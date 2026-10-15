"use strict";
// listMyReceivableTransfers -- the ONE command-scoped read that lets a technician find the Transfer they
// are about to receive onto their own truck.
//
// WHY IT EXISTS. The handheld Transfer screen listed orders from a client `transfer_orders` read that
// Rules admit only to admin/dispatcher and assigned warehouse managers. A technician holding
// inventory.transfer.receive could therefore RECEIVE but never SEE the order to receive -- an unusable
// grant. Rules are NOT widened; this trusted read answers exactly one question instead:
//
//   "Which IN_TRANSIT Transfers are destined for the authenticated caller's own governed truck?"
//
// IT GRANTS NOTHING STANDING. It is authorized by inventory.transfer.receive through the SAME resolver
// receiveTransferOrder uses, so it can only reveal work the same principal may attempt to receive. The
// receipt itself still goes through receiveTransferOrder, which re-authorizes and re-derives everything.
//
// NOTHING IS CALLER-SCOPED. The request carries no employee, truck, destination, status or filter --
// the caller is auth.uid, the technician is users/{uid}.technicianId, and the truck is the Truck
// Registry's own driver assignment (readAssignedMobileLocation, the resolver Work Order consumption
// already uses; one interpretation of "my truck", not two). Another technician's truck is therefore
// structurally unreachable: there is no input that names it.
//
// NO INVENTORY VISIBILITY. The projection is an allow-list of the order's own fields. No balance,
// availability, other serialized units, actors or audit metadata.
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReceivableReadError = exports.RECEIVABLE_STATUS = exports.RECEIVABLE_PAGE_MAX = exports.TRANSFER_ORDERS_COLLECTION = void 0;
exports.receivableProjection = receivableProjection;
exports.listMyReceivableTransfers = listMyReceivableTransfers;
const firestore_1 = require("firebase-admin/firestore");
const consumptionSourceService_js_1 = require("../workOrderConsumption/consumptionSourceService.js");
const transferOrderRepository_js_1 = require("./transferOrderRepository.js");
const transferDocIdGuard_js_1 = require("./transferDocIdGuard.js");
exports.TRANSFER_ORDERS_COLLECTION = "transfer_orders";
exports.RECEIVABLE_PAGE_MAX = 50;
/** The only lifecycle state receiveTransferOrder accepts (IN_TRANSIT -> COMPLETED). */
exports.RECEIVABLE_STATUS = "IN_TRANSIT";
class ReceivableReadError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "ReceivableReadError";
    }
}
exports.ReceivableReadError = ReceivableReadError;
/** The allow-listed projection: what the handheld needs to render and verify one receipt. Nothing else. */
function receivableProjection(o) {
    return {
        transferOrderId: o.transferOrderId,
        ...(o.transferOrderNumber === undefined ? {} : { transferOrderNumber: o.transferOrderNumber }),
        partId: o.value.partId,
        trackingMode: o.value.trackingMode,
        quantity: o.value.quantity,
        ...(o.value.serialNumbers === undefined ? {} : { serialNumbers: [...o.value.serialNumbers] }),
        origin: { type: o.value.origin.type, locationId: o.value.origin.locationId },
        destination: { type: o.value.destination.type, locationId: o.value.destination.locationId },
        status: o.status,
    };
}
function validateRequest(data) {
    if (data === undefined || data === null)
        return { cursor: null };
    if (typeof data !== "object" || Array.isArray(data))
        throw new ReceivableReadError("READ_INVALID", "request must be an object");
    const obj = data;
    // Only a cursor. employeeId / truckId / destination / status / filters are server facts and are refused.
    if (Object.keys(obj).some((k) => k !== "cursor"))
        throw new ReceivableReadError("READ_INVALID", "request has unknown fields");
    if (obj.cursor === undefined || obj.cursor === null)
        return { cursor: null };
    if (typeof obj.cursor !== "string" || !(0, transferDocIdGuard_js_1.isSafeDocumentIdSegment)(obj.cursor))
        throw new ReceivableReadError("READ_INVALID", "cursor invalid");
    return { cursor: obj.cursor };
}
async function listMyReceivableTransfers(actorUid, data, deps) {
    const { cursor } = validateRequest(data);
    const { db } = deps;
    return db.runTransaction(async (txn) => {
        // Authority first: an unauthorized caller learns nothing about identities or trucks.
        if (!(await deps.resolveReceivePermission(txn, actorUid))) {
            throw new ReceivableReadError("PERMISSION_DENIED", "not authorized to receive transfers");
        }
        const userSnap = await txn.get(db.collection("users").doc(actorUid));
        const technicianId = userSnap.exists ? (userSnap.data() ?? {}).technicianId : undefined;
        if (typeof technicianId !== "string" || technicianId.trim() === "") {
            throw new ReceivableReadError("TECHNICIAN_IDENTITY_UNAVAILABLE", "this account has no technician mapping");
        }
        const { mobile, ambiguous } = await (0, consumptionSourceService_js_1.readAssignedMobileLocation)(db, technicianId, txn);
        // Two trucks is a broken one-driver-one-truck promise: fail closed, never pick one.
        if (ambiguous)
            throw new ReceivableReadError("TRUCK_ASSIGNMENT_AMBIGUOUS", "truck assignment is ambiguous");
        if (mobile === null)
            throw new ReceivableReadError("NO_TRUCK_ASSIGNMENT", "no active truck is assigned");
        // Equality filters only, ordered by document id: served by the automatic single-field indexes.
        let q = db.collection(exports.TRANSFER_ORDERS_COLLECTION)
            .where("destination.type", "==", "MOBILE")
            .where("destination.locationId", "==", mobile.locationId)
            .where("status", "==", exports.RECEIVABLE_STATUS)
            .orderBy(firestore_1.FieldPath.documentId())
            .limit(exports.RECEIVABLE_PAGE_MAX + 1);
        if (cursor)
            q = q.startAfter(cursor);
        const snap = await txn.get(q);
        const docs = snap.docs.slice(0, exports.RECEIVABLE_PAGE_MAX);
        let orders;
        try {
            orders = docs.map((d) => (0, transferOrderRepository_js_1.deserializeTransferOrder)(d.id, d.data()));
        }
        catch {
            // Fails closed: a malformed order is never shown half-read, and never silently dropped as "no work".
            throw new ReceivableReadError("MALFORMED_STORED_RECORD", "a stored transfer order is malformed");
        }
        // Belt and braces: the query decided scope; the deserialized record must agree with it.
        for (const o of orders) {
            if (o.status !== exports.RECEIVABLE_STATUS || o.value.destination.type !== "MOBILE" || o.value.destination.locationId !== mobile.locationId) {
                throw new ReceivableReadError("MALFORMED_STORED_RECORD", "a stored transfer order disagrees with its index");
            }
        }
        return {
            truck: { locationId: mobile.locationId, label: mobile.label },
            transfers: orders.map(receivableProjection),
            nextCursor: snap.docs.length > exports.RECEIVABLE_PAGE_MAX ? docs[docs.length - 1].id : null,
        };
    }, { readOnly: true });
}
//# sourceMappingURL=transferReceivableRead.js.map