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

// ════════════════════ THE ANCHORING SALES ORDER IS NAMED, NOT KEYED ════════════════════
//
// Coordinated Visits and Coordinated Mission rendered `salesOrderLabelById[id] || id`, and this
// read carried no label map at all -- so both surfaces printed cIk3hlPDTXH5IB3VHdLy at the top of
// the screen. DECISIONS #106: a document id is a routing key, not a name.
//
// The Sales Order already owns SO-YYYY-######. This read simply never carried it.

const fakeDbFor = (docs, onGetAll) => ({
  collection: () => ({ doc: (id) => ({ id }) }),
  getAll: onGetAll ?? (async (...refs) => refs.map((r) => ({
    id: r.id,
    exists: Object.prototype.hasOwnProperty.call(docs, r.id),
    data: () => docs[r.id],
  }))),
});

test("resolveSalesOrderReferences returns the GOVERNED REFERENCE per anchor", async () => {
  const { resolveSalesOrderReferences } = await import("../lib/fulfillment/coordinatedVisitReadService.js");
  const db = fakeDbFor({ "so-a": { salesOrderNumber: "SO-2026-000003" }, "so-b": { salesOrderNumber: "SO-2026-000007" } });
  assert.deepEqual(await resolveSalesOrderReferences(db, ["so-a", "so-b"]), {
    "so-a": "SO-2026-000003",
    "so-b": "SO-2026-000007",
  });
});

test("AN UNRESOLVED ANCHOR IS ABSENT FROM THE MAP -- never mapped to its own id", async () => {
  // Absent is what makes the client render its truthful fallback. A null (or worse, the id) would
  // invite a `?? id` downstream, which is the exact defect being closed.
  const { resolveSalesOrderReferences } = await import("../lib/fulfillment/coordinatedVisitReadService.js");
  const db = fakeDbFor({ "so-numbered": { salesOrderNumber: "SO-2026-000003" }, "so-unnumbered": {} });
  const out = await resolveSalesOrderReferences(db, ["so-numbered", "so-unnumbered", "so-missing"]);
  assert.deepEqual(Object.keys(out), ["so-numbered"]);
  assert.equal("so-unnumbered" in out, false, "a Sales Order with no reference contributes nothing");
  assert.equal("so-missing" in out, false, "and neither does one that could not be read");
  for (const value of Object.values(out)) assert.doesNotMatch(value, /^[A-Za-z0-9]{20}$/, "no value may be a document id");
});

test("ONE READ PER DISTINCT ANCHOR -- a visit is many Work Orders against one order", async () => {
  const { resolveSalesOrderReferences } = await import("../lib/fulfillment/coordinatedVisitReadService.js");
  let fetched = 0;
  const db = fakeDbFor({}, async (...refs) => {
    fetched += refs.length;
    return refs.map((r) => ({ id: r.id, exists: true, data: () => ({ salesOrderNumber: "SO-2026-000003" }) }));
  });
  await resolveSalesOrderReferences(db, ["so-a", "so-a", "so-a", "so-b", "so-a"]);
  assert.equal(fetched, 2, "resolving per Work Order would read the same document five times for one label");
});

test("THE RESOLUTION IS BOUNDED, and never reads for an empty page", async () => {
  const { resolveSalesOrderReferences, MAX_RESOLVED_SALES_ORDER_REFERENCES } =
    await import("../lib/fulfillment/coordinatedVisitReadService.js");
  let fetched = 0;
  const db = fakeDbFor({}, async (...refs) => {
    fetched += refs.length;
    return refs.map((r) => ({ id: r.id, exists: true, data: () => ({ salesOrderNumber: "SO-2026-000001" }) }));
  });
  const ids = Array.from({ length: MAX_RESOLVED_SALES_ORDER_REFERENCES + 10 }, (_, i) => `so-${i}`);
  await resolveSalesOrderReferences(db, ids);
  assert.equal(fetched, MAX_RESOLVED_SALES_ORDER_REFERENCES);

  fetched = 0;
  assert.deepEqual(await resolveSalesOrderReferences(db, []), {});
  assert.deepEqual(await resolveSalesOrderReferences(db, ["", "  "]), {});
  assert.equal(fetched, 0, "blank ids are not anchors");
});

test("A FAILED REFERENCE READ does not take the coordinated page down", async () => {
  // A display enrichment on an already-successful read. Throwing would lose the whole dispatch board
  // over a label.
  const { resolveSalesOrderReferences } = await import("../lib/fulfillment/coordinatedVisitReadService.js");
  const db = fakeDbFor({}, async () => { throw new Error("boom"); });
  assert.deepEqual(await resolveSalesOrderReferences(db, ["so-a"]), {});
});
