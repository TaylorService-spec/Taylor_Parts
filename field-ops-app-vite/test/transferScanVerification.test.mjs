// TRANSFERS BY SCAN — the pure verification contract. No emulator, no React, no network.
// Run: node --test test/transferScanVerification.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  buildTransferVerification, classifyObservation, actionForStatus, expectedLocationFor,
  TRANSFER_ACTION, NOT_ACTIONABLE, OBSERVATION_STATE, BLOCKED_REASON, OBSERVATION_TEXT,
} from "../src/domain/transferScanVerification.js";

const WH1 = { type: "WAREHOUSE", locationId: "WH-1" };
const WH2 = { type: "WAREHOUSE", locationId: "WH-2" };

const order = (over = {}) => ({
  transferOrderId: "TO-1",
  partId: "PRT-1001",
  quantity: 3,
  trackingMode: "NONE",
  serialNumbers: [],
  status: "REQUESTED",
  origin: WH1,
  destination: WH2,
  ...over,
});

const serialOrder = (serials = ["SN-1", "SN-2"], over = {}) =>
  order({ trackingMode: "SERIAL", quantity: serials.length, serialNumbers: serials, ...over });

/** Scan a sequence, threading verified progress exactly as a queue would. */
function scanAll(o, tokens) {
  const observations = [];
  for (const t of tokens) {
    observations.push(classifyObservation(t, o, observations.filter((x) => x.state === OBSERVATION_STATE.VERIFIED)));
  }
  return observations;
}

const verify = (o, tokens = [], confirmedLocation = null) =>
  buildTransferVerification({ order: o, observations: scanAll(o, tokens), confirmedLocation });

// ─────────────────────────────────────────── which action, and where

test("status decides the action, mirroring the server's own gate", () => {
  assert.equal(actionForStatus("REQUESTED").action, TRANSFER_ACTION.DISPATCH);
  assert.equal(actionForStatus("IN_TRANSIT").action, TRANSFER_ACTION.RECEIVE);
});

test("a finished or cancelled transfer offers NO action, and says which", () => {
  assert.equal(actionForStatus("COMPLETED").reason, NOT_ACTIONABLE.COMPLETED);
  assert.equal(actionForStatus("CANCELLED").reason, NOT_ACTIONABLE.CANCELLED);
  assert.equal(actionForStatus("WHAT").reason, NOT_ACTIONABLE.UNKNOWN_STATUS);
  for (const s of ["COMPLETED", "CANCELLED", "WHAT", undefined]) {
    assert.equal(actionForStatus(s).action, TRANSFER_ACTION.NONE);
  }
});

test("dispatch happens at the ORIGIN and receive at the DESTINATION", () => {
  assert.deepEqual(expectedLocationFor(order(), TRANSFER_ACTION.DISPATCH), WH1);
  assert.deepEqual(expectedLocationFor(order(), TRANSFER_ACTION.RECEIVE), WH2);
  assert.equal(expectedLocationFor(order(), TRANSFER_ACTION.NONE), null);
});

test("being at the WRONG location blocks submission even when everything is scanned", () => {
  const v = verify(order(), ["PRT-1001", "PRT-1001", "PRT-1001"], WH2);
  assert.equal(v.locationConfirmed, false);
  assert.ok(v.blockers.includes(BLOCKED_REASON.WRONG_LOCATION));
  assert.equal(v.canSubmit, false);
});

test("an UNCONFIRMED location blocks too — not confirming is not the same as being right", () => {
  const v = verify(order(), ["PRT-1001", "PRT-1001", "PRT-1001"], null);
  assert.ok(v.blockers.includes(BLOCKED_REASON.WRONG_LOCATION));
});

test("the location must match by TYPE as well as id", () => {
  const v = verify(order(), ["PRT-1001", "PRT-1001", "PRT-1001"], { type: "MOBILE", locationId: "WH-1" });
  assert.equal(v.locationConfirmed, false);
});

// ─────────────────────────────────────────── quantity transfers

