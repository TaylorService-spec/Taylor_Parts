// AUTH-PR-3.5 (Authentication Modernization) -- admin-initiated password reset,
// corrected per the Owner + ChatGPT decisions in docs/DECISIONS.md #56.
//
// Trusted command module (Admin SDK; bypasses Firestore Rules) that lets a
// governed ADMIN initiate a ROUTINE password reset for ANOTHER eligible user.
// Extends the Issue #226 enterprise-access lane; reuses the immutable Audit
// Event writer. Repository/emulator-only: no deployment; NOT wired to the real
// production project.
//
// WHAT CHANGED FROM AUTH-PR-3 (#56):
//  - D-DELIVERY-NATIVE: delivery is a FIREBASE-NATIVE server send whose only
//    truthful signal is REQUEST_ACCEPTED. There is NO reset-link generation
//    here and NO "delivered" claim -- the seam reports `accepted` (Firebase
//    accepted the send request), never delivery/opening/consumption. No
//    external transactional email provider (indefinitely deferred, #54).
//  - D-ROUTINE-REVOKE = NO: routine reset performs NO session/refresh-token
//    revocation. There is no revoke stage and no `revokeRefreshTokens` dep.
//    Immediate revocation (suspected-compromise) is a SEPARATE governed action
//    with its own permission/confirmation/audit -- deliberately NOT in this
//    command. `mode` must be "routine"; "suspectedCompromise" is rejected.
//  - GUARD GAP CLOSED: the command now enforces (via a PURE, exported evaluator
//    `evaluateTargetEligibility`) the missing guards -- disabled target,
//    break-glass exclusion, missing/non-reciprocal Employee<->Auth linkage,
//    final-active-recoverable-admin protection, and self-target -- BEFORE any
//    side effect. The UI is not a security boundary; these live here.
//  - PERMISSION: authorizes via the single governed admin authority
//    (server-side `users/{actorUid}.role === "admin"`), encapsulated for the
//    Issue #226 resolver swap (auth-modernization-architecture.md §6.1). The
//    catalog id `admin.credentialReset.initiate` is registered INACTIVE
//    (permissionCatalog.ts, `active:false`) as the declared future contract; it
//    is not activated or granted here.
//
// PRESERVED FROM AUTH-PR-3:
//  - actorUid comes from the authenticated callable context only, never client
//    data. Neutral, sanitized caller output; the target email, any code/token,
//    provider body, and target-eligibility reason are NEVER returned; only
//    sanitized categories are audited.
//  - FAIL CLOSED on send capability: an unconfigured native send performs ZERO
//    Auth side effects.
//  - Every terminal path emits durable audit (initiation + send outcome), each
//    awaited before the next side effect.
//  - IDEMPOTENCY + CRASH SAFETY for the ELIGIBLE send path: a caller key claims
//    a durable op record BOUND to (actorUid, targetUid, mode) with a STRICTLY
//    validated schema; a resumable, attempt-bound (lease) single "send" stage
//    records only a SUCCESSFUL send; a stale worker's writes are refused.
//
// Repository-only: no deployment; tests run against the emulator with injected
// Admin-SDK deps + the pure evaluator's own node tests.
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { recordStandaloneAuditEvent } from "./auditEventWriter";
import type { AuditAction, AuditOutcome, Scope } from "../types/access";

const USERS_COLLECTION = "users";
const RESET_OPS_COLLECTION = "admin_credential_reset_ops";
const GLOBAL_SCOPE: Scope = { type: "global" };
const TARGET_TYPE = "user";
const MAX_LIST_LIMIT = 100;
const DEFAULT_LIST_LIMIT = 50;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,200}$/;
const STALE_PENDING_MS = 5 * 60 * 1000;
const RETRY_COOLDOWN_MS = 30 * 1000;

// D-ROUTINE-REVOKE = NO: only "routine" is supported here. "suspectedCompromise"
// (immediate revocation) is a separate governed action, not this command.
const RESET_MODES = ["routine"] as const;
export type ResetMode = (typeof RESET_MODES)[number];
const OP_STATUSES = ["in_progress", "completed", "failed"] as const;
type OpStatus = (typeof OP_STATUSES)[number];
type SendRuntime = "accepted" | "not_accepted";
// Only a SUCCESSFUL send is persisted -- an unaccepted send is left unrecorded
// so a later attempt RETRIES it. A persisted stage is therefore terminal-done.
interface OpStages { send?: "sent" }

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

