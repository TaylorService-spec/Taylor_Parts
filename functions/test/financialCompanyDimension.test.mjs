// FINANCIAL FIGURES CARRY THEIR OPERATING COMPANY — contract tests.
// Run: node --test test/financialCompanyDimension.test.mjs   (after `npm run build`)
//
// ════════════════════ THE DEFECT THESE CASES PIN CLOSED ════════════════════
//
// Operating company in this system is a GOVERNED fact, never inferred: issueInvoice stamps
// `companyId` from the Sales Order's operatingCompanyId and refuses a caller who asserts another
// (functions/src/finance/invoiceCommands.ts). Accounts, however, are NOT partitioned by operating
// company — one account can be invoiced by Taylor and by Ventana — so an account-scoped A/R total
// genuinely can span both.
//
// The canonical A/R read projection used to drop that fact on the floor. `InvoiceArRead` carried
// currency, state, due date and five money fields, and NO company; `summarizeAccountAr` therefore
// produced one `outstandingByCurrency` map spanning every company the principal could reach, and
// the rows beside it could not disambiguate it either. The per-currency discipline in that same
// file is emphatic that currencies are never blended — and the other dimension that must never be
// blended was being blended silently.
//
// So these cases assert two things, and the second is the one that matters:
//   1. the governed company reaches the read at all (carried, never inferred, explicit when absent);
//   2. the company partition RECONCILES EXACTLY to the consolidated totals it partitions.
//
// (2) is what makes the breakdown trustworthy rather than a second opinion. A partition whose parts
// do not add up to the whole is a new way to be wrong about money, not a fix.
//
// Pure and offline: the projection helpers take facts, and `readFinancialFacts` takes an injected
// Firestore and an injected authority, exactly as its own suite does.
import test from "node:test";
import assert from "node:assert/strict";

const {
  projectInvoiceAr,
  summarizeAccountAr,
  summarizeArAging,
  summarizeArAgingByCompany,
  deriveOutstandingMinor,
  UNATTRIBUTED_COMPANY,
} = await import("../lib/finance/financeReadProjection.js");
const { deriveOutstandingMinor: deriveOutstandingFromCommandCore } = await import("../lib/finance/paymentCommands.js");
const { readFinancialFacts } = await import("../lib/finance/financialReportingRead.js");
const { buildFinancialVisibilityAuthority } = await import("../lib/finance/financialVisibility.js");

const DAY = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY;

// SOURCE FACTS in the stored shape — never a desired screen number.
const stored = (over = {}) => ({
  accountId: "acct-1",
  currency: "USD",
  state: "ISSUED",
  totalMinor: 10_000,
  companyId: "taylor",
  dueDate: NOW + 10 * DAY,
  ...over,
});

const read = (id, over = {}) => projectInvoiceAr(id, stored(over), NOW);

// Sum a per-currency map into another, so a partition can be re-totalled and compared to the whole.
const addInto = (acc, map) => {
  for (const [currency, amount] of Object.entries(map ?? {})) acc[currency] = (acc[currency] ?? 0) + amount;
  return acc;
};

// ═══════════════ 1. The governed fact reaches the read, and is never invented ═══════════════

test("1. projectInvoiceAr carries the invoice's governed companyId", () => {
  assert.equal(read("inv-1", { companyId: "ventana" }).companyId, "ventana");
});

test("2. an invoice with no stored companyId projects null — the company is never inferred", () => {
  // There is nothing to infer it FROM that would be honest: not the account (accounts are not
  // company-partitioned), not the caller, not the currency. Null is the true answer.
  const r = projectInvoiceAr("inv-legacy", { accountId: "acct-1", currency: "USD", totalMinor: 500 }, NOW);
  assert.equal(r.companyId, null);
});

test("3. a non-string stored companyId is null, not coerced", () => {
  assert.equal(projectInvoiceAr("inv-x", { companyId: 7, totalMinor: 100 }, NOW).companyId, null);
});

// ═══════════════ 2. The account summary no longer blends operating companies ═══════════════