test("a complete, correctly located quantity transfer can be submitted", () => {
  const v = verify(order(), ["PRT-1001", "PRT-1001", "PRT-1001"], WH1);
  assert.equal(v.verifiedCount, 3);
  assert.equal(v.required, 3);
  assert.equal(v.canSubmit, true);
  assert.deepEqual(v.blockers, []);
});

test("an INCOMPLETE transfer cannot be submitted — this command has no partial dispatch", () => {
  const v = verify(order(), ["PRT-1001"], WH1);
  assert.equal(v.verifiedCount, 1);
  assert.ok(v.blockers.includes(BLOCKED_REASON.INCOMPLETE));
  assert.equal(v.canSubmit, false);
});

test("scanning nothing is its own blocker, distinct from scanning too few", () => {
  const empty = verify(order(), [], WH1);
  const partial = verify(order(), ["PRT-1001"], WH1);
  assert.ok(empty.blockers.includes(BLOCKED_REASON.NOTHING_SCANNED));
  assert.equal(empty.blockers.includes(BLOCKED_REASON.INCOMPLETE), false);
  assert.ok(partial.blockers.includes(BLOCKED_REASON.INCOMPLETE));
});

test("one unit too many is EXCESS and blocks — never silently dropped", () => {
  const obs = scanAll(order(), ["PRT-1001", "PRT-1001", "PRT-1001", "PRT-1001"]);
  assert.equal(obs[3].state, OBSERVATION_STATE.EXCESS);
  const v = buildTransferVerification({ order: order(), observations: obs, confirmedLocation: WH1 });
  assert.ok(v.blockers.includes(BLOCKED_REASON.BLOCKED_OBSERVATION));
  assert.equal(v.canSubmit, false, "the operator must resolve the extra unit physically");
});

test("the WRONG PART is refused and named as such", () => {
  const obs = scanAll(order(), ["PRT-9999"]);
  assert.equal(obs[0].state, OBSERVATION_STATE.WRONG_PART);
  assert.match(OBSERVATION_TEXT[OBSERVATION_STATE.WRONG_PART], /different part/i);
});

test("an unreadable code is refused, and is not mistaken for the wrong part", () => {
  const obs = scanAll(order(), ["{}"]);
  assert.equal(obs[0].state, OBSERVATION_STATE.UNREADABLE);
  assert.notEqual(OBSERVATION_TEXT[OBSERVATION_STATE.UNREADABLE], OBSERVATION_TEXT[OBSERVATION_STATE.WRONG_PART]);
});

// ─────────────────────────────────────────── serialized transfers

test("a serialized transfer verifies NAMED units, and lists which are outstanding", () => {
  const o = serialOrder(["SN-1", "SN-2", "SN-3"]);
  const v = verify(o, ["SN-2"], WH1);
  assert.equal(v.verifiedCount, 1);
  // "1 of 3" does not tell an operator which two boxes to go and find.
  assert.deepEqual(v.outstandingSerials, ["SN-1", "SN-3"]);
  assert.equal(v.canSubmit, false);
});

test("all listed serials, at the right place, can be submitted", () => {
  const o = serialOrder(["SN-1", "SN-2"]);
  const v = verify(o, ["SN-1", "SN-2"], WH1);
  assert.deepEqual(v.outstandingSerials, []);
  assert.equal(v.canSubmit, true);
});

test("a serial NOT on the order is refused, even for the right part", () => {
  const obs = scanAll(serialOrder(["SN-1", "SN-2"]), ["SN-9"]);
  assert.equal(obs[0].state, OBSERVATION_STATE.UNKNOWN_SERIAL);
});

test("scanning the PART code on a serialized transfer identifies a KIND, not a unit", () => {
  // The transfer moves named units. Accepting the part code would let the wrong physical box travel.
  const obs = scanAll(serialOrder(["SN-1"]), ["PRT-1001"]);
  assert.equal(obs[0].state, OBSERVATION_STATE.UNKNOWN_SERIAL);
});

test("the same serial twice is DUPLICATE, and never counts twice", () => {
  const o = serialOrder(["SN-1", "SN-2"]);
  const obs = scanAll(o, ["SN-1", "SN-1"]);
  assert.equal(obs[1].state, OBSERVATION_STATE.DUPLICATE);
  const v = buildTransferVerification({ order: o, observations: obs, confirmedLocation: WH1 });
  assert.equal(v.verifiedCount, 1, "a re-scan is not progress");
});

