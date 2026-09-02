// Governed reporting read seam — contract tests.
//
// Run: node --test test/financialReportingRead.test.mjs   (after `npm run build`)
//
// Offline by construction. `readFinancialFacts` was factored out of the onCall wrapper precisely so
// the SCOPE RULES can be proved without a live grant and without an emulator: the authority is
// injected (built by the same canonical builder the loader uses) and Firestore is a small fake that
// returns exactly what a query would. The callable boundary itself (unauthenticated / no reach) is
// covered by the emulator suite that already guards its sibling read.
//
// THE CLAIM UNDER TEST, above all others: a caller-supplied filter is a REQUEST, never an
// authorization. Several cases below ask for facts the principal cannot reach and assert the answer
// is EMPTY — not an error, not a leak. That is the difference between narrowing and widening, and
// it is the reason this file exists.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const { readFinancialFacts, matchesRequestedFilters, invoiceReportDimensions, REPORTING_FACT_TYPES } = await import(
  "../lib/finance/financialReportingRead.js"
);
const { buildFinancialVisibilityAuthority } = await import("../lib/finance/financialVisibility.js");
const { projectInvoiceAr } = await import("../lib/finance/financeReadProjection.js");

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 0, 1);

// ── Fixtures: SOURCE FACTS in the stored shape, not desired screen numbers. ──
const invoice = (id, over = {}) => ({
  id,
  data: {
    accountId: "acct-1",
    invoiceNumber: id.toUpperCase(),
    currency: "USD",
    state: "ISSUED",
    totalMinor: 100_000,
    appliedMinor: 0,
    creditsMinor: 0,
    chargesMinor: 0,
    writeOffMinor: 0,
    dueDate: T0 + 30 * DAY,
    issuedAtMillis: T0,
    companyId: "taylor",
    attribution: { creditedSalespersonId: "cw-emp-034" },
    lines: [{ businessUnitId: "bu-parts" }],
    ...over,
  },
});

const INVOICES = [
  invoice("inv-a"),
  invoice("inv-b", { companyId: "ventana", attribution: { creditedSalespersonId: "cw-emp-035" }, lines: [{ businessUnitId: "bu-service" }] }),
  invoice("inv-c", { accountId: "acct-2", appliedMinor: 100_000, state: "PAID" }),
  invoice("inv-d", { currency: "CAD", issuedAtMillis: T0 + 90 * DAY, dueDate: T0 + 100 * DAY }),
  // Pre-FIN-002 shape: no stamped attribution, no line business unit. It is a real, visible fact
  // under a company scope, and it must be counted as UNATTRIBUTED rather than silently dropped.
  invoice("inv-legacy", { attribution: null, lines: [{}] }),
];

function fakeDb(collections) {
  const make = (rows) => ({
    _rows: rows,
    where(field, _op, value) {
      return make(rows.filter((r) => r.data[field] === value));
    },
    limit(n) {
      return make(rows.slice(0, n));
    },
    async get() {
      return { size: rows.length, docs: rows.map((r) => ({ id: r.id, data: () => r.data })) };
    },
  });
  return { collection: (name) => make(collections[name] ?? []) };
}

const db = fakeDb({
  invoices: INVOICES,
  payment_applications: [
    { id: "app-1", data: { invoiceId: "inv-c", paymentId: "pay-1", companyId: "taylor", currency: "USD", appliedAmountMinor: 100_000, appliedAtMillis: T0 + 5 * DAY } },
    { id: "app-2", data: { invoiceId: "inv-b", paymentId: "pay-2", companyId: "ventana", currency: "USD", appliedAmountMinor: 25_000, appliedAtMillis: T0 + 6 * DAY } },
  ],
  payments: [
    { id: "pay-1", data: { accountId: "acct-2", companyId: "taylor", currency: "USD", amountMinor: 100_000, appliedMinor: 100_000, receivedAtMillis: T0 + 5 * DAY, method: "CHECK" } },
    { id: "pay-2", data: { accountId: "acct-1", companyId: "ventana", currency: "USD", amountMinor: 25_000, appliedMinor: 25_000, receivedAtMillis: T0 + 6 * DAY, method: "ACH" } },
  ],
});

