// GOAL MANAGEMENT AUTHORITY -- may THIS principal manage THIS goal?
//
// The Owner's rule, and the whole reason this module is not three lines of role comparison:
//
//     "Holding a manager title alone must not widen scope."
//
// So nothing here reads a title, a persona, a job description, or a UI screen's reachability. Every
// factor below resolves through authority the repository already has. This module composes; it
// grants nothing and it is not a second permission layer.
//
// ============================ THE FACTORS ============================
//
// A management act must satisfy EVERY factor below. Any one failing is a denial, and the denial
// names which one -- a person told "denied" learns nothing, and a person told "you may set goals,
// but not for this employee" learns exactly what to ask for.
//
//   0. IS THIS SCOPE USABLE FOR THIS METRIC AT ALL.
//      Asked first, and deliberately ahead of any capability, because an unusable scope is not a
//      permission question and must not become answerable by holding more authority. Without it an
//      unbindable scope (TEAM) falls through to a global access target and is ALLOWED for anyone
//      holding a global grant -- the record builder would still refuse, but a screen that asked
//      only "may I?" would already have been told yes.
//
//   1. CAPABILITY AT THE TARGET'S OWN SCOPE.
//      `performance.goal.<verb>` resolved by resolveEffectivePermission against the goal's target
//      scope -- a LOCATION goal is asked at { type: "location", value: warehouseId }, not at global.
//      This is what stops a Parts Manager for wh-north touching wh-south: their assignment is
//      value-matched and simply does not reach the other warehouse.
//
//   2. AUTHORITY OVER THE NUMBER ITSELF.
//      You may not set a target on a figure you are not authorized to see. This is the factor that
//      keeps a Sales Manager out of warehouse goals and a Parts Manager out of booked-dollar goals,
//      WITHOUT anyone writing "if role === salesManager". The metric's actual has an owner; if you
//      cannot read the actual, you have no business declaring what it should be.
//      Where a metric's actual is guarded by a Role-based Rules check rather than an enumerated
//      capability, this factor is VACUOUS and says so out loud -- see METRIC_MANAGEMENT_CAPABILITY.
//
//   3. HIERARCHICAL VISIBILITY, for an EMPLOYEE-scoped goal.
//      The subject employee must be inside the actor's governed visibility set
//      (hierarchicalVisibility.ts). This is what stops a Sales Manager editing a technician's goals:
//      a technician is not beneath a Sales Manager in roleHierarchy.ts, so they are not in the set.
//      Note it also stops the case nobody thinks of -- an employee setting their OWN target -- for
//      free: visibleEmployeeIdsFor deliberately includes the viewer's own employeeId, so factor 3
//      alone would PERMIT self-targeting, and factor 5 below is what refuses it.
//
//   4. NOT YOUR OWN APPROVAL (approve only).
//      FIN-007's unconditional rule, which no policy input can re-enable.
//
// And one more, which is about the SUBJECT rather than the ACTOR:
//
//   5. AN EMPLOYEE DOES NOT AUTHOR THEIR OWN TARGET.
//      The Owner: "Employees do NOT automatically manage their own targets." Distinct from factor 4:
//      factor 4 is about who approves a request, this is about whose performance is being targeted.
//      A manager who also holds a goal of their own may still author goals for their reports.
//
// PURE. No Firestore. The caller supplies assignments, roles, the employee population and the clock,
// exactly as the rest of this repository's authority modules do, so the rules are testable without a
// database.
import { resolveEffectivePermission } from "../access/resolveEffectivePermission";
import type { PermissionId, Role, RoleAssignment, Scope } from "../types/access";
import { visibleEmployeeIdsFor, type PrincipalPosition } from "../access/hierarchicalVisibility";
import { findMetric, isScopeBindable, type GoalScopeType } from "./performanceMetricRegistry";

export const CAP_GOAL_READ = "performance.goal.read";
export const CAP_GOAL_CREATE = "performance.goal.create";
export const CAP_GOAL_APPROVE = "performance.goal.approve";
export const CAP_GOAL_SUPERSEDE = "performance.goal.supersede";
export const CAP_GOAL_RETIRE = "performance.goal.retire";

export const GOAL_VERBS = Object.freeze(["read", "create", "approve", "supersede", "retire"] as const);
export type GoalVerb = (typeof GOAL_VERBS)[number];

const CAPABILITY_FOR_VERB: Readonly<Record<GoalVerb, PermissionId>> = Object.freeze({
  read: CAP_GOAL_READ,
  create: CAP_GOAL_CREATE,
  approve: CAP_GOAL_APPROVE,
  supersede: CAP_GOAL_SUPERSEDE,
  retire: CAP_GOAL_RETIRE,
});

