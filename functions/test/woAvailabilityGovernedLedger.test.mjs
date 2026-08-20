// Work-Order reservation availability must see GOVERNED stock, not just legacy WO reservations.
//
// THE DEFECT THIS PINS. inventoryService.getAvailableQuantity() computed
//   warehouseQty(STATIC catalog) - (RESERVED - RELEASED)
// and ignored every governed movement type. Receiving, Transfer and reconciled Cycle Counts write
// RECEIVED / TRANSFER_IN / TRANSFER_OUT / ADJUSTED into the SAME append-only ledger, so a Part whose
// stock arrived through the governed path was invisible here.
//
// Live evidence (platform-sandbox, verified before the fix): PRT-1001 held 3 units across wh-main,
// wh-north and a truck; getAvailableQuantity's formula returned 0, so reserveParts() would have
// refused the Work Order with "Insufficient stock: PRT-1001 (need 1, 0 available)". Governed stock
// could be received, transferred and counted -- but never planned against.
//
// This asserts the arithmetic contract directly. reserveParts() itself runs inside a Firestore
// transaction against live collections, so the pure formula is what is cheap and honest to pin here;
// the end-to-end reservation is exercised separately against the sandbox.
//
// H7 UPDATE: `governed` is now computed by the REAL exported sumGovernedLedger() (inventoryService.ts)
// rather than a hand-mirrored copy of its arithmetic -- the previous local mirror was exactly the kind
// of drift risk that let the SERIAL/ADJUSTED sign inversion (H7) go unpinned: the mirror was updated
// when RECEIVED/TRANSFER_IN/TRANSFER_OUT/ADJUSTED were added, but nothing forced it to also gain the
// trackingMode guard when that fix landed in the real function. Only grossReserved/released (legacy
// WO reservation bookkeeping, never touched by H7) remain locally computed here, since
// getAvailableQuantity() does not export that half separately.
//
// Run: node --test functions/test/woAvailabilityGovernedLedger.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { sumGovernedLedger } from "../lib/inventoryService.js";

function availability(warehouseQty, ledger) {
  let grossReserved = 0;
  let released = 0;
  const rows = [];
  for (const t of ledger) {
    if (t.type === "RESERVED") grossReserved += t.quantity;
    else if (t.type === "RELEASED") released += t.quantity;
    else rows.push(t);
  }
  const governed = sumGovernedLedger(rows);
  return warehouseQty + governed - (grossReserved - released);
}
const t = (type, quantity, extra = {}) => ({ type, quantity, ...extra });

test("governed receipts make a Part with no static baseline reservable", () => {
  // The exact live failure: 0 static baseline, real governed stock.
  assert.equal(availability(0, [t("RECEIVED", 4), t("ADJUSTED", -1)]), 3);
});

test("a warehouse-to-warehouse transfer nets to zero at Part level", () => {
  // This function's contract is warehouse-WIDE availability. A transfer moved stock between
  // locations; it neither created nor destroyed any.
  assert.equal(availability(0, [t("RECEIVED", 4), t("TRANSFER_OUT", 2), t("TRANSFER_IN", 2)]), 4);
});

test("reservations still remove availability", () => {
  assert.equal(availability(0, [t("RECEIVED", 4), t("RESERVED", 3)]), 1);
});

test("releasing a reservation restores availability", () => {
  assert.equal(availability(0, [t("RECEIVED", 4), t("RESERVED", 3), t("RELEASED", 3)]), 4);
});

test("CONSUMED is still NOT subtracted -- it finalizes what RESERVED already removed", () => {
  // The documented invariant this function has always carried. Adding governed types must not
  // quietly start double-counting consumption.
  assert.equal(availability(0, [t("RECEIVED", 5), t("RESERVED", 2), t("CONSUMED", 2)]), 3);
});

test("the legacy static-baseline path is unchanged for Parts that use it", () => {
  // A TST-* style Part with a static warehouseQty and only WO activity behaves exactly as before.
  assert.equal(availability(10, [t("RESERVED", 3), t("RELEASED", 1)]), 8);
});

