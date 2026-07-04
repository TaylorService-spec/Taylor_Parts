import { SEVERITY } from "./controlTower/types";

// Canonical event vocabulary for the derived Operational Timeline
// (Sprint 3.5). These are never persisted -- there is no Firestore
// event collection, no audit log, no Cloud Function writing them. Every
// event is synthesized on read from existing Job/Work Order data by
// domain/timelineBuilder.js.

export const EVENT_TYPE = {
  JOB_CREATED: "JOB_CREATED",
  JOB_ASSIGNED: "JOB_ASSIGNED",
  JOB_STARTED: "JOB_STARTED",
  JOB_COMPLETED: "JOB_COMPLETED",
  WORK_ORDER_CREATED: "WORK_ORDER_CREATED",
  WORK_ORDER_READY: "WORK_ORDER_READY",
  WORK_ORDER_BLOCKED: "WORK_ORDER_BLOCKED",
  WORK_ORDER_COMPLETED: "WORK_ORDER_COMPLETED",
};

// Which kind of entity an event is about -- used for the Activity
// Timeline panel's Job / Work Order / System filter (Sprint 3.5.3). No
// event type below maps to SYSTEM yet (nothing in this schema produces a
// system-level signal), but the category exists so the filter's
// vocabulary doesn't need to change shape when one is added later.
export const ENTITY_TYPE = {
  JOB: "JOB",
  WORK_ORDER: "WORK_ORDER",
  SYSTEM: "SYSTEM",
};

export const EVENT_ENTITY_TYPE = {
  [EVENT_TYPE.JOB_CREATED]: ENTITY_TYPE.JOB,
  [EVENT_TYPE.JOB_ASSIGNED]: ENTITY_TYPE.JOB,
  [EVENT_TYPE.JOB_STARTED]: ENTITY_TYPE.JOB,
  [EVENT_TYPE.JOB_COMPLETED]: ENTITY_TYPE.JOB,
  [EVENT_TYPE.WORK_ORDER_CREATED]: ENTITY_TYPE.WORK_ORDER,
  [EVENT_TYPE.WORK_ORDER_READY]: ENTITY_TYPE.WORK_ORDER,
  [EVENT_TYPE.WORK_ORDER_BLOCKED]: ENTITY_TYPE.WORK_ORDER,
  [EVENT_TYPE.WORK_ORDER_COMPLETED]: ENTITY_TYPE.WORK_ORDER,
};

// Severity per event type, reusing the shared SEVERITY vocabulary from
// domain/controlTower/types.js so an event's color means the same thing
// a risk/dispatch signal's color does elsewhere in Control Tower.
export const EVENT_SEVERITY = {
  [EVENT_TYPE.JOB_CREATED]: SEVERITY.LOW,
  [EVENT_TYPE.JOB_ASSIGNED]: SEVERITY.LOW,
  [EVENT_TYPE.JOB_STARTED]: SEVERITY.MEDIUM,
  [EVENT_TYPE.JOB_COMPLETED]: SEVERITY.LOW,
  [EVENT_TYPE.WORK_ORDER_CREATED]: SEVERITY.LOW,
  [EVENT_TYPE.WORK_ORDER_READY]: SEVERITY.LOW,
  [EVENT_TYPE.WORK_ORDER_BLOCKED]: SEVERITY.HIGH,
  [EVENT_TYPE.WORK_ORDER_COMPLETED]: SEVERITY.LOW,
};

// Relative lifecycle ordering. Used to break ties when two events share
// the same (approximated) timestamp -- see eventModel.js's sortEvents()
// and timelineBuilder.js's approximation-from-createdAt documentation.
export const EVENT_SEQUENCE_RANK = {
  [EVENT_TYPE.JOB_CREATED]: 0,
  [EVENT_TYPE.WORK_ORDER_CREATED]: 0,
  [EVENT_TYPE.WORK_ORDER_BLOCKED]: 1,
  [EVENT_TYPE.WORK_ORDER_READY]: 2,
  [EVENT_TYPE.JOB_ASSIGNED]: 2,
  [EVENT_TYPE.JOB_STARTED]: 3,
  [EVENT_TYPE.JOB_COMPLETED]: 4,
  [EVENT_TYPE.WORK_ORDER_COMPLETED]: 4,
};

// Short human-readable text per event type, for the Activity Timeline
// panel and Work Order Detail's Operational History. Defined once here
// so both consumers describe an event identically -- see
// eventModel.js's describeEvent().
export const EVENT_LABEL = {
  [EVENT_TYPE.JOB_CREATED]: "Job created",
  [EVENT_TYPE.JOB_ASSIGNED]: "Job assigned",
  [EVENT_TYPE.JOB_STARTED]: "Technician started work",
  [EVENT_TYPE.JOB_COMPLETED]: "Job completed",
  [EVENT_TYPE.WORK_ORDER_CREATED]: "Work order created",
  [EVENT_TYPE.WORK_ORDER_READY]: "Work order became READY",
  [EVENT_TYPE.WORK_ORDER_BLOCKED]: "Work order is BLOCKED",
  [EVENT_TYPE.WORK_ORDER_COMPLETED]: "Work order completed",
};

// Sprint 3.5.3: one icon glyph per event type, shared by the Activity
// Timeline panel and Work Order Detail's Operational History so both
// render the same icon for the same event type instead of each defining
// its own mapping.
export const EVENT_ICON = {
  [EVENT_TYPE.JOB_CREATED]: "+",
  [EVENT_TYPE.JOB_ASSIGNED]: "→",
  [EVENT_TYPE.JOB_STARTED]: "▶",
  [EVENT_TYPE.JOB_COMPLETED]: "✓",
  [EVENT_TYPE.WORK_ORDER_CREATED]: "◆",
  [EVENT_TYPE.WORK_ORDER_READY]: "●",
  [EVENT_TYPE.WORK_ORDER_BLOCKED]: "■",
  [EVENT_TYPE.WORK_ORDER_COMPLETED]: "✓",
};
