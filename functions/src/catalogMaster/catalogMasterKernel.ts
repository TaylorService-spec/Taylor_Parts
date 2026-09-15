// The governed PostgreSQL CATALOG MASTER kernel -- what the Part Master and Equipment Model writers share.
//
// ════════════════════ WHAT THIS IS ════════════════════
//
// The target of the catalog cutover (docs/architecture/catalog-cutover-plan.md): the PostgreSQL replacement for
// the Firestore catalog writers functions/src/partMaster/partMasterCommands.ts (createPart / updatePart /
// changePartStatus) and functions/src/equipmentCompatibility/commands.ts (importEquipmentModel). It mirrors the
// governed Commercial command kernel (the C2 layer behind the Commercial transport):
//
//   * the ALREADY-RESOLVED actor a trusted boundary supplies -- tenant, EOS principal, capability keys. No
//     Firebase uid, no role lookup here. Business authority (capability + active tenant membership) IS checked.
//   * ONE transaction per command: membership, the read under FOR UPDATE, the write and its eos_policy.audit_events
//     row commit together or not at all.
//   * deterministic, non-leaking errors: governed refusals keep their code; PostgreSQL integrity failures map to
//     named codes; anything else is COMMAND_FAILED with no SQL, driver message or connection detail.
//
// ════════════════════ WHAT IT IS NOT ════════════════════
//
//   * NOT WIRED. Nothing in functions/src/eosApi composes it (CATALOG_CUTOVER_TAIL). Opening these writers is a
//     separately authorized act that follows population, verification and the Firestore writer freeze.
//   * NOT A SYNC. Nothing here reads or writes Firestore; there is no dual write and no fallback.
//
// IDEMPOTENCY IS CONTENT-ADDRESSED, not key-addressed. The Firestore commands file a replay under an audit document
// derived from the caller's idempotency key. The PostgreSQL target has no catalog receipts table and does not
// borrow eos_commercial.command_receipts (another domain's authority). Instead every command is idempotent by the
// record itself: a create whose row already holds exactly the requested canonical fields replays; an update or
// status change whose row is already at expectedVersion + 1 holding exactly the requested result replays. Anything
// else is a deterministic conflict. A retry therefore never double-applies and never needs a key.
import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";

/**
 * The catalog write capability keys -- the ids functions/src/access/permissionCatalog.ts registers and the
 * Firestore commands check today. Nothing invented (catalogMaster test asserts each against the catalog).
 */
export const CATALOG_CAPABILITIES = Object.freeze({
  /** partMasterCommands.ts CAP_CATALOG_MANAGE: createPart / updatePart. */
  PART_MANAGE: "inventory.catalog.manage",
  /** partMasterCommands.ts CAP_CATALOG_ACTIVATE: changePartStatus. */
  PART_ACTIVATE: "inventory.catalog.activate",
  /** equipmentCompatibility/commands.ts COMMAND_CAPABILITIES.importEquipmentModel. */
  EQUIPMENT_MODEL_MANAGE: "equipment.model.manage",
} as const);

export interface CatalogActorContext {
  readonly tenantId: string;
  /** The EOS principal id (eos_policy.principals.id), never a Firebase uid. */
  readonly principalId: string;
  readonly capabilities: ReadonlySet<string>;
}

export type CatalogErrorCategory = "INVALID_INPUT" | "NOT_FOUND" | "PRECONDITION_FAILED" | "CONFLICT" | "FORBIDDEN" | "UNAVAILABLE" | "FAILED";

export class CatalogMasterError extends Error {
  constructor(readonly code: string, readonly category: CatalogErrorCategory, message: string) {
    super(message);
    this.name = "CatalogMasterError";
  }
}

export function refuse(code: string, category: CatalogErrorCategory, message: string): never {
  throw new CatalogMasterError(code, category, message);
}

export interface CatalogCommandDeps {
  readonly pool: Pool;
  /** Clock seam for tests. Defaults to the server clock. */
  readonly now?: () => Date;
}

const CONSTRAINT_CODES: Readonly<Record<string, [string, CatalogErrorCategory]>> = Object.freeze({
  parts_pkey: ["PART_ALREADY_EXISTS", "CONFLICT"],
  equipment_models_pkey: ["EQUIPMENT_MODEL_ALREADY_EXISTS", "CONFLICT"],
  part_equipment_model_same_tenant: ["EQUIPMENT_MODEL_NOT_FOUND", "NOT_FOUND"],
});

