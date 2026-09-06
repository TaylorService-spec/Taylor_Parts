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
// SANDBOX IS DIFFERENT FROM PRODUCTION (recorded here so this claim is never
// read as "undeployed everywhere"): all six adapters ARE deployed as live
// Cloud Functions in eos-platform-sandbox (DECISIONS.md #90 finding F-2,
// 2026-08-06). No client UI calls them there either, and no principal in any
// environment yet holds the `roleAssignments` document every real call
// authorizes against (see `bootstrapCompatibilityAdmin` below -- exists but is
// not exported/callable) -- so every call still denies today, in every
// environment, for a DIFFERENT reason than "not deployed."
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
import { getApp } from "firebase-admin/app";
import type { CompactClaims, Scope, ScopeType, Role } from "../types/access";
import { ENVIRONMENT_ACTIVATION_REGISTRY, type ActivationRegistryEnv } from "./environmentCapabilityOverrides";
import { COMPATIBILITY_ROLES } from "./compatibilityRoles";
import { roleHasAnyBindingAtAssignmentScope, NO_BINDING_AT_SCOPE_REASON } from "./bindingScopePolicy";
import { OPERATING_COMPANY_IDS } from "../ownership/operatingCompanyAuthority";
import { BUSINESS_UNITS } from "../finance/financialAttribution";
import {
  INVENTORY_CREATE_EXECUTOR_ROLE,
  INVENTORY_CATALOG_ADMINISTRATOR_ROLE,
  WORK_ORDER_PARTS_PLANNER_ROLE,
  CRM_ACTIVITY_CONTRIBUTOR_ROLE,
  INVENTORY_TRANSFER_OPERATOR_ROLE,
  INVENTORY_CYCLE_COUNT_COUNTER_ROLE,
  INVENTORY_CYCLE_COUNT_RECONCILER_ROLE,
  INVENTORY_PUT_AWAY_OPERATOR_ROLE,
  INVENTORY_BIN_ADMINISTRATOR_ROLE,
  INVENTORY_RETURNS_INTAKE_CLERK_ROLE,
  INVENTORY_LOOKUP_READER_ROLE,
  GENERAL_EMPLOYEE_ROLE,
  OFFICE_MANAGER_ROLE,
  SALES_MANAGER_ROLE,
  MARKETING_MANAGER_ROLE,
  PURCHASING_MANAGER_ROLE,
  SHOP_MANAGER_ROLE,
  SHOP_ASSOCIATE_ROLE,
  REPORT_VIEWER_ROLE,
  REPORT_FINANCE_VIEWER_ROLE,
  REPORT_AUTHOR_ROLE,
  EQUIPMENT_CATALOG_ADMINISTRATOR_ROLE,
  INVENTORY_RECEIVING_CLERK_ROLE,
  INVENTORY_SERIALIZED_ASSET_ACQUIRER_ROLE,
  EQUIPMENT_INSTALLER_ROLE,
  TECHNICIAN_LABOR_RECORDER_ROLE,
  WORK_ORDER_LABOR_CORRECTOR_ROLE,
  PERFORMANCE_GOAL_SUBJECT_ROLE,
  EMAIL_INTAKE_ADMINISTRATOR_ROLE,
  SERVICE_INBOUND_WORK_REVIEWER_ROLE,
  SALESPERSON_ROLE,
  GENERAL_MANAGER_ROLE,
  WAREHOUSE_MANAGER_ROLE,
  WAREHOUSE_ASSOCIATE_ROLE,
  PARTS_MANAGER_ROLE,
  PARTS_ASSOCIATE_ROLE,
  CONTROLLER_ROLE,
  SUPPORT_STAFF_ROLE,
  ACCOUNTING_MANAGER_ROLE,
  FINANCE_MANAGER_ROLE,
  FIELD_MANAGER_ROLE,
  OPERATIONS_MANAGER_ROLE,
  OWNER_ROLE,
} from "./governedBusinessRoles";
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

// R-32 (#152) -- grant-time defence in depth. Raised when NO binding on the requested Role could
// ever be conferred from the requested Scope.type, which would create an assignment granting
// nothing. Deliberately NOT raised when only SOME bindings are invalid at that scope: a mixed Role
// is the normal case (partsManager carries sixteen permissions, two location-restricted), and
// refusing those would make `partsManager @ global` and `partsManager @ location:wh-main`
// mutually exclusive -- the exact composition R-32 section 4 requires to remain valid.
export class NoBindingAtRequestedScopeError extends Error {}
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
const EMPLOYEES_COLLECTION = "employees";
const ROLE_ASSIGNMENTS_COLLECTION = "roleAssignments";
const ACCESS_REQUESTS_COLLECTION = "accessRequests";

