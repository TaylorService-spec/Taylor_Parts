// Enterprise Access & Administration Platform (Issue #226) -- seeded
// admin/dispatcher/technician compatibility Roles. Fixed by docs/
// specifications/enterprise-access-and-administration-platform.md §7
// and sequenced by docs/implementation-plans/enterprise-access-and-
// administration-platform.md (Row 2 / Task 7).
//
// These Role definitions are the parity oracle (Spec §7): every later
// shadow-mode comparison (Implementation Plan Row 4) is scored against
// this exact mapping, not a re-derived interpretation. Sourced directly
// from docs/assessments/enterprise-access-and-administration-platform.md's
// current-state matrix (§1) and "Inventory domain audit" table, and the
// live `firestore.rules` grants they describe.
//
// PURE, dependency-free data module -- declaring these Role objects
// grants nothing to anyone; no Rule/Function/claim reads this yet.
// `admin`/`dispatcher`/`technician` keep authorizing exactly as they do
// today via `users/{uid}.role` until a later, separately-authorized row
// activates the Permission engine for any domain.
//
// Recorded scope decision from Row 2 (now resolved by Row 7 / Task 12):
// the `admin.*` Permission ids (functions/src/access/permissionCatalog.ts)
// were deliberately withheld from every Role until "the Admin Portal /
// trusted-writer rows (5, 7, 10-12) actually ship." Row 7 is that row --
// the three ids Row 7's trusted-writer commands actually check
// (admin.userStatus.write, admin.roleAssignment.write,
// admin.accessRequest.decide) are now granted, to `admin` ONLY, never
// `dispatcher` (Assessment/Spec describe no Admin Portal authority for
// dispatcher). `audit.event.read` remains deferred to Row 11 (the Admin
// Portal's own read surface), since Row 7 does not consume it.
//
// Mirrored (not imported -- no shared/monorepo tooling exists in this
// repo) at field-ops-app-vite/src/access/compatibilityRoles.ts. If
// either file changes, change the other to match.
import type { Role } from "../types/access";

const PARTS_MANAGER_ONLY = { role: "PARTS_MANAGER" };
const PARTS_ASSOCIATE_ONLY = { role: "PARTS_ASSOCIATE" };
const WAREHOUSE_MANAGER_ONLY = { role: "WAREHOUSE_MANAGER" };
const MANAGER_OR_WAREHOUSE = { roles: ["PARTS_MANAGER", "WAREHOUSE_MANAGER"] };

// Shared base: every Permission both admin and dispatcher hold today,
// per the Assessment's current-state matrix. Not exported -- ADMIN_ROLE
// and DISPATCHER_ROLE each derive their own final list from this base
// PLUS their own additions, rather than one being derived by filtering
// the other -- so adding an admin-only id to ADMIN_ROLE can never leak
// into DISPATCHER_ROLE by accident (the failure mode a filter-based
// derivation would risk).
const SHARED_ADMIN_DISPATCHER_BASE_PERMISSIONS = [
  "account.record.read",
  "account.record.create",
  "account.record.update",
  "workOrder.create",
  "workOrder.transition",
  "workOrder.cancel",
  "reorder.request.read.queue",
  "reorder.request.read.own",
  "reorder.request.create.manual",
  "reorder.request.create.system",
  "reorder.request.assign",
  "reorder.request.startPurchasing",
  "reorder.request.postPurchasingUpdate",
  "reorder.request.recordPurchaseOrder",
  "reorder.request.markReceived",
  "reorder.request.approve",
  "reorder.request.reject",
  "reorder.request.cancel",
  "reorder.purchaseOrder.read",
  "reorder.purchaseOrder.create",
  "reorder.purchaseOrder.void",
  "inventory.transaction.read",
  "inventory.action.read",
  "inventory.action.create",
] as const;

// reorder.purchaseOrder.void is double-gated in firestore.rules
// (current `main`, ~L794-798): `isAdminOrDispatcher() AND
// request.auth.uid == resource.data.assignedToUserId` -- even
// admin/dispatcher must be the request's own recorded assignee, not
// just hold the security role. Both compatibility Roles carry this
// Condition.
const SHARED_ADMIN_DISPATCHER_CONDITIONS = {
  "reorder.purchaseOrder.void": [{ kind: "isOwnAssignment" as const, params: {} }],
};

// Assessment §1: admin has every capability audited there, including the
// Issue #175 governed-field write withheld from dispatcher, plus the
// Row 7 Admin Portal / trusted-writer authorities.
export const ADMIN_ROLE: Role = Object.freeze({
  id: "admin",
  name: "Administrator (compatibility)",
  description:
    "Seeded compatibility Role reproducing today's admin security-role matrix exactly.",
  systemSeed: true,
  compatibility: true,
  // Privileged (Spec sec2.4 / ADR-005 sec2.4): granting/revoking this
  // Role requires a second, distinct authorized approver, and it is
  // never eligible for the single-admin assignApprovedRole path (Row 7).
  privileged: true,
  permissions: [
    ...SHARED_ADMIN_DISPATCHER_BASE_PERMISSIONS,
    "account.governedField.write",
    "admin.userStatus.write",
    "admin.roleAssignment.write",
    "admin.accessRequest.decide",
  ],
  conditionsByPermission: SHARED_ADMIN_DISPATCHER_CONDITIONS,
}) as Role;

