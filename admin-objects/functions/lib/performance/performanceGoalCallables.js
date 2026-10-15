"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listGoalSubjectsCallable = exports.listPerformanceGoalVersionsCallable = exports.listCurrentPerformanceGoalsCallable = exports.retirePerformanceGoalCallable = exports.approvePerformanceGoalCallable = exports.createPerformanceGoalDraftCallable = void 0;
exports.mapError = mapError;
// PERFORMANCE GOAL -- thin onCall adapters. Same pattern as supplierMasterCallables /
// accessCommandCallables: derive actorUid ONLY from request.auth.uid (NEVER request.data), pass the
// payload into the service, and map thrown service errors to HttpsError through a sanitized taxonomy.
//
// These adapters add NO authority. Every capability check, scope resolution, hierarchical-visibility
// narrowing, self-approval refusal, idempotency guard and audit write lives inside the command and
// read services, so both stay independently testable and neither can be bypassed by calling the
// other's transport.
//
// EXPORT IS NOT DEPLOYMENT, AND DEPLOYMENT IS NOT ACTIVATION. All five performance.goal.*
// capabilities are registered active:false. Production resolves its activation override set to EMPTY
// unconditionally, so even a deployed callable denies there for every principal until a separate,
// Owner-executed activation.
const https_1 = require("firebase-functions/v2/https");
const performanceGoalCommands_js_1 = require("./performanceGoalCommands.js");
const performanceGoalReadService_js_1 = require("./performanceGoalReadService.js");
const partMasterCommands_js_1 = require("../partMaster/partMasterCommands.js");
const partMasterRepository_js_1 = require("../partMaster/partMasterRepository.js");
/**
 * Sanitized error -> HttpsError.
 *
 * ONE DELIBERATE DEPARTURE from the supplier/part precedent: an InvalidInputError's MESSAGE is
 * surfaced rather than replaced with a generic sentence. These messages are the product -- "metric X
 * is registered but not active for goals: no revisit, callback or repeat-visit linkage exists" is
 * the entire value of the refusal to the manager who hit it, and collapsing it to "the request has
 * invalid fields" would turn a governed explanation into a shrug. They are safe to surface: every
 * one is authored in the pure core from the registry and the request, and none reads stored state,
 * so none can leak the existence or contents of a record.
 *
 * Every OTHER type stays generic, including permission-denied -- a denial must not become a probe
 * for what exists.
 */
