export const JOB_STATUS = {
  OPEN: "open",
  ASSIGNED: "assigned",
  IN_PROGRESS: "in_progress",
  COMPLETE: "complete",
};

export const TECH_STATUS = {
  AVAILABLE: "available",
  ON_JOB: "on_job",
  OFF_SHIFT: "off_shift",
};

export const JOBS_COLLECTION = "fieldops_jobs";
export const TECHNICIANS_COLLECTION = "fieldops_technicians";
export const USERS_COLLECTION = "users";

// Phase 3 -- Platform Assignment Foundation (docs/specifications/
// employee-foundation.md). employmentStatus is the authoritative
// Employee lifecycle field -- no `active` boolean exists. ACTIVE is
// the only Phase 3 assignment-eligibility value; the other five are
// reserved states an Employee can be in without being eligible for a
// new assignment.
export const EMPLOYEES_COLLECTION = "employees";
export const EMPLOYMENT_STATUS = {
  ACTIVE: "ACTIVE",
  ON_LEAVE: "ON_LEAVE",
  INACTIVE: "INACTIVE",
  TERMINATED: "TERMINATED",
  RETIRED: "RETIRED",
  CONTRACTOR: "CONTRACTOR",
};

// Work Order Engine v1.2 (Epic 1, see docs/architecture/ADR-002). Real,
// persisted collections -- fieldops_wos is the source of truth for Work
// Order state, written only by the createWorkOrder/transitionWorkOrder
// Cloud Functions (functions/src/), never directly by this client. The
// full 11-value WorkOrderStatus enum lives in types/workOrder.ts (TS)
// and is mirrored in domain/workOrderWorkflow.js (JS) -- not duplicated
// a third time here.
export const WORK_ORDERS_COLLECTION = "fieldops_wos";
export const COUNTERS_COLLECTION = "counters";

// Sprint 2.0.2 -- Customer Foundation (docs/BusinessEntityModel.md).
// Internal naming is "Account" throughout (collection, files,
// components) -- the UI labels this "Customers" where that's clearer
// for users. See BusinessEntityModel.md's naming recommendation.
export const ACCOUNTS_COLLECTION = "accounts";
export const LOCATIONS_COLLECTION = "locations";
export const CONTACTS_COLLECTION = "contacts";

// Equipment & Installed Asset Management -- Issue #232, unit E1 (docs/
// implementation-plans/equipment-and-installed-asset-management.md).
// A flat, first-class collection per ADR-006: one Account owns many
// Equipment; each Equipment is installed at exactly one Location of that
// same Account. Distinct from Inventory Parts (data/partsCatalog.ts) --
// Equipment is an installed, customer-serviceable asset; a Part is a
// stocked catalog item. No financial fields (Equipment carries no
// financial authority, Spec §1).
export const EQUIPMENT_COLLECTION = "equipment";

// Spec §3. ACTIVE (installed/serviceable) | INACTIVE (temporarily out of
// service) | RETIRED (decommissioned -- history retained, never deleted).
export const EQUIPMENT_STATUS = {
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
  RETIRED: "RETIRED",
};

export const ACCOUNT_STATUS = {
  ACTIVE: "Active",
  INACTIVE: "Inactive",
  PROSPECT: "Prospect",
  ARCHIVED: "Archived",
};

// Customer/Account Business Model -- Customer PR 2 (docs/specifications/
// customer-account-business-model.md). An Account may represent a customer,
// a vendor, or both -- a company-identity classification only, held on the
// Account itself (relationshipTypes: string[]), never a duplicate company
// record. This is INFORMATIONAL only: it does not gate authorization and
// does not show/hide any page section (per the Specification's resolved
// decision 2). Kept deliberately separate from ACCOUNT_STATUS above and
// from every security/operational role concept. An Account with no value
// renders no badge (never a silent default to "Customer").
export const ACCOUNT_RELATIONSHIP_TYPE = {
  CUSTOMER: "CUSTOMER",
  VENDOR: "VENDOR",
};

// Account Commercial Profile -- PR 1 (docs/specifications/
// account-commercial-profile-and-financial-forecast-horizons.md;
// docs/implementation-plans/...). How an invoice is delivered to the
// customer -- process metadata, informational only, no monetary value.
export const INVOICE_DELIVERY_METHOD = {
  EMAIL: "EMAIL",
  PORTAL: "PORTAL",
  MAIL: "MAIL",
  EDI: "EDI",
};

