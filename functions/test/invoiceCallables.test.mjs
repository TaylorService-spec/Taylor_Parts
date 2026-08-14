// Finance — issueInvoice onCall adapter gate tests (site-work r3 H). Convention: coverageCallables.test.mjs
// (invoke the compiled v2 onCall via `.run(request)` against the Firestore emulator).
//
// finance.invoice.issue is registered `active:false` in permissionCatalog.ts — per
// resolveEffectivePermission.ts's "a REGISTERED capability whose `active` flag is explicitly `false` denies
// unconditionally, ahead of and regardless of any Role grant" contract, this is a hard DENY for EVERY
// principal (including a full-privilege admin) until a separate, later Owner grant activates it. That means
// the callable boundary is the only reachable surface today: the transaction body (idempotency replay,
// per-issuance validation, mapCommandError translation) is unreachable code from any external caller while
// the capability stays inactive — it cannot be exercised through issueInvoice.run() without weakening the
// fail-closed gate, which is out of scope for a test-only change (activating a Finance capability is an
// Owner-grant / protected-boundary decision, not a test concern).
// The pure invoice-issuance logic that WOULD run past that gate (amount recomputation, NOT_BILLABLE /
// TAX_REQUIRES_REVIEW / UNPRICED error codes that mapCommandError translates) is already covered directly
// against the command core in invoiceCommands.test.mjs.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";

import assert from "node:assert/strict";
import admin from "firebase-admin";

admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();
const { issueInvoice, FINANCE_INVOICE_ISSUE_CAPABILITY } = await import("../lib/finance/invoiceCallables.js");

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

console.log("invoiceCallables.test.mjs");
console.log(`capability under test: ${FINANCE_INVOICE_ISSUE_CAPABILITY}`);

const admin1 = await seedActor("admin"); // broadest governed role available
const noRole = await seedActor(null);

const baseData = () => ({
  idempotencyKey: key("issue"),
  companyId: "taylor",
  accountId: "ACCT-1",
  salesOrderId: "SO-1",
  currency: "USD",
  dueDate: 1_800_000_000_000,
  billingAction: "BILL_NOW",
  lines: [{ ref: "L1", billableQty: 1, unitPriceMinor: 1000, taxMinor: 80 }],
});

await check("unauthenticated -> unauthenticated (auth checked before any capability/read)", async () => {
  await assertHttps(issueInvoice.run(req(baseData(), undefined)), "unauthenticated");
});

await check("no-role actor -> permission-denied (fail-closed, no grant)", async () => {
  await assertHttps(issueInvoice.run(req(baseData(), noRole)), "permission-denied");
});

await check(
  "admin (broadest governed role) -> STILL permission-denied: finance.invoice.issue is registered active:false, a hard DENY ahead of any Role grant",
  async () => {
    await assertHttps(issueInvoice.run(req(baseData(), admin1)), "permission-denied");
  },
);

await check("gate denies before any persistence: no invoice document is ever written for a denied attempt", async () => {
  const data = baseData();
  await assertHttps(issueInvoice.run(req(data, admin1)), "permission-denied");
  const bySalesOrder = await db.collection("invoices").where("salesOrderId", "==", data.salesOrderId).get();
  assert.equal(bySalesOrder.empty, true);
});

await check("gate denies identically regardless of idempotencyKey (two distinct keys, same actor, same denial)", async () => {
  const a = baseData();
  const b = baseData();
  assert.notEqual(a.idempotencyKey, b.idempotencyKey);
  await assertHttps(issueInvoice.run(req(a, admin1)), "permission-denied");
  await assertHttps(issueInvoice.run(req(b, admin1)), "permission-denied");
});

console.log(`\ninvoiceCallables: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
