// PERFORMANCE GOALS ON EOS -- THE THREE READS (Firebase exit B4, DECISIONS #B4; F7d). It replaces the Firebase callables
// listCurrentPerformanceGoals, listPerformanceGoalVersions and listGoalSubjects with the SAME answers over eos_ops.performance_goals:
//
//   * a goal is a versioned, effective-dated, approved TARGET -- never an actual. Not one number in an answer came from a business record; pairing a
//     target with a measurement is the dashboard's job, against each domain's own read;
//   * the call names its targets (at most 40, refused above rather than trimmed); there is no "show me the goals" listing;
//   * the three absences stay three: no target set / outside your governed reach (denied, with the factor) / a target that exists but could not be
//     resolved (an ambiguous version chain is a data defect, rendered UNAVAILABLE and never as "no goal").
//
// THE FOUR FACTORS, translated to what EOS decides with. The Firebase authority (performance/performanceGoalAuthority.ts) resolves a role assignment
// SCOPED to the target; EOS holds capabilities flat and decides reach separately, so each factor is asked the EOS way, fail-closed, in the same order:
//   0. the metric is registered and the scope is usable for it and bindable (the metric registry, unchanged);
//   1. performance.goal.read (flat), and REACH to the target's scope: FIRM = any caller with operating-company authority (a firm target "is a target for
//      everyone, not a licence to see everything"); OPERATING_COMPANY = a company the caller is authorized for; LOCATION = a warehouse of a company the
//      caller reaches AND over which it holds the WAREHOUSE Operational Scope (DQ-017); BUSINESS_UNIT = DENIED (no EOS business-unit authority exists);
//      EMPLOYEE = see 3. TEAM is never bindable;
//   2. authority over the number itself: the metric's own existing read capability where the registry names one (flat);
//   3. EMPLOYEE targets: the subject must be inside the caller's governed hierarchical visibility (access/hierarchicalVisibility.ts, unchanged, over the
//      tenant's active Role assignments) AND belong to a company the caller reaches (company isolation: a role subtree never crosses a company).
// KNOWN DIVERGENCE (DECISIONS #B4, LOW-1): Firebase requires a GLOBAL (unscoped) holding for a FIRM target, so a holder whose performance.goal.read comes only from a
// scoped assignment is denied FIRM there. EOS decides on a flat capability set that does not say whether the holding was scoped, so a scoped holder with operating-company
// authority CAN read a FIRM target here. It widens nothing beyond the firm-wide target (a target, never an actual) and no scoped assignment of this capability exists in EOS.
// The Firebase catalog's scopesByPermission / conditionsByPermission are NOT modelled either (recordsReportingOffline pins that statement).
// Factor 4 (self-approval) and factor 5 (self-targeting) govern WRITES: the EOS writers are performanceGoalAuthoring.ts (G-1), which reuses the reach, metric and subject
// decisions below (decideGoalReach / decideMetricAuthority / decideEmployeeSubject). A goal's own subject can read it.
//
// COMPANY (#235 / #237): capability first, then company. A caller with no operating-company authority is REFUSED, never answered with an empty list.
import type { Pool, PoolClient } from "pg";
import { visibleEmployeeIdsFor, type PrincipalPosition } from "../access/hierarchicalVisibilityCore.js";
import { currentGoalFor, GoalError, type PerformanceGoal } from "../performance/performanceGoal.js";
import { findMetric, isScopeBindable, type GoalScopeType } from "../performance/performanceMetricRegistry.js";
import { scopedWarehouseIds } from "./partsReads.js";
import { acceptOnly, DATE_AS_TEXT, inTransaction, isPlainObject, reachableCompanies, refuse, requireCapability, type ReachableCompanies, type RecordsActor } from "./recordsSupport.js";

