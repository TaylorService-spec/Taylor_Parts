"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GoalReadError = exports.MAX_TARGETS_PER_READ = void 0;
exports.listCurrentPerformanceGoals = listCurrentPerformanceGoals;
exports.listPerformanceGoalVersions = listPerformanceGoalVersions;
exports.listGoalSubjects = listGoalSubjects;
const firestore_1 = require("firebase-admin/firestore");
const compatibilityRoles_js_1 = require("../access/compatibilityRoles.js");
const governedBusinessRoles_js_1 = require("../access/governedBusinessRoles.js");
const hierarchicalVisibility_js_1 = require("../access/hierarchicalVisibility.js");
const environmentCapabilityOverrides_js_1 = require("../access/environmentCapabilityOverrides.js");
const performanceGoal_js_1 = require("./performanceGoal.js");
const performanceMetricRegistry_js_1 = require("./performanceMetricRegistry.js");
const performanceGoalAuthority_js_1 = require("./performanceGoalAuthority.js");
const performanceGoalRepository_js_1 = require("./performanceGoalRepository.js");
/** The cap on how many targets one call may ask about. A request above it is REFUSED, not trimmed --
 *  trimming would answer a different question than the one asked and say nothing about having done so. */
exports.MAX_TARGETS_PER_READ = 40;
class GoalReadError extends Error {
    code;
    constructor(code, message) { super(message); this.name = "GoalReadError"; this.code = code; }
}
exports.GoalReadError = GoalReadError;
async function loadActorContext(db, actorUid) {
    const [userSnap, assignmentsSnap, population] = await Promise.all([
        db.collection("users").doc(actorUid).get(),
        db.collection("roleAssignments").where("principalUid", "==", actorUid).where("status", "==", "active").get(),
        (0, hierarchicalVisibility_js_1.loadPrincipalPositions)(db),
    ]);
    const data = userSnap.data();
    const v = data?.accessVersion;
    return {
        actorEmployeeId: typeof data?.employeeId === "string" ? data.employeeId : null,
        assignments: assignmentsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        currentAccessVersion: typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0,
        population,
    };
}
/**
 * The current APPROVED target for each requested (metric, scope), as of a date.
 *
 * Authorization is asked PER TARGET, at that target's own scope -- one call may legitimately return
 * an allowed answer and a denied one side by side, because a person's reach is not uniform across
 * warehouses or employees.
 */
async function listCurrentPerformanceGoals(input, deps) {
    const db = deps?.db ?? (0, firestore_1.getFirestore)();
    const roles = deps?.roles ?? { ...compatibilityRoles_js_1.COMPATIBILITY_ROLES, ...governedBusinessRoles_js_1.GOVERNED_BUSINESS_ROLES };
    if (typeof input?.actorUid !== "string" || input.actorUid.length === 0) {
        throw new GoalReadError("ACTOR_REQUIRED", "actorUid is required");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input?.onDate ?? "")) {
        throw new GoalReadError("DATE_REQUIRED", "onDate must be an ISO date (YYYY-MM-DD) supplied by the caller");
    }
    const targets = Array.isArray(input.targets) ? input.targets : [];
    if (targets.length === 0)
        return { results: [], onDate: input.onDate };
    if (targets.length > exports.MAX_TARGETS_PER_READ) {
        throw new GoalReadError("TOO_MANY_TARGETS", `at most ${exports.MAX_TARGETS_PER_READ} targets per call -- a larger request is refused rather than silently trimmed`);
    }
    const ctx = await loadActorContext(db, input.actorUid);
    const overrides = (0, environmentCapabilityOverrides_js_1.resolveRuntimeCapabilityOverrides)();
    const repo = (0, performanceGoalRepository_js_1.buildFirestorePerformanceGoalRepository)(db);
    const results = [];
    for (const t of targets) {
        const base = { metricId: String(t?.metricId), targetScopeType: String(t?.targetScopeType), targetScopeId: t?.targetScopeId ?? null };
        if (!(0, performanceMetricRegistry_js_1.findMetric)(base.metricId)) {
            results.push({ ...base, goal: null, denied: true, deniedFactor: "unknownMetric", unavailableReason: null });
            continue;
        }
        const decision = (0, performanceGoalAuthority_js_1.resolveGoalAuthority)({
            actorUid: input.actorUid,
            actorEmployeeId: ctx.actorEmployeeId,
            verb: "read",
            metricId: base.metricId,
            targetScopeType: base.targetScopeType,
            targetScopeId: base.targetScopeId,
            assignments: ctx.assignments,
            roles,
            currentAccessVersion: ctx.currentAccessVersion,
            population: ctx.population,
            activationOverrides: overrides,
        });
        if (decision.decision === "DENY") {
            results.push({ ...base, goal: null, denied: true, deniedFactor: decision.factor ?? null, unavailableReason: null });
            continue;
        }
        const versions = await repo.listForTarget(null, base);
        try {
            results.push({
                ...base,
                goal: (0, performanceGoal_js_1.currentGoalFor)(versions, { metricId: base.metricId, targetScopeType: base.targetScopeType, targetScopeId: base.targetScopeId }, input.onDate),
                denied: false,
                deniedFactor: null,
                unavailableReason: null,
            });
        }
        catch (err) {
            // An ambiguous version chain is a data defect, and it renders UNAVAILABLE rather than as "no
            // goal". Showing no target where a contradictory one exists would hide the defect behind a
            // state that looks deliberate.
            results.push({
                ...base,
                goal: null,
                denied: false,
                deniedFactor: null,
                unavailableReason: err instanceof performanceGoal_js_1.GoalError ? err.message : "the target could not be resolved",
            });
        }
    }
    return { results, onDate: input.onDate };
}
/**
 * Every version for one target, newest last -- the management history view.
 *
 * This is what makes "a September target stays September's target" VISIBLE rather than merely true:
 * the superseded versions are returned with their own closed windows and their own approval evidence,
 * so a person can see what they were measured against then, not only what they are measured against
 * now.
 */
