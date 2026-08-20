// Canonical purchase-order RECEIVING PROGRESS — the trusted read. EMULATOR tests.
//
// This read exists because remaining quantity CANNOT be derived in a browser: purchase_orders is
// client-readable but receiving_orders is deny-all. So what these prove is that the number the
// scanning surface shows is the same number the command enforces — derived from the same committed
// receipts, by the same pure fold.
//
// Prerequisite: npm run build; emulator running.
// Run: node test/purchaseOrderProgressRead.test.mjs
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
import assert from "node:assert/strict";
import admin from "firebase-admin";
admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();

const {
  readPurchaseOrderProgress,
  listReceivablePurchaseOrders,
  PurchaseOrderProgressNotFoundError,
  PurchaseOrderProgressInvalidError,
} = await import("../lib/inventoryReceiving/purchaseOrderProgressRead.js");
const cmd = await import("../lib/inventoryReceiving/receiveInventoryStockCommand.js");
const { receiveInventoryStock } = cmd;

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS: ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL: ${name}`); console.error(err); }
}
const runId = Date.now();
let seq = 0;
const nextId = (p) => `${p}-${runId}-${(seq += 1)}`;
const NOW = new Date(1_700_000_000_000);

const SERIAL_PARTS = new Set();
const trackingModes = async (partId) => (SERIAL_PARTS.has(partId) ? "SERIAL" : partId.startsWith("ghost") ? null : "NONE");

async function seedPo({ items, status = "SENT", version } = {}) {
  const poId = nextId("po");
  const actorId = nextId("actor");
  const lines = (items ?? [{ qty: 5 }]).map((it, i) => ({
    lineId: `L${i + 1}`, partId: it.partId ?? nextId("part"), quantity: it.qty,
  }));
  await db.collection("purchase_orders").doc(poId).set({
    supplierId: nextId("sup"), status,
    items: lines.map((l) => ({ ...l, unitPrice: 1 })),
    totalCost: lines.reduce((s, l) => s + l.quantity, 0),
    ...(version === undefined ? {} : { version }),
  });
  await db.collection("receiving_grants").doc(actorId).set({ granted: true });
  return { poId, actorId, lines };
}

const deps = (sc) => ({
  db,
  actor: { kind: "USER", id: sc.actorId },
  authorize: async (txn, actorId) => {
    const s = await txn.get(db.collection("receiving_grants").doc(actorId));
    return s.exists && s.data().granted === true;
  },
  resolvePart: async (_t, partId) => ({ partId, trackingMode: SERIAL_PARTS.has(partId) ? "SERIAL" : "NONE", active: true }),
  resolveLocationActive: async () => true,
  stageAudit: () => {},
  now: () => NOW,
});

const receive = (sc, lines) => receiveInventoryStock({
  source: { type: "PURCHASE_ORDER", purchaseOrderId: sc.poId },
  receivingLocation: { type: "WAREHOUSE", locationId: "WH-1" },
  lines,
  idempotencyKey: nextId("idem"),
}, deps(sc));

console.log("purchaseOrderProgressRead.test.mjs");

// ─────────────────────────────────── the number the command enforces

await check("an untouched order reports ordered quantities and nothing received", async () => {
  const sc = await seedPo({ items: [{ qty: 5 }, { qty: 2 }] });
  const p = await readPurchaseOrderProgress(db, sc.poId, trackingModes);
  assert.equal(p.derivedState, "NOT_RECEIVED");
  assert.equal(p.storedStatus, "SENT");
  assert.equal(p.receivable, true);
  assert.deepEqual(p.lines.map((l) => l.remainingQuantity), [5, 2]);
  assert.deepEqual(p.lines.map((l) => l.receivedQuantity), [0, 0]);
});

await check("after a PARTIAL receipt the read shows exactly what the command committed", async () => {
  // The whole reason this read exists: a browser cannot compute this, because receiving_orders is
  // deny-all to every client.
  const sc = await seedPo({ items: [{ qty: 5 }] });
  await receive(sc, [{ lineId: "L1", partId: sc.lines[0].partId, receivedQuantity: 2 }]);
  const p = await readPurchaseOrderProgress(db, sc.poId, trackingModes);
  assert.equal(p.lines[0].receivedQuantity, 2);
  assert.equal(p.lines[0].remainingQuantity, 3);
  assert.equal(p.lines[0].state, "PARTIALLY_RECEIVED");
  assert.equal(p.derivedState, "PARTIALLY_RECEIVED");
  assert.equal(p.storedStatus, "SENT", "derived progress and stored lifecycle are different facts");
});

await check("receipts ACCUMULATE across events, exactly as the command derives them", async () => {
  const sc = await seedPo({ items: [{ qty: 6 }] });
  const part = sc.lines[0].partId;
  await receive(sc, [{ lineId: "L1", partId: part, receivedQuantity: 2 }]);
  await receive(sc, [{ lineId: "L1", partId: part, receivedQuantity: 3 }]);
  const p = await readPurchaseOrderProgress(db, sc.poId, trackingModes);
  assert.equal(p.lines[0].receivedQuantity, 5);
  assert.equal(p.lines[0].remainingQuantity, 1);
});

await check("a fully received order reports RECEIVED on both axes", async () => {
  const sc = await seedPo({ items: [{ qty: 2 }] });
  await receive(sc, [{ lineId: "L1", partId: sc.lines[0].partId, receivedQuantity: 2 }]);
  const p = await readPurchaseOrderProgress(db, sc.poId, trackingModes);
  assert.equal(p.derivedState, "RECEIVED");
  assert.equal(p.storedStatus, "RECEIVED");
  assert.equal(p.receivable, false, "a completed order no longer accepts a receipt");
});

await check("lines progress INDEPENDENTLY", async () => {
  const sc = await seedPo({ items: [{ qty: 2 }, { qty: 2 }] });
  await receive(sc, [{ lineId: "L1", partId: sc.lines[0].partId, receivedQuantity: 2 }]);
  const p = await readPurchaseOrderProgress(db, sc.poId, trackingModes);
  assert.equal(p.lines.find((l) => l.lineId === "L1").state, "RECEIVED");
  assert.equal(p.lines.find((l) => l.lineId === "L2").state, "NOT_RECEIVED");
  assert.equal(p.derivedState, "PARTIALLY_RECEIVED");
});

// ─────────────────────────────────── tracking mode and version

await check("tracking mode is carried per line -- the scan queue needs it for serial handling", async () => {
  const serialPart = nextId("part");
  SERIAL_PARTS.add(serialPart);
  const sc = await seedPo({ items: [{ qty: 1, partId: serialPart }, { qty: 1 }] });
  const p = await readPurchaseOrderProgress(db, sc.poId, trackingModes);
  assert.equal(p.lines.find((l) => l.partId === serialPart).trackingMode, "SERIAL");
  assert.equal(p.lines.find((l) => l.partId !== serialPart).trackingMode, "NONE");
});

await check("an UNRESOLVABLE part reports UNKNOWN rather than defaulting to NONE", async () => {
  // Defaulting would tell an operator a serialized part needs no serial, and the receipt would then
  // be refused for a reason the screen had actively contradicted.
  const sc = await seedPo({ items: [{ qty: 1, partId: nextId("ghost") }] });
  const p = await readPurchaseOrderProgress(db, sc.poId, trackingModes);
  assert.equal(p.lines[0].trackingMode, "UNKNOWN");
});

await check("the concurrency version is projected, and a missing one normalizes to 0", async () => {
  const sc = await seedPo({ items: [{ qty: 3 }] });
  assert.equal((await readPurchaseOrderProgress(db, sc.poId, trackingModes)).version, 0);
  await receive(sc, [{ lineId: "L1", partId: sc.lines[0].partId, receivedQuantity: 1 }]);
  assert.equal((await readPurchaseOrderProgress(db, sc.poId, trackingModes)).version, 1,
    "the client needs this to submit an expectedVersion the server will accept");
});

// ─────────────────────────────────── fail closed

await check("a missing order is NOT FOUND, with no fallback to the legacy collection", async () => {
  const rrid = nextId("rr");
  await db.collection("reorder_purchase_orders").doc(rrid).set({
    reorderRequestId: rrid, partId: nextId("part"), supplierName: "ACME", externalPoNumber: "PO-1",
    orderedQuantity: 1, orderedDate: 1, expectedArrivalDate: null, status: "ORDERED", createdBy: "x", createdAt: 1,
  });
  // The id EXISTS -- in the other collection. Addressing the canonical authority must not resolve it.
  await assert.rejects(
    readPurchaseOrderProgress(db, rrid, trackingModes),
    (e) => e instanceof PurchaseOrderProgressNotFoundError,
  );
});

await check("a malformed order is INVALID rather than partially reported", async () => {
  const poId = nextId("po");
  await db.collection("purchase_orders").doc(poId).set({ supplierId: "s", status: "SENT", items: [] });
  await assert.rejects(
    readPurchaseOrderProgress(db, poId, trackingModes),
    (e) => e instanceof PurchaseOrderProgressInvalidError,
  );
});

await check("a blank purchaseOrderId is refused before any read", async () => {
  await assert.rejects(readPurchaseOrderProgress(db, "", trackingModes), (e) => e instanceof PurchaseOrderProgressInvalidError);
});

await check("reading NEVER mutates the purchase order", async () => {
  const sc = await seedPo({ items: [{ qty: 4 }] });
  const before = (await db.collection("purchase_orders").doc(sc.poId).get()).data();
  await readPurchaseOrderProgress(db, sc.poId, trackingModes);
  await readPurchaseOrderProgress(db, sc.poId, trackingModes);
  const after = (await db.collection("purchase_orders").doc(sc.poId).get()).data();
  assert.deepEqual(after, before, "a read decides nothing and writes nothing -- not even a version");
});

// ─────────────────────────────────── the receivable list

await check("the receivable list includes SENT and APPROVED orders and excludes the rest", async () => {
  const sent = await seedPo({ items: [{ qty: 1 }], status: "SENT" });
  const approved = await seedPo({ items: [{ qty: 1 }], status: "APPROVED" });
  const draft = await seedPo({ items: [{ qty: 1 }], status: "DRAFT" });
  const cancelled = await seedPo({ items: [{ qty: 1 }], status: "CANCELLED" });
  const ids = (await listReceivablePurchaseOrders(db)).map((o) => o.purchaseOrderId);
  assert.ok(ids.includes(sent.poId));
  assert.ok(ids.includes(approved.poId));
  assert.equal(ids.includes(draft.poId), false);
  assert.equal(ids.includes(cancelled.poId), false);
});

await check("the receivable list carries the line count and never the items themselves", async () => {
  const sc = await seedPo({ items: [{ qty: 1 }, { qty: 2 }, { qty: 3 }] });
  const row = (await listReceivablePurchaseOrders(db)).find((o) => o.purchaseOrderId === sc.poId);
  assert.equal(row.lineCount, 3);
  assert.equal(row.items, undefined, "the list is a summary; the lines come from the progress read");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
