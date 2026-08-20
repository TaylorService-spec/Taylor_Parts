// Sales Order allocation derives sellable stock from the GOVERNED LEDGER (Owner-ratified 2026-08-17).
//
// THE DEFECT THIS PINS. Allocation took physical ON_HAND from `stock_locations`, which nothing in the
// codebase ever writes -- it is a seeded legacy projection -- while Receiving, Transfer and reconciled
// Cycle Counts all write the append-only inventory_transactions ledger. The two could only diverge,
// and in the sandbox they did, in BOTH directions:
//
//   PRT-1001  stock_locations 0,  ledger 3 received  -> a real order was BACKORDERED
//   PRT-1005  stock_locations 40, ledger 0 received  -> 36 units committed that do not exist
//
// An availability source that can both refuse real stock and promise imaginary stock is not an
// authority. Physical stock now comes from the same ledger every other inventory surface uses.
//
// Run: node --test functions/test/salesOrderLedgerAuthority.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import {
  sumLedgerEligibleOnHand,
  openWorkOrderReserved,
  sumOtherSoCommitments,
  computePartAvailability,
} from "../lib/fulfillment/fulfillmentAvailability.js";

const ELIGIBLE = new Set(["wh-main", "wh-north"]);
const at = (locationId, type, quantity, extra = {}) => ({
  type, quantity, location: { type: "WAREHOUSE", locationId }, ...extra,
});
const mobile = (type, quantity) => ({ type, quantity, location: { type: "MOBILE", locationId: "truck-1" } });

// ---- A. ledger stock exists, stock_locations says zero -> allocation uses LEDGER stock -------------
test("A: allocation sees genuinely received ledger stock (the PRT-1001 case)", () => {
  // stock_locations said 0 here. The ledger is the authority now.
  const onHand = sumLedgerEligibleOnHand([at("wh-main", "RECEIVED", 4), at("wh-main", "ADJUSTED", -1)], ELIGIBLE);
  assert.equal(onHand, 3);
  const avail = computePartAvailability({ onHandEligible: onHand, openWoReserved: 0, otherSoAllocated: 0 });
  assert.deepEqual(avail, { kind: "KNOWN", quantity: 3 });
});

// ---- B. stock_locations says stock exists, ledger says zero -> no fabricated availability ----------
test("B: a Part never received through a governed path has NO sellable stock (the PRT-1005 case)", () => {
  // stock_locations said 40. The ledger has no physical movement at all -> UNKNOWN, never 40, never 0-as-fact.
  const onHand = sumLedgerEligibleOnHand([], ELIGIBLE);
  assert.equal(onHand, null, "missing physical evidence must be UNKNOWN, not a fabricated quantity");
  assert.deepEqual(computePartAvailability({ onHandEligible: onHand, openWoReserved: 0, otherSoAllocated: 0 }), { kind: "UNKNOWN" });
});

// ---- C. WO reservations reduce allocatable quantity ------------------------------------------------
test("C: open Work Order reservations reduce what a Sales Order may allocate", () => {
  const ledger = [at("wh-main", "RECEIVED", 10), at("wh-main", "RESERVED", 4, { workOrderId: "wo-1" })];
  const onHand = sumLedgerEligibleOnHand(ledger, ELIGIBLE);
  assert.equal(onHand, 10, "a reservation is logical -- it must not change physical on-hand");
  const reserved = openWorkOrderReserved(ledger.map((r) => ({ type: r.type, quantity: r.quantity, workOrderId: r.workOrderId })));
  assert.equal(reserved, 4);
  assert.deepEqual(computePartAvailability({ onHandEligible: onHand, openWoReserved: reserved, otherSoAllocated: 0 }), { kind: "KNOWN", quantity: 6 });
});

// ---- D. other active Sales Order allocations reduce allocatable quantity ---------------------------
test("D: other active Sales Orders' commitments reduce allocatable quantity", () => {
  const onHand = sumLedgerEligibleOnHand([at("wh-main", "RECEIVED", 10)], ELIGIBLE);
  const otherSo = sumOtherSoCommitments(
    [
      { kind: "PART", ref: "PRT-X", allocatedQty: 3 },
      { kind: "PART", ref: "PRT-X", allocatedQty: 2 },
      { kind: "PART", ref: "PRT-OTHER", allocatedQty: 99 },
    ],
    "PART",
    "PRT-X",
  );
  assert.equal(otherSo.allocatedQty, 5, "only commitments for THIS part count");
  assert.deepEqual(computePartAvailability({ onHandEligible: onHand, openWoReserved: 0, otherSoAllocated: otherSo.allocatedQty }), { kind: "KNOWN", quantity: 5 });
});

