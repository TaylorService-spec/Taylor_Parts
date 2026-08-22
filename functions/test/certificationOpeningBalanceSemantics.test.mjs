// OPENING BALANCES ARE NOT RECEIPTS.
//
// ============================ WHAT THIS PROTECTS ============================
//
// For the whole of Passes 1 and 2A, the world's initial stock was written as 32 `RECEIVED`
// movements naming `cw-seed-<partId>` receiving orders that were never created. Every balance was
// right. Every test passed. The ledger validated it, because the validator checks that a source was
// NAMED, not that it exists.
//
// What was wrong was the CLAIM: that thirty-two deliveries arrived from a supplier. Nothing in the
// system contradicted it, and the first thing that would have — a report counting receipts by month
// — does not exist yet. By the time Reporting V1 asks "how much did we receive in January?", the
// answer would have been confidently, invisibly wrong.
//
// So this file asserts the SEMANTICS, not the arithmetic. The arithmetic never changed; that is
// precisely why nothing caught it.
//
// ============================ WHY THE MUTATION MATTERS MOST ============================
//
// The final test reintroduces the exact original defect. If it ever goes green, this whole file is
// decoration: it would mean a plan can call initialization a receipt again and nothing objects.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPO = path.resolve(import.meta.dirname, "../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

const {
  buildInventoryPlan, buildOpeningBalanceRecords, projectBalances,
  BASELINE_INITIALIZATION, OPENING_BALANCE_COLLECTION, OPENING_BALANCE_PROVENANCE,
  openingBalanceRecordId,
} = await import(L("functions/scripts/certificationWorld/data/inventoryPlan.mjs"));
const { MOVEMENT_SOURCE_TYPE, MOVEMENT_DIRECTION } =
  await import(L("functions/lib/inventoryLedger/operationalMovementTypes.js"));
const { signedQuantity } = await import(L("functions/scripts/certificationWorld/ledgerMath.mjs"));

const plan = buildInventoryPlan();
const baseline = plan.filter((m) => m.classification === BASELINE_INITIALIZATION);

test("the world has opening balances at all", () => {
  assert.ok(baseline.length > 0, "a world with no opening stock proves nothing about opening stock");
});

test("NO opening balance is typed RECEIVED", () => {
  // The defect, stated directly. RECEIVED means a supplier delivered goods against an order.
  const receipts = baseline.filter((m) => m.type === "RECEIVED");
  assert.deepEqual(receipts, [], "initialization must never be recorded as a receipt");
});

test("NO opening balance references a receiving order", () => {
  const claiming = baseline.filter((m) => m.sourceObject?.type === "RECEIVING_ORDER");
  assert.deepEqual(claiming.map((m) => m.sourceObject.id), [],
    "an opening balance that names a receiving order asserts a delivery that never happened");
});

test("every opening balance is ADJUSTED, sourced from an ADJUSTMENT", () => {
  for (const m of baseline) {
    assert.equal(m.type, "ADJUSTED", `${m.partId} at ${m.location.locationId}`);
    assert.equal(m.sourceObject.type, "ADJUSTMENT");
  }
});

test("the type/source pairing matches the LEDGER's own contract, not this fixture's opinion", () => {
  // Read from the product. If the domain ever re-binds ADJUSTED to a different source type, this
  // fails here rather than at the first refused write.
  for (const m of baseline) {
    assert.equal(m.sourceObject.type, MOVEMENT_SOURCE_TYPE[m.type],
      `${m.type} must be sourced from ${MOVEMENT_SOURCE_TYPE[m.type]}`);
    assert.equal(m.direction, MOVEMENT_DIRECTION[m.type]);
  }
});

test("every referenced adjustment record actually exists", () => {
  // The difference between this model and the old one is not a nicer string. It is that the thing
  // being pointed at is written.
  const records = new Map(buildOpeningBalanceRecords(plan).map((r) => [r.id, r]));
  for (const m of baseline) {
    const rec = records.get(m.sourceObject.id);
    assert.ok(rec, `no opening-balance record for ${m.sourceObject.id}`);
    assert.equal(rec.collection, OPENING_BALANCE_COLLECTION);
    assert.equal(rec.data.provenance, OPENING_BALANCE_PROVENANCE);
    assert.equal(rec.data.partId, m.partId);
    assert.equal(rec.data.quantity, m.quantity);
  }
});

test("the record id is derived, so a movement and its record cannot drift apart", () => {
  for (const m of baseline) {
    assert.equal(m.sourceObject.id, openingBalanceRecordId(m.partId, m.location.locationId));
  }
});

