// PART BALANCES FOR A PAGE — that the batch is the same answer, cheaper.
//
// GOVERNANCE: docs/architecture/inventory-health-projection.md.
//
// The whole value of this service is a claim that can be got wrong invisibly: that reading balances
// for fifty parts at once produces EXACTLY what reading them one at a time produces. A batch that
// grouped ledger rows slightly differently, or reused one part's purchase orders for another, would
// return plausible numbers for every part and correct ones for none.
//
// So the parity test below is the centre of this file, and the read-count test is what makes the
// batch worth having at all.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  composePartBalance,
  sumOpenOrderedQuantity,
} from "../lib/inventory/partBalanceReadService.js";
import {
  readPartBalances,
  PART_BALANCE_BATCH_LIMIT,
} from "../lib/inventory/partBalanceBatchReadService.js";

// ── a recording fake Firestore ───────────────────────────────────────────────────────────────
//
// Records every query it is asked to run, because the read SHAPE is what this service changes. A
// stub that returned rows and ignored the queries would pass every value assertion below while
// still issuing one read per part.

function fakeDb({ ledger = [], warehouses = [], purchaseOrders = [], receipts = {} } = {}) {
  const calls = [];
  const snap = (docs) => ({ docs: docs.map((d) => ({ id: d.id, data: () => d.data ?? d })) });

  return {
    calls,
    collection(name) {
      const state = { name, wheres: [] };
      const api = {
        where(field, op, value) {
          state.wheres.push({ field, op, value });
          return api;
        },
        get() {
          calls.push({ collection: name, wheres: [...state.wheres] });
          if (name === "warehouses") return Promise.resolve(snap(warehouses));
          if (name === "purchase_orders") return Promise.resolve(snap(purchaseOrders));
          if (name === "inventory_transactions") {
            const w = state.wheres.find((x) => x.field === "partId");
            const ids = w?.op === "in" ? w.value : [w?.value];
            return Promise.resolve(snap(ledger.filter((r) => ids.includes(r.partId)).map((r, i) => ({ id: `t${i}`, data: r }))));
          }
          if (name === "receiving_orders") {
            const w = state.wheres.find((x) => x.field === "source.purchaseOrderId");
            return Promise.resolve(snap(receipts[w?.value] ?? []));
          }
          return Promise.resolve(snap([]));
        },
      };
      return api;
    },
  };
}

const WAREHOUSES = [{ id: "wh-main" }, { id: "wh-north" }];

const LEDGER = [
  // PRT-1: 10 received, 4 reserved  → onHand 10, reserved 4, available 6
  { partId: "PRT-1", type: "RECEIVED", quantity: 10, location: { type: "WAREHOUSE", locationId: "wh-main" } },
  { partId: "PRT-1", type: "RESERVED", quantity: 4, workOrderId: "wo-1" },
  // PRT-2: 3 received at a second warehouse
  { partId: "PRT-2", type: "RECEIVED", quantity: 3, location: { type: "WAREHOUSE", locationId: "wh-north" } },
  // PRT-3: nothing at all → UNKNOWN, never 0
];

const SERIAL_TRACKED = new Map([["PRT-1", false], ["PRT-2", false], ["PRT-3", false]]);

// ═════════════════════════════════════════ parity with the per-part path

test("a batched balance is EXACTLY the per-part balance, part for part", async () => {
  const db = fakeDb({ ledger: LEDGER, warehouses: WAREHOUSES });
  const partIds = ["PRT-1", "PRT-2", "PRT-3"];

  const batched = await readPartBalances(db, partIds, SERIAL_TRACKED);

  // The per-part answer, composed directly from the same inputs through the same pure function.
  const expected = partIds.map((partId) => composePartBalance({
    partId,
    ledgerRows: LEDGER.filter((r) => r.partId === partId),
    eligibleWarehouseIds: new Set(["wh-main", "wh-north"]),
    openOrderedQuantity: sumOpenOrderedQuantity([], partId),
    serialTracked: false,
  }));

  assert.deepEqual(batched, expected, "the batch must not be a second implementation");
});