test("4. two companies on ONE account are partitioned, and the blend is disclosed", () => {
  const reads = [
    read("t1", { companyId: "taylor", totalMinor: 10_000 }),
    read("t2", { companyId: "taylor", totalMinor: 4_000, appliedMinor: 1_000 }),
    read("v1", { companyId: "ventana", totalMinor: 7_000 }),
  ];
  const s = summarizeAccountAr(reads);

  assert.deepEqual(s.companyIds, ["taylor", "ventana"]);
  assert.equal(s.spansMultipleCompanies, true, "a consolidated figure over two companies must say so");
  assert.deepEqual(s.byCompany.taylor.outstandingByCurrency, { USD: 13_000 });
  assert.deepEqual(s.byCompany.ventana.outstandingByCurrency, { USD: 7_000 });
  assert.equal(s.byCompany.taylor.count, 2);
  assert.equal(s.byCompany.ventana.count, 1);
  // The old, company-blind answer is still available — it is just no longer the ONLY answer.
  assert.deepEqual(s.outstandingByCurrency, { USD: 20_000 });
});

test("5. a single-company set does not claim to span companies", () => {
  const s = summarizeAccountAr([read("t1"), read("t2", { totalMinor: 1 })]);
  assert.deepEqual(s.companyIds, ["taylor"]);
  assert.equal(s.spansMultipleCompanies, false);
});

test("6. THE RECONCILIATION: byCompany re-totals EXACTLY to the consolidated maps", () => {
  const reads = [
    read("t-usd", { companyId: "taylor", totalMinor: 10_000, appliedMinor: 2_500 }),
    read("t-eur", { companyId: "taylor", currency: "EUR", totalMinor: 6_000 }),
    read("v-usd", { companyId: "ventana", totalMinor: 7_000, appliedMinor: 7_000, state: "PAID", dueDate: undefined }),
    read("v-cad", { companyId: "ventana", currency: "CAD", totalMinor: 3_000, chargesMinor: 250 }),
    read("legacy", { companyId: undefined, totalMinor: 1_250 }),
  ];
  const s = summarizeAccountAr(reads);

  for (const field of ["billedByCurrency", "collectedByCurrency", "outstandingByCurrency"]) {
    const reTotalled = {};
    for (const key of s.companyIds) addInto(reTotalled, s.byCompany[key][field]);
    assert.deepEqual(reTotalled, s[field], `${field}: the parts must add up to the whole, to the cent`);
  }
  const counts = s.companyIds.reduce(
    (acc, key) => ({
      count: acc.count + s.byCompany[key].count,
      openCount: acc.openCount + s.byCompany[key].openCount,
      overdueCount: acc.overdueCount + s.byCompany[key].overdueCount,
    }),
    { count: 0, openCount: 0, overdueCount: 0 },
  );
  assert.deepEqual(counts, { count: s.count, openCount: s.openCount, overdueCount: s.overdueCount });
});

test("7. money with no governed company gets its OWN key — never folded into a company", () => {
  const s = summarizeAccountAr([
    read("t1", { companyId: "taylor", totalMinor: 10_000 }),
    read("legacy", { companyId: undefined, totalMinor: 1_250 }),
  ]);
  assert.deepEqual(s.companyIds, [UNATTRIBUTED_COMPANY, "taylor"].sort());
  assert.deepEqual(s.byCompany[UNATTRIBUTED_COMPANY].outstandingByCurrency, { USD: 1_250 });
  assert.deepEqual(s.byCompany.taylor.outstandingByCurrency, { USD: 10_000 });
  // Folding it into taylor would have overstated Taylor's exposure by 12.50; dropping it would have
  // made the parts fail to add up. It is its own key, and the total still reconciles.
  assert.deepEqual(s.outstandingByCurrency, { USD: 11_250 });
});

test("8. a blank-string companyId is unattributed, not a company named \"\"", () => {
  const s = summarizeAccountAr([read("blank", { companyId: "   ", totalMinor: 400 })]);
  assert.deepEqual(s.companyIds, [UNATTRIBUTED_COMPANY]);
});

// ═══════════════ 3. Aging gets the same dimension, from the same rule ═══════════════

