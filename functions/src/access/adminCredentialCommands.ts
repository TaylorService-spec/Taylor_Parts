// AUTH-PR-3 (Authentication Modernization) -- admin-initiated password reset.
// Trusted command module (Admin SDK; bypasses Firestore Rules) that lets a
// governed ADMIN initiate a secure password reset for ANOTHER user. Extends the
// Issue #226 enterprise-access lane: it reuses the existing immutable Audit
// Event writer (auditEventWriter.ts) and never re-implements a second audit or
// authorization system.
//
// SECURITY MODEL (docs/assessments/auth-modernization-architecture.md §6):
//  - Authorization is the SINGLE governed admin authority. Until the Issue #226
//    permission engine is the LIVE authority (ADR-005 §1), the concrete check is
//    a server-side Admin-SDK read of `users/{actorUid}.role === "admin"`,
//    encapsulated in assertActorIsAdmin() so a later row can swap in
//    resolveEffectivePermission() WITHOUT changing callers. Dispatcher and
//    operational roles never qualify. The actor uid is supplied by the callable
//    wrapper from the AUTHENTICATED SERVER CONTEXT only -- never client data.
//  - No admin-visible temporary password (D-TEMP-PW rejected): the user always
//    sets their own password via a reset link the admin never sees. This module
//    NEVER returns the reset link or token to any caller.
//  - Routine reset uses DELIVERY-CONFIRMED revocation (revoke only after the
//    reset link is confirmed delivered, so a legitimate user is not locked out
//    when delivery fails). Suspected-compromise revokes immediately (accepted
//    lockout) with recovery. Durable, SEPARATE audit events are written for
//    initiation, delivery outcome, and revocation outcome.
//  - Delivery is an INJECTED seam (ResetDelivery). NO email provider is
//    configured here (D-EMAIL-DELIVERY is an implementation-time Owner
//    decision); the deployed callable wires NOT_CONFIGURED_DELIVERY so no email
//    is ever sent and (routine) no revocation occurs until a provider exists.
//
// Repository-only: no deployment; tests run only against the emulator.
import { getFirestore } from "firebase-admin/firestore";
import { recordStandaloneAuditEvent } from "./auditEventWriter";
import type { Scope } from "../types/access";

const USERS_COLLECTION = "users";
const ADMIN_ROLE = "admin";
const GLOBAL_SCOPE: Scope = { type: "global" };
const TARGET_TYPE = "user";
const MAX_LIST_LIMIT = 100;
const DEFAULT_LIST_LIMIT = 50;

export class UnauthorizedActorError extends Error {}
export class InvalidInputError extends Error {}
export class ProtectedAccountError extends Error {}

export type ResetMode = "routine" | "suspectedCompromise";

// Injected delivery seam. An implementation MUST deliver the reset link
// out-of-band to the user's recovery email and MUST NOT return the link/token
// to its caller; it reports ONLY whether delivery was confirmed. No provider is
// implemented in this PR.
export interface ResetDelivery {
  deliverResetLink(args: { targetUid: string; link: string }): Promise<{ delivered: boolean }>;
}

// The deployed default: intentionally NOT configured, so absent an Owner-
// approved provider (D-EMAIL-DELIVERY) no email is ever sent. Reports
// delivered:false, which (routine) also means no session revocation occurs.
export const NOT_CONFIGURED_DELIVERY: ResetDelivery = {
  async deliverResetLink() {
    return { delivered: false };
  },
};

// Injected Admin-SDK capabilities -- kept behind an interface so the command is
// unit-testable against the emulator and never hard-binds a real send/mutation.
export interface AdminResetDeps {
  // Generates a password-reset link WITHOUT sending an email
  // (getAuth().generatePasswordResetLink). The link is handed only to
  // `delivery` and is NEVER returned to the caller.
  generateResetLink(email: string): Promise<string>;
  // Revokes all refresh tokens for a uid (getAuth().revokeRefreshTokens).
  revokeRefreshTokens(uid: string): Promise<void>;
  // Resolves the target's recoverable email (getAuth().getUser(uid).email).
  getRecoverableEmail(uid: string): Promise<string | null>;
  delivery: ResetDelivery;
}

