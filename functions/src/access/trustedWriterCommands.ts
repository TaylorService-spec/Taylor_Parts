// Enterprise Access & Administration Platform (Issue #226) -- the six
// trusted-writer commands: grantRole, revokeRole, assignApprovedRole,
// setUserStatus, approveAccessRequest, rejectAccessRequest. Fixed by
// docs/specifications/enterprise-access-and-administration-platform.md
// sec15 and sequenced by docs/implementation-plans/enterprise-access-
// and-administration-platform.md (Row 7 / Task 12).
//
// Server-side ONLY -- not mirrored to field-ops-app-vite: clients never
// call these functions directly. As of the deployment-candidate row
// (docs/deployment/enterprise-access-deployment-manifest.md), each
// command has a thin callable adapter (./accessCommandCallables.ts)
// exported from functions/src/index.ts -- but export is not deployment.
// These remain INERT in production: not yet deployed to the live
// project, and no Admin-mutation UI calls them, until a separate, later
// Owner production authorization (Implementation Plan Row 19+) is
// issued. Per ADR-005 sec2.6/Spec sec17, trusted-writer ACTIVATION is
// additionally blocked until Issue #15's own Cloud Functions are
// deployed and verified.
//
// ZERO Rules/index changes: every collection this module writes
// (roleAssignments, accessRequests, auditEvents) already has its Row 3
// deny-all Rules (PR #276) -- irrelevant to Admin-SDK writes anyway,
// which always bypass Rules. The authoritative per-principal
// accessVersion is stored as a field on the ALREADY-EXISTING
// `users/{uid}` document (`allow write: if false` today, unchanged) --
// no new collection, no new Rules match block, no new Firestore index
// (every query here is either a direct doc-id .get() or a two-field
// equality-only `where` query, both servable without any index
// deployment).
import { createHash } from "node:crypto";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import type {
  DocumentSnapshot,
  Transaction,
} from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import type { CompactClaims, Scope, ScopeType, Role } from "../types/access";
import { COMPATIBILITY_ROLES } from "./compatibilityRoles";
import { INVENTORY_CREATE_EXECUTOR_ROLE } from "./governedBusinessRoles";
import {
  resolveEffectivePermission,
  type TargetContext,
  type ResolveResult,
} from "./resolveEffectivePermission";
import { isValidAccessVersionValue } from "./compactClaims";
import { setCompactClaims } from "./claimsWriter";
import {
  stageAuditEventWithId,
  auditEventDocRef,
  type RecordAuditEventInput,
} from "./auditEventWriter";

// ---------------------------------------------------------------------
// Error taxonomy -- every distinguishable fail-closed reason gets its
// own class so callers (and tests) can assert on the SPECIFIC failure,
// never a generic catch-all.
// ---------------------------------------------------------------------
export class InvalidInputError extends Error {}
export class UnknownRoleError extends Error {}
export class UnauthorizedActorError extends Error {}
export class SelfApprovalError extends Error {}
export class InsufficientApproverAuthorityError extends Error {}
export class MalformedAccessDataError extends Error {}
export class UnavailableAccessDataError extends Error {}
export class InvalidStateError extends Error {}
// Thrown when the Firestore state (mutation + accessVersion bump +
// Audit Event) committed successfully, but the post-commit cross-
// service step (Auth claims refresh, and for setUserStatus, the Auth
// disable/enable call) failed. The caller must NOT treat this as
// success (Task 12: "never report success before required state,
// audit, and claims work completes") -- but the bumped accessVersion
// already makes any pre-existing token fail closed, and a retry with
// the SAME idempotencyKey will skip the state mutation entirely and
// resynchronize only the pending post-commit step.
export class ClaimsSyncPendingError extends Error {}
// Independent review round 1 finding: an idempotencyKey is the SOLE
// identity the idempotency gate checks -- reusing the same key for a
// semantically DIFFERENT command/target must never silently resolve as
// "alreadyApplied" (which would report the wrong command's
// accessVersionAfter and skip the second command's actual mutation
// entirely). Thrown when an existing Audit Event at this idempotencyKey
// has a different action/targetType/targetId than the current call.
export class IdempotencyKeyConflictError extends Error {}
// Thrown when an idempotencyKey's existing Audit Event has outcome
// "denied" -- since Audit Events are immutable, this key can never
// later resolve as "applied"; the caller must mint a fresh
// idempotencyKey rather than retry with this one.
export class IdempotencyKeyAlreadyDeniedError extends Error {}

const USERS_COLLECTION = "users";
const ROLE_ASSIGNMENTS_COLLECTION = "roleAssignments";
const ACCESS_REQUESTS_COLLECTION = "accessRequests";

// Curated registry of Roles assignable through the trusted role-assignment
// commands. It is the compatibility Roles PLUS an explicit allowlist of
// GOVERNED business Roles cleared for the trusted-command grant path --
// deliberately NOT every governed Role (declaring a Role in
// governedBusinessRoles.ts does not make it assignable here; it must be
// explicitly added below under its own governed gate). INV-1 / ADR-009 /
// Decision #42: the sole entry is the operational, non-privileged
// `inventoryCreateExecutor` (privileged:false -> assignApprovedRole's
// single authorized admin + append-only audit). All four role-lookup sites
// below resolve against this registry uniformly, so an unknown or
// non-allowlisted roleId fails closed (UnknownRoleError) exactly as before,
// and the privileged two-person rule is unaffected (compatibility Roles are
// unchanged; the one governed entry is non-privileged).
const GOVERNED_ASSIGNABLE_ROLES: Readonly<Record<string, Role>> = Object.freeze({
  inventoryCreateExecutor: INVENTORY_CREATE_EXECUTOR_ROLE,
});
const ASSIGNABLE_ROLES: Readonly<Record<string, Role>> = Object.freeze({
  ...COMPATIBILITY_ROLES,
  ...GOVERNED_ASSIGNABLE_ROLES,
});

