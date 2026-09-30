// Dispatch & Scheduling -- transport over the GOVERNED EOS Work Order route only.
//
// WORK ORDER CUTOVER + DECISION 5 (2026-09-30): nothing here touches Firebase any more. Reschedule / reassign,
// the planning estimate AND technician availability (working hours, unavailability) all go through
// services/workOrderService.ts -> POST /operations/work-orders. The former Firebase readTechnicianAvailabilityCallable
// (keyed by fieldops_technicians ids, over technician_working_availability / technician_blocked_time) is RETIRED:
// availability is now the PostgreSQL authority keyed by EMPLOYEE id, and there is no fallback to the callable.
//
// Never throws. Each method returns { result } on success or { errorStatus, errorCode, errorMessage } on failure.
// `errorStatus` is the client category lower-cased (e.g. "precondition_failed", "not_activated"); `errorCode` the
// server's stable code (STALE_SCHEDULE, SCHEDULE_CONFLICT, DOUBLE_BOOKED, AVAILABILITY_NOT_CONFIGURED,
// OUTSIDE_WORKING_HOURS, TECHNICIAN_UNAVAILABLE, ...). Turning a code into a sentence belongs to
// domain/schedulingRefusal.js, not here. This file performs transport and shape adaptation only.
import {
  findAvailableTechnicianSlots as findSlotsGoverned,
  readTechnicianAvailability as readAvailabilityGoverned,
  recordTechnicianUnavailability as recordUnavailabilityGoverned,
  endTechnicianUnavailability as endUnavailabilityGoverned,
  rescheduleWorkOrder as rescheduleGoverned,
  setTechnicianWorkingHours as setHoursGoverned,
  setWorkOrderEstimatedDuration as setEstimateGoverned,
} from "./workOrderService.ts";

// ---------------------------------------------------------------------------------------------
// Placement changes -- over the GOVERNED EOS Work Order route (services/workOrderService.ts ->
// rescheduleWorkOrder), never a Firebase callable. Initial placement is the governed Schedule
// transition (transitionWorkOrder). Same { result } | { errorStatus, errorCode } contract as before:
// `errorStatus` is the client category lower-cased (e.g. "precondition_failed", "not_activated"),
// `errorCode` the server's stable code (STALE_SCHEDULE, SCHEDULE_CONFLICT, DOUBLE_BOOKED, NOT_ACTIVATED...).
// ---------------------------------------------------------------------------------------------

async function governed(fn) {
  try {
    return { result: await fn() };
  } catch (err) {
    const category = typeof err?.code === "string" ? err.code : "INTERNAL";
    return {
      errorStatus: category.toLowerCase(),
      errorCode: typeof err?.reason === "string" ? err.reason : category,
      errorMessage: typeof err?.message === "string" ? err.message : null,
    };
  }
}

const toMillis = (v) => (typeof v === "number" ? v : v && typeof v.toMillis === "function" ? v.toMillis() : null);

/**
 * Re-time a SCHEDULED Work Order, optionally onto another technician (an EMPLOYEE id). Status stays
 * SCHEDULED. `expectedScheduledStart` is the start the board SAW -- REQUIRED by the governed command
 * (it refuses STALE_SCHEDULE when the Work Order moved in between).
 */
export const rescheduleWorkOrder = ({ workOrderId, scheduledStart, scheduledEnd, scheduledTechId, reason, expectedScheduledStart }) =>
  governed(() => rescheduleGoverned({
    workOrderId,
    expectedScheduledStart,
    scheduledStart,
    scheduledEnd,
    reason,
    ...(scheduledTechId ? { employeeId: scheduledTechId } : {}),
  }));

/**
 * Move a SCHEDULED Work Order to a different technician (EMPLOYEE id), KEEPING ITS WINDOW.
 *
 * The governed command has no separate "reassign" verb: it is a reschedule onto the SAME window with a
 * new employeeId, and the window it keeps is the one the caller SAW (`currentWindow`), which doubles as
 * the stale guard. Without a known window the move is refused locally rather than guessed.
 */
