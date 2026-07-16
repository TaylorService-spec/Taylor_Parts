// Enterprise Access & Administration Platform (Issue #226) -- callable
// Cloud Function adapters for the six trusted-writer commands
// (trustedWriterCommands.ts, Row 7 / Task 12, already independently
// reviewed across 4 rounds including one blocking external round).
//
// THIS FILE IS THE ENTIRE DEPLOYMENT SURFACE FOR THIS PROGRAM: a thin,
// uniform `onCall` wrapper per command. It adds exactly three things
// trustedWriterCommands.ts itself deliberately does not: (1) deriving
// `actorUid` from the AUTHENTICATED SERVER CONTEXT only, never from
// client-supplied data -- the single most important property of this
// file; (2) mapping the command module's typed error taxonomy to safe,
// public HttpsErrors that never leak internal Firestore paths, resolver
// reason codes, or stack detail; (3) requiring `request.auth` at all.
// Every other behavior (separation-of-duty, idempotency, atomic Audit
// Event + accessVersion mutation, claims sync) is exactly what
// trustedWriterCommands.ts already implements and trustedWriterCommands
// .test.mjs already exhaustively tests -- this file re-implements NONE
// of it.
//
// Per the Owner's deployment-candidate authorization: merging this file
// (once independently reviewed and clean) is not a production action.
// These functions are not deployed, and no Admin-mutation UI is wired
// to call them, until a SEPARATE, later Owner production authorization
// (Implementation Plan Row 19+) is issued.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";
import * as commands from "./trustedWriterCommands";

const REGION = "us-central1";

// Never passes a caught error's own message through unless the error is
// ENTIRELY about the client's own submitted input (never about internal
// server/data state) -- see each branch's comment for why it is or
// isn't safe to forward.
function mapCommandError(err: unknown): HttpsError {
  if (err instanceof HttpsError) return err;

  // The client's own malformed input (missing field, bad Scope shape,
  // bad idempotencyKey format) -- the message describes only what the
  // client itself submitted, never server-side state.
  if (err instanceof commands.InvalidInputError) {
    return new HttpsError("invalid-argument", err.message);
  }

  // Independent security review finding: UnknownRoleError is thrown from
  // TWO different contexts in trustedWriterCommands.ts -- grantRole/
  // assignApprovedRole's message describes only the client's own
  // submitted roleId (safe), but revokeRole's throws when a STORED
  // roleAssignment document references an unrecognized roleId, and its
  // message includes the internal `roleAssignments/<id>` collection
  // path. Rather than distinguish "safe" vs "unsafe" call sites by
  // string content (fragile, and the exact mistake that caused this),
  // this always uses a fixed, generic-but-actionable message -- the
  // client already knows the roleId it submitted (for grantRole/
  // assignApprovedRole) or the assignmentId it submitted (for
  // revokeRole), so no information is lost.
  if (err instanceof commands.UnknownRoleError) {
    return new HttpsError("invalid-argument", "The specified roleId is not recognized.");
  }

  // Self-approval / approver-distinctness rules reference only the
  // uids/roleId the CLIENT itself submitted -- safe to forward.
  if (err instanceof commands.SelfApprovalError) {
    return new HttpsError("permission-denied", err.message);
  }

  // The resolver's specific denial REASON (e.g. "noQualifyingGrant") is
  // internal detail about the access-control model's internal state,
  // not something the client needs or should learn from a failed call.
  if (err instanceof commands.UnauthorizedActorError) {
    return new HttpsError("permission-denied", "You are not authorized to perform this action.");
  }
  if (err instanceof commands.InsufficientApproverAuthorityError) {
    return new HttpsError(
      "permission-denied",
      "The named approver is not authorized to approve this privileged action.",
    );
  }

  // These reference internal Firestore document paths/shapes
  // (e.g. "roleAssignments/<id>.scope is malformed") -- generalized so
  // no internal collection/document structure is ever exposed.
  if (err instanceof commands.MalformedAccessDataError || err instanceof commands.UnavailableAccessDataError) {
    return new HttpsError(
      "failed-precondition",
      "The requested access record could not be read. Try again or contact an administrator.",
    );
  }
  if (err instanceof commands.InvalidStateError) {
    return new HttpsError(
      "failed-precondition",
      "This request cannot be completed for the target's current state.",
    );
  }

  // The mutation already committed; only the post-commit claims-sync
  // step failed. The client's own idempotencyKey is safe to reflect
  // back (it's theirs), and "retry-safe" is accurate, useful guidance.
  if (err instanceof commands.ClaimsSyncPendingError) {
    return new HttpsError(
      "unavailable",
      "Your request was recorded, but a follow-up step is still completing. Retry with the same idempotency key shortly.",
    );
  }

  // Idempotency-key reuse conflicts are entirely about the client's own
  // key choice -- safe, and actionable, to say so plainly.
  if (
    err instanceof commands.IdempotencyKeyConflictError ||
    err instanceof commands.IdempotencyKeyAlreadyDeniedError
  ) {
    return new HttpsError(
      "already-exists",
      "This idempotency key has already been used for a different or denied request. Use a new idempotency key and try again.",
    );
  }

  // Never leak an unrecognized error's message, class name, or stack.
  return new HttpsError("internal", "An unexpected error occurred. Please try again.");
}

