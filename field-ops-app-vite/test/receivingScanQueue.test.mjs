// RECEIVING MULTI-SCAN QUEUE — pure. No emulator, no React.
// Run: node --test test/receivingScanQueue.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import {
  createQueue, addScan, undoLastScan, removeEntry, setEntryQuantity, clearQueue,
  reconcile, buildSubmissionLines, ENTRY_STATE, ENTRY_STATE_REASON,
} from "../src/domain/receivingScanQueue.js";

const line = (over = {}) => ({
  lineId: "L1", partId: "P1", orderedQuantity: 5, receivedQuantity: 0, remainingQuantity: 5,
  trackingMode: "NONE", ...over,
});
const scan = (q, partId, over = {}) => addScan(q, { partId, ...over });

// ─────────────────────────────────────────── raw observations

test("each scan is one observation, and repeats aggregate by line", () => {
  let q = createQueue();
  q = scan(q, "P1"); q = scan(q, "P1"); q = scan(q, "P1");
  const r = reconcile(q, [line()]);
  assert.equal(r.scanCount, 3);
  assert.equal(r.lines[0].observedNow, 3);
});

test("a keyed quantity is one observation of N — the same mechanism", () => {
  const r = reconcile(scan(createQueue(), "P1", { quantity: 4 }), [line()]);
  assert.equal(r.scanCount, 1);
  assert.equal(r.lines[0].observedNow, 4);
});

test("UNDO drops the last scan and the total follows, because the total is derived", () => {
  let q = createQueue();
  q = scan(q, "P1"); q = scan(q, "P1");
  assert.equal(reconcile(q, [line()]).lines[0].observedNow, 2);
  q = undoLastScan(q);
  assert.equal(reconcile(q, [line()]).lines[0].observedNow, 1);
  assert.equal(undoLastScan(createQueue()).observations.length, 0, "undo on an empty queue is a no-op");
});

test("an entry can be REMOVED by id — correction without rescanning the delivery", () => {
  let q = createQueue();
  q = scan(q, "P1"); q = scan(q, "P1"); q = scan(q, "P1");
  const middle = q.observations[1].entryId;
  q = removeEntry(q, middle);
  assert.equal(q.observations.length, 2);
  assert.equal(q.observations.some((o) => o.entryId === middle), false);
  assert.equal(reconcile(q, [line()]).lines[0].observedNow, 2);
});

test("removing an unknown id changes nothing", () => {
  const q = scan(createQueue(), "P1");
  assert.equal(removeEntry(q, "nope"), q);
});

test("an entry quantity can be CORRECTED", () => {
  let q = scan(createQueue(), "P1");
  q = setEntryQuantity(q, q.observations[0].entryId, 3);
  assert.equal(reconcile(q, [line()]).lines[0].observedNow, 3);
});

test("a SERIALIZED entry quantity cannot be changed — one serial is one unit", () => {
  const l = line({ trackingMode: "SERIAL" });
  let q = addScan(createQueue(), { partId: "P1", serialNo: "S1" });
  q = setEntryQuantity(q, q.observations[0].entryId, 9);
  assert.equal(reconcile(q, [l]).lines[0].observedNow, 1);
});

test("clear empties the queue", () => {
  const q = scan(createQueue(), "P1");
  assert.equal(clearQueue(q).observations.length, 0);
});

// ─────────────────────────────────────────── serials

test("serialized units are SEPARATE entries and are never aggregated", () => {
  const l = line({ trackingMode: "SERIAL", orderedQuantity: 3, remainingQuantity: 3 });
  let q = createQueue();
  q = addScan(q, { partId: "P1", serialNo: "S1" });
  q = addScan(q, { partId: "P1", serialNo: "S2" });
  const r = reconcile(q, [l]);
  assert.equal(r.entries.length, 2);
  assert.equal(r.entries.every((e) => e.quantity === 1), true);
  assert.deepEqual([...r.lines[0].serialNumbers], ["S1", "S2"]);
  assert.equal(r.lines[0].observedNow, 2);
});

