// EI Phase-2 Receiving, Phase B -- Firestore-emulator tests for the trusted receiveInventoryStock
// command (functions/src/inventoryReceiving/receiveInventoryStockCommand.ts). Requires the Firestore
// emulator (127.0.0.1:8080). Imports the compiled ../lib output. Injects authorization / part /
// location / audit seams (Phase C wires the real ones). Never touches production.
// Prerequisite: npm run build; emulator running (npm run test:receiveInventoryStock via emulators:exec).
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
import assert from "node:assert/strict";
import admin from "firebase-admin";
admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();
const { FieldValue } = admin.firestore;

const cmd = await import("../lib/inventoryReceiving/receiveInventoryStockCommand.js");
const { receiveInventoryStock, UnauthorizedReceivingError, SourceNotFoundError, SourceNotReceivableError, DestinationInvalidError, PartInvalidError } = cmd;
const { IdempotencyConflictError, MalformedStoredRecordError } = await import("../lib/inventoryReceiving/receivingTypes.js");
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

// A writer app for genuinely-concurrent writes (mid-transaction), like the truck-registry precedent.
const writerApp = admin.apps.find((a) => a && a.name === "cw") || admin.initializeApp({ projectId: "taylor-parts" }, "cw");
const writerDb = writerApp.firestore();

async function seedScenario({ orderedQuantity = 5, poStatus = "ORDERED", reqStatus = "ORDERED", grant = true } = {}) {
  const rrid = nextId("rr");
  const partId = nextId("part");
  const actorId = nextId("actor");
  await db.collection("reorder_purchase_orders").doc(rrid).set({ reorderRequestId: rrid, partId, supplierName: "ACME", externalPoNumber: "PO-1", orderedQuantity, orderedDate: 1, expectedArrivalDate: null, status: poStatus, createdBy: "x", createdAt: 1 });
  await db.collection("reorder_requests").doc(rrid).set({ partId, status: reqStatus, purchaseOrderId: rrid, receivedBy: null, receivedAt: null, orderedBy: "x", orderedAt: 1 });
  if (grant) await db.collection("receiving_grants").doc(actorId).set({ granted: true });
  return { rrid, partId, actorId, orderedQuantity };
}
function request(sc, over = {}) {
  return {
    actor: { kind: "USER", id: sc.actorId },
    source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId: sc.rrid, purchaseOrderId: sc.rrid },
    receivingLocation: { type: "WAREHOUSE", locationId: "WH-1" },
    lines: [{ lineId: "L1", partId: sc.partId, expectedQuantity: sc.orderedQuantity, receivedQuantity: sc.orderedQuantity }],
    idempotencyKey: nextId("idem"),
    ...over,
  };
}
function makeDeps(over = {}) {
  const audits = [];
  const deps = {
    db,
    authorize: async (txn, actorId) => { const s = await txn.get(db.collection("receiving_grants").doc(actorId)); return s.exists && s.data().granted === true; },
    resolvePart: async (_txn, partId) => ({ partId, trackingMode: "NONE", active: true }),
    resolveLocationActive: async () => true,
    stageAudit: (txn, audit) => { audits.push(audit); txn.create(db.collection("receiving_audit_test").doc(audit.receivingId), { ...audit, at: FieldValue.serverTimestamp() }); },
    now: () => NOW,
    ...over,
  };
  return { deps, audits };
}
async function countAt(collection, field, value) {
  const snap = await db.collection(collection).where(field, "==", value).get();
  return snap.size;
}

// ---- happy path -------------------------------------------------------------------------------
await check("authorized NONE receipt succeeds atomically: one order + one RECEIVED event + closeout + audit; PO byte-identical", async () => {
  const sc = await seedScenario();
  const poBefore = (await db.collection("reorder_purchase_orders").doc(sc.rrid).get()).data();
  const { deps, audits } = makeDeps();
  const req = request(sc);
  const out = await receiveInventoryStock(req, deps);
  assert.equal(out.outcome, "applied");
  assert.equal(out.receivingId, receivingOrderDocId(req.idempotencyKey));
  // one receiving order, PUTAWAY_COMPLETE / version 1 / receivingId
  const ro = (await db.collection("receiving_orders").doc(out.receivingId).get()).data();
  assert.equal(ro.status, "PUTAWAY_COMPLETE"); assert.equal(ro.version, 1); assert.equal(ro.receivingId, out.receivingId);
  assert.equal(ro.createdBy, sc.actorId); assert.equal(ro.updatedBy, sc.actorId);
  // one RECEIVED ledger event, exact location/quantity/source/receivingId
  const led = (await db.collection("inventory_transactions").doc(out.ledgerEventId).get()).data();
  assert.equal(led.type, "RECEIVED"); assert.equal(led.quantity, sc.orderedQuantity);
  assert.deepEqual(led.location, { type: "WAREHOUSE", locationId: "WH-1" });
  assert.deepEqual(led.sourceObject, { type: "RECEIVING_ORDER", id: out.receivingId });
  // reorder_requests -> RECEIVED with coherent server metadata
  const reqDoc = (await db.collection("reorder_requests").doc(sc.rrid).get()).data();
  assert.equal(reqDoc.status, "RECEIVED"); assert.equal(reqDoc.receivedBy, sc.actorId); assert.ok(reqDoc.receivedAt);
  // reorder_purchase_orders byte-identical
  assert.deepEqual((await db.collection("reorder_purchase_orders").doc(sc.rrid).get()).data(), poBefore);
  // one audit
  assert.equal(audits.length, 1); assert.equal(audits[0].action, "receiveInventoryStock");
  assert.equal(await countAt("receiving_audit_test", "receivingId", out.receivingId), 1);
});

