// The governed PostgreSQL Employee READ kernel -- the Employee runtime reads lane (EMP-RT).
//
// The same shape as the Commercial C3 read kernel, deliberately NOT
// imported from it: Workforce is its own domain transport, and the Commercial layer's ratchets pin its read layer to
// the Commercial transport alone. What every Employee read shares:
//
//   * an ALREADY-RESOLVED actor { tenantId, principalId = EOS Principal id, capabilities }. The tenant is the actor's,
//     never a selector a caller supplies.
//   * EXISTING capability ids only. No Employee/Workforce read capability exists in eos_policy.capabilities or in
//     access/permissionCatalog.ts, and none is invented here; see workforceHttp.ts for which reads that blocks.
//   * ONE `REPEATABLE READ READ ONLY` transaction per read, so PostgreSQL itself refuses any write attempted inside it.
//   * active Principal + active tenant membership, checked inside that transaction.
//   * deterministic, non-leaking errors: a governed refusal keeps its code; anything else is READ_FAILED with no SQL,
//     driver message or connection detail.
//   * bounded keyset pagination with an opaque, unsigned cursor that can only reposition inside an authorized ordering.
//
// CREDENTIAL != PRINCIPAL != EMPLOYEE. Nothing here ever receives an external subject or identity provider, so no
// Employee can be matched by one. JOB ROLE has no PostgreSQL authority (EMP-RT-08, not implemented) and no read here
// produces, infers or names one.
import type { Pool, PoolClient } from "pg";
// The PURE decision, deliberately: `conditionalEntitlement` carries no SQL, no pool factory and no
// runtime `pg`, so adopting the conditional seam does not widen this kernel's module boundary.
import { authorizeEntitledAction, hasResolvedEntitlements, type EntitlementSet } from "../../eosOps/conditionalEntitlement";
import { postgresContextualReader } from "../../eosOps/contextualAuthorization";

export type Queryable = Pick<PoolClient, "query">;

export type EmployeeReadErrorCategory = "INVALID_INPUT" | "NOT_FOUND" | "PRECONDITION_FAILED" | "CONFLICT" | "FORBIDDEN" | "FAILED";

/** Every error leaving an Employee read is one of these. Nothing else crosses the boundary. */
export class EmployeeReadError extends Error {
  constructor(readonly code: string, readonly category: EmployeeReadErrorCategory, message: string) {
    super(message);
    this.name = "EmployeeReadError";
  }
}

export function refuse(code: string, category: EmployeeReadErrorCategory, message: string): never {
  throw new EmployeeReadError(code, category, message);
}

export function translateEmployeeReadError(err: unknown): EmployeeReadError {
  if (err instanceof EmployeeReadError) return err;
  return new EmployeeReadError("READ_FAILED", "FAILED", "the read could not be completed");
}

export interface EmployeeReadActor {
  readonly tenantId: string;
  readonly principalId: string;
  readonly capabilities: ReadonlySet<string>;
  /**
   * The SAME grants with the granting Role and its condition kept, from
   * `capabilityAuthority.resolveOperationalContext`. Required, never optional -- see the seam note
   * below `runEmployeeRead`.
   */
  readonly entitlements: EntitlementSet;
}

export interface EmployeeReadDeps {
  readonly pool: Pool;
}

function requireActorContext(actor: EmployeeReadActor): void {
  if (!actor || typeof actor.tenantId !== "string" || actor.tenantId.trim() === "" || typeof actor.principalId !== "string" || actor.principalId.trim() === "") {
    refuse("ACTOR_CONTEXT_REQUIRED", "FORBIDDEN", "a resolved tenant and principal are required");
  }
  if (!(actor.capabilities instanceof Set)) refuse("ACTOR_CONTEXT_REQUIRED", "FORBIDDEN", "a resolved capability set is required");
  if (!hasResolvedEntitlements(actor)) refuse("ACTOR_CONTEXT_REQUIRED", "FORBIDDEN", "a resolved entitlement set is required");
}

/**
 * Run ONE governed Employee read in ONE read-only snapshot.
 *
 * Order: actor context -> caller input validation (`prepare`) -> the capabilities that input requires ->
 * the CONDITION on each of those capabilities, per granting Role -> connect ->
 * BEGIN READ ONLY -> active principal + active membership -> body -> COMMIT. Refusals before `connect` touch no database.
 */
export async function runEmployeeRead<P, R>(
  deps: EmployeeReadDeps,
  actor: EmployeeReadActor,
  prepare: () => P,
  requiredCapabilities: (prepared: P) => readonly string[],
  body: (client: PoolClient, tenantId: string, principalId: string, prepared: P) => Promise<R>,
): Promise<R> {
  let client: PoolClient | undefined;
  try {
    requireActorContext(actor);
    const prepared = prepare();
    const required = requiredCapabilities(prepared);
    const missing = required.filter((c) => !actor.capabilities.has(c));
    if (missing.length > 0) refuse("CAPABILITY_REQUIRED", "FORBIDDEN", `this read requires ${missing.join(", ")}`);
    // THE CONDITIONAL DECISION. With no condition on any entitlement this allows every required key
    // through the unconditional path, consults no context authority and reads nothing.
    const reader = postgresContextualReader(deps.pool);
    for (const capabilityKey of required) {
      const decision = await authorizeEntitledAction(reader, { actor, capabilityKey });
      if (!decision.allowed) {
        refuse("CAPABILITY_CONDITION_UNSATISFIED", "FORBIDDEN",
          `this read requires ${capabilityKey}: ${decision.outcome}`);
      }
    }
    client = await deps.pool.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const member = await client.query(
      `SELECT 1 FROM eos_policy.tenant_memberships m JOIN eos_policy.principals p ON p.id = m.principal_id
        WHERE m.tenant_id = $1 AND m.principal_id = $2 AND m.status = 'active' AND p.status = 'active'`,
      [actor.tenantId, actor.principalId],
    );
    if (member.rows.length === 0) refuse("ACTOR_NOT_TENANT_MEMBER", "FORBIDDEN", "the principal is not an active member of this tenant");
    const result = await body(client, actor.tenantId, actor.principalId, prepared);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    if (client) await client.query("ROLLBACK").catch(() => undefined);
    throw translateEmployeeReadError(err);
  } finally {
    client?.release();
  }
}

