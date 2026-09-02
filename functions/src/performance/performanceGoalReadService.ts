// PERFORMANCE GOAL -- the governed read.
//
// ============================ BOUNDED BY CONSTRUCTION ============================
//
// This service answers "what is the target for THESE named things", never "show me the goals". There
// is no unbounded listing here and there must not be one: an unbounded read over a collection this
// service cannot fully authorize in one query would either scan everything and filter after the fact
// -- which is not a filter, the data was already read -- or return a page and call it a total, which
// the dashboard-wide truncation rule forbids.
//
// So the caller names its targets. A dashboard already knows which ones it is drawing (my employee
// id, this warehouse, the firm), and a management screen gets its list from
// goalSubjectEmployeeIdsFor, which is the SAME visibility set the write commands enforce.
//
// ============================ IT RETURNS TARGETS, NEVER ACTUALS ============================
//
// Not one number in the result came from a business record. Composing a target with an actual is the
// DASHBOARD's job, done against each domain's own read at that domain's own scope -- because a
// service that fetched both would become a second place where domain authority is resolved.
import type { Firestore } from "firebase-admin/firestore";
import { getFirestore } from "firebase-admin/firestore";
import type { Role } from "../types/access";
import { COMPATIBILITY_ROLES } from "../access/compatibilityRoles.js";
import { GOVERNED_BUSINESS_ROLES } from "../access/governedBusinessRoles.js";
import { loadPrincipalPositions, type PrincipalPosition } from "../access/hierarchicalVisibility.js";
import { resolveRuntimeCapabilityOverrides } from "../access/environmentCapabilityOverrides.js";
import { currentGoalFor, GoalError, type PerformanceGoal } from "./performanceGoal.js";
import { findMetric } from "./performanceMetricRegistry.js";
import { resolveGoalAuthority, goalSubjectEmployeeIdsFor } from "./performanceGoalAuthority.js";
import { buildFirestorePerformanceGoalRepository } from "./performanceGoalRepository.js";

/** The cap on how many targets one call may ask about. A request above it is REFUSED, not trimmed --
 *  trimming would answer a different question than the one asked and say nothing about having done so. */
export const MAX_TARGETS_PER_READ = 40;

export class GoalReadError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.name = "GoalReadError"; this.code = code; }
}

export interface GoalTargetRequest {
  metricId: string;
  targetScopeType: string;
  targetScopeId: string | null;
}

/**
 * One target's answer. Note the three DISTINCT absences, which a dashboard must render differently:
 *
 *   goal: null, denied: false, unavailableReason: null  -- no target has been set. An honest empty.
 *   goal: null, denied: true                            -- outside your governed reach. A permission
 *                                                          fact, and never phrased as an error.
 *   goal: null, unavailableReason: <string>             -- a target exists but could not be resolved
 *                                                          (an ambiguous version chain). NOT "no goal".
 *
 * Collapsing these into one empty state is how "you may not see this" becomes "there isn't one".
 */
export interface GoalTargetResult {
  readonly metricId: string;
  readonly targetScopeType: string;
  readonly targetScopeId: string | null;
  readonly goal: PerformanceGoal | null;
  readonly denied: boolean;
  readonly deniedFactor: string | null;
  readonly unavailableReason: string | null;
}

export interface ListCurrentGoalsInput {
  actorUid: string;
  targets: readonly GoalTargetRequest[];
  /** ISO date the targets are resolved AS OF. Supplied by the caller -- this service owns no clock. */
  onDate: string;
}

export interface PerformanceGoalReadDeps {
  db?: Firestore;
  roles?: Readonly<Record<string, Role>>;
}

interface ActorContext {
  actorEmployeeId: string | null;
  assignments: readonly unknown[];
  currentAccessVersion: number;
  population: PrincipalPosition[];
}

