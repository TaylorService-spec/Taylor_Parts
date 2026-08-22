// PART BALANCE — the shared governed balance read. Pure over injected rows: no emulator, no
// Firestore, no network.
// Run: node --test test/partBalanceReadService.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  composePartBalance,
  sumOpenOrderedQuantity,
  OPEN_PURCHASE_ORDER_STATUSES,
} from "../lib/inventory/partBalanceReadService.js";

const WH = "WH-1";
const eligible = new Set([WH]);
const at = (locationId) => ({ type: "WAREHOUSE", locationId });

const received = (quantity, locationId = WH) => ({ type: "RECEIVED", quantity, location: at(locationId), trackingMode: "NONE" });
const reservedRow = (quantity, workOrderId = "WO-1") => ({ type: "RESERVED", quantity, workOrderId });

const balance = (over = {}) => composePartBalance({
  partId: "PRT-1001",
  ledgerRows: [],
  eligibleWarehouseIds: eligible,
  openOrderedQuantity: null,
  serialTracked: false,
  ...over,
});

// ─────────────────────────────────────────── UNKNOWN is not zero

test("a part with NO movement evidence is UNKNOWN on hand — never zero", () => {
  // The whole point. A part nobody has ever received has an unknown shelf state; reporting 0 would
  // let a sale be refused for stock that may well be sitting there unrecorded.
  const r = balance();
  assert.equal(r.onHand.state, "UNKNOWN");
  assert.equal(r.onHand.value, null);
});

test("evidence that nets to zero is a KNOWN zero — a real, empty shelf", () => {
  const r = balance({ ledgerRows: [received(5), { type: "TRANSFER_OUT", quantity: 5, location: at(WH), trackingMode: "NONE" }] });
  assert.equal(r.onHand.state, "KNOWN");
  assert.equal(r.onHand.value, 0);
});

test("UNKNOWN on hand makes AVAILABLE unknown too — it does not leak out as a number", () => {
  // Subtracting a known reservation from an unknown on-hand cannot produce a trustworthy answer.
  const r = balance({ ledgerRows: [reservedRow(3)] });
  assert.equal(r.onHand.state, "UNKNOWN");
  assert.equal(r.available.state, "UNKNOWN");
  assert.equal(r.available.value, null);
});

test("no reservation evidence is a KNOWN zero, unlike on hand", () => {
  // The reservation ledger is written on every reservation, so its silence genuinely means none.
  // On-hand silence means the part was never received anywhere, which is a different fact.
  const r = balance({ ledgerRows: [received(4)] });
  assert.equal(r.reserved.state, "KNOWN");
  assert.equal(r.reserved.value, 0);
});

// ─────────────────────────────────────────── the arithmetic

test("available is on hand minus open reservations, floored at zero", () => {
  const r = balance({ ledgerRows: [received(10), reservedRow(4)] });
  assert.equal(r.onHand.value, 10);
  assert.equal(r.reserved.value, 4);
  assert.equal(r.available.value, 6);
});

test("over-reservation floors available at zero rather than going negative", () => {
  const r = balance({ ledgerRows: [received(2), reservedRow(9)] });
  assert.equal(r.available.value, 0);
});

test("RELEASED and CONSUMED reduce the open reservation", () => {
  const r = balance({ ledgerRows: [received(10), reservedRow(5), { type: "CONSUMED", quantity: 2, workOrderId: "WO-1" }] });
  assert.equal(r.reserved.value, 3);
  assert.equal(r.available.value, 7);
});

test("stock at an INELIGIBLE warehouse is excluded from on hand", () => {
  const r = balance({ ledgerRows: [received(7, "WH-CLOSED")] });
  assert.equal(r.onHand.value, 0, "evidence exists, but none of it is sellable");
  assert.equal(r.onHand.state, "KNOWN");
});

// ─────────────────────────────────────────── serialized parts

test("a SERIAL part reports NOT_COUNTED_BY_QUANTITY, not a fabricated zero", () => {
  // sumLedgerEligibleOnHand deliberately excludes serial rows from quantity math, so reporting its
  // output as "on hand" would show a confident 0 for a shelf that is full.
  const r = balance({ serialTracked: true, ledgerRows: [{ type: "RECEIVED", quantity: 1, location: at(WH), trackingMode: "SERIAL" }] });
  for (const key of ["onHand", "reserved", "available"]) {
    assert.equal(r[key].state, "NOT_COUNTED_BY_QUANTITY", `${key} must not claim a quantity`);
    assert.equal(r[key].value, null);
  }
});

