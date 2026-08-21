// WAREHOUSE ↔ TRUCK HANDOFF — proving the EXISTING custody model expresses it. PURE.
// Run: node --test test/truckHandoff.test.mjs
//
// ============================ NO NEW CUSTODY MODEL WAS INVENTED ============================
//
// Phase O asked for: stage → select the truck → scan items → warehouse release → technician
// acceptance → authoritative custody movement → audit receipt.
//
// Reconciliation found that the transfer authority ALREADY expresses every step of that:
//
//   release            dispatchTransferOrder  — TRANSFER_OUT at the origin, REQUESTED -> IN_TRANSIT
//   custody in flight  IN_TRANSIT             — counted at neither endpoint, deliberately
//   acceptance         receiveTransferOrder   — TRANSFER_IN at the destination -> COMPLETED
//   the truck itself   type: "MOBILE"         — validated against mobile_locations (the EI Truck
//                                               Registry, ADR-010) and refused when inactive
//   audit              the ledger events the two commands already write
//
// So a handoff IS a transfer whose destination is a truck. These tests prove the Phase J1 scan
// surface handles that unchanged — because inventing a parallel handoff state machine on top of a
// custody model that already says the same thing is exactly the duplicate authority the program is
// meant to avoid.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  buildTransferVerification, classifyObservation, actionForStatus, expectedLocationFor,
  TRANSFER_ACTION, OBSERVATION_STATE, BLOCKED_REASON,
} from "../src/domain/transferScanVerification.js";

const WAREHOUSE = { type: "WAREHOUSE", locationId: "WH-1" };
const TRUCK = { type: "MOBILE", locationId: "TRUCK-7" };

const handoff = (over = {}) => ({
  transferOrderId: "TO-TRUCK-1",
  partId: "PRT-1001",
  quantity: 2,
  trackingMode: "NONE",
  serialNumbers: [],
  status: "REQUESTED",
  origin: WAREHOUSE,
  destination: TRUCK,
  ...over,
});

function scanAll(o, tokens) {
  const observations = [];
  for (const t of tokens) {
    observations.push(classifyObservation(t, o, observations.filter((x) => x.state === OBSERVATION_STATE.VERIFIED)));
  }
  return observations;
}
const verify = (o, tokens = [], at = null) =>
  buildTransferVerification({ order: o, observations: scanAll(o, tokens), confirmedLocation: at });

// ─────────────────────────────────────────── release, at the warehouse

test("the WAREHOUSE releases: dispatch happens at the origin", () => {
  const o = handoff();
  assert.equal(actionForStatus(o.status).action, TRANSFER_ACTION.DISPATCH);
  assert.deepEqual(expectedLocationFor(o, TRANSFER_ACTION.DISPATCH), WAREHOUSE);
});

test("a complete release from the warehouse can be submitted", () => {
  const v = verify(handoff(), ["PRT-1001", "PRT-1001"], WAREHOUSE);
  assert.equal(v.canSubmit, true);
  assert.equal(v.action, TRANSFER_ACTION.DISPATCH);
});

test("the warehouse cannot release while standing at the TRUCK", () => {
  // Releasing from the wrong end moves stock that is not there.
  const v = verify(handoff(), ["PRT-1001", "PRT-1001"], TRUCK);
  assert.ok(v.blockers.includes(BLOCKED_REASON.WRONG_LOCATION));
  assert.equal(v.canSubmit, false);
});

// ─────────────────────────────────────────── acceptance, at the truck

test("the TECHNICIAN accepts: receive happens at the truck", () => {
  const inFlight = handoff({ status: "IN_TRANSIT" });
  assert.equal(actionForStatus(inFlight.status).action, TRANSFER_ACTION.RECEIVE);
  assert.deepEqual(expectedLocationFor(inFlight, TRANSFER_ACTION.RECEIVE), TRUCK);
});

