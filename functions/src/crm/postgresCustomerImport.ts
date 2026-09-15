// THE POST-CUTOVER CUSTOMER IMPORT CONTRACT -- Data Import customers written through the governed PostgreSQL CRM
// authority (controller CRM cutover ruling 2; docs/architecture/crm-cutover-plan.md §5 row 3).
//
// ════════════════════ UNWIRED, BEHIND THE CRM WRITER STATE ════════════════════
//
// Nothing composes this today: its first act is assertPostgresCrmWriterActive, and the committed CRM writer authority is
// PostgreSQL INACTIVE (crm/crmWriterState.ts). Moving Data Import's CUSTOMERS entity onto it is the consumer-migration
// step; the refusal contract is fixed and tested here first.
//
// ════════════════════ WHAT IT REFUSES ════════════════════
//
//   * NO OWNER: every Account requires an EXPLICIT Employee owner stated on the import row. It is never taken from the
//     import operator, the approving Principal, a Firebase uid, a Security Role, a Job Role or the creator, and there is
//     no governed creation-owner authority for the Account family to supply one (functions/src/ownership/
//     creationOwnerResolution.ts resolves Opportunity / Sales Agreement / Sales Order owners FROM an Account, never an
//     Account's own). Whether the stated owner is a valid same-tenant Employee is decided by the authority itself.
//   * UNSTRUCTURED BILLING ADDRESS: the legacy customer contract's single free-text line (customerImportContract.ts:66-73)
//     is never parsed. A structured { street, city, state, zip } is handed to eos_crm accountAuthority UNCHANGED, so its
//     validation is the authority's own, not a second copy.
//   * GOVERNED FIELDS (paymentTerms, taxStatus) and any field outside the allowlist.
//   * A legacy row lacking a required fact (name, status, owner) refuses; nothing is defaulted.
import { createAccount } from "../eosCrm/accountAuthority.js";
import type { CrmActorContext, CrmDeps } from "../eosCrm/crmAuthorityKernel.js";
import { assertPostgresCrmWriterActive, CRM_WRITER_AUTHORITY, type CrmWriterAuthority } from "./crmWriterState.js";

export const POSTGRES_CUSTOMER_IMPORT_WRITER = "account.import.postgres";

/** The row fields the PostgreSQL customer import accepts. `ownerEmployeeId` is the contract's addition. */
export const POSTGRES_CUSTOMER_IMPORT_FIELDS = Object.freeze([
  "name", "status", "ownerEmployeeId", "billingAddress", "customerNumber", "notes", "erpId", "accountingId", "legacyId",
] as const);

export class PostgresCustomerImportRefusal extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "PostgresCustomerImportRefusal";
  }
}

const isPlain = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** Pure: an import row -> the exact eos_crm createAccount input, or a refusal. Never repairs, never defaults. */
export function preparePostgresCustomerImport(row: unknown, idempotencyKey: string): Record<string, unknown> {
  if (!isPlain(row)) throw new PostgresCustomerImportRefusal("ROW_INVALID", "an import row must be an object");
  const unknown = Object.keys(row).filter((k) => !(POSTGRES_CUSTOMER_IMPORT_FIELDS as readonly string[]).includes(k));
  if (unknown.length > 0) {
    const governed = unknown.filter((k) => k === "paymentTerms" || k === "taxStatus");
    throw governed.length > 0
      ? new PostgresCustomerImportRefusal("GOVERNED_FIELD_REFUSED", `${governed.join(", ")} cannot be set by import`)
      : new PostgresCustomerImportRefusal("FIELD_NOT_ALLOWED", `not an import field: ${unknown.sort().join(", ")}`);
  }
  if (typeof row.name !== "string" || row.name.trim() === "") throw new PostgresCustomerImportRefusal("NAME_REQUIRED", "a customer must have a name");
  if (typeof row.status !== "string" || row.status === "") throw new PostgresCustomerImportRefusal("STATUS_REQUIRED", "a customer import row must state its status");
  if (row.ownerEmployeeId === undefined || row.ownerEmployeeId === null || (typeof row.ownerEmployeeId === "string" && row.ownerEmployeeId.trim() === "")) {
    throw new PostgresCustomerImportRefusal("OWNER_REQUIRED", "every imported Account requires an explicit Employee owner; none is inferred");
  }
  if (typeof row.billingAddress === "string") {
    throw new PostgresCustomerImportRefusal("BILLING_ADDRESS_UNSTRUCTURED", "a single free-text billing address is never parsed; supply { street, city, state, zip }");
  }
  if (typeof idempotencyKey !== "string" || idempotencyKey === "") throw new PostgresCustomerImportRefusal("IDEMPOTENCY_KEY_REQUIRED", "a deterministic per-row idempotency key is required");
  const input: Record<string, unknown> = { idempotencyKey };
  for (const field of POSTGRES_CUSTOMER_IMPORT_FIELDS) if (row[field] !== undefined) input[field] = row[field];
  return input;
}

/**
 * Create ONE Account from an import row through the governed authority, as the verified import actor. The actor is
 * ATTRIBUTION (created_by); the owner is the row's explicit Employee. Refuses while PostgreSQL CRM writes are inactive.
 */
export async function importCustomerToPostgres(
  deps: CrmDeps,
  actor: CrmActorContext,
  request: { readonly row: unknown; readonly idempotencyKey: string },
  authority: CrmWriterAuthority = CRM_WRITER_AUTHORITY,
) {
  assertPostgresCrmWriterActive(POSTGRES_CUSTOMER_IMPORT_WRITER, authority);
  const input = preparePostgresCustomerImport(request.row, request.idempotencyKey);
  if (input.ownerEmployeeId === actor.principalId) {
    throw new PostgresCustomerImportRefusal("OWNER_IS_IMPORT_ACTOR", "the importing Principal is attribution, never the owner");
  }
  return createAccount(deps, actor, input);
}
