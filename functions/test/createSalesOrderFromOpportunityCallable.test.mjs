// P1.3 -- governed, human-invoked WON -> Create Sales Order action. Emulator-test convention mirrors
// coverageCallables.test.mjs: the callable boundary is exercised for auth/capability gating (unauthenticated,
// ungranted -- `opportunity.createSalesOrder` is registered active:false, a hard deny for everyone until a
// separate Owner grant), and the transactional business core (persistSalesOrderFromOpportunity) is exercised
// DIRECTLY -- below the capability gate, exactly the pattern salesOrderCallables.ts/opportunityCallables.ts
// already establish for persistCreatedSalesOrder/persistTransitionedOpportunity -- to prove the WON-only
// precondition, the sourceOpportunityId dedup, the atomic Opportunity back-link, and idempotency replay.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8202";

import assert from "node:assert/strict";
import admin from "firebase-admin";

admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();
const mod = await import("../lib/opportunity/createSalesOrderFromOpportunity.js");

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

const uid = `p13-callable-${Date.now()}`;
await db.collection("users").doc(uid).set({ accessVersion: 1 });
await db.collection("roleAssignments").doc(`p13-callable-role-${Date.now()}`).set({
  principalUid: uid,
  roleId: "admin",
  scope: { type: "global" },
  grantedBy: "test",
  grantedAt: admin.firestore.Timestamp.now(),
  status: "active",
  accessVersionAtGrant: 1,
});

// ----- Callable boundary: capability is registered active:false, a hard deny for everyone -----

await check("callable rejects unauthenticated callers", async () => {
  await expectHttps(
    mod.createSalesOrderFromOpportunity.run(
      request({ opportunityId: "opp-x", ownerEmployeeId: "emp-1", salesChannel: "RETAIL", idempotencyKey: "k" }),
    ),
    "unauthenticated",
  );
});

await check("callable fails closed for an active admin while opportunity.createSalesOrder remains inactive (ungranted)", async () => {
  await expectHttps(
    mod.createSalesOrderFromOpportunity.run(
      request({ opportunityId: "opp-x", ownerEmployeeId: "emp-1", salesChannel: "RETAIL", idempotencyKey: "k" }, uid),
    ),
    "permission-denied",
  );
  assert.equal((await db.collection("sales_orders").where("sourceOpportunityId", "==", "opp-x").get()).empty, true);
});

// ----- Transactional business core, exercised directly (below the capability gate) -----

function makeOpportunity(overrides = {}) {
  return {
    accountId: "acct-1",
    ownerEmployeeId: "emp-owner",
    salesChannel: "RETAIL",
    stage: "DECISION",
    outcome: "WON",
    lines: [{ kind: "PART", ref: "PART-1", qty: 3 }],
    ...overrides,
  };
}

async function seedOpportunity(id, overrides = {}) {
  await db.collection("opportunities").doc(id).set(makeOpportunity(overrides));
}

async function runCore(input) {
  return db.runTransaction((tx) =>
    mod.persistSalesOrderFromOpportunity(db, tx, input, uid),
  );
}

await check("Opportunity not WON -> rejected, no Sales Order created, no back-link written", async () => {
  const oppId = `opp-notwon-${Date.now()}`;
  await seedOpportunity(oppId, { outcome: null, stage: "QUOTING" });
  await assert.rejects(
    runCore({ opportunityId: oppId, ownerEmployeeId: "emp-1", salesChannel: "RETAIL", idempotencyKey: `k-${oppId}` }),
    (error) => error?.code === "failed-precondition",
  );
  const soSnap = await db.collection("sales_orders").where("sourceOpportunityId", "==", oppId).get();
  assert.equal(soSnap.empty, true);
  const oppSnap = await db.collection("opportunities").doc(oppId).get();
  assert.equal(oppSnap.data().salesOrderId, undefined);
});

