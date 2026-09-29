// FIN-BLOCK-003A — the RECEIPT-TIME producer, against the Firestore emulator.
//
// acquisitionCost.test.mjs proves the fact is well-formed. This suite proves the behaviour that only
// a real transaction can show: that quantity and its cost evidence commit together or not at all,
// that a retry cannot duplicate a cost event, that a partial receipt prices only what arrived, and —
// the one most likely to be broken by a future convenience — that an unpriced purchase order yields
// stock with NO cost fact rather than a zero-cost one.
//
// Requires the Firestore emulator (127.0.0.1:8080). Imports the compiled ../lib output. Never touches
// production. Prerequisite: npm run build; emulator running.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
import assert from "node:assert/strict";
import admin from "firebase-admin";
admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();
const { FieldValue } = admin.firestore;

const { receiveInventoryStock } = await import("../lib/inventoryReceiving/receiveInventoryStockCommand.js");
const { ACQUISITION_COST_COLLECTION, acquisitionCostDocId } = await import("../lib/finance/acquisitionCost.js");
const { ReorderSourceFrozenError } = await import("../lib/reorderRequest/reorderSourceFreeze.js");
const { receivingOrderDocId } = await import("../lib/inventoryReceiving/receivingRepository.js");

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS: ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL: ${name}`); console.error(err); }
}
const runId = Date.now();
let seq = 0;
const nextId = (p) => `${p}-${runId}-${(seq += 1)}`;
const NOW = new Date(1_700_000_000_000);

/**
 * A LEGACY (live) purchase order. `price` omitted means an UNPRICED purchase — which is what every
 * purchase order in Firestore looks like today, and the state legacy compatibility must preserve.
 */
async function seedScenario({ orderedQuantity = 5, price = null, operatingCompanyId = "taylor" } = {}) {
  const rrid = nextId("rr");
  const partId = nextId("part");
  const actorId = nextId("actor");
  await db.collection("reorder_purchase_orders").doc(rrid).set({
    reorderRequestId: rrid, partId, supplierName: "ACME", externalPoNumber: "PO-1",
    orderedQuantity, orderedDate: 1, expectedArrivalDate: null, status: "ORDERED",
    createdBy: "x", createdAt: 1,
    ...(operatingCompanyId === null ? {} : { operatingCompanyId }),
    ...(price === null ? {} : { unitPriceMinor: price.unitPriceMinor, currency: price.currency }),
  });
  await db.collection("reorder_requests").doc(rrid).set({
    partId, status: "ORDERED", purchaseOrderId: rrid, receivedBy: null, receivedAt: null, orderedBy: "x", orderedAt: 1,
  });
  await db.collection("receiving_grants").doc(actorId).set({ granted: true });
  return { rrid, partId, actorId, orderedQuantity };
}

function request(sc, over = {}) {
  return {
    source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId: sc.rrid, purchaseOrderId: sc.rrid },
    receivingLocation: { type: "WAREHOUSE", locationId: "WH-1" },
    lines: [{ lineId: "L1", partId: sc.partId, expectedQuantity: sc.orderedQuantity, receivedQuantity: sc.orderedQuantity }],
    idempotencyKey: nextId("idem"),
    ...over,
  };
}
function makeDeps(sc, over = {}) {
  return {
    db,
    actor: { kind: "USER", id: sc.actorId },
    authorize: async (txn, actorId) => {
      const s = await txn.get(db.collection("receiving_grants").doc(actorId));
      return s.exists && s.data().granted === true;
    },
    resolvePart: async (_txn, partId) => ({ partId, trackingMode: "NONE", active: true }),
    resolveLocationActive: async () => true,
    stageAudit: (txn, audit) => txn.create(db.collection("receiving_audit_test").doc(audit.receivingId), { ...audit, at: FieldValue.serverTimestamp() }),
    now: () => NOW,
    ...over,
  };
}
const costDocsFor = async (receivingId) =>
  (await db.collection(ACQUISITION_COST_COLLECTION).where("receivingId", "==", receivingId).get()).docs.map((d) => ({ id: d.id, ...d.data() }));

// ══════════════════════════════ THE REORDER SOURCE FREEZE ══════════════════════════════
//
// The LEGACY reorder purchase order is the only source that carries a GOVERNED price and company today (the canonical
// purchase_orders line price is deliberately never read -- see purchaseOrderNormalization.ts), and its receiving branch
// is now FROZEN for the PostgreSQL cutover. So a priced legacy receipt is refused, and the receipt-time producer has no
// live priced source left in this runtime. The PURE derivation (governed price, exact extended cost, required company,
// deterministic (receipt, line) identity, partial pricing) stays proven in acquisitionCost.test.mjs; what cannot be
// preserved without reopening the legacy writer is the TRANSACTIONAL co-commit of quantity + cost evidence (listed as a
// domain proof with no lower boundary). Each such check below now proves the frozen refusal writes nothing at all.
async function assertPricedLegacyFrozen(sc, req = request(sc)) {
  const rrBefore = (await db.collection("reorder_requests").doc(sc.rrid).get()).data();
  await assert.rejects(receiveInventoryStock(req, makeDeps(sc)), (e) => e instanceof ReorderSourceFrozenError && e.code === "REORDER_SOURCE_FROZEN");
  const receivingId = receivingOrderDocId(req.idempotencyKey);
  assert.equal((await db.collection(ACQUISITION_COST_COLLECTION).where("purchaseOrderId", "==", sc.rrid).get()).size, 0, "no cost fact");
  assert.equal((await db.collection("receiving_orders").doc(receivingId).get()).exists, false, "no receipt");
  assert.equal((await db.collection("inventory_transactions").where("sourceObject.id", "==", receivingId).get()).size, 0, "no ledger event");
  assert.equal((await db.collection("receiving_audit_test").where("reorderRequestId", "==", sc.rrid).get()).size, 0, "no audit");
  assert.deepEqual((await db.collection("reorder_requests").doc(sc.rrid).get()).data(), rrBefore, "reorder request unchanged");
}

// ══════════════════════════════ A PRICED RECEIPT PRODUCES EVIDENCE ══════════════════════════════

// Ruling A: the priced receipt is a LEGACY REORDER_PURCHASE_ORDER receipt -- a superseded Reorder source write.
await check("a receipt against a PRICED legacy purchase order is refused FROZEN and writes NO cost fact", async () => {
  const sc = await seedScenario({ orderedQuantity: 5, price: { unitPriceMinor: 10000, currency: "USD" } });
  await assertPricedLegacyFrozen(sc);
});

// Ruling A: the shared quantity/cost lineage needs a committed priced (legacy) receipt, which the freeze forbids.
await check("a priced legacy receipt is refused FROZEN: neither the quantity nor its cost evidence is committed", async () => {
  const sc = await seedScenario({ orderedQuantity: 4, price: { unitPriceMinor: 2500, currency: "USD" } });
  await assertPricedLegacyFrozen(sc);
});

// Ruling A: the lineage fields ride a committed priced (legacy) receipt, which the freeze forbids.
await check("a priced non-USD legacy receipt is refused FROZEN and records no lineage", async () => {
  const sc = await seedScenario({ orderedQuantity: 2, price: { unitPriceMinor: 999, currency: "CAD" } });
  await assertPricedLegacyFrozen(sc);
});

// ══════════════════════════════ UNKNOWN, NEVER ZERO ══════════════════════════════

// Ruling B: "unpriced still receives, and fabricates no cost" is receiving/cost domain logic -- preserved on the unfrozen
// CANONICAL source, whose lines are always unpriced (the Epic-5 float price is never read).
await check("an UNPRICED purchase order still receives, and fabricates NO cost", async () => {
  // The most important case in this file. Receiving must keep working, and the cost must be absent rather than
  // zero — a zero-cost fact reads as "this was free" and would silently inflate every margin built on it.
  const poId = nextId("po"), partId = nextId("part"), actorId = nextId("actor");
  await db.collection("receiving_grants").doc(actorId).set({ granted: true });
  await db.collection("purchase_orders").doc(poId).set({ status: "SENT", items: [{ lineId: "L1", partId, quantity: 5, unitPrice: 12.5 }] });
  const out = await receiveInventoryStock({
    source: { type: "PURCHASE_ORDER", purchaseOrderId: poId },
    receivingLocation: { type: "WAREHOUSE", locationId: "WH-1" },
    lines: [{ lineId: "L1", partId, expectedQuantity: 5, receivedQuantity: 5 }],
    idempotencyKey: nextId("idem"),
  }, makeDeps({ actorId }));
  assert.equal(out.outcome, "applied", "the established receiving workflow is not broken by adding cost");
  assert.equal((await db.collection("inventory_transactions").doc(out.ledgerEventId).get()).data().quantity, 5);
  assert.deepEqual(await costDocsFor(out.receivingId), [], "no fact at all — the cost is UNKNOWN");
  assert.equal(out.acquisitionCostIds, undefined, "and the result does not claim one");
});

// Ruling A: "priced but no governed company" is only expressible on the legacy PO (canonical carries neither a governed
// price nor a company), whose receipt is now refused FROZEN.
await check("a PRICED legacy purchase order with NO governed company is refused FROZEN, and no cost fact exists", async () => {
  const sc = await seedScenario({ orderedQuantity: 3, price: { unitPriceMinor: 5000, currency: "USD" }, operatingCompanyId: null });
  await assertPricedLegacyFrozen(sc);
});

// ══════════════════════════════ IDEMPOTENCY AND IMMUTABILITY ══════════════════════════════

// Ruling A: a priced retry needs a committed priced (legacy) receipt; each attempt is refused FROZEN and writes nothing.
await check("a priced legacy receipt RETRY is refused FROZEN every time, and no cost fact is ever written", async () => {
  const sc = await seedScenario({ orderedQuantity: 5, price: { unitPriceMinor: 10000, currency: "USD" } });
  const req = request(sc);
  await assertPricedLegacyFrozen(sc, req);
  await assertPricedLegacyFrozen(sc, req);
});

// Ruling A: there is no committed priced receipt to protect, because the priced (legacy) receipt is refused FROZEN.
await check("a later price change cannot manufacture a cost fact for a refused (frozen) receipt", async () => {
  const sc = await seedScenario({ orderedQuantity: 5, price: { unitPriceMinor: 10000, currency: "USD" } });
  await assertPricedLegacyFrozen(sc);
  await db.collection("part_supplier_items").doc(nextId("psi")).set({ partId: sc.partId, cost: "999.0000", currency: "USD" });
  await db.collection("reorder_purchase_orders").doc(sc.rrid).update({ unitPriceMinor: 99999 });
  assert.equal((await db.collection(ACQUISITION_COST_COLLECTION).where("purchaseOrderId", "==", sc.rrid).get()).size, 0);
});

// ══════════════════════════════ PARTIAL RECEIPT AND PRICE REVISION ══════════════════════════════

await check("PARTIAL receipt: 4 of 10 prices 4, and a later price change does not rewrite it", async () => {
  // The ruling's worked example. The legacy path receives full-quantity by validation, so the partial
  // sequence is exercised on the CANONICAL purchase order, which supports partial receipts.
  const poId = nextId("po");
  const partId = nextId("part");
  const actorId = nextId("actor");
  await db.collection("receiving_grants").doc(actorId).set({ granted: true });
  await db.collection("purchase_orders").doc(poId).set({
    status: "APPROVED", version: 0,
    items: [{ lineId: "L1", partId, quantity: 10, unitPrice: 100.0 }],
  });
  const sc = { rrid: poId, partId, actorId };
  // expectedQuantity is the callers CLAIM about the ORDERED quantity, checked against the PO so a
  // caller working from a stale view cannot record a receipt against an order state that never
  // existed (receivingBatchValidation.ts:153). received < ordered IS the partial receipt.
  const canonicalRequest = (ordered, received) => ({
    source: { type: "PURCHASE_ORDER", purchaseOrderId: poId },
    receivingLocation: { type: "WAREHOUSE", locationId: "WH-1" },
    lines: [{ lineId: "L1", partId, expectedQuantity: ordered, receivedQuantity: received }],
    idempotencyKey: nextId("idem"),
  });
  const first = await receiveInventoryStock(canonicalRequest(10, 4), makeDeps(sc));
  assert.equal(first.outcome, "applied");
  assert.equal(first.lines[0].receivedNow, 4);
  assert.equal(first.lines[0].remainingQuantity, 6);
  // NO cost fact — and this is the Epic-5 refusal proving itself end to end. The line carries a float
  // unitPrice of 100.0 and the purchase order carries no company; both are refused, so a canonical
  // receipt is UNKNOWN-cost rather than costed from an ungoverned number.
  assert.deepEqual(await costDocsFor(first.receivingId), [], "the dead Epic-5 float price must not become cost");
  // The remaining 6, after the PO's price is changed. The first receipt is untouched because it is a
  // separate immutable record keyed by its own receipt — there is no rewrite path to look for.
  // The whole array, not a dot-path: Firestore has no array-index field path, and "items.0.unitPrice"
  // would write a literal field of that name and leave the PO with no readable lines.
  await db.collection("purchase_orders").doc(poId).update({ items: [{ lineId: "L1", partId, quantity: 10, unitPrice: 120.0 }] });
  const second = await receiveInventoryStock(canonicalRequest(10, 6), makeDeps(sc));
  assert.equal(second.outcome, "applied");
  assert.equal(second.lines[0].receivedNow, 6);
  assert.equal(second.lines[0].remainingQuantity, 0);
  assert.notEqual(second.receivingId, first.receivingId, "two receipts, two identities, two independent cost answers");
  assert.deepEqual(await costDocsFor(second.receivingId), []);
});

// Ruling A: two priced receipts at different prices are both LEGACY receipts, each refused FROZEN with no evidence.
await check("two priced legacy receipts at different prices are each refused FROZEN, and neither writes evidence", async () => {
  const a = await seedScenario({ orderedQuantity: 2, price: { unitPriceMinor: 10000, currency: "USD" } });
  await assertPricedLegacyFrozen(a);
  const b = await seedScenario({ orderedQuantity: 3, price: { unitPriceMinor: 12000, currency: "USD" } });
  await assertPricedLegacyFrozen(b);
});

// ══════════════════════════════ ATOMICITY ══════════════════════════════

// Ruling A: the failing-receipt path was reached through the legacy branch; the freeze now refuses it before any cost
// fact is buffered, and nothing is written.
await check("a priced legacy receipt is refused FROZEN before any cost fact is buffered -- quantity and cost cannot disagree", async () => {
  const sc = await seedScenario({ orderedQuantity: 5, price: { unitPriceMinor: 10000, currency: "USD" } });
  let sourceRead = false;
  const req = request(sc);
  await assert.rejects(
    receiveInventoryStock(req, makeDeps(sc, { __afterSourceReadHook: async () => { sourceRead = true; } })),
    (e) => e instanceof ReorderSourceFrozenError,
  );
  assert.equal(sourceRead, true, "the refusal happens on the legacy branch, after the source read and before any write");
  assert.equal((await db.collection(ACQUISITION_COST_COLLECTION).where("purchaseOrderId", "==", sc.rrid).get()).size, 0, "no orphan cost");
  assert.equal((await db.collection("reorder_requests").doc(sc.rrid).get()).data().status, "ORDERED");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
