"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.probeSerializedAssetsPresentAtLocation = probeSerializedAssetsPresentAtLocation;
exports.probeSerializedAssetsReferencedAtLocation = probeSerializedAssetsReferencedAtLocation;
exports.probeNoneStockPresentAtLocation = probeNoneStockPresentAtLocation;
exports.probeLedgerReferencedAtLocation = probeLedgerReferencedAtLocation;
exports.buildMobileLocationGovernedInventoryProbe = buildMobileLocationGovernedInventoryProbe;
const collections_js_1 = require("../constants/collections.js");
const operationalMovementRepository_js_1 = require("./operationalMovementRepository.js");
const MOBILE = "MOBILE";
// ---- serialized-asset presence: any serialized_assets doc currently custodied at this location ----
// (INSTALLED units are customer equipment, never MOBILE-location inventory -- see
// serializedAssetInventoryLocation.js's validateSerializedAssetInventoryRow, which this mirrors for the
// backend by excluding state === "INSTALLED" defensively even though an INSTALLED unit's
// currentLocationId is not expected to be a mobile_locations id.)
async function probeSerializedAssetsPresentAtLocation(txn, db, locationId) {
    try {
        const snap = await txn.get(db.collection(collections_js_1.SERIALIZED_ASSETS_COLLECTION).where("currentLocationId", "==", locationId).limit(25));
        for (const doc of snap.docs) {
            const data = doc.data();
            // The canonical stored field is `inventoryState` (serializedAsset/types.ts), NOT `state`.
            if (data && data.inventoryState !== "INSTALLED")
                return "PRESENT";
        }
        return "ABSENT";
    }
    catch {
        return "UNKNOWN"; // permission/config/transport failure -- inconclusive -> fail closed
    }
}
// ---- serialized-asset REFERENCE: has this location EVER custodied a serialized asset (any state) ----
// Distinct question from presence-now: used by the delete-safety reference probe, where even a unit
// that has since moved on still means the truck's history is not empty.
async function probeSerializedAssetsReferencedAtLocation(txn, db, locationId) {
    try {
        const snap = await txn.get(db.collection(collections_js_1.SERIALIZED_ASSETS_COLLECTION).where("currentLocationId", "==", locationId).limit(1));
        return snap.empty ? "ABSENT" : "PRESENT";
    }
    catch {
        return "UNKNOWN";
    }
}
// ---- NONE-mode ledger net balance at a location, summed per partId ----
// Mirrors transferOrderCommand.ts's computeNoneOnHandThroughTxn direction semantics exactly
// (RECEIVED/RETURNED/TRANSFER_IN +; TRANSFER_OUT/SCRAPPED -; ADJUSTED already signed; COUNTED
// excluded as an observation), but queries by `location.locationId` (a single equality filter) rather
// than `partId`, then groups by partId in memory -- the complementary access pattern this probe needs.
async function probeNoneStockPresentAtLocation(txn, db, locationId) {
    try {
        const snap = await txn.get(db.collection(collections_js_1.INVENTORY_TRANSACTIONS_COLLECTION).where("location.locationId", "==", locationId));
        const balanceByPart = new Map();
        for (const doc of snap.docs) {
            const data = doc.data();
            if ((0, operationalMovementRepository_js_1.classifyLedgerDoc)(data) !== "operational")
                continue;
            let mv;
            try {
                mv = (0, operationalMovementRepository_js_1.deserializeOperationalMovement)(data);
            }
            catch {
                continue; // a malformed operational record is skipped, not trusted -- never inflates balance
            }
            const v = mv.value;
            if (v.location.type !== MOBILE || v.location.locationId !== locationId)
                continue; // defensive re-check
            if (v.trackingMode !== "NONE")
                continue; // SERIAL custody is authoritative via serialized_assets
            const prior = balanceByPart.get(v.partId) ?? 0;
            if (v.type === "RECEIVED" || v.type === "RETURNED" || v.type === "TRANSFER_IN") {
                balanceByPart.set(v.partId, prior + v.quantity);
            }
            else if (v.type === "TRANSFER_OUT" || v.type === "SCRAPPED") {
                balanceByPart.set(v.partId, prior - v.quantity);
            }
            else if (v.type === "ADJUSTED") {
                balanceByPart.set(v.partId, prior + v.quantity); // ADJUSTED is already signed (direction SIGNED)
            }
            // COUNTED: excluded -- observation only, never balance-affecting (governance invariant).
        }
        for (const balance of balanceByPart.values()) {
            if (balance > 0)
                return "PRESENT";
        }
        return "ABSENT";
    }
    catch {
        return "UNKNOWN";
    }
}
// ---- ledger REFERENCE: has ANY operational movement (any type/direction/trackingMode) ever
// occurred at this location, regardless of current balance ----
async function probeLedgerReferencedAtLocation(txn, db, locationId) {
    try {
        const snap = await txn.get(db.collection(collections_js_1.INVENTORY_TRANSACTIONS_COLLECTION).where("location.locationId", "==", locationId).limit(1));
        return snap.empty ? "ABSENT" : "PRESENT";
    }
    catch {
        return "UNKNOWN";
    }
}
// ---- combined CURRENT-presence probe (matches truckRegistryCommands.ts's GovernedInventoryProbe
// signature: (locationId, txn) => Promise<InventoryPresence>). SERIAL presence dominates (a truck
// carrying even one serialized unit is not empty); otherwise the NONE-mode ledger balance decides;
// UNKNOWN from either axis fails the whole probe closed -- ABSENT is returned ONLY when BOTH axes
// are conclusively empty. ----
function buildMobileLocationGovernedInventoryProbe(db) {
    return async function hasGovernedInventoryAtLocation(locationId, txn) {
        const serial = await probeSerializedAssetsPresentAtLocation(txn, db, locationId);
        if (serial === "PRESENT")
            return "PRESENT";
        const stock = await probeNoneStockPresentAtLocation(txn, db, locationId);
        if (stock === "PRESENT")
            return "PRESENT";
        if (serial === "UNKNOWN" || stock === "UNKNOWN")
            return "UNKNOWN";
        return "ABSENT";
    };
}
//# sourceMappingURL=mobileLocationPresenceProbe.js.map