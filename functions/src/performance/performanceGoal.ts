// PERFORMANCE GOAL AUTHORITY -- the PURE core. A goal is a versioned, effective-dated, approved
// TARGET. That is all it is.
//
// ============================ THE ONE INVARIANT ============================
//
//     DOMAIN AUTHORITY OWNS THE ACTUAL.
//     PERFORMANCE GOAL AUTHORITY OWNS THE TARGET.
//     THE DASHBOARD COMPARES THEM.
//
// There is not one measurement in this file. A goal record never carries, caches, or recomputes an
// actual; `evaluateGoal` is handed an actual that a domain already computed and does arithmetic on
// two numbers. If this module ever grows a query, the invariant has been broken.
//
// ============================ RECONCILED WITH FIN-003, NOT PARALLEL TO IT ============================
//
// FIN-003 (finance/planVsActual.ts) already defines a versioned GOAL|BUDGET plan with a
// DRAFT→APPROVED→SUPERSEDED lifecycle, an explicit measurement basis, and a never-blend comparison
// core -- merged, tested, and dormant for want of storage and an approval authority. Building a
// second goal system beside it was the obvious wrong move and the Owner named it: "reconcile FIN-003
// rather than creating two competing goal systems."
//
// So this is the reconciliation, and it runs in ONE direction:
//
//   • This module is the GENERAL authority. A goal may be a count, a percentage, a duration or an
//     amount, over a service/technician/inventory/sales metric.
//   • A goal whose metric declares a `financialBasis` IS a FIN-003 plan. `planRecordForGoal()`
//     projects it through FIN-003's own `buildPlanRecord`, and its comparison runs through FIN-003's
//     own `comparePlanToActual`. There is no second money path, no second never-blend rule, and no
//     second definition of what BOOKED means.
//   • Approval composes FIN-007 (finance/financialApprovals.ts), whose APPROVABLE_ACTION_TYPES
//     already reserves "PLAN_APPROVAL -- approving a GOAL/BUDGET version (FIN-003)" with a nullable
//     amount expressly "for non-monetary actions (e.g. plan approval)". FIN-007 supplies the
//     mechanical invariants (approval required by default, SELF-APPROVAL FORBIDDEN under any policy,
//     a reason is mandatory, a rejection is terminal). WHO may approve is the one thing FIN-007
//     deliberately leaves to its composer, and that lives in performanceGoalAuthority.ts.
//
// What FIN-003 was missing was storage and an approval authority. It now has both, and it did not
// have to change to get them.
//
// ============================ HISTORY IS NOT REWRITTEN ============================
//
// A September target stays September's target after October's target changes. That is not a
// convention here, it is the shape of the data: superseding does not EDIT a goal, it closes the old
// version's effective window and writes a new version beside it. `currentGoalFor()` then resolves by
// DATE, so asking "what was the target in September" and "what is the target now" are the same
// question with different arguments and cannot disagree.
//
// PURE. No Firestore, no clock, no ambient time -- every timestamp is supplied by the caller.
import {
  buildPlanRecord,
  type PlanRecord,
  type MeasurementBasis,
} from "../finance/planVsActual";
import {
  findMetric,
  isScopeBindable,
  type GoalScopeType,
  type PerformanceMetric,
} from "./performanceMetricRegistry";

export const GOAL_DIRECTIONS = Object.freeze(["AT_LEAST", "AT_MOST", "EXACT"] as const);
export type GoalDirection = (typeof GOAL_DIRECTIONS)[number];

/**
 * DRAFT      -- authored, not yet a measurement authority. Never compared against.
 * APPROVED   -- in force for its effective window. The ONLY status a comparison may use.
 * SUPERSEDED -- replaced by a later version. Remains readable history; its window is closed.
 * RETIRED    -- withdrawn without a replacement. Distinct from SUPERSEDED on purpose: "we changed
 *               the number" and "we stopped measuring this" are different facts, and collapsing
 *               them would make a retired goal look like it had a successor that nobody can find.
 */
export const GOAL_STATUSES = Object.freeze(["DRAFT", "APPROVED", "SUPERSEDED", "RETIRED"] as const);
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export class GoalError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "GoalError";
    this.code = code;
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

