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
// A DENIED read keeps the section and says so (design decision A-D2). An over-bound read -- the
// callable itself refuses to label a truncated page "ready" -- renders the same honest unavailable
// state, because a partial receivables list summarized confidently is worse than no list.
export default function AccountArSection({ accountId }) {
  const { loading, errorStatus, result } = useAccountAr(accountId);
  const view = accountArView({ loading, errorStatus, result });

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
          <div className="ns-table-wrap">
            <table className="ns-table ns-table--cards">
              <caption className="fo-sr-only">Invoices on this account</caption>
              <thead>
                <tr>
                  <th scope="col">Invoice</th>
                  <th scope="col">Position</th>
                  <th scope="col" className="ns-num">Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {view.rows.map((row) => (
                  <tr key={row.key}>
                    <td data-label="Invoice">{row.invoiceNumber}</td>
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
