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
    operatingCompanyId: "taylor",
    salesChannel: "RETAIL",
    stage: "DECISION",
    outcome: "WON",
    lines: [{ kind: "PART", ref: "PART-1", qty: 3 }],
    ...overrides,
  };
}

// AN ACCEPTED AGREEMENT IS PART OF WHAT A CONVERTIBLE OPPORTUNITY IS.
//
// The Opportunity's own lines carry no price -- deriving orders from them is what produced the
// unpriced CONFIRMED records. Prices come from the ACCEPTED Agreement now, so a fixture that seeds
// only an Opportunity is describing a state that can no longer be converted. Pass `agreement: null`
// for the cases that assert that refusal.
async function seedAgreement(opportunityId, overrides = {}) {
  await db.collection("sales_agreements").doc(`agr-${opportunityId}`).set({
    accountId: "acct-1",
    ownerEmployeeId: "emp-owner",
    sourceOpportunityId: opportunityId,
    state: "ACCEPTED",
    currency: "USD",
    lines: [{ lineId: "l1", kind: "PART", ref: "PART-1", quantity: 3, unitPrice: 4200, extendedMinor: 12600 }],
    ...overrides,
  });
}

async function seedOpportunity(id, overrides = {}) {
  const { agreement, ...oppOverrides } = overrides;
  await db.collection("opportunities").doc(id).set(makeOpportunity(oppOverrides));
  if (agreement !== null) await seedAgreement(id, agreement ?? {});
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
  // unitPrice 4200 is the AGREEMENT's committed price arriving on the persisted order. Before this
  // slice every line here was priceless, and invoicing refuses to bill a priceless line.
  // FIN-002: the line carries its reporting unit (PART classifies itself as PARTS).
  assert.deepEqual(so.lines, [{ lineId: "line-1", kind: "PART", ref: "PART-1", businessUnitId: "PARTS", orderedQty: 3, unitPrice: 4200, allocatedQty: 0, fulfilledQty: 0, billedQty: 0 }]);
  assert.equal(so.sourceAgreementId, `agr-${oppId}`, "the order names the commitment it fulfils");

  const oppSnap = await db.collection("opportunities").doc(oppId).get();
  assert.equal(oppSnap.data().salesOrderId, result.salesOrderId);
});

await check("Agreement line missing a quantity -> fail-closed, no default quantity fabricated", async () => {
  // This case used to point at the OPPORTUNITY's lines. It still would have thrown
  // failed-precondition after this change -- but for the wrong reason ("no agreement"), which is a
  // test that passes while measuring nothing. It now asserts the quantity rule where quantities
  // actually live, and asserts the MESSAGE so it cannot drift back into passing by accident.
  const oppId = `opp-noqty-${Date.now()}`;
  await seedOpportunity(oppId, { agreement: { lines: [{ lineId: "l1", kind: "PART", ref: "PART-2", unitPrice: 100 }] } });
  await assert.rejects(
    runCore({ opportunityId: oppId, ownerEmployeeId: "emp-1", salesChannel: "RETAIL", idempotencyKey: `k-${oppId}` }),
    // invalid-argument, not failed-precondition: the quantity rule now fires in
    // buildCreateSalesOrder, which the caller maps to invalid-argument. Asserting the old code
    // here would have been a test written to the old wiring rather than to the behaviour.
    (error) => error?.code === "invalid-argument" && /orderedQty/.test(error.message),
  );
  const soSnap = await db.collection("sales_orders").where("sourceOpportunityId", "==", oppId).get();
  assert.equal(soSnap.empty, true);
});

await check("NO AGREEMENT -> fail-closed, and the refusal names the missing agreement", async () => {
  const oppId = `opp-noagr-${Date.now()}`;
  await seedOpportunity(oppId, { agreement: null });
  await assert.rejects(
    runCore({ opportunityId: oppId, ownerEmployeeId: "emp-1", salesChannel: "RETAIL", idempotencyKey: `k-${oppId}` }),
    (error) => error?.code === "failed-precondition" && /no sales agreement/i.test(error.message),
  );
  const soSnap = await db.collection("sales_orders").where("sourceOpportunityId", "==", oppId).get();
  assert.equal(soSnap.empty, true);
  const oppSnap = await db.collection("opportunities").doc(oppId).get();
  assert.equal(oppSnap.data().salesOrderId, undefined, "and no back-link is written");
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

await check("the same idempotency key is scoped to its Opportunity", async () => {
  const key = `shared-${Date.now()}`;
  const firstOpp = `opp-scope-a-${Date.now()}`;
  const secondOpp = `opp-scope-b-${Date.now()}`;
  await seedOpportunity(firstOpp);
  await seedOpportunity(secondOpp);
  const first = await runCore({ opportunityId: firstOpp, ownerEmployeeId: "emp-1", salesChannel: "RETAIL", idempotencyKey: key });
  const second = await runCore({ opportunityId: secondOpp, ownerEmployeeId: "emp-1", salesChannel: "RETAIL", idempotencyKey: key });
  assert.equal(first.replayed, false);
  assert.equal(second.replayed, false);
  assert.notEqual(first.salesOrderId, second.salesOrderId);
});

console.log(`\n${passed} createSalesOrderFromOpportunity callable checks passed`);
