// CYCLE COUNT BY SCAN — the pure counting session. No emulator, no React, no network.
// Run: node --test test/cycleCountScanSession.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  addCountScan, buildCountSession, classifyCountScan, toSubmitDraft,
  COUNT_OBSERVATION, COUNT_OBSERVATION_TEXT, SUBMIT_BLOCKED,
} from "../src/domain/cycleCountScanSession.js";

const session = (over = {}) => ({
  cycleCountId: "CC-1", partId: "PRT-1001", trackingMode: "NONE",
  location: { type: "WAREHOUSE", locationId: "WH-1" }, status: "COUNTING", ...over,
});

function scanAll(s, tokens) {
  let obs = Object.freeze([]);
  for (const t of tokens) obs = addCountScan(obs, t, s);
  return obs;
}
const count = (s, tokens = []) => buildCountSession({ session: s, observations: scanAll(s, tokens) });

// ─────────────────────────────────────────── the count is blind

test("NOTHING in the session carries an expected quantity or a variance", () => {
  // DECISIONS #111. Showing "expected: 12" while counting is exactly the anchoring a blind count
  // exists to prevent, and it would defeat the control entirely.
  const s = count(session(), ["PRT-1001", "PRT-1001"]);
  for (const forbidden of ["expected", "expectedQuantity", "expectedSerialNumbers", "variance", "over", "short", "discrepancy"]) {
    assert.equal(s[forbidden], undefined, `a counting session must not carry ${forbidden}`);
  }
});

