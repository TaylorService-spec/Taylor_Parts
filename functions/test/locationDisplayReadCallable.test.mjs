// PART 11A -- trusted read callable (getLocationDisplay) emulator tests. Requires the Firestore
// emulator. Prerequisite: npm run build; emulator running.
//
// Covers the callable authorization boundary end-to-end (mirrors serializedAssetReadCallable.test.mjs's
// pattern) AND the resolution logic against real warehouses/mobile_locations data via the exported
// `resolveLocationDisplays` (bypassing the auth gate, since `inventory.location.display.read` is
// deliberately granted to NO Role and has NO per-environment activation override -- exactly like
// inventory.serializedAsset.read at its own introduction -- so the READY/authorized path cannot be
// driven through the callable itself without a real grant).
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
import assert from "node:assert/strict";
import admin from "firebase-admin";

admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();
const svc = await import("../lib/inventoryLocation/locationDisplayReadService.js");
const { __resetRuntimeCapabilityOverridesCacheForTest } = await import("../lib/access/environmentCapabilityOverrides.js");

let passed = 0;
async function check(name, fn) {
  await fn();
  passed += 1;
  console.log(`PASS: ${name}`);
}
const request = (uid, data = {}) => ({ data, auth: uid ? { uid, token: {} } : undefined });
async function expectHttps(promise, code) {
  await assert.rejects(promise, (error) => error?.code === code);
}
async function withProject(projectId, fn) {
  const prevG = process.env.GCLOUD_PROJECT;
  const prevGG = process.env.GOOGLE_CLOUD_PROJECT;
  try {
    __resetRuntimeCapabilityOverridesCacheForTest();
    delete process.env.GOOGLE_CLOUD_PROJECT;
    if (projectId === null) delete process.env.GCLOUD_PROJECT;
    else process.env.GCLOUD_PROJECT = projectId;
    await fn();
  } finally {
    if (prevG === undefined) delete process.env.GCLOUD_PROJECT;
    else process.env.GCLOUD_PROJECT = prevG;
    if (prevGG === undefined) delete process.env.GOOGLE_CLOUD_PROJECT;
    else process.env.GOOGLE_CLOUD_PROJECT = prevGG;
    __resetRuntimeCapabilityOverridesCacheForTest();
  }
}

const runId = Date.now();
async function seedPrincipal(roleId) {
  const uid = `ld-read-${roleId}-${runId}`;
  await db.collection("users").doc(uid).set({ accessVersion: 1 });
  await db.collection("roleAssignments").doc(`ld-read-${roleId}-role-${runId}`).set({
    principalUid: uid, roleId, scope: { type: "global" }, grantedBy: "test",
    grantedAt: admin.firestore.Timestamp.now(), status: "active", accessVersionAtGrant: 1,
  });
  return uid;
}
const adminUid = await seedPrincipal("admin");
const dispatcherUid = await seedPrincipal("dispatcher");
const technicianUid = await seedPrincipal("technician");

// ============================= callable authorization boundary (DENIED everywhere) =============================

await check("callable rejects unauthenticated callers", async () => {
  await expectHttps(svc.getLocationDisplay.run(request(undefined, { locationIds: ["WH-1"] })), "unauthenticated");
});
await check("admin is denied -- inventory.location.display.read is granted to no Role", async () => {
  await expectHttps(svc.getLocationDisplay.run(request(adminUid, { locationIds: ["WH-1"] })), "permission-denied");
});
await check("admin is still denied inside the sandbox project (no activation override exists for this capability)", async () => {
  await withProject("eos-platform-sandbox", async () => {
    await expectHttps(svc.getLocationDisplay.run(request(adminUid, { locationIds: ["WH-1"] })), "permission-denied");
  });
});
await check("dispatcher is denied, in any project", async () => {
  await expectHttps(svc.getLocationDisplay.run(request(dispatcherUid, { locationIds: ["WH-1"] })), "permission-denied");
  await withProject("eos-platform-sandbox", async () => {
    await expectHttps(svc.getLocationDisplay.run(request(dispatcherUid, { locationIds: ["WH-1"] })), "permission-denied");
  });
});
await check("technician is denied, in any project", async () => {
  await expectHttps(svc.getLocationDisplay.run(request(technicianUid, { locationIds: ["WH-1"] })), "permission-denied");
});
await check("production projectId keeps the read DENY as well", async () => {
  await withProject("taylor-parts-production", async () => {
    await expectHttps(svc.getLocationDisplay.run(request(adminUid, { locationIds: ["WH-1"] })), "permission-denied");
  });
});
// Malformed input is rejected as invalid-argument -- but auth is checked FIRST, so an unauthorized
// caller with a malformed request still sees permission-denied, not invalid-argument (no information
// leak about request shape validity to an unauthorized caller).
await check("permission-denied is returned even for a malformed request from an unauthorized caller (auth checked first)", async () => {
  await expectHttps(svc.getLocationDisplay.run(request(adminUid, { locationIds: [] })), "permission-denied");
});

