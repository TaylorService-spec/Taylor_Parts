// CRM Activity / Notes trusted-read callable -- emulator tests. Requires the Firestore emulator
// (127.0.0.1:8080). Prerequisite: npm run build; emulator running. Mirrors financeReadCallables.test.mjs
// exactly: the onCall adapter's fail-closed capability boundary, plus the bounded-read-honesty invariant
// (a truncated page must report "unavailable", never a partial "ready" list).
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";

import assert from "node:assert/strict";
import admin from "firebase-admin";

admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();
const reads = await import("../lib/crmActivity/crmActivityReadService.js");

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

const runId = Date.now();
const uid = `crm-activity-callable-${runId}`;
await db.collection("users").doc(uid).set({ accessVersion: 1 });
await db.collection("roleAssignments").doc(`crm-activity-callable-role-${runId}`).set({
  principalUid: uid,
  roleId: "admin",
  scope: { type: "global" },
  grantedBy: "test",
  grantedAt: admin.firestore.Timestamp.now(),
  status: "active",
  accessVersionAtGrant: 1,
});

await check("callable rejects unauthenticated callers", async () => {
  await expectHttps(reads.getCrmActivities.run(request({ accountId: "acct-1" })), "unauthenticated");
});

await check("active admin is fail-closed while crm.activity.read remains inactive (registered active:false)", async () => {
  await expectHttps(reads.getCrmActivities.run(request({ accountId: "acct-1" }, uid)), "permission-denied");
});

await check("callable rejects a missing accountId", async () => {
  await expectHttps(reads.getCrmActivities.run(request({}, uid)), "permission-denied"); // capability gate fires first, fail-closed
});

function activity(accountId, over = {}) {
  return {
    accountId,
    contactId: null,
    opportunityId: null,
    salesOrderId: null,
    type: "GENERAL",
    body: "note",
    occurredAtMillis: Date.now(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdByUid: "seed-actor",
    ...over,
  };
}
async function seedActivities(accountId, count) {
  const batch = db.batch();
  for (let i = 0; i < count; i += 1) {
    batch.set(db.collection("crm_activities").doc(), activity(accountId, { occurredAtMillis: Date.now() - i }));
  }
  await batch.commit();
}
async function clearActivities(accountId) {
  const snap = await db.collection("crm_activities").where("accountId", "==", accountId).get();
  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}

await check("under the cap: status ready with every activity for the account", async () => {
  const accountId = `acct-under-${runId}`;
  await clearActivities(accountId);
  await seedActivities(accountId, 3);
  const result = await reads.readAccountCrmActivities(db, accountId, 5);
  assert.equal(result.status, "ready");
  assert.equal(result.activities.length, 3);
});

await check("exactly at the cap: status ready (no false-positive truncation)", async () => {
  const accountId = `acct-atcap-${runId}`;
  await clearActivities(accountId);
  await seedActivities(accountId, 5);
  const result = await reads.readAccountCrmActivities(db, accountId, 5);
  assert.equal(result.status, "ready");
  assert.equal(result.activities.length, 5);
});

await check("over the cap: status unavailable -- NEVER a ready partial list", async () => {
  const accountId = `acct-over-${runId}`;
  await clearActivities(accountId);
  await seedActivities(accountId, 6);
  const result = await reads.readAccountCrmActivities(db, accountId, 5);
  assert.equal(result.status, "unavailable");
  assert.equal(result.activities.length, 0);
});

await check("an account with no activities reads ready + empty list -- honest empty, not unavailable", async () => {
  const accountId = `acct-empty-${runId}`;
  await clearActivities(accountId);
  const result = await reads.readAccountCrmActivities(db, accountId, 5);
  assert.equal(result.status, "ready");
  assert.deepEqual(result.activities, []);
});

await check("activities sort most-recent-occurredAt-first", async () => {
  const accountId = `acct-sort-${runId}`;
  await clearActivities(accountId);
  const now = Date.now();
  await db.collection("crm_activities").add(activity(accountId, { occurredAtMillis: now - 5000, body: "older" }));
  await db.collection("crm_activities").add(activity(accountId, { occurredAtMillis: now, body: "newest" }));
  await db.collection("crm_activities").add(activity(accountId, { occurredAtMillis: now - 1000, body: "middle" }));
  const result = await reads.readAccountCrmActivities(db, accountId, 10);
  assert.equal(result.status, "ready");
  assert.deepEqual(result.activities.map((a) => a.body), ["newest", "middle", "older"]);
});

console.log(`\n${passed} CRM Activity read callable checks passed`);
