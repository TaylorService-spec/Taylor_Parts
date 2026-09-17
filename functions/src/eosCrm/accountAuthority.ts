// Governed PostgreSQL Account authority -- wave D1-A. Internal; nothing external invokes it yet.
//
//   createAccount                  customer.record.create   idempotent; an EXPLICIT same-tenant Employee owner is REQUIRED
//   updateAccount                  customer.record.update   the business-field allowlist; paymentTerms / taxStatus changes
//                                                           also require customer.governedField.write; an owner change is
//                                                           a governed ownership handoff (below)
//   getAccount                     customer.record.read     one Account of the actor's tenant, with every governed business fact
//   listAccounts                   customer.record.read     bounded keyset list, optional status filter and folded-name prefix
//   listAccountOwnershipHandoffs   customer.record.read     one Account's append-only ownership history, newest first, bounded
//
// IDENTITY. `eos_crm.accounts.id` is THE canonical Account id: `eos_commercial.*.account_id` references it through the
// composite (tenant_id, account_id) foreign keys of migration 1759449600000. There is no mapping id; a new Account's id
// is minted once, here.
//
// OWNERSHIP IS NOT ATTRIBUTION. `created_by` / `updated_by` are the acting EOS Principal. The owner is an Employee the
// governed PostgreSQL Employee authority RESOLVES in this tenant, supplied explicitly at creation. It is never derived
// from the Principal, a Firebase uid, a Security Role, a Job Role or the creator, and this authority cannot create an
// ownerless Account. Owner ruling: legacy accountOwner.assignedBy* / assignedAt never become Account columns; owner
// changes go through a governed Account ownership-handoff writer (prior owner, new owner, effective time, changed-by
// Principal, governed reason/source).
//
// OWNERSHIP HANDOFF (migration 1759924800000) -- PARITY with the Commercial Opportunity edit (opportunityCommandService
// + stageCommercialOwnershipTransfer), under the EXISTING customer.record.update: the legacy
// product let whoever could edit an Account change its owner, so no capability is added.
//   * `ownerEmployeeId` on updateAccount, with an optional `ownershipHandoff: { source?, reason? }`. Source defaults to
//     DIRECT_HANDOFF; reason is trimmed, blank means none, at most 500 characters.
//   * The CURRENT owner is read under FOR UPDATE, never supplied. The same owner is a no-op for ownership (no history row).
//     A different owner must resolve exactly as at creation (requireOwnerEmployee), then ONE append-only
//     eos_crm.account_ownership_handoffs row and the owner column move in the SAME transaction as every other field
//     change and the updated_by / updated_at attribution. effective_at is the INSERT's statement_timestamp(), taken AFTER
//     the FOR UPDATE lock was granted, so concurrent handoffs order by effective time exactly as they serialized (the
//     transaction-start now() of a handoff that waited on the lock would predate the one it waited for).
//   * `ownerEmployeeId: null` refuses OWNER_REQUIRED: a governed Account is never made ownerless. `ownershipHandoff`
//     without an owner change refuses OWNERSHIP_HANDOFF_WITHOUT_OWNER_CHANGE.
//   * A LEGACY OWNERLESS Account (migration 008's OWNERLESS state, carried by the cutover) receiving its first owner is an
//     initial assignment, not a handoff; no ruling governs it, so it refuses ACCOUNT_OWNER_ASSIGNMENT_NOT_GOVERNED.
//   * NO CASCADE: Contacts and customer sites keep their own owner (their owner was inherited at creation only).
//
// BILLING ADDRESS. Owner ruling: a single free-text billing address is never parsed into the structured parts; it is
// refused here (FIELD_INVALID) and belongs only in import staging / reconciliation evidence until resolved.
//
// STATUS. The canonical vocabulary only. D-C1-5's transition graph is PROPOSED and is not enforced.
//
// GOVERNED FIELDS. Mirrors firestore.rules accountGovernedFieldsValid / accountGovernedCreateBaseline /
// accountGovernedFieldsUnchanged: the values are validated for everyone; creating beyond the baseline (paymentTerms
// unset, taxStatus unset or UNKNOWN) or changing either stored value requires customer.governedField.write.
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { CRM_ACCOUNT_STATUSES, isCrmAccountStatus, type CrmAccountStatus } from "../crm/customerIdentity.js";
import { createPostgresEmployeeAuthority } from "../employeeIdentity/postgresEmployeeAuthority.js";
import {
  ACCOUNT_LINES_OF_BUSINESS,
  ACCOUNT_RELATIONSHIP_TYPES,
  INVOICE_DELIVERY_METHODS,
  ISO_4217_CURRENCIES,
  MAX_ACCOUNT_TAGS,
  MAX_ACCOUNT_TAG_LENGTH,
  PAYMENT_TERMS,
  TAX_STATUSES,
  isUngovernedPaymentTerms,
  isUngovernedTaxStatus,
} from "./accountVocabulary.js";
import {
  CRM_CAPABILITIES,
  assignmentsOf,
  decodeCrmCursor,
  fail,
  isoOf,
  optionalText,
  pageOf,
  requireAllowlistedInput,
  requireName,
  requirePageSize,
  requireRecordId,
  requireTenantAccount,
  runCrmCommand,
  runCrmCreate,
  runCrmRead,
  splitIdempotentInput,
  type CrmActorContext,
  type CrmDeps,
  type CrmReplayable,
} from "./crmAuthorityKernel.js";

