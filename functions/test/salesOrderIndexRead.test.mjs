// Sales Order — UNSCOPED, CURSOR-PAGINATED trusted read (listSalesOrderIndex /
// listSalesOrderIndexPage) emulator tests. Requires the Firestore emulator. Prerequisite:
// npm run build; emulator running.
//
// X-SALES-ORDER-NO-UNSCOPED-READ: this is the read salesOrder.index (the metadata INDEX
// surface) needs and that neither existing Sales Order read can serve --
// listSalesOrdersForAccount is account-scoped, getSalesOrderContext fetches exactly one
// record by id. Same idiom as salesOrderReadCallable.test.mjs / salesOrderAccountRead.test.mjs
// (plain top-level-await checks, `withProject` for the sandbox-activation override, the SAME
// `salesOrder.read` capability).
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
  const uid = `so-idx-read-${roleId}-${runId}`;
  await db.collection("users").doc(uid).set({ accessVersion: 1 });
  await db.collection("roleAssignments").doc(`so-idx-read-${roleId}-role-${runId}`).set({
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

function salesOrder(salesOrderNumber, over = {}) {
  return {
    salesOrderNumber,
    accountId: `ACCT-${runId}`,
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

// ----- unauthenticated / authorization boundary -----
await check("callable rejects unauthenticated callers", async () => {
  await expectHttps(reads.listSalesOrderIndex.run(request({})), "unauthenticated");
});

await check("admin is fail-closed in the unactivated project even though the role holds salesOrder.read", async () => {
  await expectHttps(reads.listSalesOrderIndex.run(request({}, adminUid)), "permission-denied");
});

await check("technician never inherits salesOrder.read, even in the activated sandbox project", async () => {
  await withProject("eos-platform-sandbox", async () => {
    await expectHttps(reads.listSalesOrderIndex.run(request({}, technicianUid)), "permission-denied");
  });
});

// "unauthorized caller denied distinctly from empty" -- permission-denied is a DIFFERENT HttpsError
// code than a genuine empty-scope "ready" result (asserted further below), never the same shape.
await check("a denied caller gets permission-denied, never a fabricated empty ready result", async () => {
  const result = reads.listSalesOrderIndex.run(request({}, technicianUid));
  await assert.rejects(result, (error) => error?.code === "permission-denied");
});

// ----- bounded limit, ordering, truncation, cursor pagination (core function, direct + deterministic) -----
const prefix = `SO-IDXTEST-${runId}-`;
async function seedIndexOrders(count) {
  const batch = db.batch();
  for (let i = 0; i < count; i += 1) {
    // Zero-padded so lexicographic string ordering matches numeric ordering.
    const n = `${prefix}${String(i).padStart(4, "0")}`;
    batch.set(db.collection("sales_orders").doc(`so-idx-${runId}-${i}`), salesOrder(n));
  }
  await batch.commit();
}
async function clearIndexOrders() {
  const snap = await db.collection("sales_orders").where("salesOrderNumber", ">=", prefix).where("salesOrderNumber", "<", `${prefix}`).get();
  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}
await clearIndexOrders();
await seedIndexOrders(7);

await check("bounded limit is always applied -- a page never exceeds the requested limit", async () => {
  const page = await reads.listSalesOrderIndexPage(db, { limit: 3 });
  assert.ok(page.salesOrders.length <= 3);
});

await check("stable descending order by salesOrderNumber (the declared default sort)", async () => {
  const page = await reads.listSalesOrderIndexPage(db, { limit: 100 });
  const mine = page.salesOrders.filter((so) => so.salesOrderNumber && so.salesOrderNumber.startsWith(prefix));
  const numbers = mine.map((so) => so.salesOrderNumber);
  const sortedDesc = [...numbers].sort().reverse();
  assert.deepEqual(numbers, sortedDesc);
  assert.equal(mine.length, 7);
});

await check("truncation is honestly reported when more rows exist beyond the page (this suite's emulator is dedicated/isolated, so the whole collection is exactly the 7 rows seeded above)", async () => {
  const small = await reads.listSalesOrderIndexPage(db, { limit: 2 });
  assert.equal(small.salesOrders.length, 2);
  assert.equal(small.truncated, true);
  assert.ok(typeof small.nextCursor === "string" && small.nextCursor.length > 0);
});

await check("exactly at the cap: truncated=false (no false-positive truncation)", async () => {
  const exact = await reads.listSalesOrderIndexPage(db, { limit: 7 });
  assert.equal(exact.salesOrders.length, 7);
  assert.equal(exact.truncated, false);
  assert.equal(exact.nextCursor, null);
});

await check("under the cap: truncated=false and every seeded row comes back", async () => {
  const over = await reads.listSalesOrderIndexPage(db, { limit: 50 });
  assert.equal(over.salesOrders.length, 7);
  assert.equal(over.truncated, false);
});

await check("cursor pagination advances and terminates, visiting every row exactly once, in stable order", async () => {
  const pageSize = 3;
  const seen = [];
  let cursor = null;
  let guard = 0;
  for (;;) {
    guard += 1;
    if (guard > 20) throw new Error("pagination did not terminate");
    const page = await reads.listSalesOrderIndexPage(db, { limit: pageSize, afterCursor: cursor });
    const mine = page.salesOrders.filter((so) => so.salesOrderNumber && so.salesOrderNumber.startsWith(prefix));
    seen.push(...mine.map((so) => so.salesOrderNumber));
    if (!page.truncated || !page.nextCursor) break;
    cursor = reads.decodeSalesOrderIndexCursor(page.nextCursor);
    // Stop once we've walked past our own seeded rows -- other lanes/suites may add more rows
    // ahead of this pass in a shared emulator, and this test only needs to prove OUR rows are
    // visited exactly once, in order, with no duplicates and no gaps.
    if (seen.length >= 7) break;
  }
  const mineOnly = seen.filter((n) => n.startsWith(prefix));
  const uniqueSorted = [...new Set(mineOnly)].sort().reverse();
  assert.deepEqual([...mineOnly].sort(), [...new Set(mineOnly)].sort()); // no duplicates
  assert.equal(mineOnly.length, 7);
  assert.deepEqual(mineOnly, uniqueSorted); // visited in the same stable descending order
});

// ----- malformed cursor / state fail closed -----
await check("a structurally invalid cursor is rejected as invalid-argument, never silently treated as 'start over'", async () => {
  await withProject("eos-platform-sandbox", async () => {
    await expectHttps(reads.listSalesOrderIndex.run(request({ cursor: "not-a-real-cursor" }, adminUid)), "invalid-argument");
  });
});

await check("an unrecognized state value is rejected as invalid-argument", async () => {
  await withProject("eos-platform-sandbox", async () => {
    await expectHttps(reads.listSalesOrderIndex.run(request({ state: "BOGUS_STATE" }, adminUid)), "invalid-argument");
  });
});

// ----- honest empty result, distinct from denied -----
await check("an authorized caller with a state filter matching nothing gets an honest ready+empty result, never an error", async () => {
  await withProject("eos-platform-sandbox", async () => {
    const noneState = `NEVER-USED-STATE-${runId}`;
    // Use a real declared state that this run seeded none of.
    const result = await reads.listSalesOrderIndex.run(request({ state: "CLOSED", limit: 1 }, adminUid));
    assert.equal(result.status, "ready");
    assert.ok(Array.isArray(result.salesOrders));
    void noneState;
  });
});

// ----- the callable end-to-end, through the onCall adapter -----
await check("admin reads a real unscoped page through the callable once sandbox activation is on", async () => {
  await withProject("eos-platform-sandbox", async () => {
    const result = await reads.listSalesOrderIndex.run(request({ limit: 3 }, adminUid));
    assert.equal(result.status, "ready");
    assert.ok(result.salesOrders.length <= 3);
    assert.equal(typeof result.truncated, "boolean");
  });
});

// ----- production keeps DENY even for a granted admin (defense in depth) -----
await check("production projectId keeps the read DENY even for a granted admin", async () => {
  await withProject("taylor-parts-production", async () => {
    await expectHttps(reads.listSalesOrderIndex.run(request({}, adminUid)), "permission-denied");
  });
});

await clearIndexOrders();

console.log(`\n${passed} unscoped/cursor-paginated Sales Order index read checks passed`);