const SCOPE_TYPES: readonly ScopeType[] = [
  "global",
  "tenant",
  "domain",
  "location",
  "ownAssignment",
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertValidScope(scope: unknown): asserts scope is Scope {
  if (!isPlainObject(scope)) {
    throw new InvalidInputError("scope must be an object");
  }
  if (typeof scope.type !== "string" || !SCOPE_TYPES.includes(scope.type as ScopeType)) {
    throw new InvalidInputError(`scope.type must be one of: ${SCOPE_TYPES.join(", ")}`);
  }
  if (scope.value !== undefined && typeof scope.value !== "string") {
    throw new InvalidInputError("scope.value must be a string when present");
  }
}

function assertNonEmptyString(value: unknown, fieldName: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new InvalidInputError(`${fieldName} is required`);
  }
}

// A caller-supplied idempotency key becomes the literal Firestore
// document id for BOTH the Audit Event and (where applicable) the new
// roleAssignment -- it must be safe as a Firestore document id and
// long enough to not collide by accident across unrelated calls.
function assertValidIdempotencyKey(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length < 8 ||
    value.length > 200 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    throw new InvalidInputError(
      "idempotencyKey must be an 8-200 character string of letters, digits, underscore, or hyphen",
    );
  }
}

// The authoritative per-principal accessVersion (Spec sec11). Missing
// entirely (no users/{uid} doc, or the field absent) is the legitimate
// bootstrap case -- a principal who has never had an access change --
// and reads as 0. A field that IS present but the wrong shape is data
// corruption, not a bootstrap case, and fails closed (Spec sec13).
function readAuthoritativeAccessVersion(snap: DocumentSnapshot): number {
  if (!snap.exists) return 0;
  const data = snap.data() || {};
  if (data.accessVersion === undefined || data.accessVersion === null) return 0;
  if (!isValidAccessVersionValue(data.accessVersion)) {
    throw new MalformedAccessDataError(`${snap.ref.path}.accessVersion is malformed`);
  }
  return data.accessVersion;
}

// Verifies the ACTOR's own effective permission server-side, using the
// merged resolver (Row 2) -- never a raw role-string check, and never
// an operationalRole treated as authority (the resolver itself already
// enforces that; nothing here bypasses it). Fails closed on: no actor
// id, no active assignments (a brand-new/unprovisioned actor), a stale/
// malformed actor accessVersion, or a resolver DENY for any other
// reason.
async function resolvePrincipalPermission(
  principalUid: string,
  permissionId: string,
  target: TargetContext,
): Promise<ResolveResult> {
  assertNonEmptyString(principalUid, "principalUid");
  const db = getFirestore();
  const [userSnap, assignmentsSnap] = await Promise.all([
    db.collection(USERS_COLLECTION).doc(principalUid).get(),
    db
      .collection(ROLE_ASSIGNMENTS_COLLECTION)
      .where("principalUid", "==", principalUid)
      .where("status", "==", "active")
      .get(),
  ]);
  const accessVersion = readAuthoritativeAccessVersion(userSnap);
  const assignments = assignmentsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as never[];
  return resolveEffectivePermission({
    permissionId,
    assignments,
    roles: COMPATIBILITY_ROLES,
    currentAccessVersion: accessVersion,
    target,
  });
}

async function verifyActorPermission(
  actorUid: string,
  permissionId: string,
  target: TargetContext,
): Promise<void> {
  const result = await resolvePrincipalPermission(actorUid, permissionId, target);
  if (result.decision !== "ALLOW") {
    throw new UnauthorizedActorError(
      `actor is not authorized for "${permissionId}" (${result.reason})`,
    );
  }
}

// ADR-005 sec2.4: a privileged grant/revoke requires a second, distinct
// authorized approver. Correction (Inventory review round 4, prior
// implementation confirmed a real defect here): the previous check
// only asked "does the approver hold ANY active roleAssignment doc
// whose roleId happens to map to a privileged Role" -- it never ran
// the assignment through the same fail-closed effective-permission
// path the ACTOR gets (shape validation via isWellFormedAssignment,
// accessVersionAtGrant consistency, Scope matching). A malformed,
// stale/future-version, or narrow-scoped (non-global) assignment
// document referencing roleId "admin" could therefore satisfy the old
// check even though the resolver itself would deny that exact
// assignment for a real global action. Fixed: the approver is now run
// through the IDENTICAL resolvePrincipalPermission() path used for the
// actor, requiring "admin.roleAssignment.write" at GLOBAL scope --
// this enforces shape/version/Scope exactly like any other caller.
// The privileged-Role constraint is preserved as an explicit,
// additional check on top (not merely implied by which Permissions
// "admin" happens to carry today): the qualifying assignment's Role
// must itself be marked `privileged`, guarding against a future
// non-privileged Role gaining `admin.roleAssignment.write` without
// also being an acceptable approver authority.
async function verifyApproverIsPrivileged(approverUid: string): Promise<void> {
  const result = await resolvePrincipalPermission(approverUid, "admin.roleAssignment.write", {
    scope: { type: "global" },
    condition: {},
  });
  if (result.decision !== "ALLOW") {
    throw new InsufficientApproverAuthorityError(
      `approverUid is not currently authorized for "admin.roleAssignment.write" at global scope (${result.reason})`,
    );
  }
  const matchedRole = result.matchedRoleId ? ASSIGNABLE_ROLES[result.matchedRoleId] : undefined;
  if (!matchedRole?.privileged) {
    throw new InsufficientApproverAuthorityError(
      "approverUid's qualifying Role assignment is not a privileged Role",
    );
  }
}

export interface CommandOutcome {
  status: "applied" | "alreadyApplied" | "denied";
  auditEventId: string;
  accessVersionAfter?: number;
}

