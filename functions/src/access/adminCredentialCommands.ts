// AUTH-PR-3 (Authentication Modernization) -- admin-initiated password reset.
// Trusted command module (Admin SDK; bypasses Firestore Rules) that lets a
// governed ADMIN initiate a secure password reset for ANOTHER user. Extends the
// Issue #226 enterprise-access lane; reuses the immutable Audit Event writer.
//
// SECURITY MODEL (docs/assessments/auth-modernization-architecture.md §6 +
// Codex rounds 2-4):
//  - Authorization = the SINGLE governed admin authority (server-side
//    users/{actorUid}.role === "admin", encapsulated for a later #226 resolver
//    swap; dispatcher/operational never qualify). actorUid comes from the
//    callable's authenticated server context only.
//  - No admin-visible temp password; the user sets their own via a reset link
//    the admin never sees. Link/token/email are NEVER returned or audited.
//  - FAIL CLOSED on delivery capability: an unconfigured delivery performs ZERO
//    Auth side effects in EITHER mode.
//  - Delivery seam receives the server-resolved recovery email AND the governed
//    idempotency key (for provider-side dedup).
//  - Every RUN terminal path emits all three durable outcomes (initiation,
//    delivery, revocation), each audit awaited before the next side effect.
//  - IDEMPOTENCY + CRASH SAFETY: a caller key claims a durable op record BOUND
//    to (actorUid, targetUid, mode) with a STRICTLY validated schema. A
//    resumable stage machine records only SUCCESSFUL stages (deliver="delivered",
//    revoke="done"); an unsuccessful delivery is left unrecorded so a later
//    attempt RETRIES it without repeating a completed revocation. Every stage
//    completion and terminal status write is ATTEMPT-BOUND (lease): a stale
//    worker cannot record a stage or set terminal status after takeover.
//  - RECOVERY: suspected-compromise delivery failure after a successful revoke
//    persists `recovery_required` (retryable; re-delivers without re-revoking),
//    never silently completed. NEUTRAL caller output throughout.
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
const OP_STATUSES = ["in_progress", "completed", "failed", "recovery_required"] as const;
type OpStatus = (typeof OP_STATUSES)[number];
type DeliverRuntime = "delivered" | "not_delivered";
// Only SUCCESSFUL stages are persisted -- an unsuccessful delivery is left
// unrecorded so it can be retried; a persisted stage is therefore terminal-done.
interface OpStages { deliver?: "delivered"; revoke?: "done" }

export class UnauthorizedActorError extends Error {}
export class InvalidInputError extends Error {}
export class ProtectedAccountError extends Error {}
export class DeliveryUnavailableError extends Error {}
export class OperationInProgressError extends Error {}
export class RetryCooldownError extends Error {}
export class OperationKeyConflictError extends Error {}
export class MalformedOperationError extends Error {}
export class AdminResetStageError extends Error {}
// Raised when a lease-bound write is refused because a newer attempt owns the op.
export class LeaseLostError extends AdminResetStageError {}

// SAFETY CONTRACT (Codex round 5) -- delivery is internally AT-LEAST-ONCE:
// after a >5min stale takeover, a worker that had already claimed the deliver
// stage may still generate an extra reset link and call deliverResetLink() a
// second time before its lease-bound state write is refused. Exactly-once
// USER-VISIBLE delivery therefore depends on MANDATORY provider-side
// deduplication keyed on `idempotencyKey`:
//  - `deliverResetLink` MUST be idempotent on `idempotencyKey` -- a repeat call
//    with the same key MUST NOT send a second message (return the prior result).
//  - `isConfigured()` returning true is the provider's ATTESTATION that it both
//    can send AND deduplicates on `idempotencyKey`. Wiring any real provider is
//    a production-gate condition: it may return true only once idempotency-key
//    dedup is verified (D-EMAIL-DELIVERY). The command fails closed when
//    isConfigured() is false, so no un-attested provider ever sends.
// A stale worker that resumes after takeover may generate an EXTRA reset link
// (delivery is internally at-least-once). Handling of that extra link:
//  - It is a distinct OOB code. The Auth-emulator observation
//    (functions/test/adminCredentialResetLinkValidity.test.mjs; evidence:
//    docs/audits/auth-pr-3-oob-validity/) shows the earlier code is NOT REMOVED
//    from the emulator's outstanding oobCodes list by a later generation (list
//    persistence). This is NOT proof of end-to-end consumability, and is
//    emulator behavior, not a real-Firebase guarantee.
//  - Whether an earlier already-delivered link REMAINS CONSUMABLE after a later
//    generation is therefore a PRODUCTION-ENABLEMENT condition to verify against
//    real Firebase Auth (see the evidence doc). If it does not hold, link
//    generation must move INSIDE the idempotent provider boundary (one key ->
//    one effective link + send).
//  - DELIVERY (the message) is protected by provider send-dedup on
//    idempotencyKey; STATE by attempt-bound writes; session revocation is
//    idempotent (a repeat is a no-op).
export interface ResetDelivery {
  isConfigured(): boolean;
  deliverResetLink(args: {
    targetUid: string;
    email: string;
    link: string;
    idempotencyKey: string;
  }): Promise<{ delivered: boolean }>;
}

