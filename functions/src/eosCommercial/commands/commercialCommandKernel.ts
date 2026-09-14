// The governed PostgreSQL Commercial command KERNEL -- wave C2.
//
// Everything the ten Commercial command services share, and nothing that belongs to one family:
//
//   * the ALREADY-RESOLVED actor context a future Render boundary (C4) supplies -- tenant, EOS principal and the
//     capability keys `resolveOperationalContext` computes from eos_policy.role_capabilities. Authentication is
//     NOT done here; business authority (capability + active tenant membership) IS.
//   * ONE transaction per command, with the C1 `command_receipts` idempotency receipt written inside it. A
//     transaction-scoped advisory lock keyed on (tenant, principal, operation, key hash) serializes concurrent
//     first executions of the same key, so exactly one mutates and the rest replay its committed result.
//   * deterministic domain errors: governed refusals keep their code; PostgreSQL integrity failures map to named
//     codes; anything else is COMMAND_FAILED with no SQL, no driver message and no connection detail.
//   * the governed COMMERCIAL_ACCOUNTABILITY_ELIGIBILITY_V1 policy (Owner ruling 2026-09-14), fixed, never an input.
//   * the catalog-reference PORT. No PostgreSQL catalog authority exists yet (`parts` is Firestore-only, and
//     `eos_ops.equipment_models` is written by nothing). Commands that validate PART / EQUIPMENT_MODEL references
//     REFUSE with CATALOG_AUTHORITY_UNAVAILABLE unless an authority is supplied -- an explicit activation
//     prerequisite, not a silently removed check and not a Firestore import.
//
// WIRED ONLY THROUGH the C4 Commercial transport (commercialHttp.ts). No Firebase callable or client imports it.
import type { Pool, PoolClient } from "pg";
import { createHash, randomUUID } from "node:crypto";
import { createPostgresEmployeeAuthority } from "../../employeeIdentity/postgresEmployeeAuthority";

export type CommercialFamily = "opportunity" | "salesAgreement" | "salesOrder";

/** The Commercial capability keys the commands require -- the ids the permission catalog already registers. */
export const COMMERCIAL_CAPABILITIES = Object.freeze({
  OPPORTUNITY_WRITE: "opportunity.write",
  OPPORTUNITY_CREATE_SALES_ORDER: "opportunity.createSalesOrder",
  SALES_AGREEMENT_CREATE: "salesAgreement.create",
  SALES_AGREEMENT_UPDATE_DRAFT: "salesAgreement.updateDraft",
  SALES_AGREEMENT_ACCEPT: "salesAgreement.accept",
  SALES_ORDER_WRITE: "salesOrder.write",
} as const);

/** Owner ruling 2026-09-14. Fixed here; a command cannot be handed a different policy. */
export const COMMERCIAL_ACCOUNTABILITY_ELIGIBILITY_V1 = Object.freeze({
  policyId: "COMMERCIAL_ACCOUNTABILITY_ELIGIBILITY_V1",
  eligibleStatuses: Object.freeze(["ACTIVE", "CONTRACTOR"] as const),
});

/** The resolved governed context a trusted boundary hands a command. */
export interface CommercialActorContext {
  readonly tenantId: string;
  /** The EOS principal id (eos_policy.principals.id), never a Firebase uid. */
  readonly principalId: string;
  /** Capability KEYS held in this tenant, as resolveOperationalContext computes them. */
  readonly capabilities: ReadonlySet<string>;
}

export type CommercialErrorCategory =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "PRECONDITION_FAILED"
  | "CONFLICT"
  | "FORBIDDEN"
  | "UNAVAILABLE"
  | "FAILED";

export class CommercialCommandError extends Error {
  constructor(readonly code: string, readonly category: CommercialErrorCategory, message: string) {
    super(message);
    this.name = "CommercialCommandError";
  }
}

export const fail = (code: string, category: CommercialErrorCategory, message: string): never => {
  throw new CommercialCommandError(code, category, message);
};

/** A PART or EQUIPMENT_MODEL reference to validate. SERVICE lines have no catalog and are never sent. */
export interface CatalogReference {
  readonly kind: "PART" | "EQUIPMENT_MODEL";
  readonly ref: string;
}
export type CatalogReferenceVerdict = "FOUND" | "NOT_FOUND" | "WRONG_KIND";
const CATALOG_VERDICTS: ReadonlySet<unknown> = new Set<CatalogReferenceVerdict>(["FOUND", "NOT_FOUND", "WRONG_KIND"]);

