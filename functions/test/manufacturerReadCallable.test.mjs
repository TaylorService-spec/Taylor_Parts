// Manufacturer -- trusted read callable (getManufacturerCatalog) emulator tests. Requires the
// Firestore emulator. Prerequisite: npm run build; emulator running.
//
// Covers the callable authorization boundary end-to-end, mirroring salesOrderReadCallable.test.mjs's
// pattern (auth/grant/deny + withProject for the per-environment activation override).
//
// Requirement "client Rules remain closed": structurally guaranteed, not separately tested here --
// firestore.rules' `manufacturers` block (`allow read, write: if false`) is UNCHANGED by this feature
// (confirmed by the accompanying PR's zero-diff on firestore.rules). This callable uses the Admin SDK,
// which bypasses Rules by design, exactly like every other trusted read service in this codebase.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";

import assert from "node:assert/strict";
import admin from "firebase-admin";

admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();
const reads = await import("../lib/partMaster/manufacturerReadService.js");
const { __resetRuntimeCapabilityOverridesCacheForTest } = await import("../lib/access/environmentCapabilityOverrides.js");

let passed = 0;
async function check(name, fn) {
  await fn();
  passed += 1;
  console.log(`PASS: ${name}`);
}
const request = (uid) => ({ data: {}, auth: uid ? { uid, token: {} } : undefined });
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
  const uid = `mfg-read-${roleId}-${runId}`;
  await db.collection("users").doc(uid).set({ accessVersion: 1 });
  await db.collection("roleAssignments").doc(`mfg-read-${roleId}-role-${runId}`).set({
    principalUid: uid,
    roleId,
    scope: { type: "global" },
    grantedBy: "test",
    grantedAt: admin.firestore.Timestamp.now(),
    status: "active",
    accessVersionAtGrant: 1,
  });
  return uid;
}

const adminUid = await seedPrincipal("admin");
const dispatcherUid = await seedPrincipal("dispatcher");
const technicianUid = await seedPrincipal("technician");

// ----- 1. unauthenticated caller is rejected outright -----
await check("callable rejects unauthenticated callers", async () => {
  await expectHttps(reads.getManufacturerCatalog.run(request()), "unauthenticated");
});

// ----- inactive environment fails closed: even a granted admin is denied in the unactivated project -----
await check("admin is fail-closed in the unactivated project (taylor-parts) even though the role holds inventory.catalog.read", async () => {
  await expectHttps(reads.getManufacturerCatalog.run(request(adminUid)), "permission-denied");
});

// ----- 6. technician does not receive broad access accidentally, in ANY project -----
await check("technician never inherits inventory.catalog.read, in the unactivated project", async () => {
  await expectHttps(reads.getManufacturerCatalog.run(request(technicianUid)), "permission-denied");
});
await check("technician never inherits inventory.catalog.read, even in the activated sandbox project (operational-role condition is coarse-feed-inert -- matches inventory.transaction.read/inventory.action.read's own current state)", async () => {
  await withProject("eos-platform-sandbox", async () => {
    await expectHttps(reads.getManufacturerCatalog.run(request(technicianUid)), "permission-denied");
  });
});

const mfgId = `mfg-read-${runId}`;
await db.collection("manufacturers").doc(mfgId).set({ name: "Acme Valve Co", status: "ACTIVE" });
// A malformed sibling document -- proves the projection excludes it honestly (excludedCount), never fabricates it.
await db.collection("manufacturers").doc(`${mfgId}-malformed`).set({ status: "ACTIVE" }); // missing name

// ----- 3. authorized Admin succeeds in sandbox -----
await check("admin reads the real Manufacturer catalog once sandbox activation is on", async () => {
  await withProject("eos-platform-sandbox", async () => {
    const result = await reads.getManufacturerCatalog.run(request(adminUid));
    assert.equal(result.status, "ready");
    const found = result.manufacturers.find((m) => m.manufacturerId === mfgId);
    assert.ok(found, "seeded manufacturer should be present");
    assert.equal(found.name, "Acme Valve Co");
    assert.equal(found.status, "ACTIVE");
    assert.equal(Object.keys(found).sort().join(","), "manufacturerId,name,status");
  });
});

// ----- 4. authorized Dispatcher succeeds in sandbox -----
await check("dispatcher reads the real Manufacturer catalog once sandbox activation is on", async () => {
  await withProject("eos-platform-sandbox", async () => {
    const result = await reads.getManufacturerCatalog.run(request(dispatcherUid));
    assert.equal(result.status, "ready");
    assert.ok(result.manufacturers.find((m) => m.manufacturerId === mfgId));
  });
});

// ----- 9/10. malformed document is honestly excluded, never fabricated into the list -----
await check("a malformed Manufacturer document (missing name) is excluded, never fabricated, and counted", async () => {
  await withProject("eos-platform-sandbox", async () => {
    const result = await reads.getManufacturerCatalog.run(request(adminUid));
    assert.equal(result.manufacturers.some((m) => m.manufacturerId === `${mfgId}-malformed`), false);
    assert.ok(result.excludedCount >= 1);
  });
});

// ----- 7. production projectId keeps inventory.catalog.read DENY even with a granting role -----
await check("production projectId keeps the read DENY even for a granted admin (activation never applies in production)", async () => {
  await withProject("taylor-parts-production", async () => {
    await expectHttps(reads.getManufacturerCatalog.run(request(adminUid)), "permission-denied");
  });
});

console.log(`\n${passed} Manufacturer read callable checks passed`);
