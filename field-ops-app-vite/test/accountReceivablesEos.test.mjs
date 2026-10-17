// FIREBASE EXIT F7c (DECISIONS #245) -- the Account page's receivables from EOS (listObligations), proved offline.
// Run: node --test test/accountReceivablesEos.test.mjs
//
// Three things must hold for the move to be honest:
//   1. The adapter hands accountArView the SAME envelope the Firebase callable did, classified from the server's own facts,
//      totalled per currency and per governed company, and unavailable (never a confident partial) when it cannot be complete.
//   2. The transport asks the server ONLY for what the server says the caller reaches, narrows by Account and kind, and maps the
//      server's refusal to "denied" and every other failure to "unavailable".
//   3. The source is a BUILD-time choice and the EOS path never touches Firebase.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { accountArFromObligations, receivablePosition, OBLIGATION_PAGE_LIMIT, EOS_RECORD_NOUN } from "../src/domain/accountReceivablesEos.js";
import { accountArView, ACCOUNT_AR_STATE } from "../src/domain/accountArView.js";
import { accountArAttentionItems } from "../src/domain/accountAttentionProjection.js";
import { buildAccountHealthStrip } from "../src/domain/accountHealthStrip.js";
import { fetchAccountReceivablesFromEos } from "../src/services/eosAccountReceivablesClient.js";
import { eosKeyForFirebaseId } from "../src/access/eosCapabilityAccess.js";

const row = (o = {}) => ({
  id: "ob-1", operatingCompanyId: "taylor", kind: "RECEIVABLE", currency: "USD", status: "OPEN", sourceDomain: "BILLING_PACKAGE",
  sourceRecordId: "bpk-1", dueOn: "2026-11-01", overdue: false, originatedMinor: "10000", settledMinor: "0", outstandingMinor: "10000",
  counterparty: { kind: "EXTERNAL_ORGANIZATION", crmAccountId: "acct-1", name: "Harbor" }, ...o,
});
const page = (items, truncated = false) => ({ items, truncated });

test("position is classified from the server's own facts: void, settled, overdue flag, due date presence", () => {
  assert.equal(receivablePosition(row({ status: "VOID" }), 0), "VOID");
  assert.equal(receivablePosition(row({ status: "SETTLED" }), 0), "SETTLED");
  assert.equal(receivablePosition(row({ status: "PARTIAL" }), 0), "SETTLED", "nothing outstanding is settled whatever the status says");
  assert.equal(receivablePosition(row({ overdue: true }), 10), "OVERDUE");
  assert.equal(receivablePosition(row({ status: "PARTIAL", overdue: true }), 4), "OVERDUE");
  assert.equal(receivablePosition(row(), 10), "CURRENT");
  assert.equal(receivablePosition(row({ dueOn: null }), 10), "UNKNOWN", "no governed due date is not 'current'");
});

test("the envelope is the callable's: status, rows and a summary that mirrors summarizeAccountAr", () => {
  const out = accountArFromObligations([
    page([
      row({ id: "a", overdue: true, outstandingMinor: "7000", settledMinor: "3000" }),
      row({ id: "b", status: "SETTLED", outstandingMinor: "0", settledMinor: "10000" }),
      row({ id: "c", status: "VOID", outstandingMinor: "0", settledMinor: "0" }),
    ]),
    page([row({ id: "d", operatingCompanyId: "ventana", currency: "CAD", outstandingMinor: "500", originatedMinor: "500" })]),
  ]);
  assert.equal(out.status, "ready");
  assert.equal(out.recordNoun, EOS_RECORD_NOUN);
  assert.deepEqual(out.invoices.map((i) => [i.invoiceId, i.arPosition, i.companyId]), [
    ["a", "OVERDUE", "taylor"], ["b", "SETTLED", "taylor"], ["c", "VOID", "taylor"], ["d", "CURRENT", "ventana"]]);
  const s = out.summary;
  assert.deepEqual([s.count, s.openCount, s.overdueCount], [4, 2, 1], "a settled and a void record are not open");
  assert.deepEqual(s.outstandingByCurrency, { USD: 7000, CAD: 500 }, "never blended across currencies");
  assert.deepEqual(s.billedByCurrency, { USD: 30000, CAD: 500 });
  assert.deepEqual(s.collectedByCurrency, { USD: 13000, CAD: 0 });
  assert.deepEqual(s.companyIds, ["taylor", "ventana"]);
  assert.equal(s.spansMultipleCompanies, true);
  assert.deepEqual(s.byCompany.taylor, { count: 3, openCount: 1, overdueCount: 1,
    billedByCurrency: { USD: 30000 }, collectedByCurrency: { USD: 13000 }, outstandingByCurrency: { USD: 7000 } });
  assert.deepEqual(s.byCompany.ventana.outstandingByCurrency, { CAD: 500 });
  // the partition reconciles to the consolidated totals EXACTLY (the property summarizeAccountAr pins on the server)
  const sum = (key) => Object.values(s.byCompany).reduce((acc, c) => { for (const [cur, v] of Object.entries(c[key])) acc[cur] = (acc[cur] ?? 0) + v; return acc; }, {});
  for (const key of ["billedByCurrency", "collectedByCurrency", "outstandingByCurrency"]) assert.deepEqual(sum(key), s[key], key);
});