// -- Firebase-native send seam (D-DELIVERY-NATIVE) ---------------------------
// The ONLY truthful signal is `accepted` (Firebase accepted the reset-email
// request), NEVER "delivered". A configured sender MUST be idempotent on
// `idempotencyKey` (native send is internally at-least-once after a stale-worker
// takeover): a repeat call with the same key MUST NOT enqueue a second email.
// `isConfigured()` true is the sender's attestation that it can send natively
// AND deduplicates on `idempotencyKey`; the command fails closed when it is
// false, so no un-attested sender ever runs. No reset link is generated here.
export interface NativeResetSender {
  isConfigured(): boolean;
  // Resolves { accepted: true } when Firebase accepted the send request. Any
  // provider body / code / link stays inside this boundary and is never
  // returned to the command.
  sendReset(args: { targetUid: string; email: string; idempotencyKey: string }): Promise<{ accepted: boolean }>;
}

// Fail-closed default: reports not-configured and performs no send. This is the
// production posture until an Owner-authorized native sender is wired at the
// AUTH-PROD enablement gate (never an external provider -- #54).
export const NOT_CONFIGURED_NATIVE_SEND: NativeResetSender = {
  isConfigured() {
    return false;
  },
  async sendReset() {
    return { accepted: false };
  },
};

// -- Target eligibility facts + PURE evaluator (guard gap, #56) ---------------

// The raw facts the guards need, resolved server-side (Auth + Firestore) by the
// injected `resolveTargetFacts`. Sourcing them behind a dep keeps the guard
// logic pure and node-testable and lets AUTH-PROD verify the exact fact sources.
export interface TargetFacts {
  authExists: boolean; // a Firebase Auth user exists for the uid
  disabled: boolean; // Auth user is disabled
  email: string | null; // recoverable email (Auth), or null
  hasEmployeeLink: boolean; // users/{uid}.employeeId present
  employeeLinkReciprocal: boolean; // employees/{employeeId} links back to uid
  isBreakGlass: boolean; // designated break-glass identity
  isFinalActiveAdmin: boolean; // resetting risks the last recoverable admin
}

export type EligibilityCategory =
  | "eligible"
  | "self-target"
  | "protected-final-admin"
  | "no-auth-account"
  | "missing-or-nonreciprocal-employee-link"
  | "disabled-target"
  | "break-glass-target"
  | "no-recoverable-email";

// "protected" -> a VISIBLE refusal (the actor may know; not an enumeration
// leak): self-target and final-active-admin. "neutral-ineligible" -> a NEUTRAL
// accepted response to the caller with a server-side denied audit (no
// enumeration of disabled/break-glass/linkage/email state). "eligible" ->
// proceed to send.
export type EligibilityDisposition = "eligible" | "protected" | "neutral-ineligible";

export interface EligibilityVerdict {
  category: EligibilityCategory;
  disposition: EligibilityDisposition;
}

// PURE. Order matters: self and final-admin are the visible "protected"
// refusals; the rest are neutral to avoid enumeration. A missing Auth account
// or broken linkage is neutral-ineligible (never silently created/linked); a
// disabled target is neutral-ineligible and is NEVER silently enabled.
export function evaluateTargetEligibility(
  facts: TargetFacts,
  actorUid: string,
  targetUid: string,
): EligibilityVerdict {
  if (actorUid === targetUid) return { category: "self-target", disposition: "protected" };
  if (!facts.authExists) return { category: "no-auth-account", disposition: "neutral-ineligible" };
  if (!facts.hasEmployeeLink || !facts.employeeLinkReciprocal) {
    return { category: "missing-or-nonreciprocal-employee-link", disposition: "neutral-ineligible" };
  }
  if (facts.isFinalActiveAdmin) return { category: "protected-final-admin", disposition: "protected" };
  if (facts.disabled) return { category: "disabled-target", disposition: "neutral-ineligible" };
  if (facts.isBreakGlass) return { category: "break-glass-target", disposition: "neutral-ineligible" };
  if (!facts.email) return { category: "no-recoverable-email", disposition: "neutral-ineligible" };
  return { category: "eligible", disposition: "eligible" };
}

