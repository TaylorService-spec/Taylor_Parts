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
import { createHash } from "crypto";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { recordStandaloneAuditEvent, stageAuditEvent, type RecordAuditEventInput } from "./auditEventWriter";
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
// PRE-1 (D-PRE1-OPSTATE) adds the terminal `reconciliation_required` status: an
// uncertain send leaves the op here -- NOT completed, NOT failed, never
// auto-retried, resolvable only by the separately authorized reconciliation
// command (D-PRE1-XKEY-RECON, not implemented here).
const OP_STATUSES = ["in_progress", "completed", "failed", "reconciliation_required"] as const;
type OpStatus = (typeof OP_STATUSES)[number];
// Bounded reason enum for the reconciliation sub-object (no free-form text).
const RECONCILIATION_REASONS = ["uncertain_send"] as const;
type ReconciliationReason = (typeof RECONCILIATION_REASONS)[number];
interface OpReconciliation { reason: ReconciliationReason; atMs: number }
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

// -- Firebase-native send seam (D-DELIVERY-NATIVE / PRE-1) -------------------
// The ONLY truthful positive signal is `accepted` (Firebase accepted the
// reset-email request), NEVER "delivered". PRE-1 makes the outcome THREE-STATE
// (D-PRE1-INTERFACE): `accepted` | `not_accepted` (definite non-success,
// retryable) | `uncertain` (the send may have reached Firebase but the outcome
// could not be durably determined -- NEVER reported as accepted). A configured
// sender MUST deduplicate on `idempotencyKey` so a repeat call with the same key
// makes AT MOST ONE Firebase call and NEVER enqueues a second email. The command
// passes a deterministic `binding` (a digest of its governed inputs) that the
// sender persists and compares; the sender never infers authority fields and
// never persists the email. `isConfigured()` true is the sender's attestation
// that it can send natively AND deduplicates; the command fails closed when it is
// false. No reset link is generated here.
export type NativeSendOutcome = "accepted" | "not_accepted" | "uncertain";
export interface NativeResetSender {
  isConfigured(): boolean;
  // Any provider body / code / link stays inside this boundary and is never
  // returned to the command. `binding` is the command-computed digest (§4).
  sendReset(args: {
    targetUid: string;
    email: string;
    idempotencyKey: string;
    binding: string;
  }): Promise<{ outcome: NativeSendOutcome }>;
}

// Fail-closed default: reports not-configured and performs no send. This is the
// production posture until an Owner-authorized native sender is wired at the
// AUTH-PROD enablement gate (never an external provider -- #54).
export const NOT_CONFIGURED_NATIVE_SEND: NativeResetSender = {
  isConfigured() {
    return false;
  },
  async sendReset() {
    return { outcome: "not_accepted" };
  },
};

// D-PRE1: the command computes this deterministic binding from its governed
// inputs and passes it to the sender, which persists + compares it (a key reused
// with a different binding fails closed). The sender never recomputes it from,
// or infers, the authority fields.
export function computeCommandBinding(actorUid: string, targetUid: string, mode: ResetMode): string {
  return createHash("sha256").update(JSON.stringify([actorUid, targetUid, mode])).digest("hex");
}

// -- Target eligibility facts + PURE evaluator (guard gap, #56) ---------------

// The raw facts the guards need, resolved server-side (Auth + Firestore) by the
// injected `resolveTargetFacts`. Sourcing them behind a dep keeps the guard
// logic pure and node-testable and lets AUTH-PROD verify the exact fact sources.
export interface TargetFacts {
  authExists: boolean; // a Firebase Auth user exists for the uid
  disabled: boolean; // Auth user is disabled
  email: string | null; // recoverable email (Auth), or null
  hasEmployeeLink: boolean; // users/{uid}.employeeId present
  employeeLinkReciprocal: boolean; // employees/{employeeId}.userId === uid (exact; no aliases)
  employmentStatus: string | null; // employees/{employeeId}.employmentStatus (from the reciprocal doc)
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
  | "inactive-employment-target"
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
// disabled target is neutral-ineligible and is NEVER silently enabled. A
// non-ACTIVE governed employmentStatus (ON_LEAVE / INACTIVE / TERMINATED /
// RETIRED / CONTRACTOR / missing / malformed) is neutral-ineligible -- it is read
// from the EXACT reciprocal Employee doc (checked after linkage) and mirrors
// firestore.rules `isActiveOperationalRole`; a routine reset requires ACTIVE.
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
  if (facts.employmentStatus !== ACTIVE_EMPLOYMENT_STATUS) {
    return { category: "inactive-employment-target", disposition: "neutral-ineligible" };
  }
  if (!facts.email) return { category: "no-recoverable-email", disposition: "neutral-ineligible" };
  return { category: "eligible", disposition: "eligible" };
}

