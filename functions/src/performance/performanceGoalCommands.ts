// PERFORMANCE GOAL -- the trusted command service. Three commands: author a draft, approve it,
// retire it.
//
// REUSES the Part Master trusted-command machinery (idempotency by deterministic audit id, request
// fingerprinting, server-authored audit, single transaction, bounded errors) rather than
// reimplementing any of it. What it does NOT reuse is that machinery's capability check: that one
// asks a GLOBAL target, and a goal must be asked at its OWN target scope or a Parts Manager for
// wh-north would reach wh-south. Authorization here goes through resolveGoalAuthority, which asks
// the scoped question and the three others the Owner's policy requires.
//
// ============================ WHY SUPERSESSION IS PART OF APPROVAL ============================
//
// The Owner's rule is that changing a future target must never rewrite historical performance. The
// dangerous moment is not authoring the new number -- it is the instant the new version becomes
// authoritative while the old one is still open, because for that instant TWO approved goals cover
// one date, and `currentGoalFor` refuses rather than picking. A manager's screen and an employee's
// screen would disagree, or both would error.
//
// So closing the predecessor's window happens in the SAME TRANSACTION as the approval that makes the
// successor authoritative. There is no window during which both are open, and none during which
// neither is. The predecessor's effectiveFrom, targetValue, version and approval evidence are NEVER
// touched -- only its status and the closing end of its window, which is what "this target applied
// until here" means.
//
// ============================ WHAT NO COMMAND HERE CAN DO ============================
//
// Edit a target value. Approve one's own draft. Reopen a retired goal. Write an actual. None of
// those has a code path; they are absent rather than guarded.
import { createHash } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { getFirestore } from "firebase-admin/firestore";
import type { Role } from "../types/access";
import { COMPATIBILITY_ROLES } from "../access/compatibilityRoles.js";
import { GOVERNED_BUSINESS_ROLES } from "../access/governedBusinessRoles.js";
import { loadPrincipalPositions } from "../access/hierarchicalVisibility.js";
import { recordStandaloneAuditEvent, stageAuditEventWithId } from "../access/auditEventWriter.js";
import { resolveRuntimeCapabilityOverrides } from "../access/environmentCapabilityOverrides.js";
import {
  InvalidInputError,
  UnauthorizedActorError,
  NotFoundError,
  InvalidStatusTransitionError,
  type MutationOutcome,
  __pm_internal_assertActorUid,
  __pm_internal_assertIdempotencyKey,
  __pm_internal_fingerprint,
  __pm_internal_checkIdempotency,
} from "../partMaster/partMasterCommands.js";
import { buildApprovalRecord } from "../finance/financialApprovals.js";
import { buildPerformanceGoal, GoalError, type PerformanceGoal } from "./performanceGoal.js";
import { resolveGoalAuthority, type GoalVerb } from "./performanceGoalAuthority.js";
import {
  buildFirestorePerformanceGoalRepository,
  type PerformanceGoalRepository,
} from "./performanceGoalRepository.js";

export interface PerformanceGoalDeps {
  db?: Firestore;
  roles?: Readonly<Record<string, Role>>;
  now?: () => Date;
  /** TEST-ONLY atomicity seam, matching the Part Master precedent. */
  __simulateFailureAfterStage?: Error;
}

