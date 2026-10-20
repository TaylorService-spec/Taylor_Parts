// F-2 -- THE FIREBASE `listFinancialFacts` / `listAccountInvoiceAr` FACT FAMILIES, SERVED FROM EOS. Pure adapters + the bounded reads.
// Run: node --test test/financeFactFamiliesEos.test.mjs
//
//   FAMILIES  PAYMENT_RECEIPT <- RECORDED customer-payment settlements; PAYMENT_APPLICATION <- their APPLIED applications; INVOICE as before.
//   FIELDS    the Sales Order reference where a receivable carries one; invoice number / issue date stay absent (no record carries them).
//   NARROW    an accountId filter asks for that account's receivables only and totals them from its own rows.
import assert from "node:assert/strict";
import test from "node:test";
import { FACT_TYPES, paymentFacts, receivableRecord, receivablesEnvelope } from "../src/domain/financialsEos.js";
import { accountArFromObligations } from "../src/domain/accountReceivablesEos.js";
import { accountArView } from "../src/domain/accountArView.js";
import { fetchFinancialFactsFromEos } from "../src/services/eosFinancialsClient.js";

const row = (over = {}) => ({
  id: "obl-1", operatingCompanyId: "taylor", kind: "RECEIVABLE", currency: "USD", status: "OPEN", sourceDomain: "BILLING_PACKAGE", sourceRecordId: "bp-1",
  dueOn: "2026-01-15", overdue: true, originatedMinor: "40000", settledMinor: "16000", outstandingMinor: "24000",
  counterparty: { kind: "EXTERNAL_ORGANIZATION", crmAccountId: "acct-t", name: "Harbor Grill" },
  sourceSalesOrder: { id: "so-1", salesOrderNumber: "SO-0001" }, ...over,
});
const settlement = (over = {}) => ({
  id: "stl-1", operatingCompanyId: "taylor", kind: "CUSTOMER_PAYMENT", direction: "RECEIPT", currency: "USD", amountMinor: "16000", appliedMinor: "16000", unappliedMinor: "0",
  businessDate: "2026-02-03", sourceReference: "ACH-77", method: "ACH", status: "RECORDED",
  counterparty: { kind: "EXTERNAL_ORGANIZATION", crmAccountId: "acct-t", name: "Harbor Grill" },
  applications: [{ id: "app-1", obligationId: "obl-1", amountMinor: "16000", status: "APPLIED", appliedAt: "2026-02-04T17:00:00.000Z" }], ...over,
});
const access = (companies) => ({ principalId: "p", consolidated: companies.length === 2, restricted: false,
  companies: companies.map((id) => ({ operatingCompanyId: id, visibility: "FULL", actions: {} })) });
const overview = () => ({ scope: { operatingCompanyId: "taylor", companies: ["taylor"] }, visibility: { restricted: false },
  currencies: [{ currency: "USD", count: 1, openCount: 1, overdueCount: 1, billedMinor: "40000", collectedMinor: "16000", outstandingMinor: "24000",
    aging: { currentMinor: "0", days1to30Minor: "0", days31to60Minor: "0", days61PlusMinor: "24000", unagedMinor: "0" } }], byCompany: [] });
function server(answers) {
  const calls = [];
  const call = async (operation, input) => {
    calls.push([operation, input]);
    const a = answers[operation];
    const v = typeof a === "function" ? a(input) : a;
    return v?.ok === false ? v : { ok: true, result: v };
  };
  return { call, calls };
}

test("a receivable carries the Sales Order it was billed from; invoice number and issue date stay absent (nothing is inferred)", () => {
  const r = receivableRecord(row());
  assert.deepEqual([r.salesOrderId, r.salesOrderNumber], ["so-1", "SO-0001"]);
  assert.deepEqual([r.invoiceNumber, r.issuedAtMillis], [null, null], "no record links a receivable to an invoice row or an issue date");
  const none = receivableRecord(row({ sourceSalesOrder: null }));
  assert.deepEqual([none.salesOrderId, none.salesOrderNumber], [null, null], "a receivable with no Sales Order source answers null, not a guess");
  assert.equal(receivableRecord({ ...row(), sourceSalesOrder: undefined }).salesOrderId, null, "a server that does not supply the key answers null");
});

test("the account read carries the same reference and the Account view passes it through", () => {
  const out = accountArFromObligations([{ items: [row(), row({ id: "obl-2", sourceSalesOrder: null })], truncated: false }]);
  assert.deepEqual(out.invoices.map((i) => [i.salesOrderId, i.salesOrderNumber]), [["so-1", "SO-0001"], [null, null]]);
  const view = accountArView({ result: out });
  assert.deepEqual(view.rows.map((r) => [r.salesOrderId, r.salesOrderNumber]), [["so-1", "SO-0001"], [null, null]]);
});