const SCHEMA = "eos_ops";
export const GOAL_READ_CAPABILITY = "performance.goal.read";
/** The cap on how many targets one call may ask about. Above it is REFUSED -- trimming would answer a different question without saying so. */
export const MAX_TARGETS_PER_READ = 40;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** FACTOR 2's table (performanceGoalAuthority.ts METRIC_MANAGEMENT_CAPABILITY): the existing read capability that governs a metric's ACTUAL; null = none enumerated. */
export const METRIC_READ_CAPABILITY: Readonly<Record<string, string | null>> = Object.freeze({
  "service.workOrder.pastDue.count": null,
  "service.workOrder.readyToSchedule.count": null,
  "service.workOrder.schedulingConflict.count": null,
  "service.workOrder.partsBlocked.count": null,
  "technician.workOrder.completed.cumulative.count": null,
  "technician.workOrder.open.count": null,
  "crm.account.active.count": "customer.record.read",
  "parts.reorderRequest.open.count": "reorder.request.create.manual",
  "receiving.purchaseOrder.receivable.count": "inventory.stock.receive",
  "purchasing.purchaseOrder.open.count": null,
});

export interface GoalTargetRequest { metricId: string; targetScopeType: string; targetScopeId: string | null }

export interface GoalTargetResult {
  readonly metricId: string;
  readonly targetScopeType: string;
  readonly targetScopeId: string | null;
  readonly goal: PerformanceGoal | null;
  readonly denied: boolean;
  readonly deniedFactor: string | null;
  readonly unavailableReason: string | null;
}

export type Decision = { readonly allowed: true } | { readonly allowed: false; readonly factor: string; readonly reason: string };
export const ALLOW: Decision = Object.freeze({ allowed: true as const });
export const deny = (factor: string, reason: string): Decision => Object.freeze({ allowed: false as const, factor, reason });

export interface GoalContext {
  readonly actor: RecordsActor;
  readonly reach: ReachableCompanies;
  readonly db: Pick<PoolClient, "query">;
  readonly warehouseScope: () => Promise<readonly string[]>;
  readonly population: () => Promise<{ readonly positions: readonly PrincipalPosition[]; readonly actorEmployeeId: string | null }>;
}

/** The tenant's principals with their active, qualifying Role keys and linked Employee: the population hierarchical visibility walks. */
export async function loadPopulation(db: Pick<PoolClient, "query">, actor: RecordsActor) {
  const roles = await db.query(
    `SELECT a.principal_id, array_agg(DISTINCT r.key) AS role_keys
       FROM eos_policy.user_role_assignments a
       JOIN eos_policy.roles r ON r.id = a.role_id AND r.tenant_id = a.tenant_id
       LEFT JOIN eos_policy.principal_access_versions v ON v.tenant_id = a.tenant_id AND v.principal_id = a.principal_id
      WHERE a.tenant_id = $1 AND a.status = 'active' AND a.access_version_at_grant <= coalesce(v.access_version, 0)
      GROUP BY a.principal_id`, [actor.tenantId]);
  const links = await db.query(
    `SELECT principal_id, employee_id FROM eos_policy.employee_principal_links WHERE tenant_id = $1 AND status = 'active'`, [actor.tenantId]);
  const employeeByPrincipal = new Map<string, string>(links.rows.map((l) => [String(l.principal_id), String(l.employee_id)]));
  const roleKeysByPrincipal = new Map<string, string[]>(roles.rows.map((r) => [String(r.principal_id), r.role_keys as string[]]));
  const ids = new Set<string>([...employeeByPrincipal.keys(), ...roleKeysByPrincipal.keys()]);
  const positions: PrincipalPosition[] = [...ids].map((principalId) => ({
    principalUid: principalId, employeeId: employeeByPrincipal.get(principalId) ?? null, roleIds: roleKeysByPrincipal.get(principalId) ?? [],
  }));
  return { positions, actorEmployeeId: employeeByPrincipal.get(actor.principalId) ?? null };
}

export async function employeeCompanyId(db: Pick<PoolClient, "query">, tenantId: string, employeeId: string): Promise<string | null> {
  const { rows } = await db.query(`SELECT operating_company_id FROM eos_workforce.employees WHERE tenant_id = $1 AND id = $2`, [tenantId, employeeId]);
  return rows.length === 0 ? null : (rows[0].operating_company_id as string | null) ?? null;
}

type Metric = NonNullable<ReturnType<typeof findMetric>>;

/**
 * FACTORS 0 and 1 for ANY verb: the metric is registered, the scope is usable for it and bindable, the caller holds `capability` (flat), and the
 * caller REACHES the target's scope. EMPLOYEE passes here; its subject is decided by decideEmployeeSubject. Shared by the reads (performance.goal.read)
 * and the authoring commands (performanceGoalAuthoring.ts), so a screen offers exactly what a command accepts.
 */
