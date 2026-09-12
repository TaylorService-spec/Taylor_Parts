import { useAccountAr } from "../../hooks/useAccountAr.js";
import { accountArView, ACCOUNT_AR_STATE } from "../../domain/accountArView.js";

// ACCOUNTS RECEIVABLE -- its own main-column section, per invoice.
//
// The read is unchanged: the trusted, finance.read-gated listAccountInvoiceAr callable
// (functions/src/finance/financeReadCallables.ts), through accountArView's pure view model. This
// renders ONLY what the AR engine actually computes -- outstanding balance and AR position per
// invoice -- and never the broader provider-neutral contract FinancialSummarySection describes.
//
// ════════════════════ WHY IT HAS ITS OWN TITLE NOW ════════════════════
//
// It rendered as an h4 inside a generic financials block, under a heading that named the plumbing
// rather than the answer. Money owed by this customer is a first-class question a salesperson comes
// to this page with, so Account North Star P1 gives it a main-column section of its own, titled in
// the words a person would use. Same read, same states, same numbers -- it is no longer filed
// under something else.
//
// ════════════════════ THREE THINGS THIS TABLE WILL NOT DO ════════════════════
//
//   * It never sums across currencies. Per-currency balances are listed per currency, in the
//     standing strip; this table states each invoice on its own line and totals nothing.
//   * It never prints a day count on an invoice that is not overdue. deriveArPosition sets
//     daysOverdue: 0 for CURRENT too, so a naive render would put "0d overdue" beside an invoice
//     that is perfectly current -- daysOverdueText is already gated on position in accountArView.
//   * It never renders the stored position token. The words come from arPositionWords, the one
//     vocabulary, so the table and every other AR surface say the same thing.
//
// ════════════════════ THE COMPANY COLUMN, AND WHEN IT APPEARS ════════════════════
//
// Accounts are NOT partitioned by operating company: an invoice's company is stamped from its
// Sales Order, so one account routinely carries both Taylor and Ventana receivables. This table had
// no company column at all, which meant a salesperson reading it could not tell whose money any row
// was — and the standing strip's Outstanding AR above it was a single figure silently spanning both.
//
// The column and the band below appear ONLY when the governed read's own summary says the set spans
// more than one company (`summary.spansMultipleCompanies`, accumulated server-side in the same pass
// as the consolidated totals). Three consequences, all deliberate:
//
//   * On a response that predates the company dimension, `view.company.supplied` is false and this
//     renders EXACTLY as it did before — no column, no band, and above all no claim that a
//     breakdown exists. Asserting a partition the read never sent would be worse than showing none.
//   * A single-company account gets no column and no band. One company is not a disclosure.
//   * An invoice carrying no governed company reads "Not attributed to a company". It is never
//     guessed onto Taylor or Ventana from the account, the owner or the line of business.
//
// A DENIED read keeps the section and says so (design decision A-D2). An over-bound read -- the
// callable itself refuses to label a truncated page "ready" -- renders the same honest unavailable
// state, because a partial receivables list summarized confidently is worse than no list.
export default function AccountArSection({ accountId }) {
  const { loading, errorStatus, result } = useAccountAr(accountId);
  const view = accountArView({ loading, errorStatus, result });
  // The server's own flag, read — never `companyIds.length > 1` recomputed here.
  const showCompany = view.company?.supplied === true && view.company.spansMultipleCompanies === true;

  return (
    // The `id` is a REAL anchor the Account Attention projection deep-links to
    // (`/customers/:accountId#account-ar-section`) rather than a fabricated route. AR resolution
    // stays here, in this section, exactly where it already lived -- Attention references it and
    // never restates it.
    <section id="account-ar-section" className="ns-section" aria-label="Accounts receivable">
      <div className="ns-section__head">
        <h2 className="ns-section__title">Accounts receivable</h2>
        <span className="ns-section__meta">
          · per invoice — multi-currency balances list per currency, never summed
        </span>
      </div>
      {view.kind === ACCOUNT_AR_STATE.LOADING && <p className="ns-state">Loading receivables…</p>}
      {view.kind === ACCOUNT_AR_STATE.DENIED && (
        <p className="ns-state ns-state--denied">Not available to you.</p>
      )}
      {view.kind === ACCOUNT_AR_STATE.UNAVAILABLE && (
        <p className="ns-state">Receivables couldn’t be read. Try again later.</p>
      )}
      {view.kind === ACCOUNT_AR_STATE.EMPTY && <p className="ns-state">No invoices on this account.</p>}
      {view.kind === ACCOUNT_AR_STATE.READY && (
        <>
          {showCompany ? (
            // Deliberately `ns-state` — the Account North Star's own vocabulary for a situation
            // rendered in words — and NOT the Financials family's bordered `fin-truth-band`.
            // Account grammar R13 admits a ruled panel for editors, dialogs and suggestion bands
            // only, never for read-only layout, and this is read-only.
            <p className="ns-state" role="note">
              <strong>This account&rsquo;s receivables span more than one operating company.</strong>{" "}
              {view.company.spanNote}
              {view.company.unattributedNote ? ` ${view.company.unattributedNote}` : ""}
            </p>
          ) : null}
          <div className="ns-table-wrap">
            <table className="ns-table ns-table--cards">
              <caption className="fo-sr-only">Invoices on this account</caption>
              <thead>
                <tr>
                  <th scope="col">Invoice</th>
                  {showCompany ? <th scope="col">Company</th> : null}
                  <th scope="col">Position</th>
                  <th scope="col" className="ns-num">Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {view.rows.map((row) => (
                  <tr key={row.key}>
                    <td data-label="Invoice">{row.invoiceNumber}</td>
                    {showCompany ? (
                      // `companyLabel` is null ONLY when the row carries no company field at all,
                      // which cannot happen while showCompany is true — the summary and the rows
                      // come from the same response. The fallback states the gap rather than
                      // printing an empty cell that reads as "none".
                      <td data-label="Company">{row.companyLabel ?? "Company not supplied for this invoice"}</td>
                    ) : null}
                    <td data-label="Position">
                      <span className={`ns-tone ns-tone--${row.tone}`}>
                        {/* An unplaceable position is stated as unplaceable, never echoed raw. */}
                        {row.positionWords ?? "Position not recognised"}
                        {row.daysOverdueText ? ` · ${row.daysOverdueText}` : ""}
                      </span>
                    </td>
                    <td data-label="Outstanding" className="ns-num">{row.outstandingText}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="ns-table__note">
            {view.openCount} open, {view.overdueCount} overdue.
          </p>
        </>
      )}
    </section>
  );
}
