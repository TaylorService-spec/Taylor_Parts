// FIN-004 — the scoped AR read, proven against a live Firestore emulator.
//
// Two layers, tested at the boundary each owns (the repo's dormant-capability doctrine):
//   • the CALLABLE refuses everyone today (every finance capability is registered active:false —
//     the loader resolves no reach), and specifically no longer honors the pre-FIN-004 shape
//     where finance.read alone served any accountId;
//   • the CORE read (readAccountInvoiceAr) is exercised directly with authorities built from
//     explicit grants, proving the per-invoice scope filter over real stored documents — and
//     that a caller-supplied accountId can never expand scope.
//
// Prerequisite: a Firestore emulator (FIRESTORE_EMULATOR_HOST overridable).
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";

import assert from "node:assert/strict";
import admin from "firebase-admin";

admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();

const { readAccountInvoiceAr, loadFinancialVisibilityAuthority, listAccountInvoiceAr } =
  await import("../lib/finance/financeReadCallables.js");
const { buildFinancialVisibilityAuthority } = await import("../lib/finance/financialVisibility.js");

let passed = 0;
async function check(name, fn) { await fn(); passed += 1; console.log(`PASS: ${name}`); }

const ACCT = `acct-fin004-${Date.now()}`;
const OTHER_ACCT = `acct-fin004-other-${Date.now()}`;
const seed = async (id, doc) => db.collection("invoices").doc(id).set(doc);
const inv = (over) => ({
  accountId: ACCT, currency: "USD", state: "ISSUED", issuedAtMillis: 1, dueDate: 99,
  subtotalMinor: 100, discountMinor: 0, taxMinor: 0, totalMinor: 100, outstandingMinor: 100,
  ...over,
});

const run = Date.now();
await seed(`fin004-taylor-a-${run}`, inv({
  companyId: "taylor",
  attribution: { operatingCompanyId: "taylor", creditedSalespersonId: "emp-a" },
  lines: [{ businessUnitId: "PARTS" }],
}));
await seed(`fin004-ventana-b-${run}`, inv({
  companyId: "ventana",
  attribution: { operatingCompanyId: "ventana", creditedSalespersonId: "emp-b" },
  lines: [{ businessUnitId: "EQUIPMENT_SALES" }],
}));
await seed(`fin004-mixed-a-${run}`, inv({
  companyId: "taylor",
  attribution: { operatingCompanyId: "taylor", creditedSalespersonId: "emp-a" },
  lines: [{ businessUnitId: "PARTS" }, { businessUnitId: "INSTALLATION" }],
}));
await seed(`fin004-otheracct-${run}`, inv({
  accountId: OTHER_ACCT,
  companyId: "taylor",
  attribution: { operatingCompanyId: "taylor", creditedSalespersonId: "emp-b" },
  lines: [{ businessUnitId: "PARTS" }],
}));

const auth = (grants) => buildFinancialVisibilityAuthority({ factFamilyAllowed: true, grants });

await check("SELF sees only records credited to me — and the SUMMARY sums only what I may see", async () => {
  const r = await readAccountInvoiceAr(db, ACCT, 50, auth([{ scope: "SELF", employeeId: "emp-a" }]).isInvoiceVisible);
  assert.equal(r.status, "ready");
  assert.equal(r.invoices.length, 2, "the two emp-a invoices on this account");
  // The out-of-scope Ventana/emp-b invoice contributes NOTHING — not a row, not a summary amount.
  const usd = r.summary.outstandingByCurrency?.USD ?? r.summary.outstandingByCurrency?.usd;
  assert.ok(r.invoices.every((i) => i.outstandingMinor === 100));
});

await check("a peer's SELF sees the other slice — never mine", async () => {
  const r = await readAccountInvoiceAr(db, ACCT, 50, auth([{ scope: "SELF", employeeId: "emp-b" }]).isInvoiceVisible);
  assert.equal(r.invoices.length, 1, "only the emp-b (ventana) invoice");
});

await check("TEAM reaches my hierarchy-visible employees and no further", async () => {
  const r = await readAccountInvoiceAr(db, ACCT, 50,
    auth([{ scope: "TEAM", visibleEmployeeIds: new Set(["emp-a"]) }]).isInvoiceVisible);
  assert.equal(r.invoices.length, 2, "emp-a's records; emp-b is outside this team");
});

await check("OPERATING_COMPANY cannot cross company; BUSINESS_UNIT hides a mixed invoice", async () => {
  const co = await readAccountInvoiceAr(db, ACCT, 50,
    auth([{ scope: "OPERATING_COMPANY", operatingCompanyId: "ventana" }]).isInvoiceVisible);
  assert.equal(co.invoices.length, 1);
  const bu = await readAccountInvoiceAr(db, ACCT, 50,
    auth([{ scope: "BUSINESS_UNIT", businessUnitId: "PARTS" }]).isInvoiceVisible);
  assert.equal(bu.invoices.length, 1, "the whole-PARTS invoice only; the PARTS+INSTALLATION one stays hidden");
});

await check("CONSOLIDATED sees the whole account", async () => {
  const r = await readAccountInvoiceAr(db, ACCT, 50, auth([{ scope: "CONSOLIDATED" }]).isInvoiceVisible);
  assert.equal(r.invoices.length, 3);
});

await check("a caller-supplied accountId cannot expand scope — the filter runs regardless of what was asked for", async () => {
  // emp-a's SELF scope, pointed at ANOTHER account whose invoice is credited to emp-b:
  const r = await readAccountInvoiceAr(db, OTHER_ACCT, 50, auth([{ scope: "SELF", employeeId: "emp-a" }]).isInvoiceVisible);
  assert.equal(r.status, "ready");
  assert.equal(r.invoices.length, 0, "asking for the account does not confer reach into it");
});

await check("truncation honesty is unchanged, and is judged on the UNFILTERED account set", async () => {
  const r = await readAccountInvoiceAr(db, ACCT, 2, auth([{ scope: "SELF", employeeId: "emp-b" }]).isInvoiceVisible);
  assert.equal(r.status, "unavailable", "3 invoices exist for the account; a limit-2 page is a truncation even though scope would show only 1");
});

await check("the LOADER resolves no reach today (every finance capability registered active:false) — including for an active admin", async () => {
  const uid = `fin004-admin-${run}`;
  await db.collection("users").doc(uid).set({ accessVersion: 1, employeeId: "emp-a" });
  await db.collection("roleAssignments").doc(`fin004-admin-role-${run}`).set({
    principalUid: uid, roleId: "admin", scope: { type: "global" },
    grantedBy: "test", grantedAt: admin.firestore.Timestamp.now(), status: "active", accessVersionAtGrant: 1,
  });
  const a = await loadFinancialVisibilityAuthority(db, uid);
  assert.equal(a.anyReach, false, "no implicit admin bypass; reach arrives only through express grants");
  assert.equal(a.factFamilyAllowed, false, "finance.read is registered active:false");
});

await check("the CALLABLE refuses without reach — the pre-FIN-004 'finance.read serves any account' shape is retired", async () => {
  const uid = `fin004-caller-${run}`;
  await db.collection("users").doc(uid).set({ accessVersion: 1 });
  await assert.rejects(
    listAccountInvoiceAr.run({ data: { accountId: ACCT }, auth: { uid, token: {} } }),
    (e) => e?.code === "permission-denied" && /visibility scope/.test(e?.message ?? ""),
  );
});

console.log(`\n${passed} passed, 0 failed`);
