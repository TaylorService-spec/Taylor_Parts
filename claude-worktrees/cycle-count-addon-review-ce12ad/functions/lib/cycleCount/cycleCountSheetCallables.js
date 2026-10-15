"use strict";
// Cycle Count A1/A4 -- the deployed callable surface of the sheet/line model. The ONLY callables that
// create or read cycle counts: the v1 single-part callables are no longer exported (Decision #179).
//
// Request contracts are exact (unknown fields refused). Authorization is the same through-transaction
// resolver the v1 family used, with per-environment activation. Errors are sanitized; the domain code rides
// in `details.code` so a screen can tell "sheet closed" from "not authorized" without parsing words.
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCycleCountSheetCallable = exports.listCycleCountSheetsCallable = exports.closeCycleCountSheetCallable = exports.cancelCycleCountSheetCallable = exports.cancelCycleCountLineCallable = exports.reconcileCycleCountLineCallable = exports.submitCycleCountLineCallable = exports.openCycleCountLineCallable = exports.createCycleCountSheetCallable = exports.runGetCycleCountSheet = exports.runListCycleCountSheets = exports.runCloseCycleCountSheet = exports.runCancelCycleCountSheet = exports.runCancelCycleCountLine = exports.runReconcileCycleCountLine = exports.runSubmitCycleCountLine = exports.runOpenCycleCountLine = exports.runCreateCycleCountSheet = void 0;
exports.resolveCountLocationCompany = resolveCountLocationCompany;
exports.stageSheetAuditEvent = stageSheetAuditEvent;
exports.productionSheetDeps = productionSheetDeps;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const auditEventWriter_js_1 = require("../access/auditEventWriter.js");
const effectiveAccessFeed_js_1 = require("../access/effectiveAccessFeed.js");
const collections_js_1 = require("../constants/collections.js");
const operatingCompanyAuthority_js_1 = require("../ownership/operatingCompanyAuthority.js");
const transferLocationResolver_js_1 = require("../inventoryTransfer/transferLocationResolver.js");
const cycleCountTypes_js_1 = require("./cycleCountTypes.js");
const cycleCountCallableWiring_js_1 = require("./cycleCountCallableWiring.js");
const cycleCountLocationEligibility_js_1 = require("./cycleCountLocationEligibility.js");
const cycleCountSheetCommand_js_1 = require("./cycleCountSheetCommand.js");
const cycleCountSheetRead_js_1 = require("./cycleCountSheetRead.js");
const REGION = { region: "us-central1" };
function requireAuth(request) {
    if (!request.auth || typeof request.auth.uid !== "string" || request.auth.uid.length === 0) {
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    }
    return request.auth.uid;
}
const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
function exactKeys(data, allowed) {
    if (!isPlainObject(data))
        throw new https_1.HttpsError("invalid-argument", "Request data must be an object.", { code: "INVALID" });
    if (Object.keys(data).some((k) => !allowed.includes(k)))
        throw new https_1.HttpsError("invalid-argument", "The request has unknown fields.", { code: "INVALID" });
    return data;
}
/** The counted location's owning company (Ownership Model v1): the governed Warehouse's, or a Bin's parent's. */
async function resolveCountLocationCompany(txn, db, location) {
    if (location.type !== "WAREHOUSE" && location.type !== "BIN")
        return null; // a truck's company is not derived here
    const warehouseId = await (0, transferLocationResolver_js_1.resolveTransferCustodyWarehouseId)(txn, db, location);
    if (!warehouseId)
        return null;
    const snap = await txn.get(db.collection(collections_js_1.WAREHOUSES_COLLECTION).doc(warehouseId));
    const company = snap.exists ? (snap.data() ?? {}).operatingCompanyId : undefined;
    return (0, operatingCompanyAuthority_js_1.isOperatingCompanyIdShape)(company) ? company : null;
}
function stageSheetAuditEvent(txn, a) {
    const detail = a.variance !== undefined ? ` variance ${a.variance}`
        : a.serialVariance !== undefined ? ` missing ${a.serialVariance.missing.length}, unexpected ${a.serialVariance.unexpected.length}` : "";
    (0, auditEventWriter_js_1.stageAuditEvent)(txn, {
        actorUid: a.actorId,
        action: a.action,
        targetType: "cycleCountSheet",
        targetId: a.sheetId,
        outcome: "applied",
        summary: `${a.action}${a.partId ? ` part ${a.partId}` : ""} at ${a.location.type}:${a.location.locationId}${detail}`.slice(0, 500),
    });
}
function productionSheetDeps(db, actorUid) {
    const eligible = (0, cycleCountLocationEligibility_js_1.makeResolveCycleCountLocationEligible)(db);
    return {
        db,
        actor: { kind: "USER", id: actorUid },
        authorize: (txn, actorId, capability) => (0, cycleCountCallableWiring_js_1.makeResolveCycleCountPermissionThroughTxn)(capability)(txn, db, actorId),
        resolvePart: (txn, partId) => (0, cycleCountCallableWiring_js_1.resolveCycleCountPartThroughTxn)(txn, db, partId),
        resolveLocationEligible: eligible,
        resolveLocationCompany: (txn, location) => resolveCountLocationCompany(txn, db, location),
        stageAudit: stageSheetAuditEvent,
        now: () => new Date(),
    };
}
const HTTP = {
    PERMISSION_DENIED: "permission-denied",
    SEPARATION_OF_DUTIES: "permission-denied",
    CYCLE_COUNT_NOT_FOUND: "not-found",
    SHEET_NOT_FOUND: "not-found",
    LOCATION_INVALID: "failed-precondition",
    PART_INVALID: "failed-precondition",
    SERIAL_INVALID: "failed-precondition",
    QUANTITY_INVALID: "failed-precondition",
    REASON_REQUIRED: "failed-precondition",
    STATUS_INVALID: "failed-precondition",
    SHEET_STATUS_INVALID: "failed-precondition",
    IDEMPOTENCY_CONFLICT: "already-exists",
    MALFORMED_STORED_RECORD: "failed-precondition",
    CYCLE_COUNT_INTEGRITY: "internal",
};
const MESSAGE = {
    SEPARATION_OF_DUTIES: "You submitted this count and cannot approve or reject its own material variance -- a different manager must review it.",
    PERMISSION_DENIED: "You are not authorized to perform this cycle count action.",
    SHEET_NOT_FOUND: "That count sheet could not be found.",
    CYCLE_COUNT_NOT_FOUND: "That part has no line on this sheet.",
    LOCATION_INVALID: "That location cannot be counted.",
    REASON_REQUIRED: "A reason is required when the count differs from what was expected.",
    SHEET_STATUS_INVALID: "This sheet no longer allows that action.",
    STATUS_INVALID: "That line no longer allows that action.",
    IDEMPOTENCY_CONFLICT: "This was already submitted with different details.",
};
function mapError(err) {
    if (err instanceof https_1.HttpsError)
        return err;
    if (err instanceof cycleCountTypes_js_1.CycleCountCommandError) {
        return new https_1.HttpsError(HTTP[err.code] ?? "internal", MESSAGE[err.code] ?? "The cycle count action could not be completed.", { code: err.code });
    }
    if (err instanceof cycleCountSheetRead_js_1.CycleCountReadInvalidError)
        return new https_1.HttpsError("invalid-argument", "That request could not be accepted.", { code: "INVALID" });
    console.error("[cycleCountSheet] unexpected failure", err);
    return new https_1.HttpsError("internal", "The cycle count action could not be completed.", { code: "CYCLE_COUNT_INTEGRITY" });
}
function commandCallable(command, keys) {
    return async (request, db = (0, firestore_1.getFirestore)()) => {
        const actorUid = requireAuth(request);
        const data = exactKeys(request.data, keys);
        try {
            return await command(data, productionSheetDeps(db, actorUid));
        }
        catch (err) {
            throw mapError(err);
        }
    };
}
exports.runCreateCycleCountSheet = commandCallable(cycleCountSheetCommand_js_1.createCycleCountSheet, ["location", "idempotencyKey"]);
exports.runOpenCycleCountLine = commandCallable(cycleCountSheetCommand_js_1.openCycleCountLine, ["sheetId", "partId"]);
exports.runSubmitCycleCountLine = commandCallable(cycleCountSheetCommand_js_1.submitCycleCountLine, ["sheetId", "partId", "countedQuantity", "countedSerialNumbers"]);
exports.runReconcileCycleCountLine = commandCallable(cycleCountSheetCommand_js_1.reconcileCycleCountLine, ["sheetId", "partId", "decision", "reason"]);
exports.runCancelCycleCountLine = commandCallable(cycleCountSheetCommand_js_1.cancelCycleCountLine, ["sheetId", "partId"]);
exports.runCancelCycleCountSheet = commandCallable(cycleCountSheetCommand_js_1.cancelCycleCountSheet, ["sheetId"]);
exports.runCloseCycleCountSheet = commandCallable(cycleCountSheetCommand_js_1.closeCycleCountSheet, ["sheetId"]);
/** A4 authority: any Cycle Count capability. Counting, reviewing and reconciling all need to see sheets. */
async function requireCycleCountRead(uid) {
    const ids = Object.values(cycleCountSheetCommand_js_1.CYCLE_COUNT_CAPABILITY);
    let allowed = false;
    try {
        const { decisions } = await (0, effectiveAccessFeed_js_1.resolveEffectiveAccess)({ principalUid: uid, permissionIds: ids });
        allowed = ids.some((id) => decisions[id] === true);
    }
    catch (err) {
        console.error("[cycleCountSheet] read authorization failed", err);
    }
    if (!allowed)
        throw new https_1.HttpsError("permission-denied", "You are not authorized to view cycle counts.", { code: "PERMISSION_DENIED" });
}
function readCallable(read) {
    return async (request, db = (0, firestore_1.getFirestore)()) => {
        const uid = requireAuth(request);
        await requireCycleCountRead(uid);
        try {
            return await read(request.data, db);
        }
        catch (err) {
            throw mapError(err);
        }
    };
}
exports.runListCycleCountSheets = readCallable(cycleCountSheetRead_js_1.listCycleCountSheets);
exports.runGetCycleCountSheet = readCallable(cycleCountSheetRead_js_1.getCycleCountSheet);
exports.createCycleCountSheetCallable = (0, https_1.onCall)(REGION, (r) => (0, exports.runCreateCycleCountSheet)(r));
exports.openCycleCountLineCallable = (0, https_1.onCall)(REGION, (r) => (0, exports.runOpenCycleCountLine)(r));
exports.submitCycleCountLineCallable = (0, https_1.onCall)(REGION, (r) => (0, exports.runSubmitCycleCountLine)(r));
exports.reconcileCycleCountLineCallable = (0, https_1.onCall)(REGION, (r) => (0, exports.runReconcileCycleCountLine)(r));
exports.cancelCycleCountLineCallable = (0, https_1.onCall)(REGION, (r) => (0, exports.runCancelCycleCountLine)(r));
exports.cancelCycleCountSheetCallable = (0, https_1.onCall)(REGION, (r) => (0, exports.runCancelCycleCountSheet)(r));
exports.closeCycleCountSheetCallable = (0, https_1.onCall)(REGION, (r) => (0, exports.runCloseCycleCountSheet)(r));
exports.listCycleCountSheetsCallable = (0, https_1.onCall)(REGION, (r) => (0, exports.runListCycleCountSheets)(r));
exports.getCycleCountSheetCallable = (0, https_1.onCall)(REGION, (r) => (0, exports.runGetCycleCountSheet)(r));
//# sourceMappingURL=cycleCountSheetCallables.js.map