export interface PerformanceGoalInput {
  goalId: string;
  metricId: string;
  targetScopeType: string;
  /** The bound id (employeeId / warehouseId / businessUnitId / operatingCompanyId). NULL for FIRM,
   *  which is the one scope that needs no value -- and is required to be null, so that "the whole
   *  firm" can never be confused with "a scope whose id we failed to record". */
  targetScopeId: string | null;
  targetValue: number;
  unit: string;
  direction: string;
  /** Required iff unit is CURRENCY_MINOR; must be absent otherwise. A currency on a count is a
   *  category error, not a harmless extra field. */
  currency?: string | null;
  effectiveFrom: string; // YYYY-MM-DD inclusive
  /** NULL = open-ended (in force until superseded or retired). */
  effectiveTo: string | null;
  status: string;
  version: number;
  createdByUid: string;
  createdAtMillis: number;
  approvedByUid?: string | null;
  approvedAtMillis?: number | null;
  supersedesGoalId?: string | null;
}

export interface PerformanceGoal {
  readonly goalId: string;
  readonly metricId: string;
  readonly targetScopeType: GoalScopeType;
  readonly targetScopeId: string | null;
  readonly targetValue: number;
  readonly unit: string;
  readonly direction: GoalDirection;
  readonly currency: string | null;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly status: GoalStatus;
  readonly version: number;
  readonly createdByUid: string;
  readonly createdAtMillis: number;
  readonly approvedByUid: string | null;
  readonly approvedAtMillis: number | null;
  readonly supersedesGoalId: string | null;
}

/**
 * Validate + freeze one goal version. Pure validation only -- persistence, version NUMBERING and
 * approval AUTHORITY live elsewhere (repository / command service / authority module respectively).
 *
 * Every refusal below is a category error rather than a preference. In particular:
 *  - an UNREGISTERED metric is refused, because a target nobody can measure is not a target;
 *  - a REGISTERED but inactive metric is refused WITH ITS BLOCKER NAMED, so the person who wanted
 *    the goal learns what actually stands in the way rather than that "it didn't work";
 *  - a unit or direction that disagrees with the registry is refused rather than coerced, because
 *    coercion is how "5" silently becomes five percent.
 */