// Requires an authenticated caller and returns their uid -- the ONLY
// place actorUid is ever derived from, across all six adapters. No
// adapter below ever reads an `actorUid` field from `request.data`; if a
// client submits one, it is silently ignored (the object spreads from
// `request.data` deliberately never include it -- see each adapter).
function requireActorUid(request: CallableRequest): string {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be signed in.");
  }
  return request.auth.uid;
}

function asRecord(data: unknown): Record<string, unknown> {
  return typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
}

export const grantRole = onCall({ region: REGION }, async (request) => {
  const actorUid = requireActorUid(request);
  const data = asRecord(request.data);
  try {
    return await commands.grantRole({
      actorUid,
      principalUid: data.principalUid as string,
      roleId: data.roleId as string,
      scope: data.scope as commands.GrantRoleInput["scope"],
      approverUid: data.approverUid as string | undefined,
      idempotencyKey: data.idempotencyKey as string,
    });
  } catch (err) {
    throw mapCommandError(err);
  }
});

export const revokeRole = onCall({ region: REGION }, async (request) => {
  const actorUid = requireActorUid(request);
  const data = asRecord(request.data);
  try {
    return await commands.revokeRole({
      actorUid,
      assignmentId: data.assignmentId as string,
      approverUid: data.approverUid as string | undefined,
      idempotencyKey: data.idempotencyKey as string,
    });
  } catch (err) {
    throw mapCommandError(err);
  }
});

export const assignApprovedRole = onCall({ region: REGION }, async (request) => {
  const actorUid = requireActorUid(request);
  const data = asRecord(request.data);
  try {
    return await commands.assignApprovedRole({
      actorUid,
      principalUid: data.principalUid as string,
      roleId: data.roleId as string,
      scope: data.scope as commands.AssignApprovedRoleInput["scope"],
      idempotencyKey: data.idempotencyKey as string,
    });
  } catch (err) {
    throw mapCommandError(err);
  }
});

export const setUserStatus = onCall({ region: REGION }, async (request) => {
  const actorUid = requireActorUid(request);
  const data = asRecord(request.data);
  try {
    return await commands.setUserStatus({
      actorUid,
      principalUid: data.principalUid as string,
      status: data.status as commands.SetUserStatusInput["status"],
      idempotencyKey: data.idempotencyKey as string,
    });
  } catch (err) {
    throw mapCommandError(err);
  }
});

export const approveAccessRequest = onCall({ region: REGION }, async (request) => {
  const actorUid = requireActorUid(request);
  const data = asRecord(request.data);
  try {
    return await commands.approveAccessRequest({
      actorUid,
      requestId: data.requestId as string,
      idempotencyKey: data.idempotencyKey as string,
    });
  } catch (err) {
    throw mapCommandError(err);
  }
});

export const rejectAccessRequest = onCall({ region: REGION }, async (request) => {
  const actorUid = requireActorUid(request);
  const data = asRecord(request.data);
  try {
    return await commands.rejectAccessRequest({
      actorUid,
      requestId: data.requestId as string,
      reason: data.reason as string,
      idempotencyKey: data.idempotencyKey as string,
    });
  } catch (err) {
    throw mapCommandError(err);
  }
});
