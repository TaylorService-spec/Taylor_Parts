// FORECASTING — /financials/forecasting (North Star P1, page 10).
//
// Design authority: docs/north-star/financials/North Star - Financials 10 Forecasting.dc.html —
// composition APPROVED as drawn; the current-main reconciliation updates only the binding:
// the FIN-005 forecast core EXISTS (records with asOf, basis, currency, period, scope,
// method label; newest governed as-of version supersedes prior versions for the same
// target) and is BUILT_DORMANT with no storage. FORECAST METHODOLOGY remains an
// unconfigured policy — method slots read "Method TBD — FIN-005" until a configured
// method actually exists. Opportunity.expectedValue is never promoted into authoritative
// forecast revenue.
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  FinancialsPageFrame,
  FinancialsFilterRail,
  FinancialsHonestSection,
  FinAnnotation,
} from "./FinancialsPrimitives.jsx";

export default function FinancialsForecasting() {
  const [company, setCompany] = useState("consolidated");
  const [businessUnit, setBusinessUnit] = useState("all");

  return (
    <FinancialsPageFrame
      title="Forecasting"
      crumb="Forecasting"
      custody="Forecast stays distinct from Actual, Goal and Budget. Every forecast exposes its version and as-of date; versions are immutable."
      custodyTip="Forecast records carry asOf, basis, currency, period, scope and a method label; the newest governed as-of version supersedes prior versions for the same target. Methodology is a policy decision not yet made — method slots read 'Method TBD — FIN-005'. Opportunity.expectedValue is never passed through as forecast revenue."
      action={
        <span className="fin-action-slot">
          <span className="fin-inact">
            Version: <strong>none</strong> — no governed forecast version exists
            <FinAnnotation tip="The version selector is first-class in the approved composition. It lists governed versions when they exist; today the honest state is that none do — the forecast core is merged and dormant with no storage." />
          </span>
        </span>
      }
    >
      <FinancialsFilterRail
        company={company}
        onCompanyChange={setCompany}
        businessUnit={businessUnit}
        onBusinessUnitChange={setBusinessUnit}
      />

      <FinancialsHonestSection
        id="fin-forecast-table"
        title="Forecast by unit"
        meta="forecast · goal (by basis) · actual to date · method"
        honest={{
          state: "NOT_ENABLED",
          detail:
            "No governed forecast version exists. The FIN-005 forecast core (versioned, as-of, explicit basis, method label) is merged and dormant — no forecast collection, no read. When versions exist, the method column carries each record's method label; until a configured methodology exists that label is 'Method TBD — FIN-005'.",
        }}
        subject="Forecast reads"
      >
        <div className="ns-table-wrap">
          <table className="ns-table">
            <caption className="fo-sr-only">Forecast versus goal and actual to date by business unit</caption>
            <thead>
              <tr>
                <th scope="col">Business unit</th>
                <th scope="col" className="ns-num">Forecast</th>
                <th scope="col" className="ns-num">Goal</th>
                <th scope="col" className="ns-num">Actual to date</th>
                <th scope="col">
                  Method
                  <FinAnnotation tip="Method TBD — FIN-005: forecast methodology is an unconfigured policy. No confidence fan is drawn (no governed model — FIN-PQ-10a)." />
                </th>
              </tr>
            </thead>
          </table>
        </div>
      </FinancialsHonestSection>

      <section className="ns-section" aria-label="Version history">
        <div className="ns-section__head">
          <h2 className="ns-section__title">Version history</h2>
          <span className="ns-section__meta">· immutable — newer as-of supersedes, never rewrites</span>
        </div>
        <p className="ns-state ns-state--na">
          No versions to list. Version history renders each governed forecast version with its as-of
          date and method label when the forecast core activates.
        </p>
        <p className="fin-section-note">
          <Link to="/financials/sales-to-goal">Sales to Goal →</Link>
        </p>
      </section>
    </FinancialsPageFrame>
  );
}
