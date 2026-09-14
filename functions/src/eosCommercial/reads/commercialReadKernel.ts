// The governed PostgreSQL Commercial READ kernel -- wave C3.
//
// What every Commercial read projection shares, and nothing that belongs to one family:
//
//   * the SAME already-resolved actor context the C2 commands take (tenant, EOS principal, capability keys). The tenant
//     is the actor's, never a selector a caller supplies alongside it.
//   * the EXISTING read capabilities -- `opportunity.read`, `salesAgreement.read`, `salesOrder.read` -- registered
//     active:false in the permission catalog. No new id, and a write capability never stands in for a read one.
//   * ONE `REPEATABLE READ READ ONLY` transaction per read: one consistent snapshot across the row, its lines, its
//     lineage and its display facts, and PostgreSQL itself refuses any write attempted inside it.
//   * active principal + active tenant membership, checked in that transaction exactly as the commands check it.
//   * the C2 error model: governed refusals keep their code; anything else is READ_FAILED with no SQL, driver message
//     or connection detail.
//   * bounded keyset pagination over (business number DESC, id DESC) with an opaque, unsigned cursor that can only
//     reposition inside the caller's already-authorized ordering.
//
// VISIBILITY. Every existing governed Commercial reader (listOpportunityContext, getSalesAgreementContext,
// listSalesOrderIndex, ...) is capability-scoped over the whole tenant: no owner, assignee or territory predicate
// exists anywhere in them. These projections preserve exactly that and invent no narrower or wider scope.
//
// NOT WIRED: no Render operation, Firebase callable or client imports this module or the projections built on it.
import type { Pool, PoolClient } from "pg";
import { CommercialCommandError, fail } from "../commands/commercialCommandKernel";

export type Queryable = Pick<PoolClient, "query">;

/** The Commercial read capability keys -- the ids the permission catalog already registers. */
export const COMMERCIAL_READ_CAPABILITIES = Object.freeze({
  OPPORTUNITY_READ: "opportunity.read",
  SALES_AGREEMENT_READ: "salesAgreement.read",
  SALES_ORDER_READ: "salesOrder.read",
} as const);

/** The resolved governed context a trusted boundary hands a read. Structurally the C2 actor context. */
export interface CommercialReadActor {
  readonly tenantId: string;
  readonly principalId: string;
  readonly capabilities: ReadonlySet<string>;
}

export interface CommercialReadDeps {
  readonly pool: Pool;
}

/** Every error leaving a read is a CommercialCommandError. Nothing else crosses the boundary. */
export function translateCommercialReadError(err: unknown): CommercialCommandError {
  if (err instanceof CommercialCommandError) return err;
  return new CommercialCommandError("READ_FAILED", "FAILED", "the read could not be completed");
}

function requireActor(actor: CommercialReadActor, requiredCapabilities: readonly string[]): void {
  if (!actor || typeof actor.tenantId !== "string" || actor.tenantId.trim() === "" || typeof actor.principalId !== "string" || actor.principalId.trim() === "") {
    fail("ACTOR_CONTEXT_REQUIRED", "FORBIDDEN", "a resolved tenant and principal are required");
  }
  if (!(actor.capabilities instanceof Set)) {
    fail("ACTOR_CONTEXT_REQUIRED", "FORBIDDEN", "a resolved capability set is required");
  }
  const missing = requiredCapabilities.filter((c) => !actor.capabilities.has(c));
  if (missing.length > 0) fail("CAPABILITY_REQUIRED", "FORBIDDEN", `this read requires ${missing.join(", ")}`);
}

/**
 * Run ONE governed Commercial read in ONE read-only snapshot.
 *
 * Order: actor context + capability -> caller input validation (`prepare`) -> connect -> BEGIN READ ONLY -> active
 * principal + active membership -> the read body -> COMMIT. Refusals before `connect` touch no database.
 */
export async function runCommercialRead<P, R>(
  deps: CommercialReadDeps,
  actor: CommercialReadActor,
  requiredCapabilities: readonly string[],
  prepare: () => P,
  body: (client: PoolClient, tenantId: string, prepared: P) => Promise<R>,
): Promise<R> {
  let client: PoolClient | undefined;
  try {
    requireActor(actor, requiredCapabilities);
    const prepared = prepare();
    client = await deps.pool.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const member = await client.query(
      `SELECT 1 FROM eos_policy.tenant_memberships m JOIN eos_policy.principals p ON p.id = m.principal_id
        WHERE m.tenant_id = $1 AND m.principal_id = $2 AND m.status = 'active' AND p.status = 'active'`,
      [actor.tenantId, actor.principalId],
    );
    if (member.rows.length === 0) fail("ACTOR_NOT_TENANT_MEMBER", "FORBIDDEN", "the principal is not an active member of this tenant");
    const result = await body(client, actor.tenantId, prepared);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    if (client) await client.query("ROLLBACK").catch(() => undefined);
    throw translateCommercialReadError(err);
  } finally {
    client?.release();
  }
}

