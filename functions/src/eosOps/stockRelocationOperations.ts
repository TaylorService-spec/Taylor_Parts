// EOS STOCK RELOCATION -- the EXISTING relocation (inventoryLocation/stockRelocationCommand.ts, BIN-P6 /
// Decision #170) on the EOS operations transport, over the PostgreSQL inventory authority (Controller ruling
// DQ-036, 2026-09-28). Client -> EOS API -> governed server authorization -> eos_ops.
//
// ════════════════════ THE SAME BUSINESS BEHAVIOR ════════════════════
//
// Everything a relocation MEANS is carried over unchanged from the Firestore command:
//   * WAREHOUSE-direct <-> BIN and BIN <-> BIN inside ONE custody Warehouse; crossing a Warehouse is a
//     Transfer, refused by name (CROSS_WAREHOUSE);
//   * the SAME request shape and validation (validateEosRelocationRequest mirrors validateRelocationRequest;
//     stockRelocationParity.test.mjs pins the two to one answer);
//   * tracking mode from the Part authority (eos_ops.parts through postgresPartPolicyAuthority), never the
//     request; LOT refused; serial numbers required for SERIAL and forbidden otherwise;
//   * EXACT-SOURCE sufficiency: quantity summed at the stated source location and nowhere else; a serial
//     unit must be in custody AT the source, AVAILABLE and not installed;
//   * the SAME deterministic identity (srl_<sha256>) and per-row idempotency keys
//     (stockRelocation:<key>:out|in[:serial]) -- a retry replays by INTENT, not by clock: same intent ->
//     replayed and nothing written; different intent -> IDEMPOTENCY_CONFLICT; some rows present and others
//     absent -> INTEGRITY, never "finish the rest";
//   * one RELOCATION_OUT + one RELOCATION_IN per quantity move, one pair PER SERIAL for serialized stock; the
//     serial's custody pointer moves in the SAME transaction as its ledger rows;
//   * one audit record per relocation (eos_policy.audit_events), never one for a replay.
//
// ════════════════════ WHAT EOS ADDS: THE GOVERNED SCOPE (DQ-017 / DQ-024) ════════════════════
//
// Besides inventory.stock.relocate, the actor must hold WORK_ELIGIBILITY WAREHOUSE_OPERATIONS and
// OPERATIONAL_SCOPE WAREHOUSE = the custody Warehouse both endpoints roll up to -- the same predicates every
// EOS warehouse act carries, evaluated per record with the concrete warehouse id.
//
// ════════════════════ WHAT IS REFUSED, NOT GUESSED ════════════════════
//
//   * recordPlacement needs inventory.placement.record as well (held separately, scoped to the same warehouse), and
//     writes the SAME placement rows put-away writes (eosOps/binPlacementOperations.ts, eos_ops.bin_placements,
//     DQ-038) in the same transaction as the ledger pair; the placement is part of the replay intent.
//   * An impossible ledger (a negative balance at the source, or a serial whose custody and ledger disagree):
//     LEDGER_INTEGRITY (DQ-019) -- never clamped into a plausible number.
//   * Not activated: every operation refuses NOT_ACTIVATED before touching anything while
//     RELOCATION_WRITER_AUTHORITY.postgres is INACTIVE.
//
// PURE PostgreSQL: no Firebase import, no Firestore fallback, no dual write.
import { lockStockLocation } from "./stockLocationLock.js";
import type { Pool, PoolClient } from "pg";
import { createHash, randomUUID } from "node:crypto";
import { authorizeObjectAction, postgresContextualReader } from "./contextualAuthorization.js";
import { warehousePredicates } from "./cycleCountOperations.js";
import { createPostgresPartPolicyAuthority } from "../catalogAuthority/postgresPartPolicyAuthority.js";
import { InventoryScopeError, resolveScopeLocation } from "./inventoryScopeAuthority.js";
import { isSafeIdSegment } from "../inventoryLocation/binRegistry.js";
import type { PostgresRelocationWriterState } from "../inventoryLocation/stockRelocationWriterState.js";
import { signedQuantity } from "../inventoryLedger/locationOnHand.js";
import { EOS_PLACEMENT_RECORD_CAPABILITY, insertPlacements, planPlacements, readPlacements } from "./binPlacementOperations.js";
import { INVENTORY_BASELINE_NOT_CERTIFIED_MESSAGE, isInventoryBaselineCertified } from "./inventoryBaselineGate.js";
import { withActorAuthority } from "./administrationReach.js";

