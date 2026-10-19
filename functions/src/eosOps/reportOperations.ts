// REPORT BUILDER AND SAVED REPORTS ON EOS (Firebase exit B4, DECISIONS #B4; F7e). It replaces the seven Firebase callables
// (runReportDefinitionCallable and the six saved-definition callables) with the SAME behaviour over PostgreSQL:
//
//   * the governed report CATALOG and structural VALIDATOR are the Firebase engine's own pure modules (reporting/reportCatalog.ts,
//     reportQueryValidation.ts) -- one definition of what a well-formed, in-catalog report is, for the client, the Firebase engine and this one;
//   * a run reads the existing EOS records (eos_crm accounts / contacts / customer sites, eos_ops equipment) and applies the Firebase engine's query
//     semantics unchanged (reporting/reportPipeline.ts): predicate-drop for any field the runner may not read, the scan-bound refusals (an aggregate
//     over a cut population, and a zero-row answer out of a cut scan, are REFUSED rather than returned as a number or a proven "empty"), the one-hop
//     join, the row and group caps, and exactly one audit event per run -- never row data.
//
// AUTHORITY, IN THIS ORDER. (1) The object's report.<object>.read capability: not held = a permission-denied OUTCOME (audited), nothing read.
// (2) COMPANY (#235 / #237): the caller's operating companies (companyAuthority.ts). None = a company-unresolved OUTCOME, nothing read -- a tenancy failure
// kept distinct from a missing grant so nobody grants a Role to fix it. Equipment is company-owned (ruling D-12): its scan carries the caller's
// companies IN THE SERVER QUERY, so another company's unit is never read. Customers, contacts and customer sites are company-NEUTRAL (ruling R-15):
// no row predicate exists to apply and none is invented; a reach is still required to run at all. Whether a neutral record should be narrower than
// that stays the open question Q-ENGE-3 and is not decided here. (3) Every field (and the traversal capability of a joined field) is decided on its own
// report.<object>.field.<group>.read key; a field the runner may not read is DROPPED from the answer, and a filter, group, sort or aggregate over one is
// dropped too (it widens the result, never leaks membership).
//
// THE THREE FIELDS FIREBASE WITHHOLDS stay withheld. customer notes, customer accountOwner and location accessNotes are registered and held as in the
// Firebase catalog but resolve DENY in every Firebase environment (not activated); INACTIVE_REPORT_CAPABILITIES keeps that here, so EOS is never
// more permissive than the system it replaces.
//
// A SAVED DEFINITION is an envelope owned by one Principal and confers NO report-data access (ADR-007 sec2.6): a run re-decides everything. Another
// Principal's definition reads exactly as a missing one (the same code and message -- no existence oracle), and the capability gate runs BEFORE the
// target is read so a caller without the capability cannot tell an existing id from a missing one.
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { getReportField, getReportObject, type ReportField } from "../reporting/reportCatalog.js";
import { validateReportDefinition, resolveDefinitionField, type ReportDefinition } from "../reporting/reportQueryValidation.js";
import { isFieldlessAggregate } from "../reporting/reportQueryModel.js";
import {
  MAX_GROUP_CARDINALITY, MAX_RESULT_ROWS, MAX_SCAN_DOCS, aggregateResultKey, computeAggregate, getAtPath, getFieldValue, groupDocuments,
  judgeAbsenceProvenance, judgeScanCompleteness, matchesFilter, projectDoc, rawFieldPath, sortRows, type Doc,
} from "../reporting/reportPipeline.js";
import { resolveCompanyAuthority } from "./companyAuthority.js";
import { acceptOnly, inTransaction, recordsAudit, refuse, ID_SHAPE, type RecordsActor } from "./recordsSupport.js";

const SCHEMA = "eos_ops";

export const REPORT_DEFINITION_CAPABILITIES = Object.freeze({
  create: "report.definition.create",
  // The EOS twin of the Firebase id report.definition.read (migration 1762300800000; same holders).
  read: "reportDefinition.read",
  rename: "report.definition.rename",
  duplicate: "report.definition.duplicate",
  delete: "report.definition.delete",
});

/** Registered and held as in Firebase, and DENIED in every Firebase environment (not activated). EOS keeps them denied. */
export const INACTIVE_REPORT_CAPABILITIES: ReadonlySet<string> = Object.freeze(new Set([
  "report.customer.field.notes.read",
  "report.customer.field.accountOwner.read",
  "report.location.field.accessNotes.read",
]));

export const MAX_NAME_LENGTH = 120;

// ════════════════════ saved definitions ════════════════════