// ════════════════════ caller input ════════════════════

type Input = Record<string, unknown> | undefined;

// ==================== THE CONDITIONAL ENTITLEMENT SEAM ====================
//
// `capabilities.has(key)` answers "is this key in the set" and can answer nothing else -- which is
// why a per-GRANT condition was unreachable from any of the thirteen kernel gate sites. The actor
// now also carries `entitlements`, resolved by `capabilityAuthority.resolveOperationalContext` on
// the request path, so a gate site can ask the question that needs the grantor.
//
// THE EXISTING CHECK IS NOT REPLACED. The flat-set check below runs first and is byte-identical to
// what it always was; the entitled decision runs AFTER it and can only ever refuse further. That
// ordering is the guarantee that wiring this in front of a governed read narrows nothing while
// `eos_policy.capability_grant_conditions` holds zero rows -- and it means a bug in the new path can
// only be a false refusal, never a false allow.
//
// AN ACTOR WITHOUT ENTITLEMENTS IS REFUSED, not waved through. A fall-back to the flat set would
// mean any caller that omitted the field escaped every condition.

/** A read accepts exactly its named fields. An unnamed field is refused, never ignored. */
export function acceptOnly(input: Input, allowed: readonly string[]): void {
  if (input === undefined || input === null) return;
  if (typeof input !== "object" || Array.isArray(input)) refuse("INPUT_INVALID", "INVALID_INPUT", "input must be an object");
  const extra = Object.keys(input).filter((k) => !allowed.includes(k));
  if (extra.length > 0) refuse("INPUT_FIELD_NOT_ACCEPTED", "INVALID_INPUT", `this read does not accept: ${extra.sort().join(", ")}`);
}

export function requireEmployeeId(value: unknown): string {
  if (typeof value !== "string" || value === "" || value.trim() !== value || value.length > 200 || value.includes("/")) {
    refuse("EMPLOYEE_ID_REQUIRED", "INVALID_INPUT", "employeeId is required and must be a governed Employee id");
  }
  return value as string;
}

export const DEFAULT_EMPLOYEE_PAGE_SIZE = 50;
export const MAX_EMPLOYEE_PAGE_SIZE = 200;

/** Absent takes the default; present but invalid REFUSES -- a caller asking for 9999 is never quietly handed 50. */
export function requirePageSize(value: unknown): number {
  if (value === undefined) return DEFAULT_EMPLOYEE_PAGE_SIZE;
  if (!Number.isSafeInteger(value) || (value as number) <= 0 || (value as number) > MAX_EMPLOYEE_PAGE_SIZE) {
    refuse("PAGE_SIZE_INVALID", "INVALID_INPUT", `limit must be a positive integer no greater than ${MAX_EMPLOYEE_PAGE_SIZE}`);
  }
  return value as number;
}

// ════════════════════ keyset cursor ════════════════════

export interface EmployeeCursor {
  readonly number: string;
  readonly id: string;
}
const CURSOR_VERSION = 1;

/** Opaque to callers; NOT secret and NOT signed. Bound to one list + family + Employee, so it cannot move between them. */
export function encodeEmployeeCursor(scope: string, cursor: EmployeeCursor): string {
  return Buffer.from(JSON.stringify({ v: CURSOR_VERSION, f: scope, n: cursor.number, id: cursor.id }), "utf8").toString("base64url");
}

/** A structurally invalid cursor refuses; it is never read as "start from the beginning". */
export function decodeEmployeeCursor(scope: string, raw: unknown): EmployeeCursor | null {
  if (raw === undefined) return null;
  const invalid = (): never => refuse("CURSOR_INVALID", "INVALID_INPUT", "cursor is not a valid position for this list");
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 1024) return invalid();
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw as string, "base64url").toString("utf8"));
  } catch {
    return invalid();
  }
  const r = parsed as Record<string, unknown> | null;
  if (!r || typeof r !== "object" || Array.isArray(r) || Object.keys(r).sort().join(",") !== "f,id,n,v") return invalid();
  if (r!.v !== CURSOR_VERSION || r!.f !== scope || typeof r!.n !== "string" || r!.n === "" || typeof r!.id !== "string" || r!.id === "") {
    return invalid();
  }
  return { number: r!.n as string, id: r!.id as string };
}

export const isoOf = (d: Date | null): string | null => (d === null ? null : d.toISOString());