// ════════════════════ caller input ════════════════════

export function requireRecordId(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > 200) {
    fail("RECORD_ID_REQUIRED", "INVALID_INPUT", `${field} is required`);
  }
  return (value as string).trim();
}

export const DEFAULT_COMMERCIAL_PAGE_SIZE = 50;
export const MAX_COMMERCIAL_PAGE_SIZE = 200;

/** Absent takes the default; present but invalid REFUSES -- a caller asking for 9999 is never quietly handed 50. */
export function requirePageSize(value: unknown): number {
  if (value === undefined) return DEFAULT_COMMERCIAL_PAGE_SIZE;
  if (!Number.isSafeInteger(value) || (value as number) <= 0 || (value as number) > MAX_COMMERCIAL_PAGE_SIZE) {
    fail("PAGE_SIZE_INVALID", "INVALID_INPUT", `limit must be a positive integer no greater than ${MAX_COMMERCIAL_PAGE_SIZE}`);
  }
  return value as number;
}

/** An optional EQUALS / IN filter over ONE governed enum. Values are checked against the allowlist, never passed through. */
export function requireEnumFilter(value: unknown, field: string, allowed: readonly string[]): string[] | null {
  if (value === undefined) return null;
  const values = typeof value === "string" ? [value] : value;
  if (!Array.isArray(values) || values.length === 0 || values.length > allowed.length || !values.every((v) => typeof v === "string" && allowed.includes(v))) {
    fail("FILTER_INVALID", "INVALID_INPUT", `${field} must be one of, or a non-empty array of, ${allowed.join(", ")}`);
  }
  return [...new Set(values as string[])];
}

export function optionalAccountId(value: unknown): string | null {
  if (value === undefined) return null;
  return requireRecordId(value, "accountId");
}

// ════════════════════ keyset cursor ════════════════════

export interface CommercialCursor {
  readonly number: string;
  readonly id: string;
}
const CURSOR_VERSION = 1;

/** Opaque to callers; NOT secret and NOT signed. It can only reposition inside an already-authorized ordering. */
export function encodeCommercialCursor(family: string, cursor: CommercialCursor): string {
  return Buffer.from(JSON.stringify({ v: CURSOR_VERSION, f: family, n: cursor.number, id: cursor.id }), "utf8").toString("base64url");
}

/** A structurally invalid cursor refuses; it is never read as "start from the beginning". */
export function decodeCommercialCursor(family: string, raw: unknown): CommercialCursor | null {
  if (raw === undefined) return null;
  const invalid = (): never => fail("CURSOR_INVALID", "INVALID_INPUT", "cursor is not a valid position for this list");
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 1024) return invalid();
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw as string, "base64url").toString("utf8"));
  } catch {
    return invalid();
  }
  const r = parsed as Record<string, unknown> | null;
  if (!r || typeof r !== "object" || Array.isArray(r) || Object.keys(r).sort().join(",") !== "f,id,n,v") return invalid();
  if (r!.v !== CURSOR_VERSION || r!.f !== family || typeof r!.n !== "string" || r!.n === "" || typeof r!.id !== "string" || r!.id === "") {
    return invalid();
  }
  return { number: r!.n as string, id: r!.id as string };
}

/** Rows come back limit + 1; the extra row is the truthful "there is more". */
export function pageOf<Row extends { id: string }, Item>(
  family: string,
  rows: readonly Row[],
  limit: number,
  numberOf: (row: Row) => string,
  project: (row: Row) => Item,
): { items: Item[]; truncated: boolean; nextCursor: string | null } {
  const truncated = rows.length > limit;
  const kept = rows.slice(0, limit);
  const last = kept[kept.length - 1];
  return {
    items: kept.map(project),
    truncated,
    nextCursor: truncated && last ? encodeCommercialCursor(family, { number: numberOf(last), id: last.id }) : null,
  };
}

// ════════════════════ shared display facts ════════════════════

/**
 * An Employee reference as a projection carries it. Owner, Accountable Person and credited salesperson are each one of
 * these, never merged. `resolved` says the id is an Employee of this tenant in PostgreSQL -- whatever their CURRENT
 * status, because a historical reference stays true after someone leaves. `displayName` is null: the PostgreSQL
 * Employee authority (eos_workforce.employees) carries no name field, and no other source is consulted.
 */
export interface CommercialPersonReference {
  readonly employeeId: string;
  readonly displayName: null;
  readonly resolved: boolean;
}

export const personOf = (employeeId: string | null, resolved: boolean | null): CommercialPersonReference | null =>
  employeeId === null ? null : { employeeId, displayName: null, resolved: resolved === true };

export const isoOf = (d: Date | null): string | null => (d === null ? null : d.toISOString());
export const minorOf = (v: string | number | null): number | null => (v === null ? null : Number(v));
