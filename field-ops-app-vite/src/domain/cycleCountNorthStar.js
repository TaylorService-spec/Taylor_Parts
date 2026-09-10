// Cycle Counts North Star P1 — the family's derivation layer.
//
// PURE: no Firebase, no network, no React, no clock passed implicitly (callers supply `now` where a
// derivation needs it). It composes governed facts the sheet/line projections already carry
// (`cycleCountSheetRead.ts`'s `lineProjection`/`sheetSummary`) and derives no business fact of its
// own — every word here is either an existing enum turned into a sentence, or a stated absence.
//
// ============================ WHAT THIS MODULE MAY NOT DO ============================
//
// CC-B1 (Owner backlog): no recount/reopen concept. REJECT is terminal; nothing here invents a
// "send for recount" verb or a way to reopen a REJECTED line.
//
// CC-B2 (Owner backlog): no stored counter-completion state exists on the server. `deriveFinishCounting`
// is command-free and derived solely from the lines already read — it may never claim a server fact
// that was not actually returned.
//
// CC-D3: a progress denominator ("N of M") is only produced when the caller can prove it read every
// line for that sheet (no `nextCursor` at any page). An ad-hoc, partially-read, or unknown set never
// gets an invented "of M" — see `deriveSheetProgress`.

/** The literal blind-cell copy — kept in exactly one place so no screen paraphrases it. */
export function blindCellText() {
  return "Hidden until submitted";
}

// ────────────────────────────── sheet-level words (derived, never a stored rollup) ──────────────────────────────

export const SHEET_WORD = Object.freeze({
  COUNTING: "Counting",
  READY_FOR_REVIEW: "Ready for review",
  REVIEW_IN_PROGRESS: "Review in progress",
  COMPLETE: "Complete",
});

/**
 * A sheet's derived word, from its lifecycle plus the facts its own lines carry. A1 forbids a stored
 * progress rollup, so this is always computed from the lines actually read for this sheet — callers
 * that have not read any lines yet (a landing-page row before its lines are fetched) should treat the
 * sheet as COUNTING/lifecycle-only until they have lines to reason about.
 *
 * @param sheet  {status: "OPEN"|"CLOSED"|"CANCELLED"}
 * @param lines  the sheet's own line projections (may be a partial read; pass all pages you have)
 */
export function sheetStatusWord(sheet, lines) {
  if (sheet?.status === "CLOSED") return SHEET_WORD.COMPLETE;
  if (sheet?.status === "CANCELLED") return SHEET_WORD.COMPLETE;
  const live = (lines ?? []).filter((l) => l.status !== "CANCELLED");
  if (live.length === 0) return SHEET_WORD.COUNTING;
  if (live.some((l) => l.status === "OPEN")) return SHEET_WORD.COUNTING;
  if (live.some((l) => l.status === "RECONCILED" || l.status === "REJECTED")) {
    return live.every((l) => l.status === "RECONCILED" || l.status === "REJECTED")
      ? SHEET_WORD.COMPLETE
      : SHEET_WORD.REVIEW_IN_PROGRESS;
  }
  return SHEET_WORD.READY_FOR_REVIEW;
}

// ────────────────────────────── line-level words + tone ──────────────────────────────

export const LINE_WORD = Object.freeze({
  NOT_STARTED: "Not started",
  COUNTING: "Counting",
  MATCH: "Counted · match",
  VARIANCE: "Variance",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  WAITING_TO_SYNC: "Waiting to sync",
});

/** A line's tone (see shared/ui/tone.js) — "Waiting to sync" must never resolve to the success tone. */
const LINE_TONE = Object.freeze({
  [LINE_WORD.NOT_STARTED]: "neutral",
  [LINE_WORD.COUNTING]: "attention",
  [LINE_WORD.MATCH]: "positive",
  [LINE_WORD.VARIANCE]: "critical",
  [LINE_WORD.APPROVED]: "positive",
  [LINE_WORD.REJECTED]: "muted",
  [LINE_WORD.WAITING_TO_SYNC]: "attention",
});

function lineHasVariance(line) {
  if (line.trackingMode === "SERIAL") {
    const sv = line.serialVariance;
    return !!sv && ((sv.missing?.length ?? 0) > 0 || (sv.unexpected?.length ?? 0) > 0);
  }
  return typeof line.variance === "number" && line.variance !== 0;
}

/**
 * @param line          a line projection from `getCycleCountSheet` (may be OPEN — no expected/variance keys).
 * @param queuedOffline  true when this line's submit is sitting in the offline queue, not yet accepted
 *                       by the server — a fact the client knows that the server projection cannot.
 */
export function lineStatusWord(line, { queuedOffline = false } = {}) {
  if (queuedOffline) return LINE_WORD.WAITING_TO_SYNC;
  switch (line?.status) {
    case "OPEN":
      return LINE_WORD.NOT_STARTED;
    case "COUNTED":
      return lineHasVariance(line) ? LINE_WORD.VARIANCE : LINE_WORD.MATCH;
    case "RECONCILED":
      return LINE_WORD.APPROVED;
    case "REJECTED":
      return LINE_WORD.REJECTED;
    default:
      return LINE_WORD.NOT_STARTED;
  }
}

export function lineStatusTone(word) {
  return LINE_TONE[word] ?? "neutral";
}

