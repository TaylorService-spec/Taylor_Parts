// Serialized Asset -- trusted read callable (getAvailableEquipment) emulator tests. Requires the
// Firestore emulator. Prerequisite: npm run build; emulator running.
//
// Covers the callable authorization boundary end-to-end, mirroring manufacturerReadCallable.test.mjs's
// pattern (auth/deny + withProject for the per-environment activation override).
//
// SUPERSEDED POSTURE, 2026-08-19. This suite was written to prove an UNGRANTED capability:
// granted to no Role, no activation override, denied for everyone everywhere. Two things
// changed, and the assertions below now prove the opposite in one of the two cases.
//
//   1. The Owner ruled "Admin and Owner have full access to all possible features and
//      permissions", so admin holds the ENTIRE catalog, this id included.
//   2. This id IS in eos-platform-sandbox's capabilityActivationOverrides.
//
// Grant AND activation together are what produce an ALLOW, so:
//   - OUTSIDE the sandbox project there is no override, the id stays active:false, and
//     admin is still denied. That half is unchanged and still asserted.
//   - INSIDE the sandbox project both conditions are met and admin is ALLOWED. That half
//     is inverted below.
//
// This is not a loosening slipped in with a fix: it is the fix. A live sweep signed in as
// admin and got HTTP 403 from this callable on a page the rail had offered them.
// dispatcher and technician hold no such grant and are still denied everywhere, which is
// what keeps this suite an authorization boundary rather than an open door.

//
// Requirement "client Rules remain closed": structurally guaranteed, not separately tested here --
// firestore.rules has NO match block for `serialized_assets` (default deny), UNCHANGED by this PR. This
// callable uses the Admin SDK, which bypasses Rules by design, exactly like every other trusted read
// service in this codebase.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";

import assert from "node:assert/strict";
import admin from "firebase-admin";

admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();
const reads = await import("../lib/serializedAsset/serializedAssetReadService.js");
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
async function expectAllowed(promise) {
  // Deliberately asserts RESOLUTION, not merely "did not reject with permission-denied".
  // A call that blew up for an unrelated reason would satisfy the weaker check while
  // proving nothing about authorization.
  await promise;
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
  const uid = `sa-read-${roleId}-${runId}`;
  await db.collection("users").doc(uid).set({ accessVersion: 1 });
  await db.collection("roleAssignments").doc(`sa-read-${roleId}-role-${runId}`).set({
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

await db.collection("serialized_assets").doc(`sa-read-${runId}`).set({
  serialNo: `SN-READ-${runId}`,
  partId: "PART-1",
  currentLocationId: "WH-MAIN",
  inventoryState: "AVAILABLE",
  currentEquipmentId: null,
  ownership: "COMPANY",
});

// ----- 1. unauthenticated caller is rejected outright -----
await check("callable rejects unauthenticated callers", async () => {
  await expectHttps(reads.getAvailableEquipment.run(request()), "unauthenticated");
});

// ----- 2. admin is denied even though admin holds most other capabilities -- this one is granted to
// NO compatibility Role, and NO activation override exists (unlike salesOrder.read/inventory.catalog.read
// at their own introduction) -----
await check("admin is denied OUTSIDE the sandbox: it holds the grant, but the id is active:false with no override", async () => {
  await expectHttps(reads.getAvailableEquipment.run(request(adminUid)), "permission-denied");
});

// ----- 3. admin IS allowed inside the sandbox project: grant + activation both satisfied -----
// This is the assertion that would have caught the live 403. Its previous form asserted the
// denial as correct, so the sweep's finding and the test suite disagreed, and the suite was wrong.
await check("admin IS allowed inside the sandbox project -- grant plus activation override", async () => {
  await withProject("eos-platform-sandbox", async () => {
    await expectAllowed(reads.getAvailableEquipment.run(request(adminUid)));
  });
});

// ----- 4. dispatcher likewise denied, in any project -----
await check("dispatcher is denied, in any project", async () => {
  await expectHttps(reads.getAvailableEquipment.run(request(dispatcherUid)), "permission-denied");
  await withProject("eos-platform-sandbox", async () => {
    await expectHttps(reads.getAvailableEquipment.run(request(dispatcherUid)), "permission-denied");
  });
});

// ----- 5. technician denied, in any project -----
await check("technician is denied, in any project", async () => {
  await expectHttps(reads.getAvailableEquipment.run(request(technicianUid)), "permission-denied");
  await withProject("eos-platform-sandbox", async () => {
    await expectHttps(reads.getAvailableEquipment.run(request(technicianUid)), "permission-denied");
  });
});

// ----- production projectId keeps the read DENY too (defense-in-depth; there is no grant to begin with) -----
await check("production projectId keeps the read DENY as well", async () => {
  await withProject("taylor-parts-production", async () => {
    await expectHttps(reads.getAvailableEquipment.run(request(adminUid)), "permission-denied");
  });
});

console.log(`\n${passed} Serialized Asset read callable checks passed`);
