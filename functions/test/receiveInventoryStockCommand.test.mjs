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
const { receivingOrderDocId, canonicalReceivingOrderDocId } = await import("../lib/inventoryReceiving/receivingRepository.js");
const { ReorderSourceFrozenError } = await import("../lib/reorderRequest/reorderSourceFreeze.js");

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

// REORDER SOURCE FREEZE (Catalog + Reorder cutover, step 2): the legacy REORDER_PURCHASE_ORDER receipt branch is frozen,
// so the receiving DOMAIN proofs below run against the unfrozen CANONICAL purchase_orders source through the SAME
// command (ruling B), and the legacy-only behaviour is pinned as the governed FROZEN refusal (ruling A).
async function seedScenario({ orderedQuantity = 5, poStatus = "SENT", grant = true, lineIds = ["L1"] } = {}) {
  const poId = nextId("po");
  const partId = nextId("part");
  const actorId = nextId("actor");
  await db.collection("purchase_orders").doc(poId).set({ supplierId: nextId("sup"), status: poStatus, items: lineIds.map((lineId) => ({ lineId, partId, quantity: orderedQuantity, unitPrice: 1 })), totalCost: orderedQuantity });
  if (grant) await db.collection("receiving_grants").doc(actorId).set({ granted: true });
  return { poId, partId, actorId, orderedQuantity };
}
// The LEGACY fixture -- used ONLY to prove the freeze refuses it (ruling A).
async function seedLegacy({ orderedQuantity = 5, reqStatus = "ORDERED" } = {}) {
  const rrid = nextId("rr");
  const partId = nextId("part");
  const actorId = nextId("actor");
  await db.collection("reorder_purchase_orders").doc(rrid).set({ reorderRequestId: rrid, partId, supplierName: "ACME", externalPoNumber: "PO-1", orderedQuantity, orderedDate: 1, expectedArrivalDate: null, status: "ORDERED", createdBy: "x", createdAt: 1 });
  await db.collection("reorder_requests").doc(rrid).set({ partId, status: reqStatus, purchaseOrderId: rrid, receivedBy: null, receivedAt: null, orderedBy: "x", orderedAt: 1 });
  await db.collection("receiving_grants").doc(actorId).set({ granted: true });
  return { rrid, partId, actorId, orderedQuantity };
}
function legacyRequest(sc, over = {}) {
  return {
    source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId: sc.rrid, purchaseOrderId: sc.rrid },
    receivingLocation: { type: "WAREHOUSE", locationId: "WH-1" },
    lines: [{ lineId: "L1", partId: sc.partId, expectedQuantity: sc.orderedQuantity, receivedQuantity: sc.orderedQuantity }],
    idempotencyKey: nextId("idem"),
    ...over,
  };
}
// THE FROZEN REFUSAL, and that nothing was written: no receipt, no ledger event, no audit, reorder request unchanged,
// legacy PO byte-identical.
async function assertLegacyFrozen(sc, req, deps) {
  const rrBefore = (await db.collection("reorder_requests").doc(sc.rrid).get()).data();
  const poBefore = (await db.collection("reorder_purchase_orders").doc(sc.rrid).get()).data();
  await assert.rejects(receiveInventoryStock(req, deps), (e) => e instanceof ReorderSourceFrozenError && e.code === "REORDER_SOURCE_FROZEN" && e.writer === "receiveInventoryStockLegacyReorder");
  const receivingId = receivingOrderDocId(req.idempotencyKey);
  assert.equal((await db.collection("receiving_orders").doc(receivingId).get()).exists, false, "no receiving order");
  assert.equal(await countAt("inventory_transactions", "sourceObject.id", receivingId), 0, "no ledger event");
  assert.equal(await countAt("receiving_audit_test", "receivingId", receivingId), 0, "no audit");
  assert.deepEqual((await db.collection("reorder_requests").doc(sc.rrid).get()).data(), rrBefore, "reorder request unchanged");
  assert.deepEqual((await db.collection("reorder_purchase_orders").doc(sc.rrid).get()).data(), poBefore, "legacy PO unchanged");
}
// The canonical receipt id (target + actor scoped).
const canonicalId = (sc, req, actorId = sc.actorId) => canonicalReceivingOrderDocId({ operation: "receiveInventoryStock", sourceType: "PURCHASE_ORDER", purchaseOrderId: sc.poId, actorId, idempotencyKey: req.idempotencyKey });
const poOf = async (sc) => (await db.collection("purchase_orders").doc(sc.poId).get()).data();
// The UNTRUSTED request payload -- NO actor (actor is trusted deps context).
function request(sc, over = {}) {
  return {
    source: { type: "PURCHASE_ORDER", purchaseOrderId: sc.poId },
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

// A partial line, so the canonical PO stays SENT and an exact retry of the same receipt is still receivable.
const partial = (sc, receivedQuantity = 2) => ({ lines: [{ lineId: "L1", partId: sc.partId, expectedQuantity: sc.orderedQuantity, receivedQuantity }] });

// ---- happy path -------------------------------------------------------------------------------
// Ruling B: the atomic NONE receipt (order + RECEIVED event + audit) is receiving domain logic -- proven on the canonical source.
await check("authorized NONE receipt succeeds atomically: one order + one RECEIVED event + PO lifecycle + audit", async () => {
  const sc = await seedScenario();
  const { deps, audits } = makeDeps(sc);
  const req = request(sc);
  const out = await receiveInventoryStock(req, deps);
  assert.equal(out.outcome, "applied");
  assert.equal(out.receivingId, canonicalId(sc, req));
  const ro = (await db.collection("receiving_orders").doc(out.receivingId).get()).data();
  assert.equal(ro.status, "PUTAWAY_COMPLETE"); assert.equal(ro.version, 1); assert.equal(ro.receivingId, out.receivingId);
  assert.equal(ro.createdBy, sc.actorId); assert.equal(ro.updatedBy, sc.actorId);
  const led = (await db.collection("inventory_transactions").doc(out.ledgerEventId).get()).data();
  assert.equal(led.type, "RECEIVED"); assert.equal(led.quantity, sc.orderedQuantity);
  assert.deepEqual(led.location, { type: "WAREHOUSE", locationId: "WH-1" });
  assert.deepEqual(led.sourceObject, { type: "RECEIVING_ORDER", id: out.receivingId });
  const po = await poOf(sc);
  assert.equal(po.status, "RECEIVED"); assert.equal(po.version, 1);
  assert.equal(audits.length, 1); assert.equal(audits[0].action, "receiveInventoryStock");
  assert.equal(await countAt("receiving_audit_test", "receivingId", out.receivingId), 1);
});

// Ruling A: a legacy REORDER_PURCHASE_ORDER receipt (the reorder ORDERED -> RECEIVED closeout) is a superseded Reorder source write.
await check("legacy REORDER_PURCHASE_ORDER receipt is refused FROZEN: no order, no event, no closeout, no audit; PO byte-identical", async () => {
  const sc = await seedLegacy();
  const { deps, audits } = makeDeps(sc);
  await assertLegacyFrozen(sc, legacyRequest(sc), deps);
  assert.equal(audits.length, 0, "no audit staged");
});

// ---- authorization ----------------------------------------------------------------------------
// Ruling B: capability denial is receiving domain logic -- proven on the canonical source.
await check("missing capability -> denied, zero writes", async () => {
  const sc = await seedScenario({ grant: false });
  const req = request(sc);
  const before = await poOf(sc);
  await assert.rejects(receiveInventoryStock(req, makeDeps(sc).deps), (e) => e instanceof UnauthorizedReceivingError);
  assert.deepEqual(await poOf(sc), before);
  assert.equal((await db.collection("receiving_orders").doc(canonicalId(sc, req)).get()).exists, false);
});

// Ruling B: commit-time revocation is receiving domain logic -- proven on the canonical source.
await check("authorization revoked during the transaction cannot commit", async () => {
  const sc = await seedScenario();
  const req = request(sc);
  const before = await poOf(sc);
  const { deps } = makeDeps(sc, { __afterAuthReadHook: async () => { await writerDb.collection("receiving_grants").doc(sc.actorId).delete(); } });
  await assert.rejects(receiveInventoryStock(req, deps));
  assert.equal((await db.collection("receiving_orders").doc(canonicalId(sc, req)).get()).exists, false);
  assert.deepEqual(await poOf(sc), before);
});

// ---- P2: actor must be trusted context, NOT the untrusted request ------------------------------
// Ruling B: request-shape validation is receiving domain logic -- proven on the canonical source.
await check("an actor embedded in the request is rejected (unknown field)", async () => {
  const sc = await seedScenario();
  await assert.rejects(receiveInventoryStock(request(sc, { actor: { kind: "USER", id: "evil" } }), makeDeps(sc).deps), (e) => e instanceof SourceNotReceivableError);
});

// ---- source / destination / part --------------------------------------------------------------
// Ruling B: source existence / receivable-state checks are receiving domain logic -- proven on the canonical source.
await check("missing / wrong-status PO fails closed", async () => {
  const missing = { poId: nextId("none"), partId: "p", actorId: nextId("a"), orderedQuantity: 5 };
  await db.collection("receiving_grants").doc(missing.actorId).set({ granted: true });
  await assert.rejects(receiveInventoryStock(request(missing), makeDeps(missing).deps), (e) => e instanceof SourceNotFoundError);
  const wrong = await seedScenario({ poStatus: "CANCELLED" });
  await assert.rejects(receiveInventoryStock(request(wrong), makeDeps(wrong).deps), (e) => e instanceof SourceNotReceivableError);
});

// Ruling A: the reorder-request ORDERED precondition exists only on the frozen legacy branch; it is now refused FROZEN.
await check("wrong-status reorder request: the legacy receipt is refused FROZEN before the reorder request is read", async () => {
  const sc = await seedLegacy({ reqStatus: "RECEIVED" });
  await assertLegacyFrozen(sc, legacyRequest(sc), makeDeps(sc).deps);
});

// Ruling A: PO/reorder-request part coherence exists only on the frozen legacy branch; it is now refused FROZEN.
await check("PO/request part identity mismatch: the legacy receipt is refused FROZEN, nothing written", async () => {
  const sc = await seedLegacy();
  await db.collection("reorder_requests").doc(sc.rrid).update({ partId: "DIFFERENT" });
  await assertLegacyFrozen(sc, legacyRequest(sc), makeDeps(sc).deps);
});

// Ruling B: destination validation is receiving domain logic -- proven on the canonical source.
await check("inactive / wrong-type destination fails closed", async () => {
  const sc = await seedScenario();
  await assert.rejects(receiveInventoryStock(request(sc), makeDeps(sc, { resolveLocationActive: async () => false }).deps), (e) => e instanceof DestinationInvalidError);
  const sc2 = await seedScenario();
  await assert.rejects(receiveInventoryStock(request(sc2, { receivingLocation: { type: "NOPE", locationId: "x" } }), makeDeps(sc2).deps), (e) => e instanceof SourceNotReceivableError || e instanceof DestinationInvalidError);
});

// Ruling B: Part authority validation is receiving domain logic -- proven on the canonical source.
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
// Ruling B: tracking-mode policy is receiving domain logic -- proven on the canonical source.
await check("LOT part still fails closed", async () => {
  const sc = await seedScenario();
  await assert.rejects(receiveInventoryStock(request(sc), makeDeps(sc, { resolvePart: async (_t, partId) => ({ partId, trackingMode: "LOT", active: true }) }).deps), (e) => e instanceof PartInvalidError);
});

// Ruling B: serial-identity enforcement is receiving domain logic -- proven on the canonical source.
await check("a SERIAL part is refused when the request carries no serial identity", async () => {
  // Guards the seam between the two suites: a SERIAL part received through a NONE-shaped request must
  // not quietly succeed as an untracked receipt.
  const sc = await seedScenario();
  await assert.rejects(receiveInventoryStock(request(sc), makeDeps(sc, { resolvePart: async (_t, partId) => ({ partId, trackingMode: "SERIAL", active: true }) }).deps));
  assert.equal((await db.collection("serialized_assets").where("partId", "==", sc.partId).get()).size, 0);
});

// Ruling B (empty lines, zero / negative / over-receipt quantities: receiving domain logic, proven on the canonical source)
// + Ruling A (the one-line and full-quantity-only rules are LEGACY-only: a legacy multi-line or partial receipt is now
// refused FROZEN before validation; the canonical source legitimately accepts both).
await check("empty lines and bad quantities fail closed; legacy multi-line / partial receipts are refused FROZEN", async () => {
  const sc = await seedScenario();
  await assert.rejects(receiveInventoryStock(request(sc, { lines: [] }), makeDeps(sc).deps), (e) => e instanceof SourceNotReceivableError);
  for (const q of [0, -1, 9]) {
    const s = await seedScenario();
    await assert.rejects(receiveInventoryStock(request(s, { lines: [{ lineId: "L1", partId: s.partId, expectedQuantity: s.orderedQuantity, receivedQuantity: q }] }), makeDeps(s).deps), (e) => e instanceof SourceNotReceivableError);
  }
  const l2 = await seedLegacy();
  await assertLegacyFrozen(l2, legacyRequest(l2, { lines: [{ lineId: "L1", partId: l2.partId, expectedQuantity: 5, receivedQuantity: 5 }, { lineId: "L2", partId: l2.partId, expectedQuantity: 5, receivedQuantity: 5 }] }), makeDeps(l2).deps);
  const l3 = await seedLegacy();
  await assertLegacyFrozen(l3, legacyRequest(l3, { lines: [{ lineId: "L1", partId: l3.partId, expectedQuantity: l3.orderedQuantity, receivedQuantity: 3 }] }), makeDeps(l3).deps);
});

// ---- atomic rollback --------------------------------------------------------------------------
// Ruling B: all-or-nothing commit is receiving domain logic -- proven on the canonical source.
await check("injected failure at each stage -> zero committed changes", async () => {
  for (const over of [
    { __afterAuthReadHook: async () => { throw new Error("boom-authz"); } },
    { resolvePart: async () => { throw new Error("boom-part"); } },
    { resolveLocationActive: async () => { throw new Error("boom-loc"); } },
    { stageAudit: () => { throw new Error("boom-audit"); } },
  ]) {
    const sc = await seedScenario();
    const req = request(sc);
    const before = await poOf(sc);
    await assert.rejects(receiveInventoryStock(req, makeDeps(sc, over).deps));
    assert.equal((await db.collection("receiving_orders").doc(canonicalId(sc, req)).get()).exists, false, JSON.stringify(Object.keys(over)));
    assert.deepEqual(await poOf(sc), before);
    assert.equal(await countAt("receiving_audit_test", "receivingId", canonicalId(sc, req)), 0);
  }
});

// ---- idempotency ------------------------------------------------------------------------------
// Ruling B: replay idempotency is receiving domain logic -- proven on the canonical source (partial, so the PO stays receivable).
await check("exact retry -> replayed, no duplicate order/event/audit", async () => {
  const sc = await seedScenario();
  const req = request(sc, partial(sc));
  const { deps, audits } = makeDeps(sc);
  const a = await receiveInventoryStock(req, deps);
  const b = await receiveInventoryStock(req, deps);
  assert.equal(a.outcome, "applied"); assert.equal(b.outcome, "replayed");
  assert.equal(a.receivingId, b.receivingId); assert.equal(a.ledgerEventId, b.ledgerEventId);
  assert.equal(audits.length, 1);
  assert.equal(await countAt("receiving_orders", "receivingId", a.receivingId), 1);
  assert.equal((await poOf(sc)).version, 1, "a replay does not bump the PO version");
});

// ---- P1: exact retry at a LATER clock still replays (occurredAt tied to order createdAt) --------
// Ruling B: occurredAt stability is receiving domain logic -- proven on the canonical source.
await check("exact retry at a later clock time replays (not a conflict)", async () => {
  const sc = await seedScenario();
  const req = request(sc, partial(sc));
  const a = await receiveInventoryStock(req, makeDeps(sc).deps); // now = NOW
  const b = await receiveInventoryStock(req, makeDeps(sc, { now: () => new Date(NOW.getTime() + 3_600_000) }).deps); // +1h
  assert.equal(b.outcome, "replayed"); // NOT a conflict, despite the later clock
  assert.equal(a.ledgerEventId, b.ledgerEventId); // same ledger event (no duplicate)
  assert.equal((await db.collection("inventory_transactions").doc(a.ledgerEventId).get()).exists, true);
});

// ---- P2: collision-free per-line ledger idempotency key ----------------------------------------
// Ruling B: the ledger idempotency key derivation is receiving domain logic -- proven on the canonical source, on ONE PO
// whose two line ids are the delimiter-colliding pair.
await check("delimiter-colliding (idempotencyKey,lineId) pairs produce DISTINCT ledger events", async () => {
  // Under naive `recv:${idempotencyKey}:${lineId}`, (K + ":x", "y") and (K, "x:y") both collide on
  // `recv:K:x:y`. The collision property is what this pins. K is run-scoped so a long-lived emulator
  // never replays a previous run's receipt (a fixture collision, not a product defect).
  const K = `k-${runId}-${(seq += 1)}`;
  const sc = await seedScenario({ lineIds: ["y", "x:y"] });
  const outA = await receiveInventoryStock(request(sc, { idempotencyKey: `${K}:x`, lines: [{ lineId: "y", partId: sc.partId, expectedQuantity: sc.orderedQuantity, receivedQuantity: sc.orderedQuantity }] }), makeDeps(sc).deps);
  const outB = await receiveInventoryStock(request(sc, { idempotencyKey: K, lines: [{ lineId: "x:y", partId: sc.partId, expectedQuantity: sc.orderedQuantity, receivedQuantity: sc.orderedQuantity }] }), makeDeps(sc).deps);
  assert.equal(outA.outcome, "applied"); assert.equal(outB.outcome, "applied");
  assert.notEqual(outA.ledgerEventId, outB.ledgerEventId, "colliding pairs must not share a ledger event");
});

// Ruling B: idempotency conflict detection is receiving domain logic -- proven on the canonical source.
await check("same idempotency key with a changed payload conflicts", async () => {
  const sc = await seedScenario();
  const req = request(sc, partial(sc));
  await receiveInventoryStock(req, makeDeps(sc).deps);
  const changed = { ...req, receivingLocation: { type: "MOBILE", locationId: "1" } };
  await assert.rejects(receiveInventoryStock(changed, makeDeps(sc).deps), (e) => e instanceof IdempotencyConflictError);
});

// Ruling B: stored-record validation is receiving domain logic -- proven on the canonical source (canonical receipt id).
await check("malformed stored Receiving record fails closed", async () => {
  const sc = await seedScenario();
  const req = request(sc);
  const docId = canonicalId(sc, req);
  await db.collection("receiving_orders").doc(docId).set({ schemaVersion: 1, receivingId: docId, bogus: true });
  await assert.rejects(receiveInventoryStock(req, makeDeps(sc).deps), (e) => e instanceof MalformedStoredRecordError);
});

// ---- concurrency ------------------------------------------------------------------------------
// Ruling B: a concurrent source change must not commit a stale receipt -- proven on the canonical PO (its own status).
await check("concurrent source-status change prevents a stale commit", async () => {
  const sc = await seedScenario();
  const req = request(sc);
  const deps = makeDeps(sc, { __afterSourceReadHook: async () => { await writerDb.collection("purchase_orders").doc(sc.poId).update({ status: "CANCELLED" }); } }).deps;
  await assert.rejects(receiveInventoryStock(req, deps));
  assert.equal((await db.collection("receiving_orders").doc(canonicalId(sc, req)).get()).exists, false);
  assert.notEqual((await poOf(sc)).status, "RECEIVED");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
