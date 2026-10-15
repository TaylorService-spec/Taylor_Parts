"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getWorkOrderLabor = exports.correctWorkOrderLaborCallable = exports.recordWorkOrderLaborCallable = void 0;
// TECHNICIAN LABOR — the onCall adapters, and the production seams behind them.
//
// All authority lives in the command. This authenticates, resolves who the caller IS (principal plus
// technician identity, both from the server, never from a payload), and translates refusals into
// codes a phone can branch on.
//
// `work_order_labor_entries` has no firestore.rules match block, so it is deny-all to every client
// including admin -- the established posture for `bins`, `inventory_returns` and `part_aliases`. A
// technician's hours cannot be written from a browser at all, which is why these exist.
//
// EXPORT != DEPLOY. Both capabilities are registered active:false and carried by no Role yet.
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const workOrderLaborCommand_js_1 = require("./workOrderLaborCommand.js");
const resolveEffectivePermission_js_1 = require("../access/resolveEffectivePermission.js");
const compatibilityRoles_js_1 = require("../access/compatibilityRoles.js");
const governedBusinessRoles_js_1 = require("../access/governedBusinessRoles.js");
const environmentCapabilityOverrides_js_1 = require("../access/environmentCapabilityOverrides.js");
const compactClaims_js_1 = require("../access/compactClaims.js");
const auditEventWriter_js_1 = require("../access/auditEventWriter.js");
const effectiveAccessFeed_js_1 = require("../access/effectiveAccessFeed.js");
const callerContext_js_1 = require("../callerContext.js");
const REGION = { region: "us-central1" };
const USERS_COLLECTION = "users";
const ROLE_ASSIGNMENTS_COLLECTION = "roleAssignments";
const GLOBAL_TARGET = { scope: { type: "global" }, condition: {} };
const LABOR_ROLE_CATALOG = { ...compatibilityRoles_js_1.COMPATIBILITY_ROLES, ...governedBusinessRoles_js_1.GOVERNED_BUSINESS_ROLES };
/** How many entries one technician-day read may return. A day is not a payroll history. */
const LABOR_READ_CAP = 100;
// Read THROUGH the transaction so a revocation mid-flight conflicts the commit rather than being
// missed. Labor is a durable business record; a race that records an hour under a revoked authority
// is not something an audit can undo.
function resolveThroughTxn(capability) {
    return async function resolve(txn, db, actorId) {
        if (typeof actorId !== "string" || actorId.trim() === "")
            return false;
        const userSnap = await txn.get(db.collection(USERS_COLLECTION).doc(actorId));
        const assignmentsSnap = await txn.get(db.collection(ROLE_ASSIGNMENTS_COLLECTION).where("principalUid", "==", actorId).where("status", "==", "active"));
        let accessVersion = 0;
        if (userSnap.exists) {
            const av = (userSnap.data() ?? {}).accessVersion;
            if (av !== undefined && av !== null) {
                if (!(0, compactClaims_js_1.isValidAccessVersionValue)(av))
                    return false;
                accessVersion = av;
            }
        }
        return (0, resolveEffectivePermission_js_1.resolveEffectivePermission)({
            permissionId: capability,
            assignments: assignmentsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
            roles: LABOR_ROLE_CATALOG,
            currentAccessVersion: accessVersion,
            target: GLOBAL_TARGET,
            activationOverrides: (0, environmentCapabilityOverrides_js_1.resolveRuntimeCapabilityOverrides)(),
        }).decision === "ALLOW";
    };
}
/** A THROWING resolver is a denial, never an allow. */
async function allows(uid, capability) {
    try {
        const { decisions } = await (0, effectiveAccessFeed_js_1.resolveEffectiveAccess)({ principalUid: uid, permissionIds: [capability] });
        return decisions[capability] === true;
    }
    catch (err) {
        console.error(`[workOrderLabor] capability resolution failed for ${capability}`, err);
        return false;
    }
}
const authorizeFor = (capability, db) => (txn, actorId) => (txn === null ? allows(actorId, capability) : resolveThroughTxn(capability)(txn, db, actorId));
/** One audit event per labor act, saying what it was and — for a correction — what it replaced. */
function stageLaborAudit(txn, a) {
    const replaced = a.correctsLaborEntryId ? ` replacing ${a.correctsLaborEntryId}` : "";
    const summary = `${a.action === "correct" ? "correctWorkOrderLabor" : "recordWorkOrderLabor"} `
        + `${a.durationMinutes}min ${a.laborType} on ${a.workDate} for technician ${a.technicianId} `
        + `against work order ${a.workOrderId}${replaced}`;
    (0, auditEventWriter_js_1.stageAuditEvent)(txn, {
        actorUid: a.actorId,
        action: a.action === "correct" ? "correctWorkOrderLabor" : "recordWorkOrderLabor",
        targetType: "workOrderLabor",
        targetId: a.laborEntryId,
        outcome: "applied",
        summary: summary.slice(0, 500),
    });
}
const FAILURE = Object.freeze({
    PERMISSION_DENIED: { status: "permission-denied", message: "You are not authorized to record labor." },
    WORK_ORDER_NOT_FOUND: { status: "not-found", message: "That work order could not be found." },
    WORK_ORDER_STATE_INVALID: { status: "failed-precondition", message: "This work order is not being executed, so new labor cannot be recorded on it." },
    NOT_ASSIGNED_TECHNICIAN: { status: "permission-denied", message: "Labor can only be recorded on a work order assigned to you." },
    REQUEST_INVALID: { status: "invalid-argument", message: "That labor entry is not valid." },
    INTERVAL_INVALID: { status: "invalid-argument", message: "Those start and end times are not valid." },
    DURATION_INVALID: { status: "invalid-argument", message: "That amount of time is not valid." },
    OVERLAPPING_ENTRY: { status: "failed-precondition", message: "That time overlaps labor you already recorded." },
    IDEMPOTENCY_CONFLICT: { status: "failed-precondition", message: "A different labor entry was already recorded under this request." },
    ENTRY_NOT_FOUND: { status: "not-found", message: "That labor entry could not be found." },
    ENTRY_ALREADY_REVERSED: { status: "failed-precondition", message: "That entry was already corrected. Correct the replacement instead." },
});
function toHttps(err) {
    if (err instanceof workOrderLaborCommand_js_1.LaborCommandError) {
        const m = FAILURE[err.code];
        return new https_1.HttpsError(m.status, m.message, err.code);
    }
    console.error("[workOrderLabor] failed", err);
    return new https_1.HttpsError("internal", "The request could not be completed.", "INTERNAL");
}
/** Identity from the authenticated session plus users/{uid}. Never from a payload. */
async function resolveActor(uid) {
    const ctx = await (0, callerContext_js_1.getCallerContext)(uid);
    return { kind: "USER", id: uid, technicianId: ctx.technicianId, role: ctx.role };
}
exports.recordWorkOrderLaborCallable = (0, https_1.onCall)(REGION, async (request) => {
    if (!request.auth?.uid)
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    const db = (0, firestore_1.getFirestore)();
    try {
        return await (0, workOrderLaborCommand_js_1.recordWorkOrderLabor)(request.data, {
            db,
            actor: await resolveActor(request.auth.uid),
            authorize: authorizeFor(workOrderLaborCommand_js_1.LABOR_RECORD_CAPABILITY, db),
            stageAudit: stageLaborAudit,
            // SERVER time. The device's own reading travels separately and is never mistaken for this.
            now: () => new Date(),
        });
    }
    catch (err) {
        throw toHttps(err);
    }
});
exports.correctWorkOrderLaborCallable = (0, https_1.onCall)(REGION, async (request) => {
    if (!request.auth?.uid)
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    const db = (0, firestore_1.getFirestore)();
    try {
        return await (0, workOrderLaborCommand_js_1.correctWorkOrderLabor)(request.data, {
            db,
            actor: await resolveActor(request.auth.uid),
            authorize: authorizeFor(workOrderLaborCommand_js_1.LABOR_CORRECT_CAPABILITY, db),
            stageAudit: stageLaborAudit,
            now: () => new Date(),
        });
    }
    catch (err) {
        throw toHttps(err);
    }
});
/**
 * The labor on ONE work order, plus its derived totals.
 *
 * Scoped to a work order rather than to an employee: "what time is on this job" is an operational
 * question a technician and their manager both have. "What has this person worked this month" is a
 * payroll question with different authority, and this deliberately cannot answer it.
 *
 * Gated on the RECORD capability -- somebody who may put time on jobs may see the time on them.
 */
