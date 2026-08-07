// Explicit .js extension: Vite resolves extensionless imports but the plain
// `node --test` runner does not, and this module is unit-tested there.
import { getAllowedActions } from "./workOrderWorkflow.js";

/**
 * F0 — field-facing selectors over the GOVERNED Work Order (`fieldops_wos`).
 *
 * This is presentation logic only. It introduces no model, no collection, no
 * status vocabulary and no permission of its own: every "may I?" question is
 * answered by getAllowedActions(), which is contract-tested against
 * functions/src/transitionEngine.ts. Labels are the only thing owned here.
 *
 * Replaces the legacy field path, where "Start Travel" and "Arrived" were React
 * local state (FieldMode's travelStageByJob) that never reached the server. On
 * the governed engine those are real transitions with real server timestamps
 * (enRouteAt / arrivedAt), so a dispatcher can finally see that a technician is
 * en route.
 */

// Labels for the technician lifecycle, in order. `from` documents the status
// each action belongs to for progress display -- it is NEVER used to decide
// whether an action is offered. Authority for that is getAllowedActions().
// `label` is the ACTION ("do this"); `stateLabel` is the resulting STATE ("this
// has happened"). They are separate because a progress track labelled with
// actions reads wrongly -- the current step would repeat the button's words back
// at the technician, so "Complete job" appeared both as a step and as the
// action. Steps describe where the job IS; the button describes what to do next.
export const FIELD_ACTIONS = [
  { action: "Accept", label: "Accept job", stateLabel: "Accepted", from: "DISPATCHED" },
  { action: "Travel", label: "Start travel", stateLabel: "Travelling", from: "ACCEPTED" },
  { action: "Arrive", label: "Arrived", stateLabel: "On site", from: "EN_ROUTE" },
  { action: "WorkStart", label: "Start work", stateLabel: "Working", from: "ARRIVED" },
  { action: "Complete", label: "Complete job", stateLabel: "Complete", from: "WORK_IN_PROGRESS" },
];

const LABEL_BY_ACTION = new Map(FIELD_ACTIONS.map((a) => [a.action, a.label]));

/** Statuses at which a technician still has something to do. */
export const FIELD_ACTIVE_STATUSES = Object.freeze([
  "DISPATCHED",
  "ACCEPTED",
  "EN_ROUTE",
  "ARRIVED",
  "WORK_IN_PROGRESS",
]);

const ACTIVE = new Set(FIELD_ACTIVE_STATUSES);

export function isActiveFieldWorkOrder(workOrder) {
  return !!workOrder && ACTIVE.has(workOrder.status);
}

/**
 * The single next step this technician may take, or null.
 *
 * Derived from the governed permission matrix, then narrowed to the field
 * lifecycle -- so an admin-only action (Cancel, Close) is never surfaced as a
 * technician's "next step" even where the role would otherwise permit it.
 * Ownership is decided by comparing assignedTechId, exactly as the server does.
 */
export function nextFieldAction(workOrder, technicianId) {
  if (!workOrder || !technicianId) return null;
  const isOwn = workOrder.assignedTechId === technicianId;
  if (!isOwn) return null;
  const allowed = getAllowedActions(workOrder.status, "technician", true);
  const match = FIELD_ACTIONS.find((a) => allowed.includes(a.action));
  return match ? { action: match.action, label: match.label } : null;
}

export function fieldActionLabel(action) {
  return LABEL_BY_ACTION.get(action) ?? action;
}

/**
 * How far through the field lifecycle a Work Order has progressed: 0 before
 * acceptance, 5 once complete. Drives a progress indicator, never a decision.
 */
export function fieldProgressStep(status) {
  const order = ["DISPATCHED", "ACCEPTED", "EN_ROUTE", "ARRIVED", "WORK_IN_PROGRESS", "COMPLETED"];
  const i = order.indexOf(status);
  return i === -1 ? 0 : i;
}

/**
 * Active work first, then by how far along it is (most advanced first, so the
 * job actually in progress leads), then by Work Order number for stability.
 * Pure and total-ordering — no reliance on array order from the query.
 */
export function sortFieldWorkOrders(workOrders = []) {
  return [...workOrders].sort((a, b) => {
    const activeDiff = Number(isActiveFieldWorkOrder(b)) - Number(isActiveFieldWorkOrder(a));
    if (activeDiff !== 0) return activeDiff;
    const progressDiff = fieldProgressStep(b.status) - fieldProgressStep(a.status);
    if (progressDiff !== 0) return progressDiff;
    return String(a.woNumber ?? a.id).localeCompare(String(b.woNumber ?? b.id));
  });
}

/** The technician's active queue, most-advanced first. */
export function activeFieldWorkOrders(workOrders = []) {
  return sortFieldWorkOrders(workOrders.filter(isActiveFieldWorkOrder));
}

/**
 * Operational PHASE — a coarse projection of the eleven governed statuses.
 *
 * Control Tower's signal algorithms (risk, dispatch scoring, timeline) were
 * written against the legacy four-state model. Rather than either rewriting
 * those algorithms' semantics or teaching each of them all eleven governed
 * statuses, they consume this projection: the operational question each asks
 * is "is this awaiting dispatch / assigned / being worked / finished?", which
 * is exactly what a phase answers.
 *
 * This is a PROJECTION OF THE GOVERNED MODEL, not a surviving legacy model:
 * the governed status remains the authority and the only thing persisted, and
 * nothing transitions on a phase. The four phase names are deliberately not
 * the legacy JOB_STATUS values, so the two can never be confused.
 */
export const FIELD_PHASE = Object.freeze({
  AWAITING_DISPATCH: "awaiting_dispatch",
  ASSIGNED: "assigned",
  ON_SITE: "on_site",
  FINISHED: "finished",
});

const PHASE_BY_STATUS = Object.freeze({
  CREATED: FIELD_PHASE.AWAITING_DISPATCH,
  READY_TO_DISPATCH: FIELD_PHASE.AWAITING_DISPATCH,
  SCHEDULED: FIELD_PHASE.AWAITING_DISPATCH,
  DISPATCHED: FIELD_PHASE.ASSIGNED,
  ACCEPTED: FIELD_PHASE.ASSIGNED,
  EN_ROUTE: FIELD_PHASE.ASSIGNED,
  ARRIVED: FIELD_PHASE.ON_SITE,
  WORK_IN_PROGRESS: FIELD_PHASE.ON_SITE,
  COMPLETED: FIELD_PHASE.FINISHED,
  CLOSED: FIELD_PHASE.FINISHED,
  CANCELLED: FIELD_PHASE.FINISHED,
});

/**
 * Fails closed: an unrecognised status is treated as AWAITING_DISPATCH so it
 * surfaces as work needing attention rather than silently counting as done.
 */
export function fieldPhase(statusOrWorkOrder) {
  const status = typeof statusOrWorkOrder === "string"
    ? statusOrWorkOrder
    : statusOrWorkOrder?.status;
  return PHASE_BY_STATUS[status] ?? FIELD_PHASE.AWAITING_DISPATCH;
}

/** Work still owed to a customer: assigned or on site, not finished. */
export function isOpenWorkOrder(workOrder) {
  const phase = fieldPhase(workOrder);
  return phase === FIELD_PHASE.AWAITING_DISPATCH
    || phase === FIELD_PHASE.ASSIGNED
    || phase === FIELD_PHASE.ON_SITE;
}
