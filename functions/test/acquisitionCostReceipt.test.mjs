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

// ══════════════════════════════ A PRICED RECEIPT PRODUCES EVIDENCE ══════════════════════════════

await check("a receipt against a PRICED purchase order writes one governed acquisition-cost fact", async () => {
  const sc = await seedScenario({ orderedQuantity: 5, price: { unitPriceMinor: 10000, currency: "USD" } });
  const out = await receiveInventoryStock(request(sc), makeDeps(sc));
  assert.equal(out.outcome, "applied");
  const costs = await costDocsFor(out.receivingId);
  assert.equal(costs.length, 1, "exactly one fact per receipt line");
  const fact = costs[0];
  assert.equal(fact.costBasis, "PURCHASE_ORDER_LINE_PRICE");
  assert.equal(fact.unitPriceMinor, 10000);
  assert.equal(fact.receivedQuantity, 5);
  assert.equal(fact.extendedCostMinor, 50000, "5 × 10000, in exact integer minor units");
  assert.equal(fact.currency, "USD");
  assert.equal(fact.operatingCompanyId, "taylor");
});

await check("quantity and cost evidence share one source lineage, and one governed event time", async () => {
  // The number and the stock movement must be traceable to the SAME receipt and the same instant,
  // otherwise a reconciliation cannot tie a cost back to the units it paid for.
  const sc = await seedScenario({ orderedQuantity: 4, price: { unitPriceMinor: 2500, currency: "USD" } });
  const out = await receiveInventoryStock(request(sc), makeDeps(sc));
  const [fact] = await costDocsFor(out.receivingId);
  const ledger = (await db.collection("inventory_transactions").doc(out.ledgerEventId).get()).data();
  assert.equal(fact.receivingId, out.receivingId);
  assert.equal(fact.purchaseOrderId, sc.rrid);
  assert.equal(fact.partId, sc.partId);
  assert.equal(fact.receivedQuantity, ledger.quantity, "the cost prices exactly the quantity the ledger moved");
  assert.equal(fact.receivedAtMillis, ledger.occurredAt, "one governed business event time, not two write clocks");
  assert.equal(fact.receivingLocationId, ledger.location.locationId);
  assert.equal(fact.id, acquisitionCostDocId(out.receivingId, "L1"), "identity is derived from the receipt");
});

await check("the cost fact carries the lineage that lets someone audit the number", async () => {
  const sc = await seedScenario({ orderedQuantity: 2, price: { unitPriceMinor: 999, currency: "CAD" } });
  const out = await receiveInventoryStock(request(sc), makeDeps(sc));
  const [fact] = await costDocsFor(out.receivingId);
  assert.equal(fact.purchaseOrderSourceType, "REORDER_PURCHASE_ORDER");
  assert.equal(fact.supplierName, "ACME");
  assert.equal(fact.supplierId, null, "a legacy PO carries a name, not a Supplier Master id — and says so");
  assert.equal(fact.purchaseOrderVersion, null, "the legacy PO is immutable and has no revisions");
  assert.equal(fact.currency, "CAD", "a non-USD purchase keeps its own currency — no FX exists");
  assert.equal(fact.createdBy, sc.actorId);
});

// ══════════════════════════════ UNKNOWN, NEVER ZERO ══════════════════════════════

await check("an UNPRICED purchase order still receives, and fabricates NO cost", async () => {
  // The legacy-compatibility case, and the most important one in this file. Every purchase order in
  // Firestore today is unpriced. Receiving must keep working, and the cost must be absent rather than
  // zero — a zero-cost fact reads as "this was free" and would silently inflate every margin built on
  // it, forever, with no error anywhere to notice.
  const sc = await seedScenario({ orderedQuantity: 5, price: null });
  const out = await receiveInventoryStock(request(sc), makeDeps(sc));
  assert.equal(out.outcome, "applied", "the established receiving workflow is not broken by adding cost");
  assert.equal((await db.collection("inventory_transactions").doc(out.ledgerEventId).get()).data().quantity, 5);
  assert.deepEqual(await costDocsFor(out.receivingId), [], "no fact at all — the cost is UNKNOWN");
  assert.equal(out.acquisitionCostIds, undefined, "and the result does not claim one");
});

