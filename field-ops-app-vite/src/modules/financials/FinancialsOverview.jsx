// FINANCIALS OVERVIEW — /financials (North Star P1, page 01).
//
// Design authority: docs/north-star/financials/North Star - Financials 01 Overview.dc.html.
// Behavioral authority: current main (FINANCIALS-UX-CURRENT-MAIN-RECONCILIATION.md).
//
// The management landing for the operational financial subledger: custody sentence →
// filter rail → six-figure lifecycle scorecard → performance-against-plan → exception
// rail → forecast teaser → cost & margin truth band. Every slot from the approved
// composition is present; every figure whose governed read is not activated renders its
// honest absence — never a zero, never a specimen number, never a client-side computation.
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  FinancialsPageFrame,
  FinancialsFilterRail,
  FinancialFigure,
  FinAnnotation,
} from "./FinancialsPrimitives.jsx";
import HonestState from "../../shared/ui/HonestState.jsx";
import { LIFECYCLE_SCORECARD_SLOTS, READ_STATE_DETAIL } from "../../domain/financialsSurface.js";

// The page frame already renders the standing "Operational financial subledger — not the
// general ledger" line. This description therefore carries the clause that line does not,
// rather than repeating it near-verbatim directly above it (the two read as one sentence
// said twice).
const OVERVIEW_CUSTODY =
  "Management view of the operational financial subledger. External accounting authority is not yet selected.";

const CUSTODY_TIP =
  "Custody sentence — permanent contract copy. EOS composes governed operational financial events; statutory accounting, chart of accounts and close belong to a future external authority. Every figure carries its fact class so OPERATIONAL_ACTUAL is never mistaken for ACCOUNTING_RECONCILED_ACTUAL, which appears nowhere — no accounting authority exists.";

const SCORECARD_TIP =
  "One ribbon carries the six lifecycle facts in lifecycle order — BOOKED, BILLABLE, BILLED, COLLECTED, A/R, UNBILLED stay distinct words on every page. Unbilled is the one derived figure and says so. This page does not issue the reads behind these figures yet, so each slot states that rather than a number — it never asserts what your governed scope would return.";

// Owning-page drilldowns per slot (hierarchy is navigation, not new data).
const SLOT_LINKS = Object.freeze({
  billable: { to: "/financials/billing-queue", words: "Billing queue →" },
  billed: { to: "/financials/invoices", words: "Invoices →" },
  collected: { to: "/financials/payments", words: "Payments →" },
  arOutstanding: { to: "/financials/accounts-receivable", words: "Aging →" },
});

export default function FinancialsOverview() {
  const [company, setCompany] = useState("consolidated");
  const [businessUnit, setBusinessUnit] = useState("all");

  return (
    <FinancialsPageFrame
      title="Financials"
      crumb="Overview"
      custody={OVERVIEW_CUSTODY}
      custodyTip={CUSTODY_TIP}
    >
      <FinancialsFilterRail
        company={company}
        onCompanyChange={setCompany}
        businessUnit={businessUnit}
        onBusinessUnitChange={setBusinessUnit}
      />

      <section className="fin-scorecard-section" aria-label="Lifecycle scorecard">
        <div className="fin-scorecard">
          {LIFECYCLE_SCORECARD_SLOTS.map((slot) => (
            <div key={slot.key} className="fin-scorecard__slot">
              <FinancialFigure
                label={slot.label}
                factClass={slot.factClass}
                derivation={slot.derivation ?? null}
                absence="No read on this surface"
              />
              {SLOT_LINKS[slot.key] ? (
                <Link className="fin-figure__link" to={SLOT_LINKS[slot.key].to}>
                  {SLOT_LINKS[slot.key].words}
                </Link>
              ) : null}
            </div>
          ))}
        </div>
        <p className="fin-section-note">
          Lifecycle scorecard
          <FinAnnotation tip={SCORECARD_TIP} />
        </p>
      </section>

      {/* --home carries the page-01 MOBILE recomposition the approved handoff §8 specifies:
          at 375 the exception rail outranks the plan table and the cost/margin band is
          omitted (it lives on Cost to Budget and Profitability). Desktop is untouched. */}
      <div className="fin-overview-grid fin-overview-grid--home">
        <div>
          <section className="ns-section" aria-label="Performance against plan">
            <div className="ns-section__head">
              <h2 className="ns-section__title">Performance against plan</h2>
              <span className="ns-section__meta">· every goal states its measurement basis</span>
            </div>
            <HonestState
              state="NOT_ENABLED"
              subject="Plan comparison"
              detail="The plan-vs-actual core (FIN-003: GOAL distinct from BUDGET, versioned records, explicit measurement basis) is merged and dormant — no goal records exist yet, and no plan read surface exists to query. Unlike bases are never summed or compared silently, so this table carries no total row when it fills."
            />
            <p className="fin-section-note">
              <Link to="/financials/sales-to-goal">Sales to Goal →</Link> ·{" "}
              <Link to="/financials/goals">Goal management →</Link>
            </p>
          </section>

          <section className="ns-section fin-ov-cost" aria-label="Cost and margin">
            <div className="ns-section__head">
              <h2 className="ns-section__title">Cost &amp; margin</h2>
            </div>
            <div className="fin-truth-band">
              <strong>Gross margin cannot be reported yet.</strong>
              <p>
                The margin derivation authority (FIN-006) is merged: margin computes only when every
                required governed cost fact exists, and renders UNKNOWN otherwise. Governed cost-fact
                supply is an open Owner decision (FIN-BLOCK-003), so margin is UNKNOWN — never derived
                from sell price, never a fabricated number.
              </p>
              <p className="fin-section-note">
                <Link to="/financials/cost-to-budget">Cost to Budget →</Link> ·{" "}
                <Link to="/financials/profitability">Profitability →</Link>
              </p>
            </div>
          </section>
        </div>

        <aside className="fin-rail">
          <section className="ns-section" aria-label="Exceptions">
            <div className="ns-section__head">
              <h2 className="ns-section__title">Exceptions</h2>
            </div>
            <ul className="fin-exception-list">
              <li>
                <span>Billing blocked</span>
                <span className="fin-inact">No billing-readiness read</span>
              </li>
              <li>
                <span>Unapplied payments</span>
                <span className="fin-inact">No payments read</span>
              </li>
              <li>
                <span>Invoices 60+ days</span>
                <span className="fin-inact">No A/R read on this page</span>
              </li>
              <li>
                <span>Reconciliation exceptions</span>
                <span className="fin-inact">No accounting authority</span>
              </li>
            </ul>
            <p className="fin-section-note">
              Attention before totals
              <FinAnnotation tip={`Each exception line is a governed read with a drilldown, never a computed guess. ${READ_STATE_DETAIL.notWired} Reconciliation reports its own missing authority (FIN-010 external: no accounting authority selected) rather than a zero — a zero would claim a reconciliation read that does not exist.`} />
            </p>
          </section>

          <section className="ns-section" aria-label="Forecast">
            <div className="ns-section__head">
              <h2 className="ns-section__title">Forecast</h2>
            </div>
            <p className="ns-state ns-state--na">
              No governed forecast version exists. The forecast core (FIN-005: versioned, as-of,
              explicit basis) is merged and dormant; methodology is a policy decision —{" "}
              <span className="fin-inact">Method TBD — FIN-005</span>.
            </p>
            <p className="fin-section-note">
              <Link to="/financials/forecasting">Forecasting →</Link>
            </p>
          </section>
        </aside>
      </div>
    </FinancialsPageFrame>
  );
}