test("the module never names an expected figure or a variance", () => {
  const src = readFileSync(new URL("../src/domain/cycleCountScanSession.js", import.meta.url), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  for (const forbidden of [/expectedQuantity/, /expectedSerial/, /variance/i, /discrepanc/i]) {
    assert.doesNotMatch(code, forbidden, `blind counting must not reference ${forbidden}`);
  }
});

test("an UNCOUNTED serial is simply counted — 'unexpected' is the server's judgement, not this screen's", () => {
  const s = session({ trackingMode: "SERIAL" });
  const obs = scanAll(s, ["SN-NEVER-SEEN"]);
  assert.equal(obs[0].state, COUNT_OBSERVATION.COUNTED);
  assert.equal(obs[0].serialNo, "SN-NEVER-SEEN");
});

// ─────────────────────────────────────────── observation is not adjustment

test("the module has NO reconcile, approve or adjust path", () => {
  const src = readFileSync(new URL("../src/domain/cycleCountScanSession.js", import.meta.url), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  for (const forbidden of [/reconcile/i, /approve/i, /ADJUSTED/, /ledger/i, /firebase/i, /callable/i]) {
    assert.doesNotMatch(code, forbidden, `a counter must not reach ${forbidden} from here`);
  }
});

test("the submit draft carries ONLY what was counted — no decision, no reason, no adjustment", () => {
  const draft = toSubmitDraft(count(session(), ["PRT-1001"]));
  assert.deepEqual(Object.keys(draft), ["countedQuantity"]);
  assert.equal(draft.decision, undefined);
  assert.equal(draft.reason, undefined);
});

// ─────────────────────────────────────────── quantity counts

test("each scan of the part adds one", () => {
  const s = count(session(), ["PRT-1001", "PRT-1001", "PRT-1001"]);
  assert.equal(s.countedQuantity, 3);
  assert.equal(s.canSubmit, true);
});

test("a count of ZERO is submittable — an empty shelf is a real finding", () => {
  // Requiring a scan first would make "there are none here" unreportable, which is precisely the
  // result a cycle count most needs to surface.
  const s = count(session(), []);
  assert.equal(s.countedQuantity, 0);
  assert.equal(s.canSubmit, true);
  assert.deepEqual(toSubmitDraft(s), { countedQuantity: 0 });
});

test("scanning the same PART repeatedly is not a duplicate — that is how you count", () => {
  const obs = scanAll(session(), ["PRT-1001", "PRT-1001"]);
  assert.equal(obs[1].state, COUNT_OBSERVATION.COUNTED);
});

test("a DIFFERENT part is refused and blocks — it is a separate count", () => {
  const s = count(session(), ["PRT-1001", "PRT-9999"]);
  assert.equal(s.unresolved.length, 1);
  assert.ok(s.blockers.includes(SUBMIT_BLOCKED.UNRESOLVED_SCAN));
  assert.equal(s.canSubmit, false);
  assert.match(COUNT_OBSERVATION_TEXT[COUNT_OBSERVATION.WRONG_PART], /count it separately/i);
});

test("an unreadable code blocks, and is distinct from the wrong part", () => {
  const obs = scanAll(session(), ["{}"]);
  assert.equal(obs[0].state, COUNT_OBSERVATION.UNREADABLE);
  assert.notEqual(
    COUNT_OBSERVATION_TEXT[COUNT_OBSERVATION.UNREADABLE],
    COUNT_OBSERVATION_TEXT[COUNT_OBSERVATION.WRONG_PART],
  );
});

// ─────────────────────────────────────────── serialized counts

test("a serialized count stays an explicit LIST, never collapsed to a number", () => {
  // The server reports missing and unexpected serials separately; a bare count would lose which
  // units were actually found.
  const s = count(session({ trackingMode: "SERIAL" }), ["SN-1", "SN-2"]);
  assert.deepEqual([...s.countedSerialNumbers], ["SN-1", "SN-2"]);
  assert.deepEqual(toSubmitDraft(s), { countedSerialNumbers: ["SN-1", "SN-2"] });
});

test("the SAME serial twice is a duplicate and counts once", () => {
  const s = session({ trackingMode: "SERIAL" });
  const obs = scanAll(s, ["SN-1", "SN-1"]);
  assert.equal(obs[1].state, COUNT_OBSERVATION.DUPLICATE_SERIAL);
  const state = buildCountSession({ session: s, observations: obs });
  assert.equal(state.countedQuantity, 1);
  assert.deepEqual([...state.countedSerialNumbers], ["SN-1"]);
});

test("a duplicate serial does NOT block — it is the counter checking, not an error", () => {
  const s = session({ trackingMode: "SERIAL" });
  const state = buildCountSession({ session: s, observations: scanAll(s, ["SN-1", "SN-1"]) });
  assert.equal(state.canSubmit, true);
});

test("duplicate detection is case-insensitive, and the submitted list stays de-duplicated", () => {
  const s = session({ trackingMode: "SERIAL" });
  const state = buildCountSession({ session: s, observations: scanAll(s, ["SN-1", "sn-1", "SN-2"]) });
  assert.equal(state.countedSerialNumbers.length, 2);
});

test("scanning the PART code on a serialized count is refused — a kind is not a unit", () => {
  const obs = scanAll(session({ trackingMode: "SERIAL" }), ["PRT-1001"]);
  assert.equal(obs[0].state, COUNT_OBSERVATION.WRONG_PART);
});

test("a serialized count of zero submits an EMPTY LIST, not a missing field", () => {
  const s = count(session({ trackingMode: "SERIAL" }), []);
  assert.deepEqual(toSubmitDraft(s), { countedSerialNumbers: [] });
  assert.equal(s.canSubmit, true);
});

// ─────────────────────────────────────────── session state

test("no session means nothing can be submitted", () => {
  const s = buildCountSession({ session: null, observations: [] });
  assert.ok(s.blockers.includes(SUBMIT_BLOCKED.NO_SESSION));
  assert.equal(s.canSubmit, false);
});

test("a count that is no longer COUNTING cannot be submitted", () => {
  for (const status of ["SUBMITTED", "RECONCILED", "CANCELLED", "REJECTED", undefined]) {
    const s = count(session({ status }), ["PRT-1001"]);
    assert.ok(s.blockers.includes(SUBMIT_BLOCKED.NOT_COUNTING), `${status} must not be submittable`);
    assert.equal(s.canSubmit, false);
  }
});

test("adding a scan never mutates the previous observations", () => {
  const s = session();
  const first = scanAll(s, ["PRT-1001"]);
  const before = JSON.stringify(first);
  addCountScan(first, "PRT-1001", s);
  assert.equal(JSON.stringify(first), before);
});

test("classification is pure — the session object is never modified", () => {
  const s = session({ trackingMode: "SERIAL" });
  const before = JSON.stringify(s);
  classifyCountScan("SN-1", s, []);
  assert.equal(JSON.stringify(s), before);
});

test("results and their lists are frozen", () => {
  const s = count(session(), ["PRT-1001"]);
  assert.throws(() => { s.canSubmit = false; }, TypeError);
  assert.throws(() => { s.blockers.push("NOPE"); }, TypeError);
});

test("every non-counting observation state has its own words", () => {
  const texts = Object.values(COUNT_OBSERVATION_TEXT);
  assert.equal(new Set(texts).size, texts.length);
  for (const state of Object.values(COUNT_OBSERVATION)) {
    if (state === COUNT_OBSERVATION.COUNTED) continue;
    assert.ok(COUNT_OBSERVATION_TEXT[state], `${state} has no words`);
  }
});
