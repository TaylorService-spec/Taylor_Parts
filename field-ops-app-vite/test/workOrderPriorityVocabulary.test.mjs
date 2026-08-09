import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import {
  WORK_ORDER_PRIORITY_LABEL,
  WORK_ORDER_PRIORITY_OPTIONS,
  workOrderPriorityLabel,
  workOrderPriorityText,
} from "../src/domain/workOrderPriority.js";

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const SURFACES = {
  "control tower detail": "../src/modules/controlTower/WorkOrderDetail.jsx",
  "dispatcher preview": "../src/modules/dispatcherBoard/WorkOrderPreview.jsx",
  "dispatcher queue": "../src/modules/dispatcherBoard/WorkOrderQueue.jsx",
  "technician card": "../src/modules/technicianDashboard/TechnicianWorkOrderCard.jsx",
  "technician detail": "../src/modules/technicianDashboard/TechnicianWorkOrderDetail.jsx",
  "scheduling": "../src/modules/scheduling/SchedulingWorkspace.jsx",
  "wizard": "../src/modules/workOrders/WorkOrderWizard.jsx",
};

test("the label a user picks at creation is the label every surface reads back", () => {
  // The creation form offered "1 - Emergency"; the record must not read "Priority 1"
  // somewhere else. A persona saw the same record as "Priority 2", "Emergency" and
  // "High" on three screens and could not tell if it was one job or three.
  assert.deepEqual(WORK_ORDER_PRIORITY_OPTIONS.map((o) => o.label), [
    "1 - Emergency", "2 - High", "3 - Normal", "4 - Low",
  ]);
  for (const [value, label] of Object.entries(WORK_ORDER_PRIORITY_LABEL)) {
    assert.equal(workOrderPriorityLabel(Number(value)), label);
  }
});

test("no surface renders a bare priority number any more", () => {
  for (const [name, path] of Object.entries(SURFACES)) {
    const src = read(path);
    assert.doesNotMatch(src, /Priority \{(wo|workOrder|job)\.priority\}/, `${name} must not print a bare number`);
    assert.doesNotMatch(src, /Priority: \{(wo|workOrder|job)\.priority\}/, `${name} must not print a bare number`);
  }
});

test("exactly ONE definition of the vocabulary exists", () => {
  for (const [name, path] of Object.entries(SURFACES)) {
    const src = read(path);
    assert.doesNotMatch(src, /1: "Emergency"/, `${name} must not redefine the vocabulary`);
    assert.doesNotMatch(src, /"1 - Emergency"/, `${name} must not redefine the options`);
  }
});

test("the word leads and the number is kept — dispatchers still quote it", () => {
  assert.equal(workOrderPriorityText(1), "Emergency (1)");
  assert.equal(workOrderPriorityText(3), "Normal (3)");
});

test("an unknown priority is never rendered as though it were chosen", () => {
  for (const bad of [undefined, null, 0, 5, -1, "high", {}, NaN, 2.5]) {
    assert.equal(workOrderPriorityLabel(bad), null, `${String(bad)} must not resolve to a label`);
    assert.equal(workOrderPriorityText(bad), null);
  }
});

test("priority is not confused with the derived at-risk signal", () => {
  // Dispatch's risk chip is a different concept — age/status derived, not chosen.
  const dispatch = read("../src/modules/dispatch/Dispatch.jsx");
  assert.doesNotMatch(dispatch, /workOrderPriorityLabel|workOrderPriorityText/, "risk must not borrow priority vocabulary");
  assert.match(dispatch, /label: "At risk"/);
});
