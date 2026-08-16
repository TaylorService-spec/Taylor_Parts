// CRM Activity / Notes — Firestore-emulator coverage for the trusted create command. Requires the
// Firestore emulator (127.0.0.1:8080). Prerequisite: npm run build; emulator running.
//
// crm.activity.create is registered active:false and granted to NO Role -- the same posture
// salesOrder.write/opportunity.write have. persistCreatedCrmActivity sits BELOW the capability gate
// (mirrors commercialCreateIdempotency.test.mjs's own header comment) precisely so the write +
// idempotency-replay + audit-atomicity invariants are provable without activating a dormant capability.
// The capability gate ITSELF (unauthenticated / unauthorized-while-inactive) is covered separately, below,
// via the onCall adapter's own .run() harness (mirrors financeReadCallables.test.mjs).
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";

import assert from "node:assert/strict";
import { test } from "node:test";
import admin from "firebase-admin";
import { buildCreateCrmActivity, CrmActivityCommandError } from "../lib/crmActivity/crmActivityCommands.js";
import { createCrmActivity, persistCreatedCrmActivity } from "../lib/crmActivity/crmActivityCallables.js";

admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();
let sequence = 0;
const id = (kind) => `${kind}-${Date.now()}-${++sequence}`;
const request = (data, uid) => ({ data, auth: uid ? { uid, token: {} } : undefined });
async function expectHttps(promise, code) {
  await assert.rejects(promise, (error) => error?.code === code);
}

// ---- A. Capability gate (onCall adapter) ----
test("createCrmActivity rejects an unauthenticated caller", async () => {
  await expectHttps(createCrmActivity.run(request({ accountId: "ACCT-1", type: "GENERAL", body: "x", idempotencyKey: id("k") })), "unauthenticated");
});

test("createCrmActivity denies EVERY caller while crm.activity.create stays registered active:false (fail-closed)", async () => {
  const uid = id("actor");
  await db.collection("users").doc(uid).set({ accessVersion: 1 });
  await db.collection("roleAssignments").doc(id("assignment")).set({
    principalUid: uid, roleId: "admin", scope: { type: "global" },
    grantedBy: "test-fixture", grantedAt: admin.firestore.Timestamp.now(),
    status: "active", accessVersionAtGrant: 1,
  });
  await expectHttps(
    createCrmActivity.run(request({ accountId: "ACCT-1", type: "GENERAL", body: "x", idempotencyKey: id("k") }, uid)),
    "permission-denied",
  );
  // Nothing written -- a denied call must never leave a partial mutation.
  const written = await db.collection("crm_activities").where("accountId", "==", "ACCT-1").get();
  assert.equal(written.docs.filter((d) => d.data().createdByUid === uid).length, 0);
});

// ---- B. Transactional core (below the capability gate) ----
function built(over = {}) {
  return buildCreateCrmActivity(
    { accountId: id("account"), type: "SALES_NOTE", body: "Discussed pricing.", ...over },
    { actorUid: id("actor"), nowMillis: Date.now() },
  );
}

test("authorized create: writes the doc + stages ONE audit event in the same transaction", async () => {
  const b = built();
  const actorUid = b.createdByUid;
  const key = id("key");
  const result = await db.runTransaction((tx) => persistCreatedCrmActivity(db, tx, b, actorUid, key));
  assert.equal(result.success, true);
  assert.equal(result.replayed, false);
  assert.ok(result.activityId);

  const snap = await db.collection("crm_activities").doc(result.activityId).get();
  assert.equal(snap.exists, true);
  assert.equal(snap.data().accountId, b.accountId);
  assert.equal(snap.data().type, "SALES_NOTE");
  assert.equal(snap.data().body, "Discussed pricing.");
  assert.equal(snap.data().createdByUid, actorUid);
  assert.ok(snap.data().createdAt); // server timestamp
  assert.equal(snap.data().occurredAtMillis, b.occurredAtMillis);
  // no assignee/due-date/status field written -- the PART 1.5 seam, proved at the persistence layer too
  for (const forbidden of ["assigneeUid", "dueDate", "status", "completedAt"]) {
    assert.equal(forbidden in snap.data(), false);
  }

  const audits = await db.collection("auditEvents").where("targetId", "==", result.activityId).get();
  assert.equal(audits.size, 1);
  assert.equal(audits.docs[0].data().action, "createCrmActivity");
  assert.equal(audits.docs[0].data().actorUid, actorUid);
  assert.equal(audits.docs[0].data().outcome, "applied");
});