test("a SERIAL part still reports ON ORDER, which IS a quantity", () => {
  const r = balance({ serialTracked: true, openOrderedQuantity: 4 });
  assert.equal(r.onOrder.state, "KNOWN");
  assert.equal(r.onOrder.value, 4);
});

test("a SERIAL part has no per-location quantity breakdown", () => {
  const r = balance({ serialTracked: true, ledgerRows: [{ type: "RECEIVED", quantity: 1, location: at(WH), trackingMode: "SERIAL" }] });
  assert.deepEqual(r.byLocation, []);
});

// ─────────────────────────────────────────── the breakdown adds up

test("the per-location breakdown SUMS to the total, because it is the same function", () => {
  const r = composePartBalance({
    partId: "PRT-1001",
    ledgerRows: [received(6, "WH-1"), received(4, "WH-2"), { type: "TRANSFER_OUT", quantity: 1, location: at("WH-2"), trackingMode: "NONE" }],
    eligibleWarehouseIds: new Set(["WH-1", "WH-2"]),
    openOrderedQuantity: null,
    serialTracked: false,
  });
  assert.equal(r.onHand.value, 9);
  assert.equal(r.byLocation.reduce((n, l) => n + l.quantity, 0), 9);
});

test("the breakdown is ordered by quantity and omits warehouses holding nothing", () => {
  const r = composePartBalance({
    partId: "PRT-1001",
    ledgerRows: [received(2, "WH-1"), received(9, "WH-2")],
    eligibleWarehouseIds: new Set(["WH-1", "WH-2", "WH-EMPTY"]),
    openOrderedQuantity: null,
    serialTracked: false,
  });
  assert.deepEqual(r.byLocation.map((l) => l.locationId), ["WH-2", "WH-1"]);
  assert.equal(r.byLocation.some((l) => l.locationId === "WH-EMPTY"), false, "nothing there is not a fact about this part");
});

// ─────────────────────────────────────────── on order

test("a part on no purchase order at all is UNKNOWN on order, not zero", () => {
  assert.equal(sumOpenOrderedQuantity([], "PRT-1001"), null);
  assert.equal(sumOpenOrderedQuantity([{ lines: [{ partId: "OTHER", quantity: 5 }] }], "PRT-1001"), null);
});

test("a part on fully received orders is a KNOWN zero", () => {
  const v = sumOpenOrderedQuantity([{ lines: [{ partId: "PRT-1001", quantity: 5, receivedQuantity: 5 }] }], "PRT-1001");
  assert.equal(v, 0);
});

test("outstanding quantity is ordered minus received, across lines and orders", () => {
  const v = sumOpenOrderedQuantity([
    { lines: [{ partId: "PRT-1001", quantity: 10, receivedQuantity: 3 }] },
    { lines: [{ partId: "PRT-1001", quantity: 4 }, { partId: "OTHER", quantity: 99 }] },
  ], "PRT-1001");
  assert.equal(v, 11);
});

test("the LEGACY single-line purchase order shape is read too", () => {
  // Both shapes exist in stored data; neither is normalized into the other here.
  assert.equal(sumOpenOrderedQuantity([{ partId: "PRT-1001", quantity: 6, receivedQuantity: 2 }], "PRT-1001"), 4);
});

test("a line with NO stated quantity contributes nothing rather than a guess", () => {
  const v = sumOpenOrderedQuantity([{ lines: [{ partId: "PRT-1001" }, { partId: "PRT-1001", quantity: 3 }] }], "PRT-1001");
  assert.equal(v, 3);
});

test("over-receipt never produces a negative outstanding", () => {
  assert.equal(sumOpenOrderedQuantity([{ lines: [{ partId: "PRT-1001", quantity: 5, receivedQuantity: 8 }] }], "PRT-1001"), 0);
});

test("only genuinely open purchase order statuses are counted as incoming", () => {
  for (const closed of ["RECEIVED", "CANCELLED", "CLOSED"]) {
    assert.equal(OPEN_PURCHASE_ORDER_STATUSES.includes(closed), false, `${closed} is not still incoming`);
  }
  assert.ok(OPEN_PURCHASE_ORDER_STATUSES.includes("SENT"));
});

// ─────────────────────────────────────────── no fourth on-hand implementation