/**
 * FACTOR 2's table: which EXISTING capability governs the metric's ACTUAL.
 *
 * `null` is not an oversight and must not be filled in with a plausible id. It means the metric's
 * actual is guarded by a Role-based `firestore.rules` check (admin/dispatcher) rather than by an
 * enumerated capability, so there is no capability to ask for. For those metrics factor 2 is
 * vacuous and the goal's reach rests on factors 1, 3 and 5 alone.
 *
 * RECORDED RESIDUAL: because factor 2 is vacuous for the Rules-gated service metrics, a principal
 * holding `performance.goal.create` at global scope can author a FIRM-scoped service goal even if
 * their function is unrelated to service. Closing that would require either a new enumerated read
 * capability for Work Order reads (a change to a guarded authority surface, out of scope here) or a
 * title comparison (expressly forbidden). It is named here rather than papered over, and it is
 * bounded: `performance.goal.create` is granted to management Roles only, and every act is audited.
 */
export const METRIC_MANAGEMENT_CAPABILITY: Readonly<Record<string, PermissionId | null>> = Object.freeze({
  // Service / dispatch -- Rules-gated (admin/dispatcher), no enumerated read capability exists.
  "service.workOrder.pastDue.count": null,
  "service.workOrder.readyToSchedule.count": null,
  "service.workOrder.schedulingConflict.count": null,
  "service.workOrder.partsBlocked.count": null,
  // Technician -- same Rules-gated posture, but narrowed hard by factor 3 (EMPLOYEE scope only).
  "technician.workOrder.completed.cumulative.count": null,
  "technician.workOrder.open.count": null,
  // CRM -- a real enumerated capability guards the portfolio count.
  "crm.account.active.count": "customer.record.read",
  // Parts / receiving / purchasing -- the location-resolved reorder and receiving authorities.
  "parts.reorderRequest.open.count": "reorder.request.create.manual",
  "receiving.purchaseOrder.receivable.count": "inventory.stock.receive",
  "purchasing.purchaseOrder.open.count": null,
});

export type DenialFactor =
  | "unknownMetric"
  | "metricNotActiveForGoals"
  | "scopeNotUsable"
  | "noGoalCapabilityAtScope"
  | "noAuthorityOverMetric"
  | "employeeOutsideVisibility"
  | "selfTargeting"
  | "selfApproval";

export interface GoalAuthorityDecision {
  readonly decision: "ALLOW" | "DENY";
  /** Which factor refused. Present only on DENY. */
  readonly factor?: DenialFactor;
  /** Human-readable, safe to surface: it names what is missing, never what exists elsewhere. */
  readonly reason?: string;
}

const ALLOW: GoalAuthorityDecision = Object.freeze({ decision: "ALLOW" });
const deny = (factor: DenialFactor, reason: string): GoalAuthorityDecision =>
  Object.freeze({ decision: "DENY" as const, factor, reason });

export interface GoalAuthorityInput {
  actorUid: string;
  /** The actor's own employeeId, or null when the principal is not linked to an employee. */
  actorEmployeeId: string | null;
  verb: GoalVerb;
  metricId: string;
  targetScopeType: string;
  targetScopeId: string | null;
  /** For `approve`: who authored the version being decided. Ignored for every other verb. */
  authoredByUid?: string | null;
  assignments: readonly RoleAssignment[];
  roles: Readonly<Record<string, Role>>;
  currentAccessVersion: number;
  /** Every principal with their employeeId and active Roles -- loadPrincipalPositions()'s output. */
  population: readonly PrincipalPosition[];
  activationOverrides?: ReadonlySet<PermissionId>;
}

/** The access-scope a goal's target scope is asked at. FIRM asks globally; the rest are value-matched. */
export function accessScopeForTarget(targetScopeType: string, targetScopeId: string | null): Scope {
  switch (targetScopeType) {
    case "LOCATION":
      return { type: "location", value: targetScopeId ?? "" };
    case "BUSINESS_UNIT":
      return { type: "businessUnit", value: targetScopeId ?? "" };
    case "OPERATING_COMPANY":
      return { type: "operatingCompany", value: targetScopeId ?? "" };
    // An EMPLOYEE goal has no employee-typed access scope in the governed model -- there is none, and
    // inventing one would be minting a scope. It is asked GLOBALLY and then narrowed by factor 3,
    // which is the governed answer to "whose records may I reach".
    case "EMPLOYEE":
    case "FIRM":
    default:
      return { type: "global" };
  }
}

function holds(
  input: GoalAuthorityInput,
  permissionId: PermissionId,
  scope: Scope,
): boolean {
  return (
    resolveEffectivePermission({
      permissionId,
      assignments: input.assignments,
      roles: input.roles,
      currentAccessVersion: input.currentAccessVersion,
      target: { scope, condition: {} },
      activationOverrides: input.activationOverrides,
    }).decision === "ALLOW"
  );
}

/**
 * THE decision. Never throws -- every malformed input resolves to a DENY with a named factor, so a
 * caller cannot accidentally treat an exception path as permission.
 */
