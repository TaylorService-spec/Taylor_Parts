// Enterprise Access & Administration Platform (Issue #226) -- stable,
// capability-based Permission catalog. Fixed by docs/specifications/
// enterprise-access-and-administration-platform.md §6/§7 and sequenced
// by docs/implementation-plans/enterprise-access-and-administration-
// platform.md (Row 1 / Task 6).
//
// This module is a PURE, dependency-free data + validation module --
// no firebase-admin import, no Firestore read/write, no Rules/Function
// wired to it yet. Declaring a Permission id here does not grant it to
// anyone; Role->Permission mapping is Row 2 (Task 7)'s compatibility
// resolver, not this file. No runtime authorization behavior changes.
//
// Mirrored (not imported -- no shared/monorepo tooling exists in this
// repo) at field-ops-app-vite/src/access/permissionCatalog.ts. If
// either file changes, change the other to match.
import type { Permission } from "../types/access";

// Spec §6: PermissionId = "<domain>.<resource>.<action>", lower-camel
// segments. Ids are immutable once published; deprecation is additive
// (`deprecated: true` + `deprecatedInFavorOf`), never a silent rename.
const PERMISSION_ID_PATTERN = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;

// Every id below reproduces a capability that already exists in
// production today (Assessment §1 current-state matrix, Assessment's
// "Inventory domain audit" table, and firestore.rules on `main`). This
// catalog names capabilities that ALREADY behave this way -- it does
// not invent new ones. Seeding these ids is the prerequisite for Row 2
// (Task 7)'s compatibility Role mapping, which is the parity oracle
// (Spec §7) all later shadow-mode comparisons (Row 4) are scored
// against.
export const PERMISSION_CATALOG: readonly Permission[] = Object.freeze([
  // --- Customer / Account domain (Assessment §1; accounts Rules) ---
  Object.freeze({
    id: "account.record.read",
    description: "Read a Customer/Account record.",
    resource: "account.record",
    action: "read",
  }),
  Object.freeze({
    id: "account.record.create",
    description: "Create a Customer/Account record.",
    resource: "account.record",
    action: "create",
  }),
  Object.freeze({
    id: "account.record.update",
    description: "Edit a Customer/Account record's non-governed fields.",
    resource: "account.record",
    action: "update",
  }),
  Object.freeze({
    id: "account.governedField.write",
    description:
      "Edit an Account's governed commercial fields (paymentTerms/taxStatus) -- Issue #175, admin-only today.",
    resource: "account.governedField",
    action: "write",
  }),

  // --- Work Order domain (Assessment §1; transitionEngine.ts) ---
  Object.freeze({
    id: "workOrder.create",
    description: "Create a Work Order.",
    resource: "workOrder",
    action: "create",
  }),
  Object.freeze({
    id: "workOrder.transition",
    description:
      "Perform a Work Order lifecycle transition via the transitionWorkOrder authority (ADR-002).",
    resource: "workOrder",
    action: "transition",
  }),
  Object.freeze({
    id: "workOrder.cancel",
    description:
      "Cancel a Work Order, subject to the dispatcher in-flight-technician narrowing preserved from today's behavior.",
    resource: "workOrder",
    action: "cancel",
  }),

  // --- Inventory / Reorder / Purchasing domain (Issue #100; Assessment's
  // Inventory domain audit table; firestore.rules current `main`) ---
  Object.freeze({
    id: "reorder.request.read.queue",
    description:
      "Read the Parts Manager queue/oversight/history views of reorder requests.",
    resource: "reorder.request",
    action: "read.queue",
  }),
  Object.freeze({
    id: "reorder.request.read.own",
    description:
      "Read only the reorder requests assigned to the caller's own identity.",
    resource: "reorder.request",
    action: "read.own",
  }),
  Object.freeze({
    id: "reorder.request.create.manual",
    description:
      "Submit a manual NEEDS_PLANNING reorder request via the zero-history quantity path.",
    resource: "reorder.request",
    action: "create.manual",
  }),
  Object.freeze({
    id: "reorder.request.create.system",
    description:
      "Create a system-originated (READY-path) reorder request -- admin/dispatcher only today.",
    resource: "reorder.request",
    action: "create.system",
  }),
  Object.freeze({
    id: "reorder.request.assign",
    description: "Assign a reorder request to a Parts Associate.",
    resource: "reorder.request",
    action: "assign",
  }),
  Object.freeze({
    id: "reorder.request.startPurchasing",
    description: "Transition an assigned reorder request to Start Purchasing.",
    resource: "reorder.request",
    action: "startPurchasing",
  }),
  Object.freeze({
    id: "reorder.request.postPurchasingUpdate",
    description: "Post a purchasing status update on an assigned reorder request.",
    resource: "reorder.request",
    action: "postPurchasingUpdate",
  }),
  Object.freeze({
    id: "reorder.request.recordPurchaseOrder",
    description: "Record a Purchase Order against an assigned reorder request.",
    resource: "reorder.request",
    action: "recordPurchaseOrder",
  }),
  Object.freeze({
    id: "reorder.request.markReceived",
    description: "Mark an assigned reorder request's Purchase Order as Received.",
    resource: "reorder.request",
    action: "markReceived",
  }),
  Object.freeze({
    id: "reorder.request.approve",
    description: "Approve a reorder request -- admin/dispatcher only today.",
    resource: "reorder.request",
    action: "approve",
  }),
  Object.freeze({
    id: "reorder.request.reject",
    description: "Reject a reorder request -- admin/dispatcher only today.",
    resource: "reorder.request",
    action: "reject",
  }),
  Object.freeze({
    id: "reorder.request.cancel",
    description: "Cancel a reorder request -- admin/dispatcher only today.",
    resource: "reorder.request",
    action: "cancel",
  }),
  Object.freeze({
    id: "reorder.purchaseOrder.read",
    description: "Read reorder Purchase Orders / Purchase Order Voids.",
    resource: "reorder.purchaseOrder",
    action: "read",
  }),
  Object.freeze({
    id: "reorder.purchaseOrder.create",
    description: "Create a reorder Purchase Order.",
    resource: "reorder.purchaseOrder",
    action: "create",
  }),
  Object.freeze({
    id: "reorder.purchaseOrder.void",
    description:
      "Void a reorder Purchase Order -- admin/dispatcher, or the recorded assignee only.",
    resource: "reorder.purchaseOrder",
    action: "void",
  }),
  Object.freeze({
    id: "inventory.transaction.read",
    description: "Read inventory_transactions records.",
    resource: "inventory.transaction",
    action: "read",
  }),
  Object.freeze({
    id: "inventory.action.read",
    description: "Read inventory_actions records.",
    resource: "inventory.action",
    action: "read",
  }),
  Object.freeze({
    id: "inventory.action.create",
    description: "Create an inventory_actions record -- admin/dispatcher only today.",
    resource: "inventory.action",
    action: "create",
  }),

  // --- Enterprise Access & Administration domain (this platform; Spec §16) ---
  Object.freeze({
    id: "admin.userStatus.write",
    description: "Enable/disable a principal's account status.",
    resource: "admin.userStatus",
    action: "write",
  }),
  Object.freeze({
    id: "admin.roleAssignment.write",
    description: "Assign or revoke an already-approved Role.",
    resource: "admin.roleAssignment",
    action: "write",
  }),
  Object.freeze({
    id: "admin.accessRequest.decide",
    description: "Approve or reject a pending Access Request.",
    resource: "admin.accessRequest",
    action: "decide",
  }),
  Object.freeze({
    id: "audit.event.read",
    description: "Read the immutable Audit Event history.",
    resource: "audit.event",
    action: "read",
  }),
]) as readonly Permission[];

export function isValidPermissionId(id: string): boolean {
  return PERMISSION_ID_PATTERN.test(id);
}

export function findPermission(id: string): Permission | undefined {
  return PERMISSION_CATALOG.find((permission) => permission.id === id);
}

// Fail-closed helper (Spec §13): callers that need to assert a
// permission id is real should use this rather than trusting an
// unchecked string -- an unknown id is never silently treated as valid.
export function requirePermission(id: string): Permission {
  const permission = findPermission(id);
  if (!permission) {
    throw new Error(`Unknown PermissionId: "${id}"`);
  }
  return permission;
}