async function listPerformanceGoalVersions(input, deps) {
    const db = deps?.db ?? (0, firestore_1.getFirestore)();
    const roles = deps?.roles ?? { ...compatibilityRoles_js_1.COMPATIBILITY_ROLES, ...governedBusinessRoles_js_1.GOVERNED_BUSINESS_ROLES };
    const t = input?.target;
    if (!t || !(0, performanceMetricRegistry_js_1.findMetric)(t.metricId))
        throw new GoalReadError("METRIC_UNKNOWN", "target names no registered metric");
    const ctx = await loadActorContext(db, input.actorUid);
    const decision = (0, performanceGoalAuthority_js_1.resolveGoalAuthority)({
        actorUid: input.actorUid,
        actorEmployeeId: ctx.actorEmployeeId,
        verb: "read",
        metricId: t.metricId,
        targetScopeType: t.targetScopeType,
        targetScopeId: t.targetScopeId ?? null,
        assignments: ctx.assignments,
        roles,
        currentAccessVersion: ctx.currentAccessVersion,
        population: ctx.population,
        activationOverrides: (0, environmentCapabilityOverrides_js_1.resolveRuntimeCapabilityOverrides)(),
    });
    if (decision.decision === "DENY")
        throw new GoalReadError("DENIED", decision.reason ?? "not authorized");
    const versions = await (0, performanceGoalRepository_js_1.buildFirestorePerformanceGoalRepository)(db).listForTarget(null, {
        metricId: t.metricId,
        targetScopeType: t.targetScopeType,
        targetScopeId: t.targetScopeId ?? null,
    });
    return { versions };
}
/**
 * The people this principal may author goals for.
 *
 * OFFERED == ACCEPTED: the same set factor 3 enforces on every write, so a management screen cannot
 * offer a person the command would refuse. Returns employee IDS only -- names come from the employee
 * directory read the calling surface already holds, and duplicating them here would make this service
 * a second, unauthorized source of employee identity.
 */
async function listGoalSubjects(input, deps) {
    const db = deps?.db ?? (0, firestore_1.getFirestore)();
    const ctx = await loadActorContext(db, input.actorUid);
    return { employeeIds: (0, performanceGoalAuthority_js_1.goalSubjectEmployeeIdsFor)(input.actorUid, ctx.actorEmployeeId, ctx.population) };
}
//# sourceMappingURL=performanceGoalReadService.js.map