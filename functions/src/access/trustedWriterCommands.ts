// Enterprise Access & Administration Platform (Issue #226) -- the six
// trusted-writer commands: grantRole, revokeRole, assignApprovedRole,
// setUserStatus, approveAccessRequest, rejectAccessRequest. Fixed by
// docs/specifications/enterprise-access-and-administration-platform.md
// sec15 and sequenced by docs/implementation-plans/enterprise-access-
// and-administration-platform.md (Row 7 / Task 12).
//
// Server-side ONLY -- not mirrored to field-ops-app-vite: clients never
// call these directly. Every command is INERT -- none is exported from
// functions/src/index.ts, so none is a deployed, callable Cloud
// Function yet. Nothing calls these from a real request path. Per
// ADR-005 sec2.6/Spec sec17, trusted-writer ACTIVATION is blocked until
// Issue #15's Cloud Functions are deployed and verified -- writing and
// testing this module now is explicitly allowed ("pure authorization-
// logic resolution" work); exporting/deploying it as a callable
// endpoint is a separate, later-authorized action.
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
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import type {
  DocumentSnapshot,
  Transaction,
} from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import type { CompactClaims, Scope, ScopeType } from "../types/access";
import { COMPATIBILITY_ROLES } from "./compatibilityRoles";
import { resolveEffectivePermission, type TargetContext } from "./resolveEffectivePermission";
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

const USERS_COLLECTION = "users";
const ROLE_ASSIGNMENTS_COLLECTION = "roleAssignments";
const ACCESS_REQUESTS_COLLECTION = "accessRequests";

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
async function verifyActorPermission(
  actorUid: string,
  permissionId: string,
  target: TargetContext,
): Promise<void> {
  assertNonEmptyString(actorUid, "actorUid");
  const db = getFirestore();
  const [actorUserSnap, actorAssignmentsSnap] = await Promise.all([
    db.collection(USERS_COLLECTION).doc(actorUid).get(),
    db
      .collection(ROLE_ASSIGNMENTS_COLLECTION)
      .where("principalUid", "==", actorUid)
      .where("status", "==", "active")
      .get(),
  ]);
  const actorAccessVersion = readAuthoritativeAccessVersion(actorUserSnap);
  const assignments = actorAssignmentsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as never[];
  const result = resolveEffectivePermission({
    permissionId,
    assignments,
    roles: COMPATIBILITY_ROLES,
    currentAccessVersion: actorAccessVersion,
    target,
  });
  if (result.decision !== "ALLOW") {
    throw new UnauthorizedActorError(
      `actor is not authorized for "${permissionId}" (${result.reason})`,
    );
  }
}

// ADR-005 sec2.4: a privileged grant/revoke requires a second, distinct
// authorized approver -- "authorized" is verified here, not merely
// "a different uid": the approver must themselves currently hold an
// ACTIVE assignment for a privileged Role.
async function verifyApproverIsPrivileged(approverUid: string): Promise<void> {
  assertNonEmptyString(approverUid, "approverUid");
  const db = getFirestore();
  const snap = await db
    .collection(ROLE_ASSIGNMENTS_COLLECTION)
    .where("principalUid", "==", approverUid)
    .where("status", "==", "active")
    .get();
  const hasPrivilegedRole = snap.docs.some((doc) => {
    const roleId = doc.data().roleId;
    const role = typeof roleId === "string" ? COMPATIBILITY_ROLES[roleId] : undefined;
    return !!role?.privileged;
  });
  if (!hasPrivilegedRole) {
    throw new InsufficientApproverAuthorityError(
      "approverUid does not currently hold an active privileged Role",
    );
  }
}

export interface CommandOutcome {
  status: "applied" | "alreadyApplied" | "denied";
  auditEventId: string;
  accessVersionAfter?: number;
}

// Exactly one immutable Audit Event per applied OR DENIED command
// attempt (Task 12). Idempotent on the same idempotencyKey as the
// applied path -- if this exact call already produced an Audit Event
// (applied OR a prior denial), this is a no-op; it never overwrites.
async function recordDeniedAttempt(
  idempotencyKey: string,
  auditInput: Omit<RecordAuditEventInput, "outcome" | "accessVersionAfter">,
): Promise<void> {
  const db = getFirestore();
  const auditRef = auditEventDocRef(idempotencyKey);
  await db.runTransaction(async (txn) => {
    const snap = await txn.get(auditRef);
    if (snap.exists) return;
    stageAuditEventWithId(txn, idempotencyKey, { ...auditInput, outcome: "denied" });
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
  await userRef.set({ pendingClaimsSyncAccessVersion: null }, { merge: true });
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
    input.idempotencyKey,
    { actorUid: input.actorUid, action: "grantRole", targetType: "roleAssignment", targetId: input.idempotencyKey },
    async () => {
      const role = COMPATIBILITY_ROLES[input.roleId];
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
      targetId: input.idempotencyKey,
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
      const role = COMPATIBILITY_ROLES[roleIdValue];

      if (role?.privileged) {
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
    input.idempotencyKey,
    { actorUid: input.actorUid, action: "assignApprovedRole", targetType: "roleAssignment", targetId: input.idempotencyKey },
    async () => {
      const role = COMPATIBILITY_ROLES[input.roleId];
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
      targetId: input.idempotencyKey,
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