export const NOT_CONFIGURED_DELIVERY: ResetDelivery = {
  isConfigured() {
    return false;
  },
  async deliverResetLink() {
    return { delivered: false };
  },
};

export interface AdminResetDeps {
  // Generating a link is non-destructive (no message is sent by generation). A
  // stale worker may regenerate an EXTRA link after takeover; whether that
  // affects the earlier already-delivered link is a production-enablement
  // verification against real Firebase Auth (see adminCredentialResetLinkValidity
  // + docs/audits/auth-pr-3-oob-validity/), not assumed here.
  generateResetLink(email: string): Promise<string>;
  // MUST be idempotent: revoking already-revoked refresh tokens is a safe no-op
  // (Firebase's revocation is a timestamp bump). The safety contract relies on
  // this so a stale-worker or resume repeat of revocation cannot cause harm.
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
  stages?: OpStages;
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
async function assertActorIsAdmin(actorUid: string): Promise<void> {
  const role = await readUserRole(actorUid);
  if (role !== ADMIN_ROLE) {
    throw new UnauthorizedActorError("actor is not authorized for credential administration");
  }
}

async function audit(actorUid: string, targetUid: string, action: AuditAction, outcome: AuditOutcome, summary: string): Promise<void> {
  await recordStandaloneAuditEvent({ actorUid, action, targetType: TARGET_TYPE, targetId: targetUid, outcome, summary, scope: GLOBAL_SCOPE });
}
async function emitOutcomes(actorUid: string, targetUid: string, deliver: { outcome: AuditOutcome; summary: string }, revoke: { outcome: AuditOutcome; summary: string }): Promise<void> {
  await audit(actorUid, targetUid, "deliverAdminPasswordReset", deliver.outcome, deliver.summary);
  await audit(actorUid, targetUid, "revokeUserSessions", revoke.outcome, revoke.summary);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

// STRICT operation-record schema validation. Any missing/malformed field --
// including the freshness fields used by concurrency/cooldown -- fails closed
// (a malformed record can never bypass the in-progress/cooldown checks).
function isValidOpRecord(d: unknown): d is OpRecord {
  if (!d || typeof d !== "object" || Array.isArray(d)) return false;
  const r = d as Record<string, unknown>;
  if (typeof r.actorUid !== "string" || r.actorUid.length === 0) return false;
  if (typeof r.targetUid !== "string" || r.targetUid.length === 0) return false;
  if (typeof r.mode !== "string" || !(RESET_MODES as readonly string[]).includes(r.mode)) return false;
  if (typeof r.status !== "string" || !(OP_STATUSES as readonly string[]).includes(r.status)) return false;
  if (!Number.isInteger(r.attempt) || (r.attempt as number) < 1) return false;
  if (!isFiniteNumber(r.createdAtMs) || !isFiniteNumber(r.updatedAtMs)) return false;
  if (r.stages !== undefined) {
    if (typeof r.stages !== "object" || r.stages === null || Array.isArray(r.stages)) return false;
    const st = r.stages as Record<string, unknown>;
    if (st.deliver !== undefined && st.deliver !== "delivered") return false;
    if (st.revoke !== undefined && st.revoke !== "done") return false;
    for (const k of Object.keys(st)) if (k !== "deliver" && k !== "revoke") return false;
  }
  return true;
}

interface ClaimResult {
  action: "replay" | "run";
  attempt: number;
  stages: OpStages;
}

// Transactionally claim/resume the operation, bound to (actorUid,targetUid,mode).
async function claimOrResume(key: string, actorUid: string, targetUid: string, mode: ResetMode): Promise<ClaimResult> {
  const ref = opRef(key);
  return db().runTransaction<ClaimResult>(async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    if (snap.exists) {
      const raw = snap.data();
      if (!isValidOpRecord(raw)) throw new MalformedOperationError("existing operation record is malformed");
      const d = raw;
      if (d.actorUid !== actorUid || d.targetUid !== targetUid || d.mode !== mode) {
        throw new OperationKeyConflictError("idempotency key is bound to a different request");
      }
      const stages = d.stages ?? {};
      if (d.status === "completed") return { action: "replay", attempt: d.attempt, stages };
      if (d.status === "in_progress" && now - d.updatedAtMs < STALE_PENDING_MS) {
        throw new OperationInProgressError("a reset for this key is already in progress");
      }
      if (d.status === "failed" && now - d.updatedAtMs < RETRY_COOLDOWN_MS) {
        throw new RetryCooldownError("this reset was recently attempted; retry shortly");
      }
      // Stale in_progress, past-cooldown failed, or recovery_required -> resume.
      const attempt = d.attempt + 1;
      tx.update(ref, { status: "in_progress", attempt, updatedAtMs: now });
      return { action: "run", attempt, stages };
    }
    tx.set(ref, {
      actorUid, targetUid, mode, status: "in_progress", attempt: 1, stages: {},
      createdAtMs: now, updatedAtMs: now, at: FieldValue.serverTimestamp(),
    });
    return { action: "run", attempt: 1, stages: {} };
  });
}

// -- Attempt-bound (lease) operations. Exported for controlled lease tests. ---

// Claim a stage for `attempt` ONLY if not already recorded done and this attempt
// still owns the op. A stale worker (attempt mismatch) gets "superseded" and
// must NOT perform the side effect.
export async function claimStage(key: string, stage: "deliver" | "revoke", attempt: number): Promise<"already_done" | "claimed" | "superseded"> {
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(opRef(key));
    if (!snap.exists) return "superseded";
    const raw = snap.data();
    if (!isValidOpRecord(raw)) return "superseded";
    if (raw.attempt !== attempt) return "superseded";
    if (raw.stages && raw.stages[stage] !== undefined) return "already_done";
    tx.update(opRef(key), { updatedAtMs: Date.now() }); // lease heartbeat
    return "claimed";
  });
}