// Independent review round 1: the idempotency gate must never let a
// reused idempotencyKey silently resolve as "alreadyApplied" for a
// DIFFERENT logical command -- that would both report the wrong
// command's accessVersionAfter and skip the current command's actual
// mutation. Compares the action/targetType/targetId an EXISTING Audit
// Event at this id was written for against what the CURRENT call
// expects; any mismatch fails closed (a conflict, not a silent no-op).
function assertSameCommandFingerprint(
  idempotencyKey: string,
  existing: Record<string, unknown>,
  expected: { action: string; targetType: string; targetId: string },
): void {
  if (
    existing.action !== expected.action ||
    existing.targetType !== expected.targetType ||
    existing.targetId !== expected.targetId
  ) {
    throw new IdempotencyKeyConflictError(
      `idempotencyKey "${idempotencyKey}" was already used for a different command (existing: action="${existing.action}", targetType="${existing.targetType}", targetId="${existing.targetId}"; this call: action="${expected.action}", targetType="${expected.targetType}", targetId="${expected.targetId}") -- reuse a fresh idempotencyKey per logical operation`,
    );
  }
  // Independent review round 2: an Audit Event is IMMUTABLE (Spec
  // sec14) -- a previously DENIED attempt at this idempotencyKey can
  // never later become "applied" by silently falling through as
  // "alreadyApplied" (that would report accessVersionAfter=undefined
  // as if the call succeeded, while the real mutation -- the whole
  // reason the caller retried -- silently never runs, forever, for
  // this key). Fails loud instead: the caller must mint a fresh
  // idempotencyKey to retry a previously-denied attempt.
  if (existing.outcome === "denied") {
    throw new IdempotencyKeyAlreadyDeniedError(
      `idempotencyKey "${idempotencyKey}" was already used for a DENIED attempt of this command -- Audit Events are immutable, so this key can never become "applied"; retry with a fresh idempotencyKey`,
    );
  }
}

// Deterministic secondary id for a CONFLICTING reuse of an
// idempotencyKey (independent review round 4): derived only from the
// idempotencyKey plus the conflicting attempt's own action/targetType/
// targetId, so a repeated retry of the exact SAME conflicting call
// always resolves to the SAME derived id (no duplicate audit spam),
// while a THIRD, differently-shaped conflicting attempt gets its own
// distinct derived id. This is still an ordinary AuditEvent document in
// the existing `auditEvents` collection, under the exact Spec sec5.8
// shape -- no new object/collection/schema is introduced; only the id-
// derivation rule differs for this specific conflict case.
function deriveConflictAuditId(
  idempotencyKey: string,
  fingerprint: { action: string; targetType: string; targetId: string },
): string {
  const hash = createHash("sha256")
    .update(`${fingerprint.action}|${fingerprint.targetType}|${fingerprint.targetId}`)
    .digest("hex")
    .slice(0, 16);
  return `${idempotencyKey}--conflict--${hash}`;
}

// Exactly one immutable Audit Event per applied OR DENIED command
// attempt (Task 12). Idempotent on the same idempotencyKey as the
// applied path -- if this exact call already produced an Audit Event
// for the SAME command/target (applied or a prior denial), this is a
// no-op; it never overwrites the immutable primary record.
//
// Correction (Inventory review round 4, prior implementation confirmed
// a real defect here): reusing an idempotencyKey for a DIFFERENT
// command/target used to silently return without recording anything --
// the calling command still failed loud (its own real error, e.g.
// UnauthorizedActorError, always propagates via withDeniedAuditOnError
// regardless of this function's outcome), but the audit trail for that
// SECOND, distinct denial was lost entirely, contradicting "every
// authorization-relevant denial emits exactly one denied Audit Event."
// Fixed: a fingerprint MISMATCH now records the conflicting denial at a
// separate, deterministic id (deriveConflictAuditId) rather than
// silently dropping it or overwriting the immutable primary record --
// satisfying both the immutable-Audit-Event contract (Spec sec14) and
// complete denial auditing (Task 12) without inventing any new object
// or schema.
async function recordDeniedAttempt(
  idempotencyKey: string,
  auditInput: Omit<RecordAuditEventInput, "outcome" | "accessVersionAfter">,
): Promise<void> {
  const db = getFirestore();
  const primaryRef = auditEventDocRef(idempotencyKey);
  await db.runTransaction(async (txn) => {
    const primarySnap = await txn.get(primaryRef);
    if (!primarySnap.exists) {
      stageAuditEventWithId(txn, idempotencyKey, { ...auditInput, outcome: "denied" });
      return;
    }
    const existing = primarySnap.data() as Record<string, unknown>;
    const sameCommand =
      existing.action === auditInput.action &&
      existing.targetType === auditInput.targetType &&
      existing.targetId === auditInput.targetId;
    if (sameCommand) {
      // Same command/target already recorded at this key (applied or a
      // prior denial) -- nothing new to record; the immutable primary
      // record remains authoritative and untouched.
      return;
    }
    const conflictId = deriveConflictAuditId(idempotencyKey, auditInput);
    const conflictRef = auditEventDocRef(conflictId);
    const conflictSnap = await txn.get(conflictRef);
    if (conflictSnap.exists) return; // this exact conflicting retry already recorded
    const conflictNote = ` [idempotencyKey "${idempotencyKey}" reuse conflict -- a different command/target already used this key]`;
    // Guarantee the concatenated summary never exceeds the writer's own
    // MAX_SUMMARY_LENGTH cap (500) regardless of how long auditInput's
    // own summary happens to be.
    const truncatedSummary = auditInput.summary.slice(0, 499 - conflictNote.length);
    stageAuditEventWithId(txn, conflictId, {
      ...auditInput,
      outcome: "denied",
      summary: `${truncatedSummary}${conflictNote}`,
    });
  });
}

// Wraps a command's pre-mutation verification phase (role/scope lookup,
// self-approval/approver checks, verifyActorPermission): any error
// thrown inside `verify` is recorded as exactly one "denied" Audit
// Event (idempotent on idempotencyKey) before being re-thrown unchanged
// -- callers still see and can assert on the SPECIFIC error class.
async function withDeniedAuditOnError<T>(
  idempotencyKey: string,
  auditContext: Omit<RecordAuditEventInput, "outcome" | "accessVersionAfter" | "summary">,
  verify: () => Promise<T>,
): Promise<T> {
  try {
    return await verify();
  } catch (err) {
    await recordDeniedAttempt(idempotencyKey, {
      ...auditContext,
      summary: `Denied: ${(err as Error).message}`,
    });
    throw err;
  }
}

