import { test } from "node:test";
import assert from "node:assert/strict";
import { extractWorkerEvidence } from "./workerEvidence.mjs";

const FENCE = "```";
const block = (obj) => `prose before\n\n${FENCE}eos-evidence\n${JSON.stringify(obj, null, 2)}\n${FENCE}\n\nprose after`;

test("a valid wrapped evidence block is found and normalized", () => {
  const r = extractWorkerEvidence(block({ evidence: { receipts: ["tests"], artifacts: ["PATCH"], executionCapable: true, toolPermissionBlocked: false, verifier: "PASS" } }));
  assert.equal(r.found, true);
  assert.deepEqual([...r.evidence.receipts], ["tests"]);
  assert.deepEqual([...r.evidence.artifacts], ["PATCH"]);
  assert.equal(r.evidence.executionCapable, true);
  assert.equal(r.evidence.verifier, "PASS");
});

test("a bare (unwrapped) evidence object is accepted too", () => {
  const r = extractWorkerEvidence(block({ receipts: ["tests"], artifacts: [] }));
  assert.equal(r.found, true);
  assert.deepEqual([...r.evidence.receipts], ["tests"]);
});

test("no block → not found, empty evidence (gate blocks, unchanged behavior)", () => {
  const r = extractWorkerEvidence("I did the work, trust me.");
  assert.equal(r.found, false);
  assert.deepEqual([...r.evidence.receipts], []);
});

test("malformed JSON → not found, never throws", () => {
  const r = extractWorkerEvidence(`x\n${FENCE}eos-evidence\n{not json\n${FENCE}`);
  assert.equal(r.found, false);
  assert.match(r.reason, /invalid JSON/);
});

test("a non-object block (array/scalar) is refused", () => {
  assert.equal(extractWorkerEvidence(`x\n${FENCE}eos-evidence\n[1,2]\n${FENCE}`).found, false);
  assert.equal(extractWorkerEvidence(`x\n${FENCE}eos-evidence\n"hi"\n${FENCE}`).found, false);
});

test("a prose-quoted ```json block is NOT mistaken for evidence", () => {
  const r = extractWorkerEvidence(`here is an example:\n${FENCE}json\n{"evidence":{"receipts":["tests"]}}\n${FENCE}`);
  assert.equal(r.found, false, "a json fence must never be read as the evidence block");
});

test("malformed receipt/artifact entries are filtered, never smuggled through", () => {
  const r = extractWorkerEvidence(block({ evidence: { receipts: ["tests", "", null, 7, {}], artifacts: [null, "PATCH"] } }));
  assert.deepEqual([...r.evidence.receipts], ["tests"]);
  assert.deepEqual([...r.evidence.artifacts], ["PATCH"]);
});

test("executionCapable is tri-state — an unstated value is null, not a positive claim", () => {
  assert.equal(extractWorkerEvidence(block({ evidence: { receipts: [] } })).evidence.executionCapable, null);
  assert.equal(extractWorkerEvidence(block({ evidence: { executionCapable: "yes" } })).evidence.executionCapable, null);
  assert.equal(extractWorkerEvidence(block({ evidence: { executionCapable: false } })).evidence.executionCapable, false);
});

test("toolPermissionBlocked is only true on an explicit boolean true", () => {
  assert.equal(extractWorkerEvidence(block({ evidence: {} })).evidence.toolPermissionBlocked, false);
  assert.equal(extractWorkerEvidence(block({ evidence: { toolPermissionBlocked: "true" } })).evidence.toolPermissionBlocked, false);
  assert.equal(extractWorkerEvidence(block({ evidence: { toolPermissionBlocked: true } })).evidence.toolPermissionBlocked, true);
});

test("non-string input is total (never throws)", () => {
  for (const v of [null, undefined, 7, {}, []]) assert.equal(extractWorkerEvidence(v).found, false);
});
