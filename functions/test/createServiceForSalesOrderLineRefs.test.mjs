// P1.2 (Sales->Cash fulfillment spine) -- OFFLINE tests for createServiceForSalesOrder.ts's PURE
// buildLineRefsAndInventorySnapshot, imported from compiled lib. The onCall wrapper itself is gated by the
// `salesOrder.service` capability, registered active:false (fail-closed DENY for everyone until a separate
// Owner grant -- see the file's header comment), so it cannot be exercised end-to-end without an Owner-side
// capability grant. This pure core is where the actual SO-line -> WO-line-ref + inventorySnapshot-seed logic
// lives, and it is exercised directly here (same separation-of-concerns pattern as
// setWorkOrderPartsPlan.test.mjs's validatePartsPlan/applyPartsPlan).
//
// Run: npm run build && node --test test/createServiceForSalesOrderLineRefs.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLineRefsAndInventorySnapshot,
  LineRefBuildError,
  assertServiceAllocationGate,
  ServiceAllocationGateError,
} from "../lib/salesOrder/createServiceForSalesOrder.js";

// A Part Master resolver over a fixture map: partId -> { found, sku }. Absent id => not found (fail closed).
const resolver = (map) => (partId) => map[partId] ?? { found: false, sku: null };

test("PART + SERVICE SO: WO gets 2 line-refs (qty+kind-bearing) + 1 inventorySnapshot row (resolved sku, correct qtyPlanned)", () => {
  const soLines = [
    { kind: "PART", ref: "P-1", orderedQty: 4, allocatedQty: 3 },
    { kind: "SERVICE", ref: "SVC-INSTALL", orderedQty: 1, allocatedQty: 0 },
  ];
  const { lineRefs, inventorySnapshot } = buildLineRefsAndInventorySnapshot(
    soLines,
    resolver({ "P-1": { found: true, sku: "IPN-1" } })
  );

  assert.equal(lineRefs.length, 2);
  assert.deepEqual(lineRefs[0], { ref: "P-1", kind: "PART", orderedQty: 4, allocatedQty: 3 });
  assert.deepEqual(lineRefs[1], { ref: "SVC-INSTALL", kind: "SERVICE", orderedQty: 1, allocatedQty: 0 });

  assert.equal(inventorySnapshot.length, 1);
  assert.equal(inventorySnapshot[0].partId, "P-1");
  assert.equal(inventorySnapshot[0].sku, "IPN-1");
  assert.notEqual(inventorySnapshot[0].sku, inventorySnapshot[0].partId); // never sku = partId
  // pass4 A-1 (BD-14): qtyPlanned = allocatedQty ONLY -- never allocatedQty || orderedQty.
  assert.equal(inventorySnapshot[0].qtyPlanned, 3);
});

test("pass4 A-1 (BD-14): PART line qtyPlanned is 0 -- NOT orderedQty -- when allocatedQty is 0 (unallocated/backordered)", () => {
  // A backordered line (allocatedQty 0, e.g. allocateSalesOrder ran but this line drew nothing from the ATP
  // pool) must seed qtyPlanned=0, never orderedQty -- otherwise the Work Order would carry planned quantity
  // with NO backing allocation, and #962's Complete write-back would credit fulfilledQty for never-allocated
  // parts.
  const soLines = [{ kind: "PART", ref: "P-2", orderedQty: 5, allocatedQty: 0 }];
  const { inventorySnapshot } = buildLineRefsAndInventorySnapshot(soLines, resolver({ "P-2": { found: true, sku: "IPN-2" } }));
  assert.equal(inventorySnapshot[0].qtyPlanned, 0);
});

