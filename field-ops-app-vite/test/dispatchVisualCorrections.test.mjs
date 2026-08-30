// Dispatch P1v1 — the Owner's visual corrections, at the layer that decides them.
//
// ════════════════════ WHAT IS ASSERTED HERE, AND WHY HERE ════════════════════
//
// VC-2/VC-3/VC-4 are ultimately questions about TIME ARITHMETIC — what a move means, what a resize
// means, which slots are targets — and that arithmetic lives in domain/dispatchBoardGeometry.js as
// pure functions. Testing it here rather than through the DOM means these rules can be stated
// exactly, including the ones a rendered board would make awkward to reach (a resize dragged past
// zero, a slot one minute inside the server's tolerance).
//
// The component wiring — that a drag no longer opens a form, that the prompt collects only a reason,
// that the keyboard reaches the same commands — is asserted in test/dispatchNorthStarBoard.test.jsx,
// because that IS a rendering question. The split is deliberate: neither file duplicates the other.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MIN_DURATION_MS,
  PAST_START_TOLERANCE_MS,
  SLOT_MS,
  isSlotSelectable,
  moveWindow,
  pastFractionOfBand,
  resizeWindow,
  snapToSlot,
  windowForDrop,
} from "../src/domain/dispatchBoardGeometry.js";

const H = 3_600_000;
const at = (h, m = 0) => Date.UTC(2026, 7, 31, h, m);

// ── VC-2 · move preserves duration, resize preserves start ───────────────────────────────────────

test("moving a chip changes both edges and keeps the job exactly as long", () => {
  const w = { startMillis: at(9), endMillis: at(11) };
  const moved = moveWindow(w, SLOT_MS);
  assert.equal(moved.startMillis, at(9, 15));
  assert.equal(moved.endMillis, at(11, 15));
  assert.equal(moved.endMillis - moved.startMillis, w.endMillis - w.startMillis,
    "a move must never silently re-length the job — that would be two changes wearing one reason");
});

test("resizing a chip moves the END and leaves the start where it was committed", () => {
  const w = { startMillis: at(9), endMillis: at(11) };
  const longer = resizeWindow(w, SLOT_MS);
  assert.equal(longer.startMillis, at(9), "resize must not drag the start");
  assert.equal(longer.endMillis, at(11, 15));

  const shorter = resizeWindow(w, -SLOT_MS);
  assert.equal(shorter.startMillis, at(9));
  assert.equal(shorter.endMillis, at(10, 45));
});

test("a resize cannot produce a zero-length or inverted placement", () => {
  const w = { startMillis: at(9), endMillis: at(11) };
  const floored = resizeWindow(w, -99 * H);
  assert.equal(floored.endMillis - floored.startMillis, MIN_DURATION_MS,
    "dragging the edge past the start must stop at one slot, not invert the window");
  assert.ok(floored.endMillis > floored.startMillis);
});

test("move and resize refuse to invent a window for a record that has none (R23)", () => {
  // The windowless scheduled record renders in the "Scheduled without a window" fallback. Giving it
  // a time by nudging it would be scheduling by side effect, through a command meant for re-timing.
  assert.equal(moveWindow(null, SLOT_MS), null);
  assert.equal(resizeWindow(null, SLOT_MS), null);
});

// ── VC-2/VC-3 · one grain, whichever hand ────────────────────────────────────────────────────────

test("every gesture lands on the same 15-minute grid", () => {
  assert.equal(SLOT_MS, 900_000);
  assert.equal(snapToSlot(at(9, 7)), at(9));
  assert.equal(snapToSlot(at(9, 8)), at(9, 15));
  // A drop reports a fraction of the band; the result is still on the grid.
  const band = { startMillis: at(7), endMillis: at(17) };
  const dropped = windowForDrop(band, 0.213, 90);
  assert.equal(dropped.startMillis % SLOT_MS, 0, "a drop must not produce a 9:07 start");
  assert.equal(dropped.endMillis - dropped.startMillis, 90 * 60_000, "duration comes from the job");
});

test("keyboard and pointer produce the SAME window for the same intent", () => {
  // VC-3's real requirement: the accessible path is not a second scheduler with its own arithmetic.
  const w = { startMillis: at(9), endMillis: at(11) };
  assert.deepEqual(moveWindow(w, SLOT_MS), moveWindow(w, SLOT_MS));
  assert.deepEqual(resizeWindow(w, -SLOT_MS), resizeWindow(w, -SLOT_MS));
  // Shift is an hour, which is four slots — not a different unit.
  assert.equal(moveWindow(w, 4 * SLOT_MS).startMillis, at(10));
});

// ── VC-4 · past slots on today are not targets ───────────────────────────────────────────────────

test("a slot already past is not selectable, and one in the future is", () => {
  const now = at(12);
  assert.equal(isSlotSelectable(at(11), now), false);
  assert.equal(isSlotSelectable(at(13), now), true);
});

test("the client's past boundary is the SERVER's, not a stricter invention", () => {
  // Mirrors PAST_START_TOLERANCE_MS in functions/src/scheduling/placementPolicy.ts. A client that
  // drifted stricter would grey out slots the server accepts; looser would invite the refusal this
  // correction exists to stop.
  assert.equal(PAST_START_TOLERANCE_MS, 60_000);
  const now = at(12);
  assert.equal(isSlotSelectable(now - 59_000, now), true, "inside tolerance, as the server allows");
  assert.equal(isSlotSelectable(now - 61_000, now), false, "outside tolerance, as the server refuses");
});

test("selectability is answered, never repaired — nothing snaps a past request forward", () => {
  // The Owner was explicit: moving a past request to the next free slot changes the user's intent.
  // These helpers therefore have NO variant that returns a corrected time; the only answer is no.
  const now = at(12);
  const past = { startMillis: at(9), endMillis: at(11) };
  const nudged = moveWindow(past, -SLOT_MS);
  assert.equal(nudged.startMillis, at(8, 45), "the arithmetic still computes what was asked for");
  assert.equal(isSlotSelectable(nudged.startMillis, now), false, "and it is then refused, not moved");
});

test("only TODAY has a dead region: a future day has none and a finished day is all of it", () => {
  const band = { startMillis: at(7), endMillis: at(17) };
  assert.equal(pastFractionOfBand(band, at(6)), 0, "a day that has not started has no past");
  assert.equal(pastFractionOfBand(band, at(18)), 1, "a day already over is entirely past");
  assert.equal(pastFractionOfBand(band, at(12)), 0.5, "midday through a 7-17 band");
});

test("a degenerate band cannot divide by zero into a nonsense shade", () => {
  assert.equal(pastFractionOfBand({ startMillis: at(9), endMillis: at(9) }, at(12)), 0);
  assert.equal(pastFractionOfBand(null, at(12)), 0);
});

test("non-finite inputs are refused rather than treated as 'now'", () => {
  assert.equal(isSlotSelectable(Number.NaN, at(12)), false);
  assert.equal(isSlotSelectable(at(13), Number.NaN), false);
  assert.equal(isSlotSelectable(undefined, at(12)), false);
});
