// Enterprise Inventory -- Cycle Count operating authority: Firestore-emulator tests for the trusted
// cycle count command family (createCycleCount / submitCycleCount / reconcileCycleCount /
// cancelCycleCount). Requires the Firestore emulator. Imports the compiled ../lib output. Mirrors
// transferOrderCommand.test.mjs's harness shape. Authorization/part/location/audit are injected seams
// (production wiring is separately pinned in cycleCountCommandComposition.ts).
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
import assert from "node:assert/strict";
import admin from "firebase-admin";
admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();
const { Timestamp } = admin.firestore;

const cmd = await import("../lib/cycleCount/cycleCountCommand.js");
const {
  createCycleCount, submitCycleCount, reconcileCycleCount, cancelCycleCount,
  UnauthorizedCycleCountError, CycleCountNotFoundError, CycleCountLocationInvalidError,
  CycleCountPartInvalidError, CycleCountReasonRequiredError, CycleCountStatusInvalidError,
} = cmd;
const { cycleCountDocId } = await import("../lib/cycleCount/cycleCountRepository.js");
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

// ---- seeding helpers (mirrors transferOrderCommand.test.mjs) -----------------------------------
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
async function seedLedgerEvent(partId, type, location, quantity, over = {}) {
  const id = "seedmv_" + nextId("mv");
  await db.collection("inventory_transactions").doc(id).set({
    schemaVersion: 2, type, direction: over.direction ?? "IN", partId, trackingMode: "NONE",
    location, quantity, sourceObject: over.sourceObject ?? { type: "RECEIVING_ORDER", id: nextId("rcv") },
    idempotencyKey: nextId("idem"), actor: { kind: "SYSTEM", id: "WORK_ORDER_TRANSITION" },
    occurredAt: NOW.getTime(), recordedAt: Timestamp.fromDate(NOW), fingerprint: "0".repeat(16),
    ...(over.counterpartyLocation ? { counterpartyLocation: over.counterpartyLocation } : {}),
  });
}
async function seedNoneOnHand(partId, location, quantity) {
  await seedLedgerEvent(partId, "RECEIVED", location, quantity);
}

const WH = () => ({ type: "WAREHOUSE", locationId: nextId("wh") });
const MOBILE = () => ({ type: "MOBILE", locationId: nextId("truck-loc") });

