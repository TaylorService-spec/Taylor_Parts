"use strict";
// Consumption source options — the TRUSTED read. Admin SDK, command-scoped, grants nothing.
//
// This is the read that lets a technician answer "where did this part come from" without being given
// any standing ability to look at inventory. It reads `warehouses`, `mobile_locations`, `trucks` and
// `bin_placements` under the Admin SDK, and returns location IDENTITIES for one Work Order, one part,
// one actor. Firestore Rules are unchanged; a test asserts that.
//
// THE ACTOR BOUNDARY IS THE SAME ONE THAT RECORDS USAGE. If a principal may not record execution data
// for this Work Order, they may not enumerate its sources either — otherwise this read would become a
// way to probe locations from outside the workflow it exists to serve.
Object.defineProperty(exports, "__esModule", { value: true });
exports.MOBILE_LOCATIONS_COLLECTION = exports.TRUCKS_COLLECTION = exports.WAREHOUSES_COLLECTION = exports.BIN_PLACEMENTS_COLLECTION = void 0;
exports.readActiveWarehouses = readActiveWarehouses;
exports.readAssignedMobileLocation = readAssignedMobileLocation;
exports.readPlacementsForWorkOrder = readPlacementsForWorkOrder;
exports.readConsumptionTrackingModes = readConsumptionTrackingModes;
exports.readSerializedCustody = readSerializedCustody;
exports.resolveConsumptionSourceOptions = resolveConsumptionSourceOptions;
exports.readWorkOrderForSourceLookup = readWorkOrderForSourceLookup;
const collections_js_1 = require("../constants/collections.js");
const consumptionSource_js_1 = require("./consumptionSource.js");
const consumptionSourceOptions_js_1 = require("./consumptionSourceOptions.js");
const types_js_1 = require("../serializedAsset/types.js");
const partMasterRepository_js_1 = require("../partMaster/partMasterRepository.js");
const consumptionPartTracking_js_1 = require("./consumptionPartTracking.js");
exports.BIN_PLACEMENTS_COLLECTION = "bin_placements";
exports.WAREHOUSES_COLLECTION = "warehouses";
exports.TRUCKS_COLLECTION = "trucks";
exports.MOBILE_LOCATIONS_COLLECTION = "mobile_locations";
const SERIALIZED_ASSETS_COLLECTION = "serialized_assets";
/**
 * ACTIVE warehouses, resolved with the SAME predicate the availability authority uses.
 *
 * `status == "ACTIVE"`, exactly as allocateSalesOrder resolves its eligible pool. Deliberately the
 * same rule rather than a similar one: a warehouse that cannot hold sellable stock must not be
 * offerable as a source, and two definitions of "eligible" would eventually disagree.
 */
async function readActiveWarehouses(db, txn) {
    const query = db.collection(exports.WAREHOUSES_COLLECTION).where("status", "==", "ACTIVE");
    const snap = txn ? await txn.get(query) : await query.get();
    return snap.docs.map((d) => {
        const data = d.data() ?? {};
        return { warehouseId: d.id, name: typeof data.name === "string" ? data.name : null, status: "ACTIVE" };
    });
}
/**
 * The technician's OWN governed truck, or null.
 *
 * `trucks.assignedDriverEmployeeId == technicianId`, which is the existing driver authority — one
 * truck per driver, enforced by the Truck Registry.
 *
 * TWO TRUCKS IS FAIL-CLOSED, NOT "PICK ONE". The registry promises one; if the data says otherwise
 * the promise is broken, and choosing arbitrarily would let a defect become a silent inventory
 * misattribution. No option is offered, and the caller can surface it.
 *
 * This authorizes the truck to APPEAR AS AN OPTION. It never infers that a part came from it —
 * the technician still selects it.
 */
async function readAssignedMobileLocation(db, technicianId, txn) {
    const query = db.collection(exports.TRUCKS_COLLECTION).where("assignedDriverEmployeeId", "==", technicianId);
    const snap = txn ? await txn.get(query) : await query.get();
    if (snap.empty)
        return { mobile: null, ambiguous: false };
    if (snap.docs.length > 1)
        return { mobile: null, ambiguous: true };
    const data = snap.docs[0].data() ?? {};
    const locationId = typeof data.locationId === "string" && data.locationId.trim().length > 0 ? data.locationId.trim() : null;
    if (locationId === null)
        return { mobile: null, ambiguous: true };
    // An out-of-service truck is not a place stock may be consumed from.
    if (typeof data.status === "string" && data.status !== "ACTIVE")
        return { mobile: null, ambiguous: false };
    return {
        mobile: {
            locationId,
            label: typeof data.displayLabel === "string" ? data.displayLabel : (typeof data.vehicleNumber === "string" ? data.vehicleNumber : null),
            truckId: snap.docs[0].id,
        },
        ambiguous: false,
    };
}
/** Placements picked FOR THIS WORK ORDER. Single-field equality, so no composite index is needed. */
async function readPlacementsForWorkOrder(db, workOrderId, txn) {
    const query = db.collection(exports.BIN_PLACEMENTS_COLLECTION).where("pickedForWorkOrderId", "==", workOrderId);
    const snap = txn ? await txn.get(query) : await query.get();
    return snap.docs
        .map((d) => d.data() ?? {})
        .filter((p) => typeof p.warehouseId === "string" && typeof p.partId === "string")
        .map((p) => ({
        warehouseId: p.warehouseId,
        partId: p.partId,
        quantity: typeof p.quantity === "number" ? p.quantity : 0,
        pickedForWorkOrderId: workOrderId,
    }));
}
/**
 * THE PART AUTHORITY for a set of part ids, as tracking modes.
 *
 * How a part is counted is the Part's fact. This read exists because Work Order usage capture used
 * to answer that question twice without ever asking: the writer hardcoded "NONE" and the callable
 * took it off the request. See consumptionPartTracking.ts for what that cost.
 *
 * A part id ABSENT from the returned map means no Part document was found — deliberately distinct
 * from "found, and quantity-tracked", so the caller can tell silence from an answer. Pass the
 * enclosing transaction when one is open: these are reads, and they must land in the caller's
 * reads-before-writes window.
 */
