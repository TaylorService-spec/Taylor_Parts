// getInventoryAnalytics -- where availableStock comes from, and what it means.
//
// TWO DEFECTS, PINNED IN ORDER.
//
// Site-work r3 D: the callable summed raw bin stock with no reservation netting, so availableStock
// was overstated and generateInventoryHealthDashboard's stockout math understated risk. Netting is
// still asserted below.
//
// BIN-P2 (Decision #160 / ADR-014): the thing being netted was `stock_locations`, a collection
// NOTHING in this repository writes. Where it had been seeded it diverged from the ledger in BOTH
// directions -- a part holding three genuinely received units read as 0, and a part with nothing
// ever received read as 40. A source that can both refuse real stock and promise imaginary stock is
// not an authority. The baseline is now the governed one every other inventory surface uses:
// the location-aware operational ledger at ACTIVE warehouses for NONE-tracked parts, and the
// serialized-asset registry's AVAILABLE units for SERIAL-tracked ones.
//
// Same harness as functions/test/manufacturerCallables.test.mjs: invoke
// the v2 onCall directly via `.run(request)` against a LIVE Firestore
// emulator, importing the compiled ../lib.
// Prerequisite: npm run build; firestore emulator running on 127.0.0.1:8080.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
import assert from "node:assert/strict";
import admin from "firebase-admin";
import { readFileSync } from "node:fs";
admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();
const { getInventoryAnalytics } = await import("../lib/inventoryAnalyticsCallables.js");

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS: ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL: ${name}`); console.error(err); }
}
const now = Date.now();
let seq = 0;
const id = (p) => `${p}-${now}-${(seq += 1)}`;
const req = (data, authUid) => ({ data, auth: authUid !== undefined ? { uid: authUid, token: {} } : undefined });

// AUTHORITY NORMALIZATION (2026-08-17). getInventoryAnalytics used to authorize with a
// direct `caller.role === "admin"` comparison, so seeding a raw role field on the user
// document was enough. It now resolves inventory.analytics.read through the capability
// catalog like every sibling read service, so the test must grant the capability the way
// the platform actually grants it: an active roleAssignment to the compatibility `admin`
// Role, which carries inventory.analytics.read via
// SHARED_ADMIN_DISPATCHER_BASE_PERMISSIONS.
//
// The effective audience is unchanged -- admin and dispatcher, as before. What changed is
// that the test now exercises the real authorization path instead of a shortcut that no
// longer reflects how the callable decides.
async function seedAdmin() {
  const u = id("actor");
  await db.collection("users").doc(u).set({ role: "admin", accessVersion: 1 });
  await db.collection("roleAssignments").doc(id("assignment")).set({
    principalUid: u,
    roleId: "admin",
    scope: { type: "global" },
    grantedBy: "test",
    grantedAt: admin.firestore.Timestamp.now(),
    status: "active",
    accessVersionAtGrant: 1,
  });
  return u;
}

console.log("inventoryAnalyticsCallables.test.mjs");

const admUid = await seedAdmin();

const TS = () => admin.firestore.Timestamp.now();
async function seedActiveWarehouse() {
  const warehouseId = id("WH");
  await db.collection("warehouses").doc(warehouseId).set({
    id: warehouseId, name: warehouseId, location: "somewhere", status: "ACTIVE", version: 1, provenance: "NATIVE",
    createdAt: TS(), createdBy: "seed", updatedAt: TS(), updatedBy: "seed",
  });
  return warehouseId;
}
/** One operational movement, in the shape the location-aware ledger actually stores. */
async function movement(partId, warehouseId, type, quantity, over = {}) {
  await db.collection("inventory_transactions").doc(id("tx")).set({
    partId, type, quantity, timestamp: TS(),
    location: { type: "WAREHOUSE", locationId: warehouseId },
    trackingMode: "NONE", ...over,
  });
}

await check("BIN-P2: the physical baseline is the LEDGER, and it is reservation-netted", async () => {
  const partId = id("SKU");
  const warehouseId = await seedActiveWarehouse();

  // 100 units of genuine physical evidence, expressed the way Receiving/Transfer/Cycle Count
  // express it -- not a stock_locations row, which nothing writes and which diverged from this
  // ledger in both directions wherever it was seeded (Decision #160 / ADR-014).
  await movement(partId, warehouseId, "RECEIVED", 100);

  // 40 reserved against a Work Order, 10 released -- net outstanding 30. RESERVED/RELEASED are
  // LOGICAL commitment events, deliberately absent from the physical sum, so netting them here
  // subtracts them exactly once.
  await db.collection("inventory_transactions").doc(id("tx")).set({
    workOrderId: id("wo"), partId, type: "RESERVED", quantity: 40, timestamp: TS(),
  });
  await db.collection("inventory_transactions").doc(id("tx")).set({
    workOrderId: id("wo"), partId, type: "RELEASED", quantity: 10, timestamp: TS(),
  });

  const result = await getInventoryAnalytics.run(req({}, admUid));
  const entry = result.health.find((e) => e.partId === partId);
  assert.ok(entry, "expected an inventory health entry for the seeded part");
  assert.equal(entry.stock.availableStock, 70, "availableStock must be (100 ledger on-hand - 30 net reserved)");
  assert.equal(entry.recommendation.availableStock, 70, "recommendation must carry the same netted availableStock");
});

await check("BIN-P2: every movement type contributes exactly as the governed authorities define it", async () => {
  const partId = id("SKU");
  const warehouseId = await seedActiveWarehouse();
  const otherWarehouse = await seedActiveWarehouse();

  await movement(partId, warehouseId, "RECEIVED", 50);      // 50
  await movement(partId, warehouseId, "RETURNED", 10);      // 60
  await movement(partId, warehouseId, "TRANSFER_IN", 5);    // 65
  await movement(partId, warehouseId, "TRANSFER_OUT", 15);  // 50
  await movement(partId, warehouseId, "SCRAPPED", 4);       // 46
  await movement(partId, warehouseId, "ADJUSTED", -6);      // 40  (signed, not absolute)
  // A prior count's own snapshot is EVIDENCE, not a movement. Counting it would compound a shelf
  // reading into the quantity it was measuring.
  await movement(partId, warehouseId, "COUNTED", 999);
  // Another eligible building's stock IS company warehouse stock, which is what this dashboard means.
  await movement(partId, otherWarehouse, "RECEIVED", 7);    // 47
  // A MOBILE (truck) location is deliberately not warehouse stock.
  await movement(partId, warehouseId, "RECEIVED", 1000, { location: { type: "MOBILE", locationId: id("truck") } });
  // A row with no location attribution fails closed rather than inflating anything.
  await db.collection("inventory_transactions").doc(id("tx")).set({ partId, type: "RECEIVED", quantity: 500, timestamp: TS() });

  const result = await getInventoryAnalytics.run(req({}, admUid));
  const entry = result.health.find((e) => e.partId === partId);
  assert.ok(entry, "expected an inventory health entry");
  assert.equal(entry.stock.availableStock, 47, "50+10+5-15-4-6 at two eligible warehouses = 47");
});

await check("BIN-P2: stock at an INACTIVE warehouse is not sellable stock", async () => {
  const partId = id("SKU");
  const warehouseId = id("WH");
  await db.collection("warehouses").doc(warehouseId).set({
    id: warehouseId, name: warehouseId, location: "somewhere", status: "INACTIVE", version: 1, provenance: "NATIVE",
    createdAt: TS(), createdBy: "seed", updatedAt: TS(), updatedBy: "seed",
  });
  await movement(partId, warehouseId, "RECEIVED", 42);

  const result = await getInventoryAnalytics.run(req({}, admUid));
  const entry = result.health.find((e) => e.partId === partId);
  // Evidence exists, but none of it is at a sellable warehouse -- a known 0, never a fabricated 42.
  if (entry) assert.equal(entry.stock.availableStock, 0, "stock at an INACTIVE warehouse is not available");
});

await check("BIN-P2: a SERIAL part counts AVAILABLE units from the serialized-asset authority", async () => {
  const partId = id("SKU");
  const warehouseId = await seedActiveWarehouse();

  // The ledger stores serial movements one-per-unit and does NOT aggregate them into a quantity,
  // so the registry is what makes a serialized part's figure truthful rather than zero.
  await movement(partId, warehouseId, "RECEIVED", 1, { trackingMode: "SERIAL", serialNo: id("SN") });
  for (const state of ["AVAILABLE", "AVAILABLE", "RESERVED"]) {
    await db.collection("serialized_assets").doc(id("asset")).set({
      partId, serialNo: id("SN"), currentLocationId: warehouseId, inventoryState: state,
    });
  }
  // A unit elsewhere is not this warehouse-available stock.
  await db.collection("serialized_assets").doc(id("asset")).set({
    partId, serialNo: id("SN"), currentLocationId: id("elsewhere"), inventoryState: "AVAILABLE",
  });

  const result = await getInventoryAnalytics.run(req({}, admUid));
  const entry = result.health.find((e) => e.partId === partId);
  assert.ok(entry, "expected an inventory health entry for the serialized part");
  assert.equal(entry.stock.availableStock, 2, "two AVAILABLE units at an eligible warehouse, and only those");
});

await check("BIN-P2: the callable no longer reads stock_locations at all", async () => {
  const source = readFileSync(new URL("../src/inventoryAnalyticsCallables.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /STOCK_LOCATIONS_COLLECTION/, "no stock_locations constant");
  assert.doesNotMatch(source, /db\.collection\(["']stock_locations["']\)/, "no stock_locations read");
  assert.doesNotMatch(source, /import type \{ StockLocation \}/, "no StockLocation type import");

  // And prove it behaviourally: a part known ONLY to stock_locations must not appear.
  const partId = id("SKU");
  await db.collection("stock_locations").doc(id("loc")).set({
    id: id("loc"), warehouseId: await seedActiveWarehouse(), partId, quantity: 9999, binCode: "A1", updatedAt: TS(),
  });
  const result = await getInventoryAnalytics.run(req({}, admUid));
  assert.equal(
    result.health.some((e) => e.partId === partId),
    false,
    "a part known ONLY to stock_locations must not appear -- absence is how UNKNOWN is expressed",
  );
});

await check("unauthenticated -> unauthenticated", async () => {
  try {
    await getInventoryAnalytics.run(req({}, undefined));
    assert.fail("expected HttpsError");
  } catch (err) {
    assert.equal(err.code, "unauthenticated");
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
