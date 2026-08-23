// RECORDING TIME ON A PHONE — the decisions, with no network and no React.
//
// ============================ THE UI IS DURATION, THE RECORD MAY BE EITHER ============================
//
// A technician finishing a job types "1 hour 30". They do not know, and should not have to
// reconstruct, when those ninety minutes began. So the common path produces a DURATION entry: a
// length and the day it belongs to, with no invented clock position.
//
// The INTERVAL shape exists for when the times genuinely are known -- a timer that ran, or an entry
// corrected against a schedule -- and it is the richer fact because it can be overlap-checked. The
// server accepts both and says which it got. Neither is a lesser version of the other.
//
// ============================ WHAT THIS SCREEN NEVER SHOWS ============================
//
// No rate. No cost. No billable total. The labor record carries none of them, on purpose, and a
// screen that displayed a figure would have to invent it.
//
// PURE: no firebase, no React. Tested in technicianLaborEntry.test.mjs.

export const LABOR_TYPE_OPTIONS = Object.freeze([
  { value: "ONSITE", label: "On site" },
  { value: "TRAVEL", label: "Travel" },
]);

/** Mirrors the command's technical bound. Not an HR rule -- see the command for why 16 hours. */
export const MAX_LABOR_MINUTES = 16 * 60;

export const LABOR_SUBMIT = Object.freeze({
  IDLE: "IDLE", SUBMITTING: "SUBMITTING", SAVED: "SAVED", PENDING_SYNC: "PENDING_SYNC", FAILED: "FAILED",
});

const FAILURE_MESSAGE = Object.freeze({
  NOT_ASSIGNED_TECHNICIAN: "This work order is not assigned to you.",
  WORK_ORDER_STATE_INVALID: "This job is not being worked, so time cannot be added to it.",
  OVERLAPPING_ENTRY: "That time overlaps labor you already recorded.",
  DURATION_INVALID: "That amount of time is not valid.",
  INTERVAL_INVALID: "Those start and end times are not valid.",
  IDEMPOTENCY_CONFLICT: "A different entry was already recorded for this attempt.",
  PERMISSION_DENIED: "You are not authorized to record labor.",
});

const int = (v) => (typeof v === "number" && Number.isInteger(v) ? v : null);

/** Hours + minutes as a technician types them, into the one number the command wants. */
export function toDurationMinutes({ hours, minutes } = {}) {
  const h = Number(hours ?? 0), m = Number(minutes ?? 0);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || m < 0) return null;
  const total = Math.round(h * 60 + m);
  return Number.isInteger(total) ? total : null;
}

/**
 * Is this entry worth sending?
 *
 * Returns the reason when it is not, because a disabled Save with no explanation is the thing a
 * technician standing in a plant room least needs.
 */
export function validateLaborEntry({ hours, minutes, laborType } = {}) {
  const total = toDurationMinutes({ hours, minutes });
  if (total === null) return { valid: false, reason: "Enter the time as hours and minutes." };
  if (total < 1) return { valid: false, reason: "Enter how long you worked." };
  if (total > MAX_LABOR_MINUTES) {
    return { valid: false, reason: `That is longer than ${MAX_LABOR_MINUTES / 60} hours. Split it into separate entries.` };
  }
  if (!LABOR_TYPE_OPTIONS.some((o) => o.value === laborType)) {
    return { valid: false, reason: "Choose on site or travel." };
  }
  return { valid: true, reason: null, durationMinutes: total };
}

/**
 * One attempt's identity.
 *
 * Deterministic from the job, the day, the type and the length, plus a token minted when the
 * technician presses Save. A retry of the SAME entry replays; changing any of it is a new request
 * rather than a replay that would return the earlier, wrong record.
 */
export function deriveLaborIntentId({ workOrderId, workDate, laborType, durationMinutes, attemptToken } = {}) {
  if (!workOrderId || !workDate || !laborType || !int(durationMinutes) || !attemptToken) return null;
  const safe = (v) => String(v).replace(/[^A-Za-z0-9_-]/g, "-");
  return `lab_${safe(workOrderId)}_${safe(workDate)}_${safe(laborType)}_${durationMinutes}_${safe(attemptToken)}`;
}

/**
 * The request the callable receives.
 *
 * `deviceReportedAtMillis` is sent ONLY when the entry was captured offline. Online, the server's own
 * clock is the only timestamp that matters and adding a second one would invite somebody to reconcile
 * two readings that never disagreed.
 */
export function buildLaborRequest({ workOrderId, workDate, laborType, hours, minutes, notes, attemptToken, capturedOfflineAtMillis } = {}) {
  const v = validateLaborEntry({ hours, minutes, laborType });
  if (!v.valid) return null;
  const idempotencyKey = deriveLaborIntentId({
    workOrderId, workDate, laborType, durationMinutes: v.durationMinutes, attemptToken,
  });
  if (!idempotencyKey) return null;
  return {
    workOrderId, laborType, entryKind: "DURATION",
    durationMinutes: v.durationMinutes, workDate, idempotencyKey,
    ...(notes && notes.trim() ? { notes: notes.trim() } : {}),
    ...(int(capturedOfflineAtMillis) ? { deviceReportedAtMillis: capturedOfflineAtMillis } : {}),
  };
}

/** Read the answer. A replay is a success -- the time is recorded either way. */
export function interpretLaborResult({ outcome, error } = {}) {
  if (outcome && (outcome.outcome === "recorded" || outcome.outcome === "replayed")) {
    return {
      status: LABOR_SUBMIT.SAVED,
      laborEntryId: outcome.laborEntryId ?? null,
      durationMinutes: outcome.durationMinutes ?? null,
      message: outcome.outcome === "replayed" ? "Already recorded." : "Time recorded.",
    };
  }
  const code = error?.details ?? error?.code ?? null;
  return {
    status: LABOR_SUBMIT.FAILED, code,
    message: FAILURE_MESSAGE[code] ?? error?.message ?? "That time could not be recorded.",
  };
}

/** Hours and minutes, for a total a person reads. */
export function formatMinutes(total) {
  const m = int(total) ?? 0;
  const h = Math.floor(m / 60), rest = m % 60;
  if (h === 0) return `${rest}m`;
  return rest === 0 ? `${h}h` : `${h}h ${rest}m`;
}

/**
 * An offline capture. NOT a saved entry.
 *
 * Carries the device's own clock reading so the server can keep both timestamps -- rewriting the work
 * time to the sync time would move real work to the moment the signal came back.
 */
export function captureOfflineLabor(form, attemptToken, capturedAtLocal) {
  const request = buildLaborRequest({ ...form, attemptToken, capturedOfflineAtMillis: capturedAtLocal });
  if (!request) return null;
  return { intentId: request.idempotencyKey, request, state: "PENDING_SYNC", capturedAtLocal };
}