function mapError(err) {
    if (err instanceof partMasterCommands_js_1.InvalidInputError)
        return new https_1.HttpsError("invalid-argument", err.message);
    if (err instanceof partMasterCommands_js_1.UnauthorizedActorError)
        return new https_1.HttpsError("permission-denied", "You are not authorized to perform this action.");
    if (err instanceof partMasterCommands_js_1.NotFoundError)
        return new https_1.HttpsError("not-found", "No performance goal exists at that id.");
    if (err instanceof partMasterCommands_js_1.VersionConflictError)
        return new https_1.HttpsError("aborted", "The record changed since you loaded it. Reload and retry.");
    if (err instanceof partMasterCommands_js_1.IdempotencyConflictError)
        return new https_1.HttpsError("aborted", "That idempotency key was already used for a different request.");
    if (err instanceof partMasterCommands_js_1.InvalidStatusTransitionError)
        return new https_1.HttpsError("failed-precondition", err.message);
    if (err instanceof performanceGoalReadService_js_1.GoalReadError) {
        if (err.code === "DENIED")
            return new https_1.HttpsError("permission-denied", "You are not authorized to read that target.");
        return new https_1.HttpsError("invalid-argument", err.message);
    }
    if (err instanceof partMasterRepository_js_1.MalformedStoredRecordError)
        return new https_1.HttpsError("internal", "The request could not be completed.");
    return new https_1.HttpsError("internal", "The request could not be completed.");
}
function requireAuth(request) {
    if (!request.auth || typeof request.auth.uid !== "string" || request.auth.uid.length === 0) {
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    }
    return request.auth.uid;
}
function asObject(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new https_1.HttpsError("invalid-argument", "Request data must be an object.");
    }
    return data;
}
const str = (v) => (typeof v === "string" ? v : "");
const strOrNull = (v) => (typeof v === "string" && v.length > 0 ? v : null);
exports.createPerformanceGoalDraftCallable = (0, https_1.onCall)(async (request) => {
    const actorUid = requireAuth(request);
    const d = asObject(request.data);
    try {
        return await (0, performanceGoalCommands_js_1.createPerformanceGoalDraft)({
            actorUid,
            idempotencyKey: str(d.idempotencyKey),
            goalId: str(d.goalId),
            metricId: str(d.metricId),
            targetScopeType: str(d.targetScopeType),
            targetScopeId: strOrNull(d.targetScopeId),
            targetValue: typeof d.targetValue === "number" ? d.targetValue : Number.NaN,
            unit: str(d.unit),
            direction: str(d.direction),
            currency: strOrNull(d.currency),
            effectiveFrom: str(d.effectiveFrom),
            effectiveTo: strOrNull(d.effectiveTo),
            supersedesGoalId: strOrNull(d.supersedesGoalId),
        });
    }
    catch (err) {
        throw mapError(err);
    }
});
exports.approvePerformanceGoalCallable = (0, https_1.onCall)(async (request) => {
    const actorUid = requireAuth(request);
    const d = asObject(request.data);
    try {
        return await (0, performanceGoalCommands_js_1.approvePerformanceGoal)({
            actorUid,
            idempotencyKey: str(d.idempotencyKey),
            goalId: str(d.goalId),
            reason: str(d.reason),
        });
    }
    catch (err) {
        throw mapError(err);
    }
});
exports.retirePerformanceGoalCallable = (0, https_1.onCall)(async (request) => {
    const actorUid = requireAuth(request);
    const d = asObject(request.data);
    try {
        return await (0, performanceGoalCommands_js_1.retirePerformanceGoal)({
            actorUid,
            idempotencyKey: str(d.idempotencyKey),
            goalId: str(d.goalId),
            reason: str(d.reason),
        });
    }
    catch (err) {
        throw mapError(err);
    }
});
exports.listCurrentPerformanceGoalsCallable = (0, https_1.onCall)(async (request) => {
    const actorUid = requireAuth(request);
    const d = asObject(request.data);
    const rawTargets = Array.isArray(d.targets) ? d.targets : [];
    try {
        return await (0, performanceGoalReadService_js_1.listCurrentPerformanceGoals)({
            actorUid,
            onDate: str(d.onDate),
            targets: rawTargets.map((t) => {
                const o = (t && typeof t === "object" ? t : {});
                return { metricId: str(o.metricId), targetScopeType: str(o.targetScopeType), targetScopeId: strOrNull(o.targetScopeId) };
            }),
        });
    }
    catch (err) {
        throw mapError(err);
    }
});
exports.listPerformanceGoalVersionsCallable = (0, https_1.onCall)(async (request) => {
    const actorUid = requireAuth(request);
    const d = asObject(request.data);
    const o = (d.target && typeof d.target === "object" ? d.target : {});
    try {
        return await (0, performanceGoalReadService_js_1.listPerformanceGoalVersions)({
            actorUid,
            target: { metricId: str(o.metricId), targetScopeType: str(o.targetScopeType), targetScopeId: strOrNull(o.targetScopeId) },
        });
    }
    catch (err) {
        throw mapError(err);
    }
});
exports.listGoalSubjectsCallable = (0, https_1.onCall)(async (request) => {
    const actorUid = requireAuth(request);
    try {
        return await (0, performanceGoalReadService_js_1.listGoalSubjects)({ actorUid });
    }
    catch (err) {
        throw mapError(err);
    }
});
//# sourceMappingURL=performanceGoalCallables.js.map