/**
 * The counter workspace's OWN line shape (`cycleCountScanSession.js`'s `COUNT_LINE_STATE`) is a
 * different vocabulary from the server's line `status` enum `lineStatusWord` above reads — it
 * additionally distinguishes "counted here, not yet submitted" from "nothing counted yet", a fact
 * the server projection has no way to express. Kept as a separate function rather than overloading
 * `lineStatusWord` with two incompatible shapes.
 *
 * @param countLineState  one of `COUNT_LINE_STATE`'s values.
 * @param opts.hasVariance  only meaningful once submitted/decided.
 * @param opts.queuedOffline  this device's submit for the line is queued, not yet server-accepted.
 */
export function counterLineWord(countLineState, { hasVariance = false, queuedOffline = false } = {}) {
  if (queuedOffline) return LINE_WORD.WAITING_TO_SYNC;
  switch (countLineState) {
    case "NOT_COUNTED":
      return LINE_WORD.NOT_STARTED;
    case "COUNTING":
      return LINE_WORD.COUNTING;
    case "SUBMITTED":
      return hasVariance ? LINE_WORD.VARIANCE : LINE_WORD.MATCH;
    case "DECIDED":
      // The counter workspace only knows a line was decided, not which way -- reviewer-only facts
      // (Approved vs Rejected) live in the manager workspace's own `lineStatusWord` reading, which
      // has the server's `reviewDecision`. Rendered as a match/variance split here is still honest:
      // it is the same information the counter already had at submit time.
      return hasVariance ? LINE_WORD.VARIANCE : LINE_WORD.MATCH;
    case "REMOVED":
      // Cancelled by the counter before it was ever submitted -- a bookkeeping fact, not a
      // reviewer's REJECTED decision, so it gets its own word rather than borrowing that one.
      return "Removed";
    default:
      return LINE_WORD.NOT_STARTED;
  }
}

// ────────────────────────────── CC-B2: Finish Counting (command-free, derived) ──────────────────────────────

/**
 * @param lines  the counter's own in-progress lines (whatever shape the counter workspace already
 *               builds — needs only `.status`/`.state` and a way to tell "not yet submitted").
 * @param isLineSubmitted  (line) => boolean — the caller's own notion of "submitted or cancelled",
 *                          since the counter workspace and the manager workspace track lines
 *                          differently (client-side scan lines vs. server line projections).
 */
export function deriveFinishCounting(lines, isLineSubmitted) {
  const outstanding = (lines ?? []).filter((l) => !isLineSubmitted(l));
  if (outstanding.length === 0) {
    return { enabled: true, reason: null };
  }
  const noun = outstanding.length === 1 ? "line is" : "lines are";
  return { enabled: false, reason: `${outstanding.length} ${noun} not yet submitted.` };
}

// ────────────────────────────── close/cancel eligibility (moved out of SheetDetail so it's shared) ──────────────────────────────

/**
 * @param sheet  {status}
 * @param lines  every line read for this sheet (must be the FULL set — a caller holding a partial
 *               page must not call this, since a false "every line disposed" would be worse than no
 *               answer at all).
 */
export function deriveCloseEligibility(sheet, lines) {
  const open = sheet?.status === "OPEN";
  const live = (lines ?? []).filter((l) => l.status !== "CANCELLED");
  const canClose = open && live.length > 0 && live.every((l) => l.status === "RECONCILED" || l.status === "REJECTED");
  return { canClose, reason: canClose ? null : "Every line must be reviewed first." };
}

export function deriveCancelEligibility(sheet, lines) {
  const open = sheet?.status === "OPEN";
  const canCancel = open && !(lines ?? []).some((l) => ["COUNTED", "RECONCILED", "REJECTED"].includes(l.status));
  return { canCancel, reason: canCancel ? null : "A line has already been counted or reviewed." };
}

// ────────────────────────────── CC-D3: progress denominator, only when it is provably known ──────────────────────────────

/**
 * "N of M lines counted" is only honest when the caller actually paged every line for this sheet —
 * never an invented denominator for a partial read or an ad-hoc sheet still being built line by line.
 *
 * @param lines        every line read so far for this sheet.
 * @param fullyRead    true only if the caller paged `getCycleCountSheet` to its final `nextCursor === null`.
 */
export function deriveSheetProgress(lines, fullyRead) {
  const live = (lines ?? []).filter((l) => l.status !== "CANCELLED");
  const counted = live.filter((l) => l.status !== "OPEN").length;
  return { counted, total: fullyRead ? live.length : null };
}

/** The landing/table sentence for a sheet's progress — never invents a denominator `deriveSheetProgress` withheld. */
export function sheetProgressText({ counted, total }) {
  return total === null ? `${counted} lines counted` : `${counted} of ${total} lines counted`;
}

// ────────────────────────────── separation of duties (client-side pre-disable only; server is final) ──────────────────────────────

/**
 * Whether Approve/Reject should render pre-disabled with a stated reason (CC-D7) because the line's
 * own submitter is the current viewer and the variance is non-zero. This is a UI courtesy only — the
 * server re-checks and refuses a self-approval on a MATERIAL variance regardless of what this renders.
 */
export function needsAnotherReviewer(line, currentUserId) {
  if (!currentUserId || !line?.submittedBy) return false;
  if (line.submittedBy !== currentUserId) return false;
  return lineHasVariance(line);
}
