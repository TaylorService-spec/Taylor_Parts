// Part-level on-hand must reflect GOVERNED ledger movement, not just legacy WO reservations.
//
// THE DEFECT THIS PINS. computeAvailableStockByPart understood only RESERVED/RELEASED and took its
// baseline from the static catalog's warehouseQty. A governed Part has no static row, so its baseline
// was 0 and none of its real movements counted at all.
//
// Live evidence (platform-sandbox): PRT-2001 had two RECEIVED units in inventory_transactions and the
// Parts Catalog displayed "0"; PRT-1001 displayed "0" while actually holding 3 units across wh-main,
// wh-north and a truck. Receiving, Transfer and Cycle Count all wrote correct, verified ledger
// evidence that the Part-side projection then ignored.
//
// This contradicted the documented authority: the inventory_transactions ledger is the source of
// truth for stock movement; the static catalog is only a baseline.
//
// Run: npx vitest run test/onHandGovernedLedger.test.jsx
import { describe, it, expect } from "vitest";
import { computeAvailableStockByPart } from "../src/domain/inventoryAnalyticsEngine";

let seq = 0;
const tx = (partId, type, quantity) => ({
  id: `t${(seq += 1)}`, workOrderId: "", partId, type, quantity, timestamp: seq,
});
const avail = (rows) => computeAvailableStockByPart(rows);

// A governed part id deliberately absent from the static catalog -- baseline 0, exactly like PRT-*.
const GOV = "PRT-9001";

describe("Part-level on-hand from the governed ledger", () => {
  it("RECEIVED units count toward on-hand for a Part with no static baseline", () => {
  // The live PRT-2001 case: two serial receipts of one unit each.
  const m = avail([tx(GOV, "RECEIVED", 1), tx(GOV, "RECEIVED", 1)]);
  expect(m.get(GOV)).toBe(2);
});

  it("a transfer moves stock without inventing or destroying it", () => {
  // Part-level availability sums across locations, so a completed transfer nets to zero change.
  const m = avail([tx(GOV, "RECEIVED", 4), tx(GOV, "TRANSFER_OUT", 2), tx(GOV, "TRANSFER_IN", 2)]);
  expect(m.get(GOV)).toBe(4);
});

  it("a reconciled Cycle Count adjustment is applied with its sign", () => {
  // ADJUSTED already carries the signed correction (negative when the count came up short).
  const m = avail([tx(GOV, "RECEIVED", 4), tx(GOV, "ADJUSTED", -1)]);
  expect(m.get(GOV)).toBe(3);
});

  it("the exact live sandbox sequence reproduces the ledger-derived total", () => {
  // Receiving 4, transfer 2 out and back in across locations, then a -1 cycle-count adjustment.
  const m = avail([
    tx("PRT-1001", "RECEIVED", 4),
    tx("PRT-1001", "TRANSFER_OUT", 2),
    tx("PRT-1001", "TRANSFER_IN", 2),
    tx("PRT-1001", "ADJUSTED", -1),
  ]);
  expect(m.get("PRT-1001")).toBe(3);
});

  it("legacy Work-Order reservation arithmetic is unchanged", () => {
  // Parts with only WO activity must behave exactly as before this change.
  const m = avail([tx(GOV, "RESERVED", 3), tx(GOV, "RELEASED", 1)]);
  expect(m.get(GOV)).toBe(-2);
});

  it("governed movement and legacy reservations compose", () => {
  const m = avail([tx(GOV, "RECEIVED", 10), tx(GOV, "RESERVED", 3), tx(GOV, "RELEASED", 1)]);
  expect(m.get(GOV)).toBe(8);
});

  it("CONSUMED is not double-counted as a governed movement", () => {
  // CONSUMED belongs to the legacy WO vocabulary and has never contributed here; adding governed
  // types must not silently give it a new meaning.
  const m = avail([tx(GOV, "RECEIVED", 5), tx(GOV, "CONSUMED", 2)]);
  expect(m.get(GOV)).toBe(5);
});

  it("a Part with no ledger activity is not fabricated into existence", () => {
  const m = avail([tx(GOV, "RECEIVED", 1)]);
  expect(m.has("PRT-DOES-NOT-EXIST")).toBe(false);
});
});
