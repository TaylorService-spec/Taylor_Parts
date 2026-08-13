// Commercial coverage onCall adapter gate. These capabilities are intentionally
// inactive, so this verifies the callable boundary fails closed before any
// persistence read/write; pure command/resolution behavior is covered separately.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";

import assert from "node:assert/strict";
import admin from "firebase-admin";

admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();
const writes = await import("../lib/coverage/coverageCallables.js");
const reads = await import("../lib/coverage/coverageReadCallables.js");

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

const uid = `coverage-callable-${Date.now()}`;
await db.collection("users").doc(uid).set({ accessVersion: 1 });
await db.collection("roleAssignments").doc(`coverage-callable-role-${Date.now()}`).set({
  principalUid: uid,
  roleId: "admin",
  scope: { type: "global" },
  grantedBy: "test",
  grantedAt: admin.firestore.Timestamp.now(),
  status: "active",
  accessVersionAtGrant: 1,
});

await check("write callables reject unauthenticated callers", async () => {
  await expectHttps(writes.createSalesTerritory.run(request({ idempotencyKey: "k", name: "AZ", kind: "STATE", geo: { states: ["AZ"] } })), "unauthenticated");
  await expectHttps(writes.createCoverageAssignment.run(request({ idempotencyKey: "k" })), "unauthenticated");
});

await check("read callable rejects unauthenticated callers", async () => {
  await expectHttps(reads.resolveCoverageForContext.run(request({ companyId: "co" })), "unauthenticated");
});

await check("active admin is fail-closed while coverage capabilities remain inactive", async () => {
  await expectHttps(writes.createSalesTerritory.run(request({ idempotencyKey: "write-denied", name: "AZ", kind: "STATE", geo: { states: ["AZ"] } }, uid)), "permission-denied");
  await expectHttps(reads.resolveCoverageForContext.run(request({ companyId: "co" }, uid)), "permission-denied");
  assert.equal((await db.collection("sales_territories").where("createdBy", "==", uid).get()).empty, true);
});

console.log(`\n${passed} coverage callable gate checks passed`);