export interface SavedDefinitionRecord {
  readonly id: string;
  readonly name: string;
  readonly ownerUid: string;
  readonly definition: unknown;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const NOT_FOUND = (): never => refuse("DEFINITION_NOT_FOUND", "NOT_FOUND", "no saved definition exists at that id");

const recordOf = (r: Record<string, unknown>): SavedDefinitionRecord => ({
  id: String(r.id), name: String(r.name), ownerUid: String(r.owner_principal_id), definition: r.definition,
  createdAt: (r.created_at as Date).toISOString(), updatedAt: (r.updated_at as Date).toISOString(),
});

function assertValidName(name: unknown): asserts name is string {
  if (typeof name !== "string" || name.trim().length === 0) refuse("NAME_REQUIRED", "INVALID_INPUT", "name is required");
  if ((name as string).length > MAX_NAME_LENGTH) refuse("NAME_TOO_LONG", "INVALID_INPUT", `name exceeds ${MAX_NAME_LENGTH} characters`);
}

/**
 * ABUSE BOUNDS (independent review MEDIUM-2). The shared validator proves a definition is well-formed and in-catalog but bounds no COUNT: a 100k-entry filters array or a
 * megabyte `in` list is "valid" and would be stored and then evaluated against every scanned record. These limits are checked BEFORE the validator on every path that accepts a
 * definition (save and run), they are cheap (length reads, then one serialisation), and they live HERE rather than in the validator on purpose: that module is the Firebase
 * engine's own port, kept byte-for-byte in parity with the client copy.
 */
export const REPORT_LIMITS = Object.freeze({
  filters: 25, sort: 5, aggregates: 10, groupBy: 10,
  // Not in the review: `fields` is the same unbounded-array shape. The catalog has fewer than 100 fields across all four objects, and duplicates are already errors.
  fields: 100,
  filterValues: 100, stringValue: 500,
  definitionBytes: 32 * 1024,
  savedPerOwner: 200,
});

function assertWithinReportLimits(definition: unknown): void {
  if (definition === null || typeof definition !== "object" || Array.isArray(definition)) return; // the validator names that
  const d = definition as Record<string, unknown>;
  for (const key of ["filters", "sort", "aggregates", "groupBy", "fields"] as const) {
    const v = d[key];
    if (Array.isArray(v) && v.length > REPORT_LIMITS[key]) {
      refuse("DEFINITION_TOO_LARGE", "INVALID_INPUT", `definition.${key} has ${v.length} entries; at most ${REPORT_LIMITS[key]} are allowed`);
    }
  }
  if (Array.isArray(d.sort)) {
    const seen = new Set<string>();
    for (const s of d.sort as Array<{ fieldId?: unknown } | null>) {
      const id = s?.fieldId;
      if (typeof id !== "string") continue;
      if (seen.has(id)) refuse("INVALID_DEFINITION", "INVALID_INPUT", `Invalid report definition: sort: duplicate ${id}`);
      seen.add(id);
    }
  }
  if (Array.isArray(d.filters)) {
    for (const f of d.filters as Array<{ value?: unknown } | null>) {
      const value = f?.value;
      const values = Array.isArray(value) ? value : [value];
      if (values.length > REPORT_LIMITS.filterValues) {
        refuse("DEFINITION_TOO_LARGE", "INVALID_INPUT", `a filter value list has ${values.length} entries; at most ${REPORT_LIMITS.filterValues} are allowed`);
      }
      for (const v of values) {
        if (typeof v === "string" && v.length > REPORT_LIMITS.stringValue) {
          refuse("DEFINITION_TOO_LARGE", "INVALID_INPUT", `a filter value is longer than ${REPORT_LIMITS.stringValue} characters`);
        }
      }
    }
  }
  if (Buffer.byteLength(JSON.stringify(definition), "utf8") > REPORT_LIMITS.definitionBytes) {
    refuse("DEFINITION_TOO_LARGE", "INVALID_INPUT", `the definition is larger than ${REPORT_LIMITS.definitionBytes} bytes`);
  }
}

/** A per-owner cap on saved definitions. Serialised per owner (advisory lock) so two concurrent creates cannot both pass the count. Call INSIDE the write transaction. */
async function assertOwnerCapacity(c: PoolClient, actor: RecordsActor): Promise<void> {
  await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`report_definitions:${actor.tenantId}:${actor.principalId}`]);
  const { rows } = await c.query(`SELECT count(*)::int AS n FROM ${SCHEMA}.report_definitions WHERE tenant_id = $1 AND owner_principal_id = $2`, [actor.tenantId, actor.principalId]);
  if (Number(rows[0].n) >= REPORT_LIMITS.savedPerOwner) {
    refuse("TOO_MANY_SAVED_DEFINITIONS", "PRECONDITION_FAILED", `at most ${REPORT_LIMITS.savedPerOwner} saved report definitions per user; delete one first`);
  }
}

function assertValidDefinition(definition: unknown): ReportDefinition {
  assertWithinReportLimits(definition);
  const errors = validateReportDefinition(definition);
  if (errors.length > 0) refuse("INVALID_DEFINITION", "INVALID_INPUT", `Invalid report definition: ${errors.join("; ")}`);
  return definition as ReportDefinition;
}

function assertActor(actor: RecordsActor): void {
  if (!actor || !ID_SHAPE(actor.tenantId) || !ID_SHAPE(actor.principalId) || !(actor.capabilities instanceof Set)) {
    refuse("ACTOR_CONTEXT_REQUIRED", "FORBIDDEN", "a resolved tenant, principal and capability set are required");
  }
}

/** Every mutation audits BOTH outcomes: a denied attempt (no capability, or not the owner) still emits exactly one event. */
async function deniedAudit(pool: Pool, actor: RecordsActor, action: string, targetId: string, summary: string): Promise<void> {
  await inTransaction(pool, "write", (c) => recordsAudit(c, actor, action, "reportDefinition", targetId, { outcome: "denied" }, summary));
}

