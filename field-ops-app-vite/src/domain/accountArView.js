// Account AR (Accounts Receivable) -- PURE view-model for the trusted `listAccountInvoiceAr`
// read (functions/src/finance/financeReadCallables.ts). No Firebase import, unit-testable in
// Node. Distinct from FinancialSummarySection.jsx's provider-neutral 7-metric contract (Open
// Pipeline/Quoted Value/.../Cash Collected) -- this surface renders ONLY what the AR engine
// actually computes (outstanding balance + AR position per invoice), never forced into that
// broader contract. This is additive, not a replacement of Financial Summary.
//
// States mirror the callable's own honest contract: denied (thrown permission-denied) |
// unavailable (read failed, or the account's real invoice set exceeds the page bound -- the
// callable itself refuses to label a truncated page "ready") | empty (ready, zero invoices) |
// ready (ready, at least one invoice). Never fabricates a total; a currency split across
// multiple currencies is shown per-currency, never blindly summed.

import { formatMinorUnits } from "./money.js";

export const ACCOUNT_AR_STATE = {
  LOADING: "loading",
  DENIED: "denied",
  UNAVAILABLE: "unavailable",
  EMPTY: "empty",
  READY: "ready",
};

// Maps a callable-transport error code to a distinct client status. Mirrors
// domain/receivingTransport.js's mapCallableErrorToStatus shape (strips an optional
// "functions/" prefix the callable SDK may add).
export function mapAccountArErrorToStatus(err) {
  const raw = err && typeof err.code === "string" ? err.code : "";
  const code = raw.startsWith("functions/") ? raw.slice("functions/".length) : raw;
  return code === "permission-denied" ? ACCOUNT_AR_STATE.DENIED : ACCOUNT_AR_STATE.UNAVAILABLE;
}

const AR_POSITION_TONE = {
  OVERDUE: "critical",
  CURRENT: "info",
  SETTLED: "positive",
  VOID: "muted",
  UNKNOWN: "unknown",
};

export function arPositionTone(position) {
  return AR_POSITION_TONE[position] ?? "unknown";
}

// Integer minor units -> a display string. Never divides/rounds lossily; multi-currency
// balances are listed per-currency, never summed across currencies.
//
// Thin delegation to domain/money.js's `formatMinorUnits` -- the ONE exact-integer-math
// exponent-aware core (X-MONEY-FORMATTER-DISAGREEMENT). This function used to hardcode
// `/100`, which silently disagreed with money.js's own (unused, zero-call-site)
// `formatMoneyMajor` for any currency whose minor unit isn't 1/100 (JPY, exponent 0).
// Every CURRENCY_MINOR write path this app can reach today emits USD only (see the
// comment on formatMinorUnits for the evidence), so this was invisible in practice --
// but account.js's `defaultCurrency` already accepts the full ISO 4217 set, and
// salesOrderCommands.ts calls multi-currency "a separate future seam", so the hardcoded
// `/100` was a defect waiting to happen, not a safe assumption. This is the ONE call
// this codebase's metadata renderer reaches for CURRENCY_MINOR cells (see
// metadata/listPresentation.js's `cellValue`) -- it only adds the optional currency-code
// prefix on top of money.js's shared core, never a second division.
export function formatMinor(amountMinor, currency) {
  const major = formatMinorUnits(amountMinor, currency);
  if (major === "—") return major;
  return currency ? `${currency} ${major}` : major;
}

// Build the render-ready view from the callable's raw result ({status, invoices, summary})
// or a transport-level error status. `result` is null when the caller is still loading.
export function accountArView({ loading = false, errorStatus = null, result = null } = {}) {
  if (loading) return { kind: ACCOUNT_AR_STATE.LOADING };
  if (errorStatus) return { kind: errorStatus };
  if (!result || result.status !== "ready") return { kind: ACCOUNT_AR_STATE.UNAVAILABLE };

  const invoices = Array.isArray(result.invoices) ? result.invoices : [];
  const summary = result.summary ?? { count: 0, openCount: 0, overdueCount: 0, outstandingByCurrency: {} };

  if (invoices.length === 0) return { kind: ACCOUNT_AR_STATE.EMPTY };

  const outstandingLines = Object.entries(summary.outstandingByCurrency ?? {}).map(
    ([currency, amountMinor]) => ({ currency, text: formatMinor(amountMinor, currency) })
  );

  return {
    kind: ACCOUNT_AR_STATE.READY,
    openCount: summary.openCount ?? 0,
    overdueCount: summary.overdueCount ?? 0,
    outstandingLines,
    rows: invoices.map((inv) => ({
      key: inv.invoiceId,
      invoiceNumber: inv.invoiceNumber ?? inv.invoiceId,
      salesOrderId: inv.salesOrderId,
      position: inv.arPosition,
      tone: arPositionTone(inv.arPosition),
      outstandingText: formatMinor(inv.outstandingMinor, inv.currency),
      // Only OVERDUE carries a meaningful day count -- deriveArPosition sets daysOverdue: 0
      // for CURRENT too (not null), so gating on position (not just typeof) avoids a
      // misleading "0d overdue" on an invoice that isn't overdue at all.
      daysOverdueText: inv.arPosition === "OVERDUE" && typeof inv.daysOverdue === "number" ? `${inv.daysOverdue}d overdue` : null,
    })),
  };
}
