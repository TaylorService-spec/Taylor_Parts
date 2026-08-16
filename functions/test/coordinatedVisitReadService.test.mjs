// Coordinated Operations read -- OFFLINE tests for the PURE read-projection core, imported from compiled
// lib. No emulator/Firebase/network. Proves the minimal projection (exact field allowlist -- no raw UID, no
// pricing), non-coordinated Work Orders (no salesOrderId) are dropped (never fabricated), and malformed
// line-refs are dropped without rejecting the whole document.
//
// Prerequisite: `npm run build` in functions/ first (this test imports the compiled lib/ output).
import test from "node:test";
import assert from "node:assert/strict";
import { projectCoordinatedWorkOrder } from "../lib/fulfillment/coordinatedVisitReadService.js";

function baseDoc(overrides = {}) {
  return {
    woNumber: "WO-5101",
    status: "WORK_IN_PROGRESS",
    customerId: "ACCT-1",
    locationId: "LOC-1",
    salesOrderId: "SO-1",
    salesOrderLineRefs: [{ ref: "PRT-1", kind: "PART", orderedQty: 2, allocatedQty: 1, lineId: "line-1" }],
    ...overrides,
  };
}

test("projectCoordinatedWorkOrder returns only the minimal coordinated-visit fields -- exact allowlist", () => {
  const p = projectCoordinatedWorkOrder("WO-1", baseDoc());
  assert.deepEqual(Object.keys(p).sort(), [
    "customerId", "id", "locationId", "salesOrderId", "salesOrderLineRefs", "status", "woNumber",
  ]);
  assert.equal(p.id, "WO-1");
  assert.equal(p.salesOrderId, "SO-1");
  assert.deepEqual(p.salesOrderLineRefs, [{ ref: "PRT-1", kind: "PART", orderedQty: 2, allocatedQty: 1, lineId: "line-1" }]);
});

test("projectCoordinatedWorkOrder never leaks raw UID or execution/financial fields present on the raw doc", () => {
  const p = projectCoordinatedWorkOrder("WO-2", baseDoc({
    assignedTechId: "uid-tech-abc",
    scheduledTechId: "uid-tech-def",
    createdByUid: "uid-creator",
    executionLog: [{ note: "x", byTechnicianId: "uid-tech-ghi" }],
    inventorySnapshot: [{ sku: "SKU-1" }],
  }));
  assert.notEqual(p, null);
  const keys = Object.keys(p);
  assert.equal(keys.includes("assignedTechId"), false);
  assert.equal(keys.includes("scheduledTechId"), false);
  assert.equal(keys.includes("createdByUid"), false);
  assert.equal(keys.includes("executionLog"), false);
  assert.equal(keys.includes("inventorySnapshot"), false);
});

test("projectCoordinatedWorkOrder returns null (skip, never fabricate) for a Work Order with no salesOrderId", () => {
  const doc = baseDoc();
  delete doc.salesOrderId;
  assert.equal(projectCoordinatedWorkOrder("WO-3", doc), null);
});

test("projectCoordinatedWorkOrder returns null for a blank/whitespace salesOrderId", () => {
  assert.equal(projectCoordinatedWorkOrder("WO-4", baseDoc({ salesOrderId: "   " })), null);
});

test("projectCoordinatedWorkOrder returns null for a missing id or missing/non-object data", () => {
  assert.equal(projectCoordinatedWorkOrder("", baseDoc()), null);
  assert.equal(projectCoordinatedWorkOrder("WO-5", undefined), null);
  assert.equal(projectCoordinatedWorkOrder("WO-6", null), null);
});

test("projectCoordinatedWorkOrder drops a malformed lineRef (missing ref/kind) without rejecting the document", () => {
  const p = projectCoordinatedWorkOrder("WO-7", baseDoc({
    salesOrderLineRefs: [
      { ref: "PRT-1", kind: "PART", orderedQty: 2, allocatedQty: 1 },
      { kind: "PART", orderedQty: 2, allocatedQty: 1 }, // missing ref -- dropped
      { ref: "PRT-2" }, // missing kind -- dropped
      "not-an-object", // dropped
    ],
  }));
  assert.notEqual(p, null);
  assert.equal(p.salesOrderLineRefs.length, 1);
  assert.equal(p.salesOrderLineRefs[0].ref, "PRT-1");
});

test("projectCoordinatedWorkOrder honestly nulls optional string fields that are absent/blank rather than guessing", () => {
  const p = projectCoordinatedWorkOrder("WO-8", { salesOrderId: "SO-1" });
  assert.notEqual(p, null);
  assert.equal(p.woNumber, null);
  assert.equal(p.status, null);
  assert.equal(p.customerId, null);
  assert.equal(p.locationId, null);
  assert.deepEqual(p.salesOrderLineRefs, []);
});
