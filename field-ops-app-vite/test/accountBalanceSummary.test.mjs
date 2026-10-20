// A6 (Owner decision, 2026-10-19) -- the Account page's customer-balance SUMMARY for a role with no Finance workspace, proved offline.
//   * accountArFromBalanceSummary turns the server's five numbers per company and currency into the Account envelope (summaryOnly, no rows).
//   * eosAccountReceivablesClient asks the SERVER for the summary only when the Finance workspace refuses or reaches no company.
//   * accountArView / the Attention projection / the health strip say what a summary can honestly say: totals, never rows, never "nothing overdue" for a summary that says otherwise.
// The rendering (AccountArSection, AccountDetail by reader) is proved in accountAttentionSection.test.jsx and accountNorthStarPage.test.jsx.
// Server-side proof (reach, isolation, shape, no write path) is functions/test/a6AccountBalanceSummary*.test.mjs.
// Run: node --test test/accountBalanceSummary.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { accountArFromBalanceSummary } from "../src/domain/accountReceivablesEos.js";
import { accountArView, ACCOUNT_AR_STATE } from "../src/domain/accountArView.js";
import { accountArAttentionItems } from "../src/domain/accountAttentionProjection.js";
import { buildAccountHealthStrip } from "../src/domain/accountHealthStrip.js";
import { fetchAccountReceivablesFromEos } from "../src/services/eosAccountReceivablesClient.js";
import { FINANCE_READ_OPERATIONS, FINANCE_COMMAND_OPERATIONS } from "../src/services/financeApiClient.js";
import { ACCOUNT_BALANCE_GATE, SHELL_GATED_CAPABILITY_IDS } from "../src/access/shellCapabilityGates.js";

const answer = (summaries, extra = {}) => ({
  status: "READY", asOf: "2026-10-19T12:00:00.000Z", restricted: false,
  summaries: summaries.map(([operatingCompanyId, currency, openReceivableCount, outstandingMinor, overdueCount, overdueMinor]) =>
    ({ operatingCompanyId, currency, openReceivableCount, outstandingMinor, overdueCount, overdueMinor })),
  ...extra,
});
const TAYLOR = ["taylor", "USD", 3, "64000", 1, "40000"];
const VENTANA = ["ventana", "USD", 1, "11000", 1, "11000"];

test("the gate and the operation are declared: asked under its own name by the shell, mirrored as a Finance READ and not a command", () => {
  assert.deepEqual({ ...ACCOUNT_BALANCE_GATE }, { read: "finance.accountBalance.read" });
  assert.ok(SHELL_GATED_CAPABILITY_IDS.includes("finance.accountBalance.read"));
  assert.ok(FINANCE_READ_OPERATIONS.includes("readAccountBalanceSummary"));
  assert.ok(!FINANCE_COMMAND_OPERATIONS.includes("readAccountBalanceSummary"));
});

test("accountArFromBalanceSummary builds a summary-only envelope: no rows, totals per currency, per-company lines kept for the screen", () => {
  const env = accountArFromBalanceSummary(answer([TAYLOR, VENTANA]));
  assert.equal(env.status, "ready");
  assert.deepEqual(env.invoices, []);
  assert.equal(env.summaryOnly, true);
  assert.equal(env.recordNoun, "Receivable");
  assert.deepEqual({ ...env.summary }, { count: 4, openCount: 4, overdueCount: 2, outstandingByCurrency: { USD: 75000 } });
  assert.deepEqual(env.summaryRows, [
    { companyId: "taylor", currency: "USD", openCount: 3, outstandingMinor: 64000, overdueCount: 1, overdueMinor: 40000 },
    { companyId: "ventana", currency: "USD", openCount: 1, outstandingMinor: 11000, overdueCount: 1, overdueMinor: 11000 },
  ]);
});

test("it never sums across currencies, and carries the server's restricted flag", () => {
  assert.deepEqual({ ...accountArFromBalanceSummary(answer([TAYLOR, ["ventana", "CAD", 1, "500", 0, "0"]])).summary.outstandingByCurrency }, { USD: 64000, CAD: 500 });
  assert.equal(accountArFromBalanceSummary(answer([TAYLOR], { restricted: true })).restricted, true);
  assert.equal(accountArFromBalanceSummary(answer([TAYLOR])).restricted, undefined);
});

test("it is unavailable, never a confident partial figure, for the server's UNAVAILABLE, a malformed answer or an unsafe amount", () => {
  for (const bad of [null, undefined, {}, { status: "UNAVAILABLE", summaries: [] }, { status: "READY" }, { status: "READY", summaries: "x" },
    answer([["taylor", "USD", 1, "9007199254740993", 0, "0"]]), answer([["taylor", "USD", 1.5, "10", 0, "0"]]), answer([["taylor", "USD", 1, "ten", 0, "0"]]),
    answer([[null, "USD", 1, "10", 0, "0"]])]) {
    assert.equal(accountArFromBalanceSummary(bad).status, "unavailable", JSON.stringify(bad));
  }
});

test("an empty summary is a READY answer with nothing open", () => {
  const env = accountArFromBalanceSummary(answer([]));
  assert.equal(env.status, "ready");
  assert.deepEqual(accountArView({ result: env }), { kind: ACCOUNT_AR_STATE.EMPTY, recordNoun: "Receivable", summaryOnly: true });
  assert.deepEqual(accountArView({ result: accountArFromBalanceSummary(answer([], { restricted: true })) }),
    { kind: ACCOUNT_AR_STATE.EMPTY, recordNoun: "Receivable", summaryOnly: true, restricted: true });
});