test("idempotent replay: retrying the SAME key creates no duplicate write or audit event", async () => {
  const b = built();
  const actorUid = b.createdByUid;
  const key = id("key");
  const first = await db.runTransaction((tx) => persistCreatedCrmActivity(db, tx, b, actorUid, key));
  const retry = await db.runTransaction((tx) => persistCreatedCrmActivity(db, tx, b, actorUid, key));
  assert.equal(retry.replayed, true);
  assert.equal(retry.activityId, first.activityId);

  const docs = await db.collection("crm_activities").where("accountId", "==", b.accountId).get();
  assert.equal(docs.size, 1);
  const audits = await db.collection("auditEvents").where("targetId", "==", first.activityId).get();
  assert.equal(audits.size, 1);
});

test("a NEW idempotency key for the same actor creates a genuinely new activity (not a replay)", async () => {
  const b = built();
  const actorUid = b.createdByUid;
  const first = await db.runTransaction((tx) => persistCreatedCrmActivity(db, tx, b, actorUid, id("key")));
  const second = await db.runTransaction((tx) => persistCreatedCrmActivity(db, tx, b, actorUid, id("key")));
  assert.equal(second.replayed, false);
  assert.notEqual(second.activityId, first.activityId);
  const docs = await db.collection("crm_activities").where("accountId", "==", b.accountId).get();
  assert.equal(docs.size, 2);
});

// ---- C. Malformed input rejected before any write (buildCreateCrmActivity, exercised end-to-end) ----
test("malformed input (missing accountId) is rejected -- nothing written", async () => {
  assert.throws(
    () => buildCreateCrmActivity({ type: "GENERAL", body: "x" }, { actorUid: id("actor"), nowMillis: Date.now() }),
    CrmActivityCommandError,
  );
});

test("malformed input (invalid type) is rejected -- nothing written", async () => {
  const accountId = id("account");
  assert.throws(
    () => buildCreateCrmActivity({ accountId, type: "FOLLOW_UP", body: "x" }, { actorUid: id("actor"), nowMillis: Date.now() }),
    CrmActivityCommandError,
  );
  const docs = await db.collection("crm_activities").where("accountId", "==", accountId).get();
  assert.equal(docs.size, 0);
});

// ---- D. Optional relations accepted / omitted correctly ----
test("optional relations (contact/opportunity/salesOrder) are persisted verbatim when supplied", async () => {
  const b = built({ contactId: "CONTACT-9", opportunityId: "OPP-9", salesOrderId: "SO-9" });
  const result = await db.runTransaction((tx) => persistCreatedCrmActivity(db, tx, b, b.createdByUid, id("key")));
  const snap = await db.collection("crm_activities").doc(result.activityId).get();
  assert.equal(snap.data().contactId, "CONTACT-9");
  assert.equal(snap.data().opportunityId, "OPP-9");
  assert.equal(snap.data().salesOrderId, "SO-9");
});

test("optional relations are persisted as null (not omitted, not empty string) when NOT supplied", async () => {
  const b = built();
  const result = await db.runTransaction((tx) => persistCreatedCrmActivity(db, tx, b, b.createdByUid, id("key")));
  const snap = await db.collection("crm_activities").doc(result.activityId).get();
  assert.equal(snap.data().contactId, null);
  assert.equal(snap.data().opportunityId, null);
  assert.equal(snap.data().salesOrderId, null);
});