export interface InitiateAdminPasswordResetInput {
  actorUid: string;
  targetUid: string;
  mode?: ResetMode;
}

export interface AdminPasswordResetOutcome {
  status: "reset_initiated" | "sessions_revoked";
  deliveryOutcome: "delivered" | "not_delivered";
  sessionRevocationOutcome: "revoked" | "skipped";
}

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidInputError(`${field} is required`);
  }
}

async function readUserRole(uid: string): Promise<string | null> {
  const snap = await getFirestore().collection(USERS_COLLECTION).doc(uid).get();
  if (!snap.exists) return null;
  const data = snap.data() as { role?: unknown } | undefined;
  return typeof data?.role === "string" ? data.role : null;
}

// The single admin-authority choke point. Today: server-side read of
// users/{actorUid}.role === "admin". Later (#226 live): swap the body for
// resolveEffectivePermission(...) -- callers are unaffected.
async function assertActorIsAdmin(actorUid: string): Promise<void> {
  const role = await readUserRole(actorUid);
  if (role !== ADMIN_ROLE) {
    throw new UnauthorizedActorError("actor is not authorized for credential administration");
  }
}

async function auditDenied(actorUid: string, targetUid: string, action: "initiateAdminPasswordReset", summary: string): Promise<void> {
  await recordStandaloneAuditEvent({
    actorUid,
    action,
    targetType: TARGET_TYPE,
    targetId: targetUid,
    outcome: "denied",
    summary,
    scope: GLOBAL_SCOPE,
  });
}

