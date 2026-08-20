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
  UnauthorizedCycleCountError, CycleCountSelfApprovalError, CycleCountNotFoundError, CycleCountLocationInvalidError,
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
// M23 blind-count remediation -- a manager actor DISTINCT from whichever `deps.actor` submitted the
// count. All the pre-existing tests below were written with ONE actor performing every step (create,
// submit, reconcile) -- exactly the pattern the separation-of-duties guard now refuses for a material
// variance, so every reconcile call on a material-variance count is switched to this manager identity.
function managerDeps(deps) {
  return { ...deps, actor: { kind: "USER", id: nextId("manager") } };
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

  const manager = managerDeps(deps);
  await assert.rejects(() => reconcileCycleCount({ cycleCountId }, manager), CycleCountReasonRequiredError);
  const reconciled = await reconcileCycleCount({ cycleCountId, reason: "found extra units on shelf recount" }, manager);
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

  const reconciled = await reconcileCycleCount({ cycleCountId, reason: "4 units missing at recount" }, managerDeps(deps));
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

  const manager = managerDeps(deps);
  await assert.rejects(() => reconcileCycleCount({ cycleCountId }, manager), CycleCountReasonRequiredError);
  const reconciled = await reconcileCycleCount({ cycleCountId, reason: "unit not found on shelf" }, manager);
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

  await reconcileCycleCount({ cycleCountId, reason: "found a unit that belongs elsewhere -- flagged for investigation" }, managerDeps(deps));
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
  const manager = managerDeps(deps);
  const r1 = await reconcileCycleCount({ cycleCountId: created.cycleCountId, reason: "shrinkage" }, manager);
  // The retry reuses the SAME manager actor as r1 -- stageOperationalMovement's own idempotency guard
  // treats a same-key ledger event from a DIFFERENT actor as a genuine conflict (correctly so -- an
  // idempotency key replayed under a different identity is exactly the kind of thing that guard exists
  // to catch), so a true retry-after-apply is always "the same actor retrying," never a second actor
  // reusing the first actor's key. The separation-of-duties replay-skip is proven separately below.
  const r2 = await reconcileCycleCount({ cycleCountId: created.cycleCountId, reason: "shrinkage" }, manager);
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

// =================================================================================================
// M23 blind-count remediation -- separation of duties (server-side, cannot be bypassed by a client)
// and the manager review step (approve/reject). Defaults exercised throughout: absolute floor 3 units,
// relative ceiling 10% (functions/src/cycleCount/cycleCountMateriality.ts) -- no env override unless a
// test says so.
// =================================================================================================

await check("self-approval REFUSED: the submitting actor cannot approve their own MATERIAL variance", async () => {
  const loc = WH(); await seedWarehouse(loc.locationId);
  const partId = nextId("part");
  await seedNoneOnHand(partId, loc, 10);
  const { deps } = makeDeps();
  const created = await createCycleCount({ partId, location: loc, idempotencyKey: nextId("idem") }, deps);
  const cycleCountId = created.cycleCountId;
  await submitCycleCount({ cycleCountId, countedQuantity: 6 }, deps); // variance -4: abs 4 >= floor 3 -> material

  await assert.rejects(() => reconcileCycleCount({ cycleCountId, reason: "shrinkage" }, deps), CycleCountSelfApprovalError);
  // Refused before any write: the record is still COUNTED, no ledger evidence exists.
  assert.equal((await db.collection("cycle_counts").doc(cycleCountId).get()).data().status, "COUNTED");
  assert.equal(await countAt("inventory_transactions", "sourceObject.id", cycleCountId), 0);

  // The SAME refusal applies to REJECT -- disposing of a material variance either way is still a
  // disposition by the same principal who counted it.
  await assert.rejects(() => reconcileCycleCount({ cycleCountId, reason: "recount disputed", decision: "REJECT" }, deps), CycleCountSelfApprovalError);
});

await check("manager approval ACCEPTED: a different actor may approve the same MATERIAL variance", async () => {
  const loc = WH(); await seedWarehouse(loc.locationId);
  const partId = nextId("part");
  await seedNoneOnHand(partId, loc, 10);
  const { deps } = makeDeps();
  const created = await createCycleCount({ partId, location: loc, idempotencyKey: nextId("idem") }, deps);
  const cycleCountId = created.cycleCountId;
  await submitCycleCount({ cycleCountId, countedQuantity: 6 }, deps); // same material -4 as above

  const reconciled = await reconcileCycleCount({ cycleCountId, reason: "shrinkage confirmed" }, managerDeps(deps));
  assert.equal(reconciled.outcome, "applied");
  assert.equal(reconciled.status, "RECONCILED");
  assert.equal(reconciled.reviewDecision, "APPROVE");
  const events = await getLedgerBySource(cycleCountId);
  assert.equal(events.length, 1); assert.equal(events[0].quantity, -4);
});

await check("manager REJECT ACCEPTED: disposes the count as disputed, stages NO ledger evidence", async () => {
  const loc = WH(); await seedWarehouse(loc.locationId);
  const partId = nextId("part");
  await seedNoneOnHand(partId, loc, 10);
  const { deps } = makeDeps();
  const created = await createCycleCount({ partId, location: loc, idempotencyKey: nextId("idem") }, deps);
  const cycleCountId = created.cycleCountId;
  await submitCycleCount({ cycleCountId, countedQuantity: 6 }, deps);

  const rejected = await reconcileCycleCount({ cycleCountId, reason: "recount scheduled, not trusting this count yet", decision: "REJECT" }, managerDeps(deps));
  assert.equal(rejected.outcome, "applied");
  assert.equal(rejected.status, "REJECTED");
  assert.equal(rejected.reviewDecision, "REJECT");
  assert.deepEqual(rejected.ledgerEventIds, []);
  assert.equal(await countAt("inventory_transactions", "sourceObject.id", cycleCountId), 0, "reject must never stage ADJUSTED evidence");
  const stored = (await db.collection("cycle_counts").doc(cycleCountId).get()).data();
  assert.equal(stored.status, "REJECTED");

  // A decision cannot be flipped after the fact.
  await assert.rejects(() => reconcileCycleCount({ cycleCountId, reason: "actually approve it" }, managerDeps(deps)), CycleCountStatusInvalidError);
});

await check("sub-threshold variance: the SAME actor may reconcile (not material) -- no separation-of-duties refusal", async () => {
  const loc = WH(); await seedWarehouse(loc.locationId);
  const partId = nextId("part");
  await seedNoneOnHand(partId, loc, 100);
  const { deps } = makeDeps();
  const created = await createCycleCount({ partId, location: loc, idempotencyKey: nextId("idem") }, deps);
  const cycleCountId = created.cycleCountId;
  await submitCycleCount({ cycleCountId, countedQuantity: 99 }, deps); // variance -1: abs 1 < floor 3, 1/100 = 1% < 10%

  const reconciled = await reconcileCycleCount({ cycleCountId, reason: "single-unit rounding, recounted" }, deps); // SAME actor as submit
  assert.equal(reconciled.outcome, "applied");
  assert.equal(reconciled.status, "RECONCILED");
});

await check("materiality threshold is CONFIGURABLE via env -- lowering it makes a previously sub-threshold variance material", async () => {
  const loc = WH(); await seedWarehouse(loc.locationId);
  const partId = nextId("part");
  await seedNoneOnHand(partId, loc, 100);
  const { deps } = makeDeps();
  const created = await createCycleCount({ partId, location: loc, idempotencyKey: nextId("idem") }, deps);
  const cycleCountId = created.cycleCountId;
  await submitCycleCount({ cycleCountId, countedQuantity: 99 }, deps); // variance -1, immaterial under defaults

  const prevAbs = process.env.CYCLE_COUNT_MATERIALITY_ABS_UNITS;
  const prevPct = process.env.CYCLE_COUNT_MATERIALITY_PCT;
  try {
    process.env.CYCLE_COUNT_MATERIALITY_ABS_UNITS = "1"; // any non-zero variance is now material
    process.env.CYCLE_COUNT_MATERIALITY_PCT = "0";
    await assert.rejects(() => reconcileCycleCount({ cycleCountId, reason: "recount" }, deps), CycleCountSelfApprovalError);
    // A different actor still succeeds under the tightened config.
    const reconciled = await reconcileCycleCount({ cycleCountId, reason: "recount" }, managerDeps(deps));
    assert.equal(reconciled.outcome, "applied");
  } finally {
    if (prevAbs === undefined) delete process.env.CYCLE_COUNT_MATERIALITY_ABS_UNITS; else process.env.CYCLE_COUNT_MATERIALITY_ABS_UNITS = prevAbs;
    if (prevPct === undefined) delete process.env.CYCLE_COUNT_MATERIALITY_PCT; else process.env.CYCLE_COUNT_MATERIALITY_PCT = prevPct;
  }
});

await check("replay of an already-decided count never re-runs the separation-of-duties check", async () => {
  // SERIAL "unexpected-only" variance stages NO ledger evidence (documented boundary -- see the SERIAL
  // unexpected test above), so the replay comparison below never touches inventory_transactions and
  // therefore never hits stageOperationalMovement's own actor-sensitive idempotency guard -- this
  // isolates the separation-of-duties replay-skip specifically, uncoupled from ledger-idempotency rules.
  const loc = WH(); await seedWarehouse(loc.locationId);
  const partId = nextId("part");
  const { deps, parts } = makeDeps();
  parts.set(partId, { partId, trackingMode: "SERIAL", active: true });
  const expectedSn = nextId("sn"); const strayS = nextId("sn");
  await seedSerializedAsset(partId, expectedSn, loc.locationId);

  const created = await createCycleCount({ partId, location: loc, idempotencyKey: nextId("idem") }, deps);
  const cycleCountId = created.cycleCountId;
  await submitCycleCount({ cycleCountId, countedSerialNumbers: [expectedSn, strayS] }, deps); // 1 unexpected of 1 expected -> 100% material

  const r1 = await reconcileCycleCount({ cycleCountId, reason: "unexpected unit flagged" }, managerDeps(deps));
  assert.equal(r1.outcome, "applied");
  // The retry reuses the counter's OWN actor -- if the self-approval check ran again here it would
  // refuse; it must not, because the count is already RECONCILED.
  const r2 = await reconcileCycleCount({ cycleCountId, reason: "unexpected unit flagged" }, deps);
  assert.equal(r2.outcome, "replayed");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
