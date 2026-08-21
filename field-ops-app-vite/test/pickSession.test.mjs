// PICK AND STAGE — the pure pick contract. No emulator, no React, no network.
// Run: node --test test/pickSession.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  demandLinesFrom, addPickScan, buildPickLine, classifyPickScan, toStageRequest,
  PICK_OBSERVATION, PICK_OBSERVATION_TEXT, LINE_STATE, STAGE_BLOCKED,
} from "../src/domain/pickSession.js";

const line = (over = {}) => ({ partId: "PRT-1001", name: "Relay", planned: 3, serialTracked: false, ...over });
const bin = { result: "FOUND", code: "STAGE-1" };

function scanAll(l, tokens) {
  let obs = Object.freeze([]);
  for (const t of tokens) obs = addPickScan(obs, t, l);
  return obs;
}
const pick = (l, tokens = [], stagingBin = bin) =>
  buildPickLine({ line: l, observations: scanAll(l, tokens), stagingBin });

// ═══════════════════════════════════════════ picking reserves nothing

test("the module cannot name a reservation, a ledger or a balance", () => {
  // Reservation is a Work Order LIFECYCLE effect (DISPATCHED -> reserveParts), not an operator
  // action. Inventing one here would be a commitment policy nobody has decided.
  const src = readFileSync(new URL("../src/domain/pickSession.js", import.meta.url), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  for (const forbidden of [/RESERVED|CONSUMED|RELEASED/, /reserveParts|consumeParts/, /ledger/i, /onHand|available/i]) {
    assert.doesNotMatch(code, forbidden, `picking must not reference ${forbidden}`);
  }
});

test("staging sends a PLACEMENT — the same request put-away uses, plus why", () => {
  // A pick IS a placement: stock moving inside the warehouse it already belongs to.
  const state = pick(line(), ["PRT-1001", "PRT-1001", "PRT-1001"]);
  const r = toStageRequest({ warehouseId: "WH-1", line: line(), lineState: state, stagingBin: bin, workOrderId: "WO-1", idempotencyKey: "k1" });
  assert.deepEqual(Object.keys(r).sort(), ["binCode", "idempotencyKey", "partId", "pickedForWorkOrderId", "quantity", "warehouseId"]);
  assert.equal(r.pickedForWorkOrderId, "WO-1");
});

// ═══════════════════════════════════════════ demand is read, never authored

test("demand comes from the Work Order's own snapshot", () => {
  const lines = demandLinesFrom({ inventorySnapshot: [
    { partId: "PRT-1001", name: "Relay", qtyPlanned: 3 },
    { sku: "PRT-2002", qtyPlanned: 1, trackingMode: "SERIAL" },
  ] });
  assert.equal(lines.length, 2);
  assert.equal(lines[0].planned, 3);
  assert.equal(lines[1].partId, "PRT-2002", "the legacy sku field is still demand");
  assert.equal(lines[1].serialTracked, true);
});

test("an unusable snapshot row is EXCLUDED, not rendered as a zero line", () => {
  // A zero line invites an operator to pick against something the job never asked for.
  const lines = demandLinesFrom({ inventorySnapshot: [
    { partId: "", qtyPlanned: 3 },
    { partId: "PRT-1001", qtyPlanned: 0 },
    { partId: "PRT-1001", qtyPlanned: -2 },
    { partId: "PRT-1001" },
    { partId: "PRT-9999", qtyPlanned: 1 },
  ] });
  assert.deepEqual(lines.map((l) => l.partId), ["PRT-9999"]);
});

test("a Work Order with no snapshot yields no demand rather than throwing", () => {
  for (const wo of [null, undefined, {}, { inventorySnapshot: "nope" }]) {
    assert.deepEqual(demandLinesFrom(wo), []);
  }
});

// ═══════════════════════════════════════════ picking against a line

test("picking exactly what was planned completes the line", () => {
  const s = pick(line(), ["PRT-1001", "PRT-1001", "PRT-1001"]);
  assert.equal(s.state, LINE_STATE.COMPLETE);
  assert.equal(s.quantity, 3);
  assert.equal(s.shortBy, 0);
  assert.equal(s.canStage, true);
});

test("SHORT is a real, recordable outcome — four of five can be staged", () => {
  // A warehouse that only has four should not be unable to record anything until the fifth appears.
  const s = pick(line({ planned: 5 }), ["PRT-1001", "PRT-1001", "PRT-1001", "PRT-1001"]);
  assert.equal(s.state, LINE_STATE.SHORT);
  assert.equal(s.shortBy, 1);
  assert.equal(s.canStage, true, "the shortfall is visible, not blocking");
});

test("nothing picked cannot be staged — that is not a shortage, it is nothing", () => {
  const s = pick(line(), []);
  assert.equal(s.state, LINE_STATE.NOT_PICKED);
  assert.ok(s.blockers.includes(STAGE_BLOCKED.NOTHING_PICKED));
  assert.equal(s.canStage, false);
});

test("OVER-PICKING is refused, not silently accepted", () => {
  // Taking more than the job needs is stock walking off a shelf for no recorded reason.
  const obs = scanAll(line({ planned: 2 }), ["PRT-1001", "PRT-1001", "PRT-1001"]);
  assert.equal(obs[2].state, PICK_OBSERVATION.EXCESS);
  const s = buildPickLine({ line: line({ planned: 2 }), observations: obs, stagingBin: bin });
  assert.ok(s.blockers.includes(STAGE_BLOCKED.UNRESOLVED_SCAN));
  assert.equal(s.canStage, false);
});

test("the WRONG part is refused and named", () => {
  const obs = scanAll(line(), ["PRT-9999"]);
  assert.equal(obs[0].state, PICK_OBSERVATION.WRONG_PART);
  assert.match(PICK_OBSERVATION_TEXT[PICK_OBSERVATION.WRONG_PART], /not the part this job asked for/i);
});

test("an unreadable code is distinct from the wrong part and from an over-pick", () => {
  const texts = [PICK_OBSERVATION.UNREADABLE, PICK_OBSERVATION.WRONG_PART, PICK_OBSERVATION.EXCESS]
    .map((s) => PICK_OBSERVATION_TEXT[s]);
  assert.equal(new Set(texts).size, 3, "three different mistakes, three sentences");
});

test("no staging bin blocks — picked stock has to go somewhere recorded", () => {
  const s = pick(line(), ["PRT-1001"], null);
  assert.ok(s.blockers.includes(STAGE_BLOCKED.NO_STAGING_BIN));
  assert.equal(s.canStage, false);
});

// ═══════════════════════════════════════════ serialized lines

test("a serialized line picks NAMED units and stages the list", () => {
  const l = line({ planned: 2, serialTracked: true });
  const s = pick(l, ["SN-1", "SN-2"]);
  assert.deepEqual([...s.serialNumbers], ["SN-1", "SN-2"]);
  const r = toStageRequest({ warehouseId: "WH-1", line: l, lineState: s, stagingBin: bin, workOrderId: "WO-1", idempotencyKey: "k1" });
  assert.deepEqual(r.serialNumbers, ["SN-1", "SN-2"]);
  assert.equal(r.quantity, undefined);
});

test("the same serial twice is a duplicate and counts once", () => {
  const l = line({ planned: 2, serialTracked: true });
  const obs = scanAll(l, ["SN-1", "SN-1"]);
  assert.equal(obs[1].state, PICK_OBSERVATION.DUPLICATE_SERIAL);
  assert.equal(buildPickLine({ line: l, observations: obs, stagingBin: bin }).quantity, 1);
});

test("a duplicate does not block — it is the picker checking", () => {
  const l = line({ planned: 1, serialTracked: true });
  const s = buildPickLine({ line: l, observations: scanAll(l, ["SN-1", "SN-1"]), stagingBin: bin });
  assert.equal(s.canStage, true);
});

test("over-picking a serialized line is refused too", () => {
  const l = line({ planned: 1, serialTracked: true });
  const obs = scanAll(l, ["SN-1", "SN-2"]);
  assert.equal(obs[1].state, PICK_OBSERVATION.EXCESS);
});

test("scanning the PART code on a serialized line is refused — a kind is not a unit", () => {
  const obs = scanAll(line({ serialTracked: true }), ["PRT-1001"]);
  assert.equal(obs[0].state, PICK_OBSERVATION.WRONG_PART);
});

test("a QUANTITY line counts repeats correctly — that is how you pick three", () => {
  // The regression this guards: reading the picked COUNT from a list of serials, which are all null
  // on a quantity line, made every scan look like the first.
  const obs = scanAll(line({ planned: 3 }), ["PRT-1001", "PRT-1001", "PRT-1001"]);
  assert.deepEqual(obs.map((o) => o.state), Array(3).fill(PICK_OBSERVATION.PICKED));
  assert.equal(buildPickLine({ line: line({ planned: 3 }), observations: obs, stagingBin: bin }).quantity, 3);
});

// ═══════════════════════════════════════════ purity

test("adding a scan never mutates what came before, and never edits the demand", () => {
  const l = line();
  const beforeLine = JSON.stringify(l);
  const first = scanAll(l, ["PRT-1001"]);
  const beforeObs = JSON.stringify(first);
  addPickScan(first, "PRT-1001", l);
  assert.equal(JSON.stringify(first), beforeObs);
  assert.equal(JSON.stringify(l), beforeLine, "the plan is read, never rewritten to match the pick");
});

test("classification is pure", () => {
  const l = line({ serialTracked: true });
  const before = JSON.stringify(l);
  classifyPickScan("SN-1", l, {});
  assert.equal(JSON.stringify(l), before);
});

test("results and lists are frozen", () => {
  const s = pick(line(), ["PRT-1001"]);
  assert.throws(() => { s.canStage = false; }, TypeError);
  assert.throws(() => { s.blockers.push("NOPE"); }, TypeError);
});
