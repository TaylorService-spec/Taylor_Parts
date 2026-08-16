import { useAccountAr } from "../../hooks/useAccountAr.js";
import { accountArView, ACCOUNT_AR_STATE } from "../../domain/accountArView.js";
import StatusPill from "../../shared/ui/StatusPill.jsx";
import FailureState from "../../shared/ui/FailureState";

// Account AR (Accounts Receivable) -- the real, governed AR read
// (functions/src/finance/financeReadCallables.ts listAccountInvoiceAr), wired directly.
// Distinct from FinancialSummarySection.jsx (a broader, still-unconnected 7-metric
// provider-neutral contract) -- this renders ONLY what the AR engine actually computes:
// outstanding balance and AR position per invoice. Additive, not a replacement.
//
// Capability `finance.read` is admin-only (compatibilityRoles.ts) and active only where
// per-environment activation is on (platform-sandbox today, never production) -- a
// persona without it gets an honest DENIED state here, never a fabricated empty/zero.
export default function AccountArSection({ accountId }) {
  const { loading, errorStatus, result } = useAccountAr(accountId);
  const view = accountArView({ loading, errorStatus, result });

  return (
    // Wave 7 extension, PART 1.6 (Account Attention) -- `id` gives the Account Attention
    // projection a REAL anchor to deep-link to (`/customers/:accountId#account-ar-section`)
    // instead of a fabricated route. AR resolution stays here, in this section, exactly where
    // it already lived -- Account Attention never restates or re-renders AR data itself.
    <section id="account-ar-section" className="wo-history">
      <h4>Accounts Receivable</h4>
      {view.kind === ACCOUNT_AR_STATE.LOADING && <p className="fo-muted">Loading AR…</p>}
      {view.kind === ACCOUNT_AR_STATE.DENIED && (
        <FailureState title="Accounts Receivable unavailable" message="You are not authorized to view AR for this account." />
      )}
      {view.kind === ACCOUNT_AR_STATE.UNAVAILABLE && (
        <p className="fo-muted">AR is currently unavailable. Try again later.</p>
      )}
      {view.kind === ACCOUNT_AR_STATE.EMPTY && <p className="fo-muted">No invoices on this account.</p>}
      {view.kind === ACCOUNT_AR_STATE.READY && (
        <div className="fo-financial-metrics">
          <p className="fo-muted">
            {view.openCount} open, {view.overdueCount} overdue
            {view.outstandingLines.length > 0 && (
              <> — outstanding: {view.outstandingLines.map((l) => l.text).join(", ")}</>
            )}
          </p>
          <ul className="fo-activity-list">
            {view.rows.map((row) => (
              <li key={row.key}>
                <span>{row.invoiceNumber}</span>{" "}
                <StatusPill tone={row.tone} label={row.position} />{" "}
                <span className="fo-muted">
                  {row.outstandingText}
                  {row.daysOverdueText ? ` · ${row.daysOverdueText}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
