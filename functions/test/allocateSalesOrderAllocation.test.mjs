// Fulfillment — OFFLINE regression tests for the allocateSalesOrder allocation algorithm (site-work #1
// so-alloc-overallocation-rerun, site-work #9 allocatesalesorder-missing-tests).
//
// allocateSalesOrder.ts itself is a single onCall transaction body wired to live Firestore + the (currently
// registered active:false, fail-closed-DENY) `salesOrder.fulfill` capability, so it cannot be authorized or
// exercised end-to-end without an Owner-side capability grant. Its allocation math, however, is composed
// ENTIRELY from small pure functions that are exported from the compiled lib and independently unit-tested
// elsewhere (fulfillmentAvailability.js, allocationProjection.js). This file drives those SAME real, compiled
// functions through a small harness (`runAllocationRound`) that reproduces — line for line — the exact
// per-ref computation pipeline in allocateSalesOrder.ts (lines ~132-166): eligible on-hand -> open WO
// reservations (lineage-excluded) -> other-SO + self netting -> buildAllocationPlan -> the
// `already + allocatableQty` write formula. It is not a reimplementation of the algorithm; it is the
// production pipeline replayed against in-memory fixtures shaped like the real Firestore reads.
//
// Run: npm run build && node --test test/allocateSalesOrderAllocation.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { computePartAvailability, openWorkOrderReserved, sumOtherSoCommitments, sumEligibleOnHand } from "../lib/fulfillment/fulfillmentAvailability.js";
import { buildAllocationPlan } from "../lib/fulfillment/allocationProjection.js";

// Mirrors allocateSalesOrder.ts's per-ref availability + plan + write pipeline exactly, using the real
// exported pure functions. `so.lines` is mutated in place with the new allocatedQty, exactly like the
// transaction's `nextLines` write — so calling this twice on the SAME `so` object simulates a real re-run
// (retry, or a second legitimate allocate call) against the SAME on-hand/other-SO fixtures.
function runAllocationRound({ so, otherSoLines, stockRows, eligibleWarehouseIds, woRows, excludeWorkOrderIds }) {
  const availabilityByRef = {};
  const distinctPartRefs = [...new Set(so.lines.filter((l) => l.kind === "PART").map((l) => l.ref))];
  for (const ref of distinctPartRefs) {
    const onHandEligible = sumEligibleOnHand(
      stockRows.filter((r) => r.partId === ref),
      eligibleWarehouseIds
    );
    const openWoReserved = onHandEligible === null ? 0 : openWorkOrderReserved(woRows.filter((r) => r.partId === ref), excludeWorkOrderIds);
    const other = sumOtherSoCommitments(otherSoLines, ref);
    const self = sumOtherSoCommitments(so.lines, ref);
    availabilityByRef[ref] = computePartAvailability({
      onHandEligible,
      openWoReserved,
      otherSoAllocated: other.allocatedQty,
      selfAllocated: self.allocatedQty,
    });
  }
  const plan = buildAllocationPlan(so.lines, availabilityByRef);
  so.lines = so.lines.map((l) => {
    const alloc = plan.lines.find((p) => p.ref === l.ref && p.kind === l.kind);
    const already = typeof l.allocatedQty === "number" ? l.allocatedQty : 0;
    return alloc ? { ...l, allocatedQty: already + alloc.allocatableQty } : l;
  });
  return plan;
}

const partLine = (ref, orderedQty, allocatedQty = 0) => ({ kind: "PART", ref, orderedQty, allocatedQty });
const stockRow = (partId, warehouseId, quantity) => ({ partId, warehouseId, quantity });
const woRow = (partId, type, quantity, workOrderId) => ({ partId, type, quantity, workOrderId });

