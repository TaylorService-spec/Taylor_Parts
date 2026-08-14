// Firestore-emulator coverage for createSalesOrder's source-Opportunity integrity (P1.4-1.6, Sales->Cash
// lifecycle build plan). These persistence helpers sit below the capability gate (salesOrder.write is
// registered active:false), so the test proves the transaction invariant without activating dormant
// capabilities -- same shape as commercialCreateIdempotency.test.mjs / commercialTransitionIdempotency.test.mjs.
//
// Prerequisite (same harness as the sibling create-idempotency tests):
//   firebase emulators:start --only firestore --project taylor-parts
//   (after `npm run build`) node --test test/createSalesOrderSourceOpportunity.test.mjs
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8203";

import assert from "node:assert/strict";
import { test } from "node:test";
import admin from "firebase-admin";
import { buildCreateSalesOrder } from "../lib/salesOrder/salesOrderCommands.js";
import { persistCreatedSalesOrder } from "../lib/salesOrder/salesOrderCallables.js";

admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();
let sequence = 0;
const id = (kind) => `${kind}-${Date.now()}-${++sequence}`;
const opportunityLines = [{ kind: "PART", ref: "part-1", qty: 1 }];

const opp = async (fields) => {
  const oppId = id("opp");
  await db.collection("opportunities").doc(oppId).set({ lines: opportunityLines, ...fields });
  return oppId;
};

const builtFor = (accountId, sourceOpportunityId) =>
  buildCreateSalesOrder(
    { accountId, ownerEmployeeId: id("owner"), salesChannel: "RETAIL", sourceOpportunityId, lines: [{ kind: "PART", ref: "part-1", orderedQty: 1 }] },
    { actorUid: id("actor"), nowMillis: Date.now() },
  );

test("sourceOpportunityId pointing at a non-existent Opportunity is rejected -- no Sales Order created", async () => {
  const accountId = id("account");
  const built = builtFor(accountId, id("missing-opp"));
  await assert.rejects(
    () => db.runTransaction((tx) => persistCreatedSalesOrder(db, tx, built, id("actor"), id("key"))),
    (err) => err.code === "invalid-argument",
  );
  assert.equal((await db.collection("sales_orders").where("accountId", "==", accountId).get()).size, 0);
});

test("sourceOpportunityId pointing at a LOST Opportunity is rejected -- no Sales Order created", async () => {
  const accountId = id("account");
  const oppId = await opp({ accountId, outcome: "LOST" });
  const built = builtFor(accountId, oppId);
  await assert.rejects(
    () => db.runTransaction((tx) => persistCreatedSalesOrder(db, tx, built, id("actor"), id("key"))),
    (err) => err.code === "failed-precondition",
  );
  assert.equal((await db.collection("sales_orders").where("accountId", "==", accountId).get()).size, 0);
});

test("sourceOpportunityId pointing at a WON Opportunity for a DIFFERENT account is rejected -- no Sales Order created", async () => {
  const accountId = id("account");
  const otherAccountId = id("other-account");
  const oppId = await opp({ accountId: otherAccountId, outcome: "WON" });
  const built = builtFor(accountId, oppId);
  await assert.rejects(
    () => db.runTransaction((tx) => persistCreatedSalesOrder(db, tx, built, id("actor"), id("key"))),
    (err) => err.code === "failed-precondition",
  );
  assert.equal((await db.collection("sales_orders").where("accountId", "==", accountId).get()).size, 0);
});

test("sourceOpportunityId pointing at a matching WON Opportunity creates the Sales Order and atomically sets opp.salesOrderId", async () => {
  const accountId = id("account");
  const oppId = await opp({ accountId, outcome: "WON" });
  const built = builtFor(accountId, oppId);
  const created = await db.runTransaction((tx) => persistCreatedSalesOrder(db, tx, built, id("actor"), id("key")));
  assert.equal(created.replayed, false);
  const oppAfter = await db.collection("opportunities").doc(oppId).get();
  assert.equal(oppAfter.data().salesOrderId, created.salesOrderId);
});