export function buildPerformanceGoal(input: PerformanceGoalInput): PerformanceGoal {
  if (!nonEmpty(input?.goalId) || !ID_PATTERN.test(input.goalId)) {
    throw new GoalError("GOAL_ID_INVALID", "goalId must match [A-Za-z0-9_-]{1,128}");
  }

  const metric = findMetric(input.metricId);
  if (!metric) {
    throw new GoalError(
      "METRIC_UNKNOWN",
      `metricId "${String(input.metricId)}" is not in the performance metric registry -- a goal may only name a registered metric`,
    );
  }
  if (!metric.activeForGoals) {
    throw new GoalError(
      "METRIC_NOT_ACTIVE_FOR_GOALS",
      `metric "${metric.metricId}" is registered but not active for goals: ${metric.blockedBy}`,
    );
  }

  if (!(GOAL_STATUSES as readonly string[]).includes(input.status)) {
    throw new GoalError("STATUS_INVALID", `status must be one of ${GOAL_STATUSES.join("/")}`);
  }
  if (!(GOAL_DIRECTIONS as readonly string[]).includes(input.direction)) {
    throw new GoalError("DIRECTION_INVALID", `direction must be one of ${GOAL_DIRECTIONS.join("/")}`);
  }
  if (!metric.allowedDirections.includes(input.direction as GoalDirection)) {
    throw new GoalError(
      "DIRECTION_NOT_ALLOWED",
      `metric "${metric.metricId}" allows direction ${metric.allowedDirections.join("/")} -- ${input.direction} would invert its meaning`,
    );
  }
  if (input.unit !== metric.unit) {
    throw new GoalError(
      "UNIT_MISMATCH",
      `metric "${metric.metricId}" is measured in ${metric.unit}, not ${String(input.unit)} -- a target in the wrong unit is not a smaller number, it is a different claim`,
    );
  }

  // --- scope ---------------------------------------------------------------
  if (!metric.supportedScopes.includes(input.targetScopeType as GoalScopeType)) {
    throw new GoalError(
      "SCOPE_NOT_SUPPORTED",
      `metric "${metric.metricId}" supports scope ${metric.supportedScopes.join("/")} -- not ${String(input.targetScopeType)}`,
    );
  }
  if (!isScopeBindable(input.targetScopeType)) {
    throw new GoalError(
      "SCOPE_NOT_BINDABLE",
      `scope ${String(input.targetScopeType)} has no governed binding in this repository, so a goal targeting it could never be measured against a provable population`,
    );
  }
  if (input.targetScopeType === "FIRM") {
    if (input.targetScopeId !== null && input.targetScopeId !== undefined) {
      throw new GoalError("SCOPE_ID_UNEXPECTED", "a FIRM goal carries no targetScopeId -- it is the whole authorized population");
    }
  } else if (!nonEmpty(input.targetScopeId) || !ID_PATTERN.test(input.targetScopeId as string)) {
    throw new GoalError("SCOPE_ID_REQUIRED", `a ${input.targetScopeType} goal requires a targetScopeId matching [A-Za-z0-9_-]{1,128}`);
  }

  // --- target value --------------------------------------------------------
  if (!isInt(input.targetValue) || input.targetValue < 0) {
    throw new GoalError("TARGET_INVALID", "targetValue must be a non-negative integer");
  }
  if (metric.unit === "PERCENT" && input.targetValue > 100) {
    throw new GoalError("TARGET_INVALID", "a PERCENT target must be 0..100 percentage points");
  }
  if (metric.unit === "CURRENCY_MINOR") {
    if (!nonEmpty(input.currency)) throw new GoalError("CURRENCY_REQUIRED", "a CURRENCY_MINOR target requires an explicit currency");
  } else if (input.currency !== undefined && input.currency !== null) {
    throw new GoalError("CURRENCY_UNEXPECTED", `metric "${metric.metricId}" is measured in ${metric.unit} -- a currency on it is a category error`);
  }

  // --- effective window ----------------------------------------------------
  if (!ISO_DATE.test(input.effectiveFrom ?? "")) {
    throw new GoalError("EFFECTIVE_FROM_INVALID", "effectiveFrom must be an ISO date (YYYY-MM-DD)");
  }
  if (input.effectiveTo !== null && input.effectiveTo !== undefined) {
    if (!ISO_DATE.test(input.effectiveTo)) throw new GoalError("EFFECTIVE_TO_INVALID", "effectiveTo must be an ISO date (YYYY-MM-DD) or null");
    if (input.effectiveTo < input.effectiveFrom) throw new GoalError("EFFECTIVE_TO_INVALID", "effectiveTo precedes effectiveFrom");
  }

  // --- version + lifecycle -------------------------------------------------
  if (!isInt(input.version) || input.version < 1) throw new GoalError("VERSION_INVALID", "version must be a positive integer");
  if (!nonEmpty(input.createdByUid)) throw new GoalError("REQUIRED", "createdByUid is required");
  if (!isInt(input.createdAtMillis) || input.createdAtMillis <= 0) throw new GoalError("REQUIRED", "createdAtMillis (ms epoch) is required");

  const approvedBy = nonEmpty(input.approvedByUid) ? input.approvedByUid.trim() : null;
  const approvedAt = isInt(input.approvedAtMillis) && (input.approvedAtMillis as number) > 0 ? (input.approvedAtMillis as number) : null;

  if (input.status === "DRAFT" && (approvedBy !== null || approvedAt !== null)) {
    throw new GoalError("DRAFT_NOT_APPROVED", "a DRAFT goal carries no approver -- DRAFT and APPROVED are different facts and one may not wear the other's evidence");
  }
  if (input.status !== "DRAFT" && (approvedBy === null || approvedAt === null)) {
    throw new GoalError("APPROVAL_EVIDENCE_REQUIRED", `a ${input.status} goal must name who approved it and when`);
  }
  // FIN-007's rule, restated at the record boundary so a malformed record cannot carry it past the
  // command that would otherwise be the only place it is checked.
  if (approvedBy !== null && approvedBy === input.createdByUid.trim()) {
    throw new GoalError("SELF_APPROVAL_FORBIDDEN", "the author of a goal may not approve it -- under any policy");
  }

  const supersedes = nonEmpty(input.supersedesGoalId) ? input.supersedesGoalId.trim() : null;
  if (supersedes !== null && input.version === 1) {
    throw new GoalError("SUPERSEDES_INVALID", "version 1 supersedes nothing");
  }
  if (supersedes === null && input.version > 1) {
    throw new GoalError("SUPERSEDES_REQUIRED", "a version above 1 must name the goal version it supersedes, or the chain has a hole in it");
  }
  if (supersedes === input.goalId) {
    throw new GoalError("SUPERSEDES_INVALID", "a goal cannot supersede itself");
  }

  return Object.freeze({
    goalId: input.goalId.trim(),
    metricId: metric.metricId,
    targetScopeType: input.targetScopeType as GoalScopeType,
    targetScopeId: input.targetScopeType === "FIRM" ? null : (input.targetScopeId as string).trim(),
    targetValue: input.targetValue,
    unit: metric.unit,
    direction: input.direction as GoalDirection,
    currency: metric.unit === "CURRENCY_MINOR" ? (input.currency as string).trim() : null,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo ?? null,
    status: input.status as GoalStatus,
    version: input.version,
    createdByUid: input.createdByUid.trim(),
    createdAtMillis: input.createdAtMillis,
    approvedByUid: approvedBy,
    approvedAtMillis: approvedAt,
    supersedesGoalId: supersedes,
  });
}