test("a DUPLICATE serial is blocked and NOT counted", () => {
  const l = line({ trackingMode: "SERIAL" });
  let q = createQueue();
  q = addScan(q, { partId: "P1", serialNo: "S1" });
  q = addScan(q, { partId: "P1", serialNo: "S1" });
  const r = reconcile(q, [l]);
  assert.equal(r.entries[1].state, ENTRY_STATE.DUPLICATE_SERIAL);
  assert.equal(r.lines[0].observedNow, 1, "the same physical unit is one unit");
  assert.equal(r.submittable, false);
});

test("a serialized part scanned WITHOUT a serial is blocked", () => {
  const r = reconcile(scan(createQueue(), "P1"), [line({ trackingMode: "SERIAL" })]);
  assert.equal(r.entries[0].state, ENTRY_STATE.SERIAL_REQUIRED);
});

test("a non-serialized part scanned WITH a serial is blocked", () => {
  const q = addScan(createQueue(), { partId: "P1", serialNo: "S1" });
  assert.equal(reconcile(q, [line()]).entries[0].state, ENTRY_STATE.SERIAL_NOT_ALLOWED);
});

test("a serial is trimmed but not case-folded — serial identity is case-significant", () => {
  const l = line({ trackingMode: "SERIAL", orderedQuantity: 2, remainingQuantity: 2 });
  let q = addScan(createQueue(), { partId: "P1", serialNo: "  s1  " });
  q = addScan(q, { partId: "P1", serialNo: "S1" });
  const r = reconcile(q, [l]);
  assert.deepEqual([...r.lines[0].serialNumbers], ["s1", "S1"], "different case is a different serial");
});

// ─────────────────────────────────────────── reconciliation

test("expected versus observed is reported per line, including untouched lines", () => {
  const lines = [line(), line({ lineId: "L2", partId: "P2", orderedQuantity: 2, remainingQuantity: 2 })];
  const r = reconcile(scan(createQueue(), "P1"), lines);
  const l1 = r.lines.find((l) => l.lineId === "L1");
  const l2 = r.lines.find((l) => l.lineId === "L2");
  assert.equal(l1.observedNow, 1);
  assert.equal(l1.remainingAfter, 4);
  assert.equal(l2.observedNow, 0, "a line nobody scanned reports zero, not absence");
  assert.equal(l2.remainingAfter, 2);
});

test("PREVIOUSLY RECEIVED is carried through, and remaining is measured from it", () => {
  const r = reconcile(scan(createQueue(), "P1"), [line({ receivedQuantity: 3, remainingQuantity: 2 })]);
  assert.equal(r.lines[0].previouslyReceived, 3);
  assert.equal(r.lines[0].remainingBefore, 2);
  assert.equal(r.lines[0].remainingAfter, 1);
});

test("OVER-RECEIPT is attributed to the scan that crossed the limit", () => {
  let q = createQueue();
  for (let i = 0; i < 3; i += 1) q = scan(q, "P1");
  const r = reconcile(q, [line({ orderedQuantity: 2, remainingQuantity: 2 })]);
  assert.deepEqual(r.entries.map((e) => e.state), [ENTRY_STATE.VALID, ENTRY_STATE.VALID, ENTRY_STATE.OVER_RECEIPT]);
  assert.equal(r.lines[0].observedNow, 2, "the blocked scan is not counted");
  assert.equal(r.submittable, false);
});

test("a part NOT on the order is blocked and attributed to no line", () => {
  const r = reconcile(scan(createQueue(), "GHOST"), [line()]);
  assert.equal(r.entries[0].state, ENTRY_STATE.NOT_ON_ORDER);
  assert.equal(r.entries[0].lineId, null);
});

test("a line already received in full blocks further scans", () => {
  const r = reconcile(scan(createQueue(), "P1"), [line({ receivedQuantity: 5, remainingQuantity: 0 })]);
  assert.equal(r.entries[0].state, ENTRY_STATE.ALREADY_SATISFIED);
});

