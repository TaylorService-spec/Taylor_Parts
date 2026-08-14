// Firestore-emulator coverage for commercial TRANSITION replay (site-work r3 item G). Same shape as
// commercialCreateIdempotency.test.mjs's create-side guard: these persistence helpers sit below the capability
// gate (opportunity.write / salesOrder.write are registered active:false), so the test proves the transaction
// invariant without activating dormant capabilities.
//
// Prerequisite (same harness as the sibling create-idempotency test):
//   firebase emulators:start --only firestore --project taylor-parts
//   (after `npm run build`) node --test test/commercialTransitionIdempotency.test.mjs
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";

import assert from "node:assert/strict";
import { test } from "node:test";
import admin from "firebase-admin";
import { buildCreateOpportunity } from "../lib/opportunity/opportunityCommands.js";
import { persistCreatedOpportunity, persistTransitionedOpportunity } from "../lib/opportunity/opportunityCallables.js";
import { buildCreateSalesOrder } from "../lib/salesOrder/salesOrderCommands.js";
import { persistCreatedSalesOrder, persistTransitionedSalesOrder } from "../lib/salesOrder/salesOrderCallables.js";

admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();
let sequence = 0;
const id = (kind) => `${kind}-${Date.now()}-${++sequence}`;

test("a retried ADVANCE on an Opportunity does NOT skip a stage -- replay returns the prior result", async () => {
  const actorUid = id("actor");
  const built = buildCreateOpportunity(
    { accountId: id("account"), ownerEmployeeId: id("owner"), salesChannel: "RETAIL" },
    { actorUid, nowMillis: Date.now() },
  );
  const created = await db.runTransaction((tx) => persistCreatedOpportunity(db, tx, built, actorUid, id("create-key")));
  const ref = db.collection("opportunities").doc(created.opportunityId);
  assert.equal((await ref.get()).data().stage, "IDENTIFIED");

  const key = id("transition-key");
  const intent = { kind: "ADVANCE", toStage: "QUALIFYING" };

  const first = await db.runTransaction((tx) =>
    persistTransitionedOpportunity(db, tx, ref, created.opportunityId, intent, actorUid, key),
  );
  assert.equal(first.replayed, false);
  assert.equal(first.stage, "QUALIFYING");

  // Retry with the SAME idempotencyKey (client timeout retry / double-tap): must NOT advance a second time.
  const retry = await db.runTransaction((tx) =>
    persistTransitionedOpportunity(db, tx, ref, created.opportunityId, intent, actorUid, key),
  );
  assert.equal(retry.replayed, true, "retry with same key is a replay");
  assert.equal(retry.stage, "QUALIFYING", "replay reports the SAME stage -- it did not skip ahead to SOLUTION");

  const afterRetry = await ref.get();
  assert.equal(afterRetry.data().stage, "QUALIFYING", "the persisted document only advanced ONCE");

  // A DIFFERENT idempotencyKey performs a genuinely new, distinct advance.
  const next = await db.runTransaction((tx) =>
    persistTransitionedOpportunity(db, tx, ref, created.opportunityId, { kind: "ADVANCE", toStage: "SOLUTION" }, actorUid, id("transition-key-2")),
  );
  assert.equal(next.replayed, false);
  assert.equal(next.stage, "SOLUTION");
});

test("a retried ADVANCE on a Sales Order does NOT skip a state -- replay returns the prior result", async () => {
  const actorUid = id("actor");
  const built = buildCreateSalesOrder(
    { accountId: id("account"), ownerEmployeeId: id("owner"), salesChannel: "RETAIL", lines: [{ kind: "PART", ref: "part-1", orderedQty: 1 }] },
    { actorUid, nowMillis: Date.now() },
  );
  const created = await db.runTransaction((tx) => persistCreatedSalesOrder(db, tx, built, actorUid, id("create-key")));
  const ref = db.collection("sales_orders").doc(created.salesOrderId);
  assert.equal((await ref.get()).data().state, "CONFIRMED");

  const key = id("transition-key");
  const first = await db.runTransaction((tx) =>
    persistTransitionedSalesOrder(db, tx, ref, created.salesOrderId, "ADVANCE", actorUid, key),
  );
  assert.equal(first.replayed, false);
  assert.equal(first.state, "IN_FULFILLMENT");

  // Retry with the SAME idempotencyKey: must NOT advance a second time (would otherwise skip toward FULFILLED).
  const retry = await db.runTransaction((tx) =>
    persistTransitionedSalesOrder(db, tx, ref, created.salesOrderId, "ADVANCE", actorUid, key),
  );
  assert.equal(retry.replayed, true, "retry with same key is a replay");
  assert.equal(retry.state, "IN_FULFILLMENT", "replay reports the SAME state -- it did not skip ahead");

  const afterRetry = await ref.get();
  assert.equal(afterRetry.data().state, "IN_FULFILLMENT", "the persisted document only advanced ONCE");
});