test("governed stock and a static baseline compose rather than replace each other", () => {
  assert.equal(availability(10, [t("RECEIVED", 5), t("RESERVED", 2)]), 13);
});

test("insufficiency is still detected honestly -- no fabricated stock", () => {
  // PRT-1005 in the live sandbox: planned demand exists, no governed stock was ever received.
  const available = availability(0, []);
  assert.equal(available, 0);
  assert.equal(2 > available, true, "a demand of 2 against 0 available must still be insufficient");
});

test("a governed part fully transferred away is not reservable at zero", () => {
  assert.equal(availability(0, [t("RECEIVED", 2), t("TRANSFER_OUT", 2)]), 0);
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
  assert.equal(availability(0, [t("ADJUSTED", 1, { trackingMode: "SERIAL" })]), 0);
});

test("H7: a SERIAL-tracked ADJUSTED entry does not offset genuine NONE-mode governed stock either", () => {
  const available = availability(0, [t("RECEIVED", 3, { trackingMode: "NONE" }), t("ADJUSTED", 1, { trackingMode: "SERIAL" })]);
  assert.equal(available, 3, "the SERIAL row must be excluded, not merely non-negative -- 3 NONE-mode units stay 3, not 4");
});

test("H7: SERIAL-tracked RECEIVED/TRANSFER_IN/TRANSFER_OUT are excluded from quantity math exactly like ADJUSTED", () => {
  assert.equal(availability(0, [t("RECEIVED", 5, { trackingMode: "SERIAL" })]), 0);
  assert.equal(
    availability(0, [t("RECEIVED", 5, { trackingMode: "NONE" }), t("TRANSFER_OUT", 2, { trackingMode: "SERIAL" })]),
    5,
    "a SERIAL TRANSFER_OUT must not subtract from NONE-mode governed stock"
  );
});

test("H7: NONE-mode ADJUSTED behavior is unchanged -- a reconciled shortage still reduces availability", () => {
  assert.equal(availability(0, [t("RECEIVED", 4, { trackingMode: "NONE" }), t("ADJUSTED", -1, { trackingMode: "NONE" })]), 3);
});

test("H7: a row with NO trackingMode field is treated as NONE (backward-compatible default -- see sumGovernedLedger's header)", () => {
  // trackingMode is a REQUIRED, validated field on every governed operational-movement write, so a row
  // carrying a governed type can never legitimately omit it; this only matters for legacy/pre-field
  // fixtures, and existing behavior (all of the tests above this section) must not regress.
  assert.equal(availability(0, [t("RECEIVED", 4), t("ADJUSTED", -1)]), 3);
});

// ---- H7 secondary finding: RETURNED/SCRAPPED were schema-legal but silently omitted ----------------
//
// transferOrderCommand.ts's computeNoneOnHandThroughTxn, cycleCount/cycleCountExpectedQuantity.ts and
// inventoryLedger/mobileLocationPresenceProbe.ts's probeNoneStockPresentAtLocation all already sum
// RETURNED (+) and SCRAPPED (-). getAvailableQuantity() omitted both entirely -- a governed RMA return
// or a governed scrap-out was invisible to Work Order reservation availability.

test("H7b: RETURNED (RMA) is now counted as a physical receipt, like RECEIVED", () => {
  assert.equal(availability(0, [t("RETURNED", 2, { trackingMode: "NONE" })]), 2);
});

test("H7b: SCRAPPED is now counted as a physical removal, like TRANSFER_OUT", () => {
  assert.equal(availability(0, [t("RECEIVED", 5, { trackingMode: "NONE" }), t("SCRAPPED", 2, { trackingMode: "NONE" })]), 3);
});

test("H7b: a SERIAL-tracked RETURNED/SCRAPPED entry is excluded from quantity math too", () => {
  assert.equal(availability(0, [t("RETURNED", 1, { trackingMode: "SERIAL" })]), 0);
  assert.equal(
    availability(0, [t("RECEIVED", 5, { trackingMode: "NONE" }), t("SCRAPPED", 1, { trackingMode: "SERIAL" })]),
    5
  );
});
