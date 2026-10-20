// FINANCIALS ON EOS (Firebase exit B1, DECISIONS #B1) -- the pure adapters, the bounded principal-isolated reads, and the pins that no
// Firebase call remains on the EOS path. Run: node --test test/financialsEos.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  NOT_SUPPLIED, dayMillis, periodWindows, readableCompanies, receivablePosition, receivableRecord, receivablesEnvelope, reportingDay, settlementKindWords,
  settlementRecord,
} from "../src/domain/financialsEos.js";
import { fetchFinancialFactsFromEos, financeReader, OBLIGATION_PAGE_LIMIT, resolveScope } from "../src/services/eosFinancialsClient.js";
import { FINANCE_READ_OPERATIONS } from "../src/services/financeApiClient.js";
import { financialFactsState, agingSlots, lifecycleScorecard, FACTS_STATE } from "../src/domain/financialFactsView.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(here, "../src", rel), "utf8").replace(/\r\n/g, "\n");

const row = (over = {}) => ({
  id: "obl_aaaaaaaa-1", operatingCompanyId: "taylor", kind: "RECEIVABLE", currency: "USD", status: "OPEN", sourceDomain: "BILLING_PACKAGE", sourceRecordId: "bp-1",
  dueOn: "2026-01-15", overdue: true, originatedMinor: "40000", settledMinor: "16000", outstandingMinor: "24000",
  counterparty: { kind: "EXTERNAL_ORGANIZATION", crmAccountId: "acct-t", name: "Harbor Grill" }, ...over,
});
const currency = (over = {}) => ({ currency: "USD", count: 2, openCount: 2, overdueCount: 1, billedMinor: "95000", collectedMinor: "21000", outstandingMinor: "74000",
  aging: { currentMinor: "0", days1to30Minor: "0", days31to60Minor: "0", days61PlusMinor: "24000", unagedMinor: "50000" }, ...over });
const overview = (over = {}) => ({ scope: { operatingCompanyId: "consolidated", companies: ["taylor", "ventana"] }, visibility: { restricted: false }, currencies: [currency()],
  byCompany: [{ operatingCompanyId: "taylor", ...currency() }], ...over });
const access = (companies, over = {}) => ({ principalId: "p", consolidated: companies.length === 2, restricted: false,
  companies: companies.map((id) => ({ operatingCompanyId: id, visibility: "FULL", actions: {} })), ...over });

// A server stand-in: answers per operation from `answers` and records every call.
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

