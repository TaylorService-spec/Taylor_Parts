// Coordinated Operations -- trusted read callable (listCoordinatedOperations) emulator tests. Requires the
// Firestore emulator. Prerequisite: npm run build; emulator running.
//
// Covers the callable authorization boundary end-to-end, mirroring serializedAssetReadCallable.test.mjs's
// pattern exactly, plus the bounded read itself (active-status filter, non-coordinated Work Orders dropped,
// truncation is honest).
//
// GRANT vs ACTIVATION (the two-axis gate this suite exists to prove). Owner Decision #113
// (grantable-governed-roles workstream) grants `fulfillment.coordinatedVisit.read` to exactly five Roles --
// owner, admin, operationsManager, fieldManager, dispatcher -- via compatibilityRoles.ts/
// governedBusinessRoles.ts. That grant is NOT an activation: the capability is still registered active:false
// in permissionCatalog.ts, and resolveEffectivePermission's active:false gate denies EVERY principal,
// including a principal holding a qualifying grant, in any environment that does not list this id in its own
// `capabilityActivationOverrides` (environmentCapabilityOverrides.ts). Today only the `eos-platform-sandbox`
// project's registry entry does. So:
//   - Grant WITHOUT activation (no override in this project)         -> DENY, for everyone, grant or not.
//   - Grant WITH activation (inside eos-platform-sandbox)             -> ALLOW, for the five granted Roles.
//   - NO grant, regardless of activation (e.g. technician, in sandbox) -> DENY.
// This suite proves all three states directly, plus (unchanged) that an unauthenticated caller is rejected
// outright and that the production project stays denied regardless (role-keyed hard block, defense in depth).
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
// The ALLOW-path counterpart of expectHttps: the call must resolve (not throw), and resolve to the read's
// own "ready" shape -- proves the request actually passed the authorization wall and reached the bounded
// read, not merely that it didn't throw a specific code.
async function expectAllowed(promise) {
  const result = await promise;
  assert.equal(result.status, "ready");
  assert.equal(Array.isArray(result.workOrders), true);
  return result;
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
const ownerUid = await seedPrincipal("owner");
const operationsManagerUid = await seedPrincipal("operationsManager");
const fieldManagerUid = await seedPrincipal("fieldManager");

// ----- 0. the CORE bounded read against real seeded Work Orders (calling readActiveCoordinatedWorkOrders
// directly, independent of the auth wall, so the read behavior is proven on its own) -----
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

// ----- 1. unauthenticated caller is rejected outright -- unchanged by Owner Decision #113 -----
await check("callable rejects unauthenticated callers", async () => {
  await expectHttps(reads.listCoordinatedOperations.run(request()), "unauthenticated");
});

// ----- 2. WITHOUT an environment activation override, every principal is denied -- including the Roles
// Owner Decision #113 now grants it to. The grant alone never lifts the catalog's active:false gate; only
// a per-environment activation override does that (environmentCapabilityOverrides.ts), and this default
// test project ("taylor-parts", no withProject wrapper here) carries none for this capability. -----
await check("admin is denied where no environment activates the capability (active:false gate, not lack of grant -- admin DOES hold the grant now)", async () => {
  await expectHttps(reads.listCoordinatedOperations.run(request(adminUid)), "permission-denied");
});

await check("owner, operationsManager, fieldManager, dispatcher are likewise denied where no environment activates the capability", async () => {
  for (const uid of [ownerUid, operationsManagerUid, fieldManagerUid, dispatcherUid]) {
    await expectHttps(reads.listCoordinatedOperations.run(request(uid)), "permission-denied");
  }
});

// ----- 3. INSIDE the sandbox project, whose registry entry DOES activate this capability
// (config/environments.json / the embedded ENVIRONMENT_ACTIVATION_REGISTRY snapshot both list
// "fulfillment.coordinatedVisit.read" for eos-platform-sandbox), the five Owner-Decision-#113 Roles are now
// ALLOWED. This is the flip: before that ruling this whole project was still DENY for everyone, because no
// Role held the grant at all; now the grant exists and this is the one environment that also activates it. -----
await check("owner, admin, operationsManager, fieldManager, dispatcher are ALLOWED inside the sandbox project -- exactly the five Owner-Decision-#113 Roles, under activation", async () => {
  await withProject("eos-platform-sandbox", async () => {
    for (const uid of [ownerUid, adminUid, operationsManagerUid, fieldManagerUid, dispatcherUid]) {
      await expectAllowed(reads.listCoordinatedOperations.run(request(uid)));
    }
  });
});

// ----- 4. technician is denied in BOTH environments -- proving the sandbox ALLOW above is scoped to
// exactly the five named Roles, not "activation makes everyone pass." Outside sandbox it is denied by the
// same active:false gate as everyone else; inside sandbox (where the gate is lifted) it is denied because
// technician was never one of the granted Roles to begin with. -----
await check("technician is denied in any project -- outside sandbox by the inactive gate, inside sandbox by lacking the grant", async () => {
  await expectHttps(reads.listCoordinatedOperations.run(request(technicianUid)), "permission-denied");
  await withProject("eos-platform-sandbox", async () => {
    await expectHttps(reads.listCoordinatedOperations.run(request(technicianUid)), "permission-denied");
  });
});

// ----- production projectId keeps the read DENY too -- defense in depth, independent of the grant. Even
// though admin now holds the grant, environmentCapabilityOverrides.ts's role-keyed hard block returns EMPTY
// unconditionally for any project whose registry role is "production" (and fails closed for any unrecognized
// project id too), so this stays denied regardless of what any Role holds. -----
await check("production projectId keeps the read DENY as well, regardless of the grant", async () => {
  await withProject("taylor-parts-production", async () => {
    await expectHttps(reads.listCoordinatedOperations.run(request(adminUid)), "permission-denied");
  });
});

console.log(`\n${passed} Coordinated Operations read callable checks passed`);
