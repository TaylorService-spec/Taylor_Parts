"use strict";
// Receiving Phase-2 E1: the trusted Receiving CALLABLES (receiveInventoryStock, listReceivingLocationOptions)
// and their exact, sanitized request/response/error contracts. firebase-functions v2 onCall. The actor is
// derived ONLY from request.auth.uid; authorization is the merged governed resolver for the UNGRANTED
// inventory.stock.receive capability (so every real user is denied). The receive callable runs the pinned
// production composition (concrete §3A resolver); the option callable runs the merged trusted option
// service. Errors map to a bounded public HttpsError matrix -- no raw Firestore path/value/code/reason
// escapes. Handlers are exported for focused tests; the exported onCall symbols pin the real production
// wiring so no client can supply an actor, resolver, or audit seam.
Object.defineProperty(exports, "__esModule", { value: true });
exports.listReceivingLocationOptionsCallable = exports.receiveInventoryStockCallable = void 0;
exports.requireAuth = requireAuth;
exports.validateReceiveRequest = validateReceiveRequest;
exports.validateEmptyRequest = validateEmptyRequest;
exports.mapReceiveError = mapReceiveError;
exports.mapOptionsError = mapOptionsError;
exports.runReceiveInventoryStock = runReceiveInventoryStock;
exports.runListReceivingLocationOptions = runListReceivingLocationOptions;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const receiveInventoryStockComposition_js_1 = require("./receiveInventoryStockComposition.js");
const receiveInventoryStockCommand_js_1 = require("./receiveInventoryStockCommand.js");
const receivingTypes_js_1 = require("./receivingTypes.js");
const receivingLocationOptionsService_js_1 = require("../warehouseGovernance/receivingLocationOptionsService.js");
const receivingCallableWiring_js_1 = require("./receivingCallableWiring.js");
const REGION = { region: "us-central1" };
// -------- helpers --------
function isPlainObject(v) { return typeof v === "object" && v !== null && !Array.isArray(v); }
function isNonBlankString(v) { return typeof v === "string" && v.trim() !== ""; }
function isFiniteNumber(v) { return typeof v === "number" && Number.isFinite(v); }
function invalidArg(msg) { return new https_1.HttpsError("invalid-argument", msg); }
function noUnknownKeys(obj, allowed) { return Object.keys(obj).every((k) => allowed.has(k)); }
// Derive the trusted actor UID from the server-verified auth context ONLY (never request.data).
function requireAuth(request) {
    if (!request.auth || typeof request.auth.uid !== "string" || request.auth.uid.length === 0) {
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    }
    return request.auth.uid;
}
// -------- exact request contracts (structural -> invalid-argument) --------
const RECEIVE_TOP_KEYS = new Set(["source", "receivingLocation", "lines", "idempotencyKey"]);
const SOURCE_KEYS = new Set(["type", "reorderRequestId", "purchaseOrderId"]);
const LOCATION_KEYS = new Set(["type", "locationId"]);
// `serialNumbers` is permitted STRUCTURALLY here (SERIAL receipts, Wave 7). This layer only checks
// shape; whether serials are required, forbidden, correctly counted or duplicated is decided by the
// command's own validator against the AUTHORITATIVE Part tracking mode and PO ordered quantity, which
// this boundary cannot see. Omitting the key here silently broke SERIAL receiving end to end: this
// check runs BEFORE the command, so a well-formed serial payload was rejected as an unknown field.
const LINE_KEYS = new Set(["lineId", "partId", "expectedQuantity", "receivedQuantity", "serialNumbers"]);
// Validate the exact receive payload; any unknown/server-owned/actor field or wrong type is invalid-argument.
function validateReceiveRequest(data) {
    if (!isPlainObject(data))
        throw invalidArg("Request data must be an object.");
    if (!noUnknownKeys(data, RECEIVE_TOP_KEYS))
        throw invalidArg("The request has unknown fields.");
    const source = data.source;
    if (!isPlainObject(source) || !noUnknownKeys(source, SOURCE_KEYS))
        throw invalidArg("source is missing or has unknown fields.");
    if (source.type !== "REORDER_PURCHASE_ORDER")
        throw invalidArg("source.type is invalid.");
    if (!isNonBlankString(source.reorderRequestId))
        throw invalidArg("source.reorderRequestId is invalid.");
    if (!isNonBlankString(source.purchaseOrderId))
        throw invalidArg("source.purchaseOrderId is invalid.");
    const loc = data.receivingLocation;
    if (!isPlainObject(loc) || !noUnknownKeys(loc, LOCATION_KEYS))
        throw invalidArg("receivingLocation is missing or has unknown fields.");
    if (loc.type !== "WAREHOUSE")
        throw invalidArg("receivingLocation.type is invalid.");
    if (!isNonBlankString(loc.locationId))
        throw invalidArg("receivingLocation.locationId is invalid.");
    const lines = data.lines;
    // First slice: exactly one line. Empty or multiple lines are an invalid payload (invalid-argument),
    // rejected at the callable boundary before authorization or any Firestore read.
    if (!Array.isArray(lines) || lines.length !== 1)
        throw invalidArg("lines must contain exactly one line.");
    for (const line of lines) {
        if (!isPlainObject(line) || !noUnknownKeys(line, LINE_KEYS))
            throw invalidArg("a line is missing or has unknown fields.");
        if (!isNonBlankString(line.lineId))
            throw invalidArg("line.lineId is invalid.");
        if (!isNonBlankString(line.partId))
            throw invalidArg("line.partId is invalid.");
        if (!isFiniteNumber(line.expectedQuantity))
            throw invalidArg("line.expectedQuantity is invalid.");
        if (!isFiniteNumber(line.receivedQuantity))
            throw invalidArg("line.receivedQuantity is invalid.");
        // Shape only: when present it must be an array of non-blank strings. Count, duplication and
        // whether serials are required at all are the command's decisions, made against the authoritative
        // Part tracking mode -- this boundary must not second-guess them or it would fork the rule.
        if (line.serialNumbers !== undefined) {
            if (!Array.isArray(line.serialNumbers))
                throw invalidArg("line.serialNumbers is invalid.");
            if (!line.serialNumbers.every((s) => isNonBlankString(s)))
                throw invalidArg("line.serialNumbers is invalid.");
        }
    }
    if (!isNonBlankString(data.idempotencyKey))
        throw invalidArg("idempotencyKey is invalid.");
    return data;
}
// Options request must be the EXACT empty object {}. null/undefined/arrays/primitives/any keyed object
// are invalid-argument (the client must explicitly send {}).
function validateEmptyRequest(data) {
    if (!isPlainObject(data) || Object.keys(data).length > 0)
        throw invalidArg("This request takes no fields.");
}
// -------- error matrices (bounded, sanitized public codes) --------
function mapReceiveError(err) {
    if (err instanceof https_1.HttpsError)
        return err; // the structural invalid-argument we threw
    if (err instanceof receiveInventoryStockCommand_js_1.ReceiveCommandError) {
        const code = err.code === "PERMISSION_DENIED" ? "permission-denied"
            : err.code === "SOURCE_NOT_FOUND" ? "not-found"
                : err.code === "SOURCE_NOT_RECEIVABLE" ? "failed-precondition"
                    : err.code === "DESTINATION_INVALID" ? "failed-precondition"
                        : err.code === "PART_INVALID" ? "failed-precondition"
                            : "internal"; // RECEIVING_INTEGRITY / unknown -> internal
        const message = code === "permission-denied" ? "You are not authorized to receive stock."
            : code === "not-found" ? "The referenced source could not be found."
                : code === "failed-precondition" ? "The receipt is not currently permitted for the referenced source, destination, or part."
                    : "The receipt could not be completed.";
        return new https_1.HttpsError(code, message);
    }
    if (err instanceof receivingTypes_js_1.IdempotencyConflictError)
        return new https_1.HttpsError("failed-precondition", "This receipt conflicts with a prior request for the same key.");
    if (err instanceof receivingTypes_js_1.MalformedStoredRecordError)
        return new https_1.HttpsError("failed-precondition", "The stored receiving state is inconsistent.");
    if (err instanceof receivingTypes_js_1.InvalidReceivingError)
        return new https_1.HttpsError("invalid-argument", "The request is missing or has invalid fields.");
    return new https_1.HttpsError("internal", "The receipt could not be completed.");
}
function mapOptionsError(err) {
    if (err instanceof https_1.HttpsError)
        return err;
    if (err instanceof receivingLocationOptionsService_js_1.ReceivingLocationOptionsError) {
        const code = err.code === "INVALID_REQUEST" ? "invalid-argument"
            : err.code === "PERMISSION_DENIED" ? "permission-denied"
                : "internal"; // SOURCE_UNAVAILABLE / unknown -> internal
        const message = code === "invalid-argument" ? "This request takes no fields."
            : code === "permission-denied" ? "You are not authorized to list receiving locations."
                : "Receiving locations are temporarily unavailable.";
        return new https_1.HttpsError(code, message);
    }
    return new https_1.HttpsError("internal", "Receiving locations are temporarily unavailable.");
}
async function runReceiveInventoryStock(request, wiring) {
    const actorUid = requireAuth(request);
    const validated = validateReceiveRequest(request.data);
    try {
        const outcome = await (0, receiveInventoryStockComposition_js_1.receiveInventoryStockProduction)(validated, {
            db: wiring.db,
            actor: { kind: "USER", id: actorUid },
            authorize: (txn, actorId, _capability) => wiring.resolvePermission(txn, actorId),
            resolvePart: (txn, partId) => wiring.resolvePart(txn, partId),
            stageAudit: wiring.stageAudit,
            now: wiring.now,
        });
        // The callable's PUBLIC response stays exactly these three fields. The command's own outcome also
        // carries `ledgerEventIds` (and `serializedAssetIds` for a SERIAL receipt), but those are internal
        // detail: widening a deployed callable's response is a contract change in its own right, and a
        // client has no use for per-serial ids it cannot read anyway (serialized_assets is client-denied).
        // receivingCallablesEmulator.test.mjs pins this key set deliberately.
        return { outcome: outcome.outcome, receivingId: outcome.receivingId, ledgerEventId: outcome.ledgerEventId };
    }
    catch (err) {
        throw mapReceiveError(err);
    }
}
async function runListReceivingLocationOptions(request, wiring) {
    const actorUid = requireAuth(request);
    validateEmptyRequest(request.data);
    try {
        const options = await (0, receivingLocationOptionsService_js_1.listEligibleReceivingLocationOptions)({}, {
            actor: { kind: "USER", id: actorUid },
            authorize: (txn, actorId) => wiring.resolvePermission(txn, actorId),
            readCandidateWarehouses: async (txn) => {
                const snap = await txn.get(wiring.db.collection("warehouses"));
                return snap.docs.map((d) => ({ warehouseId: d.id, data: d.data() }));
            },
            runRead: (fn) => wiring.db.runTransaction(fn),
        });
        return { options };
    }
    catch (err) {
        throw mapOptionsError(err);
    }
}
// Real production wiring, built lazily at invocation (after initializeApp). Pins the governed resolver,
// Part authority, and immutable audit writer -- no client-supplied actor/resolver/audit seam.
function productionWiring() {
    const db = (0, firestore_1.getFirestore)();
    return {
        db,
        resolvePermission: (txn, actorId) => (0, receivingCallableWiring_js_1.resolveReceivePermissionThroughTxn)(txn, db, actorId),
        resolvePart: (txn, partId) => (0, receivingCallableWiring_js_1.resolveReceivePartThroughTxn)(txn, db, partId),
        stageAudit: receivingCallableWiring_js_1.stageReceiveAuditEvent,
        now: () => new Date(),
    };
}
exports.receiveInventoryStockCallable = (0, https_1.onCall)(REGION, (request) => runReceiveInventoryStock(request, productionWiring()));
exports.listReceivingLocationOptionsCallable = (0, https_1.onCall)(REGION, (request) => runListReceivingLocationOptions(request, productionWiring()));
//# sourceMappingURL=receivingCallables.js.map