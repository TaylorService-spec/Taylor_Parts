import AccountArSection from "./AccountArSection";
import FinancialSummarySection from "./FinancialSummarySection";
import FinancialForecastSection from "./FinancialForecastSection";

// THE ACCOUNT'S FINANCIAL AREA. One governed surface, plus one honest line about what is not
// connected yet.
//
// WHY THIS EXISTS. The page previously rendered three financial blocks built to two different
// contracts, and the SAME string -- "Sales data source not connected", the single UNCONFIGURED_COPY
// constant in domain/financialSummaryView.js -- surfaced FOUR times on one render. AR (the one
// block with real governed data) sat apart from them. The user saw implementation plumbing repeated
// down the page and had to work out for themselves which block was real.
//
// The fix was composition, not deletion, and it is unchanged:
//   * AccountArSection is the authoritative AR surface (listAccountInvoiceAr) and is untouched.
//   * The provider-dependent surfaces (Financial Summary, Credit, Forecast Horizons) render ONLY
//     when a provider is actually configured. While unconfigured they collapse into ONE bounded
//     honest line instead of four.
//
// ════════════════════ WHAT ACCOUNT NORTH STAR P1 CHANGED HERE ════════════════════
//
// This block no longer supplies a heading, and it no longer wraps AR in a generic "financials"
// identity. AccountArSection now carries its own main-column section title ("Accounts receivable")
// -- the approved composition's point being that receivables are the answer, not a subheading
// inside a category. What remains here is the anchor the standing strip links to and the single
// not-connected line, which stays BELOW the real data it must never be confused with.
export default function AccountFinancialsSection({ accountId, financialProviderConfigured = false }) {
  return (
    <div id="account-financials">
      <AccountArSection accountId={accountId} />

      {financialProviderConfigured ? (
        <>
          <FinancialSummarySection />
          <FinancialForecastSection />
        </>
      ) : (
        // One line, once. Not four copies of the same sentence down the page.
        <p className="ns-state">
          Credit, forecast and summary figures need a connected financial data source. Receivables
          above are live and unaffected.
        </p>
      )}
    </div>
  );
}