// ---- E. partial allocation math ---------------------------------------------------------------------
test("E: partial allocation math is exact against combined demand", () => {
  // The live sandbox shape: 40 on hand, 9 already committed by other active Sales Orders -> 31 allocatable.
  const onHand = sumLedgerEligibleOnHand([at("wh-main", "RECEIVED", 40)], ELIGIBLE);
  const avail = computePartAvailability({ onHandEligible: onHand, openWoReserved: 0, otherSoAllocated: 9 });
  assert.deepEqual(avail, { kind: "KNOWN", quantity: 31 });
});

// ---- F. insufficient governed stock stays honest -----------------------------------------------------
test("F: demand beyond governed stock yields a real shortage, never fabricated supply", () => {
  const onHand = sumLedgerEligibleOnHand([at("wh-main", "RECEIVED", 2)], ELIGIBLE);
  const avail = computePartAvailability({ onHandEligible: onHand, openWoReserved: 0, otherSoAllocated: 0 });
  assert.deepEqual(avail, { kind: "KNOWN", quantity: 2 });
  assert.equal(avail.quantity < 100, true, "a 100-unit order must not be fully allocatable from 2 units");
});

test("F: over-committed stock floors at zero rather than going negative", () => {
  const onHand = sumLedgerEligibleOnHand([at("wh-main", "RECEIVED", 2)], ELIGIBLE);
  assert.deepEqual(computePartAvailability({ onHandEligible: onHand, openWoReserved: 5, otherSoAllocated: 4 }), { kind: "KNOWN", quantity: 0 });
});

// ---- G. replay must not double-allocate --------------------------------------------------------------
test("G: an SO's own existing commitment is netted, so re-running allocation does not double-allocate", () => {
  // selfAllocated is what makes replay idempotent: the second pass sees its own 5 already committed.
  const onHand = sumLedgerEligibleOnHand([at("wh-main", "RECEIVED", 10)], ELIGIBLE);
  const first = computePartAvailability({ onHandEligible: onHand, openWoReserved: 0, otherSoAllocated: 0 });
  assert.deepEqual(first, { kind: "KNOWN", quantity: 10 });
  const replay = computePartAvailability({ onHandEligible: onHand, openWoReserved: 0, otherSoAllocated: 0, selfAllocated: 5 });
  assert.deepEqual(replay, { kind: "KNOWN", quantity: 5 }, "its own commitment must not be available to itself twice");
});

// ---- H. logical commitment must not move physical stock ----------------------------------------------
test("H: logical commitment events are NEVER counted as physical movement", () => {
  // The invariant that keeps allocation a commitment rather than a movement. If RESERVED/RELEASED/CONSUMED
  // leaked into physical on-hand, committing stock would appear to create or destroy it.
  const ledger = [
    at("wh-main", "RECEIVED", 5),
    at("wh-main", "RESERVED", 3, { workOrderId: "wo-1" }),
    at("wh-main", "RELEASED", 1, { workOrderId: "wo-1" }),
    at("wh-main", "CONSUMED", 2, { workOrderId: "wo-1" }),
  ];
  assert.equal(sumLedgerEligibleOnHand(ledger, ELIGIBLE), 5, "physical on-hand must be receipts only");
});

// ---- warehouse eligibility is preserved ---------------------------------------------------------------
test("stock at an INELIGIBLE warehouse is not sellable", () => {
  const onHand = sumLedgerEligibleOnHand([at("wh-retired", "RECEIVED", 99)], ELIGIBLE);
  assert.equal(onHand, 0, "rows exist but none are eligible -> a real 0, not UNKNOWN");
});

test("MOBILE/truck stock is real inventory but is not sellable warehouse stock", () => {
  // Evidence EXISTS (the part is physically somewhere), it is simply not sellable from a warehouse ->
  // a known 0, not UNKNOWN. UNKNOWN is reserved for "we have no physical evidence at all".
  assert.equal(sumLedgerEligibleOnHand([mobile("RECEIVED", 7)], ELIGIBLE), 0);
  assert.equal(sumLedgerEligibleOnHand([at("wh-main", "RECEIVED", 3), mobile("TRANSFER_IN", 7)], ELIGIBLE), 3);
});

test("a warehouse-to-warehouse transfer between eligible sites conserves sellable stock", () => {
  const onHand = sumLedgerEligibleOnHand(
    [at("wh-main", "RECEIVED", 4), at("wh-main", "TRANSFER_OUT", 2), at("wh-north", "TRANSFER_IN", 2)],
    ELIGIBLE,
  );
  assert.equal(onHand, 4);
});