/**
 * The catalog-reference authority a command validates product lines against. There is deliberately no
 * implementation in this repository: supplying one is an activation prerequisite (Owner C2 ruling).
 */
export interface CommercialCatalogAuthority {
  verifyReferences(
    db: Pick<PoolClient, "query">,
    tenantId: string,
    references: readonly CatalogReference[],
  ): Promise<readonly CatalogReferenceVerdict[]>;
}

export interface CommercialCommandDeps {
  readonly pool: Pool;
  /** Absent in every deployed composition today, which is why product-line commands cannot activate. */
  readonly catalog?: CommercialCatalogAuthority;
  /** Clock seam for tests. Defaults to the server clock. */
  readonly now?: () => Date;
}

/** Validate product references through the port, refusing when no authority exists. */
export async function requireCatalogReferences(
  deps: CommercialCommandDeps,
  db: Pick<PoolClient, "query">,
  tenantId: string,
  lines: readonly { kind: string; ref: string }[],
): Promise<void> {
  const references = lines
    .filter((l) => l.kind === "PART" || l.kind === "EQUIPMENT_MODEL")
    .map((l) => ({ kind: l.kind as CatalogReference["kind"], ref: l.ref }));
  if (references.length === 0) return;
  if (!deps.catalog) {
    fail(
      "CATALOG_AUTHORITY_UNAVAILABLE",
      "UNAVAILABLE",
      "no PostgreSQL catalog authority is available to validate PART / EQUIPMENT_MODEL references; this command cannot run until one is governed",
    );
  }
  const verdicts: unknown = await deps.catalog!.verifyReferences(db, tenantId, references);
  // The authority must answer every reference with a governed verdict. A short, long or unrecognised answer is a broken
  // authority, and a broken authority must never read as FOUND.
  if (!Array.isArray(verdicts) || verdicts.length !== references.length || !verdicts.every((v) => CATALOG_VERDICTS.has(v))) {
    fail("CATALOG_AUTHORITY_CONTRACT_VIOLATION", "UNAVAILABLE", "the catalog authority did not return one governed verdict per reference");
  }
  (verdicts as CatalogReferenceVerdict[]).forEach((verdict, i) => {
    if (verdict === "NOT_FOUND") fail("REFERENCE_NOT_FOUND", "INVALID_INPUT", `line reference ${references[i].ref} does not exist`);
    if (verdict === "WRONG_KIND") fail("REFERENCE_WRONG_KIND", "INVALID_INPUT", `line reference ${references[i].ref} is not a ${references[i].kind}`);
  });
}

// ════════════════════ error translation ════════════════════

const PRECONDITION_CODES = new Set([
  "ALREADY_CLOSED", "ILLEGAL_TRANSITION", "OUTCOME_REQUIRES_DECISION", "NO_LINES", "LINE_QTY_REQUIRED_FOR_WON", "CLOSED",
  "NO_CHANGES", "TERMINAL", "NOT_FULFILLABLE", "UNPRICED_LINE", "COMPANY_REQUIRED", "ALREADY_ESTABLISHED", "NOTHING_TO_HAND_OFF",
  "HANDOFF_IS_NO_OP", "NO_OP",
]);
const DOMAIN_ERROR_NAMES = new Set([
  "OpportunityCommandError", "SalesAgreementCommandError", "SalesOrderCommandError", "CommercialCompanyScopeError",
  "CommercialOwnershipError", "CreationOwnerUnresolvedError", "AttributionError", "CreationAccountablePersonError",
  "AccountablePersonMintError", "CommercialAccountabilityWriteError", "CommercialNumberingError", "EmployeeAuthorityFailure",
]);
const CONSTRAINT_CODES: Readonly<Record<string, [string, CommercialErrorCategory]>> = Object.freeze({
  opportunities_account_fk: ["ACCOUNT_NOT_FOUND", "NOT_FOUND"],
  sales_agreements_account_fk: ["ACCOUNT_NOT_FOUND", "NOT_FOUND"],
  sales_orders_account_fk: ["ACCOUNT_NOT_FOUND", "NOT_FOUND"],
  sales_agreements_one_per_opportunity: ["AGREEMENT_ALREADY_EXISTS", "CONFLICT"],
  sales_orders_one_per_opportunity: ["SALES_ORDER_ALREADY_EXISTS", "CONFLICT"],
  sales_orders_one_per_agreement: ["SALES_ORDER_ALREADY_EXISTS", "CONFLICT"],
  opportunities_number_unique: ["NUMBER_CONFLICT", "CONFLICT"],
  sales_agreements_number_unique: ["NUMBER_CONFLICT", "CONFLICT"],
  sales_orders_number_unique: ["NUMBER_CONFLICT", "CONFLICT"],
  command_receipts_one_per_key: ["IDEMPOTENCY_CONFLICT", "CONFLICT"],
  command_receipts_member_fk: ["ACTOR_NOT_TENANT_MEMBER", "FORBIDDEN"],
});

