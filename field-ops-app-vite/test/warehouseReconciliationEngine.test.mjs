// Site-work r3 item C -- client reconciliation engine parity with the already-fixed
// server (functions/src/warehouseReconciliationService.ts, #917). Proves
// src/domain/warehouseReconciliationEngine.ts (what Operations.jsx renders) mirrors
// the server's two hardening changes:
//   (a) expectedQuantity is keyed by `${warehouseId}__${partId}`, not globally by partId
//   (b) fail-closed: if warehouseStock has warehouseIds but ledgerConsumption entries
//       lack warehouseId, return [] -- never a spurious discrepancy from comparing an
//       incompatible scope.
//
// Run: node test/warehouseReconciliationEngine.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import { detectStockDiscrepancies } from "../src/domain/warehouseReconciliationEngine.ts";

let passed = 0;
function ok(name, fn) {
  fn();
  passed += 1;
  console.log("PASS -- " + name);
}

ok("warehouse-scoped consumption matches its own warehouse's stock -- no discrepancy", () => {
  const result = detectStockDiscrepancies({
    warehouseStock: [
      { id: "S1", warehouseId: "WH-1", partId: "PART-1", quantity: 10, binCode: "A1" },
      { id: "S2", warehouseId: "WH-2", partId: "PART-1", quantity: 5, binCode: "B1" },
    ],
    ledgerConsumption: [
      { partId: "PART-1", quantity: 3, warehouseId: "WH-1" },
      { partId: "PART-1", quantity: 1, warehouseId: "WH-2" },
    ],
  });
  // actual - expected computed PER warehouse, not from a pooled global total.
  assert.deepEqual(
    result.map((d) => [d.warehouseId, d.expectedQuantity, d.actualQuantity, d.variance]).sort(),
    [
      ["WH-1", 3, 10, 7],
      ["WH-2", 1, 5, 4],
    ].sort(),
  );
});

ok("a real discrepancy is still detected when consumption is fully warehouse-attributed", () => {
  const result = detectStockDiscrepancies({
    warehouseStock: [{ id: "S1", warehouseId: "WH-1", partId: "PART-1", quantity: 10, binCode: "A1" }],
    ledgerConsumption: [{ partId: "PART-1", quantity: 2, warehouseId: "WH-1" }],
  });
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], {
    partId: "PART-1",
    warehouseId: "WH-1",
    expectedQuantity: 2,
    actualQuantity: 10,
    variance: 8,
    severity: "CRITICAL",
  });
});

ok("warehouseId-less consumption against warehouse-scoped stock fails CLOSED -- [] not a spurious CRITICAL", () => {
  // Pre-fix behaviour: a global consumption total (e.g. 3 units consumed, attributed
  // nowhere) compared against EACH warehouse's full bin total manufactured a false
  // discrepancy at every warehouse holding that part. Post-fix: no attribution -> no
  // claim, ever -- this is exactly the shape Operations.jsx currently produces, since
  // the live ledger (LedgerTransaction) carries no warehouseId.
  const result = detectStockDiscrepancies({
    warehouseStock: [
      { id: "S1", warehouseId: "WH-1", partId: "PART-1", quantity: 10, binCode: "A1" },
      { id: "S2", warehouseId: "WH-2", partId: "PART-1", quantity: 10, binCode: "B1" },
    ],
    ledgerConsumption: [{ partId: "PART-1", quantity: 3 }],
  });
  assert.deepEqual(result, [], "warehouseId-less consumption must never produce a discrepancy");
});

ok("mixed consumption (some entries carry warehouseId, some don't) still fails closed", () => {
  const result = detectStockDiscrepancies({
    warehouseStock: [{ id: "S1", warehouseId: "WH-1", partId: "PART-1", quantity: 10, binCode: "A1" }],
    ledgerConsumption: [
      { partId: "PART-1", quantity: 3, warehouseId: "WH-1" },
      { partId: "PART-1", quantity: 2 },
    ],
  });
  assert.deepEqual(result, []);
});

ok("no warehouse-scoped stock at all (warehouseId falsy everywhere) does not trip the guard", () => {
  // The guard only fires once warehouseStock actually carries warehouse attribution;
  // an empty/unscoped stock set has nothing to falsely attribute.
  const result = detectStockDiscrepancies({ warehouseStock: [], ledgerConsumption: [{ partId: "PART-1", quantity: 3 }] });
  assert.deepEqual(result, []);
});

console.log(`\n${passed} passed`);
