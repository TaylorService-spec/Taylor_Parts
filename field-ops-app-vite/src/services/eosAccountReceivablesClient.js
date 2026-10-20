// The Account page's receivables, READ FROM EOS. Firebase exit F7c (DECISIONS #245).
//
//   browser -> THIS -> POST /operations/finance: readMyFinanceCompanyAccess, then listObligations (RECEIVABLE, one CRM Account)
//   -> verified bearer -> EOS Principal + tenant membership + capabilities -> PostgreSQL (functions/src/eosFinance/financeOperations.ts)
//
// It decides nothing. finance.payment.read and the caller's EXPLICIT operating-company assignments are decided by the server on
// every call: the companies asked about are only the ones the server itself says the caller reaches
// (`readMyFinanceCompanyAccess` -- advice, re-decided by `listObligations`), the Account id only NARROWS, and a company the
// caller does not reach is never requested. No Firebase.
//
// Same contract as services/financeReadCallableClient.js fetchAccountInvoiceAr: `{ result }` on an answer (the envelope
// domain/accountArView.js interprets) or `{ errorStatus }` ("denied" | "unavailable"), never a throw. The Firebase transport
// stays the sole source in a build that declares no EOS API (hooks/useAccountAr.js picks one at BUILD time).
import { callFinanceApi } from "./financeApiClient.js";
import { READ_TIMEOUT_MS, boundedRead } from "../access/boundedRead.js";
import { ACCOUNT_AR_STATE } from "../domain/accountArView.js";
import { accountArFromBalanceSummary, accountArFromObligations, OBLIGATION_PAGE_LIMIT } from "../domain/accountReceivablesEos.js";

const TIMED_OUT = Object.freeze({ ok: false, code: "UNREACHABLE" });
const denied = () => ({ errorStatus: ACCOUNT_AR_STATE.DENIED });
const unavailable = () => ({ errorStatus: ACCOUNT_AR_STATE.UNAVAILABLE });
// Only the server's own refusal is a permission fact; every other failure (unconfigured, unreachable, 5xx, malformed) is not.
const refusal = (res) => (res.code === "FORBIDDEN" ? denied() : unavailable());

/**
 * @param {string} accountId the CRM Account
 * @param {{ call?: typeof callFinanceApi, timeoutMs?: number }} [options] injectable transport and bound (tests)
 */
export async function fetchAccountReceivablesFromEos(accountId, { call: rawCall = callFinanceApi, timeoutMs = READ_TIMEOUT_MS } = {}) {
  // EVERY request is bounded (F1's boundedRead): one that does not answer in time is a failed read, which maps to "unavailable"
  // below, so a slow service is never an infinite "Loading receivables...". The abort cancels a real fetch.
  const call = (operation, input) => boundedRead((signal) => rawCall(operation, input, signal ? { signal } : {}), timeoutMs, TIMED_OUT);
  if (typeof accountId !== "string" || accountId.trim() === "") return unavailable();

  // A6: a caller the Finance workspace does not reach (the server refuses readMyFinanceCompanyAccess, or reaches it to no company) may still hold the
  // customer-balance SUMMARY (finance.accountBalance.read). The SERVER decides: this asks it for the summary and renders whatever it answers; a caller
  // who holds neither is refused there too, and that stays "denied". Nothing is inferred here from a capability the client holds.
  const summary = async () => {
    const res = await call("readAccountBalanceSummary", { crmAccountId: accountId });
    if (!res.ok) return refusal(res);
    const envelope = accountArFromBalanceSummary(res.result);
    return envelope.status === "ready" ? { result: envelope } : unavailable();
  };
  const access = await call("readMyFinanceCompanyAccess");
  if (!access.ok) return access.code === "FORBIDDEN" ? summary() : refusal(access);
  // B1 (DECISIONS #B1): a company whose inner Finance reach is EMPTY (the server says RESTRICTED_EMPTY) reads nothing, so it is not asked
  // about; the server still re-decides every read, and a restricted reader's rows are only the receivables it may see.
  const companies = Array.isArray(access.result?.companies)
    ? access.result.companies.filter((c) => c?.visibility !== "RESTRICTED_EMPTY").map((c) => c?.operatingCompanyId).filter((id) => typeof id === "string" && id.length > 0)
    : null;
  if (companies === null) return unavailable();
  // The server reaches this caller to no company: listObligations would refuse every one of them. The same answer, one call earlier.
  if (companies.length === 0) return summary();

  // One read per reached company (a consolidated read is just their union, and a per-company page keeps the 200-row bound per
  // company). All or nothing: a partial set of companies is never presented as the account's receivables.
  const reads = await Promise.all(
    companies.map((operatingCompanyId) => call("listObligations", { operatingCompanyId, crmAccountId: accountId, kind: "RECEIVABLE" })),
  );
  const failed = reads.find((r) => !r.ok);
  if (failed) return refusal(failed);

  const pages = reads.map((r) => {
    const items = r.result?.items;
    // A page AT the server's cap cannot be proven complete: unavailable, never a confident partial balance.
    return { items, truncated: Array.isArray(items) && items.length >= OBLIGATION_PAGE_LIMIT };
  });
  const result = accountArFromObligations(pages);
  // `restricted`: the server limited what this principal reads to the receivables credited to it / its team -- the screen says so.
  return result.status === "ready" ? { result: { ...result, restricted: access.result.restricted === true } } : unavailable();
}
