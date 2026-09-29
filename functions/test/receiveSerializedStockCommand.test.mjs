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
import "./support/firebaseEmulatorGuard.cjs"; // FIRST: Firebase test-safety guard (emulator mode) -- see test/support/firebaseTestGuard.cjs
import assert from "node:assert/strict";
import admin from "firebase-admin";
admin.initializeApp({ projectId: "demo-eos-test" });
const db = admin.firestore();
const { FieldValue } = admin.firestore;

const cmd = await import("../lib/inventoryReceiving/receiveInventoryStockCommand.js");
const { receiveInventoryStock, PartInvalidError, SerialIdentityConflictError } = cmd;
const { receivingOrderDocId, canonicalReceivingOrderDocId } = await import("../lib/inventoryReceiving/receivingRepository.js");
const { ReorderSourceFrozenError } = await import("../lib/reorderRequest/reorderSourceFreeze.js");
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

// REORDER SOURCE FREEZE (Catalog + Reorder cutover, step 2): the legacy REORDER_PURCHASE_ORDER receipt branch is frozen,
// so every SERIAL domain proof below runs against the unfrozen CANONICAL purchase_orders source through the SAME command
// (ruling B). The PO orders TWICE what each receipt takes, so a receipt is partial, the PO stays SENT, and an exact retry is
// still within the remaining quantity (the canonical replay is validated against remaining -- a known, pre-existing
// canonical-path behaviour, not part of the freeze). The legacy branch itself is pinned as the FROZEN refusal at the end (ruling A).
async function seedScenario({ orderedQuantity = 3, grant = true, partId = nextId("part") } = {}) {
  const poId = nextId("po");
  const actorId = nextId("actor");
  await db.collection("purchase_orders").doc(poId).set({ supplierId: nextId("sup"), status: "SENT", items: [{ lineId: "L1", partId, quantity: orderedQuantity * 2, unitPrice: 1 }], totalCost: orderedQuantity * 2 });
  if (grant) await db.collection("receiving_grants").doc(actorId).set({ granted: true });
  return { poId, partId, actorId, orderedQuantity };
}
const receiptId = (sc, req) => canonicalReceivingOrderDocId({ operation: "receiveInventoryStock", sourceType: "PURCHASE_ORDER", purchaseOrderId: sc.poId, actorId: sc.actorId, idempotencyKey: req.idempotencyKey });

function serials(sc, n = sc.orderedQuantity) {
  return Array.from({ length: n }, (_, i) => `${sc.partId}-SN-${i + 1}`);
}