export interface BillingAddress {
  readonly street: string | null;
  readonly city: string | null;
  readonly state: string | null;
  readonly zip: string | null;
}

export interface AccountProjection {
  readonly accountId: string;
  readonly name: string;
  readonly status: CrmAccountStatus;
  readonly ownerEmployeeId: string | null;
  readonly notes: string | null;
  readonly billingAddress: BillingAddress | null;
  readonly customerNumber: string | null;
  readonly erpId: string | null;
  readonly accountingId: string | null;
  readonly legacyId: string | null;
  readonly defaultCurrency: string | null;
  readonly purchaseOrderRequired: boolean | null;
  readonly invoiceDeliveryMethod: string | null;
  readonly paymentTerms: string | null;
  readonly taxStatus: string | null;
  readonly billingContactId: string | null;
  readonly tags: string[];
  readonly relationshipTypes: string[];
  readonly lineOfBusiness: string[];
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedBy: string;
  readonly updatedAt: string;
}

interface AccountRow {
  id: string;
  name: string;
  status: CrmAccountStatus;
  owner_employee_id: string | null;
  notes: string | null;
  billing_address_street: string | null;
  billing_address_city: string | null;
  billing_address_state: string | null;
  billing_address_postal_code: string | null;
  customer_number: string | null;
  erp_id: string | null;
  accounting_id: string | null;
  legacy_id: string | null;
  default_currency: string | null;
  purchase_order_required: boolean | null;
  invoice_delivery_method: string | null;
  payment_terms: string | null;
  tax_status: string | null;
  billing_contact_id: string | null;
  tags: string[];
  relationship_types: string[];
  lines_of_business: string[];
  created_by: string;
  created_at: Date;
  updated_by: string;
  updated_at: Date;
}

/** One Account row with its normalized children, in canonical order. `a` is the eos_crm.accounts alias. */
const COLUMNS = `a.id, a.name, a.status, a.owner_employee_id, a.notes, a.billing_address_street, a.billing_address_city,
  a.billing_address_state, a.billing_address_postal_code, a.customer_number, a.erp_id, a.accounting_id, a.legacy_id,
  a.default_currency, a.purchase_order_required, a.invoice_delivery_method, a.payment_terms, a.tax_status,
  a.billing_contact_id, a.created_by, a.created_at, a.updated_by, a.updated_at,
  ARRAY(SELECT t.tag FROM eos_crm.account_tags t WHERE t.tenant_id = a.tenant_id AND t.account_id = a.id ORDER BY t.position) AS tags,
  ARRAY(SELECT r.relationship_type FROM eos_crm.account_relationship_types r WHERE r.tenant_id = a.tenant_id AND r.account_id = a.id) AS relationship_types,
  ARRAY(SELECT l.line_of_business FROM eos_crm.account_lines_of_business l WHERE l.tenant_id = a.tenant_id AND l.account_id = a.id) AS lines_of_business`;

/** A stored set, in the vocabulary's canonical order (the order the Account form writes). */
const inCanonicalOrder = (values: readonly string[], vocabulary: readonly string[]): string[] =>
  [...values].sort((x, y) => vocabulary.indexOf(x) - vocabulary.indexOf(y) || (x < y ? -1 : x > y ? 1 : 0));