const authority = (grants, factFamilyAllowed = true) => buildFinancialVisibilityAuthority({ factFamilyAllowed, grants });
const CONSOLIDATED = authority([{ scope: "CONSOLIDATED" }]);
const SELF_034 = authority([{ scope: "SELF", employeeId: "cw-emp-034" }]);
const TAYLOR_ONLY = authority([{ scope: "OPERATING_COMPANY", operatingCompanyId: "taylor" }]);
const ids = (r) => r.invoices.map((i) => i.invoiceId).sort();

// ═══════════════ 1. Authorization precedes every filter ═══════════════

test("1. no reach returns nothing, even at consolidated-looking filters", async () => {
  const none = authority([]);
  const r = await readFinancialFacts(db, none, {}, 50);
  assert.equal(r.status, "unavailable");
  assert.deepEqual(r.invoices, []);
});

test("2. the fact-family gate alone confers no reach", async () => {
  const familyOnlyNoScope = authority([], true);
  assert.equal(familyOnlyNoScope.anyReach, false);
  const r = await readFinancialFacts(db, familyOnlyNoScope, {}, 50);
  assert.equal(r.status, "unavailable");
});

test("3. a scope grant without the fact family confers no reach", async () => {
  const scopeWithoutFamily = authority([{ scope: "CONSOLIDATED" }], false);
  assert.equal(scopeWithoutFamily.anyReach, false);
  assert.deepEqual((await readFinancialFacts(db, scopeWithoutFamily, {}, 50)).invoices, []);
});

test("4. SELF reach returns only facts credited to the principal", async () => {
  const r = await readFinancialFacts(db, SELF_034, {}, 50);
  assert.deepEqual(ids(r), ["inv-a", "inv-c", "inv-d"]);
  // inv-b belongs to the other salesperson; inv-legacy has no credited person — an honest null is not yours.
  assert.ok(!ids(r).includes("inv-b") && !ids(r).includes("inv-legacy"));
});

// ═══════════════ 2. Filters may narrow; they may NEVER widen ═══════════════

test("5. requesting ANOTHER salesperson's credit under SELF returns empty, not their facts", async () => {
  const r = await readFinancialFacts(db, SELF_034, { creditedSalespersonId: "cw-emp-035" }, 50);
  assert.deepEqual(r.invoices, []);
  assert.equal(r.status, "ready", "an out-of-reach request is an honest empty result, not an error");
});

test("6. requesting a company outside reach returns empty", async () => {
  const r = await readFinancialFacts(db, TAYLOR_ONLY, { companyId: "ventana" }, 50);
  assert.deepEqual(r.invoices, []);
});

test("7. an unfiltered call under a company scope returns ONLY that company", async () => {
  const r = await readFinancialFacts(db, TAYLOR_ONLY, {}, 50);
  assert.deepEqual(ids(r), ["inv-a", "inv-c", "inv-d", "inv-legacy"]);
  assert.ok(r.invoices.every((i) => i.companyId === "taylor"));
});

test("8. a filter narrows an already-authorized set (consolidated + companyId)", async () => {
  const wide = await readFinancialFacts(db, CONSOLIDATED, {}, 50);
  const narrowed = await readFinancialFacts(db, CONSOLIDATED, { companyId: "ventana" }, 50);
  assert.equal(wide.invoices.length, INVOICES.length);
  assert.deepEqual(ids(narrowed), ["inv-b"]);
  assert.ok(narrowed.invoices.length < wide.invoices.length);
});

