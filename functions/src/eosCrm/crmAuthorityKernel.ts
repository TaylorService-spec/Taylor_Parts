// The governed PostgreSQL CRM KERNEL -- wave D1-A (CRM business authority).
//
// What every governed Account / Contact / customer-site operation shares, and nothing that belongs to one family:
//
//   * the ALREADY-RESOLVED actor context a trusted boundary supplies -- tenant, EOS Principal id and the capability KEYS
//     `resolveOperationalContext` computes from eos_policy.role_capabilities. Structurally the Commercial C2 actor
//     context. Authentication is NOT done here; business authority (capability + active tenant membership) IS.
//   * the EXISTING catalogued Customer capabilities only. Owner ruling (V1): Accounts, Contacts and customer sites all use
//     `customer.record.read|create|update` for their verbs; an Account's paymentTerms / taxStatus additionally keep their
//     DISTINCT `customer.governedField.write` authority. No id is invented.
//   * caller input that can never carry authority: tenant, principal, capabilities, uid, roles, securityRole, jobRole,
//     externalSubject and identityProvider are REFUSED, never ignored; every other key must be on the operation's
//     allowlist.
//   * CREATE IDEMPOTENCY (runCrmCreate): an `eos_crm.command_receipts` row in the create's own transaction, serialized
//     by a transaction-scoped advisory lock on the key identity, replayed with `replayed: true`. Raw keys are never stored.
//   * ONE transaction per command (READ COMMITTED) and ONE `REPEATABLE READ READ ONLY` snapshot per read, each checking
//     active principal + active tenant membership inside it. Timestamps are the database server's `now()`.
//   * deterministic, non-leaking errors in the Commercial C2 shape (code, category, message): governed refusals keep
//     their code, named integrity rules map to named codes, anything else is CRM_COMMAND_FAILED / CRM_READ_FAILED with
//     no SQL, driver message, constraint name or connection detail.
//   * bounded keyset pagination with an opaque cursor that can only reposition inside the caller's authorized ordering.
//
// POSTGRESQL ONLY. No Firebase, no Firestore fallback, no dual write. NOT WIRED: no Render operation, Firebase callable
// or client imports this module or the services built on it.
import type { Pool, PoolClient } from "pg";
import { createHash, randomUUID } from "node:crypto";

/** The catalogued Customer capability KEYS (functions/src/access/permissionCatalog.ts). Nothing else is consulted. */
export const CRM_CAPABILITIES = Object.freeze({
  CUSTOMER_RECORD_READ: "customer.record.read",
  CUSTOMER_RECORD_CREATE: "customer.record.create",
  CUSTOMER_RECORD_UPDATE: "customer.record.update",
  CUSTOMER_GOVERNED_FIELD_WRITE: "customer.governedField.write",
} as const);

/** The resolved governed context a trusted boundary hands an operation. Structurally the C2 CommercialActorContext. */
export interface CrmActorContext {
  readonly tenantId: string;
  /** The EOS Principal id (eos_policy.principals.id), never a Firebase uid. */
  readonly principalId: string;
  /** Capability KEYS held in this tenant, as resolveOperationalContext computes them. */
  readonly capabilities: ReadonlySet<string>;
}

export interface CrmDeps {
  readonly pool: Pool;
}

export type CrmErrorCategory =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "PRECONDITION_FAILED"
  | "CONFLICT"
  | "FORBIDDEN"
  | "UNAVAILABLE"
  | "FAILED";

/** The ONLY error that leaves a governed CRM operation. Same (code, category, message) shape as CommercialCommandError. */
export class CrmAuthorityError extends Error {
  constructor(readonly code: string, readonly category: CrmErrorCategory, message: string) {
    super(message);
    this.name = "CrmAuthorityError";
  }
}

export const fail = (code: string, category: CrmErrorCategory, message: string): never => {
  throw new CrmAuthorityError(code, category, message);
};

export type Queryable = Pick<PoolClient, "query">;

// ════════════════════ error translation ════════════════════

