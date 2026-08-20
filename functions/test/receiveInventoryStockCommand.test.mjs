// EI Phase-2 Receiving, Phase B -- Firestore-emulator tests for the trusted receiveInventoryStock
// command. Requires the Firestore emulator (127.0.0.1:8080). Imports the compiled ../lib output. The
// server-derived actor is TRUSTED command context (deps.actor), never in the untrusted request.
// Authorization / part / location / audit are injected seams. Never touches production.
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
// The UNTRUSTED request payload -- NO actor (actor is trusted deps context).
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
  const audits = [];
  const deps = {
    db,
    actor: { kind: "USER", id: sc.actorId },
    authorize: async (txn, actorId) => { const s = await txn.get(db.collection("receiving_grants").doc(actorId)); return s.exists && s.data().granted === true; },
    resolvePart: async (_txn, partId) => ({ partId, trackingMode: "NONE", active: true }),
    resolveLocationActive: async () => true,
    stageAudit: (txn, audit) => { audits.push(audit); txn.create(db.collection("receiving_audit_test").doc(audit.receivingId), { ...audit, at: FieldValue.serverTimestamp() }); },
    now: () => NOW,
    ...over,
  };
  return { deps, audits };
}
async function countAt(collection, field, value) { return (await db.collection(collection).where(field, "==", value).get()).size; }

// ---- happy path -------------------------------------------------------------------------------
await check("authorized NONE receipt succeeds atomically: one order + one RECEIVED event + closeout + audit; PO byte-identical", async () => {
  const sc = await seedScenario();
  const poBefore = (await db.collection("reorder_purchase_orders").doc(sc.rrid).get()).data();
  const { deps, audits } = makeDeps(sc);
  const req = request(sc);
  const out = await receiveInventoryStock(req, deps);
  assert.equal(out.outcome, "applied");
  assert.equal(out.receivingId, receivingOrderDocId(req.idempotencyKey));
  const ro = (await db.collection("receiving_orders").doc(out.receivingId).get()).data();
  assert.equal(ro.status, "PUTAWAY_COMPLETE"); assert.equal(ro.version, 1); assert.equal(ro.receivingId, out.receivingId);
  assert.equal(ro.createdBy, sc.actorId); assert.equal(ro.updatedBy, sc.actorId);
  const led = (await db.collection("inventory_transactions").doc(out.ledgerEventId).get()).data();
  assert.equal(led.type, "RECEIVED"); assert.equal(led.quantity, sc.orderedQuantity);
  assert.deepEqual(led.location, { type: "WAREHOUSE", locationId: "WH-1" });
  assert.deepEqual(led.sourceObject, { type: "RECEIVING_ORDER", id: out.receivingId });
  const reqDoc = (await db.collection("reorder_requests").doc(sc.rrid).get()).data();
  assert.equal(reqDoc.status, "RECEIVED"); assert.equal(reqDoc.receivedBy, sc.actorId); assert.ok(reqDoc.receivedAt);
  assert.deepEqual((await db.collection("reorder_purchase_orders").doc(sc.rrid).get()).data(), poBefore);
  assert.equal(audits.length, 1); assert.equal(audits[0].action, "receiveInventoryStock");
  assert.equal(await countAt("receiving_audit_test", "receivingId", out.receivingId), 1);
});

// ---- authorization ----------------------------------------------------------------------------
await check("missing capability -> denied, zero writes", async () => {
  const sc = await seedScenario({ grant: false });
  const req = request(sc);
  await assert.rejects(receiveInventoryStock(req, makeDeps(sc).deps), (e) => e instanceof UnauthorizedReceivingError);
  assert.equal((await db.collection("reorder_requests").doc(sc.rrid).get()).data().status, "ORDERED");
  assert.equal((await db.collection("receiving_orders").doc(receivingOrderDocId(req.idempotencyKey)).get()).exists, false);
});