/** Does this goal's effective window cover `onDate` (inclusive both ends, open-ended when null)? */
export function goalCoversDate(goal: PerformanceGoal, onDate: string): boolean {
  if (!ISO_DATE.test(onDate ?? "")) throw new GoalError("DATE_INVALID", "onDate must be an ISO date (YYYY-MM-DD)");
  if (onDate < goal.effectiveFrom) return false;
  return goal.effectiveTo === null || onDate <= goal.effectiveTo;
}

/** Identity of the thing a goal targets -- one metric at one scope. */
export interface GoalTarget {
  metricId: string;
  targetScopeType: GoalScopeType;
  targetScopeId: string | null;
}

function sameTarget(goal: PerformanceGoal, target: GoalTarget): boolean {
  return (
    goal.metricId === target.metricId &&
    goal.targetScopeType === target.targetScopeType &&
    (goal.targetScopeId ?? null) === (target.targetScopeId ?? null)
  );
}

/**
 * THE goal in force for one target on one date -- or null when there is none.
 *
 * Only APPROVED versions are considered: a DRAFT is not a measurement authority, and SUPERSEDED and
 * RETIRED are history. This is FIN-003's rule (`comparePlanToActual` refuses anything not APPROVED)
 * applied at selection time rather than only at comparison time, so a caller cannot accidentally
 * hold a draft and believe it has the target.
 *
 * AMBIGUITY IS A REFUSAL, NOT A TIE-BREAK. Two APPROVED versions covering one date for one target
 * is a supersession that did not close its predecessor's window -- a data defect. Picking the newer
 * one would hide it, and the hidden version of this defect is the one where a manager's screen and
 * an employee's screen quietly show different targets. The precedent is `selectCurrentForecast`,
 * which raises AS_OF_AMBIGUOUS rather than resolving a tie by array order.
 */
export function currentGoalFor(
  goals: readonly PerformanceGoal[],
  target: GoalTarget,
  onDate: string,
): PerformanceGoal | null {
  const candidates = (Array.isArray(goals) ? goals : []).filter(
    (g) => g && g.status === "APPROVED" && sameTarget(g, target) && goalCoversDate(g, onDate),
  );
  if (candidates.length === 0) return null;
  if (candidates.length > 1) {
    throw new GoalError(
      "GOAL_AMBIGUOUS",
      `${candidates.length} APPROVED goals cover ${target.metricId} at ${target.targetScopeType}:${target.targetScopeId ?? "-"} on ${onDate} (${candidates
        .map((g) => `${g.goalId}@v${g.version}`)
        .join(", ")}) -- a supersession failed to close the earlier window`,
    );
  }
  return candidates[0];
}

