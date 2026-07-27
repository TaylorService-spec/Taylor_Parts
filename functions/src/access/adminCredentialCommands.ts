// AUTH-PR-3 (Authentication Modernization) -- admin-initiated password reset.
// Trusted command module (Admin SDK; bypasses Firestore Rules) that lets a
// governed ADMIN initiate a secure password reset for ANOTHER user. Extends the
// Issue #226 enterprise-access lane: reuses the existing immutable Audit Event
// writer (auditEventWriter.ts); never re-implements a second audit/authz system.
//
// SECURITY MODEL (docs/assessments/auth-modernization-architecture.md §6 +
// Codex round-2 corrections):
//  - Authorization = the SINGLE governed admin authority. Until the Issue #226
//    permission engine is the LIVE authority (ADR-005 §1), assertActorIsAdmin()
//    is a server-side Admin-SDK read of users/{actorUid}.role === "admin",
//    encapsulated for a later resolveEffectivePermission() swap. Dispatcher/
//    operational never qualify. actorUid comes from the callable's authenticated
//    server context only.
//  - No admin-visible temp password: the user sets their own via a reset link
//    the admin never sees. The link/token/email are NEVER returned to a caller
//    and NEVER written to an audit event.
//  - FAIL CLOSED on delivery capability: if delivery is not configured, NO Auth
//    side effect (no link generation, no revocation) occurs, in EITHER mode --
//    so suspected-compromise can never revoke into an unrecoverable state.
//  - Delivery is an injected seam that receives the server-resolved recovery
//    email so a real provider can send without a second identity lookup; the
//    impl must not return/log/audit the email/link/token.
//  - Routine = delivery-CONFIRMED revocation; suspectedCompromise = generate ->
//    revoke -> deliver (immediate revoke with a recovery link). Every attempted
//    stage records a durable applied/denied audit outcome; an audit write is
//    awaited BEFORE the next side effect (fail-closed).
//  - IDEMPOTENCY: a caller-supplied key claims a durable operation record in a
//    transaction; completed replays return the neutral result with no side
//    effects, a fresh pending claim rejects concurrent/duplicate calls, and a
//    recent failure is cooled down.
//  - NEUTRAL caller output: target eligibility and per-message delivery results
//    never change the caller-facing result ({ status: "accepted" }); detailed
//    causes live only in the durable audit trail.
//
// Repository-only: no deployment; tests run only against the emulator.
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { recordStandaloneAuditEvent } from "./auditEventWriter";
import type { AuditAction, AuditOutcome, Scope } from "../types/access";

const USERS_COLLECTION = "users";
const RESET_OPS_COLLECTION = "admin_credential_reset_ops";
const ADMIN_ROLE = "admin";
const GLOBAL_SCOPE: Scope = { type: "global" };
const TARGET_TYPE = "user";
const MAX_LIST_LIMIT = 100;
const DEFAULT_LIST_LIMIT = 50;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,200}$/;
const STALE_PENDING_MS = 5 * 60 * 1000; // a pending op older than this may be retaken (crash recovery)
const RETRY_COOLDOWN_MS = 30 * 1000; // a failed op may be retried only after this

export class UnauthorizedActorError extends Error {}
export class InvalidInputError extends Error {}
export class ProtectedAccountError extends Error {}
export class DeliveryUnavailableError extends Error {}
export class OperationInProgressError extends Error {}
export class RetryCooldownError extends Error {}
// A generic failure of an internal stage (generation / delivery / revocation).
// The specific cause is recorded in the audit trail, NOT surfaced to the caller.
export class AdminResetStageError extends Error {}

export type ResetMode = "routine" | "suspectedCompromise";

// Injected delivery seam. Receives the server-resolved recovery email so a real
// transactional provider can send without a second identity lookup. An impl
// MUST NOT return the email/link/token to its caller, and MUST NOT log/audit
// them. isConfigured() reports delivery CAPABILITY (not per-message success).
export interface ResetDelivery {
  isConfigured(): boolean;
  deliverResetLink(args: { targetUid: string; email: string; link: string }): Promise<{ delivered: boolean }>;
}

// The deployed default: intentionally NOT configured. Because the command fails
// closed on an unconfigured delivery, the deployed callable performs NO Auth
// side effect at all until an Owner-approved provider (D-EMAIL-DELIVERY) is
// wired here.
export const NOT_CONFIGURED_DELIVERY: ResetDelivery = {
  isConfigured() {
    return false;
  },
  async deliverResetLink() {
    return { delivered: false };
  },
};

export interface AdminResetDeps {
  // Generates a reset link WITHOUT sending an email
  // (getAuth().generatePasswordResetLink). Handed only to `delivery`; NEVER
  // returned to the caller or audited.
  generateResetLink(email: string): Promise<string>;
  revokeRefreshTokens(uid: string): Promise<void>;
  getRecoverableEmail(uid: string): Promise<string | null>;
  delivery: ResetDelivery;
}

