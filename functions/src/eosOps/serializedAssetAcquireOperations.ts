// EOS SERIALIZED ASSET ACQUISITION -- the EXISTING acquire-existing-unit (serializedAsset/acquireSerializedAssetCommand.ts)
// on the EOS operations transport, over the PostgreSQL Catalog and inventory authority (Controller ruling DQ-036(b),
// 2026-09-28). INACTIVE (serializedAsset/acquireWriterState.ts).
//
// ════════════════════ THE SAME COMMAND ════════════════════
//
//   * the same request and refusals (validateEosAcquireRequest mirrors validateAcquireRequest; acquireParity pins
//     them): part, serial, location, a reason from the CLOSED set (nothing meaning "we bought it"), an optional
//     provenance note, an idempotency key;
//   * the same identity (serializedAssetDocId(part, serial)) and replay rule, decided before the part and custody
//     gates: the same unit acquired again with the same intent -> replayed; a unit that arrived by RECEIPT ->
//     ALREADY_EXISTS_CONFLICT (acquisition never overwrites purchasing history); another reason, location, or note
//     under the same key -> ALREADY_EXISTS_CONFLICT;
//   * the unit enters AVAILABLE at an ACTIVE governed WAREHOUSE -- never a customer's location -- with NON_PO_ACQUISITION
//     provenance, and creates no Equipment, no customer relationship and no purchasing history;
//   * one audit record per acquisition.
//
// ════════════════════ THE CAPABILITY ALONE IS NOT ENOUGH ════════════════════
//
//   inventory.serializedAsset.acquire (Administration-grant-only) AND
//   WORK_ELIGIBILITY WAREHOUSE_OPERATIONS + OPERATIONAL_SCOPE WAREHOUSE = the receiving warehouse AND
//   Catalog identity: eos_ops.parts ACTIVE and SERIAL (never the caller's word) AND
//   operating-company compatibility: the warehouse's key resolves to an ACTIVE governed company
//   (operatingCompanyBinding) -- the unit's custody company IS the warehouse's; nothing is inferred AND
//   serialized-asset state: no unit of this part and serial in custody already.
//
// ════════════════════ THE LEDGER FACT ════════════════════
//
// PostgreSQL derives serial on-hand from eos_ops.inventory_movements, and every custody act there checks custody and
// ledger agree (DQ-019). So the acquisition writes, in the same transaction as the custody row, ONE ADJUSTED +1
// SERIAL movement sourced SERIALIZED_ASSET_ACQUISITION -- the opening-balance model quantity stock already uses
// (ADJUSTED from an ADJUSTMENT), applied to a unit. It is not a receipt: no RECEIVED row, no receiving order.
//
// ATOMICITY (DQ-019): validate authority, scope and state -> establish custody and provenance -> record the +1 ledger
// fact -> commit, ONE transaction; any failure rolls all of it back. Acquisitions of the same unit are serialized by
// an advisory lock, so a retry or a concurrent duplicate is replayed or refused -- never a second custody row, a
// second asset or a second increment -- and evidence that is not one whole acquisition fails closed.
//
// PURE PostgreSQL: no Firebase import, no Firestore fallback, no dual write.
import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { authorizeObjectAction, postgresContextualReader } from "./contextualAuthorization.js";
import { warehousePredicates } from "./cycleCountOperations.js";
import { createPostgresPartPolicyAuthority } from "../catalogAuthority/postgresPartPolicyAuthority.js";
import { InventoryScopeError, resolveScopeLocation } from "./inventoryScopeAuthority.js";
import { OperatingCompanyBindingError, resolveActiveOperatingCompanyId } from "./operatingCompanyBinding.js";
import { serializedAssetDocId } from "../serializedAsset/serializedAssetRegistration.js";
import { signedQuantity } from "../inventoryLedger/locationOnHand.js";
import type { PostgresAcquireWriterState } from "../serializedAsset/acquireWriterState.js";

export const EOS_SERIALIZED_ASSET_ACQUIRE_CAPABILITY = "inventory.serializedAsset.acquire";
/** Mirrors ACQUISITION_REASONS. */
export const EOS_ACQUISITION_REASONS = Object.freeze(["OPENING_BALANCE", "LEGACY_MIGRATION", "EXISTING_COMPANY_ASSET"] as const);
export type EosAcquisitionReason = (typeof EOS_ACQUISITION_REASONS)[number];
export const ACQUISITION_MOVEMENT_SOURCE_KIND = "SERIALIZED_ASSET_ACQUISITION";

export type AcquireOperationCategory =
  | "INVALID_INPUT" | "NOT_FOUND" | "PRECONDITION_FAILED" | "CONFLICT" | "FORBIDDEN" | "NOT_ACTIVATED";