/** Every error leaving a command is a CommercialCommandError. Nothing else crosses the boundary. */
export function translateCommercialError(err: unknown): CommercialCommandError {
  if (err instanceof CommercialCommandError) return err;
  const e = err as { name?: unknown; code?: unknown; constraint?: unknown; message?: unknown } | null;
  if (e && typeof e.name === "string" && DOMAIN_ERROR_NAMES.has(e.name) && typeof e.code === "string") {
    const category: CommercialErrorCategory =
      e.code === "RECORD_NOT_FOUND" || e.code === "EMPLOYEE_REFERENCE_NOT_FOUND" ? "NOT_FOUND"
        : e.code.endsWith("AUTHORITY_UNAVAILABLE") ? "UNAVAILABLE"
          : PRECONDITION_CODES.has(e.code) ? "PRECONDITION_FAILED"
            : "INVALID_INPUT";
    return new CommercialCommandError(e.code, category, String(e.message ?? e.code));
  }
  if (e && e.name === "CommercialRecordNotFoundError") return new CommercialCommandError("RECORD_NOT_FOUND", "NOT_FOUND", String(e.message));
  if (e && typeof e.constraint === "string" && CONSTRAINT_CODES[e.constraint]) {
    const [code, category] = CONSTRAINT_CODES[e.constraint];
    return new CommercialCommandError(code, category, `refused by governed integrity rule ${code}`);
  }
  if (e && (e.code === "40001" || e.code === "40P01")) {
    return new CommercialCommandError("CONCURRENT_MODIFICATION", "CONFLICT", "the command collided with a concurrent change; retry it");
  }
  return new CommercialCommandError("COMMAND_FAILED", "FAILED", "the command could not be completed");
}

// ════════════════════ the one-transaction runner ════════════════════

export interface CommercialCommandTarget {
  readonly family: CommercialFamily;
  readonly id: string;
}

export interface CommercialCommandOutcome<R> {
  readonly result: R;
  readonly target: CommercialCommandTarget | null;
}

export type CommercialReplayable<R> = R & { readonly replayed: boolean };

const hashKey = (key: string): string => createHash("sha256").update(key, "utf8").digest("hex");

/**
 * Run ONE governed Commercial command in ONE PostgreSQL transaction.
 *
 * Order: capability check -> BEGIN -> advisory lock on the idempotency identity -> replay if a committed receipt
 * exists -> active principal + active membership -> the command body -> the receipt -> COMMIT. Any failure rolls
 * back every effect, the receipt included, and leaves the key free for a genuine retry.
 */