type Queryable = Pick<PoolClient, "query">;

export const EOS_STOCK_RELOCATE_CAPABILITY = "inventory.stock.relocate";
export const EOS_RELOCATION_ENDPOINT_TYPES = ["WAREHOUSE", "BIN"] as const;
/** Mirrors MAX_RELOCATION_SERIALS. */
export const EOS_MAX_RELOCATION_SERIALS = 100;
export const RELOCATION_MOVEMENT_SOURCE_KIND = "STOCK_RELOCATION";

export type RelocationOperationCategory =
  | "INVALID_INPUT" | "NOT_FOUND" | "PRECONDITION_FAILED" | "CONFLICT" | "FORBIDDEN" | "NOT_ACTIVATED";

export class RelocationOperationError extends Error {
  constructor(readonly code: string, readonly category: RelocationOperationCategory, message: string) {
    super(message);
    this.name = "RelocationOperationError";
  }
}
const refuse = (code: string, category: RelocationOperationCategory, message: string): never => {
  throw new RelocationOperationError(code, category, message);
};

export interface RelocationActor {
  readonly tenantId: string;
  readonly principalId: string;
  readonly capabilities: ReadonlySet<string>;
}

export interface RelocationOperationDeps {
  readonly pool: Pool;
  /** The activation state. The transport passes RELOCATION_WRITER_AUTHORITY.postgres; nothing defaults it to ACTIVE. */
  readonly postgresState: PostgresRelocationWriterState;
}

interface LocationRef { readonly type: "WAREHOUSE" | "BIN"; readonly locationId: string }

export interface EosRelocationRequest {
  readonly partId: string;
  readonly source: LocationRef;
  readonly destination: LocationRef;
  readonly quantity?: number;
  readonly serialNumbers?: readonly string[];
  readonly idempotencyKey: string;
  readonly recordPlacement: boolean;
  readonly pickedForWorkOrderId: string | null;
}

// ════════════════════ request shape: the Firestore command's rules, verbatim ════════════════════

const isNonBlank = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const ALLOWED_KEYS = new Set(["partId", "source", "destination", "quantity", "serialNumbers", "idempotencyKey", "recordPlacement", "pickedForWorkOrderId"]);

function validateEndpoint(ref: unknown): LocationRef | null {
  if (!isPlainObject(ref)) return null;
  const keys = Object.keys(ref);
  if (keys.length !== 2 || !keys.every((k) => k === "type" || k === "locationId")) return null;
  if (!(EOS_RELOCATION_ENDPOINT_TYPES as readonly string[]).includes(ref.type as string)) return null;
  if (!isSafeIdSegment(ref.locationId)) return null;
  return { type: ref.type as LocationRef["type"], locationId: ref.locationId as string };
}

