// Finance AR trusted-read callable -- emulator tests. Requires the Firestore emulator (127.0.0.1:8080).
// Prerequisite: npm run build; emulator running.
//
// Covers two things:
//   1. The onCall adapter's fail-closed callable boundary (unauthenticated / finance.read still active:false).
//   2. The bounded-read honesty fix (site-work r3 item I): readAccountInvoiceAr (the core read, factored out of
//      the onCall wrapper precisely so it is testable without a live finance.read grant) must report "ready"
//      only for a COMPLETE page, and the honest non-complete "unavailable" -- NEVER a "ready" partial summary
//      -- once the account's real invoice count exceeds the requested `limit`. Mirrors the already-shipped
//      coverageReadCallables.ts / resolveCoverageForContext bounded-read precedent (PR #905): fetch limit+1,
//      and if the extra row is present, the page is a truncation, not a complete result.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";

import assert from "node:assert/strict";
import admin from "firebase-admin";

admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();
const reads = await import("../lib/finance/financeReadCallables.js");

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

// FIN-004: the core read now REQUIRES a visibility predicate. These cases measure the bounded-read
// honesty contract, not scoping (financeVisibilityRead.test.mjs owns that), so they read with an
// explicit CONSOLIDATED authority — the widest reach, granted expressly, exactly as a real
// consolidated principal would.
const { buildFinancialVisibilityAuthority } = await import("../lib/finance/financialVisibility.js");
const CONSOLIDATED_VIEW = buildFinancialVisibilityAuthority({
  factFamilyAllowed: true,
  grants: [{ scope: "CONSOLIDATED" }],
}).isInvoiceVisible;
const uid = `finance-callable-${runId}`;
await db.collection("users").doc(uid).set({ accessVersion: 1 });
await db.collection("roleAssignments").doc(`finance-callable-role-${runId}`).set({
  principalUid: uid,
  roleId: "admin",
  scope: { type: "global" },
  grantedBy: "test",
  grantedAt: admin.firestore.Timestamp.now(),
  status: "active",
  accessVersionAtGrant: 1,
});

await check("callable rejects unauthenticated callers", async () => {
  await expectHttps(reads.listAccountInvoiceAr.run(request({ accountId: "acct-1" })), "unauthenticated");
});

await check("active admin is fail-closed while finance.read remains inactive (registered active:false)", async () => {
  await expectHttps(reads.listAccountInvoiceAr.run(request({ accountId: "acct-1" }, uid)), "permission-denied");
});

function invoice(accountId, over = {}) {
  return {
    accountId,
    invoiceNumber: "INV-1",
    currency: "USD",
    state: "ISSUED",
    totalMinor: 10_000,
    appliedMinor: 0,
    creditsMinor: 0,
    chargesMinor: 0,
    writeOffMinor: 0,
    dueDate: Date.now() + 1000 * 60 * 60 * 24 * 30,
    ...over,
  };
}
async function seedInvoices(accountId, count) {
  const batch = db.batch();
  for (let i = 0; i < count; i += 1) {
    batch.set(db.collection("invoices").doc(`inv-${accountId}-${i}`), invoice(accountId));
  }
  await batch.commit();
}
async function clearInvoices(accountId) {
  const snap = await db.collection("invoices").where("accountId", "==", accountId).get();
  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}

await check("under the cap: status ready with a full summary over every invoice", async () => {
  const accountId = `acct-under-${runId}`;
  await clearInvoices(accountId);
  await seedInvoices(accountId, 3);
  const result = await reads.readAccountInvoiceAr(db, accountId, 5, CONSOLIDATED_VIEW);
  assert.equal(result.status, "ready");
  assert.equal(result.invoices.length, 3);
  assert.equal(result.summary.count, 3);
});

await check("exactly at the cap: status ready (no false-positive truncation)", async () => {
  const accountId = `acct-atcap-${runId}`;
  await clearInvoices(accountId);
  await seedInvoices(accountId, 5);
  const result = await reads.readAccountInvoiceAr(db, accountId, 5, CONSOLIDATED_VIEW);
  assert.equal(result.status, "ready");
  assert.equal(result.invoices.length, 5);
});

await check("over the cap: status unavailable -- NEVER a ready partial summary (pre-fix this returned 'ready' over a truncated page)", async () => {
  const accountId = `acct-over-${runId}`;
  await clearInvoices(accountId);
  await seedInvoices(accountId, 6);
  const result = await reads.readAccountInvoiceAr(db, accountId, 5, CONSOLIDATED_VIEW);
  assert.equal(result.status, "unavailable");
  assert.equal(result.invoices.length, 0);
  assert.equal(result.summary.count, 0);
});

// ── The REPORTING read seam shares this boundary. It resolves reach through the SAME canonical
// loader, so the same two facts must hold for it: no identity is unauthenticated, and an active
// admin with finance.read still inactive reaches nothing. Admin is not a bypass.
const reporting = await import("../lib/finance/financialReportingRead.js");

await check("reporting read rejects unauthenticated callers", async () => {
  await expectHttps(reporting.listFinancialFacts.run(request({})), "unauthenticated");
});

await check("reporting read denies an active admin while finance.read remains inactive (no admin bypass)", async () => {
  await expectHttps(reporting.listFinancialFacts.run(request({}, uid)), "permission-denied");
});

await check("reporting read denies a caller-supplied filter just the same — a filter is not a credential", async () => {
  await expectHttps(
    reporting.listFinancialFacts.run(request({ companyId: "taylor", creditedSalespersonId: "cw-emp-034" }, uid)),
    "permission-denied",
  );
});

console.log(`\n${passed} finance AR read callable checks passed`);
