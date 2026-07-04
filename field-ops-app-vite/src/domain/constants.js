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

// Sprint 4: real, Firestore-backed inventory (separate from and
// unrelated to demo/InventoryContext.jsx's in-memory demo layer, which
// stays exactly as-is -- see services/inventoryService.js).
export const INVENTORY_COLLECTION = "fieldops_inventory";

// Sprint 4: persisted job event log (services/jobEventService.js).
export const JOB_EVENTS_COLLECTION = "fieldops_job_events";

export const LOCATION_TYPE = {
  WAREHOUSE: "warehouse",
  TRUCK: "truck",
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

// Sprint 4: JOB_PHASE is an ADDITIVE, optional field (job.phase) layered
// on top of the untouched JOB_STATUS -- it is NOT a replacement or a
// second status enum. JOB_STATUS remains the single source of truth for
// "what can this job legally do next" (assignJob()/updateJobStatus(),
// domain/jobWorkflow.js's canTransitionJob()); nothing about it changes
// in this sprint. JOB_PHASE exists purely to track finer-grained
// operational detail *within* the ASSIGNED/IN_PROGRESS window (did the
// technician start traveling yet? have parts been used yet?) that
// JOB_STATUS was never meant to represent. A job missing this field
// entirely (any job written before Sprint 4) is treated as having no
// phase tracked -- existing code that only reads job.status is
// completely unaffected. See domain/jobPhaseWorkflow.js and
// services/jobService.js.
export const JOB_PHASE = {
  CREATED: "CREATED",
  ASSIGNED: "ASSIGNED",
  EN_ROUTE: "EN_ROUTE",
  IN_PROGRESS: "IN_PROGRESS",
  PARTS_USED: "PARTS_USED",
  COMPLETED: "COMPLETED",
};
