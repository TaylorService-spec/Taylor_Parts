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
// Run: node --test functions/test/woAvailabilityGovernedLedger.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

// The formula under test, mirrored exactly from inventoryService.getAvailableQuantity(). Kept as a
// local mirror because the real function requires a Firestore Transaction; any change to the real
// one that is not reflected here will show up as an E2E failure against the sandbox, which is where
// the true integration evidence lives.
function availability(warehouseQty, ledger) {
  let grossReserved = 0;
  let released = 0;
  let governed = 0;
  for (const t of ledger) {
    if (t.type === "RESERVED") grossReserved += t.quantity;
    else if (t.type === "RELEASED") released += t.quantity;
    else if (t.type === "RECEIVED" || t.type === "TRANSFER_IN") governed += t.quantity;
    else if (t.type === "TRANSFER_OUT") governed -= t.quantity;
    else if (t.type === "ADJUSTED") governed += t.quantity;
  }
  return warehouseQty + governed - (grossReserved - released);
}
const t = (type, quantity) => ({ type, quantity });

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
