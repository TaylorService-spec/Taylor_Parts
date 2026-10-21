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
import { admittedScopeValues, type ScopedHolding } from "../../adminPolicy/assignmentScopeRuntime";
import { RESERVED_CAPABILITY_HOLDERS } from "../../adminPolicy/roleCapabilityAdministration";
import { qualifyingGlobalRoles } from "../../eosOps/administrationReach";
import { recordCommandAudit, wellFormed, type CommandAuditSpec } from "../../eosAudit/commandAuditEvent";
import { resolveCommercialCompanyReach, type CommercialCompanyReach, type CommercialCompanyResolver } from "../commercialCompanyAuthority";

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

/**
 * Owner ruling #204: BUSINESS APPROVAL of a proposed trade-in value (PostgreSQL-native, migration 1764500000000). Not one of
 * the migration-023 vocabulary keys above, and never implied by administrative authority.
 */
export const SALES_AGREEMENT_TRADE_IN_APPROVE_CAPABILITY = "salesAgreement.tradeIn.approve";

/**
 * DQ-022: an ADMINISTRATIVE handoff source (ADMIN_CORRECTION / CUSTOMER_HANDOFF_REVIEW) needs this in addition to the
 * record's edit capability. Not one of the Commercial vocabulary keys above (migration 023): it belongs to the ownership
 * handoff domain shared with the CRM Account (migration 1763683200000).
 */
export const OWNERSHIP_HANDOFF_CORRECT_CAPABILITY = "ownership.handoff.correct";

/** DQ-022: the handoff sources that state an administrative act, and so require OWNERSHIP_HANDOFF_CORRECT. */
export const ADMINISTRATIVE_HANDOFF_SOURCES: ReadonlySet<string> = new Set(["ADMIN_CORRECTION", "CUSTOMER_HANDOFF_REVIEW"]);

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
  /**
   * Capabilities held ONLY within an assignment scope (resolveOperationalContext(...).scopedHeld). Never in
   * `capabilities`. A Commercial command honours an UNCONDITIONED salesChannel holding against the governing channel of
   * the record it writes (DQ-020); every other scoped or conditioned holding grants nothing here. Absent = none.
   */
  readonly scopedHeld?: readonly ScopedHolding[];
}

/**
 * DQ-020 (Controller 2026-09-28): Commercial writes are NOT tenant-wide. A capability held globally reaches every
 * channel; one held only at salesChannel=X reaches records whose GOVERNING channel is X -- decided exactly the way the
 * Commercial reads decide it (admittedScopeValues over unconditioned holdings). The governing channel is fixed by the
 * record's relationship, per operation:
 *   Opportunity create        the channel it is created in (validated by the builder)
 *   Opportunity edit/move     its stored channel -- and, when an edit changes the channel, the new one too
 *   Agreement create/edit/accept  its source Opportunity's stored channel
 *   Sales Order create        its source Opportunity's channel (direct: the channel it is created in)
 *   Sales Order transition    its stored channel
 * A record with no channel admits no scoped holder. The command body MUST decide the channel: a body that returns
 * without calling `admitChannel` for a non-global actor is refused (fail closed).
 */