await check("a PRICED purchase order with NO governed company produces no cost fact", async () => {
  // Fails closed rather than attributing the cost to a company it cannot prove. The receiving
  // warehouse is right there and would look like a reasonable source; it is not one.
  const sc = await seedScenario({ orderedQuantity: 3, price: { unitPriceMinor: 5000, currency: "USD" }, operatingCompanyId: null });
  const out = await receiveInventoryStock(request(sc), makeDeps(sc));
  assert.equal(out.outcome, "applied");
  assert.deepEqual(await costDocsFor(out.receivingId), [], "no company means no evidence, not a guessed company");
});

// ══════════════════════════════ IDEMPOTENCY AND IMMUTABILITY ══════════════════════════════

await check("a receipt RETRY produces one quantity outcome and ONE cost fact", async () => {
  // A duplicated cost event is a financial defect. Identity prevents it rather than a check.
  const sc = await seedScenario({ orderedQuantity: 5, price: { unitPriceMinor: 10000, currency: "USD" } });
  const req = request(sc);
  const first = await receiveInventoryStock(req, makeDeps(sc));
  const second = await receiveInventoryStock(req, makeDeps(sc));
  assert.equal(first.outcome, "applied");
  assert.equal(second.outcome, "replayed");
  assert.equal(second.receivingId, first.receivingId);
  const costs = await costDocsFor(first.receivingId);
  assert.equal(costs.length, 1, "the retry wrote no second cost event");
  assert.equal(costs[0].extendedCostMinor, 50000, "and did not double the first one");
  assert.equal(second.acquisitionCostIds, undefined, "a replay does not claim to have written facts");
});

await check("a committed cost fact is never rewritten by anything the receiving path does", async () => {
  const sc = await seedScenario({ orderedQuantity: 5, price: { unitPriceMinor: 10000, currency: "USD" } });
  const out = await receiveInventoryStock(request(sc), makeDeps(sc));
  const before = (await db.collection(ACQUISITION_COST_COLLECTION).doc(acquisitionCostDocId(out.receivingId, "L1")).get()).data();
  // Change the supplier quote AND the purchase order's stored price after the fact. Neither is a path
  // to the committed evidence: the PO is immutable to clients by Rules, and even a privileged rewrite
  // of it cannot reach a receipt that already happened.
  await db.collection("part_supplier_items").doc(nextId("psi")).set({ partId: sc.partId, cost: "999.0000", currency: "USD" });
  await db.collection("reorder_purchase_orders").doc(sc.rrid).update({ unitPriceMinor: 99999 });
  const after = (await db.collection(ACQUISITION_COST_COLLECTION).doc(acquisitionCostDocId(out.receivingId, "L1")).get()).data();
  assert.deepEqual(after, before, "history is evidence: it does not move when a current price does");
  assert.equal(after.unitPriceMinor, 10000);
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

await check("a second receipt cannot alter the first receipt's cost evidence", async () => {
  // The same invariant on the LIVE path, where prices are governed. Two priced purchase orders for the
  // same part at different prices: each receipt keeps its own.
  const a = await seedScenario({ orderedQuantity: 2, price: { unitPriceMinor: 10000, currency: "USD" } });
  const outA = await receiveInventoryStock(request(a), makeDeps(a));
  const b = await seedScenario({ orderedQuantity: 3, price: { unitPriceMinor: 12000, currency: "USD" } });
  const outB = await receiveInventoryStock(request(b), makeDeps(b));
  const [factA] = await costDocsFor(outA.receivingId);
  const [factB] = await costDocsFor(outB.receivingId);
  assert.equal(factA.unitPriceMinor, 10000, "the earlier acquisition keeps the price it was acquired at");
  assert.equal(factB.unitPriceMinor, 12000);
  assert.equal(factA.extendedCostMinor, 20000);
  assert.equal(factB.extendedCostMinor, 36000);
});

// ══════════════════════════════ ATOMICITY ══════════════════════════════

await check("a receipt that fails writes NO cost fact — quantity and cost cannot disagree", async () => {
  // The two must commit together or not at all. Here the reorder request is cancelled after the source
  // read, so the transaction fails at the lifecycle write, after the cost fact was already buffered.
  const sc = await seedScenario({ orderedQuantity: 5, price: { unitPriceMinor: 10000, currency: "USD" } });
  const req = request(sc);
  const deps = makeDeps(sc, {
    __afterSourceReadHook: async () => { await db.collection("reorder_requests").doc(sc.rrid).update({ status: "CANCELLED" }); },
  });
  await assert.rejects(receiveInventoryStock(req, deps));
  const costs = (await db.collection(ACQUISITION_COST_COLLECTION).where("purchaseOrderId", "==", sc.rrid).get()).size;
  assert.equal(costs, 0, "no orphan cost for stock that was never received");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