test("the service does NOT reimplement on-hand or reservation math", () => {
  const src = readFileSync(new URL("../src/inventory/partBalanceReadService.ts", import.meta.url), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  // It must go through the ratified functions...
  assert.match(code, /sumLedgerEligibleOnHand/);
  assert.match(code, /openWorkOrderReserved/);
  // ...and must not restate their vocabulary itself. This platform has already been bitten once by
  // two sources of stock truth diverging in both directions.
  assert.doesNotMatch(code, /"TRANSFER_IN"|"SCRAPPED"|"ADJUSTED"/, "movement-type math belongs to the ratified function");
});

test("it never writes: no transaction, no set/update/delete, no command import", () => {
  const src = readFileSync(new URL("../src/inventory/partBalanceReadService.ts", import.meta.url), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  for (const forbidden of [/runTransaction/, /\.set\(/, /\.update\(/, /\.delete\(/, /Command/]) {
    assert.doesNotMatch(code, forbidden, `a balance read must never ${forbidden}`);
  }
});

test("results are frozen — a caller cannot turn UNKNOWN into a number", () => {
  const r = balance();
  assert.throws(() => { r.onHand = { state: "KNOWN", value: 99 }; }, TypeError);
});

// ─────────────────────────────── the STORED canonical shape, not the normalized one
//
// Every case above hand-builds `{ lines: [...] }` -- the shape normalizeCanonicalPurchaseOrder
// PRODUCES, never the shape Firestore HOLDS. readPartBalance passes raw stored documents straight
// through, and a stored canonical purchase order has `items`.
//
// So this function returned null for every canonical order and `onOrder` could not see one of
// them, while this suite stayed green: the arithmetic was always right and the field was never
// found. A test built from a shape that does not occur in storage can be thorough, correct, and
// describe a world the database does not contain.

test("a REAL stored canonical purchase order is read from its `items`", () => {
  // Copied from an actual emulator document, keys and all.
  const stored = {
    id: "po-abc123",
    supplierId: "cw-sup-001",
    status: "SENT",
    items: [{ lineId: "L1", partId: "CW-P-0003", quantity: 18, unitPrice: 17.5 }],
    version: 3,
    totalCost: 315,
  };
  assert.equal(sumOpenOrderedQuantity([stored], "CW-P-0003"), 18);
  assert.equal(sumOpenOrderedQuantity([stored], "CW-P-9999"), null, "a part not on the order is still UNKNOWN");
});

test("a purchase order carrying BOTH shapes is counted once, not twice", () => {
  // Never unioned. If both were read, an order in mid-migration would silently double its
  // outstanding quantity -- and an overstated inbound figure is the one that makes a shortage
  // look handled.
  const both = {
    status: "SENT",
    lines: [{ partId: "CW-P-0003", quantity: 5 }],
    items: [{ partId: "CW-P-0003", quantity: 5 }],
  };
  assert.equal(sumOpenOrderedQuantity([both], "CW-P-0003"), 5);
});

test("an order with neither shape stays UNKNOWN rather than inventing zero", () => {
  // Absence of a readable line list is not evidence that nothing is on order.
  assert.equal(sumOpenOrderedQuantity([{ id: "po-1", status: "SENT" }], "CW-P-0003"), null);
  assert.equal(sumOpenOrderedQuantity([{ id: "po-1", status: "SENT", items: [] }], "CW-P-0003"), null);
});

test("KNOWN GAP: canonical outstanding does not yet net committed receipts", () => {
  // Recorded deliberately, as current behaviour rather than as an aspiration.
  //
  // A LEGACY order carries receivedQuantity on the document, so its outstanding shrinks as goods
  // arrive. A CANONICAL order does not: the receipt command writes only version/updatedAt/status,
  // and received quantity is DERIVED from committed receipts by deriveReceiptState -- which this
  // function never sees.
  //
  // So after a partial receipt a canonical order still reports its FULL ordered quantity as
  // inbound. This assertion documents that, so a future change that fixes it fails here and is
  // noticed, instead of quietly altering every onOrder figure.
  const canonicalAfterPartialReceipt = {
    status: "SENT",
    items: [{ lineId: "L1", partId: "CW-P-0003", quantity: 18 }],   // 9 already received elsewhere
  };
  assert.equal(sumOpenOrderedQuantity([canonicalAfterPartialReceipt], "CW-P-0003"), 18,
    "if this now returns 9, receipts are being netted -- update this test and the assessment doc");
  // The legacy shape, by contrast, does net -- because the quantity is ON the document.
  assert.equal(sumOpenOrderedQuantity([{ partId: "CW-P-0003", quantity: 18, receivedQuantity: 9 }], "CW-P-0003"), 9);
});