await check("authorization revoked during the transaction cannot commit", async () => {
  const sc = await seedScenario();
  const req = request(sc);
  const { deps } = makeDeps(sc, { __afterAuthReadHook: async () => { await writerDb.collection("receiving_grants").doc(sc.actorId).delete(); } });
  await assert.rejects(receiveInventoryStock(req, deps));
  assert.equal((await db.collection("receiving_orders").doc(receivingOrderDocId(req.idempotencyKey)).get()).exists, false);
  assert.equal((await db.collection("reorder_requests").doc(sc.rrid).get()).data().status, "ORDERED");
});

// ---- P2: actor must be trusted context, NOT the untrusted request ------------------------------
await check("an actor embedded in the request is rejected (unknown field)", async () => {
  const sc = await seedScenario();
  await assert.rejects(receiveInventoryStock(request(sc, { actor: { kind: "USER", id: "evil" } }), makeDeps(sc).deps), (e) => e instanceof SourceNotReceivableError);
});

// ---- source / destination / part --------------------------------------------------------------
await check("missing / wrong-status PO fails closed", async () => {
  const missing = { rrid: nextId("none"), partId: "p", actorId: nextId("a"), orderedQuantity: 5 };
  await db.collection("receiving_grants").doc(missing.actorId).set({ granted: true });
  await assert.rejects(receiveInventoryStock(request(missing), makeDeps(missing).deps), (e) => e instanceof SourceNotFoundError);
  const wrong = await seedScenario({ poStatus: "CANCELLED" });
  await assert.rejects(receiveInventoryStock(request(wrong), makeDeps(wrong).deps), (e) => e instanceof SourceNotReceivableError);
});

await check("wrong-status reorder request fails closed (apply path requires ORDERED)", async () => {
  const sc = await seedScenario({ reqStatus: "RECEIVED" });
  await assert.rejects(receiveInventoryStock(request(sc), makeDeps(sc).deps), (e) => e instanceof SourceNotReceivableError);
});

await check("PO/request part identity mismatch fails closed", async () => {
  const sc = await seedScenario();
  await db.collection("reorder_requests").doc(sc.rrid).update({ partId: "DIFFERENT" });
  await assert.rejects(receiveInventoryStock(request(sc), makeDeps(sc).deps), (e) => e instanceof SourceNotReceivableError);
});

await check("inactive / wrong-type destination fails closed", async () => {
  const sc = await seedScenario();
  await assert.rejects(receiveInventoryStock(request(sc), makeDeps(sc, { resolveLocationActive: async () => false }).deps), (e) => e instanceof DestinationInvalidError);
  const sc2 = await seedScenario();
  await assert.rejects(receiveInventoryStock(request(sc2, { receivingLocation: { type: "NOPE", locationId: "x" } }), makeDeps(sc2).deps), (e) => e instanceof SourceNotReceivableError || e instanceof DestinationInvalidError);
});

await check("inactive / missing Part fails closed", async () => {
  const sc = await seedScenario();
  await assert.rejects(receiveInventoryStock(request(sc), makeDeps(sc, { resolvePart: async () => null }).deps), (e) => e instanceof PartInvalidError);
  const sc2 = await seedScenario();
  await assert.rejects(receiveInventoryStock(request(sc2), makeDeps(sc2, { resolvePart: async (_t, partId) => ({ partId, trackingMode: "NONE", active: false }) }).deps), (e) => e instanceof PartInvalidError);
});

// SERIAL was authorized for Receiving in Wave 7 (Owner decision:
// docs/releases/serialized-asset-registry-slice-b-boundary.md), so this no longer asserts that SERIAL
// fails closed. LOT's deferral is unchanged and still locked here; SERIAL's own behavior -- including
// every way it must fail closed -- is covered in test/receiveSerializedStockCommand.test.mjs.
await check("LOT part still fails closed", async () => {
  const sc = await seedScenario();
  await assert.rejects(receiveInventoryStock(request(sc), makeDeps(sc, { resolvePart: async (_t, partId) => ({ partId, trackingMode: "LOT", active: true }) }).deps), (e) => e instanceof PartInvalidError);
});

