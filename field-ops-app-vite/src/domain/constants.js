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

export const ROLES = {
  ADMIN: "admin",
  DISPATCHER: "dispatcher",
  TECHNICIAN: "technician",
};

// Which NAV tabs (see App.jsx's NAV keys) each role may see. Admin sees
// everything; dispatcher runs the office side; technician is scoped to
// the field-facing view. Update here, not in App.jsx, when access changes.
export const ROLE_NAV_ACCESS = {
  [ROLES.ADMIN]: ["controlTower", "jobs", "technicians", "dispatch", "fieldMode", "inventory"],
  [ROLES.DISPATCHER]: ["controlTower", "jobs", "technicians", "dispatch", "inventory"],
  [ROLES.TECHNICIAN]: ["fieldMode", "jobs"],
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
