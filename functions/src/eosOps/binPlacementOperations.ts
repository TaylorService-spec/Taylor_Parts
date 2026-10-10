// EOS BIN PLACEMENT (put-away) -- the EXISTING placement record (inventoryLocation/putAwayCommand.ts) on the EOS
// operations transport, over eos_ops.bin_placements (Controller ruling DQ-038, 2026-09-28; migration 1764126000000).
//
// ════════════════════ WHAT IS PRESERVED, EXACTLY ════════════════════
//
//   * A placement is an append-only EVENT and writes NOTHING ELSE: no ledger row, no quantity, no balance (Decision
//     #116 -- the warehouse is the custody authority; a bin is where it was last put).
//   * The same request (validateEosPutAwayRequest mirrors validatePutAwayRequest; binPlacementParity.test.mjs pins
//     the two to one answer): warehouse + part + key, EXACTLY ONE of binCode / binId, EXACTLY ONE of quantity /
//     serialNumbers, an optional pick and an optional operator note.
//   * The same identity (plc_<key>__<serial|part>) and the same replay rule, decided FIRST: every placement present
//     and identical -> replayed; any present but not all, or any different -> IDEMPOTENCY_CONFLICT.
//   * The same bin resolution: a scanned bin id must be a bin OF THIS warehouse and ACTIVE; a typed code resolves
//     through the warehouse's code claims, a SUPERSEDED code still reaching its bin.
//   * A serial must be a real unit OF THIS part (serialized_custody).
//
// ════════════════════ WHAT EOS ADDS ════════════════════
//
//   * WAREHOUSE SCOPE IS AUTHORITATIVE: inventory.placement.record + WORK_ELIGIBILITY WAREHOUSE_OPERATIONS +
//     OPERATIONAL_SCOPE WAREHOUSE = the stated warehouse, which must be a governed warehouse in the tenant.
//   * The placement -> warehouse relationship is the SERVER's, twice: resolution here, and the table's trigger.
//   * No operating company is read, stored or inferred.
//   * One audit record per recorded stow (eos_policy.audit_events), none for a replay.
//
// The row shape and the replay comparison are exported for the EOS relocation, which writes the SAME placement when
// a relocation also stows into its destination bin (Decision #170).
//
// PURE PostgreSQL: no Firebase import, no Firestore fallback, no dual write.
import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { authorizeObjectAction, postgresContextualReader } from "./contextualAuthorization.js";
import { warehousePredicates } from "./cycleCountOperations.js";
import { InventoryScopeError, resolveScopeLocation } from "./inventoryScopeAuthority.js";
import { isSafeIdSegment, normalizeBinCode } from "../inventoryLocation/binRegistry.js";
import type { PostgresPlacementWriterState } from "../inventoryLocation/placementWriterState.js";
import { INVENTORY_BASELINE_NOT_CERTIFIED_MESSAGE, isInventoryBaselineCertified } from "./inventoryBaselineGate.js";
import { withActorAuthority } from "./administrationReach.js";

type Queryable = Pick<PoolClient, "query">;

export const EOS_PLACEMENT_RECORD_CAPABILITY = "inventory.placement.record";
/** Mirrors MAX_PLACEMENT_NOTE. */
export const EOS_MAX_PLACEMENT_NOTE = 500;

export type PlacementOperationCategory =
  | "INVALID_INPUT" | "NOT_FOUND" | "PRECONDITION_FAILED" | "CONFLICT" | "FORBIDDEN" | "NOT_ACTIVATED";

export class PlacementOperationError extends Error {
  constructor(readonly code: string, readonly category: PlacementOperationCategory, message: string) {
    super(message);
    this.name = "PlacementOperationError";
  }
}
const refuse = (code: string, category: PlacementOperationCategory, message: string): never => {
  throw new PlacementOperationError(code, category, message);
};