export function resolveGoalAuthority(input: GoalAuthorityInput): GoalAuthorityDecision {
  const metric = findMetric(input?.metricId);
  if (!metric) {
    return deny("unknownMetric", `"${String(input?.metricId)}" is not a registered performance metric`);
  }
  // A READ of an existing goal on a since-deactivated metric stays readable -- history does not
  // become unreadable because the platform stopped accepting new targets against it. Every WRITE
  // verb refuses.
  if (!metric.activeForGoals && input.verb !== "read") {
    return deny(
      "metricNotActiveForGoals",
      `"${metric.metricId}" is registered but not active for goals: ${metric.blockedBy}`,
    );
  }

  // --- FACTOR 0: is this scope usable for this metric at all --------------
  // Asked BEFORE any capability, because an unusable scope is not a permission question and must not
  // be answerable by holding more authority. Without this check an unbindable scope (TEAM) would fall
  // through accessScopeForTarget's default to { type: "global" } and be ALLOWED for anyone holding a
  // global grant -- the record builder would then refuse it, but a caller that asked authority alone
  // would already have been told yes. buildPerformanceGoal enforces the same two rules; they are
  // repeated here rather than shared because the two questions have different callers and a screen
  // that only asks "may I?" must get the same answer as the command that only asks "is this valid?".
  if (!metric.supportedScopes.includes(input.targetScopeType as GoalScopeType)) {
    return deny(
      "scopeNotUsable",
      `"${metric.metricId}" supports scope ${metric.supportedScopes.join("/")} -- not ${String(input.targetScopeType)}`,
    );
  }
  if (!isScopeBindable(input.targetScopeType)) {
    return deny(
      "scopeNotUsable",
      `scope ${String(input.targetScopeType)} has no governed binding in this repository, so no principal can hold authority over it`,
    );
  }

  const scope = accessScopeForTarget(input.targetScopeType, input.targetScopeId);

  // --- FACTOR 1: the goal capability, at the target's own scope ------------
  const goalCapability = CAPABILITY_FOR_VERB[input.verb];
  if (!goalCapability || !holds(input, goalCapability, scope)) {
    return deny(
      "noGoalCapabilityAtScope",
      `no qualifying grant of ${goalCapability ?? String(input.verb)} at ${input.targetScopeType}${input.targetScopeId ? `:${input.targetScopeId}` : ""}`,
    );
  }

  // --- FACTOR 2: authority over the number itself -------------------------
  // Deliberately applied to READ as well: seeing someone's target is seeing a claim about their
  // performance on a figure, and if the figure is closed to you the target is too.
  const metricCapability = METRIC_MANAGEMENT_CAPABILITY[metric.metricId] ?? null;
  if (metricCapability !== null && !holds(input, metricCapability, scope)) {
    return deny(
      "noAuthorityOverMetric",
      `setting a target on "${metric.metricId}" requires ${metricCapability} -- a target may not be declared on a figure the actor is not authorized to see`,
    );
  }

  // --- FACTOR 3: hierarchical visibility, for an EMPLOYEE target -----------
  if ((input.targetScopeType as GoalScopeType) === "EMPLOYEE") {
    const subject = input.targetScopeId;
    if (!subject) {
      return deny("employeeOutsideVisibility", "an EMPLOYEE goal requires the subject employeeId");
    }
    const visible = visibleEmployeeIdsFor(input.actorUid, input.population ?? []);
    if (!visible.has(subject)) {
      return deny(
        "employeeOutsideVisibility",
        "that employee is not within your governed visibility -- position confers reach, and reach is not conferred by holding a management capability",
      );
    }

    // --- FACTOR 5: an employee does not author their own target -----------
    // visibleEmployeeIdsFor ALWAYS includes the viewer's own employeeId (a leaf role would otherwise
    // hide someone from themselves), so factor 3 alone would permit this. Read is exempt: seeing
    // your own goal is the point of having one.
    if (input.verb !== "read" && input.actorEmployeeId !== null && subject === input.actorEmployeeId) {
      return deny(
        "selfTargeting",
        "an employee does not manage their own target -- a goal for you is authored by someone above you",
      );
    }
  }

  // --- FACTOR 4: no self-approval -----------------------------------------
  if (input.verb === "approve") {
    const author = typeof input.authoredByUid === "string" ? input.authoredByUid.trim() : "";
    if (author.length === 0) {
      return deny("selfApproval", "the authoring principal must be known before a goal version can be approved");
    }
    if (author === input.actorUid.trim()) {
      return deny(
        "selfApproval",
        "the author of a goal version may not approve it -- under any policy (FIN-007)",
      );
    }
  }

  return ALLOW;
}

/**
 * The employees a manager may author goals FOR -- the picker's contents.
 *
 * OFFERED == ACCEPTED. This is deliberately the same visibility set factor 3 enforces, so a
 * management screen cannot offer a person the command would then refuse. The repository's own
 * precedent for this discipline is the reorder warehouse picker, which "filters by the same
 * authority the create enforces". A screen that loads everyone and hides rows client-side is not a
 * filter at all -- the data was already sent.
 *
 * The actor's own employeeId is REMOVED here, matching factor 5: a manager's own goal is authored by
 * someone above them, so offering themselves in their own picker would offer a refusal.
 */
export function goalSubjectEmployeeIdsFor(
  actorUid: string,
  actorEmployeeId: string | null,
  population: readonly PrincipalPosition[],
): readonly string[] {
  const visible = new Set(visibleEmployeeIdsFor(actorUid, population ?? []));
  if (actorEmployeeId) visible.delete(actorEmployeeId);
  return Object.freeze([...visible].sort());
}