// Account Commercial Profile -- PR 2 (docs/specifications/
// account-commercial-profile-and-financial-forecast-horizons.md;
// docs/implementation-plans/...). The two GOVERNED enum fields: their
// values are validated AND their edit is restricted to admin -- BOTH
// enforced in firestore.rules (Tier 2), never by UI hiding. The same
// enum literals are duplicated in the Rules files' governed-field
// helpers; keep the two in sync (there is no shared source between JS
// and the Rules DSL).
//
// paymentTerms is the fixed enum ONLY -- `CUSTOM` terms and the governed
// payment_terms_definitions domain are a separate future initiative and
// are never accepted here.
export const PAYMENT_TERMS = {
  COD: "COD",
  NET_30: "NET_30",
  NET_60: "NET_60",
  NET_90: "NET_90",
};

// taxStatus safe-default invariant: an ABSENT taxStatus is treated as
// UNKNOWN, NEVER silently as TAXABLE (see resolveTaxStatus in
// domain/commercialProfile.js). EXEMPT/RESELLER may carry a
// taxExemptionRef in a future initiative -- not modeled here.
export const TAX_STATUS = {
  UNKNOWN: "UNKNOWN",
  TAXABLE: "TAXABLE",
  EXEMPT: "EXEMPT",
  RESELLER: "RESELLER",
};

// Sprint 2.1.3 -- Reorder Request & Notification Foundation
// (docs/BusinessEntityModel.md's Reorder Request entry). The platform's
// first Operational Workflow Object / Business Object dual-classified
// collection outside Work Order -- client-direct-write via
// domain/inventoryReorderRequests.js only, never a Cloud Function.
// PENDING_REVIEW is the only status this sprint writes or reads; the
// remaining values are reserved for the future Review & Approval sprint
// (Workflow history foundation -- named now so the schema doesn't need
// to be reshaped later).
//
// Sprint 2.1.5 -- Inventory -> Parts Manager Handoff. An approval no
// longer settles at APPROVED -- it advances to READY_FOR_PARTS_MANAGER,
// the request's new terminal-for-this-sprint state once ownership
// hands off. `reviewDecision` (see inventoryReorderRequests.js) still
// permanently records APPROVED/REJECTED as the historical decision;
// `status` is the thing that keeps moving.
//
// Sprint 2.1.6 -- Parts Manager -> Parts Associate Assignment.
// READY_FOR_PARTS_MANAGER is no longer terminal -- a Parts Manager can
// advance it to ASSIGNED_TO_PARTS_ASSOCIATE, the platform's first
// individual (per-user) workflow ownership, via
// `assignedToUserId`/`assignedBy`/`assignedAt` (see
// inventoryReorderRequests.js).
//
// Sprint 2.1.7 -- Purchase Execution Foundation. The assigned Parts
// Associate (and only them -- enforced in firestore.rules, not just
// application code) can advance ASSIGNED_TO_PARTS_ASSOCIATE to
// PURCHASING_IN_PROGRESS via `startPurchasing()`. `currentOwner` and
// the assignment fields are unchanged by this transition -- it's the
// same person's work moving from waiting to in-progress, not a
// hand-off.
// Sprint 2.1.10 -- Purchase Order Foundation. The assigned Parts
// Associate can advance PURCHASING_IN_PROGRESS to ORDERED via
// `domain/reorderPurchaseOrders.js`'s recordPurchaseOrder(), which
// atomically creates a Reorder Purchase Order record AND transitions
// this status in one Firestore transaction (see that file's own
// comment for the full atomicity design).
export const REORDER_REQUESTS_COLLECTION = "reorder_requests";