/** The capability gate for a mutation: FIRST, before any read of the target (the cross-principal existence oracle closes here). */
async function requireMutationCapability(pool: Pool, actor: RecordsActor, capability: string, action: string, targetId: string): Promise<void> {
  assertActor(actor);
  if (actor.capabilities.has(capability)) return;
  await deniedAudit(pool, actor, action, targetId, `Denied: actor lacks "${capability}".`);
  refuse("CAPABILITY_REQUIRED", "FORBIDDEN", `this requires ${capability}`);
}

function requireRead(actor: RecordsActor): void {
  assertActor(actor);
  if (!actor.capabilities.has(REPORT_DEFINITION_CAPABILITIES.read)) refuse("CAPABILITY_REQUIRED", "FORBIDDEN", `this requires ${REPORT_DEFINITION_CAPABILITIES.read}`);
}

/** Someone else's definition. Returned (not audited here) so the audit is written AFTER the transaction ends: never a second pool connection while one is held. */
const FOREIGN = Symbol("foreign-definition");

/** The caller's OWN definition; NOT_FOUND when missing; FOREIGN when it belongs to another Principal (the caller then audits it and answers the same NOT_FOUND). */
async function loadOwned(
  c: PoolClient, actor: RecordsActor, definitionId: string, lock: boolean,
): Promise<(SavedDefinitionRecord & { readonly objectId: string }) | typeof FOREIGN> {
  const { rows } = await c.query(
    `SELECT id, name, owner_principal_id, object_id, definition, created_at, updated_at FROM ${SCHEMA}.report_definitions
      WHERE tenant_id = $1 AND id = $2 ${lock ? "FOR UPDATE" : ""}`, [actor.tenantId, definitionId]);
  if (rows.length === 0) return NOT_FOUND();
  if (rows[0].owner_principal_id !== actor.principalId) return FOREIGN;
  return { ...recordOf(rows[0]), objectId: String(rows[0].object_id) };
}

/** After the transaction: audit the foreign attempt and answer exactly as for a missing id (no existence oracle). */
async function denyForeign(pool: Pool, actor: RecordsActor, action: string, definitionId: string): Promise<never> {
  await deniedAudit(pool, actor, action, definitionId, `Denied: actor does not own saved definition "${definitionId}".`);
  return NOT_FOUND();
}

export async function createSavedReportDefinition(deps: { readonly pool: Pool }, actor: RecordsActor, input: Record<string, unknown>) {
  const i = acceptOnly(input, ["name", "definition"]);
  assertActor(actor);
  assertValidName(i.name);
  const id = `rpt_${randomUUID()}`;
  // The CAPABILITY gate is the cheap check, so it runs before the definition is walked: a caller without the capability learns nothing about validation and costs nothing.
  await requireMutationCapability(deps.pool, actor, REPORT_DEFINITION_CAPABILITIES.create, "createReportDefinition", id);
  // Structural validation next: a malformed definition is refused before any write.
  const definition = assertValidDefinition(i.definition);
  return inTransaction(deps.pool, "write", async (c) => {
    await assertOwnerCapacity(c, actor);
    const { rows } = await c.query(
      `INSERT INTO ${SCHEMA}.report_definitions (tenant_id, id, name, owner_principal_id, object_id, definition)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING id, name, owner_principal_id, definition, created_at, updated_at`,
      [actor.tenantId, id, i.name, actor.principalId, String(definition.objectId), JSON.stringify(definition)]);
    await recordsAudit(c, actor, "createReportDefinition", "reportDefinition", id,
      { outcome: "applied", objectId: definition.objectId }, `Saved report definition "${i.name}" created for object "${String(definition.objectId)}".`);
    return recordOf(rows[0]);
  });
}

export async function readSavedReportDefinition(deps: { readonly pool: Pool }, actor: RecordsActor, input: Record<string, unknown>) {
  const i = acceptOnly(input, ["definitionId"]);
  requireRead(actor);
  if (!ID_SHAPE(i.definitionId)) refuse("DEFINITION_ID_REQUIRED", "INVALID_INPUT", "definitionId is required");
  const found = await inTransaction(deps.pool, "snapshot", async (c) => {
    const { rows } = await c.query(
      `SELECT id, name, owner_principal_id, definition, created_at, updated_at FROM ${SCHEMA}.report_definitions
        WHERE tenant_id = $1 AND id = $2 AND owner_principal_id = $3`, [actor.tenantId, i.definitionId, actor.principalId]);
    return rows.length === 0 ? null : recordOf(rows[0]);
  });
  return found ?? NOT_FOUND();
}

export async function listSavedReportDefinitions(deps: { readonly pool: Pool }, actor: RecordsActor, input: Record<string, unknown>) {
  acceptOnly(input, []);
  requireRead(actor);
  return inTransaction(deps.pool, "snapshot", async (c) => {
    const { rows } = await c.query(
      `SELECT id, name, owner_principal_id, definition, created_at, updated_at FROM ${SCHEMA}.report_definitions
        WHERE tenant_id = $1 AND owner_principal_id = $2 ORDER BY updated_at DESC, id`, [actor.tenantId, actor.principalId]);
    return { items: rows.map(recordOf) };
  });
}

