// AUTH-PR-3 (Authentication Modernization) -- admin-initiated password reset.
// Trusted command module (Admin SDK; bypasses Firestore Rules) that lets a
// governed ADMIN initiate a secure password reset for ANOTHER user. Extends the
// Issue #226 enterprise-access lane; reuses the existing immutable Audit Event
// writer (auditEventWriter.ts).
//
// SECURITY MODEL (docs/assessments/auth-modernization-architecture.md §6 +
// Codex rounds 2-3):
//  - Authorization = the SINGLE governed admin authority. Until #226's engine is
//    the live authority (ADR-005 §1), assertActorIsAdmin() is a server-side read
//    of users/{actorUid}.role === "admin", encapsulated for a later resolver
//    swap. Dispatcher/operational never qualify. actorUid comes from the
//    callable's authenticated server context only.
//  - No admin-visible temp password; the user sets their own via a reset link
//    the admin never sees. Link/token/email are NEVER returned to a caller and
//    NEVER written to an audit event.
//  - FAIL CLOSED on delivery capability: an unconfigured delivery performs ZERO
//    Auth side effects (no link generation, no revocation) in EITHER mode.
//  - Delivery is an injected seam that receives the server-resolved recovery
//    email AND the governed idempotency key (for provider-side dedup); the impl
//    must not return/log/audit the email/link/token.
//  - Every RUN's terminal path emits all three durable outcomes -- initiation,
//    delivery, revocation -- with each audit awaited before the next side effect.
//  - IDEMPOTENCY + CRASH SAFETY: a caller key claims a durable operation record
//    BOUND to (actorUid, targetUid, mode). A resumable per-stage machine
//    transactionally claims each stage (deliver, revoke) for the current attempt
//    and records durable completion, so a crash/stale-takeover resumes without
//    repeating a completed stage; delivery carries the key for provider dedup and
//    revocation is idempotent.
//  - RECOVERY REQUIRED: in suspected-compromise, if delivery fails AFTER a
//    successful revocation, the op is persisted as `recovery_required` (a durable
//    condition for an authorized operator workflow) -- never silently completed.
//  - NEUTRAL caller output: target eligibility and delivery outcomes never change
//    the caller-facing result ({ status: "accepted" }); causes live only in audit.
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
const STALE_PENDING_MS = 5 * 60 * 1000;
const RETRY_COOLDOWN_MS = 30 * 1000;

const RESET_MODES = ["routine", "suspectedCompromise"] as const;
export type ResetMode = (typeof RESET_MODES)[number];
type OpStatus = "in_progress" | "completed" | "failed" | "recovery_required";
type DeliverStage = "delivered" | "not_delivered";
type RevokeStage = "done" | "skipped";

export class UnauthorizedActorError extends Error {}
export class InvalidInputError extends Error {}
export class ProtectedAccountError extends Error {}
export class DeliveryUnavailableError extends Error {}
export class OperationInProgressError extends Error {}
export class RetryCooldownError extends Error {}
export class OperationKeyConflictError extends Error {}
export class MalformedOperationError extends Error {}
// Generic internal-stage failure -- the specific cause is audited, never surfaced.
export class AdminResetStageError extends Error {}

export interface ResetDelivery {
  isConfigured(): boolean;
  // Receives the server-resolved recovery email AND the governed idempotency key
  // so a real transactional provider can send AND deduplicate. An impl MUST NOT
  // return/log/audit the email/link/token.
  deliverResetLink(args: {
    targetUid: string;
    email: string;
    link: string;
    idempotencyKey: string;
  }): Promise<{ delivered: boolean }>;
}

// Deployed default: intentionally NOT configured -> the command fails closed and
// performs no Auth side effect at all until D-EMAIL-DELIVERY wires a provider.
export const NOT_CONFIGURED_DELIVERY: ResetDelivery = {
  isConfigured() {
    return false;
  },
  async deliverResetLink() {
    return { delivered: false };
  },
};