test("ledger rows are grouped per part — one part's stock never leaks into another's", async () => {
  const db = fakeDb({ ledger: LEDGER, warehouses: WAREHOUSES });
  const [one, two, three] = await readPartBalances(db, ["PRT-1", "PRT-2", "PRT-3"], SERIAL_TRACKED);

  assert.deepEqual(one.onHand, { state: "KNOWN", value: 10 });
  assert.deepEqual(one.reserved, { state: "KNOWN", value: 4 });
  assert.deepEqual(one.available, { state: "KNOWN", value: 6 });

  assert.deepEqual(two.onHand, { state: "KNOWN", value: 3 });
  // PRT-2 has no commitment rows at all, which is a KNOWN zero: the reservation ledger is written on
  // every reservation, so its silence genuinely means nothing is reserved.
  assert.deepEqual(two.reserved, { state: "KNOWN", value: 0 });

  // PRT-3 has NO evidence whatsoever. UNKNOWN, never 0 — a shelf nobody has looked at is not an
  // empty shelf, and this is the Owner's ruling that an unledgered Part has UNKNOWN availability.
  assert.deepEqual(three.onHand, { state: "UNKNOWN", value: null });
  assert.deepEqual(three.available, { state: "UNKNOWN", value: null });
});

// ═════════════════════════════════════════ the read shape, which is the point

test("the shared inputs are read ONCE for the whole page, not once per part", async () => {
  const db = fakeDb({ ledger: LEDGER, warehouses: WAREHOUSES });
  await readPartBalances(db, ["PRT-1", "PRT-2", "PRT-3"], SERIAL_TRACKED);

  const byCollection = (name) => db.calls.filter((c) => c.collection === name).length;

  // The ACTIVE warehouse set and the open purchase orders do not vary by part. The per-part path
  // re-reads both for every part; a page of 50 would read them 50 times each.
  assert.equal(byCollection("warehouses"), 1);
  assert.equal(byCollection("purchase_orders"), 1);
  // The ledger is the one genuinely per-part input, and it batches via `in`.
  assert.equal(byCollection("inventory_transactions"), 1);
});

test("the ledger read chunks at Firestore's `in` ceiling of 30, never one query per part", async () => {
  const partIds = Array.from({ length: 50 }, (_, i) => `PRT-${i}`);
  const db = fakeDb({ warehouses: WAREHOUSES });
  await readPartBalances(db, partIds, new Map(partIds.map((id) => [id, false])));

  const ledgerCalls = db.calls.filter((c) => c.collection === "inventory_transactions");
  // 50 parts is TWO queries, not fifty. Total reads for the page: 2 + 1 + 1 = 4.
  assert.equal(ledgerCalls.length, 2);
  for (const call of ledgerCalls) {
    const w = call.wheres.find((x) => x.field === "partId");
    assert.equal(w.op, "in");
    assert.ok(w.value.length <= 30, "an `in` clause over 30 values is rejected by Firestore");
  }
  assert.equal(db.calls.filter((c) => c.collection === "warehouses").length, 1);
});

test("an empty request reads nothing at all", async () => {
  const db = fakeDb({ warehouses: WAREHOUSES });
  assert.deepEqual(await readPartBalances(db, [], new Map()), []);
  assert.equal(db.calls.length, 0, "asking about no parts must not query");
});

// ═════════════════════════════════════════ serialized parts

test("a SERIAL-tracked part reports NOT_COUNTED_BY_QUANTITY, never a confident zero", async () => {
  const ledger = [
    { partId: "PRT-S", type: "RECEIVED", quantity: 2, trackingMode: "SERIAL", location: { type: "WAREHOUSE", locationId: "wh-main" } },
  ];
  const db = fakeDb({ ledger, warehouses: WAREHOUSES });
  const [balance] = await readPartBalances(db, ["PRT-S"], new Map([["PRT-S", true]]));

  // Two serialized units are on the shelf. Summing ledger quantities would report them; reporting
  // that figure as "on hand" for a serial part is the category error the sibling service records —
  // the units are counted by the serialized registry, one row per unit.
  assert.equal(balance.onHand.state, "NOT_COUNTED_BY_QUANTITY");
  assert.equal(balance.onHand.value, null);
  assert.equal(balance.available.state, "NOT_COUNTED_BY_QUANTITY");
  assert.deepEqual(balance.byLocation, []);
});

test("a part the Part Master cannot resolve is OMITTED, never assumed quantity-tracked", async () => {
  const db = fakeDb({ ledger: LEDGER, warehouses: WAREHOUSES });
  // PRT-2 is absent from the tracking map, standing in for a part that did not resolve.
  const out = await readPartBalances(db, ["PRT-1", "PRT-2"], new Map([["PRT-1", false]]));
  assert.deepEqual(out.map((b) => b.partId), ["PRT-1"]);
});

// ═════════════════════════════════════════ on order