function makeDeps(over = {}) {
  const audits = [];
  const grants = new Set([
    "inventory.cycleCount.create", "inventory.cycleCount.submit", "inventory.cycleCount.reconcile", "inventory.cycleCount.cancel",
  ]);
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
async function getLedgerBySource(cycleCountId) {
  const snap = await db.collection("inventory_transactions").where("sourceObject.id", "==", cycleCountId).get();
  return snap.docs.map((d) => d.data());
}

// =================================================================================================
// NONE mode -- exact match, positive variance, negative variance
// =================================================================================================
await check("NONE exact match: counted == expected -> variance 0, RECONCILED with no ledger write", async () => {
  const loc = WH(); await seedWarehouse(loc.locationId);
  const partId = nextId("part");
  await seedNoneOnHand(partId, loc, 10);
  const { deps } = makeDeps();

  const created = await createCycleCount({ partId, location: loc, idempotencyKey: nextId("idem") }, deps);
  assert.equal(created.outcome, "applied");
  const cycleCountId = created.cycleCountId;
  assert.equal(cycleCountId, cycleCountDocId((await db.collection("cycle_counts").doc(cycleCountId).get()).data().idempotencyKey));
  assert.equal((await db.collection("cycle_counts").doc(cycleCountId).get()).data().expectedQuantity, 10);

  const submitted = await submitCycleCount({ cycleCountId, countedQuantity: 10 }, deps);
  assert.equal(submitted.outcome, "applied");
  const afterSubmit = (await db.collection("cycle_counts").doc(cycleCountId).get()).data();
  assert.equal(afterSubmit.status, "COUNTED"); assert.equal(afterSubmit.variance, 0);

  const reconciled = await reconcileCycleCount({ cycleCountId }, deps);
  assert.equal(reconciled.outcome, "applied");
  assert.deepEqual(reconciled.ledgerEventIds, []);
  assert.equal((await db.collection("cycle_counts").doc(cycleCountId).get()).data().status, "RECONCILED");
  assert.equal(await countAt("inventory_transactions", "sourceObject.id", cycleCountId), 0);
});

await check("NONE positive variance: counted > expected -> reason required, ADJUSTED +delta ledger evidence", async () => {
  const loc = WH(); await seedWarehouse(loc.locationId);
  const partId = nextId("part");
  await seedNoneOnHand(partId, loc, 10);
  const { deps } = makeDeps();

  const created = await createCycleCount({ partId, location: loc, idempotencyKey: nextId("idem") }, deps);
  const cycleCountId = created.cycleCountId;
  await submitCycleCount({ cycleCountId, countedQuantity: 14 }, deps);
  assert.equal((await db.collection("cycle_counts").doc(cycleCountId).get()).data().variance, 4);

  await assert.rejects(() => reconcileCycleCount({ cycleCountId }, deps), CycleCountReasonRequiredError);
  const reconciled = await reconcileCycleCount({ cycleCountId, reason: "found extra units on shelf recount" }, deps);
  assert.equal(reconciled.outcome, "applied");
  const events = await getLedgerBySource(cycleCountId);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "ADJUSTED"); assert.equal(events[0].quantity, 4);
  assert.deepEqual(events[0].location, loc);
  const stored = (await db.collection("cycle_counts").doc(cycleCountId).get()).data();
  assert.equal(stored.status, "RECONCILED"); assert.equal(stored.reconciliationReason, "found extra units on shelf recount");
});

await check("NONE negative variance: counted < expected -> reason required, ADJUSTED -delta ledger evidence", async () => {
  const loc = WH(); await seedWarehouse(loc.locationId);
  const partId = nextId("part");
  await seedNoneOnHand(partId, loc, 10);
  const { deps } = makeDeps();

  const created = await createCycleCount({ partId, location: loc, idempotencyKey: nextId("idem") }, deps);
  const cycleCountId = created.cycleCountId;
  await submitCycleCount({ cycleCountId, countedQuantity: 6 }, deps);
  assert.equal((await db.collection("cycle_counts").doc(cycleCountId).get()).data().variance, -4);

  const reconciled = await reconcileCycleCount({ cycleCountId, reason: "4 units missing at recount" }, deps);
  assert.equal(reconciled.outcome, "applied");
  const events = await getLedgerBySource(cycleCountId);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "ADJUSTED"); assert.equal(events[0].quantity, -4);
});

// =================================================================================================
// SERIAL mode -- exact, missing, unexpected
// =================================================================================================
await check("SERIAL exact: all expected serials counted -> no variance, RECONCILED with no ledger write", async () => {
  const loc = WH(); await seedWarehouse(loc.locationId);
  const partId = nextId("part");
  const { deps, parts } = makeDeps();
  parts.set(partId, { partId, trackingMode: "SERIAL", active: true });
  const sn1 = nextId("sn"); const sn2 = nextId("sn");
  await seedSerializedAsset(partId, sn1, loc.locationId);
  await seedSerializedAsset(partId, sn2, loc.locationId);

  const created = await createCycleCount({ partId, location: loc, idempotencyKey: nextId("idem") }, deps);
  const cycleCountId = created.cycleCountId;
  assert.deepEqual((await db.collection("cycle_counts").doc(cycleCountId).get()).data().expectedSerialNumbers.sort(), [sn1, sn2].sort());

  await submitCycleCount({ cycleCountId, countedSerialNumbers: [sn1, sn2] }, deps);
  const afterSubmit = (await db.collection("cycle_counts").doc(cycleCountId).get()).data();
  assert.deepEqual(afterSubmit.serialVariance, { missing: [], unexpected: [] });

  const reconciled = await reconcileCycleCount({ cycleCountId }, deps);
  assert.equal(reconciled.outcome, "applied");
  assert.equal(await countAt("inventory_transactions", "sourceObject.id", cycleCountId), 0);
});

