// COPY ONCE -> VERIFY: the PostgreSQL half of the CRM cutover (docs/architecture/crm-cutover-plan.md §3.4).
//
// Driven only by the operator CLI functions/scripts/crmCutover.js, which fences the environment BEFORE this module or
// `pg` is loaded. Consumes the canonical records crmCutoverSnapshot.ts produced from an exported snapshot file; loads no
// Firebase module and has no Firestore path (crmCutover.test.mjs). Not an API operation, never composed in server.ts.
//
// ════════════════════ COPY ════════════════════
//
// ONE transaction for the whole tenant, under a transaction-scoped advisory lock:
//   * the tenant, the #1912 schema and the performing EOS Principal (active, active member of the tenant) must exist;
//   * every owner is RE-RESOLVED inside the transaction against eos_workforce.employees of the tenant (a census can be
//     stale) -- an unresolved owner refuses, it is never nulled;
//   * an id held by ANOTHER tenant refuses (ids are global primary keys and are never re-minted);
//   * absent record -> INSERT, verbatim id and timestamps; present and identical -> nothing;
//   * present and DIFFERENT -> DRIFT_DETECTED, everything rolled back, NEVER overwritten;
//   * a tenant row the snapshot does not contain -> TARGET_HAS_UNKNOWN_RECORDS, rolled back -- except rows whose ids the
//     synthetic nonprod seed manifest DECLARES, and only when the operator explicitly retains them.
// Order: Accounts (billing contact NULL) -> Account child sets -> Contacts -> customer sites -> billing contacts, so every
// composite foreign key holds row by row. created_by / updated_by are the performing EOS PRINCIPAL; a Firebase uid is
// never written anywhere (it lives in the evidence file). A run that inserts anything appends ONE
// eos_policy.audit_events row; a no-op run appends nothing.
//
// ════════════════════ VERIFY ════════════════════
//
// READ ONLY, REPEATABLE READ. Counts, id sets, field-by-field reconciliation over a deterministic sample (or all), FK
// integrity (children -> Account, billing contact on its Account, owners -> same-tenant Employees), Commercial / finance
// Account references resolving, no Firebase uid in an attribution column, and no Certification-excluded id present.
import type { PoolClient } from "pg";
import { createHash, randomUUID } from "node:crypto";
import { EMPLOYMENT_STATUS_VALUES } from "../employeeIdentity/employeeAuthority.js";
import { ACCOUNT_LINES_OF_BUSINESS, ACCOUNT_RELATIONSHIP_TYPES } from "../eosCrm/accountVocabulary.js";
import {
  ACCOUNT_FIELDS,
  CONTACT_FIELDS,
  LOCATION_FIELDS,
  type CanonicalAccount,
  type CanonicalContact,
  type CanonicalCrm,
  type CanonicalLocation,
  type CrmCollection,
} from "./crmCutoverSnapshot.js";
import { ACCOUNT_REFERENCING_TABLES, crmBusinessFactSchemaPresent, relationExists } from "./crmCutoverTarget.js";

type Db = Pick<PoolClient, "query">;

export class CrmCutoverError extends Error {
  constructor(readonly code: string, message: string, readonly details: unknown = null) {
    super(message);
    this.name = "CrmCutoverError";
  }
}

export interface DeclaredSyntheticIds {
  readonly accounts: readonly string[];
  readonly contacts: readonly string[];
  readonly locations: readonly string[];
}
const NO_SYNTHETIC: DeclaredSyntheticIds = { accounts: [], contacts: [], locations: [] };