test("a second Sales Order against an Opportunity that already has one is rejected (dedup)", async () => {
  const accountId = id("account");
  const oppId = await opp({ accountId, outcome: "WON" });
  const first = builtFor(accountId, oppId);
  const firstCreated = await db.runTransaction((tx) => persistCreatedSalesOrder(db, tx, first, id("actor"), id("key")));
  assert.equal(firstCreated.replayed, false);

  const second = builtFor(accountId, oppId);
  await assert.rejects(
    () => db.runTransaction((tx) => persistCreatedSalesOrder(db, tx, second, id("actor"), id("key"))),
    (err) => err.code === "failed-precondition",
  );
  assert.equal((await db.collection("sales_orders").where("sourceOpportunityId", "==", oppId).get()).size, 1);
  const oppAfter = await db.collection("opportunities").doc(oppId).get();
  assert.equal(oppAfter.data().salesOrderId, firstCreated.salesOrderId, "the back-link still points at the FIRST Sales Order");
});

test("createSalesOrder with NO sourceOpportunityId is unaffected -- succeeds without touching opportunities", async () => {
  const accountId = id("account");
  const built = buildCreateSalesOrder(
    { accountId, ownerEmployeeId: id("owner"), salesChannel: "RETAIL", lines: [{ kind: "PART", ref: "part-1", orderedQty: 1 }] },
    { actorUid: id("actor"), nowMillis: Date.now() },
  );
  const created = await db.runTransaction((tx) => persistCreatedSalesOrder(db, tx, built, id("actor"), id("key")));
  assert.equal(created.replayed, false);
  const soDoc = await db.collection("sales_orders").doc(created.salesOrderId).get();
  assert.equal(soDoc.data().sourceOpportunityId, null);
  // currency round-trips onto the persisted header via the `...fields` spread (no callable change needed),
  // so the created order is invoiceable — a written doc with currency:undefined would fail-close at issueInvoice.
  assert.equal(soDoc.data().currency, "USD", "currency must reach the persisted Sales Order header");
});

test("a retried create against a WON Opportunity replays -- does NOT re-verify or re-link a second time", async () => {
  const accountId = id("account");
  const oppId = await opp({ accountId, outcome: "WON" });
  const actorUid = id("actor");
  const key = id("key");
  const built = builtFor(accountId, oppId);

  const first = await db.runTransaction((tx) => persistCreatedSalesOrder(db, tx, built, actorUid, key));
  assert.equal(first.replayed, false);

  const retry = await db.runTransaction((tx) => persistCreatedSalesOrder(db, tx, built, actorUid, key));
  assert.equal(retry.replayed, true, "retry with the same idempotencyKey is a replay");
  assert.equal(retry.salesOrderId, first.salesOrderId);

  assert.equal((await db.collection("sales_orders").where("sourceOpportunityId", "==", oppId).get()).size, 1);
  const oppAfter = await db.collection("opportunities").doc(oppId).get();
  assert.equal(oppAfter.data().salesOrderId, first.salesOrderId);
});

test("source Opportunity cannot lend lineage to divergent Sales Order lines", async () => {
  const accountId = id("account");
  const oppId = await opp({ accountId, outcome: "WON" });
  const divergent = buildCreateSalesOrder(
    { accountId, ownerEmployeeId: id("owner"), salesChannel: "RETAIL", sourceOpportunityId: oppId, lines: [{ kind: "PART", ref: "unrelated-part", orderedQty: 1 }] },
    { actorUid: id("actor"), nowMillis: Date.now() },
  );
  await assert.rejects(
    () => db.runTransaction((tx) => persistCreatedSalesOrder(db, tx, divergent, id("actor"), id("key"))),
    (err) => err.code === "failed-precondition",
  );
});