// -- Actor authorization (PRE-2, corrected) ----------------------------------
//
// AUTH-PR-3.5 authorized the actor by stored role ALONE. PRE-2 makes admin
// password-reset authorization FAIL CLOSED unless the authenticated actor is a
// governed admin with an ACTIVE employment status, a non-disabled Auth account,
// and a valid RECIPROCAL Employee<->User linkage. Facts are resolved server-side
// from the authenticated context (Auth + Firestore) behind an injected dep -- the
// actor uid always comes from the authenticated callable context, never from
// client data, and no client-supplied role/status/capability value is ever
// consulted.
//
// TWO INDEPENDENT active-state gates (both required):
//  1. Firebase Auth account control: the account exists and `disabled !== true`.
//  2. Governed employment lifecycle: the reciprocally-linked
//     `employees/{employeeId}.employmentStatus === "ACTIVE"`. This is the
//     authoritative business lifecycle field (mirrors firestore.rules
//     `isActiveOperationalRole`); ON_LEAVE / INACTIVE / TERMINATED / RETIRED /
//     CONTRACTOR / missing / malformed all DENY. Auth-disabled is a distinct
//     account control and does not substitute for employmentStatus (or vice versa).
//
// Reciprocal linkage uses the GOVERNED field ONLY:
//   users/{uid}.employeeId == employeeId  AND  employees/{employeeId}.userId == uid.
// Alias fields (employees.authUid / employees.uid) are intentionally NOT accepted:
// a stale or conflicting record must never authorize when the authoritative
// `userId` is absent or points elsewhere.
const ACTIVE_EMPLOYMENT_STATUS = "ACTIVE";

export interface ActorAuthorizationFacts {
  authExists: boolean; // a Firebase Auth user exists for the actor uid
  disabled: boolean; // Auth user is disabled (inactive account)
  isAdmin: boolean; // governed admin role: users/{actorUid}.role === "admin"
  hasEmployeeLink: boolean; // users/{actorUid}.employeeId present
  employeeLinkReciprocal: boolean; // employees/{employeeId}.userId === actorUid (exact)
  employmentStatus: string | null; // employees/{employeeId}.employmentStatus (from the reciprocal doc)
}

export type ActorAuthorizationCategory =
  | "authorized"
  | "no-auth-account"
  | "disabled-actor"
  | "not-admin"
  | "missing-or-nonreciprocal-employee-link"
  | "inactive-employment";

export interface ActorAuthorizationVerdict {
  authorized: boolean;
  category: ActorAuthorizationCategory;
}

// PURE. Fail-closed order: a missing Auth account, a disabled account, a
// non-admin role, a missing/non-reciprocal Employee<->User link, or a non-ACTIVE
// employment status each deny. Only a governed admin with an enabled Auth account,
// an exact reciprocal Employee link, and employmentStatus === "ACTIVE" is authorized.
export function evaluateActorAuthorization(facts: ActorAuthorizationFacts): ActorAuthorizationVerdict {
  if (!facts.authExists) return { authorized: false, category: "no-auth-account" };
  if (facts.disabled) return { authorized: false, category: "disabled-actor" };
  if (!facts.isAdmin) return { authorized: false, category: "not-admin" };
  if (!facts.hasEmployeeLink || !facts.employeeLinkReciprocal) {
    return { authorized: false, category: "missing-or-nonreciprocal-employee-link" };
  }
  if (facts.employmentStatus !== ACTIVE_EMPLOYMENT_STATUS) {
    return { authorized: false, category: "inactive-employment" };
  }
  return { authorized: true, category: "authorized" };
}