export async function renameSavedReportDefinition(deps: { readonly pool: Pool }, actor: RecordsActor, input: Record<string, unknown>) {
  const i = acceptOnly(input, ["definitionId", "name"]);
  assertActor(actor);
  assertValidName(i.name);
  if (!ID_SHAPE(i.definitionId)) refuse("DEFINITION_ID_REQUIRED", "INVALID_INPUT", "definitionId is required");
  const definitionId = i.definitionId as string;
  await requireMutationCapability(deps.pool, actor, REPORT_DEFINITION_CAPABILITIES.rename, "renameReportDefinition", definitionId);
  const result = await inTransaction(deps.pool, "write", async (c) => {
    const current = await loadOwned(c, actor, definitionId, true);
    if (current === FOREIGN) return FOREIGN;
    const { rows } = await c.query(
      `UPDATE ${SCHEMA}.report_definitions SET name = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2
        RETURNING id, name, owner_principal_id, definition, created_at, updated_at`, [actor.tenantId, definitionId, i.name]);
    await recordsAudit(c, actor, "renameReportDefinition", "reportDefinition", definitionId,
      { outcome: "applied", objectId: current.objectId }, `Saved report definition "${definitionId}" renamed to "${String(i.name)}".`);
    return recordOf(rows[0]);
  });
  return result === FOREIGN ? denyForeign(deps.pool, actor, "renameReportDefinition", definitionId) : result;
}

export async function duplicateSavedReportDefinition(deps: { readonly pool: Pool }, actor: RecordsActor, input: Record<string, unknown>) {
  const i = acceptOnly(input, ["definitionId", "name"]);
  assertActor(actor);
  if (!ID_SHAPE(i.definitionId)) refuse("DEFINITION_ID_REQUIRED", "INVALID_INPUT", "definitionId is required");
  if (i.name !== undefined && typeof i.name !== "string") refuse("NAME_INVALID", "INVALID_INPUT", "name must be a string when present");
  const definitionId = i.definitionId as string;
  await requireMutationCapability(deps.pool, actor, REPORT_DEFINITION_CAPABILITIES.duplicate, "duplicateReportDefinition", definitionId);
  const result = await inTransaction(deps.pool, "write", async (c) => {
    const source = await loadOwned(c, actor, definitionId, false);
    if (source === FOREIGN) return FOREIGN;
    const name = i.name !== undefined ? i.name : `${source.name} (copy)`;
    assertValidName(name);
    await assertOwnerCapacity(c, actor);
    const id = `rpt_${randomUUID()}`;
    const { rows } = await c.query(
      `INSERT INTO ${SCHEMA}.report_definitions (tenant_id, id, name, owner_principal_id, object_id, definition)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING id, name, owner_principal_id, definition, created_at, updated_at`,
      [actor.tenantId, id, name, actor.principalId, source.objectId, JSON.stringify(source.definition)]);
    await recordsAudit(c, actor, "duplicateReportDefinition", "reportDefinition", id,
      { outcome: "applied", objectId: source.objectId }, `Saved report definition "${definitionId}" duplicated to "${id}".`);
    return recordOf(rows[0]);
  });
  return result === FOREIGN ? denyForeign(deps.pool, actor, "duplicateReportDefinition", definitionId) : result;
}