function request(sc, over = {}) {
  const { line: lineOver, ...top } = over;
  return {
    source: { type: "PURCHASE_ORDER", purchaseOrderId: sc.poId },
    receivingLocation: { type: "WAREHOUSE", locationId: "WH-1" },
    lines: [{
      lineId: "L1", partId: sc.partId,
      expectedQuantity: sc.orderedQuantity * 2, receivedQuantity: sc.orderedQuantity,
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
// Ruling B: SERIAL activation is receiving domain logic -- proven on the canonical source.
await check("SERIAL receipt activates one Serialized Asset per unit, atomically with the receipt", async () => {
  const sc = await seedScenario();
  const { deps, audits } = makeDeps(sc);
  const req = request(sc);
  const out = await receiveInventoryStock(req, deps);

  assert.equal(out.outcome, "applied");
  assert.equal(out.receivingId, receiptId(sc, req));
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

  // The PO lifecycle moves exactly as for a NONE receipt (canonical: the version serializes every receipt).
  assert.equal((await db.collection("purchase_orders").doc(sc.poId).get()).data().version, 1);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].serialCount, 3);
});

// Ruling B: per-unit ledger staging is receiving domain logic -- proven on the canonical source.
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
// Ruling B: replay idempotency is receiving domain logic -- proven on the canonical source.
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

// Ruling B: idempotency conflict on serial identity is receiving domain logic -- proven on the canonical source.
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
// Ruling B: serial uniqueness is receiving domain logic -- proven on the canonical source (a second canonical PO).
await check("the SAME physical unit cannot be received twice (duplicate serial fails the whole receipt)", async () => {
  const scA = await seedScenario({ orderedQuantity: 2 });
  const { deps: depsA } = makeDeps(scA);
  await receiveInventoryStock(request(scA, { line: { serialNumbers: ["DUP-1", "DUP-2"] } }), depsA);

  // A SECOND, independent receipt of the same part re-presenting one of those serials.
  const scB = await seedScenario({ orderedQuantity: 2, partId: scA.partId });
  const { deps: depsB } = makeDeps(scB);

  await assert.rejects(
    () => receiveInventoryStock(request(scB, { line: { serialNumbers: ["DUP-2", "DUP-3"] } }), depsB),
    (e) => e instanceof SerialIdentityConflictError && e.code === "SERIAL_IDENTITY_CONFLICT",
  );

  // Fails CLOSED: the non-conflicting serial from the rejected receipt was not created either, and
  // the second receipt left no receiving order and no stock effect behind.
  assert.equal((await db.collection(SERIALIZED_ASSETS_COLLECTION).doc(serializedAssetDocId(scA.partId, "DUP-3")).get()).exists, false);
  assert.equal((await assetsFor(scA.partId)).length, 2);
  assert.equal((await db.collection("receiving_orders").where("source.purchaseOrderId", "==", scB.poId).get()).size, 0);
  assert.equal((await db.collection("purchase_orders").doc(scB.poId).get()).data().version, undefined, "the second PO is untouched");
});

// Ruling B: per-part serial identity is receiving domain logic -- proven on the canonical source.
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
// Ruling B: all-or-nothing SERIAL commit is receiving domain logic -- proven on the canonical source. The failure is now
// injected at the audit stage (step 13), which runs after the assets and ledger events were staged (steps 9/9b).
await check("a failure AFTER serial staging creates NEITHER asset NOR stock effect", async () => {
  const sc = await seedScenario();
  const { deps } = makeDeps(sc, { stageAudit: () => { throw new Error("boom-after-serial-staging"); } });
  const req = request(sc);

  await assert.rejects(() => receiveInventoryStock(req, deps), /boom-after-serial-staging/);

  assert.equal((await assetsFor(sc.partId)).length, 0, "no Serialized Asset may survive a failed receipt");
  assert.equal((await ledgerFor(receiptId(sc, req))).length, 0);
  assert.equal((await db.collection("receiving_orders").doc(receiptId(sc, req)).get()).exists, false);
});

// Ruling B: capability denial is receiving domain logic -- proven on the canonical source.
await check("an unauthorized actor is denied and creates nothing", async () => {
  const sc = await seedScenario({ grant: false });
  const { deps } = makeDeps(sc);
  const req = request(sc);
  await assert.rejects(() => receiveInventoryStock(req, deps), (e) => e.code === "PERMISSION_DENIED");
  assert.equal((await assetsFor(sc.partId)).length, 0);
  assert.equal((await db.collection("receiving_orders").doc(receiptId(sc, req)).get()).exists, false);
});

// ---- serial input validation at the command boundary -------------------------------------------
// Ruling B: serial input validation is receiving domain logic -- proven on the canonical source.
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
// Ruling B: tracking-mode policy is receiving domain logic -- proven on the canonical source.
await check("LOT is still refused", async () => {
  const sc = await seedScenario();
  const { deps } = makeDeps(sc, { resolvePart: async (_t, partId) => ({ partId, trackingMode: "LOT", active: true }) });
  await assert.rejects(
    () => receiveInventoryStock(request(sc), deps),
    (e) => e instanceof PartInvalidError,
  );
  assert.equal((await assetsFor(sc.partId)).length, 0);
});

// Ruling B: NONE receipt shape is receiving domain logic -- proven on the canonical source.
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

// Ruling B: serial-identity placement is receiving domain logic -- proven on the canonical source.
await check("a NONE receipt carrying serialNumbers is REFUSED (no second home for serial identity)", async () => {
  const sc = await seedScenario();
  const { deps } = makeDeps(sc, { resolvePart: async (_t, partId) => ({ partId, trackingMode: "NONE", active: true }) });
  await assert.rejects(() => receiveInventoryStock(request(sc), deps));
  assert.equal((await assetsFor(sc.partId)).length, 0);
});

// Ruling A: a legacy REORDER_PURCHASE_ORDER SERIAL receipt is a superseded Reorder source write -- refused FROZEN before
// any serial is staged: no asset, no ledger event, no receiving order, reorder request still ORDERED.
await check("a legacy REORDER_PURCHASE_ORDER SERIAL receipt is refused FROZEN and activates nothing", async () => {
  const rrid = nextId("rr"), partId = nextId("part"), actorId = nextId("actor");
  await db.collection("reorder_purchase_orders").doc(rrid).set({ reorderRequestId: rrid, partId, supplierName: "ACME", externalPoNumber: "PO-1", orderedQuantity: 2, orderedDate: 1, expectedArrivalDate: null, status: "ORDERED", createdBy: "x", createdAt: 1 });
  await db.collection("reorder_requests").doc(rrid).set({ partId, status: "ORDERED", purchaseOrderId: rrid, receivedBy: null, receivedAt: null, orderedBy: "x", orderedAt: 1 });
  await db.collection("receiving_grants").doc(actorId).set({ granted: true });
  const req = {
    source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId: rrid, purchaseOrderId: rrid },
    receivingLocation: { type: "WAREHOUSE", locationId: "WH-1" },
    lines: [{ lineId: "L1", partId, expectedQuantity: 2, receivedQuantity: 2, serialNumbers: [`${partId}-SN-1`, `${partId}-SN-2`] }],
    idempotencyKey: nextId("idem"),
  };
  const { deps, audits } = makeDeps({ actorId });
  await assert.rejects(() => receiveInventoryStock(req, deps), (e) => e instanceof ReorderSourceFrozenError && e.code === "REORDER_SOURCE_FROZEN");
  assert.equal((await assetsFor(partId)).length, 0);
  assert.equal((await ledgerFor(receivingOrderDocId(req.idempotencyKey))).length, 0);
  assert.equal((await db.collection("receiving_orders").doc(receivingOrderDocId(req.idempotencyKey)).get()).exists, false);
  assert.equal((await db.collection("reorder_requests").doc(rrid).get()).data().status, "ORDERED");
  assert.equal(audits.length, 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