test("PAYMENT_RECEIPT / PAYMENT_APPLICATION: customer payments only, voided and reversed excluded, applications join to the receivables by id", () => {
  const facts = paymentFacts([{ items: [
    settlement(),
    settlement({ id: "stl-2", kind: "VENDOR_PAYMENT", direction: "DISBURSEMENT", applications: [] }),
    settlement({ id: "stl-3", status: "VOID", applications: [] }),
    settlement({ id: "stl-4", appliedMinor: "100", unappliedMinor: "15900", applications: [
      { id: "app-2", obligationId: "obl-2", amountMinor: "100", status: "APPLIED", appliedAt: "2026-02-05T00:00:00.000Z" },
      { id: "app-3", obligationId: "obl-2", amountMinor: "50", status: "REVERSED", appliedAt: "2026-02-05T00:00:00.000Z" }] }),
  ] }]);
  assert.deepEqual(facts.payments.map((p) => p.paymentId), ["stl-1", "stl-4"], "a vendor payment is not a receipt; a voided settlement is no receipt");
  const [p] = facts.payments;
  assert.deepEqual([p.accountId, p.companyId, p.currency, p.amountMinor, p.appliedMinor, p.method, p.externalRef, p.invoiceId],
    ["acct-t", "taylor", "USD", 16000, 16000, "ACH", "ACH-77", null]);
  assert.equal(p.receivedAtMillis, new Date(2026, 1, 3).getTime(), "placed by its business date");
  assert.deepEqual(facts.applications.map((a) => [a.applicationId, a.invoiceId, a.paymentId, a.appliedAmountMinor]), [["app-1", "obl-1", "stl-1", 16000], ["app-2", "obl-2", "stl-4", 100]],
    "the reversed application is not cash applied; invoiceId is the receivable's id");
  assert.equal(facts.applications[0].appliedAtMillis, Date.parse("2026-02-04T17:00:00.000Z"));
  assert.equal(facts.truncated, false);
});

test("payment facts: accountId only narrows; a malformed row or unsafe amount makes the whole answer unavailable", () => {
  const items = [settlement(), settlement({ id: "stl-9", counterparty: { kind: "EXTERNAL_ORGANIZATION", crmAccountId: "acct-other", name: null } })];
  assert.deepEqual(paymentFacts([{ items }], { accountId: "acct-other" }).payments.map((p) => p.paymentId), ["stl-9"]);
  assert.deepEqual(paymentFacts([{ items }], { accountId: "nobody" }).payments, []);
  assert.equal(paymentFacts([{ items: [settlement({ amountMinor: "9007199254740993" })] }]), null);
  assert.equal(paymentFacts([{ items: [settlement({ applications: [{ id: "a", obligationId: "o", amountMinor: "x", status: "APPLIED" }] })] }]), null);
  assert.equal(paymentFacts([{ items: undefined }]), null);
  assert.equal(paymentFacts([{ items: [{ id: 5 }] }]), null);
});

test("reads: no factTypes means all three families, as the callable did, and the application joins to the receivable of the same answer", async () => {
  const s = server({ readMyFinanceCompanyAccess: access(["taylor"]), readFinanceOverview: overview(), listObligations: { items: [row()] }, listSettlements: { items: [settlement()] } });
  const out = await fetchFinancialFactsFromEos({}, 200, { call: s.call });
  assert.deepEqual(FACT_TYPES, ["INVOICE", "PAYMENT_RECEIPT", "PAYMENT_APPLICATION"]);
  assert.deepEqual(s.calls.map(([op]) => op), ["readMyFinanceCompanyAccess", "readFinanceOverview", "listObligations", "listSettlements"]);
  const r = out.result;
  assert.deepEqual([r.invoices.length, r.payments.length, r.applications.length], [1, 1, 1]);
  assert.equal(r.invoices.find((i) => i.invoiceId === r.applications[0].invoiceId)?.salesOrderNumber, "SO-0001");
  assert.equal(r.summary.outstandingByCurrency.USD, 24000, "the server's own total, unchanged");
});

test("reads: payments only asks for settlements (no receivable read, no overview); each family returns only what was asked for", async () => {
  const s = server({ readMyFinanceCompanyAccess: access(["taylor", "ventana"]), listSettlements: { items: [settlement()] } });
  const out = await fetchFinancialFactsFromEos({ factTypes: ["PAYMENT_RECEIPT", "PAYMENT_APPLICATION"], periodStartMillis: Date.parse("2026-02-01T07:00:00Z"), periodEndMillis: Date.parse("2026-02-28T06:59:59.999Z") },
    200, { call: s.call });
  assert.deepEqual(s.calls.map(([op, i]) => [op, i?.operatingCompanyId ?? null]), [["readMyFinanceCompanyAccess", null], ["listSettlements", "consolidated"]]);
  assert.deepEqual([s.calls[1][1].businessDateFrom, s.calls[1][1].businessDateTo], ["2026-02-01", "2026-02-28"], "the period travels as a business-date window");
  assert.deepEqual([out.result.invoices.length, out.result.payments.length, out.result.applications.length], [0, 1, 1]);
  const only = server({ readMyFinanceCompanyAccess: access(["taylor"]), listSettlements: { items: [settlement()] } });
  const receipts = await fetchFinancialFactsFromEos({ factTypes: ["PAYMENT_RECEIPT"] }, 200, { call: only.call });
  assert.deepEqual([receipts.result.payments.length, receipts.result.applications.length], [1, 0]);
});