// Record a stage completion ONLY if this attempt still owns the op. Returns
// false (refused) for a stale worker -- its write can never overwrite state.
export async function recordStageOwned(key: string, stage: "deliver" | "revoke", value: "delivered" | "done", attempt: number): Promise<boolean> {
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(opRef(key));
    if (!snap.exists) return false;
    const raw = snap.data();
    if (!isValidOpRecord(raw) || raw.attempt !== attempt) return false;
    tx.update(opRef(key), { [`stages.${stage}`]: value, updatedAtMs: Date.now() });
    return true;
  });
}

// Set terminal status ONLY if this attempt still owns the op.
export async function setStatusOwned(key: string, status: OpStatus, attempt: number): Promise<boolean> {
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(opRef(key));
    if (!snap.exists) return false;
    const raw = snap.data();
    if (!isValidOpRecord(raw) || raw.attempt !== attempt) return false;
    tx.update(opRef(key), { status, updatedAtMs: Date.now() });
    return true;
  });
}

export async function initiateAdminPasswordReset(input: InitiateAdminPasswordResetInput, deps: AdminResetDeps): Promise<AdminPasswordResetOutcome> {
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
  if (claim.action === "replay") return NEUTRAL_ACCEPTED;
  const { attempt, stages } = claim;

  // Lease-bound writers that bail if a newer attempt has taken over.
  const recordStage = async (stage: "deliver" | "revoke", value: "delivered" | "done") => {
    if (!(await recordStageOwned(key, stage, value, attempt))) throw new LeaseLostError("superseded by a newer attempt");
  };
  const setStatus = async (status: OpStatus) => {
    if (!(await setStatusOwned(key, status, attempt))) throw new LeaseLostError("superseded by a newer attempt");
  };

  try {
    await audit(actorUid, targetUid, "initiateAdminPasswordReset", "applied", `Initiated (mode ${mode}, attempt ${attempt}).`);

    let email: string | null;
    try {
      email = await deps.getRecoverableEmail(targetUid);
    } catch {
      await emitOutcomes(actorUid, targetUid, { outcome: "denied", summary: "Failed: identity lookup error." }, { outcome: "denied", summary: "Skipped: identity lookup error." });
      await setStatus("failed");
      throw new AdminResetStageError("identity lookup failed");
    }
    if (!email) {
      await emitOutcomes(actorUid, targetUid, { outcome: "denied", summary: "Not delivered: target has no recoverable email." }, { outcome: "denied", summary: "Skipped: target ineligible." });
      await setStatus("completed");
      return NEUTRAL_ACCEPTED;
    }

    // Deliver stage: generate + deliver; persists ONLY on success (so a failure
    // is retryable on a later attempt).
    const runDeliver = async (): Promise<DeliverRuntime> => {
      if (stages.deliver === "delivered") return "delivered";
      const claimed = await claimStage(key, "deliver", attempt);
      if (claimed === "superseded") throw new LeaseLostError("superseded by a newer attempt");
      if (claimed === "already_done") return "delivered";
      const link = await deps.generateResetLink(email as string);
      const { delivered } = await deps.delivery.deliverResetLink({ targetUid, email: email as string, link, idempotencyKey: key });
      if (delivered) await recordStage("deliver", "delivered");
      return delivered ? "delivered" : "not_delivered";
    };
    // Revoke stage: idempotent; persists "done" on success only.
    const runRevoke = async (): Promise<void> => {
      if (stages.revoke === "done") return;
      const claimed = await claimStage(key, "revoke", attempt);
      if (claimed === "superseded") throw new LeaseLostError("superseded by a newer attempt");
      if (claimed === "already_done") return;
      await deps.revokeRefreshTokens(targetUid);
      await recordStage("revoke", "done");
    };

    if (mode === "suspectedCompromise") {
      try {
        await runRevoke();
      } catch (e) {
        if (e instanceof LeaseLostError) throw e;
        await emitOutcomes(actorUid, targetUid, { outcome: "denied", summary: "Skipped: session revocation failed (suspected compromise)." }, { outcome: "denied", summary: "Failed: session revocation error (suspected compromise)." });
        await setStatus("failed");
        throw new AdminResetStageError("session revocation failed");
      }
      // Revocation done -> any delivery failure is RECOVERY REQUIRED (retryable;
      // a later attempt re-delivers without re-revoking).
      let deliverResult: DeliverRuntime;
      try {
        deliverResult = await runDeliver();
      } catch (e) {
        if (e instanceof LeaseLostError) throw e;
        await emitOutcomes(actorUid, targetUid, { outcome: "denied", summary: "Failed: recovery-link delivery error after revocation -- RECOVERY REQUIRED." }, { outcome: "applied", summary: "Revoked immediately (suspected compromise)." });
        await setStatus("recovery_required");
        return NEUTRAL_ACCEPTED;
      }
      if (deliverResult === "delivered") {
        await emitOutcomes(actorUid, targetUid, { outcome: "applied", summary: "Recovery link delivered." }, { outcome: "applied", summary: "Revoked immediately (suspected compromise)." });
        await setStatus("completed");
        return NEUTRAL_ACCEPTED;
      }
      await emitOutcomes(actorUid, targetUid, { outcome: "denied", summary: "Not delivered after revocation -- RECOVERY REQUIRED." }, { outcome: "applied", summary: "Revoked immediately (suspected compromise)." });
      await setStatus("recovery_required");
      return NEUTRAL_ACCEPTED;
    }

    // Routine: deliver first; revoke ONLY after confirmed delivery.
    let deliverResult: DeliverRuntime;
    try {
      deliverResult = await runDeliver();
    } catch (e) {
      if (e instanceof LeaseLostError) throw e;
      await emitOutcomes(actorUid, targetUid, { outcome: "denied", summary: "Failed: reset-link generation or delivery error." }, { outcome: "denied", summary: "Skipped: reset delivery not completed." });
      await setStatus("failed");
      throw new AdminResetStageError("delivery failed");
    }
    if (deliverResult !== "delivered") {
      // Not delivered: no revocation; retryable (status failed).
      await emitOutcomes(actorUid, targetUid, { outcome: "denied", summary: "Not delivered: provider returned no confirmation." }, { outcome: "denied", summary: "Skipped: reset delivery not confirmed." });
      await setStatus("failed");
      return NEUTRAL_ACCEPTED;
    }
    try {
      await runRevoke();
    } catch (e) {
      if (e instanceof LeaseLostError) throw e;
      await emitOutcomes(actorUid, targetUid, { outcome: "applied", summary: "Reset link delivered." }, { outcome: "denied", summary: "Failed: session revocation error after delivery." });
      await setStatus("failed");
      throw new AdminResetStageError("session revocation failed");
    }
    await emitOutcomes(actorUid, targetUid, { outcome: "applied", summary: "Reset link delivered." }, { outcome: "applied", summary: "Revoked after confirmed delivery." });
    await setStatus("completed");
    return NEUTRAL_ACCEPTED;
  } catch (err) {
    // A lost-lease bail must NOT overwrite the winner's state.
    if (!(err instanceof LeaseLostError) && !(err instanceof AdminResetStageError)) {
      await setStatusOwned(key, "failed", attempt).catch(() => {});
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
