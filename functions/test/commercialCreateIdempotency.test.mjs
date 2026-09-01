// Firestore-emulator coverage for commercial create replay.  These persistence helpers sit below the
// capability gate, so the test proves the transaction invariant without activating dormant capabilities.
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";

import assert from "node:assert/strict";
import { test } from "node:test";
import admin from "firebase-admin";
import { buildCreateOpportunity } from "../lib/opportunity/opportunityCommands.js";
import { persistCreatedOpportunity } from "../lib/opportunity/opportunityCallables.js";
import { buildCreateSalesOrder } from "../lib/salesOrder/salesOrderCommands.js";
import { persistCreatedSalesOrder } from "../lib/salesOrder/salesOrderCallables.js";

admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();
let sequence = 0;
const id = (kind) => `${kind}-${Date.now()}-${++sequence}`;

test("opportunity create replays one idempotency key and creates again for a new key", async () => {
  const actorUid = id("actor");
  const built = buildCreateOpportunity({ accountId: id("account"), ownerEmployeeId: id("owner"), salesChannel: "RETAIL" }, { actorUid, nowMillis: Date.now() });
  const first = await db.runTransaction((tx) => persistCreatedOpportunity(db, tx, built, actorUid, "first"));
  const retry = await db.runTransaction((tx) => persistCreatedOpportunity(db, tx, built, actorUid, "first"));
  const next = await db.runTransaction((tx) => persistCreatedOpportunity(db, tx, built, actorUid, "second"));
  assert.equal(retry.replayed, true);
  assert.equal(retry.opportunityId, first.opportunityId);
  assert.notEqual(next.opportunityId, first.opportunityId);
  assert.equal((await db.collection("opportunities").where("accountId", "==", built.accountId).get()).size, 2);
});

test("sales order create replays one idempotency key and creates again for a new key", async () => {
  const actorUid = id("actor");
  const built = buildCreateSalesOrder({ accountId: id("account"), ownerEmployeeId: id("owner"), operatingCompanyId: "taylor", salesChannel: "RETAIL", lines: [{ kind: "PART", ref: "part-1", orderedQty: 1, unitPrice: 2500 }] }, { actorUid, nowMillis: Date.now() });
  const first = await db.runTransaction((tx) => persistCreatedSalesOrder(db, tx, built, actorUid, "first"));
  const retry = await db.runTransaction((tx) => persistCreatedSalesOrder(db, tx, built, actorUid, "first"));
  const next = await db.runTransaction((tx) => persistCreatedSalesOrder(db, tx, built, actorUid, "second"));
  assert.equal(retry.replayed, true);
  assert.equal(retry.salesOrderId, first.salesOrderId);
  assert.notEqual(next.salesOrderId, first.salesOrderId);
  assert.equal((await db.collection("sales_orders").where("accountId", "==", built.accountId).get()).size, 2);
});