// -- Actor authorization (PRE-2, corrected) ----------------------------------
//
// AUTH-PR-3.5 authorized the actor by stored role ALONE. PRE-2 makes admin
// password-reset authorization FAIL CLOSED unless the authenticated actor is a
// governed admin with an ACTIVE, non-disabled account and a valid RECIPROCAL
// Employee<->Auth linkage. Facts are resolved server-side from the authenticated
// context (Auth + Firestore) behind an injected dep -- the actor uid always comes
// from the authenticated callable context, never from client data, and no
// client-supplied role/status/capability value is ever consulted.
//
// Schema reconciliation: account/employment "active" state is represented solely
// by the Firebase Auth enabled/disabled flag (`setUserStatus` toggles only
// `getAuth().updateUser({ disabled })`; there is no separate Firestore
// employment-status field). "Active employment/account" and "not disabled" both
// reduce to `authExists && !disabled`. If a distinct governed employment-status
// field is later introduced, extend `ActorAuthorizationFacts` + the evaluator.
export interface ActorAuthorizationFacts {
  authExists: boolean; // a Firebase Auth user exists for the actor uid
  disabled: boolean; // Auth user is disabled (inactive account)
  isAdmin: boolean; // governed admin role: users/{actorUid}.role === "admin"
  hasEmployeeLink: boolean; // users/{actorUid}.employeeId present
  employeeLinkReciprocal: boolean; // employees/{employeeId} links back to actorUid
}

export type ActorAuthorizationCategory =
  | "authorized"
  | "no-auth-account"
  | "disabled-actor"
  | "not-admin"
  | "missing-or-nonreciprocal-employee-link";

export interface ActorAuthorizationVerdict {
  authorized: boolean;
  category: ActorAuthorizationCategory;
}

// PURE. Fail-closed order: a missing Auth account, a disabled account, a
// non-admin role, or a missing/non-reciprocal Employee<->Auth link each deny.
// Only a governed admin with an active, reciprocally-linked identity is authorized.
export function evaluateActorAuthorization(facts: ActorAuthorizationFacts): ActorAuthorizationVerdict {
  if (!facts.authExists) return { authorized: false, category: "no-auth-account" };
  if (facts.disabled) return { authorized: false, category: "disabled-actor" };
  if (!facts.isAdmin) return { authorized: false, category: "not-admin" };
  if (!facts.hasEmployeeLink || !facts.employeeLinkReciprocal) {
    return { authorized: false, category: "missing-or-nonreciprocal-employee-link" };
  }
  return { authorized: true, category: "authorized" };
}

export interface ActorAuthorizationDeps {
  // Resolve the actor authorization facts (Auth + Firestore) from the
  // authenticated context. Throwing FAILS CLOSED (treated as unauthorized).
  resolveActorFacts(actorUid: string): Promise<ActorAuthorizationFacts>;
}