/** Named integrity rules of migration 1758758400000, reported as domain facts rather than as constraint names. */
const CONSTRAINT_CODES: Readonly<Record<string, [string, CrmErrorCategory]>> = Object.freeze({
  contacts_account_same_tenant: ["ACCOUNT_NOT_FOUND", "NOT_FOUND"],
  account_locations_account_same_tenant: ["ACCOUNT_NOT_FOUND", "NOT_FOUND"],
  accounts_name_present: ["NAME_REQUIRED", "INVALID_INPUT"],
  contacts_name_present: ["NAME_REQUIRED", "INVALID_INPUT"],
  account_locations_name_present: ["NAME_REQUIRED", "INVALID_INPUT"],
  accounts_pkey: ["ID_CONFLICT", "CONFLICT"],
  contacts_pkey: ["ID_CONFLICT", "CONFLICT"],
  account_locations_pkey: ["ID_CONFLICT", "CONFLICT"],
  accounts_billing_contact_on_account: ["BILLING_CONTACT_NOT_ON_ACCOUNT", "INVALID_INPUT"],
  account_tags_unique_per_account: ["FIELD_INVALID", "INVALID_INPUT"],
  command_receipts_one_per_key: ["IDEMPOTENCY_CONFLICT", "CONFLICT"],
  command_receipts_member_fk: ["ACTOR_NOT_TENANT_MEMBER", "FORBIDDEN"],
});

/** The pure CRM vocabulary's own refusals (functions/src/crm/customerIdentity.ts), kept as governed input refusals. */
const CRM_VOCABULARY_ERRORS: Readonly<Record<string, string>> = Object.freeze({
  CrmIdentityError: "IDENTITY_INVALID",
  CrmOwnershipError: "OWNER_INVALID",
  CrmLocationNamespaceError: "INVENTORY_LOCATION_DISCRIMINATOR_REFUSED",
});

export function translateCrmError(err: unknown, fallback: "CRM_COMMAND_FAILED" | "CRM_READ_FAILED"): CrmAuthorityError {
  if (err instanceof CrmAuthorityError) return err;
  const e = err as { name?: unknown; code?: unknown; constraint?: unknown; message?: unknown } | null;
  if (e && typeof e.name === "string" && CRM_VOCABULARY_ERRORS[e.name]) {
    return new CrmAuthorityError(CRM_VOCABULARY_ERRORS[e.name], "INVALID_INPUT", String(e.message ?? e.name));
  }
  if (e && typeof e.constraint === "string" && CONSTRAINT_CODES[e.constraint]) {
    const [code, category] = CONSTRAINT_CODES[e.constraint];
    return new CrmAuthorityError(code, category, `refused by governed integrity rule ${code}`);
  }
  if (e && (e.code === "40001" || e.code === "40P01")) {
    return new CrmAuthorityError("CONCURRENT_MODIFICATION", "CONFLICT", "the operation collided with a concurrent change; retry it");
  }
  return fallback === "CRM_COMMAND_FAILED"
    ? new CrmAuthorityError("CRM_COMMAND_FAILED", "FAILED", "the command could not be completed")
    : new CrmAuthorityError("CRM_READ_FAILED", "FAILED", "the read could not be completed");
}

// ════════════════════ actor + caller input ════════════════════

export function requireActor(actor: CrmActorContext, requiredCapability: string): void {
  if (!actor || typeof actor.tenantId !== "string" || actor.tenantId.trim() === "" || typeof actor.principalId !== "string" || actor.principalId.trim() === "") {
    fail("ACTOR_CONTEXT_REQUIRED", "FORBIDDEN", "a resolved tenant and principal are required");
  }
  if (!(actor.capabilities instanceof Set)) {
    fail("ACTOR_CONTEXT_REQUIRED", "FORBIDDEN", "a resolved capability set is required");
  }
  if (!actor.capabilities.has(requiredCapability)) {
    fail("CAPABILITY_REQUIRED", "FORBIDDEN", `this operation requires ${requiredCapability}`);
  }
}

/**
 * Authority is the actor context's, never the payload's. A caller naming any of these is refused outright -- dropping
 * the key silently would let a caller believe it had chosen a tenant, an attribution or a role.
 */
export const CALLER_AUTHORITY_FIELDS = Object.freeze([
  "tenantId", "principalId", "capabilities", "uid", "roles", "securityRole", "jobRole", "externalSubject", "identityProvider",
] as const);

