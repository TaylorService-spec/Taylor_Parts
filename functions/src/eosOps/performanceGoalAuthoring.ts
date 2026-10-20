// PERFORMANCE GOAL AUTHORING ON EOS (G-1; Owner direction 2026-10-19 "Restore complete EOS goal authoring"; resolves OD-B4-3). Three commands -- author a DRAFT,
// approve it (which supersedes the version it replaces), retire an approved goal -- over eos_ops.performance_goals, plus ONE read that tells the screen what the
// caller may author (OFFERED == ACCEPTED). They are the Firebase commands (functions/src/performance/performanceGoalCommands.ts) with the SAME rules:
//
//   * VERBS and capabilities (Firebase catalog, mirrored): a first version asks performance.goal.create; a version that NAMES a predecessor asks
//     performance.goal.supersede (replacing a target in force is a different authority from setting one); approve asks .approve; retire asks .retire.
//   * THE DECISION, in this order, every refusal BEFORE any write: capability -> the caller's operating companies -> idempotent replay -> the factors:
//       0 the metric is registered, ACTIVE for goals, and the scope is usable and bindable;
//       1 REACH to the target's own scope (the reads' rules: FIRM = any caller with company authority; OPERATING_COMPANY = a company reached; LOCATION = a
//         warehouse of a company reached AND over which the caller holds the WAREHOUSE scope; BUSINESS_UNIT stays denied -- EOS has no such authority, OD-B4-4);
//       3 EMPLOYEE targets: the subject inside the caller's governed hierarchical visibility AND an Employee of a company reached;
//       2 authority over the number itself (the metric's own read capability where the registry names one);
//       5 AN EMPLOYEE DOES NOT AUTHOR THEIR OWN TARGET (the Owner: "Employees do NOT automatically manage their own targets") -- create / approve / retire of a goal
//         whose subject is the caller's own linked Employee is refused;
//       4 NOBODY APPROVES THEIR OWN DRAFT (FIN-007, unconditional), and the two people are distinct EMPLOYEES, not only distinct Principals: the approver is refused when the
//         Principals are equal, when the approver's linked Employee is the Employee recorded as the author's at draft time (a relink of the author's Employee to a new
//         Principal does not make a second person), or when the author Principal's CURRENT link resolves to the approver's Employee. A reason is mandatory.
//   * FOREIGN = NONEXISTENT. A goal outside the caller's reach, in another company, or on an Employee outside their visibility reads EXACTLY as a goal that does
//     not exist (GOAL_NOT_FOUND) for approve / retire, and as the one generic "outside your reach" answer for create. No refusal says which.
//   * DISPOSITION OF A DRAFT. A DRAFT of any provenance (a copied one cannot be approved here) is disposed of by retirePerformanceGoal (capability .retire, a reason): it
//     becomes RETIRED, never measured, its window untouched. Versions are numbered max(version of the target) + 1, so a retired or superseded history never reuses a number.
//   * VERSIONING AS THE READ MODEL EXPECTS. Approving a successor closes its predecessor's window (status SUPERSEDED, effective_to = the day before the successor
//     begins, never LENGTHENED) in the SAME transaction, so no instant has two APPROVED versions on one date (currentGoalFor would refuse it). A first version is
//     refused when another APPROVED version already covers any day of its window -- that is "supersede", not "create" (Firebase left this to the data defect; EOS
//     closes it). A retire closes the window at today (UTC); history is never deleted.
//   * SCHEDULED (G-1b; Owner option A). An approved version that has not started is SCHEDULED: it may NOT be retired (GOAL_SCHEDULED_NOT_RETIRABLE), it is corrected by a
//     replacement draft (.supersede, two-person approval, the self rules). Approving that replacement supersedes the scheduled version in the same transaction WITHOUT
//     touching its window -- it never governed a day, which the read derives from the approval (neverGoverned) -- and moves the preceding version's end to the day before
//     the corrected start, earlier or later, only while that boundary is still in the future (the corrected start must be after today: GOAL_START_ELAPSED). What governs a
//     date is decided by governingVersions (performanceGoalReads.ts), the same predicate the overlap checks use.
//   * IDEMPOTENCY: every command carries a caller idempotencyKey, keyed per actor (eos_ops.performance_goal_commands) with a request fingerprint: the same key and
//     request replays the stored answer and writes nothing; the same key with a different request is IDEMPOTENCY_CONFLICT.
//   * ONE audit row per applied command (the Firebase action names: createPerformanceGoalDraft / approvePerformanceGoal / supersedePerformanceGoal /
//     retirePerformanceGoal). A REFUSED command writes nothing -- not a goal, not a command record, not an audit row (the EOS convention; Firebase also audited
//     denied attempts, a recorded divergence, DECISIONS #G-1).
//
// WHAT NO COMMAND HERE CAN DO: edit a target value, approve one's own draft, reopen a retired goal, write an actual. None has a code path.
// A goal written here is provenance NATIVE and its author / approver are EOS Principal ids. A MIGRATED draft (Firebase uids) cannot be approved here -- its author
// cannot be compared with an EOS Principal, so segregation of duties could not be proven (the copy of existing goals is HELD; none exist today).
import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { buildPerformanceGoal, GoalError, type PerformanceGoal } from "../performance/performanceGoal.js";
import { findMetric, PERFORMANCE_METRICS, type GoalScopeType } from "../performance/performanceMetricRegistry.js";
import { ApprovalError, buildApprovalRecord } from "../finance/financialApprovals.js";
import { exemptionRecord, resolveSecondaryApprovalExemption, type SecondaryApprovalResolution } from "../access/secondaryApprovalExemption.js";