// Initiate an admin-driven password reset for `targetUid`. Returns ONLY a
// coarse, non-sensitive status -- never the reset link, token, or password.
export async function initiateAdminPasswordReset(
  input: InitiateAdminPasswordResetInput,
  deps: AdminResetDeps,
): Promise<AdminPasswordResetOutcome> {
  assertNonEmptyString(input.actorUid, "actorUid");
  assertNonEmptyString(input.targetUid, "targetUid");
  const mode: ResetMode = input.mode ?? "routine";
  if (mode !== "routine" && mode !== "suspectedCompromise") {
    throw new InvalidInputError("mode must be 'routine' or 'suspectedCompromise'");
  }

  // Authorization (records a denied audit on failure).
  try {
    await assertActorIsAdmin(input.actorUid);
  } catch (err) {
    await auditDenied(input.actorUid, input.targetUid, "initiateAdminPasswordReset", `Admin password reset denied: actor not authorized (mode ${mode}).`);
    throw err;
  }

  // Protected account: no self-reset through the admin tool (use self-service).
  if (input.actorUid === input.targetUid) {
    await auditDenied(input.actorUid, input.targetUid, "initiateAdminPasswordReset", "Admin password reset denied: self-reset via admin tool is not permitted.");
    throw new ProtectedAccountError("Use self-service password recovery to reset your own password.");
  }

  // Final-active-admin lockout is structurally prevented for RESET, so no
  // separate guard is needed here: (1) an admin cannot reset their own
  // credential through this tool (the self-reset check above), and (2) reaching
  // this point for an admin target requires the actor to ALSO be an admin (the
  // authorization check) and to be a DIFFERENT principal (the self check) --
  // which means at least one other admin exists after the reset. Reset is also
  // non-destructive (the target keeps their account and sets a new password via
  // the emailed link). Destructive credential ops (disable / role removal /
  // session-only revocation) carry their own final-admin guard in their own
  // rows; they are out of scope for AUTH-PR-3.
  const email = await deps.getRecoverableEmail(input.targetUid);
  if (!email) {
    await auditDenied(input.actorUid, input.targetUid, "initiateAdminPasswordReset", "Admin password reset denied: target has no recoverable email.");
    throw new InvalidInputError("The target account has no recoverable email address.");
  }

  // Durable initiation event (BEFORE any side effect).
  await recordStandaloneAuditEvent({
    actorUid: input.actorUid,
    action: "initiateAdminPasswordReset",
    targetType: TARGET_TYPE,
    targetId: input.targetUid,
    outcome: "applied",
    summary: `Admin password reset initiated (mode ${mode}).`,
    scope: GLOBAL_SCOPE,
  });

  const recordDelivery = async (delivered: boolean): Promise<void> => {
    await recordStandaloneAuditEvent({
      actorUid: input.actorUid,
      action: "deliverAdminPasswordReset",
      targetType: TARGET_TYPE,
      targetId: input.targetUid,
      outcome: delivered ? "applied" : "denied",
      summary: delivered ? "Reset link delivered to the registered email." : "Reset link not delivered (no provider configured or delivery not confirmed).",
      scope: GLOBAL_SCOPE,
    });
  };
  const recordRevocation = async (revoked: boolean, note: string): Promise<void> => {
    await recordStandaloneAuditEvent({
      actorUid: input.actorUid,
      action: "revokeUserSessions",
      targetType: TARGET_TYPE,
      targetId: input.targetUid,
      outcome: revoked ? "applied" : "denied",
      summary: note,
      scope: GLOBAL_SCOPE,
    });
  };

  if (mode === "suspectedCompromise") {
    // Immediate revocation (accepted lockout) + recovery link.
    await deps.revokeRefreshTokens(input.targetUid);
    await recordRevocation(true, "Sessions revoked immediately (suspected compromise).");
    const link = await deps.generateResetLink(email);
    const { delivered } = await deps.delivery.deliverResetLink({ targetUid: input.targetUid, link });
    await recordDelivery(delivered);
    return { status: "sessions_revoked", deliveryOutcome: delivered ? "delivered" : "not_delivered", sessionRevocationOutcome: "revoked" };
  }

  // Routine: generate -> deliver -> revoke ONLY after confirmed delivery.
  const link = await deps.generateResetLink(email);
  const { delivered } = await deps.delivery.deliverResetLink({ targetUid: input.targetUid, link });
  await recordDelivery(delivered);
  if (delivered) {
    await deps.revokeRefreshTokens(input.targetUid);
    await recordRevocation(true, "Sessions revoked after confirmed delivery.");
    return { status: "reset_initiated", deliveryOutcome: "delivered", sessionRevocationOutcome: "revoked" };
  }
  await recordRevocation(false, "Session revocation skipped: reset delivery was not confirmed.");
  return { status: "reset_initiated", deliveryOutcome: "not_delivered", sessionRevocationOutcome: "skipped" };
}

export interface ResetEligibleUser {
  uid: string;
  displayName: string | null;
  role: string | null;
  hasEmployeeLink: boolean;
}

export interface ListResetEligibleUsersInput {
  actorUid: string;
  limit?: number;
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIST_LIMIT;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
    throw new InvalidInputError(`limit must be an integer between 1 and ${MAX_LIST_LIMIT}`);
  }
  return limit;
}

// Admin-only sanitized directory for choosing a reset target. Returns ONLY the
// minimal fields needed to identify a user -- never email, claims, tokens,
// permission graphs, or the full user document.
export async function listResetEligibleUsers(input: ListResetEligibleUsersInput): Promise<ResetEligibleUser[]> {
  assertNonEmptyString(input.actorUid, "actorUid");
  await assertActorIsAdmin(input.actorUid);
  const limit = clampLimit(input.limit);
  const snap = await getFirestore().collection(USERS_COLLECTION).limit(limit).get();
  return snap.docs.map((doc) => {
    const data = doc.data() as { displayName?: unknown; role?: unknown; employeeId?: unknown };
    return {
      uid: doc.id,
      displayName: typeof data.displayName === "string" ? data.displayName : null,
      role: typeof data.role === "string" ? data.role : null,
      hasEmployeeLink: typeof data.employeeId === "string" && data.employeeId.length > 0,
    };
  });
}