export const REORDER_REQUEST_STATUS = {
  PENDING_REVIEW: "PENDING_REVIEW",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  READY_FOR_PARTS_MANAGER: "READY_FOR_PARTS_MANAGER",
  ASSIGNED_TO_PARTS_ASSOCIATE: "ASSIGNED_TO_PARTS_ASSOCIATE",
  PURCHASING_IN_PROGRESS: "PURCHASING_IN_PROGRESS",
  ORDERED: "ORDERED",
  RECEIVED: "RECEIVED", // Sprint 2.1.11 -- Receiving (Reorder Request closeout). Terminal.
  // Cancel/Void schema deployment sequence, PR 4 of 6 (docs/specifications/
  // reorder-request-cancellation.md). Terminal. Reachable from
  // READY_FOR_PARTS_MANAGER, ASSIGNED_TO_PARTS_ASSOCIATE, or
  // PURCHASING_IN_PROGRESS -- i.e. any pre-ORDERED active status.
  CANCELLED: "CANCELLED",
  // Cancel/Void schema deployment sequence, PR 5 of 6 (docs/specifications/
  // reorder-request-cancellation.md). Terminal. Reachable ONLY from
  // ORDERED -- unlike CANCELLED, Void never touches the original
  // reorder_purchase_orders document; it creates a separate, append-only
  // reorder_purchase_order_voids record instead (see
  // domain/reorderPurchaseOrders.js's voidPurchaseOrder()).
  VOIDED: "VOIDED",
};

// Sprint 2.1.5 -- Inventory -> Parts Manager Handoff. `currentOwner` is
// a coarse, role-level ownership marker. Inventory owns a request from
// creation through review; approval hands ownership to the Parts
// Manager. Rejection is terminal and leaves ownership with Inventory.
//
// Sprint 2.1.6 -- Parts Manager -> Parts Associate Assignment. Adds
// PARTS_ASSOCIATE -- set when a Parts Manager assigns a
// READY_FOR_PARTS_MANAGER request to a specific person
// (`assignedToUserId`). `currentOwner` stays role-level even though
// assignment is now individual -- `assignedToUserId` (not a new
// `currentOwner` value) is what carries the per-user identity.
export const REORDER_REQUEST_OWNER = {
  INVENTORY: "INVENTORY",
  PARTS_MANAGER: "PARTS_MANAGER",
  PARTS_ASSOCIATE: "PARTS_ASSOCIATE",
};

// Zero-history reorder behavior sprint -- the first canonical enum for
// Employee `operationalRoles[]` string values in this codebase (no
// production consumer has ever populated or read one; PR #85's
// EmployeeAssignmentPicker has zero production consumers). Gates who
// may manually enter a `requestedQty` for a NEEDS_PLANNING
// recommendation (see domain/inventoryReorderRequests.js,
// firestore.rules' canSubmitManualZeroHistoryQuantity()).
//
// IMPORTANT: OPERATIONAL_ROLE.PARTS_MANAGER and
// REORDER_REQUEST_OWNER.PARTS_MANAGER (above) are the same string but
// mean two unrelated things on two unrelated fields -- the former is
// an Employee's `operationalRoles[]` entry (who is allowed to act),
// the latter is a Reorder Request's `currentOwner` (who currently owns
// this specific request, role-level, set automatically by workflow
// transitions). Do not conflate them; a person can hold the
// operational role without any request currently being
// role-owned by "PARTS_MANAGER", and vice versa.
export const OPERATIONAL_ROLE = {
  PARTS_MANAGER: "PARTS_MANAGER",
  WAREHOUSE_MANAGER: "WAREHOUSE_MANAGER",
  // Added for Sprint 2.1.6's EmployeeAssignmentPicker adoption (PR
  // #105) -- functions/scripts/provisionEmployeeAccess.js's
  // VALID_OPERATIONAL_ROLES already reserved this value; it was never
  // activated on the client or used for any eligibility filter until
  // now. Restricts the Reorder Request assignment picker to Employees
  // actually meant to receive assignments -- previously any ACTIVE,
  // linked-user Employee (an Owner, a Driver, anyone) appeared as
  // selectable, since the picker had no requiredOperationalRole.
  PARTS_ASSOCIATE: "PARTS_ASSOCIATE",
};

// Immutable audit fact recorded on every Reorder Request at creation --
// distinguishes an analytics-computed requestedQty from a manually
// entered one when no usage history existed. See
// docs/specifications/inventory-zero-history-reorder-behavior.md.
export const QUANTITY_SOURCE = {
  ANALYTICS: "ANALYTICS",
  MANUAL_ZERO_HISTORY: "MANUAL_ZERO_HISTORY",
};

// Sprint 2.1.9 -- Inventory Actions Foundation. `inventory_actions` is
// a NEW, separate, append-only audit collection for human-initiated
// stock adjustments -- deliberately NOT a modification of
// `inventory_transactions` (Epic 2D/3, ADR-003), which remains
// Admin-SDK-only and Work-Order-driven (RESERVED/RELEASED/CONSUMED),
// untouched. This mirrors how `reorder_requests` was added in Sprint
// 2.1.3 as a new parallel Business Object rather than touching the
// ledger -- "no second inventory system competing with the ledger"
// means not reusing or mutating inventory_transactions, not that a
// new, distinct audit trail can't exist alongside it.
export const INVENTORY_ACTIONS_COLLECTION = "inventory_actions";

