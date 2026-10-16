// THE JOBS PAGE'S ORDER (Owner "FIX JOBS AND DISPATCH", 2026-10-16). The page used to list every Work Order in read
// order with one generic chip, so scheduled work could not be dispatched and the actionable rows were lost among
// completed and cancelled ones. This groups the SAME governed Work Order list by what a dispatcher can do next, and
// orders each group by what matters for it. Pure: no clock except the one passed in, no I/O.
import { placementWindow } from "./dispatchBoardGeometry.js";

export const JOB_SECTION = Object.freeze({
  READY_TO_DISPATCH: "READY_TO_DISPATCH",
  TO_SCHEDULE: "TO_SCHEDULE",
  IN_FIELD: "IN_FIELD",
  NOT_READY: "NOT_READY",
  FINISHED: "FINISHED",
});

export const JOB_SECTION_TITLE = Object.freeze({
  [JOB_SECTION.READY_TO_DISPATCH]: "Scheduled — ready to dispatch",
  [JOB_SECTION.TO_SCHEDULE]: "Waiting to be scheduled",
  [JOB_SECTION.IN_FIELD]: "In the field",
  [JOB_SECTION.NOT_READY]: "Not ready to schedule yet",
  [JOB_SECTION.FINISHED]: "Finished or cancelled",
});

const IN_FIELD = new Set(["DISPATCHED", "ACCEPTED", "EN_ROUTE", "ARRIVED", "WORK_IN_PROGRESS"]);
const FINISHED = new Set(["COMPLETED", "CLOSED", "CANCELLED"]);

/** Which section a Work Order belongs to, by its governed status. Unknown statuses are NOT_READY: shown, never actionable. */
export function jobSectionFor(status) {
  if (status === "SCHEDULED") return JOB_SECTION.READY_TO_DISPATCH;
  if (status === "READY_TO_DISPATCH") return JOB_SECTION.TO_SCHEDULE;
  if (IN_FIELD.has(status)) return JOB_SECTION.IN_FIELD;
  if (FINISHED.has(status)) return JOB_SECTION.FINISHED;
  return JOB_SECTION.NOT_READY;
}

const millis = (v) => (v == null ? null : typeof v === "number" ? v : typeof v.toMillis === "function" ? v.toMillis() : null);
const ascNullLast = (x, y) => (x == null ? (y == null ? 0 : 1) : y == null ? -1 : x - y);

/**
 * [{ section, title, items }] in the order a dispatcher works them; empty sections omitted.
 *   ready to dispatch -- earliest scheduled start first (overdue ones surface at the top);
 *   to schedule       -- highest priority (lowest number) first, then oldest;
 *   in the field      -- earliest scheduled start first;
 *   not ready         -- oldest first;
 *   finished          -- most recently changed first.
 * Ties keep the server's order (Array.prototype.sort is stable): nothing is pinned or promoted by name.
 */
export function groupJobs(workOrders) {
  const buckets = new Map(Object.values(JOB_SECTION).map((k) => [k, []]));
  for (const wo of workOrders ?? []) buckets.get(jobSectionFor(wo?.status)).push(wo);
  const start = (wo) => placementWindow(wo)?.startMillis ?? null;
  buckets.get(JOB_SECTION.READY_TO_DISPATCH).sort((a, b) => ascNullLast(start(a), start(b)));
  buckets.get(JOB_SECTION.IN_FIELD).sort((a, b) => ascNullLast(start(a), start(b)));
  buckets.get(JOB_SECTION.TO_SCHEDULE).sort((a, b) =>
    ascNullLast(Number.isInteger(a.priority) ? a.priority : null, Number.isInteger(b.priority) ? b.priority : null)
    || ascNullLast(millis(a.createdAt), millis(b.createdAt)));
  buckets.get(JOB_SECTION.NOT_READY).sort((a, b) => ascNullLast(millis(a.createdAt), millis(b.createdAt)));
  buckets.get(JOB_SECTION.FINISHED).sort((a, b) => ascNullLast(millis(b.updatedAt), millis(a.updatedAt)));
  return Object.values(JOB_SECTION)
    .filter((k) => buckets.get(k).length > 0)
    .map((k) => ({ section: k, title: JOB_SECTION_TITLE[k], items: buckets.get(k) }));
}
