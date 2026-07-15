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
// Recorded scope decision (owner review welcome, not blocking Row 2):
// the `admin.*`/`audit.event.read` Permission ids (functions/src/access/
// permissionCatalog.ts) are deliberately NOT granted to any Role here.
// The Administration surface is unbuilt in production today (renders a
// PlaceholderPage) -- granting those ids now would specify a capability
// that does not yet exist anywhere, which is not what "reproduce
// today's matrix exactly" asks for. They are seeded onto `admin` when
// the Admin Portal / trusted-writer rows (5, 7, 10-12) actually ship.
//
// Mirrored (not imported -- no shared/monorepo tooling exists in this
// repo) at functions/src/access/compatibilityRoles.ts. If either file
// changes, change the other to match.
import type { Role } from "../types/access";

const PARTS_MANAGER_ONLY = { role: "PARTS_MANAGER" };
const PARTS_ASSOCIATE_ONLY = { role: "PARTS_ASSOCIATE" };
const WAREHOUSE_MANAGER_ONLY = { role: "WAREHOUSE_MANAGER" };
const MANAGER_OR_WAREHOUSE = { roles: ["PARTS_MANAGER", "WAREHOUSE_MANAGER"] };

// Assessment §1: admin has every capability audited there, including the
// Issue #175 governed-field write withheld from dispatcher.
export const ADMIN_ROLE: Role = Object.freeze({
  id: "admin",
  name: "Administrator (compatibility)",
  description:
    "Seeded compatibility Role reproducing today's admin security-role matrix exactly.",
  systemSeed: true,
  compatibility: true,
  permissions: [
    "account.record.read",
    "account.record.create",
    "account.record.update",
    "account.governedField.write",
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
  ],
}) as Role;

// Assessment §1: dispatcher matches admin except the Issue #175
// governed-field write, which is Rules-denied to dispatcher today.
export const DISPATCHER_ROLE: Role = Object.freeze({
  id: "dispatcher",
  name: "Dispatcher (compatibility)",
  description:
    "Seeded compatibility Role reproducing today's dispatcher security-role matrix exactly.",
  systemSeed: true,
  compatibility: true,
  permissions: ADMIN_ROLE.permissions.filter(
    (id) => id !== "account.governedField.write",
  ),
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
