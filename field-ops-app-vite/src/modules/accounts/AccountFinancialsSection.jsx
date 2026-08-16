import AccountArSection from "./AccountArSection";
import FinancialSummarySection from "./FinancialSummarySection";
import FinancialForecastSection from "./FinancialForecastSection";

// ONE coherent Accounts Receivable & financial area for the Account workspace.
//
// WHY THIS EXISTS. The page previously rendered three financial blocks built to two different
// contracts, and the SAME string -- "Sales data source not connected", the single UNCONFIGURED_COPY
// constant in domain/financialSummaryView.js -- surfaced FOUR times on one render: Financial Summary,
// Credit, and both Forecast Horizon families. AR (the one block with real governed data) sat apart
// from them. The user saw implementation plumbing repeated down the page and had to work out for
// themselves which block was real.
//
// The fix is composition, not deletion. Nothing is redesigned and no authority moves:
//   * AccountArSection is unchanged and stays the authoritative AR surface (listAccountInvoiceAr).
//   * The provider-dependent surfaces (Financial Summary, Credit, Forecast Horizons) are rendered
//     ONLY when a provider is actually configured. While unconfigured they collapse into ONE bounded
//     honest line instead of four, which is exactly the "one bounded unavailable state OR hide the
//     optional section" rule.
//
// The provider-configured branch is deliberately preserved rather than removed: the day a provider
// exists, these sections light up with no further change here.

// The provider-neutral surfaces expose no "is a provider configured" flag of their own -- their
// production state is a module-level constant that is currently always UNCONFIGURED. Rather than
// reach into their internals, this takes it as an injectable prop defaulting to false, so the
// composition is testable and flips in exactly one place when a provider lands.
export default function AccountFinancialsSection({ accountId, financialProviderConfigured = false }) {
  return (
    <section id="account-financials" aria-label="Accounts receivable and financials">
      <AccountArSection accountId={accountId} />

      {financialProviderConfigured ? (
        <>
          <FinancialSummarySection />
          <FinancialForecastSection />
        </>
      ) : (
        // One line, once. Not four copies of the same sentence down the page.
        <p className="fo-muted">
          Credit, forecast and summary figures need a connected financial data source. Receivables
          above are live and unaffected.
        </p>
      )}
    </section>
  );
}