test("9. every requested filter is subtractive — no filter combination ever exceeds the unfiltered set", async () => {
  const baseline = new Set(ids(await readFinancialFacts(db, CONSOLIDATED, {}, 50)));
  const requests = [
    { companyId: "taylor" },
    { businessUnitId: "bu-service" },
    { creditedSalespersonId: "cw-emp-035" },
    { accountId: "acct-2" },
    { periodStartMillis: T0 + 60 * DAY },
    { companyId: "taylor", creditedSalespersonId: "cw-emp-034", businessUnitId: "bu-parts" },
  ];
  for (const f of requests) {
    for (const id of ids(await readFinancialFacts(db, CONSOLIDATED, f, 50))) {
      assert.ok(baseline.has(id), `filter ${JSON.stringify(f)} produced ${id}, which the unfiltered read did not`);
    }
  }
});

test("10. an unstamped dimension is a NON-match, never a pass-through", () => {
  const legacy = { companyId: "taylor", creditedSalespersonId: null, businessUnitIds: [], accountId: "acct-1", issuedAtMillis: null };
  assert.equal(matchesRequestedFilters(legacy, { businessUnitId: "bu-parts" }), false);
  assert.equal(matchesRequestedFilters(legacy, { creditedSalespersonId: "cw-emp-034" }), false);
  assert.equal(matchesRequestedFilters(legacy, { periodStartMillis: T0 }), false);
  assert.equal(matchesRequestedFilters(legacy, {}), true);
});

// ═══════════════ 3. Business-unit and period semantics ═══════════════

test("11. BUSINESS_UNIT filtering matches the frozen line attribution", async () => {
  const r = await readFinancialFacts(db, CONSOLIDATED, { businessUnitId: "bu-service" }, 50);
  assert.deepEqual(ids(r), ["inv-b"]);
  assert.deepEqual(r.invoices[0].businessUnitIds, ["bu-service"]);
});

test("12. period filters bound on the invoice's own issuedAtMillis", async () => {
  const early = await readFinancialFacts(db, CONSOLIDATED, { periodStartMillis: T0, periodEndMillis: T0 + DAY }, 50);
  assert.ok(!ids(early).includes("inv-d"), "an invoice issued 90 days later is outside the period");
  const late = await readFinancialFacts(db, CONSOLIDATED, { periodStartMillis: T0 + 60 * DAY }, 50);
  assert.deepEqual(ids(late), ["inv-d"]);
});

// ═══════════════ 4. No new financial truth ═══════════════

test("13. derived money equals the canonical projection exactly — no second formula", async () => {
  const r = await readFinancialFacts(db, CONSOLIDATED, {}, 50);
  for (const read of r.invoices) {
    const source = INVOICES.find((i) => i.id === read.invoiceId).data;
    const canonical = projectInvoiceAr(read.invoiceId, source, Date.now());
    for (const field of ["totalMinor", "appliedMinor", "outstandingMinor", "arPosition", "daysOverdue", "state"]) {
      assert.deepEqual(read[field], canonical[field], `${read.invoiceId}.${field} diverged from the canonical projection`);
    }
  }
});

test("14. every money value is an integer minor unit", async () => {
  const r = await readFinancialFacts(db, CONSOLIDATED, {}, 50);
  const amounts = [
    ...r.invoices.flatMap((i) => [i.totalMinor, i.appliedMinor, i.outstandingMinor]),
    ...r.payments.map((p) => p.amountMinor),
    ...r.applications.map((a) => a.appliedAmountMinor),
    ...r.byCompany.flatMap((d) => [...Object.values(d.billedByCurrency), ...Object.values(d.outstandingByCurrency)]),
  ];
  assert.ok(amounts.length > 0);
  for (const v of amounts) assert.ok(Number.isSafeInteger(v), `${v} is not an integer minor unit`);
});

test("15. currencies are never summed together", async () => {
  const r = await readFinancialFacts(db, CONSOLIDATED, { companyId: "taylor" }, 50);
  const taylor = r.byCompany.find((d) => d.key === "taylor");
  assert.deepEqual(Object.keys(taylor.billedByCurrency).sort(), ["CAD", "USD"]);
  assert.equal(taylor.billedByCurrency.CAD, 100_000);
  // Collected is the persisted appliedMinor, rolled up beside billed — not re-derived from payments.
  assert.equal(taylor.collectedByCurrency.USD, 100_000, "only inv-c has cash applied");
  assert.equal(taylor.collectedByCurrency.CAD, 0);
});