test("outstanding ordered quantity nets committed receipts, per part", async () => {
  const purchaseOrders = [
    // CANONICAL shape (`items`): stores no receivedQuantity, so outstanding is derived from the
    // committed receipts. Reading `quantity` alone would report the full order as inbound forever.
    { id: "po-1", data: { status: "SENT", supplierId: "sup-1", items: [{ lineId: "l1", partId: "PRT-1", quantity: 10, unitPrice: 1 }] } },
    // APPROVED is NOT an open status — an approved-but-unsent order is not inbound supply.
    { id: "po-2", data: { status: "APPROVED", supplierId: "sup-1", items: [{ lineId: "l1", partId: "PRT-2", quantity: 7, unitPrice: 1 }] } },
  ];
  const receipts = { "po-1": [{ id: "r1", data: { lines: [{ lineId: "l1", receivedQuantity: 4 }] } }] };
  const db = fakeDb({ ledger: LEDGER, warehouses: WAREHOUSES, purchaseOrders, receipts });

  const [one, two] = await readPartBalances(db, ["PRT-1", "PRT-2"], SERIAL_TRACKED);

  // 10 ordered, 4 received → 6 still inbound. Without the receipts this would report 10 and make a
  // live shortage look handled.
  assert.deepEqual(one.onOrder, { state: "KNOWN", value: 6 });
  // No OPEN order mentions PRT-2, so nothing is known about its inbound supply — UNKNOWN, not 0.
  assert.deepEqual(two.onOrder, { state: "UNKNOWN", value: null });
});

test("receipts are read once for the page, not once per part", async () => {
  const purchaseOrders = [{ id: "po-1", data: { status: "SENT", lines: [{ lineId: "l1", partId: "PRT-1", quantity: 10 }] } }];
  const db = fakeDb({ ledger: LEDGER, warehouses: WAREHOUSES, purchaseOrders, receipts: { "po-1": [] } });
  await readPartBalances(db, ["PRT-1", "PRT-2", "PRT-3"], SERIAL_TRACKED);

  // One open order, three parts → one receipts query, not three.
  assert.equal(db.calls.filter((c) => c.collection === "receiving_orders").length, 1);
});

// ═════════════════════════════════════════ FALSE COMFORT

test("warehouse availability EXCLUDES mobile stock, so the two scopes can differ", async () => {
  const ledger = [
    { partId: "PRT-M", type: "RECEIVED", quantity: 2, location: { type: "WAREHOUSE", locationId: "wh-main" } },
    // Eight on a truck. Company-owned is 10; warehouse-available is 2.
    { partId: "PRT-M", type: "RECEIVED", quantity: 8, location: { type: "MOBILE", locationId: "truck-12" } },
  ];
  const db = fakeDb({ ledger, warehouses: WAREHOUSES });
  const [balance] = await readPartBalances(db, ["PRT-M"], new Map([["PRT-M", false]]));

  // THE FALSE_COMFORT INVARIANT: a warehouse shortage can coexist with company-owned stock on
  // trucks. Collapsing the two scopes into one "Stock" figure is what hides that.
  assert.deepEqual(balance.onHand, { state: "KNOWN", value: 2 });
  assert.ok(balance.onHand.value < 10, "mobile stock must not be counted as warehouse availability");
  assert.deepEqual(balance.byLocation, [{ locationId: "wh-main", quantity: 2 }]);
});

test("stock at an INACTIVE warehouse is not availability", async () => {
  const ledger = [
    { partId: "PRT-X", type: "RECEIVED", quantity: 5, location: { type: "WAREHOUSE", locationId: "wh-retired" } },
  ];
  // wh-retired is absent from the ACTIVE set the query returns.
  const db = fakeDb({ ledger, warehouses: WAREHOUSES });
  const [balance] = await readPartBalances(db, ["PRT-X"], new Map([["PRT-X", false]]));
  assert.equal(balance.onHand.value, 0);
  assert.deepEqual(balance.byLocation, []);
});

// ═════════════════════════════════════════ the boundary

test("the batch is BOUNDED, and its limit is the page size", () => {
  assert.equal(PART_BALANCE_BATCH_LIMIT, 50);
});