export interface CommercialWriteScope {
  /** True when every required capability is held globally; `admitChannel` then admits everything. */
  readonly global: boolean;
  /** Refuse OUTSIDE_SALES_CHANNEL_SCOPE unless every required capability reaches `channel`. */
  admitChannel(channel: string | null | undefined): void;
  /**
   * Q-1a (Owner ruling Q1-11): OPERATING-COMPANY AUTHORITY, decided BEFORE the channel. A command that acts on an EXISTING record locks it through
   * a `commercialRecordStore` lock function, which puts this predicate INSIDE the SELECT ... FOR UPDATE: a record of a company the caller does not reach
   * is simply not found (RECORD_NOT_FOUND, never "forbidden") and is never locked. Calling it records that the command decided company authority.
   */
  companyFilter(alias: string, firstParam: number): { readonly sql: string; readonly params: readonly unknown[] };
  /**
   * Q-1a: a command that CREATES a record states the company it books to (a key, null = company-less). A company the caller does not reach refuses
   * with the SAME words as a company this tenant does not govern (OPERATING_COMPANY_NOT_GOVERNED): the caller learns nothing about it.
   */
  admitNewCompany(companyKey: string | null, companyId: string | null): void;
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
  /** TEST INJECTION ONLY (Q-1a). The deployed server supplies none (a test asserts it); absent = the governed resolver. */
  readonly companyReach?: CommercialCompanyResolver;
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
  "OPERATING_COMPANY_KEY_NOT_BOUND", "OPERATING_COMPANY_KEY_AMBIGUOUS",
  "ALREADY_CLOSED", "ILLEGAL_TRANSITION", "OUTCOME_REQUIRES_DECISION", "NO_LINES", "LINE_QTY_REQUIRED_FOR_WON", "CLOSED",
  "NO_CHANGES", "TERMINAL", "NOT_FULFILLABLE", "UNPRICED_LINE", "COMPANY_REQUIRED", "ALREADY_ESTABLISHED", "NOTHING_TO_HAND_OFF",
  "HANDOFF_IS_NO_OP", "NO_OP",
]);
const DOMAIN_ERROR_NAMES = new Set([
  "OpportunityCommandError", "SalesAgreementCommandError", "SalesOrderCommandError", "CommercialCompanyScopeError",
  "CommercialOwnershipError", "CreationOwnerUnresolvedError", "AttributionError", "CreationAccountablePersonError",
  "AccountablePersonMintError", "CommercialAccountabilityWriteError", "CommercialNumberingError", "EmployeeAuthorityFailure",
  // The governed company -> key binding (eosOps/operatingCompanyBinding.ts): an unkeyed or inactive company refuses.
  "OperatingCompanyBindingError",
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
  /**
   * Q-1: the ONE audit row this applied command writes (eos_policy.audit_events), in the same transaction as the receipt.
   * Required by the type, so a new command cannot compile without stating its audit. A replay never reaches the body and a
   * refusal rolls the row back with everything else.
   */
  readonly audit: CommandAuditSpec;
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
  body: (client: PoolClient, now: Date, scope: CommercialWriteScope) => Promise<CommercialCommandOutcome<R>>,
  /**
   * The record the caller's input NAMES (e.g. the Opportunity an edit targets), for commands that act on an existing
   * record. A committed receipt for the same key is a replay ONLY of a command on that same record: the replay identity
   * is (tenant, principal, operation, key), so without this a key reused on a DIFFERENT record would return the first
   * record's result as "replayed" and apply nothing -- the false replay the retired Firestore path closed by scoping its
   * replay id to the record. Refused IDEMPOTENCY_KEY_REUSED instead.
   */
  replayTarget?: { readonly family: CommercialFamily; readonly id: unknown },
): Promise<CommercialReplayable<R>> {
  if (!actor || typeof actor.tenantId !== "string" || actor.tenantId.trim() === "" || typeof actor.principalId !== "string" || actor.principalId.trim() === "") {
    throw new CommercialCommandError("ACTOR_CONTEXT_REQUIRED", "FORBIDDEN", "a resolved tenant and principal are required");
  }
  if (!(actor.capabilities instanceof Set)) {
    throw new CommercialCommandError("ACTOR_CONTEXT_REQUIRED", "FORBIDDEN", "a resolved capability set is required");
  }
  // Global first (unchanged); a key absent from the flat set may still be held at sales-channel scope (DQ-020).
  const channelsByCapability = new Map<string, readonly string[]>();
  for (const c of requiredCapabilities) {
    if (actor.capabilities.has(c)) continue;
    const channels = admittedScopeValues(actor.scopedHeld, c, "salesChannel");
    if (channels.length > 0) channelsByCapability.set(c, channels);
  }
  const missing = requiredCapabilities.filter((c) => !actor.capabilities.has(c) && !channelsByCapability.has(c));
  if (missing.length > 0) {
    throw new CommercialCommandError("CAPABILITY_REQUIRED", "FORBIDDEN", `this command requires ${missing.join(", ")}`);
  }
  let channelDecided = false;
  let companyDecided = false;
  // Resolved in the command's transaction once membership is proved (below); the scope is bound to it.
  let company: CommercialCompanyReach | null = null;
  const reach = (): CommercialCompanyReach => company ?? fail("COMPANY_AUTHORITY_NOT_ESTABLISHED", "FORBIDDEN", "operating-company authority was not resolved for this command");
  const scope: CommercialWriteScope = Object.freeze({
    companyFilter(alias: string, firstParam: number) {
      const r = reach();
      companyDecided = true;
      return { sql: r.sql(alias, firstParam), params: r.sqlParams() };
    },
    admitNewCompany(companyKey: string | null, companyId: string | null) {
      const r = reach();
      companyDecided = true;
      if (!r.admitsNewCompany(companyKey)) {
        fail("OPERATING_COMPANY_NOT_GOVERNED", "PRECONDITION_FAILED", `operating company '${companyId ?? ""}' is not governed in this tenant`);
      }
    },
    global: channelsByCapability.size === 0,
    admitChannel(channel: string | null | undefined) {
      channelDecided = true;
      for (const [capability, channels] of channelsByCapability) {
        if (typeof channel !== "string" || channel === "" || !channels.includes(channel)) {
          fail("OUTSIDE_SALES_CHANNEL_SCOPE", "FORBIDDEN", `${capability} is held only for sales channel(s) ${channels.join(", ")}; this record's channel is ${channel ?? "unset"}`);
        }
      }
    },
  });
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
    const prior = await client.query<{ result: R; target_family: string | null; target_id: string | null }>(
      `SELECT result, target_family, target_id FROM eos_commercial.command_receipts
        WHERE tenant_id = $1 AND principal_id = $2 AND operation = $3 AND idempotency_key_hash = $4`,
      [actor.tenantId, actor.principalId, operation, keyHash],
    );
    if (prior.rows.length === 1) {
      const receipt = prior.rows[0];
      if (replayTarget && (receipt.target_family !== replayTarget.family || receipt.target_id !== replayTarget.id)) {
        fail("IDEMPOTENCY_KEY_REUSED", "CONFLICT", "this idempotency key was already used for a different record; use a new key for a new action");
      }
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
    // Q-1a: capability (above) -> COMPANY AUTHORITY -> channel / ownership reach (the body). Resolved once, in this transaction.
    company = await (deps.companyReach ?? resolveCommercialCompanyReach)(client, actor.tenantId, actor.principalId);
    const outcome = await body(client, now, scope);
    if (!companyDecided) {
      fail("COMPANY_AUTHORITY_NOT_ESTABLISHED", "FORBIDDEN", "this command did not establish operating-company authority for the record it acts on");
    }
    if (!scope.global && !channelDecided) {
      fail("OUTSIDE_SALES_CHANNEL_SCOPE", "FORBIDDEN", "this command did not establish the record's sales channel for a channel-scoped caller");
    }
    await recordCommandAudit(client, actor.tenantId, actor.principalId, outcome.audit);
    await client.query(
      `INSERT INTO eos_commercial.command_receipts
         (id, tenant_id, principal_id, operation, idempotency_key_hash, target_family, target_id, result)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [`rcpt_${randomUUID()}`, actor.tenantId, actor.principalId, operation, keyHash,
        outcome.target?.family ?? null, outcome.target?.id ?? null, JSON.stringify(wellFormed(outcome.result))],
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

/**
 * A RESERVED capability's effective-authorization check (Owner G7, DECISIONS #226): refuse unless the actor holds one of
 * its reserved Roles through a qualifying global assignment. An unreserved capability passes. Read in the command's
 * transaction, after the capability gate.
 */
export async function requireReservedHolder(db: Queryable, tenantId: string, principalId: string, capabilityKey: string): Promise<void> {
  const reserved = RESERVED_CAPABILITY_HOLDERS.get(capabilityKey);
  if (!reserved) return;
  if ((await qualifyingGlobalRoles(db, tenantId, principalId, reserved.roleKeys)).length === 0) {
    fail("RESERVED_CAPABILITY", "FORBIDDEN", `${capabilityKey} is exercised only through the ${reserved.roleKeys.join(" or ")} Role (${reserved.ruling})`);
  }
}

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

/**
 * SAL-03(c) (P0, Owner security ruling 2026-10-21): OWNER ELIGIBILITY ON A COMPANY-LESS RECORD. A company-less Opportunity or Sales Agreement is visible to its owner
 * (Q-1a), so naming an owner is granting reach. On CREATION or REASSIGNMENT of such a record the owner must be exactly one of:
 *   1. the CREATOR's own linked Employee -- the authenticated actor at creation, the record's STORED creator (created_by) at reassignment; never client input; or
 *   2. the Account's governed owner (an Agreement: its Opportunity's Account), when that Employee's home company lies inside the creator's company authority.
 * Anything else, including an account owner of a company the creator does not reach, is refused with the words of an owner that does not exist
 * (OWNER_NOT_FOUND), or -- when the owner was only INHERITED -- the words of an Account with nothing to inherit (OWNER_REQUIRED), so the refusal never says that
 * a foreign Employee exists. Run it AFTER requireTenantEmployee, and only for a company-less record; a company-keyed record keeps today's behaviour (Q-1a
 * decides it by company alone). A historical owner is never re-judged: callers invoke this only for a NEW owner value. Not in resolveCreationOwner, which is pure
 * and shared with the Firebase path.
 */
export async function requireEligibleCompanylessOwner(
  db: Queryable,
  tenantId: string,
  facts: { readonly recordCreatorPrincipalId: string | null; readonly accountId: string; readonly ownerEmployeeId: string; readonly inherited?: boolean },
  resolver: CommercialCompanyResolver = resolveCommercialCompanyReach,
): Promise<void> {
  const refuse = (): never => facts.inherited === true
    ? fail("OWNER_REQUIRED", "INVALID_INPUT",
      "No owner: none was supplied and the Account has no governed owner to inherit (no upstream owner supplied). "
      + "Ownership is never assigned to the caller, the creator, or an arbitrary employee.")
    : fail("OWNER_NOT_FOUND", "NOT_FOUND", `the owner ${facts.ownerEmployeeId} is not an Employee of this tenant`);
  const creator = facts.recordCreatorPrincipalId;
  if (creator === null || creator.trim() === "") return refuse();
  // 1. The creator's own Employee.
  const own = await db.query<{ employee_id: string }>(
    `SELECT employee_id FROM eos_policy.employee_principal_links WHERE tenant_id = $1 AND principal_id = $2 AND status = 'active'`, [tenantId, creator]);
  if (own.rows.some((r) => String(r.employee_id) === facts.ownerEmployeeId)) return;
  // 2. The Account's governed owner, read here in the transaction (never taken from input).
  const account = await db.query<{ owner_employee_id: string | null }>(
    `SELECT owner_employee_id FROM eos_crm.accounts WHERE tenant_id = $1 AND id = $2`, [tenantId, facts.accountId]);
  if (account.rows.length === 0 || account.rows[0].owner_employee_id !== facts.ownerEmployeeId) return refuse();
  // ... and inheritance never crosses companies: the owner's HOME company must be inside the creator's company authority.
  const reach = await resolver(db, tenantId, creator);
  if (reach.basis === "PROTECTED_ADMINISTRATOR") return; // unrestricted by standing: every company is inside its authority
  const home = await db.query<{ operating_company_key: string }>(
    `SELECT k.operating_company_key FROM eos_workforce.employees e
       JOIN eos_policy.tenant_operating_company_keys k ON k.tenant_id = e.tenant_id AND k.operating_company_id = e.operating_company_id AND k.status = 'ACTIVE'
      WHERE e.tenant_id = $1 AND e.id = $2`, [tenantId, facts.ownerEmployeeId]);
  if (!home.rows.some((r) => reach.companyKeys.includes(String(r.operating_company_key)))) return refuse(); // no home company bound = cannot show same-company: fail closed
}

/** The Account row, read in THIS tenant only. */
/**
 * A customer SITE stated on an Agreement or Sales Order must be one of THAT record's Account's governed sites
 * (eos_crm.account_locations). A National Accounts customer has many sites; a site id is never free text, never another
 * customer's site, and never a site that does not exist -- the read projection would otherwise silently show none.
 * (National Accounts reconciliation, 2026-09-30: the location was stored unvalidated.) null / absent states no site.
 */
export async function requireAccountLocation(db: Queryable, tenantId: string, accountId: string, locationId: unknown): Promise<void> {
  if (locationId === null || locationId === undefined) return;
  if (typeof locationId !== "string" || locationId.trim() === "" || locationId.length > 255) {
    fail("LOCATION_INVALID", "INVALID_INPUT", "locationId, when stated, is a customer site id");
  }
  const { rows } = await db.query(`SELECT 1 FROM eos_crm.account_locations WHERE tenant_id = $1 AND account_id = $2 AND id = $3`,
    [tenantId, accountId, locationId]);
  if (rows.length === 0) fail("LOCATION_NOT_FOR_ACCOUNT", "PRECONDITION_FAILED", "that site is not one of this customer's sites");
}

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

/**
 * NEW COMMERCIAL WORK REQUIRES AN ACTIVE SALES CHANNEL (Controller NATIONAL ACCOUNTS ACTIVATION, 2026-09-30: "Inactive
 * STRATEGIC_ACCOUNTS: not offered and not writable"). The channel a record is CREATED in, or MOVED into, must be one this
 * tenant has made ACTIVE (eos_policy.tenant_sales_channels, set through Administration setTenantSalesChannelStatus) --
 * for EVERY writer: a channel-scoped holder could never be assigned an inactive channel, but a GLOBAL holder's
 * admitChannel admits any channel, so this is the gate that closes it. SALES_CHANNEL_NOT_ACTIVE. Records already in a
 * channel that is later deactivated stay governed history and continue their lifecycle; nothing is rewritten.
 */
export async function requireActiveSalesChannel(db: Queryable, tenantId: string, salesChannel: unknown): Promise<void> {
  const { rows } = await db.query(
    `SELECT 1 FROM eos_policy.tenant_sales_channels WHERE tenant_id = $1 AND sales_channel::text = $2 AND status = 'ACTIVE'`,
    [tenantId, salesChannel],
  );
  if (rows.length === 0) fail("SALES_CHANNEL_NOT_ACTIVE", "PRECONDITION_FAILED", `sales channel ${String(salesChannel)} is not active for this tenant`);
}

/**
 * NEW COMMERCIAL WORK REQUIRES AN ACTIVE CUSTOMER (Controller DQ-5, 2026-09-30). Opening an Opportunity, moving one onto
 * another customer, or booking a direct Sales Order refuses an Account whose CRM status is not ACTIVE (PROSPECT, INACTIVE,
 * ARCHIVED) with ACCOUNT_NOT_ACTIVE. Channel-blind: RETAIL and NATIONAL_ACCOUNTS alike. It governs only the act of
 * starting work -- records already on a customer that later goes inactive stay governed history and continue their
 * lifecycle; nothing is rewritten. Unknown / other-tenant Accounts remain ACCOUNT_NOT_FOUND (non-disclosing).
 */
export async function requireActiveTenantAccount(
  db: Queryable,
  tenantId: string,
  accountId: string,
): Promise<{ id: string; ownerEmployeeId: string | null }> {
  const { rows } = await db.query<{ id: string; owner_employee_id: string | null; status: string }>(
    `SELECT id, owner_employee_id, status::text AS status FROM eos_crm.accounts WHERE tenant_id = $1 AND id = $2`,
    [tenantId, accountId],
  );
  if (rows.length === 0) fail("ACCOUNT_NOT_FOUND", "NOT_FOUND", `no Account ${accountId} in this tenant`);
  if (rows[0].status !== "ACTIVE") fail("ACCOUNT_NOT_ACTIVE", "PRECONDITION_FAILED", "new Commercial work requires an ACTIVE customer");
  return { id: rows[0].id, ownerEmployeeId: rows[0].owner_employee_id };
}
