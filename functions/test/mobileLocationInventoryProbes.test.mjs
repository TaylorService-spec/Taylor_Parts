// Enterprise Inventory Phase 5 -- emulator tests proving the REAL MOBILE-location governed-inventory
// probes (functions/src/inventoryLedger/mobileLocationPresenceProbe.ts) are conclusive against actual
// serialized_assets / inventory_transactions / transfer_orders data, and that the truck-registry
// commands (deactivateTruck / deleteTruckCreatedInError) now use them by DEFAULT. Requires the
// Firestore emulator. Prerequisite: npm run build; emulator running.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
import assert from "node:assert/strict";
import admin from "firebase-admin";
admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();

const {
  probeSerializedAssetsPresentAtLocation,
  probeSerializedAssetsReferencedAtLocation,
  probeNoneStockPresentAtLocation,
  probeLedgerReferencedAtLocation,
  buildMobileLocationGovernedInventoryProbe,
} = await import("../lib/inventoryLedger/mobileLocationPresenceProbe.js");
const { buildOperationalReferenceProbe, REFERENCE_AUTHORITY_KEYS } = await import("../lib/truckRegistry/operationalReferenceProbe.js");
const {
  createTruck, deactivateTruck, deleteTruckCreatedInError,
} = await import("../lib/truckRegistry/truckRegistryCommands.js");
const { InventoryPresentError, InventoryStateUnknownError, TruckReferencedError, ReferenceStateUnknownError } =
  await import("../lib/truckRegistry/types.js");

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS: ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL: ${name}`); console.error(err); }
}
const now = Date.now();
let seq = 0;
const uid = (p) => `${p}-${now}-${(seq += 1)}`;
const key = (p) => `${p}-key-${now}-${(seq += 1)}`;

async function seedActor(role) { const u = uid("actor"); await db.collection("users").doc(u).set({ role }); return u; }
async function seedWarehouse() { const w = uid("wh"); await db.collection("warehouses").doc(w).set({ name: "WH" }); return w; }
const admin1 = await seedActor("admin");
const LBL = { displayLabel: "Truck", vehicleNumber: "V-1" };

async function makeTruck() {
  const wh = await seedWarehouse();
  const truckId = uid("TRK"), locationId = uid("MLOC");
  const r = await createTruck({ actorUid: admin1, idempotencyKey: key("c"), truckId, locationId, homeWarehouseId: wh, ...LBL }, { now: () => new Date() });
  return { truckId, locationId, wh, version: r.version };
}

function ledgerDoc({ locationId, partId, type, quantity, trackingMode = "NONE", serialNo, counterpartyLocationId }) {
  const direction = { RECEIVED: "IN", RETURNED: "IN", TRANSFER_IN: "IN", TRANSFER_OUT: "OUT", SCRAPPED: "OUT", ADJUSTED: "SIGNED", COUNTED: "SNAPSHOT" }[type];
  const sourceType = { RECEIVED: "RECEIVING_ORDER", RETURNED: "RMA", TRANSFER_OUT: "TRANSFER_ORDER", TRANSFER_IN: "TRANSFER_ORDER", COUNTED: "COUNT_SHEET", ADJUSTED: "ADJUSTMENT", SCRAPPED: "SCRAP" }[type];
  const isTransfer = type === "TRANSFER_OUT" || type === "TRANSFER_IN";
  const data = {
    schemaVersion: 2, type, direction, partId, trackingMode,
    location: { type: "MOBILE", locationId }, quantity,
    sourceObject: { type: sourceType, id: uid("src") },
    idempotencyKey: key("mv"), actor: { kind: "SYSTEM", id: "WORK_ORDER_TRANSITION" },
    occurredAt: now, recordedAt: admin.firestore.Timestamp.now(),
    fingerprint: "0000000000000000",
  };
  if (trackingMode === "SERIAL" && serialNo) data.serialNo = serialNo;
  if (isTransfer) data.counterpartyLocation = { type: "WAREHOUSE", locationId: counterpartyLocationId ?? uid("cp") };
  return data;
}
async function writeLedger(entry) {
  await db.collection("inventory_transactions").doc(uid("imv")).set(ledgerDoc(entry));
}
async function writeSerializedAsset({ locationId, inventoryState = "AVAILABLE", partId }) {
  const serialNo = uid("SN");
  await db.collection("serialized_assets").doc(uid("sa")).set({
    schemaVersion: 1, serialNo, partId: partId ?? uid("part"), currentLocationId: locationId,
    inventoryState, currentEquipmentId: null, ownership: "OWNED",
  });
  return serialNo;
}

// ============================= mobileLocationPresenceProbe.ts direct tests =============================

await check("empty truck: no ledger, no serialized assets -> ABSENT / ABSENT / CLEAR / CLEAR", async () => {
  const { locationId } = await makeTruck();
  await db.runTransaction(async (txn) => {
    assert.equal(await probeSerializedAssetsPresentAtLocation(txn, db, locationId), "ABSENT");
    assert.equal(await probeNoneStockPresentAtLocation(txn, db, locationId), "ABSENT");
    assert.equal(await probeSerializedAssetsReferencedAtLocation(txn, db, locationId), "ABSENT");
    assert.equal(await probeLedgerReferencedAtLocation(txn, db, locationId), "ABSENT");
  });
});

await check("NONE stock projection: RECEIVED then partial TRANSFER_OUT nets to remaining positive balance -> PRESENT", async () => {
  const { locationId } = await makeTruck();
  const partId = uid("part");
  await writeLedger({ locationId, partId, type: "RECEIVED", quantity: 10 });
  await writeLedger({ locationId, partId, type: "TRANSFER_OUT", quantity: 4 });
  await db.runTransaction(async (txn) => {
    assert.equal(await probeNoneStockPresentAtLocation(txn, db, locationId), "PRESENT");
  });
});

await check("NONE stock projection: RECEIVED fully offset by TRANSFER_OUT nets to zero -> ABSENT (net balance, not history)", async () => {
  const { locationId } = await makeTruck();
  const partId = uid("part");
  await writeLedger({ locationId, partId, type: "RECEIVED", quantity: 5 });
  await writeLedger({ locationId, partId, type: "TRANSFER_OUT", quantity: 5 });
  await db.runTransaction(async (txn) => {
    assert.equal(await probeNoneStockPresentAtLocation(txn, db, locationId), "ABSENT");
    // but the LEDGER REFERENCE (history) is NOT absent -- the location was referenced, even though net is zero
    assert.equal(await probeLedgerReferencedAtLocation(txn, db, locationId), "PRESENT");
  });
});

await check("NONE stock projection: COUNTED entries are excluded from the balance (observation-only invariant)", async () => {
  const { locationId } = await makeTruck();
  const partId = uid("part");
  await writeLedger({ locationId, partId, type: "COUNTED", quantity: 99 });
  await db.runTransaction(async (txn) => {
    assert.equal(await probeNoneStockPresentAtLocation(txn, db, locationId), "ABSENT");
  });
});

await check("SERIAL projection: an AVAILABLE serialized asset at the location -> PRESENT", async () => {
  const { locationId } = await makeTruck();
  await writeSerializedAsset({ locationId, inventoryState: "AVAILABLE" });
  await db.runTransaction(async (txn) => {
    assert.equal(await probeSerializedAssetsPresentAtLocation(txn, db, locationId), "PRESENT");
    assert.equal(await probeSerializedAssetsReferencedAtLocation(txn, db, locationId), "PRESENT");
  });
});

await check("SERIAL projection: a serialized asset elsewhere does NOT present at this location (location-bound)", async () => {
  const { locationId } = await makeTruck();
  const other = uid("MLOC-other");
  await writeSerializedAsset({ locationId: other, inventoryState: "AVAILABLE" });
  await db.runTransaction(async (txn) => {
    assert.equal(await probeSerializedAssetsPresentAtLocation(txn, db, locationId), "ABSENT");
  });
});

await check("inbound transfer (TRANSFER_IN) raises NONE-mode balance -> PRESENT", async () => {
  const { locationId } = await makeTruck();
  const partId = uid("part");
  await writeLedger({ locationId, partId, type: "TRANSFER_IN", quantity: 3 });
  await db.runTransaction(async (txn) => {
    assert.equal(await probeNoneStockPresentAtLocation(txn, db, locationId), "PRESENT");
  });
});

await check("outbound transfer (TRANSFER_OUT) alone -> negative-only balance stays ABSENT (never fabricates a positive)", async () => {
  const { locationId } = await makeTruck();
  const partId = uid("part");
  await writeLedger({ locationId, partId, type: "TRANSFER_OUT", quantity: 3 });
  await db.runTransaction(async (txn) => {
    assert.equal(await probeNoneStockPresentAtLocation(txn, db, locationId), "ABSENT");
  });
});

await check("in-transit behaviour: a SERIAL unit whose custody has NOT yet moved to the truck (still at origin) does not present at the truck", async () => {
  const { locationId: truckLoc } = await makeTruck();
  const origin = uid("MLOC-origin");
  // dispatch has occurred (ledger TRANSFER_OUT at origin) but currentLocationId only moves at receive/
  // completion (governed constraint) -- the asset's custody is still the origin, not the truck.
  await writeSerializedAsset({ locationId: origin, inventoryState: "IN_TRANSIT" });
  const partId = uid("part");
  await writeLedger({ locationId: origin, partId, type: "TRANSFER_OUT", quantity: 1, trackingMode: "SERIAL", serialNo: uid("SN") });
  await db.runTransaction(async (txn) => {
    assert.equal(await probeSerializedAssetsPresentAtLocation(txn, db, truckLoc), "ABSENT");
  });
});

// ================================ combined GovernedInventoryProbe ================================

await check("combined probe: empty truck -> ABSENT", async () => {
  const { locationId } = await makeTruck();
  const probe = buildMobileLocationGovernedInventoryProbe(db);
  await db.runTransaction(async (txn) => { assert.equal(await probe(locationId, txn), "ABSENT"); });
});

await check("combined probe: SERIAL presence dominates even with zero NONE-mode ledger balance", async () => {
  const { locationId } = await makeTruck();
  await writeSerializedAsset({ locationId, inventoryState: "AVAILABLE" });
  const probe = buildMobileLocationGovernedInventoryProbe(db);
  await db.runTransaction(async (txn) => { assert.equal(await probe(locationId, txn), "PRESENT"); });
});

await check("combined probe: NONE-mode positive balance alone -> PRESENT", async () => {
  const { locationId } = await makeTruck();
  await writeLedger({ locationId, partId: uid("part"), type: "RECEIVED", quantity: 1 });
  const probe = buildMobileLocationGovernedInventoryProbe(db);
  await db.runTransaction(async (txn) => { assert.equal(await probe(locationId, txn), "PRESENT"); });
});

// ============================= end-to-end: deactivateTruck (real default probe) =============================

await check("deactivateTruck: empty truck -> a successful eligible action (DEFAULT deps, no injected probe)", async () => {
  const { truckId, version } = await makeTruck();
  const r = await deactivateTruck({ actorUid: admin1, idempotencyKey: key("deact"), truckId, expectedVersion: version }, { now: () => new Date() });
  assert.equal(r.outcome, "applied");
});

await check("deactivateTruck: truck with governed inventory present -> denied (InventoryPresentError, DEFAULT deps)", async () => {
  const { truckId, locationId, version } = await makeTruck();
  await writeSerializedAsset({ locationId, inventoryState: "AVAILABLE" });
  await assert.rejects(
    deactivateTruck({ actorUid: admin1, idempotencyKey: key("deact"), truckId, expectedVersion: version }, { now: () => new Date() }),
    InventoryPresentError,
  );
});

// =================== end-to-end: deleteTruckCreatedInError (real default reference probe) ===================

await check("deleteTruckCreatedInError: truck referenced by a transfer order -> denied (TruckReferencedError, DEFAULT deps)", async () => {
  const { truckId, locationId, wh, version } = await makeTruck();
  await db.collection("transfer_orders").doc(uid("trf")).set({
    schemaVersion: 1, partId: uid("part"), trackingMode: "NONE", quantity: 1,
    origin: { type: "WAREHOUSE", locationId: wh }, destination: { type: "MOBILE", locationId },
    status: "REQUESTED", version: 1, idempotencyKey: key("t"), actor: { kind: "USER", id: admin1 },
    createdAt: admin.firestore.Timestamp.now(), createdBy: admin1, updatedAt: admin.firestore.Timestamp.now(), updatedBy: admin1,
    fingerprint: "0000000000000000",
  });
  await assert.rejects(
    deleteTruckCreatedInError({ actorUid: admin1, idempotencyKey: key("del"), truckId, expectedVersion: version, deletionReason: "created in error, unit-test" }, { now: () => new Date() }),
    TruckReferencedError,
  );
});

await check("deleteTruckCreatedInError: no reference in any of the 5 now-provable authorities, but the 6 unresolvable authorities remain UNKNOWN -> STILL denied (ReferenceStateUnknownError, DEFAULT deps) -- delete safety is NOT loosened", async () => {
  const { truckId, version } = await makeTruck(); // genuinely empty: no ledger, no serialized asset, no transfer order
  await assert.rejects(
    deleteTruckCreatedInError({ actorUid: admin1, idempotencyKey: key("del"), truckId, expectedVersion: version, deletionReason: "created in error, unit-test" }, { now: () => new Date() }),
    ReferenceStateUnknownError,
  );
});

await check("deleteTruckCreatedInError: with an injected full-coverage CLEAR registry (all 11 authorities), delete succeeds -- proving the AGGREGATE gate itself is sound; the DEFAULT wiring is what remains fail-closed today", async () => {
  const { truckId, version } = await makeTruck();
  const allClear = REFERENCE_AUTHORITY_KEYS.map((k) => ({ key: k, description: k, verifiableNow: true, check: async () => "CLEAR" }));
  const probe = buildOperationalReferenceProbe({ db }, allClear);
  const r = await deleteTruckCreatedInError(
    { actorUid: admin1, idempotencyKey: key("del"), truckId, expectedVersion: version, deletionReason: "created in error, unit-test" },
    { now: () => new Date(), hasOperationalReferences: probe },
  );
  assert.equal(r.outcome, "applied");
});

// ============================= structural: no duplicate inventory authority =============================

await check("structural: the probes perform ONLY reads (txn.get), never a write (create/set/update/delete) -- no new inventory-quantity store is written by this probe layer", async () => {
  const { locationId } = await makeTruck();
  await writeSerializedAsset({ locationId, inventoryState: "AVAILABLE" });
  await writeLedger({ locationId, partId: uid("part"), type: "RECEIVED", quantity: 2 });
  let writeCalls = 0;
  await db.runTransaction(async (realTxn) => {
    const spyTxn = new Proxy(realTxn, {
      get(target, prop, receiver) {
        if (prop === "set" || prop === "create" || prop === "update" || prop === "delete") {
          return (...args) => { writeCalls += 1; return Reflect.get(target, prop, receiver).apply(target, args); };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    await probeSerializedAssetsPresentAtLocation(spyTxn, db, locationId);
    await probeNoneStockPresentAtLocation(spyTxn, db, locationId);
    await probeSerializedAssetsReferencedAtLocation(spyTxn, db, locationId);
    await probeLedgerReferencedAtLocation(spyTxn, db, locationId);
    const probe = buildMobileLocationGovernedInventoryProbe(db);
    await probe(locationId, spyTxn);
  });
  assert.equal(writeCalls, 0, "probe layer must never write -- it is a projection, not an authority");
});

await check("structural: no new inventory collection is introduced -- the probes read ONLY serialized_assets, inventory_transactions, and transfer_orders (the three collections Enterprise Inventory already owns)", async () => {
  const src = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../src/inventoryLedger/mobileLocationPresenceProbe.ts", import.meta.url), "utf8"));
  const collectionRefs = [...src.matchAll(/db\.collection\((\w+)\)/g)].map((m) => m[1]);
  const allowed = new Set(["INVENTORY_TRANSACTIONS_COLLECTION", "SERIALIZED_ASSETS_COLLECTION"]);
  assert.ok(collectionRefs.length > 0, "the probe module reads at least one collection");
  for (const ref of collectionRefs) assert.ok(allowed.has(ref), `unexpected collection reference: ${ref}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