export async function deleteSavedReportDefinition(deps: { readonly pool: Pool }, actor: RecordsActor, input: Record<string, unknown>) {
  const i = acceptOnly(input, ["definitionId"]);
  assertActor(actor);
  if (!ID_SHAPE(i.definitionId)) refuse("DEFINITION_ID_REQUIRED", "INVALID_INPUT", "definitionId is required");
  const definitionId = i.definitionId as string;
  await requireMutationCapability(deps.pool, actor, REPORT_DEFINITION_CAPABILITIES.delete, "deleteReportDefinition", definitionId);
  const result = await inTransaction(deps.pool, "write", async (c) => {
    const current = await loadOwned(c, actor, definitionId, true);
    if (current === FOREIGN) return FOREIGN;
    await c.query(`DELETE FROM ${SCHEMA}.report_definitions WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, definitionId]);
    await recordsAudit(c, actor, "deleteReportDefinition", "reportDefinition", definitionId,
      { outcome: "applied", objectId: current.objectId }, `Saved report definition "${definitionId}" deleted.`);
    return { deleted: true as const };
  });
  return result === FOREIGN ? denyForeign(deps.pool, actor, "deleteReportDefinition", definitionId) : result;
}

// ════════════════════ the record loaders: PostgreSQL rows in the catalog's document shape ════════════════════
//
// The catalog's raw field paths (customer.billingAddress.street, location.address.city, ...) describe a document; each loader answers with exactly
// that shape so the pipeline needs no per-object code. Dates leave as ISO strings, references as the referenced record's id.

type Reader = Pick<PoolClient, "query">;
interface LoadOptions { readonly ids?: readonly string[]; readonly limit: number; readonly companyKeys?: readonly string[] }
type Loader = (c: Reader, tenantId: string, o: LoadOptions) => Promise<Doc[]>;

const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v === null || v === undefined ? null : String(v));
const dateText = (v: unknown): string | null => (v instanceof Date ? v.toISOString().slice(0, 10) : v === null || v === undefined ? null : String(v));

const loadCustomers: Loader = async (c, tenantId, o) => {
  const { rows } = await c.query(
    `SELECT a.id, a.name, a.status::text AS status, a.owner_employee_id, a.notes, a.billing_address_street, a.billing_address_city,
            a.billing_address_state, a.billing_address_postal_code, a.customer_number, a.erp_id, a.accounting_id, a.legacy_id,
            a.default_currency, a.purchase_order_required, a.invoice_delivery_method, a.payment_terms::text AS payment_terms,
            a.tax_status::text AS tax_status, a.billing_contact_id, a.created_at,
            ARRAY(SELECT t.tag FROM eos_crm.account_tags t WHERE t.tenant_id = a.tenant_id AND t.account_id = a.id ORDER BY t.position) AS tags,
            ARRAY(SELECT r.relationship_type::text FROM eos_crm.account_relationship_types r WHERE r.tenant_id = a.tenant_id AND r.account_id = a.id
                   ORDER BY r.relationship_type::text) AS relationship_types
       FROM eos_crm.accounts a
      WHERE a.tenant_id = $1 AND ($3::text[] IS NULL OR a.id = ANY($3::text[]))
      ORDER BY a.created_at, a.id LIMIT $2`,
    [tenantId, o.limit, o.ids ? [...o.ids] : null]);
  return rows.map((r) => ({
    id: String(r.id), name: r.name, status: r.status, relationshipTypes: r.relationship_types ?? [],
    billingAddress: { street: r.billing_address_street, city: r.billing_address_city, state: r.billing_address_state, zip: r.billing_address_postal_code },
    tags: r.tags ?? [], customerNumber: r.customer_number, erpId: r.erp_id, accountingId: r.accounting_id, legacyId: r.legacy_id, notes: r.notes,
    createdAt: iso(r.created_at), paymentTerms: r.payment_terms, taxStatus: r.tax_status, defaultCurrency: r.default_currency,
    purchaseOrderRequired: r.purchase_order_required, invoiceDeliveryMethod: r.invoice_delivery_method,
    billingContact: r.billing_contact_id, accountOwner: r.owner_employee_id,
  }));
};

const loadContacts: Loader = async (c, tenantId, o) => {
  const { rows } = await c.query(
    `SELECT id, name, email, phone, contact_role, account_id FROM eos_crm.contacts
      WHERE tenant_id = $1 AND ($3::text[] IS NULL OR id = ANY($3::text[])) ORDER BY id LIMIT $2`,
    [tenantId, o.limit, o.ids ? [...o.ids] : null]);
  return rows.map((r) => ({ id: String(r.id), name: r.name, email: r.email, phone: r.phone, role: r.contact_role, accountId: r.account_id }));
};

const loadLocations: Loader = async (c, tenantId, o) => {
  const { rows } = await c.query(
    `SELECT id, name, address_street, address_city, address_state, address_postal_code, access_notes, account_id FROM eos_crm.account_locations
      WHERE tenant_id = $1 AND ($3::text[] IS NULL OR id = ANY($3::text[])) ORDER BY id LIMIT $2`,
    [tenantId, o.limit, o.ids ? [...o.ids] : null]);
  return rows.map((r) => ({
    id: String(r.id), name: r.name, address: { street: r.address_street, city: r.address_city, state: r.address_state, zip: r.address_postal_code },
    accessNotes: r.access_notes, accountId: r.account_id,
  }));
};

/** Equipment is COMPANY-OWNED (ruling D-12): the caller's companies are in the server query, so another company's unit is never read. */
const loadEquipment: Loader = async (c, tenantId, o) => {
  const { rows } = await c.query(
    `SELECT e.id, e.name, e.status::text AS status, m.manufacturer_name, m.model_number, e.serial_number, e.asset_tag, e.installed_on,
            e.warranty_expires_on, e.notes, e.account_id, e.customer_location_id, e.created_at
       FROM ${SCHEMA}.equipment e
       LEFT JOIN ${SCHEMA}.equipment_models m ON m.tenant_id = e.tenant_id AND m.id = e.equipment_model_id
      WHERE e.tenant_id = $1 AND e.operating_company_key = ANY($3::text[]) AND ($4::text[] IS NULL OR e.id = ANY($4::text[]))
      ORDER BY e.created_at, e.id LIMIT $2`,
    [tenantId, o.limit, [...(o.companyKeys ?? [])], o.ids ? [...o.ids] : null]);
  return rows.map((r) => ({
    id: String(r.id), name: r.name, status: r.status, manufacturer: r.manufacturer_name, model: r.model_number, serialNumber: r.serial_number,
    assetTag: r.asset_tag, installedDate: dateText(r.installed_on), warrantyExpiresDate: dateText(r.warranty_expires_on), notes: r.notes,
    accountId: r.account_id, locationId: r.customer_location_id, createdAt: iso(r.created_at),
  }));
};

/** How a report object's rows are bounded by company: `bound` carries the company in the server query; `neutral` has no company field (R-15). */
const LOADERS: Readonly<Record<string, { readonly load: Loader; readonly rowScopeKind: "company-bound" | "company-neutral" }>> = Object.freeze({
  customer: { load: loadCustomers, rowScopeKind: "company-neutral" },
  contact: { load: loadContacts, rowScopeKind: "company-neutral" },
  location: { load: loadLocations, rowScopeKind: "company-neutral" },
  equipment: { load: loadEquipment, rowScopeKind: "company-bound" },
});

/**
 * The one-hop join, bounded like the base scan. A related object is joined only when it is company-NEUTRAL (customer, contact, location are; they are
 * the only objects the catalog's relationships reach with fields). Any other related object is REFUSED -- its rows are never read -- and reported, so a
 * zero-row answer that depends on it is never labelled a proven absence. A company-BOUND related object would be read through its own loader's company
 * predicate; none is reachable today.
 */
async function joinRelatedDocs(
  c: Reader, tenantId: string, docs: Doc[], relatedFields: ReadonlyArray<{ field: ReportField; relationship: NonNullable<ReturnType<typeof resolveDefinitionField>>["relationship"] }>,
): Promise<{ docs: Doc[]; refusedObjectIds: string[]; incompleteObjectIds: string[] }> {
  const refused = new Set<string>();
  const byRelationship = new Map<string, { toObjectId: string; viaPath: string }>();
  for (const { relationship } of relatedFields) {
    if (!relationship) continue;
    const via = getReportField(relationship.viaField);
    if (!via) continue;
    const loader = LOADERS[relationship.toObjectId];
    if (!loader || loader.rowScopeKind !== "company-neutral") { refused.add(relationship.toObjectId); continue; }
    byRelationship.set(relationship.relationshipId, { toObjectId: relationship.toObjectId, viaPath: rawFieldPath(via) });
  }
  const joined = docs.map((d) => ({ ...d }));
  for (const { toObjectId, viaPath } of byRelationship.values()) {
    const refIds = new Set<string>();
    for (const doc of joined) {
      const ref = getAtPath(doc, viaPath);
      if (typeof ref === "string" && ref) refIds.add(ref);
    }
    if (refIds.size === 0) continue;
    const related = await LOADERS[toObjectId].load(c, tenantId, { ids: [...refIds], limit: refIds.size });
    const byId = new Map(related.map((r) => [String(r.id), r]));
    for (const doc of joined) {
      const ref = getAtPath(doc, viaPath);
      if (typeof ref === "string" && byId.has(ref)) doc[`__related__${toObjectId}`] = byId.get(ref);
    }
  }
  return { docs: joined, refusedObjectIds: [...refused], incompleteObjectIds: [] };
}

// ════════════════════ the run ════════════════════

type OutcomeKind = "permission-denied" | "company-unresolved" | "empty" | "partially-authorized" | "truncated-widened" | "results";

function collectReferencedFieldIds(def: ReportDefinition): string[] {
  const ids: string[] = [];
  if (Array.isArray(def.fields)) ids.push(...(def.fields as string[]));
  if (Array.isArray(def.filters)) for (const f of def.filters as Array<{ fieldId?: unknown }>) if (typeof f?.fieldId === "string") ids.push(f.fieldId);
  if (Array.isArray(def.groupBy)) ids.push(...(def.groupBy as string[]));
  if (Array.isArray(def.sort)) for (const s of def.sort as Array<{ fieldId?: unknown }>) if (typeof s?.fieldId === "string") ids.push(s.fieldId);
  if (Array.isArray(def.aggregates)) for (const a of def.aggregates as Array<{ fieldId?: unknown }>) if (typeof a?.fieldId === "string") ids.push(a.fieldId);
  return ids;
}

export interface RunOptions {
  readonly maxResultRows?: number;
  readonly maxGroupCardinality?: number;
  readonly maxScanDocs?: number;
}

/**
 * Run a report definition for the caller. Resolves with an OUTCOME for every governed answer (including the two refusals, which are audited); throws
 * only for a malformed request, an unknown/unreadable object, and the two scan-bound refusals (SCAN_INCOMPLETE, ABSENCE_UNPROVEN).
 */
export async function runReportDefinition(deps: { readonly pool: Pool; readonly options?: RunOptions }, actor: RecordsActor, input: Record<string, unknown>) {
  const i = acceptOnly(input, ["definition", "definitionId"]);
  assertActor(actor);
  if (i.definitionId !== undefined && !ID_SHAPE(i.definitionId)) refuse("DEFINITION_ID_INVALID", "INVALID_INPUT", "definitionId must be a governed id when present");
  const maxResultRows = deps.options?.maxResultRows ?? MAX_RESULT_ROWS;
  const maxGroupCardinality = deps.options?.maxGroupCardinality ?? MAX_GROUP_CARDINALITY;
  const maxScanDocs = deps.options?.maxScanDocs ?? MAX_SCAN_DOCS;
  // `definitionId` is an AUDIT LABEL only: the definition that runs is always the one in `definition` (the client sends the saved body), a run never loads or trusts a stored
  // row by this id, and an unowned or unknown id is simply recorded as given. It confers no access and is not an existence oracle (independent review, info).
  const definitionId = typeof i.definitionId === "string" ? i.definitionId : `adhoc-${randomUUID()}`;

  // The cheap abuse bounds, then structural validation. The object capability CANNOT be checked first here: it is named by the definition's own objectId, and a denied run must
  // be audited against a real, validated objectId. "Never valid" is distinct from "no longer fully authorized".
  assertWithinReportLimits(i.definition);
  const errors = validateReportDefinition(i.definition);
  if (errors.length > 0) refuse("INVALID_DEFINITION", "INVALID_INPUT", `Invalid report definition: ${errors.join("; ")}`);
  const def = i.definition as ReportDefinition;
  const objectId = def.objectId as string;
  const object = getReportObject(objectId)!;
  const loader = LOADERS[objectId];
  if (!object.collection || !loader) refuse("UNKNOWN_REPORT_OBJECT", "PRECONDITION_FAILED", `objectId "${objectId}" has no backing records`);

  const audit = (outcome: "applied" | "denied", summary: string, extra: Record<string, unknown> = {}) =>
    inTransaction(deps.pool, "write", (c) => recordsAudit(c, actor, "runReportDefinition", "reportDefinition", definitionId,
      { outcome, objectId, ...extra }, summary));

  const refusal = async (kind: "permission-denied" | "company-unresolved", summary: string, reason: string | null, companyReach: readonly string[]) => {
    await audit("denied", summary);
    return {
      kind, objectId, rows: null, aggregates: null, rowCount: 0, rowCap: maxResultRows, truncated: false,
      // No scan was issued on this path, so completeness is INAPPLICABLE -- stated, not left to be misread as "complete".
      completeness: "not-attempted" as const, scanTruncated: false, widened: false,
      droppedColumnLabels: [] as string[], droppedFieldIds: [] as string[], droppedPredicateFieldIds: [] as string[], droppedPredicateCount: 0,
      companyReach: [...companyReach], rowScopeKind: kind === "company-unresolved" ? ("unresolved" as const) : loader.rowScopeKind,
      companyBoundRefusal: reason, refusedJoinObjectIds: [] as string[], incompleteJoinObjectIds: [] as string[],
    };
  };

  // (1) The object gate. Not held: nothing is read, not even the caller's companies.
  if (!actor.capabilities.has(object.objectReadCapability)) {
    return refusal("permission-denied", `Report run denied: object-level read capability not held for "${objectId}".`, null, []);
  }

  const held = (capability: string) => capability !== "" && actor.capabilities.has(capability) && !INACTIVE_REPORT_CAPABILITIES.has(capability);

  // (2) Company reach, the field gate and the bounded scan, in ONE snapshot.
  const read = await inTransaction(deps.pool, "snapshot", async (c) => {
    const authority = await resolveCompanyAuthority(c, actor.tenantId, actor.principalId);
    if (authority.companyKeys.length === 0) return { unresolved: true as const };

    const authorized = new Set<string>();
    const deniedLabels = new Map<string, string>();
    for (const fieldId of new Set(collectReferencedFieldIds(def))) {
      const resolved = resolveDefinitionField(objectId, fieldId);
      if (!resolved) continue; // already refused by the validator
      const fieldAllowed = held(resolved.field.readCapability);
      const traversalAllowed = resolved.relationship ? held(resolved.relationship.traversalCapability ?? "") : true;
      if (fieldAllowed && traversalAllowed) authorized.add(fieldId);
      else deniedLabels.set(fieldId, resolved.field.label);
    }

    const scan = await loader.load(c, actor.tenantId, { limit: maxScanDocs + 1, companyKeys: authority.companyKeys });
    const scanTruncated = scan.length > maxScanDocs;
    const rawDocs = scan.slice(0, maxScanDocs);

    const relatedFields = [...authorized]
      .map((id) => resolveDefinitionField(objectId, id))
      .filter((r): r is NonNullable<typeof r> => !!r && !!r.relationship);
    const joinResult = relatedFields.length > 0
      ? await joinRelatedDocs(c, actor.tenantId, rawDocs, relatedFields)
      : { docs: rawDocs, refusedObjectIds: [] as string[], incompleteObjectIds: [] as string[] };
    return { unresolved: false as const, companies: authority.companies, authorized, deniedLabels, scanTruncated, ...joinResult };
  });

  if (read.unresolved) {
    return refusal("company-unresolved",
      `Report run refused: the runner's operating company could not be resolved for "${objectId}"; the caller has no operating-company authority, so no row bound can be applied.`,
      "the runner holds the object read capability but has no operating-company authority; an unbounded read is never the fallback", []);
  }

  const { authorized, deniedLabels, scanTruncated, companies } = read;
  const wanted = <T,>(xs: T[] | undefined): T[] => xs ?? [];
  const fieldsDef = wanted(def.fields as string[] | undefined);
  const activeFields = fieldsDef.filter((id) => authorized.has(id));
  const droppedFieldIds = fieldsDef.filter((id) => !authorized.has(id));
  const droppedColumnLabels = droppedFieldIds.map((id) => deniedLabels.get(id) ?? id);

  // Predicate-drop rule (ADR-007 sec2.4): a filter / group / aggregate that REFERENCES a field the runner may not read is DROPPED, never applied.
  const filtersDef = wanted(def.filters as Array<{ fieldId: string; op: string; value: unknown }> | undefined);
  const activeFilters = filtersDef.filter((f) => authorized.has(f.fieldId));
  const groupByDef = wanted(def.groupBy as string[] | undefined);
  const activeGroupBy = groupByDef.filter((id) => authorized.has(id));
  const activeSort = wanted(def.sort as Array<{ fieldId: string; direction: "asc" | "desc" }> | undefined).filter((s) => authorized.has(s.fieldId));
  const aggregatesDef = wanted(def.aggregates as Array<{ fieldId?: string; fn: string }> | undefined);
  const activeAggregates = aggregatesDef.filter((a) => isFieldlessAggregate(a.fn) || (typeof a.fieldId === "string" && authorized.has(a.fieldId)));
  const droppedPredicateFieldIds = [...new Set([
    ...filtersDef.filter((f) => !authorized.has(f.fieldId)).map((f) => f.fieldId),
    ...groupByDef.filter((id) => !authorized.has(id)),
    ...aggregatesDef.filter((a) => !isFieldlessAggregate(a.fn) && typeof a.fieldId === "string" && !authorized.has(a.fieldId)).map((a) => a.fieldId as string),
  ])];
  const widened = droppedPredicateFieldIds.length > 0;

  // Truncation honesty (census X-9): an aggregate over a cut population is REFUSED, never returned as a figure smaller than the truth.
  if (judgeScanCompleteness({ scanTruncated, hasAggregates: activeAggregates.length > 0 }) === "refuse-incomplete-total") {
    await audit("denied", `Report run refused: aggregates over "${objectId}" would be computed from a truncated scan and would understate the true totals.`, { truncated: true });
    refuse("SCAN_INCOMPLETE", "PRECONDITION_FAILED",
      `Aggregates for "${objectId}" cannot be computed: the scan exceeded ${maxScanDocs} records, so any total would be lower than the truth. Narrow the report with filters, or run it without aggregates.`);
  }

  const filtered = read.docs.filter((doc) => activeFilters.every((f) => matchesFilter(doc, objectId, f)));
  const sorted = sortRows(filtered, objectId, activeSort);

  const grouped = activeGroupBy.length > 0 || activeAggregates.length > 0;
  let aggregateRows: Doc[] | null = null;
  let groupCardinalityTruncated = false;
  let resultRows: Doc[];
  if (grouped) {
    const groups = groupDocuments(filtered, objectId, activeGroupBy);
    groupCardinalityTruncated = groups.size > maxGroupCardinality;
    aggregateRows = [...groups.values()].slice(0, maxGroupCardinality).map((rows) => {
      const row: Doc = {};
      for (const fieldId of activeGroupBy) {
        const field = getReportField(fieldId);
        if (field) row[fieldId] = getFieldValue(rows[0], objectId, field);
      }
      for (const agg of activeAggregates) row[aggregateResultKey(agg)] = computeAggregate(rows, objectId, agg);
      return row;
    });
    resultRows = [];
  } else {
    resultRows = sorted;
  }

  const rowCountBeforeCap = grouped ? (aggregateRows as Doc[]).length : resultRows.length;
  const rowCapTruncated = rowCountBeforeCap > maxResultRows;
  const truncated = scanTruncated || groupCardinalityTruncated || rowCapTruncated;
  const cappedAggregates = aggregateRows ? aggregateRows.slice(0, maxResultRows) : null;
  const projected = grouped ? null : resultRows.slice(0, maxResultRows).map((doc) => projectDoc(doc, objectId, activeFields));
  const rowCount = grouped ? (cappedAggregates as Doc[]).length : (projected as Doc[]).length;

  // Unproven absence (RPT-FIX): zero rows out of a truncated scan (or an incomplete join) is REFUSED, never returned as a proven "empty".
  const joinIncomplete = read.refusedObjectIds.length > 0 || read.incompleteObjectIds.length > 0;
  if (judgeAbsenceProvenance({ scanTruncated, rowCount, joinIncomplete }) === "refuse-unproven-absence") {
    const unjoined = [...new Set([...read.refusedObjectIds, ...read.incompleteObjectIds])];
    await audit("denied", scanTruncated
      ? `Report run refused: no rows of "${objectId}" matched inside a truncated scan, so an empty result would not be a proven absence.`
      : `Report run refused: no rows of "${objectId}" matched, but the one-hop join to ${unjoined.map((u) => `"${u}"`).join(", ")} did not complete, so an empty result would not be a proven absence.`,
    { rowCount: 0, truncated: scanTruncated });
    refuse("ABSENCE_UNPROVEN", "PRECONDITION_FAILED", scanTruncated
      ? `No matching rows for "${objectId}" were found, but the scan exceeded ${maxScanDocs} records, so matching rows may exist beyond it. This is NOT a proven "no results": narrow the report with filters so the scan completes.`
      : `No matching rows for "${objectId}" were found, but the related object(s) ${unjoined.map((u) => `"${u}"`).join(", ")} could not be joined for this run, so rows may have been excluded on a value that was never read. This is NOT a proven "no results".`);
  }

  await audit("applied", `Report run applied for object "${objectId}".`, {
    rowCount, truncated,
    ...(droppedFieldIds.length > 0 ? { droppedFieldIds } : {}),
    ...(droppedPredicateFieldIds.length > 0 ? { droppedPredicateFieldIds } : {}),
  });

  const kind: OutcomeKind = rowCount === 0 ? "empty" : droppedColumnLabels.length > 0 ? "partially-authorized" : truncated || widened ? "truncated-widened" : "results";
  return {
    kind, objectId, rows: projected, aggregates: cappedAggregates, rowCount, rowCap: maxResultRows, truncated,
    completeness: scanTruncated ? ("bounded-page" as const) : ("proven-complete" as const), scanTruncated, widened,
    droppedColumnLabels, droppedFieldIds, droppedPredicateFieldIds, droppedPredicateCount: droppedPredicateFieldIds.length,
    companyReach: [...companies], rowScopeKind: loader.rowScopeKind, companyBoundRefusal: null,
    refusedJoinObjectIds: read.refusedObjectIds, incompleteJoinObjectIds: read.incompleteObjectIds,
  };
}
