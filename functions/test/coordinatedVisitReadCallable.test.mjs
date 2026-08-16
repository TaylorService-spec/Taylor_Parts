// Coordinated Operations -- trusted read callable (listCoordinatedOperations) emulator tests. Requires the
// Firestore emulator. Prerequisite: npm run build; emulator running.
//
// Covers the callable authorization boundary end-to-end, mirroring serializedAssetReadCallable.test.mjs's
// pattern exactly. `fulfillment.coordinatedVisit.read` is deliberately granted to NO compatibility Role and
// has NO per-environment activation override in this phase -- so EVERY principal (including admin, and
// including inside the sandbox project) must be denied here. This suite proves that ungranted posture, plus
// the bounded read itself (active-status filter, non-coordinated Work Orders dropped, truncation is honest).
//
// Requirement "client Rules remain closed": structurally guaranteed, not separately tested here --
// firestore.rules is UNCHANGED by this PR (no new match block for fieldops_wos). This callable uses the
// Admin SDK, which bypasses Rules by design, exactly like every other trusted read service in this codebase.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";

import assert from "node:assert/strict";
import admin from "firebase-admin";

admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();
const reads = await import("../lib/fulfillment/coordinatedVisitReadService.js");
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
  const uid = `covisit-read-${roleId}-${runId}`;
  await db.collection("users").doc(uid).set({ accessVersion: 1 });
  await db.collection("roleAssignments").doc(`covisit-read-${roleId}-role-${runId}`).set({
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

// ----- 0. the CORE bounded read against real seeded Work Orders (calling readActiveCoordinatedWorkOrders
// directly -- the callable's authorization wall means the callable itself can never reach real data in this
// phase, so the read behavior is proven here, separately from the auth-deny wall proven below) -----
await check("readActiveCoordinatedWorkOrders returns only coordinated (salesOrderId-bearing) active Work Orders", async () => {
  const soId = `SO-covisit-${runId}`;
  await db.collection("fieldops_wos").doc(`covisit-wo-a-${runId}`).set({
    woNumber: "WO-A", status: "WORK_IN_PROGRESS", customerId: "ACCT-1", locationId: "LOC-1", salesOrderId: soId,
    salesOrderLineRefs: [{ ref: "PRT-1", kind: "PART", orderedQty: 2, allocatedQty: 1 }],
  });
  await db.collection("fieldops_wos").doc(`covisit-wo-b-${runId}`).set({
    woNumber: "WO-B", status: "COMPLETED", customerId: "ACCT-1", locationId: "LOC-1", salesOrderId: soId,
  });
  // CLOSED is excluded from the active-coordination status filter -- archived, not a live obligation.
  await db.collection("fieldops_wos").doc(`covisit-wo-closed-${runId}`).set({
    woNumber: "WO-CLOSED", status: "CLOSED", customerId: "ACCT-1", locationId: "LOC-1", salesOrderId: soId,
  });
  // Standalone Work Order (no salesOrderId) -- fetched within the bounded page (single-field status filter
  // only) but dropped by the pure projection; counted in `skipped`, never fabricated into the result.
  await db.collection("fieldops_wos").doc(`covisit-wo-standalone-${runId}`).set({
    woNumber: "WO-STANDALONE", status: "WORK_IN_PROGRESS", customerId: "ACCT-9", locationId: "LOC-9",
  });

  const result = await reads.readActiveCoordinatedWorkOrders(db, 500);
  assert.equal(result.status, "ready");
  const mine = result.workOrders.filter((w) => w.salesOrderId === soId);
  assert.equal(mine.length, 2, "the two coordinated (salesOrderId-bearing), non-CLOSED Work Orders are returned");
  assert.equal(mine.some((w) => w.woNumber === "WO-CLOSED"), false, "CLOSED Work Orders are excluded");
  assert.equal(result.workOrders.some((w) => w.woNumber === "WO-STANDALONE"), false, "standalone Work Orders (no salesOrderId) never appear in the result");
  // No raw UID anywhere in the returned projection shape.
  for (const wo of result.workOrders) {
    assert.equal(Object.keys(wo).sort().join(","), "customerId,id,locationId,salesOrderId,salesOrderLineRefs,status,woNumber");
  }
});

await check("readActiveCoordinatedWorkOrders honestly reports truncated:true when the active-status count exceeds the limit", async () => {
  const soId = `SO-covisit-trunc-${runId}`;
  for (let i = 0; i < 3; i++) {
    await db.collection("fieldops_wos").doc(`covisit-trunc-${i}-${runId}`).set({
      woNumber: `WO-TRUNC-${i}`, status: "SCHEDULED", customerId: "ACCT-T", locationId: "LOC-T", salesOrderId: soId,
    });
  }
  // A tiny limit forces truncation given the docs already seeded above plus these three.
  const result = await reads.readActiveCoordinatedWorkOrders(db, 1);
  assert.equal(result.status, "ready");
  assert.equal(result.truncated, true);
  assert.equal(result.workOrders.length <= 1, true);
});

// ----- 1. unauthenticated caller is rejected outright -----
await check("callable rejects unauthenticated callers", async () => {
  await expectHttps(reads.listCoordinatedOperations.run(request()), "unauthenticated");
});

// ----- 2. admin is denied -- fulfillment.coordinatedVisit.read is granted to NO compatibility Role -----
await check("admin is denied -- fulfillment.coordinatedVisit.read is granted to no Role", async () => {
  await expectHttps(reads.listCoordinatedOperations.run(request(adminUid)), "permission-denied");
});

// ----- 3. admin is STILL denied inside the sandbox project -- no activation override exists -----
await check("admin is still denied inside the sandbox project (no activation override exists for this capability)", async () => {
  await withProject("eos-platform-sandbox", async () => {
    await expectHttps(reads.listCoordinatedOperations.run(request(adminUid)), "permission-denied");
  });
});

// ----- 4. dispatcher likewise denied, in any project -----
await check("dispatcher is denied, in any project", async () => {
  await expectHttps(reads.listCoordinatedOperations.run(request(dispatcherUid)), "permission-denied");
  await withProject("eos-platform-sandbox", async () => {
    await expectHttps(reads.listCoordinatedOperations.run(request(dispatcherUid)), "permission-denied");
  });
});

// ----- 5. technician denied, in any project -----
await check("technician is denied, in any project", async () => {
  await expectHttps(reads.listCoordinatedOperations.run(request(technicianUid)), "permission-denied");
  await withProject("eos-platform-sandbox", async () => {
    await expectHttps(reads.listCoordinatedOperations.run(request(technicianUid)), "permission-denied");
  });
});

// ----- production projectId keeps the read DENY too (defense-in-depth; there is no grant to begin with) -----
await check("production projectId keeps the read DENY as well", async () => {
  await withProject("taylor-parts-production", async () => {
    await expectHttps(reads.listCoordinatedOperations.run(request(adminUid)), "permission-denied");
  });
});

console.log(`\n${passed} Coordinated Operations read callable checks passed`);