await check("SERIAL missing: an expected unit is not counted -> reason required, ADJUSTED evidence per missing serial", async () => {
  const loc = WH(); await seedWarehouse(loc.locationId);
  const partId = nextId("part");
  const { deps, parts } = makeDeps();
  parts.set(partId, { partId, trackingMode: "SERIAL", active: true });
  const sn1 = nextId("sn"); const sn2 = nextId("sn");
  await seedSerializedAsset(partId, sn1, loc.locationId);
  await seedSerializedAsset(partId, sn2, loc.locationId);

  const created = await createCycleCount({ partId, location: loc, idempotencyKey: nextId("idem") }, deps);
  const cycleCountId = created.cycleCountId;
  await submitCycleCount({ cycleCountId, countedSerialNumbers: [sn1] }, deps);
  const afterSubmit = (await db.collection("cycle_counts").doc(cycleCountId).get()).data();
  assert.deepEqual(afterSubmit.serialVariance.missing, [sn2]);

  await assert.rejects(() => reconcileCycleCount({ cycleCountId }, deps), CycleCountReasonRequiredError);
  const reconciled = await reconcileCycleCount({ cycleCountId, reason: "unit not found on shelf" }, deps);
  const events = await getLedgerBySource(cycleCountId);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "ADJUSTED"); assert.equal(events[0].serialNo, sn2); assert.equal(events[0].quantity, 1);

  // The registry itself is intentionally NOT flipped to a "missing" state (no such governed lifecycle
  // state exists) -- documented boundary. The unit remains AVAILABLE at its last-known location.
  const assetId = serializedAssetDocId(partId, sn2);
  const asset = (await db.collection("serialized_assets").doc(assetId).get()).data();
  assert.equal(asset.inventoryState, "AVAILABLE");
  assert.equal(asset.currentLocationId, loc.locationId);
});

await check("SERIAL unexpected: a found unit is not expected here -> recorded as evidence, no ledger movement/relocation", async () => {
  const loc = WH(); const elsewhere = WH();
  await seedWarehouse(loc.locationId); await seedWarehouse(elsewhere.locationId);
  const partId = nextId("part");
  const { deps, parts } = makeDeps();
  parts.set(partId, { partId, trackingMode: "SERIAL", active: true });
  const expectedSn = nextId("sn"); const strayS = nextId("sn");
  await seedSerializedAsset(partId, expectedSn, loc.locationId);
  await seedSerializedAsset(partId, strayS, elsewhere.locationId); // a known unit, but AVAILABLE elsewhere

  const created = await createCycleCount({ partId, location: loc, idempotencyKey: nextId("idem") }, deps);
  const cycleCountId = created.cycleCountId;
  await submitCycleCount({ cycleCountId, countedSerialNumbers: [expectedSn, strayS] }, deps);
  const afterSubmit = (await db.collection("cycle_counts").doc(cycleCountId).get()).data();
  assert.deepEqual(afterSubmit.serialVariance.unexpected, [strayS]);

  await reconcileCycleCount({ cycleCountId, reason: "found a unit that belongs elsewhere -- flagged for investigation" }, deps);
  // No ledger event was staged for the unexpected unit (this authority never silently relocates stock --
  // that remains Transfer's exclusive authority); the evidence lives on the cycle count document only.
  assert.equal(await countAt("inventory_transactions", "sourceObject.id", cycleCountId), 0);
  const strayAsset = (await db.collection("serialized_assets").doc(serializedAssetDocId(partId, strayS)).get()).data();
  assert.equal(strayAsset.currentLocationId, elsewhere.locationId, "the stray unit was NOT relocated");
});

