// The governed PostgreSQL MANUFACTURER writer -- the cutover target for the Firestore
// partMaster/partMasterCommands.ts createManufacturer / updateManufacturer / changeManufacturerStatus
// (partMasterRepository.ts buildFirestoreManufacturerRepository stageCreate / stageUpdate), exported as the
// createManufacturer / updateManufacturer / changeManufacturerStatus callables in partMaster/manufacturerCallables.ts.
//
// Its table is eos_ops.manufacturers (migration 1761782400000); nothing else writes it.
//
// ════════════════════ THE AUTHORIZATION, PROVEN NOT ASSUMED ════════════════════
//
// partMasterCommands.ts is explicit and this writer copies it exactly:
//
//   createManufacturer         requireCapabilityOrAudit(..., CAP_CATALOG_MANAGE, ...)    inventory.catalog.manage
//   updateManufacturer         requireCapabilityOrAudit(..., CAP_CATALOG_MANAGE, ...)    inventory.catalog.manage
//   changeManufacturerStatus   requireCapabilityOrAudit(..., CAP_CATALOG_ACTIVATE, ...)  inventory.catalog.activate
//
// It is NOT one capability. A caller who may correct a name is not thereby a caller who may deactivate a
// manufacturer every Part and Equipment Model in the tenant points at, and collapsing the two here would widen
// the deactivate authority to everyone holding the edit one. No new capability is invented: migration
// 1761782400000 registered `inventory.manufacturer.read` and deliberately registered no manufacturer WRITE
// capability, because the measured CRED evidence for Manufacturer is READ only.
//
// ════════════════════ THE CONCURRENCY TOKEN IS `updatedAt`, NOT A VERSION ════════════════════
//
// eos_ops.manufacturers has NO version column -- unlike eos_ops.parts and eos_ops.equipment_models, which both
// do. Adding one is a migration, and a migration is not this change's to write. So the optimistic-concurrency
// token is the column the table actually has: `updated_at`, rendered at PostgreSQL's own microsecond precision
// (catalogRows.ts TS()), server-authored, and made STRICTLY INCREASING by the UPDATE below. The legacy guard is
// preserved in behaviour -- a write from a stale read is refused with VERSION_CONFLICT, exactly as the Firestore
// command refuses a stale expectedVersion -- with the token this schema can actually carry.
//
// This breaks no existing contract: the merged PostgreSQL read seam (eosOps/manufacturerAuthority.ts) returns
// {id, name, status, provenance} and has never handed any caller a version.
//
// ════════════════════ DELIBERATE DIFFERENCES FROM THE FIRESTORE COMMAND ════════════════════
//
//   * Idempotency is CONTENT-ADDRESSED (catalogMasterKernel.ts header), not keyed. There is no idempotencyKey
//     input, because the PostgreSQL target has no catalog receipts table and borrowing another domain's is not
//     an option. A create whose row already says exactly this replays; an update or status change already
//     applied replays; anything else is a deterministic conflict.
//   * `normalizedName` is DERIVED and never accepted from a caller. The Firestore record carries it as stored
//     data; here it is recomputed from the name every write, through the ONE statement of that derivation
//     (manufacturerMigration.ts#normalizeName), so the two columns cannot disagree.
//   * `provenance` is NATIVE and is not a caller input. A live command only ever writes NATIVE; MIGRATED belongs
//     to the one-time copy.
//   * NO DELETE. A manufacturer is deactivated, never removed -- equipment that names one must not lose its
//     reference. There is no delete function here and no DELETE capability anywhere in the catalog.
//
// NOT WIRED. Nothing composes this into the Render API; CATALOG_WRITER_AUTHORITY.postgres is INACTIVE and
// activating these writers is a separate authorized step that changes that constant in the same commit.
import type { PoolClient } from "pg";
import {
  CATALOG_CAPABILITIES,
  type CatalogActorContext,
  type CatalogCommandDeps,
  type CatalogCommandResult,
  refuse,
  requirePlainObject,
  runCatalogCommand,
} from "./catalogMasterKernel";
import {
  type CanonicalManufacturer,
  differingFields,
  INSERT_MANUFACTURER_SQL,
  insertManufacturerValues,
  isoMicros,
  MANUFACTURER_MASTER_FIELDS,
  MANUFACTURER_SELECT,
  manufacturerFromRow,
} from "./catalogRows";
import { parseManufacturerId } from "../partMaster/validation";
import { MANUFACTURER_STATUSES, type ManufacturerStatus } from "../partMaster/types";
// The source's own normalization, stated once and reused -- never restated here.
import { normalizeName } from "../eosOps/migration/manufacturerMigration";