export const reassignScheduledWorkOrder = ({ workOrderId, scheduledTechId, reason, currentWindow }) => {
  const start = toMillis(currentWindow?.startMillis ?? currentWindow?.scheduledStart);
  const end = toMillis(currentWindow?.endMillis ?? currentWindow?.scheduledEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return Promise.resolve({ errorStatus: "invalid_input", errorCode: "NOT_SCHEDULED" });
  }
  return governed(() => rescheduleGoverned({
    workOrderId, expectedScheduledStart: start, scheduledStart: start, scheduledEnd: end, employeeId: scheduledTechId, reason,
  }));
};

/**
 * The planning estimate (ND-21): whole minutes, or null to clear. Governed setWorkOrderEstimatedDuration
 * (workOrder.lifecycle.schedule); a terminal Work Order refuses WORK_ORDER_TERMINAL.
 */
export const setWorkOrderEstimatedDuration = ({ workOrderId, estimatedDurationMinutes }) =>
  governed(() => setEstimateGoverned(workOrderId, estimatedDurationMinutes ?? null));

// ---------------------------------------------------------------------------------------------
// Technician availability -- the governed PostgreSQL authority (DECISION 5)
// ---------------------------------------------------------------------------------------------

/**
 * One governed availability view in the board's lane shape. The lane key `technicianId` IS the Employee id (the
 * board's technicians come from listWorkOrderTechnicians, which are Employees). `workingAvailability: null` and
 * `availableMinutes: null` mean NOT CONFIGURED -- never zero -- exactly as before; every consumer keeps them apart
 * (domain/dispatchBoardGeometry.js).
 */
export function adaptAvailabilityView(view) {
  if (!view || typeof view.employeeId !== "string") return null;
  return {
    technicianId: view.employeeId,
    employeeId: view.employeeId,
    displayName: view.displayName ?? null,
    availabilityState: view.availabilityState === "CONFIGURED" ? "CONFIGURED" : "NOT_CONFIGURED",
    workingAvailability: view.workingAvailability ?? null,
    workingIntervals: Array.isArray(view.workingIntervals) ? view.workingIntervals : [],
    notConfiguredIntervals: Array.isArray(view.notConfiguredIntervals) ? view.notConfiguredIntervals : [],
    blockedTime: (Array.isArray(view.blockedTime) ? view.blockedTime : []).map((b) => ({
      blockId: b.unavailabilityId,
      unavailabilityId: b.unavailabilityId,
      kind: b.kind,
      startMillis: b.startMillis,
      endMillis: b.endMillis,
      ...(b.reason ? { note: b.reason } : {}),
    })),
    availableMinutes: typeof view.availableMinutes === "number" ? view.availableMinutes : null,
  };
}

/**
 * Governed availability for a window, keyed by EMPLOYEE id. Omit `technicianIds` (Employee ids) for the board's
 * every-schedulable-technician form. Returns { result: { startMillis, endMillis, technicians: [lane views] } }.
 */
export const readTechnicianAvailability = ({ startMillis, endMillis, technicianIds }) =>
  governed(async () => {
    const res = await readAvailabilityGoverned({
      start: startMillis,
      end: endMillis,
      ...(Array.isArray(technicianIds) ? { employeeIds: technicianIds } : {}),
    });
    return {
      startMillis: res?.startMillis ?? startMillis,
      endMillis: res?.endMillis ?? endMillis,
      technicians: (res?.technicians ?? []).map(adaptAvailabilityView).filter(Boolean),
      notFoundEmployeeIds: res?.notFoundEmployeeIds ?? [],
    };
  });

/** Set an Employee's weekly working hours (workOrder.lifecycle.schedule). */
export const setTechnicianWorkingHours = (input) => governed(() => setHoursGoverned(input));

/** Record a dated unavailability (PTO, TRAINING, ...). Never refuses over scheduled work; warns instead. */
export const recordTechnicianUnavailability = (input) => governed(() => recordUnavailabilityGoverned(input));

/** END an unavailability (never deleted): withdrawn if it has not started, else stopped at `endAt` / now. */
export const endTechnicianUnavailability = (input) => governed(() => endUnavailabilityGoverned(input));

/** The self-scheduling FOUNDATION query (office use now). */
export const findAvailableTechnicianSlots = (input) => governed(() => findSlotsGoverned(input));
