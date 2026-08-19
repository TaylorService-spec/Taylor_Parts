// Site-work r3 item C -- client reconciliation engine parity with the already-fixed
// server (functions/src/warehouseReconciliationService.ts, #917). Proves
// src/domain/warehouseReconciliationEngine.ts (what Operations.jsx renders) mirrors
// the server's two hardening changes:
//   (a) expectedQuantity is keyed by `${warehouseId}__${partId}`, not globally by partId
//   (b) fail-closed: if warehouseStock has warehouseIds but ledgerConsumption entries
//       lack warehouseId, report CANNOT_EVALUATE -- never a spurious discrepancy from
//       comparing an incompatible scope.
//
// M15 -- the fail-closed guard firing and a genuinely-clean comparison must render as
// two DIFFERENT outcomes, not the same `[]`. Before this fix, detectStockDiscrepancies
// returned a bare array in both cases, so WarehousePanel.jsx could not tell "the check
// ran and found nothing" from "the check could not run" -- see the CANNOT_EVALUATE vs.
// EVALUATED assertions below, which fail against the pre-fix bare-array shape.
//
// Run: node test/warehouseReconciliationEngine.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import { detectStockDiscrepancies, generateReconciliationReport } from "../src/domain/warehouseReconciliationEngine.ts";

let passed = 0;
function ok(name, fn) {
  fn();
  passed += 1;
  console.log("PASS -- " + name);
}

ok("warehouse-scoped consumption matches its own warehouse's stock -- no discrepancy, status EVALUATED", () => {
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
  assert.equal(result.status, "EVALUATED");
  // actual - expected computed PER warehouse, not from a pooled global total.
  assert.deepEqual(
    result.discrepancies.map((d) => [d.warehouseId, d.expectedQuantity, d.actualQuantity, d.variance]).sort(),
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
  assert.equal(result.status, "EVALUATED");
  assert.equal(result.discrepancies.length, 1);
  assert.deepEqual(result.discrepancies[0], {
    partId: "PART-1",
    warehouseId: "WH-1",
    expectedQuantity: 2,
    actualQuantity: 10,
    variance: 8,
    severity: "CRITICAL",
  });
});

ok("warehouseId-less consumption against warehouse-scoped stock fails CLOSED -- CANNOT_EVALUATE, not a spurious CRITICAL", () => {
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
  assert.equal(result.status, "CANNOT_EVALUATE");
  assert.deepEqual(result.discrepancies, [], "warehouseId-less consumption must never produce a discrepancy");
});

ok("mixed consumption (some entries carry warehouseId, some don't) still fails closed -- CANNOT_EVALUATE", () => {
  const result = detectStockDiscrepancies({
    warehouseStock: [{ id: "S1", warehouseId: "WH-1", partId: "PART-1", quantity: 10, binCode: "A1" }],
    ledgerConsumption: [
      { partId: "PART-1", quantity: 3, warehouseId: "WH-1" },
      { partId: "PART-1", quantity: 2 },
    ],
  });
  assert.equal(result.status, "CANNOT_EVALUATE");
  assert.deepEqual(result.discrepancies, []);
});

ok("no warehouse-scoped stock at all (warehouseId falsy everywhere) does not trip the guard -- EVALUATED", () => {
  // The guard only fires once warehouseStock actually carries warehouse attribution;
  // an empty/unscoped stock set has nothing to falsely attribute.
  const result = detectStockDiscrepancies({ warehouseStock: [], ledgerConsumption: [{ partId: "PART-1", quantity: 3 }] });
  assert.equal(result.status, "EVALUATED");
  assert.deepEqual(result.discrepancies, []);
});

// M15 -- the whole point of this fix: CANNOT_EVALUATE and a genuinely-clean EVALUATED
// result must be distinguishable in BOTH the raw detection result and the report built
// from it. Before the fix, generateReconciliationReport(discrepancies: []) could not
// possibly carry this distinction because its only input was the bare array.
ok("CANNOT_EVALUATE and a genuinely-clean EVALUATED both have zero discrepancies, but are NOT the same outcome", () => {
  const cannotEvaluate = detectStockDiscrepancies({
    warehouseStock: [{ id: "S1", warehouseId: "WH-1", partId: "PART-1", quantity: 10, binCode: "A1" }],
    ledgerConsumption: [{ partId: "PART-1", quantity: 3 }], // no warehouseId -> guard fires
  });
  const genuinelyClean = detectStockDiscrepancies({
    warehouseStock: [],
    ledgerConsumption: [], // nothing to compare, nothing found -- guard never fires
  });

  assert.equal(cannotEvaluate.discrepancies.length, 0);
  assert.equal(genuinelyClean.discrepancies.length, 0);
  assert.notEqual(
    cannotEvaluate.status,
    genuinelyClean.status,
    "a structurally-unrunnable check must not report the same status as a check that ran and found nothing",
  );
  assert.equal(cannotEvaluate.status, "CANNOT_EVALUATE");
  assert.equal(genuinelyClean.status, "EVALUATED");

  // The report built from each carries the same distinction forward -- this is what
  // WarehousePanel.jsx actually branches on.
  const cannotEvaluateReport = generateReconciliationReport(cannotEvaluate);
  const genuinelyCleanReport = generateReconciliationReport(genuinelyClean);
  assert.equal(cannotEvaluateReport.status, "CANNOT_EVALUATE");
  assert.equal(genuinelyCleanReport.status, "EVALUATED");
  assert.equal(cannotEvaluateReport.totalDiscrepancies, 0);
  assert.equal(genuinelyCleanReport.totalDiscrepancies, 0);
});

ok("generateReconciliationReport carries EVALUATED discrepancies and severity tallies through unchanged", () => {
  const detection = detectStockDiscrepancies({
    warehouseStock: [{ id: "S1", warehouseId: "WH-1", partId: "PART-1", quantity: 10, binCode: "A1" }],
    ledgerConsumption: [{ partId: "PART-1", quantity: 2, warehouseId: "WH-1" }],
  });
  const report = generateReconciliationReport(detection);
  assert.equal(report.status, "EVALUATED");
  assert.equal(report.totalDiscrepancies, 1);
  assert.equal(report.bySeverity.CRITICAL, 1);
  assert.deepEqual(report.discrepancies, detection.discrepancies);
});

console.log(`\n${passed} passed`);