const project = (row: AccountRow): AccountProjection => {
  const address = [row.billing_address_street, row.billing_address_city, row.billing_address_state, row.billing_address_postal_code];
  return {
    accountId: row.id,
    name: row.name,
    status: row.status,
    ownerEmployeeId: row.owner_employee_id,
    notes: row.notes,
    billingAddress: address.every((p) => p === null)
      ? null
      : { street: row.billing_address_street, city: row.billing_address_city, state: row.billing_address_state, zip: row.billing_address_postal_code },
    customerNumber: row.customer_number,
    erpId: row.erp_id,
    accountingId: row.accounting_id,
    legacyId: row.legacy_id,
    defaultCurrency: row.default_currency,
    purchaseOrderRequired: row.purchase_order_required,
    invoiceDeliveryMethod: row.invoice_delivery_method,
    paymentTerms: row.payment_terms,
    taxStatus: row.tax_status,
    billingContactId: row.billing_contact_id,
    tags: row.tags,
    relationshipTypes: inCanonicalOrder(row.relationship_types, ACCOUNT_RELATIONSHIP_TYPES),
    lineOfBusiness: inCanonicalOrder(row.lines_of_business, ACCOUNT_LINES_OF_BUSINESS),
    createdBy: row.created_by,
    createdAt: isoOf(row.created_at),
    updatedBy: row.updated_by,
    updatedAt: isoOf(row.updated_at),
  };
};

// ════════════════════ field validation ════════════════════

function requireStatus(value: unknown): CrmAccountStatus {
  if (!isCrmAccountStatus(value)) fail("STATUS_INVALID", "INVALID_INPUT", `status must be one of ${CRM_ACCOUNT_STATUSES.join(", ")}`);
  return value as CrmAccountStatus;
}

function optionalEnum(value: unknown, field: string, allowed: readonly string[]): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !allowed.includes(value)) fail("FIELD_INVALID", "INVALID_INPUT", `${field} must be one of ${allowed.join(", ")}, or null`);
  return value as string;
}

function enumSet(value: unknown, field: string, allowed: readonly string[]): string[] {
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string" && allowed.includes(v)) || new Set(value).size !== value.length) {
    fail("FIELD_INVALID", "INVALID_INPUT", `${field} must be an array of distinct values from ${allowed.join(", ")}`);
  }
  // Canonical order, as the Account form writes it.
  return allowed.filter((v) => (value as string[]).includes(v));
}

function tagList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_ACCOUNT_TAGS) {
    fail("FIELD_INVALID", "INVALID_INPUT", `tags must be an array of at most ${MAX_ACCOUNT_TAGS} strings`);
  }
  const tags = (value as unknown[]).map((t) => {
    if (typeof t !== "string" || t.trim() === "" || t.trim().length > MAX_ACCOUNT_TAG_LENGTH) {
      fail("FIELD_INVALID", "INVALID_INPUT", `each tag must be a non-blank string of at most ${MAX_ACCOUNT_TAG_LENGTH} characters`);
    }
    return (t as string).trim();
  });
  if (new Set(tags).size !== tags.length) fail("FIELD_INVALID", "INVALID_INPUT", "tags must be distinct");
  return tags;
}

function billingAddress(value: unknown): [string | null, string | null, string | null, string | null] {
  if (value === null) return [null, null, null, null];
  if (typeof value !== "object" || Array.isArray(value)) fail("FIELD_INVALID", "INVALID_INPUT", "billingAddress must be { street, city, state, zip } or null");
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).filter((k) => !["street", "city", "state", "zip"].includes(k));
  if (unknown.length > 0) fail("FIELD_NOT_ALLOWED", "INVALID_INPUT", `not an accepted billingAddress part: ${unknown.sort().join(", ")}`);
  return [optionalText(record.street, "billingAddress.street"), optionalText(record.city, "billingAddress.city"),
    optionalText(record.state, "billingAddress.state"), optionalText(record.zip, "billingAddress.zip")];
}

function currency(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !/^[A-Z]{3}$/.test(value) || !ISO_4217_CURRENCIES.has(value)) {
    fail("FIELD_INVALID", "INVALID_INPUT", "defaultCurrency must be an ISO 4217 alphabetic code (e.g. USD), or null");
  }
  return value as string;
}

function optionalBoolean(value: unknown, field: string): boolean | null {
  if (value !== null && typeof value !== "boolean") fail("FIELD_INVALID", "INVALID_INPUT", `${field} must be a boolean or null`);
  return value as boolean | null;
}

