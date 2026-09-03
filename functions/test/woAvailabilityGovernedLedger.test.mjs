// OPERATIONAL AVAILABILITY ARITHMETIC — the contract Work Order dispatch is refused by.
//
// HISTORY, because it explains the shape. This file was written to pin an earlier defect:
// getAvailableQuantity() computed warehouseQty(STATIC catalogue) - (RESERVED - RELEASED) and ignored
// every governed movement type, so a Part whose stock arrived through Receiving/Transfer/Cycle Count
// was invisible. Live evidence at the time (platform-sandbox): PRT-1001 held 3 units and the formula
// returned 0, refusing the Work Order as "Insufficient stock".
//
// That was fixed by ADDING the governed types on top of the static baseline. DECISIONS #165 finished
// the job by REMOVING the baseline: a fixture quantity may not decide a real dispatch at all.
//
// Run: node --test functions/test/woAvailabilityGovernedLedger.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
// RETARGETED (DECISIONS #165). These cases used to exercise `sumGovernedLedger`, a Work-Order-only
// on-hand sum that added a STATIC catalogue baseline and counted every location. That function is
// deleted and the static baseline is gone: operational on-hand is now the SAME ledger derivation the
// Sales Order path uses, so there is one answer rather than two that could disagree.
//
// The H7/H7b semantics below are unchanged and are the reason this file survived rather than being
// deleted with the function — `sumLedgerEligibleOnHand` is where that behaviour now lives, and it
// had no direct coverage of it. Two cases DID go: the pair asserting that a static baseline still
// worked and composed with governed stock. The ruling makes both false, and a green test asserting
// a retired authority is worse than no test.
import { sumLedgerEligibleOnHand } from "../lib/fulfillment/fulfillmentAvailability.js";

const WH = "wh-1";
const ELIGIBLE = new Set([WH]);

/**
 * Operational availability: eligible on-hand − open commitment. `null` = UNKNOWN.
 *
 * Mirrors inventoryService.openCommitment: RESERVED − RELEASED, with CONSUMED deliberately NOT
 * subtracted. That is not an oversight — nothing removes consumed stock from on-hand, so leaving
 * the consumed quantity counted as committed is what keeps it out of availability. Using
 * `openWorkOrderReserved` here instead (which does subtract CONSUMED) makes this file's CONSUMED
 * case return 5 where 3 units physically remain; that gap is proven in
 * test/inventoryConsumptionOnHandGap.test.mjs and is the open decision blocking one shared pool.
 */
function availability(ledger) {
  const onHand = sumLedgerEligibleOnHand(ledger, ELIGIBLE);
  if (onHand === null) return null;
  const committed = ledger.reduce(
    (n, r) => n + (r.type === "RESERVED" ? r.quantity : r.type === "RELEASED" ? -r.quantity : 0),
    0,
  );
  return Math.max(0, onHand - Math.max(0, committed));
}
// Physical movements need a governed location to count; commitment events never carry one.
const COMMITMENT = new Set(["RESERVED", "RELEASED", "CONSUMED"]);
const t = (type, quantity, extra = {}) => ({
  type,
  quantity,
  ...(COMMITMENT.has(type) ? {} : { location: { type: "WAREHOUSE", locationId: WH } }),
  ...extra,
});

test("governed receipts make a Part with no static baseline reservable", () => {
  // The exact live failure: 0 static baseline, real governed stock.
  assert.equal(availability([t("RECEIVED", 4), t("ADJUSTED", -1)]), 3);
});

test("a warehouse-to-warehouse transfer nets to zero at Part level", () => {
  // This function's contract is warehouse-WIDE availability. A transfer moved stock between
  // locations; it neither created nor destroyed any.
  assert.equal(availability([t("RECEIVED", 4), t("TRANSFER_OUT", 2), t("TRANSFER_IN", 2)]), 4);
});

test("reservations still remove availability", () => {
  assert.equal(availability([t("RECEIVED", 4), t("RESERVED", 3)]), 1);
});

test("releasing a reservation restores availability", () => {
  assert.equal(availability([t("RECEIVED", 4), t("RESERVED", 3), t("RELEASED", 3)]), 4);
});

test("CONSUMED is still NOT subtracted -- it finalizes what RESERVED already removed", () => {
  // The documented invariant this function has always carried. Adding governed types must not
  // quietly start double-counting consumption.
  assert.equal(availability([t("RECEIVED", 5), t("RESERVED", 2), t("CONSUMED", 2)]), 3);
});

// THE TWO STATIC-BASELINE CASES THAT USED TO SIT HERE ARE DELETED, not ported.
// They asserted that a Part's static catalogue `warehouseQty` still produced reservable stock, and
// that governed stock COMPOSED with it (10 static + 5 received − 2 reserved = 13). DECISIONS #165
// retires that: a fixture quantity may not decide a real dispatch. There is no ported equivalent
// because the behaviour they described no longer exists — and keeping them green against a retired
// authority would be worse than having no test at all.

test("NO EVIDENCE IS UNKNOWN, AND UNKNOWN IS NOT ZERO", () => {
  // The case the static baseline used to hide. A part with no physical movement anywhere is a DATA
  // GAP, and the honest answer is "we do not know" — which callers must fail closed on rather than
  // read as "none available" (a claim) or "plenty" (a worse claim).
  assert.equal(availability([]), null);
  // Commitment events alone are not physical evidence: a reservation is a claim ON stock, not proof
  // stock exists. This is what keeps a stray RESERVED row from manufacturing an on-hand answer.
  assert.equal(availability([t("RESERVED", 3)]), null);
});

