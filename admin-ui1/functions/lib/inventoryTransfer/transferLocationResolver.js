"use strict";
// Enterprise Inventory Phase 4 -- the concrete production `resolveLocationActive` resolver for the
// transfer command family. Reads WAREHOUSE endpoints through `warehouses/{locationId}` (the SAME §3A
// governed validator Receiving's resolver uses) and MOBILE(truck) endpoints through
// `mobile_locations/{locationId}` (the EI Truck Registry's MOBILE Inventory Location, ADR-010). Never
// throws for data reasons -- returns a plain boolean; the command maps false to ORIGIN_INVALID /
// DESTINATION_INVALID. Because every read is inside the caller's transaction, a concurrent
// ACTIVE->INACTIVE transition (warehouse status flip, truck deactivation) conflicts the command's
// commit, forcing a retry that re-reads the new state -- no stale movement.
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeResolveTransferLocationActive = makeResolveTransferLocationActive;
exports.resolveTransferCustodyWarehouseId = resolveTransferCustodyWarehouseId;
const binCommands_js_1 = require("../inventoryLocation/binCommands.js");
const binRegistry_js_1 = require("../inventoryLocation/binRegistry.js");
const collections_js_1 = require("../constants/collections.js");
const governedWarehouseValidation_js_1 = require("../warehouseGovernance/governedWarehouseValidation.js");
const truckRegistryRepository_js_1 = require("../truckRegistry/truckRegistryRepository.js");
const types_js_1 = require("../truckRegistry/types.js");
const transferDocIdGuard_js_1 = require("./transferDocIdGuard.js");
function makeResolveTransferLocationActive(db) {
    return async function resolveLocationActive(txn, location) {
        if (!(0, transferDocIdGuard_js_1.isSafeDocumentIdSegment)(location.locationId))
            return false;
        if (location.type === "WAREHOUSE") {
            const snap = await txn.get(db.collection(collections_js_1.WAREHOUSES_COLLECTION).doc(location.locationId));
            if (!snap.exists)
                return false;
            const parsed = (0, governedWarehouseValidation_js_1.validateGovernedWarehouse)(snap.data(), location.locationId);
            if (!parsed.valid)
                return false;
            return parsed.value.status === "ACTIVE";
        }
        if (location.type === "BIN") {
            // BIN-P6: the bin must be readable at the current schema and ACTIVE, and its GOVERNED parent
            // Warehouse -- the bin document's own warehouseId, never the id prefix or the code -- must be
            // ACTIVE too. A bin in a retired building is not a place stock can go.
            const binSnap = await txn.get(db.collection(binCommands_js_1.BINS_COLLECTION).doc(location.locationId));
            if (!binSnap.exists)
                return false;
            const bin = binSnap.data() ?? {};
            if (bin.schemaVersion !== binRegistry_js_1.BIN_SCHEMA_VERSION || bin.status !== "ACTIVE")
                return false;
            if (typeof bin.warehouseId !== "string" || !(0, transferDocIdGuard_js_1.isSafeDocumentIdSegment)(bin.warehouseId))
                return false;
            const whSnap = await txn.get(db.collection(collections_js_1.WAREHOUSES_COLLECTION).doc(bin.warehouseId));
            if (!whSnap.exists)
                return false;
            const parsed = (0, governedWarehouseValidation_js_1.validateGovernedWarehouse)(whSnap.data(), bin.warehouseId);
            return parsed.valid && parsed.value.status === "ACTIVE";
        }
        if (location.type === "MOBILE") {
            const snap = await txn.get(db.collection(truckRegistryRepository_js_1.MOBILE_LOCATIONS_COLLECTION).doc(location.locationId));
            if (!snap.exists)
                return false;
            try {
                const parsed = (0, truckRegistryRepository_js_1.mobileLocationFromFirestore)(snap.id, snap.data());
                return parsed.active === true;
            }
            catch (err) {
                // A malformed stored MOBILE location fails closed -- never trusted as active.
                if (err instanceof types_js_1.MalformedStoredRecordError)
                    return false;
                throw err;
            }
        }
        return false;
    };
}
/**
 * The Warehouse custody parent of a Transfer endpoint under Model A, or null for a truck. A BIN's parent
 * is read from its governed document. Used to refuse a "transfer" that never leaves its Warehouse.
 */
async function resolveTransferCustodyWarehouseId(txn, db, location) {
    if (location.type === "WAREHOUSE")
        return location.locationId;
    if (location.type !== "BIN" || !(0, transferDocIdGuard_js_1.isSafeDocumentIdSegment)(location.locationId))
        return null;
    const snap = await txn.get(db.collection(binCommands_js_1.BINS_COLLECTION).doc(location.locationId));
    if (!snap.exists)
        return null;
    const warehouseId = (snap.data() ?? {}).warehouseId;
    return typeof warehouseId === "string" && warehouseId !== "" ? warehouseId : null;
}
//# sourceMappingURL=transferLocationResolver.js.map