/** Microsecond UTC ISO, the same string crmCutoverSnapshot.ts produces. */
const ISO = (column: string) => `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const vocabularyOrder = (values: readonly string[], vocabulary: readonly string[]) =>
  [...values].sort((x, y) => vocabulary.indexOf(x) - vocabulary.indexOf(y) || (x < y ? -1 : x > y ? 1 : 0));

/** Every CRM record of ONE tenant, in canonical shape. Tenant-predicated on every table. */
export async function readTenantCrm(db: Db, tenantId: string): Promise<CanonicalCrm & { attribution: Map<string, { createdBy: string; updatedBy: string }> }> {
  const attribution = new Map<string, { createdBy: string; updatedBy: string }>();
  const accounts = (await db.query(
    `SELECT a.id, a.name, a.status::text AS status, a.owner_employee_id, a.notes, a.billing_address_street, a.billing_address_city,
            a.billing_address_state, a.billing_address_postal_code, a.customer_number, a.erp_id, a.accounting_id, a.legacy_id,
            a.default_currency, a.purchase_order_required, a.invoice_delivery_method, a.payment_terms, a.tax_status,
            a.billing_contact_id, a.created_by, a.updated_by, ${ISO("a.created_at")} AS created_at, ${ISO("a.updated_at")} AS updated_at,
            ARRAY(SELECT t.tag FROM eos_crm.account_tags t WHERE t.tenant_id = a.tenant_id AND t.account_id = a.id ORDER BY t.position) AS tags,
            ARRAY(SELECT r.relationship_type FROM eos_crm.account_relationship_types r WHERE r.tenant_id = a.tenant_id AND r.account_id = a.id) AS relationship_types,
            ARRAY(SELECT l.line_of_business FROM eos_crm.account_lines_of_business l WHERE l.tenant_id = a.tenant_id AND l.account_id = a.id) AS lines_of_business
       FROM eos_crm.accounts a WHERE a.tenant_id = $1 ORDER BY a.id`,
    [tenantId],
  )).rows.map((r): CanonicalAccount => {
    attribution.set(`accounts|${r.id}`, { createdBy: r.created_by, updatedBy: r.updated_by });
    return {
      id: r.id, name: r.name, status: r.status, ownerEmployeeId: r.owner_employee_id, notes: r.notes,
      billingAddressStreet: r.billing_address_street, billingAddressCity: r.billing_address_city, billingAddressState: r.billing_address_state,
      billingAddressPostalCode: r.billing_address_postal_code, customerNumber: r.customer_number, erpId: r.erp_id, accountingId: r.accounting_id,
      legacyId: r.legacy_id, defaultCurrency: r.default_currency, purchaseOrderRequired: r.purchase_order_required,
      invoiceDeliveryMethod: r.invoice_delivery_method, paymentTerms: r.payment_terms, taxStatus: r.tax_status, billingContactId: r.billing_contact_id,
      tags: r.tags, relationshipTypes: vocabularyOrder(r.relationship_types, ACCOUNT_RELATIONSHIP_TYPES),
      linesOfBusiness: vocabularyOrder(r.lines_of_business, ACCOUNT_LINES_OF_BUSINESS), createdAt: r.created_at, updatedAt: r.updated_at,
    };
  });
  const contacts = (await db.query(
    `SELECT id, account_id, name, email, phone, contact_role, is_primary, owner_employee_id, created_by, updated_by,
            ${ISO("created_at")} AS created_at, ${ISO("updated_at")} AS updated_at
       FROM eos_crm.contacts WHERE tenant_id = $1 ORDER BY id`,
    [tenantId],
  )).rows.map((r): CanonicalContact => {
    attribution.set(`contacts|${r.id}`, { createdBy: r.created_by, updatedBy: r.updated_by });
    return {
      id: r.id, accountId: r.account_id, name: r.name, email: r.email, phone: r.phone, contactRole: r.contact_role, isPrimary: r.is_primary,
      ownerEmployeeId: r.owner_employee_id, createdAt: r.created_at, updatedAt: r.updated_at,
    };
  });
  const locations = (await db.query(
    `SELECT id, account_id, name, address_street, address_city, address_state, address_postal_code, access_notes, owner_employee_id,
            created_by, updated_by, ${ISO("created_at")} AS created_at, ${ISO("updated_at")} AS updated_at
       FROM eos_crm.account_locations WHERE tenant_id = $1 ORDER BY id`,
    [tenantId],
  )).rows.map((r): CanonicalLocation => {
    attribution.set(`locations|${r.id}`, { createdBy: r.created_by, updatedBy: r.updated_by });
    return {
      id: r.id, accountId: r.account_id, name: r.name, addressStreet: r.address_street, addressCity: r.address_city, addressState: r.address_state,
      addressPostalCode: r.address_postal_code, accessNotes: r.access_notes, ownerEmployeeId: r.owner_employee_id,
      createdAt: r.created_at, updatedAt: r.updated_at,
    };
  });
  return { accounts, contacts, locations, attribution };
}

export function differingFields<T extends object>(fields: readonly (keyof T & string)[], a: T, b: T): string[] {
  return fields.filter((f) => JSON.stringify(a[f]) !== JSON.stringify(b[f]));
}

interface FamilyPlan<T> { insert: T[]; unchanged: number; drift: { id: string; fields: string[] }[]; unknown: string[]; retained: string[] }

function plan<T extends { id: string }>(source: readonly T[], target: readonly T[], fields: readonly (keyof T & string)[], declared: readonly string[], retain: boolean): FamilyPlan<T> {
  const byId = new Map(target.map((r) => [r.id, r]));
  const sourceIds = new Set(source.map((r) => r.id));
  const declaredIds = new Set(declared);
  const out: FamilyPlan<T> = { insert: [], unchanged: 0, drift: [], unknown: [], retained: [] };
  for (const r of target) {
    if (sourceIds.has(r.id)) continue;
    if (retain && declaredIds.has(r.id)) out.retained.push(r.id);
    else out.unknown.push(r.id);
  }
  for (const s of source) {
    const t = byId.get(s.id);
    if (t === undefined) { out.insert.push(s); continue; }
    const diff = differingFields(fields, s, t);
    if (diff.length === 0) out.unchanged += 1;
    else out.drift.push({ id: s.id, fields: diff });
  }
  return out;
}

const PRINCIPAL_ID = /^[A-Za-z0-9_-]{1,200}$/;

export interface CrmCopyReport {
  readonly outcome: "COPIED" | "NO_CHANGES";
  readonly tenantId: string;
  readonly canonicalDigest: string;
  readonly performedByPrincipalId: string;
  readonly accounts: { readonly inserted: number; readonly unchanged: number };
  readonly contacts: { readonly inserted: number; readonly unchanged: number };
  readonly locations: { readonly inserted: number; readonly unchanged: number };
  readonly retainedDeclaredSyntheticRows: Readonly<Record<CrmCollection, readonly string[]>>;
  readonly auditEventId: string | null;
}

export interface CrmCopyInput {
  readonly tenantId: string;
  readonly performedByPrincipalId: string;
  readonly crm: CanonicalCrm;
  readonly canonicalDigest: string;
  readonly snapshotSha256: string;
  readonly evidenceSha256: string;
  readonly declaredSynthetic?: DeclaredSyntheticIds;
  readonly retainDeclaredSynthetic?: boolean;
}

export async function copyCrm(client: PoolClient, input: CrmCopyInput): Promise<CrmCopyReport> {
  const { tenantId, crm } = input;
  const actor = input.performedByPrincipalId;
  if (typeof actor !== "string" || !PRINCIPAL_ID.test(actor)) {
    throw new CrmCutoverError("PERFORMED_BY_INVALID", "the performing EOS Principal id is required");
  }
  const declared = input.declaredSynthetic ?? NO_SYNTHETIC;
  const retain = input.retainDeclaredSynthetic === true;
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`crm-cutover|${tenantId}`]);
    if ((await client.query("SELECT 1 FROM eos_policy.tenants WHERE id = $1", [tenantId])).rows.length === 0) {
      throw new CrmCutoverError("TENANT_NOT_FOUND", "the target tenant does not exist; the copy never creates one");
    }
    if (!(await crmBusinessFactSchemaPresent(client))) {
      throw new CrmCutoverError("CRM_TARGET_SCHEMA_ABSENT", "eos_crm lacks the D1-A Account business-fact schema (migration 025)");
    }
    const member = await client.query(
      `SELECT 1 FROM eos_policy.tenant_memberships m JOIN eos_policy.principals p ON p.id = m.principal_id
        WHERE m.tenant_id = $1 AND m.principal_id = $2 AND m.status = 'active' AND p.status = 'active'`,
      [tenantId, actor],
    );
    if (member.rows.length === 0) {
      throw new CrmCutoverError("PERFORMER_NOT_TENANT_PRINCIPAL", "the performing id is not an active EOS Principal with an active membership in the tenant");
    }

    // Owners, re-resolved in THIS transaction.
    const owners = [...new Set([...crm.accounts, ...crm.contacts, ...crm.locations].map((r) => r.ownerEmployeeId).filter((o): o is string => o !== null))];
    const resolved = new Set((await client.query(
      `SELECT id FROM eos_workforce.employees WHERE tenant_id = $1 AND id = ANY($2::text[]) AND employment_status::text = ANY($3::text[]) FOR SHARE`,
      [tenantId, owners, [...EMPLOYMENT_STATUS_VALUES]],
    )).rows.map((r: { id: string }) => r.id));
    const unresolved = owners.filter((o) => !resolved.has(o)).sort();
    if (unresolved.length > 0) throw new CrmCutoverError("OWNER_UNRESOLVED", `${unresolved.length} owner(s) are not Employees of the tenant; nothing was written`, unresolved);

    // Ids are global primary keys: an id held by another tenant is never re-minted around.
    const foreign: { collection: string; id: string }[] = [];
    for (const [collection, table, ids] of [
      ["accounts", "eos_crm.accounts", crm.accounts.map((r) => r.id)],
      ["contacts", "eos_crm.contacts", crm.contacts.map((r) => r.id)],
      ["locations", "eos_crm.account_locations", crm.locations.map((r) => r.id)],
    ] as const) {
      const { rows } = await client.query(`SELECT id FROM ${table} WHERE id = ANY($1::text[]) AND tenant_id <> $2 ORDER BY id`, [ids, tenantId]);
      for (const r of rows as { id: string }[]) foreign.push({ collection, id: r.id });
    }
    if (foreign.length > 0) throw new CrmCutoverError("ID_HELD_BY_ANOTHER_TENANT", `${foreign.length} snapshot id(s) belong to another tenant; nothing was written`, foreign);

    const target = await readTenantCrm(client, tenantId);
    const plans = {
      accounts: plan(crm.accounts, target.accounts, ACCOUNT_FIELDS, declared.accounts, retain),
      contacts: plan(crm.contacts, target.contacts, CONTACT_FIELDS, declared.contacts, retain),
      locations: plan(crm.locations, target.locations, LOCATION_FIELDS, declared.locations, retain),
    };
    const drift = (["accounts", "contacts", "locations"] as const).flatMap((c) => plans[c].drift.map((d) => ({ collection: c, ...d })));
    if (drift.length > 0) throw new CrmCutoverError("DRIFT_DETECTED", `${drift.length} snapshot record(s) differ from the tenant's records; nothing was written or overwritten`, drift);
    const unknown = (["accounts", "contacts", "locations"] as const).flatMap((c) => plans[c].unknown.map((id) => ({ collection: c, id })));
    if (unknown.length > 0) throw new CrmCutoverError("TARGET_HAS_UNKNOWN_RECORDS", `${unknown.length} tenant record(s) are not in the snapshot; nothing was written`, unknown);

    for (const a of plans.accounts.insert) {
      await client.query(
        `INSERT INTO eos_crm.accounts (id, tenant_id, name, status, owner_employee_id, notes, billing_address_street, billing_address_city,
           billing_address_state, billing_address_postal_code, customer_number, erp_id, accounting_id, legacy_id, default_currency,
           purchase_order_required, invoice_delivery_method, payment_terms, tax_status, billing_contact_id, created_by, updated_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,NULL,$20,$20,$21,$22)`,
        [a.id, tenantId, a.name, a.status, a.ownerEmployeeId, a.notes, a.billingAddressStreet, a.billingAddressCity, a.billingAddressState,
          a.billingAddressPostalCode, a.customerNumber, a.erpId, a.accountingId, a.legacyId, a.defaultCurrency, a.purchaseOrderRequired,
          a.invoiceDeliveryMethod, a.paymentTerms, a.taxStatus, actor, a.createdAt, a.updatedAt],
      );
      if (a.tags.length > 0) {
        await client.query(
          `INSERT INTO eos_crm.account_tags (tenant_id, account_id, position, tag)
           SELECT $1, $2, (v.ord - 1)::smallint, v.value FROM unnest($3::text[]) WITH ORDINALITY AS v(value, ord)`,
          [tenantId, a.id, a.tags],
        );
      }
      if (a.relationshipTypes.length > 0) {
        await client.query(`INSERT INTO eos_crm.account_relationship_types (tenant_id, account_id, relationship_type) SELECT $1, $2, unnest($3::text[])`, [tenantId, a.id, a.relationshipTypes]);
      }
      if (a.linesOfBusiness.length > 0) {
        await client.query(`INSERT INTO eos_crm.account_lines_of_business (tenant_id, account_id, line_of_business) SELECT $1, $2, unnest($3::text[])`, [tenantId, a.id, a.linesOfBusiness]);
      }
    }
    for (const c of plans.contacts.insert) {
      await client.query(
        `INSERT INTO eos_crm.contacts (id, tenant_id, account_id, name, email, phone, contact_role, is_primary, owner_employee_id, created_by, updated_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,$12)`,
        [c.id, tenantId, c.accountId, c.name, c.email, c.phone, c.contactRole, c.isPrimary, c.ownerEmployeeId, actor, c.createdAt, c.updatedAt],
      );
    }
    for (const l of plans.locations.insert) {
      await client.query(
        `INSERT INTO eos_crm.account_locations (id, tenant_id, account_id, name, address_street, address_city, address_state, address_postal_code,
           access_notes, owner_employee_id, created_by, updated_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12,$13)`,
        [l.id, tenantId, l.accountId, l.name, l.addressStreet, l.addressCity, l.addressState, l.addressPostalCode, l.accessNotes, l.ownerEmployeeId,
          actor, l.createdAt, l.updatedAt],
      );
    }
    for (const a of plans.accounts.insert) {
      if (a.billingContactId === null) continue;
      await client.query(`UPDATE eos_crm.accounts SET billing_contact_id = $3 WHERE tenant_id = $1 AND id = $2`, [tenantId, a.id, a.billingContactId]);
    }

    const inserted = { accounts: plans.accounts.insert.length, contacts: plans.contacts.insert.length, locations: plans.locations.insert.length };
    let auditEventId: string | null = null;
    if (inserted.accounts + inserted.contacts + inserted.locations > 0) {
      auditEventId = `crm_cutover_${randomUUID()}`;
      await client.query(
        `INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, reason)
         VALUES ($1, $2, 'crm.cutover.copy', $3, 'crm_cutover', $4, NULL, $5::jsonb, $6)`,
        [auditEventId, tenantId, actor, input.canonicalDigest, JSON.stringify({
          snapshotSha256: input.snapshotSha256, canonicalDigest: input.canonicalDigest, evidenceSha256: input.evidenceSha256, inserted,
          unchanged: { accounts: plans.accounts.unchanged, contacts: plans.contacts.unchanged, locations: plans.locations.unchanged },
          retainedDeclaredSyntheticRows: { accounts: plans.accounts.retained, contacts: plans.contacts.retained, locations: plans.locations.retained },
        }), "CRM Firestore -> PostgreSQL cutover: copy once (docs/architecture/crm-cutover-plan.md)"],
      );
    }
    await client.query("COMMIT");
    return {
      outcome: auditEventId === null ? "NO_CHANGES" : "COPIED",
      tenantId,
      canonicalDigest: input.canonicalDigest,
      performedByPrincipalId: actor,
      accounts: { inserted: inserted.accounts, unchanged: plans.accounts.unchanged },
      contacts: { inserted: inserted.contacts, unchanged: plans.contacts.unchanged },
      locations: { inserted: inserted.locations, unchanged: plans.locations.unchanged },
      retainedDeclaredSyntheticRows: { accounts: plans.accounts.retained, contacts: plans.contacts.retained, locations: plans.locations.retained },
      auditEventId,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  }
}

