// BIN-P6 STOCK RELOCATION — emulator suite. Spec: docs/specifications/bin-stock-relocation-and-multi-scan.md.
//
// Run against the Firestore emulator:  FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node test/stockRelocationCommand.test.mjs
//
// The load-bearing assertions:
//   - CONSERVATION: every same-Warehouse relocation leaves the Warehouse aggregate -- as the real
//     availability reader computes it -- exactly unchanged;
//   - EXACT SOURCE: sufficiency never borrows from direct stock, a sibling bin, or another building;
//   - ONE SIGN RULE: consumption now reduces Transfer and Cycle Count on-hand, which it did not before;
//   - REPLAY BY INTENT: a retry writes nothing; a changed request under the same key is a conflict.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
import assert from "node:assert/strict";
import admin from "firebase-admin";
admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();
const { Timestamp } = admin.firestore;

const { relocateStock, RelocationError, relocationRowKey, deriveRelocationId } = await import("../lib/inventoryLocation/stockRelocationCommand.js");
const { readBinParentage } = await import("../lib/inventoryLocation/binParentage.js");
const { sumExactLocationOnHand, sumWarehouseAggregateOnHand, binIdsReferenced, signedQuantity } = await import("../lib/inventoryLedger/locationOnHand.js");
const { sumLedgerEligibleOnHand } = await import("../lib/fulfillment/fulfillmentAvailability.js");
const { computeAnalyticsOnHandByPart } = await import("../lib/inventoryAnalyticsCallables.js");
const { classifyLedgerDoc, deserializeOperationalMovement, operationalMovementDocId } = await import("../lib/inventoryLedger/operationalMovementRepository.js");
const { OPERATIONAL_MOVEMENT_TYPES } = await import("../lib/inventoryLedger/operationalMovementTypes.js");
const { serializedAssetDocId } = await import("../lib/serializedAsset/serializedAssetRegistration.js");
const { BIN_SCHEMA_VERSION } = await import("../lib/inventoryLocation/binRegistry.js");
const transfer = await import("../lib/inventoryTransfer/transferOrderCommand.js");
const { SameCustodyParentError } = await import("../lib/inventoryTransfer/transferOrderTypes.js");
const { makeResolveTransferLocationActive } = await import("../lib/inventoryTransfer/transferLocationResolver.js");
const { computeExpectedQuantityThroughTxn } = await import("../lib/cycleCount/cycleCountExpectedQuantity.js");

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS: ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL: ${name}`); console.error(err); }
}
const runId = Date.now();
let seq = 0;
const nextId = (p) => `${p}-${runId}-${(seq += 1)}`;
const NOW = new Date(1_700_000_000_000);

async function seedWarehouse(id, over = {}) {
  await db.collection("warehouses").doc(id).set({
    id, name: id, location: "somewhere", status: "ACTIVE", version: 1,
    updatedAt: Timestamp.fromDate(NOW), updatedBy: "seed", provenance: "NATIVE",
    createdAt: Timestamp.fromDate(NOW), createdBy: "seed", ...over,
  });
}
async function seedBin(warehouseId, over = {}) {
  const id = `bin_${"0".repeat(8)}${String(runId).slice(-8)}${String((seq += 1)).padStart(24, "0")}`;
  await db.collection("bins").doc(id).set({
    warehouseId, area: "PARTS_ROOM", aisle: "A", bay: 1, position: seq, code: `A01-${String(seq).padStart(3, "0")}`,
    name: null, status: "ACTIVE", version: 1, schemaVersion: BIN_SCHEMA_VERSION, idempotencyKey: nextId("bk"),
    fingerprint: "0".repeat(16), ...over,
  });
  return id;
}
async function seedMovement(partId, location, type, quantity, over = {}) {
  const id = "seedmv_" + nextId("mv");
  const src = { RECEIVED: { type: "RECEIVING_ORDER", id: nextId("rcv") }, WORK_ORDER_CONSUMPTION: { type: "WORK_ORDER", id: nextId("wo") } }[type];
  const direction = type === "RECEIVED" ? "IN" : "SIGNED";
  await db.collection("inventory_transactions").doc(id).set({
    schemaVersion: 2, type, direction, partId, trackingMode: "NONE", location, quantity, sourceObject: src,
    idempotencyKey: nextId("idem"), actor: { kind: "SYSTEM", id: "WORK_ORDER_TRANSITION" },
    occurredAt: NOW.getTime(), recordedAt: Timestamp.fromDate(NOW), fingerprint: "0".repeat(16), ...over,
  });
}
async function seedSerial(partId, serialNo, locationId, over = {}) {
  await db.collection("serialized_assets").doc(serializedAssetDocId(partId, serialNo)).set({
    schemaVersion: 1, serialNo, partId, currentLocationId: locationId, inventoryState: "AVAILABLE",
    currentEquipmentId: null, ownership: "COMPANY", activatedByReceivingId: nextId("rcv"),
    createdAtMillis: NOW.getTime(), createdByUid: "seed", updatedAtMillis: NOW.getTime(), updatedByUid: "seed", ...over,
  });
}

function makeDeps({ grants = ["inventory.stock.relocate"], parts = {} } = {}) {
  const audits = [];
  const granted = new Set(grants);
  return {
    audits,
    deps: {
      db,
      actor: { kind: "USER", id: nextId("actor") },
      authorize: async (_txn, _db, _actorId, capability) => granted.has(capability),
      resolvePart: async (_txn, _db, partId) => parts[partId] ?? { partId, trackingMode: "NONE", active: true },
      stageAudit: (_txn, a) => { audits.push(a); },
      now: () => NOW,
    },
  };
}

async function movementsFor(partId) {
  const snap = await db.collection("inventory_transactions").where("partId", "==", partId).get();
  return snap.docs.map((d) => d.data()).filter((d) => classifyLedgerDoc(d) === "operational").map((d) => deserializeOperationalMovement(d).value);
}
async function rawRowsFor(partId) {
  return (await db.collection("inventory_transactions").where("partId", "==", partId).get()).docs.map((d) => d.data());
}
const WHref = (id) => ({ type: "WAREHOUSE", locationId: id });
const BINref = (id) => ({ type: "BIN", locationId: id });
async function expectCode(promise, code, reasonPrefix) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof RelocationError, `expected RelocationError, got ${err?.name}: ${err?.message}`);
    assert.equal(err.code, code, `code (reason ${err.reason})`);
    if (reasonPrefix) assert.ok(err.reason.startsWith(reasonPrefix), `reason ${err.reason}`);
    return true;
  });
}

// ================================ the one sign rule ================================
await check("sign rule is total over the movement vocabulary", async () => {
  for (const type of OPERATIONAL_MOVEMENT_TYPES) {
    assert.notEqual(signedQuantity({ type, quantity: 1 }), 0, `${type} must have a sign`);
  }
  assert.equal(signedQuantity({ type: "RELOCATION_OUT", quantity: 3 }), -3);
  assert.equal(signedQuantity({ type: "RELOCATION_IN", quantity: 3 }), 3);
  assert.equal(signedQuantity({ type: "WORK_ORDER_CONSUMPTION", quantity: -2 }), -2);
  assert.equal(signedQuantity({ type: "RECEIVED", quantity: -5 }), 0, "a corrupt negative receipt contributes nothing");
  assert.equal(signedQuantity({ type: "RESERVED", quantity: 5 }), 0, "a commitment is not physical stock");
});

// ================================ conservation ================================
await check("CONSERVATION: WH -> A -> B -> WH keeps the Warehouse aggregate at exactly 10", async () => {
  const wh = nextId("wh"); await seedWarehouse(wh);
  const binA = await seedBin(wh); const binB = await seedBin(wh);
  const partId = nextId("part");
  await seedMovement(partId, WHref(wh), "RECEIVED", 10);
  const { deps, audits } = makeDeps();

  async function state() {
    const mv = await movementsFor(partId);
    const raw = await rawRowsFor(partId);
    const parentage = await readBinParentage(db, binIdsReferenced(raw));
    return {
      direct: sumExactLocationOnHand(mv, WHref(wh)),
      a: sumExactLocationOnHand(mv, BINref(binA)),
      b: sumExactLocationOnHand(mv, BINref(binB)),
      aggregate: sumWarehouseAggregateOnHand(mv, new Set([wh]), parentage),
      // The REAL availability reader, as Sales Order allocation calls it.
      available: sumLedgerEligibleOnHand(raw, new Set([wh]), parentage),
    };
  }
  assert.deepEqual(await state(), { direct: 10, a: 0, b: 0, aggregate: 10, available: 10 });

  await relocateStock({ partId, source: WHref(wh), destination: BINref(binA), quantity: 4, idempotencyKey: nextId("k") }, deps);
  assert.deepEqual(await state(), { direct: 6, a: 4, b: 0, aggregate: 10, available: 10 });

  await relocateStock({ partId, source: BINref(binA), destination: BINref(binB), quantity: 3, idempotencyKey: nextId("k") }, deps);
  assert.deepEqual(await state(), { direct: 6, a: 1, b: 3, aggregate: 10, available: 10 });

  await relocateStock({ partId, source: BINref(binB), destination: WHref(wh), quantity: 2, idempotencyKey: nextId("k") }, deps);
  assert.deepEqual(await state(), { direct: 8, a: 1, b: 1, aggregate: 10, available: 10 });

  assert.equal(audits.length, 3, "every applied relocation is audited");
});

await check("without parentage, binned stock would vanish from availability -- which is why it is required", async () => {
  const wh = nextId("wh"); await seedWarehouse(wh);
  const binA = await seedBin(wh);
  const partId = nextId("part");
  await seedMovement(partId, WHref(wh), "RECEIVED", 5);
  await relocateStock({ partId, source: WHref(wh), destination: BINref(binA), quantity: 5, idempotencyKey: nextId("k") }, makeDeps().deps);
  const raw = await rawRowsFor(partId);
  assert.equal(sumLedgerEligibleOnHand(raw, new Set([wh]), new Map()), 0, "an unresolved bin is excluded, never guessed");
  assert.equal(sumLedgerEligibleOnHand(raw, new Set([wh]), await readBinParentage(db, binIdsReferenced(raw))), 5);
});

await check("UNKNOWN stays UNKNOWN: no physical evidence is null, not zero", async () => {
  assert.equal(sumLedgerEligibleOnHand([], new Set(["WH-X"]), new Map()), null);
});

// ================================ exact source ================================
await check("EXACT SOURCE: an empty bin cannot borrow from plentiful direct stock", async () => {
  const wh = nextId("wh"); await seedWarehouse(wh);
  const binA = await seedBin(wh); const binB = await seedBin(wh);
  const partId = nextId("part");
  await seedMovement(partId, WHref(wh), "RECEIVED", 50);
  await expectCode(relocateStock({ partId, source: BINref(binA), destination: BINref(binB), quantity: 1, idempotencyKey: nextId("k") }, makeDeps().deps), "INSUFFICIENT_STOCK");
  assert.equal((await rawRowsFor(partId)).length, 1, "nothing written");
});

await check("CROSS_WAREHOUSE: a bin in another building is a Transfer, by name", async () => {
  const wh1 = nextId("wh"); const wh2 = nextId("wh"); await seedWarehouse(wh1); await seedWarehouse(wh2);
  const bin2 = await seedBin(wh2);
  const partId = nextId("part");
  await seedMovement(partId, WHref(wh1), "RECEIVED", 5);
  await expectCode(relocateStock({ partId, source: WHref(wh1), destination: BINref(bin2), quantity: 1, idempotencyKey: nextId("k") }, makeDeps().deps), "CROSS_WAREHOUSE");
});

await check("RETIRED_BIN: an inactive bin, or a bin in an inactive warehouse, is not a place", async () => {
  const wh = nextId("wh"); await seedWarehouse(wh);
  const dead = await seedBin(wh, { status: "INACTIVE" });
  const partId = nextId("part");
  await seedMovement(partId, WHref(wh), "RECEIVED", 5);
  await expectCode(relocateStock({ partId, source: WHref(wh), destination: BINref(dead), quantity: 1, idempotencyKey: nextId("k") }, makeDeps().deps), "RETIRED_BIN", "bin_not_active");
  const closed = nextId("wh"); await seedWarehouse(closed, { status: "INACTIVE" });
  const binInClosed = await seedBin(closed);
  await expectCode(relocateStock({ partId, source: BINref(binInClosed), destination: WHref(closed), quantity: 1, idempotencyKey: nextId("k") }, makeDeps().deps), "RETIRED_BIN");
});

await check("NOT_FOUND: an unknown bin or part is named, not guessed", async () => {
  const wh = nextId("wh"); await seedWarehouse(wh);
  const partId = nextId("part");
  await seedMovement(partId, WHref(wh), "RECEIVED", 5);
  await expectCode(relocateStock({ partId, source: WHref(wh), destination: BINref("bin_doesnotexist0000000000000000000000000000"), quantity: 1, idempotencyKey: nextId("k") }, makeDeps().deps), "NOT_FOUND", "bin_not_found");
  const noPart = makeDeps(); noPart.deps.resolvePart = async () => null;
  await expectCode(relocateStock({ partId, source: WHref(wh), destination: WHref(nextId("wh")), quantity: 1, idempotencyKey: nextId("k") }, noPart.deps), "NOT_FOUND", "part_not_found");
});

await check("parentage comes from the bin document, not its id or code", async () => {
  // A bin whose CODE and id both look like they belong to wh1 but whose document says wh2.
  const wh1 = nextId("wh"); const wh2 = nextId("wh"); await seedWarehouse(wh1); await seedWarehouse(wh2);
  const trick = await seedBin(wh2, { code: `${wh1}-A01-001` });
  const partId = nextId("part");
  await seedMovement(partId, WHref(wh1), "RECEIVED", 5);
  await expectCode(relocateStock({ partId, source: WHref(wh1), destination: BINref(trick), quantity: 1, idempotencyKey: nextId("k") }, makeDeps().deps), "CROSS_WAREHOUSE");
});

// ================================ authority ================================
await check("DENIED: no relocate capability, no movement", async () => {
  const wh = nextId("wh"); await seedWarehouse(wh);
  const binA = await seedBin(wh);
  const partId = nextId("part");
  await seedMovement(partId, WHref(wh), "RECEIVED", 5);
  await expectCode(relocateStock({ partId, source: WHref(wh), destination: BINref(binA), quantity: 1, idempotencyKey: nextId("k") }, makeDeps({ grants: [] }).deps), "DENIED", "relocate_not_authorized");
});

await check("placement authority does NOT imply movement authority", async () => {
  const wh = nextId("wh"); await seedWarehouse(wh);
  const binA = await seedBin(wh);
  const partId = nextId("part");
  await seedMovement(partId, WHref(wh), "RECEIVED", 5);
  await expectCode(relocateStock({ partId, source: WHref(wh), destination: BINref(binA), quantity: 1, idempotencyKey: nextId("k"), recordPlacement: true }, makeDeps({ grants: ["inventory.placement.record"] }).deps), "DENIED", "relocate_not_authorized");
});

await check("PUT-AWAY needs BOTH capabilities, and writes the movement and the placement together", async () => {
  const wh = nextId("wh"); await seedWarehouse(wh);
  const binA = await seedBin(wh);
  const partId = nextId("part");
  await seedMovement(partId, WHref(wh), "RECEIVED", 5);
  const req = { partId, source: WHref(wh), destination: BINref(binA), quantity: 2, idempotencyKey: nextId("k"), recordPlacement: true };
  await expectCode(relocateStock(req, makeDeps().deps), "DENIED", "placement_not_authorized");
  const out = await relocateStock(req, makeDeps({ grants: ["inventory.stock.relocate", "inventory.placement.record"] }).deps);
  assert.equal(out.outcome, "relocated");
  assert.equal(out.placementIds.length, 1);
  const plc = (await db.collection("bin_placements").doc(out.placementIds[0]).get()).data();
  assert.equal(plc.binId, binA); assert.equal(plc.warehouseId, wh); assert.equal(plc.quantity, 2);
  assert.equal(sumExactLocationOnHand(await movementsFor(partId), BINref(binA)), 2);
});

await check("placement requires a BIN destination", async () => {
  await expectCode(relocateStock({ partId: "p", source: BINref("bin_x"), destination: WHref("wh"), quantity: 1, idempotencyKey: "k", recordPlacement: true }, makeDeps().deps), "INVALID", "placement_requires_bin_destination");
});

// ================================ idempotency ================================
await check("REPLAY: the same request twice moves stock once", async () => {
  const wh = nextId("wh"); await seedWarehouse(wh);
  const binA = await seedBin(wh);
  const partId = nextId("part");
  await seedMovement(partId, WHref(wh), "RECEIVED", 5);
  const req = { partId, source: WHref(wh), destination: BINref(binA), quantity: 3, idempotencyKey: nextId("k") };
  const first = await relocateStock(req, makeDeps().deps);
  const rowsAfterFirst = (await rawRowsFor(partId)).length;
  // A retry from a different moment (a phone reconnecting later) must still replay.
  const later = makeDeps(); later.deps.now = () => new Date(NOW.getTime() + 60_000);
  const second = await relocateStock(req, later.deps);
  assert.equal(second.outcome, "replayed");
  assert.deepEqual(second.movementIds, first.movementIds);
  assert.equal((await rawRowsFor(partId)).length, rowsAfterFirst, "no new rows");
  assert.equal(sumExactLocationOnHand(await movementsFor(partId), BINref(binA)), 3);
  assert.equal(later.audits.length, 0, "a replay is not a second audited move");
});

await check("REPLAY survives the source going empty and the bin being retired afterwards", async () => {
  const wh = nextId("wh"); await seedWarehouse(wh);
  const binA = await seedBin(wh);
  const partId = nextId("part");
  await seedMovement(partId, WHref(wh), "RECEIVED", 3);
  const req = { partId, source: WHref(wh), destination: BINref(binA), quantity: 3, idempotencyKey: nextId("k") };
  await relocateStock(req, makeDeps().deps);
  await db.collection("bins").doc(binA).update({ status: "INACTIVE" });
  assert.equal((await relocateStock(req, makeDeps().deps)).outcome, "replayed");
});

await check("CONFLICT: the same key with a different quantity is refused", async () => {
  const wh = nextId("wh"); await seedWarehouse(wh);
  const binA = await seedBin(wh);
  const partId = nextId("part");
  await seedMovement(partId, WHref(wh), "RECEIVED", 5);
  const key = nextId("k");
  await relocateStock({ partId, source: WHref(wh), destination: BINref(binA), quantity: 2, idempotencyKey: key }, makeDeps().deps);
  await expectCode(relocateStock({ partId, source: WHref(wh), destination: BINref(binA), quantity: 3, idempotencyKey: key }, makeDeps().deps), "IDEMPOTENCY_CONFLICT");
});

await check("a partial prior write is an integrity failure, never 'finish the rest'", async () => {
  const wh = nextId("wh"); await seedWarehouse(wh);
  const binA = await seedBin(wh);
  const partId = nextId("part");
  await seedMovement(partId, WHref(wh), "RECEIVED", 5);
  const key = nextId("k");
  await db.collection("inventory_transactions").doc(operationalMovementDocId(relocationRowKey(key, "out"))).set({ planted: true });
  await expectCode(relocateStock({ partId, source: WHref(wh), destination: BINref(binA), quantity: 1, idempotencyKey: key }, makeDeps().deps), "INTEGRITY", "partial_prior_relocation");
});

// ================================ serialized custody ================================
await check("SERIAL: the unit's own currentLocationId moves; the warehouse still counts it", async () => {
  const wh = nextId("wh"); await seedWarehouse(wh);
  const binA = await seedBin(wh);
  const partId = nextId("part");
  const parts = { [partId]: { partId, trackingMode: "SERIAL", active: true } };
  await seedSerial(partId, "SN-1", wh); await seedSerial(partId, "SN-2", wh);
  const out = await relocateStock({ partId, source: WHref(wh), destination: BINref(binA), serialNumbers: ["SN-1"], idempotencyKey: nextId("k") }, makeDeps({ parts }).deps);
  assert.equal(out.movementIds.length, 2, "one OUT and one IN for the one serial");
  const sn1 = (await db.collection("serialized_assets").doc(serializedAssetDocId(partId, "SN-1")).get()).data();
  const sn2 = (await db.collection("serialized_assets").doc(serializedAssetDocId(partId, "SN-2")).get()).data();
  assert.equal(sn1.currentLocationId, binA); assert.equal(sn1.inventoryState, "AVAILABLE");
  assert.equal(sn2.currentLocationId, wh, "the other unit did not move");
  // Analytics resolves the serial's custody through the bin's governed parent.
  const parentage = await readBinParentage(db, [binA]);
  const onHand = computeAnalyticsOnHandByPart([], [sn1, sn2], new Set([wh]), parentage);
  assert.equal(onHand.get(partId), 2, "both units still in this warehouse");
  assert.equal(computeAnalyticsOnHandByPart([], [sn1, sn2], new Set([wh]), new Map()).get(partId), 1, "without parentage the binned unit would vanish");
});

await check("SERIAL_NOT_AT_SOURCE: a serial elsewhere, or installed, is refused", async () => {
  const wh = nextId("wh"); await seedWarehouse(wh);
  const binA = await seedBin(wh); const binB = await seedBin(wh);
  const partId = nextId("part");
  const parts = { [partId]: { partId, trackingMode: "SERIAL", active: true } };
  await seedSerial(partId, "SN-X", binB);
  await expectCode(relocateStock({ partId, source: WHref(wh), destination: BINref(binA), serialNumbers: ["SN-X"], idempotencyKey: nextId("k") }, makeDeps({ parts }).deps), "SERIAL_NOT_AT_SOURCE", "serial_elsewhere");
  await seedSerial(partId, "SN-I", wh, { inventoryState: "INSTALLED", currentEquipmentId: "eq-1" });
  await expectCode(relocateStock({ partId, source: WHref(wh), destination: BINref(binA), serialNumbers: ["SN-I"], idempotencyKey: nextId("k") }, makeDeps({ parts }).deps), "SERIAL_NOT_AT_SOURCE", "serial_not_available");
});

await check("tracking mode comes from the Part, never the request", async () => {
  const partId = nextId("part");
  await expectCode(relocateStock({ partId, source: WHref("a"), destination: WHref("b"), quantity: 1, idempotencyKey: "k" }, makeDeps({ parts: { [partId]: { partId, trackingMode: "SERIAL", active: true } } }).deps), "INVALID", "serial_numbers_required");
  await expectCode(relocateStock({ partId, source: WHref("a"), destination: WHref("b"), quantity: 1, idempotencyKey: "k" }, makeDeps({ parts: { [partId]: { partId, trackingMode: "LOT", active: true } } }).deps), "INVALID", "lot_not_supported");
});

// ================================ the live consumption defect ================================
await check("CONSUMPTION now reduces Transfer sufficiency (it used to be ignored)", async () => {
  const wh1 = nextId("wh"); const wh2 = nextId("wh"); await seedWarehouse(wh1); await seedWarehouse(wh2);
  const partId = nextId("part");
  await seedMovement(partId, WHref(wh1), "RECEIVED", 5);
  await seedMovement(partId, WHref(wh1), "WORK_ORDER_CONSUMPTION", -3);
  const deps = {
    db, actor: { kind: "USER", id: nextId("actor") },
    authorize: async () => true,
    resolvePart: async (_t, id) => ({ partId: id, trackingMode: "NONE", active: true }),
    resolveLocationActive: makeResolveTransferLocationActive(db),
    stageAudit: () => {}, now: () => NOW,
  };
  // 5 received, 3 fitted to a machine: only 2 remain. Moving 3 must be refused.
  await assert.rejects(transfer.createTransferOrder({ partId, quantity: 3, origin: WHref(wh1), destination: WHref(wh2), idempotencyKey: nextId("k") }, deps), (e) => e instanceof transfer.InsufficientStockError);
  const ok = await transfer.createTransferOrder({ partId, quantity: 2, origin: WHref(wh1), destination: WHref(wh2), idempotencyKey: nextId("k") }, deps);
  assert.equal(ok.outcome, "applied");
});

await check("CONSUMPTION now reduces Cycle Count expected quantity (no more double subtraction)", async () => {
  const wh = nextId("wh"); await seedWarehouse(wh);
  const partId = nextId("part");
  await seedMovement(partId, WHref(wh), "RECEIVED", 10);
  await seedMovement(partId, WHref(wh), "WORK_ORDER_CONSUMPTION", -4);
  const expected = await db.runTransaction((txn) => computeExpectedQuantityThroughTxn(txn, db, partId, WHref(wh)));
  assert.equal(expected, 6, "a count of the real 6 on the shelf must show no variance");
});

// ================================ Transfer Bin endpoints ================================
function transferDeps() {
  return {
    db, actor: { kind: "USER", id: nextId("actor") },
    authorize: async () => true,
    resolvePart: async (_t, id) => ({ partId: id, trackingMode: "NONE", active: true }),
    resolveLocationActive: makeResolveTransferLocationActive(db),
    stageAudit: () => {}, now: () => NOW,
  };
}

await check("TRANSFER refuses a same-warehouse pair: that is a relocation", async () => {
  const wh = nextId("wh"); await seedWarehouse(wh);
  const binA = await seedBin(wh); const binB = await seedBin(wh);
  const partId = nextId("part");
  await seedMovement(partId, WHref(wh), "RECEIVED", 5);
  await assert.rejects(transfer.createTransferOrder({ partId, quantity: 1, origin: WHref(wh), destination: BINref(binA), idempotencyKey: nextId("k") }, transferDeps()), (e) => e instanceof SameCustodyParentError);
  await assert.rejects(transfer.createTransferOrder({ partId, quantity: 1, origin: BINref(binA), destination: BINref(binB), idempotencyKey: nextId("k") }, transferDeps()), (e) => e instanceof SameCustodyParentError);
});

await check("TRANSFER carries a bin across a custody boundary, from its exact stock", async () => {
  const wh1 = nextId("wh"); const wh2 = nextId("wh"); await seedWarehouse(wh1); await seedWarehouse(wh2);
  const binA = await seedBin(wh1); const binC = await seedBin(wh2);
  const partId = nextId("part");
  await seedMovement(partId, WHref(wh1), "RECEIVED", 10);
  await relocateStock({ partId, source: WHref(wh1), destination: BINref(binA), quantity: 4, idempotencyKey: nextId("k") }, makeDeps().deps);
  // Exact source: bin A holds 4, so 5 is refused even though warehouse 1 holds 10.
  await assert.rejects(transfer.createTransferOrder({ partId, quantity: 5, origin: BINref(binA), destination: BINref(binC), idempotencyKey: nextId("k") }, transferDeps()), (e) => e instanceof transfer.InsufficientStockError);
  const created = await transfer.createTransferOrder({ partId, quantity: 4, origin: BINref(binA), destination: BINref(binC), idempotencyKey: nextId("k") }, transferDeps());
  await transfer.dispatchTransferOrder({ transferOrderId: created.transferOrderId }, transferDeps());
  await transfer.receiveTransferOrder({ transferOrderId: created.transferOrderId }, transferDeps());
  const raw = await rawRowsFor(partId);
  const parentage = await readBinParentage(db, binIdsReferenced(raw));
  assert.equal(sumLedgerEligibleOnHand(raw, new Set([wh1]), parentage), 6);
  assert.equal(sumLedgerEligibleOnHand(raw, new Set([wh2]), parentage), 4);
  assert.equal(sumLedgerEligibleOnHand(raw, new Set([wh1, wh2]), parentage), 10, "company total conserved");
});

await check("TRANSFER refuses a retired bin endpoint", async () => {
  const wh1 = nextId("wh"); const wh2 = nextId("wh"); await seedWarehouse(wh1); await seedWarehouse(wh2);
  const dead = await seedBin(wh2, { status: "INACTIVE" });
  const partId = nextId("part");
  await seedMovement(partId, WHref(wh1), "RECEIVED", 5);
  await assert.rejects(transfer.createTransferOrder({ partId, quantity: 1, origin: WHref(wh1), destination: BINref(dead), idempotencyKey: nextId("k") }, transferDeps()), (e) => e instanceof transfer.DestinationInvalidError);
});

await check("SERIALIZED PUT-AWAY finds a real registered serial (it never could before BIN-P6)", async () => {
  // recordPutAway used to look serials up by `${partId}__${serial}` and then a bare serial id -- a
  // convention no writer produces -- so every real unit was refused as serial_unknown.
  const { recordPutAway } = await import("../lib/inventoryLocation/putAwayCommand.js");
  const wh = nextId("wh"); await seedWarehouse(wh);
  const binA = await seedBin(wh);
  const partId = nextId("part");
  await seedSerial(partId, "SN-PA", wh);
  const out = await recordPutAway(
    { warehouseId: wh, binId: binA, partId, serialNumbers: ["SN-PA"], idempotencyKey: nextId("k") },
    { db, actor: { kind: "USER", id: nextId("actor") }, authorize: async () => true, now: () => NOW },
  );
  assert.equal(out.outcome, "recorded");
  assert.deepEqual(out.serialNumbers, ["SN-PA"]);
});

await check("relocation id is deterministic and path-safe", async () => {
  assert.match(deriveRelocationId("any key / with ../ slashes"), /^srl_[0-9a-f]{40}$/);
  assert.equal(deriveRelocationId("k1"), deriveRelocationId("k1"));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
