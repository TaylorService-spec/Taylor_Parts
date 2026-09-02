// Site-work #7 (inventory-ledger-missing-tests) -- behavioral coverage for
// functions/src/inventoryService.ts, the sole source of stock truth
// (reserve/release/consume + trigger-effects idempotency + all-or-nothing
// rejection on insufficient stock). Previously had zero automated tests
// despite being load-bearing (see functions/test/transitionEngine.test.mjs's
// own header, which explicitly names inventoryService.ts as one of the
// modules "covered separately once the emulator is available").
//
// Same harness as functions/test/completeAssignedJob.test.js /
// functions/test/createWorkOrderIdempotency.test.js: the compiled module is
// invoked directly against a LIVE Firestore emulator (no rules-unit-testing,
// no HTTP layer). Imported from its own compiled module, never via
// lib/index.js (which calls initializeApp() itself and would collide with
// this file's own admin.initializeApp()).
//
// Each test uses a distinct SKU from the static functions/src/data/
// partsCatalog.ts catalog so that getAvailableQuantity()'s WAREHOUSE-WIDE
// (not per-Work-Order) ledger sum for a given partId never crosses
// contamination between tests sharing one emulator project.
//
// Prerequisite (also how CI runs it):
//   firebase emulators:start --only firestore --project taylor-parts
//   (after `npm run build`) node --test test/inventoryService.test.mjs
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";

import assert from "node:assert/strict";
import { test } from "node:test";

const admin = (await import("firebase-admin")).default;
const PROJECT_ID = "taylor-parts";
admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

const {
  reserveParts,
  releaseParts,
  consumeParts,
  finalizeInventoryTransaction,
  triggerInventoryEffects,
} = await import("../lib/inventoryService.js");

const WOS = "fieldops_wos";
const LEDGER = "inventory_transactions";
const SYNC = "inventory_sync_status";

let counter = 0;
function id(label) {
  counter += 1;
  return `${label}-${Date.now()}-${counter}`;
}

async function seedWorkOrder(woId, items) {
  await db.collection(WOS).doc(woId).set({ id: woId, inventorySnapshot: items });
}

async function ledgerFor(woId, partId) {
  const snap = await db
    .collection(LEDGER)
    .where("workOrderId", "==", woId)
    .where("partId", "==", partId)
    .get();
  return snap.docs.map((d) => d.data());
}

// ── GOVERNED STOCK, because the static catalogue is no longer inventory (DECISIONS #162) ──
//
// These tests used to get their stock from data/partsCatalog.ts's static `warehouseQty`, which
// getAvailableQuantity() added the ledger to. That baseline is gone: a fixture quantity may not
// decide whether a real dispatch succeeds. Operational on-hand is now ledger evidence at an
// ACTIVE warehouse, and a part with no evidence is UNKNOWN — not zero, and not committable.
//
// So the harness seeds the SAME quantities the catalogue used to supply, as real RECEIVED
// movements at one eligible warehouse. Every test's arithmetic is unchanged; only where the
// stock comes from changed, which is the whole point of the ruling.
const WAREHOUSES = "warehouses";
const TEST_WAREHOUSE = "wh-inventory-service-test";

/** The catalogue quantities these tests were written against, now seeded as governed movements. */
const GOVERNED_STOCK = {
  "TST-1002": 6, "TST-1003": 20, "TST-1004": 4, "TST-1005": 2, "TST-1006": 8,
  "TST-1007": 2, "TST-1008": 6, "TST-1009": 6, "TST-1010": 4, "TST-1011": 2,
  "TST-1013": 6, "TST-1014": 10, "TST-1015": 4, "TST-1016": 12, "TST-1017": 20,
  "TST-1018": 4, "TST-1019": 20, "TST-1020": 2, "TST-1031": 0, "TST-1035": 2,
  "TST-1040": 4, "TST-1058": 12, "TST-1059": 10, "TST-1060": 12, "TST-1061": 4,
};

