// Enterprise Access & Administration Platform (Issue #226) -- governed
// object type contracts. Fixed by docs/specifications/
// enterprise-access-and-administration-platform.md §5 and sequenced by
// docs/implementation-plans/enterprise-access-and-administration-platform.md
// (Row 1 / Task 6). These are CONTRACTS ONLY -- no collection, Rule,
// Function, or runtime behavior is created by this file. `admin`/
// `dispatcher`/`technician` keep authorizing exactly as they do today
// until a later, separately-authorized row activates any of this.
//
// Mirrored (not imported -- no shared/monorepo tooling exists in this
// repo) at field-ops-app-vite/src/types/access.ts. If either file
// changes, change the other to match.
import type { Timestamp } from "firebase-admin/firestore";

// Spec §6: "<domain>.<resource>.<action>", lower-camel segments,
// immutable once published. This is a nominal string type (not an enum)
// because the catalog (permissionCatalog.ts) is the single source of
// truth for which ids exist -- the type only fixes the shape.
export type PermissionId = string;

export type ScopeType =
  | "global"
  | "tenant"
  | "domain"
  | "location"
  | "ownAssignment";

// Spec §5.4 -- `tenant` is reserved and inert until Issue #140 defines
// it; it must never widen access (§10 of the Specification).
export interface Scope {
  type: ScopeType;
  value?: string;
}

export type ConditionKind =
  | "statusEquals"
  | "statusIn"
  | "isOwnAssignment"
  | "employmentActive"
  | "operationalRoleActive";

// Spec §5.5 -- a declarative predicate, never arbitrary code. Unknown/
// malformed `kind` fails closed (Spec §13) wherever this is evaluated.
export interface Condition {
  kind: ConditionKind;
  params: Record<string, unknown>;
}

// Spec §5.1 -- a pure capability declaration. Carries no principal, no
// Scope, no Condition.
export interface Permission {
  id: PermissionId;
  description: string;
  resource: string;
  action: string;
  deprecated?: boolean;
  // Set only when `deprecated` is true; the successor id a caller
  // should migrate to. Deprecation is additive, never a silent rename
  // (Spec §6).
  deprecatedInFavorOf?: PermissionId;
}

// Spec §5.2 -- a named bundle of Permission ids. This field is
// literally `PermissionId[]`, matching the Specification-Approved
// shape exactly -- it is not restructured here, even though Conditions
// (below) attach to individual grants.
export type RolePermissions = PermissionId[];

// Spec §5.5 -- Conditions are "attached to Permissions-within-Roles by
// repository declaration." Rather than changing `Role.permissions`'
// approved `PermissionId[]` shape to carry them, this is a side map
// keyed by the same PermissionId: a Role's optional
// `conditionsByPermission` supplies the Conditions (if any) that gate
// that particular grant. A PermissionId absent from this map carries
// no Condition beyond Scope matching (Spec §8 step 3).
export type RoleConditionsByPermission = Partial<
  Record<PermissionId, Condition[]>
>;

// The three seeded compatibility Roles (`admin`, `dispatcher`,
// `technician`) are `systemSeed: true, compatibility: true` and their
// grants are repository-declared and frozen to reproduce today's
// matrix exactly (Spec §7).
export interface Role {
  id: string;
  name: string;
  description: string;
  permissions: RolePermissions;
  conditionsByPermission?: RoleConditionsByPermission;
  compatibility?: boolean;
  systemSeed?: boolean;
  // Row 7 (Task 12) / ADR-005 sec2.4: a privileged Role's grant/revoke
  // requires a second, distinct authorized approver and is never
  // eligible for the single-admin assignApprovedRole path. Absent or
  // false means "ordinary pre-approved, non-privileged" (Spec sec2.4's
  // single-admin-assignable category).
  privileged?: boolean;
}

export type RoleAssignmentStatus = "active" | "disabled";

// Spec §5.3 -- binds a Role to a principal within a Scope. Creation/
// disabling is a trusted-writer command (Implementation Plan Row 7,
// #15-gated) that bumps `accessVersion` and emits an Audit Event.
// No client-direct write, ever.
export interface RoleAssignment {
  id: string;
  principalUid: string;
  roleId: string;
  scope: Scope;
  grantedBy: string;
  grantedAt: Timestamp;
  approvedBy?: string;
  status: RoleAssignmentStatus;
  accessVersionAtGrant: number;
}

export type ApproverConstraint =
  | "distinctFromRequester"
  | "platformAdmin"
  | "companyAdmin";

// Spec §5.6 -- fixed by ADR-005 §2.4; the full approval matrix is
// deferred to a later Specification-of-record. No approval-policy
// editor exists in the MVP (Spec §16) -- this is a repository-declared
// contract only.
export interface ApprovalPolicy {
  changeType: string;
  requiresApproval: boolean;
  approverConstraint: ApproverConstraint;
}

export type AccessRequestStatus = "pending" | "approved" | "rejected";

// Spec §5.7 -- the record contract exists so audit/trace exist from
// day one; the request -> review -> decision workflow and UI are
// deferred. Until then, access changes are Owner-authorized
// operator-script actions that still emit Audit Events.
export interface AccessRequest {
  id: string;
  requestedBy: string;
  requestedChange: string;
  requestedScope: Scope;
  status: AccessRequestStatus;
  decidedBy?: string;
  decidedAt?: Timestamp;
  reason?: string;
}

export type AuditAction =
  | "grantRole"
  | "revokeRole"
  | "assignApprovedRole"
  | "setUserStatus"
  | "approveAccessRequest"
  | "rejectAccessRequest"
  | "breakGlassRestore";

export type AuditOutcome = "applied" | "denied";

// Spec §5.8 / §14 -- append-only and immutable (no update/delete by
// anyone, including admins); written only by a trusted writer; never
// contains secrets, tokens, raw credentials, full permission graphs, or
// PII beyond the minimal targetId.
export interface AuditEvent {
  id: string;
  at: Timestamp;
  actorUid: string;
  action: AuditAction;
  targetType: string;
  targetId: string;
  scope?: Scope;
  approverUid?: string;
  outcome: AuditOutcome;
  summary: string;
  accessVersionAfter?: number;
}

// Spec §11 -- the ONLY four fields ever permitted in a custom claim.
// Never detailed permissions, Scopes, Conditions, approval limits, or
// territory lists (hard prohibition). `companyId` is present only after
// Issue #140 defines it -- reserved/empty until then.
export interface CompactClaims {
  companyId?: string;
  platformAdmin?: boolean;
  companyAdmin?: boolean;
  accessVersion?: number;
}