export interface PlacementActor {
  readonly tenantId: string;
  readonly principalId: string;
  readonly capabilities: ReadonlySet<string>;
}
export interface PlacementOperationDeps {
  readonly pool: Pool;
  readonly postgresState: PostgresPlacementWriterState;
}

// ════════════════════ request: the Firestore command's rules, verbatim ════════════════════

export interface EosPutAwayRequest {
  readonly warehouseId: string;
  readonly binCode?: string;
  readonly binId?: string;
  readonly partId: string;
  readonly quantity?: number;
  readonly serialNumbers?: readonly string[];
  readonly idempotencyKey: string;
  readonly pickedForWorkOrderId?: string;
  readonly note?: string;
}

const isNonBlank = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/** Shape validation only -- the same reasons, in the same order, as validatePutAwayRequest. */
export function validateEosPutAwayRequest(input: unknown): { valid: true; value: EosPutAwayRequest } | { valid: false; reason: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { valid: false, reason: "not_object" };
  const d = input as Record<string, unknown>;
  if (!isNonBlank(d.warehouseId)) return { valid: false, reason: "warehouse_required" };
  if (!isNonBlank(d.partId)) return { valid: false, reason: "part_required" };
  if (!isNonBlank(d.idempotencyKey)) return { valid: false, reason: "idempotency_key_required" };
  const hasBinId = d.binId !== undefined;
  const hasBinCode = d.binCode !== undefined;
  if (hasBinId === hasBinCode) return { valid: false, reason: "bin_code_or_bin_id_required" };
  let binCode: string | undefined;
  let binId: string | undefined;
  if (hasBinId) {
    if (!isSafeIdSegment(d.binId) || !String(d.binId).startsWith("bin_")) return { valid: false, reason: "bin_id_invalid" };
    binId = d.binId as string;
  } else {
    const normalized = normalizeBinCode(d.binCode);
    if (!normalized.valid) return { valid: false, reason: normalized.reason as string };
    binCode = normalized.value.code;
  }
  let note: string | undefined;
  if (d.note !== undefined && d.note !== null) {
    if (typeof d.note !== "string") return { valid: false, reason: "note_invalid" };
    const trimmed = d.note.trim();
    if (trimmed.length > EOS_MAX_PLACEMENT_NOTE) return { valid: false, reason: "note_too_long" };
    if (trimmed !== "") note = trimmed;
  }
  const hasSerials = d.serialNumbers !== undefined;
  const hasQuantity = d.quantity !== undefined;
  if (hasSerials === hasQuantity) return { valid: false, reason: "quantity_or_serials_required" };
  if (hasSerials) {
    if (!Array.isArray(d.serialNumbers) || d.serialNumbers.length === 0) return { valid: false, reason: "serials_invalid" };
    if (!d.serialNumbers.every(isNonBlank)) return { valid: false, reason: "serials_invalid" };
    const seen = new Set(d.serialNumbers.map((s) => (s as string).trim().toLowerCase()));
    if (seen.size !== d.serialNumbers.length) return { valid: false, reason: "serials_duplicated" };
    return {
      valid: true,
      value: {
        warehouseId: d.warehouseId, partId: d.partId, idempotencyKey: d.idempotencyKey,
        ...(binCode !== undefined ? { binCode } : {}),
        ...(binId !== undefined ? { binId } : {}),
        serialNumbers: (d.serialNumbers as string[]).map((s) => s.trim()),
        ...(isNonBlank(d.pickedForWorkOrderId) ? { pickedForWorkOrderId: d.pickedForWorkOrderId.trim() } : {}),
        ...(note !== undefined ? { note } : {}),
      },
    };
  }
  if (typeof d.quantity !== "number" || !Number.isInteger(d.quantity) || d.quantity <= 0) return { valid: false, reason: "quantity_invalid" };
  return {
    valid: true,
    value: {
      warehouseId: d.warehouseId, partId: d.partId, idempotencyKey: d.idempotencyKey,
      ...(binCode !== undefined ? { binCode } : {}),
      ...(binId !== undefined ? { binId } : {}),
      quantity: d.quantity,
      ...(isNonBlank(d.pickedForWorkOrderId) ? { pickedForWorkOrderId: d.pickedForWorkOrderId.trim() } : {}),
      ...(note !== undefined ? { note } : {}),
    },
  };
}

