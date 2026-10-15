"use strict";
// Enterprise Inventory -- Cycle Count operating authority: the trusted CALLABLES (createCycleCount,
// submitCycleCount, reconcileCycleCount, cancelCycleCount) and their exact, sanitized request/response/
// error contracts. firebase-functions v2 onCall. Mirrors transferCallables.ts. The actor is derived ONLY
// from request.auth.uid; authorization is the merged governed resolver for each UNGRANTED
// inventory.cycleCount.* capability (active: false), so every real user is denied until a separate grant
// + activation gate. No production caller can supply an actor, resolver, or audit seam.
Object.defineProperty(exports, "__esModule", { value: true });
exports.cancelCycleCountCallable = exports.reconcileCycleCountCallable = exports.submitCycleCountCallable = exports.createCycleCountCallable = void 0;
exports.runCreateCycleCount = runCreateCycleCount;
exports.runSubmitCycleCount = runSubmitCycleCount;
exports.runReconcileCycleCount = runReconcileCycleCount;
exports.runCancelCycleCount = runCancelCycleCount;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const cycleCountCommandComposition_js_1 = require("./cycleCountCommandComposition.js");
const cycleCountTypes_js_1 = require("./cycleCountTypes.js");
const cycleCountCallableWiring_js_1 = require("./cycleCountCallableWiring.js");
const REGION = { region: "us-central1" };
function isPlainObject(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isNonBlankString(v) {
    return typeof v === "string" && v.trim() !== "";
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
const CREATE_KEYS = new Set(["partId", "location", "idempotencyKey"]);
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
    validateLocationShape(data.location, "location");
    if (!isNonBlankString(data.idempotencyKey))
        throw invalidArg("idempotencyKey is invalid.");
    return data;
}
// -------- SUBMIT request contract --------
const SUBMIT_KEYS = new Set(["cycleCountId", "countedQuantity", "countedSerialNumbers"]);
function validateSubmitRequest(data) {
    if (!isPlainObject(data))
        throw invalidArg("Request data must be an object.");
    if (!noUnknownKeys(data, SUBMIT_KEYS))
        throw invalidArg("The request has unknown fields.");
    if (!isNonBlankString(data.cycleCountId))
        throw invalidArg("cycleCountId is invalid.");
    if (data.countedQuantity !== undefined && (typeof data.countedQuantity !== "number" || !Number.isFinite(data.countedQuantity))) {
        throw invalidArg("countedQuantity is invalid.");
    }
    if (data.countedSerialNumbers !== undefined) {
        if (!Array.isArray(data.countedSerialNumbers) || !data.countedSerialNumbers.every((s) => isNonBlankString(s))) {
            throw invalidArg("countedSerialNumbers is invalid.");
        }
    }
    return data;
}
// -------- RECONCILE request contract --------
// `decision` is the M23 manager-review addition ("APPROVE" | "REJECT", defaults to "APPROVE" when
// omitted so this callable's pre-M23 request shape still works unchanged).
const RECONCILE_KEYS = new Set(["cycleCountId", "reason", "decision"]);
function validateReconcileRequest(data) {
    if (!isPlainObject(data))
        throw invalidArg("Request data must be an object.");
    if (!noUnknownKeys(data, RECONCILE_KEYS))
        throw invalidArg("The request has unknown fields.");
    if (!isNonBlankString(data.cycleCountId))
        throw invalidArg("cycleCountId is invalid.");
    if (data.reason !== undefined && !isNonBlankString(data.reason))
        throw invalidArg("reason is invalid.");
    if (data.decision !== undefined && data.decision !== "APPROVE" && data.decision !== "REJECT") {
        throw invalidArg("decision is invalid.");
    }
    return data;
}
// -------- cycleCountId-only request contract (cancel) --------
const ID_ONLY_KEYS = new Set(["cycleCountId"]);
function validateIdOnlyRequest(data) {
    if (!isPlainObject(data))
        throw invalidArg("Request data must be an object.");
    if (!noUnknownKeys(data, ID_ONLY_KEYS))
        throw invalidArg("The request has unknown fields.");
    if (!isNonBlankString(data.cycleCountId))
        throw invalidArg("cycleCountId is invalid.");
    return data;
}
// -------- sanitized error matrix --------
function mapCycleCountError(err) {
    if (err instanceof https_1.HttpsError)
        return err;
    if (err instanceof cycleCountTypes_js_1.CycleCountCommandError) {
        const code = mapCode(err.code);
        const message = code === "permission-denied" && err.code === "SEPARATION_OF_DUTIES"
            ? "You submitted this count and cannot approve or reject its own material variance -- a different manager must review it."
            : code === "permission-denied" ? "You are not authorized to perform this cycle count action."
                : code === "not-found" ? "The cycle count could not be found."
                    : code === "failed-precondition" ? "This cycle count action is not currently permitted."
                        : "The cycle count action could not be completed.";
        return new https_1.HttpsError(code, message);
    }
    return new https_1.HttpsError("internal", "The cycle count action could not be completed.");
}
function mapCode(code) {
    switch (code) {
        case "PERMISSION_DENIED":
        case "SEPARATION_OF_DUTIES":
            return "permission-denied";
        case "CYCLE_COUNT_NOT_FOUND":
            return "not-found";
        case "LOCATION_INVALID":
        case "PART_INVALID":
        case "SERIAL_INVALID":
        case "QUANTITY_INVALID":
        case "REASON_REQUIRED":
        case "STATUS_INVALID":
        case "IDEMPOTENCY_CONFLICT":
        case "MALFORMED_STORED_RECORD":
            return "failed-precondition";
        default:
            return "internal"; // CYCLE_COUNT_INTEGRITY / unknown
    }
}
async function runCreateCycleCount(request, wiring) {
    const actorUid = requireAuth(request);
    const validated = validateCreateRequest(request.data);
    try {
        const outcome = await (0, cycleCountCommandComposition_js_1.createCycleCountProduction)(validated, {
            db: wiring.db,
            actor: { kind: "USER", id: actorUid },
            authorize: (txn, actorId) => wiring.resolveCreatePermission(txn, actorId),
            resolvePart: wiring.resolvePart,
            stageAudit: wiring.stageAudit,
            now: wiring.now,
        });
        // M23 blind-count remediation: expectedQuantity/expectedSerialNumbers are DELIBERATELY OMITTED from
        // this response. The command already computed and stored them (createCycleCountProduction's own
        // outcome carries them, server-side, for the idempotency-replay path above), but they are never
        // projected onto what reaches the counting client -- if they were, a determined user could read the
        // expected value straight off this network response (in the browser devtools Network tab) before
        // ever typing a counted quantity, defeating the blind count even though the UI itself never renders
        // it. The counter first learns the expected value in submitCycleCount's OWN response (see below),
        // which only arrives after their counted value has already left their hands in that same request.
        return {
            outcome: outcome.outcome,
            cycleCountId: outcome.cycleCountId,
            partId: outcome.partId,
            trackingMode: outcome.trackingMode,
            location: outcome.location,
            status: outcome.status,
        };
    }
    catch (err) {
        throw mapCycleCountError(err);
    }
}
async function runSubmitCycleCount(request, wiring) {
    const actorUid = requireAuth(request);
    const validated = validateSubmitRequest(request.data);
    try {
        const outcome = await (0, cycleCountCommandComposition_js_1.submitCycleCountProduction)(validated, {
            db: wiring.db,
            actor: { kind: "USER", id: actorUid },
            authorize: (txn, actorId) => wiring.resolveSubmitPermission(txn, actorId),
            resolvePart: wiring.resolvePart,
            stageAudit: wiring.stageAudit,
            now: wiring.now,
        });
        // M23 blind-count remediation: THIS is the first response that carries the expected snapshot back to
        // the counting client -- deliberately, since by the time this response arrives, the counted value in
        // this SAME request has already been recorded server-side. There is nothing left to anchor.
        return {
            outcome: outcome.outcome,
            cycleCountId: outcome.cycleCountId,
            status: outcome.status,
            countedQuantity: outcome.countedQuantity ?? null,
            countedSerialNumbers: outcome.countedSerialNumbers ?? null,
            variance: outcome.variance ?? null,
            serialVariance: outcome.serialVariance ?? null,
            expectedQuantity: outcome.expectedQuantity ?? null,
            expectedSerialNumbers: outcome.expectedSerialNumbers ?? null,
        };
    }
    catch (err) {
        throw mapCycleCountError(err);
    }
}
async function runReconcileCycleCount(request, wiring) {
    const actorUid = requireAuth(request);
    const validated = validateReconcileRequest(request.data);
    try {
        const outcome = await (0, cycleCountCommandComposition_js_1.reconcileCycleCountProduction)(validated, {
            db: wiring.db,
            actor: { kind: "USER", id: actorUid },
            authorize: (txn, actorId) => wiring.resolveReconcilePermission(txn, actorId),
            resolvePart: wiring.resolvePart,
            stageAudit: wiring.stageAudit,
            now: wiring.now,
        });
        return {
            outcome: outcome.outcome,
            cycleCountId: outcome.cycleCountId,
            status: outcome.status,
            ledgerEventIds: outcome.ledgerEventIds ?? [],
            reviewDecision: outcome.reviewDecision ?? null,
            reconciliationReason: outcome.reconciliationReason ?? null,
        };
    }
    catch (err) {
        throw mapCycleCountError(err);
    }
}
async function runCancelCycleCount(request, wiring) {
    const actorUid = requireAuth(request);
    const validated = validateIdOnlyRequest(request.data);
    try {
        const outcome = await (0, cycleCountCommandComposition_js_1.cancelCycleCountProduction)(validated, {
            db: wiring.db,
            actor: { kind: "USER", id: actorUid },
            authorize: (txn, actorId) => wiring.resolveCancelPermission(txn, actorId),
            resolvePart: wiring.resolvePart,
            stageAudit: wiring.stageAudit,
            now: wiring.now,
        });
        return { outcome: outcome.outcome, cycleCountId: outcome.cycleCountId, status: outcome.status };
    }
    catch (err) {
        throw mapCycleCountError(err);
    }
}
function productionWiring() {
    const db = (0, firestore_1.getFirestore)();
    return {
        db,
        resolveCreatePermission: (txn, actorId) => (0, cycleCountCallableWiring_js_1.makeResolveCycleCountPermissionThroughTxn)("inventory.cycleCount.create")(txn, db, actorId),
        resolveSubmitPermission: (txn, actorId) => (0, cycleCountCallableWiring_js_1.makeResolveCycleCountPermissionThroughTxn)("inventory.cycleCount.submit")(txn, db, actorId),
        resolveReconcilePermission: (txn, actorId) => (0, cycleCountCallableWiring_js_1.makeResolveCycleCountPermissionThroughTxn)("inventory.cycleCount.reconcile")(txn, db, actorId),
        resolveCancelPermission: (txn, actorId) => (0, cycleCountCallableWiring_js_1.makeResolveCycleCountPermissionThroughTxn)("inventory.cycleCount.cancel")(txn, db, actorId),
        resolvePart: (txn, partId) => (0, cycleCountCallableWiring_js_1.resolveCycleCountPartThroughTxn)(txn, db, partId),
        stageAudit: cycleCountCallableWiring_js_1.stageCycleCountAuditEvent,
        now: () => new Date(),
    };
}
exports.createCycleCountCallable = (0, https_1.onCall)(REGION, (request) => runCreateCycleCount(request, productionWiring()));
exports.submitCycleCountCallable = (0, https_1.onCall)(REGION, (request) => runSubmitCycleCount(request, productionWiring()));
exports.reconcileCycleCountCallable = (0, https_1.onCall)(REGION, (request) => runReconcileCycleCount(request, productionWiring()));
exports.cancelCycleCountCallable = (0, https_1.onCall)(REGION, (request) => runCancelCycleCount(request, productionWiring()));
//# sourceMappingURL=cycleCountCallables.js.map