// =================================================================================================
// replay / idempotency
// =================================================================================================
await check("duplicate create (same idempotencyKey) -> replayed, no second document, frozen snapshot preserved", async () => {
  const loc = WH(); await seedWarehouse(loc.locationId);
  const partId = nextId("part");
  await seedNoneOnHand(partId, loc, 10);
  const { deps } = makeDeps();
  const idempotencyKey = nextId("idem");
  const first = await createCycleCount({ partId, location: loc, idempotencyKey }, deps);
  await seedNoneOnHand(partId, loc, 100); // ledger moves AFTER create -- must not affect the replay
  const second = await createCycleCount({ partId, location: loc, idempotencyKey }, deps);
  assert.equal(first.outcome, "applied"); assert.equal(second.outcome, "replayed");
  assert.equal(first.cycleCountId, second.cycleCountId);
  assert.equal(await countAt("cycle_counts", "partId", partId), 1);
  assert.equal((await db.collection("cycle_counts").doc(first.cycleCountId).get()).data().expectedQuantity, 10, "snapshot stays frozen at first-create value");
});

await check("duplicate reconcile (retry after apply) -> replayed, no second ADJUSTED event", async () => {
  const loc = WH(); await seedWarehouse(loc.locationId);
  const partId = nextId("part");
  await seedNoneOnHand(partId, loc, 10);
  const { deps } = makeDeps();
  const created = await createCycleCount({ partId, location: loc, idempotencyKey: nextId("idem") }, deps);
  await submitCycleCount({ cycleCountId: created.cycleCountId, countedQuantity: 7 }, deps);
  const r1 = await reconcileCycleCount({ cycleCountId: created.cycleCountId, reason: "shrinkage" }, deps);
  const r2 = await reconcileCycleCount({ cycleCountId: created.cycleCountId, reason: "shrinkage" }, deps);
  assert.equal(r1.outcome, "applied"); assert.equal(r2.outcome, "replayed");
  assert.deepEqual(r1.ledgerEventIds, r2.ledgerEventIds);
  assert.equal(await countAt("inventory_transactions", "sourceObject.id", created.cycleCountId), 1);
});

// =================================================================================================
// unauthorized
// =================================================================================================
await check("unauthorized create -> PERMISSION_DENIED, zero writes", async () => {
  const loc = WH(); await seedWarehouse(loc.locationId);
  const partId = nextId("part");
  await seedNoneOnHand(partId, loc, 10);
  const { deps } = makeDeps({ authorize: async () => false });
  await assert.rejects(
    () => createCycleCount({ partId, location: loc, idempotencyKey: nextId("idem") }, deps),
    UnauthorizedCycleCountError,
  );
  assert.equal(await countAt("cycle_counts", "partId", partId), 0);
});
await check("unauthorized reconcile -> PERMISSION_DENIED, status unchanged", async () => {
  const loc = WH(); await seedWarehouse(loc.locationId);
  const partId = nextId("part");
  await seedNoneOnHand(partId, loc, 10);
  const { deps, grants } = makeDeps();
  const created = await createCycleCount({ partId, location: loc, idempotencyKey: nextId("idem") }, deps);
  await submitCycleCount({ cycleCountId: created.cycleCountId, countedQuantity: 8 }, deps);
  grants.delete("inventory.cycleCount.reconcile");
  await assert.rejects(() => reconcileCycleCount({ cycleCountId: created.cycleCountId, reason: "x" }, deps), UnauthorizedCycleCountError);
  assert.equal((await db.collection("cycle_counts").doc(created.cycleCountId).get()).data().status, "COUNTED");
});