export interface GoalEvaluation {
  readonly metricId: string;
  readonly unit: string;
  readonly direction: GoalDirection;
  readonly targetValue: number;
  readonly actualValue: number;
  /** actual − target. Positive means above the target NUMBER, which is good for AT_LEAST and bad
   *  for AT_MOST -- the sign is arithmetic, `met` is the judgement. */
  readonly variance: number;
  readonly met: boolean;
  /**
   * Percent of target achieved -- ONLY for AT_LEAST, where "80% of goal" is the conventional and
   * unambiguous reading. NULL for AT_MOST and EXACT on purpose: "80% attainment" of a past-due
   * target of 5 means nothing a reader would agree on, and a plausible number here would be worse
   * than no number. A target of 0 also yields null, because every actual would otherwise be
   * infinite attainment.
   */
  readonly attainmentPercent: number | null;
}

/**
 * Compare ONE already-computed actual against ONE approved goal.
 *
 * The actual arrives from the domain that owns it. This function does not know where it came from
 * and must not: its whole job is the arithmetic of "did the number meet the target", which is the
 * only part of a comparison that belongs to the TARGET rather than to the measurement.
 */
export function evaluateGoal(goal: PerformanceGoal, actualValue: number): GoalEvaluation {
  if (goal?.status !== "APPROVED") {
    throw new GoalError(
      "GOAL_NOT_APPROVED",
      `only an APPROVED goal is a measurement authority (status ${goal?.status}) -- drafts and superseded versions are history`,
    );
  }
  if (typeof actualValue !== "number" || !Number.isFinite(actualValue)) {
    throw new GoalError("ACTUAL_INVALID", "actualValue must be a finite number -- UNKNOWN is not a number and must not reach this function");
  }

  const met =
    goal.direction === "AT_LEAST" ? actualValue >= goal.targetValue
      : goal.direction === "AT_MOST" ? actualValue <= goal.targetValue
        : actualValue === goal.targetValue;

  const attainmentPercent =
    goal.direction === "AT_LEAST" && goal.targetValue > 0
      ? Math.round((actualValue / goal.targetValue) * 100)
      : null;

  return Object.freeze({
    metricId: goal.metricId,
    unit: goal.unit,
    direction: goal.direction,
    targetValue: goal.targetValue,
    actualValue,
    variance: actualValue - goal.targetValue,
    met,
    attainmentPercent,
  });
}

/**
 * Project a FINANCIAL goal into a FIN-003 PlanRecord, so its comparison runs through FIN-003's own
 * never-blend core instead of a second money path here.
 *
 * This is the reconciliation made executable. `comparePlanToActual(planRecordForGoal(goal), facts)`
 * is how a booked-dollar goal is measured; nothing in this module sums a currency, filters a fact
 * by period, or decides whether two bases may be compared -- FIN-003 already owns all three.
 *
 * Refuses a non-financial metric rather than inventing a basis for it: a count has no measurement
 * basis, and giving it one to satisfy a type would be exactly the silent blend FIN-003 exists to
 * prevent.
 */
export function planRecordForGoal(goal: PerformanceGoal, metric?: PerformanceMetric): PlanRecord {
  const m = metric ?? findMetric(goal.metricId);
  if (!m) throw new GoalError("METRIC_UNKNOWN", `metric "${goal.metricId}" is not registered`);
  if (m.financialBasis === null) {
    throw new GoalError(
      "NOT_A_FINANCIAL_GOAL",
      `metric "${m.metricId}" declares no financialBasis -- it is measured in ${m.unit}, and a plan record would have to invent a basis it does not have`,
    );
  }
  if (goal.effectiveTo === null) {
    throw new GoalError(
      "PERIOD_REQUIRED",
      "a FIN-003 plan requires a closed period; an open-ended financial goal has no window to accumulate facts over",
    );
  }
  return buildPlanRecord({
    planType: "GOAL",
    version: goal.version,
    status: goal.status === "APPROVED" ? "APPROVED" : goal.status === "SUPERSEDED" ? "SUPERSEDED" : "DRAFT",
    measurementBasis: m.financialBasis as MeasurementBasis,
    currency: goal.currency as string,
    amountMinor: goal.targetValue,
    periodStart: goal.effectiveFrom,
    periodEnd: goal.effectiveTo,
    scope: {
      operatingCompanyId: goal.targetScopeType === "OPERATING_COMPANY" ? goal.targetScopeId : null,
      businessUnitId: goal.targetScopeType === "BUSINESS_UNIT" ? goal.targetScopeId : null,
      creditedSalespersonId: goal.targetScopeType === "EMPLOYEE" ? goal.targetScopeId : null,
    },
  });
}