/** A live command writes NATIVE. MIGRATED is the one-time copy's, and is never minted here. */
export const NATIVE_MANUFACTURER_PROVENANCE = "NATIVE";

/** partMasterCommands.ts createManufacturer: a new manufacturer is ACTIVE, and the status is not an input. */
export const MANUFACTURER_INITIAL_STATUS: ManufacturerStatus = "ACTIVE";

/**
 * partMasterCommands.ts's own name rule, restated exactly: a non-empty string once trimmed, and at most 200
 * characters BEFORE trimming (`input.name.length > 200`, not the trimmed length). The bound is on what the
 * caller sent, which is the check the Firestore command makes.
 */
const MAX_NAME_LENGTH = 200;

/** The caller-writable fields of a create. Everything else about the row is repository authority. */
const CREATE_FIELDS: ReadonlySet<string> = new Set(["manufacturerId", "name"]);

export interface ManufacturerWriteResult {
  readonly manufacturerId: string;
  /** The optimistic-concurrency token to send back on the next update. Microsecond ISO-8601 UTC. */
  readonly updatedAt: string;
}

function requireManufacturerId(value: unknown): string {
  const parsed = parseManufacturerId(value);
  if (!parsed.valid) refuse("INVALID_INPUT", "INVALID_INPUT", "manufacturerId must be a valid manufacturer id");
  return parsed.value as string;
}

function requireName(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > MAX_NAME_LENGTH) {
    refuse("INVALID_INPUT", "INVALID_INPUT", `name is required and must be at most ${MAX_NAME_LENGTH} characters`);
  }
  return (value as string).trim();
}

/**
 * The token a caller must echo back. A non-empty string is all this layer can assert about it: whether it is THE
 * token is decided against the stored row, under the lock, and never by its shape.
 */
function requireExpectedUpdatedAt(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    refuse("INVALID_INPUT", "INVALID_INPUT", "expectedUpdatedAt must be the updatedAt token the record was read at");
  }
  return value as string;
}