test("fields the register does not hold are absent, never invented", () => {
  const [r] = accountArFromObligations([page([row()])]).invoices;
  assert.equal(r.invoiceNumber, null);
  assert.equal(r.salesOrderId, null);
  assert.equal(r.daysOverdue, null, "the register supplies an overdue FLAG; a day count is never computed from a date on the client");
  assert.equal(r.accountId, "acct-1");
});

test("a page that may be truncated, a malformed row or an unsafe amount is unavailable -- never a partial answer", () => {
  assert.equal(accountArFromObligations([page([row()], true)]).status, "unavailable");
  assert.equal(accountArFromObligations([page([row()]), page([row({ id: "x" })], true)]).status, "unavailable", "one truncated company spoils the account");
  assert.equal(accountArFromObligations([page([row({ id: undefined })])]).status, "unavailable");
  assert.equal(accountArFromObligations([page([row({ outstandingMinor: "9007199254740993" })])]).status, "unavailable");
  assert.equal(accountArFromObligations([page([row({ originatedMinor: "12.5" })])]).status, "unavailable");
  assert.equal(accountArFromObligations([{ items: null, truncated: false }]).status, "unavailable");
  assert.equal(accountArFromObligations(null).status, "unavailable");
});

test("accountArView and its consumers read the EOS envelope unchanged, and word the record truthfully", () => {
  const view = accountArView({ result: accountArFromObligations([page([row({ overdue: true }), row({ id: "ob-2" })])]) });
  assert.equal(view.kind, ACCOUNT_AR_STATE.READY);
  assert.equal(view.recordNoun, "Receivable");
  assert.equal(view.openCount, 2);
  assert.equal(view.overdueCount, 1);
  assert.equal(view.rows[0].invoiceNumber, "ob-1", "the register's own reference (the obligation id) stands where an invoice number would");
  assert.equal(view.rows[0].daysOverdueText, null);
  const attention = accountArAttentionItems(view, { accountId: "acct-1" });
  assert.equal(attention.items.length, 1);
  assert.equal(attention.items[0].recordNoun, "Receivable");
  assert.equal(attention.items[0].objectType, "receivable");
  const strip = buildAccountHealthStrip({ workOrderCount: { value: 0, loading: false, error: false }, arView: view });
  assert.ok(strip.some((m) => /Outstanding AR/.test(m.label)));
  // an empty answer still names its noun, so "No receivables on this account." is worded from the read, not guessed
  assert.deepEqual(accountArView({ result: accountArFromObligations([page([])]) }), { kind: ACCOUNT_AR_STATE.EMPTY, recordNoun: "Receivable" });
  // the Firebase envelope (no noun) is worded exactly as before
  const fb = accountArView({ result: { status: "ready", invoices: [{ invoiceId: "1", invoiceNumber: "INV-1", currency: "USD", outstandingMinor: 1, arPosition: "CURRENT" }],
    summary: { count: 1, openCount: 1, overdueCount: 0, outstandingByCurrency: { USD: 1 } } } });
  assert.equal(fb.recordNoun, "Invoice");
});

// ── the transport ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const okRes = (result) => ({ ok: true, result });
const failRes = (code, status = null) => ({ ok: false, code, status, reason: null, message: code });
function transport(handlers) {
  const calls = [];
  const call = async (operation, input) => {
    calls.push([operation, input ?? null]);
    return handlers[operation](input);
  };
  return { call, calls };
}
const access = (...companies) => okRes({ companies: companies.map((operatingCompanyId) => ({ operatingCompanyId })), consolidated: companies.length > 1 });