test("9. aging per company: each company's buckets are its own money only", () => {
  const reads = [
    read("t-overdue", { companyId: "taylor", totalMinor: 10_000, dueDate: NOW - 40 * DAY }),
    read("v-current", { companyId: "ventana", totalMinor: 7_000, dueDate: NOW + 5 * DAY }),
  ];
  const byCompany = summarizeArAgingByCompany(reads, NOW);
  assert.deepEqual(Object.keys(byCompany).sort(), ["taylor", "ventana"]);
  assert.equal(byCompany.taylor.USD.days31to60Minor, 10_000);
  assert.equal(byCompany.taylor.USD.currentMinor, 0);
  assert.equal(byCompany.ventana.USD.currentMinor, 7_000);
  assert.equal(byCompany.ventana.USD.days31to60Minor, 0);
});

test("10. the per-company buckets re-total to the consolidated aging, bucket by bucket", () => {
  const reads = [
    read("t-overdue", { companyId: "taylor", totalMinor: 10_000, dueDate: NOW - 40 * DAY }),
    read("t-61", { companyId: "taylor", totalMinor: 2_000, dueDate: NOW - 90 * DAY }),
    read("v-current", { companyId: "ventana", totalMinor: 7_000, dueDate: NOW + 5 * DAY }),
    read("v-1to30", { companyId: "ventana", totalMinor: 900, dueDate: NOW - 3 * DAY }),
    read("unaged", { companyId: undefined, totalMinor: 1_250, dueDate: undefined }),
    read("settled", { companyId: "taylor", totalMinor: 500, appliedMinor: 500, state: "PAID" }),
  ];
  const consolidated = summarizeArAging(reads, NOW);
  const byCompany = summarizeArAgingByCompany(reads, NOW);

  const fields = [
    "totalOutstandingMinor", "currentMinor", "days1to30Minor",
    "days31to60Minor", "days61PlusMinor", "unagedMinor",
  ];
  const reTotalled = {};
  for (const perCurrency of Object.values(byCompany)) {
    for (const [currency, bucket] of Object.entries(perCurrency)) {
      const acc = (reTotalled[currency] ??= Object.fromEntries(fields.map((f) => [f, 0])));
      for (const f of fields) acc[f] += bucket[f];
    }
  }
  assert.deepEqual(reTotalled, consolidated);
});

test("11. a company whose invoices are all settled contributes no aging key (not a row of zeroes)", () => {
  const byCompany = summarizeArAgingByCompany(
    [read("v-paid", { companyId: "ventana", totalMinor: 500, appliedMinor: 500, state: "PAID" })],
    NOW,
  );
  assert.deepEqual(byCompany, {});
});

// ═══════════════ 4. The governed reporting read exposes it, still scope-first ═══════════════

// `readFinancialFacts` reads the WALL CLOCK (it is the server deriving "overdue as of now"), so these
// fixtures are dated relative to the real clock rather than the fixed NOW the pure helpers above use.
const REAL_NOW = Date.now();

const invoiceDoc = (id, over = {}) => ({
  id,
  data: {
    accountId: "acct-1",
    invoiceNumber: id.toUpperCase(),
    currency: "USD",
    state: "ISSUED",
    totalMinor: 100_000,
    appliedMinor: 0,
    dueDate: REAL_NOW - 40 * DAY,
    issuedAtMillis: REAL_NOW - 60 * DAY,
    companyId: "taylor",
    attribution: { creditedSalespersonId: "cw-emp-034" },
    lines: [{ businessUnitId: "bu-parts" }],
    ...over,
  },
});

function fakeDb(collections) {
  const make = (rows) => ({
    where: (field, _op, value) => make(rows.filter((r) => r.data[field] === value)),
    limit: (n) => make(rows.slice(0, n)),
    get: async () => ({ size: rows.length, docs: rows.map((r) => ({ id: r.id, data: () => r.data })) }),
  });
  return { collection: (name) => make(collections[name] ?? []) };
}

const db = fakeDb({
  invoices: [
    invoiceDoc("inv-t"),
    invoiceDoc("inv-v", { companyId: "ventana", dueDate: REAL_NOW + 5 * DAY }),
    invoiceDoc("inv-legacy", { companyId: null, dueDate: null }),
  ],
  payment_applications: [],
  payments: [],
});
const authority = (grants) => buildFinancialVisibilityAuthority({ factFamilyAllowed: true, grants });