async function seedGovernedStock() {
  await db.collection(WAREHOUSES).doc(TEST_WAREHOUSE).set({ id: TEST_WAREHOUSE, status: "ACTIVE" }, { merge: true });
  const batch = db.batch();
  for (const [partId, quantity] of Object.entries(GOVERNED_STOCK)) {
    // A zero-quantity RECEIVED is deliberate for TST-1031: it is EVIDENCE that nets to zero (a real
    // empty shelf), which is a different fact from no evidence at all (UNKNOWN).
    batch.set(db.collection(LEDGER).doc(), {
      workOrderId: "",
      partId,
      type: "RECEIVED",
      quantity,
      trackingMode: "NONE",
      location: { type: "WAREHOUSE", locationId: TEST_WAREHOUSE },
      schemaVersion: 2,
      timestamp: admin.firestore.Timestamp.now(),
    });
  }
  await batch.commit();
}
await seedGovernedStock();

async function seedRawLedgerEntry(woId, partId, type, quantity) {
  await db.collection(LEDGER).add({
    workOrderId: woId,
    partId,
    type,
    quantity,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });
}

function sumType(entries, type) {
  return entries.filter((e) => e.type === type).reduce((s, e) => s + e.quantity, 0);
}

// ---- reserveParts: happy path -----------------------------------------

test("reserveParts writes one RESERVED entry per planned item, exact quantity", async () => {
  const woId = id("wo");
  await seedWorkOrder(woId, [{ sku: "TST-1002", qtyPlanned: 3 }]);
  await reserveParts(woId);

  const entries = await ledgerFor(woId, "TST-1002");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].type, "RESERVED");
  assert.equal(entries[0].quantity, 3);
});

test("reserveParts with an empty/missing inventorySnapshot is a no-op", async () => {
  const woId = id("wo");
  await seedWorkOrder(woId, []);
  await reserveParts(woId); // must not throw
  const snap = await db.collection(LEDGER).where("workOrderId", "==", woId).get();
  assert.equal(snap.size, 0);
});

test("reserveParts skips items with qtyPlanned <= 0", async () => {
  const woId = id("wo");
  await seedWorkOrder(woId, [{ sku: "TST-1009", qtyPlanned: 0 }]);
  await reserveParts(woId);
  const entries = await ledgerFor(woId, "TST-1009");
  assert.equal(entries.length, 0);
});

test("reserveParts against a nonexistent Work Order rejects", async () => {
  await assert.rejects(reserveParts(id("wo-missing")), /No Work Order/);
});

// ---- reserve -> consume happy path -------------------------------------

test("reserve then consume: outstanding reservation is fully converted, no double-count", async () => {
  const woId = id("wo");
  await seedWorkOrder(woId, [{ sku: "TST-1013", qtyPlanned: 2 }]);
  await reserveParts(woId);
  await consumeParts(woId);

  const entries = await ledgerFor(woId, "TST-1013");
  assert.equal(sumType(entries, "RESERVED"), 2);
  assert.equal(sumType(entries, "CONSUMED"), 2);
  // Per the module's documented availability model, CONSUMED does not
  // subtract a second time: outstanding (reserved - released - consumed)
  // for this WO/part is now exactly zero.
  assert.equal(sumType(entries, "RESERVED") - sumType(entries, "RELEASED") - sumType(entries, "CONSUMED"), 0);
});

// ---- all-or-nothing rejection on insufficient stock ---------------------

test("reserveParts rejects all-or-nothing when ANY planned item is short, no partial writes", async () => {
  const woId = id("wo");
  // TST-1031 has warehouseQty 0 in the static catalog -- always insufficient.
  await seedWorkOrder(woId, [
    { sku: "TST-1004", qtyPlanned: 2 }, // sufficient on its own (warehouseQty 4)
    { sku: "TST-1031", qtyPlanned: 1 }, // insufficient (warehouseQty 0)
  ]);
  await assert.rejects(reserveParts(woId), /Insufficient stock/);

  // Neither item was reserved -- the transaction is genuinely atomic, not
  // just "the failing item was skipped."
  assert.equal((await ledgerFor(woId, "TST-1004")).length, 0, "sufficient item must not be partially reserved");
  assert.equal((await ledgerFor(woId, "TST-1031")).length, 0);
});