// PURE. Resolve the Employee-link facts from raw document values using the
// GOVERNED reciprocal contract only. `employmentStatus` is trusted ONLY when the
// link is exactly reciprocal (`employees/{employeeId}.userId === uid`); otherwise
// it is null (deny). A non-string employmentStatus is treated as malformed (null).
export interface EmployeeLinkResolutionInput {
  userEmployeeId: unknown; // users/{uid}.employeeId
  employeeExists: boolean; // employees/{employeeId} document exists
  employeeUserId: unknown; // employees/{employeeId}.userId (authoritative back-link)
  employeeEmploymentStatus: unknown; // employees/{employeeId}.employmentStatus
  uid: string;
}
export interface EmployeeLinkFacts {
  hasEmployeeLink: boolean;
  employeeLinkReciprocal: boolean;
  employmentStatus: string | null;
}
export function resolveEmployeeLinkFacts(input: EmployeeLinkResolutionInput): EmployeeLinkFacts {
  const employeeId =
    typeof input.userEmployeeId === "string" && input.userEmployeeId.length > 0 ? input.userEmployeeId : null;
  const hasEmployeeLink = employeeId !== null;
  // GOVERNED reciprocal field ONLY -- exact userId match. No authUid/uid aliases.
  const employeeLinkReciprocal = hasEmployeeLink && input.employeeExists && input.employeeUserId === input.uid;
  const employmentStatus =
    employeeLinkReciprocal && typeof input.employeeEmploymentStatus === "string"
      ? input.employeeEmploymentStatus
      : null;
  return { hasEmployeeLink, employeeLinkReciprocal, employmentStatus };
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
  reconciliation?: OpReconciliation;
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
// which condition failed. The denial category is INTERNAL to the thrown error and
// is NOT persisted -- the existing denied audit records only the generic
// unauthorized summary (audit coverage is owned by the separate PRE-3 gate).
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
  // PRE-1 reconciliation sub-object: strict shape (bounded reason enum + finite atMs).
  if (r.reconciliation !== undefined) {
    if (typeof r.reconciliation !== "object" || r.reconciliation === null || Array.isArray(r.reconciliation)) return false;
    const rc = r.reconciliation as Record<string, unknown>;
    if (typeof rc.reason !== "string" || !(RECONCILIATION_REASONS as readonly string[]).includes(rc.reason)) return false;
    if (!isFiniteNumber(rc.atMs)) return false;
    for (const k of Object.keys(rc)) if (k !== "reason" && k !== "atMs") return false;
  }
  // Invariants tying status to the other fields (fail closed on violation):
  const stagesSent = (r.stages as Record<string, unknown> | undefined)?.send === "sent";
  if (r.status === "reconciliation_required") {
    // Must carry a reconciliation reason and must NOT be marked sent.
    if (r.reconciliation === undefined) return false;
    if (stagesSent) return false;
  } else if (r.reconciliation !== undefined) {
    // reconciliation is only valid on the reconciliation_required status.
    return false;
  }
  return true;
}

interface ClaimResult {
  // "blocked" -> the op is in reconciliation_required: same-key replay is
  // side-effect-free (no send, no state change, no new audit); the caller gets the
  // neutral envelope. Resolution is only via the separately authorized
  // reconciliation command (D-PRE1-XKEY-RECON).
  action: "replay" | "run" | "blocked";
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
      // PRE-1: reconciliation_required is terminal-until-reconciled -- never resume,
      // never auto-retry, never re-enter the send path. Same-key replay is blocked
      // and side-effect-free.
      if (d.status === "reconciliation_required") return { action: "blocked", attempt: d.attempt, stages };
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

// Set terminal status ONLY if this attempt still owns the op. `reconciliation_required`
// is deliberately NOT settable here -- it must go through setReconciliationRequiredOwned
// so its sanitized audit is written atomically in the same transaction.
export async function setStatusOwned(key: string, status: OpStatus, attempt: number): Promise<boolean> {
  if (status === "reconciliation_required") {
    throw new Error("reconciliation_required must be set via setReconciliationRequiredOwned (atomic audit)");
  }
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(opRef(key));
    if (!snap.exists) return false;
    const raw = snap.data();
    if (!isValidOpRecord(raw) || raw.attempt !== attempt) return false;
    tx.update(opRef(key), { status, updatedAtMs: Date.now() });
    return true;
  });
}