/** The caller's input as a plain object whose keys are all on the operation's allowlist. */
export function requireAllowlistedInput(input: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    fail("INPUT_INVALID", "INVALID_INPUT", "input must be an object");
  }
  const record = input as Record<string, unknown>;
  const keys = Object.keys(record);
  const authority = keys.filter((k) => (CALLER_AUTHORITY_FIELDS as readonly string[]).includes(k));
  if (authority.length > 0) {
    fail("CALLER_AUTHORITY_REFUSED", "FORBIDDEN", `input may not carry authority: ${authority.sort().join(", ")}`);
  }
  const unknown = keys.filter((k) => !allowed.includes(k));
  if (unknown.length > 0) {
    fail("FIELD_NOT_ALLOWED", "INVALID_INPUT", `not an accepted field for this operation: ${unknown.sort().join(", ")}`);
  }
  return record;
}

export function requireRecordId(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(value)) {
    fail("RECORD_ID_REQUIRED", "INVALID_INPUT", `${field} is required and must be 1-200 characters of A-Z a-z 0-9 _ -`);
  }
  return value as string;
}

export const MAX_CRM_TEXT_LENGTH = 2000;

export function requireName(value: unknown, what: string): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > MAX_CRM_TEXT_LENGTH) {
    fail("NAME_REQUIRED", "INVALID_INPUT", `${what} requires a non-empty name of at most ${MAX_CRM_TEXT_LENGTH} characters`);
  }
  return (value as string).trim();
}

/** Absent or null clears; a blank string clears; anything that is not a string refuses. */
export function optionalText(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length > MAX_CRM_TEXT_LENGTH) {
    fail("FIELD_INVALID", "INVALID_INPUT", `${field} must be a string of at most ${MAX_CRM_TEXT_LENGTH} characters, or null`);
  }
  const trimmed = (value as string).trim();
  return trimmed === "" ? null : trimmed;
}

export const DEFAULT_CRM_PAGE_SIZE = 50;
export const MAX_CRM_PAGE_SIZE = 200;

/** Absent takes the default; present but invalid REFUSES -- a caller asking for 9999 is never quietly handed 50. */
export function requirePageSize(value: unknown): number {
  if (value === undefined) return DEFAULT_CRM_PAGE_SIZE;
  if (!Number.isSafeInteger(value) || (value as number) <= 0 || (value as number) > MAX_CRM_PAGE_SIZE) {
    fail("PAGE_SIZE_INVALID", "INVALID_INPUT", `limit must be a positive integer no greater than ${MAX_CRM_PAGE_SIZE}`);
  }
  return value as number;
}

// ════════════════════ keyset cursor over (folded name, id) ════════════════════

export interface CrmCursor {
  readonly name: string;
  readonly id: string;
}
const CURSOR_VERSION = 1;

/** Opaque to callers; NOT secret and NOT signed. It can only reposition inside an already-authorized ordering. */
export function encodeCrmCursor(family: string, cursor: CrmCursor): string {
  return Buffer.from(JSON.stringify({ v: CURSOR_VERSION, f: family, n: cursor.name, id: cursor.id }), "utf8").toString("base64url");
}

/** A structurally invalid cursor refuses; it is never read as "start from the beginning". */
export function decodeCrmCursor(family: string, raw: unknown): CrmCursor | null {
  if (raw === undefined || raw === null) return null;
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
  if (r!.v !== CURSOR_VERSION || r!.f !== family || typeof r!.n !== "string" || typeof r!.id !== "string" || r!.id === "") return invalid();
  return { name: r!.n as string, id: r!.id as string };
}

/** Rows come back limit + 1, each carrying `folded_name`; the extra row is the truthful "there is more". */
export function pageOf<Row extends { id: string; folded_name: string }, Item>(
  family: string,
  rows: readonly Row[],
  limit: number,
  project: (row: Row) => Item,
): { items: Item[]; truncated: boolean; nextCursor: string | null } {
  const truncated = rows.length > limit;
  const kept = rows.slice(0, limit);
  const last = kept[kept.length - 1];
  return {
    items: kept.map(project),
    truncated,
    nextCursor: truncated && last ? encodeCrmCursor(family, { name: last.folded_name, id: last.id }) : null,
  };
}

export const isoOf = (d: Date): string => d.toISOString();

// ════════════════════ the runners ════════════════════

