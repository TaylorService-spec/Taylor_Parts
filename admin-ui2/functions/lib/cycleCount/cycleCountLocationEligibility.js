"use strict";
// Cycle Count LOCATION ELIGIBILITY (BIN-P7, Decision #178 B4) -- the governed policy seam that decides
// whether a location may be counted at all.
//
// WAREHOUSE and MOBILE: exactly the shared governed resolver Transfer uses (active, governed).
// BIN: all four of the Owner's conditions, fail closed on each:
//   1. the Bin is valid and ACTIVE at the current schema            (shared resolver)
//   2. its governed parent Warehouse resolves and is ACTIVE         (shared resolver, bin.warehouseId)
//   3. that Warehouse has passed the Bin conversion gate            (warehouse_bin_conversions)
//   4. the caller holds the Cycle Count capability                  (the command's own authorize, unchanged)
//
// Why 3 exists: before conversion, stock physically in a bin is still recorded direct at the Warehouse.
// Counting the bin would book it as a positive variance and an approved ADJUSTED +N would count it twice.
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeResolveCycleCountLocationEligible = makeResolveCycleCountLocationEligible;
const transferLocationResolver_js_1 = require("../inventoryTransfer/transferLocationResolver.js");
const binConversionGate_js_1 = require("../inventoryLocation/binConversionGate.js");
function makeResolveCycleCountLocationEligible(db) {
    const resolveActive = (0, transferLocationResolver_js_1.makeResolveTransferLocationActive)(db);
    return async function resolveCycleCountLocationEligible(txn, location) {
        if (!(await resolveActive(txn, location)))
            return false;
        if (location.type !== "BIN")
            return true;
        const warehouseId = await (0, transferLocationResolver_js_1.resolveTransferCustodyWarehouseId)(txn, db, location);
        return warehouseId !== null && (await (0, binConversionGate_js_1.isWarehouseBinConversionComplete)(txn, db, warehouseId));
    };
}
//# sourceMappingURL=cycleCountLocationEligibility.js.map