await check("WON, no prior Sales Order -> Sales Order created with correct sourceOpportunityId/accountId/lines + Opportunity.salesOrderId set atomically", async () => {
  const oppId = `opp-won-${Date.now()}`;
  await seedOpportunity(oppId);
  const result = await runCore({
    opportunityId: oppId,
    ownerEmployeeId: "emp-owner-2",
    salesChannel: "NATIONAL_ACCOUNTS",
    locationId: "loc-1",
    customerPO: "PO-77",
    idempotencyKey: `k-${oppId}`,
  });
  assert.equal(result.success, true);
  assert.equal(result.replayed, false);
  assert.ok(result.salesOrderId);

  const soSnap = await db.collection("sales_orders").doc(result.salesOrderId).get();
  assert.equal(soSnap.exists, true);
  const so = soSnap.data();
  assert.equal(so.sourceOpportunityId, oppId);
  assert.equal(so.accountId, "acct-1"); // server-derived from the Opportunity, NOT client-supplied
  assert.equal(so.ownerEmployeeId, "emp-owner-2"); // caller-supplied SO-own fact
  assert.equal(so.salesChannel, "NATIONAL_ACCOUNTS");
  assert.equal(so.locationId, "loc-1");
  assert.equal(so.customerPO, "PO-77");
  assert.equal(so.state, "CONFIRMED");
  assert.deepEqual(so.lines, [{ kind: "PART", ref: "PART-1", orderedQty: 3, allocatedQty: 0, fulfilledQty: 0 }]);

  const oppSnap = await db.collection("opportunities").doc(oppId).get();
  assert.equal(oppSnap.data().salesOrderId, result.salesOrderId);
});

await check("Opportunity line missing qty -> fail-closed, no Sales Order, no default quantity fabricated", async () => {
  const oppId = `opp-noqty-${Date.now()}`;
  await seedOpportunity(oppId, { lines: [{ kind: "PART", ref: "PART-2" }] });
  await assert.rejects(
    runCore({ opportunityId: oppId, ownerEmployeeId: "emp-1", salesChannel: "RETAIL", idempotencyKey: `k-${oppId}` }),
    (error) => error?.code === "failed-precondition",
  );
  const soSnap = await db.collection("sales_orders").where("sourceOpportunityId", "==", oppId).get();
  assert.equal(soSnap.empty, true);
});

await check("WON with an existing Sales Order for it -> rejected (dedup on sourceOpportunityId)", async () => {
  const oppId = `opp-dup-${Date.now()}`;
  await seedOpportunity(oppId);
  await db.collection("sales_orders").doc().set({
    sourceOpportunityId: oppId,
    accountId: "acct-1",
    state: "CONFIRMED",
    lines: [],
  });
  await assert.rejects(
    runCore({ opportunityId: oppId, ownerEmployeeId: "emp-1", salesChannel: "RETAIL", idempotencyKey: `k-${oppId}-second` }),
    (error) => error?.code === "failed-precondition",
  );
  const soSnap = await db.collection("sales_orders").where("sourceOpportunityId", "==", oppId).get();
  assert.equal(soSnap.size, 1); // still exactly the one pre-existing Sales Order
});

await check("idempotencyKey replay -> replayed:true, no second Sales Order created", async () => {
  const oppId = `opp-replay-${Date.now()}`;
  await seedOpportunity(oppId);
  const key = `k-${oppId}`;
  const first = await runCore({ opportunityId: oppId, ownerEmployeeId: "emp-1", salesChannel: "RETAIL", idempotencyKey: key });
  assert.equal(first.replayed, false);
  assert.ok(first.salesOrderId);

  const second = await runCore({ opportunityId: oppId, ownerEmployeeId: "emp-1", salesChannel: "RETAIL", idempotencyKey: key });
  assert.equal(second.replayed, true);
  assert.equal(second.salesOrderId, first.salesOrderId);

  const soSnap = await db.collection("sales_orders").where("sourceOpportunityId", "==", oppId).get();
  assert.equal(soSnap.size, 1);
});

console.log(`\n${passed} createSalesOrderFromOpportunity callable checks passed`);