// Assessment §1: dispatcher matches the shared base exactly -- no
// governed-field write (Issue #175), no Admin Portal / trusted-writer
// authority (Row 7).
export const DISPATCHER_ROLE: Role = Object.freeze({
  id: "dispatcher",
  name: "Dispatcher (compatibility)",
  description:
    "Seeded compatibility Role reproducing today's dispatcher security-role matrix exactly.",
  systemSeed: true,
  compatibility: true,
  permissions: [...SHARED_ADMIN_DISPATCHER_BASE_PERMISSIONS],
  conditionsByPermission: SHARED_ADMIN_DISPATCHER_CONDITIONS,
}) as Role;

// Assessment's Inventory domain audit table: a pure technician has none
// of the admin/dispatcher-only actions (no Customer access, no
// approve/reject/cancel/void-without-assignment, no system-path
// create); the Issue #100 operational-role grants are expressed here
// as Conditions on `operationalRoleActive`, never as unconditioned
// Permissions -- an operationalRole never becomes a security Permission
// by itself (Spec §9).
//
// `workOrder.transition` is granted unconditioned: the *specific*
// forward/backward direction a technician may invoke is still decided
// by transitionEngine.ts's own ACTION_PERMISSIONS table (Spec §12 lists
// "existing Cloud-Function-owned lifecycle e.g. transitionWorkOrder" as
// trusted-Function-authoritative territory this resolver does not take
// over) -- the fixed ConditionKind set (Spec §5.5) has no
// "action-direction" predicate, and inventing one is out of Row 2's
// scope.
export const TECHNICIAN_ROLE: Role = Object.freeze({
  id: "technician",
  name: "Technician (compatibility)",
  description:
    "Seeded compatibility Role reproducing today's technician security-role matrix exactly, with Issue #100 operational-role grants expressed as Conditions.",
  systemSeed: true,
  compatibility: true,
  permissions: [
    "workOrder.transition",
    "reorder.request.read.queue",
    "reorder.request.read.own",
    "reorder.request.create.manual",
    "reorder.request.assign",
    "reorder.request.startPurchasing",
    "reorder.request.postPurchasingUpdate",
    "reorder.request.recordPurchaseOrder",
    "reorder.request.markReceived",
    "reorder.purchaseOrder.read",
    "reorder.purchaseOrder.create",
    "inventory.transaction.read",
    "inventory.action.read",
  ],
  // reorder.purchaseOrder.void is deliberately NOT granted to technician
  // at all -- firestore.rules (current `main`) keeps Void gated to
  // isAdminOrDispatcher() + assignee only, with its own inline comment
  // that this is NOT extended to PARTS_ASSOCIATE even though it is
  // already the assignee (matching the Assessment's Inventory domain
  // audit table: "no operational role gets Approve/Reject/Cancel/Void").
  conditionsByPermission: {
    "reorder.request.read.queue": [
      { kind: "operationalRoleActive", params: PARTS_MANAGER_ONLY },
    ],
    "reorder.request.read.own": [
      { kind: "operationalRoleActive", params: PARTS_ASSOCIATE_ONLY },
    ],
    "reorder.request.create.manual": [
      { kind: "operationalRoleActive", params: MANAGER_OR_WAREHOUSE },
    ],
    "reorder.request.assign": [
      { kind: "operationalRoleActive", params: PARTS_MANAGER_ONLY },
    ],
    "reorder.request.startPurchasing": [
      { kind: "operationalRoleActive", params: PARTS_ASSOCIATE_ONLY },
    ],
    "reorder.request.postPurchasingUpdate": [
      { kind: "operationalRoleActive", params: PARTS_ASSOCIATE_ONLY },
    ],
    "reorder.request.recordPurchaseOrder": [
      { kind: "operationalRoleActive", params: PARTS_ASSOCIATE_ONLY },
    ],
    "reorder.request.markReceived": [
      { kind: "operationalRoleActive", params: PARTS_ASSOCIATE_ONLY },
    ],
    "reorder.purchaseOrder.read": [
      { kind: "operationalRoleActive", params: PARTS_ASSOCIATE_ONLY },
    ],
    "reorder.purchaseOrder.create": [
      { kind: "operationalRoleActive", params: PARTS_ASSOCIATE_ONLY },
    ],
    "inventory.transaction.read": [
      { kind: "operationalRoleActive", params: MANAGER_OR_WAREHOUSE },
    ],
    "inventory.action.read": [
      { kind: "operationalRoleActive", params: WAREHOUSE_MANAGER_ONLY },
    ],
  },
}) as Role;

export const COMPATIBILITY_ROLES: Readonly<Record<string, Role>> = Object.freeze({
  admin: ADMIN_ROLE,
  dispatcher: DISPATCHER_ROLE,
  technician: TECHNICIAN_ROLE,
});
