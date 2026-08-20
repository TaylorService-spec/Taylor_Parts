// Sales Order fulfillment/installation progression — PURE projection.
//
// The property every assertion here defends: ABSENT EVIDENCE IS NOT EVIDENCE OF COMPLETION.
// A chevron turning green is a claim about the physical world — that stock was allocated,
// that a technician arrived, that equipment changed hands. This projection may only make
// claims the records support, and must say UNKNOWN otherwise.
//
// The failure mode worth fearing is not a red step shown green by a bug. It is a step shown
// green because nothing was recorded and the code treated silence as success. Several tests
// below exist only to make that impossible.
//
// Run: node --test test/salesOrderFulfillmentProgress.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import test from "node:test";
import {
  projectFulfillmentProgress,
  summarizeQuantities,
  FULFILLMENT_STEPS,
  STEP_STATE,
} from "../src/domain/salesOrderFulfillmentProgress.js";

const order = (over = {}) => ({
  state: "CONFIRMED",
  lines: [{ orderedQty: 2, allocatedQty: 2, fulfilledQty: 0 }],
  ...over,
});
const wo = (over = {}) => ({ id: "wo-1", workOrderNumber: "WO-1", status: "SCHEDULED", ...over });

const stateOf = (result, key) => result.steps.find((s) => s.key === key).state;

// ---------------------------------------------------------------- shape

test("the progression is exactly the eight declared steps, in order", () => {
  const r = projectFulfillmentProgress(order(), []);
  assert.deepEqual(
    r.steps.map((s) => s.key),
    ["confirmed", "allocated", "installationCreated", "scheduled", "dispatched", "onSite", "installed", "handoff"],
  );
  assert.equal(r.steps.length, FULFILLMENT_STEPS.length);
});

// ---------------------------------------------------------------- unknown stays unknown

test("UNREADABLE Work Orders yield UNKNOWN, never 'not started'", () => {
  // null means "could not load". A caller lacking permission must not see an order that
  // looks like nothing has happened.
  const r = projectFulfillmentProgress(order(), null);
  for (const key of ["installationCreated", "scheduled", "dispatched", "onSite", "installed"]) {
    assert.equal(stateOf(r, key), STEP_STATE.UNKNOWN, `${key} must be UNKNOWN when Work Orders are unreadable`);
  }
  assert.ok(r.blockers.some((b) => /could not be read/i.test(b)));
});

test("an EMPTY Work Order list is a real answer and differs from an unreadable one", () => {
  const r = projectFulfillmentProgress(order(), []);
  assert.equal(stateOf(r, "installationCreated"), STEP_STATE.CURRENT, "loaded-and-none is a known state");
  assert.notEqual(stateOf(r, "installationCreated"), STEP_STATE.UNKNOWN);
});

test("CUSTOMER HANDOFF is UNKNOWN even when every other step is complete", () => {
  // The whole point. Finishing the work and handing the equipment over are different facts,
  // and only one of them is recorded today.
  const r = projectFulfillmentProgress(
    order({ lines: [{ orderedQty: 1, allocatedQty: 1, fulfilledQty: 1 }] }),
    [wo({ status: "COMPLETED" })],
  );
  assert.equal(stateOf(r, "installed"), STEP_STATE.COMPLETE);
  assert.equal(stateOf(r, "handoff"), STEP_STATE.UNKNOWN, "handoff must never be inferred from installation");
  assert.notEqual(r.overall, STEP_STATE.COMPLETE, "the order is not finished without a handoff record");
});

test("handoff completes ONLY with an authoritative custody event", () => {
  const r = projectFulfillmentProgress(
    order({ lines: [{ orderedQty: 1, allocatedQty: 1, fulfilledQty: 1 }] }),
    [wo({ status: "COMPLETED" })],
    { eventId: "custody-1" },
  );
  assert.equal(stateOf(r, "handoff"), STEP_STATE.COMPLETE);
  assert.equal(r.overall, STEP_STATE.COMPLETE);
});

test("missing allocation quantities are UNKNOWN, not zero", () => {
  const r = projectFulfillmentProgress(order({ lines: [{ orderedQty: 5 }] }), []);
  assert.equal(stateOf(r, "allocated"), STEP_STATE.UNKNOWN);
  assert.equal(summarizeQuantities([{ orderedQty: 5 }]).allocated, null, "absent is null, never 0");
});

// ---------------------------------------------------------------- allocation

test("partial allocation is CURRENT, never complete", () => {
  const r = projectFulfillmentProgress(order({ lines: [{ orderedQty: 10, allocatedQty: 4 }] }), []);
  assert.equal(stateOf(r, "allocated"), STEP_STATE.CURRENT);
});

