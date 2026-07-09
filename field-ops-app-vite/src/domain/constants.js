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

export const ACCOUNT_STATUS = {
  ACTIVE: "Active",
  INACTIVE: "Inactive",
  PROSPECT: "Prospect",
  ARCHIVED: "Archived",
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
export const REORDER_REQUESTS_COLLECTION = "reorder_requests";

export const REORDER_REQUEST_STATUS = {
  PENDING_REVIEW: "PENDING_REVIEW",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  READY_FOR_PARTS_MANAGER: "READY_FOR_PARTS_MANAGER",
  ASSIGNED_TO_PARTS_ASSOCIATE: "ASSIGNED_TO_PARTS_ASSOCIATE",
  PURCHASING_IN_PROGRESS: "PURCHASING_IN_PROGRESS",
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