/** Shape validation only -- the same reasons, in the same order, as validateRelocationRequest. */
export function validateEosRelocationRequest(input: unknown): { valid: true; value: EosRelocationRequest } | { valid: false; reason: string } {
  if (!isPlainObject(input)) return { valid: false, reason: "not_object" };
  if (Object.keys(input).some((k) => !ALLOWED_KEYS.has(k))) return { valid: false, reason: "unknown_field" };
  if (!isNonBlank(input.partId)) return { valid: false, reason: "part_id_invalid" };
  const source = validateEndpoint(input.source);
  if (source === null) return { valid: false, reason: "source_invalid" };
  const destination = validateEndpoint(input.destination);
  if (destination === null) return { valid: false, reason: "destination_invalid" };
  if (source.type === destination.type && source.locationId === destination.locationId) return { valid: false, reason: "same_location" };
  if (!isNonBlank(input.idempotencyKey) || input.idempotencyKey.length > 300) return { valid: false, reason: "idempotency_key_invalid" };
  const hasSerials = input.serialNumbers !== undefined;
  const hasQuantity = input.quantity !== undefined;
  if (hasSerials === hasQuantity) return { valid: false, reason: "quantity_or_serials_required" };
  let serialNumbers: string[] | undefined;
  let quantity: number | undefined;
  if (hasSerials) {
    if (!Array.isArray(input.serialNumbers) || input.serialNumbers.length === 0) return { valid: false, reason: "serial_numbers_invalid" };
    if (input.serialNumbers.length > EOS_MAX_RELOCATION_SERIALS) return { valid: false, reason: "too_many_serials" };
    serialNumbers = [];
    for (const s of input.serialNumbers) {
      if (!isNonBlank(s)) return { valid: false, reason: "serial_numbers_invalid" };
      serialNumbers.push(s.trim());
    }
    if (new Set(serialNumbers).size !== serialNumbers.length) return { valid: false, reason: "serial_repeated" };
  } else {
    if (typeof input.quantity !== "number" || !Number.isInteger(input.quantity) || input.quantity <= 0) return { valid: false, reason: "quantity_invalid" };
    quantity = input.quantity;
  }
  const recordPlacement = input.recordPlacement === undefined ? false : input.recordPlacement;
  if (typeof recordPlacement !== "boolean") return { valid: false, reason: "record_placement_invalid" };
  if (recordPlacement && destination.type !== "BIN") return { valid: false, reason: "placement_requires_bin_destination" };
  const picked = input.pickedForWorkOrderId;
  if (picked !== undefined && (!recordPlacement || !isNonBlank(picked))) return { valid: false, reason: "picked_for_work_order_invalid" };
  return {
    valid: true,
    value: {
      partId: input.partId.trim(), source, destination,
      ...(quantity !== undefined ? { quantity } : {}),
      ...(serialNumbers !== undefined ? { serialNumbers } : {}),
      idempotencyKey: input.idempotencyKey, recordPlacement,
      pickedForWorkOrderId: isNonBlank(picked) ? picked.trim() : null,
    },
  };
}

/** The deterministic relocation identity -- identical to deriveRelocationId. */
export function eosRelocationId(idempotencyKey: string): string {
  return "srl_" + createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 40);
}

/** Per-row ledger idempotency keys -- identical to relocationRowKey. */
export function eosRelocationRowKey(idempotencyKey: string, side: "out" | "in", serialNo?: string): string {
  return serialNo === undefined ? `stockRelocation:${idempotencyKey}:${side}` : `stockRelocation:${idempotencyKey}:${side}:${serialNo}`;
}

// ════════════════════ transaction + audit ════════════════════

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

interface PlannedRow {
  readonly movementType: "RELOCATION_OUT" | "RELOCATION_IN";
  readonly location: LocationRef;
  readonly quantityDelta: number;
  readonly serialNumber: string | null;
  readonly idempotencyKey: string;
}

function planRows(req: EosRelocationRequest): PlannedRow[] {
  const serials = req.serialNumbers ?? [];
  if (serials.length === 0) {
    const q = req.quantity as number;
    return [
      { movementType: "RELOCATION_OUT", location: req.source, quantityDelta: signedQuantity({ type: "RELOCATION_OUT", quantity: q }), serialNumber: null, idempotencyKey: eosRelocationRowKey(req.idempotencyKey, "out") },
      { movementType: "RELOCATION_IN", location: req.destination, quantityDelta: signedQuantity({ type: "RELOCATION_IN", quantity: q }), serialNumber: null, idempotencyKey: eosRelocationRowKey(req.idempotencyKey, "in") },
    ];
  }
  return serials.flatMap((s) => [
    { movementType: "RELOCATION_OUT" as const, location: req.source, quantityDelta: signedQuantity({ type: "RELOCATION_OUT", quantity: 1 }), serialNumber: s, idempotencyKey: eosRelocationRowKey(req.idempotencyKey, "out", s) },
    { movementType: "RELOCATION_IN" as const, location: req.destination, quantityDelta: signedQuantity({ type: "RELOCATION_IN", quantity: 1 }), serialNumber: s, idempotencyKey: eosRelocationRowKey(req.idempotencyKey, "in", s) },
  ]);
}