test("a DUPLICATE does not block — it is the operator checking, not an error", () => {
  const o = serialOrder(["SN-1"]);
  const v = buildTransferVerification({ order: o, observations: scanAll(o, ["SN-1", "SN-1"]), confirmedLocation: WH1 });
  assert.equal(v.blockers.includes(BLOCKED_REASON.BLOCKED_OBSERVATION), false);
  assert.equal(v.canSubmit, true);
});

test("serial matching is case-insensitive but never fuzzy", () => {
  const o = serialOrder(["SN-1"]);
  assert.equal(scanAll(o, ["sn-1"])[0].state, OBSERVATION_STATE.VERIFIED);
  assert.equal(scanAll(o, ["SN-11"])[0].state, OBSERVATION_STATE.UNKNOWN_SERIAL);
});

// ─────────────────────────────────────────── stale and finished orders

test("a COMPLETED order offers no action and cannot be submitted, however much is scanned", () => {
  const v = verify(order({ status: "COMPLETED" }), ["PRT-1001", "PRT-1001", "PRT-1001"], WH1);
  assert.equal(v.action, TRANSFER_ACTION.NONE);
  assert.deepEqual(v.blockers, [BLOCKED_REASON.NOT_ACTIONABLE]);
  assert.equal(v.canSubmit, false);
});

test("an unknown status fails closed rather than guessing an action", () => {
  const v = verify(order({ status: "SOMETHING_NEW" }), [], WH1);
  assert.equal(v.action, TRANSFER_ACTION.NONE);
  assert.equal(v.notActionable, NOT_ACTIONABLE.UNKNOWN_STATUS);
});

test("an IN_TRANSIT order is received at the destination, not the origin", () => {
  const o = order({ status: "IN_TRANSIT" });
  assert.equal(verify(o, ["PRT-1001", "PRT-1001", "PRT-1001"], WH1).canSubmit, false, "origin is the wrong place to receive");
  assert.equal(verify(o, ["PRT-1001", "PRT-1001", "PRT-1001"], WH2).canSubmit, true);
});

// ─────────────────────────────────────────── it authors nothing

test("the module has NO quantity arithmetic beyond counting, and no ledger or command import", () => {
  const src = readFileSync(new URL("../src/domain/transferScanVerification.js", import.meta.url), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  for (const forbidden of [/firebase/i, /firestore/i, /Command/, /callable/i, /TRANSFER_OUT|TRANSFER_IN/, /ledger/i]) {
    assert.doesNotMatch(code, forbidden, `verification must not reference ${forbidden}`);
  }
});

test("verification NEVER edits the order to match what was scanned", () => {
  // The order is the authority for what moves. A scan that disagrees blocks; it does not rewrite.
  const o = order();
  const before = JSON.stringify(o);
  verify(o, ["PRT-9999", "PRT-1001", "PRT-1001", "PRT-1001", "PRT-1001"], WH1);
  assert.equal(JSON.stringify(o), before);
});

test("the result carries no payload for the command — only a verdict", () => {
  const v = verify(order(), ["PRT-1001", "PRT-1001", "PRT-1001"], WH1);
  assert.equal(v.quantity, undefined);
  assert.equal(v.serialNumbers, undefined);
  assert.equal(v.request, undefined, "the command takes a transferOrderId and re-derives everything itself");
});

test("results and their lists are frozen", () => {
  const v = verify(order(), [], WH1);
  assert.throws(() => { v.canSubmit = true; }, TypeError);
  assert.throws(() => { v.blockers.push("NOPE"); }, TypeError);
});

test("every blocking observation state has text, and none shares a sentence", () => {
  const texts = Object.values(OBSERVATION_TEXT);
  assert.equal(new Set(texts).size, texts.length, "two different mistakes share one sentence");
  for (const state of Object.values(OBSERVATION_STATE)) {
    if (state === OBSERVATION_STATE.VERIFIED) continue;
    assert.ok(OBSERVATION_TEXT[state], `${state} has no words`);
  }
});