/** Every field an EOS put-away accepts. */
const EOS_PUT_AWAY_FIELDS: ReadonlySet<string> = new Set(["warehouseId", "binCode", "binId", "partId", "quantity", "serialNumbers", "idempotencyKey", "pickedForWorkOrderId", "note"]);

/** The deterministic placement id -- identical to derivePlacementId. */
export function eosPlacementId(idempotencyKey: string, discriminator: string): string {
  return `plc_${idempotencyKey}__${discriminator}`;
}

export interface PlannedPlacement {
  readonly id: string;
  readonly warehouseId: string;
  readonly binId: string;
  readonly binCode: string;
  readonly partId: string;
  readonly serialNumber: string | null;
  readonly quantity: number;
  readonly idempotencyKey: string;
  readonly pickedForWorkOrderId: string | null;
  readonly note: string | null;
}

/** The placement rows one stow produces -- the buildPlacementEntries shape: one per serial, one for a quantity. */
export function planPlacements(input: Omit<PlannedPlacement, "id" | "serialNumber" | "quantity"> & {
  readonly serialNumbers: readonly string[]; readonly quantity: number;
}): PlannedPlacement[] {
  const base = {
    warehouseId: input.warehouseId, binId: input.binId, binCode: input.binCode, partId: input.partId,
    idempotencyKey: input.idempotencyKey, pickedForWorkOrderId: input.pickedForWorkOrderId, note: input.note,
  };
  return input.serialNumbers.length > 0
    ? input.serialNumbers.map((s) => ({ ...base, id: eosPlacementId(input.idempotencyKey, s), serialNumber: s, quantity: 1 }))
    : [{ ...base, id: eosPlacementId(input.idempotencyKey, input.partId), serialNumber: null, quantity: input.quantity }];
}

export interface StoredPlacement {
  readonly id: string;
  readonly warehouse_id: string;
  readonly bin_id: string;
  readonly bin_code: string;
  readonly part_id: string;
  readonly serial_number: string | null;
  readonly quantity: number;
  readonly idempotency_key: string;
  readonly picked_for_work_order_id: string | null;
  readonly note: string | null;
}

/** The stored placements under these ids, in no particular order. */
export async function readPlacements(db: Queryable, tenantId: string, ids: readonly string[]): Promise<StoredPlacement[]> {
  const { rows } = await db.query<StoredPlacement>(
    `SELECT id, warehouse_id, bin_id, bin_code, part_id, serial_number, quantity, idempotency_key, picked_for_work_order_id, note
       FROM eos_ops.bin_placements WHERE tenant_id = $1 AND id = ANY($2)`, [tenantId, [...ids]]);
  return rows;
}