test("full allocation across several lines completes the step", () => {
  const r = projectFulfillmentProgress(
    order({ lines: [{ orderedQty: 2, allocatedQty: 2 }, { orderedQty: 3, allocatedQty: 3 }] }),
    [],
  );
  assert.equal(stateOf(r, "allocated"), STEP_STATE.COMPLETE);
  assert.equal(r.quantities.ordered, 5);
  assert.equal(r.quantities.allocated, 5);
});

// ---------------------------------------------------------------- one work order

test("a scheduled Work Order reaches SCHEDULED but no further", () => {
  const r = projectFulfillmentProgress(order(), [wo({ status: "SCHEDULED" })]);
  assert.equal(stateOf(r, "installationCreated"), STEP_STATE.COMPLETE);
  assert.equal(stateOf(r, "scheduled"), STEP_STATE.COMPLETE);
  assert.equal(stateOf(r, "dispatched"), STEP_STATE.CURRENT);
  assert.equal(stateOf(r, "installed"), STEP_STATE.FUTURE);
});

test("ARRIVED proves on-site, and implies dispatched", () => {
  const r = projectFulfillmentProgress(order(), [wo({ status: "ARRIVED" })]);
  assert.equal(stateOf(r, "dispatched"), STEP_STATE.COMPLETE);
  assert.equal(stateOf(r, "onSite"), STEP_STATE.COMPLETE);
  assert.equal(stateOf(r, "installed"), STEP_STATE.CURRENT);
});

// ---------------------------------------------------------------- many work orders

test("MIXED completion never claims INSTALLED — the weakest link decides", () => {
  const r = projectFulfillmentProgress(order(), [
    wo({ id: "a", status: "COMPLETED" }),
    wo({ id: "b", status: "SCHEDULED" }),
  ]);
  assert.equal(stateOf(r, "installed"), STEP_STATE.CURRENT, "one done out of two is not INSTALLED");
  assert.ok(r.blockers.some((b) => /1 of 2 installations complete/.test(b)), "partial progress must be surfaced");
});

test("every installation complete DOES complete the step", () => {
  const r = projectFulfillmentProgress(order(), [
    wo({ id: "a", status: "COMPLETED" }),
    wo({ id: "b", status: "CLOSED" }),
  ]);
  assert.equal(stateOf(r, "installed"), STEP_STATE.COMPLETE);
});

test("a CANCELLED Work Order is excluded from the live set and does not hold progress back", () => {
  const r = projectFulfillmentProgress(order(), [
    wo({ id: "a", status: "COMPLETED" }),
    wo({ id: "b", status: "CANCELLED" }),
  ]);
  assert.equal(stateOf(r, "installed"), STEP_STATE.COMPLETE, "a cancelled WO is not an outstanding installation");
  assert.equal(r.workOrders.find((w) => w.id === "b").cancelled, true);
});

test("ALL Work Orders cancelled is BLOCKED, not future and not complete", () => {
  const r = projectFulfillmentProgress(order(), [wo({ status: "CANCELLED" })]);
  assert.equal(stateOf(r, "installationCreated"), STEP_STATE.BLOCKED);
  assert.equal(stateOf(r, "installed"), STEP_STATE.BLOCKED);
  assert.ok(r.blockers.some((b) => /cancelled/i.test(b)));
});

// ---------------------------------------------------------------- cancelled order

test("a CANCELLED Sales Order fails every step, including ones already achieved", () => {
  const r = projectFulfillmentProgress(
    order({ state: "CANCELLED", lines: [{ orderedQty: 1, allocatedQty: 1 }] }),
    [wo({ status: "COMPLETED" })],
  );
  for (const s of r.steps) assert.equal(s.state, STEP_STATE.FAILED, `${s.key} must be FAILED`);
  assert.equal(r.overall, STEP_STATE.FAILED);
});

// ---------------------------------------------------------------- degenerate input

test("a missing order state is UNKNOWN rather than assumed confirmed", () => {
  const r = projectFulfillmentProgress({ lines: [] }, []);
  assert.equal(stateOf(r, "confirmed"), STEP_STATE.UNKNOWN);
});

test("no input at all does not throw, and claims nothing", () => {
  const r = projectFulfillmentProgress(undefined, undefined);
  assert.equal(stateOf(r, "confirmed"), STEP_STATE.UNKNOWN);
  assert.notEqual(r.overall, STEP_STATE.COMPLETE);
});

test("NO STEP is ever COMPLETE without evidence — swept across empty inputs", () => {
  // A blanket guard: with nothing recorded, nothing may be green.
  for (const input of [undefined, {}, { lines: [] }, { state: "CONFIRMED", lines: [] }]) {
    const r = projectFulfillmentProgress(input, null);
    const greens = r.steps.filter((s) => s.state === STEP_STATE.COMPLETE).map((s) => s.key);
    const allowed = input && input.state ? ["confirmed"] : [];
    assert.deepEqual(greens, allowed, `unexpected COMPLETE steps for ${JSON.stringify(input)}`);
  }
});