const view = () => accountArView({ result: accountArFromBalanceSummary(answer([TAYLOR, VENTANA])) });

test("accountArView: READY with totals and one formatted line per company and currency, and no rows", () => {
  const v = view();
  assert.equal(v.kind, ACCOUNT_AR_STATE.READY);
  assert.equal(v.summaryOnly, true);
  assert.deepEqual(v.rows, []);
  assert.equal(v.openCount, 4);
  assert.equal(v.overdueCount, 2);
  assert.deepEqual(v.outstandingLines, [{ currency: "USD", text: "$750.00" }]);
  assert.deepEqual(v.summaryRows.map((r) => [r.companyLabel, r.openCount, r.outstandingText, r.overdueCount, r.overdueText]), [
    ["Taylor Freezer of Arizona", 3, "$640.00", 1, "$400.00"], ["Ventana", 1, "$110.00", 1, "$110.00"],
  ]);
});

test("the health strip shows the outstanding and past-due figures from the summary", () => {
  const [, outstanding, pastDue] = buildAccountHealthStrip({ workOrderCount: { loading: false, value: 0 }, arView: view() });
  assert.equal(outstanding.value, "$750.00");
  assert.equal(pastDue.value, "2");
});

test("the Attention projection does not report a summary as 'nothing overdue': the per-receivable items are not available to this reader", () => {
  const out = accountArAttentionItems(view(), { accountId: "acct-1" });
  assert.deepEqual(out.items, []);
  assert.equal(out.sourceStatus, "denied");
  // and a summary that is confirmed empty is still the healthy answer
  assert.equal(accountArAttentionItems(accountArView({ result: accountArFromBalanceSummary(answer([])) }), { accountId: "acct-1" }).sourceStatus, "ready");
});

// ── the transport ────────────────────────────────────────────────────────────────────
const okRes = (result) => ({ ok: true, result });
const failRes = (code, status = null) => ({ ok: false, code, status, reason: null, message: code });
function transport(handlers) {
  const calls = [];
  return { calls, call: async (operation, input) => { calls.push([operation, input ?? null]); return handlers[operation](input); } };
}

test("a workspace refusal falls to the summary, narrowed to the one Account, and no list is read", async () => {
  const t = transport({ readMyFinanceCompanyAccess: () => failRes("FORBIDDEN", 403), readAccountBalanceSummary: () => okRes(answer([TAYLOR])) });
  const { result, errorStatus } = await fetchAccountReceivablesFromEos("acct-1", { call: t.call });
  assert.equal(errorStatus, undefined);
  assert.equal(result.summaryOnly, true);
  assert.deepEqual(t.calls, [["readMyFinanceCompanyAccess", null], ["readAccountBalanceSummary", { crmAccountId: "acct-1" }]]);
});

test("a workspace that reaches no company also falls to the summary", async () => {
  const t = transport({ readMyFinanceCompanyAccess: () => okRes({ companies: [] }), readAccountBalanceSummary: () => okRes(answer([VENTANA])) });
  const { result } = await fetchAccountReceivablesFromEos("acct-1", { call: t.call });
  assert.deepEqual(result.summaryRows.map((r) => r.companyId), ["ventana"]);
  assert.deepEqual(t.calls.map(([op]) => op), ["readMyFinanceCompanyAccess", "readAccountBalanceSummary"]);
});

test("a caller who holds neither is DENIED; an unreachable or UNAVAILABLE summary is unavailable, never denied", async () => {
  const neither = transport({ readMyFinanceCompanyAccess: () => failRes("FORBIDDEN", 403), readAccountBalanceSummary: () => failRes("FORBIDDEN", 403) });
  assert.deepEqual(await fetchAccountReceivablesFromEos("acct-1", { call: neither.call }), { errorStatus: "denied" });
  const down = transport({ readMyFinanceCompanyAccess: () => failRes("FORBIDDEN", 403), readAccountBalanceSummary: () => failRes("UNREACHABLE") });
  assert.deepEqual(await fetchAccountReceivablesFromEos("acct-1", { call: down.call }), { errorStatus: "unavailable" });
  const tooWide = transport({ readMyFinanceCompanyAccess: () => failRes("FORBIDDEN", 403),
    readAccountBalanceSummary: () => okRes({ status: "UNAVAILABLE", reason: "VISIBILITY_TOO_WIDE", summaries: [] }) });
  assert.deepEqual(await fetchAccountReceivablesFromEos("acct-1", { call: tooWide.call }), { errorStatus: "unavailable" });
});

test("a Finance reader is unchanged: the summary is never asked for", async () => {
  const t = transport({ readMyFinanceCompanyAccess: () => okRes({ companies: [{ operatingCompanyId: "taylor" }] }), listObligations: () => okRes({ items: [] }) });
  const { result } = await fetchAccountReceivablesFromEos("acct-1", { call: t.call });
  assert.equal(result.status, "ready");
  assert.equal(result.summaryOnly, undefined);
  assert.deepEqual(t.calls.map(([op]) => op), ["readMyFinanceCompanyAccess", "listObligations"]);
});

test("an unreachable workspace is unavailable and does NOT fall to the summary (only the server's refusal does)", async () => {
  const t = transport({ readMyFinanceCompanyAccess: () => failRes("UNREACHABLE") });
  assert.deepEqual(await fetchAccountReceivablesFromEos("acct-1", { call: t.call }), { errorStatus: "unavailable" });
  assert.equal(t.calls.length, 1);
});