/** This workflow's declared site in the central scope map (access/secondaryApprovalExemptionCore.ts). */
export const GOAL_APPROVAL_SITE = "goals.performanceGoal" as const;
import { operatingCompanyDisplayName } from "../ownership/operatingCompanyAuthority.js";
import {
  acceptOnly, DATE_AS_TEXT, ID_SHAPE, inTransaction, reachableCompanies, recordsAudit, refuse, requireCapability, type RecordsActor,
} from "./recordsSupport.js";
import {
  ALLOW, decideEmployeeSubject, decideGoalReach, decideMetricAuthority, deny, goalContextOn, goalOf, governingVersions, neverGoverned, subjectEmployeeIds,
  withGoalContext, type Decision, type GoalContext, type GoalTargetRequest,
} from "./performanceGoalReads.js";

const SCHEMA = "eos_ops";
export const GOAL_CREATE = "performance.goal.create";
export const GOAL_SUPERSEDE = "performance.goal.supersede";
export const GOAL_APPROVE = "performance.goal.approve";
export const GOAL_RETIRE = "performance.goal.retire";
export const GOAL_WRITE_CAPABILITIES: readonly string[] = Object.freeze([GOAL_CREATE, GOAL_SUPERSEDE, GOAL_APPROVE, GOAL_RETIRE]);
/** The scopes the authoring screen offers: BUSINESS_UNIT has no EOS authority (OD-B4-4) and TEAM is never bindable. */
export const AUTHORABLE_SCOPES: readonly GoalScopeType[] = Object.freeze(["EMPLOYEE", "LOCATION", "OPERATING_COMPANY", "FIRM"] as const);
const MAX_REASON = 1000;

export interface GoalAuthoringDeps { readonly pool: Pool; readonly now?: () => Date }

type Verb = "create" | "supersede" | "approve" | "retire";
const CAPABILITY_FOR_VERB: Readonly<Record<Verb, string>> = Object.freeze({ create: GOAL_CREATE, supersede: GOAL_SUPERSEDE, approve: GOAL_APPROVE, retire: GOAL_RETIRE });

// ════════════════════ shared ════════════════════

const fingerprintOf = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function requireIdempotencyKey(v: unknown): string {
  if (typeof v !== "string" || v.trim() === "" || v.trim() !== v || v.length > 200) {
    refuse("IDEMPOTENCY_KEY_REQUIRED", "INVALID_INPUT", "idempotencyKey is required (a trimmed, non-empty string of at most 200 characters)");
  }
  return v as string;
}

function requireReason(v: unknown): string {
  if (typeof v !== "string" || v.trim() === "") refuse("REASON_REQUIRED", "INVALID_INPUT", "a decision without a reason is not governance");
  const r = (v as string).trim();
  if (r.length > MAX_REASON) refuse("REASON_TOO_LONG", "INVALID_INPUT", `the reason is at most ${MAX_REASON} characters`);
  return r;
}

function requireGoalId(v: unknown): string {
  if (typeof v !== "string" || !ID_SHAPE(v)) refuse("GOAL_ID_REQUIRED", "INVALID_INPUT", "goalId is required");
  return v as string;
}

const isoToday = (now: () => Date): string => now().toISOString().slice(0, 10);

/**
 * The version that GOVERNS until a SCHEDULED one starts: walk the scheduled version's `supersedesGoalId` back while the version found never governed (it was itself a
 * scheduled version replaced by a correction), to the first version that did, or none. A correction of a correction therefore reaches the real predecessor, whose end
 * is the boundary to move -- never a never-governed row, whose window is not written.
 */
function precedingOf<T extends PerformanceGoal>(versions: readonly T[], scheduled: { supersedesGoalId: string | null }): T | undefined {
  const seen = new Set<string>();
  let id = scheduled.supersedesGoalId;
  while (id && !seen.has(id)) {
    seen.add(id);
    const v = versions.find((g) => g.goalId === id);
    if (!v) return undefined;
    if (!neverGoverned(v, versions)) return v;
    id = v.supersedesGoalId;
  }
  return undefined;
}

/**
 * The start a CORRECTION of a scheduled version may take. It must be after `today` (a correction never governs, or stops governing, an elapsed day) and after the
 * start of the version before the scheduled one (which keeps governing until the day before). Returns the refusal, or null. Refused rather than clamped: a clamp would
 * answer with a start date nobody typed.
 */
function correctionStartRefusal(start: string, today: string, preceding: { effectiveFrom: string } | undefined): { code: string; message: string } | null {
  if (start <= today) {
    return { code: "GOAL_START_ELAPSED", message: "A replacement for a target that has not started must take effect after today -- a day that has already passed keeps the target that governed it." };
  }
  if (preceding && start <= preceding.effectiveFrom) {
    return { code: "GOAL_INVALID", message: "The replacement must take effect after the target before it began, or that target's window would be erased." };
  }
  return null;
}

/** The calendar day before an ISO date. Pure UTC arithmetic -- no locale, no ambient timezone. */
export function previousIsoDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const overlaps = (a: { effectiveFrom: string; effectiveTo: string | null }, b: { effectiveFrom: string; effectiveTo: string | null }): boolean =>
  a.effectiveFrom <= (b.effectiveTo ?? "9999-12-31") && b.effectiveFrom <= (a.effectiveTo ?? "9999-12-31");

type Stored = PerformanceGoal & { readonly provenance: string; readonly authorEmployeeId: string | null };

const GOAL_COLUMNS = `goal_id, metric_id, target_scope_type, target_scope_id, target_value, unit, direction, currency,
            ${DATE_AS_TEXT("effective_from")} AS effective_from_text, ${DATE_AS_TEXT("effective_to")} AS effective_to_text,
            status, version, created_by_ref, created_at_ms, approved_by_ref, approved_at_ms, supersedes_goal_id, provenance, author_employee_id`;