export interface InitiateAdminPasswordResetInput {
  actorUid: string;
  targetUid: string;
  idempotencyKey: string;
  mode?: ResetMode;
}

// Neutral caller-facing result -- identical for delivered / not-delivered /
// target-ineligible so the admin cannot enumerate target state.
export interface AdminPasswordResetOutcome {
  status: "accepted";
}
const NEUTRAL_ACCEPTED: AdminPasswordResetOutcome = { status: "accepted" };

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

// Single admin-authority choke point (swap the body for the #226 resolver when
// that engine becomes the live authority).
async function assertActorIsAdmin(actorUid: string): Promise<void> {
  const role = await readUserRole(actorUid);
  if (role !== ADMIN_ROLE) {
    throw new UnauthorizedActorError("actor is not authorized for credential administration");
  }
}

// Durable audit write. Awaited so it fails closed BEFORE the next side effect --
// if the audit cannot be recorded, the operation stops rather than proceeding
// to a side effect that would go unrecorded.
async function audit(
  actorUid: string,
  targetUid: string,
  action: AuditAction,
  outcome: AuditOutcome,
  summary: string,
): Promise<void> {
  await recordStandaloneAuditEvent({
    actorUid,
    action,
    targetType: TARGET_TYPE,
    targetId: targetUid,
    outcome,
    summary,
    scope: GLOBAL_SCOPE,
  });
}

interface ResetOpRecord {
  status?: "pending" | "completed" | "failed";
  attempt?: number;
  createdAtMs?: number;
  updatedAtMs?: number;
}

// Transactionally claim the operation for this idempotency key. Returns
// { replay } for an already-completed op (no side effects), otherwise
// { proceed }. Concurrent/duplicate fresh-pending claims and too-soon retries
// after a failure are rejected. Firestore's transactional read-then-write
// serializes concurrent callers: exactly one creates the pending record; the
// other re-reads it and rejects.
async function claimOperation(
  key: string,
  actorUid: string,
  targetUid: string,
  mode: ResetMode,
): Promise<{ replay: AdminPasswordResetOutcome } | { proceed: true }> {
  const db = getFirestore();
  const ref = db.collection(RESET_OPS_COLLECTION).doc(key);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    let attempt = 0;
    let createdAtMs = now;
    if (snap.exists) {
      const d = (snap.data() ?? {}) as ResetOpRecord;
      attempt = d.attempt ?? 0;
      createdAtMs = d.createdAtMs ?? now;
      if (d.status === "completed") {
        return { replay: NEUTRAL_ACCEPTED };
      }
      if (d.status === "pending" && now - (d.updatedAtMs ?? 0) < STALE_PENDING_MS) {
        throw new OperationInProgressError("A reset for this key is already in progress.");
      }
      if (d.status === "failed" && now - (d.updatedAtMs ?? 0) < RETRY_COOLDOWN_MS) {
        throw new RetryCooldownError("This reset was recently attempted; retry shortly.");
      }
    }
    tx.set(
      ref,
      {
        status: "pending",
        actorUid,
        targetUid,
        mode,
        attempt: attempt + 1,
        createdAtMs,
        updatedAtMs: now,
        at: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { proceed: true };
  });
}

async function markOp(key: string, status: "completed" | "failed"): Promise<void> {
  await getFirestore()
    .collection(RESET_OPS_COLLECTION)
    .doc(key)
    .set({ status, updatedAtMs: Date.now(), at: FieldValue.serverTimestamp() }, { merge: true });
}