test("reads: a settlement failure is all-or-nothing, a full settlement page is flagged, and an unknown family is refused before any read", async () => {
  const bad = server({ readMyFinanceCompanyAccess: access(["taylor"]), listSettlements: { ok: false, code: "INTERNAL" } });
  assert.deepEqual(await fetchFinancialFactsFromEos({ factTypes: ["PAYMENT_RECEIPT"] }, 200, { call: bad.call }), { errorStatus: "unavailable" });
  const forbidden = server({ readMyFinanceCompanyAccess: access(["taylor"]), listSettlements: { ok: false, code: "FORBIDDEN" } });
  assert.deepEqual(await fetchFinancialFactsFromEos({ factTypes: ["PAYMENT_RECEIPT"] }, 200, { call: forbidden.call }), { errorStatus: "denied" });
  const full = Array.from({ length: 100 }, (_, i) => settlement({ id: `stl-${i}`, applications: [] }));
  const page = server({ readMyFinanceCompanyAccess: access(["taylor"]), listSettlements: { items: full } });
  assert.equal((await fetchFinancialFactsFromEos({ factTypes: ["PAYMENT_RECEIPT"] }, 200, { call: page.call })).result.truncated, true);
  const unknown = server({});
  assert.deepEqual(await fetchFinancialFactsFromEos({ factTypes: ["INVOICE", "GOAL"] }, 200, { call: unknown.call }), { errorStatus: "unavailable" });
  assert.equal(unknown.calls.length, 0);
});

test("reads: an accountId asks for that account's receivables only and totals them from its own rows, with the per-company partition", async () => {
  const s = server({ readMyFinanceCompanyAccess: access(["taylor", "ventana"]), readFinanceOverview: overview(),
    listObligations: { items: [row()] } });
  // two companies reached: a consolidated answer is ONE call, and the summary partitions its rows by company
  const out = await fetchFinancialFactsFromEos({ accountId: " acct-t ", factTypes: ["INVOICE"] }, 200, { call: s.call });
  assert.equal(s.calls.some(([op]) => op === "readFinanceOverview"), false, "the company overview is not account-scoped, so it is not asked for");
  assert.equal(s.calls.find(([op]) => op === "listObligations")[1].crmAccountId, "acct-t", "the account travels as a narrowing request");
  assert.deepEqual([out.result.summary.count, out.result.summary.billedByCurrency, out.result.summary.outstandingByCurrency], [1, { USD: 40000 }, { USD: 24000 }]);
  assert.deepEqual(out.result.summary.companyIds, ["taylor"]);
  assert.equal(out.result.agingByCurrency, undefined, "no company aging is attributed to one account");
  // a full page cannot prove the account's total: unavailable, never a partial figure
  const full = Array.from({ length: 200 }, (_, i) => row({ id: `obl-${i}` }));
  const t = server({ readMyFinanceCompanyAccess: access(["taylor"]), listObligations: { items: full } });
  assert.deepEqual(await fetchFinancialFactsFromEos({ accountId: "acct-t", factTypes: ["INVOICE"] }, 200, { call: t.call }), { errorStatus: "unavailable" });
  // no accountId: the server's overview is still what totals the book
  const book = server({ readMyFinanceCompanyAccess: access(["taylor"]), readFinanceOverview: overview(), listObligations: { items: [row()] } });
  await fetchFinancialFactsFromEos({ factTypes: ["INVOICE"] }, 200, { call: book.call });
  assert.equal(book.calls.some(([op]) => op === "readFinanceOverview"), true);
  assert.equal(book.calls.find(([op]) => op === "listObligations")[1].crmAccountId, undefined);
});

test("receivablesEnvelope: accountScoped without an overview totals the rows; without accountScoped the totals stay absent", () => {
  const rec = { items: [row()], truncated: false };
  assert.equal(receivablesEnvelope({ overview: null, pages: [rec], accountScoped: true }).summary.outstandingByCurrency.USD, 24000);
  assert.equal(receivablesEnvelope({ overview: null, pages: [rec] }).summary, undefined);
  assert.equal(receivablesEnvelope({ overview: null, pages: [{ ...rec, truncated: true }], accountScoped: true }).status, "unavailable");
});