interface AccessMutationPlan {
  principalUid: string;
  auditInput: Omit<RecordAuditEventInput, "accessVersionAfter">;
  apply: (txn: Transaction, ctx: { newAccessVersion: number }) => void;
  // Runs AFTER the Firestore transaction commits, BEFORE the claims
  // refresh -- e.g. setUserStatus's Auth disable/enable call. Must be
  // idempotent on its own (safe to repeat on retry).
  postCommitAuthAction?: () => Promise<void>;
}

// The shared orchestrator for every command that DOES change what a
// principal is authorized to do (grantRole, revokeRole,
// assignApprovedRole, setUserStatus). Implements: the idempotency gate
// (Audit Event doc existence, deterministic on idempotencyKey -- never
// process memory); the atomic Firestore transaction (business mutation
// + accessVersion increment + exactly one Audit Event, all-or-nothing);
// and the post-commit, retry-safe claims synchronization.
async function runAccessMutationCommand(
  idempotencyKey: string,
  plan: AccessMutationPlan,
): Promise<CommandOutcome> {
  const db = getFirestore();
  const auditRef = auditEventDocRef(idempotencyKey);
  const userRef = db.collection(USERS_COLLECTION).doc(plan.principalUid);

  const result = await db.runTransaction(async (txn): Promise<CommandOutcome> => {
    const auditSnap = await txn.get(auditRef);
    if (auditSnap.exists) {
      const existing = auditSnap.data() as Record<string, unknown>;
      assertSameCommandFingerprint(idempotencyKey, existing, plan.auditInput);
      return {
        status: "alreadyApplied",
        auditEventId: idempotencyKey,
        accessVersionAfter: existing.accessVersionAfter as number | undefined,
      };
    }

    const userSnap = await txn.get(userRef);
    const currentAccessVersion = readAuthoritativeAccessVersion(userSnap);
    const newAccessVersion = currentAccessVersion + 1;

    plan.apply(txn, { newAccessVersion });

    txn.set(
      userRef,
      { accessVersion: newAccessVersion, pendingClaimsSyncAccessVersion: newAccessVersion },
      { merge: true },
    );

    stageAuditEventWithId(txn, idempotencyKey, {
      ...plan.auditInput,
      accessVersionAfter: newAccessVersion,
    });

    return {
      status: "applied",
      auditEventId: idempotencyKey,
      accessVersionAfter: newAccessVersion,
    };
  });

  // Post-commit, cross-service, retry-safe. Runs even on the
  // "alreadyApplied" (idempotent no-op) path, in case a PRIOR attempt
  // committed Firestore state but died before claims sync completed --
  // this is exactly the "a retry must resynchronize claims without
  // repeating the state mutation" requirement.
  await syncPendingClaims(plan.principalUid, plan.postCommitAuthAction);

  return result;
}

async function syncPendingClaims(
  uid: string,
  postCommitAuthAction?: () => Promise<void>,
): Promise<void> {
  const db = getFirestore();
  const userRef = db.collection(USERS_COLLECTION).doc(uid);
  const snap = await userRef.get();
  const data = snap.data() || {};
  const pending = data.pendingClaimsSyncAccessVersion;
  if (pending === undefined || pending === null) return;
  if (!isValidAccessVersionValue(pending)) {
    throw new MalformedAccessDataError(`${userRef.path}.pendingClaimsSyncAccessVersion is malformed`);
  }
  try {
    if (postCommitAuthAction) await postCommitAuthAction();
    await refreshAccessVersionClaim(uid, pending);
  } catch (err) {
    throw new ClaimsSyncPendingError(
      `Firestore state already committed (accessVersion=${pending}) but the post-commit sync failed for ${uid} -- a retry with the same idempotencyKey will resynchronize without repeating the state mutation: ${(err as Error).message}`,
    );
  }

  // Compare-and-clear (independent review round 1 finding): only clear
  // the pending marker if it STILL equals the exact value just synced.
  // Under concurrent grants on the SAME principal, a second call may
  // have already bumped pendingClaimsSyncAccessVersion further by the
  // time this (slower) call finishes its own Auth round-trip --
  // clearing unconditionally here would silently drop that newer sync
  // obligation, leaving claims possibly stale with no pending marker
  // left to ever retry it. Leaving the marker set when it no longer
  // matches lets the newer call's own sync (already in flight, or a
  // future retry) finish the job and correctly clear it once its own
  // value matches -- the invariant that matters (the marker is never
  // falsely cleared) is what this guarantees, converging to the
  // correct final claims value even though a momentary stale-claims
  // window between two racing Auth API calls isn't itself eliminable
  // without a distributed lock, out of this row's scope.
  await db.runTransaction(async (txn) => {
    const freshSnap = await txn.get(userRef);
    const freshPending = (freshSnap.data() || {}).pendingClaimsSyncAccessVersion;
    if (freshPending === pending) {
      txn.set(userRef, { pendingClaimsSyncAccessVersion: null }, { merge: true });
    }
  });
}

// Refreshes ONLY the accessVersion claim, preserving whatever
// companyId/platformAdmin/companyAdmin already exist on the principal's
// token -- setCompactClaims fully REPLACES (never merges), so this
// reads the CURRENT claims first and carries forward only the three
// other permitted fields, never anything else. Any failure here
// (including the Auth user record not existing) propagates unmasked --
// "unavailable dependency" must fail closed, never silently proceed as
// if there were no prior claims.
async function refreshAccessVersionClaim(uid: string, accessVersion: number): Promise<void> {
  const user = await getAuth().getUser(uid);
  const existingClaims = (user.customClaims || {}) as Record<string, unknown>;
  const nextClaims: Record<string, unknown> = { accessVersion };
  if (typeof existingClaims.companyId === "string") nextClaims.companyId = existingClaims.companyId;
  if (typeof existingClaims.platformAdmin === "boolean") {
    nextClaims.platformAdmin = existingClaims.platformAdmin;
  }
  if (typeof existingClaims.companyAdmin === "boolean") {
    nextClaims.companyAdmin = existingClaims.companyAdmin;
  }
  await setCompactClaims(uid, nextClaims as CompactClaims);
}