test("12. readFinancialFacts returns aging partitioned by company beside the consolidated row", async () => {
  const r = await readFinancialFacts(db, authority([{ scope: "CONSOLIDATED" }]), {}, 50);
  assert.equal(r.status, "ready");
  assert.deepEqual(Object.keys(r.agingByCompany).sort(), [UNATTRIBUTED_COMPANY, "taylor", "ventana"].sort());
  assert.equal(r.agingByCompany.taylor.USD.days31to60Minor, 100_000);
  assert.equal(r.agingByCompany.ventana.USD.currentMinor, 100_000);
  assert.equal(r.agingByCompany[UNATTRIBUTED_COMPANY].USD.unagedMinor, 100_000);
  // The consolidated row is still there, and still equals the sum of the parts.
  assert.equal(r.agingByCurrency.USD.totalOutstandingMinor, 300_000);
});

test("13. a company the principal cannot reach contributes no key at all", async () => {
  // Scope, not filtering: Ventana money is not merely absent from a bucket, it never entered the set.
  const r = await readFinancialFacts(db, authority([{ scope: "OPERATING_COMPANY", operatingCompanyId: "taylor" }]), {}, 50);
  assert.equal(r.status, "ready");
  assert.deepEqual(Object.keys(r.agingByCompany), ["taylor"]);
  assert.equal(r.summary.spansMultipleCompanies, false);
  assert.deepEqual(r.summary.companyIds, ["taylor"]);
});

test("14. a requested companyId narrows the aging partition without widening reach", async () => {
  const r = await readFinancialFacts(db, authority([{ scope: "CONSOLIDATED" }]), { companyId: "ventana" }, 50);
  assert.deepEqual(Object.keys(r.agingByCompany), ["ventana"]);
  assert.equal(r.agingByCompany.ventana.USD.currentMinor, 100_000);
});

// ═══════════════ 5. The two outstanding formulas must not drift apart ═══════════════

test("15. the read projection and the payment command core derive the SAME outstanding", () => {
  // `deriveOutstandingMinor` is implemented TWICE — once in financeReadProjection.ts (what the read
  // shows) and once in paymentCommands.ts (what the command maintains, and what
  // financialReconciliation.ts diffs against). They are the same formula written out twice, which is
  // a real duplicate representation of the A/R outstanding rule; consolidating it belongs to the
  // Payment lane that owns paymentCommands.ts. Until then this pins them together, so a change to
  // one that is not made to the other fails here rather than in a customer's balance.
  const cases = [
    { totalMinor: 10_000, appliedMinor: 3_000, creditsMinor: 1_000, chargesMinor: 500, writeOffMinor: 500 },
    { totalMinor: 10_000 },
    { totalMinor: 0, appliedMinor: 0 },
    { totalMinor: 7_500, writeOffMinor: 7_500 },
    { totalMinor: 1, chargesMinor: 99 },
  ];
  for (const c of cases) {
    assert.equal(
      deriveOutstandingMinor(c),
      deriveOutstandingFromCommandCore(c),
      `outstanding formulas disagree for ${JSON.stringify(c)}`,
    );
  }
});

// ═══════════════ 6. Money stays integer minor units through the new surface ═══════════════

test("16. every amount the company partition produces is an integer", () => {
  const reads = [
    read("t1", { companyId: "taylor", totalMinor: 10_001, appliedMinor: 3 }),
    read("v1", { companyId: "ventana", currency: "EUR", totalMinor: 999 }),
  ];
  const s = summarizeAccountAr(reads);
  const amounts = [
    ...Object.values(s.outstandingByCurrency),
    ...s.companyIds.flatMap((k) => [
      ...Object.values(s.byCompany[k].billedByCurrency),
      ...Object.values(s.byCompany[k].collectedByCurrency),
      ...Object.values(s.byCompany[k].outstandingByCurrency),
    ]),
    ...Object.values(summarizeArAgingByCompany(reads, NOW)).flatMap((byCurrency) =>
      Object.values(byCurrency).flatMap((b) => Object.values(b)),
    ),
  ];
  for (const a of amounts) assert.equal(Number.isSafeInteger(a), true, `${a} is not an integer minor-unit amount`);
});