const storedOf = (r: Record<string, unknown>): Stored => ({ ...goalOf(r), provenance: String(r.provenance), authorEmployeeId: (r.author_employee_id as string | null) ?? null });

async function loadGoal(c: PoolClient, tenantId: string, goalId: string): Promise<Stored | null> {
  const { rows } = await c.query(`SELECT ${GOAL_COLUMNS} FROM ${SCHEMA}.performance_goals WHERE tenant_id = $1 AND goal_id = $2`, [tenantId, goalId]);
  return rows.length === 0 ? null : storedOf(rows[0]);
}

async function loadVersions(c: PoolClient, tenantId: string, t: GoalTargetRequest): Promise<Stored[]> {
  const { rows } = await c.query(
    `SELECT ${GOAL_COLUMNS} FROM ${SCHEMA}.performance_goals
      WHERE tenant_id = $1 AND metric_id = $2 AND target_scope_type = $3 AND target_scope_id IS NOT DISTINCT FROM $4
      ORDER BY version, effective_from, goal_id`, [tenantId, t.metricId, t.targetScopeType, t.targetScopeId]);
  return rows.map(storedOf);
}

/** Every authoring command on ONE target is serialized, so two approvals cannot both see "nothing in force". Released at commit or rollback. */
async function lockTarget(c: PoolClient, tenantId: string, t: GoalTargetRequest): Promise<void> {
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`performance_goal|${tenantId}|${t.metricId}|${t.targetScopeType}|${t.targetScopeId ?? ""}`]);
}

const targetOf = (g: { metricId: string; targetScopeType: string; targetScopeId: string | null }): GoalTargetRequest =>
  ({ metricId: g.metricId, targetScopeType: g.targetScopeType, targetScopeId: g.targetScopeId });

/** The replay probe. A stored command of THIS actor under this key: same command and fingerprint = replay (the stored answer); anything else = conflict. */
async function probeReplay(c: PoolClient, actor: RecordsActor, key: string, command: string, fingerprint: string): Promise<Record<string, unknown> | null> {
  // Two racers on one key are serialized here (released at commit), so the second SEES the first's record and replays it instead of colliding on the primary key.
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`performance_goal_key|${actor.tenantId}|${actor.principalId}|${key}`]);
  const { rows } = await c.query(
    `SELECT command, request_fingerprint, result FROM ${SCHEMA}.performance_goal_commands WHERE tenant_id = $1 AND actor_principal_id = $2 AND idempotency_key = $3`,
    [actor.tenantId, actor.principalId, key]);
  if (rows.length === 0) return null;
  if (rows[0].command !== command || rows[0].request_fingerprint !== fingerprint) {
    refuse("IDEMPOTENCY_CONFLICT", "CONFLICT", "this idempotency key was already used for a DIFFERENT request");
  }
  return { ...(rows[0].result as Record<string, unknown>), outcome: "replayed" };
}

async function recordCommand(c: PoolClient, actor: RecordsActor, key: string, command: string, goalId: string, fingerprint: string, result: unknown): Promise<void> {
  await c.query(
    `INSERT INTO ${SCHEMA}.performance_goal_commands (tenant_id, actor_principal_id, idempotency_key, command, goal_id, request_fingerprint, result)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`, [actor.tenantId, actor.principalId, key, command, goalId, fingerprint, JSON.stringify(result)]);
}

/**
 * The WRITE decision for one target: factor 0 (active; not asked of a retire) -> 1 (reach) -> 3 (the subject) -> 2 (the number) -> 5 (own target) -> 4 (own draft, by Principal AND Employee). Reach and the
 * subject come BEFORE the metric and self rules on purpose: a refusal that depends on the goal's own details must never be reachable for a goal the caller cannot
 * see, or its wording would tell them the goal exists.
 */
interface Authored { readonly principal: string; readonly employeeId: string | null }

async function decideWrite(ctx: GoalContext, t: GoalTargetRequest, verb: Verb, authored: Authored | null, out?: { resolution?: SecondaryApprovalResolution }): Promise<Decision> {
  const metric = findMetric(t.metricId);
  // A retire is how a stranded goal is disposed of, so it is not refused because its metric was deactivated since.
  if (metric && !metric.activeForGoals && verb !== "retire") {
    return deny("metricNotActiveForGoals", `"${metric.metricId}" is registered but not active for goals: ${metric.blockedBy}`);
  }
  const reach = await decideGoalReach(ctx, t, CAPABILITY_FOR_VERB[verb]);
  if (!reach.allowed) return reach;
  const subject = await decideEmployeeSubject(ctx, t);
  if (!subject.allowed) return subject;
  const number = decideMetricAuthority(ctx, metric as NonNullable<typeof metric>, "setting");
  if (!number.allowed) return number;
  if (t.targetScopeType === "EMPLOYEE") {
    const { actorEmployeeId } = await ctx.population();
    if (actorEmployeeId !== null && t.targetScopeId === actorEmployeeId) {
      return deny("selfTargeting", "an employee does not manage their own target -- a goal for you is authored by someone above you");
    }
  }
  if (verb === "approve") {
    if (authored === null || authored.principal.trim() === "") return deny("selfApproval", "the authoring principal must be known before a goal version can be approved");
    // Same person (Principal, or one Employee behind two Principals) is admitted ONLY by the central seam: the governed protected Owner (DECISIONS #SAE, amending FIN-007).
    const admitSelf = async (message: string): Promise<Decision> => {
      const resolution = await resolveSecondaryApprovalExemption(ctx.db, ctx.actor.tenantId, ctx.actor.principalId, GOAL_APPROVAL_SITE);
      if (!resolution.exempt || exemptionRecord(resolution, ctx.actor.principalId, ctx.actor.tenantId, GOAL_APPROVAL_SITE) === null) return deny("selfApproval", message);
      if (out) out.resolution = resolution;
      return ALLOW;
    };
    if (authored.principal.trim() === ctx.actor.principalId.trim()) {
      return admitSelf("the author of a goal version may not approve it, unless the governed protected Owner (FIN-007, as amended by DECISIONS #SAE)");
    }
    // Two-person approval rests on distinct EMPLOYEES: the Employee recorded at draft time, and the author Principal's link NOW, may not be the approver's Employee.
    const { actorEmployeeId } = await ctx.population();
    if (actorEmployeeId !== null) {
      const shared = "the author of a goal version may not approve it, nor may anyone else linked to the same Employee, unless the governed protected Owner (FIN-007, as amended by DECISIONS #SAE)";
      if (authored.employeeId !== null && authored.employeeId === actorEmployeeId) return admitSelf(shared);
      const { rows } = await ctx.db.query(
        `SELECT employee_id FROM eos_policy.employee_principal_links WHERE tenant_id = $1 AND principal_id = $2 AND status = 'active'`, [ctx.actor.tenantId, authored.principal]);
      if (rows.length > 0 && String(rows[0].employee_id) === actorEmployeeId) return admitSelf(shared);
    }
  }
  return ALLOW;
}