// ════════════════════ verify ════════════════════

export interface CrmVerifyInput {
  readonly tenantId: string;
  readonly crm: CanonicalCrm;
  readonly sample: number | "all";
  /** Every Firebase uid / legacy actor string the snapshot's provenance evidence names. None may be an attribution. */
  readonly provenanceActors: readonly string[];
  /** Certification-excluded ids per collection. None may be present. */
  readonly excludedIds: Readonly<Record<CrmCollection, readonly string[]>>;
  readonly declaredSynthetic?: DeclaredSyntheticIds;
}

export interface CrmVerifyReport {
  readonly reconciled: boolean;
  readonly counts: Readonly<Record<CrmCollection, { readonly source: number; readonly target: number; readonly declaredSynthetic: number }>>;
  readonly missingInTarget: Readonly<Record<CrmCollection, readonly string[]>>;
  readonly unexpectedInTarget: Readonly<Record<CrmCollection, readonly string[]>>;
  readonly sampled: Readonly<Record<CrmCollection, number>>;
  readonly fieldMismatches: readonly { readonly collection: CrmCollection; readonly id: string; readonly fields: readonly string[] }[];
  readonly integrity: {
    readonly contactsWithoutAccount: number;
    readonly locationsWithoutAccount: number;
    readonly billingContactNotOnAccount: number;
    readonly ownersUnresolved: number;
    readonly attributionNotAnEosPrincipal: number;
    readonly attributionIsLegacyActor: number;
    readonly certificationExcludedPresent: number;
  };
  readonly commercialAccountReferences: readonly { readonly table: string; readonly rows: number; readonly unresolved: number }[];
}

