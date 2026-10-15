"use strict";
// Enterprise Inventory Phase 4 -- the trusted transfer CALLABLES (createTransferOrder,
// dispatchTransferOrder, receiveTransferOrder, cancelTransferOrder) and their exact, sanitized
// request/response/error contracts. firebase-functions v2 onCall. Mirrors receivingCallables.ts. The
// actor is derived ONLY from request.auth.uid; authorization is the merged governed resolver for each
// UNGRANTED inventory.transfer.* capability (active: false), so every real user is denied until a
// separate grant + activation gate. No production caller can supply an actor, resolver, or audit seam.
Object.defineProperty(exports, "__esModule", { value: true });
exports.cancelTransferOrderCallable = exports.receiveTransferOrderCallable = exports.dispatchTransferOrderCallable = exports.createTransferOrderCallable = void 0;
exports.runCreateTransferOrder = runCreateTransferOrder;
exports.runDispatchTransferOrder = runDispatchTransferOrder;
exports.runReceiveTransferOrder = runReceiveTransferOrder;
exports.runCancelTransferOrder = runCancelTransferOrder;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const transferCommandComposition_js_1 = require("./transferCommandComposition.js");
const transferOrderTypes_js_1 = require("./transferOrderTypes.js");
const transferCallableWiring_js_1 = require("./transferCallableWiring.js");
const REGION = { region: "us-central1" };
function isPlainObject(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isNonBlankString(v) {
    return typeof v === "string" && v.trim() !== "";
}
function isFiniteNumber(v) {
    return typeof v === "number" && Number.isFinite(v);
}
function invalidArg(msg) {
    return new https_1.HttpsError("invalid-argument", msg);
}
function noUnknownKeys(obj, allowed) {
    return Object.keys(obj).every((k) => allowed.has(k));
}
function requireAuth(request) {
    if (!request.auth || typeof request.auth.uid !== "string" || request.auth.uid.length === 0) {
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    }
    return request.auth.uid;
}
// -------- CREATE request contract --------
const CREATE_KEYS = new Set(["partId", "quantity", "origin", "destination", "serialNumbers", "idempotencyKey"]);
const LOCATION_KEYS = new Set(["type", "locationId"]);
function validateLocationShape(loc, field) {
    if (!isPlainObject(loc) || !noUnknownKeys(loc, LOCATION_KEYS))
        throw invalidArg(`${field} is missing or has unknown fields.`);
    if (loc.type !== "WAREHOUSE" && loc.type !== "MOBILE")
        throw invalidArg(`${field}.type is invalid.`);
    if (!isNonBlankString(loc.locationId))
        throw invalidArg(`${field}.locationId is invalid.`);
}
function validateCreateRequest(data) {
    if (!isPlainObject(data))
        throw invalidArg("Request data must be an object.");
    if (!noUnknownKeys(data, CREATE_KEYS))
        throw invalidArg("The request has unknown fields.");
    if (!isNonBlankString(data.partId))
        throw invalidArg("partId is invalid.");
    if (!isFiniteNumber(data.quantity))
        throw invalidArg("quantity is invalid.");
    validateLocationShape(data.origin, "origin");
    validateLocationShape(data.destination, "destination");
    if (data.serialNumbers !== undefined) {
        if (!Array.isArray(data.serialNumbers) || !data.serialNumbers.every((s) => isNonBlankString(s)))
            throw invalidArg("serialNumbers is invalid.");
    }
    if (!isNonBlankString(data.idempotencyKey))
        throw invalidArg("idempotencyKey is invalid.");
    return data;
}
// -------- transferOrderId-only request contract (dispatch/receive/cancel) --------
const ID_ONLY_KEYS = new Set(["transferOrderId"]);
function validateIdOnlyRequest(data) {
    if (!isPlainObject(data))
        throw invalidArg("Request data must be an object.");
    if (!noUnknownKeys(data, ID_ONLY_KEYS))
        throw invalidArg("The request has unknown fields.");
    if (!isNonBlankString(data.transferOrderId))
        throw invalidArg("transferOrderId is invalid.");
    return data;
}
// -------- sanitized error matrix --------
function mapTransferError(err) {
    if (err instanceof https_1.HttpsError)
        return err;
    if (err instanceof transferOrderTypes_js_1.TransferCommandError) {
        const code = mapCode(err.code);
        const message = code === "permission-denied" ? "You are not authorized to perform this transfer action."
            : code === "not-found" ? "The transfer order could not be found."
                : code === "failed-precondition" ? "This transfer action is not currently permitted."
                    : "The transfer action could not be completed.";
        return new https_1.HttpsError(code, message);
    }
    return new https_1.HttpsError("internal", "The transfer action could not be completed.");
}
function mapCode(code) {
    switch (code) {
        case "PERMISSION_DENIED":
            return "permission-denied";
        case "TRANSFER_NOT_FOUND":
            return "not-found";
        case "ORIGIN_INVALID":
        case "DESTINATION_INVALID":
        case "SAME_LOCATION":
        case "PART_INVALID":
        case "SERIAL_INVALID":
        case "INSUFFICIENT_STOCK":
        case "STATUS_INVALID":
        case "IDEMPOTENCY_CONFLICT":
        case "MALFORMED_STORED_RECORD":
            return "failed-precondition";
        default:
            return "internal"; // TRANSFER_INTEGRITY / unknown
    }
}
async function runCreateTransferOrder(request, wiring) {
    const actorUid = requireAuth(request);
    const validated = validateCreateRequest(request.data);
    try {
        const outcome = await (0, transferCommandComposition_js_1.createTransferOrderProduction)(validated, {
            db: wiring.db,
            actor: { kind: "USER", id: actorUid },
            authorize: (txn, actorId) => wiring.resolveCreatePermission(txn, actorId),
            resolvePart: wiring.resolvePart,
            stageAudit: wiring.stageAudit,
            now: wiring.now,
        });
        return { outcome: outcome.outcome, transferOrderId: outcome.transferOrderId };
    }
    catch (err) {
        throw mapTransferError(err);
    }
}
async function runDispatchTransferOrder(request, wiring) {
    const actorUid = requireAuth(request);
    const validated = validateIdOnlyRequest(request.data);
    try {
        const outcome = await (0, transferCommandComposition_js_1.dispatchTransferOrderProduction)(validated, {
            db: wiring.db,
            actor: { kind: "USER", id: actorUid },
            authorize: (txn, actorId) => wiring.resolveDispatchPermission(txn, actorId),
            resolvePart: wiring.resolvePart,
            stageAudit: wiring.stageAudit,
            now: wiring.now,
        });
        return { outcome: outcome.outcome, transferOrderId: outcome.transferOrderId };
    }
    catch (err) {
        throw mapTransferError(err);
    }
}
async function runReceiveTransferOrder(request, wiring) {
    const actorUid = requireAuth(request);
    const validated = validateIdOnlyRequest(request.data);
    try {
        const outcome = await (0, transferCommandComposition_js_1.receiveTransferOrderProduction)(validated, {
            db: wiring.db,
            actor: { kind: "USER", id: actorUid },
            authorize: (txn, actorId) => wiring.resolveReceivePermission(txn, actorId),
            resolvePart: wiring.resolvePart,
            stageAudit: wiring.stageAudit,
            now: wiring.now,
        });
        return { outcome: outcome.outcome, transferOrderId: outcome.transferOrderId };
    }
    catch (err) {
        throw mapTransferError(err);
    }
}
async function runCancelTransferOrder(request, wiring) {
    const actorUid = requireAuth(request);
    const validated = validateIdOnlyRequest(request.data);
    try {
        const outcome = await (0, transferCommandComposition_js_1.cancelTransferOrderProduction)(validated, {
            db: wiring.db,
            actor: { kind: "USER", id: actorUid },
            authorize: (txn, actorId) => wiring.resolveCancelPermission(txn, actorId),
            resolvePart: wiring.resolvePart,
            stageAudit: wiring.stageAudit,
            now: wiring.now,
        });
        return { outcome: outcome.outcome, transferOrderId: outcome.transferOrderId };
    }
    catch (err) {
        throw mapTransferError(err);
    }
}
function productionWiring() {
    const db = (0, firestore_1.getFirestore)();
    return {
        db,
        resolveCreatePermission: (txn, actorId) => (0, transferCallableWiring_js_1.makeResolveTransferPermissionThroughTxn)("inventory.transfer.create")(txn, db, actorId),
        resolveDispatchPermission: (txn, actorId) => (0, transferCallableWiring_js_1.makeResolveTransferPermissionThroughTxn)("inventory.transfer.dispatch")(txn, db, actorId),
        resolveReceivePermission: (txn, actorId) => (0, transferCallableWiring_js_1.makeResolveTransferPermissionThroughTxn)("inventory.transfer.receive")(txn, db, actorId),
        resolveCancelPermission: (txn, actorId) => (0, transferCallableWiring_js_1.makeResolveTransferPermissionThroughTxn)("inventory.transfer.cancel")(txn, db, actorId),
        resolvePart: (txn, partId) => (0, transferCallableWiring_js_1.resolveTransferPartThroughTxn)(txn, db, partId),
        stageAudit: transferCallableWiring_js_1.stageTransferAuditEvent,
        now: () => new Date(),
    };
}
exports.createTransferOrderCallable = (0, https_1.onCall)(REGION, (request) => runCreateTransferOrder(request, productionWiring()));
exports.dispatchTransferOrderCallable = (0, https_1.onCall)(REGION, (request) => runDispatchTransferOrder(request, productionWiring()));
exports.receiveTransferOrderCallable = (0, https_1.onCall)(REGION, (request) => runReceiveTransferOrder(request, productionWiring()));
exports.cancelTransferOrderCallable = (0, https_1.onCall)(REGION, (request) => runCancelTransferOrder(request, productionWiring()));
//# sourceMappingURL=transferCallables.js.map