async function requireActiveMembership(client: PoolClient, actor: CrmActorContext): Promise<void> {
  const member = await client.query(
    `SELECT 1 FROM eos_policy.tenant_memberships m JOIN eos_policy.principals p ON p.id = m.principal_id
      WHERE m.tenant_id = $1 AND m.principal_id = $2 AND m.status = 'active' AND p.status = 'active'`,
    [actor.tenantId, actor.principalId],
  );
  if (member.rows.length === 0) fail("ACTOR_NOT_TENANT_MEMBER", "FORBIDDEN", "the principal is not an active member of this tenant");
}

/**
 * Run ONE governed CRM command in ONE PostgreSQL transaction.
 *
 * Order: actor + capability -> caller input validation (`prepare`) -> connect -> BEGIN -> active principal + active
 * membership -> the body -> COMMIT. Refusals before `connect` touch no database; any later failure rolls back every
 * effect.
 */
export async function runCrmCommand<P, R>(
  deps: CrmDeps,
  actor: CrmActorContext,
  requiredCapability: string,
  prepare: () => P,
  body: (client: PoolClient, actor: CrmActorContext, prepared: P) => Promise<R>,
): Promise<R> {
  let client: PoolClient | undefined;
  try {
    requireActor(actor, requiredCapability);
    const prepared = prepare();
    client = await deps.pool.connect();
    await client.query("BEGIN");
    await requireActiveMembership(client, actor);
    const result = await body(client, actor, prepared);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    if (client) await client.query("ROLLBACK").catch(() => undefined);
    throw translateCrmError(err, "CRM_COMMAND_FAILED");
  } finally {
    client?.release();
  }
}

// ════════════════════ create idempotency ════════════════════

export type CrmCreateOperation = "crm.createAccount" | "crm.createContact" | "crm.createAccountLocation";
export type CrmTargetType = "ACCOUNT" | "CONTACT" | "ACCOUNT_LOCATION";
export type CrmReplayable<R> = R & { readonly replayed: boolean };

const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

/** Deterministic JSON: object keys sorted at every depth, so the same request always hashes the same. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.keys(value as Record<string, unknown>).sort()
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export const MAX_IDEMPOTENCY_KEY_LENGTH = 200;

/** A create's idempotency key: required, a non-blank string of bounded length. Only its SHA-256 is ever persisted. */
export function requireIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    fail("IDEMPOTENCY_KEY_REQUIRED", "INVALID_INPUT", `idempotencyKey is required: a non-blank string of at most ${MAX_IDEMPOTENCY_KEY_LENGTH} characters`);
  }
  return value as string;
}

/**
 * Run ONE governed CRM CREATE, idempotently, in ONE PostgreSQL transaction.
 *
 * Order: actor + capability -> `prepare` (which must validate the key and return the caller's request without it) ->
 * connect -> BEGIN -> active principal + membership -> advisory lock on (tenant, principal, operation, key hash) ->
 * committed receipt? replay it (or refuse a different request under the same key) -> the body -> the receipt -> COMMIT.
 *
 * SCOPE. A key belongs to one (tenant, principal, operation): the same key used by another principal, in another tenant
 * or for another create operation is a DIFFERENT key. Reusing a key for the same operation with a different request
 * (compared by SHA-256 of the canonical request) refuses with IDEMPOTENCY_KEY_REUSED and changes nothing. A replay
 * returns the result recorded at creation, not the record's current state. Any failure rolls the receipt back with the
 * create, so the key stays free for a genuine retry.
 */