/** Write planned placements. Every id is new (the caller decided replay/conflict first); a race is a conflict. */
export async function insertPlacements(db: Queryable, tenantId: string, actorId: string, rows: readonly PlannedPlacement[]): Promise<void> {
  for (const p of rows) {
    try {
      await db.query(
        `INSERT INTO eos_ops.bin_placements (id, tenant_id, warehouse_id, bin_id, bin_code, part_id, serial_number, quantity,
            idempotency_key, picked_for_work_order_id, note, placed_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [p.id, tenantId, p.warehouseId, p.binId, p.binCode, p.partId, p.serialNumber, p.quantity, p.idempotencyKey,
          p.pickedForWorkOrderId, p.note, actorId]);
    } catch (err) {
      if ((err as { code?: string }).code === "23505") refuse("IDEMPOTENCY_CONFLICT", "CONFLICT", "a placement with this key was written concurrently");
      throw err;
    }
  }
}

// ════════════════════ the put-away command ════════════════════

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

/** Resolve the stated bin WITHIN the stated warehouse -- the two Firestore input paths, converging on one bin id. */
async function resolveBin(db: Queryable, tenantId: string, req: EosPutAwayRequest): Promise<{ binId: string; binCode: string }> {
  if (req.binId !== undefined) {
    const { rows } = await db.query<{ warehouse_id: string; code: string; status: string }>(
      `SELECT warehouse_id, code, status::text AS status FROM eos_ops.bins WHERE tenant_id = $1 AND id = $2`, [tenantId, req.binId]);
    if (!rows[0]) return refuse("BIN_NOT_FOUND", "NOT_FOUND", "NOT_FOUND");
    // Wrong building is answered before status, as the Firestore resolver does.
    if (rows[0].warehouse_id !== req.warehouseId) return refuse("BIN_WRONG_WAREHOUSE", "PRECONDITION_FAILED", "WRONG_WAREHOUSE");
    if (rows[0].status !== "ACTIVE") return refuse("BIN_INACTIVE", "PRECONDITION_FAILED", "INACTIVE");
    return { binId: req.binId, binCode: rows[0].code };
  }
  const { rows } = await db.query<{ bin_id: string; claim_state: string; bin_warehouse: string; current_code: string; status: string }>(
    `SELECT c.bin_id, c.claim_state::text AS claim_state, b.warehouse_id AS bin_warehouse, b.code AS current_code, b.status::text AS status
       FROM eos_ops.bin_code_claims c JOIN eos_ops.bins b ON b.tenant_id = c.tenant_id AND b.id = c.bin_id
      WHERE c.tenant_id = $1 AND c.warehouse_id = $2 AND c.code = $3`, [tenantId, req.warehouseId, req.binCode]);
  if (!rows[0]) return refuse("BIN_NOT_FOUND", "NOT_FOUND", "NOT_FOUND");
  // A claim filed under this warehouse pointing at another warehouse's bin is a data fault (DQ-019), never an answer.
  if (rows[0].bin_warehouse !== req.warehouseId) return refuse("BIN_MALFORMED", "PRECONDITION_FAILED", "MALFORMED");
  if (rows[0].status !== "ACTIVE") return refuse("BIN_INACTIVE", "PRECONDITION_FAILED", "INACTIVE");
  // A SUPERSEDED code is usable: the physical bin is right; its current code is what is recorded.
  return { binId: rows[0].bin_id, binCode: rows[0].current_code };
}

export async function recordEosPutAway(deps: PlacementOperationDeps, actor: PlacementActor, input: Record<string, unknown>) {
  if (deps.postgresState !== "ACTIVE") {
    refuse("NOT_ACTIVATED", "NOT_ACTIVATED", "EOS put-away is not activated in this environment; placements are still recorded on the current system");
  }
  // The cutover fails closed until the tenant's legacy baseline is CERTIFIED (inventoryBaselineGate.ts).
  if (!(await isInventoryBaselineCertified(deps.pool, actor.tenantId))) refuse("NOT_ACTIVATED", "NOT_ACTIVATED", INVENTORY_BASELINE_NOT_CERTIFIED_MESSAGE);
  // The EOS request is CLOSED (Controller INVENTORY reconciliation, 2026-10-01; DQ-038 "no company inference"): a field the
  // put-away does not define -- an operating company above all -- is refused, never silently ignored. Checked before the
  // shared shape validator, which stays the Firestore command's rules verbatim (binPlacementParity.test.mjs).
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const extra = Object.keys(input).filter((k) => !EOS_PUT_AWAY_FIELDS.has(k));
    if (extra.length > 0) return refuse("INVALID", "INVALID_INPUT", "unknown_field");
  }
  const validated = validateEosPutAwayRequest(input);
  if (!validated.valid) return refuse("INVALID", "INVALID_INPUT", validated.reason);
  const req = validated.value;
  const serials = req.serialNumbers ?? [];

  return inTransaction(deps.pool, async (db) => {
    if (!actor.capabilities.has(EOS_PLACEMENT_RECORD_CAPABILITY)) refuse("CAPABILITY_MISSING", "FORBIDDEN", `you do not hold ${EOS_PLACEMENT_RECORD_CAPABILITY}`);
    // The warehouse must be governed, and the actor's scope over it is authoritative.
    let warehouse;
    try {
      warehouse = await resolveScopeLocation(db, actor.tenantId, { type: "WAREHOUSE", locationId: req.warehouseId });
    } catch (err) {
      if (err instanceof InventoryScopeError) return refuse("WAREHOUSE_NOT_FOUND", "NOT_FOUND", "no governed warehouse with that id");
      throw err;
    }
    const decision = await authorizeObjectAction(postgresContextualReader(db), {
      actor, capabilityKey: EOS_PLACEMENT_RECORD_CAPABILITY, predicates: warehousePredicates(warehouse.scopeWarehouseId),
    });
    if (!decision.allowed) {
      refuse(decision.reason, "FORBIDDEN",
        decision.reason === "OUTSIDE_OPERATIONAL_SCOPE" ? "this warehouse is outside your operational scope"
          : decision.reason === "WORK_ELIGIBILITY_MISSING" ? "put-away requires the Warehouse Operations work eligibility"
            : decision.reason === "EMPLOYEE_LINK_REQUIRED" ? "only an Employee can record a placement" : "not authorized");
    }

    // REPLAY FIRST, before any gate on current state.
    const probeIds = serials.length > 0 ? serials.map((s) => eosPlacementId(req.idempotencyKey, s)) : [eosPlacementId(req.idempotencyKey, req.partId)];
    const present = await readPlacements(db, actor.tenantId, probeIds);
    if (present.length > 0) {
      if (present.length !== probeIds.length) refuse("IDEMPOTENCY_CONFLICT", "CONFLICT", "partial_key_reuse");
      let storedBinCode: string | null = null;
      for (const d of present) {
        const same = d.idempotency_key === req.idempotencyKey && d.warehouse_id === req.warehouseId && d.part_id === req.partId
          && (req.binId !== undefined ? d.bin_id === req.binId : d.bin_code === req.binCode)
          && (d.picked_for_work_order_id ?? null) === (req.pickedForWorkOrderId ?? null)
          && (d.note ?? null) === (req.note ?? null)
          && (serials.length > 0 ? Number(d.quantity) === 1 : d.serial_number === null && Number(d.quantity) === req.quantity);
        if (!same) refuse("IDEMPOTENCY_CONFLICT", "CONFLICT", "different_stow");
        storedBinCode = d.bin_code;
      }
      return {
        outcome: "replayed" as const, placementIds: probeIds, warehouseId: req.warehouseId, binCode: storedBinCode ?? req.binCode,
        partId: req.partId, quantity: serials.length > 0 ? null : (req.quantity ?? 0), serialNumbers: serials,
      };
    }

    const bin = await resolveBin(db, actor.tenantId, req);

    // FAIL CLOSED ON THE GOVERNED MASTERS (Controller INVENTORY reconciliation, 2026-10-01; DQ-038 "the server validates"):
    // a stow into a warehouse that is not ACTIVE, or of a Part the governed Part authority does not hold ACTIVE, is refused.
    // A SERIALIZED Part is stowed by serial, never by an anonymous quantity, so serial custody is never bypassed.
    if (!warehouse.active) refuse("WAREHOUSE_NOT_ACTIVE", "PRECONDITION_FAILED", "the warehouse is not ACTIVE");
    const partRows = (await db.query<{ status: string; control_type: string }>(
      `SELECT status::text AS status, control_type::text AS control_type FROM eos_ops.parts WHERE tenant_id = $1 AND id = $2`,
      [actor.tenantId, req.partId])).rows;
    if (partRows.length === 0) refuse("PART_NOT_FOUND", "NOT_FOUND", "no governed Part with that id");
    if (partRows[0].status !== "ACTIVE") refuse("PART_NOT_ACTIVE", "PRECONDITION_FAILED", "a placement may only stow an ACTIVE Part");
    if (partRows[0].control_type === "SERIALIZED" && serials.length === 0) refuse("SERIALS_REQUIRED", "INVALID_INPUT", "a serialized Part is stowed by serial number");

    // A serial must be a real unit OF THIS part, in custody INSIDE this warehouse (the warehouse itself or one of its bins)
    // and not installed: a placement records where a unit the warehouse holds was put, never a unit held elsewhere.
    if (serials.length > 0) {
      const { rows } = await db.query<{ part_id: string; serial_number: string; status: string; custody_warehouse_id: string | null }>(
        `SELECT c.part_id, c.serial_number, c.status::text AS status,
                CASE WHEN c.location_type = 'WAREHOUSE' THEN c.location_id
                     WHEN c.location_type = 'BIN' THEN (SELECT b.warehouse_id FROM eos_ops.bins b WHERE b.tenant_id = c.tenant_id AND b.id = c.location_id)
                     ELSE NULL END AS custody_warehouse_id
           FROM eos_ops.serialized_custody c WHERE c.tenant_id = $1 AND c.serial_number = ANY($2)`,
        [actor.tenantId, serials]);
      for (const s of serials) {
        const units = rows.filter((r) => r.serial_number === s);
        if (units.length === 0) refuse("INVALID", "INVALID_INPUT", "serial_unknown");
        const unit = units.find((u) => u.part_id === req.partId);
        if (!unit) refuse("INVALID", "INVALID_INPUT", "serial_wrong_part");
        if (unit!.custody_warehouse_id !== req.warehouseId || unit!.status === "INSTALLED") {
          refuse("SERIAL_NOT_IN_WAREHOUSE", "PRECONDITION_FAILED", "this unit is not in custody in this warehouse");
        }
      }
    }

    const rows = planPlacements({
      warehouseId: req.warehouseId, binId: bin.binId, binCode: bin.binCode, partId: req.partId, idempotencyKey: req.idempotencyKey,
      pickedForWorkOrderId: req.pickedForWorkOrderId ?? null, note: req.note ?? null, serialNumbers: serials, quantity: req.quantity ?? 0,
    });
    await insertPlacements(db, actor.tenantId, actor.principalId, rows);
    await db.query(
      `INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, reason)
       VALUES ($1, $2, 'binPlacement.record', $3, 'binPlacement', $4, NULL, $5, NULL)`,
      [`audit_${randomUUID()}`, actor.tenantId, actor.principalId, rows[0].id,
        JSON.stringify(await withActorAuthority(db, actor.tenantId, actor.principalId, { warehouseId: req.warehouseId, binId: bin.binId, binCode: bin.binCode, partId: req.partId,
          quantity: serials.length > 0 ? serials.length : req.quantity, serialCount: serials.length,
          pickedForWorkOrderId: req.pickedForWorkOrderId ?? null, placementIds: rows.map((r) => r.id) }))]);
    return {
      outcome: "recorded" as const, placementIds: rows.map((r) => r.id), warehouseId: req.warehouseId, binCode: bin.binCode,
      partId: req.partId, quantity: serials.length > 0 ? null : (req.quantity ?? 0), serialNumbers: serials,
    };
  });
}

export const EOS_PLACEMENT_OPERATIONS = Object.freeze({
  recordPutAway: recordEosPutAway,
} as const);
export type EosPlacementOperation = keyof typeof EOS_PLACEMENT_OPERATIONS;