const sampleOrder = (id: string) => createHash("sha256").update(id).digest("hex");

export async function verifyCrm(client: PoolClient, input: CrmVerifyInput): Promise<CrmVerifyReport> {
  const { tenantId, crm } = input;
  const declared = input.declaredSynthetic ?? NO_SYNTHETIC;
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const target = await readTenantCrm(client, tenantId);
    const families = [
      ["accounts", crm.accounts, target.accounts, ACCOUNT_FIELDS, declared.accounts],
      ["contacts", crm.contacts, target.contacts, CONTACT_FIELDS, declared.contacts],
      ["locations", crm.locations, target.locations, LOCATION_FIELDS, declared.locations],
    ] as const;
    const counts = {} as Record<CrmCollection, { source: number; target: number; declaredSynthetic: number }>;
    const missing = {} as Record<CrmCollection, string[]>;
    const unexpected = {} as Record<CrmCollection, string[]>;
    const sampled = {} as Record<CrmCollection, number>;
    const mismatches: { collection: CrmCollection; id: string; fields: string[] }[] = [];
    for (const [collection, source, tgt, fields, declaredIds] of families) {
      const byId = new Map<string, object>(tgt.map((r) => [r.id, r]));
      const sourceIds = new Set<string>(source.map((r) => r.id));
      const declaredSet = new Set(declaredIds);
      const synthetic = tgt.filter((r) => !sourceIds.has(r.id) && declaredSet.has(r.id)).length;
      counts[collection] = { source: source.length, target: tgt.length, declaredSynthetic: synthetic };
      missing[collection] = source.filter((r) => !byId.has(r.id)).map((r) => r.id);
      unexpected[collection] = tgt.filter((r) => !sourceIds.has(r.id) && !declaredSet.has(r.id)).map((r) => r.id);
      const ordered = [...source].sort((a, b) => (sampleOrder(a.id) < sampleOrder(b.id) ? -1 : 1));
      const chosen = input.sample === "all" ? ordered : ordered.slice(0, input.sample);
      sampled[collection] = chosen.length;
      for (const s of chosen) {
        const t = byId.get(s.id);
        if (t === undefined) continue;
        const diff = differingFields(fields as readonly string[] as never, s as never, t as never);
        if (diff.length > 0) mismatches.push({ collection, id: s.id, fields: diff });
      }
    }

    const n = async (sql: string, values: unknown[]) => Number((await client.query(sql, values)).rows[0].n);
    const legacyActors = [...new Set(input.provenanceActors.filter((a) => typeof a === "string" && a !== ""))];
    const attributionQuery = (table: string, predicate: string) =>
      `SELECT count(*)::int AS n FROM ${table} x WHERE x.tenant_id = $1 AND (${predicate})`;
    let attributionNotPrincipal = 0;
    let attributionLegacy = 0;
    let excludedPresent = 0;
    const sourceIdsOf: Record<CrmCollection, string[]> = { accounts: crm.accounts.map((r) => r.id), contacts: crm.contacts.map((r) => r.id), locations: crm.locations.map((r) => r.id) };
    for (const [collection, table] of [["accounts", "eos_crm.accounts"], ["contacts", "eos_crm.contacts"], ["locations", "eos_crm.account_locations"]] as const) {
      // Copied rows must be attributed to an EOS Principal (rows the copy did not write are not its claim to make).
      attributionNotPrincipal += await n(attributionQuery(table,
        "x.id = ANY($2::text[]) AND (NOT EXISTS (SELECT 1 FROM eos_policy.principals p WHERE p.id = x.created_by) OR NOT EXISTS (SELECT 1 FROM eos_policy.principals p WHERE p.id = x.updated_by))"),
      [tenantId, sourceIdsOf[collection]]);
      attributionLegacy += await n(attributionQuery(table, "x.created_by = ANY($2::text[]) OR x.updated_by = ANY($2::text[])"), [tenantId, legacyActors]);
      excludedPresent += await n(attributionQuery(table, "x.id = ANY($2::text[])"), [tenantId, [...input.excludedIds[collection]]]);
    }
    const integrity = {
      contactsWithoutAccount: await n(`SELECT count(*)::int AS n FROM eos_crm.contacts c WHERE c.tenant_id = $1
        AND NOT EXISTS (SELECT 1 FROM eos_crm.accounts a WHERE a.tenant_id = c.tenant_id AND a.id = c.account_id)`, [tenantId]),
      locationsWithoutAccount: await n(`SELECT count(*)::int AS n FROM eos_crm.account_locations l WHERE l.tenant_id = $1
        AND NOT EXISTS (SELECT 1 FROM eos_crm.accounts a WHERE a.tenant_id = l.tenant_id AND a.id = l.account_id)`, [tenantId]),
      billingContactNotOnAccount: await n(`SELECT count(*)::int AS n FROM eos_crm.accounts a WHERE a.tenant_id = $1 AND a.billing_contact_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM eos_crm.contacts c WHERE c.tenant_id = a.tenant_id AND c.account_id = a.id AND c.id = a.billing_contact_id)`, [tenantId]),
      ownersUnresolved: await n(`SELECT count(*)::int AS n FROM (
          SELECT owner_employee_id FROM eos_crm.accounts WHERE tenant_id = $1
          UNION ALL SELECT owner_employee_id FROM eos_crm.contacts WHERE tenant_id = $1
          UNION ALL SELECT owner_employee_id FROM eos_crm.account_locations WHERE tenant_id = $1) o
        WHERE o.owner_employee_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM eos_workforce.employees e WHERE e.tenant_id = $1 AND e.id = o.owner_employee_id AND e.employment_status::text = ANY($2::text[]))`,
      [tenantId, [...EMPLOYMENT_STATUS_VALUES]]),
      attributionNotAnEosPrincipal: attributionNotPrincipal,
      attributionIsLegacyActor: attributionLegacy,
      certificationExcludedPresent: excludedPresent,
    };

    const commercial: { table: string; rows: number; unresolved: number }[] = [];
    for (const table of ACCOUNT_REFERENCING_TABLES) {
      if (!(await relationExists(client, table))) continue;
      // `table` comes only from the frozen list.
      const { rows } = await client.query(
        `SELECT count(*)::int AS rows,
                count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM eos_crm.accounts a WHERE a.tenant_id = x.tenant_id AND a.id = x.account_id))::int AS unresolved
           FROM ${table} x WHERE x.tenant_id = $1`,
        [tenantId],
      );
      commercial.push({ table, rows: rows[0].rows, unresolved: rows[0].unresolved });
    }
    await client.query("COMMIT");

    const reconciled = (Object.keys(counts) as CrmCollection[]).every((c) => missing[c].length === 0 && unexpected[c].length === 0)
      && mismatches.length === 0 && Object.values(integrity).every((v) => v === 0) && commercial.every((c) => c.unresolved === 0);
    return { reconciled, counts, missingInTarget: missing, unexpectedInTarget: unexpected, sampled, fieldMismatches: mismatches, integrity, commercialAccountReferences: commercial };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  }
}