/** Every error leaving a catalog command is a CatalogMasterError. Nothing else crosses the boundary. */
export function translateCatalogError(err: unknown): CatalogMasterError {
  if (err instanceof CatalogMasterError) return err;
  const e = err as { code?: unknown; constraint?: unknown } | null;
  if (e && typeof e.constraint === "string" && CONSTRAINT_CODES[e.constraint]) {
    const [code, category] = CONSTRAINT_CODES[e.constraint];
    return new CatalogMasterError(code, category, `refused by governed integrity rule ${code}`);
  }
  if (e && e.code === "23514") return new CatalogMasterError("RECORD_INVALID", "INVALID_INPUT", "the record violates a governed catalog rule");
  if (e && (e.code === "40001" || e.code === "40P01")) {
    return new CatalogMasterError("CONCURRENT_MODIFICATION", "CONFLICT", "the command collided with a concurrent change; retry it");
  }
  return new CatalogMasterError("COMMAND_FAILED", "FAILED", "the command could not be completed");
}

export interface CatalogAuditEntry {
  readonly action: string;
  readonly targetKind: "part" | "equipment_model";
  readonly targetId: string;
  readonly before: unknown;
  readonly after: unknown;
}

export type CatalogCommandResult<R> = R & { readonly replayed: boolean };

/**
 * Run ONE governed catalog command in ONE PostgreSQL transaction.
 *
 * Order: actor shape -> capability -> connect -> BEGIN -> active principal + active membership -> body -> audit
 * (only when the body applied a change) -> COMMIT. Any failure rolls back every effect.
 */
export async function runCatalogCommand<R extends object>(
  deps: CatalogCommandDeps,
  actor: CatalogActorContext,
  requiredCapability: string,
  body: (client: PoolClient, now: Date) => Promise<{ result: R; replayed: boolean; audit: CatalogAuditEntry | null }>,
): Promise<CatalogCommandResult<R>> {
  if (!actor || typeof actor.tenantId !== "string" || actor.tenantId.trim() === "" || typeof actor.principalId !== "string" || actor.principalId.trim() === "") {
    throw new CatalogMasterError("ACTOR_CONTEXT_REQUIRED", "FORBIDDEN", "a resolved tenant and principal are required");
  }
  if (!(actor.capabilities instanceof Set)) {
    throw new CatalogMasterError("ACTOR_CONTEXT_REQUIRED", "FORBIDDEN", "a resolved capability set is required");
  }
  if (!actor.capabilities.has(requiredCapability)) {
    throw new CatalogMasterError("CAPABILITY_REQUIRED", "FORBIDDEN", `this command requires ${requiredCapability}`);
  }
  const now = (deps.now ?? (() => new Date()))();
  let client: PoolClient | undefined;
  try {
    client = await deps.pool.connect();
    await client.query("BEGIN");
    const member = await client.query(
      `SELECT 1 FROM eos_policy.tenant_memberships m JOIN eos_policy.principals p ON p.id = m.principal_id
        WHERE m.tenant_id = $1 AND m.principal_id = $2 AND m.status = 'active' AND p.status = 'active'`,
      [actor.tenantId, actor.principalId],
    );
    if (member.rows.length === 0) refuse("ACTOR_NOT_TENANT_MEMBER", "FORBIDDEN", "the principal is not an active member of this tenant");
    const outcome = await body(client, now);
    if (outcome.audit !== null) {
      await client.query(
        `INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [`audit_${randomUUID()}`, actor.tenantId, outcome.audit.action, actor.principalId, outcome.audit.targetKind,
          outcome.audit.targetId, outcome.audit.before === null ? null : JSON.stringify(outcome.audit.before),
          JSON.stringify(outcome.audit.after), now],
      );
    }
    await client.query("COMMIT");
    return { ...outcome.result, replayed: outcome.replayed };
  } catch (err) {
    if (client) await client.query("ROLLBACK").catch(() => undefined);
    throw translateCatalogError(err);
  } finally {
    client?.release();
  }
}

/** Plain-object guard for untrusted command input. */
export function requirePlainObject(value: unknown, what: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    refuse("INVALID_INPUT", "INVALID_INPUT", `${what} must be a plain object`);
  }
  return value as Record<string, unknown>;
}

/** A positive integer expectedVersion, or a refusal. */
export function requireExpectedVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) refuse("INVALID_INPUT", "INVALID_INPUT", "expectedVersion must be a positive integer");
  return value as number;
}
