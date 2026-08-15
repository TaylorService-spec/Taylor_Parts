// Sales Order — trusted read callable (getSalesOrderContext) emulator tests. Requires the Firestore
// emulator. Prerequisite: npm run build; emulator running.
//
// Covers the callable authorization boundary end-to-end, mirroring financeReadCallables.test.mjs's
// pattern (auth/grant/deny) combined with effectiveAccessFeed.test.mjs's `withProject` pattern (GCLOUD_
// PROJECT toggling to exercise the per-environment activation override, since `salesOrder.read` is
// registered active:false and only lifts in a sandbox-role, non-production project).
//
// NOTE on requirement "client never requires direct Firestore read access to sales_orders": this is
// structurally guaranteed, not separately tested here -- firestore.rules' `sales_orders` block
// (`allow read, write: if false`) is UNCHANGED by this feature (confirmed by the accompanying PR's
// zero-diff on firestore.rules). This callable uses the Admin SDK, which bypasses Rules by design,
// exactly like every other trusted read service in this codebase (opportunityReadService.ts,
// financeReadCallables.ts).
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";

import assert from "node:assert/strict";
import admin from "firebase-admin";

admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();
const reads = await import("../lib/salesOrder/salesOrderReadService.js");
const { __resetRuntimeCapabilityOverridesCacheForTest } = await import("../lib/access/environmentCapabilityOverrides.js");

let passed = 0;
async function check(name, fn) {
  await fn();
  passed += 1;
  console.log(`PASS: ${name}`);
}
const request = (data, uid) => ({ data, auth: uid ? { uid, token: {} } : undefined });
async function expectHttps(promise, code) {
  await assert.rejects(promise, (error) => error?.code === code);
}

// Run `fn` with GCLOUD_PROJECT pinned (or cleared) and the cold-start override cache reset before and
// after, so each case sees a fresh runtime resolution -- exact pattern from effectiveAccessFeed.test.mjs.
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
  const uid = `so-read-${roleId}-${runId}`;
  await db.collection("users").doc(uid).set({ accessVersion: 1 });
  await db.collection("roleAssignments").doc(`so-read-${roleId}-role-${runId}`).set({
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
  await expectHttps(reads.getSalesOrderContext.run(request({ salesOrderId: "so-1" })), "unauthenticated");
});

// ----- 5. inactive environment fails closed: even a granted admin is denied in the unactivated project -----
await check("admin is fail-closed in the unactivated project (taylor-parts) even though the role holds salesOrder.read", async () => {
  await expectHttps(reads.getSalesOrderContext.run(request({ salesOrderId: "so-1" }, adminUid)), "permission-denied");
});

// ----- 2. technician does not inherit Sales Order read, in ANY project (not part of the granting roles) -----
await check("technician never inherits salesOrder.read, in the unactivated project", async () => {
  await expectHttps(reads.getSalesOrderContext.run(request({ salesOrderId: "so-1" }, technicianUid)), "permission-denied");
});
await check("technician never inherits salesOrder.read, even in the activated sandbox project", async () => {
  await withProject("eos-platform-sandbox", async () => {
    await expectHttps(reads.getSalesOrderContext.run(request({ salesOrderId: "so-1" }, technicianUid)), "permission-denied");
  });
});

const soId = `so-read-${runId}`;
await db.collection("sales_orders").doc(soId).set({
  accountId: "ACCT-1",
  ownerEmployeeId: "EMP-1",
  salesChannel: "RETAIL",
  currency: "USD",
  locationId: null,
  sourceOpportunityId: "OPP-1",
  customerPO: null,
  notes: null,
  state: "CONFIRMED",
  lines: [{ lineId: "line-1", kind: "PART", ref: "PRT-1", orderedQty: 3, allocatedQty: 0, fulfilledQty: 0, billedQty: 0 }],
  serviceWorkOrderIds: [],
  createdAtMillis: Date.now(),
  updatedAtMillis: Date.now(),
});

// ----- 3. admin CAN read once the sandbox activation override is on -----
await check("admin reads a real Sales Order once sandbox activation is on", async () => {
  await withProject("eos-platform-sandbox", async () => {
    const result = await reads.getSalesOrderContext.run(request({ salesOrderId: soId }, adminUid));
    assert.equal(result.status, "ready");
    assert.equal(result.salesOrder.id, soId);
    assert.equal(result.salesOrder.accountId, "ACCT-1");
    assert.equal(result.salesOrder.sourceOpportunityId, "OPP-1");
  });
});

// ----- 4. dispatcher CAN read once the sandbox activation override is on -----
await check("dispatcher reads a real Sales Order once sandbox activation is on", async () => {
  await withProject("eos-platform-sandbox", async () => {
    const result = await reads.getSalesOrderContext.run(request({ salesOrderId: soId }, dispatcherUid));
    assert.equal(result.status, "ready");
    assert.equal(result.salesOrder.id, soId);
  });
});

// ----- 7. a missing Sales Order id is an honest not-found, distinct from unavailable -----
await check("a genuinely missing Sales Order id returns an honest not-found, never a fabricated result", async () => {
  await withProject("eos-platform-sandbox", async () => {
    const result = await reads.getSalesOrderContext.run(request({ salesOrderId: `so-does-not-exist-${runId}` }, adminUid));
    assert.equal(result.status, "not-found");
    assert.equal(result.salesOrder, null);
  });
});

// ----- production projectId keeps salesOrder.read DENY even with a granting role (defense-in-depth) -----
await check("production projectId keeps the read DENY even for a granted admin (activation never applies in production)", async () => {
  await withProject("taylor-parts-production", async () => {
    await expectHttps(reads.getSalesOrderContext.run(request({ salesOrderId: soId }, adminUid)), "permission-denied");
  });
});

// ----- invalid-argument guard -----
await check("a missing salesOrderId argument is rejected before any authorization check", async () => {
  await expectHttps(reads.getSalesOrderContext.run(request({}, adminUid)), "invalid-argument");
});

console.log(`\n${passed} Sales Order read callable checks passed`);
