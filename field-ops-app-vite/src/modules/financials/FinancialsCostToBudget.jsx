// COST TO BUDGET — /financials/cost-to-budget (North Star P1, page 09).
//
// Design authority: docs/north-star/financials/North Star - Financials 09 Cost to Budget.dc.html.
// Budget vs actual cost — with NO authoritative cost drawn before FIN-006 supply exists.
// The structure ships whole: the Budget column is real (versioned records, when they
// exist); Actual / Variance / Remaining are reserved columns carrying one quiet phrase
// per row, never zero-filled, never derived from sell price.
//
// Current-main truth: FIN-006 margin/cost derivation core merged, cost-fact supply is an
// open Owner decision (FIN-BLOCK-003); FIN-003 budget records merged with no storage.
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  FinancialsPageFrame,
  FinancialsFilterRail,
  FinancialsHonestSection,
  FinAnnotation,
} from "./FinancialsPrimitives.jsx";

export default function FinancialsCostToBudget() {
  const [company, setCompany] = useState("consolidated");
  const [businessUnit, setBusinessUnit] = useState("all");

  return (
    <FinancialsPageFrame
      title="Cost to Budget"
      crumb="Cost to Budget"
      custody="Budget versus actual cost. No authoritative cost is drawn before governed cost facts exist — columns are reserved, not zero-filled."
      custodyTip="Budgets are versioned FIN-003 records administered in Budget Management. Cost actuals require FIN-006's governed cost-fact supply (FIN-BLOCK-003, Owner decision). Until then each row states 'no cost authority' — a zero would claim a cost read that does not exist, and cost is never derived from sell price."
    >
      <FinancialsFilterRail
        company={company}
        onCompanyChange={setCompany}
        businessUnit={businessUnit}
        onBusinessUnitChange={setBusinessUnit}
        periodLabel="Period — quarter"
      />

      <div className="fin-truth-band" role="note">
        <strong>Cost actuals are not yet governed.</strong>
        <p>
          The cost &amp; margin derivation core (FIN-006) is merged: it computes only when every
          required governed cost fact exists and reports UNKNOWN otherwise. Real cost-fact supply is
          an open Owner decision (FIN-BLOCK-003). When it lands, the reserved columns below take
          values and over-budget rows take exception treatment — the structure does not change.
        </p>
      </div>

      <FinancialsHonestSection
        id="fin-cost-to-budget"
        title="Budget lines"
        meta="budget figures drill to their versioned records in Budget Management"
        honest={{
          state: "NOT_ENABLED",
          detail:
            "No budget records exist yet: the FIN-003 plan core (versioned budgets, distinct from goals) is merged and dormant with no storage, and no plan read surface exists.",
        }}
        subject="Budget reads"
        footer={
          <p className="fin-section-note">
            <Link to="/financials/budgets">Budget management →</Link> ·{" "}
            <Link to="/financials/profitability">Profitability →</Link>
          </p>
        }
      >
        <div className="ns-table-wrap">
          <table className="ns-table">
            <caption className="fo-sr-only">Budget versus actual cost by category</caption>
            <thead>
              <tr>
                <th scope="col">Category</th>
                <th scope="col" className="ns-num">
                  Budget
                  <FinAnnotation tip="Versioned FIN-003 records — the version is part of the fact (v1, v2…) and plan history is never rewritten." />
                </th>
                <th scope="col" className="ns-num">Actual</th>
                <th scope="col" className="ns-num">Variance</th>
                <th scope="col" className="ns-num">Remaining</th>
              </tr>
            </thead>
          </table>
        </div>
      </FinancialsHonestSection>
    </FinancialsPageFrame>
  );
}