test("a transfer out to a truck removes sellable warehouse stock", () => {
  const onHand = sumLedgerEligibleOnHand([at("wh-main", "RECEIVED", 4), at("wh-main", "TRANSFER_OUT", 1)], ELIGIBLE);
  assert.equal(onHand, 3, "the unit left the warehouse; it is no longer sellable from there");
});

test("a negative ADJUSTED from a reconciled Cycle Count reduces sellable stock", () => {
  // num0() drops non-positive values, so a shortage adjustment must be read with its own sign.
  assert.equal(sumLedgerEligibleOnHand([at("wh-main", "RECEIVED", 5), at("wh-main", "ADJUSTED", -2)], ELIGIBLE), 3);
});

// ---- H7 (sandbox-gap-scan-2026-08-19.md): the ledger sign inversion ---------------------------------
//
// A Cycle Count on a SERIAL-tracked Part reconciling a MISSING unit writes "ADJUSTED, quantity: 1"
// (SERIAL quantity is always exactly 1, never negative -- there is no "quantity -1 of one specific
// serial"). Before this fix, sumLedgerEligibleOnHand summed that row exactly like a NONE-mode receipt:
// discovering a unit MISSING increased its reservable Sales Order availability. The fix mirrors
// inventoryLedger/mobileLocationPresenceProbe.ts's established `if (v.trackingMode !== "NONE")
// continue;` precedent -- SERIAL custody is authoritative via serialized_assets, never via quantity math.

test("H7: a SERIAL-tracked ADJUSTED entry (a cycle count finding a unit missing) must NOT raise sellable on-hand", () => {
  const onHand = sumLedgerEligibleOnHand([at("wh-main", "ADJUSTED", 1, { trackingMode: "SERIAL" })], ELIGIBLE);
  // Pre-fix this was 1 (the exact inversion H7 reports). The row has physical-type evidence but is
  // excluded from quantity math entirely, so it is a known 0 (not UNKNOWN -- ADJUSTED is a PHYSICAL type).
  assert.equal(onHand, 0);
});

test("H7: a SERIAL-tracked ADJUSTED entry does not distort genuine NONE-mode eligible stock", () => {
  const onHand = sumLedgerEligibleOnHand(
    [at("wh-main", "RECEIVED", 3, { trackingMode: "NONE" }), at("wh-main", "ADJUSTED", 1, { trackingMode: "SERIAL" })],
    ELIGIBLE,
  );
  assert.equal(onHand, 3, "the SERIAL row must be excluded, not merely floored -- 3 NONE-mode units stay 3, not 4");
});

test("H7: a row with no trackingMode field is treated as NONE (backward-compatible default)", () => {
  // trackingMode is a REQUIRED, validated field on every governed operational-movement write, so a row
  // carrying a governed type can never legitimately omit it in real data; existing callers/tests that
  // never set it (all of the tests above this section) must keep behaving exactly as before.
  assert.equal(sumLedgerEligibleOnHand([at("wh-main", "RECEIVED", 4), at("wh-main", "ADJUSTED", -1)], ELIGIBLE), 3);
});

// ---- H7 secondary finding: RETURNED/SCRAPPED were schema-legal but silently omitted -----------------
//
// transferOrderCommand.ts, cycleCount/cycleCountExpectedQuantity.ts and mobileLocationPresenceProbe.ts
// already sum RETURNED (+) and SCRAPPED (-). sumLedgerEligibleOnHand omitted both -- a governed RMA
// return or scrap-out at an eligible warehouse was invisible to Sales Order allocation availability.

test("H7b: RETURNED (RMA) is now counted as eligible physical on-hand, like RECEIVED", () => {
  assert.equal(sumLedgerEligibleOnHand([at("wh-main", "RETURNED", 2, { trackingMode: "NONE" })], ELIGIBLE), 2);
});

test("H7b: SCRAPPED is now counted as a physical removal, like TRANSFER_OUT", () => {
  const onHand = sumLedgerEligibleOnHand(
    [at("wh-main", "RECEIVED", 5, { trackingMode: "NONE" }), at("wh-main", "SCRAPPED", 2, { trackingMode: "NONE" })],
    ELIGIBLE,
  );
  assert.equal(onHand, 3);
});

test("H7b: a SERIAL-tracked RETURNED/SCRAPPED entry is excluded from quantity math too", () => {
  assert.equal(sumLedgerEligibleOnHand([at("wh-main", "RETURNED", 1, { trackingMode: "SERIAL" })], ELIGIBLE), 0);
  const onHand = sumLedgerEligibleOnHand(
    [at("wh-main", "RECEIVED", 5, { trackingMode: "NONE" }), at("wh-main", "SCRAPPED", 1, { trackingMode: "SERIAL" })],
    ELIGIBLE,
  );
  assert.equal(onHand, 5);
});