test("16. the read serves ONLY persisted fact types — no goal, budget, forecast, cost or margin", () => {
  assert.deepEqual([...REPORTING_FACT_TYPES], ["INVOICE", "PAYMENT_RECEIPT", "PAYMENT_APPLICATION"]);
  const src = readFileSync(new URL("../src/finance/financialReportingRead.ts", import.meta.url), "utf8");
  const body = src.replace(/^\/\/.*$/gm, ""); // the doc header NAMES what it refuses to serve
  for (const banned of ["GOAL", "BUDGET", "FORECAST", "marginMinor", "costMinor", "quota", "commission"]) {
    assert.ok(!body.includes(banned), `reporting read must not traffic in ${banned}`);
  }
});

// ═══════════════ 5. Attribution is preserved, never re-derived ═══════════════

test("17. creditedSalespersonId is exposed verbatim from the frozen attribution", async () => {
  const r = await readFinancialFacts(db, CONSOLIDATED, {}, 50);
  assert.equal(r.invoices.find((i) => i.invoiceId === "inv-a").creditedSalespersonId, "cw-emp-034");
  assert.equal(r.invoices.find((i) => i.invoiceId === "inv-b").creditedSalespersonId, "cw-emp-035");
  const dims = invoiceReportDimensions({ attribution: { creditedSalespersonId: "cw-emp-034" }, companyId: "taylor", lines: [] });
  assert.equal(dims.creditedSalespersonId, "cw-emp-034");
});

test("18. credit is never re-derived from owner, creator, assignment, technician or warehouse", () => {
  const src = readFileSync(new URL("../src/finance/financialReportingRead.ts", import.meta.url), "utf8");
  for (const forbidden of ["ownerEmployeeId", "createdByUid", "commercialOwner", "assignedTo", "technicianId", "warehouseId", "sales_orders"]) {
    assert.ok(!src.includes(forbidden), `reporting read must not source credit from ${forbidden}`);
  }
  // Only ONE dimension extractor, and it reads the same facts the visibility predicate reads.
  assert.ok(src.includes("invoiceVisibilityFacts(doc)"));
});

test("19. an unattributed fact is reported as unattributed, not as a zero bucket", async () => {
  const r = await readFinancialFacts(db, TAYLOR_ONLY, {}, 50);
  assert.equal(r.unattributed.creditedSalesperson, 1, "inv-legacy carries no credited salesperson");
  assert.equal(r.unattributed.businessUnit, 1);
  assert.ok(!r.byCreditedSalesperson.some((d) => d.key === "" || d.key === "null" || d.key === "UNKNOWN"));
  // The rollup must reconcile to the list beside it: every invoice is either in a bucket or counted unattributed.
  const bucketed = r.byCreditedSalesperson.reduce((n, d) => n + d.invoiceCount, 0);
  assert.equal(bucketed + r.unattributed.creditedSalesperson, r.invoices.length);
});

// ═══════════════ 6. Bounded-read honesty and derived collections ═══════════════

test("20. a truncated page is unavailable — never a confident partial summary", async () => {
  const r = await readFinancialFacts(db, CONSOLIDATED, {}, 2);
  assert.equal(r.status, "unavailable");
  assert.deepEqual(r.invoices, []);
  assert.deepEqual(r.summary.outstandingByCurrency, {});
});

test("21. truncation is judged before scope filtering, so a narrow scope cannot mask an incomplete page", async () => {
  // SELF_034 can see 3 of 5; a limit of 4 still truncates the underlying query and must stay honest.
  const r = await readFinancialFacts(db, SELF_034, {}, 4);
  assert.equal(r.status, "unavailable");
});