export async function decideGoalReach(ctx: GoalContext, t: GoalTargetRequest, capability: string): Promise<Decision> {
  const metric = findMetric(t.metricId);
  if (!metric) return deny("unknownMetric", `"${String(t.metricId)}" is not a registered performance metric`);
  // FACTOR 0 -- asked before any capability: an unusable scope is not a permission question. (A READ of an existing goal on a since-deactivated metric
  // stays readable: history does not become unreadable because the platform stopped accepting new targets against it.)
  if (!metric.supportedScopes.includes(t.targetScopeType as GoalScopeType)) {
    return deny("scopeNotUsable", `"${metric.metricId}" supports scope ${metric.supportedScopes.join("/")} -- not ${String(t.targetScopeType)}`);
  }
  if (!isScopeBindable(t.targetScopeType)) {
    return deny("scopeNotUsable", `scope ${String(t.targetScopeType)} has no governed binding, so no principal can hold authority over it`);
  }
  // FACTOR 1 -- the capability, then REACH to the target's own scope.
  if (!ctx.actor.capabilities.has(capability)) return deny("noGoalCapabilityAtScope", `${capability} is not held`);
  const scopeType = t.targetScopeType as GoalScopeType;
  const scopeId = t.targetScopeId;
  const noReach = deny("noGoalCapabilityAtScope", `no reach to ${scopeType}${scopeId ? `:${scopeId}` : ""}`);
  if (scopeType === "OPERATING_COMPANY") {
    if (typeof scopeId !== "string" || !ctx.reach.companies.includes(scopeId)) return noReach;
  } else if (scopeType === "LOCATION") {
    if (typeof scopeId !== "string") return noReach;
    const { rows } = await ctx.db.query(
      `SELECT operating_company_key FROM ${SCHEMA}.warehouses WHERE tenant_id = $1 AND id = $2`, [ctx.actor.tenantId, scopeId]);
    if (rows.length === 0 || !ctx.reach.keys.includes(String(rows[0].operating_company_key))) return noReach;
    if (!(await ctx.warehouseScope()).includes(scopeId)) return noReach;
  } else if (scopeType === "BUSINESS_UNIT") {
    return deny("noGoalCapabilityAtScope", "EOS has no business-unit authority; a business-unit target cannot be read or set here");
  } else if (scopeType !== "FIRM" && scopeType !== "EMPLOYEE") {
    return noReach;
  }
  return ALLOW;
}

/** FACTOR 2 -- authority over the number itself: the metric's own existing read capability where the registry names one (flat). */
export function decideMetricAuthority(ctx: GoalContext, metric: Metric, verb: "reading" | "setting" = "reading"): Decision {
  const metricCapability = METRIC_READ_CAPABILITY[metric.metricId] ?? null;
  if (metricCapability !== null && !ctx.actor.capabilities.has(metricCapability)) {
    return deny("noAuthorityOverMetric", `${verb} a target on "${metric.metricId}" requires ${metricCapability}`);
  }
  return ALLOW;
}

/** FACTOR 3 -- an EMPLOYEE target: inside the caller's governed visibility, and in a company the caller reaches. Every other scope passes. */
export async function decideEmployeeSubject(ctx: GoalContext, t: GoalTargetRequest): Promise<Decision> {
  if (t.targetScopeType !== "EMPLOYEE") return ALLOW;
  const scopeId = t.targetScopeId;
  if (typeof scopeId !== "string" || scopeId === "") return deny("employeeOutsideVisibility", "an EMPLOYEE goal requires the subject employeeId");
  const { positions } = await ctx.population();
  if (!visibleEmployeeIdsFor(ctx.actor.principalId, positions).has(scopeId)) {
    return deny("employeeOutsideVisibility", "that employee is not within your governed visibility");
  }
  const company = await employeeCompanyId(ctx.db, ctx.actor.tenantId, scopeId);
  if (company === null || !ctx.reach.companies.includes(company)) return deny("employeeOutsideVisibility", "that employee is not within your governed visibility");
  return ALLOW;
}