/** A DENY -> the closed refusal. `existing`: the goal was named by id, so every reach-shaped refusal answers as the goal not existing. */
function refuseDecision(d: Decision, existing: boolean): never {
  if (d.allowed) throw new Error("refuseDecision called with an ALLOW");
  switch (d.factor) {
    case "unknownMetric": case "metricNotActiveForGoals": case "scopeNotUsable":
      return refuse("GOAL_INVALID", "INVALID_INPUT", d.reason);
    case "noAuthorityOverMetric":
      return refuse("METRIC_AUTHORITY_REQUIRED", "FORBIDDEN", d.reason);
    case "selfTargeting":
      return refuse("SELF_TARGETING_FORBIDDEN", "FORBIDDEN", d.reason);
    case "selfApproval":
      return refuse("SELF_APPROVAL_FORBIDDEN", "FORBIDDEN", d.reason);
    default:
      if (existing) return refuse("GOAL_NOT_FOUND", "NOT_FOUND", "no such goal");
      return refuse("GOAL_SCOPE_NOT_REACHABLE", "FORBIDDEN", "that target is outside your authority");
  }
}

const rethrowGoalError = (err: unknown): never => {
  if (err instanceof GoalError) return refuse("GOAL_INVALID", "INVALID_INPUT", err.message);
  throw err;
};

// ════════════════════ createPerformanceGoalDraft ════════════════════

/**
 * Author a DRAFT version. A draft is never a measurement authority and is never compared against. Input: { metricId, targetScopeType, targetScopeId?, targetValue,
 * unit, direction, currency?, effectiveFrom, effectiveTo?, supersedesGoalId?, idempotencyKey }. The goal id and the version are the server's.
 */