// Curated registry of Roles assignable through the trusted role-assignment
// commands. It is the compatibility Roles PLUS an explicit allowlist of
// GOVERNED business Roles cleared for the trusted-command grant path --
// deliberately NOT an alias of GOVERNED_BUSINESS_ROLES (declaring a Role in
// governedBusinessRoles.ts still does not make it assignable here by
// itself; it must be explicitly added below under its own governed gate).
// INV-1 / ADR-009 / Decision #42 started this registry with the sole,
// operational, non-privileged `inventoryCreateExecutor`. All four
// role-lookup sites below resolve against this registry uniformly, so an
// unknown or non-allowlisted roleId fails closed (UnknownRoleError) exactly
// as before.
//
// EXTENDED, first for six more operational Roles, and now (Owner ruling,
// "grantable-governed-roles" workstream) for the remaining eight: `owner`,
// `operationsManager`, `officeManager`, `salesManager`, `accountingManager`,
// `financeManager`, `fieldManager`, `generalEmployee`. Each was declared in
// governedBusinessRoles.ts to carry a specific capability set and was
// consequently un-assignable by ANY path -- the Role existed, the
// capability existed, the environment could even activate it, and no
// principal could ever hold it. That is the same defect class as a
// capability carried by no Role at all: authority that exists on paper and
// cannot be conferred in practice. This registry is now EVERY id
// GOVERNED_BUSINESS_ROLES declares (all 15) -- Owner's explicit direction
// was "make all 15 governed business roles grantable" -- but it remains a
// hand-enumerated object literal, not `= GOVERNED_BUSINESS_ROLES`, so a
// FUTURE Role added to that catalog does NOT become assignable merely by
// being declared; it still requires an explicit line added here under
// review, preserving the "declaring != assignable" property for anything
// not yet on this list.
//
// PRIVILEGED-ROLE EXCEPTION: `owner` is privileged:true (same as the
// compatibility `admin` Role it mirrors) and is now the ONE privileged
// entry in this registry -- everything else here is privileged:false. This
// is safe WITHOUT any new protection code because the two-person rule is
// keyed off `role.privileged`, not off which allowlist a Role came from:
// grantRole/revokeRole already (a) require a distinct approverUid whenever
// the TARGET Role is privileged, (b) forbid actorUid === principalUid for a
// privileged Role (self-grant ban), (c) forbid approverUid === actorUid or
// approverUid === principalUid (self-approval ban), and (d) require the
// approver to independently resolve `admin.roleAssignment.write` at global
// scope AND hold a Role marked `privileged` (verifyApproverIsPrivileged) --
// all four apply to `owner` exactly as they already do to `admin`, with no
// code change needed here. assignApprovedRole's own `if (role.privileged)
// throw InvalidStateError` also already refuses `owner` on the
// single-admin path, unchanged. A dedicated test below proves each of
// these holds for `owner` specifically (not merely inherited by
// assertion), and a second test proves the OTHER fifteen entries all
// remain non-privileged, so this registry cannot silently grow a second
// privileged entry without failing CI.
//
// Adding a Role here still grants NOTHING. It only makes the Role reachable by grantRole/
// assignApprovedRole, each of which remains a governed, audited, idempotent trusted-writer command.
const GOVERNED_ASSIGNABLE_ROLES: Readonly<Record<string, Role>> = Object.freeze({
  inventoryCreateExecutor: INVENTORY_CREATE_EXECUTOR_ROLE,
  inventoryCatalogAdministrator: INVENTORY_CATALOG_ADMINISTRATOR_ROLE,
  workOrderPartsPlanner: WORK_ORDER_PARTS_PLANNER_ROLE,
  crmActivityContributor: CRM_ACTIVITY_CONTRIBUTOR_ROLE,
  inventoryTransferOperator: INVENTORY_TRANSFER_OPERATOR_ROLE,
  inventoryCycleCountCounter: INVENTORY_CYCLE_COUNT_COUNTER_ROLE,
  inventoryCycleCountReconciler: INVENTORY_CYCLE_COUNT_RECONCILER_ROLE,
  // SCANNER PROMOTION 2026-08-20. Listed here as well as in GOVERNED_BUSINESS_ROLES for exactly the
  // reason the comment above gives: without an entry here a Role is defined, visible in the catalog,
  // and impossible to give anyone. All four are non-privileged, and adding them still grants
  // NOTHING -- it only makes them reachable by the governed, audited grantRole path.
  inventoryPutAwayOperator: INVENTORY_PUT_AWAY_OPERATOR_ROLE,
  inventoryBinAdministrator: INVENTORY_BIN_ADMINISTRATOR_ROLE,
  inventoryReturnsIntakeClerk: INVENTORY_RETURNS_INTAKE_CLERK_ROLE,
  inventoryLookupReader: INVENTORY_LOOKUP_READER_ROLE,
  generalEmployee: GENERAL_EMPLOYEE_ROLE,
  officeManager: OFFICE_MANAGER_ROLE,
  salesManager: SALES_MANAGER_ROLE,
  // Owner ruling 2026-08-19. Listed HERE as well as in GOVERNED_BUSINESS_ROLES: this
  // allowlist is what makes a Role actually grantable, and a Role defined but absent from
  // it resolves UnknownRoleError at assignment time -- defined, visible in the catalog,
  // and impossible to give anyone.
  marketingManager: MARKETING_MANAGER_ROLE,
  purchasingManager: PURCHASING_MANAGER_ROLE,
  shopManager: SHOP_MANAGER_ROLE,
  shopAssociate: SHOP_ASSOCIATE_ROLE,
  // Owner decisions 2026-08-21: tiered Reporting, standalone Equipment catalog administration,
  // and Receiving as a named station. A Role absent from this allowlist is grantable to nobody,
  // which is the Admin Superset gap this program already closed once.
  reportViewer: REPORT_VIEWER_ROLE,
  reportFinanceViewer: REPORT_FINANCE_VIEWER_ROLE,
  reportAuthor: REPORT_AUTHOR_ROLE,
  equipmentCatalogAdministrator: EQUIPMENT_CATALOG_ADMINISTRATOR_ROLE,
  inventoryReceivingClerk: INVENTORY_RECEIVING_CLERK_ROLE,
  // Owner decision 2026-08-23: serialized acquisition and equipment install as SEPARATE stations.
  // Both belong here for the reason stated above -- a Role the writer cannot name is a Role nobody
  // can hold, and an unassignable Role is indistinguishable from an absent one at the moment
  // somebody tries to staff it.
  inventorySerializedAssetAcquirer: INVENTORY_SERIALIZED_ASSET_ACQUIRER_ROLE,
  equipmentInstaller: EQUIPMENT_INSTALLER_ROLE,
  // Labor Domain V1. Here for the reason stated above: a Role the writer cannot name is a Role
  // nobody can hold, and an unassignable Role is indistinguishable from an absent one at the
  // moment somebody tries to staff it.
  technicianLaborRecorder: TECHNICIAN_LABOR_RECORDER_ROLE,
  workOrderLaborCorrector: WORK_ORDER_LABOR_CORRECTOR_ROLE,
  // Performance Goal Authority. Here for the reason stated above: a Role the writer cannot name is a
  // Role nobody can hold. This one especially -- it is the ONLY way a principal whose position is a
  // compatibility Role (technician, dispatcher) can be given sight of their own target, so leaving it
  // unassignable would ship a goal system those people could never see the output of.
  performanceGoalSubject: PERFORMANCE_GOAL_SUBJECT_ROLE,
  // Email Connections + Inbound Work. Here for the reason stated above: a Role the writer cannot name
  // is a Role nobody can hold, and the whole point of declaring these two separately is that an
  // organisation can staff configuration and queue review with different people.
  emailIntakeAdministrator: EMAIL_INTAKE_ADMINISTRATOR_ROLE,
  serviceInboundWorkReviewer: SERVICE_INBOUND_WORK_REVIEWER_ROLE,
  salesperson: SALESPERSON_ROLE,
  generalManager: GENERAL_MANAGER_ROLE,
  warehouseManager: WAREHOUSE_MANAGER_ROLE,
  warehouseAssociate: WAREHOUSE_ASSOCIATE_ROLE,
  partsManager: PARTS_MANAGER_ROLE,
  partsAssociate: PARTS_ASSOCIATE_ROLE,
  controller: CONTROLLER_ROLE,
  supportStaff: SUPPORT_STAFF_ROLE,
  accountingManager: ACCOUNTING_MANAGER_ROLE,
  financeManager: FINANCE_MANAGER_ROLE,
  fieldManager: FIELD_MANAGER_ROLE,
  operationsManager: OPERATIONS_MANAGER_ROLE,
  owner: OWNER_ROLE,
});

// Exported for the invariant tests: everything in the allowlist above must be either
// non-privileged, or must be exactly `owner` (the one Role this registry deliberately makes
// grantable through the existing, unmodified privileged two-person path -- see the comment above).
export const GOVERNED_ASSIGNABLE_ROLE_IDS: readonly string[] = Object.freeze(
  Object.keys(GOVERNED_ASSIGNABLE_ROLES),
);
export const __GOVERNED_ASSIGNABLE_ROLES_FOR_TEST: Readonly<Record<string, Role>> =
  GOVERNED_ASSIGNABLE_ROLES;
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
  "operatingCompany",
  "businessUnit",
];

