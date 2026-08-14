// Cycle 7 — DEMAND-LINEAGE regression. Proves the Owner invariant: the same underlying parts demand is never
// double-counted as BOTH a Sales Order allocation AND a Work Order reservation. A Work Order created to fulfill
// a Sales Order carries `salesOrderId`; its reservation is excluded from ATP's openWoReserved (counted via the
// SO). Standalone (non-SO) Work Order reservations still count.
import test from "node:test";
import assert from "node:assert/strict";
import { openWorkOrderReserved, computePartAvailability, sumOtherSoCommitments } from "../lib/fulfillment/fulfillmentAvailability.js";

test("SO-linked WO reservation is NOT counted again in openWoReserved (no double-count)", () => {
  const rows = [
    { type: "RESERVED", quantity: 2, workOrderId: "WO-fromSO" }, // fulfills a Sales Order
    { type: "RESERVED", quantity: 3, workOrderId: "WO-standalone" }, // independent service
  ];
  // Exclude the SO-linked WO: only the standalone 3 counts here (the 2 is counted via the SO allocation).
  assert.equal(openWorkOrderReserved(rows, new Set(["WO-fromSO"])), 3);
  // Without the lineage exclusion it would be 5 (the bug we prevent).
  assert.equal(openWorkOrderReserved(rows), 5);
});

test("end-to-end: SO allocates 2, its WO reserves 2 → total committed = 2, not 4", () => {
  // ATP for a part with on-hand 10:
  //   other-SO allocation = 2 (this SO committed 2)
  //   WO reservation for that same demand = 2, but its WO is SO-linked ⇒ excluded from openWoReserved.
  const onHandEligible = 10;
  const otherSoAllocated = sumOtherSoCommitments([{ kind: "PART", ref: "PRT-1001", allocatedQty: 2 }], "PART", "PRT-1001").allocatedQty; // 2
  const openWoReserved = openWorkOrderReserved(
    [{ type: "RESERVED", quantity: 2, workOrderId: "WO-fromSO" }],
    new Set(["WO-fromSO"]) // SO-linked ⇒ excluded
  ); // 0
  const atp = computePartAvailability({ onHandEligible, openWoReserved, otherSoAllocated });
  assert.deepEqual(atp, { kind: "KNOWN", quantity: 8 }); // 10 − 0 − 2, NOT 10 − 2 − 2 = 6
});

test("a standalone WO reservation (no SO lineage) still reduces ATP", () => {
  const atp = computePartAvailability({
    onHandEligible: 10,
    openWoReserved: openWorkOrderReserved([{ type: "RESERVED", quantity: 4, workOrderId: "WO-standalone" }], new Set()),
    otherSoAllocated: 0,
  });
  assert.deepEqual(atp, { kind: "KNOWN", quantity: 6 });
});
