// The ONE vocabulary for Work Order status.
//
// Same problem workOrderPriority.js was written to solve, one field over. A stored status
// is an uppercase machine value — CREATED, READY_TO_DISPATCH, WORK_IN_PROGRESS — and every
// surface that shows one has to turn it into words. Until now each did that privately, so
// the labels lived in whichever component happened to need them and nothing kept two
// screens saying the same thing about the same record.
//
// This map is lifted from DispatchSchedulingWorkspace, which held the only complete
// status→label map in the app, so no copy a user reads changes by adopting it.
//
// NOT THE SAME THING as controlTower/WorkOrderActions' STATUS_LABEL, which reads
// "Dispatcher actions", "Awaiting technician", "Active job". Those describe what the panel
// is FOR at each stage — action-panel headings, not a name for the state — and folding
// them in here would produce a status column reading "Dispatcher actions".
//
// The machine values stay uppercase and are never compared against these labels.

/** Stored value -> the words a user reads. */
export const WORK_ORDER_STATUS_LABEL = Object.freeze({
  CREATED: "Created",
  READY_TO_DISPATCH: "Ready to Dispatch",
  SCHEDULED: "Scheduled",
  DISPATCHED: "Dispatched",
  ACCEPTED: "Accepted",
  EN_ROUTE: "En Route",
  ARRIVED: "Arrived",
  WORK_IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
});

/** The canonical machine values, in lifecycle order. */
export const WORK_ORDER_STATUS_VALUES = Object.freeze(Object.keys(WORK_ORDER_STATUS_LABEL));

/**
 * Display text for a stored status.
 *
 * An unrecognised value is returned VERBATIM rather than mapped to a default. A status the
 * vocabulary does not know about is a data question, and silently relabelling it would
 * hide exactly the kind of mismatch #1093 was.
 */
export function workOrderStatusLabel(status) {
  return WORK_ORDER_STATUS_LABEL[status] ?? status ?? "";
}