async function readConsumptionTrackingModes(db, partIds, txn) {
    const unique = [
        ...new Set(partIds.filter((id) => typeof id === "string" && id.trim().length > 0).map((id) => id.trim())),
    ];
    const modes = new Map();
    for (const partId of unique) {
        const ref = db.collection(partMasterRepository_js_1.PARTS_COLLECTION).doc(partId);
        const snap = txn ? await txn.get(ref) : await ref.get();
        if (!snap.exists)
            continue;
        modes.set(partId, (0, consumptionPartTracking_js_1.trackingModeFromStoredControlType)((snap.data() ?? {}).controlType));
    }
    return modes;
}
/** A serialized unit's governed custody. Null when unknown — which #168 fails closed on. */
async function readSerializedCustody(db, partId, serialNo, txn) {
    const snap = txn
        ? await txn.get(db.collection(SERIALIZED_ASSETS_COLLECTION).where("partId", "==", partId).where("serialNo", "==", serialNo))
        : await db.collection(SERIALIZED_ASSETS_COLLECTION).where("partId", "==", partId).where("serialNo", "==", serialNo).get();
    if (snap.empty || snap.docs.length > 1)
        return null;
    const data = snap.docs[0].data() ?? {};
    // THE TYPED PAIR, OR NOTHING. This used to default a missing type to "WAREHOUSE" -- and since no
    // writer stamped the field, the default was taken every time, including for a unit relocated into a
    // BIN (stockRelocationCommand writes the bin id into currentLocationId). Work-Order consumption was
    // therefore told "WAREHOUSE <bin id>": a location that does not exist, asserted with confidence.
    //
    // The default is gone. An unstamped or unrecognized type is an UNKNOWN custody, and unknown custody
    // is exactly the case resolveConsumptionSource already refuses (SERIAL_CUSTODY_UNKNOWN, "letting
    // someone assert a location would fabricate history"). Returning null hands it that case instead of
    // manufacturing an answer -- the refusal path is reached honestly rather than being unreachable.
    return (0, types_js_1.readSerializedCustodyPair)(data);
}
/**
 * Resolve the option set for one (work order, part, actor).
 *
 * Composes #168's resolver for the pick decision rather than re-deciding it here — ambiguity and
 * insufficiency are its rules, and a second implementation in a read path would eventually disagree
 * with the write path that actually refuses.
 */
async function resolveConsumptionSourceOptions(db, lookup, txn) {
    const [warehouses, mobileResult, placements] = await Promise.all([
        readActiveWarehouses(db, txn),
        readAssignedMobileLocation(db, lookup.technicianId, txn),
        readPlacementsForWorkOrder(db, lookup.workOrderId, txn),
    ]);
    const governedLocations = [
        ...warehouses.map((w) => ({ type: "WAREHOUSE", locationId: w.warehouseId })),
        ...(mobileResult.mobile === null ? [] : [{ type: "MOBILE", locationId: mobileResult.mobile.locationId }]),
    ];
    const serializedCurrentLocation = lookup.trackingMode === "SERIAL" && typeof lookup.serialNo === "string" && lookup.serialNo.trim().length > 0
        ? await readSerializedCustody(db, lookup.partId, lookup.serialNo.trim(), txn)
        : null;
    // The pick decision, made ONCE, by the authority that owns it.
    const picked = (0, consumptionSource_js_1.resolveConsumptionSource)({
        workOrderId: lookup.workOrderId,
        partId: lookup.partId,
        requestedQuantity: lookup.requestedQuantity,
        trackingMode: lookup.trackingMode,
        serializedCurrentLocation,
        governedLocations,
        placements,
    });
    const projected = (0, consumptionSourceOptions_js_1.projectConsumptionSourceOptions)({
        trackingMode: lookup.trackingMode,
        pickedSource: picked.resolved && picked.source.basis === "PICKED_PLACEMENT"
            ? { locationId: picked.source.locationId, locationType: picked.source.locationType }
            : null,
        pickUnavailableReason: picked.resolved ? null : picked.reason,
        serializedCurrentLocation: serializedCurrentLocation === null
            ? null
            : { locationId: serializedCurrentLocation.locationId, locationType: serializedCurrentLocation.type },
        warehouses,
        mobile: mobileResult.mobile,
    });
    return Object.freeze({ ...projected, mobileAmbiguous: mobileResult.ambiguous });
}
/** The Work Order's own record, for the ownership check the callable performs. */
async function readWorkOrderForSourceLookup(db, workOrderId) {
    const snap = await db.collection(collections_js_1.WORK_ORDERS_COLLECTION).doc(workOrderId).get();
    return snap.exists ? snap.data() : null;
}
//# sourceMappingURL=consumptionSourceService.js.map