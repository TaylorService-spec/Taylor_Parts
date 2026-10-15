"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NOT_CONFIGURED_NATIVE_SEND = exports.LeaseLostError = exports.AdminResetStageError = exports.MalformedOperationError = exports.OperationKeyConflictError = exports.RetryCooldownError = exports.OperationInProgressError = exports.DeliveryUnavailableError = exports.ProtectedAccountError = exports.InvalidInputError = exports.UnauthorizedActorError = void 0;
exports.computeCommandBinding = computeCommandBinding;
exports.evaluateTargetEligibility = evaluateTargetEligibility;
exports.evaluateActorAuthorization = evaluateActorAuthorization;
exports.resolveEmployeeLinkFacts = resolveEmployeeLinkFacts;
exports.claimStage = claimStage;
exports.recordStageOwned = recordStageOwned;
exports.setStatusOwned = setStatusOwned;
exports.initiateAdminPasswordReset = initiateAdminPasswordReset;
exports.listResetEligibleUsers = listResetEligibleUsers;
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
const crypto_1 = require("crypto");
const firestore_1 = require("firebase-admin/firestore");
const auditEventWriter_1 = require("./auditEventWriter");
const USERS_COLLECTION = "users";
const RESET_OPS_COLLECTION = "admin_credential_reset_ops";
const GLOBAL_SCOPE = { type: "global" };
const TARGET_TYPE = "user";
const MAX_LIST_LIMIT = 100;
const DEFAULT_LIST_LIMIT = 50;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,200}$/;
const STALE_PENDING_MS = 5 * 60 * 1000;
const RETRY_COOLDOWN_MS = 30 * 1000;
// D-ROUTINE-REVOKE = NO: only "routine" is supported here. "suspectedCompromise"
// (immediate revocation) is a separate governed action, not this command.
const RESET_MODES = ["routine"];
// PRE-1 (D-PRE1-OPSTATE) adds the terminal `reconciliation_required` status: an
// uncertain send leaves the op here -- NOT completed, NOT failed, never
// auto-retried, resolvable only by the separately authorized reconciliation
// command (D-PRE1-XKEY-RECON, not implemented here).
const OP_STATUSES = ["in_progress", "completed", "failed", "reconciliation_required"];
// Bounded reason enum for the reconciliation sub-object (no free-form text).
const RECONCILIATION_REASONS = ["uncertain_send"];
class UnauthorizedActorError extends Error {
}
exports.UnauthorizedActorError = UnauthorizedActorError;
class InvalidInputError extends Error {
}
exports.InvalidInputError = InvalidInputError;
class ProtectedAccountError extends Error {
}
exports.ProtectedAccountError = ProtectedAccountError;
class DeliveryUnavailableError extends Error {
}
exports.DeliveryUnavailableError = DeliveryUnavailableError;
class OperationInProgressError extends Error {
}
exports.OperationInProgressError = OperationInProgressError;
class RetryCooldownError extends Error {
}
exports.RetryCooldownError = RetryCooldownError;
class OperationKeyConflictError extends Error {
}
exports.OperationKeyConflictError = OperationKeyConflictError;
class MalformedOperationError extends Error {
}
exports.MalformedOperationError = MalformedOperationError;
class AdminResetStageError extends Error {
}
exports.AdminResetStageError = AdminResetStageError;
// Raised when a lease-bound write is refused because a newer attempt owns the op.
class LeaseLostError extends AdminResetStageError {
}
exports.LeaseLostError = LeaseLostError;
// Fail-closed default: reports not-configured and performs no send. This is the
// production posture until an Owner-authorized native sender is wired at the
// AUTH-PROD enablement gate (never an external provider -- #54).
exports.NOT_CONFIGURED_NATIVE_SEND = {
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
function computeCommandBinding(actorUid, targetUid, mode) {
    return (0, crypto_1.createHash)("sha256").update(JSON.stringify([actorUid, targetUid, mode])).digest("hex");
}
// PURE. Order matters: self and final-admin are the visible "protected"
// refusals; the rest are neutral to avoid enumeration. A missing Auth account
// or broken linkage is neutral-ineligible (never silently created/linked); a
// disabled target is neutral-ineligible and is NEVER silently enabled. A
// non-ACTIVE governed employmentStatus (ON_LEAVE / INACTIVE / TERMINATED /
// RETIRED / CONTRACTOR / missing / malformed) is neutral-ineligible -- it is read
// from the EXACT reciprocal Employee doc (checked after linkage) and mirrors
// firestore.rules `isActiveOperationalRole`; a routine reset requires ACTIVE.
function evaluateTargetEligibility(facts, actorUid, targetUid) {
    if (actorUid === targetUid)
        return { category: "self-target", disposition: "protected" };
    if (!facts.authExists)
        return { category: "no-auth-account", disposition: "neutral-ineligible" };
    if (!facts.hasEmployeeLink || !facts.employeeLinkReciprocal) {
        return { category: "missing-or-nonreciprocal-employee-link", disposition: "neutral-ineligible" };
    }
    if (facts.isFinalActiveAdmin)
        return { category: "protected-final-admin", disposition: "protected" };
    if (facts.disabled)
        return { category: "disabled-target", disposition: "neutral-ineligible" };
    if (facts.isBreakGlass)
        return { category: "break-glass-target", disposition: "neutral-ineligible" };
    if (facts.employmentStatus !== ACTIVE_EMPLOYMENT_STATUS) {
        return { category: "inactive-employment-target", disposition: "neutral-ineligible" };
    }
    if (!facts.email)
        return { category: "no-recoverable-email", disposition: "neutral-ineligible" };
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
// PURE. Fail-closed order: a missing Auth account, a disabled account, a
// non-admin role, a missing/non-reciprocal Employee<->User link, or a non-ACTIVE
// employment status each deny. Only a governed admin with an enabled Auth account,
// an exact reciprocal Employee link, and employmentStatus === "ACTIVE" is authorized.
function evaluateActorAuthorization(facts) {
    if (!facts.authExists)
        return { authorized: false, category: "no-auth-account" };
    if (facts.disabled)
        return { authorized: false, category: "disabled-actor" };
    if (!facts.isAdmin)
        return { authorized: false, category: "not-admin" };
    if (!facts.hasEmployeeLink || !facts.employeeLinkReciprocal) {
        return { authorized: false, category: "missing-or-nonreciprocal-employee-link" };
    }
    if (facts.employmentStatus !== ACTIVE_EMPLOYMENT_STATUS) {
        return { authorized: false, category: "inactive-employment" };
    }
    return { authorized: true, category: "authorized" };
}
function resolveEmployeeLinkFacts(input) {
    const employeeId = typeof input.userEmployeeId === "string" && input.userEmployeeId.length > 0 ? input.userEmployeeId : null;
    const hasEmployeeLink = employeeId !== null;
    // GOVERNED reciprocal field ONLY -- exact userId match. No authUid/uid aliases.
    const employeeLinkReciprocal = hasEmployeeLink && input.employeeExists && input.employeeUserId === input.uid;
    const employmentStatus = employeeLinkReciprocal && typeof input.employeeEmploymentStatus === "string"
        ? input.employeeEmploymentStatus
        : null;
    return { hasEmployeeLink, employeeLinkReciprocal, employmentStatus };
}
const NEUTRAL_ACCEPTED = { status: "accepted" };
function assertNonEmptyString(value, field) {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new InvalidInputError(`${field} is required`);
    }
}
function db() {
    return (0, firestore_1.getFirestore)();
}
function opRef(key) {
    return db().collection(RESET_OPS_COLLECTION).doc(key);
}
// Fail-closed actor authorization (PRE-2). Any lookup error is treated as
// unauthorized (never a silent pass). The sanitized public error never reveals
// which condition failed. The denial category is INTERNAL to the thrown error and
// is NOT persisted -- the existing denied audit records only the generic
// unauthorized summary (audit coverage is owned by the separate PRE-3 gate).
async function assertActorAuthorized(actorUid, deps) {
    let facts;
    try {
        facts = await deps.resolveActorFacts(actorUid);
    }
    catch {
        throw new UnauthorizedActorError("actor authorization lookup failed");
    }
    const verdict = evaluateActorAuthorization(facts);
    if (!verdict.authorized) {
        throw new UnauthorizedActorError(`actor is not authorized (${verdict.category})`);
    }
    return verdict.category;
}
async function audit(actorUid, targetUid, action, outcome, summary) {
    await (0, auditEventWriter_1.recordStandaloneAuditEvent)({ actorUid, action, targetType: TARGET_TYPE, targetId: targetUid, outcome, summary, scope: GLOBAL_SCOPE });
}
// PRE-3 (D-PRE3-AUDIT-DURABILITY): a DENIAL stays authoritative even if its audit
// cannot be persisted. This best-effort helper records the sanitized denial and, on
// audit-write failure, surfaces the failure to server-side telemetry ONLY -- it never
// throws, never blocks the denial, and never leaks the reason to the caller.
async function auditDenial(actorUid, targetUid, action, summary) {
    try {
        await (0, auditEventWriter_1.recordStandaloneAuditEvent)({ actorUid, action, targetType: TARGET_TYPE, targetId: targetUid, outcome: "denied", summary, scope: GLOBAL_SCOPE });
    }
    catch (e) {
        // Telemetry only -- the denial remains authoritative.
        console.error("admin-reset denial audit failed (denial remains authoritative)", { action, error: e?.message });
    }
}
function isFiniteNumber(v) {
    return typeof v === "number" && Number.isFinite(v);
}
// STRICT operation-record schema validation. Any missing/malformed field --
// including the freshness fields used by concurrency/cooldown -- fails closed.
function isValidOpRecord(d) {
    if (!d || typeof d !== "object" || Array.isArray(d))
        return false;
    const r = d;
    if (typeof r.actorUid !== "string" || r.actorUid.length === 0)
        return false;
    if (typeof r.targetUid !== "string" || r.targetUid.length === 0)
        return false;
    if (typeof r.mode !== "string" || !RESET_MODES.includes(r.mode))
        return false;
    if (typeof r.status !== "string" || !OP_STATUSES.includes(r.status))
        return false;
    if (!Number.isInteger(r.attempt) || r.attempt < 1)
        return false;
    if (!isFiniteNumber(r.createdAtMs) || !isFiniteNumber(r.updatedAtMs))
        return false;
    if (r.stages !== undefined) {
        if (typeof r.stages !== "object" || r.stages === null || Array.isArray(r.stages))
            return false;
        const st = r.stages;
        if (st.send !== undefined && st.send !== "sent")
            return false;
        for (const k of Object.keys(st))
            if (k !== "send")
                return false;
    }
    // PRE-1 reconciliation sub-object: strict shape (bounded reason enum + finite atMs).
    if (r.reconciliation !== undefined) {
        if (typeof r.reconciliation !== "object" || r.reconciliation === null || Array.isArray(r.reconciliation))
            return false;
        const rc = r.reconciliation;
        if (typeof rc.reason !== "string" || !RECONCILIATION_REASONS.includes(rc.reason))
            return false;
        if (!isFiniteNumber(rc.atMs))
            return false;
        for (const k of Object.keys(rc))
            if (k !== "reason" && k !== "atMs")
                return false;
    }
    // Invariants tying status to the other fields (fail closed on violation):
    const stagesSent = r.stages?.send === "sent";
    if (r.status === "reconciliation_required") {
        // Must carry a reconciliation reason and must NOT be marked sent.
        if (r.reconciliation === undefined)
            return false;
        if (stagesSent)
            return false;
    }
    else if (r.reconciliation !== undefined) {
        // reconciliation is only valid on the reconciliation_required status.
        return false;
    }
    return true;
}
// Transactionally claim/resume the operation, bound to (actorUid,targetUid,mode).
async function claimOrResume(key, actorUid, targetUid, mode) {
    const ref = opRef(key);
    return db().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const now = Date.now();
        if (snap.exists) {
            const raw = snap.data();
            if (!isValidOpRecord(raw))
                throw new MalformedOperationError("existing operation record is malformed");
            const d = raw;
            if (d.actorUid !== actorUid || d.targetUid !== targetUid || d.mode !== mode) {
                throw new OperationKeyConflictError("idempotency key is bound to a different request");
            }
            const stages = d.stages ?? {};
            if (d.status === "completed")
                return { action: "replay", attempt: d.attempt, stages };
            // PRE-1: reconciliation_required is terminal-until-reconciled -- never resume,
            // never auto-retry, never re-enter the send path. Same-key replay is blocked
            // and side-effect-free.
            if (d.status === "reconciliation_required")
                return { action: "blocked", attempt: d.attempt, stages };
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
            createdAtMs: now, updatedAtMs: now, at: firestore_1.FieldValue.serverTimestamp(),
        });
        return { action: "run", attempt: 1, stages: {} };
    });
}
// -- Attempt-bound (lease) operations. Exported for controlled lease tests. ---
// Claim the send stage for `attempt` ONLY if not already recorded done and this
// attempt still owns the op. A stale worker (attempt mismatch) gets "superseded".
async function claimStage(key, stage, attempt) {
    return db().runTransaction(async (tx) => {
        const snap = await tx.get(opRef(key));
        if (!snap.exists)
            return "superseded";
        const raw = snap.data();
        if (!isValidOpRecord(raw))
            return "superseded";
        if (raw.attempt !== attempt)
            return "superseded";
        if (raw.stages && raw.stages[stage] !== undefined)
            return "already_done";
        tx.update(opRef(key), { updatedAtMs: Date.now() }); // lease heartbeat
        return "claimed";
    });
}
// Record the send stage completion ONLY if this attempt still owns the op.
async function recordStageOwned(key, stage, value, attempt) {
    return db().runTransaction(async (tx) => {
        const snap = await tx.get(opRef(key));
        if (!snap.exists)
            return false;
        const raw = snap.data();
        if (!isValidOpRecord(raw) || raw.attempt !== attempt)
            return false;
        tx.update(opRef(key), { [`stages.${stage}`]: value, updatedAtMs: Date.now() });
        return true;
    });
}
// Set terminal status ONLY if this attempt still owns the op. `reconciliation_required`
// is deliberately NOT settable here -- it must go through setReconciliationRequiredOwned
// so its sanitized audit is written atomically in the same transaction.
async function setStatusOwned(key, status, attempt) {
    if (status === "reconciliation_required") {
        throw new Error("reconciliation_required must be set via setReconciliationRequiredOwned (atomic audit)");
    }
    return db().runTransaction(async (tx) => {
        const snap = await tx.get(opRef(key));
        if (!snap.exists)
            return false;
        const raw = snap.data();
        if (!isValidOpRecord(raw) || raw.attempt !== attempt)
            return false;
        tx.update(opRef(key), { status, updatedAtMs: Date.now() });
        return true;
    });
}
// PRE-1 (D-PRE1-OPSTATE + D-PRE1-AUDIT): atomically transition the op to
// `reconciliation_required` AND stage the sanitized uncertainty audit in the SAME
// Firestore transaction -- commit both or neither. Attempt-bound (a stale worker is
// refused). Never sets stages.send; never transitions to completed. The standalone
// audit path is intentionally NOT used for this transition.
async function setReconciliationRequiredOwned(key, attempt, reason, auditInput) {
    return db().runTransaction(async (tx) => {
        const snap = await tx.get(opRef(key));
        if (!snap.exists)
            return false;
        const raw = snap.data();
        if (!isValidOpRecord(raw) || raw.attempt !== attempt)
            return false;
        tx.update(opRef(key), {
            status: "reconciliation_required",
            reconciliation: { reason, atMs: Date.now() },
            updatedAtMs: Date.now(),
        });
        // Atomic sanitized audit: transition cannot commit without it (and vice versa).
        (0, auditEventWriter_1.stageAuditEvent)(tx, auditInput);
        return true;
    });
}
async function initiateAdminPasswordReset(input, deps) {
    assertNonEmptyString(input.actorUid, "actorUid");
    assertNonEmptyString(input.targetUid, "targetUid");
    assertNonEmptyString(input.idempotencyKey, "idempotencyKey");
    if (!IDEMPOTENCY_KEY_PATTERN.test(input.idempotencyKey)) {
        throw new InvalidInputError("idempotencyKey must be 8-200 chars of [A-Za-z0-9._:-]");
    }
    const mode = input.mode ?? "routine";
    if (!RESET_MODES.includes(mode)) {
        // suspectedCompromise (immediate revocation) is a separate governed action.
        throw new InvalidInputError("mode must be 'routine'; suspected-compromise reset is a separate governed action");
    }
    const { actorUid, targetUid, idempotencyKey: key } = input;
    // --- Pre-claim denials (no op record for these) ---------------------------
    try {
        await assertActorAuthorized(actorUid, deps);
    }
    catch (err) {
        await auditDenial(actorUid, targetUid, "initiateAdminPasswordReset", `Denied: actor not authorized (mode ${mode}).`);
        throw err;
    }
    if (actorUid === targetUid) {
        await auditDenial(actorUid, targetUid, "initiateAdminPasswordReset", "Denied: self-reset via admin tool is not permitted.");
        throw new ProtectedAccountError("Use self-service password recovery to reset your own password.");
    }
    if (!deps.nativeSend.isConfigured()) {
        await auditDenial(actorUid, targetUid, "deliverAdminPasswordReset", "Denied: native reset send not configured; no Auth side effect performed.");
        throw new DeliveryUnavailableError("Password reset send is not configured.");
    }
    // --- Eligibility guards (require facts; still pre-claim) -------------------
    let facts;
    try {
        facts = await deps.resolveTargetFacts(targetUid);
    }
    catch {
        await auditDenial(actorUid, targetUid, "initiateAdminPasswordReset", "Denied: target eligibility lookup error.");
        throw new AdminResetStageError("target eligibility lookup failed");
    }
    const verdict = evaluateTargetEligibility(facts, actorUid, targetUid);
    if (verdict.disposition === "protected") {
        // Visible refusal (self already handled above; here: final-active-admin).
        await auditDenial(actorUid, targetUid, "initiateAdminPasswordReset", `Denied: protected target (${verdict.category}).`);
        throw new ProtectedAccountError("This account is protected and cannot be reset from the admin tool.");
    }
    if (verdict.disposition === "neutral-ineligible") {
        // NEUTRAL to the caller (no enumeration); denied audit records the category.
        await audit(actorUid, targetUid, "initiateAdminPasswordReset", "applied", `Initiated (mode ${mode}).`);
        await audit(actorUid, targetUid, "deliverAdminPasswordReset", "denied", `Not sent: target ineligible (${verdict.category}).`);
        return NEUTRAL_ACCEPTED;
    }
    // --- Eligible: idempotent, lease-bound native send ------------------------
    // PRE-3 (D-PRE3-CONFLICT): audit the security-relevant claim denials
    // (key-conflict, malformed op record) as best-effort denials; in-progress /
    // retry-cooldown are intentionally NOT audited (benign, D-PRE3-BENIGN).
    let claim;
    try {
        claim = await claimOrResume(key, actorUid, targetUid, mode);
    }
    catch (err) {
        if (err instanceof OperationKeyConflictError) {
            await auditDenial(actorUid, targetUid, "initiateAdminPasswordReset", "Denied: idempotency key bound to a different request.");
        }
        else if (err instanceof MalformedOperationError) {
            await auditDenial(actorUid, targetUid, "initiateAdminPasswordReset", "Denied: malformed operation record.");
        }
        throw err;
    }
    // replay (completed) or blocked (reconciliation_required) -> side-effect-free neutral.
    if (claim.action === "replay" || claim.action === "blocked")
        return NEUTRAL_ACCEPTED;
    const { attempt, stages } = claim;
    const email = facts.email; // eligible => non-null
    const binding = computeCommandBinding(actorUid, targetUid, mode);
    const recordStage = async () => {
        if (!(await recordStageOwned(key, "send", "sent", attempt)))
            throw new LeaseLostError("superseded by a newer attempt");
    };
    const setStatus = async (status) => {
        if (!(await setStatusOwned(key, status, attempt)))
            throw new LeaseLostError("superseded by a newer attempt");
    };
    try {
        await audit(actorUid, targetUid, "initiateAdminPasswordReset", "applied", `Initiated (mode ${mode}, attempt ${attempt}).`);
        if (stages.send === "sent") {
            // Already sent on a prior attempt -- neutral, no second send.
            await setStatus("completed");
            return NEUTRAL_ACCEPTED;
        }
        const claimed = await claimStage(key, "send", attempt);
        if (claimed === "superseded")
            throw new LeaseLostError("superseded by a newer attempt");
        if (claimed === "already_done") {
            await setStatus("completed");
            return NEUTRAL_ACCEPTED;
        }
        let outcome;
        try {
            const res = await deps.nativeSend.sendReset({ targetUid, email, idempotencyKey: key, binding });
            outcome = res.outcome;
        }
        catch (e) {
            if (e instanceof LeaseLostError)
                throw e;
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
            if (!staged)
                throw new LeaseLostError("superseded by a newer attempt");
            return NEUTRAL_ACCEPTED;
        }
        // not_accepted -> retryable (status failed), no stage persisted.
        await audit(actorUid, targetUid, "deliverAdminPasswordReset", "denied", "Not sent: native send did not accept the request.");
        await setStatus("failed");
        return NEUTRAL_ACCEPTED;
    }
    catch (err) {
        // A lost-lease bail must NOT overwrite the winner's state.
        if (!(err instanceof LeaseLostError) && !(err instanceof AdminResetStageError)) {
            await setStatusOwned(key, "failed", attempt).catch(() => { });
        }
        throw err;
    }
}
// Governed list access/denial events are scope-level (no per-target identity).
const LIST_ACCESS_TARGET_TYPE = "adminCredentialReset";
const LIST_ACCESS_TARGET_ID = "reset-eligible-candidates";
async function defaultListAccessAudit(actorUid) {
    await (0, auditEventWriter_1.recordStandaloneAuditEvent)({
        actorUid, action: "listResetEligibleUsers", targetType: LIST_ACCESS_TARGET_TYPE,
        targetId: LIST_ACCESS_TARGET_ID, outcome: "applied",
        summary: "Listed admin-reset candidates (access; no identities, no count).", scope: GLOBAL_SCOPE,
    });
}
async function defaultListDenialAudit(actorUid) {
    await (0, auditEventWriter_1.recordStandaloneAuditEvent)({
        actorUid, action: "listResetEligibleUsers", targetType: LIST_ACCESS_TARGET_TYPE,
        targetId: LIST_ACCESS_TARGET_ID, outcome: "denied",
        summary: "Denied: not authorized to list admin-reset candidates.", scope: GLOBAL_SCOPE,
    });
}
function clampLimit(limit) {
    if (limit === undefined)
        return DEFAULT_LIST_LIMIT;
    if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
        throw new InvalidInputError(`limit must be an integer between 1 and ${MAX_LIST_LIMIT}`);
    }
    return limit;
}
async function listResetEligibleUsers(input, deps) {
    assertNonEmptyString(input.actorUid, "actorUid");
    try {
        await assertActorAuthorized(input.actorUid, deps);
    }
    catch (err) {
        // PRE-3 (D-PRE3-AUDIT-DURABILITY): best-effort denial audit; the denial stays
        // authoritative even if its audit cannot be persisted.
        try {
            await (deps.recordDenialAudit ?? defaultListDenialAudit)(input.actorUid);
        }
        catch (e) {
            console.error("list denial audit failed (denial remains authoritative)", { error: e?.message });
        }
        throw err;
    }
    const limit = clampLimit(input.limit); // validation: NOT audited (D-PRE3-VALIDATION)
    const snap = await db().collection(USERS_COLLECTION).limit(limit).get();
    const users = await Promise.all(snap.docs.map(async (doc) => {
        const data = doc.data();
        // Resolve the GOVERNED reciprocal link (Firestore only): read the exact
        // employees/{employeeId} back-link. No authUid/uid aliases; a non-reciprocal
        // or missing employee doc yields hasEmployeeLink=false.
        const userEmployeeId = data.employeeId;
        const employeeId = typeof userEmployeeId === "string" && userEmployeeId.length > 0 ? userEmployeeId : null;
        let employeeExists = false;
        let employeeUserId = undefined;
        if (employeeId) {
            const empSnap = await db().collection("employees").doc(employeeId).get();
            employeeExists = empSnap.exists;
            employeeUserId = empSnap.exists ? empSnap.data().userId : undefined;
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
    }));
    // PRE-3 (D-PRE3-AUDIT-DURABILITY): AUDIT BEFORE RETURN, fail closed. If the access
    // audit cannot be committed, return NO rows (a sanitized error), never the candidates.
    try {
        await (deps.recordAccessAudit ?? defaultListAccessAudit)(input.actorUid);
    }
    catch {
        throw new AdminResetStageError("could not record list-access audit");
    }
    return users;
}
//# sourceMappingURL=adminCredentialCommands.js.map