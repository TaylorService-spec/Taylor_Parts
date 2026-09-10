// Cycle Count -- PURE mapping of a callable's outcome or error into honest, human words. No I/O.
//
// The server carries its domain reason in `details.code` (cycleCountSheetCallables.ts); that is read
// first, because "this sheet is closed" and "you are not authorized" need different next steps. The HTTP
// code is the fallback.

const DETAIL_MESSAGE = Object.freeze({
  SEPARATION_OF_DUTIES: "You submitted this count and cannot approve or reject its own material variance -- a different manager must review it.",
  PERMISSION_DENIED: "You are not authorized to perform this cycle count action.",
  SHEET_NOT_FOUND: "That count sheet could not be found.",
  CYCLE_COUNT_NOT_FOUND: "That part has no line on this sheet yet.",
  LOCATION_INVALID: "That location cannot be counted -- it is inactive, unknown, or a bin whose warehouse has not finished bin conversion.",
  PART_INVALID: "That part cannot be counted here (unknown, inactive, or lot-tracked).",
  REASON_REQUIRED: "A reason is required when the count differs from what was expected.",
  SHEET_STATUS_INVALID: "This sheet no longer allows that action.",
  STATUS_INVALID: "That line no longer allows that action.",
  IDEMPOTENCY_CONFLICT: "This was already submitted with different details. Nothing was changed.",
  MALFORMED_STORED_RECORD: "The stored count is inconsistent and was not changed. Report it.",
  CYCLE_COUNT_INTEGRITY: "The count could not be completed right now. It is safe to try again.",
});

const HTTPS_MESSAGE = Object.freeze({
  "unauthenticated": "You must be signed in to do this.",
  "permission-denied": DETAIL_MESSAGE.PERMISSION_DENIED,
  "not-found": "That could not be found.",
  "failed-precondition": "This cycle count action is not currently permitted.",
  "already-exists": DETAIL_MESSAGE.IDEMPOTENCY_CONFLICT,
  "invalid-argument": "The request was invalid.",
  "unavailable": "The server could not be reached. It is safe to try again.",
  "deadline-exceeded": "The server did not answer in time. It is safe to try again.",
  "internal": "The cycle count action could not be completed.",
});

export function cycleCountErrorCode(err) {
  const raw = err && typeof err.code === "string" ? err.code : "";
  return raw.startsWith("functions/") ? raw.slice("functions/".length) : raw;
}
export function cycleCountErrorDetail(err) {
  const d = err?.details;
  return d && typeof d === "object" && typeof d.code === "string" ? d.code : null;
}

export function mapCycleCountActionError(err) {
  const detail = cycleCountErrorDetail(err);
  if (detail && DETAIL_MESSAGE[detail]) return DETAIL_MESSAGE[detail];
  const code = cycleCountErrorCode(err);
  return HTTPS_MESSAGE[code] ?? "The cycle count action could not be completed.";
}

/**
 * Technical failures are the only ones worth retrying -- with the SAME request, which the server replays.
 * A business refusal (a domain code, or a refusal HTTP code) would fail identically again.
 */
export function isRetryableCycleCountError(err) {
  const detail = cycleCountErrorDetail(err);
  if (detail && detail !== "CYCLE_COUNT_INTEGRITY") return false;
  const code = cycleCountErrorCode(err);
  return code === "" || code === "unavailable" || code === "deadline-exceeded" || code === "internal" || code === "aborted" || code === "resource-exhausted";
}

export function describeCycleCountOutcome(action, outcome, decision) {
  const verb = action === "reconcile"
    ? (decision === "REJECT" ? "rejected" : "approved")
    : ({ createSheet: "started", openLine: "added", submit: "recorded", cancelLine: "removed", cancelSheet: "cancelled", closeSheet: "closed" }[action] ?? action);
  return outcome === "replayed" ? `Already ${verb} (no change made).` : `Count ${verb}.`;
}