async function lockManufacturer(
  client: Pick<PoolClient, "query">, tenantId: string, id: string,
): Promise<CanonicalManufacturer | null> {
  const { rows } = await client.query(`${MANUFACTURER_SELECT} WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, id]);
  return rows.length === 0 ? null : manufacturerFromRow(rows[0]);
}

/**
 * Write the changed columns and return the row's NEW token.
 *
 * `updated_at` is GREATEST(now, stored + 1µs) so the token is strictly increasing even if two commands land
 * inside the same microsecond -- a token that could repeat is not a concurrency token. The WHERE clause carries
 * the expected token too, so a row that moved between the lock and the write updates nothing and is refused.
 */
async function applyManufacturerUpdate(
  client: Pick<PoolClient, "query">,
  tenantId: string,
  stored: CanonicalManufacturer,
  changes: { readonly name?: string; readonly normalizedName?: string; readonly status?: string },
  actorPrincipalId: string,
  now: Date,
): Promise<string> {
  const { rows } = await client.query(
    `UPDATE eos_ops.manufacturers
        SET name            = COALESCE($4, name),
            normalized_name = COALESCE($5, normalized_name),
            status          = COALESCE($6, status),
            updated_by      = $7,
            updated_at      = GREATEST($8::timestamptz, updated_at + interval '1 microsecond')
      WHERE tenant_id = $1 AND id = $2
        AND to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') = $3
  RETURNING to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at`,
    [tenantId, stored.id, stored.updatedAt, changes.name ?? null, changes.normalizedName ?? null,
      changes.status ?? null, actorPrincipalId, isoMicros(now)],
  );
  if (rows.length !== 1) {
    refuse("CONCURRENT_MODIFICATION", "CONFLICT", "the record changed while the command was running; retry it");
  }
  return String(rows[0].updated_at);
}

/**
 * Create one manufacturer at the id the caller names -- ACTIVE, NATIVE, version-free.
 *
 * Replays when the row already says exactly this; refuses when a row at that id says something else. The id is
 * the caller's, not minted here, because the Firestore command takes one and a copy must carry source ids across
 * unchanged.
 */
export async function createManufacturer(
  deps: CatalogCommandDeps,
  actor: CatalogActorContext,
  input: { manufacturer: unknown },
): Promise<CatalogCommandResult<ManufacturerWriteResult>> {
  return runCatalogCommand(deps, actor, CATALOG_CAPABILITIES.MANUFACTURER_MANAGE, async (client, now) => {
    const raw = requirePlainObject(requirePlainObject(input, "input").manufacturer, "manufacturer");
    for (const k of Object.keys(raw)) {
      if (!CREATE_FIELDS.has(k)) refuse("FIELD_NOT_WRITABLE", "INVALID_INPUT", `field "${k}" is not writable`);
    }
    const id = requireManufacturerId(raw.manufacturerId);
    const name = requireName(raw.name);
    const fields = {
      id, name, normalizedName: normalizeName(name),
      status: MANUFACTURER_INITIAL_STATUS as string, provenance: NATIVE_MANUFACTURER_PROVENANCE,
    };

    const existing = await lockManufacturer(client, actor.tenantId, id);
    if (existing !== null) {
      if (differingFields(MANUFACTURER_MASTER_FIELDS, existing, { ...existing, ...fields }).length === 0) {
        return { result: { manufacturerId: existing.id, updatedAt: existing.updatedAt }, replayed: true, audit: null };
      }
      refuse("MANUFACTURER_ALREADY_EXISTS", "CONFLICT", `manufacturer ${id} already exists`);
    }
    const at = isoMicros(now);
    const record: CanonicalManufacturer = { ...fields, createdAt: at, updatedAt: at };
    await client.query(INSERT_MANUFACTURER_SQL, insertManufacturerValues(actor.tenantId, record, actor.principalId, actor.principalId));
    return {
      result: { manufacturerId: id, updatedAt: at }, replayed: false,
      audit: { action: "catalog.manufacturer.create", targetKind: "manufacturer", targetId: id, before: null, after: record },
    };
  });
}

/**
 * Correct a manufacturer's NAME. Identity, status and provenance are not updatable here -- exactly the Firestore
 * command's surface, which takes a name and nothing else.
 */
export async function updateManufacturer(
  deps: CatalogCommandDeps,
  actor: CatalogActorContext,
  input: { manufacturerId: unknown; expectedUpdatedAt: unknown; name: unknown },
): Promise<CatalogCommandResult<ManufacturerWriteResult>> {
  return runCatalogCommand(deps, actor, CATALOG_CAPABILITIES.MANUFACTURER_MANAGE, async (client, now) => {
    const envelope = requirePlainObject(input, "input");
    const id = requireManufacturerId(envelope.manufacturerId);
    const expectedUpdatedAt = requireExpectedUpdatedAt(envelope.expectedUpdatedAt);
    const name = requireName(envelope.name);
    const normalizedName = normalizeName(name);

    const stored = await lockManufacturer(client, actor.tenantId, id);
    if (stored === null) refuse("MANUFACTURER_NOT_FOUND", "NOT_FOUND", `no manufacturer ${id} in this tenant`);
    const current = stored;
    const already = current.name === name && current.normalizedName === normalizedName;

    // THE REPLAY, decided the same way the sibling writers decide theirs: the record has MOVED PAST the token the
    // caller holds and already says exactly what was asked for. A first attempt that committed and lost its reply
    // is therefore not re-applied, and never double-counted.
    if (already && current.updatedAt > expectedUpdatedAt) {
      return { result: { manufacturerId: id, updatedAt: current.updatedAt }, replayed: true, audit: null };
    }
    if (current.updatedAt !== expectedUpdatedAt) {
      refuse("VERSION_CONFLICT", "CONFLICT", "the record changed since it was loaded; reload and retry");
    }
    if (already) refuse("NO_CHANGES", "PRECONDITION_FAILED", "the requested name is already the stored name");

    const updatedAt = await applyManufacturerUpdate(client, actor.tenantId, current, { name, normalizedName }, actor.principalId, now);
    const after: CanonicalManufacturer = { ...current, name, normalizedName, updatedAt };
    return {
      result: { manufacturerId: id, updatedAt }, replayed: false,
      audit: { action: "catalog.manufacturer.update", targetKind: "manufacturer", targetId: id, before: current, after },
    };
  });
}

/**
 * ACTIVE <-> INACTIVE, under `inventory.catalog.activate`.
 *
 * The Firestore command's transition rule is the whole of it: the two statuses are the only ones, and changing to
 * the status the record already has is a REFUSAL there (InvalidStatusTransitionError, "manufacturer already X"),
 * not a no-op. That refusal is preserved -- but only for a caller whose token is current. A caller replaying its
 * own committed change holds a stale token and gets the replay, which is the honest answer to a retry.
 */
export async function changeManufacturerStatus(
  deps: CatalogCommandDeps,
  actor: CatalogActorContext,
  input: { manufacturerId: unknown; expectedUpdatedAt: unknown; newStatus: unknown },
): Promise<CatalogCommandResult<ManufacturerWriteResult>> {
  return runCatalogCommand(deps, actor, CATALOG_CAPABILITIES.MANUFACTURER_ACTIVATE, async (client, now) => {
    const envelope = requirePlainObject(input, "input");
    const id = requireManufacturerId(envelope.manufacturerId);
    const expectedUpdatedAt = requireExpectedUpdatedAt(envelope.expectedUpdatedAt);
    if (typeof envelope.newStatus !== "string" || !(MANUFACTURER_STATUSES as readonly string[]).includes(envelope.newStatus)) {
      refuse("INVALID_INPUT", "INVALID_INPUT", `newStatus must be one of ${MANUFACTURER_STATUSES.join("/")}`);
    }
    const newStatus = envelope.newStatus as string;

    const stored = await lockManufacturer(client, actor.tenantId, id);
    if (stored === null) refuse("MANUFACTURER_NOT_FOUND", "NOT_FOUND", `no manufacturer ${id} in this tenant`);
    const current = stored;

    if (current.status === newStatus && current.updatedAt > expectedUpdatedAt) {
      return { result: { manufacturerId: id, updatedAt: current.updatedAt }, replayed: true, audit: null };
    }
    if (current.updatedAt !== expectedUpdatedAt) {
      refuse("VERSION_CONFLICT", "CONFLICT", "the record changed since it was loaded; reload and retry");
    }
    if (current.status === newStatus) {
      refuse("INVALID_STATUS_TRANSITION", "PRECONDITION_FAILED", `manufacturer is already ${newStatus}`);
    }

    const updatedAt = await applyManufacturerUpdate(client, actor.tenantId, current, { status: newStatus }, actor.principalId, now);
    const after: CanonicalManufacturer = { ...current, status: newStatus, updatedAt };
    return {
      result: { manufacturerId: id, updatedAt }, replayed: false,
      audit: { action: "catalog.manufacturer.changeStatus", targetKind: "manufacturer", targetId: id, before: current, after },
    };
  });
}