/** Scalar business fields: input name -> [column, validator]. Column names only ever come from here. */
const SCALAR_FIELDS: Readonly<Record<string, readonly [string, (v: unknown) => unknown]>> = Object.freeze({
  name: ["name", (v) => requireName(v, "an Account")],
  status: ["status", requireStatus],
  notes: ["notes", (v) => optionalText(v, "notes")],
  customerNumber: ["customer_number", (v) => optionalText(v, "customerNumber")],
  erpId: ["erp_id", (v) => optionalText(v, "erpId")],
  accountingId: ["accounting_id", (v) => optionalText(v, "accountingId")],
  legacyId: ["legacy_id", (v) => optionalText(v, "legacyId")],
  defaultCurrency: ["default_currency", currency],
  purchaseOrderRequired: ["purchase_order_required", (v) => optionalBoolean(v, "purchaseOrderRequired")],
  invoiceDeliveryMethod: ["invoice_delivery_method", (v) => optionalEnum(v, "invoiceDeliveryMethod", INVOICE_DELIVERY_METHODS)],
  paymentTerms: ["payment_terms", (v) => optionalEnum(v, "paymentTerms", PAYMENT_TERMS)],
  taxStatus: ["tax_status", (v) => optionalEnum(v, "taxStatus", TAX_STATUSES)],
  billingContactId: ["billing_contact_id", (v) => (v === null ? null : requireRecordId(v, "billingContactId"))],
});
const ADDRESS_COLUMNS = ["billing_address_street", "billing_address_city", "billing_address_state", "billing_address_postal_code"] as const;
const SET_FIELDS = ["tags", "relationshipTypes", "lineOfBusiness"] as const;

interface AccountFields {
  /** column -> value, in allowlist order */
  readonly columns: Map<string, unknown>;
  readonly tags?: string[];
  readonly relationshipTypes?: string[];
  readonly lineOfBusiness?: string[];
}

function accountFields(i: Record<string, unknown>): AccountFields {
  const columns = new Map<string, unknown>();
  for (const [field, [column, validate]] of Object.entries(SCALAR_FIELDS)) {
    if (i[field] !== undefined) columns.set(column, validate(i[field]));
  }
  if (i.billingAddress !== undefined) billingAddress(i.billingAddress).forEach((part, n) => columns.set(ADDRESS_COLUMNS[n], part));
  return {
    columns,
    tags: i.tags === undefined ? undefined : tagList(i.tags),
    relationshipTypes: i.relationshipTypes === undefined ? undefined : enumSet(i.relationshipTypes, "relationshipTypes", ACCOUNT_RELATIONSHIP_TYPES),
    lineOfBusiness: i.lineOfBusiness === undefined ? undefined : enumSet(i.lineOfBusiness, "lineOfBusiness", ACCOUNT_LINES_OF_BUSINESS),
  };
}

const requireGovernedFieldCapability = (actor: CrmActorContext): void => {
  if (!actor.capabilities.has(CRM_CAPABILITIES.CUSTOMER_GOVERNED_FIELD_WRITE)) {
    fail("CAPABILITY_REQUIRED", "FORBIDDEN", `setting or changing paymentTerms or taxStatus requires ${CRM_CAPABILITIES.CUSTOMER_GOVERNED_FIELD_WRITE}`);
  }
};

async function replaceChildren(db: PoolClient, tenantId: string, accountId: string, fields: AccountFields, replacing: boolean): Promise<void> {
  const sets: [string, string, string[] | undefined, boolean][] = [
    ["account_tags", "tag", fields.tags, true],
    ["account_relationship_types", "relationship_type", fields.relationshipTypes, false],
    ["account_lines_of_business", "line_of_business", fields.lineOfBusiness, false],
  ];
  for (const [table, column, values, ordered] of sets) {
    if (values === undefined) continue;
    if (replacing) await db.query(`DELETE FROM eos_crm.${table} WHERE tenant_id = $1 AND account_id = $2`, [tenantId, accountId]);
    if (values.length === 0) continue;
    await db.query(
      ordered
        ? `INSERT INTO eos_crm.${table} (tenant_id, account_id, position, ${column})
           SELECT $1, $2, (v.ord - 1)::smallint, v.value FROM unnest($3::text[]) WITH ORDINALITY AS v(value, ord)`
        : `INSERT INTO eos_crm.${table} (tenant_id, account_id, ${column}) SELECT $1, $2, v.value FROM unnest($3::text[]) AS v(value)`,
      [tenantId, accountId, values],
    );
  }
}

async function selectAccount(db: Pick<PoolClient, "query">, tenantId: string, accountId: string): Promise<AccountProjection> {
  const { rows } = await db.query<AccountRow>(`SELECT ${COLUMNS} FROM eos_crm.accounts a WHERE a.tenant_id = $1 AND a.id = $2`, [tenantId, accountId]);
  if (rows.length === 0) fail("ACCOUNT_NOT_FOUND", "NOT_FOUND", "the Account does not exist in this tenant");
  return project(rows[0]);
}

