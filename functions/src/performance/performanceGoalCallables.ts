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
import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  createPerformanceGoalDraft,
  approvePerformanceGoal,
  retirePerformanceGoal,
} from "./performanceGoalCommands.js";
import {
  listCurrentPerformanceGoals,
  listPerformanceGoalVersions,
  listGoalSubjects,
  GoalReadError,
} from "./performanceGoalReadService.js";
import {
  InvalidInputError,
  UnauthorizedActorError,
  NotFoundError,
  VersionConflictError,
  IdempotencyConflictError,
  InvalidStatusTransitionError,
} from "../partMaster/partMasterCommands.js";
import { MalformedStoredRecordError } from "../partMaster/partMasterRepository.js";

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
export function mapError(err: unknown): HttpsError {
  if (err instanceof InvalidInputError) return new HttpsError("invalid-argument", err.message);
  if (err instanceof UnauthorizedActorError) return new HttpsError("permission-denied", "You are not authorized to perform this action.");
  if (err instanceof NotFoundError) return new HttpsError("not-found", "No performance goal exists at that id.");
  if (err instanceof VersionConflictError) return new HttpsError("aborted", "The record changed since you loaded it. Reload and retry.");
  if (err instanceof IdempotencyConflictError) return new HttpsError("aborted", "That idempotency key was already used for a different request.");
  if (err instanceof InvalidStatusTransitionError) return new HttpsError("failed-precondition", err.message);
  if (err instanceof GoalReadError) {
    if (err.code === "DENIED") return new HttpsError("permission-denied", "You are not authorized to read that target.");
    return new HttpsError("invalid-argument", err.message);
  }
  if (err instanceof MalformedStoredRecordError) return new HttpsError("internal", "The request could not be completed.");
  return new HttpsError("internal", "The request could not be completed.");
}

function requireAuth(request: { auth?: { uid: string } | null }): string {
  if (!request.auth || typeof request.auth.uid !== "string" || request.auth.uid.length === 0) {
    throw new HttpsError("unauthenticated", "Must be signed in.");
  }
  return request.auth.uid;
}

function asObject(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new HttpsError("invalid-argument", "Request data must be an object.");
  }
  return data as Record<string, unknown>;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

export const createPerformanceGoalDraftCallable = onCall(async (request) => {
  const actorUid = requireAuth(request);
  const d = asObject(request.data);
  try {
    return await createPerformanceGoalDraft({
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
  } catch (err) {
    throw mapError(err);
  }
});

export const approvePerformanceGoalCallable = onCall(async (request) => {
  const actorUid = requireAuth(request);
  const d = asObject(request.data);
  try {
    return await approvePerformanceGoal({
      actorUid,
      idempotencyKey: str(d.idempotencyKey),
      goalId: str(d.goalId),
      reason: str(d.reason),
    });
  } catch (err) {
    throw mapError(err);
  }
});

export const retirePerformanceGoalCallable = onCall(async (request) => {
  const actorUid = requireAuth(request);
  const d = asObject(request.data);
  try {
    return await retirePerformanceGoal({
      actorUid,
      idempotencyKey: str(d.idempotencyKey),
      goalId: str(d.goalId),
      reason: str(d.reason),
    });
  } catch (err) {
    throw mapError(err);
  }
});

export const listCurrentPerformanceGoalsCallable = onCall(async (request) => {
  const actorUid = requireAuth(request);
  const d = asObject(request.data);
  const rawTargets = Array.isArray(d.targets) ? d.targets : [];
  try {
    return await listCurrentPerformanceGoals({
      actorUid,
      onDate: str(d.onDate),
      targets: rawTargets.map((t) => {
        const o = (t && typeof t === "object" ? t : {}) as Record<string, unknown>;
        return { metricId: str(o.metricId), targetScopeType: str(o.targetScopeType), targetScopeId: strOrNull(o.targetScopeId) };
      }),
    });
  } catch (err) {
    throw mapError(err);
  }
});

export const listPerformanceGoalVersionsCallable = onCall(async (request) => {
  const actorUid = requireAuth(request);
  const d = asObject(request.data);
  const o = (d.target && typeof d.target === "object" ? d.target : {}) as Record<string, unknown>;
  try {
    return await listPerformanceGoalVersions({
      actorUid,
      target: { metricId: str(o.metricId), targetScopeType: str(o.targetScopeType), targetScopeId: strOrNull(o.targetScopeId) },
    });
  } catch (err) {
    throw mapError(err);
  }
});

export const listGoalSubjectsCallable = onCall(async (request) => {
  const actorUid = requireAuth(request);
  try {
    return await listGoalSubjects({ actorUid });
  } catch (err) {
    throw mapError(err);
  }
});
