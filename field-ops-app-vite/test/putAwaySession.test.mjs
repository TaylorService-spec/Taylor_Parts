// PUT-AWAY BY SCAN — the pure stow contract. No emulator, no React, no network.
// Run: node --test test/putAwaySession.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  addStowScan, buildStowSession, classifyStowScan, toPutAwayRequest,
  BIN_RESULT, BIN_RESULT_TEXT, STOW_OBSERVATION, STOW_OBSERVATION_TEXT, STOW_BLOCKED, STOW_STEP,
} from "../src/domain/putAwaySession.js";

const session = (over = {}) => ({ warehouseId: "WH-1", partId: "PRT-1001", serialTracked: false, ...over });
const foundBin = { result: BIN_RESULT.FOUND, code: "A-14", warehouseId: "WH-1" };

function scanAll(s, tokens) {
  let obs = Object.freeze([]);
  for (const t of tokens) obs = addStowScan(obs, t, s);
  return obs;
}
const stow = (s, tokens = [], bin = foundBin) =>
  buildStowSession({ session: s, bin, observations: scanAll(s, tokens) });

// ═══════════════════════════════════════════ the invariant

test("the module cannot name a balance, a ledger or a movement", () => {
  // DECISIONS #116: a stow says WHERE, never WHAT THERE IS. If this module could express a quantity
  // change it would be one edit away from removing stowed stock from warehouse on-hand.
  const src = readFileSync(new URL("../src/domain/putAwaySession.js", import.meta.url), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  for (const forbidden of [/onHand/i, /available/i, /reserved/i, /ledger/i, /TRANSFER_|RECEIVED|ADJUSTED/, /balance/i]) {
    assert.doesNotMatch(code, forbidden, `a stow must not reference ${forbidden}`);
  }
});

test("NO QUARANTINE — there is nowhere to express condition or a hold", () => {
  const src = readFileSync(new URL("../src/domain/putAwaySession.js", import.meta.url), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  for (const forbidden of [/quarantine/i, /inspect/i, /condition/i, /disposition/i]) {
    assert.doesNotMatch(code, forbidden, `DECISIONS #117 keeps ${forbidden} out of put-away`);
  }
});

test("the request carries a place and contents — nothing else", () => {
  const state = stow(session(), ["PRT-1001", "PRT-1001"]);
  const r = toPutAwayRequest({ session: session(), bin: foundBin, state, idempotencyKey: "k1" });
  assert.deepEqual(Object.keys(r).sort(), ["binCode", "idempotencyKey", "partId", "quantity", "warehouseId"]);
});

// ═══════════════════════════════════════════ the destination

test("no bin means the stow is still choosing a destination", () => {
  const s = buildStowSession({ session: session(), bin: null, observations: [] });
  assert.equal(s.step, STOW_STEP.DESTINATION);
  assert.ok(s.blockers.includes(STOW_BLOCKED.NO_BIN));
});

test("a FOUND bin moves on to contents", () => {
  assert.equal(stow(session(), []).step, STOW_STEP.CONTENTS);
});

test("every unusable bin blocks, and each keeps its own words", () => {
  for (const result of [BIN_RESULT.INACTIVE, BIN_RESULT.WRONG_WAREHOUSE, BIN_RESULT.NOT_FOUND, BIN_RESULT.MALFORMED]) {
    const s = stow(session(), ["PRT-1001"], { result, code: "A-14" });
    assert.ok(s.blockers.includes(STOW_BLOCKED.BIN_UNUSABLE), `${result} must block`);
    assert.equal(s.canSubmit, false);
    assert.ok(BIN_RESULT_TEXT[result], `${result} has no words`);
  }
  const texts = Object.values(BIN_RESULT_TEXT);
  assert.equal(new Set(texts).size, texts.length, "two different bin problems share one sentence");
});

test("WRONG WAREHOUSE says which building, not that the bin does not exist", () => {
  // A real bin at the wrong site is a different problem from a code nobody registered.
  assert.match(BIN_RESULT_TEXT[BIN_RESULT.WRONG_WAREHOUSE], /different warehouse|building/i);
  assert.notEqual(BIN_RESULT_TEXT[BIN_RESULT.WRONG_WAREHOUSE], BIN_RESULT_TEXT[BIN_RESULT.NOT_FOUND]);
});

test("a RETIRED bin says retired, never 'not registered'", () => {
  assert.match(BIN_RESULT_TEXT[BIN_RESULT.INACTIVE], /retired/i);
});

// ═══════════════════════════════════════════ contents

test("a complete quantity stow can be submitted", () => {
  const s = stow(session(), ["PRT-1001", "PRT-1001", "PRT-1001"]);
  assert.equal(s.quantity, 3);
  assert.equal(s.canSubmit, true);
  assert.deepEqual(s.blockers, []);
});

test("an EMPTY stow is not a finding — it is nothing happening", () => {
  // Unlike a cycle count, where zero IS the answer. A placement record for no items means nothing.
  const s = stow(session(), []);
  assert.ok(s.blockers.includes(STOW_BLOCKED.NOTHING_TO_STOW));
  assert.equal(s.canSubmit, false);
});

test("a DIFFERENT part is refused and blocks", () => {
  const s = stow(session(), ["PRT-1001", "PRT-9999"]);
  assert.ok(s.blockers.includes(STOW_BLOCKED.UNRESOLVED_SCAN));
  assert.equal(s.canSubmit, false);
  assert.match(STOW_OBSERVATION_TEXT[STOW_OBSERVATION.WRONG_PART], /stow it separately/i);
});

test("an unreadable code blocks, distinctly from the wrong part", () => {
  const obs = scanAll(session(), ["{}"]);
  assert.equal(obs[0].state, STOW_OBSERVATION.UNREADABLE);
  assert.notEqual(
    STOW_OBSERVATION_TEXT[STOW_OBSERVATION.UNREADABLE],
    STOW_OBSERVATION_TEXT[STOW_OBSERVATION.WRONG_PART],
  );
});

test("scanning the same PART repeatedly is how you stow several", () => {
  const obs = scanAll(session(), ["PRT-1001", "PRT-1001"]);
  assert.equal(obs[1].state, STOW_OBSERVATION.ADDED);
  assert.equal(stow(session(), ["PRT-1001", "PRT-1001"]).quantity, 2);
});

// ═══════════════════════════════════════════ serialized stows

test("a serialized stow places NAMED units, one request field", () => {
  const s = session({ serialTracked: true });
  const state = stow(s, ["SN-1", "SN-2"]);
  assert.deepEqual([...state.serialNumbers], ["SN-1", "SN-2"]);
  const r = toPutAwayRequest({ session: s, bin: foundBin, state, idempotencyKey: "k1" });
  assert.deepEqual(r.serialNumbers, ["SN-1", "SN-2"]);
  assert.equal(r.quantity, undefined, "exactly one shape — the server refuses both");
});

test("the same serial twice is a duplicate and is placed once", () => {
  const s = session({ serialTracked: true });
  const obs = scanAll(s, ["SN-1", "SN-1"]);
  assert.equal(obs[1].state, STOW_OBSERVATION.DUPLICATE_SERIAL);
  assert.equal(buildStowSession({ session: s, bin: foundBin, observations: obs }).quantity, 1);
});

test("a duplicate serial does not block — it is the operator checking", () => {
  const s = session({ serialTracked: true });
  const state = buildStowSession({ session: s, bin: foundBin, observations: scanAll(s, ["SN-1", "SN-1"]) });
  assert.equal(state.canSubmit, true);
});

test("scanning the PART code on a serialized stow is refused — a kind is not a unit", () => {
  // "Where is SN-42" must be answerable afterwards.
  const obs = scanAll(session({ serialTracked: true }), ["PRT-1001"]);
  assert.equal(obs[0].state, STOW_OBSERVATION.WRONG_PART);
});

test("a quantity stow sends quantity and NEVER a serial list", () => {
  const state = stow(session(), ["PRT-1001"]);
  const r = toPutAwayRequest({ session: session(), bin: foundBin, state, idempotencyKey: "k1" });
  assert.equal(r.quantity, 1);
  assert.equal(r.serialNumbers, undefined);
});

// ═══════════════════════════════════════════ purity

test("adding a scan never mutates what came before", () => {
  const s = session();
  const first = scanAll(s, ["PRT-1001"]);
  const before = JSON.stringify(first);
  addStowScan(first, "PRT-1001", s);
  assert.equal(JSON.stringify(first), before);
});

test("classification never modifies the session", () => {
  const s = session({ serialTracked: true });
  const before = JSON.stringify(s);
  classifyStowScan("SN-1", s, []);
  assert.equal(JSON.stringify(s), before);
});

test("results and lists are frozen", () => {
  const s = stow(session(), ["PRT-1001"]);
  assert.throws(() => { s.canSubmit = false; }, TypeError);
  assert.throws(() => { s.blockers.push("NOPE"); }, TypeError);
});