// ---------------------------------------------------------------------
// grantRole -- the privileged-eligible path (requires a second,
// distinct, independently-authorized approver whenever the target Role
// is privileged).
// ---------------------------------------------------------------------
export interface GrantRoleInput {
  actorUid: string;
  principalUid: string;
  roleId: string;
  scope: Scope;
  approverUid?: string;
  idempotencyKey: string;
}

export async function grantRole(input: GrantRoleInput): Promise<CommandOutcome> {
  assertValidIdempotencyKey(input.idempotencyKey);
  assertNonEmptyString(input.actorUid, "actorUid");
  assertNonEmptyString(input.principalUid, "principalUid");
  assertNonEmptyString(input.roleId, "roleId");
  assertValidScope(input.scope);

  await withDeniedAuditOnError(
    // targetId is the PRINCIPAL, not the idempotencyKey/assignment id
    // (independent review round 1: reusing this idempotencyKey for a
    // DIFFERENT principal must be distinguishable by the fingerprint
    // check below -- an idempotencyKey-shaped targetId would be
    // identical across both calls and could never catch that).
    input.idempotencyKey,
    { actorUid: input.actorUid, action: "grantRole", targetType: "roleAssignment", targetId: input.principalUid },
    async () => {
      const role = ASSIGNABLE_ROLES[input.roleId];
      if (!role) throw new UnknownRoleError(`unknown roleId: "${input.roleId}"`);

      if (role.privileged) {
        if (input.actorUid === input.principalUid) {
          throw new SelfApprovalError("an actor may not grant themselves a privileged Role");
        }
        if (!input.approverUid) {
          throw new InvalidInputError("approverUid is required to grant a privileged Role");
        }
        if (input.approverUid === input.actorUid || input.approverUid === input.principalUid) {
          throw new SelfApprovalError(
            "approverUid must be distinct from both actorUid and principalUid",
          );
        }
        await verifyApproverIsPrivileged(input.approverUid);
      }

      await verifyActorPermission(input.actorUid, "admin.roleAssignment.write", {
        scope: { type: "global" },
        condition: {},
      });
    },
  );

  const db = getFirestore();
  const assignmentRef = db.collection(ROLE_ASSIGNMENTS_COLLECTION).doc(input.idempotencyKey);

  return runAccessMutationCommand(input.idempotencyKey, {
    principalUid: input.principalUid,
    auditInput: {
      actorUid: input.actorUid,
      action: "grantRole",
      targetType: "roleAssignment",
      targetId: input.principalUid,
      outcome: "applied",
      summary: `Granted role "${input.roleId}" to principal ${input.principalUid}`,
      scope: input.scope,
      ...(input.approverUid !== undefined ? { approverUid: input.approverUid } : {}),
    },
    apply: (txn, ctx) => {
      txn.create(assignmentRef, {
        principalUid: input.principalUid,
        roleId: input.roleId,
        scope: input.scope,
        grantedBy: input.actorUid,
        grantedAt: FieldValue.serverTimestamp(),
        ...(input.approverUid !== undefined ? { approvedBy: input.approverUid } : {}),
        status: "active",
        accessVersionAtGrant: ctx.newAccessVersion,
      });
    },
  });
}

// ---------------------------------------------------------------------
// revokeRole
// ---------------------------------------------------------------------
export interface RevokeRoleInput {
  actorUid: string;
  assignmentId: string;
  approverUid?: string;
  idempotencyKey: string;
}

export async function revokeRole(input: RevokeRoleInput): Promise<CommandOutcome> {
  assertValidIdempotencyKey(input.idempotencyKey);
  assertNonEmptyString(input.actorUid, "actorUid");
  assertNonEmptyString(input.assignmentId, "assignmentId");

  const db = getFirestore();
  const assignmentRef = db.collection(ROLE_ASSIGNMENTS_COLLECTION).doc(input.assignmentId);

  const { principalUid, roleId } = await withDeniedAuditOnError(
    input.idempotencyKey,
    { actorUid: input.actorUid, action: "revokeRole", targetType: "roleAssignment", targetId: input.assignmentId },
    async () => {
      const assignmentSnap = await assignmentRef.get();
      if (!assignmentSnap.exists) {
        throw new UnavailableAccessDataError(`roleAssignments/${input.assignmentId} does not exist`);
      }
      const assignmentData = assignmentSnap.data() as Record<string, unknown>;
      if (
        typeof assignmentData.principalUid !== "string" ||
        typeof assignmentData.roleId !== "string"
      ) {
        throw new MalformedAccessDataError(`roleAssignments/${input.assignmentId} is malformed`);
      }
      try {
        assertValidScope(assignmentData.scope);
      } catch (err) {
        throw new MalformedAccessDataError(
          `roleAssignments/${input.assignmentId}.scope is malformed: ${(err as Error).message}`,
        );
      }
      const principalUidValue = assignmentData.principalUid;
      const roleIdValue = assignmentData.roleId;
      const assignmentScope = assignmentData.scope;
      const role = ASSIGNABLE_ROLES[roleIdValue];
      // Independent review round 1: an unrecognized roleId must fail
      // closed, never be silently treated as "not privileged" (which
      // would skip the second-approver requirement for a Role this
      // catalog doesn't even know about -- exactly the fail-open
      // pattern Spec sec13 prohibits). This mirrors grantRole/
      // assignApprovedRole's own `if (!role) throw UnknownRoleError`.
      if (!role) {
        throw new UnknownRoleError(
          `roleAssignments/${input.assignmentId} references unknown roleId "${roleIdValue}"`,
        );
      }

      if (role.privileged) {
        if (input.actorUid === principalUidValue) {
          throw new SelfApprovalError("an actor may not revoke their own privileged Role");
        }
        if (!input.approverUid) {
          throw new InvalidInputError("approverUid is required to revoke a privileged Role");
        }
        if (input.approverUid === input.actorUid || input.approverUid === principalUidValue) {
          throw new SelfApprovalError(
            "approverUid must be distinct from both actorUid and principalUid",
          );
        }
        await verifyApproverIsPrivileged(input.approverUid);
      }

      await verifyActorPermission(input.actorUid, "admin.roleAssignment.write", {
        scope: assignmentScope,
        condition: {},
      });

      return { principalUid: principalUidValue, roleId: roleIdValue };
    },
  );

  return runAccessMutationCommand(input.idempotencyKey, {
    principalUid,
    auditInput: {
      actorUid: input.actorUid,
      action: "revokeRole",
      targetType: "roleAssignment",
      targetId: input.assignmentId,
      outcome: "applied",
      summary: `Revoked role "${roleId}" from principal ${principalUid}`,
      ...(input.approverUid !== undefined ? { approverUid: input.approverUid } : {}),
    },
    apply: (txn) => {
      txn.update(assignmentRef, { status: "disabled" });
    },
  });
}