export async function runCrmCreate<P extends { idempotencyKey: string; request: unknown }, R extends object>(
  deps: CrmDeps,
  actor: CrmActorContext,
  requiredCapability: string,
  operation: CrmCreateOperation,
  prepare: () => P,
  body: (client: PoolClient, actor: CrmActorContext, prepared: P) => Promise<{ result: R; targetType: CrmTargetType; targetId: string }>,
): Promise<CrmReplayable<R>> {
  let client: PoolClient | undefined;
  try {
    requireActor(actor, requiredCapability);
    const prepared = prepare();
    const keyHash = sha256(prepared.idempotencyKey);
    const requestHash = sha256(canonicalJson(prepared.request));
    client = await deps.pool.connect();
    await client.query("BEGIN");
    await requireActiveMembership(client, actor);
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
      `crm-create|${actor.tenantId}|${actor.principalId}|${operation}|${keyHash}`,
    ]);
    const prior = await client.query<{ request_hash: string; result: R }>(
      `SELECT request_hash, result FROM eos_crm.command_receipts
        WHERE tenant_id = $1 AND principal_id = $2 AND operation = $3 AND idempotency_key_hash = $4`,
      [actor.tenantId, actor.principalId, operation, keyHash],
    );
    if (prior.rows.length === 1) {
      if (prior.rows[0].request_hash !== requestHash) {
        fail("IDEMPOTENCY_KEY_REUSED", "CONFLICT", "this idempotency key was already used for a different request");
      }
      await client.query("COMMIT");
      return { ...prior.rows[0].result, replayed: true };
    }
    const outcome = await body(client, actor, prepared);
    await client.query(
      `INSERT INTO eos_crm.command_receipts
         (id, tenant_id, principal_id, operation, idempotency_key_hash, request_hash, target_type, target_id, result)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [`crcpt_${randomUUID()}`, actor.tenantId, actor.principalId, operation, keyHash, requestHash,
        outcome.targetType, outcome.targetId, JSON.stringify(outcome.result)],
    );
    await client.query("COMMIT");
    return { ...outcome.result, replayed: false };
  } catch (err) {
    if (client) await client.query("ROLLBACK").catch(() => undefined);
    throw translateCrmError(err, "CRM_COMMAND_FAILED");
  } finally {
    client?.release();
  }
}

/** Split a create input into its idempotency key and the request it names. */
export function splitIdempotentInput(i: Record<string, unknown>): { idempotencyKey: string; request: Record<string, unknown> } {
  const { idempotencyKey, ...request } = i;
  return { idempotencyKey: requireIdempotencyKey(idempotencyKey), request };
}

/** Run ONE governed CRM read in ONE read-only snapshot. PostgreSQL itself refuses any write attempted inside it. */
export async function runCrmRead<P, R>(
  deps: CrmDeps,
  actor: CrmActorContext,
  requiredCapability: string,
  prepare: () => P,
  body: (client: PoolClient, tenantId: string, prepared: P) => Promise<R>,
): Promise<R> {
  let client: PoolClient | undefined;
  try {
    requireActor(actor, requiredCapability);
    const prepared = prepare();
    client = await deps.pool.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await requireActiveMembership(client, actor);
    const result = await body(client, actor.tenantId, prepared);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    if (client) await client.query("ROLLBACK").catch(() => undefined);
    throw translateCrmError(err, "CRM_READ_FAILED");
  } finally {
    client?.release();
  }
}

/**
 * The parent Account, in THIS tenant only. A cross-tenant Account reads as absent, never as "exists elsewhere".
 * `SHARE` holds the row for the rest of the transaction, so an owner inherited from it cannot be handed off between the
 * read and the child INSERT that records it.
 */
export async function requireTenantAccount(
  db: Queryable,
  tenantId: string,
  accountId: string,
  lock: "NONE" | "SHARE" = "NONE",
): Promise<{ id: string; ownerEmployeeId: string | null }> {
  const { rows } = await db.query<{ id: string; owner_employee_id: string | null }>(
    `SELECT id, owner_employee_id FROM eos_crm.accounts WHERE tenant_id = $1 AND id = $2${lock === "SHARE" ? " FOR SHARE" : ""}`,
    [tenantId, accountId],
  );
  if (rows.length === 0) fail("ACCOUNT_NOT_FOUND", "NOT_FOUND", "the Account does not exist in this tenant");
  return { id: rows[0].id, ownerEmployeeId: rows[0].owner_employee_id };
}

/**
 * Build `SET col = $n, ...` from a FIXED field->column map. Column names only ever come from the map; caller keys that
 * are not in it were already refused by `requireAllowlistedInput`.
 */
export function assignmentsOf(
  changes: ReadonlyMap<string, unknown>,
  columns: Readonly<Record<string, string>>,
  firstParam: number,
): { sql: string; values: unknown[] } {
  const parts: string[] = [];
  const values: unknown[] = [];
  for (const [field, value] of changes) {
    const column = columns[field];
    if (!column) fail("FIELD_NOT_ALLOWED", "INVALID_INPUT", `not an accepted field for this operation: ${field}`);
    values.push(value);
    parts.push(`${column} = $${firstParam + values.length - 1}`);
  }
  return { sql: parts.join(", "), values };
}
