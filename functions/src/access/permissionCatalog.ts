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

// Issue #325 / ADR-007 D-226 -- field-level read-capability extension.
// docs/architecture/ADR-007-governed-object-based-report-creator.md §2.2/
// §2.3 and docs/specifications/governed-object-based-report-creator.md §3
// adopt "report.<objectId>.field.<fieldId>.read" (object read capability:
// "report.<objectId>.read") as the id shape -- both already satisfy
// PERMISSION_ID_PATTERN above unchanged (5 and 3 lower-camel dot segments
// respectively; no core pattern change required). These two STRICTER
// patterns exist only to give "malformed" its own explicit, testable
// failure mode for this capability class (a caller authoring or
// validating a `report.*` id gets a shape check narrower than the
// generic one) -- they are not consulted by findPermission()/
// resolveEffectivePermission(), which deny an unregistered or malformed
// id identically via exact catalog lookup (DenialReason
// "unknownPermission" either way).
const REPORT_OBJECT_READ_CAPABILITY_PATTERN = /^report\.[a-z][a-zA-Z0-9]*\.read$/;
const REPORT_FIELD_READ_CAPABILITY_PATTERN =
  /^report\.[a-z][a-zA-Z0-9]*\.field\.[a-zA-Z0-9]+\.read$/;

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

  // --- Warehouse domain (Epic 4 Warehouse + Fulfillment System; Spec §27) --
  // read-only: no create/update/delete permission exists for any of the
  // three collections below because no client-reachable write path
  // exists (Admin-SDK-internal only) -- see Spec §27.1 for the repository
  // evidence this claim is grounded in.
  Object.freeze({
    id: "warehouse.record.read",
    description: "Read a warehouses record (physical warehouse site).",
    resource: "warehouse.record",
    action: "read",
  }),
  Object.freeze({
    id: "warehouse.stockLocation.read",
    description: "Read a stock_locations record (bin-level quantity within a warehouse).",
    resource: "warehouse.stockLocation",
    action: "read",
  }),
  Object.freeze({
    id: "warehouse.transferOrder.read",
    description: "Read a transfer_orders record (inter-warehouse stock transfer).",
    resource: "warehouse.transferOrder",
    action: "read",
  }),

  // --- Report field-level read capabilities (Issue #325 / ADR-007 D-226) ---
  // docs/specifications/governed-object-based-report-creator.md §4/§5,
  // wave 1 only (customer/contact/location/equipment -- the four objects
  // whose Specification field tables are already fully authored and
  // Owner-approved; later waves' fields are catalogued at their own,
  // separately-authorized activation per ADR-007 §2.9/§4). No Rule,
  // Function, or Role grants any of these ids yet (see
  // resolveEffectivePermission.test.mjs's A3 acceptance test, which
  // defers this whole class the same way it already defers
  // `audit.event.read`) -- this is catalog data only, exactly as
  // required for D-226 ("resolvable by resolveEffectivePermission per
  // field") and no more. One capability governs every operation on a
  // field (select/filter/sort/group/aggregate/display/share/schedule/
  // export) -- ADR-007 §4 open decision 2, resolved here as NOT
  // operator-differentiated (the Specification's own adopted default).
  // A field id is never embedded as a static Role.conditionsByPermission
  // param -- the field identity IS the PermissionId itself (catalog
  // data), and any future genuinely per-target authorization for a
  // report capability must use a ConditionContext closure, never a
  // static param, per the precedent set by Issue #226 Warehouse Rows A/B
  // (isAssignedToWarehouse()).
  //
  // `active: false` marks a REGISTERED-but-not-yet-grantable capability
  // (ADR-007 §2.6): `customer.notes`/`location.accessNotes` are
  // `security-text` fields the Specification requires the wave-1 review
  // to explicitly confirm before activation (Spec §5, sensitivity
  // legend) -- not yet done here; `customer.accountOwner` is `employee`-
  // sensitivity and explicitly deferred to wave 4 despite sitting in the
  // wave-1 table (Spec §4, load-bearing example). Every other wave-1
  // field/object id is `active: true` -- their review IS the merged
  // Specification itself.
  Object.freeze({
    id: "report.customer.read",
    description: "Object-level read gate for reporting on Customer/Account records.",
    resource: "report.customer",
    action: "read",
    active: true,
  }),
  Object.freeze({
    id: "report.customer.field.name.read",
    description: "Report field-read: customer.name.",
    resource: "report.customer.field.name",
    action: "read",
    active: true,
  }),
  Object.freeze({
    id: "report.customer.field.status.read",
    description: "Report field-read: customer.status.",
    resource: "report.customer.field.status",
    action: "read",
    active: true,
  }),
  Object.freeze({
    id: "report.customer.field.relationshipTypes.read",
    description: "Report field-read: customer.relationshipTypes.",
    resource: "report.customer.field.relationshipTypes",
    action: "read",
    active: true,
  }),
  Object.freeze({
    id: "report.customer.field.billingAddress.read",
    description:
      "Report field-read: customer.billingAddress (street/city/state/zip -- one capability, grouped per Spec §5.1).",
    resource: "report.customer.field.billingAddress",
    action: "read",
    active: true,
  }),
  Object.freeze({
    id: "report.customer.field.tags.read",
    description: "Report field-read: customer.tags.",
    resource: "report.customer.field.tags",
    action: "read",
    active: true,
  }),
  Object.freeze({
    id: "report.customer.field.externalIds.read",
    description:
      "Report field-read: customer.customerNumber/erpId/accountingId/legacyId (one capability, grouped per Spec §5.1).",
    resource: "report.customer.field.externalIds",
    action: "read",
    active: true,
  }),
  Object.freeze({
    id: "report.customer.field.notes.read",
    description:
      "Report field-read: customer.notes -- security-text, inactive pending the wave-1 review's explicit confirmation (Spec §5 sensitivity legend).",
    resource: "report.customer.field.notes",
    action: "read",
    active: false,
  }),
  Object.freeze({
    id: "report.customer.field.createdAt.read",
    description: "Report field-read: customer.createdAt.",
    resource: "report.customer.field.createdAt",
    action: "read",
    active: true,
  }),
  Object.freeze({
    id: "report.customer.field.paymentTerms.read",
    description: "Report field-read: customer.paymentTerms -- governed (Rules admin-only write, Issue #175).",
    resource: "report.customer.field.paymentTerms",
    action: "read",
    active: true,
  }),
  Object.freeze({
    id: "report.customer.field.taxStatus.read",
    description: "Report field-read: customer.taxStatus -- governed (Rules admin-only write, Issue #175).",
    resource: "report.customer.field.taxStatus",
    action: "read",
    active: true,
  }),
  Object.freeze({
    id: "report.customer.field.commercialProfile.read",
    description:
      "Report field-read: customer.defaultCurrency/purchaseOrderRequired/invoiceDeliveryMethod (one capability, grouped per Spec §5.1).",
    resource: "report.customer.field.commercialProfile",
    action: "read",
    active: true,
  }),
  Object.freeze({
    id: "report.customer.field.billingContact.read",
    description: "Report field-read: customer.billingContact (reference -> contact).",
    resource: "report.customer.field.billingContact",
    action: "read",
    active: true,
  }),
  Object.freeze({
    id: "report.customer.field.accountOwner.read",
    description:
      "Report field-read: customer.accountOwner (reference -> employee) -- employee-sensitivity, deferred to wave 4 despite sitting in the wave-1 object table (Spec §4).",
    resource: "report.customer.field.accountOwner",
    action: "read",
    active: false,
  }),

  Object.freeze({
    id: "report.contact.read",
    description: "Object-level read gate for reporting on Contact records.",
    resource: "report.contact",
    action: "read",
    active: true,
  }),
  Object.freeze({
    id: "report.contact.field.name.read",
    description: "Report field-read: contact.name.",
    resource: "report.contact.field.name",
    action: "read",
    active: true,
  }),
  Object.freeze({
    id: "report.contact.field.email.read",
    description: "Report field-read: contact.email.",
    resource: "report.contact.field.email",
    action: "read",
    active: true,
  }),
  Object.freeze({
    id: "report.contact.field.phone.read",
    description: "Report field-read: contact.phone.",
    resource: "report.contact.field.phone",
    action: "read",
    active: true,
  }),
  Object.freeze({
    id: "report.contact.field.role.read",
    description: "Report field-read: contact.role.",
    resource: "report.contact.field.role",
    action: "read",
    active: true,
  }),
  Object.freeze({
    id: "report.contact.field.customer.read",
    description: "Report field-read: contact.accountId (reference -> customer).",
    resource: "report.contact.field.customer",
    action: "read",
    active: true,
  }),

  Object.freeze({
    id: "report.location.read",
    description: "Object-level read gate for reporting on Location records.",
    resource: "report.location",
    action: "read",
    active: true,
  }),
  Object.freeze({
    id: "report.location.field.name.read",
    description: "Report field-read: location.name.",
    resource: "report.location.field.name",
    action: "read",
    active: true,
  }),
  Object.freeze({
    id: "report.location.field.address.read",
    description:
      "Report field-read: location.address.street/city/state/zip (one capability, grouped per Spec §5.3).",
    resource: "report.location.field.address",
    action: "read",
    active: true,
  }),
  Object.freeze({
    id: "report.location.field.accessNotes.read",
    description:
      "Report field-read: location.accessNotes -- security-text, inactive pending the wave-1 review's explicit confirmation (Spec §5 sensitivity legend).",
    resource: "report.location.field.accessNotes",
    action: "read",
    active: false,
  }),
  Object.freeze({
    id: "report.location.field.customer.read",
    description: "Report field-read: location.accountId (reference -> customer).",
    resource: "report.location.field.customer",
    action: "read",
    active: true,
  }),

  Object.freeze({
    id: "report.equipment.read",
    description: "Object-level read gate for reporting on Equipment records.",
    resource: "report.equipment",
    action: "read",
    active: true,
  }),
  Object.freeze({
    id: "report.equipment.field.name.read",
    description: "Report field-read: equipment.name.",
    resource: "report.equipment.field.name",
    action: "read",
    active: true,
  }),
  Object.freeze({
    id: "report.equipment.field.status.read",
    description: "Report field-read: equipment.status.",
    resource: "report.equipment.field.status",
    action: "read",
    active: true,
  }),
  Object.freeze({
    id: "report.equipment.field.identity.read",
    description:
      "Report field-read: equipment.manufacturer/model/serialNumber/assetTag (one capability, grouped per Spec §5.4).",
    resource: "report.equipment.field.identity",
    action: "read",
    active: true,
  }),
  Object.freeze({
    id: "report.equipment.field.dates.read",
    description: "Report field-read: equipment.installedDate/warrantyExpiresDate (one capability, grouped per Spec §5.4).",
    resource: "report.equipment.field.dates",
    action: "read",
    active: true,
  }),
  Object.freeze({
    id: "report.equipment.field.notes.read",
    description: "Report field-read: equipment.notes -- standard (not security-text; distinct from customer/location notes, Spec §5.4).",
    resource: "report.equipment.field.notes",
    action: "read",
    active: true,
  }),
  Object.freeze({
    id: "report.equipment.field.customer.read",
    description: "Report field-read: equipment.accountId (reference -> customer).",
    resource: "report.equipment.field.customer",
    action: "read",
    active: true,
  }),
  Object.freeze({
    id: "report.equipment.field.location.read",
    description: "Report field-read: equipment.locationId (reference -> location).",
    resource: "report.equipment.field.location",
    action: "read",
    active: true,
  }),
  Object.freeze({
    id: "report.equipment.field.createdAt.read",
    description: "Report field-read: equipment.createdAt.",
    resource: "report.equipment.field.createdAt",
    action: "read",
    active: true,
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

// Issue #325 / ADR-007 D-226 -- shape-only validators (no catalog
// lookup) for the report.* capability class. `isValidPermissionId`
// above already accepts both shapes (they satisfy the generic
// "<domain>.<resource>.<action>"+ pattern); these exist so a caller
// authoring or validating a `report.*` id -- e.g. a future Reporting-
// lane catalog-authoring script -- gets a check narrower than the
// generic one, with "malformed" as its own distinguishable outcome
// from "not shaped like a report id at all".
export function isValidReportObjectReadCapabilityId(id: string): boolean {
  return REPORT_OBJECT_READ_CAPABILITY_PATTERN.test(id);
}

export function isValidReportFieldReadCapabilityId(id: string): boolean {
  return REPORT_FIELD_READ_CAPABILITY_PATTERN.test(id);
}

// Fail-closed helper (ADR-007 §2.6 / Spec §4-§5's "denied by default
// until dedicated security review" sensitive-field posture): true only
// for a REGISTERED (found in the catalog) capability whose `active`
// flag is not explicitly `false`. An unregistered id is never "active"
// -- this is not a substitute for `findPermission`, it is stricter.
// resolveEffectivePermission() (resolveEffectivePermission.ts) enforces
// this same rule as an unconditional gate ahead of any Role-grant
// check; this export exists for callers (tests, future catalog
// tooling) that want the same answer without invoking the full resolver.
export function isActivePermission(id: string): boolean {
  const permission = findPermission(id);
  return !!permission && permission.active !== false;
}
