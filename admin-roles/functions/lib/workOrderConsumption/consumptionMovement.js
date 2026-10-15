"use strict";
// Work Order physical consumption — the MOVEMENT, and the correction that reverses it.
//
// PURE construction + deterministic identity. The Firestore work belongs to the caller's existing
// transaction; this module decides only WHAT is written, so the decision is testable without an
// emulator and cannot differ between the command and a test.
//
// ============================ WHY THIS IS NOT `CONSUMED` ============================
//
// `CONSUMED` already exists and means something else: a location-less commitment event that
// reconciles a Work Order reservation. Reusing the name would merge a promise with a stock movement,
// and the two must stay separable — completion still writes the commitment event, and it must not be
// mistaken for a second physical decrement of stock this module already removed.
//
// ============================ SIGN, AND WHY ONE TYPE COVERS THE CORRECTION ============================
//
// WORK_ORDER_CONSUMPTION is SIGNED, following ADJUSTED's existing precedent:
//
//   consumption  NEGATIVE   stock leaves the location it was used from
//   correction   POSITIVE   the same fact reversed, restoring to the location it left
//
// A separate reversal type was the alternative and is worse: two types can drift, and a reversal
// that names a different location than the movement it reverses is exactly the bug that would let a
// correction manufacture stock somewhere it never was. One type, one sign convention, one rule in
// the on-hand derivation.
//
// A correction is EXECUTION-DATA CORRECTION, not a return. Nothing here decides returns disposition,
// restocking condition, or customer credit.
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConsumptionMovementError = exports.WORK_ORDER_CONSUMPTION_TYPE = void 0;
exports.consumptionIdempotencyKey = consumptionIdempotencyKey;
exports.buildConsumptionMovement = buildConsumptionMovement;
exports.outstandingConsumptionByLocation = outstandingConsumptionByLocation;
exports.planConsumptionCorrection = planConsumptionCorrection;
const node_crypto_1 = require("node:crypto");
exports.WORK_ORDER_CONSUMPTION_TYPE = "WORK_ORDER_CONSUMPTION";
class ConsumptionMovementError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = new.target.name;
    }
}
exports.ConsumptionMovementError = ConsumptionMovementError;
const isPositive = (v) => typeof v === "number" && Number.isFinite(v) && v > 0;
const str = (v) => (typeof v === "string" && v.trim().length > 0 ? v.trim() : null);
/**
 * The movement's idempotency key.
 *
 * Derived from the command's own key plus the part, the direction and the location, so:
 *   · a retry of the same submit produces the SAME key and is refused as a duplicate;
 *   · two different parts in one submit are two movements, not one;
 *   · a consumption and its later correction never collide, because direction is in the key.
 */
