"use strict";
// LOCATION ON-HAND — the ONE place a ledger movement's effect on physical on-hand is decided.
// PURE: no Firestore, no clock. Every reader that turns ledger rows into a quantity goes through here.
//
// ============================ WHY THIS MODULE EXISTS ============================
//
// Before BIN-P6 the sign rule ("RECEIVED adds, TRANSFER_OUT subtracts, ADJUSTED is signed") was
// written out FIVE times -- availability, Transfer sufficiency, Cycle Count expected quantity, the
// mobile presence probe, and analytics. When Decisions #168/#171 made Work Order physical consumption
// live, only one of the five learned about WORK_ORDER_CONSUMPTION. The other copies kept counting
// consumed stock as present: Transfer could authorize moving a part already fitted to a machine, and a
// Cycle Count would "find" the consumed quantity as a shortage and post an ADJUSTED for it, subtracting
// the same consumption twice.
//
// Five copies of one rule is how that happened, and BIN-P6 would have made it a sixth time (the
// relocation pair). So there is one rule, it is TOTAL over the movement vocabulary, and a new
// movement type without a sign fails the build instead of silently contributing nothing.
//
// ============================ EXACT VERSUS AGGREGATE ============================
//
// EXACT (sumExactLocationOnHand) answers "how much is at THIS location" -- the only question a movement
// may ask of its source (Decision #170 Ruling 7: a movement cannot invent which child Bin stock came
// from). It never aggregates.
//
// AGGREGATE (sumWarehouseAggregateOnHand) answers "how much does this Warehouse hold" under Model A
// (Decision #160 / ADR-014): its direct rows PLUS the rows at every Bin whose governed parent it is.
// Each ledger row has exactly one location and therefore exactly one custody parent, so no row can be
// counted twice. There is deliberately no function that reads a parent row "and its children" as two
// contributions.
//
// Bin parentage is an INPUT, resolved by the caller from governed `bins` documents. It is never derived
// from the bin id's prefix, its human code, or scanner text.
Object.defineProperty(exports, "__esModule", { value: true });
exports.NO_BIN_PARENTAGE = exports.MOVEMENT_SIGN = void 0;
exports.signedQuantity = signedQuantity;
exports.isPhysicalMovementType = isPhysicalMovementType;
exports.sumExactLocationOnHand = sumExactLocationOnHand;
exports.resolveCustodyWarehouseId = resolveCustodyWarehouseId;
exports.binIdsReferenced = binIdsReferenced;
exports.sumWarehouseAggregateOnHand = sumWarehouseAggregateOnHand;
/**
 * The effect of each movement type on the location it names. Declared as a Record over the whole
 * vocabulary, so adding a movement type without deciding its sign is a COMPILE error.
 */
exports.MOVEMENT_SIGN = Object.freeze({
    RECEIVED: "PLUS",
    RETURNED: "PLUS",
    TRANSFER_IN: "PLUS",
    RELOCATION_IN: "PLUS",
    TRANSFER_OUT: "MINUS",
    SCRAPPED: "MINUS",
    RELOCATION_OUT: "MINUS",
    // Both carry their own sign: an ADJUSTED shortage from a reconciled count, and a consumption
    // (negative) or its correction (positive). Reading them as magnitudes would drop exactly the cases
    // that matter.
    ADJUSTED: "SIGNED",
    WORK_ORDER_CONSUMPTION: "SIGNED",
});
/** The quantity one movement contributes to on-hand at the location it names. */
function signedQuantity(movement) {
    const rule = exports.MOVEMENT_SIGN[movement.type];
    if (rule === undefined)
        return 0; // legacy / unknown types move no physical stock
    const q = Number(movement.quantity);
    if (!Number.isFinite(q))
        return 0;
    if (rule === "SIGNED")
        return q;
    // IN/OUT rows are positive magnitudes by contract. A non-positive one is malformed and contributes
    // NOTHING -- taking its absolute value would let a corrupt negative receipt manufacture stock.
    if (q <= 0)
        return 0;
    return rule === "PLUS" ? q : -q;
}
/** True when a movement type moves physical stock at all. */
function isPhysicalMovementType(type) {
    return Object.prototype.hasOwnProperty.call(exports.MOVEMENT_SIGN, type);
}
function sameLocation(a, b) {
    return !!a && a.type === b.type && a.locationId === b.locationId;
}
/**
 * On-hand at exactly one location, NONE-mode quantity only. The source-sufficiency authority for every
 * movement: it never looks at a parent, a child, or a sibling.
 */
function sumExactLocationOnHand(movements, location) {
    let total = 0;
    for (const m of movements) {
        if (m.trackingMode !== undefined && m.trackingMode !== "NONE")
            continue;
        if (!sameLocation(m.location, location))
            continue;
        total += signedQuantity(m);
    }
    return total;
}
exports.NO_BIN_PARENTAGE = new Map();
/**
 * The custody Warehouse of a location under Model A, or null when it has none (MOBILE, VENDOR,
 * CUSTOMER, VIRTUAL) or cannot be resolved (a BIN absent from `parentage`).
 */
function resolveCustodyWarehouseId(location, parentage) {
    if (!location || typeof location.locationId !== "string" || location.locationId === "")
        return null;
    if (location.type === "WAREHOUSE")
        return location.locationId;
    if (location.type === "BIN")
        return parentage.get(location.locationId) ?? null;
    return null;
}
/** Distinct BIN location ids referenced by these rows -- the only bins a caller needs to resolve. */
function binIdsReferenced(rows) {
    const ids = new Set();
    for (const r of rows) {
        if (r.location?.type === "BIN" && typeof r.location.locationId === "string" && r.location.locationId !== "") {
            ids.add(r.location.locationId);
        }
    }
    return [...ids].sort();
}
/**
 * Model-A Warehouse aggregate: direct rows plus rows at every child Bin, for the given Warehouses.
 * Each row contributes once, to exactly one custody parent.
 */
function sumWarehouseAggregateOnHand(movements, warehouseIds, parentage) {
    let total = 0;
    for (const m of movements) {
        if (m.trackingMode !== undefined && m.trackingMode !== "NONE")
            continue;
        const custody = resolveCustodyWarehouseId(m.location, parentage);
        if (custody === null || !warehouseIds.has(custody))
            continue;
        total += signedQuantity(m);
    }
    return total;
}
//# sourceMappingURL=locationOnHand.js.map