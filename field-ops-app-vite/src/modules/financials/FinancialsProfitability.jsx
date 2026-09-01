// GROSS MARGIN & PROFITABILITY — /financials/profitability (North Star P1, page 11).
//
// Design authority: docs/north-star/financials/North Star - Financials 11 Profitability.dc.html.
// Before FIN-006 the truthful unavailable state IS the page: a leading, explanatory
// "margin cannot be reported yet" band, then "what is reportable today" — revenue at full
// strength, cost / GM / GM% reserved with one quiet phrase per row. Fact outranks absence.
// When FIN-006 lands the layout gains values, not structure.
//
// Current-main truth: the margin derivation core is merged — margin computes only when
// every governed cost fact exists, else UNKNOWN. Cost supply is FIN-BLOCK-003 (Owner).
// Revenue (billed) reads are merged and inactive. UNKNOWN is rendered exactly; no number
// is ever derived from sell price or partial cost, and missing-cost lines are never
// silently omitted from margin.
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  FinancialsPageFrame,
  FinancialsFilterRail,
  FinancialsHonestSection,
  FinAnnotation,
} from "./FinancialsPrimitives.jsx";

const PIVOT_OPTIONS = [
  { key: "unit", label: "By unit" },
  { key: "salesperson", label: "By salesperson" },
  { key: "customer", label: "By customer" },
  { key: "source", label: "By source" },
];

export default function FinancialsProfitability() {
  const [company, setCompany] = useState("consolidated");

  return (
    <FinancialsPageFrame
      title="Gross Margin & Profitability"
      crumb="Gross Margin & Profitability"
      custody="Operational profitability. Gross margin is computed only from complete governed cost facts — otherwise it is UNKNOWN, never a number."
      custodyTip="The FIN-006 derivation core is merged: margin computes when every required governed cost fact exists and reports UNKNOWN otherwise. Cost is never derived from sell price; margin is never derived from partial cost; missing-cost lines are never silently omitted. Who may see margin by person when it exists is an open product question (FIN-PQ-15a)."
    >
      <FinancialsFilterRail company={company} onCompanyChange={setCompany} />

      {/* THE PIVOTS ARE NOT ACTIONABLE YET, SO THEY MUST NOT LOOK ACTIONABLE (Owner visual
          review, F11). They were interactive FilterBar chips while the page's own copy said
          "dimension pivots stay inactive until the authority they pivot exists" — a control
          that invites a click and changes nothing. They are rendered here in the family's
          existing static chip grammar (the same .fin-basis chip the plan pages use for
          vocabulary), as a list, with no button and no selected state to mistake for one. */}
      <section className="ns-section" aria-label="Dimensions">
        <p className="fin-section-note">
          Dimensions (inactive until FIN-006):{" "}
          {PIVOT_OPTIONS.map((option) => (
            <span key={option.key}>
              {" "}
              <span className="fin-basis fin-basis--inactive">{option.label}</span>
            </span>
          ))}
          <FinAnnotation tip="These are the dimensions margin will pivot by when FIN-006 cost supply exists. They are shown as vocabulary, not controls: nothing here filters anything today, so nothing here is clickable." />
        </p>
      </section>

      <div className="fin-truth-band" role="note">
        <strong>Margin cannot be reported yet.</strong>
        <p>
          Governed cost-fact supply does not exist (FIN-BLOCK-003, Owner decision). Until it does,
          gross margin is UNKNOWN — with no fabricated number. The composition below keeps every
          slot; FIN-006 activation fills values, not structure. The dimensions below are vocabulary
          only — nothing pivots until the authority they pivot exists.
        </p>
      </div>

      <div className="fin-overview-grid">
        <FinancialsHonestSection
          id="fin-profitability"
          title="What is reportable today"
          meta="revenue at full strength when billed reads activate · cost, GM and GM% reserved"
          honest={{
            state: "NOT_ENABLED",
            detail:
              "This page does not issue its own billed-revenue read yet, so no revenue rows are shown. Cost, gross margin and margin % remain UNKNOWN pending FIN-006 cost supply — each reserved column carries its one quiet phrase, never a zero.",
          }}
          subject="Revenue and margin reads"
        >
          <div className="ns-table-wrap">
            <table className="ns-table">
              <caption className="fo-sr-only">Revenue with reserved margin columns</caption>
              <thead>
                <tr>
                  <th scope="col">Business unit</th>
                  <th scope="col" className="ns-num">Billed revenue</th>
                  <th scope="col" className="ns-num">
                    Cost
                    <FinAnnotation tip="UNKNOWN until every required governed cost fact exists — never derived from sell price." />
                  </th>
                  <th scope="col" className="ns-num">Gross margin</th>
                  <th scope="col" className="ns-num">GM %</th>
                </tr>
              </thead>
            </table>
          </div>
        </FinancialsHonestSection>

        <aside className="fin-rail">
          <section className="ns-section" aria-label="What activates with cost authority">
            <div className="ns-section__head">
              <h2 className="ns-section__title">Activates with FIN-006</h2>
            </div>
            <p className="ns-state ns-state--na">
              Cost and margin values, margin pivots by unit / salesperson / customer / source, and
              over-budget exception treatment on Cost to Budget.
            </p>
            <p className="fin-section-note">
              <Link to="/financials/cost-to-budget">Cost to Budget →</Link>
            </p>
          </section>
          <section className="ns-section" aria-label="Never on this page">
            <div className="ns-section__head">
              <h2 className="ns-section__title">Never on this page</h2>
            </div>
            <p className="ns-state ns-state--na">
              Statutory net profit, overhead allocation and tax — those belong to the future
              external accounting authority, not the operational subledger.
            </p>
          </section>
        </aside>
      </div>
    </FinancialsPageFrame>
  );
}