// ---------------------------------------------------------------------
// assignApprovedRole -- the single-admin path, limited to repository-
// approved, NON-PRIVILEGED Roles only (ADR-005 sec2.4).
// ---------------------------------------------------------------------
export interface AssignApprovedRoleInput {
  actorUid: string;
  principalUid: string;
  roleId: string;
  scope: Scope;
  idempotencyKey: string;
}

export async function assignApprovedRole(
  input: AssignApprovedRoleInput,
): Promise<CommandOutcome> {
  assertValidIdempotencyKey(input.idempotencyKey);
  assertNonEmptyString(input.actorUid, "actorUid");
  assertNonEmptyString(input.principalUid, "principalUid");
  assertNonEmptyString(input.roleId, "roleId");
  assertValidScope(input.scope);

  await withDeniedAuditOnError(
    // targetId is the PRINCIPAL, not the idempotencyKey/assignment id --
    // see grantRole's identical comment (independent review round 1).
    input.idempotencyKey,
    { actorUid: input.actorUid, action: "assignApprovedRole", targetType: "roleAssignment", targetId: input.principalUid },
    async () => {
      const role = ASSIGNABLE_ROLES[input.roleId];
      if (!role) throw new UnknownRoleError(`unknown roleId: "${input.roleId}"`);
      if (role.privileged) {
        throw new InvalidStateError(
          `roleId "${input.roleId}" is privileged -- use grantRole with a distinct approver, not assignApprovedRole`,
        );
      }

      await verifyActorPermission(input.actorUid, "admin.roleAssignment.write", {
        scope: { type: "global" },
        condition: {},
      });
    },
  );

  const db = getFirestore();
  const assignmentRef = db.collection(ROLE_ASSIGNMENTS_COLLECTION).doc(input.idempotencyKey);

  return runAccessMutationCommand(input.idempotencyKey, {
    principalUid: input.principalUid,
    auditInput: {
      actorUid: input.actorUid,
      action: "assignApprovedRole",
      targetType: "roleAssignment",
      targetId: input.principalUid,
      outcome: "applied",
      summary: `Assigned pre-approved role "${input.roleId}" to principal ${input.principalUid}`,
      scope: input.scope,
    },
    apply: (txn, ctx) => {
      txn.create(assignmentRef, {
        principalUid: input.principalUid,
        roleId: input.roleId,
        scope: input.scope,
        grantedBy: input.actorUid,
        grantedAt: FieldValue.serverTimestamp(),
        status: "active",
        accessVersionAtGrant: ctx.newAccessVersion,
      });
    },
  });
}

// ---------------------------------------------------------------------
// bootstrapCompatibilityAdmin -- ONE-TIME, audited migration of an existing
// LEGACY compatibility administrator (`users/{uid}.role === "admin"`, the
// pre-governed raw-role source of truth) into the governed roleAssignment
// model. Break-glass seam for the chicken-and-egg bootstrap: grantRole/
// assignApprovedRole resolve `admin.roleAssignment.write` through the
// resolver (which reads roleAssignments, NOT `users.role`), so the FIRST
// governed admin cannot be created by them. This command's authority is NOT
// a governed grant -- it is (1) the existing legacy `users.role === "admin"`
// fact, (2) an enabled Auth user whose email exactly matches the approved
// binding, and (3) designated-technical-operator infrastructure access
// (ADR-009 controlled technical exception: explicitly authorized, narrowly
// scoped, audited, idempotent, never a routine business workflow). It
// migrates existing authority -- granting nothing the legacy raw-role model
// did not already confer -- and does NOT weaken two-person approval for
// FUTURE privileged grants (those still route through grantRole with a
// distinct approver). It creates only a Firestore roleAssignment; never
// Firebase/Google Cloud IAM, never a manual document edit. The audit
// distinguishes the infrastructure operator (actorUid) from the migrated
// principal (targetId) and records the source legacy authority + migration
// provenance + project + approved commit in the summary (no email/PII).
export interface BootstrapCompatibilityAdminInput {
  operatorUid: string; // infrastructure operator identity (audit actorUid)
  uid: string; // target principal being migrated (audit targetId)
  expectedEmail: string; // the Auth user's email must match this exactly
  provenanceCommit: string; // approved repository commit, recorded in the audit
  idempotencyKey: string; // fresh per attempt (a denied attempt burns its key)
}
const LEGACY_ADMIN_ROLE_ID = "admin";
const BOOTSTRAP_ADMIN_PROVENANCE = "bootstrap:legacy-admin-migration";
const BOOTSTRAP_ADMIN_PROJECT = "taylor-parts";
const bootstrapAdminAssignmentId = (uid: string): string => `bootstrap-admin-${uid}`;

// Full-equivalence test for the deterministic bootstrap assignment: only a
// document matching ALL of these is treated as "already migrated". Anything
// else at the deterministic id is a non-equivalent conflict (fail closed).
function isEquivalentBootstrapAdminAssignment(data: Record<string, unknown> | undefined, uid: string): boolean {
  const scope = data?.scope as { type?: unknown } | undefined;
  return (
    data !== undefined &&
    data.principalUid === uid &&
    data.roleId === LEGACY_ADMIN_ROLE_ID &&
    data.status === "active" &&
    data.grantedBy === BOOTSTRAP_ADMIN_PROVENANCE &&
    scope?.type === "global"
  );
}