async function resolveEndpoint(db: Queryable, tenantId: string, ref: LocationRef) {
  try {
    return await resolveScopeLocation(db, tenantId, ref);
  } catch (err) {
    if (err instanceof InventoryScopeError) {
      return refuse("NOT_FOUND", "NOT_FOUND", ref.type === "BIN" ? "bin_not_found" : "warehouse_not_found");
    }
    throw err;
  }
}

// ════════════════════ the command ════════════════════

export async function relocateEosStock(deps: RelocationOperationDeps, actor: RelocationActor, input: Record<string, unknown>) {
  if (deps.postgresState !== "ACTIVE") {
    refuse("NOT_ACTIVATED", "NOT_ACTIVATED", "EOS stock relocation is not activated in this environment; relocations still run on the current system");
  }
  // The cutover fails closed until the tenant's legacy baseline is CERTIFIED (inventoryBaselineGate.ts).
  if (!(await isInventoryBaselineCertified(deps.pool, actor.tenantId))) refuse("NOT_ACTIVATED", "NOT_ACTIVATED", INVENTORY_BASELINE_NOT_CERTIFIED_MESSAGE);
  const validated = validateEosRelocationRequest(input);
  if (!validated.valid) return refuse("INVALID", "INVALID_INPUT", validated.reason);
  const req = validated.value;
  const relocationId = eosRelocationId(req.idempotencyKey);
  const serials = req.serialNumbers ?? [];

  return inTransaction(deps.pool, async (db) => {
    // ---- 1. capability (the scope predicates follow once the custody warehouse is known) ----
    if (!actor.capabilities.has(EOS_STOCK_RELOCATE_CAPABILITY)) refuse("CAPABILITY_MISSING", "FORBIDDEN", `you do not hold ${EOS_STOCK_RELOCATE_CAPABILITY}`);

    // ---- 2. PLACEMENT is its own authority: holding relocate does not imply it (Decision #170) ----
    if (req.recordPlacement && !actor.capabilities.has(EOS_PLACEMENT_RECORD_CAPABILITY)) {
      refuse("CAPABILITY_MISSING", "FORBIDDEN", "placement_not_authorized");
    }

    // ---- 3. part authority: tracking mode from eos_ops.parts, never the request ----
    const [part] = await createPostgresPartPolicyAuthority().readPartPolicies(db, actor.tenantId, [req.partId]);
    if (!part.found) refuse("NOT_FOUND", "NOT_FOUND", "part_not_found");
    if (part.trackingMode === "LOT") refuse("INVALID", "INVALID_INPUT", "lot_not_supported");
    const isSerial = part.trackingMode === "SERIAL";
    if (isSerial !== serials.length > 0) refuse("INVALID", "INVALID_INPUT", isSerial ? "serial_numbers_required" : "serial_numbers_not_allowed");

    // ---- 4. endpoints: governed, same custody warehouse; the actor's scope over THAT warehouse ----
    const source = await resolveEndpoint(db, actor.tenantId, req.source);
    const destination = await resolveEndpoint(db, actor.tenantId, req.destination);
    if (source.scopeWarehouseId !== destination.scopeWarehouseId) {
      refuse("CROSS_WAREHOUSE", "PRECONDITION_FAILED", "different_custody_parents_use_transfer");
    }
    const decision = await authorizeObjectAction(postgresContextualReader(db), {
      actor, capabilityKey: EOS_STOCK_RELOCATE_CAPABILITY, predicates: warehousePredicates(source.scopeWarehouseId),
    });
    if (!decision.allowed) {
      refuse(decision.reason, "FORBIDDEN",
        decision.reason === "OUTSIDE_OPERATIONAL_SCOPE" ? "this warehouse is outside your operational scope"
          : decision.reason === "WORK_ELIGIBILITY_MISSING" ? "relocating stock requires the Warehouse Operations work eligibility"
            : decision.reason === "EMPLOYEE_LINK_REQUIRED" ? "only an Employee can relocate stock" : "not authorized");
    }
    if (req.recordPlacement) {
      const placement = await authorizeObjectAction(postgresContextualReader(db), {
        actor, capabilityKey: EOS_PLACEMENT_RECORD_CAPABILITY, predicates: warehousePredicates(source.scopeWarehouseId),
      });
      if (!placement.allowed) refuse(placement.reason, "FORBIDDEN", "placement_not_authorized");
    }
    // The placement a move ALSO records (DQ-038): the same rows put-away writes, at the custody warehouse's bin.
    const destinationBinCode = req.destination.type === "BIN"
      ? (await db.query<{ code: string }>(`SELECT code FROM eos_ops.bins WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, req.destination.locationId])).rows[0]?.code ?? null
      : null;
    // The ids derive from the key and the serial/part alone, so they are known whatever the destination -- which is
    // what lets a replay WITHOUT a placement notice one that was written under the same key.
    const plannedPlacements = planPlacements({ warehouseId: source.scopeWarehouseId, binId: req.destination.locationId,
      binCode: destinationBinCode ?? "", partId: req.partId, idempotencyKey: req.idempotencyKey,
      pickedForWorkOrderId: req.pickedForWorkOrderId, note: null, serialNumbers: serials, quantity: req.quantity ?? 0 });

    // ---- 5. prior write? replay by INTENT ----
    const planned = planRows(req);
    const { rows: prior } = await db.query<{
      id: string; idempotency_key: string; part_id: string; tracking_mode: string; location_type: string; location_id: string;
      movement_type: string; quantity_delta: number; serial_number: string | null; source_kind: string; source_id: string;
    }>(
      `SELECT id, idempotency_key, part_id, tracking_mode::text AS tracking_mode, location_type::text AS location_type, location_id,
              movement_type::text AS movement_type, quantity_delta, serial_number, source_kind, source_id
         FROM eos_ops.inventory_movements WHERE tenant_id = $1 AND idempotency_key = ANY($2)`,
      [actor.tenantId, planned.map((p) => p.idempotencyKey)]);
    if (prior.length > 0 && prior.length < planned.length) refuse("INTEGRITY", "CONFLICT", "partial_prior_relocation");
    if (prior.length === planned.length) {
      const byKey = new Map(prior.map((r) => [r.idempotency_key, r]));
      const movementIds = planned.map((p) => {
        const r = byKey.get(p.idempotencyKey);
        const same = r && r.part_id === req.partId && r.tracking_mode === (isSerial ? "SERIAL" : "NONE")
          && r.location_type === p.location.type && r.location_id === p.location.locationId && r.movement_type === p.movementType
          && Number(r.quantity_delta) === p.quantityDelta && (r.serial_number ?? null) === p.serialNumber
          && r.source_kind === RELOCATION_MOVEMENT_SOURCE_KIND && r.source_id === relocationId;
        if (!same) refuse("IDEMPOTENCY_CONFLICT", "CONFLICT", "idempotency_key_reused");
        return (r as { id: string }).id;
      });
      // THE PLACEMENT IS PART OF THE INTENT: a retry that asks for a placement the original never wrote (or omits
      // one it did, or names another pick) is a different request under this key, not a replay.
      const placed = await readPlacements(db, actor.tenantId, plannedPlacements.map((p) => p.id));
      if (req.recordPlacement) {
        if (placed.length !== plannedPlacements.length) refuse("IDEMPOTENCY_CONFLICT", "CONFLICT", "placement_intent_differs");
        for (const d of placed) {
          if (d.bin_id !== req.destination.locationId || (d.picked_for_work_order_id ?? null) !== (req.pickedForWorkOrderId ?? null)) {
            refuse("IDEMPOTENCY_CONFLICT", "CONFLICT", "placement_intent_differs");
          }
        }
      } else if (placed.length > 0) {
        refuse("IDEMPOTENCY_CONFLICT", "CONFLICT", "placement_intent_differs");
      }
      return {
        outcome: "replayed" as const, relocationId, partId: req.partId, source: req.source, destination: req.destination,
        quantity: isSerial ? null : (req.quantity ?? null), serialNumbers: serials, movementIds,
        placementIds: req.recordPlacement ? plannedPlacements.map((p) => p.id) : [] as string[],
      };
    }

    // ---- 6. a NEW move: part and both endpoints ACTIVE ----
    if (part.status !== "ACTIVE") refuse("INVALID", "INVALID_INPUT", "part_not_active");
    if (!source.active || !destination.active) refuse("RETIRED_BIN", "PRECONDITION_FAILED", !source.active ? "source_not_active" : "destination_not_active");

    // ---- 7. exact-source sufficiency ----
    const companyKey = source.operatingCompanyKey;
    if (isSerial) {
      const { rows: units } = await db.query<{ serial_number: string; status: string; location_type: string; location_id: string; equipment_id: string | null; operating_company_key: string }>(
        `SELECT serial_number, status::text AS status, location_type::text AS location_type, location_id, equipment_id, operating_company_key
           FROM eos_ops.serialized_custody WHERE tenant_id = $1 AND part_id = $2 AND serial_number = ANY($3) FOR UPDATE`,
        [actor.tenantId, req.partId, serials]);
      const unitBySerial = new Map(units.map((u) => [u.serial_number, u]));
      serials.forEach((s, i) => {
        const u = unitBySerial.get(s);
        if (!u) refuse("NOT_FOUND", "NOT_FOUND", `serial_not_found:${i}`);
        const unit = u as NonNullable<typeof u>;
        if (unit.location_type !== req.source.type || unit.location_id !== req.source.locationId) refuse("SERIAL_NOT_AT_SOURCE", "PRECONDITION_FAILED", `serial_elsewhere:${i}`);
        if (unit.status !== "AVAILABLE" || unit.equipment_id !== null) refuse("SERIAL_NOT_AT_SOURCE", "PRECONDITION_FAILED", `serial_not_available:${i}`);
        if (unit.operating_company_key !== companyKey) refuse("LEDGER_INTEGRITY", "PRECONDITION_FAILED", `serial_company_mismatch:${i}`);
      });
      // DQ-019: custody says the unit is here; the ledger must agree, or the evidence is not trustworthy.
      const { rows: nets } = await db.query<{ serial_number: string; net: string }>(
        `SELECT serial_number, SUM(quantity_delta)::bigint AS net FROM eos_ops.inventory_movements
          WHERE tenant_id = $1 AND part_id = $2 AND tracking_mode = 'SERIAL' AND location_type = $3 AND location_id = $4
            AND serial_number = ANY($5) GROUP BY serial_number`,
        [actor.tenantId, req.partId, req.source.type, req.source.locationId, serials]);
      const netBySerial = new Map(nets.map((n) => [n.serial_number, Number(n.net)]));
      serials.forEach((s, i) => { if (netBySerial.get(s) !== 1) refuse("LEDGER_INTEGRITY", "PRECONDITION_FAILED", `ledger_disagrees_with_custody:${i}`); });
    } else {
      // Serialize concurrent relocations out of the SAME source for the SAME part: two moves that each see
      // enough stock must not both commit against it (the Firestore command gets this from its transaction reads).
      await lockStockLocation(db, actor.tenantId, req.partId, req.source.type, req.source.locationId);
      const { rows } = await db.query<{ total: string | null }>(
        `SELECT COALESCE(SUM(quantity_delta), 0)::bigint AS total FROM eos_ops.inventory_movements
          WHERE tenant_id = $1 AND part_id = $2 AND tracking_mode = 'NONE' AND location_type = $3 AND location_id = $4`,
        [actor.tenantId, req.partId, req.source.type, req.source.locationId]);
      const atSource = Number(rows[0]?.total ?? 0);
      if (!Number.isSafeInteger(atSource) || atSource < 0) refuse("LEDGER_INTEGRITY", "PRECONDITION_FAILED", "the ledger balance at the source is impossible; it must be investigated before moving stock");
      if (atSource < (req.quantity as number)) refuse("INSUFFICIENT_STOCK", "PRECONDITION_FAILED", "exact_source_short");
    }

    // ---- 7b. placement records, read before any write: an existing one without its movement is an integrity fault ----
    if (req.recordPlacement) {
      if (destinationBinCode === null) refuse("NOT_FOUND", "NOT_FOUND", "bin_not_found");
      if ((await readPlacements(db, actor.tenantId, plannedPlacements.map((p) => p.id))).length > 0) {
        refuse("INTEGRITY", "CONFLICT", "placement_without_movement");
      }
    }

    // ---- 8. the ledger pair(s), the serial custody pointer, and the placement, in ONE transaction ----
    const movementIds: string[] = [];
    for (const p of planned) {
      const id = `mov_${randomUUID()}`;
      try {
        await db.query(
          `INSERT INTO eos_ops.inventory_movements
             (id, tenant_id, operating_company_key, part_id, tracking_mode, location_type, location_id,
              movement_type, quantity_delta, serial_number, source_kind, source_id, idempotency_key, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [id, actor.tenantId, companyKey, req.partId, isSerial ? "SERIAL" : "NONE", p.location.type, p.location.locationId,
            p.movementType, p.quantityDelta, p.serialNumber, RELOCATION_MOVEMENT_SOURCE_KIND, relocationId, p.idempotencyKey, actor.principalId]);
      } catch (err) {
        // A concurrent identical request committed first: its rows now hold these keys.
        if ((err as { code?: string }).code === "23505") refuse("IDEMPOTENCY_CONFLICT", "CONFLICT", "idempotency_key_reused");
        throw err;
      }
      movementIds.push(id);
    }
    if (isSerial) {
      await db.query(
        `UPDATE eos_ops.serialized_custody SET location_type = $4, location_id = $5, updated_by = $6, updated_at = now()
          WHERE tenant_id = $1 AND part_id = $2 AND serial_number = ANY($3)`,
        [actor.tenantId, req.partId, serials, req.destination.type, req.destination.locationId, actor.principalId]);
    }
    if (req.recordPlacement) await insertPlacements(db, actor.tenantId, actor.principalId, plannedPlacements);
    await db.query(
      `INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, reason)
       VALUES ($1, $2, 'stockRelocation.relocate', $3, 'stockRelocation', $4, NULL, $5, NULL)`,
      [`audit_${randomUUID()}`, actor.tenantId, actor.principalId, relocationId,
        JSON.stringify(await withActorAuthority(db, actor.tenantId, actor.principalId, { partId: req.partId, source: req.source, destination: req.destination, warehouseId: source.scopeWarehouseId,
          quantity: isSerial ? serials.length : req.quantity, serialCount: serials.length, placementRecorded: req.recordPlacement,
          placementIds: req.recordPlacement ? plannedPlacements.map((p) => p.id) : [] }))]);
    return {
      outcome: "relocated" as const, relocationId, partId: req.partId, source: req.source, destination: req.destination,
      quantity: isSerial ? null : (req.quantity as number), serialNumbers: serials, movementIds,
      placementIds: req.recordPlacement ? plannedPlacements.map((p) => p.id) : [] as string[],
    };
  });
}

export const EOS_RELOCATION_OPERATIONS = Object.freeze({
  relocateStock: relocateEosStock,
} as const);
export type EosRelocationOperation = keyof typeof EOS_RELOCATION_OPERATIONS;
