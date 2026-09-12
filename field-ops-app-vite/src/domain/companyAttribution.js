// OPERATING-COMPANY DISCLOSURE — the ONE client vocabulary for "whose money is this?".
//
// ════════════════════ THE DEFECT THIS MODULE EXISTS TO END ════════════════════
//
// Accounts are not partitioned by operating company. `issueInvoice` stamps the invoice's
// `companyId` from its Sales Order's governed `operatingCompanyId`, so ONE account can genuinely
// carry both Taylor and Ventana invoices — that is the ordinary case for a customer who buys from
// both. Until the governed reads carried a company dimension, every customer-facing receivables
// figure was a consolidated total spanning both companies, on rows that carried no company either,
// with no control and no sentence anywhere saying so. A blended figure that looks exactly like a
// single-company figure is not a cosmetic problem: it is a number a person acts on.
//
// ════════════════════ WHAT THIS MODULE WILL NOT DO ════════════════════
//
//   * It does no money arithmetic. Every amount here was summed by the server, in the same pass
//     that produced the consolidated totals, which is why the partition reconciles to them
//     exactly. This module selects, labels and formats.
//   * It never INFERS a company. `operatingCompanyId` is never derived from the account, the
//     owner, the salesperson, the line of business or a display name (Owner ruling D-2, and
//     domain/operatingCompanyAuthority.js's whole reason for existing). A fact with no governed
//     company is UNATTRIBUTED and is labelled as such — never folded into a company, never
//     dropped, never guessed.
//   * It never ASSERTS A BREAKDOWN IT DID NOT RECEIVE. The governed function and this bundle ship
//     separately, so a response may legitimately predate the company dimension entirely. In that
//     case `supplied` is false and every surface falls back to its existing consolidated
//     rendering WITHOUT claiming a company split exists. A UI that invents a breakdown is worse
//     than one that shows none.
//   * It adds no UI when there is nothing to disclose. One company is one company;
//     `spansMultipleCompanies` false means the surfaces stay exactly as they are.

import { formatByCurrency } from "./financialFactsView.js";
import { resolveOperatingCompany } from "./operatingCompanyAuthority.js";

/**
 * The explicit key the server uses for "this money carries no governed operating company".
 *
 * Mirrors UNATTRIBUTED_COMPANY in functions/src/finance/financeReadProjection.ts. It is its own
 * key rather than an omission for the same reason aging keeps `unagedMinor` beside its buckets:
 * the per-company figures PLUS this key reconcile exactly to the consolidated totals, and that
 * reconciliation is the only thing that makes a breakdown trustworthy.
 */
export const UNATTRIBUTED_COMPANY = "UNATTRIBUTED";

/**
 * The words for one company key. Resolution goes through the governed id via the operating-company
 * authority — never through a display name, a code or a line-of-business token.
 *
 * A shape-valid id this build does not know is a REAL governed company belonging to a newer seed
 * list, so its money is named and kept visible with the id it actually carries, rather than
 * silently hidden or quietly renamed to something this client made up.
 */
export function companyAttributionLabel(key) {
  if (key === UNATTRIBUTED_COMPANY) return "Not attributed to a company";
  const { company } = resolveOperatingCompany(key);
  if (company) return company.displayName;
  return `Unrecognised company (${typeof key === "string" && key.length > 0 ? key : "no id"})`;
}

const count = (v) => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null);

/**
 * The disclosure view model for a governed AR summary.
 *
 * Accepts the `summary` from EITHER governed read — `listAccountInvoiceAr` and
 * `listFinancialFacts` both return `summarizeAccountAr`'s shape — so the Account page and the
 * Financials pages can never word the same fact two different ways.
 *
 * `supplied` is decided by `companyIds` AND `byCompany` both being present and well-shaped. The
 * per-row `companyId` is deliberately NOT the gate: a partial rollout in which rows carry a
 * company but the summary does not would let a surface build its own partition, which is the
 * client-side money arithmetic this family forbids.
 */
