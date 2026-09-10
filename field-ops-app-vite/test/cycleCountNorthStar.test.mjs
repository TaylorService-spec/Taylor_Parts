// THE CYCLE COUNTS P1 DERIVATION LAYER, ASSERTED OFFLINE.
//
// The assertions that carry the most weight are the ones about what must NOT be produced — an
// invented progress denominator, a "success" tone on an unsynced line, a stored counter-completion
// claim (CC-B2), or a recount concept (CC-B1).
import test from "node:test";
import assert from "node:assert/strict";
import {
  blindCellText,
  SHEET_WORD,
  sheetStatusWord,
  LINE_WORD,
  lineStatusWord,
  lineStatusTone,
  counterLineWord,
  deriveFinishCounting,
  deriveCloseEligibility,
  deriveCancelEligibility,
  deriveSheetProgress,
  sheetProgressText,
  needsAnotherReviewer,
} from "../src/domain/cycleCountNorthStar.js";

test("blindCellText is the one literal string", () => {
  assert.equal(blindCellText(), "Hidden until submitted");
});

test("sheetStatusWord: OPEN sheet with any OPEN line is Counting", () => {
  assert.equal(sheetStatusWord({ status: "OPEN" }, [{ status: "OPEN" }, { status: "COUNTED" }]), SHEET_WORD.COUNTING);
});

test("sheetStatusWord: OPEN sheet, all lines COUNTED, is Ready for review", () => {
  assert.equal(sheetStatusWord({ status: "OPEN" }, [{ status: "COUNTED" }, { status: "COUNTED" }]), SHEET_WORD.READY_FOR_REVIEW);
});

test("sheetStatusWord: OPEN sheet with a mix of decided and counted lines is Review in progress", () => {
  assert.equal(
    sheetStatusWord({ status: "OPEN" }, [{ status: "RECONCILED" }, { status: "COUNTED" }]),
    SHEET_WORD.REVIEW_IN_PROGRESS,
  );
});

test("sheetStatusWord: OPEN sheet, every live line disposed, is Complete", () => {
  assert.equal(
    sheetStatusWord({ status: "OPEN" }, [{ status: "RECONCILED" }, { status: "REJECTED" }, { status: "CANCELLED" }]),
    SHEET_WORD.COMPLETE,
  );
});

test("sheetStatusWord: CLOSED sheet is always Complete regardless of lines", () => {
  assert.equal(sheetStatusWord({ status: "CLOSED" }, []), SHEET_WORD.COMPLETE);
});

test("lineStatusWord: OPEN line is Not started, never shows a figure", () => {
  assert.equal(lineStatusWord({ status: "OPEN" }), LINE_WORD.NOT_STARTED);
});

test("lineStatusWord: COUNTED with zero variance is a match", () => {
  assert.equal(lineStatusWord({ status: "COUNTED", variance: 0 }), LINE_WORD.MATCH);
});

test("lineStatusWord: COUNTED with non-zero variance is Variance", () => {
  assert.equal(lineStatusWord({ status: "COUNTED", variance: -1 }), LINE_WORD.VARIANCE);
});

test("lineStatusWord: SERIAL line with a missing serial is Variance", () => {
  assert.equal(
    lineStatusWord({ status: "COUNTED", trackingMode: "SERIAL", serialVariance: { missing: ["SN-1"], unexpected: [] } }),
    LINE_WORD.VARIANCE,
  );
});

test("lineStatusWord: RECONCILED is Approved, REJECTED is Rejected", () => {
  assert.equal(lineStatusWord({ status: "RECONCILED" }), LINE_WORD.APPROVED);
  assert.equal(lineStatusWord({ status: "REJECTED" }), LINE_WORD.REJECTED);
});

test("lineStatusWord: a queued-offline line is Waiting to sync regardless of server status", () => {
  assert.equal(lineStatusWord({ status: "OPEN" }, { queuedOffline: true }), LINE_WORD.WAITING_TO_SYNC);
});

test("lineStatusTone: Waiting to sync is never the success tone", () => {
  assert.notEqual(lineStatusTone(LINE_WORD.WAITING_TO_SYNC), "positive");
});

test("lineStatusTone: an unmapped word falls back to neutral rather than throwing", () => {
  assert.equal(lineStatusTone("nonsense"), "neutral");
});

test("counterLineWord: NOT_COUNTED and COUNTING are distinct words the server's status enum cannot express", () => {
  assert.equal(counterLineWord("NOT_COUNTED"), LINE_WORD.NOT_STARTED);
  assert.equal(counterLineWord("COUNTING"), LINE_WORD.COUNTING);
});