test("an empty shelf is a DIFFERENT fact from no evidence -- known 0, not UNKNOWN", () => {
  // Evidence exists and nets to zero: a real backorder, and a number we are entitled to state.
  assert.equal(availability([t("RECEIVED", 2), t("TRANSFER_OUT", 2)]), 0);
  // Evidence exists but none of it at an eligible warehouse: also a known 0, never UNKNOWN.
  assert.equal(availability([t("RECEIVED", 5, { location: { type: "WAREHOUSE", locationId: "wh-other" } })]), 0);
});

test("MOBILE/truck stock is not committable warehouse stock", () => {
  // A van's contents are real inventory and deliberately excluded from this pool — counting them
  // is how the same unit gets promised to a second job. Evidence exists, so this is a known 0.
  assert.equal(availability([t("RECEIVED", 4, { location: { type: "MOBILE", locationId: "truck-7" } })]), 0);
});

test("a governed part fully transferred away is not reservable at zero", () => {
  assert.equal(availability([t("RECEIVED", 2), t("TRANSFER_OUT", 2)]), 0);
});

// ---- H7: the ledger sign inversion (sandbox-gap-scan-2026-08-19.md) -------------------------------
//
// A Cycle Count on a SERIAL-tracked Part reconciling a MISSING unit writes "ADJUSTED, quantity: 1"
// (SERIAL quantity is always exactly 1 and cannot carry a negative sign -- there is no "quantity -1 of
// one specific serial", only "this serial is present or it isn't"). Before the fix, that record was
// summed into `governed` exactly like a NONE-mode receipt: discovering a unit MISSING increased its
// reservable availability. The fix (mirroring inventoryLedger/mobileLocationPresenceProbe.ts's
// established `if (v.trackingMode !== "NONE") continue;` precedent) excludes any row whose
// trackingMode is not "NONE" from this quantity sum.

test("H7: a SERIAL-tracked ADJUSTED entry (a cycle count finding a unit missing) must NOT raise availability", () => {
  // A SERIAL part with zero static baseline and a single reconciled-missing-unit ADJUSTED entry.
  // Pre-fix this returned 1 (the missing unit read as +1 reservable stock, the exact inversion H7
  // reports); post-fix it must stay 0 -- SERIAL quantity math is never aggregated here at all.
  assert.equal(availability([t("ADJUSTED", 1, { trackingMode: "SERIAL" })]), 0);
});

test("H7: a SERIAL-tracked ADJUSTED entry does not offset genuine NONE-mode governed stock either", () => {
  const available = availability([t("RECEIVED", 3, { trackingMode: "NONE" }), t("ADJUSTED", 1, { trackingMode: "SERIAL" })]);
  assert.equal(available, 3, "the SERIAL row must be excluded, not merely non-negative -- 3 NONE-mode units stay 3, not 4");
});

test("H7: SERIAL-tracked RECEIVED/TRANSFER_IN/TRANSFER_OUT are excluded from quantity math exactly like ADJUSTED", () => {
  assert.equal(availability([t("RECEIVED", 5, { trackingMode: "SERIAL" })]), 0);
  assert.equal(
    availability([t("RECEIVED", 5, { trackingMode: "NONE" }), t("TRANSFER_OUT", 2, { trackingMode: "SERIAL" })]),
    5,
    "a SERIAL TRANSFER_OUT must not subtract from NONE-mode governed stock"
  );
});

test("H7: NONE-mode ADJUSTED behavior is unchanged -- a reconciled shortage still reduces availability", () => {
  assert.equal(availability([t("RECEIVED", 4, { trackingMode: "NONE" }), t("ADJUSTED", -1, { trackingMode: "NONE" })]), 3);
});

test("H7: a row with NO trackingMode field is treated as NONE (backward-compatible default -- see sumGovernedLedger's header)", () => {
  // trackingMode is a REQUIRED, validated field on every governed operational-movement write, so a row
  // carrying a governed type can never legitimately omit it; this only matters for legacy/pre-field
  // fixtures, and existing behavior (all of the tests above this section) must not regress.
  assert.equal(availability([t("RECEIVED", 4), t("ADJUSTED", -1)]), 3);
});

// ---- H7 secondary finding: RETURNED/SCRAPPED were schema-legal but silently omitted ----------------
//
// transferOrderCommand.ts's computeNoneOnHandThroughTxn, cycleCount/cycleCountExpectedQuantity.ts and
// inventoryLedger/mobileLocationPresenceProbe.ts's probeNoneStockPresentAtLocation all already sum
// RETURNED (+) and SCRAPPED (-). getAvailableQuantity() omitted both entirely -- a governed RMA return
// or a governed scrap-out was invisible to Work Order reservation availability.

test("H7b: RETURNED (RMA) is now counted as a physical receipt, like RECEIVED", () => {
  assert.equal(availability([t("RETURNED", 2, { trackingMode: "NONE" })]), 2);
});

test("H7b: SCRAPPED is now counted as a physical removal, like TRANSFER_OUT", () => {
  assert.equal(availability([t("RECEIVED", 5, { trackingMode: "NONE" }), t("SCRAPPED", 2, { trackingMode: "NONE" })]), 3);
});

test("H7b: a SERIAL-tracked RETURNED/SCRAPPED entry is excluded from quantity math too", () => {
  assert.equal(availability([t("RETURNED", 1, { trackingMode: "SERIAL" })]), 0);
  assert.equal(
    availability([t("RECEIVED", 5, { trackingMode: "NONE" }), t("SCRAPPED", 1, { trackingMode: "SERIAL" })]),
    5
  );
});