async function loadActorContext(db: Firestore, actorUid: string): Promise<ActorContext> {
  const [userSnap, assignmentsSnap, population] = await Promise.all([
    db.collection("users").doc(actorUid).get(),
    db.collection("roleAssignments").where("principalUid", "==", actorUid).where("status", "==", "active").get(),
    loadPrincipalPositions(db),
  ]);
  const data = userSnap.data() as Record<string, unknown> | undefined;
  const v = data?.accessVersion;
  return {
    actorEmployeeId: typeof data?.employeeId === "string" ? (data.employeeId as string) : null,
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
export async function listCurrentPerformanceGoals(
  input: ListCurrentGoalsInput,
  deps?: PerformanceGoalReadDeps,
): Promise<{ results: GoalTargetResult[]; onDate: string }> {
  const db = deps?.db ?? getFirestore();
  const roles = deps?.roles ?? ({ ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES } as Readonly<Record<string, Role>>);

  if (typeof input?.actorUid !== "string" || input.actorUid.length === 0) {
    throw new GoalReadError("ACTOR_REQUIRED", "actorUid is required");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input?.onDate ?? "")) {
    throw new GoalReadError("DATE_REQUIRED", "onDate must be an ISO date (YYYY-MM-DD) supplied by the caller");
  }
  const targets = Array.isArray(input.targets) ? input.targets : [];
  if (targets.length === 0) return { results: [], onDate: input.onDate };
  if (targets.length > MAX_TARGETS_PER_READ) {
    throw new GoalReadError("TOO_MANY_TARGETS", `at most ${MAX_TARGETS_PER_READ} targets per call -- a larger request is refused rather than silently trimmed`);
  }

  const ctx = await loadActorContext(db, input.actorUid);
  const overrides = resolveRuntimeCapabilityOverrides();
  const repo = buildFirestorePerformanceGoalRepository(db);
  const results: GoalTargetResult[] = [];

  for (const t of targets) {
    const base = { metricId: String(t?.metricId), targetScopeType: String(t?.targetScopeType), targetScopeId: t?.targetScopeId ?? null };

    if (!findMetric(base.metricId)) {
      results.push({ ...base, goal: null, denied: true, deniedFactor: "unknownMetric", unavailableReason: null });
      continue;
    }

    const decision = resolveGoalAuthority({
      actorUid: input.actorUid,
      actorEmployeeId: ctx.actorEmployeeId,
      verb: "read",
      metricId: base.metricId,
      targetScopeType: base.targetScopeType,
      targetScopeId: base.targetScopeId,
      assignments: ctx.assignments as never[],
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
        goal: currentGoalFor(versions, { metricId: base.metricId, targetScopeType: base.targetScopeType as never, targetScopeId: base.targetScopeId }, input.onDate),
        denied: false,
        deniedFactor: null,
        unavailableReason: null,
      });
    } catch (err) {
      // An ambiguous version chain is a data defect, and it renders UNAVAILABLE rather than as "no
      // goal". Showing no target where a contradictory one exists would hide the defect behind a
      // state that looks deliberate.
      results.push({
        ...base,
        goal: null,
        denied: false,
        deniedFactor: null,
        unavailableReason: err instanceof GoalError ? err.message : "the target could not be resolved",
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
export async function listPerformanceGoalVersions(
  input: { actorUid: string; target: GoalTargetRequest },
  deps?: PerformanceGoalReadDeps,
): Promise<{ versions: PerformanceGoal[] }> {
  const db = deps?.db ?? getFirestore();
  const roles = deps?.roles ?? ({ ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES } as Readonly<Record<string, Role>>);
  const t = input?.target;
  if (!t || !findMetric(t.metricId)) throw new GoalReadError("METRIC_UNKNOWN", "target names no registered metric");

  const ctx = await loadActorContext(db, input.actorUid);
  const decision = resolveGoalAuthority({
    actorUid: input.actorUid,
    actorEmployeeId: ctx.actorEmployeeId,
    verb: "read",
    metricId: t.metricId,
    targetScopeType: t.targetScopeType,
    targetScopeId: t.targetScopeId ?? null,
    assignments: ctx.assignments as never[],
    roles,
    currentAccessVersion: ctx.currentAccessVersion,
    population: ctx.population,
    activationOverrides: resolveRuntimeCapabilityOverrides(),
  });
  if (decision.decision === "DENY") throw new GoalReadError("DENIED", decision.reason ?? "not authorized");

  const versions = await buildFirestorePerformanceGoalRepository(db).listForTarget(null, {
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
export async function listGoalSubjects(
  input: { actorUid: string },
  deps?: PerformanceGoalReadDeps,
): Promise<{ employeeIds: readonly string[] }> {
  const db = deps?.db ?? getFirestore();
  const ctx = await loadActorContext(db, input.actorUid);
  return { employeeIds: goalSubjectEmployeeIdsFor(input.actorUid, ctx.actorEmployeeId, ctx.population) };
}