// ---- authorization ----------------------------------------------------------------------------
await check("missing capability -> denied, zero writes", async () => {
  const sc = await seedScenario({ grant: false });
  const req = request(sc);
  await assert.rejects(receiveInventoryStock(req, makeDeps().deps), (e) => e instanceof UnauthorizedReceivingError);
  assert.equal((await db.collection("reorder_requests").doc(sc.rrid).get()).data().status, "ORDERED");
  assert.equal((await db.collection("receiving_orders").doc(receivingOrderDocId(req.idempotencyKey)).get()).exists, false);
});

await check("authorization revoked during the transaction cannot commit", async () => {
  const sc = await seedScenario();
  const req = request(sc);
  const { deps } = makeDeps({ __afterAuthReadHook: async () => { await writerDb.collection("receiving_grants").doc(sc.actorId).delete(); } });
  await assert.rejects(receiveInventoryStock(req, deps));
  // never committed: no receiving order, request still ORDERED
  assert.equal((await db.collection("receiving_orders").doc(receivingOrderDocId(req.idempotencyKey)).get()).exists, false);
  assert.equal((await db.collection("reorder_requests").doc(sc.rrid).get()).data().status, "ORDERED");
});

// ---- source validation ------------------------------------------------------------------------
await check("missing / wrong-status PO fails closed", async () => {
  const missing = { rrid: nextId("none"), partId: "p", actorId: nextId("a"), orderedQuantity: 5 };
  await db.collection("receiving_grants").doc(missing.actorId).set({ granted: true });
  await assert.rejects(receiveInventoryStock(request(missing), makeDeps().deps), (e) => e instanceof SourceNotFoundError);
  const wrong = await seedScenario({ poStatus: "CANCELLED" });
  await assert.rejects(receiveInventoryStock(request(wrong), makeDeps().deps), (e) => e instanceof SourceNotReceivableError);
});

await check("wrong-status reorder request fails closed (apply path requires ORDERED)", async () => {
  const sc = await seedScenario({ reqStatus: "RECEIVED" });
  await assert.rejects(receiveInventoryStock(request(sc), makeDeps().deps), (e) => e instanceof SourceNotReceivableError);
});

await check("PO/request part identity mismatch fails closed", async () => {
  const sc = await seedScenario();
  await db.collection("reorder_requests").doc(sc.rrid).update({ partId: "DIFFERENT" });
  await assert.rejects(receiveInventoryStock(request(sc), makeDeps().deps), (e) => e instanceof SourceNotReceivableError);
});

// ---- destination / part -----------------------------------------------------------------------
await check("inactive / wrong-type destination fails closed", async () => {
  const sc = await seedScenario();
  await assert.rejects(receiveInventoryStock(request(sc), makeDeps({ resolveLocationActive: async () => false }).deps), (e) => e instanceof DestinationInvalidError);
  const sc2 = await seedScenario();
  await assert.rejects(receiveInventoryStock(request(sc2, { receivingLocation: { type: "NOPE", locationId: "x" } }), makeDeps().deps), (e) => e instanceof SourceNotReceivableError || e instanceof DestinationInvalidError);
});

await check("inactive / missing Part fails closed", async () => {
  const sc = await seedScenario();
  await assert.rejects(receiveInventoryStock(request(sc), makeDeps({ resolvePart: async () => null }).deps), (e) => e instanceof PartInvalidError);
  const sc2 = await seedScenario();
  await assert.rejects(receiveInventoryStock(request(sc2), makeDeps({ resolvePart: async (_t, partId) => ({ partId, trackingMode: "NONE", active: false }) }).deps), (e) => e instanceof PartInvalidError);
});

