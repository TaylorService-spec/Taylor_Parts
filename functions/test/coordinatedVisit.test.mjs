// Fulfillment Cycle 8 — OFFLINE tests for the PURE coordinated-visit projection. Proves SO grouping,
// per-unit accountability, honest partial completion, and shared-context detection — no new authority.
import test from "node:test";
import assert from "node:assert/strict";
import { groupWorkOrdersBySalesOrder, buildCoordinatedVisit, buildCoordinatedVisits } from "../lib/fulfillment/coordinatedVisit.js";

const wo = (id, salesOrderId, status, extra = {}) => ({ id, salesOrderId, status, customerId: "ACCT-1", locationId: "LOC-1", ...extra });

test("groups only Work Orders that carry a salesOrderId", () => {
  const groups = groupWorkOrdersBySalesOrder([wo("W1", "SO-1", "CREATED"), wo("W2", "SO-1", "CREATED"), { id: "W3", status: "CREATED" }]);
  assert.equal(groups.size, 1);
  assert.equal(groups.get("SO-1").length, 2);
});

test("all Work Orders done ⇒ READY", () => {
  const v = buildCoordinatedVisit("SO-1", [wo("W1", "SO-1", "COMPLETED"), wo("W2", "SO-1", "CLOSED")]);
  assert.equal(v.readiness, "READY");
  assert.equal(v.completed, 2);
  assert.equal(v.total, 2);
});

test("honest partial completion: some done + some not ⇒ PARTIAL; any blocked ⇒ ATTENTION", () => {
  const partial = buildCoordinatedVisit("SO-1", [wo("W1", "SO-1", "COMPLETED"), wo("W2", "SO-1", "IN_PROGRESS")]);
  assert.equal(partial.readiness, "PARTIAL");
  assert.equal(partial.completed, 1);
  // 4 of 5 done, 1 blocked ⇒ ATTENTION (never a fake whole-visit COMPLETE)
  const wos = [wo("A", "SO-1", "COMPLETED"), wo("B", "SO-1", "COMPLETED"), wo("C", "SO-1", "COMPLETED"), wo("D", "SO-1", "COMPLETED"), wo("E", "SO-1", "BLOCKED")];
  const attn = buildCoordinatedVisit("SO-1", wos);
  assert.equal(attn.readiness, "ATTENTION");
  assert.equal(attn.completed, 4);
  assert.equal(attn.blocked, 1);
});

test("none done ⇒ IN_PROGRESS", () => {
  assert.equal(buildCoordinatedVisit("SO-1", [wo("W1", "SO-1", "CREATED")]).readiness, "IN_PROGRESS");
});

test("shared context: consistent customer/location vs a divergence surfaced (not hidden)", () => {
  const consistent = buildCoordinatedVisit("SO-1", [wo("W1", "SO-1", "CREATED"), wo("W2", "SO-1", "CREATED")]);
  assert.equal(consistent.contextConsistent, true);
  assert.equal(consistent.customerId, "ACCT-1");
  const diverged = buildCoordinatedVisit("SO-1", [wo("W1", "SO-1", "CREATED"), wo("W2", "SO-1", "CREATED", { locationId: "LOC-2" })]);
  assert.equal(diverged.contextConsistent, false);
});

test("buildCoordinatedVisits: one visit per Sales Order", () => {
  const visits = buildCoordinatedVisits([wo("W1", "SO-1", "COMPLETED"), wo("W2", "SO-2", "CREATED"), wo("W3", "SO-2", "BLOCKED")]);
  assert.equal(visits.length, 2);
  const so2 = visits.find((v) => v.salesOrderId === "SO-2");
  assert.equal(so2.readiness, "ATTENTION");
});