export function companyAttribution(summary) {
  const companyIds = Array.isArray(summary?.companyIds) ? summary.companyIds : null;
  const byCompany =
    summary?.byCompany && typeof summary.byCompany === "object" && !Array.isArray(summary.byCompany)
      ? summary.byCompany
      : null;

  if (companyIds === null || byCompany === null) {
    return Object.freeze({
      supplied: false,
      spansMultipleCompanies: false,
      unattributedPresent: false,
      companyIds: [],
      rows: [],
      spanLabel: null,
      spanNote: null,
      unattributedNote: null,
    });
  }

  const rows = companyIds.map((key) => {
    const figures = byCompany[key] ?? {};
    return {
      key,
      label: companyAttributionLabel(key),
      // A surface may want to treat unattributed money differently (a muted tone, a footnote).
      // It must never need to re-derive "is this a company?" from the key string to do so.
      unattributed: key === UNATTRIBUTED_COMPANY,
      invoiceCount: count(figures.count),
      openCount: count(figures.openCount),
      overdueCount: count(figures.overdueCount),
      billedText: formatByCurrency(figures.billedByCurrency),
      collectedText: formatByCurrency(figures.collectedByCurrency),
      outstandingText: formatByCurrency(figures.outstandingByCurrency),
    };
  });

  // `spansMultipleCompanies` is the SERVER'S OWN flag, not `companyIds.length > 1` recomputed
  // here. The two agree today; reading the flag means they cannot come to disagree later.
  const spans = summary.spansMultipleCompanies === true;
  const unattributedRow = rows.find((r) => r.unattributed) ?? null;
  // UNATTRIBUTED IS NOT A COMPANY, so it is never counted as one. A set of {taylor, UNATTRIBUTED}
  // spans more than one key but reads "1 company + unattributed", not "2 companies" — calling
  // money that belongs to nobody a second company would be exactly the invention this forbids.
  const namedCount = rows.length - (unattributedRow ? 1 : 0);

  return Object.freeze({
    supplied: true,
    spansMultipleCompanies: spans,
    unattributedPresent: unattributedRow !== null,
    companyIds,
    rows,
    /** A compact suffix for a one-line figure ("2 companies", "1 company + unattributed"). */
    spanLabel: spans
      ? `${namedCount} ${namedCount === 1 ? "company" : "companies"}${unattributedRow ? " + unattributed" : ""}`
      : null,
    spanNote: spans
      ? `These figures combine ${rows.map((r) => r.label).join(", ")}. ` +
        "An account is not partitioned by company: each invoice carries the governed operating company " +
        "stamped on it from its Sales Order. The breakdown is the same money, split by that fact and never " +
        "inferred; the parts reconcile to the consolidated totals exactly."
      : null,
    unattributedNote: unattributedRow
      ? `${unattributedRow.outstandingText} outstanding carries no governed operating company. It is stated ` +
        "here as unattributed rather than placed on Taylor or Ventana, and it is counted in the " +
        "consolidated totals rather than dropped."
      : null,
  });
}

/**
 * The company span of the SERVER'S OWN aging derivation (`agingByCompany`).
 *
 * The A/R aging scorecard reads `agingByCurrency`, which under a consolidated selection is one row
 * of buckets spanning both companies — a reader cannot tell whose exposure is 61+ days old. This
 * reports that span so the page can say so. It does NOT re-bucket anything and returns no amounts:
 * the buckets on screen stay the server's single consolidated derivation, correctly labelled.
 */
export function agingCompanySpan(result) {
  const aging =
    result?.agingByCompany && typeof result.agingByCompany === "object" && !Array.isArray(result.agingByCompany)
      ? result.agingByCompany
      : null;
  if (aging === null) {
    return Object.freeze({ supplied: false, spansMultipleCompanies: false, companyIds: [], labels: [], note: null });
  }
  const companyIds = Object.keys(aging).sort();
  const labels = companyIds.map(companyAttributionLabel);
  return Object.freeze({
    supplied: true,
    spansMultipleCompanies: companyIds.length > 1,
    companyIds,
    labels,
    note:
      companyIds.length > 1
        ? `These buckets combine ${companyIds.length} operating companies — ${labels.join(", ")}. ` +
          "Choose a company above to age one company's exposure on its own; nothing here splits them, " +
          "because the buckets are the server's own derivation and this page ages nothing."
        : null,
  });
}