async function requireOwnerEmployee(db: PoolClient, tenantId: string, employeeId: string): Promise<string> {
  const resolution = await createPostgresEmployeeAuthority(db).resolveEmployeeReference({ tenantId, employeeId });
  if (resolution.outcome === "RESOLVED") return resolution.employee.employeeId;
  if (resolution.outcome === "AUTHORITY_UNAVAILABLE") fail("EMPLOYEE_AUTHORITY_UNAVAILABLE", "UNAVAILABLE", "the Employee authority could not answer");
  return fail("OWNER_NOT_FOUND", "NOT_FOUND", "the owner is not an Employee of this tenant");
}

/** An explicit owner id, shaped like an Employee id. Absent or null is OWNER_REQUIRED: a governed Account is never ownerless. */
function requireOwnerEmployeeId(value: unknown): string {
  if (value === undefined || value === null) fail("OWNER_REQUIRED", "INVALID_INPUT", "an Account requires an explicit owner: an Employee of this tenant");
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(value)) fail("OWNER_INVALID", "INVALID_INPUT", "ownerEmployeeId must be an Employee id");
  return value as string;
}

/** Mirrors OWNERSHIP_HANDOFF_SOURCES (access/auditEventWriter.ts), COMMERCIAL_HANDOFF_SOURCES and migration 1759924800000. */
export const ACCOUNT_OWNERSHIP_HANDOFF_SOURCES = Object.freeze(["DIRECT_HANDOFF", "CUSTOMER_HANDOFF_REVIEW", "ADMIN_CORRECTION"] as const);
export type AccountOwnershipHandoffSource = (typeof ACCOUNT_OWNERSHIP_HANDOFF_SOURCES)[number];
/** The audit writer's MAX_HANDOFF_REASON_LENGTH, as eos_commercial.ownership_handoffs holds it. */
export const MAX_ACCOUNT_HANDOFF_REASON_LENGTH = 500;
const DEFAULT_HANDOFF_SOURCE: AccountOwnershipHandoffSource = "DIRECT_HANDOFF";

interface HandoffTerms {
  readonly source: AccountOwnershipHandoffSource;
  readonly reason: string | null;
}

function ownershipHandoffTerms(value: unknown): HandoffTerms {
  if (value === undefined) return { source: DEFAULT_HANDOFF_SOURCE, reason: null };
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("HANDOFF_INVALID", "INVALID_INPUT", "ownershipHandoff must be an object { source?, reason? }");
  }
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).filter((k) => k !== "source" && k !== "reason");
  if (unknown.length > 0) fail("FIELD_NOT_ALLOWED", "INVALID_INPUT", `not an accepted ownershipHandoff field: ${unknown.sort().join(", ")}`);
  const source = record.source === undefined ? DEFAULT_HANDOFF_SOURCE : record.source;
  if (typeof source !== "string" || !(ACCOUNT_OWNERSHIP_HANDOFF_SOURCES as readonly string[]).includes(source)) {
    fail("HANDOFF_SOURCE_INVALID", "INVALID_INPUT", `ownershipHandoff.source must be one of ${ACCOUNT_OWNERSHIP_HANDOFF_SOURCES.join(", ")}`);
  }
  let reason: string | null = null;
  if (record.reason !== undefined && record.reason !== null) {
    if (typeof record.reason !== "string") fail("HANDOFF_REASON_INVALID", "INVALID_INPUT", "ownershipHandoff.reason must be a string or null");
    const trimmed = (record.reason as string).trim();
    if (trimmed.length > MAX_ACCOUNT_HANDOFF_REASON_LENGTH) {
      fail("HANDOFF_REASON_INVALID", "INVALID_INPUT", `ownershipHandoff.reason must be at most ${MAX_ACCOUNT_HANDOFF_REASON_LENGTH} characters`);
    }
    reason = trimmed === "" ? null : trimmed;
  }
  return { source: source as AccountOwnershipHandoffSource, reason };
}

/**
 * Append the handoff and move the current owner, on the CALLER's transaction. `previousOwnerEmployeeId` is the value the
 * caller read under FOR UPDATE in this same transaction. One Account; nothing cascades to its Contacts or sites.
 */