export class AcquireOperationError extends Error {
  constructor(readonly code: string, readonly category: AcquireOperationCategory, message: string) {
    super(message);
    this.name = "AcquireOperationError";
  }
}
const refuse = (code: string, category: AcquireOperationCategory, message: string): never => {
  throw new AcquireOperationError(code, category, message);
};

export interface AcquireActor {
  readonly tenantId: string;
  readonly principalId: string;
  readonly capabilities: ReadonlySet<string>;
}
export interface AcquireOperationDeps {
  readonly pool: Pool;
  readonly postgresState: PostgresAcquireWriterState;
}

export interface EosAcquireRequest {
  readonly partId: string;
  readonly serialNo: string;
  readonly locationId: string;
  readonly reason: EosAcquisitionReason;
  readonly idempotencyKey: string;
  readonly provenanceNote: string | null;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const ALLOWED_KEYS = new Set(["partId", "serialNo", "locationId", "reason", "provenanceNote", "idempotencyKey"]);

/** The Firestore validator's decisions and messages, as a value rather than a throw (acquireParity compares them). */
export function validateEosAcquireRequest(input: unknown): { valid: true; value: EosAcquireRequest } | { valid: false; message: string } {
  if (!isPlainObject(input)) return { valid: false, message: "request is not an object" };
  for (const k of Object.keys(input)) if (!ALLOWED_KEYS.has(k)) return { valid: false, message: `unknown field ${k}` };
  const partId = str(input.partId);
  const serialNo = str(input.serialNo);
  const locationId = str(input.locationId);
  const idempotencyKey = str(input.idempotencyKey);
  if (!partId) return { valid: false, message: "partId required" };
  if (!serialNo) return { valid: false, message: "serialNo required" };
  if (!locationId) return { valid: false, message: "locationId required" };
  if (!idempotencyKey) return { valid: false, message: "idempotencyKey required" };
  const reason = input.reason;
  if (typeof reason !== "string" || !(EOS_ACQUISITION_REASONS as readonly string[]).includes(reason)) {
    return { valid: false, message: `reason must be one of ${EOS_ACQUISITION_REASONS.join("/")}` };
  }
  const provenanceNote = input.provenanceNote === undefined ? null : str(input.provenanceNote);
  if (input.provenanceNote !== undefined && provenanceNote === null) {
    return { valid: false, message: "provenanceNote must be a non-empty string when present" };
  }
  return { valid: true, value: { partId, serialNo, locationId, idempotencyKey, reason: reason as EosAcquisitionReason, provenanceNote } };
}

async function inTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function acquireEosSerializedAsset(deps: AcquireOperationDeps, actor: AcquireActor, input: Record<string, unknown>) {
  if (deps.postgresState !== "ACTIVE") {
    refuse("NOT_ACTIVATED", "NOT_ACTIVATED", "EOS serialized asset acquisition is not activated in this environment; units are still acquired on the current system");
  }
  const validated = validateEosAcquireRequest(input);
  if (!validated.valid) return refuse("REQUEST_INVALID", "INVALID_INPUT", validated.message);
  const req = validated.value;
  const serializedAssetId = serializedAssetDocId(req.partId, req.serialNo);

  return inTransaction(deps.pool, async (db) => {
    // ---- 1. AUTHORITY: the capability, then the receiving warehouse's scope ----
    if (!actor.capabilities.has(EOS_SERIALIZED_ASSET_ACQUIRE_CAPABILITY)) {
      refuse("PERMISSION_DENIED", "FORBIDDEN", "actor is not authorized to acquire serialized assets");
    }
    let warehouse;
    try {
      // Acquisition admits exactly one kind of place: a WAREHOUSE (ACQUIRED_LOCATION_TYPE). Never a bin, truck or customer.
      warehouse = await resolveScopeLocation(db, actor.tenantId, { type: "WAREHOUSE", locationId: req.locationId });
    } catch (err) {
      if (err instanceof InventoryScopeError) return refuse("LOCATION_INVALID", "PRECONDITION_FAILED", `${req.locationId} is not an active governed company location`);
      throw err;
    }
    const decision = await authorizeObjectAction(postgresContextualReader(db), {
      actor, capabilityKey: EOS_SERIALIZED_ASSET_ACQUIRE_CAPABILITY, predicates: warehousePredicates(warehouse.scopeWarehouseId),
    });
    if (!decision.allowed) {
      refuse(decision.reason, "FORBIDDEN",
        decision.reason === "OUTSIDE_OPERATIONAL_SCOPE" ? "this warehouse is outside your operational scope"
          : decision.reason === "WORK_ELIGIBILITY_MISSING" ? "acquiring a unit requires the Warehouse Operations work eligibility"
            : decision.reason === "EMPLOYEE_LINK_REQUIRED" ? "only an Employee can acquire a unit" : "not authorized");
    }

    // ---- 2. THE UNIT FIRST: identity -> replay -> gates ----
    //
    // ONE ACQUISITION PER UNIT AT A TIME. A transaction-scoped advisory lock on (tenant, part, serial) serializes
    // every acquisition of the same unit BEFORE anything is read: a concurrent duplicate waits here, then reads the
    // winner's committed custody + provenance + ledger fact and is replayed (same intent) or refused (different
    // intent). Without it both would pass the "nothing exists yet" reads -- a FOR UPDATE on a row that does not exist
    // locks nothing -- and the loser would die on a unique index with a raw database error.
    await db.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [`eos_ops.serializedAssetAcquire:${actor.tenantId}:${req.partId}:${req.serialNo}`]);
    const ledgerIdempotencyKey = `serializedAssetAcquisition:${serializedAssetId}`;
    const { rows: custody } = await db.query<{ status: string; location_type: string; location_id: string }>(
      `SELECT status::text AS status, location_type::text AS location_type, location_id FROM eos_ops.serialized_custody
        WHERE tenant_id = $1 AND part_id = $2 AND serial_number = $3 FOR UPDATE`, [actor.tenantId, req.partId, req.serialNo]);
    const { rows: acquired } = await db.query<{ id: string; reason: string; note: string | null; idempotency_key: string; ledger_movement_id: string }>(
      `SELECT id, reason::text AS reason, note, idempotency_key, ledger_movement_id FROM eos_ops.serialized_asset_acquisitions
        WHERE tenant_id = $1 AND part_id = $2 AND serial_number = $3`, [actor.tenantId, req.partId, req.serialNo]);
    const { rows: ledger } = await db.query<{ id: string; movement_type: string; quantity_delta: number; tracking_mode: string;
        part_id: string; serial_number: string | null; location_id: string; source_kind: string | null; source_id: string | null }>(
      `SELECT id, movement_type::text AS movement_type, quantity_delta, tracking_mode::text AS tracking_mode, part_id, serial_number,
              location_id, source_kind, source_id
         FROM eos_ops.inventory_movements WHERE tenant_id = $1 AND idempotency_key = $2`, [actor.tenantId, ledgerIdempotencyKey]);
    if (custody[0] || acquired[0] || ledger[0]) {
      // Evidence that does not form ONE whole acquisition is never repaired or guessed at here (DQ-019): it fails
      // closed. Provenance without custody, a ledger fact without provenance, or provenance whose ledger fact is
      // missing or is not exactly the +1 ADJUSTED serial movement of THIS unit at THIS warehouse.
      if (acquired[0] && !custody[0]) refuse("ACQUIRE_INTEGRITY", "CONFLICT", "an acquisition is recorded for this unit but it has no custody");
      if (ledger[0] && !acquired[0]) refuse("ACQUIRE_INTEGRITY", "CONFLICT", "an acquisition ledger fact exists for this unit but no acquisition is recorded");
      if (!acquired[0]) {
        refuse("ALREADY_EXISTS_CONFLICT", "CONFLICT", "this unit already exists from a receipt; acquisition must not overwrite purchasing history");
      }
      const a = acquired[0] as { id: string; reason: string; note: string | null; idempotency_key: string; ledger_movement_id: string };
      const c = custody[0] as { status: string; location_type: string; location_id: string };
      const m = ledger[0];
      if (ledger.length !== 1 || !m || m.id !== a.ledger_movement_id || m.movement_type !== "ADJUSTED" || Number(m.quantity_delta) !== 1
          || m.tracking_mode !== "SERIAL" || m.part_id !== req.partId || m.serial_number !== req.serialNo
          || m.source_kind !== ACQUISITION_MOVEMENT_SOURCE_KIND || m.source_id !== a.id) {
        refuse("ACQUIRE_INTEGRITY", "CONFLICT", "this unit's acquisition is not backed by exactly one +1 ADJUSTED serial ledger movement");
      }
      if (a.idempotency_key === req.idempotencyKey && (a.note ?? null) !== req.provenanceNote) {
        refuse("ALREADY_EXISTS_CONFLICT", "CONFLICT", "this request id already acquired this unit with a different note");
      }
      if (a.reason !== req.reason || c.location_type !== "WAREHOUSE" || c.location_id !== req.locationId) {
        refuse("ALREADY_EXISTS_CONFLICT", "CONFLICT", `this unit was already acquired as ${a.reason} at ${c.location_id}`);
      }
      return { outcome: "replayed" as const, serializedAssetId, partId: req.partId, serialNo: req.serialNo, locationId: c.location_id, state: c.status, reason: req.reason };
    }

    // ---- 3. CATALOG IDENTITY: eos_ops.parts, ACTIVE and SERIAL ----
    const [part] = await createPostgresPartPolicyAuthority().readPartPolicies(db, actor.tenantId, [req.partId]);
    if (!part.found) refuse("PART_NOT_FOUND", "NOT_FOUND", `part ${req.partId} not found`);
    if (part.status !== "ACTIVE") refuse("PART_NOT_FOUND", "NOT_FOUND", `part ${req.partId} is not active`);
    if (part.trackingMode !== "SERIAL") {
      refuse("PART_NOT_SERIALIZED", "PRECONDITION_FAILED", `part ${req.partId} is ${part.trackingMode}; only SERIAL parts have individually identified units`);
    }

    // ---- 4. CUSTODY: an ACTIVE governed warehouse of a governed company ----
    if (!warehouse.active) refuse("LOCATION_INVALID", "PRECONDITION_FAILED", `${req.locationId} is not an active governed company location`);
    try {
      await resolveActiveOperatingCompanyId(db as PoolClient, actor.tenantId, warehouse.operatingCompanyKey);
    } catch (err) {
      if (err instanceof OperatingCompanyBindingError) return refuse("COMPANY_NOT_GOVERNED", "PRECONDITION_FAILED", `the warehouse's operating company is not governed: ${err.message}`);
      throw err;
    }

    // ---- 5. CREATE, ALL OR NOTHING: custody -> provenance -> the +1 ledger fact -> audit, in THIS transaction ----
    // Any failure -- a constraint, a trigger, the connection, the COMMIT itself -- rolls every one of them back
    // (inTransaction). A unique violation means another writer (a receipt, which does not take this lock) got the
    // unit first: that is a conflict, never a partial acquisition.
    const acquisitionId = `acq_${randomUUID()}`;
    const movementId = `mov_${randomUUID()}`;
    const uniqueViolation = (err: unknown) => (err as { code?: string }).code === "23505";
    try {
      await db.query(
        `INSERT INTO eos_ops.serialized_custody (id, tenant_id, operating_company_key, part_id, serial_number, status, location_type, location_id, updated_by)
         VALUES ($1, $2, $3, $4, $5, 'AVAILABLE', 'WAREHOUSE', $6, $7)`,
        [`ser_${randomUUID()}`, actor.tenantId, warehouse.operatingCompanyKey, req.partId, req.serialNo, req.locationId, actor.principalId]);
      await db.query(
        `INSERT INTO eos_ops.serialized_asset_acquisitions (id, tenant_id, part_id, serial_number, warehouse_id, operating_company_key,
            reason, note, idempotency_key, ledger_movement_id, acquired_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [acquisitionId, actor.tenantId, req.partId, req.serialNo, req.locationId, warehouse.operatingCompanyKey,
          req.reason, req.provenanceNote, req.idempotencyKey, movementId, actor.principalId]);
      await db.query(
        `INSERT INTO eos_ops.inventory_movements
           (id, tenant_id, operating_company_key, part_id, tracking_mode, location_type, location_id,
            movement_type, quantity_delta, serial_number, source_kind, source_id, idempotency_key, created_by)
         VALUES ($1, $2, $3, $4, 'SERIAL', 'WAREHOUSE', $5, 'ADJUSTED', $6, $7, $8, $9, $10, $11)`,
        [movementId, actor.tenantId, warehouse.operatingCompanyKey, req.partId, req.locationId,
          signedQuantity({ type: "ADJUSTED", quantity: 1 }), req.serialNo, ACQUISITION_MOVEMENT_SOURCE_KIND, acquisitionId,
          ledgerIdempotencyKey, actor.principalId]);
    } catch (err) {
      if (uniqueViolation(err)) refuse("ALREADY_EXISTS_CONFLICT", "CONFLICT", "this unit was brought into custody concurrently");
      throw err;
    }
    await db.query(
      `INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, reason)
       VALUES ($1, $2, 'serializedAsset.acquire', $3, 'serializedAsset', $4, NULL, $5, $6)`,
      [`audit_${randomUUID()}`, actor.tenantId, actor.principalId, serializedAssetId,
        JSON.stringify({ partId: req.partId, serialNo: req.serialNo, locationId: req.locationId, reason: req.reason,
          provenance: "NON_PO_ACQUISITION", acquisitionId, ledgerMovementId: movementId }), req.provenanceNote]);
    return { outcome: "acquired" as const, serializedAssetId, partId: req.partId, serialNo: req.serialNo, locationId: req.locationId, state: "AVAILABLE", reason: req.reason };
  });
}

export const EOS_ACQUIRE_OPERATIONS = Object.freeze({
  acquireSerializedAsset: acquireEosSerializedAsset,
} as const);
export type EosAcquireOperation = keyof typeof EOS_ACQUIRE_OPERATIONS;
