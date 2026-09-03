// CONSUMED STOCK NEVER LEAVES ON-HAND — the defect that blocks one commitment pool.
// Run: node --test test/inventoryConsumptionOnHandGap.test.mjs   (no emulator)
//
// Found while implementing DECISIONS #165's "one commitment pool". It is PRE-EXISTING and it is
// NOT fixed here; these tests pin it so the next change cannot be built on top of it unknowingly.
//
// THE FACT. Nothing in this platform removes consumed stock from physical on-hand:
//   · `sumLedgerEligibleOnHand` counts RECEIVED / TRANSFER_IN / TRANSFER_OUT / ADJUSTED /
//     RETURNED / SCRAPPED. CONSUMED is not among them.
//   · Legacy commitment rows (RESERVED / RELEASED / CONSUMED) carry no `location`, and that
//     function skips any row without a WAREHOUSE location — so a consumption is doubly invisible.
//   · `consumeParts()` writes CONSUMED and no physical-removal movement of any kind.
//
// So after 5 units are received and 2 are fitted to a machine, physical on-hand still reads 5.
//
// THE TWO PATHS COMPENSATE DIFFERENTLY, WHICH IS WHY THIS WAS INVISIBLE.
//   · inventoryService (Work Orders) nets RESERVED − RELEASED and deliberately does NOT subtract
//     CONSUMED. The consumed quantity stays counted as committed, so it stays out of availability.
//     Wrong reason, right number.
//   · `openWorkOrderReserved` (Sales Orders) DOES subtract CONSUMED and does not compensate. The
//     units leave the commitment side while never leaving the on-hand side, so they are silently
//     re-offered.
//
// WHY IT BLOCKS THE UNIFICATION. Adopting the Sales Order commitment sum in the Work Order path —
// the obvious way to make one pool — would import this defect into the live dispatch path and
// conjure consumed stock back into availability. Adopting the Work Order rule platform-wide makes
// "committed" mean "committed or consumed", which is wrong for any Reserved-to-* figure. Fixing it
// properly means either a physical removal movement at consumption or amending an Owner-ratified
// derivation. All three are inventory-semantics decisions, so it is recorded, not chosen.

import assert from "node:assert/strict";
import test from "node:test";

const { sumLedgerEligibleOnHand, openWorkOrderReserved, computePartAvailability } = await import(
  "../lib/fulfillment/fulfillmentAvailability.js"
);

const WH = "wh-1";
const ELIGIBLE = new Set([WH]);
const at = (locationId = WH) => ({ type: "WAREHOUSE", locationId });

/** 5 received, then a Work Order reserved 2 and consumed them. 3 units physically remain. */
const RECEIVED_5_CONSUMED_2 = [
  { type: "RECEIVED", quantity: 5, trackingMode: "NONE", location: at() },
  { type: "RESERVED", quantity: 2, workOrderId: "wo-1" },
  { type: "CONSUMED", quantity: 2, workOrderId: "wo-1" },
];

test("physical on-hand does NOT drop when stock is consumed", () => {
  assert.equal(
    sumLedgerEligibleOnHand(RECEIVED_5_CONSUMED_2, ELIGIBLE),
    5,
    "3 units physically remain, but on-hand still reads 5 — consumption is invisible to this derivation",
  );
});

test("a CONSUMED row cannot be seen by the on-hand derivation even in principle", () => {
  // Two independent reasons, either of which alone would hide it. Both are asserted so a future
  // fix that addresses only one does not look complete.
  const consumedWithLocation = [{ type: "CONSUMED", quantity: 2, trackingMode: "NONE", location: at() }];
  assert.equal(
    sumLedgerEligibleOnHand(consumedWithLocation, ELIGIBLE),
    null,
    "CONSUMED is not a physical movement type, so even WITH a location it is not evidence of stock",
  );
  const consumedWithoutLocation = [{ type: "CONSUMED", quantity: 2 }];
  assert.equal(sumLedgerEligibleOnHand(consumedWithoutLocation, ELIGIBLE), null);
});

test("THE DEFECT: the Sales Order path re-offers consumed units", () => {
  const onHand = sumLedgerEligibleOnHand(RECEIVED_5_CONSUMED_2, ELIGIBLE);
  const committed = openWorkOrderReserved(RECEIVED_5_CONSUMED_2);
  assert.equal(committed, 0, "the commitment is released by CONSUMED…");
  assert.equal(onHand, 5, "…while the stock it consumed never left on-hand");

  const atp = computePartAvailability({ onHandEligible: onHand, openWoReserved: committed, otherSoAllocated: 0 });
  assert.deepEqual(
    atp,
    { kind: "KNOWN", quantity: 5 },
    "5 promised where 3 exist — this is the over-availability that blocks one pool",
  );
});

test("the Work Order rule gets the right number, by compensating rather than by being right", () => {
  // RESERVED − RELEASED, CONSUMED deliberately not subtracted: the consumed quantity stays
  // "committed" forever, which keeps it out of availability. This is what inventoryService uses.
  const openCommitment = (rows) =>
    Math.max(
      0,
      rows.reduce((n, r) => n + (r.type === "RESERVED" ? r.quantity : r.type === "RELEASED" ? -r.quantity : 0), 0),
    );
  const onHand = sumLedgerEligibleOnHand(RECEIVED_5_CONSUMED_2, ELIGIBLE);
  assert.equal(openCommitment(RECEIVED_5_CONSUMED_2), 2, "the consumed 2 stay counted as committed");
  assert.equal(onHand - openCommitment(RECEIVED_5_CONSUMED_2), 3, "which yields the physically correct 3");

  // The compensation is exact only while consumption equals what was reserved. A partial
  // consumption with its remainder released lands correctly too, which is why this has held up.
  const partial = [
    { type: "RECEIVED", quantity: 5, trackingMode: "NONE", location: at() },
    { type: "RESERVED", quantity: 3, workOrderId: "wo-2" },
    { type: "CONSUMED", quantity: 1, workOrderId: "wo-2" },
    { type: "RELEASED", quantity: 2, workOrderId: "wo-2" },
  ];
  assert.equal(
    sumLedgerEligibleOnHand(partial, ELIGIBLE) - openCommitment(partial),
    4,
    "5 received, 1 consumed, 2 released back ⇒ 4 available",
  );
});

test("the two rules disagree, and the size of the disagreement is exactly what was consumed", () => {
  const rows = RECEIVED_5_CONSUMED_2;
  const salesOrderRule = openWorkOrderReserved(rows);
  const workOrderRule = Math.max(
    0,
    rows.reduce((n, r) => n + (r.type === "RESERVED" ? r.quantity : r.type === "RELEASED" ? -r.quantity : 0), 0),
  );
  assert.equal(workOrderRule - salesOrderRule, 2, "the gap is the consumed quantity, every time");
  assert.notEqual(salesOrderRule, workOrderRule, "one physical pool cannot have two commitment answers");
});