export interface AdminResetDeps {
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

export interface AdminPasswordResetOutcome {
  status: "accepted";
}
const NEUTRAL_ACCEPTED: AdminPasswordResetOutcome = { status: "accepted" };

interface OpRecord {
  actorUid: string;
  targetUid: string;
  mode: ResetMode;
  status: OpStatus;
  attempt: number;
  stages?: { deliver?: DeliverStage; revoke?: RevokeStage };
  createdAtMs: number;
  updatedAtMs: number;
}

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidInputError(`${field} is required`);
  }
}

function db() {
  return getFirestore();
}
function opRef(key: string) {
  return db().collection(RESET_OPS_COLLECTION).doc(key);
}

async function readUserRole(uid: string): Promise<string | null> {
  const snap = await db().collection(USERS_COLLECTION).doc(uid).get();
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

// Durable audit write. Awaited so it fails closed BEFORE the next side effect.
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

// Emits the delivery + revocation outcome events -- called on EVERY run terminal
// path so all three stage outcomes (with the earlier initiation event) are
// always durably recorded.
async function emitOutcomes(
  actorUid: string,
  targetUid: string,
  deliver: { outcome: AuditOutcome; summary: string },
  revoke: { outcome: AuditOutcome; summary: string },
): Promise<void> {
  await audit(actorUid, targetUid, "deliverAdminPasswordReset", deliver.outcome, deliver.summary);
  await audit(actorUid, targetUid, "revokeUserSessions", revoke.outcome, revoke.summary);
}

function isValidOpRecord(d: unknown): d is OpRecord {
  if (!d || typeof d !== "object") return false;
  const r = d as Record<string, unknown>;
  return (
    typeof r.actorUid === "string" &&
    typeof r.targetUid === "string" &&
    typeof r.mode === "string" &&
    (RESET_MODES as readonly string[]).includes(r.mode) &&
    typeof r.status === "string" &&
    typeof r.attempt === "number"
  );
}

interface ClaimResult {
  action: "replay" | "run";
  attempt: number;
  stages: { deliver?: DeliverStage; revoke?: RevokeStage };
}

// Transactionally claim/resume the operation for this key. Binds the key to the
// exact (actorUid, targetUid, mode) tuple; a differing existing record is a hard
// conflict, a malformed record fails closed, a completed op replays, a fresh
// in-progress/cooldown rejects, and a stale in-progress / past-cooldown failure /
// recovery_required op is RESUMED (attempt incremented, prior stages preserved).
async function claimOrResume(
  key: string,
  actorUid: string,
  targetUid: string,
  mode: ResetMode,
): Promise<ClaimResult> {
  const ref = opRef(key);
  return db().runTransaction<ClaimResult>(async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    if (snap.exists) {
      const raw = snap.data();
      if (!isValidOpRecord(raw)) {
        throw new MalformedOperationError("existing operation record is malformed");
      }
      const d = raw;
      if (d.actorUid !== actorUid || d.targetUid !== targetUid || d.mode !== mode) {
        throw new OperationKeyConflictError("idempotency key is bound to a different request");
      }
      const stages = d.stages ?? {};
      if (d.status === "completed") {
        return { action: "replay", attempt: d.attempt, stages };
      }
      if (d.status === "in_progress" && now - d.updatedAtMs < STALE_PENDING_MS) {
        throw new OperationInProgressError("a reset for this key is already in progress");
      }
      if (d.status === "failed" && now - d.updatedAtMs < RETRY_COOLDOWN_MS) {
        throw new RetryCooldownError("this reset was recently attempted; retry shortly");
      }
      // Stale in-progress, past-cooldown failure, or recovery_required -> resume.
      const attempt = d.attempt + 1;
      tx.update(ref, { status: "in_progress", attempt, updatedAtMs: now });
      return { action: "run", attempt, stages };
    }
    tx.set(ref, {
      actorUid,
      targetUid,
      mode,
      status: "in_progress",
      attempt: 1,
      stages: {},
      createdAtMs: now,
      updatedAtMs: now,
      at: FieldValue.serverTimestamp(),
    });
    return { action: "run", attempt: 1, stages: {} };
  });
}

