// Wave 7 slice B -- Firestore-emulator tests for SERIAL receipt through the EXISTING governed
// receiveInventoryStock command (Owner decision:
// docs/releases/serialized-asset-registry-slice-b-boundary.md).
//
// What these lock, beyond "it works":
//   * the Serialized Asset is created ATOMICALLY with the receipt -- never one without the other;
//   * a failure creates NEITHER the asset NOR the stock effect;
//   * the same physical unit cannot be received twice (duplicate serial fails the whole receipt);
//   * a retry replays without creating a second asset or a second ledger effect;
//   * SERIAL stages one ledger event PER UNIT (the ledger's own rule), not one bulk event;
//   * LOT is still refused, and NONE receipts are entirely unchanged.
//
// Requires the Firestore emulator. Imports the compiled ../lib output. Never touches production.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
import assert from "node:assert/strict";
import admin from "firebase-admin";
admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();
const { FieldValue } = admin.firestore;

const cmd = await import("../lib/inventoryReceiving/receiveInventoryStockCommand.js");
const { receiveInventoryStock, PartInvalidError, SerialIdentityConflictError } = cmd;
const { receivingOrderDocId } = await import("../lib/inventoryReceiving/receivingRepository.js");
const { serializedAssetDocId } = await import("../lib/serializedAsset/serializedAssetRegistration.js");
const { SERIALIZED_ASSETS_COLLECTION } = await import("../lib/constants/collections.js");

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS: ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL: ${name}`); console.error(err); }
}
const runId = Date.now();
let seq = 0;
const nextId = (p) => `${p}-${runId}-${(seq += 1)}`;
const NOW = new Date(1_700_000_000_000);

async function seedScenario({ orderedQuantity = 3, grant = true } = {}) {
  const rrid = nextId("rr");
  const partId = nextId("part");
  const actorId = nextId("actor");
  await db.collection("reorder_purchase_orders").doc(rrid).set({ reorderRequestId: rrid, partId, supplierName: "ACME", externalPoNumber: "PO-1", orderedQuantity, orderedDate: 1, expectedArrivalDate: null, status: "ORDERED", createdBy: "x", createdAt: 1 });
  await db.collection("reorder_requests").doc(rrid).set({ partId, status: "ORDERED", purchaseOrderId: rrid, receivedBy: null, receivedAt: null, orderedBy: "x", orderedAt: 1 });
  if (grant) await db.collection("receiving_grants").doc(actorId).set({ granted: true });
  return { rrid, partId, actorId, orderedQuantity };
}

function serials(sc, n = sc.orderedQuantity) {
  return Array.from({ length: n }, (_, i) => `${sc.partId}-SN-${i + 1}`);
}

function request(sc, over = {}) {
  const { line: lineOver, ...top } = over;
  return {
    source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId: sc.rrid, purchaseOrderId: sc.rrid },
    receivingLocation: { type: "WAREHOUSE", locationId: "WH-1" },
    lines: [{
      lineId: "L1", partId: sc.partId,
      expectedQuantity: sc.orderedQuantity, receivedQuantity: sc.orderedQuantity,
      serialNumbers: serials(sc),
      ...(lineOver || {}),
    }],
    idempotencyKey: nextId("idem"),
    ...top,
  };
}

function makeDeps(sc, over = {}) {
  const audits = [];
  const deps = {
    db,
    actor: { kind: "USER", id: sc.actorId },
    authorize: async (txn, actorId) => { const s = await txn.get(db.collection("receiving_grants").doc(actorId)); return s.exists && s.data().granted === true; },
    resolvePart: async (_txn, partId) => ({ partId, trackingMode: "SERIAL", active: true }),
    resolveLocationActive: async () => true,
    stageAudit: (txn, audit) => { audits.push(audit); txn.create(db.collection("receiving_audit_test").doc(audit.receivingId), { ...audit, at: FieldValue.serverTimestamp() }); },
    now: () => NOW,
    ...over,
  };
  return { deps, audits };
}

const ledgerFor = async (receivingId) =>
  (await db.collection("inventory_transactions").where("sourceObject.id", "==", receivingId).get()).docs.map((d) => d.data());
const assetsFor = async (partId) =>
  (await db.collection(SERIALIZED_ASSETS_COLLECTION).where("partId", "==", partId).get()).docs.map((d) => d.data());

// ---- happy path ------------------------------------------------------------------------------
await check("SERIAL receipt activates one Serialized Asset per unit, atomically with the receipt", async () => {
  const sc = await seedScenario();
  const { deps, audits } = makeDeps(sc);
  const req = request(sc);
  const out = await receiveInventoryStock(req, deps);

  assert.equal(out.outcome, "applied");
  assert.equal(out.receivingId, receivingOrderDocId(req.idempotencyKey));
  assert.equal(out.serializedAssetIds.length, 3);

  const assets = await assetsFor(sc.partId);
  assert.equal(assets.length, 3);
  for (const sn of serials(sc)) {
    const doc = (await db.collection(SERIALIZED_ASSETS_COLLECTION).doc(serializedAssetDocId(sc.partId, sn)).get()).data();
    assert.ok(doc, `no asset for ${sn}`);
    assert.equal(doc.serialNo, sn);
    assert.equal(doc.partId, sc.partId);
    // Specification section F: activated at its put-away location, in state RECEIVED.
    assert.equal(doc.inventoryState, "RECEIVED");
    assert.equal(doc.currentLocationId, "WH-1");
    // In inventory, NOT installed -- the install link is section H, which is not built.
    assert.equal(doc.currentEquipmentId, null);
    assert.equal(doc.ownership, "COMPANY");
    assert.equal(doc.activatedByReceivingId, out.receivingId);
    assert.equal(doc.createdByUid, sc.actorId);
  }

  // The receiving order records the serials it received.
  const ro = (await db.collection("receiving_orders").doc(out.receivingId).get()).data();
  assert.equal(ro.lines[0].trackingMode, "SERIAL");
  assert.deepEqual(ro.lines[0].serialNumbers, serials(sc));

  // Closeout still happens exactly as for a NONE receipt.
  assert.equal((await db.collection("reorder_requests").doc(sc.rrid).get()).data().status, "RECEIVED");
  assert.equal(audits.length, 1);
  assert.equal(audits[0].serialCount, 3);
});

await check("SERIAL stages one ledger event PER UNIT (quantity 1 + serialNo), never one bulk event", async () => {
  const sc = await seedScenario();
  const { deps } = makeDeps(sc);
  const out = await receiveInventoryStock(request(sc), deps);

  const events = await ledgerFor(out.receivingId);
  assert.equal(events.length, 3, "expected one ledger event per serialized unit");
  assert.equal(out.ledgerEventIds.length, 3);
  assert.equal(out.ledgerEventId, out.ledgerEventIds[0]);
  for (const ev of events) {
    assert.equal(ev.type, "RECEIVED");
    assert.equal(ev.quantity, 1); // the ledger's own SERIAL rule
    assert.ok(serials(sc).includes(ev.serialNo));
  }
  assert.equal(new Set(events.map((e) => e.serialNo)).size, 3);
});

// ---- idempotency / retry ----------------------------------------------------------------------
await check("an exact retry REPLAYS: no second asset, no second ledger effect", async () => {
  const sc = await seedScenario();
  const { deps } = makeDeps(sc);
  const req = request(sc);

  const first = await receiveInventoryStock(req, deps);
  const second = await receiveInventoryStock(req, deps); // same key, same payload

  assert.equal(first.outcome, "applied");
  assert.equal(second.outcome, "replayed");
  assert.deepEqual(second.serializedAssetIds, first.serializedAssetIds);
  assert.equal((await assetsFor(sc.partId)).length, 3, "retry must not create a second asset");
  assert.equal((await ledgerFor(first.receivingId)).length, 3, "retry must not create a second ledger effect");
});

await check("the same key with DIFFERENT serials conflicts -- and creates nothing new", async () => {
  const sc = await seedScenario();
  const { deps } = makeDeps(sc);
  const req = request(sc);
  await receiveInventoryStock(req, deps);

  const tampered = { ...req, lines: [{ ...req.lines[0], serialNumbers: [...serials(sc).slice(0, 2), `${sc.partId}-SN-ROGUE`] }] };
  await assert.rejects(() => receiveInventoryStock(tampered, deps));

  assert.equal((await assetsFor(sc.partId)).length, 3);
  assert.equal((await db.collection(SERIALIZED_ASSETS_COLLECTION).doc(serializedAssetDocId(sc.partId, `${sc.partId}-SN-ROGUE`)).get()).exists, false);
});

// ---- duplicate serial identity -----------------------------------------------------------------
await check("the SAME physical unit cannot be received twice (duplicate serial fails the whole receipt)", async () => {
  const scA = await seedScenario({ orderedQuantity: 2 });
  const { deps: depsA } = makeDeps(scA);
  await receiveInventoryStock(request(scA, { line: { serialNumbers: ["DUP-1", "DUP-2"] } }), depsA);

  // A SECOND, independent receipt of the same part re-presenting one of those serials.
  const scB = { ...scA, rrid: nextId("rr") };
  await db.collection("reorder_purchase_orders").doc(scB.rrid).set({ reorderRequestId: scB.rrid, partId: scA.partId, supplierName: "ACME", externalPoNumber: "PO-2", orderedQuantity: 2, orderedDate: 1, expectedArrivalDate: null, status: "ORDERED", createdBy: "x", createdAt: 1 });
  await db.collection("reorder_requests").doc(scB.rrid).set({ partId: scA.partId, status: "ORDERED", purchaseOrderId: scB.rrid, receivedBy: null, receivedAt: null, orderedBy: "x", orderedAt: 1 });
  const { deps: depsB } = makeDeps(scB);

  await assert.rejects(
    () => receiveInventoryStock(request(scB, { line: { serialNumbers: ["DUP-2", "DUP-3"] } }), depsB),
    (e) => e instanceof SerialIdentityConflictError && e.code === "SERIAL_IDENTITY_CONFLICT",
  );

  // Fails CLOSED: the non-conflicting serial from the rejected receipt was not created either, and
  // the second receipt left no receiving order and no stock effect behind.
  assert.equal((await db.collection(SERIALIZED_ASSETS_COLLECTION).doc(serializedAssetDocId(scA.partId, "DUP-3")).get()).exists, false);
  assert.equal((await assetsFor(scA.partId)).length, 2);
  assert.equal((await db.collection("reorder_requests").doc(scB.rrid).get()).data().status, "ORDERED");
});

await check("a serial already used by a DIFFERENT part is not a conflict (identity is per part)", async () => {
  // Serial numbers are only unique within a manufacturer's line, so two different Parts may carry the
  // same printed serial. Scoping identity to (partId, serialNo) is what keeps that legal.
  const scA = await seedScenario({ orderedQuantity: 1 });
  const scB = await seedScenario({ orderedQuantity: 1 });
  const { deps: depsA } = makeDeps(scA);
  const { deps: depsB } = makeDeps(scB);

  await receiveInventoryStock(request(scA, { line: { serialNumbers: ["SHARED-SN"] } }), depsA);
  const outB = await receiveInventoryStock(request(scB, { line: { serialNumbers: ["SHARED-SN"] } }), depsB);

  assert.equal(outB.outcome, "applied");
  assert.notEqual(serializedAssetDocId(scA.partId, "SHARED-SN"), serializedAssetDocId(scB.partId, "SHARED-SN"));
  assert.equal((await assetsFor(scA.partId)).length, 1);
  assert.equal((await assetsFor(scB.partId)).length, 1);
});

// ---- atomicity on failure ----------------------------------------------------------------------
await check("a failure AFTER serial staging creates NEITHER asset NOR stock effect", async () => {
  const sc = await seedScenario();
  // Reorder request is not ORDERED -> the command throws at closeout, after assets/ledger were staged.
  await db.collection("reorder_requests").doc(sc.rrid).update({ status: "RECEIVED" });
  const { deps } = makeDeps(sc);
  const req = request(sc);

  await assert.rejects(() => receiveInventoryStock(req, deps));

  assert.equal((await assetsFor(sc.partId)).length, 0, "no Serialized Asset may survive a failed receipt");
  assert.equal((await ledgerFor(receivingOrderDocId(req.idempotencyKey))).length, 0);
  assert.equal((await db.collection("receiving_orders").doc(receivingOrderDocId(req.idempotencyKey)).get()).exists, false);
});

await check("an unauthorized actor is denied and creates nothing", async () => {
  const sc = await seedScenario({ grant: false });
  const { deps } = makeDeps(sc);
  const req = request(sc);
  await assert.rejects(() => receiveInventoryStock(req, deps), (e) => e.code === "PERMISSION_DENIED");
  assert.equal((await assetsFor(sc.partId)).length, 0);
  assert.equal((await db.collection("receiving_orders").doc(receivingOrderDocId(req.idempotencyKey)).get()).exists, false);
});

// ---- serial input validation at the command boundary -------------------------------------------
await check("missing / miscounted / duplicated serials are refused and create nothing", async () => {
  for (const bad of [undefined, [], ["ONLY-1"], ["A", "A", "B"], ["A", "B", ""]]) {
    const sc = await seedScenario();
    const { deps } = makeDeps(sc);
    const line = bad === undefined ? { serialNumbers: undefined } : { serialNumbers: bad };
    const req = request(sc, { line });
    if (bad === undefined) delete req.lines[0].serialNumbers;
    await assert.rejects(() => receiveInventoryStock(req, deps), `expected rejection for ${JSON.stringify(bad)}`);
    assert.equal((await assetsFor(sc.partId)).length, 0);
  }
});

// ---- LOT still deferred, NONE unchanged --------------------------------------------------------
await check("LOT is still refused", async () => {
  const sc = await seedScenario();
  const { deps } = makeDeps(sc, { resolvePart: async (_t, partId) => ({ partId, trackingMode: "LOT", active: true }) });
  await assert.rejects(
    () => receiveInventoryStock(request(sc), deps),
    (e) => e instanceof PartInvalidError,
  );
  assert.equal((await assetsFor(sc.partId)).length, 0);
});

await check("a NONE receipt is unchanged: one bulk ledger event, and NO Serialized Asset", async () => {
  const sc = await seedScenario();
  const { deps } = makeDeps(sc, { resolvePart: async (_t, partId) => ({ partId, trackingMode: "NONE", active: true }) });
  const req = request(sc);
  delete req.lines[0].serialNumbers; // a NONE line carries no serial identity
  const out = await receiveInventoryStock(req, deps);

  assert.equal(out.outcome, "applied");
  assert.equal(out.serializedAssetIds, undefined);
  const events = await ledgerFor(out.receivingId);
  assert.equal(events.length, 1);
  assert.equal(events[0].quantity, sc.orderedQuantity);
  assert.equal(events[0].serialNo, undefined);
  assert.equal((await assetsFor(sc.partId)).length, 0);
});

await check("a NONE receipt carrying serialNumbers is REFUSED (no second home for serial identity)", async () => {
  const sc = await seedScenario();
  const { deps } = makeDeps(sc, { resolvePart: async (_t, partId) => ({ partId, trackingMode: "NONE", active: true }) });
  await assert.rejects(() => receiveInventoryStock(request(sc), deps));
  assert.equal((await assetsFor(sc.partId)).length, 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
