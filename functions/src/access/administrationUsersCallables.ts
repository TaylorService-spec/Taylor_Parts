// ADMINISTRATION USERS CONSOLIDATION -- the callable adapters for the two new Administration >
// Users surfaces: the governed Employee profile write, and the record-scoped Change History read.
//
// The SAME thin-adapter contract accessCommandCallables.ts sets, and for the same three reasons:
// `actorUid` is derived from the AUTHENTICATED SERVER CONTEXT and from nothing else (a client that
// sends one is ignored -- no adapter below reads `data.actorUid`); the command modules' typed
// errors are mapped to safe public HttpsErrors that never leak a Firestore path, a resolver reason
// code or a stack; and `request.auth` is required at all.
//
// Every authorization, validation and audit decision lives in the command modules and is
// re-implemented nowhere here.
//
// DEPLOYMENT POSTURE, unchanged from every other surface in this file's neighbourhood: these
// deploy to eos-platform-sandbox under the per-environment activation program and are NOT deployed
// to the production project. Both deny today in every environment for the standing platform
// reason -- no principal holds a `roleAssignments` document, so every governed capability
// resolution denies -- which the Users surface states on screen rather than hiding.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";
import * as employeeProfile from "./employeeProfileCommands";
import * as changeHistory from "./recordChangeHistoryReadService";

const REGION = "us-central1";

function requireActorUid(request: CallableRequest): string {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be signed in.");
  }
  return request.auth.uid;
}

function asRecord(data: unknown): Record<string, unknown> {
  return typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
}

function mapError(err: unknown): HttpsError {
  if (err instanceof HttpsError) return err;

  // Entirely about the caller's own submitted input -- which field, which vocabulary. Safe, and
  // the only class of message an edit form can actually act on.
  if (
    err instanceof employeeProfile.InvalidInputError ||
    err instanceof changeHistory.InvalidInputError
  ) {
    return new HttpsError("invalid-argument", err.message);
  }

  // The specific denial REASON is access-model internal state. The caller learns that they may
  // not, never why the resolver said so.
  if (
    err instanceof employeeProfile.UnauthorizedActorError ||
    err instanceof changeHistory.UnauthorizedActorError
  ) {
    return new HttpsError("permission-denied", "You are not authorized to perform this action.");
  }

  // "The employee does not exist" and "the manager you chose does not exist" are both facts about
  // ids the CALLER submitted, and both are actionable. Neither names a collection path.
  if (err instanceof employeeProfile.EmployeeNotFoundError) {
    return new HttpsError("not-found", "This employee record could not be found.");
  }
  if (err instanceof employeeProfile.UnknownManagerError) {
    return new HttpsError("failed-precondition", "The selected manager is not an existing employee.");
  }

  if (err instanceof employeeProfile.IdempotencyKeyConflictError) {
    return new HttpsError(
      "already-exists",
      "This request key has already been used for a different request. Try again.",
    );
  }

  return new HttpsError("internal", "An unexpected error occurred. Please try again.");
}

/**
 * Edit an Employee's profile / employment record.
 *
 * `changes` is a field-key map. The command rejects any key outside its editable set BY NAME,
 * including securityRole, userId and account status -- so this adapter needs no allow-list of its
 * own, and cannot drift from the one that enforces.
 */
export const updateEmployeeProfile = onCall({ region: REGION }, async (request) => {
  const actorUid = requireActorUid(request);
  const data = asRecord(request.data);
  try {
    return await employeeProfile.updateEmployeeProfile({
      actorUid,
      employeeId: data.employeeId as string,
      changes: asRecord(data.changes),
      idempotencyKey: data.idempotencyKey as string,
    });
  } catch (err) {
    throw mapError(err);
  }
});

/**
 * One record's authoritative change history, newest first.
 *
 * Read-only, mutates nothing, and writes NO Audit Event of its own -- the same posture
 * resolveEffectiveAccessCallable takes, and for a sharper reason here: an audited denied read of
 * the audit trail would let an unauthorized caller append to the trail they were refused.
 */
export const listRecordChangeHistory = onCall({ region: REGION }, async (request) => {
  const actorUid = requireActorUid(request);
  const data = asRecord(request.data);
  try {
    const rows = await changeHistory.listRecordChangeHistory({
      actorUid,
      targetType: data.targetType as string,
      targetId: data.targetId as string,
      limit: typeof data.limit === "number" ? data.limit : undefined,
    });
    return { rows };
  } catch (err) {
    throw mapError(err);
  }
});