test("every blocking state has a plain-language reason", () => {
  for (const s of Object.values(ENTRY_STATE)) {
    if (s === ENTRY_STATE.VALID) continue;
    assert.ok(ENTRY_STATE_REASON[s], `${s} has no reason text`);
  }
});

test("a part on TWO lines is reported as ambiguous rather than split by guess", () => {
  const lines = [line(), line({ lineId: "L2" })];
  const r = reconcile(scan(createQueue(), "P1"), lines);
  assert.deepEqual([...r.ambiguousParts], ["P1"]);
  assert.equal(r.entries[0].lineId, "L1", "the first line is used, and the ambiguity is surfaced");
});

// ─────────────────────────────────────────── submission

test("an empty queue is not submittable", () => {
  assert.equal(reconcile(createQueue(), [line()]).submittable, false);
  assert.equal(buildSubmissionLines(reconcile(createQueue(), [line()])), null);
});

test("ANY blocked entry prevents submission — never silently dropped or included", () => {
  let q = scan(createQueue(), "P1");
  q = scan(q, "GHOST");
  const r = reconcile(q, [line()]);
  assert.equal(r.submittable, false);
  assert.equal(r.blocked.length, 1);
  assert.equal(buildSubmissionLines(r), null, "no payload can be built from a queue with a blocked entry");
});

test("removing the blocked entry makes the queue submittable again", () => {
  let q = scan(createQueue(), "P1");
  q = scan(q, "GHOST");
  const bad = reconcile(q, [line()]).blocked[0].entryId;
  const r = reconcile(removeEntry(q, bad), [line()]);
  assert.equal(r.submittable, true);
  assert.deepEqual(buildSubmissionLines(r), [{ lineId: "L1", partId: "P1", receivedQuantity: 1 }]);
});

test("the payload OMITS lines nobody scanned", () => {
  const lines = [line(), line({ lineId: "L2", partId: "P2" })];
  const payload = buildSubmissionLines(reconcile(scan(createQueue(), "P1"), lines));
  assert.equal(payload.length, 1);
  assert.equal(payload[0].lineId, "L1");
});

test("the payload carries serials for a serialized line, and none for a plain one", () => {
  const lines = [
    line({ trackingMode: "SERIAL", orderedQuantity: 2, remainingQuantity: 2 }),
    line({ lineId: "L2", partId: "P2" }),
  ];
  let q = addScan(createQueue(), { partId: "P1", serialNo: "S1" });
  q = scan(q, "P2", { quantity: 2 });
  const payload = buildSubmissionLines(reconcile(q, lines));
  const l1 = payload.find((l) => l.lineId === "L1");
  const l2 = payload.find((l) => l.lineId === "L2");
  assert.deepEqual([...l1.serialNumbers], ["S1"]);
  assert.equal(l1.receivedQuantity, 1);
  assert.equal(l2.serialNumbers, undefined);
  assert.equal(l2.receivedQuantity, 2);
});

test("the payload serial count always equals its received quantity", () => {
  const l = line({ trackingMode: "SERIAL", orderedQuantity: 3, remainingQuantity: 3 });
  let q = createQueue();
  for (const s of ["S1", "S2", "S3"]) q = addScan(q, { partId: "P1", serialNo: s });
  const payload = buildSubmissionLines(reconcile(q, [l]));
  assert.equal(payload[0].serialNumbers.length, payload[0].receivedQuantity);
});

test("the queue is immutable — every operation returns a new value", () => {
  const a = createQueue();
  const b = scan(a, "P1");
  assert.notEqual(a, b);
  assert.equal(a.observations.length, 0, "the original is untouched");
  assert.throws(() => { b.observations.push({}); }, TypeError);
});

test("reconcile holds no state between calls", () => {
  const q = scan(scan(createQueue(), "P1"), "P1");
  const a = reconcile(q, [line()]);
  const b = reconcile(q, [line()]);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
});