test("RECEIVING THROUGHPUT CANNOT COUNT OPENING STOCK", () => {
  // The report that would have been wrong. Anything asking "what did we receive?" filters on the
  // movement type, and no opening balance answers to it.
  const receiptUnits = plan.filter((m) => m.type === "RECEIVED").reduce((s, m) => s + m.quantity, 0);
  assert.equal(receiptUnits, 0, "the baseline contributes zero units of receiving activity");

  const openingUnits = baseline.reduce((s, m) => s + m.quantity, 0);
  assert.ok(openingUnits > 0, "...while still holding real stock");
});

test("PURCHASING THROUGHPUT CANNOT COUNT OPENING STOCK EITHER", () => {
  // No opening balance points at a purchase order, directly or through a receiving order.
  const purchaseLinked = baseline.filter((m) =>
    m.sourceObject?.type === "RECEIVING_ORDER" || /purchase|po-|cw-seed/i.test(String(m.sourceObject?.id)));
  assert.deepEqual(purchaseLinked, [], "opening stock was never bought");
});

test("opening stock is initialized WHERE IT SITS -- trucks included", () => {
  // The other half of the same defect: truck stock used to be a warehouse-to-truck transfer naming
  // a transfer order nobody created. A van that starts the day with parts in it did not have them
  // driven out that morning.
  const mobile = baseline.filter((m) => m.location.type === "MOBILE");
  assert.ok(mobile.length > 0, "the world must still put stock on trucks");
  const transfers = plan.filter((m) => m.type === "TRANSFER_IN" || m.type === "TRANSFER_OUT");
  assert.deepEqual(transfers, [], "baseline stock is declared, never transferred into place");
});

test("no baseline movement names a transfer order", () => {
  const claiming = baseline.filter((m) => m.sourceObject?.type === "TRANSFER_ORDER");
  assert.deepEqual(claiming.map((m) => m.sourceObject.id), [],
    "55 of these existed and the reference sweep was not yet looking for them");
});

test("the arithmetic is unchanged by the semantic correction", () => {
  // The correction must not have quietly moved stock. 571 / 164 / 735 are the figures every earlier
  // pass was verified against.
  const b = projectBalances(plan);
  const total = (m) => [...m].filter(([k]) => !String(k).includes("@")).reduce((s, [, v]) => s + v, 0);
  assert.equal(total(b.warehouse), 571, "warehouse total");
  assert.equal(total(b.truck), 164, "truck total");
  assert.equal(total(b.company), 735, "company total");
});

test("no location holds a negative opening balance", () => {
  const b = projectBalances(plan);
  const negatives = [...b.warehouse, ...b.truck].filter(([, v]) => v < 0);
  assert.deepEqual(negatives, [], "a negative opening balance is a plan that spent stock it never had");
});

test("MUTATION: reintroducing the original defect turns this file RED", () => {
  // The exact shape that shipped: an opening balance dressed as a receipt, naming a receiving order
  // that does not exist. Every check above must reject it.
  const defective = {
    ...baseline[0],
    type: "RECEIVED",
    direction: "IN",
    sourceObject: { type: "RECEIVING_ORDER", id: `cw-seed-${baseline[0].partId}` },
  };
  const mutated = [defective, ...baseline.slice(1)];

  assert.ok(mutated.some((m) => m.type === "RECEIVED"), "the mutation is present");
  assert.notEqual(defective.sourceObject.type, MOVEMENT_SOURCE_TYPE.ADJUSTED,
    "and it no longer matches the ADJUSTED contract");

  const records = new Map(buildOpeningBalanceRecords(plan).map((r) => [r.id, r]));
  assert.equal(records.get(defective.sourceObject.id), undefined,
    "its source references nothing -- the dangling reference, reproduced");

  const receiptUnits = mutated.filter((m) => m.type === "RECEIVED").reduce((s, m) => s + m.quantity, 0);
  assert.ok(receiptUnits > 0,
    "and receiving throughput now counts stock that was never received -- the report that would have lied");
});

test("MUTATION: a plan that adds up correctly is still rejected when it lies about why", () => {
  // The point of the whole file. Balances are IDENTICAL under the mutation -- signedQuantity treats
  // a positive ADJUSTED and a RECEIVED the same way. Arithmetic was never going to catch this.
  const asReceipt = baseline.map((m) => ({ ...m, type: "RECEIVED", direction: "IN" }));
  const before = baseline.reduce((s, m) => s + signedQuantity(m), 0);
  const after = asReceipt.reduce((s, m) => s + signedQuantity(m), 0);
  assert.equal(after, before, "the numbers agree perfectly, which is exactly why nothing noticed");
  assert.notEqual(asReceipt[0].type, "ADJUSTED", "and the meaning is wrong anyway");
});
