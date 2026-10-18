// The Financials pages' reads, FROM EOS. Firebase exit B1 (DECISIONS #B1).
//
//   browser -> THIS -> POST /operations/finance: readMyFinanceCompanyAccess, readFinanceOverview, listObligations, readObligation,
//   listSettlements, readSettlement -> verified bearer -> EOS Principal + tenant + capabilities -> PostgreSQL
//   (functions/src/eosFinance/financeOperations.ts)
//
// It decides nothing. finance.payment.read, the caller's EXPLICIT operating-company assignments AND the credited-person / team
// reach are decided by the server on every call; this module asks only for what the server itself says the caller may open, and a
// company the server did not name is never requested. EVERY request is bounded (access/boundedRead.js) so a slow service is a
// settled "unavailable", never an endless "Loading". No Firebase, no fallback, no cache: each call is a fresh, bounded,
// principal-authenticated read (the bearer is the signed-in principal's own).
//
// Contract: `{ result }` on an answer, or `{ errorStatus: "denied" | "unavailable" | "notFound" }`; never a throw.
import { callFinanceApi } from "./financeApiClient.js";
import { READ_TIMEOUT_MS, boundedRead } from "../access/boundedRead.js";
import { periodWindows, readableCompanies, receivablesEnvelope } from "../domain/financialsEos.js";

/** The server's cap on one `listObligations` page (financeOperations.ts obligationRows(..., 200)). */
export const OBLIGATION_PAGE_LIMIT = 200;

const TIMED_OUT = Object.freeze({ ok: false, code: "UNREACHABLE" });
const DENIED = Object.freeze({ errorStatus: "denied" });
const UNAVAILABLE = Object.freeze({ errorStatus: "unavailable" });
const NOT_FOUND = Object.freeze({ errorStatus: "notFound" });
// Only the server's own refusal is a permission fact; every other failure (unconfigured, unreachable, 5xx, malformed) is not.
const refusal = (res) => (res.code === "FORBIDDEN" ? DENIED : res.code === "NOT_FOUND" ? NOT_FOUND : UNAVAILABLE);

/** @param {{ call?: typeof callFinanceApi, timeoutMs?: number }} [options] injectable transport and bound (tests) */
export function financeReader({ call: rawCall = callFinanceApi, timeoutMs = READ_TIMEOUT_MS } = {}) {
  const call = (operation, input) => boundedRead((signal) => rawCall(operation, input, signal ? { signal } : {}), timeoutMs, TIMED_OUT);
  const read = async (operation, input) => {
    const res = await call(operation, input);
    return res.ok ? { result: res.result } : refusal(res);
  };
  return Object.freeze({
    access: () => read("readMyFinanceCompanyAccess"),
    overview: (input) => read("readFinanceOverview", input),
    receivables: (input) => read("listObligations", { kind: "RECEIVABLE", ...input }),
    receivable: (obligationId) => read("readObligation", { obligationId }),
    settlements: (input) => read("listSettlements", input),
    settlement: (settlementId) => read("readSettlement", { settlementId }),
  });
}

/** The companies to read for a page and whether the server can total them in one answer. */
export async function resolveScope(reader, companyId) {
  const access = await reader.access();
  if (!access.result) return access;
  const readable = readableCompanies(access.result);
  if (readable === null) return UNAVAILABLE;
  // Nothing visible at any company the principal reaches (or none reached): a settled permission answer, not "no records".
  if (readable.length === 0) return DENIED;
  const ids = readable.map((c) => c.operatingCompanyId);
  if (companyId && companyId !== "consolidated") {
    return ids.includes(companyId) ? { scope: { companies: [companyId], total: companyId }, access: access.result } : DENIED;
  }
  // Consolidated: one server answer when the principal reaches EVERY active company; one company when it reaches exactly one; and
  // with several-but-not-all, the rows of each and NO total (a total is never assembled here).
  if (access.result.consolidated === true) return { scope: { companies: ids, total: "consolidated" }, access: access.result };
  return { scope: { companies: ids, total: ids.length === 1 ? ids[0] : null }, access: access.result };
}

/**
 * `listFinancialFacts`'s replacement where an EOS API is declared: the receivables envelope (rows + the server's own totals and
 * aging). Only the INVOICE fact family exists in EOS (a receivable); payments are settlements and have their own reads.
 *
 * @param {{ companyId?: string|null, factTypes?: string[], periodStartMillis?: number, periodEndMillis?: number }} filters
 */
export async function fetchFinancialFactsFromEos(filters = {}, _limit = OBLIGATION_PAGE_LIMIT, options = {}) {
  const types = Array.isArray(filters.factTypes) && filters.factTypes.length > 0 ? filters.factTypes : ["INVOICE"];
  if (!types.includes("INVOICE")) return UNAVAILABLE;
  const reader = financeReader(options);
  const resolved = await resolveScope(reader, filters.companyId);
  if (resolved.errorStatus) return resolved;
  const { companies, total } = resolved.scope;
  const window = periodWindows(filters).receivables;
  const asked = companies.length > 1 && total === "consolidated" ? ["consolidated"] : companies;
  const [overview, ...lists] = await Promise.all([
    total === null ? Promise.resolve({ result: null }) : reader.overview({ operatingCompanyId: total, ...window }),
    ...asked.map((operatingCompanyId) => reader.receivables({ operatingCompanyId, ...window })),
  ]);
  for (const r of [overview, ...lists]) if (r.errorStatus) return r;
  const pages = lists.map((r) => ({ items: r.result?.items, truncated: Array.isArray(r.result?.items) && r.result.items.length >= OBLIGATION_PAGE_LIMIT }));
  const envelope = receivablesEnvelope({ overview: overview.result, pages });
  return envelope.status === "ready" ? { result: envelope } : UNAVAILABLE;
}