test("it asks only for the companies the server says the caller reaches, narrowed to the Account and to receivables", async () => {
  const t = transport({
    readMyFinanceCompanyAccess: () => access("taylor", "ventana"),
    listObligations: (input) => okRes({ scope: input.operatingCompanyId, items: [row({ id: `ob-${input.operatingCompanyId}`, operatingCompanyId: input.operatingCompanyId })] }),
  });
  const { result, errorStatus } = await fetchAccountReceivablesFromEos("acct-1", { call: t.call });
  assert.equal(errorStatus, undefined);
  assert.equal(result.summary.spansMultipleCompanies, true);
  assert.deepEqual(t.calls, [
    ["readMyFinanceCompanyAccess", null],
    ["listObligations", { operatingCompanyId: "taylor", crmAccountId: "acct-1", kind: "RECEIVABLE" }],
    ["listObligations", { operatingCompanyId: "ventana", crmAccountId: "acct-1", kind: "RECEIVABLE" }],
  ]);
});

test("a Taylor-only caller never asks about Ventana", async () => {
  const t = transport({
    readMyFinanceCompanyAccess: () => access("taylor"),
    listObligations: () => okRes({ items: [] }),
  });
  const { result } = await fetchAccountReceivablesFromEos("acct-1", { call: t.call });
  assert.equal(result.status, "ready");
  assert.deepEqual(t.calls.filter(([op]) => op === "listObligations").map(([, i]) => i.operatingCompanyId), ["taylor"]);
});

test("the server's refusal is DENIED; nothing else is", async () => {
  const forbidden = transport({ readMyFinanceCompanyAccess: () => failRes("FORBIDDEN", 403) });
  assert.deepEqual(await fetchAccountReceivablesFromEos("acct-1", { call: forbidden.call }), { errorStatus: "denied" });
  // reaches no company: the same answer listObligations would give, one call earlier
  const none = transport({ readMyFinanceCompanyAccess: () => access() });
  assert.deepEqual(await fetchAccountReceivablesFromEos("acct-1", { call: none.call }), { errorStatus: "denied" });
  assert.equal(none.calls.length, 1);
  // a company refused on the read itself (access changed between the two calls) is still the server's refusal
  const raced = transport({ readMyFinanceCompanyAccess: () => access("taylor", "ventana"),
    listObligations: (i) => (i.operatingCompanyId === "ventana" ? failRes("FORBIDDEN", 403) : okRes({ items: [] })) });
  assert.deepEqual(await fetchAccountReceivablesFromEos("acct-1", { call: raced.call }), { errorStatus: "denied" });
  for (const code of ["NOT_CONFIGURED", "NOT_SIGNED_IN", "UNREACHABLE", "UNAVAILABLE", "INTERNAL", "UNAUTHENTICATED"]) {
    const t = transport({ readMyFinanceCompanyAccess: () => failRes(code) });
    assert.deepEqual(await fetchAccountReceivablesFromEos("acct-1", { call: t.call }), { errorStatus: "unavailable" }, code);
  }
  const listFails = transport({ readMyFinanceCompanyAccess: () => access("taylor"), listObligations: () => failRes("UNREACHABLE") });
  assert.deepEqual(await fetchAccountReceivablesFromEos("acct-1", { call: listFails.call }), { errorStatus: "unavailable" });
});

test("a malformed access answer, a page at the server's cap and a blank account are unavailable, and a blank account asks nothing", async () => {
  const malformed = transport({ readMyFinanceCompanyAccess: () => okRes({ companies: "taylor" }) });
  assert.deepEqual(await fetchAccountReceivablesFromEos("acct-1", { call: malformed.call }), { errorStatus: "unavailable" });
  const full = Array.from({ length: OBLIGATION_PAGE_LIMIT }, (_, i) => row({ id: `ob-${i}` }));
  const capped = transport({ readMyFinanceCompanyAccess: () => access("taylor"), listObligations: () => okRes({ items: full }) });
  assert.deepEqual(await fetchAccountReceivablesFromEos("acct-1", { call: capped.call }), { errorStatus: "unavailable" }, "200 rows cannot be proven complete");
  const justUnder = transport({ readMyFinanceCompanyAccess: () => access("taylor"), listObligations: () => okRes({ items: full.slice(1) }) });
  assert.equal((await fetchAccountReceivablesFromEos("acct-1", { call: justUnder.call })).result.status, "ready");
  for (const blank of ["", "   ", null, undefined, 5]) {
    const t = transport({});
    assert.deepEqual(await fetchAccountReceivablesFromEos(blank, { call: t.call }), { errorStatus: "unavailable" });
    assert.equal(t.calls.length, 0);
  }
});