// Transactionally claim a stage for `attempt`, ONLY if not already recorded done
// and this attempt still owns the op. Prevents a stale-takeover runner and the
// original runner from both performing the same stage.
async function claimStage(
  key: string,
  stage: "deliver" | "revoke",
  attempt: number,
): Promise<"already_done" | "claimed" | "superseded"> {
  const ref = opRef(key);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return "superseded";
    const d = snap.data() as OpRecord;
    if (d.attempt !== attempt) return "superseded";
    if (d.stages && d.stages[stage] !== undefined) return "already_done";
    tx.update(ref, { updatedAtMs: Date.now() });
    return "claimed";
  });
}

async function recordStage(key: string, stage: "deliver" | "revoke", value: string): Promise<void> {
  await opRef(key).update({ [`stages.${stage}`]: value, updatedAtMs: Date.now() });
}
async function setStatus(key: string, status: OpStatus): Promise<void> {
  await opRef(key).set({ status, updatedAtMs: Date.now(), at: FieldValue.serverTimestamp() }, { merge: true });
}

// Initiate an admin-driven password reset. Returns ONLY the neutral
// { status: "accepted" } for any processed request; never the link/token/email
// and never a target-eligibility / delivery-outcome reason.
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
  if (!(RESET_MODES as readonly string[]).includes(mode)) {
    throw new InvalidInputError("mode must be 'routine' or 'suspectedCompromise'");
  }
  const { actorUid, targetUid, idempotencyKey: key } = input;

  try {
    await assertActorIsAdmin(actorUid);
  } catch (err) {
    await audit(actorUid, targetUid, "initiateAdminPasswordReset", "denied", `Denied: actor not authorized (mode ${mode}).`);
    throw err;
  }
  if (actorUid === targetUid) {
    await audit(actorUid, targetUid, "initiateAdminPasswordReset", "denied", "Denied: self-reset via admin tool is not permitted.");
    throw new ProtectedAccountError("Use self-service password recovery to reset your own password.");
  }
  if (!deps.delivery.isConfigured()) {
    await audit(actorUid, targetUid, "deliverAdminPasswordReset", "denied", "Denied: delivery capability not configured; no Auth side effect performed.");
    throw new DeliveryUnavailableError("Password reset delivery is not configured.");
  }

  const claim = await claimOrResume(key, actorUid, targetUid, mode);
  if (claim.action === "replay") {
    return NEUTRAL_ACCEPTED;
  }
  const { attempt, stages } = claim;

  try {
    await audit(actorUid, targetUid, "initiateAdminPasswordReset", "applied", `Initiated (mode ${mode}, attempt ${attempt}).`);

    let email: string | null;
    try {
      email = await deps.getRecoverableEmail(targetUid);
    } catch {
      await emitOutcomes(actorUid, targetUid, { outcome: "denied", summary: "Failed: identity lookup error." }, { outcome: "denied", summary: "Skipped: identity lookup error." });
      await setStatus(key, "failed");
      throw new AdminResetStageError("identity lookup failed");
    }
    if (!email) {
      await emitOutcomes(actorUid, targetUid, { outcome: "denied", summary: "Not delivered: target has no recoverable email." }, { outcome: "denied", summary: "Skipped: target ineligible." });
      await setStatus(key, "completed");
      return NEUTRAL_ACCEPTED;
    }

    // Performs generate+deliver for the deliver stage (idempotent on resume via
    // the persisted stage + provider dedup key). Returns the deliver outcome.
    const runDeliver = async (): Promise<DeliverStage> => {
      if (stages.deliver !== undefined) return stages.deliver;
      const claimed = await claimStage(key, "deliver", attempt);
      if (claimed === "superseded") throw new AdminResetStageError("superseded by a newer attempt");
      if (claimed === "already_done") {
        const snap = await opRef(key).get();
        return (snap.data() as OpRecord).stages?.deliver ?? "not_delivered";
      }
      const link = await deps.generateResetLink(email as string);
      const { delivered } = await deps.delivery.deliverResetLink({ targetUid, email: email as string, link, idempotencyKey: key });
      const value: DeliverStage = delivered ? "delivered" : "not_delivered";
      await recordStage(key, "deliver", value);
      return value;
    };
    const runRevoke = async (): Promise<void> => {
      if (stages.revoke === "done") return;
      const claimed = await claimStage(key, "revoke", attempt);
      if (claimed === "superseded") throw new AdminResetStageError("superseded by a newer attempt");
      if (claimed === "already_done") return;
      await deps.revokeRefreshTokens(targetUid);
      await recordStage(key, "revoke", "done");
    };

    if (mode === "suspectedCompromise") {
      // Revoke first. A revocation failure is terminal-failed with delivery
      // audited as skipped (all three outcomes present).
      try {
        await runRevoke();
      } catch {
        await emitOutcomes(actorUid, targetUid, { outcome: "denied", summary: "Skipped: session revocation failed (suspected compromise)." }, { outcome: "denied", summary: "Failed: session revocation error (suspected compromise)." });
        await setStatus(key, "failed");
        throw new AdminResetStageError("session revocation failed");
      }
      // Revocation succeeded -> from here, any delivery failure is RECOVERY
      // REQUIRED (never a silent success, never terminal-failed-and-forgotten):
      // the account is locked out and needs an operator-resolvable recovery.
      let deliverResult: DeliverStage;
      try {
        deliverResult = await runDeliver();
      } catch {
        await emitOutcomes(actorUid, targetUid, { outcome: "denied", summary: "Failed: recovery-link delivery error after revocation -- RECOVERY REQUIRED." }, { outcome: "applied", summary: "Revoked immediately (suspected compromise)." });
        await setStatus(key, "recovery_required");
        return NEUTRAL_ACCEPTED;
      }
      if (deliverResult === "delivered") {
        await emitOutcomes(actorUid, targetUid, { outcome: "applied", summary: "Recovery link delivered." }, { outcome: "applied", summary: "Revoked immediately (suspected compromise)." });
        await setStatus(key, "completed");
        return NEUTRAL_ACCEPTED;
      }
      await emitOutcomes(actorUid, targetUid, { outcome: "denied", summary: "Not delivered after revocation (provider returned no confirmation) -- RECOVERY REQUIRED." }, { outcome: "applied", summary: "Revoked immediately (suspected compromise)." });
      await setStatus(key, "recovery_required");
      return NEUTRAL_ACCEPTED;
    }

    // Routine: deliver first; a generation/delivery failure is terminal-failed
    // with NO revocation performed. Revoke only after confirmed delivery.
    let deliverResult: DeliverStage;
    try {
      deliverResult = await runDeliver();
    } catch {
      await emitOutcomes(actorUid, targetUid, { outcome: "denied", summary: "Failed: reset-link generation or delivery error." }, { outcome: "denied", summary: "Skipped: reset delivery not completed." });
      await setStatus(key, "failed");
      throw new AdminResetStageError("delivery failed");
    }
    if (deliverResult !== "delivered") {
      await recordStage(key, "revoke", "skipped");
      await emitOutcomes(actorUid, targetUid, { outcome: "denied", summary: "Not delivered: provider returned no confirmation." }, { outcome: "denied", summary: "Skipped: reset delivery not confirmed." });
      await setStatus(key, "completed");
      return NEUTRAL_ACCEPTED;
    }
    try {
      await runRevoke();
    } catch {
      await emitOutcomes(actorUid, targetUid, { outcome: "applied", summary: "Reset link delivered." }, { outcome: "denied", summary: "Failed: session revocation error after delivery." });
      await setStatus(key, "failed");
      throw new AdminResetStageError("session revocation failed");
    }
    await emitOutcomes(actorUid, targetUid, { outcome: "applied", summary: "Reset link delivered." }, { outcome: "applied", summary: "Revoked after confirmed delivery." });
    await setStatus(key, "completed");
    return NEUTRAL_ACCEPTED;
  } catch (err) {
    if (!(err instanceof AdminResetStageError)) {
      // Unexpected throw (not one of our audited terminal paths): mark failed.
      await setStatus(key, "failed").catch(() => {});
    }
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

// Admin-only sanitized directory. Returns ONLY minimal identity fields -- never
// email, claims, tokens, permission graphs, or the full user document.
export async function listResetEligibleUsers(input: ListResetEligibleUsersInput): Promise<ResetEligibleUser[]> {
  assertNonEmptyString(input.actorUid, "actorUid");
  await assertActorIsAdmin(input.actorUid);
  const limit = clampLimit(input.limit);
  const snap = await db().collection(USERS_COLLECTION).limit(limit).get();
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