exports.getWorkOrderLabor = (0, https_1.onCall)(REGION, async (request) => {
    if (!request.auth?.uid)
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    const db = (0, firestore_1.getFirestore)();
    const uid = request.auth.uid;
    try {
        const workOrderId = typeof (request.data ?? {}).workOrderId === "string" ? request.data.workOrderId.trim() : "";
        if (!workOrderId)
            throw new workOrderLaborCommand_js_1.LaborCommandError("REQUEST_INVALID", "workOrderId required");
        const canRecord = await allows(uid, workOrderLaborCommand_js_1.LABOR_RECORD_CAPABILITY);
        const canCorrect = await allows(uid, workOrderLaborCommand_js_1.LABOR_CORRECT_CAPABILITY);
        // Record-only holders read their OWN assigned jobs; correct holders read any (see the function).
        await (0, workOrderLaborCommand_js_1.authorizeWorkOrderLaborRead)(db, await resolveActor(uid), workOrderId, { canRecord, canCorrect });
        const snap = await db.collection(workOrderLaborCommand_js_1.LABOR_ENTRIES_COLLECTION)
            .where("workOrderId", "==", workOrderId).limit(LABOR_READ_CAP).get();
        const entries = snap.docs.map((d) => d.data() ?? {});
        return {
            status: "ready",
            workOrderId,
            // REVERSED entries are RETURNED as well as excluded from the totals: "what does this job cost
            // in time" and "what was recorded and later corrected" are different questions.
            entries: entries.map((e) => ({
                laborEntryId: e.laborEntryId, technicianId: e.technicianId, laborType: e.laborType,
                entryKind: e.entryKind, durationMinutes: e.durationMinutes, workDate: e.workDate,
                startedAtMillis: e.startedAtMillis ?? null, endedAtMillis: e.endedAtMillis ?? null,
                status: e.status, correctsLaborEntryId: e.correctsLaborEntryId ?? null,
                notes: e.notes ?? null,
            })),
            totals: (0, workOrderLaborCommand_js_1.projectWorkOrderLabor)(entries),
            // The contract, returned so a client never hardcodes a copy of it.
            laborTypes: [...workOrderLaborCommand_js_1.LABOR_TYPES],
            entryKinds: [...workOrderLaborCommand_js_1.LABOR_ENTRY_KINDS],
            recordableStatuses: [...workOrderLaborCommand_js_1.LABOR_RECORDABLE_WO_STATUSES],
            maxMinutes: workOrderLaborCommand_js_1.MAX_LABOR_MINUTES,
            canRecord,
            canCorrect,
        };
    }
    catch (err) {
        throw toHttps(err);
    }
});
//# sourceMappingURL=laborCallables.js.map