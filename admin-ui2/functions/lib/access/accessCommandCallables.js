"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.listPrivilegedRoleRequests = exports.readPrincipalAccessState = exports.decidePrivilegedRoleRequest = exports.requestPrivilegedRole = exports.rejectAccessRequest = exports.approveAccessRequest = exports.setUserStatus = exports.assignApprovedRole = exports.revokeRole = exports.grantRole = void 0;
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
// These functions are deployed to eos-platform-sandbox under the per-environment
// activation program; they are NOT deployed to the production project. No
// Admin-mutation UI is wired to call them, until a SEPARATE, later Owner
// production authorization (Implementation Plan Row 19+) is issued.
const https_1 = require("firebase-functions/v2/https");
const commands = __importStar(require("./trustedWriterCommands"));
const REGION = "us-central1";
// Never passes a caught error's own message through unless the error is
// ENTIRELY about the client's own submitted input (never about internal
// server/data state) -- see each branch's comment for why it is or
// isn't safe to forward.
function mapCommandError(err) {
    if (err instanceof https_1.HttpsError)
        return err;
    // The client's own malformed input (missing field, bad Scope shape,
    // bad idempotencyKey format) -- the message describes only what the
    // client itself submitted, never server-side state.
    if (err instanceof commands.InvalidInputError) {
        return new https_1.HttpsError("invalid-argument", err.message);
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
        return new https_1.HttpsError("invalid-argument", "The specified roleId is not recognized.");
    }
    // Self-approval / approver-distinctness rules reference only the
    // uids/roleId the CLIENT itself submitted -- safe to forward.
    if (err instanceof commands.SelfApprovalError) {
        return new https_1.HttpsError("permission-denied", err.message);
    }
    // The resolver's specific denial REASON (e.g. "noQualifyingGrant") is
    // internal detail about the access-control model's internal state,
    // not something the client needs or should learn from a failed call.
    if (err instanceof commands.UnauthorizedActorError) {
        return new https_1.HttpsError("permission-denied", "You are not authorized to perform this action.");
    }
    if (err instanceof commands.InsufficientApproverAuthorityError) {
        return new https_1.HttpsError("permission-denied", "The named approver is not authorized to approve this privileged action.");
    }
    // These reference internal Firestore document paths/shapes
    // (e.g. "roleAssignments/<id>.scope is malformed") -- generalized so
    // no internal collection/document structure is ever exposed.
    if (err instanceof commands.MalformedAccessDataError || err instanceof commands.UnavailableAccessDataError) {
        return new https_1.HttpsError("failed-precondition", "The requested access record could not be read. Try again or contact an administrator.");
    }
    if (err instanceof commands.InvalidStateError) {
        return new https_1.HttpsError("failed-precondition", "This request cannot be completed for the target's current state.");
    }
    // The mutation already committed; only the post-commit claims-sync
    // step failed. The client's own idempotencyKey is safe to reflect
    // back (it's theirs), and "retry-safe" is accurate, useful guidance.
    if (err instanceof commands.ClaimsSyncPendingError) {
        return new https_1.HttpsError("unavailable", "Your request was recorded, but a follow-up step is still completing. Retry with the same idempotency key shortly.");
    }
    // Idempotency-key reuse conflicts are entirely about the client's own
    // key choice -- safe, and actionable, to say so plainly.
    if (err instanceof commands.IdempotencyKeyConflictError ||
        err instanceof commands.IdempotencyKeyAlreadyDeniedError) {
        return new https_1.HttpsError("already-exists", "This idempotency key has already been used for a different or denied request. Use a new idempotency key and try again.");
    }
    // Never leak an unrecognized error's message, class name, or stack.
    return new https_1.HttpsError("internal", "An unexpected error occurred. Please try again.");
}
// Requires an authenticated caller and returns their uid -- the ONLY
// place actorUid is ever derived from, across all six adapters. No
// adapter below ever reads an `actorUid` field from `request.data`; if a
// client submits one, it is silently ignored (the object spreads from
// `request.data` deliberately never include it -- see each adapter).
function requireActorUid(request) {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    }
    return request.auth.uid;
}
function asRecord(data) {
    return typeof data === "object" && data !== null ? data : {};
}
exports.grantRole = (0, https_1.onCall)({ region: REGION }, async (request) => {
    const actorUid = requireActorUid(request);
    const data = asRecord(request.data);
    try {
        return await commands.grantRole({
            actorUid,
            principalUid: data.principalUid,
            roleId: data.roleId,
            scope: data.scope,
            approverUid: data.approverUid,
            idempotencyKey: data.idempotencyKey,
        });
    }
    catch (err) {
        throw mapCommandError(err);
    }
});
exports.revokeRole = (0, https_1.onCall)({ region: REGION }, async (request) => {
    const actorUid = requireActorUid(request);
    const data = asRecord(request.data);
    try {
        return await commands.revokeRole({
            actorUid,
            assignmentId: data.assignmentId,
            approverUid: data.approverUid,
            idempotencyKey: data.idempotencyKey,
        });
    }
    catch (err) {
        throw mapCommandError(err);
    }
});
exports.assignApprovedRole = (0, https_1.onCall)({ region: REGION }, async (request) => {
    const actorUid = requireActorUid(request);
    const data = asRecord(request.data);
    try {
        return await commands.assignApprovedRole({
            actorUid,
            principalUid: data.principalUid,
            roleId: data.roleId,
            scope: data.scope,
            idempotencyKey: data.idempotencyKey,
        });
    }
    catch (err) {
        throw mapCommandError(err);
    }
});
exports.setUserStatus = (0, https_1.onCall)({ region: REGION }, async (request) => {
    const actorUid = requireActorUid(request);
    const data = asRecord(request.data);
    try {
        return await commands.setUserStatus({
            actorUid,
            principalUid: data.principalUid,
            status: data.status,
            idempotencyKey: data.idempotencyKey,
        });
    }
    catch (err) {
        throw mapCommandError(err);
    }
});
exports.approveAccessRequest = (0, https_1.onCall)({ region: REGION }, async (request) => {
    const actorUid = requireActorUid(request);
    const data = asRecord(request.data);
    try {
        return await commands.approveAccessRequest({
            actorUid,
            requestId: data.requestId,
            idempotencyKey: data.idempotencyKey,
        });
    }
    catch (err) {
        throw mapCommandError(err);
    }
});
exports.rejectAccessRequest = (0, https_1.onCall)({ region: REGION }, async (request) => {
    const actorUid = requireActorUid(request);
    const data = asRecord(request.data);
    try {
        return await commands.rejectAccessRequest({
            actorUid,
            requestId: data.requestId,
            reason: data.reason,
            idempotencyKey: data.idempotencyKey,
        });
    }
    catch (err) {
        throw mapCommandError(err);
    }
});
// =====================================================================
// PRIVILEGED ROLE APPROVAL
// =====================================================================
//
// THE APPROVING IDENTITY IS request.auth.uid AND NOTHING ELSE.
//
// Note what is absent from decidePrivilegedRoleRequest: any read of an approver field from
// `data`. That absence IS the control. grantRole's `approverUid` parameter proves the named
// principal HOLDS approval authority and proves nothing about whether they used it -- a caller who
// can type the Admin UID could mint a privileged Role without the Admin present.
//
// Here there is no parameter through which an approver could be asserted, so the proof is
// structural rather than a validation rule a later edit could relax.
exports.requestPrivilegedRole = (0, https_1.onCall)({ region: REGION }, async (request) => {
    const actorUid = requireActorUid(request);
    const data = asRecord(request.data);
    try {
        return await commands.requestPrivilegedRole({
            actorUid,
            principalUid: data.principalUid,
            roleId: data.roleId,
            scope: data.scope,
            idempotencyKey: data.idempotencyKey,
        });
    }
    catch (err) {
        throw mapCommandError(err);
    }
});
exports.decidePrivilegedRoleRequest = (0, https_1.onCall)({ region: REGION }, async (request) => {
    const actorUid = requireActorUid(request);
    const data = asRecord(request.data);
    try {
        return await commands.decidePrivilegedRoleRequest({
            // actorUid is the APPROVER, derived from the authenticated session. Deliberately not
            // overridable: `data.approverUid`, if a caller sends one, is read by nothing.
            actorUid,
            requestId: data.requestId,
            decision: data.decision,
            reason: data.reason,
            idempotencyKey: data.idempotencyKey,
            // MFA SEAM. Auth-context facts the callable can already see, recorded on the decision so a
            // future "re-authenticated within N minutes" rule checks data that is already being written.
            approvalContext: {
                authTimeSeconds: request.auth?.token?.auth_time ?? null,
                signInProvider: request.auth?.token?.firebase?.sign_in_provider ?? null,
            },
        });
    }
    catch (err) {
        throw mapCommandError(err);
    }
});
// ONE PRINCIPAL'S ACCESS STATE. The read half of Administration > Users (Owner ruling §4).
//
// Clients cannot read `roleAssignments` directly -- no rule matches that collection in
// firestore.rules, so Firestore's default denies it -- and no client may hold the Admin SDK, so
// Auth's `disabled` flag is unreachable from the browser by construction. This callable is
// therefore the only read path for either fact, which is the point: the authority is checked
// server-side on admin.principalAccess.read rather than by a UI that declines to render a row.
//
// principalUid comes from the CLIENT (it is the record being viewed); actorUid comes only from
// request.auth.uid and is never accepted from the payload.
exports.readPrincipalAccessState = (0, https_1.onCall)({ region: REGION }, async (request) => {
    const actorUid = requireActorUid(request);
    const data = asRecord(request.data);
    try {
        return await commands.readPrincipalAccessState({
            actorUid,
            principalUid: data.principalUid,
        });
    }
    catch (err) {
        throw mapCommandError(err);
    }
});
// The APPROVAL QUEUE read. Approvers only.
//
// Clients cannot read `privilegedRoleRequests` directly: no rule matches that collection in
// firestore.rules, so Firestore's default denies it. That is the correct posture and this callable
// is the only read path -- which means the queue's contents are gated by the same capability that
// gates deciding on them, rather than by a UI that merely declines to render a button.
exports.listPrivilegedRoleRequests = (0, https_1.onCall)({ region: REGION }, async (request) => {
    const actorUid = requireActorUid(request);
    const data = asRecord(request.data);
    try {
        return await commands.listPrivilegedRoleRequests({
            actorUid,
            status: data.status,
        });
    }
    catch (err) {
        throw mapCommandError(err);
    }
});
//# sourceMappingURL=accessCommandCallables.js.map