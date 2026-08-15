// Sales Order operational actions -- OFFLINE tests for the pure domain helpers (house
// check()/passed convention, mirrors test/partMasterWrite.test.mjs). No Firebase/network. Asserts
// the client-side lifecycle mirror matches functions/src/salesOrder/salesOrderLifecycle.ts's
// checkTransition exactly, the allocate/service-creation gates match their commands' own state
// guards, and the governed outcome mapping never fabricates a success.
import assert from "node:assert/strict";
import {
  nextAdvanceState,
  canAdvance,
  canCancel,
  canAllocate,
  canCreateService,
  outcomeFromErrorCode,
  outcomeFromTransitionResult,
  outcomeFromAllocateResult,
  outcomeFromServiceResult,
} from "../src/domain/salesOrderActions.js";

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  ok - ${name}`); }
console.log("salesOrderActions.test.mjs");

check("nextAdvanceState mirrors salesOrderLifecycle.ts's FORWARD map exactly", () => {
  assert.equal(nextAdvanceState("CONFIRMED"), "IN_FULFILLMENT");
  assert.equal(nextAdvanceState("IN_FULFILLMENT"), "FULFILLED");
  assert.equal(nextAdvanceState("FULFILLED"), "CLOSED");
  assert.equal(nextAdvanceState("CLOSED"), null);
  assert.equal(nextAdvanceState("CANCELLED"), null);
  assert.equal(nextAdvanceState("bogus"), null);
});

check("canAdvance: terminal states never advance", () => {
  assert.equal(canAdvance("CLOSED"), false);
  assert.equal(canAdvance("CANCELLED"), false);
});

check("canAdvance: CONFIRMED -> IN_FULFILLMENT always offered", () => {
  assert.equal(canAdvance("CONFIRMED", { allLinesFulfilled: false }), true);
  assert.equal(canAdvance("CONFIRMED", { allLinesFulfilled: true }), true);
});

check("canAdvance: IN_FULFILLMENT -> FULFILLED gated on allLinesFulfilled (mirrors checkTransition's NOT_FULFILLABLE)", () => {
  assert.equal(canAdvance("IN_FULFILLMENT", { allLinesFulfilled: false }), false);
  assert.equal(canAdvance("IN_FULFILLMENT", { allLinesFulfilled: true }), true);
  assert.equal(canAdvance("IN_FULFILLMENT"), false); // default false -- fails closed, never assumes fulfilled
});

check("canAdvance: FULFILLED -> CLOSED always offered (no fulfillment gate at this step)", () => {
  assert.equal(canAdvance("FULFILLED", { allLinesFulfilled: false }), true);
});

check("canCancel: allowed before FULFILLED, illegal at/after FULFILLED (mirrors the return/credit boundary)", () => {
  assert.equal(canCancel("CONFIRMED"), true);
  assert.equal(canCancel("IN_FULFILLMENT"), true);
  assert.equal(canCancel("FULFILLED"), false);
  assert.equal(canCancel("CLOSED"), false);
  assert.equal(canCancel("CANCELLED"), false);
});

check("canAllocate: only CONFIRMED/IN_FULFILLMENT (mirrors allocateSalesOrder.ts's state guard)", () => {
  assert.equal(canAllocate("CONFIRMED"), true);
  assert.equal(canAllocate("IN_FULFILLMENT"), true);
  assert.equal(canAllocate("FULFILLED"), false);
  assert.equal(canAllocate("CLOSED"), false);
  assert.equal(canAllocate("CANCELLED"), false);
});

check("canCreateService: only CONFIRMED/IN_FULFILLMENT, and only when no Service Work Order exists yet", () => {
  assert.equal(canCreateService("CONFIRMED", { serviceWorkOrderIds: [] }), true);
  assert.equal(canCreateService("IN_FULFILLMENT", { serviceWorkOrderIds: [] }), true);
  assert.equal(canCreateService("CONFIRMED", { serviceWorkOrderIds: ["WO-1"] }), false);
  assert.equal(canCreateService("FULFILLED", { serviceWorkOrderIds: [] }), false);
  assert.equal(canCreateService("CLOSED", { serviceWorkOrderIds: [] }), false);
});

check("outcomeFromErrorCode: known codes map to safe, distinct copy; unknown codes fail closed to a generic error", () => {
  assert.equal(outcomeFromErrorCode("permission-denied").kind, "denied");
  assert.equal(outcomeFromErrorCode("failed-precondition").kind, "invalid");
  assert.equal(outcomeFromErrorCode("not-found").kind, "notFound");
  assert.equal(outcomeFromErrorCode("something-unmapped").kind, "error");
  assert.equal(outcomeFromErrorCode(undefined).kind, "error");
});

check("outcomeFromTransitionResult: applied vs replayed, carries the server's state -- never fabricates one", () => {
  assert.deepEqual(outcomeFromTransitionResult({ state: "IN_FULFILLMENT", replayed: false }).kind, "applied");
  assert.deepEqual(outcomeFromTransitionResult({ state: "IN_FULFILLMENT", replayed: true }).kind, "replayed");
  assert.equal(outcomeFromTransitionResult({ state: "IN_FULFILLMENT" }).state, "IN_FULFILLMENT");
  assert.equal(outcomeFromTransitionResult(null).kind, "error");
  assert.equal(outcomeFromTransitionResult({}).kind, "error");
});

check("outcomeFromAllocateResult / outcomeFromServiceResult: applied only on a real server payload", () => {
  assert.equal(outcomeFromAllocateResult({ readiness: "READY", counts: {} }).kind, "applied");
  assert.equal(outcomeFromAllocateResult(null).kind, "error");
  assert.equal(outcomeFromServiceResult({ workOrderId: "WO-9", woNumber: "WO-2026-9" }).kind, "applied");
  assert.equal(outcomeFromServiceResult({}).kind, "error");
});

console.log(`${passed} passed`);
