// Finance — recordRefund onCall adapter gate tests (site-work r3 H). Convention: coverageCallables.test.mjs
// (invoke the compiled v2 onCall via `.run(request)` against the Firestore emulator).
//
// finance.refund.record is registered `active:false` in permissionCatalog.ts — per
// resolveEffectivePermission.ts's "a REGISTERED capability whose `active` flag is explicitly `false` denies
// unconditionally, ahead of and regardless of any Role grant" contract, this is a hard DENY for EVERY
// principal (including a full-privilege admin) until a separate, later Owner grant activates it. That means
// the callable boundary is the only reachable surface today: the transaction body (idempotency replay,
// invoiceId lookup, mapCommandError translation) is unreachable code from any external caller while the
// capability stays inactive — it cannot be exercised through recordRefund.run() without weakening the
// fail-closed gate, which is out of scope for a test-only change (activating a Finance capability is an
// Owner-grant / protected-boundary decision, not a test concern).
// The pure refund logic that WOULD run past that gate (applied-payment reversal, invoice-state re-derivation,
// INVOICE_VOID/EXCEEDS_APPLIED/CURRENCY_MISMATCH error codes that mapCommandError translates) is already
// covered directly against the command core in refundCommands.test.mjs.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";

import assert from "node:assert/strict";
import admin from "firebase-admin";

admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();
const { recordRefund, FINANCE_REFUND_RECORD_CAPABILITY } = await import("../lib/finance/refundCallables.js");

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS: ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL: ${name}`); console.error(err); }
}
const now = Date.now();
let seq = 0;
const uid = (p) => `${p}-${now}-${(seq += 1)}`;
const key = (p) => `${p}-key-${now}-${(seq += 1)}`;
const req = (data, authUid) => ({ data, auth: authUid !== undefined ? { uid: authUid, token: {} } : undefined });

async function seedActor(roleId) {
  const u = uid("actor");
  await db.collection("users").doc(u).set({ accessVersion: 1 });
  if (roleId) {
    const id = uid("asg");
    await db.collection("roleAssignments").doc(id).set({
      id, principalUid: u, roleId, scope: { type: "global" },
      grantedBy: "t", grantedAt: admin.firestore.Timestamp.now(), status: "active", accessVersionAtGrant: 1,
    });
  }
  return u;
}
async function assertHttps(promise, expectedCode) {
  try { await promise; assert.fail(`expected HttpsError "${expectedCode}", none thrown`); }
  catch (err) { assert.equal(err.code, expectedCode, `expected "${expectedCode}", got "${err.code}": ${err.message}`); }
}

console.log("refundCallables.test.mjs");
console.log(`capability under test: ${FINANCE_REFUND_RECORD_CAPABILITY}`);

const admin1 = await seedActor("admin");
const noRole = await seedActor(null);

const baseData = () => ({
  idempotencyKey: key("refund"),
  invoiceId: "INV-DOES-NOT-MATTER-GATE-DENIES-FIRST",
  companyId: "taylor",
  accountId: "ACCT-1",
  currency: "USD",
  amountMinor: 150,
  reason: "test refund",
  effectiveDate: "2026-08-13",
});

await check("unauthenticated -> unauthenticated (auth checked before any capability/read)", async () => {
  await assertHttps(recordRefund.run(req(baseData(), undefined)), "unauthenticated");
});

await check("no-role actor -> permission-denied (fail-closed, no grant)", async () => {
  await assertHttps(recordRefund.run(req(baseData(), noRole)), "permission-denied");
});

await check(
  "admin (broadest governed role) -> STILL permission-denied: finance.refund.record is registered active:false, a hard DENY ahead of any Role grant",
  async () => {
    await assertHttps(recordRefund.run(req(baseData(), admin1)), "permission-denied");
  },
);

await check("gate denies before any persistence: no refund document is ever written for a denied attempt", async () => {
  const data = baseData();
  await assertHttps(recordRefund.run(req(data, admin1)), "permission-denied");
  const refunds = await db.collection("refunds").where("invoiceId", "==", data.invoiceId).get();
  assert.equal(refunds.empty, true);
});

await check("gate denies identically regardless of idempotencyKey (two distinct keys, same actor, same denial)", async () => {
  const a = baseData();
  const b = baseData();
  assert.notEqual(a.idempotencyKey, b.idempotencyKey);
  await assertHttps(recordRefund.run(req(a, admin1)), "permission-denied");
  await assertHttps(recordRefund.run(req(b, admin1)), "permission-denied");
});

console.log(`\nrefundCallables: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
