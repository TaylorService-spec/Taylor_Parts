"use strict";
// BIN CONVERSION RECONCILIATION — proof that moving a warehouse's stock into its bins created and
// destroyed nothing. PURE. Read by functions/scripts/binConversionReconciliation.mjs.
//
// A warehouse is converted to bins by ORDINARY governed relocation: an operator puts stock away with
// Scan -> Move stock, and each line writes RELOCATION_OUT at the warehouse and RELOCATION_IN at the bin.
// No historical row is rewritten, no balance is edited, no migration-only ledger history exists. What a
// conversion needs on top of that is EVIDENCE, and this module produces it.
//
// For each part, over the conversion window [start, end]:
//
//   aggregateBefore   Model-A warehouse aggregate from rows recorded before `start`
//   aggregateAfter    the same, from rows recorded up to `end`
//   relocationNet     the signed sum of RELOCATION rows in the window  -- MUST be 0
//   otherNet          the signed sum of every other physical row in the window (a receipt, a job's
//                     consumption, a transfer that happened while the aisle was being converted)
//
//   balanced  <=>  relocationNet === 0  AND  aggregateAfter - aggregateBefore === otherNet
//
// That is the honest form of "before = after": concurrent real activity is not forbidden, it is
// EXPLAINED line by line, and relocation is shown to have contributed exactly nothing.
Object.defineProperty(exports, "__esModule", { value: true });
exports.reconcileBinConversion = reconcileBinConversion;
const locationOnHand_js_1 = require("./locationOnHand.js");
const isRelocation = (type) => type === "RELOCATION_OUT" || type === "RELOCATION_IN";
/**
 * Reconcile one warehouse's conversion window. NONE-mode quantity only: a serialized unit's custody is
 * its own asset record, and a serial relocation is proved by that record, not by quantity math.
 */
function reconcileBinConversion(rows, warehouseId, parentage, start, end) {
    const byPart = new Map();
    const unresolved = new Set();
    for (const { value: v, recordedAt } of rows) {
        if (v.trackingMode !== undefined && v.trackingMode !== "NONE")
            continue;
        if (recordedAt > end)
            continue;
        const loc = v.location;
        const custody = (0, locationOnHand_js_1.resolveCustodyWarehouseId)(loc, parentage);
        if (loc?.type === "BIN" && custody === null)
            unresolved.add(loc.locationId);
        if (custody !== warehouseId)
            continue;
        const q = (0, locationOnHand_js_1.signedQuantity)(v);
        const acc = byPart.get(v.partId) ?? { before: 0, after: 0, reloc: 0, other: 0, binned: 0, direct: 0 };
        acc.after += q;
        if (loc.type === "BIN")
            acc.binned += q;
        else
            acc.direct += q;
        if (recordedAt < start)
            acc.before += q;
        else if (isRelocation(v.type))
            acc.reloc += q;
        else
            acc.other += q;
        byPart.set(v.partId, acc);
    }
    const parts = [...byPart.entries()]
        .map(([partId, a]) => Object.freeze({
        partId,
        aggregateBefore: a.before,
        aggregateAfter: a.after,
        relocationNet: a.reloc,
        otherNet: a.other,
        binnedAfter: a.binned,
        directAfter: a.direct,
        balanced: a.reloc === 0 && a.after - a.before === a.other,
    }))
        .sort((x, y) => x.partId.localeCompare(y.partId));
    return Object.freeze({
        warehouseId,
        start,
        end,
        parts: Object.freeze(parts),
        balanced: unresolved.size === 0 && parts.every((p) => p.balanced),
        unresolvedBinIds: Object.freeze([...unresolved].sort()),
    });
}
//# sourceMappingURL=binConversionReconciliation.js.map