await check("a SERIAL part is refused when the request carries no serial identity", async () => {
  // Guards the seam between the two suites: a SERIAL part received through a NONE-shaped request must
  // not quietly succeed as an untracked receipt.
  const sc = await seedScenario();
  await assert.rejects(receiveInventoryStock(request(sc), makeDeps(sc, { resolvePart: async (_t, partId) => ({ partId, trackingMode: "SERIAL", active: true }) }).deps));
  assert.equal((await db.collection("serialized_assets").where("partId", "==", sc.partId).get()).size, 0);
});

await check("empty / multiple lines and bad quantities fail closed", async () => {
  const sc = await seedScenario();
  await assert.rejects(receiveInventoryStock(request(sc, { lines: [] }), makeDeps(sc).deps), (e) => e instanceof SourceNotReceivableError);
  const sc2 = await seedScenario();
  await assert.rejects(receiveInventoryStock(request(sc2, { lines: [{ lineId: "L1", partId: sc2.partId, expectedQuantity: 5, receivedQuantity: 5 }, { lineId: "L2", partId: sc2.partId, expectedQuantity: 5, receivedQuantity: 5 }] }), makeDeps(sc2).deps), (e) => e instanceof SourceNotReceivableError);
  for (const q of [0, -1, 3, 9]) {
    const s = await seedScenario();
    await assert.rejects(receiveInventoryStock(request(s, { lines: [{ lineId: "L1", partId: s.partId, expectedQuantity: s.orderedQuantity, receivedQuantity: q }] }), makeDeps(s).deps), (e) => e instanceof SourceNotReceivableError);
  }
});

// ---- atomic rollback --------------------------------------------------------------------------
await check("injected failure at each stage -> zero committed changes", async () => {
  for (const over of [
    { __afterAuthReadHook: async () => { throw new Error("boom-authz"); } },
    { resolvePart: async () => { throw new Error("boom-part"); } },
    { resolveLocationActive: async () => { throw new Error("boom-loc"); } },
    { stageAudit: () => { throw new Error("boom-audit"); } },
  ]) {
    const sc = await seedScenario();
    const req = request(sc);
    await assert.rejects(receiveInventoryStock(req, makeDeps(sc, over).deps));
    assert.equal((await db.collection("receiving_orders").doc(receivingOrderDocId(req.idempotencyKey)).get()).exists, false, JSON.stringify(Object.keys(over)));
    assert.equal((await db.collection("reorder_requests").doc(sc.rrid).get()).data().status, "ORDERED");
    assert.equal(await countAt("receiving_audit_test", "receivingId", receivingOrderDocId(req.idempotencyKey)), 0);
  }
});

// ---- idempotency ------------------------------------------------------------------------------
await check("exact retry -> replayed, no duplicate order/event/closeout/audit", async () => {
  const sc = await seedScenario();
  const req = request(sc);
  const { deps, audits } = makeDeps(sc);
  const a = await receiveInventoryStock(req, deps);
  const b = await receiveInventoryStock(req, deps);
  assert.equal(a.outcome, "applied"); assert.equal(b.outcome, "replayed");
  assert.equal(a.receivingId, b.receivingId); assert.equal(a.ledgerEventId, b.ledgerEventId);
  assert.equal(audits.length, 1);
  assert.equal(await countAt("receiving_orders", "receivingId", a.receivingId), 1);
});