export async function createPerformanceGoalDraft(deps: GoalAuthoringDeps, actor: RecordsActor, input: Record<string, unknown>) {
  const i = acceptOnly(input, ["metricId", "targetScopeType", "targetScopeId", "targetValue", "unit", "direction", "currency", "effectiveFrom", "effectiveTo", "supersedesGoalId", "idempotencyKey"]);
  const key = requireIdempotencyKey(i.idempotencyKey);
  const supersedes = typeof i.supersedesGoalId === "string" && i.supersedesGoalId !== "" ? i.supersedesGoalId : null;
  if (i.supersedesGoalId !== undefined && i.supersedesGoalId !== null && supersedes === null) refuse("GOAL_ID_REQUIRED", "INVALID_INPUT", "supersedesGoalId must name a goal");
  const verb: Verb = supersedes ? "supersede" : "create";
  requireCapability(actor, CAPABILITY_FOR_VERB[verb]);
  const t: GoalTargetRequest = {
    metricId: typeof i.metricId === "string" ? i.metricId : "",
    targetScopeType: typeof i.targetScopeType === "string" ? i.targetScopeType : "",
    targetScopeId: typeof i.targetScopeId === "string" && i.targetScopeId !== "" ? i.targetScopeId : null,
  };
  const now = (deps.now ?? (() => new Date()))();
  const today = now.toISOString().slice(0, 10);

  return inTransaction(deps.pool, "write", async (c) => {
    const reach = await reachableCompanies(c, actor);
    const fingerprint = fingerprintOf(["CREATE", t.metricId, t.targetScopeType, t.targetScopeId, i.targetValue, i.unit, i.direction, i.currency ?? null,
      i.effectiveFrom, i.effectiveTo ?? null, supersedes]);
    const replay = await probeReplay(c, actor, key, "CREATE", fingerprint);
    if (replay) return replay;

    const ctx = goalContextOn(c, actor, reach);
    const decision = await decideWrite(ctx, t, verb, null);
    if (!decision.allowed) return refuseDecision(decision, false);
    // The author's linked Employee, recorded with the draft: two-person approval rests on distinct Employees, and a later relink must not change who authored it.
    const authorEmployeeId = (await ctx.population()).actorEmployeeId;

    await lockTarget(c, actor.tenantId, t);
    const versions = await loadVersions(c, actor.tenantId, t);
    // max(version) + 1 over EVERY version of the target (retired and superseded ones included), so a number is never reused.
    const version = versions.reduce((m, g) => Math.max(m, g.version), 0) + 1;
    if (supersedes) {
      // Looked up AMONG THIS TARGET'S versions: a goal id of another target (or none) reads the same.
      const predecessor = versions.find((g) => g.goalId === supersedes);
      if (!predecessor) return refuse("GOAL_NOT_FOUND", "NOT_FOUND", "no such goal");
      if (predecessor.status !== "APPROVED") {
        return refuse("GOAL_NOT_SUPERSEDABLE", "PRECONDITION_FAILED",
          `only an APPROVED version may be superseded (${supersedes} is ${predecessor.status}) -- a draft is replaced by a new draft, and a retired goal has no successor by definition`);
      }
      if (typeof i.effectiveFrom === "string" && ISO_DATE.test(i.effectiveFrom)) {
        if (predecessor.effectiveFrom > today) {
          // A CORRECTION of a SCHEDULED version (G-1b): it replaces a target that has not started, so it may start before or after it -- but never on an elapsed day,
          // and never before the version that precedes the scheduled one began (that one keeps governing until the corrected start).
          const rejection = correctionStartRefusal(i.effectiveFrom, today, precedingOf(versions, predecessor));
          if (rejection) return refuse(rejection.code, "INVALID_INPUT", rejection.message);
        } else if (i.effectiveFrom <= predecessor.effectiveFrom) {
          return refuse("GOAL_INVALID", "INVALID_INPUT", "a successor must take effect AFTER its predecessor began, or closing the predecessor's window would erase the period it governed");
        }
      }
    } else if (typeof i.effectiveFrom === "string" && ISO_DATE.test(i.effectiveFrom) && (i.effectiveTo === undefined || i.effectiveTo === null || (typeof i.effectiveTo === "string" && ISO_DATE.test(i.effectiveTo)))) {
      // (a malformed date skips the overlap probe and is refused, with its own sentence, by the record builder below)
      const to = typeof i.effectiveTo === "string" ? i.effectiveTo : null;
      const inForce = governingVersions(versions).find((g) => overlaps(g, { effectiveFrom: i.effectiveFrom as string, effectiveTo: to }));
      if (inForce) {
        return refuse("GOAL_ALREADY_IN_FORCE", "CONFLICT",
          `an APPROVED target (version ${inForce.version}) already covers part of that window -- replace it by naming it as the version this one supersedes`);
      }
    }

    const goalId = `goal_${randomUUID()}`;
    let goal: PerformanceGoal;
    try {
      goal = buildPerformanceGoal({
        goalId, metricId: t.metricId, targetScopeType: t.targetScopeType, targetScopeId: t.targetScopeId,
        targetValue: i.targetValue as number, unit: i.unit as string, direction: i.direction as string,
        currency: (i.currency ?? null) as string | null, effectiveFrom: i.effectiveFrom as string, effectiveTo: (i.effectiveTo ?? null) as string | null,
        // The record builder's own rule is "a version above 1 names its predecessor"; the STORED version is the target's max + 1 (a first version after a retired history is not 1).
        status: "DRAFT", version: supersedes ? 2 : 1, createdByUid: actor.principalId, createdAtMillis: now.getTime(), approvedByUid: null, approvedAtMillis: null, supersedesGoalId: supersedes,
      });
    } catch (err) { return rethrowGoalError(err); }

    await c.query(
      `INSERT INTO ${SCHEMA}.performance_goals (tenant_id, goal_id, metric_id, target_scope_type, target_scope_id, target_value, unit, direction, currency,
         effective_from, effective_to, status, version, created_by_ref, created_at_ms, supersedes_goal_id, provenance, author_employee_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'DRAFT',$12,$13,$14,$15,'NATIVE',$16)`,
      [actor.tenantId, goal.goalId, goal.metricId, goal.targetScopeType, goal.targetScopeId, goal.targetValue, goal.unit, goal.direction, goal.currency,
        goal.effectiveFrom, goal.effectiveTo, version, actor.principalId, goal.createdAtMillis, supersedes, authorEmployeeId]);
    const result = { outcome: "applied", goalId: goal.goalId, status: "DRAFT", version, supersedesGoalId: supersedes };
    await recordCommand(c, actor, key, "CREATE", goal.goalId, fingerprint, result);
    await recordsAudit(c, actor, "createPerformanceGoalDraft", "performance_goal", goal.goalId,
      { outcome: "applied", status: "DRAFT", version, metricId: goal.metricId, targetScopeType: goal.targetScopeType, targetScopeId: goal.targetScopeId,
        targetValue: goal.targetValue, direction: goal.direction, effectiveFrom: goal.effectiveFrom, supersedesGoalId: supersedes, authorEmployeeId },
      `DRAFT v${version} ${goal.metricId} ${goal.targetScopeType}:${goal.targetScopeId ?? "-"} target=${goal.targetValue} ${goal.direction} from=${goal.effectiveFrom}${supersedes ? ` supersedes=${supersedes}` : ""}`);
    return result;
  });
}

// ════════════════════ approvePerformanceGoal ════════════════════

/**
 * Approve a DRAFT, making it the target in force -- and, atomically, close the window of the version it replaces. Input: { goalId, reason, idempotencyKey }.
 * Refused for the author (SELF_APPROVAL_FORBIDDEN) twice over: the factor above, and FIN-007's record builder, which refuses it "under any policy".
 */