// (a) THE DEFECT: a second invocation with nothing else changed must NOT double-commit.
test("re-run idempotency: a second allocation call does not double-commit the same on-hand pool (site-work #1)", () => {
  const so = { lines: [partLine("PART-1", 10)] };
  const eligibleWarehouseIds = new Set(["WH-A"]);
  const stockRows = [stockRow("PART-1", "WH-A", 10)];
  const args = { so, otherSoLines: [], stockRows, eligibleWarehouseIds, woRows: [], excludeWorkOrderIds: new Set() };

  const first = runAllocationRound(args);
  assert.equal(first.lines[0].allocatableQty, 10);
  assert.equal(so.lines[0].allocatedQty, 10, "first call allocates the full 10 units on-hand");

  // Re-run: stock_locations is untouched (allocation never decrements it -- non-forking design). Before the
  // fix, ATP was recomputed as the full undiminished 10 again, and `already + allocatableQty` bumped
  // allocatedQty to 20 against only 10 physical units -- the double-commit.
  const second = runAllocationRound(args);
  assert.equal(second.lines[0].allocatableQty, 0, "nothing left to allocate: this SO already holds the whole pool");
  assert.equal(so.lines[0].allocatedQty, 10, "allocatedQty stays at 10, never grows past the physical on-hand");

  // A third call is equally inert.
  runAllocationRound(args);
  assert.equal(so.lines[0].allocatedQty, 10);
});

// (a-2) Partial-then-retry: the classic race/retry shape where the first call cannot fully satisfy demand.
test("re-run idempotency under partial fulfillment: repeated calls converge to on-hand, never exceed it", () => {
  const so = { lines: [partLine("PART-1", 10)] };
  const eligibleWarehouseIds = new Set(["WH-A"]);
  const stockRows = [stockRow("PART-1", "WH-A", 6)]; // only 6 physically on-hand for an order of 10
  const args = { so, otherSoLines: [], stockRows, eligibleWarehouseIds, woRows: [], excludeWorkOrderIds: new Set() };

  const first = runAllocationRound(args);
  assert.equal(first.lines[0].state, "PARTIAL");
  assert.equal(so.lines[0].allocatedQty, 6);

  // Retry with the SAME undiminished on-hand read (6). Before the fix this granted another 6 (would-be 12
  // against a 6-unit pool -- the same bug, just visible with a shortfall instead of a clean multiple).
  const second = runAllocationRound(args);
  assert.equal(second.lines[0].allocatableQty, 0, "self-netted ATP is now 0 -- no more physical stock to give");
  assert.equal(so.lines[0].allocatedQty, 6, "allocatedQty converges to the true 6-unit pool, never over-commits");
});

// (b) Self-netting in isolation: computePartAvailability must subtract THIS SO's own prior commitment.
test("self-netting: computePartAvailability nets selfAllocated from the same pool as otherSoAllocated", () => {
  assert.deepEqual(
    computePartAvailability({ onHandEligible: 10, openWoReserved: 0, otherSoAllocated: 0, selfAllocated: 4 }),
    { kind: "KNOWN", quantity: 6 }
  );
  // self + other stack against the same physical pool.
  assert.deepEqual(
    computePartAvailability({ onHandEligible: 10, openWoReserved: 0, otherSoAllocated: 3, selfAllocated: 4 }),
    { kind: "KNOWN", quantity: 3 }
  );
  // floored at 0, never negative.
  assert.deepEqual(
    computePartAvailability({ onHandEligible: 5, openWoReserved: 0, otherSoAllocated: 0, selfAllocated: 9 }),
    { kind: "KNOWN", quantity: 0 }
  );
  // selfAllocated is optional/omittable and defaults to no netting (backward-compatible call shape).
  assert.deepEqual(
    computePartAvailability({ onHandEligible: 10, openWoReserved: 0, otherSoAllocated: 0 }),
    { kind: "KNOWN", quantity: 10 }
  );
});