test("a receivable record keeps the register's figures, supplies no invoice number / issue date / business unit, and never invents one", () => {
  const r = receivableRecord(row());
  assert.deepEqual([r.invoiceId, r.invoiceNumber, r.issuedAtMillis, r.businessUnitIds, r.creditedSalespersonId], ["obl_aaaaaaaa-1", null, null, [], null]);
  assert.deepEqual([r.totalMinor, r.appliedMinor, r.outstandingMinor, r.arPosition], [40000, 16000, 24000, "OVERDUE"]);
  assert.equal(r.dueDate, new Date(2026, 0, 15).getTime());
  assert.equal(receivableRecord(row({ originatedMinor: "9007199254740993" })), null, "an unsafe amount is never presented");
  assert.equal(receivableRecord(row({ id: 5 })), null);
  for (const [status, expected] of [["VOID", "VOID"], ["SETTLED", "SETTLED"]]) assert.equal(receivablePosition(row({ status })), expected);
  assert.equal(receivablePosition(row({ overdue: false })), "CURRENT");
  assert.equal(receivablePosition(row({ overdue: false, dueOn: null })), "UNKNOWN", "no governed due date is never Current");
  for (const md of Object.values(NOT_SUPPLIED)) assert.match(md.words, /^Not supplied \(model decision MD-B1-\d/);
});

test("the envelope carries the SERVER's totals and aging, per currency, and adds nothing up", () => {
  const env = receivablesEnvelope({ overview: overview(), pages: [{ items: [row()], truncated: false }] });
  assert.equal(env.status, "ready");
  assert.equal(env.recordNoun, "Receivable");
  assert.deepEqual(env.summary.billedByCurrency, { USD: 95000 });
  assert.deepEqual(env.summary.outstandingByCurrency, { USD: 74000 });
  assert.equal(env.agingByCurrency.USD.days61PlusMinor, 24000);
  // The pages' own view layer reads it unchanged.
  const { state, result } = financialFactsState({ loading: false, errorStatus: null, result: env });
  assert.equal(state, FACTS_STATE.READY);
  assert.match(lifecycleScorecard(state, result).arOutstanding.valueText, /740\.00/);
  assert.equal(agingSlots(state, result).supplied, true);
  // No overview (a principal that reaches only SOME companies): totals are ABSENT, never assembled from rows.
  const noTotal = receivablesEnvelope({ overview: null, pages: [{ items: [row(), row({ id: "obl_2" })], truncated: false }] });
  assert.equal(noTotal.summary, undefined);
  assert.equal(noTotal.agingByCurrency, undefined);
  const s = financialFactsState({ loading: false, errorStatus: null, result: noTotal });
  assert.equal(lifecycleScorecard(s.state, s.result).arOutstanding.valueText, null, "the scorecard says it is not supplied");
  // A malformed row, page or amount makes the whole answer unavailable; a truncated page is flagged, not hidden.
  assert.equal(receivablesEnvelope({ overview: null, pages: [{ items: [row({ settledMinor: "x" })] }] }).status, "unavailable");
  assert.equal(receivablesEnvelope({ overview: null, pages: [{ items: undefined }] }).status, "unavailable");
  assert.equal(receivablesEnvelope({ overview: overview({ currencies: [currency({ billedMinor: "1.5" })] }), pages: [] }).status, "unavailable");
  assert.equal(receivablesEnvelope({ overview: null, pages: [{ items: [row()], truncated: true }] }).truncated, true);
});

test("period selections become EOS request windows (recorded instants for receivables, business days in the reporting zone for settlements)", () => {
  const start = Date.parse("2026-10-01T07:00:00Z"), end = Date.parse("2026-10-31T06:59:59.999Z"); // Phoenix is UTC-7, no DST
  const w = periodWindows({ periodStartMillis: start, periodEndMillis: end });
  assert.deepEqual(w.receivables, { recordedFrom: "2026-10-01T07:00:00.000Z", recordedTo: "2026-10-31T07:00:00.000Z" });
  assert.deepEqual(w.settlements, { businessDateFrom: "2026-10-01", businessDateTo: "2026-10-31" });
  assert.deepEqual(periodWindows({}), { receivables: {}, settlements: {} }, "no period: no window");
  assert.equal(reportingDay(Date.parse("2026-10-01T06:59:59Z")), "2026-09-30", "the reporting zone, not the browser's");
  assert.equal(dayMillis("not a day"), null);
});

test("settlements keep the server's amounts and name their kind in words", () => {
  const s = settlementRecord({ id: "stl_1", operatingCompanyId: "taylor", kind: "CUSTOMER_PAYMENT", currency: "USD", amountMinor: "10000", appliedMinor: "4000", unappliedMinor: "6000",
    businessDate: "2026-10-01", sourceReference: "ACH-1", status: "RECORDED", reconciliationStatus: "UNRECONCILED", applications: [{ id: "a" }] });
  assert.deepEqual([s.amountMinor, s.appliedMinor, s.unappliedMinor, s.applications.length], [10000, 4000, 6000, 1]);
  assert.equal(settlementKindWords("CUSTOMER_PAYMENT"), "Customer payment");
  assert.equal(settlementRecord({ id: "x", currency: "USD", amountMinor: "1", appliedMinor: "x", unappliedMinor: "0" }), null);
});

test("only the companies the server says can be opened are asked about; an empty-reach company reads nothing", () => {
  const list = readableCompanies({ companies: [{ operatingCompanyId: "taylor", visibility: "FULL" }, { operatingCompanyId: "ventana", visibility: "RESTRICTED_EMPTY" }] });
  assert.deepEqual(list.map((c) => c.operatingCompanyId), ["taylor"]);
  assert.equal(readableCompanies({ companies: "nope" }), null);
});

test("reads: consolidated principal -> one consolidated overview and one consolidated list; a company chip -> that company only", async () => {
  const s = server({ readMyFinanceCompanyAccess: access(["taylor", "ventana"]), readFinanceOverview: overview(), listObligations: { items: [row()] } });
  const out = await fetchFinancialFactsFromEos({ factTypes: ["INVOICE"] }, 200, { call: s.call });
  assert.equal(out.result.status, "ready");
  assert.deepEqual(s.calls.map(([op, i]) => [op, i?.operatingCompanyId ?? null]),
    [["readMyFinanceCompanyAccess", null], ["readFinanceOverview", "consolidated"], ["listObligations", "consolidated"]]);
  assert.equal(s.calls[2][1].kind, "RECEIVABLE");
  const one = server({ readMyFinanceCompanyAccess: access(["taylor", "ventana"]), readFinanceOverview: overview(), listObligations: { items: [] } });
  await fetchFinancialFactsFromEos({ companyId: "ventana", factTypes: ["INVOICE"] }, 200, { call: one.call });
  assert.deepEqual(one.calls.slice(1).map(([op, i]) => [op, i.operatingCompanyId]), [["readFinanceOverview", "ventana"], ["listObligations", "ventana"]]);
  // A company the server did not name is never requested, whatever the chip says.
  const only = server({ readMyFinanceCompanyAccess: access(["taylor"]), readFinanceOverview: overview(), listObligations: { items: [] } });
  const denied = await fetchFinancialFactsFromEos({ companyId: "ventana" }, 200, { call: only.call });
  assert.deepEqual(denied, { errorStatus: "denied" });
  assert.deepEqual(only.calls.map(([op]) => op), ["readMyFinanceCompanyAccess"]);
});

test("reads: one reached company is totalled by the server for that company; several-but-not-all get rows and NO total", async () => {
  const single = server({ readMyFinanceCompanyAccess: access(["taylor"]), readFinanceOverview: overview(), listObligations: { items: [row()] } });
  await fetchFinancialFactsFromEos({ factTypes: ["INVOICE"] }, 200, { call: single.call });
  assert.deepEqual(single.calls.slice(1).map(([op, i]) => [op, i.operatingCompanyId]), [["readFinanceOverview", "taylor"], ["listObligations", "taylor"]]);
  const three = server({ readMyFinanceCompanyAccess: access(["a", "b", "c"], { consolidated: false }), readFinanceOverview: overview(), listObligations: { items: [row()] } });
  const out = await fetchFinancialFactsFromEos({ factTypes: ["INVOICE"] }, 200, { call: three.call });
  assert.equal(three.calls.some(([op]) => op === "readFinanceOverview"), false, "no overview is asked for: the total is not assembled");
  assert.equal(out.result.summary, undefined);
  assert.equal(out.result.invoices.length, 3);
});

test("reads: the window travels as a request; a restricted reader is told so; a full page is flagged truncated", async () => {
  const full = Array.from({ length: OBLIGATION_PAGE_LIMIT }, (_, i) => row({ id: `obl_${i}` }));
  const s = server({ readMyFinanceCompanyAccess: access(["taylor"], { restricted: true }), readFinanceOverview: overview({ visibility: { restricted: true } }), listObligations: { items: full } });
  const out = await fetchFinancialFactsFromEos({ factTypes: ["INVOICE"], periodStartMillis: 1000, periodEndMillis: 2000 }, 200, { call: s.call });
  assert.deepEqual([out.result.truncated, out.result.restricted], [true, true]);
  assert.equal(s.calls[1][1].recordedFrom, new Date(1000).toISOString());
  assert.equal(s.calls[1][1].recordedTo, new Date(2001).toISOString());
});

test("reads: refusal is a permission fact only when the server says FORBIDDEN; everything else is unavailable; nothing waits forever", async () => {
  const forbidden = server({ readMyFinanceCompanyAccess: { ok: false, code: "FORBIDDEN" } });
  assert.deepEqual(await fetchFinancialFactsFromEos({}, 200, { call: forbidden.call }), { errorStatus: "denied" });
  for (const code of ["UNREACHABLE", "INTERNAL", "UNAVAILABLE", "NOT_CONFIGURED"]) {
    const s = server({ readMyFinanceCompanyAccess: { ok: false, code } });
    assert.deepEqual(await fetchFinancialFactsFromEos({}, 200, { call: s.call }), { errorStatus: "unavailable" }, code);
  }
  const noneVisible = server({ readMyFinanceCompanyAccess: { companies: [{ operatingCompanyId: "taylor", visibility: "RESTRICTED_EMPTY" }], consolidated: false, restricted: true } });
  assert.deepEqual(await fetchFinancialFactsFromEos({}, 200, { call: noneVisible.call }), { errorStatus: "denied" }, "nothing visible anywhere is a settled answer");
  assert.deepEqual(noneVisible.calls.map(([op]) => op), ["readMyFinanceCompanyAccess"]);
  const failedList = server({ readMyFinanceCompanyAccess: access(["taylor"]), readFinanceOverview: overview(), listObligations: { ok: false, code: "INTERNAL" } });
  assert.deepEqual(await fetchFinancialFactsFromEos({}, 200, { call: failedList.call }), { errorStatus: "unavailable" }, "all or nothing");
  const hung = await fetchFinancialFactsFromEos({}, 200, { call: () => new Promise(() => {}), timeoutMs: 20 });
  assert.deepEqual(hung, { errorStatus: "unavailable" });
  const unknown = server({});
  assert.deepEqual(await fetchFinancialFactsFromEos({ factTypes: ["FORECAST"] }, 200, { call: unknown.call }), { errorStatus: "unavailable" });
  assert.equal(unknown.calls.length, 0, "a fact family EOS does not serve is refused before any read");
});

test("the reader asks for exactly the finance operations the client declares, and a missing record is 'notFound', not a denial", async () => {
  const s = server({ readObligation: { ok: false, code: "NOT_FOUND" }, readSettlement: { ok: false, code: "NOT_FOUND" } });
  const reader = financeReader({ call: s.call });
  assert.deepEqual(await reader.receivable("obl_x"), { errorStatus: "notFound" });
  assert.deepEqual(await reader.settlement("stl_x"), { errorStatus: "notFound" });
  await reader.overview({ operatingCompanyId: "taylor" });
  await reader.settlements({ operatingCompanyId: "taylor" });
  for (const [op] of s.calls) assert.ok(FINANCE_READ_OPERATIONS.includes(op), `${op} is a declared Finance read`);
  assert.ok(FINANCE_READ_OPERATIONS.includes("readFinanceOverview"));
  const scope = await resolveScope(financeReader({ call: server({ readMyFinanceCompanyAccess: access(["taylor", "ventana"]) }).call }), null);
  assert.deepEqual(scope.scope, { companies: ["taylor", "ventana"], total: "consolidated" });
});

test("PINS: the facts hook and the page chooser decide by the build-time flag only; the EOS path imports no Firebase and has no fallback", () => {
  const hook = read("hooks/useFinancialFacts.js");
  assert.match(hook, /EOS_SESSION_SOURCE \? fetchFinancialFactsFromEos : fetchFinancialFacts/);
  const pages = read("modules/financials/financialsPages.js");
  assert.match(pages, /EOS_SESSION_SOURCE \? eos\(\) : legacy\(\)/);
  for (const f of ["modules/financials/FinancialsReceivablesEos.jsx", "modules/financials/FinancialsSettlementsEos.jsx", "modules/financials/FinancialsReceivableDetailEos.jsx",
    "modules/financials/FinancialsSettlementDetailEos.jsx", "services/eosFinancialsClient.js", "domain/financialsEos.js", "hooks/useEosFinanceRead.js"]) {
    const text = read(f).replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(text, /from\s+["'](firebase|\.\.?\/.*firebase\/firebase|.*financeReadCallableClient|.*useEmployeeDirectory)/, `${f}: no Firebase, no callable client, no Firestore directory`);
    assert.doesNotMatch(text, /httpsCallable|onSnapshot|getDocs|navigator\.onLine/, `${f}: no Firebase call`);
  }
  // The five record pages are chosen, not conditionally rendered: App.jsx takes them from the chooser.
  const app = read("App.jsx");
  assert.match(app, /financialsPages;/);
  assert.doesNotMatch(app, /import\("\.\/modules\/financials\/Financials(Invoices|Payments|InvoiceDetail|PaymentDetail|AccountsReceivable)\.jsx"\)/, "App.jsx names no legacy Financials page directly");
});
