// ADMINISTRATION USERS CONSOLIDATION -- the callable adapter for the record-scoped Change History read.
//
// RETIRED (2026-09-17): the `updateEmployeeProfile` callable adapter that used to live here is removed. It wrote
// the retired Firestore `employees` record + `employee_number_registry`; PostgreSQL is the Employee authority
// (#1913) and the browser uses the governed Workforce commands (#1937). employeeProfileCommands.ts is kept only
// for its vocabulary and the unit-tested record of the legacy writer; it is not exposed.
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
// to the production project. It denies today in every environment for the standing platform
// reason -- no principal holds a `roleAssignments` document, so every governed capability
// resolution denies -- which the Users surface states on screen rather than hiding.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";
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

  // Entirely about the caller's own submitted input. Safe, and actionable.
  if (err instanceof changeHistory.InvalidInputError) {
    return new HttpsError("invalid-argument", err.message);
  }

  // The specific denial REASON is access-model internal state. The caller learns that they may
  // not, never why the resolver said so.
  if (err instanceof changeHistory.UnauthorizedActorError) {
    return new HttpsError("permission-denied", "You are not authorized to perform this action.");
  }

  return new HttpsError("internal", "An unexpected error occurred. Please try again.");
}

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