export interface AdminResetDeps extends ActorAuthorizationDeps {
  // Resolve the guard facts for the target (Auth + Firestore). Throwing is a
  // stage error (audited), not a silent pass.
  resolveTargetFacts(targetUid: string): Promise<TargetFacts>;
  // Firebase-native send seam (fail-closed by default).
  nativeSend: NativeResetSender;
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

// Fail-closed actor authorization (PRE-2). Any lookup error is treated as
// unauthorized (never a silent pass). The sanitized public error never reveals
// which condition failed; the category is recorded only in the server-side audit.
async function assertActorAuthorized(
  actorUid: string,
  deps: ActorAuthorizationDeps,
): Promise<ActorAuthorizationCategory> {
  let facts: ActorAuthorizationFacts;
  try {
    facts = await deps.resolveActorFacts(actorUid);
  } catch {
    throw new UnauthorizedActorError("actor authorization lookup failed");
  }
  const verdict = evaluateActorAuthorization(facts);
  if (!verdict.authorized) {
    throw new UnauthorizedActorError(`actor is not authorized (${verdict.category})`);
  }
  return verdict.category;
}

async function audit(actorUid: string, targetUid: string, action: AuditAction, outcome: AuditOutcome, summary: string): Promise<void> {
  await recordStandaloneAuditEvent({ actorUid, action, targetType: TARGET_TYPE, targetId: targetUid, outcome, summary, scope: GLOBAL_SCOPE });
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

// STRICT operation-record schema validation. Any missing/malformed field --
// including the freshness fields used by concurrency/cooldown -- fails closed.
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
    if (st.send !== undefined && st.send !== "sent") return false;
    for (const k of Object.keys(st)) if (k !== "send") return false;
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
      // Stale in_progress or past-cooldown failed -> resume.
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

// Claim the send stage for `attempt` ONLY if not already recorded done and this
// attempt still owns the op. A stale worker (attempt mismatch) gets "superseded".
export async function claimStage(key: string, stage: "send", attempt: number): Promise<"already_done" | "claimed" | "superseded"> {
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

// Record the send stage completion ONLY if this attempt still owns the op.
export async function recordStageOwned(key: string, stage: "send", value: "sent", attempt: number): Promise<boolean> {
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
    // suspectedCompromise (immediate revocation) is a separate governed action.
    throw new InvalidInputError("mode must be 'routine'; suspected-compromise reset is a separate governed action");
  }
  const { actorUid, targetUid, idempotencyKey: key } = input;

  // --- Pre-claim denials (no op record for these) ---------------------------
  try {
    await assertActorAuthorized(actorUid, deps);
  } catch (err) {
    await audit(actorUid, targetUid, "initiateAdminPasswordReset", "denied", `Denied: actor not authorized (mode ${mode}).`);
    throw err;
  }
  if (actorUid === targetUid) {
    await audit(actorUid, targetUid, "initiateAdminPasswordReset", "denied", "Denied: self-reset via admin tool is not permitted.");
    throw new ProtectedAccountError("Use self-service password recovery to reset your own password.");
  }
  if (!deps.nativeSend.isConfigured()) {
    await audit(actorUid, targetUid, "deliverAdminPasswordReset", "denied", "Denied: native reset send not configured; no Auth side effect performed.");
    throw new DeliveryUnavailableError("Password reset send is not configured.");
  }

  // --- Eligibility guards (require facts; still pre-claim) -------------------
  let facts: TargetFacts;
  try {
    facts = await deps.resolveTargetFacts(targetUid);
  } catch {
    await audit(actorUid, targetUid, "initiateAdminPasswordReset", "denied", "Denied: target eligibility lookup error.");
    throw new AdminResetStageError("target eligibility lookup failed");
  }
  const verdict = evaluateTargetEligibility(facts, actorUid, targetUid);
  if (verdict.disposition === "protected") {
    // Visible refusal (self already handled above; here: final-active-admin).
    await audit(actorUid, targetUid, "initiateAdminPasswordReset", "denied", `Denied: protected target (${verdict.category}).`);
    throw new ProtectedAccountError("This account is protected and cannot be reset from the admin tool.");
  }
  if (verdict.disposition === "neutral-ineligible") {
    // NEUTRAL to the caller (no enumeration); denied audit records the category.
    await audit(actorUid, targetUid, "initiateAdminPasswordReset", "applied", `Initiated (mode ${mode}).`);
    await audit(actorUid, targetUid, "deliverAdminPasswordReset", "denied", `Not sent: target ineligible (${verdict.category}).`);
    return NEUTRAL_ACCEPTED;
  }

  // --- Eligible: idempotent, lease-bound native send ------------------------
  const claim = await claimOrResume(key, actorUid, targetUid, mode);
  if (claim.action === "replay") return NEUTRAL_ACCEPTED;
  const { attempt, stages } = claim;
  const email = facts.email as string; // eligible => non-null

  const recordStage = async () => {
    if (!(await recordStageOwned(key, "send", "sent", attempt))) throw new LeaseLostError("superseded by a newer attempt");
  };
  const setStatus = async (status: OpStatus) => {
    if (!(await setStatusOwned(key, status, attempt))) throw new LeaseLostError("superseded by a newer attempt");
  };

  try {
    await audit(actorUid, targetUid, "initiateAdminPasswordReset", "applied", `Initiated (mode ${mode}, attempt ${attempt}).`);

    if (stages.send === "sent") {
      // Already sent on a prior attempt -- neutral, no second send.
      await setStatus("completed");
      return NEUTRAL_ACCEPTED;
    }
    const claimed = await claimStage(key, "send", attempt);
    if (claimed === "superseded") throw new LeaseLostError("superseded by a newer attempt");
    if (claimed === "already_done") {
      await setStatus("completed");
      return NEUTRAL_ACCEPTED;
    }

    let accepted: SendRuntime;
    try {
      const res = await deps.nativeSend.sendReset({ targetUid, email, idempotencyKey: key });
      accepted = res.accepted ? "accepted" : "not_accepted";
    } catch (e) {
      if (e instanceof LeaseLostError) throw e;
      await audit(actorUid, targetUid, "deliverAdminPasswordReset", "denied", "Failed: native reset send error.");
      await setStatus("failed");
      throw new AdminResetStageError("native reset send failed");
    }

    if (accepted === "accepted") {
      await recordStage();
      // TRUTHFUL: "request accepted", never "delivered".
      await audit(actorUid, targetUid, "deliverAdminPasswordReset", "applied", "Reset email requested (accepted by Firebase native send).");
      await setStatus("completed");
      return NEUTRAL_ACCEPTED;
    }
    // Not accepted -> retryable (status failed), no stage persisted.
    await audit(actorUid, targetUid, "deliverAdminPasswordReset", "denied", "Not sent: native send did not accept the request.");
    await setStatus("failed");
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
export async function listResetEligibleUsers(
  input: ListResetEligibleUsersInput,
  deps: ActorAuthorizationDeps,
): Promise<ResetEligibleUser[]> {
  assertNonEmptyString(input.actorUid, "actorUid");
  await assertActorAuthorized(input.actorUid, deps);
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
