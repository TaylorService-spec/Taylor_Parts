// Sales Order — ACCOUNT-SCOPED trusted read (listSalesOrdersForAccount / readSalesOrdersForAccount)
// emulator tests. Requires the Firestore emulator (127.0.0.1:8080). Prerequisite: npm run build; emulator
// running. Wave 7 completion PART 3: "which Sales Orders belong to this Account?" -- reuses the SAME
// `salesOrder.read` capability as getSalesOrderContext (functions/src/salesOrder/salesOrderReadService.ts);
// only the query shape (a real server-side accountId `where` clause, bounded) is new. Reuses
// projectSalesOrder() -- the SAME projection function getSalesOrderContext uses -- so PR #991's pricing
// exclusion (no unitPrice) cannot leak through a second code path; asserted directly below.
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
  const uid = `so-acct-read-${roleId}-${runId}`;
  await db.collection("users").doc(uid).set({ accessVersion: 1 });
  await db.collection("roleAssignments").doc(`so-acct-read-${roleId}-role-${runId}`).set({
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
const technicianUid = await seedPrincipal("technician");

function salesOrder(accountId, over = {}) {
  return {
    accountId,
    ownerEmployeeId: "EMP-1",
    salesChannel: "RETAIL",
    currency: "USD",
    locationId: null,
    sourceOpportunityId: null,
    customerPO: null,
    notes: null,
    state: "CONFIRMED",
    lines: [{ lineId: "line-1", kind: "PART", ref: "PRT-1", orderedQty: 1, allocatedQty: 0, fulfilledQty: 0, billedQty: 0, unitPrice: 99.99 }],
    serviceWorkOrderIds: [],
    createdAtMillis: Date.now(),
    updatedAtMillis: Date.now(),
    ...over,
  };
}
async function seedSalesOrders(accountId, count, over = {}) {
  const batch = db.batch();
  for (let i = 0; i < count; i += 1) {
    batch.set(db.collection("sales_orders").doc(`so-${accountId}-${i}`), salesOrder(accountId, over));
  }
  await batch.commit();
}
async function clearSalesOrders(accountId) {
  const snap = await db.collection("sales_orders").where("accountId", "==", accountId).get();
  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}

// ----- unauthenticated / invalid-argument boundary -----
await check("callable rejects unauthenticated callers", async () => {
  await expectHttps(reads.listSalesOrdersForAccount.run(request({ accountId: "acct-1" })), "unauthenticated");
});

await check("a missing accountId argument is rejected before any authorization check", async () => {
  await expectHttps(reads.listSalesOrdersForAccount.run(request({}, adminUid)), "invalid-argument");
});

await check("a blank accountId argument is rejected", async () => {
  await expectHttps(reads.listSalesOrdersForAccount.run(request({ accountId: "   " }, adminUid)), "invalid-argument");
});

// ----- authorization: fail-closed while salesOrder.read stays inactive in this project -----
await check("admin is fail-closed in the unactivated project even though the role holds salesOrder.read", async () => {
  await expectHttps(reads.listSalesOrdersForAccount.run(request({ accountId: "acct-1" }, adminUid)), "permission-denied");
});

await check("technician never inherits salesOrder.read, even in the activated sandbox project", async () => {
  await withProject("eos-platform-sandbox", async () => {
    await expectHttps(reads.listSalesOrdersForAccount.run(request({ accountId: "acct-1" }, technicianUid)), "permission-denied");
  });
});

// ----- populated / empty / malformed accountId / no pricing leak -----
await check("authorized admin reads real Sales Orders scoped to the account, in the activated sandbox project", async () => {
  const accountId = `acct-pop-${runId}`;
  const otherAccountId = `acct-other-${runId}`;
  await clearSalesOrders(accountId);
  await clearSalesOrders(otherAccountId);
  await seedSalesOrders(accountId, 3);
  await seedSalesOrders(otherAccountId, 2); // must NOT leak into this account's page
  await withProject("eos-platform-sandbox", async () => {
    const result = await reads.listSalesOrdersForAccount.run(request({ accountId }, adminUid));
    assert.equal(result.status, "ready");
    assert.equal(result.salesOrders.length, 3);
    assert.equal(result.truncated, false);
    assert.equal(result.skipped, 0);
    assert.ok(result.salesOrders.every((so) => so.accountId === accountId));
    // PR #991's pricing exclusion must hold on this second code path too -- no unitPrice anywhere.
    for (const so of result.salesOrders) {
      for (const line of so.lines) {
        assert.equal("unitPrice" in line, false);
        assert.equal("price" in line, false);
      }
    }
  });
});

await check("an account with zero Sales Orders returns an honest ready+empty result, never an error", async () => {
  const accountId = `acct-empty-${runId}`;
  await clearSalesOrders(accountId);
  await withProject("eos-platform-sandbox", async () => {
    const result = await reads.listSalesOrdersForAccount.run(request({ accountId }, adminUid));
    assert.equal(result.status, "ready");
    assert.deepEqual(result.salesOrders, []);
    assert.equal(result.truncated, false);
  });
});

await check("a malformed/nonexistent accountId is not an error -- an honest ready+empty result", async () => {
  await withProject("eos-platform-sandbox", async () => {
    const result = await reads.listSalesOrdersForAccount.run(
      request({ accountId: "  !!not-a-real-id///<>  " }, adminUid)
    );
    assert.equal(result.status, "ready");
    assert.deepEqual(result.salesOrders, []);
  });
});

// ----- bounded-read honesty: truncation must be disclosed, never silently dropped -----
await check("over the cap: truncated=true and the page is capped at `limit`, never silently short", async () => {
  const accountId = `acct-trunc-${runId}`;
  await clearSalesOrders(accountId);
  await seedSalesOrders(accountId, 6);
  await withProject("eos-platform-sandbox", async () => {
    const result = await reads.listSalesOrdersForAccount.run(request({ accountId, limit: 5 }, adminUid));
    assert.equal(result.status, "ready");
    assert.equal(result.salesOrders.length, 5);
    assert.equal(result.truncated, true);
  });
});

await check("exactly at the cap: truncated=false (no false-positive truncation)", async () => {
  const accountId = `acct-atcap-${runId}`;
  await clearSalesOrders(accountId);
  await seedSalesOrders(accountId, 5);
  await withProject("eos-platform-sandbox", async () => {
    const result = await reads.listSalesOrdersForAccount.run(request({ accountId, limit: 5 }, adminUid));
    assert.equal(result.salesOrders.length, 5);
    assert.equal(result.truncated, false);
  });
});

// ----- production keeps DENY even for a granted admin (defense in depth) -----
await check("production projectId keeps the read DENY even for a granted admin", async () => {
  const accountId = `acct-prod-${runId}`;
  await withProject("taylor-parts-production", async () => {
    await expectHttps(reads.listSalesOrdersForAccount.run(request({ accountId }, adminUid)), "permission-denied");
  });
});

console.log(`\n${passed} account-scoped Sales Order read callable checks passed`);