function resolveDeps(deps: PerformanceGoalDeps | undefined) {
  return {
    db: deps?.db ?? getFirestore(),
    roles: deps?.roles ?? ({ ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES } as Readonly<Record<string, Role>>),
    now: deps?.now ?? (() => new Date()),
    failAfterStage: deps?.__simulateFailureAfterStage,
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The calendar day before an ISO date. Pure UTC arithmetic -- no locale, no ambient timezone. */
export function previousIsoDate(iso: string): string {
  if (!ISO_DATE.test(iso)) throw new InvalidInputError("date must be ISO (YYYY-MM-DD)");
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Today, in UTC, as an ISO date. Used only to close a RETIRED goal's window at the retiring act. */
function isoToday(now: () => Date): string {
  return now().toISOString().slice(0, 10);
}

function auditDocId(operation: string, actorUid: string, goalId: string, key: string): string {
  return "pg_" + createHash("sha256").update(`${operation}|${actorUid}|${goalId}|${key}`).digest("hex").slice(0, 40);
}

function readAccessVersion(data: Record<string, unknown> | undefined): number {
  const v = data?.accessVersion;
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
}

/**
 * The scoped authorization gate. Loads the actor's real assignments, employee link and the employee
 * population, then asks resolveGoalAuthority. A denial is AUDITED before it throws, because a
 * refused attempt to set someone's target is exactly the kind of act that should leave a trace.
 */
async function requireGoalAuthority(
  db: Firestore,
  roles: Readonly<Record<string, Role>>,
  actorUid: string,
  verb: GoalVerb,
  spec: { metricId: string; targetScopeType: string; targetScopeId: string | null; authoredByUid?: string | null },
  auditAction: "createPerformanceGoalDraft" | "approvePerformanceGoal" | "supersedePerformanceGoal" | "retirePerformanceGoal",
  goalId: string,
): Promise<void> {
  const [userSnap, assignmentsSnap, population] = await Promise.all([
    db.collection("users").doc(actorUid).get(),
    db.collection("roleAssignments").where("principalUid", "==", actorUid).where("status", "==", "active").get(),
    loadPrincipalPositions(db),
  ]);
  const userData = userSnap.data() as Record<string, unknown> | undefined;

  const decision = resolveGoalAuthority({
    actorUid,
    actorEmployeeId: typeof userData?.employeeId === "string" ? (userData.employeeId as string) : null,
    verb,
    metricId: spec.metricId,
    targetScopeType: spec.targetScopeType,
    targetScopeId: spec.targetScopeId,
    authoredByUid: spec.authoredByUid ?? null,
    assignments: assignmentsSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as never[],
    roles,
    currentAccessVersion: readAccessVersion(userData),
    population,
    // The per-environment activation set. Production resolves this to EMPTY unconditionally, so the
    // whole authority is inert there until a separate, Owner-executed activation.
    activationOverrides: resolveRuntimeCapabilityOverrides(),
  });

  if (decision.decision === "ALLOW") return;

  await recordStandaloneAuditEvent({
    actorUid,
    action: auditAction,
    targetType: "performanceGoal",
    targetId: goalId,
    outcome: "denied",
    summary: `denied: ${decision.factor} -- ${decision.reason}`,
  });
  throw new UnauthorizedActorError(decision.reason ?? "not authorized");
}

function rethrowGoalError(err: unknown): never {
  // A GoalError is a validation refusal from the pure core. It surfaces as InvalidInputError so the
  // callable's error taxonomy stays the repository's, and its MESSAGE is preserved because these
  // messages name the blocker (a metric's inactivity reason, a unit mismatch) and are the whole
  // value of the refusal to whoever hit it.
  if (err instanceof GoalError) throw new InvalidInputError(err.message);
  throw err;
}

// ---------------------------------------------------------------------------
// createPerformanceGoalDraft
// ---------------------------------------------------------------------------

export interface CreateGoalDraftInput {
  actorUid: string;
  idempotencyKey: string;
  goalId: string;
  metricId: string;
  targetScopeType: string;
  targetScopeId: string | null;
  targetValue: number;
  unit: string;
  direction: string;
  currency?: string | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
  /** Present when this draft is intended to REPLACE an approved version. */
  supersedesGoalId?: string | null;
}

export interface CreateGoalDraftOutcome extends MutationOutcome {
  goalId: string;
  status: "DRAFT";
}

/**
 * Author a DRAFT version. A draft is never a measurement authority and is never compared against;
 * this command therefore changes nothing anyone is measured by, which is why it is separable from
 * approval at all.
 *
 * VERB DEPENDS ON INTENT. A first version asks `create`; a version that names a predecessor asks
 * `supersede`, because replacing a target in force is a different authority from setting one where
 * none existed, and the Owner's capability list separates them.
 */
export async function createPerformanceGoalDraft(
  input: CreateGoalDraftInput,
  deps?: PerformanceGoalDeps,
): Promise<CreateGoalDraftOutcome> {
  const { db, roles, now, failAfterStage } = resolveDeps(deps);
  __pm_internal_assertActorUid(input.actorUid);
  __pm_internal_assertIdempotencyKey(input.idempotencyKey);

  const supersedes = typeof input.supersedesGoalId === "string" && input.supersedesGoalId.length > 0 ? input.supersedesGoalId : null;
  const repo: PerformanceGoalRepository = buildFirestorePerformanceGoalRepository(db);

  await requireGoalAuthority(
    db, roles, input.actorUid,
    supersedes ? "supersede" : "create",
    { metricId: input.metricId, targetScopeType: input.targetScopeType, targetScopeId: input.targetScopeId },
    "createPerformanceGoalDraft", input.goalId,
  );

  let predecessor: PerformanceGoal | null = null;
  let version = 1;
  if (supersedes) {
    predecessor = await repo.getById(null, supersedes);
    if (!predecessor) throw new NotFoundError(`no goal exists at ${supersedes}`);
    if (predecessor.status !== "APPROVED") {
      throw new InvalidStatusTransitionError(
        `only an APPROVED version may be superseded (${supersedes} is ${predecessor.status}) -- a draft is edited by replacing it, and a retired goal has no successor by definition`,
      );
    }
    if (predecessor.metricId !== input.metricId || predecessor.targetScopeType !== input.targetScopeType || (predecessor.targetScopeId ?? null) !== (input.targetScopeId ?? null)) {
      throw new InvalidInputError(
        "a successor must target the SAME metric and scope as the version it supersedes -- changing either makes it a different goal, not a new version of this one",
      );
    }
    if (input.effectiveFrom <= predecessor.effectiveFrom) {
      throw new InvalidInputError(
        "a successor must take effect AFTER its predecessor began, or closing the predecessor's window would erase the period it governed",
      );
    }
    version = predecessor.version + 1;
  }

  let goal: PerformanceGoal;
  try {
    goal = buildPerformanceGoal({
      goalId: input.goalId,
      metricId: input.metricId,
      targetScopeType: input.targetScopeType,
      targetScopeId: input.targetScopeId,
      targetValue: input.targetValue,
      unit: input.unit,
      direction: input.direction,
      currency: input.currency ?? null,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo ?? null,
      status: "DRAFT",
      version,
      createdByUid: input.actorUid,
      createdAtMillis: now().getTime(),
      approvedByUid: null,
      approvedAtMillis: null,
      supersedesGoalId: supersedes,
    });
  } catch (err) { rethrowGoalError(err); }

  const fp = __pm_internal_fingerprint(["createPerformanceGoalDraft", goalToFingerprint(goal)]);
  const auditId = auditDocId("createPerformanceGoalDraft", input.actorUid, goal.goalId, input.idempotencyKey);

  return db.runTransaction(async (txn: Transaction) => {
    const replay = await __pm_internal_checkIdempotency(db, txn, auditId, fp);
    if (replay) return { ...replay, goalId: goal.goalId, status: "DRAFT" as const };
    if (await repo.getById(txn, goal.goalId)) throw new InvalidInputError(`a goal already exists at ${goal.goalId}`);

    repo.stageCreate(txn, goal);
    stageAuditEventWithId(txn, auditId, {
      actorUid: input.actorUid,
      action: "createPerformanceGoalDraft",
      targetType: "performanceGoal",
      targetId: goal.goalId,
      outcome: "applied",
      summary: `DRAFT v=${goal.version} ${goal.metricId} ${goal.targetScopeType}:${goal.targetScopeId ?? "-"} target=${goal.targetValue}${goal.unit === "PERCENT" ? "%" : ""} ${goal.direction} from=${goal.effectiveFrom}${supersedes ? ` supersedes=${supersedes}` : ""} fp=${fp}`,
    });
    if (failAfterStage) throw failAfterStage;
    return { outcome: "applied" as const, version: goal.version, goalId: goal.goalId, status: "DRAFT" as const };
  });
}

// Fingerprint over the fields that DEFINE the request. Deliberately excludes createdAtMillis, so a
// genuine retry of the same intent replays instead of colliding on a clock difference.
function goalToFingerprint(g: PerformanceGoal): unknown {
  return [g.goalId, g.metricId, g.targetScopeType, g.targetScopeId, g.targetValue, g.unit, g.direction, g.currency, g.effectiveFrom, g.effectiveTo, g.version, g.supersedesGoalId];
}

// ---------------------------------------------------------------------------
// approvePerformanceGoal
// ---------------------------------------------------------------------------

export interface ApproveGoalInput {
  actorUid: string;
  idempotencyKey: string;
  goalId: string;
  /** FIN-007: "a decision without a reason is not governance." */
  reason: string;
}

export interface ApproveGoalOutcome extends MutationOutcome {
  goalId: string;
  status: "APPROVED";
  supersededGoalId: string | null;
  /** The date the predecessor's window was closed at, when one was closed. */
  predecessorClosedAt: string | null;
}

/**
 * Approve a DRAFT, making it the target in force -- and, atomically, close the window of the version
 * it replaces.
 *
 * Self-approval is refused twice over and neither check is redundant: resolveGoalAuthority's factor 4
 * refuses before any read, and FIN-007's buildApprovalRecord refuses unconditionally at the record
 * boundary "under any policy". The second is what guarantees the rule survives someone later
 * relaxing the first.
 */
export async function approvePerformanceGoal(
  input: ApproveGoalInput,
  deps?: PerformanceGoalDeps,
): Promise<ApproveGoalOutcome> {
  const { db, roles, now, failAfterStage } = resolveDeps(deps);
  __pm_internal_assertActorUid(input.actorUid);
  __pm_internal_assertIdempotencyKey(input.idempotencyKey);
  if (typeof input.reason !== "string" || input.reason.trim().length === 0) {
    throw new InvalidInputError("a decision without a reason is not governance");
  }

  const repo = buildFirestorePerformanceGoalRepository(db);
  const draft = await repo.getById(null, input.goalId);
  if (!draft) throw new NotFoundError(`no goal exists at ${input.goalId}`);
  if (draft.status !== "DRAFT") {
    throw new InvalidStatusTransitionError(`only a DRAFT may be approved (${input.goalId} is ${draft.status})`);
  }

  const supersedes = draft.supersedesGoalId;
  await requireGoalAuthority(
    db, roles, input.actorUid, "approve",
    {
      metricId: draft.metricId,
      targetScopeType: draft.targetScopeType,
      targetScopeId: draft.targetScopeId,
      authoredByUid: draft.createdByUid,
    },
    supersedes ? "supersedePerformanceGoal" : "approvePerformanceGoal",
    input.goalId,
  );

  const decidedAtMillis = now().getTime();
  // FIN-007's record. amountMinor is null because approving a target is not a monetary action --
  // the shape the engine's own comment reserves "for non-monetary actions (e.g. plan approval)".
  // Built for its INVARIANTS (self-approval refusal, mandatory reason, frozen evidence); the record
  // is not persisted separately because the approval evidence lives on the goal version itself and a
  // second store of the same fact is a second thing to keep in step.
  const approval = buildApprovalRecord({
    actionType: "PLAN_APPROVAL",
    targetRecordId: input.goalId,
    amountMinor: null,
    requestedByUid: draft.createdByUid,
    decidedByUid: input.actorUid,
    decision: "APPROVED",
    reason: input.reason,
    decidedAtMillis,
  });

  const fp = __pm_internal_fingerprint(["approvePerformanceGoal", input.goalId, input.actorUid, approval.reason]);
  const auditId = auditDocId("approvePerformanceGoal", input.actorUid, input.goalId, input.idempotencyKey);
  const closeAt = supersedes ? previousIsoDate(draft.effectiveFrom) : null;

  return db.runTransaction(async (txn: Transaction) => {
    const replay = await __pm_internal_checkIdempotency(db, txn, auditId, fp);
    if (replay) {
      return { ...replay, goalId: input.goalId, status: "APPROVED" as const, supersededGoalId: supersedes, predecessorClosedAt: closeAt };
    }

    // Re-read inside the transaction: the status checked above was read outside it.
    const current = await repo.getById(txn, input.goalId);
    if (!current) throw new NotFoundError(`no goal exists at ${input.goalId}`);
    if (current.status !== "DRAFT") throw new InvalidStatusTransitionError(`only a DRAFT may be approved (${input.goalId} is ${current.status})`);

    if (supersedes) {
      const predecessor = await repo.getById(txn, supersedes);
      if (!predecessor) throw new NotFoundError(`no goal exists at ${supersedes}`);
      if (predecessor.status !== "APPROVED") {
        throw new InvalidStatusTransitionError(`the version being superseded is ${predecessor.status}, not APPROVED -- it may already have been replaced`);
      }
      // Close the predecessor at the day before the successor takes effect. If it already ends
      // EARLIER, leave it: shortening a window is closing it, but LENGTHENING one would extend a
      // target over days it never governed, which is the history rewrite this whole design refuses.
      const effectiveTo =
        predecessor.effectiveTo !== null && predecessor.effectiveTo < (closeAt as string)
          ? predecessor.effectiveTo
          : (closeAt as string);
      repo.stageLifecycleChange(txn, supersedes, { status: "SUPERSEDED", effectiveTo });
    }

    repo.stageLifecycleChange(txn, input.goalId, {
      status: "APPROVED",
      approvedByUid: approval.decidedByUid,
      approvedAtMillis: approval.decidedAtMillis,
    });

    stageAuditEventWithId(txn, auditId, {
      actorUid: input.actorUid,
      action: supersedes ? "supersedePerformanceGoal" : "approvePerformanceGoal",
      targetType: "performanceGoal",
      targetId: input.goalId,
      outcome: "applied",
      summary: `APPROVED v=${current.version} ${current.metricId} ${current.targetScopeType}:${current.targetScopeId ?? "-"} target=${current.targetValue} author=${current.createdByUid} approver=${input.actorUid}${supersedes ? ` superseded=${supersedes} closedAt=${closeAt}` : ""} reason="${approval.reason}" fp=${fp}`,
    });
    if (failAfterStage) throw failAfterStage;
    return {
      outcome: "applied" as const,
      version: current.version,
      goalId: input.goalId,
      status: "APPROVED" as const,
      supersededGoalId: supersedes,
      predecessorClosedAt: closeAt,
    };
  });
}

// ---------------------------------------------------------------------------
// retirePerformanceGoal
// ---------------------------------------------------------------------------

export interface RetireGoalInput {
  actorUid: string;
  idempotencyKey: string;
  goalId: string;
  reason: string;
}

export interface RetireGoalOutcome extends MutationOutcome {
  goalId: string;
  status: "RETIRED";
  closedAt: string;
}

/**
 * Withdraw an APPROVED goal with NO successor.
 *
 * Distinct from supersession, and the distinction is the point: "we changed the number" and "we
 * stopped measuring this" are different facts about a person's performance, and a retired goal that
 * looked SUPERSEDED would imply a successor nobody can find.
 *
 * The window is closed at the retiring act's own date rather than deleted, so the period the goal DID
 * govern remains readable. A retired goal is history, not an absence.
 */
export async function retirePerformanceGoal(
  input: RetireGoalInput,
  deps?: PerformanceGoalDeps,
): Promise<RetireGoalOutcome> {
  const { db, roles, now, failAfterStage } = resolveDeps(deps);
  __pm_internal_assertActorUid(input.actorUid);
  __pm_internal_assertIdempotencyKey(input.idempotencyKey);
  if (typeof input.reason !== "string" || input.reason.trim().length === 0) {
    throw new InvalidInputError("a decision without a reason is not governance");
  }

  const repo = buildFirestorePerformanceGoalRepository(db);
  const goal = await repo.getById(null, input.goalId);
  if (!goal) throw new NotFoundError(`no goal exists at ${input.goalId}`);
  if (goal.status !== "APPROVED") {
    throw new InvalidStatusTransitionError(`only an APPROVED goal may be retired (${input.goalId} is ${goal.status})`);
  }

  await requireGoalAuthority(
    db, roles, input.actorUid, "retire",
    { metricId: goal.metricId, targetScopeType: goal.targetScopeType, targetScopeId: goal.targetScopeId },
    "retirePerformanceGoal", input.goalId,
  );

  const today = isoToday(now);
  // Retiring a goal that has not started yet closes it at its own start, never before it: a window
  // ending before it begins is unrepresentable and would fail revalidation on the way back out.
  const closedAt = today < goal.effectiveFrom ? goal.effectiveFrom : today;
  const fp = __pm_internal_fingerprint(["retirePerformanceGoal", input.goalId, input.actorUid, input.reason.trim()]);
  const auditId = auditDocId("retirePerformanceGoal", input.actorUid, input.goalId, input.idempotencyKey);

  return db.runTransaction(async (txn: Transaction) => {
    const replay = await __pm_internal_checkIdempotency(db, txn, auditId, fp);
    if (replay) return { ...replay, goalId: input.goalId, status: "RETIRED" as const, closedAt };

    const current = await repo.getById(txn, input.goalId);
    if (!current) throw new NotFoundError(`no goal exists at ${input.goalId}`);
    if (current.status !== "APPROVED") throw new InvalidStatusTransitionError(`only an APPROVED goal may be retired (${input.goalId} is ${current.status})`);

    const effectiveTo = current.effectiveTo !== null && current.effectiveTo < closedAt ? current.effectiveTo : closedAt;
    repo.stageLifecycleChange(txn, input.goalId, { status: "RETIRED", effectiveTo });
    stageAuditEventWithId(txn, auditId, {
      actorUid: input.actorUid,
      action: "retirePerformanceGoal",
      targetType: "performanceGoal",
      targetId: input.goalId,
      outcome: "applied",
      summary: `RETIRED v=${current.version} ${current.metricId} ${current.targetScopeType}:${current.targetScopeId ?? "-"} closedAt=${effectiveTo} reason="${input.reason.trim()}" fp=${fp}`,
    });
    if (failAfterStage) throw failAfterStage;
    return { outcome: "applied" as const, version: current.version, goalId: input.goalId, status: "RETIRED" as const, closedAt: effectiveTo };
  });
}