export async function approvePerformanceGoal(deps: GoalAuthoringDeps, actor: RecordsActor, input: Record<string, unknown>) {
  requireCapability(actor, GOAL_APPROVE);
  const i = acceptOnly(input, ["goalId", "reason", "idempotencyKey"]);
  const key = requireIdempotencyKey(i.idempotencyKey);
  const goalId = requireGoalId(i.goalId);
  const reason = requireReason(i.reason);
  const now = (deps.now ?? (() => new Date()))();

  return inTransaction(deps.pool, "write", async (c) => {
    const reach = await reachableCompanies(c, actor);
    const fingerprint = fingerprintOf(["APPROVE", goalId, reason]);
    const replay = await probeReplay(c, actor, key, "APPROVE", fingerprint);
    if (replay) return replay;

    const named = await loadGoal(c, actor.tenantId, goalId);
    if (!named) return refuse("GOAL_NOT_FOUND", "NOT_FOUND", "no such goal");
    const t = targetOf(named);
    // Reach FIRST (a goal outside it is "no such goal"), then serialize on the target and re-read, then the state.
    const ctx = goalContextOn(c, actor, reach);
    const reachDecision = await decideGoalReach(ctx, t, GOAL_APPROVE);
    if (!reachDecision.allowed) return refuseDecision(reachDecision, true);
    const subject = await decideEmployeeSubject(ctx, t);
    if (!subject.allowed) return refuseDecision(subject, true);

    await lockTarget(c, actor.tenantId, t);
    const versions = await loadVersions(c, actor.tenantId, t);
    const draft = versions.find((g) => g.goalId === goalId);
    if (!draft) return refuse("GOAL_NOT_FOUND", "NOT_FOUND", "no such goal");
    if (draft.status !== "DRAFT") return refuse("GOAL_NOT_DRAFT", "PRECONDITION_FAILED", `only a DRAFT may be approved (this goal is ${draft.status})`);
    if (draft.provenance !== "NATIVE") {
      return refuse("GOAL_AUTHOR_UNPROVABLE", "PRECONDITION_FAILED", "this draft was copied from the previous system, so its author cannot be compared with the approver; author a new draft instead");
    }
    const exemptionOut: { resolution?: SecondaryApprovalResolution } = {};
    const decision = await decideWrite(ctx, t, "approve", { principal: draft.createdByUid, employeeId: draft.authorEmployeeId }, exemptionOut);
    if (!decision.allowed) return refuseDecision(decision, true);
    const exemption = exemptionRecord(exemptionOut.resolution, actor.principalId, actor.tenantId, GOAL_APPROVAL_SITE);

    const decidedAtMillis = now.getTime();
    let approval;
    try {
      // FIN-007's record, built for its INVARIANTS (self-approval refusal, mandatory reason). amountMinor is null: approving a target is not a monetary action.
      approval = buildApprovalRecord({
        actionType: "PLAN_APPROVAL", targetRecordId: goalId, amountMinor: null, requestedByUid: draft.createdByUid, decidedByUid: actor.principalId,
        decision: "APPROVED", reason, decidedAtMillis, exemption: exemptionOut.resolution, tenantId: actor.tenantId, site: GOAL_APPROVAL_SITE,
      });
    } catch (err) {
      if (err instanceof ApprovalError) return refuse(err.code === "SELF_APPROVAL_FORBIDDEN" ? "SELF_APPROVAL_FORBIDDEN" : "GOAL_INVALID", err.code === "SELF_APPROVAL_FORBIDDEN" ? "FORBIDDEN" : "INVALID_INPUT", err.message);
      throw err;
    }

    const supersededId = draft.supersedesGoalId;
    // The SAME instant as the approval timestamp (decidedAtMillis): the correction-vs-ordinary branch and neverGoverned (derived from approved_at) always agree, even across midnight UTC.
    const today = now.toISOString().slice(0, 10);
    let closedAt: string | null = null;
    // The versions the clash check below compares with: all of them, with the PRECEDING version's window as corrected here.
    let others: Stored[] = versions;
    let correction: { precedingGoalId: string | null; precedingClosedAt: string | null } | null = null;
    if (supersededId) {
      const predecessor = versions.find((g) => g.goalId === supersededId);
      if (!predecessor) return refuse("GOAL_NOT_FOUND", "NOT_FOUND", "the version this one supersedes no longer exists");
      if (predecessor.status !== "APPROVED") {
        return refuse("GOAL_NOT_SUPERSEDABLE", "PRECONDITION_FAILED", `the version being superseded is ${predecessor.status}, not APPROVED -- it may already have been replaced`);
      }
      if (predecessor.effectiveFrom > today) {
        // A CORRECTION (G-1b): the version being replaced is SCHEDULED -- it has not started, so it never governed a day and its record is kept as it is (its window is not
        // touched: "never governed" is derived from this approval, see neverGoverned). The version BEFORE it, which governs until the scheduled start, now governs until the
        // corrected start instead. That boundary is a scheduled transition, not history: it moves only while it is still in the future, so no elapsed day changes hands.
        const preceding = precedingOf(versions, predecessor);
        const rejection = correctionStartRefusal(draft.effectiveFrom, today, preceding);
        if (rejection) return refuse(rejection.code, "INVALID_INPUT", rejection.message);
        let precedingClosedAt: string | null = null;
        if (preceding) {
          if (preceding.status !== "SUPERSEDED" || preceding.effectiveTo === null) {
            return refuse("GOAL_NOT_SUPERSEDABLE", "PRECONDITION_FAILED", `the target before the scheduled one is ${preceding.status}, not the replaced target this correction expects`);
          }
          const wanted = previousIsoDate(draft.effectiveFrom);
          // The boundary the scheduled version set (the day before its start) moves to the corrected one. A window that ended EARLIER on its own is only ever shortened.
          precedingClosedAt = preceding.effectiveTo === previousIsoDate(predecessor.effectiveFrom) || preceding.effectiveTo > wanted ? wanted : preceding.effectiveTo;
          if (precedingClosedAt !== preceding.effectiveTo) {
            await c.query(`UPDATE ${SCHEMA}.performance_goals SET effective_to = $3 WHERE tenant_id = $1 AND goal_id = $2`, [actor.tenantId, preceding.goalId, precedingClosedAt]);
          }
          others = versions.map((g) => (g.goalId === preceding.goalId ? { ...g, effectiveTo: precedingClosedAt } : g));
        }
        await c.query(`UPDATE ${SCHEMA}.performance_goals SET status = 'SUPERSEDED' WHERE tenant_id = $1 AND goal_id = $2`, [actor.tenantId, supersededId]);
        correction = { precedingGoalId: preceding?.goalId ?? null, precedingClosedAt };
      } else {
        if (draft.effectiveFrom <= predecessor.effectiveFrom) {
          return refuse("GOAL_INVALID", "INVALID_INPUT", "a successor must take effect AFTER its predecessor began");
        }
        closedAt = previousIsoDate(draft.effectiveFrom);
        // Shortening a window is closing it; LENGTHENING one would extend a target over days it never governed -- the history rewrite this design refuses.
        const effectiveTo = predecessor.effectiveTo !== null && predecessor.effectiveTo < closedAt ? predecessor.effectiveTo : closedAt;
        await c.query(`UPDATE ${SCHEMA}.performance_goals SET status = 'SUPERSEDED', effective_to = $3 WHERE tenant_id = $1 AND goal_id = $2`, [actor.tenantId, supersededId, effectiveTo]);
      }
    }
    // No OTHER version that governs may cover the draft's window (the version it replaces is excluded; the preceding one is taken as corrected above).
    // (governing is decided over ALL versions -- the successor of a never-governed version must be in view -- and the draft and the version it replaces are then set aside.)
    const clash = governingVersions(others).find((g) => g.goalId !== goalId && g.goalId !== supersededId && overlaps(g, draft));
    if (clash) {
      return refuse("GOAL_ALREADY_IN_FORCE", "CONFLICT", `an APPROVED target (version ${clash.version}) already covers part of this window -- approving this draft would leave two targets in force`);
    }
    await c.query(
      `UPDATE ${SCHEMA}.performance_goals SET status = 'APPROVED', approved_by_ref = $3, approved_at_ms = $4 WHERE tenant_id = $1 AND goal_id = $2`,
      [actor.tenantId, goalId, approval.decidedByUid, approval.decidedAtMillis]);

    const approverEmployeeId = (await ctx.population()).actorEmployeeId;
    // SAE: the basis a same-person approval was admitted on, with its provenance, in the command record (the domain record of this decision) and in the audit row below.
    const basis = exemption ? { approvalBasis: exemption.approvalBasis, approvalScope: exemption.scopeKey, approvalGrantSource: exemption.grantSource } : {};
    const result = { outcome: "applied", goalId, status: "APPROVED", version: draft.version, supersededGoalId: supersededId, predecessorClosedAt: closedAt, ...basis,
      ...(correction ? { correctedScheduledGoalId: supersededId, precedingGoalId: correction.precedingGoalId, precedingClosedAt: correction.precedingClosedAt } : {}) };
    await recordCommand(c, actor, key, "APPROVE", goalId, fingerprint, result);
    await recordsAudit(c, actor, supersededId ? "supersedePerformanceGoal" : "approvePerformanceGoal", "performance_goal", goalId,
      { outcome: "applied", status: "APPROVED", version: draft.version, author: draft.createdByUid, approver: actor.principalId, authorEmployeeId: draft.authorEmployeeId, approverEmployeeId,
        reason: approval.reason, supersededGoalId: supersededId, predecessorClosedAt: closedAt, ...basis, ...(correction ? { correctedScheduledGoal: true, ...correction } : {}) },
      `APPROVED v${draft.version} ${draft.metricId} ${draft.targetScopeType}:${draft.targetScopeId ?? "-"} target=${draft.targetValue} author=${draft.createdByUid} approver=${actor.principalId}${supersededId ? ` superseded=${supersededId} closedAt=${closedAt}` : ""}${correction ? ` correctedScheduled=true precedingClosedAt=${correction.precedingClosedAt}` : ""} reason="${approval.reason}"`);
    return result;
  });
}

