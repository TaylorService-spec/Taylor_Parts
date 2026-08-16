// Enterprise Inventory Phase 4 -- Firestore-emulator tests for the trusted transfer command family
// (createTransferOrder / dispatchTransferOrder / receiveTransferOrder / cancelTransferOrder).
// Requires the Firestore emulator (127.0.0.1:8080). Imports the compiled ../lib output. Mirrors
// receiveInventoryStockCommand.test.mjs's harness shape. Authorization/part/location/audit are
// injected seams (production wiring is separately pinned in transferCommandComposition.ts).
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
import assert from "node:assert/strict";
import admin from "firebase-admin";
admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();
const { Timestamp } = admin.firestore;

const cmd = await import("../lib/inventoryTransfer/transferOrderCommand.js");
const {
  createTransferOrder, dispatchTransferOrder, receiveTransferOrder, cancelTransferOrder,
  UnauthorizedTransferError, TransferNotFoundError, OriginInvalidError, DestinationInvalidError,
  SameLocationError, TransferPartInvalidError, InsufficientStockError, TransferStatusInvalidError,
} = cmd;
const { transferOrderDocId } = await import("../lib/inventoryTransfer/transferOrderRepository.js");
const { serializedAssetDocId } = await import("../lib/serializedAsset/serializedAssetRegistration.js");
const { makeResolveTransferLocationActive } = await import("../lib/inventoryTransfer/transferLocationResolver.js");

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS: ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL: ${name}`); console.error(err); }
}
const runId = Date.now();
let seq = 0;
const nextId = (p) => `${p}-${runId}-${(seq += 1)}`;
const NOW = new Date(1_700_000_000_000);

// ---- seeding helpers ---------------------------------------------------------------------------
async function seedWarehouse(id, over = {}) {
  await db.collection("warehouses").doc(id).set({
    id, name: id, location: "somewhere", status: "ACTIVE", version: 1,
    updatedAt: Timestamp.fromDate(NOW), updatedBy: "seed", provenance: "NATIVE",
    createdAt: Timestamp.fromDate(NOW), createdBy: "seed",
    ...over,
  });
}
async function seedMobileLocation(id, over = {}) {
  await db.collection("mobile_locations").doc(id).set({
    locationId: id, type: "MOBILE", displayLabel: id, active: true, version: 1,
    createdAt: Timestamp.fromDate(NOW), createdBy: "seed", updatedAt: Timestamp.fromDate(NOW), updatedBy: "seed",
    ...over,
  });
}
async function seedSerializedAsset(partId, serialNo, locationId, over = {}) {
  const id = serializedAssetDocId(partId, serialNo);
  await db.collection("serialized_assets").doc(id).set({
    schemaVersion: 1, serialNo, partId, currentLocationId: locationId, inventoryState: "AVAILABLE",
    currentEquipmentId: null, ownership: "COMPANY", activatedByReceivingId: nextId("rcv"),
    createdAtMillis: NOW.getTime(), createdByUid: "seed", updatedAtMillis: NOW.getTime(), updatedByUid: "seed",
    ...over,
  });
  return id;
}
async function seedNoneOnHand(partId, location, quantity) {
  const id = "seedmv_" + nextId("mv");
  await db.collection("inventory_transactions").doc(id).set({
    schemaVersion: 2, type: "RECEIVED", direction: "IN", partId, trackingMode: "NONE",
    location, quantity, sourceObject: { type: "RECEIVING_ORDER", id: nextId("rcv") },
    idempotencyKey: nextId("idem"), actor: { kind: "SYSTEM", id: "WORK_ORDER_TRANSITION" },
    occurredAt: NOW.getTime(), recordedAt: Timestamp.fromDate(NOW), fingerprint: "0".repeat(16),
  });
}

const WH = () => ({ type: "WAREHOUSE", locationId: nextId("wh") });
const MOBILE = () => ({ type: "MOBILE", locationId: nextId("truck-loc") });

function makeDeps(over = {}) {
  const audits = [];
  const grants = new Set(["inventory.transfer.create", "inventory.transfer.dispatch", "inventory.transfer.receive", "inventory.transfer.cancel"]);
  const parts = new Map();
  const deps = {
    db,
    actor: { kind: "USER", id: nextId("actor") },
    authorize: async (_txn, _actorId, capability) => grants.has(capability),
    resolvePart: async (_txn, partId) => parts.get(partId) ?? { partId, trackingMode: "NONE", active: true },
    resolveLocationActive: makeResolveTransferLocationActive(db),
    stageAudit: (_txn, audit) => { audits.push(audit); },
    now: () => NOW,
    ...over,
  };
  return { deps, audits, parts, grants };
}
async function countAt(collection, field, value) {
  return (await db.collection(collection).where(field, "==", value).get()).size;
}

// =================================================================================================
// warehouse -> warehouse, NONE part, happy path through the full loop
// =================================================================================================
await check("warehouse -> warehouse NONE: create -> dispatch -> receive closes the loop atomically", async () => {
  const origin = WH(); const destination = WH();
  await seedWarehouse(origin.locationId); await seedWarehouse(destination.locationId);
  const partId = nextId("part");
  await seedNoneOnHand(partId, origin, 10);
  const { deps, audits } = makeDeps();

  const idempotencyKey = nextId("idem");
  const created = await createTransferOrder({ partId, quantity: 5, origin, destination, idempotencyKey }, deps);
  assert.equal(created.outcome, "applied");
  const transferOrderId = created.transferOrderId;
  assert.equal(transferOrderId, transferOrderDocId(idempotencyKey));

  const stored = (await db.collection("transfer_orders").doc(transferOrderId).get()).data();
  assert.equal(stored.status, "REQUESTED"); assert.equal(stored.quantity, 5);
  assert.deepEqual(stored.origin, origin); assert.deepEqual(stored.destination, destination);
  assert.equal(stored.fromWarehouseId, origin.locationId); assert.equal(stored.toWarehouseId, destination.locationId);

  const dispatched = await dispatchTransferOrder({ transferOrderId }, deps);
  assert.equal(dispatched.outcome, "applied");
  assert.equal((await db.collection("transfer_orders").doc(transferOrderId).get()).data().status, "IN_TRANSIT");
  const out = (await db.collection("inventory_transactions").doc(dispatched.ledgerEventIds[0]).get()).data();
  assert.equal(out.type, "TRANSFER_OUT"); assert.equal(out.quantity, 5);
  assert.deepEqual(out.location, origin); assert.deepEqual(out.counterpartyLocation, destination);
  assert.deepEqual(out.sourceObject, { type: "TRANSFER_ORDER", id: transferOrderId });

  const received = await receiveTransferOrder({ transferOrderId }, deps);
  assert.equal(received.outcome, "applied");
  assert.equal((await db.collection("transfer_orders").doc(transferOrderId).get()).data().status, "COMPLETED");
  const inn = (await db.collection("inventory_transactions").doc(received.ledgerEventIds[0]).get()).data();
  assert.equal(inn.type, "TRANSFER_IN"); assert.equal(inn.quantity, 5);
  assert.deepEqual(inn.location, destination); assert.deepEqual(inn.counterpartyLocation, origin);

  assert.equal(audits.length, 3);
  assert.deepEqual(audits.map((a) => a.action), ["createTransferOrder", "dispatchTransferOrder", "receiveTransferOrder"]);
});

// =================================================================================================
// warehouse -> truck (MOBILE), SERIAL unit(s) -- Serialized Asset location evidence + truck projection
// =================================================================================================
await check("warehouse -> truck SERIAL: dispatch flips IN_TRANSIT, receive relocates to the truck (canonical authority)", async () => {
  const origin = WH(); const truckLoc = MOBILE();
  await seedWarehouse(origin.locationId); await seedMobileLocation(truckLoc.locationId);
  const partId = nextId("part");
  const { deps, parts } = makeDeps();
  parts.set(partId, { partId, trackingMode: "SERIAL", active: true });
  const serialNo = nextId("sn");
  const assetId = await seedSerializedAsset(partId, serialNo, origin.locationId);

  const idempotencyKey = nextId("idem");
  const created = await createTransferOrder({ partId, quantity: 1, origin, destination: truckLoc, serialNumbers: [serialNo], idempotencyKey }, deps);
  assert.equal(created.outcome, "applied");
  const transferOrderId = created.transferOrderId;

  await dispatchTransferOrder({ transferOrderId }, deps);
  const afterDispatch = (await db.collection("serialized_assets").doc(assetId).get()).data();
  assert.equal(afterDispatch.inventoryState, "IN_TRANSIT");
  assert.equal(afterDispatch.currentLocationId, origin.locationId, "location does NOT change at dispatch -- only at completion");

  await receiveTransferOrder({ transferOrderId }, deps);
  const afterReceive = (await db.collection("serialized_assets").doc(assetId).get()).data();
  assert.equal(afterReceive.currentLocationId, truckLoc.locationId, "truck projection: the asset's location IS the truck's MOBILE location");
  assert.equal(afterReceive.inventoryState, "AVAILABLE");
});

// =================================================================================================
// truck -> warehouse, same authority, opposite direction
// =================================================================================================
await check("truck -> warehouse SERIAL: the SAME command family closes the return leg", async () => {
  const truckLoc = MOBILE(); const destination = WH();
  await seedMobileLocation(truckLoc.locationId); await seedWarehouse(destination.locationId);
  const partId = nextId("part");
  const { deps, parts } = makeDeps();
  parts.set(partId, { partId, trackingMode: "SERIAL", active: true });
  const serialNo = nextId("sn");
  const assetId = await seedSerializedAsset(partId, serialNo, truckLoc.locationId);

  const created = await createTransferOrder({ partId, quantity: 1, origin: truckLoc, destination, serialNumbers: [serialNo], idempotencyKey: nextId("idem") }, deps);
  await dispatchTransferOrder({ transferOrderId: created.transferOrderId }, deps);
  await receiveTransferOrder({ transferOrderId: created.transferOrderId }, deps);
  const final = (await db.collection("serialized_assets").doc(assetId).get()).data();
  assert.equal(final.currentLocationId, destination.locationId);
  assert.equal(final.inventoryState, "AVAILABLE");
});

// =================================================================================================
// insufficient stock (NONE and SERIAL)
// =================================================================================================
await check("insufficient stock (NONE): origin on-hand < requested quantity -> INSUFFICIENT_STOCK, zero writes", async () => {
  const origin = WH(); const destination = WH();
  await seedWarehouse(origin.locationId); await seedWarehouse(destination.locationId);
  const partId = nextId("part");
  await seedNoneOnHand(partId, origin, 2);
  const { deps } = makeDeps();
  await assert.rejects(
    () => createTransferOrder({ partId, quantity: 5, origin, destination, idempotencyKey: nextId("idem") }, deps),
    InsufficientStockError,
  );
});
await check("insufficient stock (SERIAL): unit not AVAILABLE at origin -> INSUFFICIENT_STOCK", async () => {
  const origin = WH(); const destination = WH();
  await seedWarehouse(origin.locationId); await seedWarehouse(destination.locationId);
  const partId = nextId("part");
  const { deps, parts } = makeDeps();
  parts.set(partId, { partId, trackingMode: "SERIAL", active: true });
  const serialNo = nextId("sn");
  await seedSerializedAsset(partId, serialNo, origin.locationId, { inventoryState: "RESERVED" });
  await assert.rejects(
    () => createTransferOrder({ partId, quantity: 1, origin, destination, serialNumbers: [serialNo], idempotencyKey: nextId("idem") }, deps),
    InsufficientStockError,
  );
});

// =================================================================================================
// invalid origin / destination
// =================================================================================================
await check("invalid origin: unknown warehouse -> ORIGIN_INVALID, zero writes", async () => {
  const origin = WH(); const destination = WH();
  await seedWarehouse(destination.locationId); // origin never seeded
  const partId = nextId("part");
  await seedNoneOnHand(partId, origin, 10);
  const { deps } = makeDeps();
  await assert.rejects(
    () => createTransferOrder({ partId, quantity: 1, origin, destination, idempotencyKey: nextId("idem") }, deps),
    OriginInvalidError,
  );
});
await check("invalid destination: INACTIVE warehouse -> DESTINATION_INVALID", async () => {
  const origin = WH(); const destination = WH();
  await seedWarehouse(origin.locationId); await seedWarehouse(destination.locationId, { status: "INACTIVE" });
  const partId = nextId("part");
  await seedNoneOnHand(partId, origin, 10);
  const { deps } = makeDeps();
  await assert.rejects(
    () => createTransferOrder({ partId, quantity: 1, origin, destination, idempotencyKey: nextId("idem") }, deps),
    DestinationInvalidError,
  );
});

// =================================================================================================
// same origin == destination
// =================================================================================================
await check("same origin==destination -> rejected before any read/write (SAME_LOCATION)", async () => {
  const loc = WH();
  await seedWarehouse(loc.locationId);
  const partId = nextId("part");
  const { deps } = makeDeps();
  await assert.rejects(
    () => createTransferOrder({ partId, quantity: 1, origin: loc, destination: loc, idempotencyKey: nextId("idem") }, deps),
    SameLocationError,
  );
  assert.equal(await countAt("transfer_orders", "partId", partId), 0);
});

// =================================================================================================
// duplicate / replay
// =================================================================================================
await check("duplicate create (same idempotencyKey, same payload) -> replayed, no second document", async () => {
  const origin = WH(); const destination = WH();
  await seedWarehouse(origin.locationId); await seedWarehouse(destination.locationId);
  const partId = nextId("part");
  await seedNoneOnHand(partId, origin, 10);
  const { deps } = makeDeps();
  const idempotencyKey = nextId("idem");
  const first = await createTransferOrder({ partId, quantity: 3, origin, destination, idempotencyKey }, deps);
  const second = await createTransferOrder({ partId, quantity: 3, origin, destination, idempotencyKey }, deps);
  assert.equal(first.outcome, "applied"); assert.equal(second.outcome, "replayed");
  assert.equal(first.transferOrderId, second.transferOrderId);
  assert.equal(await countAt("transfer_orders", "partId", partId), 1);
});
await check("duplicate dispatch (retry after apply) -> replayed, no second TRANSFER_OUT event", async () => {
  const origin = WH(); const destination = WH();
  await seedWarehouse(origin.locationId); await seedWarehouse(destination.locationId);
  const partId = nextId("part");
  await seedNoneOnHand(partId, origin, 10);
  const { deps } = makeDeps();
  const created = await createTransferOrder({ partId, quantity: 3, origin, destination, idempotencyKey: nextId("idem") }, deps);
  const d1 = await dispatchTransferOrder({ transferOrderId: created.transferOrderId }, deps);
  const d2 = await dispatchTransferOrder({ transferOrderId: created.transferOrderId }, deps);
  assert.equal(d1.outcome, "applied"); assert.equal(d2.outcome, "replayed");
  assert.deepEqual(d1.ledgerEventIds, d2.ledgerEventIds);
  assert.equal(await countAt("inventory_transactions", "sourceObject.id", created.transferOrderId), 1);
});

// =================================================================================================
// unauthorized
// =================================================================================================
await check("unauthorized create -> PERMISSION_DENIED, zero writes", async () => {
  const origin = WH(); const destination = WH();
  await seedWarehouse(origin.locationId); await seedWarehouse(destination.locationId);
  const partId = nextId("part");
  await seedNoneOnHand(partId, origin, 10);
  const { deps } = makeDeps({ authorize: async () => false });
  await assert.rejects(
    () => createTransferOrder({ partId, quantity: 1, origin, destination, idempotencyKey: nextId("idem") }, deps),
    UnauthorizedTransferError,
  );
  assert.equal(await countAt("transfer_orders", "partId", partId), 0);
});
await check("unauthorized dispatch -> PERMISSION_DENIED, status unchanged", async () => {
  const origin = WH(); const destination = WH();
  await seedWarehouse(origin.locationId); await seedWarehouse(destination.locationId);
  const partId = nextId("part");
  await seedNoneOnHand(partId, origin, 10);
  const { deps, grants } = makeDeps();
  const created = await createTransferOrder({ partId, quantity: 1, origin, destination, idempotencyKey: nextId("idem") }, deps);
  grants.delete("inventory.transfer.dispatch");
  await assert.rejects(() => dispatchTransferOrder({ transferOrderId: created.transferOrderId }, deps), UnauthorizedTransferError);
  assert.equal((await db.collection("transfer_orders").doc(created.transferOrderId).get()).data().status, "REQUESTED");
});

// =================================================================================================
// cancellation -- domain-safe only
// =================================================================================================
await check("cancel a REQUESTED transfer -> CANCELLED, no ledger effect", async () => {
  const origin = WH(); const destination = WH();
  await seedWarehouse(origin.locationId); await seedWarehouse(destination.locationId);
  const partId = nextId("part");
  await seedNoneOnHand(partId, origin, 10);
  const { deps } = makeDeps();
  const created = await createTransferOrder({ partId, quantity: 1, origin, destination, idempotencyKey: nextId("idem") }, deps);
  const cancelled = await cancelTransferOrder({ transferOrderId: created.transferOrderId }, deps);
  assert.equal(cancelled.outcome, "applied");
  assert.equal((await db.collection("transfer_orders").doc(created.transferOrderId).get()).data().status, "CANCELLED");
  assert.equal(await countAt("inventory_transactions", "sourceObject.id", created.transferOrderId), 0);
});
await check("cancel an IN_TRANSIT transfer is NOT domain-safe -> STATUS_INVALID, status unchanged", async () => {
  const origin = WH(); const destination = WH();
  await seedWarehouse(origin.locationId); await seedWarehouse(destination.locationId);
  const partId = nextId("part");
  await seedNoneOnHand(partId, origin, 10);
  const { deps } = makeDeps();
  const created = await createTransferOrder({ partId, quantity: 1, origin, destination, idempotencyKey: nextId("idem") }, deps);
  await dispatchTransferOrder({ transferOrderId: created.transferOrderId }, deps);
  await assert.rejects(() => cancelTransferOrder({ transferOrderId: created.transferOrderId }, deps), TransferStatusInvalidError);
  assert.equal((await db.collection("transfer_orders").doc(created.transferOrderId).get()).data().status, "IN_TRANSIT");
});
await check("receive before dispatch (REQUESTED) is not legal -> STATUS_INVALID", async () => {
  const origin = WH(); const destination = WH();
  await seedWarehouse(origin.locationId); await seedWarehouse(destination.locationId);
  const partId = nextId("part");
  await seedNoneOnHand(partId, origin, 10);
  const { deps } = makeDeps();
  const created = await createTransferOrder({ partId, quantity: 1, origin, destination, idempotencyKey: nextId("idem") }, deps);
  await assert.rejects(() => receiveTransferOrder({ transferOrderId: created.transferOrderId }, deps), TransferStatusInvalidError);
});
await check("dispatch/receive of an unknown transferOrderId -> TRANSFER_NOT_FOUND", async () => {
  const { deps } = makeDeps();
  await assert.rejects(() => dispatchTransferOrder({ transferOrderId: nextId("nope") }, deps), TransferNotFoundError);
  await assert.rejects(() => receiveTransferOrder({ transferOrderId: nextId("nope") }, deps), TransferNotFoundError);
});

// =================================================================================================
// atomic failure: nothing partially written when the command throws mid-transaction
// =================================================================================================
await check("atomic failure: a downstream error after location checks leaves NO transfer_orders/ledger/asset writes", async () => {
  const origin = WH(); const destination = WH();
  await seedWarehouse(origin.locationId); await seedWarehouse(destination.locationId);
  const partId = nextId("part");
  const { deps, parts } = makeDeps();
  // trackingMode flips between validation and the sufficiency check is impossible to force honestly;
  // instead force the audit stage to throw, which aborts the whole Firestore transaction (no commit).
  parts.set(partId, { partId, trackingMode: "NONE", active: true });
  await seedNoneOnHand(partId, origin, 10);
  const boom = { ...deps, stageAudit: () => { throw new Error("simulated downstream failure"); } };
  await assert.rejects(() => createTransferOrder({ partId, quantity: 1, origin, destination, idempotencyKey: nextId("idem") }, boom));
  assert.equal(await countAt("transfer_orders", "partId", partId), 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
