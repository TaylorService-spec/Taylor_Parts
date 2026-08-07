import test from "node:test";
import assert from "node:assert/strict";

import {
  FIELD_ACTIONS,
  FIELD_ACTIVE_STATUSES,
  FIELD_PHASE,
  isActiveFieldWorkOrder,
  nextFieldAction,
  fieldPhase,
  fieldProgressStep,
  sortFieldWorkOrders,
  activeFieldWorkOrders,
  isOpenWorkOrder,
} from "../src/domain/fieldWorkOrder.js";

const TECH = "tech-1";
const wo = (status, over = {}) => ({ id: `wo-${status}`, status, assignedTechId: TECH, ...over });

test("the technician lifecycle is offered one step at a time, in order", () => {
  const chain = [
    ["DISPATCHED", "Accept"],
    ["ACCEPTED", "Travel"],
    ["EN_ROUTE", "Arrive"],
    ["ARRIVED", "WorkStart"],
    ["WORK_IN_PROGRESS", "Complete"],
  ];
  for (const [status, action] of chain) {
    const next = nextFieldAction(wo(status), TECH);
    assert.equal(next?.action, action, `at ${status}`);
  }
});

test("no action is offered on a Work Order assigned to someone else", () => {
  for (const status of FIELD_ACTIVE_STATUSES) {
    assert.equal(nextFieldAction(wo(status, { assignedTechId: "someone-else" }), TECH), null);
  }
});

test("no action is offered without a resolved technician (fails closed)", () => {
  assert.equal(nextFieldAction(wo("DISPATCHED"), null), null);
  assert.equal(nextFieldAction(wo("DISPATCHED"), undefined), null);
  assert.equal(nextFieldAction(null, TECH), null);
});

test("terminal and pre-dispatch statuses offer the technician nothing", () => {
  for (const status of ["CREATED", "READY_TO_DISPATCH", "SCHEDULED", "COMPLETED", "CLOSED", "CANCELLED"]) {
    assert.equal(nextFieldAction(wo(status), TECH), null, `at ${status}`);
  }
});

test("only the five field-lifecycle statuses count as active", () => {
  for (const status of FIELD_ACTIVE_STATUSES) {
    assert.equal(isActiveFieldWorkOrder(wo(status)), true, status);
  }
  for (const status of ["CREATED", "READY_TO_DISPATCH", "SCHEDULED", "COMPLETED", "CLOSED", "CANCELLED"]) {
    assert.equal(isActiveFieldWorkOrder(wo(status)), false, status);
  }
  assert.equal(isActiveFieldWorkOrder(null), false);
});

test("phase projects all eleven governed statuses and covers them exhaustively", () => {
  const expected = {
    CREATED: FIELD_PHASE.AWAITING_DISPATCH,
    READY_TO_DISPATCH: FIELD_PHASE.AWAITING_DISPATCH,
    SCHEDULED: FIELD_PHASE.AWAITING_DISPATCH,
    DISPATCHED: FIELD_PHASE.ASSIGNED,
    ACCEPTED: FIELD_PHASE.ASSIGNED,
    EN_ROUTE: FIELD_PHASE.ASSIGNED,
    ARRIVED: FIELD_PHASE.ON_SITE,
    WORK_IN_PROGRESS: FIELD_PHASE.ON_SITE,
    COMPLETED: FIELD_PHASE.FINISHED,
    CLOSED: FIELD_PHASE.FINISHED,
    CANCELLED: FIELD_PHASE.FINISHED,
  };
  for (const [status, phase] of Object.entries(expected)) {
    assert.equal(fieldPhase(status), phase, status);
    assert.equal(fieldPhase({ status }), phase, `${status} (object form)`);
  }
  assert.equal(Object.keys(expected).length, 11, "all governed statuses must be covered");
});

test("an unknown status fails CLOSED -- surfaced as needing attention, never as finished", () => {
  assert.equal(fieldPhase("SOMETHING_NEW"), FIELD_PHASE.AWAITING_DISPATCH);
  assert.equal(fieldPhase(undefined), FIELD_PHASE.AWAITING_DISPATCH);
  assert.equal(fieldPhase({}), FIELD_PHASE.AWAITING_DISPATCH);
  assert.equal(isOpenWorkOrder({ status: "SOMETHING_NEW" }), true);
});

test("isOpenWorkOrder counts everything not finished", () => {
  assert.equal(isOpenWorkOrder(wo("CREATED")), true);
  assert.equal(isOpenWorkOrder(wo("EN_ROUTE")), true);
  assert.equal(isOpenWorkOrder(wo("WORK_IN_PROGRESS")), true);
  assert.equal(isOpenWorkOrder(wo("COMPLETED")), false);
  assert.equal(isOpenWorkOrder(wo("CANCELLED")), false);
});

test("progress advances monotonically through the lifecycle", () => {
  const order = ["DISPATCHED", "ACCEPTED", "EN_ROUTE", "ARRIVED", "WORK_IN_PROGRESS", "COMPLETED"];
  const steps = order.map(fieldProgressStep);
  for (let i = 1; i < steps.length; i += 1) {
    assert.ok(steps[i] > steps[i - 1], `${order[i]} must be past ${order[i - 1]}`);
  }
  assert.equal(fieldProgressStep("UNKNOWN"), 0);
});

test("active work sorts ahead of inactive, most advanced first, stably", () => {
  const list = [
    wo("COMPLETED", { woNumber: "WO-4" }),
    wo("DISPATCHED", { woNumber: "WO-2" }),
    wo("WORK_IN_PROGRESS", { woNumber: "WO-1" }),
    wo("ACCEPTED", { woNumber: "WO-3" }),
  ];
  const sorted = sortFieldWorkOrders(list).map((w) => w.woNumber);
  assert.deepEqual(sorted, ["WO-1", "WO-3", "WO-2", "WO-4"]);
  // Pure: the input is not mutated.
  assert.equal(list[0].woNumber, "WO-4");
});

test("activeFieldWorkOrders drops finished work entirely", () => {
  const list = [wo("COMPLETED"), wo("ARRIVED"), wo("CANCELLED"), wo("DISPATCHED")];
  const active = activeFieldWorkOrders(list);
  assert.equal(active.length, 2);
  assert.deepEqual(active.map((w) => w.status), ["ARRIVED", "DISPATCHED"]);
});

test("labels exist for every field action and never leak an action name", () => {
  assert.equal(FIELD_ACTIONS.length, 5);
  for (const a of FIELD_ACTIONS) {
    assert.ok(a.label && a.label !== a.action, `${a.action} needs a human label`);
  }
});
