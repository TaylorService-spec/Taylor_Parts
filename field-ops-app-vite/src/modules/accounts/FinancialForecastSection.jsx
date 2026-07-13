import { financialSummaryView, FINANCIAL_PROVIDER_STATE } from "../../domain/financialSummaryView";
import {
  forecastHorizonView,
  FORECAST_FAMILIES,
  FORECAST_FAMILY_ORDER,
  PRODUCTION_FORECAST_STATE,
} from "../../domain/financialForecastHorizons";

// Account Commercial Profile and Financial Forecast Horizons -- PR 4,
// Phase 3 + 4 (docs/specifications/account-commercial-profile-and-financial-
// forecast-horizons.md). Provider-neutral financial surfaces:
//
//   * CREDIT is rendered UNAVAILABLE via the provider-state contract only --
//     the same five-state view as the Financial Summary, showing `unconfigured`
//     -> "Sales data source not connected". NO creditStatus/creditLimit field,
//     document, or Firestore Rule is added by this initiative.
//   * FINANCIAL FORECAST HORIZONS render two separately-labeled family
//     sub-sections (Receivables and Pipeline / order). Each shows its DEFINED
//     label set (Family 1 includes the `Receivables Due` due-date aging label)
//     and the `unconfigured` provider-state message -- never a $0 or figure.
//     The families are never merged into one total.
//
// Only `unconfigured` is reachable this phase: no financial provider is
// connected, so nothing here executes a forecast/credit calculation and NO
// real figure, drill-down, export, or AI-access path is exposed (all deferred
// to the separate provider Specification, Phase 5). The `providerState` prop
// exists so the surface is genuinely built to the full contract; AccountDetail
// mounts it with no prop -> unconfigured.
const PRODUCTION_PROVIDER_STATE = { status: FINANCIAL_PROVIDER_STATE.UNCONFIGURED };

// A provider-state message rendered as an aria-live status region. Only
// message/loading kinds are ever reached here (credit/forecast never yield a
// figure this phase), so there is no metrics/figure branch to render.
function ProviderStateMessage({ view }) {
  const className = view.kind === "loading" || view.tone !== "warning" ? "fo-muted" : "fo-warning";
  return (
    <p className={className} role="status" aria-live="polite">
      {view.text}
    </p>
  );
}

// One forecast family sub-section: its label, its DEFINED metric label set
// (labels only -- never a value/figure), and the unconfigured provider-state
// message. Rendering the labels surfaces the definitions (incl. `Receivables
// Due`) without ever showing a figure.
function ForecastFamily({ family }) {
  const def = FORECAST_FAMILIES[family];
  const view = forecastHorizonView(PRODUCTION_FORECAST_STATE);
  return (
    <div className="fo-forecast-family">
      <h5>{def.label}</h5>
      <ul className="fo-activity-list fo-forecast-labels">
        {def.metricLabels.map((label) => (
          <li key={label} className="fo-muted">
            {label}
          </li>
        ))}
      </ul>
      <ProviderStateMessage view={view} />
    </div>
  );
}

export default function FinancialForecastSection({ providerState = PRODUCTION_PROVIDER_STATE }) {
  // Credit reuses the SAME five-state provider-state view -- rendered
  // unavailable, never a stored/fabricated credit value.
  const creditView = financialSummaryView(providerState);
  return (
    <>
      {/* Credit -- rendered unavailable via the provider-state contract only */}
      <section className="wo-history">
        <h4>Credit</h4>
        <ProviderStateMessage view={creditView} />
      </section>

      {/* Financial Forecast Horizons -- two separately-labeled families */}
      <section className="wo-history">
        <h4>Financial Forecast Horizons</h4>
        <div className="fo-forecast-families">
          {FORECAST_FAMILY_ORDER.map((family) => (
            <ForecastFamily key={family} family={family} />
          ))}
        </div>
      </section>
    </>
  );
}