// PRE-1 (D-PRE1-OPSTATE + D-PRE1-AUDIT): atomically transition the op to
// `reconciliation_required` AND stage the sanitized uncertainty audit in the SAME
// Firestore transaction -- commit both or neither. Attempt-bound (a stale worker is
// refused). Never sets stages.send; never transitions to completed. The standalone
// audit path is intentionally NOT used for this transition.
async function setReconciliationRequiredOwned(
  key: string,
  attempt: number,
  reason: ReconciliationReason,
  auditInput: RecordAuditEventInput,
): Promise<boolean> {
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(opRef(key));
    if (!snap.exists) return false;
    const raw = snap.data();
    if (!isValidOpRecord(raw) || raw.attempt !== attempt) return false;
    tx.update(opRef(key), {
      status: "reconciliation_required",
      reconciliation: { reason, atMs: Date.now() },
      updatedAtMs: Date.now(),
    });
    // Atomic sanitized audit: transition cannot commit without it (and vice versa).
    stageAuditEvent(tx, auditInput);
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
  // replay (completed) or blocked (reconciliation_required) -> side-effect-free neutral.
  if (claim.action === "replay" || claim.action === "blocked") return NEUTRAL_ACCEPTED;
  const { attempt, stages } = claim;
  const email = facts.email as string; // eligible => non-null
  const binding = computeCommandBinding(actorUid, targetUid, mode);

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

    let outcome: NativeSendOutcome;
    try {
      const res = await deps.nativeSend.sendReset({ targetUid, email, idempotencyKey: key, binding });
      outcome = res.outcome;
    } catch (e) {
      if (e instanceof LeaseLostError) throw e;
      await audit(actorUid, targetUid, "deliverAdminPasswordReset", "denied", "Failed: native reset send error.");
      await setStatus("failed");
      throw new AdminResetStageError("native reset send failed");
    }

    if (outcome === "accepted") {
      await recordStage();
      // TRUTHFUL: "request accepted", never "delivered".
      await audit(actorUid, targetUid, "deliverAdminPasswordReset", "applied", "Reset email requested (accepted by Firebase native send).");
      await setStatus("completed");
      return NEUTRAL_ACCEPTED;
    }
    if (outcome === "uncertain") {
      // Possibly sent, outcome unknown: NEVER reported as accepted, NEVER stages.send,
      // NEVER completed, no auto-retry. Atomically transition to reconciliation_required
      // together with a truthful sanitized uncertainty audit (both commit or neither).
      const staged = await setReconciliationRequiredOwned(key, attempt, "uncertain_send", {
        actorUid,
        action: "deliverAdminPasswordReset",
        targetType: TARGET_TYPE,
        targetId: targetUid,
        outcome: "uncertain",
        summary: "Send outcome uncertain (possibly sent); operation requires reconciliation.",
        scope: GLOBAL_SCOPE,
      });
      if (!staged) throw new LeaseLostError("superseded by a newer attempt");
      return NEUTRAL_ACCEPTED;
    }
    // not_accepted -> retryable (status failed), no stage persisted.
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
  // GOVERNED reciprocal Employee link: users/{uid}.employeeId present AND
  // employees/{employeeId}.userId === uid (exact; no authUid/uid aliases). A bare
  // users.employeeId with no reciprocal back-link reports false. Authoritative
  // reset eligibility (Auth state, employmentStatus, break-glass, final-admin,
  // email) is evaluated per-target at initiate; this flag surfaces linkage only.
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
  return Promise.all(
    snap.docs.map(async (doc) => {
      const data = doc.data() as { displayName?: unknown; role?: unknown; employeeId?: unknown };
      // Resolve the GOVERNED reciprocal link (Firestore only): read the exact
      // employees/{employeeId} back-link. No authUid/uid aliases; a non-reciprocal
      // or missing employee doc yields hasEmployeeLink=false.
      const userEmployeeId = data.employeeId;
      const employeeId =
        typeof userEmployeeId === "string" && userEmployeeId.length > 0 ? userEmployeeId : null;
      let employeeExists = false;
      let employeeUserId: unknown = undefined;
      if (employeeId) {
        const empSnap = await db().collection("employees").doc(employeeId).get();
        employeeExists = empSnap.exists;
        employeeUserId = empSnap.exists ? (empSnap.data() as Record<string, unknown>).userId : undefined;
      }
      const link = resolveEmployeeLinkFacts({
        userEmployeeId,
        employeeExists,
        employeeUserId,
        employeeEmploymentStatus: undefined, // not surfaced by the list
        uid: doc.id,
      });
      return {
        uid: doc.id,
        displayName: typeof data.displayName === "string" ? data.displayName : null,
        role: typeof data.role === "string" ? data.role : null,
        hasEmployeeLink: link.employeeLinkReciprocal,
      };
    }),
  );
}