export const INVENTORY_ACTION_TYPE = {
  RECEIVE_STOCK: "RECEIVE_STOCK",
  ADJUST_STOCK: "ADJUST_STOCK",
  CORRECT_MISTAKE: "CORRECT_MISTAKE",
};

// Sprint 2.1.10 -- Purchase Order Foundation. `reorder_purchase_orders`
// is a NEW, separate collection -- deliberately NOT the existing
// `purchase_orders` collection (Epic 5, Procurement + Supplier
// Management: Admin-SDK-only, Supplier-linked, line-item-based,
// documented in BusinessEntityModel.md's Section 3 object model
// table). Reusing that name/collection would either collide with it
// (it's already `allow create, update, delete: if false` -- Admin-SDK
// only) or misleadingly imply this minimal, Reorder-Request-linked
// record is that full entity. This object is documented as "Reorder
// Purchase Order" specifically to keep the two unambiguous -- see
// docs/BusinessEntityModel.md Section 4b.
//
// Each document's ID is its own `reorderRequestId` (not an
// auto-generated ID) -- this is what lets firestore.rules enforce "no
// duplicate Purchase Order per Reorder Request" via Firestore's own
// create-vs-update distinction (a second write to the same ID is an
// `update`, which the rule denies unconditionally), not just an
// application-level check.
export const PURCHASE_ORDERS_COLLECTION = "reorder_purchase_orders";

// Cancel/Void schema deployment sequence, PR 5 of 6 (docs/specifications/
// reorder-request-cancellation.md). The sole record of a void event --
// append-only, never updated or deleted (firestore.rules' `allow
// update, delete: if false`). Document ID is its own `reorderPurchaseOrderId`
// (== the Reorder Request/Purchase Order's shared ID), same
// duplicate-prevention-via-create-vs-update technique as
// reorder_purchase_orders above. The original reorder_purchase_orders
// document this void record references is NEVER modified or deleted --
// no rule change of any kind applies to that collection in this sprint.
export const REORDER_PURCHASE_ORDER_VOIDS_COLLECTION = "reorder_purchase_order_voids";

export const PURCHASE_ORDER_STATUS = {
  ORDERED: "ORDERED",
};

export const ROLES = {
  ADMIN: "admin",
  DISPATCHER: "dispatcher",
  TECHNICIAN: "technician",
};

// Which NAV tabs (see App.jsx's NAV keys) each role may see. Admin sees
// everything; dispatcher runs the office side; technician is scoped to
// the field-facing view. Update here, not in App.jsx, when access changes.
// "operations" (Epics 2D/3/4/5 read-only dashboard) is admin/dispatcher
// only, matching firestore.rules' isAdminOrDispatcher() read gate on
// inventory_transactions/stock_locations/warehouses/etc. -- a
// technician has no reason to see ledger/warehouse/procurement
// reporting.
export const ROLE_NAV_ACCESS = {
  [ROLES.ADMIN]: ["controlTower", "jobs", "technicians", "dispatch", "fieldMode", "inventory", "operations", "dispatcherBoard"],
  [ROLES.DISPATCHER]: ["controlTower", "jobs", "technicians", "dispatch", "inventory", "operations", "dispatcherBoard"],
  [ROLES.TECHNICIAN]: ["fieldMode", "jobs", "technicianDashboard"],
};

//
// NOTE:
// WORK_ORDER_STATE is derived only -- never written to Firestore, never
// transitioned independently of its Jobs. JOB_STATUS remains the single
// source of truth; a Work Order's state is always an aggregate computed
// from its child Jobs. domain/workOrderLifecycle.js is the one place that
// computes it -- see computeWorkOrderState() there. Sprint 3.4 note:
// this enum's COMPLETED value is what Sprint 3.4's design docs refer to
// as "COMPLETE" -- kept as COMPLETED here (not renamed) since it's
// already relied on by existing CSS classes (.wo-completed) and other
// consumers, and the two names carry identical meaning.
//
export const WORK_ORDER_STATE = {
  READY: "READY",
  BLOCKED: "BLOCKED",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "COMPLETED",
};