async function stageAccountOwnershipHandoff(
  db: PoolClient,
  tenantId: string,
  principalId: string,
  accountId: string,
  previousOwnerEmployeeId: string,
  newOwnerEmployeeId: string,
  terms: HandoffTerms,
): Promise<void> {
  await db.query(
    `INSERT INTO eos_crm.account_ownership_handoffs
       (id, tenant_id, account_id, previous_owner_employee_id, new_owner_employee_id, source, reason, handed_off_by, effective_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, statement_timestamp())`,
    [`acohf_${randomUUID()}`, tenantId, accountId, previousOwnerEmployeeId, newOwnerEmployeeId, terms.source, terms.reason, principalId],
  );
  await db.query(
    `UPDATE eos_crm.accounts SET owner_employee_id = $3 WHERE tenant_id = $1 AND id = $2 AND owner_employee_id = $4`,
    [tenantId, accountId, newOwnerEmployeeId, previousOwnerEmployeeId],
  );
}

const CREATE_FIELDS = ["idempotencyKey", "ownerEmployeeId", "billingAddress", ...SET_FIELDS, ...Object.keys(SCALAR_FIELDS).filter((f) => f !== "billingContactId")];
const UPDATE_FIELDS = ["accountId", "ownerEmployeeId", "ownershipHandoff", "billingAddress", ...SET_FIELDS, ...Object.keys(SCALAR_FIELDS)];

// ════════════════════ commands ════════════════════

export function createAccount(deps: CrmDeps, actor: CrmActorContext, input: unknown): Promise<CrmReplayable<AccountProjection>> {
  return runCrmCreate(
    deps,
    actor,
    CRM_CAPABILITIES.CUSTOMER_RECORD_CREATE,
    "crm.createAccount",
    () => {
      const i = requireAllowlistedInput(input, CREATE_FIELDS);
      const { idempotencyKey, request } = splitIdempotentInput(i);
      const owner = requireOwnerEmployeeId(i.ownerEmployeeId);
      if (i.name === undefined) fail("NAME_REQUIRED", "INVALID_INPUT", "an Account requires a name");
      if (i.status === undefined) fail("STATUS_INVALID", "INVALID_INPUT", `status is required: one of ${CRM_ACCOUNT_STATUSES.join(", ")}`);
      const fields = accountFields(i);
      const paymentTerms = (fields.columns.get("payment_terms") ?? null) as string | null;
      const taxStatus = (fields.columns.get("tax_status") ?? null) as string | null;
      if (!isUngovernedPaymentTerms(paymentTerms) || !isUngovernedTaxStatus(taxStatus)) requireGovernedFieldCapability(actor);
      return { idempotencyKey, request, owner, fields };
    },
    async (db, { tenantId, principalId }, { owner, fields }) => {
      const ownerEmployeeId = await requireOwnerEmployee(db, tenantId, owner);
      const accountId = `acct_${randomUUID()}`;
      const extra = [...fields.columns.entries()].filter(([column]) => column !== "name" && column !== "status");
      const extraColumns = extra.map(([column]) => ", " + column).join("");
      const extraParams = extra.map((_, n) => ", $" + (7 + n)).join("");
      await db.query(
        `INSERT INTO eos_crm.accounts (id, tenant_id, name, status, owner_employee_id, created_by, updated_by${extraColumns})
         VALUES ($1, $2, $3, $4, $5, $6, $6${extraParams})`,
        [accountId, tenantId, fields.columns.get("name"), fields.columns.get("status"), ownerEmployeeId, principalId, ...extra.map(([, v]) => v)],
      );
      await replaceChildren(db, tenantId, accountId, fields, false);
      return { result: await selectAccount(db, tenantId, accountId), targetType: "ACCOUNT", targetId: accountId };
    },
  );
}