// ════════════════════ retirePerformanceGoal ════════════════════

/**
 * Withdraw an APPROVED goal with NO successor. Distinct from supersession: "we changed the number" and "we stopped measuring this" are different facts. The window is
 * CLOSED at the retiring act's own date (UTC) -- never before the goal began -- not deleted, so the period it governed stays readable. A DRAFT of any provenance can be
 * retired too: that is its disposition (a copied draft cannot be approved here, an abandoned one is discarded) -- it becomes RETIRED, never measured, its window untouched.
 * Input: { goalId, reason, idempotencyKey }.
 */
export async function retirePerformanceGoal(deps: GoalAuthoringDeps, actor: RecordsActor, input: Record<string, unknown>) {
  requireCapability(actor, GOAL_RETIRE);
  const i = acceptOnly(input, ["goalId", "reason", "idempotencyKey"]);
  const key = requireIdempotencyKey(i.idempotencyKey);
  const goalId = requireGoalId(i.goalId);
  const reason = requireReason(i.reason);
  const today = isoToday(deps.now ?? (() => new Date()));

  return inTransaction(deps.pool, "write", async (c) => {
    const reach = await reachableCompanies(c, actor);
    const fingerprint = fingerprintOf(["RETIRE", goalId, reason]);
    const replay = await probeReplay(c, actor, key, "RETIRE", fingerprint);
    if (replay) return replay;

    const named = await loadGoal(c, actor.tenantId, goalId);
    if (!named) return refuse("GOAL_NOT_FOUND", "NOT_FOUND", "no such goal");
    const t = targetOf(named);
    const ctx = goalContextOn(c, actor, reach);
    const reachDecision = await decideGoalReach(ctx, t, GOAL_RETIRE);
    if (!reachDecision.allowed) return refuseDecision(reachDecision, true);
    const subject = await decideEmployeeSubject(ctx, t);
    if (!subject.allowed) return refuseDecision(subject, true);

    await lockTarget(c, actor.tenantId, t);
    const goal = await loadGoal(c, actor.tenantId, goalId);
    if (!goal) return refuse("GOAL_NOT_FOUND", "NOT_FOUND", "no such goal");
    if (goal.status !== "APPROVED" && goal.status !== "DRAFT") {
      return refuse("GOAL_NOT_RETIRABLE", "PRECONDITION_FAILED", `only an APPROVED goal or a DRAFT may be retired (this goal is ${goal.status})`);
    }
    const decision = await decideWrite(ctx, t, "retire", null);
    if (!decision.allowed) return refuseDecision(decision, true);

    if (goal.status === "APPROVED" && goal.effectiveFrom > today) {
      // G-1b (Owner, option A): an approved target that has not started is SCHEDULED, and history is immutable -- it is corrected by a replacement someone else approves,
      // never withdrawn (a withdrawal would leave the dates after the version before it with no target, or reopen a closed window).
      return refuse("GOAL_SCHEDULED_NOT_RETIRABLE", "PRECONDITION_FAILED",
        "This target hasn't started yet, so it can't be retired. To change it, set a corrective replacement for someone else to approve.");
    }
    if (goal.status === "DRAFT") {
      // Disposition of a draft: it was never a target, so no window closes and nothing was measured against it.
      await c.query(`UPDATE ${SCHEMA}.performance_goals SET status = 'RETIRED' WHERE tenant_id = $1 AND goal_id = $2`, [actor.tenantId, goalId]);
      const discarded = { outcome: "applied", goalId, status: "RETIRED", version: goal.version, closedAt: null, discardedDraft: true };
      await recordCommand(c, actor, key, "RETIRE", goalId, fingerprint, discarded);
      await recordsAudit(c, actor, "retirePerformanceGoal", "performance_goal", goalId,
        { outcome: "applied", status: "RETIRED", version: goal.version, discardedDraft: true, provenance: goal.provenance, reason },
        `RETIRED (discarded draft, ${goal.provenance}) v${goal.version} ${goal.metricId} ${goal.targetScopeType}:${goal.targetScopeId ?? "-"} reason="${reason}"`);
      return discarded;
    }

    // (A goal that has not started was refused above: a retire always closes at today, never before the goal began.)
    const closeAt = today;
    const effectiveTo = goal.effectiveTo !== null && goal.effectiveTo < closeAt ? goal.effectiveTo : closeAt;
    await c.query(`UPDATE ${SCHEMA}.performance_goals SET status = 'RETIRED', effective_to = $3 WHERE tenant_id = $1 AND goal_id = $2`, [actor.tenantId, goalId, effectiveTo]);
    const result = { outcome: "applied", goalId, status: "RETIRED", version: goal.version, closedAt: effectiveTo };
    await recordCommand(c, actor, key, "RETIRE", goalId, fingerprint, result);
    await recordsAudit(c, actor, "retirePerformanceGoal", "performance_goal", goalId,
      { outcome: "applied", status: "RETIRED", version: goal.version, closedAt: effectiveTo, discardedDraft: false, reason },
      `RETIRED v${goal.version} ${goal.metricId} ${goal.targetScopeType}:${goal.targetScopeId ?? "-"} closedAt=${effectiveTo} reason="${reason}"`);
    return result;
  });
}