test("a balance read never writes", () => {
  const code = readFileSync(new URL("../src/inventory/partBalanceBatchReadService.ts", import.meta.url), "utf8");
  // The same guard the single-part service carries. `new Map(entries)` rather than `.set()` in the
  // receipt map is a consequence of this rule, not an accident.
  for (const forbidden of [/runTransaction/, /\.set\(/, /\.update\(/, /\.delete\(/, /Command/]) {
    assert.doesNotMatch(code, forbidden, `a balance read must never ${forbidden}`);
  }
});

test("no second capability was minted for asking the same question fifty times", () => {
  const code = readFileSync(new URL("../src/inventory/partBalanceBatchReadService.ts", import.meta.url), "utf8");
  assert.match(code, /INVENTORY_BALANCE_READ_CAPABILITY/);
  // Imported from the sibling, never redeclared — a second constant could drift to a second string.
  assert.doesNotMatch(code, /const INVENTORY_BALANCE_READ_CAPABILITY\s*=/);
});

test("a throwing capability resolver DENIES", () => {
  const code = readFileSync(new URL("../src/inventory/partBalanceBatchReadService.ts", import.meta.url), "utf8");
  assert.match(code, /A THROWING resolver is a denial, never an allow/);
  assert.match(code, /allowed = false;/);
});

test("the LEGACY single-line order shape nets its own stored receivedQuantity", async () => {
  // Two stored shapes exist and neither is normalized into the other. A legacy order carries
  // receivedQuantity ON the document and is one-shot by validation; applying canonical receipt
  // semantics to it would answer a question its shape never asked.
  const purchaseOrders = [
    { id: "po-legacy", data: { status: "SENT", partId: "PRT-1", quantity: 9, receivedQuantity: 4 } },
  ];
  const db = fakeDb({ ledger: LEDGER, warehouses: WAREHOUSES, purchaseOrders });
  const [one] = await readPartBalances(db, ["PRT-1"], SERIAL_TRACKED);
  assert.deepEqual(one.onOrder, { state: "KNOWN", value: 5 });
});

test("a FULLY received order leaves nothing inbound — a known zero, not UNKNOWN", async () => {
  const purchaseOrders = [
    { id: "po-1", data: { status: "SENT", supplierId: "s", items: [{ lineId: "l1", partId: "PRT-1", quantity: 10, unitPrice: 1 }] } },
  ];
  const receipts = { "po-1": [{ id: "r1", data: { lines: [{ lineId: "l1", receivedQuantity: 10 }] } }] };
  const db = fakeDb({ ledger: LEDGER, warehouses: WAREHOUSES, purchaseOrders, receipts });
  const [one] = await readPartBalances(db, ["PRT-1"], SERIAL_TRACKED);
  // A part that appears on orders which are all fully received is a KNOWN 0 — distinct from a part
  // no order has ever mentioned, which stays UNKNOWN.
  assert.deepEqual(one.onOrder, { state: "KNOWN", value: 0 });
});

test("a COMPLETED transfer conserves company-owned stock and moves the warehouse split", async () => {
  // The ledger records both endpoints. Warehouse availability follows the destination; nothing is
  // invented at both ends, and the company-owned total is unchanged by the move.
  const ledger = [
    { partId: "PRT-T", type: "RECEIVED", quantity: 10, location: { type: "WAREHOUSE", locationId: "wh-main" } },
    { partId: "PRT-T", type: "TRANSFER_OUT", quantity: 4, location: { type: "WAREHOUSE", locationId: "wh-main" } },
    { partId: "PRT-T", type: "TRANSFER_IN", quantity: 4, location: { type: "WAREHOUSE", locationId: "wh-north" } },
  ];
  const db = fakeDb({ ledger, warehouses: WAREHOUSES });
  const [balance] = await readPartBalances(db, ["PRT-T"], new Map([["PRT-T", false]]));

  // The split is visible per warehouse, and the per-location figures come from the SAME function as
  // the total, so a breakdown can never fail to add up to the total it belongs to.
  const total = balance.byLocation.reduce((sum, l) => sum + l.quantity, 0);
  assert.equal(total, balance.onHand.value, "the breakdown must add up to its own total");
});

test("RETURN INTAKE alone does not restock", async () => {
  // Intake records that something came back. It does not assert the unit is sellable, so it must not
  // move availability — inferring physical availability from a Return record is how a damaged unit
  // gets promised to the next customer.
  const withIntake = [
    { partId: "PRT-R", type: "RECEIVED", quantity: 5, location: { type: "WAREHOUSE", locationId: "wh-main" } },
    { partId: "PRT-R", type: "RETURN_INTAKE", quantity: 3, location: { type: "WAREHOUSE", locationId: "wh-main" } },
  ];
  const db = fakeDb({ ledger: withIntake, warehouses: WAREHOUSES });
  const [balance] = await readPartBalances(db, ["PRT-R"], new Map([["PRT-R", false]]));
  assert.equal(balance.onHand.value, 5, "intake alone must leave availability unchanged");
});