/** THE decision for one READ of one target. Never throws for a malformed target: every unusable input is a named DENY. */
async function decideRead(ctx: GoalContext, t: GoalTargetRequest): Promise<Decision> {
  const reach = await decideGoalReach(ctx, t, GOAL_READ_CAPABILITY);
  if (!reach.allowed) return reach;
  const metricDecision = decideMetricAuthority(ctx, findMetric(t.metricId) as Metric);
  if (!metricDecision.allowed) return metricDecision;
  return decideEmployeeSubject(ctx, t);
}

export const goalOf = (r: Record<string, unknown>): PerformanceGoal => Object.freeze({
  goalId: String(r.goal_id),
  metricId: String(r.metric_id),
  targetScopeType: String(r.target_scope_type) as GoalScopeType,
  targetScopeId: (r.target_scope_id as string | null) ?? null,
  targetValue: Number(r.target_value),
  unit: String(r.unit),
  direction: String(r.direction) as PerformanceGoal["direction"],
  currency: (r.currency as string | null) ?? null,
  effectiveFrom: String(r.effective_from_text),
  effectiveTo: (r.effective_to_text as string | null) ?? null,
  status: String(r.status) as PerformanceGoal["status"],
  version: Number(r.version),
  // The Firebase uids as stored: evidence, not references to EOS Principals.
  createdByUid: String(r.created_by_ref),
  createdAtMillis: Number(r.created_at_ms),
  approvedByUid: (r.approved_by_ref as string | null) ?? null,
  approvedAtMillis: r.approved_at_ms === null || r.approved_at_ms === undefined ? null : Number(r.approved_at_ms),
  supersedesGoalId: (r.supersedes_goal_id as string | null) ?? null,
  // NATIVE (authored on EOS) or MIGRATED (copied from the previous system). Present when the row was read with it: a screen withholds Approve from a copied draft.
  ...(typeof r.provenance === "string" ? { provenance: r.provenance } : {}),
});

async function versionsFor(db: Pick<PoolClient, "query">, tenantId: string, t: GoalTargetRequest): Promise<PerformanceGoal[]> {
  const { rows } = await db.query(
    `SELECT goal_id, metric_id, target_scope_type, target_scope_id, target_value, unit, direction, currency,
            ${DATE_AS_TEXT("effective_from")} AS effective_from_text, ${DATE_AS_TEXT("effective_to")} AS effective_to_text,
            status, version, created_by_ref, created_at_ms, approved_by_ref, approved_at_ms, supersedes_goal_id, provenance
       FROM ${SCHEMA}.performance_goals
      WHERE tenant_id = $1 AND metric_id = $2 AND target_scope_type = $3 AND target_scope_id IS NOT DISTINCT FROM $4
      ORDER BY version, effective_from, goal_id`, [tenantId, t.metricId, t.targetScopeType, t.targetScopeId]);
  return rows.map(goalOf);
}

function parseTarget(raw: unknown): GoalTargetRequest {
  const o = isPlainObject(raw) ? raw : {};
  return {
    metricId: typeof o.metricId === "string" ? o.metricId : "",
    targetScopeType: typeof o.targetScopeType === "string" ? o.targetScopeType : "",
    targetScopeId: typeof o.targetScopeId === "string" && o.targetScopeId.length > 0 ? o.targetScopeId : null,
  };
}

/** The decision context over an OPEN connection: the snapshot of a read, or the write transaction of an authoring command (G-1). Lazy and memoized. */
export function goalContextOn(c: PoolClient, actor: RecordsActor, reach: ReachableCompanies): GoalContext {
  let warehouses: Promise<readonly string[]> | null = null;
  let population: ReturnType<typeof loadPopulation> | null = null;
  return {
    actor, reach, db: c,
    warehouseScope: () => (warehouses ??= scopedWarehouseIds(c, actor, { companyKeys: reach.keys })),
    population: () => (population ??= loadPopulation(c, actor)),
  };
}

export async function withGoalContext<T>(deps: { readonly pool: Pool }, actor: RecordsActor, fn: (ctx: GoalContext) => Promise<T>): Promise<T> {
  return inTransaction(deps.pool, "snapshot", async (c) => fn(goalContextOn(c, actor, await reachableCompanies(c, actor))));
}

/**
 * The Employees this principal may author goals FOR -- ids only. OFFERED == ACCEPTED: the visibility set the write commands enforce, with the caller's own
 * Employee removed (an employee does not author their own target) and every Employee of a company the caller does not reach removed.
 */