test("concurrent reservations for the final unit serialize and cannot oversell", async () => {
  const sku = "TST-1020"; // warehouseQty 2
  const first = id("wo-race");
  const second = id("wo-race");
  await seedWorkOrder(first, [{ sku, qtyPlanned: 2 }]);
  await seedWorkOrder(second, [{ sku, qtyPlanned: 2 }]);

  const results = await Promise.allSettled([reserveParts(first), reserveParts(second)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
  assert.equal(sumType(await ledgerFor(first, sku), "RESERVED") + sumType(await ledgerFor(second, sku), "RESERVED"), 2);
});

// ---- B-1: duplicate-sku rows in one WO's inventorySnapshot --------------
// A supported scenario (two duplicate-ref PART SO lines can land as two rows
// sharing a sku) must have its qtyPlanned SUMMED per sku before the
// availability check, not evaluated per-row against the same
// un-decremented available figure -- otherwise each row passes
// independently and the WO reserves qtyPlanned+qtyPlanned against a pool
// that only ever had enough for one, driving on-hand negative.

test("reserveParts aggregates qtyPlanned across duplicate-sku rows -- reserves the total once, not per-row", async () => {
  const sku = "TST-1058"; // warehouseQty 12
  const woId = id("wo");
  await seedWorkOrder(woId, [
    { sku, qtyPlanned: 5 },
    { sku, qtyPlanned: 5 },
  ]);
  await reserveParts(woId);

  const entries = await ledgerFor(woId, sku);
  assert.equal(sumType(entries, "RESERVED"), 10, "total reserved must be the sum (10), not double-reserved (20)");
  assert.equal(entries.filter((e) => e.type === "RESERVED").length, 1, "one aggregated ledger entry per sku, not one per row");
});

test("reserveParts fails closed (all-or-nothing) when duplicate-sku rows' SUMMED demand exceeds the pool, even though each row alone would fit", async () => {
  const sku = "TST-1059"; // warehouseQty 10
  const woId = id("wo");
  await seedWorkOrder(woId, [
    { sku, qtyPlanned: 6 }, // fits alone (6 <= 10)
    { sku, qtyPlanned: 6 }, // fits alone (6 <= 10), but summed demand is 12 > 10
  ]);
  await assert.rejects(reserveParts(woId), /Insufficient stock/);

  const entries = await ledgerFor(woId, sku);
  assert.equal(entries.length, 0, "no partial/duplicate reservation may land -- on-hand must never go negative");
});

test("reserveParts with duplicate-sku rows alongside a distinct sku still evaluates and reserves each independently", async () => {
  const dupSku = "TST-1060"; // warehouseQty 12
  const otherSku = "TST-1061"; // warehouseQty 4
  const woId = id("wo");
  await seedWorkOrder(woId, [
    { sku: dupSku, qtyPlanned: 3 },
    { sku: dupSku, qtyPlanned: 3 },
    { sku: otherSku, qtyPlanned: 2 },
  ]);
  await reserveParts(woId);

  assert.equal(sumType(await ledgerFor(woId, dupSku), "RESERVED"), 6);
  assert.equal(sumType(await ledgerFor(woId, otherSku), "RESERVED"), 2);
});

// ---- release returns the correct quantity -------------------------------

test("releaseParts releases exactly the outstanding reserved quantity for this Work Order", async () => {
  const woId = id("wo");
  await seedWorkOrder(woId, [{ sku: "TST-1005", qtyPlanned: 1 }]);
  await reserveParts(woId);
  await releaseParts(woId);

  const entries = await ledgerFor(woId, "TST-1005");
  assert.equal(sumType(entries, "RESERVED"), 1);
  assert.equal(sumType(entries, "RELEASED"), 1);
  assert.equal(sumType(entries, "RESERVED") - sumType(entries, "RELEASED"), 0, "nothing left outstanding");
});

test("releaseParts is safe to call when nothing was ever reserved (e.g. cancelled pre-DISPATCHED)", async () => {
  const woId = id("wo");
  await seedWorkOrder(woId, [{ sku: "TST-1006", qtyPlanned: 4 }]);
  await releaseParts(woId); // must not throw
  const entries = await ledgerFor(woId, "TST-1006");
  assert.equal(entries.length, 0, "no RELEASED entry when outstanding is already 0");
});

// ---- consumeParts: completion repair / oversell guard --------------------

test("consumeParts repairs a missing reservation and consumes atomically when stock is available", async () => {
  const woId = id("wo");
  await seedWorkOrder(woId, [{ sku: "TST-1007", qtyPlanned: 1 }]);
  await consumeParts(woId);
  const entries = await ledgerFor(woId, "TST-1007");
  assert.equal(sumType(entries, "RESERVED"), 1);
  assert.equal(sumType(entries, "CONSUMED"), 1);
});

test("consumeParts all-or-nothing: one under-reserved item blocks consumption of ALL items", async () => {
  const woId = id("wo");
  await seedWorkOrder(woId, [
    { sku: "TST-1008", qtyPlanned: 2 }, // will be fully (properly) reserved
    { sku: "TST-1010", qtyPlanned: 5 }, // deliberately under-reserved below
  ]);
  // Reserve TST-1008 normally.
  await seedRawLedgerEntry(woId, "TST-1008", "RESERVED", 2);
  // Hand-seed an inconsistent, under-covering reservation for TST-1010 (1
  // instead of the 5 planned) -- simulates a plan edited upward after
  // reservation, which is exactly the "stuck consume" scenario the
  // shortfall guard exists to catch.
  await seedRawLedgerEntry(woId, "TST-1010", "RESERVED", 1);

  await assert.rejects(consumeParts(woId), /reservation shortfall/);

  // Neither item was consumed -- including the one that DID have enough
  // reserved, proving the rejection is atomic across the whole Work Order,
  // not just the short item.
  const e8 = await ledgerFor(woId, "TST-1008");
  const e10 = await ledgerFor(woId, "TST-1010");
  assert.equal(sumType(e8, "CONSUMED"), 0, "adequately-reserved item must not be consumed either");
  assert.equal(sumType(e10, "CONSUMED"), 0);
});

// ---- triggerInventoryEffects: idempotency --------------------------------

test("triggerInventoryEffects is idempotent: re-applying the SAME state does not double-reserve", async () => {
  const woId = id("wo");
  await seedWorkOrder(woId, [{ sku: "TST-1003", qtyPlanned: 5 }]);

  await triggerInventoryEffects(woId, "DISPATCHED");
  await triggerInventoryEffects(woId, "DISPATCHED"); // replay of the same transition

  const entries = await ledgerFor(woId, "TST-1003");
  assert.equal(entries.length, 1, "only one RESERVED entry despite two DISPATCHED calls");
  assert.equal(entries[0].quantity, 5);

  const sync = (await db.collection(SYNC).doc(woId).get()).data();
  assert.equal(sync.processedStates.DISPATCHED, true);
});

test("triggerInventoryEffects claims atomically: two CONCURRENT calls for the same (workOrderId, state) do not both run the trigger", async () => {
  // Regression test for the check-then-act gap: two callers racing for
  // the same (workOrderId, state) -- e.g. the retryInventoryEffects
  // operator tool racing a live transition-driven call -- must not both
  // observe "unprocessed" and both execute reserveParts(), which would
  // double-write the ledger (two RESERVED entries instead of one).
  // Fired via Promise.all (not sequential awaits) so both calls' very
  // first read races genuinely concurrently, the same way the pre-fix
  // isStateProcessed() check-then-act bug would actually be triggered.
  const woId = id("wo");
  const sku = "TST-1040"; // ample warehouseQty, must not be the limiting factor here
  await seedWorkOrder(woId, [{ sku, qtyPlanned: 1 }]);

  await Promise.all([
    triggerInventoryEffects(woId, "DISPATCHED"),
    triggerInventoryEffects(woId, "DISPATCHED"),
  ]);

  const entries = await ledgerFor(woId, sku);
  const reserved = entries.filter((e) => e.type === "RESERVED");
  assert.equal(reserved.length, 1, "only one RESERVED entry must exist despite two concurrent DISPATCHED calls");
  assert.equal(reserved[0].quantity, 1);

  const sync = (await db.collection(SYNC).doc(woId).get()).data();
  assert.equal(sync.processedStates.DISPATCHED, true);
  assert.equal(sync.claims?.DISPATCHED, undefined, "claim is cleared once processing completes");
});

test("triggerInventoryEffects for an unmapped state (e.g. ARRIVED) is a pure no-op", async () => {
  const woId = id("wo");
  await seedWorkOrder(woId, [{ sku: "TST-1011", qtyPlanned: 1 }]);
  await triggerInventoryEffects(woId, "ARRIVED");

  const entries = await ledgerFor(woId, "TST-1011");
  assert.equal(entries.length, 0);
  const syncSnap = await db.collection(SYNC).doc(woId).get();
  assert.equal(syncSnap.exists, false, "no inventory_sync_status doc for a state with no ledger meaning");
});

// ---- triggerInventoryEffects: never throws, records failure, allows retry ----

test("triggerInventoryEffects swallows an insufficient-stock failure and records it for retry; does not mark processed", async () => {
  const woId = id("wo");
  await seedWorkOrder(woId, [{ sku: "TST-1031", qtyPlanned: 1 }]); // warehouseQty 0

  await triggerInventoryEffects(woId, "DISPATCHED"); // must not throw

  const entries = await ledgerFor(woId, "TST-1031");
  assert.equal(entries.length, 0, "failed reservation leaves no ledger entry");

  const sync = (await db.collection(SYNC).doc(woId).get()).data();
  assert.equal(sync.processedStates?.DISPATCHED, undefined, "not marked processed on failure");
  assert.equal(sync.failures.DISPATCHED.retryNeeded, true);
  assert.match(sync.failures.DISPATCHED.error, /Insufficient stock/);
});

test("a failed DISPATCHED trigger can be retried later and succeeds once stock frees up", async () => {
  const sku = "TST-1035"; // warehouseQty 2
  const woBlocker = id("wo-blocker");
  const woWaiting = id("wo-waiting");
  await seedWorkOrder(woBlocker, [{ sku, qtyPlanned: 2 }]);
  await seedWorkOrder(woWaiting, [{ sku, qtyPlanned: 1 }]);

  // Blocker takes all available stock.
  await triggerInventoryEffects(woBlocker, "DISPATCHED");
  assert.equal(sumType(await ledgerFor(woBlocker, sku), "RESERVED"), 2);

  // Waiting WO's DISPATCHED trigger fails closed (0 available) but does not throw.
  await triggerInventoryEffects(woWaiting, "DISPATCHED");
  assert.equal((await ledgerFor(woWaiting, sku)).length, 0);
  let sync = (await db.collection(SYNC).doc(woWaiting).get()).data();
  assert.equal(sync.failures.DISPATCHED.retryNeeded, true);

  // Blocker releases its reservation (e.g. CANCELLED).
  await triggerInventoryEffects(woBlocker, "CANCELLED");
  assert.equal(sumType(await ledgerFor(woBlocker, sku), "RELEASED"), 2);

  // Retrying is simply calling triggerInventoryEffects again for the same
  // (workOrderId, state) -- per the module's own documented retry model.
  await triggerInventoryEffects(woWaiting, "DISPATCHED");
  const entries = await ledgerFor(woWaiting, sku);
  assert.equal(sumType(entries, "RESERVED"), 1, "retry now succeeds once stock is available");

  sync = (await db.collection(SYNC).doc(woWaiting).get()).data();
  assert.equal(sync.processedStates.DISPATCHED, true);
  assert.equal(sync.failures?.DISPATCHED, undefined, "prior failure cleared once the retry succeeds");
});

// ---- COMPLETED trigger: consume + finalize -------------------------------

test("COMPLETED trigger consumes reserved stock and finalizes the Work Order's inventory processing", async () => {
  const woId = id("wo");
  await seedWorkOrder(woId, [{ sku: "TST-1014", qtyPlanned: 2 }]);

  await triggerInventoryEffects(woId, "DISPATCHED");
  await triggerInventoryEffects(woId, "COMPLETED");

  const entries = await ledgerFor(woId, "TST-1014");
  assert.equal(sumType(entries, "CONSUMED"), 2);

  const sync = (await db.collection(SYNC).doc(woId).get()).data();
  assert.equal(sync.processedStates.DISPATCHED, true);
  assert.equal(sync.processedStates.COMPLETED, true);
  assert.equal(sync.finalized, true);
});

test("replaying COMPLETED after it already succeeded does not double-consume or re-finalize the ledger", async () => {
  const woId = id("wo");
  await seedWorkOrder(woId, [{ sku: "TST-1015", qtyPlanned: 1 }]);
  await triggerInventoryEffects(woId, "DISPATCHED");
  await triggerInventoryEffects(woId, "COMPLETED");
  await triggerInventoryEffects(woId, "COMPLETED"); // replay

  const entries = await ledgerFor(woId, "TST-1015");
  assert.equal(sumType(entries, "CONSUMED"), 1, "still exactly one CONSUMED unit, not two");
});

// ---- consumeParts: honors governed ACTUAL usage (qtyUsed), P0.1 ----------

test("consumeParts with qtyUsed < qtyPlanned consumes only the actual and releases the remainder", async () => {
  const woId = id("wo");
  // TST-1017 must have ample warehouseQty in the static catalog.
  await seedWorkOrder(woId, [{ sku: "TST-1017", qtyPlanned: 4, qtyUsed: 1 }]);
  await reserveParts(woId);
  await consumeParts(woId);

  const entries = await ledgerFor(woId, "TST-1017");
  assert.equal(sumType(entries, "RESERVED"), 4, "reservation stays at qtyPlanned");
  assert.equal(sumType(entries, "CONSUMED"), 1, "ledger consumes the actual qtyUsed, not qtyPlanned");
  assert.equal(sumType(entries, "RELEASED"), 3, "unused remainder (qtyPlanned - qtyUsed) is released, not stranded");
  // Nothing left outstanding for this WO/part once actual + remainder are accounted for.
  assert.equal(
    sumType(entries, "RESERVED") - sumType(entries, "RELEASED") - sumType(entries, "CONSUMED"),
    0
  );
});

test("consumeParts with qtyUsed === qtyPlanned consumes all, releases nothing", async () => {
  const woId = id("wo");
  await seedWorkOrder(woId, [{ sku: "TST-1018", qtyPlanned: 2, qtyUsed: 2 }]);
  await reserveParts(woId);
  await consumeParts(woId);

  const entries = await ledgerFor(woId, "TST-1018");
  assert.equal(sumType(entries, "CONSUMED"), 2);
  assert.equal(sumType(entries, "RELEASED"), 0, "no remainder to release when fully used");
});

test("consumeParts with no qtyUsed recorded falls back to qtyPlanned (no regression)", async () => {
  const woId = id("wo");
  await seedWorkOrder(woId, [{ sku: "TST-1019", qtyPlanned: 3 }]); // qtyUsed never populated
  await reserveParts(woId);
  await consumeParts(woId);

  const entries = await ledgerFor(woId, "TST-1019");
  assert.equal(sumType(entries, "CONSUMED"), 3, "falls back to qtyPlanned when no actual was recorded");
  assert.equal(sumType(entries, "RELEASED"), 0, "no remainder released in the fallback case");
});

// ---- CANCELLED trigger releases outstanding reservation ------------------

test("CANCELLED trigger releases whatever was reserved", async () => {
  const woId = id("wo");
  await seedWorkOrder(woId, [{ sku: "TST-1016", qtyPlanned: 3 }]);
  await triggerInventoryEffects(woId, "DISPATCHED");
  await triggerInventoryEffects(woId, "CANCELLED");

  const entries = await ledgerFor(woId, "TST-1016");
  assert.equal(sumType(entries, "RESERVED"), 3);
  assert.equal(sumType(entries, "RELEASED"), 3);
});

// ---- finalizeInventoryTransaction is a pure sync-status marker -----------

test("finalizeInventoryTransaction writes no ledger entry, only marks the sync-status doc", async () => {
  const woId = id("wo");
  await finalizeInventoryTransaction(woId);
  const snap = await db.collection(LEDGER).where("workOrderId", "==", woId).get();
  assert.equal(snap.size, 0);
  const sync = (await db.collection(SYNC).doc(woId).get()).data();
  assert.equal(sync.finalized, true);
});
