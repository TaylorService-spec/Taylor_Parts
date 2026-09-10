// CYCLE COUNT BY SCAN — the pure multi-part counting session (BIN-P8 / A2). No emulator, no React.
// Run: node --test test/cycleCountScanSession.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createQueue, addScan, removeEntry } from "../src/domain/scanObservationQueue.js";
import {
  buildCountLines, linesToSubmit, lineDraft, pendingWorkCount, isDuplicateSerial, COUNT_LINE_STATE,
} from "../src/domain/cycleCountScanSession.js";

const scan = (q, partId, serialNo) => addScan(q, { partId, serialNo });
const parts = new Map([
  ["P-A", { trackingMode: "NONE", label: "P-A · Relay" }],
  ["P-S", { trackingMode: "SERIAL", label: "P-S · Compressor" }],
]);
const open = (partId, trackingMode = parts.get(partId)?.trackingMode ?? "NONE") => [partId, { partId, status: "OPEN", trackingMode }];

test("repeated NONE scans aggregate into ONE line; many parts are many lines", () => {
  let q = createQueue();
  q = scan(q, "P-A"); q = scan(q, "P-A"); q = scan(q, "P-A"); q = scan(q, "P-S", "S1");
  const lines = buildCountLines({ observations: q.observations, parts, serverLines: new Map([open("P-A"), open("P-S")]) });
  assert.equal(lines.length, 2);
  const a = lines.find((l) => l.partId === "P-A");
  assert.equal(a.countedQuantity, 3); assert.equal(a.state, COUNT_LINE_STATE.COUNTING);
});

test("SERIAL observations stay individually identified; a repeat serial is detected", () => {
  let q = createQueue();
  q = scan(q, "P-S", "S1"); q = scan(q, "P-S", "S2");
  const [line] = buildCountLines({ observations: q.observations, parts, serverLines: new Map([open("P-S")]) });
  assert.deepEqual([...line.countedSerialNumbers], ["S1", "S2"]); assert.equal(line.countedQuantity, 2);
  assert.equal(isDuplicateSerial(q.observations, "P-S", " s1 "), true, "case-insensitive, trimmed");
  assert.equal(isDuplicateSerial(q.observations, "P-S", "S3"), false);
  assert.equal(isDuplicateSerial(q.observations, "P-A", "S1"), false, "per line, not global");
});

test("a zero count is representable and submittable", () => {
  const lines = buildCountLines({ observations: [], parts, serverLines: new Map([open("P-A")]), zeroed: new Set(["P-A"]) });
  assert.equal(lines[0].state, COUNT_LINE_STATE.COUNTING);
  assert.deepEqual(lineDraft(lines[0]), { countedQuantity: 0 });
  assert.equal(linesToSubmit(lines).length, 1);
});

test("an opened line with nothing counted here is NOT submitted as zero by accident", () => {
  const lines = buildCountLines({ observations: [], parts, serverLines: new Map([open("P-A")]) });
  assert.equal(lines[0].state, COUNT_LINE_STATE.NOT_COUNTED);
  assert.equal(linesToSubmit(lines).length, 0);
});

test("correction before submit: removing an entry changes the count, nothing else", () => {
  let q = createQueue(); q = scan(q, "P-A"); q = scan(q, "P-A");
  const first = buildCountLines({ observations: q.observations, parts, serverLines: new Map([open("P-A")]) })[0];
  q = removeEntry(q, first.entryIds.at(-1));
  assert.equal(buildCountLines({ observations: q.observations, parts, serverLines: new Map([open("P-A")]) })[0].countedQuantity, 1);
});

test("BLIND: an unsubmitted line carries no expected value; a submitted one carries only its own", () => {
  let q = createQueue(); q = scan(q, "P-A");
  const lines = buildCountLines({
    observations: q.observations, parts,
    serverLines: new Map([open("P-A"), ["P-S", { partId: "P-S", trackingMode: "SERIAL", status: "COUNTED", countedSerialNumbers: ["S1"], expectedQuantity: 2, serialVariance: { missing: ["S2"], unexpected: [] } }]]),
  });
  const a = lines.find((l) => l.partId === "P-A"), s = lines.find((l) => l.partId === "P-S");
  for (const k of ["expectedQuantity", "variance", "serialVariance"]) assert.equal(a[k], undefined, `open line must not carry ${k}`);
  assert.equal(s.state, COUNT_LINE_STATE.SUBMITTED); assert.equal(s.expectedQuantity, 2);
});

test("pending work is counted in scans, and a zero counts as one", () => {
  let q = createQueue(); q = scan(q, "P-A"); q = scan(q, "P-A"); q = scan(q, "P-A");
  const lines = buildCountLines({ observations: q.observations, parts, serverLines: new Map([open("P-A"), open("P-S")]), zeroed: new Set(["P-S"]) });
  assert.equal(pendingWorkCount(lines), 4);
});

test("removed and reviewed lines are not resubmitted", () => {
  const lines = buildCountLines({ parts, serverLines: new Map([
    ["P-A", { partId: "P-A", status: "CANCELLED", trackingMode: "NONE" }],
    ["P-S", { partId: "P-S", status: "RECONCILED", trackingMode: "SERIAL", countedSerialNumbers: [] }],
  ]) });
  assert.deepEqual(lines.map((l) => l.state).sort(), [COUNT_LINE_STATE.DECIDED, COUNT_LINE_STATE.REMOVED].sort());
  assert.equal(linesToSubmit(lines).length, 0);
});

test("the module has no reconcile path and no second queue", () => {
  const src = readFileSync(new URL("../src/domain/cycleCountScanSession.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /reconcile\w*\(|approve/i);
  assert.doesNotMatch(src, /function (createQueue|addScan)/, "observations live in the shared scanObservationQueue");
});