export function updateAccount(deps: CrmDeps, actor: CrmActorContext, input: unknown): Promise<AccountProjection> {
  return runCrmCommand(
    deps,
    actor,
    CRM_CAPABILITIES.CUSTOMER_RECORD_UPDATE,
    () => {
      const i = requireAllowlistedInput(input, UPDATE_FIELDS);
      const fields = accountFields(i);
      // `ownerEmployeeId: null` is named, and refuses: clearing the owner is never an update.
      const owner = i.ownerEmployeeId === undefined ? null : requireOwnerEmployeeId(i.ownerEmployeeId);
      if (i.ownershipHandoff !== undefined && owner === null) {
        fail("OWNERSHIP_HANDOFF_WITHOUT_OWNER_CHANGE", "INVALID_INPUT", "ownershipHandoff describes an owner change; name ownerEmployeeId");
      }
      const handoff = { named: i.ownershipHandoff !== undefined, terms: ownershipHandoffTerms(i.ownershipHandoff) };
      if (fields.columns.size === 0 && SET_FIELDS.every((f) => i[f] === undefined) && owner === null) {
        fail("NO_CHANGES_REQUESTED", "INVALID_INPUT", "an update must name at least one accepted field");
      }
      return { accountId: requireRecordId(i.accountId, "accountId"), fields, owner, handoff };
    },
    async (db, principal, { accountId, fields, owner, handoff }) => {
      const { tenantId, principalId } = principal;
      const current = await db.query<{ payment_terms: string | null; tax_status: string | null; owner_employee_id: string | null }>(
        `SELECT payment_terms, tax_status, owner_employee_id FROM eos_crm.accounts WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [tenantId, accountId],
      );
      if (current.rows.length === 0) fail("ACCOUNT_NOT_FOUND", "NOT_FOUND", "the Account does not exist in this tenant");
      // accountGovernedFieldsUnchanged: naming a governed field with its CURRENT value is not a governed write.
      for (const column of ["payment_terms", "tax_status"] as const) {
        if (fields.columns.has(column) && fields.columns.get(column) !== current.rows[0][column]) requireGovernedFieldCapability(principal);
      }
      if (owner !== null) {
        const previous = current.rows[0].owner_employee_id;
        if (previous === null) {
          fail("ACCOUNT_OWNER_ASSIGNMENT_NOT_GOVERNED", "PRECONDITION_FAILED",
            "this Account has no owner; a first owner assignment is not an ownership handoff and no governed path exists for it");
        }
        if (owner === previous) {
          if (handoff.named) fail("OWNERSHIP_HANDOFF_WITHOUT_OWNER_CHANGE", "INVALID_INPUT", "the Account is already owned by that Employee; there is no handoff to record");
        } else {
          const newOwner = await requireOwnerEmployee(db, tenantId, owner);
          await stageAccountOwnershipHandoff(db, tenantId, principalId, accountId, previous as string, newOwner, handoff.terms);
        }
      }
      const set = assignmentsOf(fields.columns, Object.fromEntries([...fields.columns.keys()].map((c) => [c, c])), 4);
      const assignments = set.sql === "" ? "" : set.sql + ", ";
      await db.query(
        `UPDATE eos_crm.accounts SET ${assignments}updated_by = $3, updated_at = now()
          WHERE tenant_id = $1 AND id = $2`,
        [tenantId, accountId, principalId, ...set.values],
      );
      await replaceChildren(db, tenantId, accountId, fields, true);
      return selectAccount(db, tenantId, accountId);
    },
  );
}

// ════════════════════ reads ════════════════════

export function getAccount(deps: CrmDeps, actor: CrmActorContext, input: unknown): Promise<AccountProjection> {
  return runCrmRead(
    deps,
    actor,
    CRM_CAPABILITIES.CUSTOMER_RECORD_READ,
    () => ({ accountId: requireRecordId(requireAllowlistedInput(input, ["accountId"]).accountId, "accountId") }),
    (db, tenantId, { accountId }) => selectAccount(db, tenantId, accountId),
  );
}

export interface AccountPage {
  readonly items: AccountProjection[];
  readonly truncated: boolean;
  readonly nextCursor: string | null;
}

const MAX_NAME_PREFIX = 200;

export function listAccounts(deps: CrmDeps, actor: CrmActorContext, input: unknown = {}): Promise<AccountPage> {
  return runCrmRead(
    deps,
    actor,
    CRM_CAPABILITIES.CUSTOMER_RECORD_READ,
    () => {
      const i = requireAllowlistedInput(input, ["limit", "cursor", "status", "nameStartsWith"]);
      let statuses: string[] | null = null;
      if (i.status !== undefined) {
        const values = typeof i.status === "string" ? [i.status] : i.status;
        if (!Array.isArray(values) || values.length === 0 || values.length > CRM_ACCOUNT_STATUSES.length || !values.every(isCrmAccountStatus)) {
          fail("FILTER_INVALID", "INVALID_INPUT", `status must be one of, or a non-empty array of, ${CRM_ACCOUNT_STATUSES.join(", ")}`);
        }
        statuses = [...new Set(values as string[])];
      }
      let prefix: string | null = null;
      if (i.nameStartsWith !== undefined) {
        if (typeof i.nameStartsWith !== "string" || i.nameStartsWith.trim() === "" || i.nameStartsWith.length > MAX_NAME_PREFIX) {
          fail("FILTER_INVALID", "INVALID_INPUT", `nameStartsWith must be a non-empty string of at most ${MAX_NAME_PREFIX} characters`);
        }
        // The SAME fold as eos_crm's `lower(btrim(name))` index and customerIdentity.foldCustomerName.
        prefix = (i.nameStartsWith as string).trim().toLowerCase();
      }
      return { limit: requirePageSize(i.limit), cursor: decodeCrmCursor("account", i.cursor), statuses, prefix };
    },
    async (db, tenantId, { limit, cursor, statuses, prefix }) => {
      const { rows } = await db.query<AccountRow & { folded_name: string }>(
        `SELECT ${COLUMNS}, lower(btrim(a.name)) AS folded_name
           FROM eos_crm.accounts a
          WHERE a.tenant_id = $1
            AND ($2::text[] IS NULL OR a.status::text = ANY($2::text[]))
            AND ($3::text IS NULL OR left(lower(btrim(a.name)), char_length($3::text)) = $3::text)
            AND ($4::text IS NULL OR (lower(btrim(a.name)), a.id) > ($4::text, $5::text))
          ORDER BY lower(btrim(a.name)), a.id
          LIMIT $6`,
        [tenantId, statuses, prefix, cursor?.name ?? null, cursor?.id ?? null, limit + 1],
      );
      return pageOf("account", rows, limit, project);
    },
  );
}

// ════════════════════ ownership history ════════════════════

export interface AccountOwnershipHandoffProjection {
  readonly handoffId: string;
  readonly accountId: string;
  readonly previousOwnerEmployeeId: string;
  readonly newOwnerEmployeeId: string;
  readonly source: AccountOwnershipHandoffSource;
  readonly reason: string | null;
  readonly handedOffBy: string;
  readonly effectiveAt: string;
  readonly createdAt: string;
}

export interface AccountOwnershipHandoffPage {
  readonly items: AccountOwnershipHandoffProjection[];
  readonly truncated: boolean;
  readonly nextCursor: string | null;
}

interface HandoffRow {
  id: string;
  account_id: string;
  previous_owner_employee_id: string;
  new_owner_employee_id: string;
  source: AccountOwnershipHandoffSource;
  reason: string | null;
  handed_off_by: string;
  effective_at: Date;
  created_at: Date;
  /** The keyset position: effective_at as UTC text at microsecond precision. */
  folded_name: string;
}

const HANDOFF_CURSOR_FAMILY = "accountOwnershipHandoff";
const HANDOFF_POSITION = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

export function listAccountOwnershipHandoffs(deps: CrmDeps, actor: CrmActorContext, input: unknown): Promise<AccountOwnershipHandoffPage> {
  return runCrmRead(
    deps,
    actor,
    CRM_CAPABILITIES.CUSTOMER_RECORD_READ,
    () => {
      const i = requireAllowlistedInput(input, ["accountId", "limit", "cursor"]);
      const cursor = decodeCrmCursor(HANDOFF_CURSOR_FAMILY, i.cursor);
      if (cursor && !HANDOFF_POSITION.test(cursor.name)) fail("CURSOR_INVALID", "INVALID_INPUT", "cursor is not a valid position for this list");
      return { accountId: requireRecordId(i.accountId, "accountId"), limit: requirePageSize(i.limit), cursor };
    },
    async (db, tenantId, { accountId, limit, cursor }) => {
      await requireTenantAccount(db, tenantId, accountId);
      const { rows } = await db.query<HandoffRow>(
        `SELECT id, account_id, previous_owner_employee_id, new_owner_employee_id, source, reason, handed_off_by, effective_at, created_at,
                to_char(effective_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS folded_name
           FROM eos_crm.account_ownership_handoffs
          WHERE tenant_id = $1 AND account_id = $2
            AND ($3::timestamptz IS NULL OR (effective_at, id) < ($3::timestamptz, $4::text))
          ORDER BY effective_at DESC, id DESC
          LIMIT $5`,
        [tenantId, accountId, cursor?.name ?? null, cursor?.id ?? null, limit + 1],
      );
      return pageOf(HANDOFF_CURSOR_FAMILY, rows, limit, (row) => ({
        handoffId: row.id,
        accountId: row.account_id,
        previousOwnerEmployeeId: row.previous_owner_employee_id,
        newOwnerEmployeeId: row.new_owner_employee_id,
        source: row.source,
        reason: row.reason,
        handedOffBy: row.handed_off_by,
        effectiveAt: isoOf(row.effective_at),
        createdAt: isoOf(row.created_at),
      }));
    },
  );
}