// ---- P1: exact retry at a LATER clock still replays (occurredAt tied to order createdAt) --------
await check("exact retry at a later clock time replays (not a conflict)", async () => {
  const sc = await seedScenario();
  const req = request(sc);
  const a = await receiveInventoryStock(req, makeDeps(sc).deps); // now = NOW
  const b = await receiveInventoryStock(req, makeDeps(sc, { now: () => new Date(NOW.getTime() + 3_600_000) }).deps); // +1h
  assert.equal(b.outcome, "replayed"); // NOT a conflict, despite the later clock
  assert.equal(a.ledgerEventId, b.ledgerEventId); // same ledger event (no duplicate)
  assert.equal((await db.collection("inventory_transactions").doc(a.ledgerEventId).get()).exists, true);
});

// ---- P2: collision-free per-line ledger idempotency key ----------------------------------------
await check("delimiter-colliding (idempotencyKey,lineId) pairs produce DISTINCT ledger events", async () => {
  // Under naive `recv:${idempotencyKey}:${lineId}`, (K + ":x", "y") and (K, "x:y") both collide on
  // `recv:K:x:y`. The collision property is what this pins.
  //
  // K IS RUN-SCOPED. It used to be the literal "k". A LEGACY receipt's document id is
  // rcv_sha256(idempotencyKey) -- deterministic and deliberately NOT scoped to the order -- so a fixed
  // key resolves to the same document on every run, and a second run against a long-lived emulator
  // fails with an idempotency conflict against its own previous run. That is a fixture collision, not
  // a product defect; the production identity rules are pinned separately in
  // receiveCanonicalMultiLine.test.mjs (same raw key on different POs, and legacy/canonical namespace
  // disjointness).
  const K = `k-${runId}-${(seq += 1)}`;
  const a = await seedScenario();
  const b = await seedScenario();
  const outA = await receiveInventoryStock(request(a, { idempotencyKey: `${K}:x`, lines: [{ lineId: "y", partId: a.partId, expectedQuantity: a.orderedQuantity, receivedQuantity: a.orderedQuantity }] }), makeDeps(a).deps);
  const outB = await receiveInventoryStock(request(b, { idempotencyKey: K, lines: [{ lineId: "x:y", partId: b.partId, expectedQuantity: b.orderedQuantity, receivedQuantity: b.orderedQuantity }] }), makeDeps(b).deps);
  assert.equal(outA.outcome, "applied"); assert.equal(outB.outcome, "applied");
  assert.notEqual(outA.ledgerEventId, outB.ledgerEventId, "colliding pairs must not share a ledger event");
});

await check("same idempotency key with a changed payload conflicts", async () => {
  const sc = await seedScenario();
  const req = request(sc);
  await receiveInventoryStock(req, makeDeps(sc).deps);
  const changed = { ...req, receivingLocation: { type: "MOBILE", locationId: "1" } };
  await assert.rejects(receiveInventoryStock(changed, makeDeps(sc).deps), (e) => e instanceof IdempotencyConflictError);
});

await check("malformed stored Receiving record fails closed", async () => {
  const sc = await seedScenario();
  const req = request(sc);
  const docId = receivingOrderDocId(req.idempotencyKey);
  await db.collection("receiving_orders").doc(docId).set({ schemaVersion: 1, receivingId: docId, bogus: true });
  await assert.rejects(receiveInventoryStock(req, makeDeps(sc).deps), (e) => e instanceof MalformedStoredRecordError);
});

// ---- concurrency ------------------------------------------------------------------------------
await check("concurrent source-status change prevents a stale commit", async () => {
  const sc = await seedScenario();
  const req = request(sc);
  const deps = makeDeps(sc, { __afterSourceReadHook: async () => { await writerDb.collection("reorder_requests").doc(sc.rrid).update({ status: "CANCELLED" }); } }).deps;
  await assert.rejects(receiveInventoryStock(req, deps));
  assert.equal((await db.collection("receiving_orders").doc(receivingOrderDocId(req.idempotencyKey)).get()).exists, false);
  assert.notEqual((await db.collection("reorder_requests").doc(sc.rrid).get()).data().status, "RECEIVED");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