// FIN-BLOCK-001: financial reach scopes bind to GOVERNED ids only — free text is refused at
// grant time. Companies come from the operating-company authority; units from the canonical
// business-unit vocabulary. Value validation for these two types happens here (grant validation)
// so an unbindable assignment can never be written, matching the fail-closed resolver side.
const GOVERNED_SCOPE_VALUE_SETS: Partial<Record<ScopeType, readonly string[]>> = {
  operatingCompany: Object.values(OPERATING_COMPANY_IDS),
  businessUnit: BUSINESS_UNITS,
};

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
  const governedValues = GOVERNED_SCOPE_VALUE_SETS[scope.type as ScopeType];
  if (governedValues) {
    if (typeof scope.value !== "string" || scope.value.length === 0) {
      throw new InvalidInputError(`scope.value is required for a ${scope.type} scope`);
    }
    if (!governedValues.includes(scope.value)) {
      throw new InvalidInputError(
        `scope.value "${scope.value}" is not a governed ${scope.type} id (expected one of: ${governedValues.join(", ")})`,
      );
    }
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

      // R-32 (#152) -- the SAME binding-scope opinion resolveEffectivePermission enforces, asked
      // here so an assignment that could confer nothing is never created. Defence in depth, NOT
      // the invariant: assignments written before R-32 already exist and this check cannot see
      // them, which is why resolution-time enforcement is the authoritative one.
      if (!roleHasAnyBindingAtAssignmentScope(role, input.scope.type)) {
        throw new NoBindingAtRequestedScopeError(
          NO_BINDING_AT_SCOPE_REASON +
            `: no permission on role "${input.roleId}" may be conferred from a ` +
            `"${input.scope.type}"-scoped assignment`,
        );
      }

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

// =====================================================================
// CERTIFICATION AUTHORITY GENESIS -- the first role assignment in an empty
// non-production world, and nothing else, ever.
// =====================================================================
//
// ============================ THE PROBLEM THIS SOLVES, EXACTLY ============================
//
// `admin.roleAssignment.write` is carried by exactly ONE Role: `owner`, which is privileged.
// Granting a privileged Role requires a second, distinct approver who ALSO holds
// `admin.roleAssignment.write` through a privileged Role (verifyApproverIsPrivileged above), or --
// in the newer flow below -- an AUTHENTICATED approver whose identity comes from their own session.
//
// In a freshly installed Certification World, `roleAssignments` is empty. There is no actor, no
// approver, and no one who can authenticate. So the first grant is not merely inconvenient to
// perform through the normal path: it is IMPOSSIBLE through it, by design, and correctly so. Every
// subsequent grant is then trivially possible, because the fixture's other 86 grants are all
// NON-privileged and need only a single authorized actor with no approver at all.
//
// That asymmetry is the whole design. This function performs exactly one grant -- the one the
// governed path cannot reach in an empty world -- and hands every other grant back to grantRole().
//
// ============================ WHY THIS IS NOT A BACK DOOR ============================
//
//   ONE ROLE, NOT A PARAMETER. `roleId` is not an input. It is fixed to the single privileged Role
//   that carries admin.roleAssignment.write, so this cannot be repurposed to grant anything else.
//
//   ONLY INTO A VACUUM. It refuses if ANY active role assignment already exists in the project.
//   Not "if this principal already has one" -- ANY. A world with authority in it is a world whose
//   authority came from somewhere, and genesis is not entitled to add a second source.
//
//   NON-PRODUCTION BY ROLE, RESOLVED SERVER-SIDE. The runtime's own project identity decides, from
//   the environment registry -- never a caller-supplied argument. Production yields EMPTY overrides
//   and is refused here outright, the same way the private-AI classification is refused.
//
//   IT TELLS THE TRUTH ABOUT ITSELF. The audit action is `bootstrapCertificationAuthority`, not
//   `grantRole`, and the actor is a system genesis identity rather than a fabricated human. An
//   audit trail that recorded this as an ordinary grant by a person who did not exist yet would be
//   a lie in the one record whose entire purpose is to be trustworthy.
//
// After genesis, this function refuses forever and normal grantRole() carries every other grant
// with its ordinary eligibility, audit and idempotency intact.

// =====================================================================
// RUNTIME PROJECT IDENTITY -- one resolver, because two were already one too many
// =====================================================================
//
// ============================ THE DEFECT THIS FIXES ============================
//
// The genesis guard resolved runtime identity from GCLOUD_PROJECT / GOOGLE_CLOUD_PROJECT alone.
// That is the CLOUD FUNCTIONS convention: the platform populates those variables, no caller can
// influence them, and for a deployed function it is exactly right.
//
// It is not right for a governed ADMIN SCRIPT. Nothing populates those variables locally, so a
// live genesis run -- against a correctly resolved, correctly initialized certification app that
// had already read the governed world -- resolved its own project as `none` and refused:
//
//     REFUSED: genesis refuses an unregistered runtime project (none)
//
// The guard behaved correctly. It failed CLOSED, wrote nothing, and a following dry run still
// reported WOULD_BOOTSTRAP. The identity SOURCE was wrong, not the refusal.
//
// ============================ WHY A SHARED RESOLVER ============================
//
// This exact question was already answered correctly elsewhere in this file: the bootstrap-admin
// cross-project guard reads `getApp().options.projectId` first and falls back to the environment.
// Genesis introduced a second, weaker rule beside it instead of reusing that one -- which is the
// failure mode this module's own comments warn about everywhere else. So there is now ONE resolver
// and both callers use it.
//
// ============================ WHAT IT ASKS, AND WHY THAT ORDER ============================
//
// The initialized Admin app is asked FIRST because it is the identity that actually matters: it is
// the project this SDK will write to. An environment variable describes where the process believes
// it is running; the app describes where the write lands. When they disagree, the write wins the
// question of what is true and neither wins the question of what was intended -- so it REFUSES
// rather than picking, exactly as executionTarget refuses ambient credentials that disagree with
// --projectId.
//
// Deployed Cloud Functions behaviour is preserved: initializeApp() there resolves its projectId
// from the platform, and where it does not, the environment fallback answers as it always did.

/** Raised when the runtime cannot prove which project it is about to write to. */
export class RuntimeProjectIdentityError extends Error {
  constructor(message: string) { super(message); this.name = "RuntimeProjectIdentityError"; }
}

/**
 * PURE decision core: given what the initialized app says and what the environment says, which
 * project is this runtime writing to?
 *
 * Separated from the I/O so the rule can be tested without initializing a Firebase app or touching
 * Firestore -- the same reason resolveCapabilityOverrides is pure.
 */
export function resolveRuntimeProjectIdentity(
  appProjectId: string | null | undefined,
  envProjectId: string | null | undefined,
): string {
  const app = typeof appProjectId === "string" && appProjectId.length > 0 ? appProjectId : null;
  const env = typeof envProjectId === "string" && envProjectId.length > 0 ? envProjectId : null;

  // Disagreement is not a tie to break. One of the two is describing a different world, and there
  // is no safe way to choose which -- so neither is used.
  if (app && env && app !== env) {
    throw new RuntimeProjectIdentityError(
      `runtime project identity is ambiguous: the initialized Admin app is bound to "${app}" but `
      + `the environment names "${env}". Refusing rather than choosing.`);
  }
  const resolved = app ?? env;
  if (!resolved) {
    throw new RuntimeProjectIdentityError(
      "cannot resolve the runtime project identity from the initialized Admin app or the "
      + "environment. Refusing: a trusted write must know which project it is writing to.");
  }
  return resolved;
}

/** The project THIS runtime writes to. Reads the initialized app, then the platform environment. */
export function trustedRuntimeProjectId(): string {
  let appProjectId: string | null = null;
  try {
    appProjectId = getApp().options.projectId ?? null;
  } catch {
    // No app initialized yet. Not fatal on its own -- the environment may still answer, and the
    // resolver refuses if neither does.
    appProjectId = null;
  }
  return resolveRuntimeProjectIdentity(
    appProjectId,
    process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? null,
  );
}

/** The system identity recorded as actor for a genesis write. Deliberately not a UID shape. */
export const CERTIFICATION_GENESIS_ACTOR = "system:certification-authority-genesis";

/** The one Role genesis may establish: the only Role carrying admin.roleAssignment.write. */
export const CERTIFICATION_GENESIS_ROLE_ID = "owner";

export class GenesisNotPermittedError extends Error {
  constructor(message: string) { super(message); this.name = "GenesisNotPermittedError"; }
}

export interface BootstrapCertificationAuthorityInput {
  /** The principal receiving the genesis authority. Derived by the caller from the fixture. */
  principalUid: string;
  /** The employee id that principal is linked to, recorded in the audit summary for traceability. */
  employeeId: string;
  idempotencyKey: string;
}

/**
 * Establish the FIRST role assignment in an otherwise-empty non-production world.
 *
 * Reuses runAccessMutationCommand, so genesis gets the same atomic guarantees as every other
 * access mutation: the assignment, the accessVersion increment and exactly one Audit Event commit
 * together or not at all, and claims synchronise afterwards. Writing the document from a script
 * would have skipped all of it and produced a record indistinguishable from a governed grant while
 * being nothing like one.
 */
export async function bootstrapCertificationAuthority(
  input: BootstrapCertificationAuthorityInput,
): Promise<CommandOutcome> {
  assertValidIdempotencyKey(input.idempotencyKey);
  assertNonEmptyString(input.principalUid, "principalUid");
  assertNonEmptyString(input.employeeId, "employeeId");

  // ── NON-PRODUCTION, decided from the runtime's own identity ──────────────────────────────────
  //
  // THE PROJECT THIS SDK ACTUALLY WRITES TO, from the initialized Admin app -- not from an
  // environment variable that nothing populates outside a deployed function. The caller's
  // executionTarget ceremony chose a target; this independently verifies the SDK is bound to that
  // same project, so a caller-supplied --projectId can never be sufficient on its own.
  const projectId = trustedRuntimeProjectId();
  const env = (ENVIRONMENT_ACTIVATION_REGISTRY.environments ?? [])
    .find((e: ActivationRegistryEnv) => typeof e?.firebase?.projectId === "string" && e.firebase.projectId === projectId);
  if (!env) {
    throw new GenesisNotPermittedError(
      `genesis refuses an unregistered runtime project (${projectId})`);
  }
  if (env.role === "production") {
    throw new GenesisNotPermittedError("genesis is never permitted in a production environment");
  }

  const db = getFirestore();

  // ── ONLY INTO A VACUUM ───────────────────────────────────────────────────────────────────────
  //
  // ANY active assignment, not just one for this principal. Authority that already exists came
  // from somewhere, and a second independent source of it is the thing this must never become.
  const existing = await db.collection(ROLE_ASSIGNMENTS_COLLECTION)
    .where("status", "==", "active").limit(1).get();
  if (!existing.empty) {
    const doc = existing.docs[0].data() as Record<string, unknown>;
    throw new GenesisNotPermittedError(
      `role authority is already initialized (active assignment "${doc.roleId}" for `
      + `${doc.principalUid}). Genesis applies only to an empty world. Use grantRole.`);
  }

  const role = ASSIGNABLE_ROLES[CERTIFICATION_GENESIS_ROLE_ID];
  if (!role?.privileged) {
    // Defensive: if the catalog ever stopped marking this Role privileged, the asymmetry this
    // function exists to resolve would no longer hold and genesis would be unnecessary.
    throw new GenesisNotPermittedError(
      `"${CERTIFICATION_GENESIS_ROLE_ID}" is not a privileged Role in this catalog`);
  }

  const assignmentRef = db.collection(ROLE_ASSIGNMENTS_COLLECTION).doc(input.idempotencyKey);
  return runAccessMutationCommand(input.idempotencyKey, {
    principalUid: input.principalUid,
    auditInput: {
      actorUid: CERTIFICATION_GENESIS_ACTOR,
      action: "bootstrapCertificationAuthority",
      targetType: "roleAssignment",
      targetId: input.principalUid,
      outcome: "applied",
      summary: `GENESIS: established "${CERTIFICATION_GENESIS_ROLE_ID}" for ${input.employeeId} `
        + `(${input.principalUid}) in an empty non-production world. No prior authority existed, `
        + "so no actor or approver could be authenticated. Subsequent grants use grantRole.",
      scope: { type: "global" },
    },
    apply: (txn, ctx) => {
      txn.create(assignmentRef, {
        principalUid: input.principalUid,
        roleId: CERTIFICATION_GENESIS_ROLE_ID,
        scope: { type: "global" },
        // NOT `grantedBy: <some uid>`. No principal granted this, and saying one did would be the
        // single most misleading field in the access model.
        grantedBy: CERTIFICATION_GENESIS_ACTOR,
        grantedAt: FieldValue.serverTimestamp(),
        genesis: true,
        status: "active",
        accessVersionAtGrant: ctx.newAccessVersion,
      });
    },
  });
}

// =====================================================================
// GENESIS COMPLETION -- the runtime administration half
// =====================================================================
//
// ============================ WHY GENESIS HAS TWO HALVES ============================
//
// Certification genesis has to establish TWO different authority facts, and the first
// implementation established only one:
//
//   BUSINESS AUTHORITY        roleId "owner", from GOVERNED_BUSINESS_ROLES. What the fixture
//                             declares cw-emp-000 to be. Established by
//                             bootstrapCertificationAuthority above.
//   ADMINISTRATION AUTHORITY  roleId "admin", from COMPATIBILITY_ROLES. What actually qualifies
//                             admin.roleAssignment.write when grantRole asks. Established here.
//
// They are different because resolvePrincipalPermission -- the path every trusted-writer command
// authorizes through -- resolves against COMPATIBILITY_ROLES and ONLY those. `owner` is not in that
// catalog, so holding it is a business fact that authorizes nothing in the trusted writer. A live
// genesis owner attempting the first non-privileged grant was refused `noQualifyingGrant`, which
// was correct: the assignment was well-formed, active, in-version and globally scoped, and the
// catalog simply does not contain its roleId.
//
// THE TWO CATALOGS ARE NOT WIDENED TO FIX THIS, deliberately. Making the trusted writer resolve
// against ASSIGNABLE_ROLES would make business `owner` sufficient to administer roles in EVERY
// environment including production -- a material security widening to solve a certification
// bootstrap. The missing authority is granted explicitly instead.
//
// ============================ WHY THIS IS SEPARATE, AND NOT A REWRITE ============================
//
// The live certification project already carries a truthful genesis event: the owner assignment and
// its bootstrapCertificationAuthority audit record. That history is immutable and correct as far as
// it goes. Pretending it also recorded the admin assignment would be a lie in the audit trail, and
// re-running the original command cannot help -- it refuses over any existing assignment, by design.
//
// So this is a COMPLETION with its own action and its own record, stating plainly what it does.
// It is NOT bootstrapCompatibilityAdmin: that tool represents a legacy-admin migration, demands an
// expectedEmail and stamps `bootstrap:legacy-admin-migration` provenance. No migration occurred
// here, and recording one would be the same species of untruth.

/** The compatibility Role that actually qualifies admin.roleAssignment.write for grantRole. */
export const CERTIFICATION_GENESIS_ADMIN_ROLE_ID = "admin";

export interface CompleteCertificationAuthorityGenesisInput {
  /** The principal that already holds the owner genesis assignment. */
  principalUid: string;
  /** The employee id it is linked to, for the audit summary. */
  employeeId: string;
  idempotencyKey: string;
}

/**
 * Establish the compatibility administration half of certification genesis.
 *
 * ONLY over the exact known partial-genesis state: precisely one active assignment, and it is the
 * owner genesis assignment for this principal. Anything else refuses -- including an `admin`
 * assignment that arrived from somewhere other than genesis, which is blessed by nobody.
 */
export async function completeCertificationAuthorityGenesis(
  input: CompleteCertificationAuthorityGenesisInput,
): Promise<CommandOutcome> {
  assertValidIdempotencyKey(input.idempotencyKey);
  assertNonEmptyString(input.principalUid, "principalUid");
  assertNonEmptyString(input.employeeId, "employeeId");

  // Same runtime identity rule as genesis: the project this SDK writes to, never a caller argument.
  const projectId = trustedRuntimeProjectId();
  const env = (ENVIRONMENT_ACTIVATION_REGISTRY.environments ?? [])
    .find((e: ActivationRegistryEnv) => typeof e?.firebase?.projectId === "string" && e.firebase.projectId === projectId);
  if (!env) {
    throw new GenesisNotPermittedError(
      `genesis completion refuses an unregistered runtime project (${projectId})`);
  }
  if (env.role === "production") {
    throw new GenesisNotPermittedError(
      "genesis completion is never permitted in a production environment");
  }

  const db = getFirestore();
  const active = await db.collection(ROLE_ASSIGNMENTS_COLLECTION)
    .where("status", "==", "active").get();

  // ── ALREADY COMPLETE? Read the world, not a memo about it.
  const adminRow = active.docs
    .map((d) => d.data() as Record<string, unknown>)
    .find((r) => r.principalUid === input.principalUid && r.roleId === CERTIFICATION_GENESIS_ADMIN_ROLE_ID);
  if (adminRow) {
    // An admin assignment from ANY other source is not genesis and must not be relabelled as one.
    if (adminRow.genesis !== true || adminRow.grantedBy !== CERTIFICATION_GENESIS_ACTOR) {
      throw new GenesisNotPermittedError(
        `an "${CERTIFICATION_GENESIS_ADMIN_ROLE_ID}" assignment for ${input.principalUid} already `
        + `exists but did not come from genesis (grantedBy "${String(adminRow.grantedBy)}"). `
        + "Refusing to bless it as genesis.");
    }
    // Genesis-derived and already present: the caller's idempotency check should have caught this,
    // and runAccessMutationCommand would replay anyway. Refusing is clearer than a silent no-op.
    throw new GenesisNotPermittedError(
      "certification authority genesis is already complete; nothing to do");
  }

  // ── THE EXACT PARTIAL STATE, and nothing else.
  if (active.size !== 1) {
    throw new GenesisNotPermittedError(
      `genesis completion applies only to the exact partial state: exactly one active assignment. `
      + `Found ${active.size}. Refusing.`);
  }
  const owner = active.docs[0].data() as Record<string, unknown>;
  if (owner.principalUid !== input.principalUid
    || owner.roleId !== CERTIFICATION_GENESIS_ROLE_ID
    || owner.genesis !== true) {
    throw new GenesisNotPermittedError(
      `the single active assignment is not this principal's owner genesis assignment `
      + `(principal "${String(owner.principalUid)}", role "${String(owner.roleId)}", `
      + `genesis ${String(owner.genesis)}). Refusing.`);
  }

  const role = ASSIGNABLE_ROLES[CERTIFICATION_GENESIS_ADMIN_ROLE_ID];
  if (!role || !Array.isArray(role.permissions) || !role.permissions.includes("admin.roleAssignment.write")) {
    // Defensive: if the compatibility catalog stopped carrying role administration, completing
    // genesis this way would establish an authority that authorizes nothing.
    throw new GenesisNotPermittedError(
      `"${CERTIFICATION_GENESIS_ADMIN_ROLE_ID}" does not carry admin.roleAssignment.write in this catalog`);
  }

  const assignmentRef = db.collection(ROLE_ASSIGNMENTS_COLLECTION).doc(input.idempotencyKey);
  return runAccessMutationCommand(input.idempotencyKey, {
    principalUid: input.principalUid,
    auditInput: {
      actorUid: CERTIFICATION_GENESIS_ACTOR,
      action: "completeCertificationAuthorityGenesis",
      targetType: "roleAssignment",
      targetId: input.principalUid,
      outcome: "applied",
      summary: `GENESIS COMPLETION: established the runtime administration half -- `
        + `"${CERTIFICATION_GENESIS_ADMIN_ROLE_ID}" for ${input.employeeId} (${input.principalUid}). `
        + `The business half ("${CERTIFICATION_GENESIS_ROLE_ID}") was established by a prior `
        + "bootstrapCertificationAuthority event, which this does not modify. Holding the business "
        + "Role authorizes nothing in the trusted writer, which resolves against the compatibility "
        + "catalog; this is the assignment grantRole actually qualifies against.",
      scope: { type: "global" },
    },
    apply: (txn, ctx) => {
      txn.create(assignmentRef, {
        principalUid: input.principalUid,
        roleId: CERTIFICATION_GENESIS_ADMIN_ROLE_ID,
        scope: { type: "global" },
        // Truthful provenance. NOT bootstrap:legacy-admin-migration -- no migration occurred.
        grantedBy: CERTIFICATION_GENESIS_ACTOR,
        grantedAt: FieldValue.serverTimestamp(),
        genesis: true,
        status: "active",
        accessVersionAtGrant: ctx.newAccessVersion,
      });
    },
  });
}

// =====================================================================
// PRIVILEGED ROLE APPROVAL -- propose, then approve as an authenticated Admin
// =====================================================================
//
// ============================ THE DEFECT THIS REPLACES ============================
//
// grantRole accepts `approverUid` as REQUEST-BODY DATA. verifyApproverIsPrivileged then resolves
// that UID's stored permissions -- which proves the named principal HOLDS approval authority, and
// proves nothing whatsoever about whether they exercised it. A caller able to type the Admin UID
// could mint a privileged Role without the Admin being present, awake, or aware.
//
// "someone supplied the Admin UID" is not "the authenticated Admin approved this".
//
// Here the approving identity comes ONLY from `actorUid`, which the callable layer derives from
// `request.auth.uid`. There is no parameter through which an approver can be asserted, which is the
// point: the proof is structural, not a validation rule someone could relax later.
//
// ============================ TAYLOR POLICY: ONE APPROVER ============================
//
// Owner decision 2026-08-22. Taylor has ONE human security approver, operating the `admin`
// principal. `requiredApprovals` is therefore 1, and the proposer MAY be the same human -- the
// control being enforced is PROPOSAL != AUTHENTICATED APPROVAL, not a headcount.
//
// A previous reading of this repository assumed two-person approval was required. It is not, for
// this organization, and pretending otherwise would certify a control Taylor does not operate.
// `requiredApprovals` is stored on the request rather than hardcoded so an enterprise tenant can
// raise it without redesigning the request/decision architecture.
//
// ============================ MFA SEAM ============================
//
// Authority is re-resolved AT APPROVAL TIME from the approver's live session, never carried forward
// from the request. The decision records an `approvalContext` -- today just the auth-time facts the
// callable can see -- so a future rule of the form "approval requires re-authentication within N
// minutes" is a check against data already being written, not a schema migration. Nothing here
// assumes password authentication.
const PRIVILEGED_ROLE_REQUESTS_COLLECTION = "privilegedRoleRequests";

export const PRIVILEGED_REQUEST_STATUS = Object.freeze({
  PENDING_APPROVAL: "PENDING_APPROVAL",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
});

/**
 * A stable fingerprint of WHAT WAS PROPOSED.
 *
 * Recomputed at approval time and compared. Approving a request whose target, Role or scope changed
 * after it was reviewed is approving something nobody read -- and it is the obvious attack on any
 * propose/approve flow, so it is checked rather than assumed.
 */
function privilegedRequestFingerprint(target: string, roleId: string, scope: Scope): string {
  return JSON.stringify({ target, roleId, scope });
}

export interface RequestPrivilegedRoleInput {
  actorUid: string;
  principalUid: string;
  roleId: string;
  scope: Scope;
  idempotencyKey: string;
}

/**
 * STEP 1 -- PROPOSE. Creates a pending request and grants NOTHING.
 *
 * Proposing requires the same authority as granting. A lower bar would let an unprivileged caller
 * fill the queue with requests an Admin might approve by reflex, which turns the approval screen
 * into the attack surface.
 */
export async function requestPrivilegedRole(input: RequestPrivilegedRoleInput): Promise<CommandOutcome> {
  assertValidIdempotencyKey(input.idempotencyKey);
  assertNonEmptyString(input.actorUid, "actorUid");
  assertNonEmptyString(input.principalUid, "principalUid");
  assertNonEmptyString(input.roleId, "roleId");
  assertValidScope(input.scope);

  const db = getFirestore();
  const requestRef = db.collection(PRIVILEGED_ROLE_REQUESTS_COLLECTION).doc(input.idempotencyKey);

  await withDeniedAuditOnError(
    input.idempotencyKey,
    { actorUid: input.actorUid, action: "requestPrivilegedRole", targetType: "privilegedRoleRequest", targetId: input.principalUid },
    async () => {
      const role = ASSIGNABLE_ROLES[input.roleId];
      if (!role) throw new UnknownRoleError(`unknown roleId: "${input.roleId}"`);
      // A non-privileged Role does not belong in this queue: grantRole already handles it in one
      // step, and routing it here would invent an approval ceremony the policy does not require.
      if (!role.privileged) {
        throw new InvalidInputError(
          `roleId "${input.roleId}" is not privileged -- use grantRole directly rather than the approval queue`,
        );
      }
      await verifyActorPermission(input.actorUid, "admin.roleAssignment.write", {
        scope: { type: "global" },
        condition: {},
      });
    },
  );

  // A PROPOSAL CHANGES NOBODY'S AUTHORITY, so it deliberately does NOT go through
  // runAccessMutationCommand. That helper exists to mutate access: it bumps accessVersion and
  // synchronises custom claims. Running a proposal through it bumped a version and attempted a
  // claims sync for a principal whose authority had not moved -- invalidating live sessions for a
  // decision nobody had taken yet, and failing outright when the proposer had no Auth record.
  //
  // The same shape as approveAccessRequest: one transaction, idempotent on the audit event, writing
  // the request document and an Audit Event and nothing else.
  const auditRef = auditEventDocRef(input.idempotencyKey);
  const auditInput = {
    actorUid: input.actorUid,
    action: "requestPrivilegedRole" as const,
    targetType: "privilegedRoleRequest",
    targetId: input.principalUid,
  };

  return db.runTransaction(async (txn): Promise<CommandOutcome> => {
    const auditSnap = await txn.get(auditRef);
    if (auditSnap.exists) {
      const existing = auditSnap.data() as Record<string, unknown>;
      assertSameCommandFingerprint(input.idempotencyKey, existing, auditInput);
      return { status: "alreadyApplied", auditEventId: input.idempotencyKey };
    }

    txn.create(requestRef, {
      requestId: input.idempotencyKey,
      principalUid: input.principalUid,
      roleId: input.roleId,
      scope: input.scope,
      requestedBy: input.actorUid,
      requestedAt: FieldValue.serverTimestamp(),
      status: PRIVILEGED_REQUEST_STATUS.PENDING_APPROVAL,
      requestFingerprint: privilegedRequestFingerprint(input.principalUid, input.roleId, input.scope),
      // FUTURE POLICY SEAM. Stored per request rather than hardcoded, so raising the threshold is a
      // policy change rather than an architecture change.
      requiredApprovals: 1,
      approvals: [],
    });

    stageAuditEventWithId(txn, input.idempotencyKey, {
      ...auditInput,
      outcome: "applied",
      summary: `Proposed privileged role "${input.roleId}" for principal ${input.principalUid} -- PENDING_APPROVAL`,
      scope: input.scope,
    });

    return { status: "applied", auditEventId: input.idempotencyKey };
  });
}

export interface ListPrivilegedRoleRequestsInput {
  actorUid: string;
  status?: string;
}

/**
 * Read the approval queue. Requires the SAME authority as deciding on it.
 *
 * Gating the read behind `admin.roleAssignment.write` rather than a weaker read capability is
 * deliberate: the queue names principals and the elevations proposed for them, which is exactly the
 * map an attacker would want. A UI that simply hides the button would leave that map readable.
 *
 * Returns the target's employee display name where one exists, because an approver deciding on
 * "grant owner to gOTW7OJx…" is not reviewing anything -- they need to see the person.
 */
export async function listPrivilegedRoleRequests(input: ListPrivilegedRoleRequestsInput): Promise<{
  requests: Array<Record<string, unknown>>;
}> {
  assertNonEmptyString(input.actorUid, "actorUid");
  await verifyActorPermission(input.actorUid, "admin.roleAssignment.write", {
    scope: { type: "global" },
    condition: {},
  });

  const db = getFirestore();
  let query = db.collection(PRIVILEGED_ROLE_REQUESTS_COLLECTION).limit(200);
  if (input.status) query = query.where("status", "==", input.status) as typeof query;
  const snap = await query.get();

  const rows = snap.docs.map((doc) => {
    const d = doc.data();
    return {
      requestId: doc.id,
      principalUid: d.principalUid as string,
      roleId: d.roleId as string,
      scope: d.scope,
      status: d.status as string,
      requestedBy: d.requestedBy as string,
      requestedAtMs: (d.requestedAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? null,
      decidedBy: (d.decidedBy as string | undefined) ?? null,
      decidedAtMs: (d.decidedAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? null,
      requiredApprovals: (d.requiredApprovals as number | undefined) ?? 1,
    };
  });

  // Resolve display names for the targets. Done here rather than in the client so the client never
  // needs a read path into `employees` it would not otherwise have.
  const uids = [...new Set(rows.map((r) => r.principalUid).filter(Boolean))];
  const nameByUid = new Map<string, string>();
  for (const uid of uids) {
    const userSnap = await db.collection(USERS_COLLECTION).doc(uid).get();
    const employeeId = userSnap.exists ? (userSnap.data()?.employeeId as string | undefined) : undefined;
    if (!employeeId) continue;
    const empSnap = await db.collection(EMPLOYEES_COLLECTION).doc(employeeId).get();
    if (empSnap.exists) {
      nameByUid.set(uid, (empSnap.data()?.displayName as string) || employeeId);
    }
  }

  return {
    requests: rows
      .map((r) => ({ ...r, displayName: nameByUid.get(r.principalUid) ?? null }))
      .sort((a, b) => (b.requestedAtMs ?? 0) - (a.requestedAtMs ?? 0)),
  };
}

export interface DecidePrivilegedRoleRequestInput {
  /** Derived from request.auth.uid by the callable. NEVER accepted from the request body. */
  actorUid: string;
  requestId: string;
  decision: "APPROVE" | "REJECT";
  reason?: string;
  idempotencyKey: string;
  /** Auth-context facts for the MFA seam. Advisory today; never a substitute for actorUid. */
  approvalContext?: Record<string, unknown>;
}

/**
 * STEP 2 + 3 -- APPROVE (and grant) or REJECT, as the authenticated Admin.
 *
 * On APPROVE the grant happens inside the SAME command as the decision, so a request cannot sit
 * "approved but ungranted" -- a state that reads as authorized in every report and confers nothing.
 */
export async function decidePrivilegedRoleRequest(input: DecidePrivilegedRoleRequestInput): Promise<CommandOutcome> {
  assertValidIdempotencyKey(input.idempotencyKey);
  assertNonEmptyString(input.actorUid, "actorUid");
  assertNonEmptyString(input.requestId, "requestId");
  if (input.decision !== "APPROVE" && input.decision !== "REJECT") {
    throw new InvalidInputError('decision must be "APPROVE" or "REJECT"');
  }

  const db = getFirestore();
  const requestRef = db.collection(PRIVILEGED_ROLE_REQUESTS_COLLECTION).doc(input.requestId);

  const preSnap = await requestRef.get();
  if (!preSnap.exists) {
    throw new UnavailableAccessDataError(`${PRIVILEGED_ROLE_REQUESTS_COLLECTION}/${input.requestId} does not exist`);
  }
  const req = preSnap.data() as Record<string, unknown>;
  const principalUid = req.principalUid as string;
  const roleId = req.roleId as string;
  const scope = req.scope as Scope;
  if (typeof principalUid !== "string" || typeof roleId !== "string" || !scope) {
    throw new MalformedAccessDataError(`${PRIVILEGED_ROLE_REQUESTS_COLLECTION}/${input.requestId} is malformed`);
  }

  // A RETRY IS NOT A SECOND DECISION, and conflating them breaks one of them.
  //
  // Replaying the SAME idempotencyKey is a client retrying after a network blip, and must resolve to
  // the recorded outcome. A DIFFERENT key against an already-decided request is a genuine attempt to
  // decide twice, and must be refused. Checking "is it still pending" first treated both as the
  // second case, so an ordinary retry got InvalidStateError and looked like tampering.
  const replaySnap = await auditEventDocRef(input.idempotencyKey).get();
  if (replaySnap.exists) {
    assertSameCommandFingerprint(input.idempotencyKey, replaySnap.data() as Record<string, unknown>, {
      action: "decidePrivilegedRoleRequest",
      targetType: "privilegedRoleRequest",
      targetId: principalUid,
    });
    return {
      status: "alreadyApplied",
      auditEventId: input.idempotencyKey,
      accessVersionAfter: (replaySnap.data() as Record<string, unknown>).accessVersionAfter as number | undefined,
    };
  }

  await withDeniedAuditOnError(
    input.idempotencyKey,
    { actorUid: input.actorUid, action: "decidePrivilegedRoleRequest", targetType: "privilegedRoleRequest", targetId: principalUid },
    async () => {
      if (req.status !== PRIVILEGED_REQUEST_STATUS.PENDING_APPROVAL) {
        throw new InvalidStateError(
          `${PRIVILEGED_ROLE_REQUESTS_COLLECTION}/${input.requestId} is not pending (status="${String(req.status)}") -- a decision may only be made once`,
        );
      }
      // TAMPER CHECK. The stored fingerprint is compared against one recomputed from the stored
      // fields, so an edit to target/Role/scope after the request was raised is refused rather than
      // silently approved.
      const expected = privilegedRequestFingerprint(principalUid, roleId, scope);
      if (req.requestFingerprint !== expected) {
        throw new InvalidStateError(
          `${PRIVILEGED_ROLE_REQUESTS_COLLECTION}/${input.requestId} has been modified since it was raised -- refusing to approve a changed request`,
        );
      }
      // The target may never approve their own elevation. This survives even at requiredApprovals=1,
      // because it is not a headcount rule -- it is the rule that nobody signs off their own power.
      if (input.actorUid === principalUid) {
        throw new SelfApprovalError("the target of a privileged role request may not approve their own elevation");
      }
      // AUTHORITY RE-RESOLVED AT APPROVAL TIME, from the approver's current state. An Admin whose
      // authority was revoked between proposal and approval must be denied -- carrying authority
      // forward from the request would make revocation take effect everywhere except here.
      await verifyActorPermission(input.actorUid, "admin.roleAssignment.write", {
        scope: { type: "global" },
        condition: {},
      });
      const role = ASSIGNABLE_ROLES[roleId];
      if (!role) throw new UnknownRoleError(`unknown roleId: "${roleId}"`);
      if (!role.privileged) {
        throw new InvalidStateError(`roleId "${roleId}" is no longer privileged -- refusing to approve through the privileged queue`);
      }
    },
  );

  const approving = input.decision === "APPROVE";
  const assignmentRef = db.collection(ROLE_ASSIGNMENTS_COLLECTION).doc(input.idempotencyKey);

  // REJECT CHANGES NOBODY'S AUTHORITY, so it takes the same non-mutating path as the proposal.
  // Routing it through runAccessMutationCommand bumped the APPROVER's accessVersion and tried to
  // sync their claims -- invalidating live sessions to record a decision to do nothing.
  if (!approving) {
    const rejectAuditRef = auditEventDocRef(input.idempotencyKey);
    const rejectAudit = {
      actorUid: input.actorUid,
      action: "decidePrivilegedRoleRequest" as const,
      targetType: "privilegedRoleRequest",
      targetId: principalUid,
    };
    return db.runTransaction(async (txn): Promise<CommandOutcome> => {
      const auditSnap = await txn.get(rejectAuditRef);
      if (auditSnap.exists) {
        assertSameCommandFingerprint(input.idempotencyKey, auditSnap.data() as Record<string, unknown>, rejectAudit);
        return { status: "alreadyApplied", auditEventId: input.idempotencyKey };
      }
      txn.update(requestRef, {
        status: PRIVILEGED_REQUEST_STATUS.REJECTED,
        decidedBy: input.actorUid,
        decidedAt: FieldValue.serverTimestamp(),
        reason: input.reason ?? null,
        ...(input.approvalContext ? { approvalContext: input.approvalContext } : {}),
      });
      stageAuditEventWithId(txn, input.idempotencyKey, {
        ...rejectAudit,
        outcome: "applied",
        summary: `Authenticated Admin ${input.actorUid} REJECTED request ${input.requestId} for "${roleId}" on ${principalUid}`,
        scope,
      });
      return { status: "applied", auditEventId: input.idempotencyKey };
    });
  }

  return runAccessMutationCommand(input.idempotencyKey, {
    // On approval the TARGET's authority changes, so their accessVersion is what must move. On
    // rejection nothing about the target changes and the version stays put.
    principalUid,
    auditInput: {
      actorUid: input.actorUid,
      action: "decidePrivilegedRoleRequest",
      targetType: "privilegedRoleRequest",
      targetId: principalUid,
      outcome: "applied",
      summary: `Authenticated Admin ${input.actorUid} APPROVED request ${input.requestId}: granted "${roleId}" to ${principalUid}`,
      scope,
    },
    apply: (txn, ctx) => {
      txn.update(requestRef, {
        status: PRIVILEGED_REQUEST_STATUS.APPROVED,
        decidedBy: input.actorUid,
        decidedAt: FieldValue.serverTimestamp(),
        ...(input.approvalContext ? { approvalContext: input.approvalContext } : {}),
      });
      // TRANSACTIONALLY COHERENT: the decision and the assignment land together or not at all.
      txn.create(assignmentRef, {
        principalUid,
        roleId,
        scope,
        grantedBy: req.requestedBy as string,
        approvedBy: input.actorUid,
        approvalRequestId: input.requestId,
        grantedAt: FieldValue.serverTimestamp(),
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
  // The CONFIRMED target project (e.g. "taylor-parts" or "eos-platform-sandbox").
  // Required. Recorded as the audit provenance project, and cross-checked against
  // the runtime project the Admin SDK actually writes to (fail closed on
  // mismatch) -- so the provenance can never claim a project other than the one
  // the roleAssignment actually lands in. Replaces the former hard-coded
  // BOOTSTRAP_ADMIN_PROJECT="taylor-parts", which mis-recorded the sandbox.
  projectId: string;
}
const LEGACY_ADMIN_ROLE_ID = "admin";
const BOOTSTRAP_ADMIN_PROVENANCE = "bootstrap:legacy-admin-migration";
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
  assertNonEmptyString(input.projectId, "projectId");

  const db = getFirestore();
  // Cross-project fail-closed guard (replaces the former hard-coded
  // BOOTSTRAP_ADMIN_PROJECT="taylor-parts"). The confirmed target project MUST
  // equal the runtime project this Admin SDK actually writes to, resolved from
  // the initialized app's own projectId (then GCLOUD_PROJECT/GOOGLE_CLOUD_PROJECT
  // as fallbacks). This makes it structurally impossible to stamp a provenance
  // project different from where the roleAssignment lands -- e.g. recording
  // "eos-platform-sandbox" while writing to "taylor-parts", or vice versa. We
  // refuse BEFORE any write (no audit against the mismatched project).
  // ONE RESOLVER, shared with the genesis guard. This block was the CORRECT implementation and
  // genesis wrote a second, weaker one beside it -- which is how a live genesis run resolved its
  // own project as `none` against a correctly initialized app. The rule now lives in one place and
  // both callers ask it, so they cannot diverge again. It additionally refuses an app/environment
  // DISAGREEMENT, which this version silently resolved in the app's favour.
  let runtimeProject: string;
  try {
    runtimeProject = trustedRuntimeProjectId();
  } catch (err) {
    throw new InvalidStateError(
      "cannot resolve the runtime project identity; refusing to record bootstrap provenance "
      + `(fail closed): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (runtimeProject !== input.projectId) {
    throw new InvalidStateError(
      `project mismatch: confirmed target "${input.projectId}" != runtime project "${runtimeProject}" ` +
        "(fail closed; bootstrap provenance must match the write target)",
    );
  }
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
    `project=${input.projectId}; commit=${input.provenanceCommit}`;

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