export async function runCommercialCommand<R extends object>(
  deps: CommercialCommandDeps,
  actor: CommercialActorContext,
  operation: string,
  requiredCapabilities: readonly string[],
  idempotencyKey: unknown,
  body: (client: PoolClient, now: Date) => Promise<CommercialCommandOutcome<R>>,
): Promise<CommercialReplayable<R>> {
  if (!actor || typeof actor.tenantId !== "string" || actor.tenantId.trim() === "" || typeof actor.principalId !== "string" || actor.principalId.trim() === "") {
    throw new CommercialCommandError("ACTOR_CONTEXT_REQUIRED", "FORBIDDEN", "a resolved tenant and principal are required");
  }
  if (!(actor.capabilities instanceof Set)) {
    throw new CommercialCommandError("ACTOR_CONTEXT_REQUIRED", "FORBIDDEN", "a resolved capability set is required");
  }
  const missing = requiredCapabilities.filter((c) => !actor.capabilities.has(c));
  if (missing.length > 0) {
    throw new CommercialCommandError("CAPABILITY_REQUIRED", "FORBIDDEN", `this command requires ${missing.join(", ")}`);
  }
  if (typeof idempotencyKey !== "string" || idempotencyKey.trim() === "") {
    throw new CommercialCommandError("IDEMPOTENCY_KEY_REQUIRED", "INVALID_INPUT", "a non-empty idempotency key is required");
  }
  const keyHash = hashKey(idempotencyKey);
  const now = (deps.now ?? (() => new Date()))();

  // Acquisition is INSIDE the governed boundary: a pool that cannot connect is a COMMAND_FAILED like any other
  // infrastructure failure, never a raw driver error carrying a host, user or connection string.
  let client: PoolClient | undefined;
  try {
    client = await deps.pool.connect();
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
      `commercial-command|${actor.tenantId}|${actor.principalId}|${operation}|${keyHash}`,
    ]);
    const prior = await client.query<{ result: R }>(
      `SELECT result FROM eos_commercial.command_receipts
        WHERE tenant_id = $1 AND principal_id = $2 AND operation = $3 AND idempotency_key_hash = $4`,
      [actor.tenantId, actor.principalId, operation, keyHash],
    );
    if (prior.rows.length === 1) {
      await client.query("COMMIT");
      return { ...prior.rows[0].result, replayed: true };
    }
    const member = await client.query(
      `SELECT 1 FROM eos_policy.tenant_memberships m JOIN eos_policy.principals p ON p.id = m.principal_id
        WHERE m.tenant_id = $1 AND m.principal_id = $2 AND m.status = 'active' AND p.status = 'active'`,
      [actor.tenantId, actor.principalId],
    );
    if (member.rows.length === 0) {
      fail("ACTOR_NOT_TENANT_MEMBER", "FORBIDDEN", "the principal is not an active member of this tenant");
    }
    const outcome = await body(client, now);
    await client.query(
      `INSERT INTO eos_commercial.command_receipts
         (id, tenant_id, principal_id, operation, idempotency_key_hash, target_family, target_id, result)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [`rcpt_${randomUUID()}`, actor.tenantId, actor.principalId, operation, keyHash,
        outcome.target?.family ?? null, outcome.target?.id ?? null, JSON.stringify(outcome.result)],
    );
    await client.query("COMMIT");
    return { ...outcome.result, replayed: false };
  } catch (err) {
    if (client) await client.query("ROLLBACK").catch(() => undefined);
    throw translateCommercialError(err);
  } finally {
    client?.release();
  }
}

// ════════════════════ shared governed resolutions ════════════════════

type Queryable = Pick<PoolClient, "query">;

/** The Employee must RESOLVE in this tenant through the governed PostgreSQL Employee authority. */
export async function requireTenantEmployee(
  db: Queryable,
  tenantId: string,
  employeeId: string,
  role: "OWNER" | "CREDITED_SALESPERSON",
): Promise<string> {
  const resolution = await createPostgresEmployeeAuthority(db).resolveEmployeeReference({ tenantId, employeeId });
  if (resolution.outcome === "RESOLVED") return resolution.employee.employeeId;
  if (resolution.outcome === "AUTHORITY_UNAVAILABLE") {
    fail("EMPLOYEE_AUTHORITY_UNAVAILABLE", "UNAVAILABLE", "the Employee authority could not answer");
  }
  return fail(
    role === "OWNER" ? "OWNER_NOT_FOUND" : "CREDITED_SALESPERSON_NOT_FOUND",
    "NOT_FOUND",
    `${role === "OWNER" ? "the owner" : "the credited salesperson"} ${employeeId} is not an Employee of this tenant`,
  );
}

/** The Account row, read in THIS tenant only. */
export async function requireTenantAccount(
  db: Queryable,
  tenantId: string,
  accountId: string,
): Promise<{ id: string; ownerEmployeeId: string | null }> {
  const { rows } = await db.query<{ id: string; owner_employee_id: string | null }>(
    `SELECT id, owner_employee_id FROM eos_crm.accounts WHERE tenant_id = $1 AND id = $2`,
    [tenantId, accountId],
  );
  if (rows.length === 0) fail("ACCOUNT_NOT_FOUND", "NOT_FOUND", `no Account ${accountId} in this tenant`);
  return { id: rows[0].id, ownerEmployeeId: rows[0].owner_employee_id };
}