// ════════════════════ listGoalAuthoringOptions ════════════════════

/**
 * What THIS caller may author, in the shape the screen's pickers need. OFFERED == ACCEPTED: the metrics are the registry's ACTIVE ones the caller has authority over
 * (factor 2) and whose scopes EOS can bind; the companies and warehouses are the ones the write decision would accept; the people are the visibility set minus the
 * caller's own Employee. Needs at least one authoring capability. Read-only.
 */
export async function listGoalAuthoringOptions(deps: { readonly pool: Pool }, actor: RecordsActor, input: Record<string, unknown>) {
  acceptOnly(input, []);
  if (!actor || !(actor.capabilities instanceof Set) || !GOAL_WRITE_CAPABILITIES.some((k) => actor.capabilities.has(k))) {
    requireCapability(actor, GOAL_CREATE);
  }
  return withGoalContext(deps, actor, async (ctx) => {
    const metrics = PERFORMANCE_METRICS
      .filter((m) => m.activeForGoals && decideMetricAuthority(ctx, m, "setting").allowed)
      .map((m) => ({
        metricId: m.metricId, displayName: m.displayName, unit: m.unit, allowedDirections: [...m.allowedDirections],
        supportedScopes: m.supportedScopes.filter((s) => (AUTHORABLE_SCOPES as readonly string[]).includes(s)),
      }))
      .filter((m) => m.supportedScopes.length > 0);
    const companies = ctx.reach.companies.map((id) => ({ id, name: operatingCompanyDisplayName(id) ?? id }));
    const scoped = await ctx.warehouseScope();
    const { rows } = scoped.length === 0 ? { rows: [] as Array<Record<string, unknown>> } : await ctx.db.query(
      `SELECT id, name FROM ${SCHEMA}.warehouses WHERE tenant_id = $1 AND id = ANY($2::text[]) AND operating_company_key = ANY($3::text[]) ORDER BY name, id`,
      [actor.tenantId, [...scoped], [...ctx.reach.keys]]);
    return {
      // The caller's own Principal id: the screen withholds "Approve" from a draft its caller authored (the command refuses it anyway).
      principalId: actor.principalId,
      verbs: { create: actor.capabilities.has(GOAL_CREATE), supersede: actor.capabilities.has(GOAL_SUPERSEDE), approve: actor.capabilities.has(GOAL_APPROVE), retire: actor.capabilities.has(GOAL_RETIRE) },
      metrics,
      companies,
      warehouses: rows.map((r) => ({ id: String(r.id), name: String(r.name) })),
      employeeIds: await subjectEmployeeIds(ctx),
    };
  });
}
