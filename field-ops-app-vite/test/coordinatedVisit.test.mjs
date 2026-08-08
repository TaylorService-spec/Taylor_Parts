// Coordinated VISIT mirror — pure unit tests (node:test). Mirrors functions/src/fulfillment/coordinatedVisit.ts.
// Proves: grouping excludes standalone Work Orders; honest readiness (all done READY, any blocked ATTENTION,
// some done PARTIAL, none IN_PROGRESS); honest counts + remaining; contextConsistent surfaces disagreement.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  groupWorkOrdersBySalesOrder, buildCoordinatedVisit, buildCoordinatedVisits,
  visitReadinessTone, workOrderStatusTone,
} from "../src/domain/coordinatedVisit.js";

const wo = (id, status, salesOrderId, extra = {}) => ({ id, woNumber: id, status, salesOrderId, customerId: "C1", locationId: "L1", ...extra });

test("grouping keys by salesOrderId and EXCLUDES standalone Work Orders (no salesOrderId)", () => {
  const groups = groupWorkOrdersBySalesOrder([
    wo("a", "COMPLETED", "SO1"), wo("b", "BLOCKED", "SO1"), { id: "c", status: "IN_PROGRESS" },
  ]);
  assert.deepEqual([...groups.keys()], ["SO1"]);
  assert.equal(groups.get("SO1").length, 2);
});

test("all done ⇒ READY; counts + remaining honest", () => {
  const v = buildCoordinatedVisit("SO1", [wo("a", "COMPLETED", "SO1"), wo("b", "CLOSED", "SO1")]);
  assert.equal(v.readiness, "READY");
  assert.equal(v.total, 2); assert.equal(v.completed, 2); assert.equal(v.blocked, 0); assert.equal(v.remaining, 0);
});

test("any blocked ⇒ ATTENTION — 3 done + 1 in-progress + 1 blocked is NOT complete", () => {
  const v = buildCoordinatedVisit("SO1", [
    wo("a", "COMPLETED", "SO1"), wo("b", "COMPLETED", "SO1"), wo("c", "COMPLETED", "SO1"),
    wo("d", "IN_PROGRESS", "SO1"), wo("e", "BLOCKED", "SO1"),
  ]);
  assert.equal(v.readiness, "ATTENTION");
  assert.equal(v.completed, 3); assert.equal(v.total, 5); assert.equal(v.blocked, 1); assert.equal(v.remaining, 2);
  assert.notEqual(v.completed, v.total); // explicitly not complete
});

test("some done, none blocked ⇒ PARTIAL; none done ⇒ IN_PROGRESS", () => {
  assert.equal(buildCoordinatedVisit("SO1", [wo("a", "COMPLETED", "SO1"), wo("b", "IN_PROGRESS", "SO1")]).readiness, "PARTIAL");
  assert.equal(buildCoordinatedVisit("SO1", [wo("a", "IN_PROGRESS", "SO1"), wo("b", "SCHEDULED", "SO1")]).readiness, "IN_PROGRESS");
});

test("contextConsistent=false when grouped Work Orders disagree on customer/location", () => {
  const v = buildCoordinatedVisit("SO1", [
    wo("a", "COMPLETED", "SO1", { customerId: "C1" }), wo("b", "COMPLETED", "SO1", { customerId: "C2" }),
  ]);
  assert.equal(v.contextConsistent, false);
});

test("unknown status counts as not-done (no assumed completion)", () => {
  const v = buildCoordinatedVisit("SO1", [wo("a", "WEIRD", "SO1"), wo("b", "COMPLETED", "SO1")]);
  assert.equal(v.completed, 1); assert.equal(v.readiness, "PARTIAL");
});

test("buildCoordinatedVisits builds one per Sales Order", () => {
  const visits = buildCoordinatedVisits([wo("a", "COMPLETED", "SO1"), wo("b", "COMPLETED", "SO2")]);
  assert.equal(visits.length, 2);
});

test("tone mapping is honest", () => {
  assert.equal(visitReadinessTone("READY"), "positive");
  assert.equal(visitReadinessTone("ATTENTION"), "attention");
  assert.equal(visitReadinessTone("PARTIAL"), "info");
  assert.equal(workOrderStatusTone("COMPLETED"), "positive");
  assert.equal(workOrderStatusTone("BLOCKED"), "attention");
  assert.equal(workOrderStatusTone(null), "unknown");
});