export async function bootstrapCompatibilityAdmin(
  input: BootstrapCompatibilityAdminInput,
): Promise<CommandOutcome> {
  assertValidIdempotencyKey(input.idempotencyKey);
  assertNonEmptyString(input.operatorUid, "operatorUid");
  assertNonEmptyString(input.uid, "uid");
  assertNonEmptyString(input.expectedEmail, "expectedEmail");
  assertNonEmptyString(input.provenanceCommit, "provenanceCommit");

  const db = getFirestore();
  const assignmentRef = db.collection(ROLE_ASSIGNMENTS_COLLECTION).doc(bootstrapAdminAssignmentId(input.uid));
  const userRef = db.collection(USERS_COLLECTION).doc(input.uid);
  const auditRef = auditEventDocRef(input.idempotencyKey);
  const activeAdminQuery = db
    .collection(ROLE_ASSIGNMENTS_COLLECTION)
    .where("principalUid", "==", input.uid)
    .where("status", "==", "active")
    .where("roleId", "==", LEGACY_ADMIN_ROLE_ID);
  // actorUid = infrastructure operator (distinct from the migrated target).
  const auditContext = {
    actorUid: input.operatorUid,
    action: "bootstrapCompatibilityAdmin" as const,
    targetType: "roleAssignment",
    targetId: input.uid,
  };
  const summary =
    `bootstrap compatibility admin migration; source=legacy users.role=admin; ` +
    `provenance=${BOOTSTRAP_ADMIN_PROVENANCE}; operator=${input.operatorUid}; target=${input.uid}; ` +
    `project=${BOOTSTRAP_ADMIN_PROJECT}; commit=${input.provenanceCommit}`;

  const result = await withDeniedAuditOnError(input.idempotencyKey, auditContext, async () => {
    // --- Immediately-before-mutation Auth verification (not transactional):
    // existence, enabled state, and EXACT email must all hold. ---
    let userRecord;
    try {
      userRecord = await getAuth().getUser(input.uid);
    } catch {
      throw new InvalidStateError(`no Auth user exists for uid "${input.uid}"`);
    }
    if (userRecord.disabled) {
      throw new InvalidStateError(`Auth user "${input.uid}" is disabled`);
    }
    if (userRecord.email !== input.expectedEmail) {
      throw new InvalidStateError(`Auth user "${input.uid}" email does not match the approved binding`);
    }

    return db.runTransaction(async (txn): Promise<CommandOutcome> => {
      // Idempotency gate (identical semantics to runAccessMutationCommand):
      const auditSnap = await txn.get(auditRef);
      if (auditSnap.exists) {
        assertSameCommandFingerprint(input.idempotencyKey, auditSnap.data() as Record<string, unknown>, auditContext);
        return {
          status: "alreadyApplied",
          auditEventId: input.idempotencyKey,
          accessVersionAfter: (auditSnap.data() as Record<string, unknown>).accessVersionAfter as number | undefined,
        };
      }
      // Deterministic-assignment revalidation IN the transaction: an
      // equivalent bootstrap doc -> alreadyApplied (no second version bump);
      // a NON-equivalent doc at the deterministic id -> fail closed.
      const existingAssignment = await txn.get(assignmentRef);
      if (existingAssignment.exists) {
        if (isEquivalentBootstrapAdminAssignment(existingAssignment.data() as Record<string, unknown>, input.uid)) {
          return { status: "alreadyApplied", auditEventId: input.idempotencyKey };
        }
        throw new InvalidStateError(`a non-equivalent deterministic bootstrap assignment already exists (${assignmentRef.id})`);
      }
      // Legacy authority revalidation IN the transaction: users/{uid}.role
      // must be EXACTLY "admin".
      const userSnap = await txn.get(userRef);
      const legacyRole = userSnap.exists ? (userSnap.data() as Record<string, unknown>).role : undefined;
      if (legacyRole !== LEGACY_ADMIN_ROLE_ID) {
        throw new InvalidStateError(`users/${input.uid}.role is not exactly "admin" (got ${JSON.stringify(legacyRole)})`);
      }
      // No CONFLICTING active admin assignment (any other doc) IN the txn.
      const activeAdmins = await txn.get(activeAdminQuery);
      for (const doc of activeAdmins.docs) {
        if (doc.id !== assignmentRef.id) {
          throw new InvalidStateError(`a conflicting active admin roleAssignment already exists (${doc.id})`);
        }
      }
      // Atomic write: assignment (create -> fails closed on concurrent
      // create) + accessVersion bump + exactly one applied audit.
      const newAccessVersion = readAuthoritativeAccessVersion(userSnap) + 1;
      txn.create(assignmentRef, {
        principalUid: input.uid,
        roleId: LEGACY_ADMIN_ROLE_ID,
        scope: { type: "global" },
        grantedBy: BOOTSTRAP_ADMIN_PROVENANCE,
        grantedAt: FieldValue.serverTimestamp(),
        status: "active",
        accessVersionAtGrant: newAccessVersion,
      });
      txn.set(
        userRef,
        { accessVersion: newAccessVersion, pendingClaimsSyncAccessVersion: newAccessVersion },
        { merge: true },
      );
      stageAuditEventWithId(txn, input.idempotencyKey, {
        ...auditContext,
        outcome: "applied",
        summary,
        scope: { type: "global" },
        accessVersionAfter: newAccessVersion,
      });
      return { status: "applied", auditEventId: input.idempotencyKey, accessVersionAfter: newAccessVersion };
    });
  });

  // Post-commit, retry-safe claims synchronization (runs on the
  // alreadyApplied path too, in case a prior attempt committed state but
  // died before claims sync).
  await syncPendingClaims(input.uid);
  return result;
}

