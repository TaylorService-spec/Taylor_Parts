// SALES TO GOAL — /financials/sales-to-goal (North Star P1, page 08).
//
// Design authority: docs/north-star/financials/North Star - Financials 08 Sales to Goal.dc.html.
// Actual performance against governed goals; every goal states its measurement basis.
// Unlike bases are never summed or compared silently — no total row exists, and the
// period-summary rail groups by basis only. Attainment bars cap at 100% fill while the
// number carries truth past 100. A GROSS_MARGIN-basis goal cannot compute attainment
// truthfully until FIN-006 cost supply exists.
//
// Current-main truth: the FIN-003 plan core (versioned GOAL records with explicit basis)
// is merged and dormant — no goal collection, no plan read. Per-basis actuals await read
// activation. The composition ships whole; the body states the truth.
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  FinancialsPageFrame,
  FinancialsFilterRail,
  FinancialsHonestSection,
  FinAnnotation,
  BasisChip,
} from "./FinancialsPrimitives.jsx";
import { MEASUREMENT_BASES, READ_STATE_DETAIL } from "../../domain/financialsSurface.js";

export default function FinancialsSalesToGoal() {
  const [company, setCompany] = useState("consolidated");
  const [businessUnit, setBusinessUnit] = useState("all");

  return (
    <FinancialsPageFrame
      title="Sales to Goal"
      crumb="Sales to Goal"
      custody="Actual performance against governed goals. Every goal states its measurement basis — unlike bases are never summed or compared silently."
      custodyTip="Bases are BOOKED / BILLED / COLLECTED / REVENUE / GROSS_MARGIN, each in its own column slot. This table carries no total row, deliberately: a sum across bases would be a number with no meaning. A unit without a goal reports the absence in words, never a fake 0% bar. Person rows attribute strictly by creditedSalespersonId and render only within the viewer's visibility scope."
    >
      <FinancialsFilterRail
        company={company}
        onCompanyChange={setCompany}
        businessUnit={businessUnit}
        onBusinessUnitChange={setBusinessUnit}
      />

      <div className="fin-overview-grid">
        <FinancialsHonestSection
          id="fin-sales-to-goal"
          title="Attainment by scope"
          meta="company → unit → person · attainment bars cap at 100% fill, the number carries truth past 100"
          honest={{ state: "NOT_ENABLED", detail: `${READ_STATE_DETAIL.notActivated} Goals themselves await the FIN-003 plan core's activation — the record model (versioned, explicit basis, APPROVED plans measurable) is merged with no storage yet.` }}
          subject="Goal and actual reads"
        >
          <div className="ns-table-wrap">
            <table className="ns-table">
              <caption className="fo-sr-only">Attainment against goals by scope</caption>
              <thead>
                <tr>
                  <th scope="col">Scope</th>
                  <th scope="col">
                    Basis
                    <FinAnnotation tip="A goal with basis GROSS_MARGIN renders 'attainment cannot be computed truthfully' while FIN-006 cost supply is missing — the basis is honored, never approximated from sell price." />
                  </th>
                  <th scope="col" className="ns-num">Actual</th>
                  <th scope="col" className="ns-num">Goal</th>
                  <th scope="col" className="ns-num">Variance</th>
                  <th scope="col">Attainment</th>
                </tr>
              </thead>
            </table>
          </div>
        </FinancialsHonestSection>

        <aside className="fin-rail">
          <section className="ns-section" aria-label="Period summary by basis">
            <div className="ns-section__head">
              <h2 className="ns-section__title">Period summary</h2>
              <span className="ns-section__meta">· grouped by basis — deliberately no single total</span>
            </div>
            <ul className="fin-exception-list">
              {MEASUREMENT_BASES.map((b) => (
                <li key={b.key}>
                  <BasisChip basis={b.label} />
                  <span className="fin-inact">No goal records</span>
                </li>
              ))}
            </ul>
            <p className="fin-section-note">
              <Link to="/financials/goals">Goal management →</Link>
            </p>
          </section>
        </aside>
      </div>
    </FinancialsPageFrame>
  );
}