test("counterLineWord: SUBMITTED with no variance is a match, with a variance is Variance", () => {
  assert.equal(counterLineWord("SUBMITTED", { hasVariance: false }), LINE_WORD.MATCH);
  assert.equal(counterLineWord("SUBMITTED", { hasVariance: true }), LINE_WORD.VARIANCE);
});

test("counterLineWord: a queued-offline line is Waiting to sync regardless of state", () => {
  assert.equal(counterLineWord("SUBMITTED", { queuedOffline: true }), LINE_WORD.WAITING_TO_SYNC);
});

test("counterLineWord: REMOVED gets its own word, never borrows the reviewer's Rejected", () => {
  assert.equal(counterLineWord("REMOVED"), "Removed");
});

test("deriveFinishCounting: disabled with a count of what's outstanding, never a stored-state claim", () => {
  const lines = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const submitted = new Set([1]);
  const result = deriveFinishCounting(lines, (l) => submitted.has(l.id));
  assert.equal(result.enabled, false);
  assert.equal(result.reason, "2 lines are not yet submitted.");
});

test("deriveFinishCounting: singular phrasing for exactly one outstanding line", () => {
  const result = deriveFinishCounting([{ id: 1 }], () => false);
  assert.equal(result.reason, "1 line is not yet submitted.");
});

test("deriveFinishCounting: enabled once every line is submitted/cancelled", () => {
  const result = deriveFinishCounting([{ id: 1 }, { id: 2 }], () => true);
  assert.deepEqual(result, { enabled: true, reason: null });
});

test("deriveCloseEligibility: cannot close with an undisposed COUNTED line", () => {
  const result = deriveCloseEligibility({ status: "OPEN" }, [{ status: "RECONCILED" }, { status: "COUNTED" }]);
  assert.equal(result.canClose, false);
  assert.equal(result.reason, "Every line must be reviewed first.");
});

test("deriveCloseEligibility: can close once every live line is disposed", () => {
  const result = deriveCloseEligibility({ status: "OPEN" }, [{ status: "RECONCILED" }, { status: "REJECTED" }, { status: "CANCELLED" }]);
  assert.equal(result.canClose, true);
});

test("deriveCloseEligibility: a sheet with zero live lines cannot be closed", () => {
  assert.equal(deriveCloseEligibility({ status: "OPEN" }, [{ status: "CANCELLED" }]).canClose, false);
});

test("deriveCancelEligibility: cannot cancel once any line has been counted or reviewed", () => {
  assert.equal(deriveCancelEligibility({ status: "OPEN" }, [{ status: "COUNTED" }]).canCancel, false);
});

test("deriveCancelEligibility: can cancel while every line is still OPEN", () => {
  assert.equal(deriveCancelEligibility({ status: "OPEN" }, [{ status: "OPEN" }]).canCancel, true);
});

test("deriveSheetProgress: no denominator on a partial read", () => {
  const result = deriveSheetProgress([{ status: "COUNTED" }, { status: "OPEN" }], false);
  assert.deepEqual(result, { counted: 1, total: null });
});

test("deriveSheetProgress: denominator only once the caller proves it read every line", () => {
  const result = deriveSheetProgress([{ status: "COUNTED" }, { status: "OPEN" }], true);
  assert.deepEqual(result, { counted: 1, total: 2 });
});

test("deriveSheetProgress: CANCELLED lines never count toward counted or total", () => {
  const result = deriveSheetProgress([{ status: "COUNTED" }, { status: "CANCELLED" }], true);
  assert.deepEqual(result, { counted: 1, total: 1 });
});

test("sheetProgressText: omits the denominator entirely when it is unknown", () => {
  assert.equal(sheetProgressText({ counted: 12, total: null }), "12 lines counted");
});

test("sheetProgressText: states the denominator when known", () => {
  assert.equal(sheetProgressText({ counted: 18, total: 27 }), "18 of 27 lines counted");
});

test("needsAnotherReviewer: true only for the line's own submitter on a material variance", () => {
  assert.equal(needsAnotherReviewer({ submittedBy: "u1", variance: -1 }, "u1"), true);
});

test("needsAnotherReviewer: false for a different reviewer", () => {
  assert.equal(needsAnotherReviewer({ submittedBy: "u1", variance: -1 }, "u2"), false);
});

test("needsAnotherReviewer: false when the line matches exactly, even for the submitter", () => {
  assert.equal(needsAnotherReviewer({ submittedBy: "u1", variance: 0 }, "u1"), false);
});

test("needsAnotherReviewer: false with no current user (never a false-positive lockout)", () => {
  assert.equal(needsAnotherReviewer({ submittedBy: "u1", variance: -1 }, null), false);
});