test("22. payments and applications appear only for invoices the principal can see", async () => {
  const r = await readFinancialFacts(db, SELF_034, {}, 50);
  assert.deepEqual(r.applications.map((a) => a.applicationId), ["app-1"], "app-2 settles inv-b, which SELF cannot see");
  assert.deepEqual(r.payments.map((p) => p.paymentId), ["pay-1"]);
});

test("23. factTypes restricts the payload without changing what was authorized", async () => {
  const only = await readFinancialFacts(db, CONSOLIDATED, { factTypes: ["INVOICE"] }, 50);
  assert.ok(only.invoices.length > 0);
  assert.deepEqual(only.payments, []);
  assert.deepEqual(only.applications, []);
});

test("24. the granted scopes are reported, so a surface can state what it is showing", async () => {
  const r = await readFinancialFacts(db, TAYLOR_ONLY, {}, 50);
  assert.deepEqual([...r.grantedScopes], ["OPERATING_COMPANY"]);
});

// ═══════════════ 7. Canonical event dates, one per fact type ═══════════════
//
// The defect these pin: filtering receipts by the ISSUE DATE of the invoice they settle answers
// "cash against invoices raised in March" in place of "cash received in March". The fixture below
// is built so the two questions have DIFFERENT answers — an invoice issued in January paid in
// March — because a fixture where they coincide cannot tell the two apart.
const JAN = Date.UTC(2026, 0, 15);
const MAR = Date.UTC(2026, 2, 15);
const CROSS_DB = fakeDb({
  invoices: [
    invoice("inv-jan", { issuedAtMillis: JAN, appliedMinor: 40_000, dueDate: JAN + 30 * DAY }),
  ],
  payment_applications: [
    { id: "app-mar", data: { invoiceId: "inv-jan", paymentId: "pay-mar", companyId: "taylor", currency: "USD", appliedAmountMinor: 40_000, appliedAtMillis: MAR } },
  ],
  payments: [
    { id: "pay-mar", data: { accountId: "acct-1", companyId: "taylor", currency: "USD", amountMinor: 40_000, appliedMinor: 40_000, receivedAtMillis: MAR, method: "ACH" } },
  ],
});
const marchWindow = { periodStartMillis: Date.UTC(2026, 2, 1), periodEndMillis: Date.UTC(2026, 2, 31, 23, 59, 59, 999) };
const januaryWindow = { periodStartMillis: Date.UTC(2026, 0, 1), periodEndMillis: Date.UTC(2026, 0, 31, 23, 59, 59, 999) };

test("25. a MARCH period returns the March payment even though its invoice was issued in January", async () => {
  const r = await readFinancialFacts(CROSS_DB, CONSOLIDATED, marchWindow, 50);
  assert.deepEqual(r.payments.map((p) => p.paymentId), ["pay-mar"], "the receipt is judged on receivedAtMillis");
  assert.deepEqual(r.applications.map((a) => a.applicationId), ["app-mar"]);
  // ...and the invoice itself is NOT in a March window, because it was not issued in March.
  assert.deepEqual(r.invoices, [], "the invoice is judged on issuedAtMillis");
});

test("26. a JANUARY period returns the invoice but NOT the March payment", async () => {
  const r = await readFinancialFacts(CROSS_DB, CONSOLIDATED, januaryWindow, 50);
  assert.deepEqual(r.invoices.map((i) => i.invoiceId), ["inv-jan"]);
  assert.deepEqual(r.payments, [], "a March receipt must not appear in a January window");
  assert.deepEqual(r.applications, [], "a March application must not appear in a January window");
});

test("27. payment authorization is NOT narrowed by the invoice period", async () => {
  // The regression this prevents: authorizing receipts from the period-filtered invoice set would
  // make the March payment invisible, because its invoice falls outside a March window.
  const r = await readFinancialFacts(CROSS_DB, CONSOLIDATED, marchWindow, 50);
  assert.equal(r.payments.length, 1, "the payment survives even though its invoice is filtered out");
});