export async function subjectEmployeeIds(ctx: GoalContext): Promise<string[]> {
  const { positions, actorEmployeeId } = await ctx.population();
  const visible = new Set(visibleEmployeeIdsFor(ctx.actor.principalId, positions));
  if (actorEmployeeId) visible.delete(actorEmployeeId);
  if (visible.size === 0) return [];
  const { rows } = await ctx.db.query(
    `SELECT id FROM eos_workforce.employees WHERE tenant_id = $1 AND id = ANY($2::text[]) AND operating_company_id = ANY($3::text[]) ORDER BY id`,
    [ctx.actor.tenantId, [...visible], [...ctx.reach.companies]]);
  return rows.map((r) => String(r.id));
}

/** The current APPROVED target for each requested (metric, scope), as of a date the CALLER supplies (this authority owns no clock). */
export async function listCurrentPerformanceGoals(deps: { readonly pool: Pool }, actor: RecordsActor, input: Record<string, unknown>) {
  requireCapability(actor, GOAL_READ_CAPABILITY);
  const i = acceptOnly(input, ["targets", "onDate"]);
  if (typeof i.onDate !== "string" || !ISO_DATE.test(i.onDate)) refuse("DATE_REQUIRED", "INVALID_INPUT", "onDate must be an ISO date (YYYY-MM-DD) supplied by the caller");
  const onDate = i.onDate as string;
  const targets = Array.isArray(i.targets) ? i.targets : [];
  if (targets.length === 0) return { results: [] as GoalTargetResult[], onDate };
  if (targets.length > MAX_TARGETS_PER_READ) {
    refuse("TOO_MANY_TARGETS", "INVALID_INPUT", `at most ${MAX_TARGETS_PER_READ} targets per call -- a larger request is refused rather than silently trimmed`);
  }
  return withGoalContext(deps, actor, async (ctx) => {
    const results: GoalTargetResult[] = [];
    for (const raw of targets) {
      const t = parseTarget(raw);
      const decision = await decideRead(ctx, t);
      if (!decision.allowed) {
        results.push({ ...t, goal: null, denied: true, deniedFactor: decision.factor, unavailableReason: null });
        continue;
      }
      const versions = await versionsFor(ctx.db, actor.tenantId, t);
      try {
        results.push({
          ...t, goal: currentGoalFor(versions, { metricId: t.metricId, targetScopeType: t.targetScopeType as GoalScopeType, targetScopeId: t.targetScopeId }, onDate),
          denied: false, deniedFactor: null, unavailableReason: null,
        });
      } catch (err) {
        // An ambiguous version chain is a data defect: UNAVAILABLE, never "no goal" (that would hide the defect behind a state that looks deliberate).
        results.push({ ...t, goal: null, denied: false, deniedFactor: null, unavailableReason: err instanceof GoalError ? err.message : "the target could not be resolved" });
      }
    }
    return { results, onDate };
  });
}

/** Every version for ONE target, oldest first -- the management history view. */
export async function listPerformanceGoalVersions(deps: { readonly pool: Pool }, actor: RecordsActor, input: Record<string, unknown>) {
  requireCapability(actor, GOAL_READ_CAPABILITY);
  const i = acceptOnly(input, ["target"]);
  const t = parseTarget(i.target);
  if (!findMetric(t.metricId)) refuse("METRIC_UNKNOWN", "INVALID_INPUT", "target names no registered metric");
  return withGoalContext(deps, actor, async (ctx) => {
    const decision = await decideRead(ctx, t);
    if (!decision.allowed) return refuse("GOAL_DENIED", "FORBIDDEN", "you are not authorized to read that target");
    return { versions: await versionsFor(ctx.db, actor.tenantId, t) };
  });
}

/**
 * The people this principal may author goals FOR -- the subject picker's contents. OFFERED == ACCEPTED: the visibility set the write commands enforce,
 * with the caller's own Employee removed and every Employee of a company the caller does not reach removed. Employee IDS only.
 */
export async function listGoalSubjects(deps: { readonly pool: Pool }, actor: RecordsActor, input: Record<string, unknown>) {
  requireCapability(actor, GOAL_READ_CAPABILITY);
  acceptOnly(input, []);
  return withGoalContext(deps, actor, async (ctx) => ({ employeeIds: await subjectEmployeeIds(ctx) }));
}
