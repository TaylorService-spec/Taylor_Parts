"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.probeSerializedAssetsPresentAtLocation = probeSerializedAssetsPresentAtLocation;
exports.probeSerializedAssetsReferencedAtLocation = probeSerializedAssetsReferencedAtLocation;
exports.probeNoneStockPresentAtLocation = probeNoneStockPresentAtLocation;
exports.probeLedgerReferencedAtLocation = probeLedgerReferencedAtLocation;
exports.buildMobileLocationGovernedInventoryProbe = buildMobileLocationGovernedInventoryProbe;
// Enterprise Inventory Phase 5 -- MOBILE-location (truck) governed-inventory-PRESENCE probes.
//
// WHY THIS FILE. `truckRegistryCommands.ts`'s `deactivateTruck` and `deleteTruckCreatedInError`
// each accept an INJECTED probe (`GovernedInventoryProbe` / `OperationalReferenceProbe`) that
// defaults to UNKNOWN because, at the time those commands were written, no governed authority
// could conclusively answer "is there inventory at this MOBILE location right now" or "has this
// MOBILE location ever been referenced by operational history." Enterprise Inventory Phase 4 (the
// Transfer operating authority, PR #1032) changed that for TWO of the governed authorities:
//   * serialized_assets carries a queryable scalar `currentLocationId` (serializedAssetReadService.ts),
//     kept in sync with custody at receive/completion by the Transfer command;
//   * inventory_transactions (schemaVersion 2 operational ledger records) carries a queryable
//     `location: { type, locationId }` map, written by the Transfer command's TRANSFER_OUT/TRANSFER_IN
//     effects (transferOrderCommand.ts) and by Receiving.
//
// This module builds REAL, conclusive probes over those two authorities. It creates NO new
// inventory-quantity store: every number here is a read-time reduction of the SAME single
// append-only ledger the rest of Enterprise Inventory already treats as the sole movement
// authority (transferOrderCommand.ts's own `computeNoneOnHandThroughTxn` documents the identical
// direction semantics for a per-PART query; this module queries the COMPLEMENTARY dimension --
// per-LOCATION -- because the truck-registry probes only have a locationId in hand, not a partId).
//
// WHAT REMAINS GENUINELY UNPROVABLE (documented, not silently resolved): a cycle count is an
// OBSERVATION and emits no movement -- the invariant stated in mobileLocationInventoryProjection.js
// ("CYCLE COUNT / RECONCILIATION IS AN OBSERVATION ONLY ... NEVER mutates or emits stock"). Only the
// manager-approved reconciliation moves stock, as a signed ADJUSTED. So a location whose true on-hand
// has drifted from the ledger-derived balance (e.g. an un-reconciled physical loss) will not be
// reflected here -- this probe reports what the LEDGER says, which is the only governed authority
// that exists, not physical ground truth.
//
// Every read is bounded to an EQUALITY filter (no orderBy, no composite index) on either
// `serialized_assets.currentLocationId` or `inventory_transactions.location.locationId` -- both are
// automatic single-field (including nested map-field) indexes; no firestore.indexes.json entry is
// required. All reads go through the caller's Transaction, so a concurrent write to either
// collection conflicts the commit exactly like every other injected probe in this repository.
const locationOnHand_js_1 = require("./locationOnHand.js");
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
// (RECEIVED/RETURNED/TRANSFER_IN +; TRANSFER_OUT/SCRAPPED -; ADJUSTED already signed), but it
// queries by `location.locationId` (a single equality filter) rather
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
            // One sign rule, from locationOnHand.ts. A technician consuming from their truck (Decision #171)
            // now reduces the truck's presence, which the previous hand-written branches missed.
            balanceByPart.set(v.partId, prior + (0, locationOnHand_js_1.signedQuantity)(v));
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