// ── the seam ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
const here = path.dirname(fileURLToPath(import.meta.url));
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const src = (rel) => stripComments(readFileSync(path.resolve(here, "../src", rel), "utf8"));
const NO_FIREBASE = /from\s+["'][^"']*firebase[^"']*["']|import\(\s*["'][^"']*firebase[^"']*["']\s*\)|httpsCallable|onSnapshot|getDoc\b/;

test("the EOS path never touches Firebase, and the source is chosen once at BUILD time with F1's flag", () => {
  for (const f of ["services/eosAccountReceivablesClient.js", "domain/accountReceivablesEos.js", "access/accountArSource.js"]) {
    assert.doesNotMatch(src(f), NO_FIREBASE, f);
  }
  const hook = src("hooks/useAccountAr.js");
  assert.match(hook, /EOS_SESSION_SOURCE\s*\?\s*fetchAccountReceivablesFromEos\s*:\s*fetchAccountInvoiceAr/, "a compile-time ternary");
  assert.match(hook, /from\s+["']\.\.\/access\/eosSessionSource\.js["']/);
  assert.doesNotMatch(hook, /catch|\.then\(\s*\(\s*\{\s*errorStatus/, "no runtime fallback from one source to the other");
  assert.doesNotMatch(src("access/eosSessionSource.js"), /localStorage|sessionStorage|URLSearchParams|location\./, "no runtime override");
  // the Firebase transport is untouched: production keeps it as the sole source
  assert.match(src("services/financeReadCallableClient.js"), /listAccountInvoiceAr/);
});

// ── the gate ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("the Account's finance gate is asked under the key the read applies, and the split gave both keys to the same Roles", () => {
  // listObligations' view key (functions/src/eosFinance/financeOperations.ts FINANCE_VIEW_CAPABILITY)
  const server = readFileSync(path.resolve(here, "../../functions/src/eosFinance/financeOperations.ts"), "utf8");
  assert.match(server, /FINANCE_VIEW_CAPABILITY = "finance\.payment\.read"/);
  assert.equal(eosKeyForFirebaseId("finance.read"), "finance.payment.read");
  // The Owner's finance split (migration 1761609600000): finance.read -> finance.invoice.read / finance.payment.read, each to
  // exactly the Roles that held finance.read. So moving the gate from the invoice key to the payment key moves no holder.
  const sql = readFileSync(path.resolve(here, "../../functions/migrations/1761609600000_finance-administration-reorder-vocabulary.sql"), "utf8");
  const holders = (kind) => [...sql.matchAll(new RegExp(`\\('([A-Za-z]+)',\\s*'finance\\.${kind}\\.read'\\)`, "g"))].map((m) => m[1]).sort();
  const invoice = holders("invoice");
  assert.ok(invoice.length >= 14, `expected the 14 Roles, saw ${invoice.length}`);
  assert.deepEqual(holders("payment"), invoice);
  // ...and the whole grant baseline, which includes every LATER grant: any future divergence of the two keys fails here.
  const baseline = JSON.parse(readFileSync(path.resolve(here, "../../functions/src/adminPolicy/seed/roleCapabilityAuthorityBaseline.json"), "utf8"));
  const baselineHolders = (key) => baseline.grants.filter((g) => g.capabilityKey === key).map((g) => g.roleKey).sort();
  assert.ok(baselineHolders("finance.payment.read").length >= 14);
  assert.deepEqual(baselineHolders("finance.payment.read"), baselineHolders("finance.invoice.read"),
    "finance.invoice.read and finance.payment.read must keep identical holders while the Account gate is asked under the payment key");
});

// ── every request is bounded ───────────────────────────────────────────────────────────────────────────────────────────────
test("a request that never answers is a failed read: unavailable (not denied, not an endless Loading), and the signal is passed", async () => {
  const never = new Promise(() => {});
  const seen = [];
  const hang = async (operation, input, options) => { seen.push([operation, options]); return never; };
  const first = await fetchAccountReceivablesFromEos("acct-1", { call: hang, timeoutMs: 20 });
  assert.deepEqual(first, { errorStatus: "unavailable" });
  assert.equal(seen.length, 1);
  assert.ok(seen[0][1].signal instanceof AbortSignal, "the abort reaches a real fetch");
  assert.equal(seen[0][1].signal.aborted, true, "and is fired on expiry");

  // the second stage is bounded too: access answers, listObligations hangs
  const t = transport({ readMyFinanceCompanyAccess: () => access("taylor") });
  const stalls = async (operation, input, options) => (operation === "listObligations" ? never : t.call(operation, input, options));
  assert.deepEqual(await fetchAccountReceivablesFromEos("acct-1", { call: stalls, timeoutMs: 20 }), { errorStatus: "unavailable" });
  // a call that throws is a failed read as well
  const throws = async () => { throw new Error("boom"); };
  assert.deepEqual(await fetchAccountReceivablesFromEos("acct-1", { call: throws, timeoutMs: 20 }), { errorStatus: "unavailable" });
});