test("pass4 B-2: lineId (when present on the SO line) is carried onto both the line-ref and the inventorySnapshot row", () => {
  const soLines = [
    { lineId: "line-1", kind: "PART", ref: "P-1", orderedQty: 5, allocatedQty: 5 },
    { lineId: "line-2", kind: "PART", ref: "P-1", orderedQty: 5, allocatedQty: 0 }, // duplicate ref, own lineId
  ];
  const { lineRefs, inventorySnapshot } = buildLineRefsAndInventorySnapshot(
    soLines,
    resolver({ "P-1": { found: true, sku: "IPN-1" } })
  );
  assert.equal(lineRefs[0].lineId, "line-1");
  assert.equal(lineRefs[1].lineId, "line-2");
  assert.equal(inventorySnapshot[0].lineId, "line-1");
  assert.equal(inventorySnapshot[0].qtyPlanned, 5);
  assert.equal(inventorySnapshot[1].lineId, "line-2");
  assert.equal(inventorySnapshot[1].qtyPlanned, 0, "the backordered duplicate-ref line seeds its OWN qtyPlanned (0), not the sibling's");
});

test("unresolvable PART ref (no canonical Part record) -> FAIL CLOSED (PART_NOT_FOUND), never fabricates sku", () => {
  const soLines = [{ kind: "PART", ref: "P-MISSING", orderedQty: 1, allocatedQty: 0 }];
  assert.throws(
    () => buildLineRefsAndInventorySnapshot(soLines, resolver({})),
    (e) => e instanceof LineRefBuildError && e.code === "PART_NOT_FOUND"
  );
});

test("PART ref resolves to a canonical Part with no valid internalPartNumber -> FAIL CLOSED (SKU_UNRESOLVED)", () => {
  const soLines = [{ kind: "PART", ref: "P-3", orderedQty: 1, allocatedQty: 0 }];
  assert.throws(
    () => buildLineRefsAndInventorySnapshot(soLines, resolver({ "P-3": { found: true, sku: null } })),
    (e) => e instanceof LineRefBuildError && e.code === "SKU_UNRESOLVED"
  );
  assert.throws(
    () => buildLineRefsAndInventorySnapshot(soLines, resolver({ "P-3": { found: true, sku: "   " } })),
    (e) => e instanceof LineRefBuildError && e.code === "SKU_UNRESOLVED"
  );
});

test("pass4 A-1 (BD-14) gate: a SO with a PART line and NO allocatedAt (allocateSalesOrder never ran) is REJECTED", () => {
  const soLines = [{ kind: "PART", ref: "P-1", orderedQty: 5, allocatedQty: 0 }];
  assert.throws(
    () => assertServiceAllocationGate(soLines, undefined),
    (e) => e instanceof ServiceAllocationGateError && e.code === "NOT_ALLOCATED"
  );
});

test("pass4 A-1 (BD-14) gate: a SO with a PART line and an allocatedAt timestamp is ALLOWED, even if partially allocated", () => {
  const soLines = [
    { kind: "PART", ref: "P-1", orderedQty: 5, allocatedQty: 5 },
    { kind: "PART", ref: "P-2", orderedQty: 3, allocatedQty: 0 }, // backordered
  ];
  assert.doesNotThrow(() => assertServiceAllocationGate(soLines, { seconds: 1, nanoseconds: 0 }));
});

test("pass4 A-1 (BD-14) gate: a SO with NO PART lines (SERVICE/EQUIPMENT_MODEL only) is ALLOWED without allocation", () => {
  const soLines = [{ kind: "SERVICE", ref: "SVC-1", orderedQty: 1, allocatedQty: 0 }];
  assert.doesNotThrow(() => assertServiceAllocationGate(soLines, undefined));
});

test("EQUIPMENT_MODEL-only SO: line-refs populated, NO inventorySnapshot (never resolves against Part Master)", () => {
  const soLines = [{ kind: "EQUIPMENT_MODEL", ref: "C713", orderedQty: 2, allocatedQty: 1 }];
  // Resolver that would throw if ever called -- proves EQUIPMENT_MODEL lines never touch Part Master.
  const neverCalled = () => {
    throw new Error("resolvePart must not be called for a non-PART line");
  };
  const { lineRefs, inventorySnapshot } = buildLineRefsAndInventorySnapshot(soLines, neverCalled);
  assert.equal(lineRefs.length, 1);
  assert.deepEqual(lineRefs[0], { ref: "C713", kind: "EQUIPMENT_MODEL", orderedQty: 2, allocatedQty: 1 });
  assert.deepEqual(inventorySnapshot, []);
});
