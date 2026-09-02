// FINANCIALS REPORTING READ — PURE view model for the governed `listFinancialFacts` callable
// (functions/src/finance/financialReportingRead.ts). No Firebase import; unit-testable in Node.
//
// ════════════ THIS MODULE DOES NO MONEY ARITHMETIC ════════════
//
// Every figure it renders was summed by the server, which is the only place that knows what the
// principal was allowed to see. The client formats and labels; it never adds, never nets, never
// buckets. If a figure a page wants is not in the envelope, the honest answer is that the read
// does not supply it — not a total computed here from rows that may themselves be a partial slice.
//
// ════════════ UNATTRIBUTED IS NOT ZERO ════════════
//
// The invoices in this system predate FIN-002's attribution stamping in part: an invoice issued by
// the currently deployed command build carries `companyId` but no `attribution` and no line
// `businessUnitId`. Those facts are REAL and VISIBLE; they simply cannot be placed on a salesperson
// or unit axis. The server counts them in `unattributed`, and the sentences below name that count
// so a performance table reads "3 invoices carry no credited salesperson" rather than showing a
// person's row at zero — which would be a claim about their performance that nobody made.

import { formatMoneyDisplay } from "./moneyDisplay.js";

export const FACTS_STATE = Object.freeze({
  LOADING: "LOADING",
  DENIED: "DENIED",
  UNAVAILABLE: "UNAVAILABLE",
  EMPTY: "EMPTY",
  READY: "READY",
});

/**
 * Map the {loading, errorStatus, result} chain onto ONE honest state.
 *
 * `status: "unavailable"` from the server is a real answer, not a failure: the callable refuses to
 * label a truncated page "ready" rather than summarizing a partial set confidently. It maps to
 * UNAVAILABLE for exactly that reason — the page must not present it as "nothing here".
 */
export function financialFactsState({ loading, errorStatus, result }) {
  if (loading) return { state: FACTS_STATE.LOADING };
  if (errorStatus === "denied") return { state: FACTS_STATE.DENIED };
  if (errorStatus === "unavailable" || result == null) return { state: FACTS_STATE.UNAVAILABLE };
  if (result.status !== "ready") return { state: FACTS_STATE.UNAVAILABLE };
  if (!Array.isArray(result.invoices) || result.invoices.length === 0) {
    return { state: FACTS_STATE.EMPTY, result };
  }
  return { state: FACTS_STATE.READY, result };
}

/** The honest-state detail sentence for each non-ready state. Contract copy — states the fact, only. */
export const FACTS_DETAIL = Object.freeze({
  [FACTS_STATE.DENIED]:
    "The server refused this read for your principal. That is a permission fact about your governed financial visibility, not an absence of records — reach requires both the finance fact-family gate and a visibility scope.",
  [FACTS_STATE.UNAVAILABLE]:
    "The governed read did not return a complete result, so nothing is shown. The server refuses to summarize a partial page: an incomplete financial total is worse than none.",
  [FACTS_STATE.EMPTY]:
    "The governed read answered, and no records fall within your visibility scope for this filter. This is a real result, not a failure.",
});

const money = (minor, currency) => formatMoneyDisplay(minor, currency);

/**
 * Format a per-currency map the server produced. Multiple currencies render as separate amounts —
 * they are never combined, here or anywhere. An empty map is an honest dash, not a zero: the server
 * omits a currency with nothing in it, and printing "$0.00" would assert a balance it never stated.
 */
export function formatByCurrency(byCurrency) {
  const entries = Object.entries(byCurrency ?? {}).filter(([, v]) => typeof v === "number");
  if (entries.length === 0) return "—";
  return entries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, minor]) => money(minor, currency))
    .join(" · ");
}

const AR_POSITION_WORDS = Object.freeze({
  OVERDUE: "Overdue",
  CURRENT: "Current",
  SETTLED: "Settled",
  VOID: "Void",
  UNKNOWN: "Position not recorded",
});

/** One invoice row, ready to render. Every amount is the server's; only the wording is ours. */
export function invoiceRow(read) {
  return {
    invoiceId: read.invoiceId,
    invoiceNumber: read.invoiceNumber ?? read.invoiceId,
    accountId: read.accountId,
    companyId: read.companyId,
    // "Mixed" is the collection-level truth for a cross-unit invoice: line-level BU is the only
    // unit fact, so no single unit may be printed in a header cell (FIN-002).
    businessUnit:
      read.businessUnitIds.length === 0
        ? "Not attributed"
        : read.businessUnitIds.length === 1
          ? read.businessUnitIds[0]
          : "Mixed",
    creditedSalespersonId: read.creditedSalespersonId,
    issuedAtMillis: read.issuedAtMillis,
    dueDate: read.dueDate,
    total: money(read.totalMinor, read.currency),
    applied: money(read.appliedMinor, read.currency),
    outstanding: money(read.outstandingMinor, read.currency),
    position: AR_POSITION_WORDS[read.arPosition] ?? "Position not recorded",
    positionTone: read.arPosition === "OVERDUE" ? "critical" : read.arPosition === "SETTLED" ? "positive" : "info",
    daysOverdue: read.daysOverdue,
  };
}

/** The open-exposure rows for A/R: the same server figures, restricted to what is actually owed. */
export function outstandingRows(result) {
  return (result?.invoices ?? []).filter((i) => i.outstandingMinor > 0).map(invoiceRow);
}

/** One rollup row. `key` is a governed id; the caller supplies the human label for it. */
export function rollupRow(row) {
  return {
    key: row.key,
    invoiceCount: row.invoiceCount,
    billed: formatByCurrency(row.billedByCurrency),
    collected: formatByCurrency(row.collectedByCurrency),
    outstanding: formatByCurrency(row.outstandingByCurrency),
  };
}

/**
 * The sentence naming facts that cannot be placed on a dimension, or null when every fact is
 * attributed. Rendered BESIDE a rollup table, never folded into it as an "Other" row — an
 * unattributed fact belongs to nobody, and giving it a row invents an entity.
 */
export function unattributedNote(result, dimension) {
  const count = result?.unattributed?.[dimension] ?? 0;
  if (!count) return null;
  const noun = count === 1 ? "invoice carries" : "invoices carry";
  const what =
    dimension === "creditedSalesperson"
      ? "no credited salesperson"
      : "no line-level business unit";
  return `${count} visible ${noun} ${what}, so ${count === 1 ? "it is" : "they are"} not placed on this axis. They are counted here rather than dropped, and never shown as a zero against anyone.`;
}

/** What the server said the principal's reach actually was — never what the page guessed. */
export function scopeSentence(result) {
  const scopes = result?.grantedScopes ?? [];
  if (scopes.length === 0) return null;
  return `Server-resolved visibility scope: ${scopes.join(", ")}.`;
}
