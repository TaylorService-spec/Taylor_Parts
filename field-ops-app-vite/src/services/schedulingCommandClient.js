// Dispatch & Scheduling -- transport over the certified Scheduling domain.
//
// WORK ORDER CUTOVER: the three Work Order WRITES that lived here (rescheduleWorkOrderCallable,
// reassignScheduledWorkOrderCallable, setWorkOrderEstimatedDurationCallable) no longer touch Firebase:
// reschedule / reassign go through the governed EOS route, and the duration estimate is refused (no
// governed operation exists). ONLY readTechnicianAvailability remains a Firebase callable -- it reads
// technician working hours / blocked time, not a Work Order, and is keyed by fieldops_technicians ids.
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
import { rescheduleWorkOrder as rescheduleGoverned } from "./workOrderService";

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
    return { errorStatus: category.toLowerCase(), errorCode: typeof err?.reason === "string" ? err.reason : category };
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
 * The planning estimate. The governed Work Order route has NO operation for it, and it must not fall
 * back to the Firebase callable -- so it is refused, visibly, until the server serves one.
 */
export const setWorkOrderEstimatedDuration = async () =>
  ({ errorStatus: "unavailable", errorCode: "NOT_ON_GOVERNED_ROUTE" });

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
