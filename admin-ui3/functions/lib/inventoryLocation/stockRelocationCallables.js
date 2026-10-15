"use strict";
// relocateStock -- the callable over the BIN-P6 relocation authority (stockRelocationCommand.ts).
//
// Authorization and Part resolution are the SAME through-transaction resolvers the Transfer commands use
// (transferCallableWiring.ts). Relocation is a sibling movement authority, and two implementations of
// "may this principal do this, as of this transaction" would eventually disagree.
//
// Every failure keeps its own detail token (spec §5.5). A warehouse operator reading "line 7 failed"
// needs to know whether to fix the count, walk to another bin, or use a Transfer instead -- and a
// technical failure must be distinguishable from a business refusal, because only the first is retried.
Object.defineProperty(exports, "__esModule", { value: true });
exports.listStockMovementLocationsCallable = exports.relocateStockCallable = void 0;
exports.stageRelocationAuditEvent = stageRelocationAuditEvent;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const auditEventWriter_js_1 = require("../access/auditEventWriter.js");
const transferCallableWiring_js_1 = require("../inventoryTransfer/transferCallableWiring.js");
const stockRelocationCommand_js_1 = require("./stockRelocationCommand.js");
const receivingLocationOptionsService_js_1 = require("../warehouseGovernance/receivingLocationOptionsService.js");
const collections_js_1 = require("../constants/collections.js");
const REGION = { region: "us-central1" };
function requireAuth(request) {
    if (!request.auth || typeof request.auth.uid !== "string" || request.auth.uid.length === 0) {
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.", "UNAUTHENTICATED");
    }
    return request.auth.uid;
}
const resolverByCapability = new Map();
async function authorizeThroughTxn(txn, db, actorId, capability) {
    let resolve = resolverByCapability.get(capability);
    if (!resolve) {
        resolve = (0, transferCallableWiring_js_1.makeResolveTransferPermissionThroughTxn)(capability);
        resolverByCapability.set(capability, resolve);
    }
    try {
        return await resolve(txn, db, actorId);
    }
    catch {
        return false; // a THROWING resolver is a denial, never an allow
    }
}
function stageRelocationAuditEvent(txn, a) {
    const unit = a.serialCount > 0 ? `${a.serialCount} serial(s)` : `qty ${a.quantity}`;
    const summary = `relocateStock ${unit} of part ${a.partId}: ${a.source.type}:${a.source.locationId} -> ${a.destination.type}:${a.destination.locationId}${a.placementRecorded ? " (put-away)" : ""}`.slice(0, 500);
    (0, auditEventWriter_js_1.stageAuditEvent)(txn, {
        actorUid: a.actorId,
        action: "relocateStock",
        targetType: "stockRelocation",
        targetId: a.relocationId,
        outcome: "applied",
        summary,
    });
}
const productionDeps = (actorUid) => ({
    db: (0, firestore_1.getFirestore)(),
    actor: { kind: "USER", id: actorUid },
    authorize: authorizeThroughTxn,
    resolvePart: transferCallableWiring_js_1.resolveTransferPartThroughTxn,
    stageAudit: stageRelocationAuditEvent,
    now: () => new Date(),
});
const MESSAGE = {
    DENIED: ["permission-denied", "You are not authorized to move this stock."],
    INVALID: ["invalid-argument", "That move could not be accepted."],
    NOT_FOUND: ["not-found", "Something in that move could not be found."],
    RETIRED_BIN: ["failed-precondition", "That location is not in use."],
    CROSS_WAREHOUSE: ["failed-precondition", "Those locations are in different warehouses. Use a transfer."],
    INSUFFICIENT_STOCK: ["failed-precondition", "There is not enough stock at the source location."],
    SERIAL_NOT_AT_SOURCE: ["failed-precondition", "That serial is not available at the source location."],
    IDEMPOTENCY_CONFLICT: ["already-exists", "This move was already submitted with different details."],
    INTEGRITY: ["internal", "The stored records for this move are inconsistent."],
};
/** Firestore contention and availability failures are the only ones worth retrying, with the SAME key. */
function isRetryableTechnical(err) {
    const code = err?.code;
    return code === 10 || code === 14 || code === 4 || code === "aborted" || code === "unavailable" || code === "deadline-exceeded";
}
exports.relocateStockCallable = (0, https_1.onCall)(REGION, async (request) => {
    const actorUid = requireAuth(request);
    try {
        return await (0, stockRelocationCommand_js_1.relocateStock)(request.data, productionDeps(actorUid));
    }
    catch (err) {
        if (err instanceof stockRelocationCommand_js_1.RelocationError) {
            const [code, message] = MESSAGE[err.code];
            // The detail carries the class and a bounded reason token -- never a stored value.
            throw new https_1.HttpsError(code, message, { code: err.code, reason: err.reason });
        }
        if (isRetryableTechnical(err)) {
            throw new https_1.HttpsError("unavailable", "The move could not be completed right now. It is safe to retry.", { code: "RETRYABLE_TECHNICAL_FAILURE" });
        }
        console.error("[relocateStock] unexpected failure", err);
        throw new https_1.HttpsError("internal", "The move could not be completed.", { code: "RETRYABLE_TECHNICAL_FAILURE" });
    }
});
/**
 * STOCK MOVEMENT LOCATIONS -- the warehouses a relocation operator may choose between, from the server.
 *
 * Replaces Move stock's client-direct `warehouses` read, which firestore.rules admit only for
 * admin/dispatcher and an assigned warehouse manager. REUSES the governed option builder Receiving uses
 * (listEligibleReceivingLocationOptions): governed + ACTIVE warehouses only, sanitized to {value, label},
 * never a raw document. Only the authorizer differs -- the caller must hold inventory.stock.relocate AND
 * inventory.location.bin.read, the two capabilities Move stock itself needs. Relocation authority is
 * global-scope, so this returns exactly the warehouses the command would accept. Bins stay on the
 * existing bin.read callables (resolveBin / resolveBinToken / listBins).
 */
exports.listStockMovementLocationsCallable = (0, https_1.onCall)(REGION, async (request) => {
    const actorUid = requireAuth(request);
    const db = (0, firestore_1.getFirestore)();
    try {
        const options = await (0, receivingLocationOptionsService_js_1.listEligibleReceivingLocationOptions)(request.data ?? {}, {
            actor: { kind: "USER", id: actorUid },
            authorize: async (txn, actorId) => (await authorizeThroughTxn(txn, db, actorId, "inventory.stock.relocate"))
                && (await authorizeThroughTxn(txn, db, actorId, "inventory.location.bin.read")),
            readCandidateWarehouses: async (txn) => (await txn.get(db.collection(collections_js_1.WAREHOUSES_COLLECTION))).docs.map((d) => ({ warehouseId: d.id, data: d.data() })),
            runRead: (fn) => db.runTransaction(fn, { readOnly: true }),
        });
        return { warehouses: options.map((o) => ({ warehouseId: o.value, name: o.label })) };
    }
    catch (err) {
        if (err instanceof receivingLocationOptionsService_js_1.ReceivingLocationOptionsError) {
            if (err.code === "PERMISSION_DENIED")
                throw new https_1.HttpsError("permission-denied", "You are not authorized to move stock.", { code: "DENIED" });
            if (err.code === "INVALID_REQUEST")
                throw new https_1.HttpsError("invalid-argument", "That request could not be accepted.", { code: "INVALID" });
        }
        throw new https_1.HttpsError("unavailable", "Warehouses could not be read right now.", { code: "RETRYABLE_TECHNICAL_FAILURE" });
    }
});
//# sourceMappingURL=stockRelocationCallables.js.map