await check("SERIAL / LOT part fails closed", async () => {
  for (const mode of ["SERIAL", "LOT"]) {
    const sc = await seedScenario();
    await assert.rejects(receiveInventoryStock(request(sc), makeDeps({ resolvePart: async (_t, partId) => ({ partId, trackingMode: mode, active: true }) }).deps), (e) => e instanceof PartInvalidError);
  }
});

// ---- line / quantity --------------------------------------------------------------------------
await check("empty / multiple lines and bad quantities fail closed", async () => {
  const sc = await seedScenario();
  await assert.rejects(receiveInventoryStock(request(sc, { lines: [] }), makeDeps().deps), (e) => e instanceof SourceNotReceivableError);
  const sc2 = await seedScenario();
  await assert.rejects(receiveInventoryStock(request(sc2, { lines: [{ lineId: "L1", partId: sc2.partId, expectedQuantity: 5, receivedQuantity: 5 }, { lineId: "L2", partId: sc2.partId, expectedQuantity: 5, receivedQuantity: 5 }] }), makeDeps().deps), (e) => e instanceof SourceNotReceivableError);
  for (const q of [0, -1, 3, 9]) {
    const s = await seedScenario();
    await assert.rejects(receiveInventoryStock(request(s, { lines: [{ lineId: "L1", partId: s.partId, expectedQuantity: s.orderedQuantity, receivedQuantity: q }] }), makeDeps().deps), (e) => e instanceof SourceNotReceivableError);
  }
});

// ---- atomic rollback at each staged boundary --------------------------------------------------
await check("injected failure at each stage -> zero committed changes", async () => {
  for (const over of [
    { __afterAuthReadHook: async () => { throw new Error("boom-authz"); } },
    { resolvePart: async () => { throw new Error("boom-part"); } },
    { resolveLocationActive: async () => { throw new Error("boom-loc"); } },
    { stageAudit: () => { throw new Error("boom-audit"); } },
  ]) {
    const sc = await seedScenario();
    const req = request(sc);
    await assert.rejects(receiveInventoryStock(req, makeDeps(over).deps));
    assert.equal((await db.collection("receiving_orders").doc(receivingOrderDocId(req.idempotencyKey)).get()).exists, false, JSON.stringify(Object.keys(over)));
    assert.equal((await db.collection("reorder_requests").doc(sc.rrid).get()).data().status, "ORDERED");
    assert.equal(await countAt("receiving_audit_test", "receivingId", receivingOrderDocId(req.idempotencyKey)), 0);
  }
});

// ---- idempotency ------------------------------------------------------------------------------
await check("exact retry -> replayed, no duplicate order/event/closeout/audit", async () => {
  const sc = await seedScenario();
  const req = request(sc);
  const { deps, audits } = makeDeps();
  const a = await receiveInventoryStock(req, deps);
  const b = await receiveInventoryStock(req, deps); // exact retry (same idempotencyKey/payload)
  assert.equal(a.outcome, "applied"); assert.equal(b.outcome, "replayed");
  assert.equal(a.receivingId, b.receivingId); assert.equal(a.ledgerEventId, b.ledgerEventId);
  assert.equal(audits.length, 1); // replay stages no audit
  assert.equal(await countAt("receiving_orders", "receivingId", a.receivingId), 1);
});

await check("same idempotency key with a changed payload conflicts", async () => {
  const sc = await seedScenario();
  const req = request(sc);
  await receiveInventoryStock(req, makeDeps().deps);
  const changed = { ...req, receivingLocation: { type: "MOBILE", locationId: "1" } };
  await assert.rejects(receiveInventoryStock(changed, makeDeps().deps), (e) => e instanceof IdempotencyConflictError);
});

await check("malformed stored Receiving record fails closed", async () => {
  const sc = await seedScenario();
  const req = request(sc);
  const docId = receivingOrderDocId(req.idempotencyKey);
  await db.collection("receiving_orders").doc(docId).set({ schemaVersion: 1, receivingId: docId, bogus: true }); // malformed
  await assert.rejects(receiveInventoryStock(req, makeDeps().deps), (e) => e instanceof MalformedStoredRecordError);
});

// ---- concurrency ------------------------------------------------------------------------------
await check("concurrent source-status change prevents a stale commit", async () => {
  const sc = await seedScenario();
  const req = request(sc);
  const deps = makeDeps({ __afterSourceReadHook: async () => { await writerDb.collection("reorder_requests").doc(sc.rrid).update({ status: "CANCELLED" }); } }).deps;
  await assert.rejects(receiveInventoryStock(req, deps));
  // the command's RECEIVED transition never committed
  assert.equal((await db.collection("receiving_orders").doc(receivingOrderDocId(req.idempotencyKey)).get()).exists, false);
  assert.notEqual((await db.collection("reorder_requests").doc(sc.rrid).get()).data().status, "RECEIVED");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