// ============================= resolveLocationDisplays (bypasses the auth gate directly) =============================

async function seedWarehouse(id, name) { await db.collection("warehouses").doc(id).set({ name }); }
async function seedMobileLocation(id, displayLabel) { await db.collection("mobile_locations").doc(id).set({ locationId: id, type: "MOBILE", displayLabel, active: true }); }

await check("authorized/ready: a WAREHOUSE id resolves { type: WAREHOUSE, label: <name> }", async () => {
  const id = `WH-${runId}-1`;
  await seedWarehouse(id, "Main Warehouse");
  const [entry] = await svc.resolveLocationDisplays(db, [id]);
  assert.deepEqual(entry, { locationId: id, type: "WAREHOUSE", label: "Main Warehouse" });
});
await check("authorized/ready: a MOBILE(truck) id resolves { type: MOBILE, label: <displayLabel> }", async () => {
  const id = `MLOC-${runId}-1`;
  await seedMobileLocation(id, "Truck 204");
  const [entry] = await svc.resolveLocationDisplays(db, [id]);
  assert.deepEqual(entry, { locationId: id, type: "MOBILE", label: "Truck 204" });
});
await check("unavailable/unresolved: an id matching neither WAREHOUSE nor MOBILE (e.g. a customer location) resolves UNRESOLVED, label null -- never a fabricated type", async () => {
  const id = `CUST-${runId}-1`;
  const [entry] = await svc.resolveLocationDisplays(db, [id]);
  assert.deepEqual(entry, { locationId: id, type: "UNRESOLVED", label: null });
});
await check("fail closed on malformed data: a warehouse doc missing `name` resolves UNRESOLVED, not a fabricated WAREHOUSE entry", async () => {
  const id = `WH-${runId}-malformed`;
  await db.collection("warehouses").doc(id).set({ active: true }); // no `name`
  const [entry] = await svc.resolveLocationDisplays(db, [id]);
  assert.deepEqual(entry, { locationId: id, type: "UNRESOLVED", label: null });
});
await check("fail closed on malformed data: a mobile_locations doc with a blank displayLabel resolves UNRESOLVED", async () => {
  const id = `MLOC-${runId}-malformed`;
  await db.collection("mobile_locations").doc(id).set({ locationId: id, type: "MOBILE", displayLabel: "   ", active: true });
  const [entry] = await svc.resolveLocationDisplays(db, [id]);
  assert.deepEqual(entry, { locationId: id, type: "UNRESOLVED", label: null });
});
await check("empty (connected, resolved, nothing to show): every requested id is genuinely UNRESOLVED -- distinct from a read failure", async () => {
  const ids = [`CUST-${runId}-2`, `CUST-${runId}-3`];
  const entries = await svc.resolveLocationDisplays(db, ids);
  assert.equal(entries.every((e) => e.type === "UNRESOLVED" && e.label === null), true);
});
await check("no raw Firebase uid, auth token, or internal id leaks into a resolved entry -- exact 3-key shape only", async () => {
  const id = `WH-${runId}-2`;
  await seedWarehouse(id, "Second Warehouse");
  const [entry] = await svc.resolveLocationDisplays(db, [id]);
  assert.deepEqual(Object.keys(entry).sort(), ["label", "locationId", "type"]);
});
await check("bounded batch: multiple ids resolve independently, order preserved, mixed WAREHOUSE/MOBILE/UNRESOLVED", async () => {
  const whId = `WH-${runId}-3`, mlId = `MLOC-${runId}-2`, custId = `CUST-${runId}-4`;
  await seedWarehouse(whId, "Third Warehouse");
  await seedMobileLocation(mlId, "Truck 9");
  const entries = await svc.resolveLocationDisplays(db, [whId, mlId, custId]);
  assert.deepEqual(entries.map((e) => e.type), ["WAREHOUSE", "MOBILE", "UNRESOLVED"]);
});

console.log(`\n${passed} Location Display read callable checks passed`);