// ---------------------------------------------------------------------
// setUserStatus -- enforced at the Auth layer (disabled accounts cannot
// authenticate at all), with the same accessVersion-bump defense in
// depth for any token already issued before the disable.
// ---------------------------------------------------------------------
export interface SetUserStatusInput {
  actorUid: string;
  principalUid: string;
  status: "enabled" | "disabled";
  idempotencyKey: string;
}

export async function setUserStatus(input: SetUserStatusInput): Promise<CommandOutcome> {
  assertValidIdempotencyKey(input.idempotencyKey);
  assertNonEmptyString(input.actorUid, "actorUid");
  assertNonEmptyString(input.principalUid, "principalUid");
  if (input.status !== "enabled" && input.status !== "disabled") {
    throw new InvalidInputError('status must be "enabled" or "disabled"');
  }

  await withDeniedAuditOnError(
    input.idempotencyKey,
    { actorUid: input.actorUid, action: "setUserStatus", targetType: "user", targetId: input.principalUid },
    () =>
      verifyActorPermission(input.actorUid, "admin.userStatus.write", {
        scope: { type: "global" },
        condition: {},
      }),
  );

  return runAccessMutationCommand(input.idempotencyKey, {
    principalUid: input.principalUid,
    auditInput: {
      actorUid: input.actorUid,
      action: "setUserStatus",
      targetType: "user",
      targetId: input.principalUid,
      outcome: "applied",
      summary: `Set account status to "${input.status}" for principal ${input.principalUid}`,
    },
    apply: () => {
      // No Firestore field beyond accessVersion -- enable/disable is
      // enforced at the Auth layer (postCommitAuthAction).
    },
    postCommitAuthAction: async () => {
      await getAuth().updateUser(input.principalUid, {
        disabled: input.status === "disabled",
      });
    },
  });
}

// ---------------------------------------------------------------------
// approveAccessRequest / rejectAccessRequest -- decisions on an
// EXISTING pending Access Request only (Spec sec5.7: the request-
// creation workflow itself remains deferred). Deliberately does NOT
// bump accessVersion or sync claims: this row's own scope is recording
// the decision, not executing the resulting grant (that would be a
// separate call to grantRole/assignApprovedRole through a still-
// deferred workflow that connects an approved request to it).
// ---------------------------------------------------------------------
interface DecideAccessRequestInput {
  actorUid: string;
  requestId: string;
  idempotencyKey: string;
  decision: "approved" | "rejected";
  reason?: string;
}

async function decideAccessRequest(input: DecideAccessRequestInput): Promise<CommandOutcome> {
  assertValidIdempotencyKey(input.idempotencyKey);
  assertNonEmptyString(input.actorUid, "actorUid");
  assertNonEmptyString(input.requestId, "requestId");

  const db = getFirestore();
  const requestRef = db.collection(ACCESS_REQUESTS_COLLECTION).doc(input.requestId);
  const action = input.decision === "approved" ? "approveAccessRequest" : "rejectAccessRequest";

  await withDeniedAuditOnError(
    input.idempotencyKey,
    { actorUid: input.actorUid, action, targetType: "accessRequest", targetId: input.requestId },
    async () => {
      const preCheckSnap = await requestRef.get();
      if (!preCheckSnap.exists) {
        throw new UnavailableAccessDataError(`accessRequests/${input.requestId} does not exist`);
      }
      const preCheckData = preCheckSnap.data() as Record<string, unknown>;
      if (typeof preCheckData.requestedBy !== "string") {
        throw new MalformedAccessDataError(`accessRequests/${input.requestId} is malformed`);
      }
      if (preCheckData.requestedBy === input.actorUid) {
        throw new SelfApprovalError("an actor may not decide their own Access Request");
      }

      await verifyActorPermission(input.actorUid, "admin.accessRequest.decide", {
        scope: { type: "global" },
        condition: {},
      });
    },
  );

  const auditRef = auditEventDocRef(input.idempotencyKey);

  return db.runTransaction(async (txn): Promise<CommandOutcome> => {
    const auditSnap = await txn.get(auditRef);
    if (auditSnap.exists) {
      const existing = auditSnap.data() as Record<string, unknown>;
      assertSameCommandFingerprint(input.idempotencyKey, existing, {
        action,
        targetType: "accessRequest",
        targetId: input.requestId,
      });
      return { status: "alreadyApplied", auditEventId: input.idempotencyKey };
    }

    const requestSnap = await txn.get(requestRef);
    const requestData = requestSnap.data();
    if (!requestSnap.exists || !requestData) {
      throw new UnavailableAccessDataError(`accessRequests/${input.requestId} does not exist`);
    }
    if (requestData.status !== "pending") {
      throw new InvalidStateError(
        `accessRequests/${input.requestId} is not pending (status="${requestData.status}") -- a decision may only be made once`,
      );
    }

    txn.update(requestRef, {
      status: input.decision,
      decidedBy: input.actorUid,
      decidedAt: FieldValue.serverTimestamp(),
      ...(input.decision === "rejected" ? { reason: input.reason } : {}),
    });

    stageAuditEventWithId(txn, input.idempotencyKey, {
      actorUid: input.actorUid,
      action: input.decision === "approved" ? "approveAccessRequest" : "rejectAccessRequest",
      targetType: "accessRequest",
      targetId: input.requestId,
      outcome: "applied",
      summary: `${input.decision === "approved" ? "Approved" : "Rejected"} access request ${input.requestId}`,
    });

    return { status: "applied", auditEventId: input.idempotencyKey };
  });
}

export interface ApproveAccessRequestInput {
  actorUid: string;
  requestId: string;
  idempotencyKey: string;
}

export async function approveAccessRequest(
  input: ApproveAccessRequestInput,
): Promise<CommandOutcome> {
  return decideAccessRequest({ ...input, decision: "approved" });
}

export interface RejectAccessRequestInput {
  actorUid: string;
  requestId: string;
  reason: string;
  idempotencyKey: string;
}

export async function rejectAccessRequest(
  input: RejectAccessRequestInput,
): Promise<CommandOutcome> {
  assertNonEmptyString(input.reason, "reason");
  return decideAccessRequest({ ...input, decision: "rejected", reason: input.reason });
}