// Initiate an admin-driven password reset. Returns ONLY the neutral
// { status: "accepted" } for any processed request; never the link/token/email
// and never a target-eligibility or delivery-outcome reason.
export async function initiateAdminPasswordReset(
  input: InitiateAdminPasswordResetInput,
  deps: AdminResetDeps,
): Promise<AdminPasswordResetOutcome> {
  assertNonEmptyString(input.actorUid, "actorUid");
  assertNonEmptyString(input.targetUid, "targetUid");
  assertNonEmptyString(input.idempotencyKey, "idempotencyKey");
  if (!IDEMPOTENCY_KEY_PATTERN.test(input.idempotencyKey)) {
    throw new InvalidInputError("idempotencyKey must be 8-200 chars of [A-Za-z0-9._:-]");
  }
  const mode: ResetMode = input.mode ?? "routine";
  if (mode !== "routine" && mode !== "suspectedCompromise") {
    throw new InvalidInputError("mode must be 'routine' or 'suspectedCompromise'");
  }
  const { actorUid, targetUid, idempotencyKey: key } = input;

  // Authorization (about the ACTOR -- a distinct permission-denied is fine).
  try {
    await assertActorIsAdmin(actorUid);
  } catch (err) {
    await audit(actorUid, targetUid, "initiateAdminPasswordReset", "denied", `Denied: actor not authorized (mode ${mode}).`);
    throw err;
  }

  // Protected account: no self-reset via the admin tool (actor's own choice --
  // not a target-eligibility leak).
  if (actorUid === targetUid) {
    await audit(actorUid, targetUid, "initiateAdminPasswordReset", "denied", "Denied: self-reset via admin tool is not permitted.");
    throw new ProtectedAccountError("Use self-service password recovery to reset your own password.");
  }

  // FAIL CLOSED before ANY Auth side effect or op claim if delivery capability
  // is unavailable -- prevents suspected-compromise lockout with no recovery.
  if (!deps.delivery.isConfigured()) {
    await audit(actorUid, targetUid, "deliverAdminPasswordReset", "denied", "Denied: delivery capability not configured; no Auth side effect performed.");
    throw new DeliveryUnavailableError("Password reset delivery is not configured.");
  }

  // Idempotency / concurrency claim.
  const claim = await claimOperation(key, actorUid, targetUid, mode);
  if ("replay" in claim) {
    return claim.replay;
  }

  try {
    // Durable initiation event BEFORE any side effect.
    await audit(actorUid, targetUid, "initiateAdminPasswordReset", "applied", `Initiated (mode ${mode}).`);

    const email = await deps.getRecoverableEmail(targetUid);
    if (!email) {
      // Neutral to the caller; the real reason is only in the audit trail.
      await audit(actorUid, targetUid, "deliverAdminPasswordReset", "denied", "Not delivered: target has no recoverable email.");
      await audit(actorUid, targetUid, "revokeUserSessions", "denied", "Skipped: target ineligible.");
      await markOp(key, "completed");
      return NEUTRAL_ACCEPTED;
    }

    // Generate the link first (non-destructive), so a generation failure never
    // leaves a target with revoked sessions.
    let link: string;
    try {
      link = await deps.generateResetLink(email);
    } catch {
      await audit(actorUid, targetUid, "deliverAdminPasswordReset", "denied", "Failed: reset-link generation error.");
      await audit(actorUid, targetUid, "revokeUserSessions", "denied", "Skipped: reset-link generation error.");
      await markOp(key, "failed");
      throw new AdminResetStageError("reset-link generation failed");
    }

    if (mode === "suspectedCompromise") {
      // Delivery capability confirmed above, so immediate revocation is safe
      // under the accepted-compromise model (recovery link follows).
      try {
        await deps.revokeRefreshTokens(targetUid);
      } catch {
        await audit(actorUid, targetUid, "revokeUserSessions", "denied", "Failed: session revocation error (suspected compromise).");
        await markOp(key, "failed");
        throw new AdminResetStageError("session revocation failed");
      }
      await audit(actorUid, targetUid, "revokeUserSessions", "applied", "Revoked immediately (suspected compromise).");
      let delivered = false;
      try {
        ({ delivered } = await deps.delivery.deliverResetLink({ targetUid, email, link }));
      } catch {
        await audit(actorUid, targetUid, "deliverAdminPasswordReset", "denied", "Failed: delivery error (recovery link).");
        await markOp(key, "failed");
        throw new AdminResetStageError("delivery failed");
      }
      await audit(actorUid, targetUid, "deliverAdminPasswordReset", delivered ? "applied" : "denied", delivered ? "Recovery link delivered." : "Not delivered: provider returned no confirmation.");
      await markOp(key, "completed");
      return NEUTRAL_ACCEPTED;
    }

    // Routine: deliver, then revoke ONLY after confirmed delivery.
    let delivered = false;
    try {
      ({ delivered } = await deps.delivery.deliverResetLink({ targetUid, email, link }));
    } catch {
      await audit(actorUid, targetUid, "deliverAdminPasswordReset", "denied", "Failed: delivery error.");
      await audit(actorUid, targetUid, "revokeUserSessions", "denied", "Skipped: delivery error.");
      await markOp(key, "failed");
      throw new AdminResetStageError("delivery failed");
    }
    await audit(actorUid, targetUid, "deliverAdminPasswordReset", delivered ? "applied" : "denied", delivered ? "Reset link delivered." : "Not delivered: provider returned no confirmation.");
    if (delivered) {
      try {
        await deps.revokeRefreshTokens(targetUid);
      } catch {
        await audit(actorUid, targetUid, "revokeUserSessions", "denied", "Failed: session revocation error after delivery.");
        await markOp(key, "failed");
        throw new AdminResetStageError("session revocation failed");
      }
      await audit(actorUid, targetUid, "revokeUserSessions", "applied", "Revoked after confirmed delivery.");
    } else {
      await audit(actorUid, targetUid, "revokeUserSessions", "denied", "Skipped: reset delivery not confirmed.");
    }
    await markOp(key, "completed");
    return NEUTRAL_ACCEPTED;
  } catch (err) {
    // Best-effort: ensure the op is not left pending on an unexpected throw.
    await markOp(key, "failed").catch(() => {});
    throw err;
  }
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
// minimal identity fields -- never email, claims, tokens, permission graphs, or
// the full user document.
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