test("28. an undated fact is EXCLUDED when a period is requested, never assumed inside it", async () => {
  const undated = fakeDb({
    invoices: [invoice("inv-undated", { issuedAtMillis: null })],
    payment_applications: [],
    payments: [],
  });
  assert.deepEqual((await readFinancialFacts(undated, CONSOLIDATED, marchWindow, 50)).invoices, []);
  // With NO period requested it is returned normally — absence of a date is not absence of a fact.
  assert.equal((await readFinancialFacts(undated, CONSOLIDATED, {}, 50)).invoices.length, 1);
});

// ═══════════════ 8. Consolidated lifecycle totals ═══════════════

test("29. the summary carries SERVER-COMPUTED consolidated billed, collected and outstanding", async () => {
  const r = await readFinancialFacts(db, CONSOLIDATED, {}, 50);
  // 100000*4 + 100000 (inv-legacy) across USD/CAD — asserted per currency, never as one number.
  assert.equal(r.summary.billedByCurrency.USD, 400_000);
  assert.equal(r.summary.billedByCurrency.CAD, 100_000);
  assert.equal(r.summary.collectedByCurrency.USD, 100_000, "only inv-c has cash applied");
  assert.equal(r.summary.outstandingByCurrency.USD, 300_000);
  assert.equal(r.summary.outstandingByCurrency.CAD, 100_000);
});

test("30. CURRENCIES ARE NEVER BLENDED in the consolidated totals", async () => {
  const r = await readFinancialFacts(db, CONSOLIDATED, {}, 50);
  for (const map of [r.summary.billedByCurrency, r.summary.collectedByCurrency, r.summary.outstandingByCurrency]) {
    assert.ok(!Object.hasOwn(map, "TOTAL") && !Object.hasOwn(map, "ALL"), "no blended key may exist");
    for (const v of Object.values(map)) assert.ok(Number.isSafeInteger(v));
  }
  // USD and CAD billed must not have been added into either key.
  assert.notEqual(r.summary.billedByCurrency.USD, 500_000);
});

test("31. the consolidated total spans companies WITHOUT normalizing any company id", async () => {
  // The legacy uppercase company is a DIFFERENT company key and stays one — it gets no lowercase
  // row. But its amount is an authorized atomic fact at consolidated scope, so it is counted in
  // the consolidated currency total. Summing authorized facts is not normalizing attribution.
  const legacyDb = fakeDb({
    invoices: [
      invoice("inv-lower", { companyId: "taylor", totalMinor: 10_000 }),
      invoice("inv-upper", { companyId: "TAYLOR", totalMinor: 5_000 }),
    ],
    payment_applications: [],
    payments: [],
  });
  const r = await readFinancialFacts(legacyDb, CONSOLIDATED, {}, 50);
  assert.equal(r.summary.billedByCurrency.USD, 15_000, "both authorized facts contribute to the consolidated total");
  assert.deepEqual(r.byCompany.map((c) => c.key).sort(), ["TAYLOR", "taylor"], "the two company keys stay distinct");
  // A single-company request still sees only its own key — the totals did not merge the ids.
  const lower = await readFinancialFacts(legacyDb, CONSOLIDATED, { companyId: "taylor" }, 50);
  assert.equal(lower.summary.billedByCurrency.USD, 10_000);
});

test("32. single-company views remain correct after the consolidated totals were added", async () => {
  const taylor = await readFinancialFacts(db, CONSOLIDATED, { companyId: "taylor" }, 50);
  assert.equal(taylor.summary.billedByCurrency.USD, 300_000);
  assert.equal(taylor.summary.billedByCurrency.CAD, 100_000);
  const ventana = await readFinancialFacts(db, CONSOLIDATED, { companyId: "ventana" }, 50);
  assert.equal(ventana.summary.billedByCurrency.USD, 100_000);
  assert.equal(ventana.summary.collectedByCurrency.USD, 0);
});
