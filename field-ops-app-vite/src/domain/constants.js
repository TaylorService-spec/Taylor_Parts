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
export const REORDER_REQUESTS_COLLECTION = "reorder_requests";

export const REORDER_REQUEST_STATUS = {
  PENDING_REVIEW: "PENDING_REVIEW",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
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
