// Dispatch & Scheduling -- transport over the certified Scheduling domain.
//
// Structure mirrors services/salesAgreementCommandClient.js exactly: firebase imported LAZILY (no
// import-time initializeApp side effect), and this is the only place these callables are invoked.
//
// Never throws. Each method returns { result } on success or { errorStatus, errorCode } on failure.
// `errorStatus` is the HttpsError code (functions/-prefix stripped); `errorCode` is the STABLE
// governed code the server puts in `details.code` -- SCHEDULE_CONFLICT, BLOCKED_TIME_CONFLICT,
// START_IN_PAST, TECHNICIAN_INELIGIBLE, STALE_WORK_ORDER. The board acts on `errorCode`; turning it
// into a sentence belongs to domain/schedulingRefusal.js, not here. This file performs transport only.
//
// ════════════════════ WHY THE READ IS HERE AND NOT A FIRESTORE QUERY ════════════════════
//
// `technician_working_availability` and `technician_blocked_time` DENY CLIENT READS -- deployed, and
// proved live by the Scheduling Functional Gate (a dispatcher's own ID token gets 403 on both). The
// board therefore cannot query them, and readTechnicianAvailability is the only way lane shading,
// blocked-time chips and capacity have anything behind them. Do not add a Firestore path to either
// collection anywhere in this app; it would fail closed, which is correct, and look like a bug.
function mapError(err) {
  const raw = err && typeof err.code === "string" ? err.code : "";
  const status = raw.startsWith("functions/") ? raw.slice("functions/".length) : raw;
  // The server puts the stable governed code in details.code. It is the thing worth acting on: two
  // different refusals both arrive as `failed-precondition` and mean entirely different things to a
  // dispatcher.
  const code = err?.details?.code ?? null;
  return { errorStatus: status || "internal", errorCode: typeof code === "string" ? code : null };
}

async function invoke(name, payload) {
  const [{ httpsCallable }, { functions }] = await Promise.all([
    import("firebase/functions"),
    import("../firebase/firebase.js"),
  ]);
  const res = await httpsCallable(functions, name)(payload);
  return res?.data;
}

const call = async (name, payload) => {
  try {
    return { result: await invoke(name, payload) };
  } catch (err) {
    return mapError(err);
  }
};

// ---------------------------------------------------------------------------------------------
// Placement changes. Initial placement is NOT here -- it is the governed Schedule transition and
// goes through services/workOrderService.transitionWorkOrder, the same path it always used. Adding
// a second scheduling entry point for the board is exactly what ND-24 was about.
// ---------------------------------------------------------------------------------------------

/**
 * Re-time a SCHEDULED Work Order, optionally onto another technician. Status stays SCHEDULED.
 *
 * `expectedScheduledStart` is what makes the drag safe: the dispatcher drags from the position they
 * can SEE, and between the render and the drop somebody else may have moved it. Passing the start
 * the board believed it was moving lets the server refuse STALE_WORK_ORDER instead of silently
 * overwriting a placement this dispatcher never saw. Always send it from a drag.
 */
export const rescheduleWorkOrder = ({ workOrderId, scheduledStart, scheduledEnd, scheduledTechId, reason, expectedScheduledStart }) =>
  call("rescheduleWorkOrderCallable", {
    workOrderId,
    scheduledStart,
    scheduledEnd,
    reason,
    ...(scheduledTechId ? { scheduledTechId } : {}),
    ...(typeof expectedScheduledStart === "number" ? { expectedScheduledStart } : {}),
  });

/**
 * Move a SCHEDULED Work Order to a different technician, KEEPING ITS WINDOW.
 *
 * The window is deliberately not a parameter: the server takes it from the stored record. A caller
 * that could also restate the window could move a job and re-time it in one un-named action, and the
 * audit event would record a reassignment that was really both.
 */
export const reassignScheduledWorkOrder = ({ workOrderId, scheduledTechId, reason }) =>
  call("reassignScheduledWorkOrderCallable", { workOrderId, scheduledTechId, reason });

export const setWorkOrderEstimatedDuration = ({ workOrderId, estimatedDurationMinutes }) =>
  call("setWorkOrderEstimatedDurationCallable", { workOrderId, estimatedDurationMinutes });

// ---------------------------------------------------------------------------------------------
// The trusted read
// ---------------------------------------------------------------------------------------------

/**
 * Governed availability for a window. Omit `technicianIds` for the board's every-technician form.
 *
 * Returns { startMillis, endMillis, technicians: [{ technicianId, workingAvailability, blockedTime,
 * availableMinutes }] }. `workingAvailability: null` and `availableMinutes: null` mean UNRECORDED,
 * not zero, and every consumer must keep them apart -- see domain/dispatchBoardGeometry.js.
 */
export const readTechnicianAvailability = ({ startMillis, endMillis, technicianIds }) =>
  call("readTechnicianAvailabilityCallable", {
    startMillis,
    endMillis,
    ...(Array.isArray(technicianIds) ? { technicianIds } : {}),
  });