// (c) Eligible-warehouse filtering: only status==ACTIVE warehouses' stock counts; missing evidence stays UNKNOWN.
test("eligible-warehouse filtering: only eligible-warehouse stock counts toward on-hand", () => {
  const eligibleWarehouseIds = new Set(["WH-ACTIVE"]);
  const stockRows = [stockRow("PART-1", "WH-ACTIVE", 4), stockRow("PART-1", "WH-INACTIVE", 100)];
  assert.equal(sumEligibleOnHand(stockRows, eligibleWarehouseIds), 4, "the 100 units at an ineligible warehouse are excluded entirely");

  // stock exists but none at an eligible warehouse -> a KNOWN 0 (backorder), not UNKNOWN.
  assert.equal(sumEligibleOnHand([stockRow("PART-1", "WH-INACTIVE", 100)], eligibleWarehouseIds), 0);

  // no stock_locations evidence at all -> null (UNKNOWN), never treated as 0.
  assert.equal(sumEligibleOnHand([], eligibleWarehouseIds), null);

  // end-to-end through a full allocation round: only the eligible-warehouse stock is allocatable.
  const so = { lines: [partLine("PART-1", 4)] };
  const plan = runAllocationRound({ so, otherSoLines: [], stockRows, eligibleWarehouseIds, woRows: [], excludeWorkOrderIds: new Set() });
  assert.equal(plan.lines[0].state, "ALLOCATED");
  assert.equal(so.lines[0].allocatedQty, 4);
});

// (d) Work-order-lineage exclusion: WO reservations linked to an active SO are excluded from openWoReserved
// (that demand is already counted via the SO's own allocation) — a standalone WO's reservation still counts.
test("work-order-lineage exclusion: SO-linked WO reservations are excluded; standalone WO reservations still net", () => {
  const rows = [woRow("PART-1", "RESERVED", 3, "WO-LINKED"), woRow("PART-1", "RESERVED", 2, "WO-STANDALONE")];
  assert.equal(openWorkOrderReserved(rows, new Set(["WO-LINKED"])), 2, "only the standalone WO's 2 units count");
  assert.equal(openWorkOrderReserved(rows, new Set()), 5, "with no lineage exclusion, both WOs net");

  // end-to-end: a standalone WO reservation reduces ATP even though this SO also holds an allocation.
  const so = { lines: [partLine("PART-1", 10)] };
  const eligibleWarehouseIds = new Set(["WH-A"]);
  const stockRows = [stockRow("PART-1", "WH-A", 10)];
  const plan = runAllocationRound({
    so,
    otherSoLines: [],
    stockRows,
    eligibleWarehouseIds,
    woRows: rows,
    excludeWorkOrderIds: new Set(["WO-LINKED"]),
  });
  assert.equal(plan.lines[0].allocatableQty, 8, "10 on-hand minus the 2-unit standalone WO reservation");
  assert.equal(so.lines[0].allocatedQty, 8);
});

// (e) Insufficient-stock rejection: a line can never be granted more than the true remaining physical pool,
// and the transaction-level precondition (only CONFIRMED/IN_FULFILLMENT may allocate) rejects the whole call
// outright for any other state — the shortfall is always honest (BACKORDERED/PARTIAL), never silently zeroed
// or over-granted.
test("insufficient-stock rejection: allocation never exceeds the true remaining pool; shortfall is honest", () => {
  const so = { lines: [partLine("PART-1", 5)] };
  const eligibleWarehouseIds = new Set(["WH-A"]);
  const stockRows = [stockRow("PART-1", "WH-A", 0)];
  const plan = runAllocationRound({ so, otherSoLines: [], stockRows, eligibleWarehouseIds, woRows: [], excludeWorkOrderIds: new Set() });
  assert.equal(plan.lines[0].state, "BACKORDERED");
  assert.equal(plan.lines[0].allocatableQty, 0);
  assert.equal(plan.lines[0].shortfallQty, 5);
  assert.equal(so.lines[0].allocatedQty, 0, "no phantom allocation when nothing is on-hand");
  assert.equal(plan.readiness, "BLOCKED");

  // another active SO already holds the entire pool -> this SO gets nothing, honestly reported.
  const so2 = { lines: [partLine("PART-2", 5)] };
  const otherSoLines = [{ ref: "PART-2", allocatedQty: 10 }];
  const stockRows2 = [stockRow("PART-2", "WH-A", 10)];
  const plan2 = runAllocationRound({ so: so2, otherSoLines, stockRows: stockRows2, eligibleWarehouseIds, woRows: [], excludeWorkOrderIds: new Set() });
  assert.equal(plan2.lines[0].allocatableQty, 0);
  assert.equal(plan2.lines[0].state, "BACKORDERED");
});
