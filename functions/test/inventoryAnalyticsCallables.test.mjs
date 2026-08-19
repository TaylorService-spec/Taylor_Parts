// Site-work r3 D -- getInventoryAnalytics availableStock must be
// reservation-netted, consistent with inventoryService.ts's
// getAvailableQuantity() (warehouseQty - (grossReserved - released))
// and the client mirror's computeAvailableStockByPart(). Before this
// fix, the callable summed STOCK_LOCATIONS_COLLECTION `quantity`
// (raw physical bin stock) with no reservation netting at all, so
// availableStock was overstated -- and generateInventoryHealthDashboard's
// stockout/urgency math (which trusts availableStock as the netted
// figure) understated risk -- whenever a part had outstanding RESERVED
// transactions.
//
// Same harness as functions/test/manufacturerCallables.test.mjs: invoke
// the v2 onCall directly via `.run(request)` against a LIVE Firestore
// emulator, importing the compiled ../lib.
// Prerequisite: npm run build; firestore emulator running on 127.0.0.1:8080.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
import assert from "node:assert/strict";
import admin from "firebase-admin";
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

await check("availableStock is reservation-netted (bin total minus outstanding RESERVED), not raw bin sum", async () => {
  const partId = id("SKU");
  const warehouseId = id("WH");

  // Physical bin stock: 100 units on hand.
  await db.collection("stock_locations").doc(id("loc")).set({
    id: id("loc"), warehouseId, partId, quantity: 100, binCode: "A1", updatedAt: admin.firestore.Timestamp.now(),
  });

  // 40 units reserved against a Work Order, 10 of those released back --
  // net outstanding reservation = 30. Reservation-netted availableStock
  // should be 100 - 30 = 70, NOT the raw bin total of 100.
  await db.collection("inventory_transactions").doc(id("tx")).set({
    workOrderId: id("wo"), partId, type: "RESERVED", quantity: 40, timestamp: admin.firestore.Timestamp.now(),
  });
  await db.collection("inventory_transactions").doc(id("tx")).set({
    workOrderId: id("wo"), partId, type: "RELEASED", quantity: 10, timestamp: admin.firestore.Timestamp.now(),
  });

  const result = await getInventoryAnalytics.run(req({}, admUid));
  const entry = result.health.find((e) => e.partId === partId);
  assert.ok(entry, "expected an inventory health entry for the seeded part");
  assert.equal(entry.stock.availableStock, 70, "availableStock must be netted (100 bin - 30 net reserved), not the raw bin sum of 100");
  assert.equal(entry.recommendation.availableStock, 70, "recommendation must carry the same netted availableStock");
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