// =================================================================================================
// transfer-in-flight treatment (documented boundary, not an unresolved ambiguity)
// =================================================================================================
await check("in-transit stock is excluded from BOTH endpoints' expected quantity (already-dispatched, not-yet-received)", async () => {
  const origin = WH(); const destination = WH();
  await seedWarehouse(origin.locationId); await seedWarehouse(destination.locationId);
  const partId = nextId("part");
  await seedNoneOnHand(partId, origin, 10);
  // Simulate a Transfer that has posted TRANSFER_OUT at origin but has NOT yet posted TRANSFER_IN at
  // destination (mid-flight) -- exactly transferOrderCommand.ts's dispatchTransferOrder ledger effect.
  const transferOrderId = nextId("trf");
  await seedLedgerEvent(partId, "TRANSFER_OUT", origin, 4, {
    direction: "OUT", sourceObject: { type: "TRANSFER_ORDER", id: transferOrderId }, counterpartyLocation: destination,
  });
  const { deps } = makeDeps();

  const atOrigin = await createCycleCount({ partId, location: origin, idempotencyKey: nextId("idem") }, deps);
  assert.equal((await db.collection("cycle_counts").doc(atOrigin.cycleCountId).get()).data().expectedQuantity, 6, "10 - 4 in-flight = 6 remaining at origin");

  const atDestination = await createCycleCount({ partId, location: destination, idempotencyKey: nextId("idem") }, deps);
  assert.equal((await db.collection("cycle_counts").doc(atDestination.cycleCountId).get()).data().expectedQuantity, 0, "not yet posted TRANSFER_IN -- destination does not expect it either");
});

// =================================================================================================
// atomic failure: nothing partially written when the command throws mid-transaction
// =================================================================================================
await check("atomic failure: a downstream error after location checks leaves NO cycle_counts/ledger writes", async () => {
  const loc = WH(); await seedWarehouse(loc.locationId);
  const partId = nextId("part");
  await seedNoneOnHand(partId, loc, 10);
  const { deps } = makeDeps();
  const boom = { ...deps, stageAudit: () => { throw new Error("simulated downstream failure"); } };
  await assert.rejects(() => createCycleCount({ partId, location: loc, idempotencyKey: nextId("idem") }, boom));
  assert.equal(await countAt("cycle_counts", "partId", partId), 0);
});

await check("cancel an OPEN cycle count -> CANCELLED, no ledger effect; cancel after submit is NOT domain-safe", async () => {
  const loc = WH(); await seedWarehouse(loc.locationId);
  const partId = nextId("part");
  await seedNoneOnHand(partId, loc, 10);
  const { deps } = makeDeps();
  const created = await createCycleCount({ partId, location: loc, idempotencyKey: nextId("idem") }, deps);
  const cancelled = await cancelCycleCount({ cycleCountId: created.cycleCountId }, deps);
  assert.equal(cancelled.outcome, "applied");
  assert.equal((await db.collection("cycle_counts").doc(created.cycleCountId).get()).data().status, "CANCELLED");

  const created2 = await createCycleCount({ partId, location: loc, idempotencyKey: nextId("idem") }, deps);
  await submitCycleCount({ cycleCountId: created2.cycleCountId, countedQuantity: 10 }, deps);
  await assert.rejects(() => cancelCycleCount({ cycleCountId: created2.cycleCountId }, deps), CycleCountStatusInvalidError);
});

await check("unknown cycleCountId -> CYCLE_COUNT_NOT_FOUND; invalid location -> LOCATION_INVALID; inactive part -> PART_INVALID", async () => {
  const { deps } = makeDeps();
  await assert.rejects(() => submitCycleCount({ cycleCountId: nextId("nope"), countedQuantity: 1 }, deps), CycleCountNotFoundError);

  const partId = nextId("part");
  const badLoc = { type: "WAREHOUSE", locationId: nextId("wh") }; // never seeded
  await assert.rejects(() => createCycleCount({ partId, location: badLoc, idempotencyKey: nextId("idem") }, deps), CycleCountLocationInvalidError);

  const loc = WH(); await seedWarehouse(loc.locationId);
  const { deps: deps2, parts } = makeDeps();
  const inactivePartId = nextId("part");
  parts.set(inactivePartId, { partId: inactivePartId, trackingMode: "NONE", active: false });
  await assert.rejects(() => createCycleCount({ partId: inactivePartId, location: loc, idempotencyKey: nextId("idem") }, deps2), CycleCountPartInvalidError);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