// A separator that cannot occur inside a Firestore document id, so two different field sets can
// never hash to the same key by running together. Printable on purpose: a literal control byte in
// source silently disables whatever reads it, which is why the repo forbids one outright.
const SEPARATOR = "/";
function consumptionIdempotencyKey(input) {
    const material = [input.commandKey, input.workOrderId, input.partId, input.locationId, input.direction].join(SEPARATOR);
    return `woc_${(0, node_crypto_1.createHash)("sha256").update(material).digest("hex").slice(0, 32)}`;
}
/** Build the operational movement for one part's consumption (or its correction). */
function buildConsumptionMovement(input) {
    const workOrderId = str(input.workOrderId);
    const partId = str(input.partId);
    const locationId = str(input.locationId);
    const locationType = str(input.locationType);
    const actorId = str(input.actorId);
    if (!workOrderId || !partId || !locationId || !locationType || !actorId) {
        throw new ConsumptionMovementError("MOVEMENT_LINEAGE_REQUIRED", "a physical consumption must name its work order, part, location and actor");
    }
    if (!isPositive(input.quantity)) {
        throw new ConsumptionMovementError("MOVEMENT_QUANTITY_INVALID", "quantity must be a positive magnitude — the sign is applied by direction");
    }
    if (!Number.isSafeInteger(input.occurredAt)) {
        throw new ConsumptionMovementError("MOVEMENT_TIME_REQUIRED", "occurredAt must be the governed event time in epoch millis");
    }
    if (input.direction !== "CONSUME" && input.direction !== "CORRECT") {
        throw new ConsumptionMovementError("MOVEMENT_DIRECTION_INVALID", "direction must be CONSUME or CORRECT");
    }
    const signed = input.direction === "CONSUME" ? -input.quantity : input.quantity;
    // trackingMode is deliberately NOT on the event: the validator takes it from the PART authority
    // argument, so carrying it here would be a second, forgeable answer to a question the Part already
    // owns -- and the validator rejects the unknown field outright.
    return {
        type: exports.WORK_ORDER_CONSUMPTION_TYPE,
        partId,
        location: { type: locationType, locationId },
        quantity: signed,
        // The Work Order IS the source object — the boundary this ruling moved.
        sourceObject: { type: "WORK_ORDER", id: workOrderId },
        idempotencyKey: consumptionIdempotencyKey({
            commandKey: input.commandKey, workOrderId, partId, locationId, direction: input.direction,
        }),
        actor: { kind: "USER", id: actorId },
        occurredAt: input.occurredAt,
        ...(input.serialNo === undefined ? {} : { serialNo: input.serialNo }),
    };
}
/**
 * How much of a part this Work Order has physically consumed and not yet had corrected, per location.
 *
 * Correction targets the ORIGINAL source rather than asking anyone to choose one, and this is what
 * makes that possible: the outstanding balance per location is derivable from the movements
 * themselves, so a correction restores to where the stock actually left from.
 *
 * NOT a costing rule. Reversing the most recent unreversed entry is bookkeeping about which
 * execution record is being corrected — it is not FIFO, not LIFO, and decides nothing about value.
 */
function outstandingConsumptionByLocation(rows, workOrderId, partId) {
    const byLocation = new Map();
    for (const r of rows ?? []) {
        if (r?.type !== exports.WORK_ORDER_CONSUMPTION_TYPE)
            continue;
        if (r?.partId !== partId)
            continue;
        if (r?.sourceObject?.type !== "WORK_ORDER" || r?.sourceObject?.id !== workOrderId)
            continue;
        const locationId = str(r?.location?.locationId);
        const locationType = str(r?.location?.type);
        if (!locationId || !locationType)
            continue;
        if (typeof r.quantity !== "number" || !Number.isFinite(r.quantity))
            continue;
        const key = `${locationType}/${locationId}`;
        const entry = byLocation.get(key) ?? { locationType, locationId, outstanding: 0 };
        // A consumption is negative, so subtracting it accumulates a positive outstanding figure; a
        // correction is positive and reduces it.
        entry.outstanding -= r.quantity;
        byLocation.set(key, entry);
    }
    return [...byLocation.values()].filter((e) => e.outstanding > 0);
}
/**
 * Plan the correction for a qtyUsed DECREASE.
 *
 * Restores to the ORIGINAL source lineage, never to a location someone selects — a correction that
 * could name a new location would let a decrement conjure stock into a warehouse the part was never
 * in. It also refuses to restore more than was actually consumed, so repeated corrections cannot
 * inflate on-hand.
 */
function planConsumptionCorrection(outstanding, quantity) {
    if (!isPositive(quantity))
        return { ok: false, reason: "CORRECTION_QUANTITY_INVALID" };
    const total = outstanding.reduce((n, e) => n + e.outstanding, 0);
    if (quantity > total) {
        // More than was consumed. Refusing is the whole point: a correction is a correction of a real
        // record, not an inventory increase with a Work Order attached to it.
        return { ok: false, reason: "CORRECTION_EXCEEDS_CONSUMPTION" };
    }
    const plan = [];
    let remaining = quantity;
    // Most recent unreversed first — `outstanding` preserves the ledger's own order.
    for (const entry of [...outstanding].reverse()) {
        if (remaining <= 0)
            break;
        const take = Math.min(remaining, entry.outstanding);
        plan.push({ locationType: entry.locationType, locationId: entry.locationId, quantity: take });
        remaining -= take;
    }
    return { ok: true, plan };
}
//# sourceMappingURL=consumptionMovement.js.map