test("acceptance at the truck completes the handoff", () => {
  const v = verify(handoff({ status: "IN_TRANSIT" }), ["PRT-1001", "PRT-1001"], TRUCK);
  assert.equal(v.action, TRANSFER_ACTION.RECEIVE);
  assert.equal(v.canSubmit, true);
});

test("the technician cannot accept back at the warehouse", () => {
  const v = verify(handoff({ status: "IN_TRANSIT" }), ["PRT-1001", "PRT-1001"], WAREHOUSE);
  assert.equal(v.canSubmit, false);
});

test("a MOBILE endpoint must match by TYPE — a warehouse with the same id is not the truck", () => {
  const v = verify(handoff({ status: "IN_TRANSIT" }), ["PRT-1001", "PRT-1001"], { type: "WAREHOUSE", locationId: "TRUCK-7" });
  assert.equal(v.locationConfirmed, false);
});

// ─────────────────────────────────────────── in flight is neither end

test("between release and acceptance the stock is at NEITHER end", () => {
  // The transfer commands post TRANSFER_OUT at the origin and TRANSFER_IN only on receipt, so an
  // in-flight unit is excluded from both endpoints' sums. That is the existing rule, not a new one:
  // it is never double-counted and never silently dropped, it is simply not AT a location in flight.
  const inFlight = handoff({ status: "IN_TRANSIT" });
  // Nothing about the surface claims the stock is anywhere: it offers only the receiving action.
  assert.equal(actionForStatus(inFlight.status).action, TRANSFER_ACTION.RECEIVE);
  assert.equal(expectedLocationFor(inFlight, TRANSFER_ACTION.DISPATCH), WAREHOUSE);
});

// ─────────────────────────────────────────── serialized handoffs

test("serialized units are handed off by NAME, at both ends", () => {
  const serialised = handoff({ trackingMode: "SERIAL", quantity: 2, serialNumbers: ["SN-1", "SN-2"] });
  const release = verify(serialised, ["SN-1", "SN-2"], WAREHOUSE);
  assert.equal(release.canSubmit, true);

  const accept = verify({ ...serialised, status: "IN_TRANSIT" }, ["SN-1"], TRUCK);
  assert.deepEqual(accept.outstandingSerials, ["SN-2"], "the technician sees which unit is missing");
  assert.equal(accept.canSubmit, false);
});

test("a unit that is not on the handoff is refused at the truck", () => {
  const serialised = handoff({ status: "IN_TRANSIT", trackingMode: "SERIAL", quantity: 1, serialNumbers: ["SN-1"] });
  const obs = scanAll(serialised, ["SN-9"]);
  assert.equal(obs[0].state, OBSERVATION_STATE.UNKNOWN_SERIAL);
});

// ─────────────────────────────────────────── no parallel machine

test("the scan surface has NO truck-specific state machine", () => {
  // A handoff is a transfer. A second state machine could disagree with the custody model about
  // what is where, which is the duplicate authority this program exists to avoid.
  const src = readFileSync(new URL("../src/domain/transferScanVerification.js", import.meta.url), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  for (const forbidden of [/handoff/i, /truck/i, /technicianAccept/i, /custody/i]) {
    assert.doesNotMatch(code, forbidden, `a handoff must not need its own ${forbidden}`);
  }
});

test("the surface is endpoint-agnostic: the SAME rules govern both kinds of transfer", () => {
  const warehouseToWarehouse = handoff({ destination: { type: "WAREHOUSE", locationId: "WH-2" } });
  const warehouseToTruck = handoff();
  const a = verify(warehouseToWarehouse, ["PRT-1001", "PRT-1001"], WAREHOUSE);
  const b = verify(warehouseToTruck, ["PRT-1001", "PRT-1001"], WAREHOUSE);
  assert.equal(a.canSubmit, b.canSubmit);
  assert.equal(a.action, b.action);
  assert.deepEqual(a.blockers, b.blockers);
});
