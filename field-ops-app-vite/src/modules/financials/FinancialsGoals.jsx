// GOAL MANAGEMENT — /financials/goals (North Star P1, page 13).
//
// Design authority: docs/north-star/financials/North Star - Financials 13 Goal Management.dc.html.
// Governed financial/performance goal administration; the measurement basis is unmissable —
// rendered as an outlined chip in its own column, fixed per goal. Person goals attribute
// by creditedSalespersonId (a FIN-002-complete fact); SELF visibility follows FIN-004.
// A margin-basis goal reads "Active · not computable" while FIN-006 supply is missing.
//
// Current-main truth: FIN-003 goal records merged, dormant, no storage; FIN-007 approval
// policy unconfigured. Actions render disabled with that truth.
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  FinancialsPageFrame,
  FinancialsFilterRail,
  FinancialsHonestSection,
  FinAnnotation,
  BasisChip,
} from "./FinancialsPrimitives.jsx";
import FilterBar from "../../shared/ui/FilterBar";
import { MEASUREMENT_BASES } from "../../domain/financialsSurface.js";

const SCOPE_OPTIONS = [
  { key: "all", label: "All scopes" },
  { key: "unit", label: "Unit" },
  { key: "team", label: "Team" },
  { key: "person", label: "Person" },
];

export default function FinancialsGoals() {
  const [company, setCompany] = useState("consolidated");
  const [scope, setScope] = useState("all");

  return (
    <FinancialsPageFrame
      title="Goal Management"
      crumb="Goal Management"
      custody="Versioned performance targets with an explicit measurement basis, fixed per goal. Goals are distinct from budgets and are never blended with them."
      custodyTip="Bases: BOOKED / BILLED / COLLECTED / REVENUE / GROSS_MARGIN. The basis decides what 'attainment' means and is immutable on a goal; margin-basis targets are percentages (the unit renders from the basis, never assumed). Team-roster semantics on mid-period change are an open product question (FIN-PQ-TEAM-GOAL) — recorded, not invented."
      action={
        <span className="fin-action-slot">
          <button type="button" className="fin-primary-action" disabled>
            New goal
          </button>
          <span className="fin-inact">
            Goal commands are not active · approval policy not configured
            <FinAnnotation tip="The FIN-003 plan core is merged and dormant — no goal collection or command is activated, no plan capability exists in the catalog. FIN-007 approval policy is unconfigured and fails closed; self-approval is forbidden by current authority." />
          </span>
        </span>
      }
    >
      <FinancialsFilterRail company={company} onCompanyChange={setCompany} />
      <FilterBar variant="chips" label="Scope type" options={SCOPE_OPTIONS} activeKey={scope} onChange={setScope} />

      <FinancialsHonestSection
        id="fin-goals"
        title="Goals"
        meta="basis chips carry the vocabulary · goals drill to Sales to Goal attainment"
        honest={{
          state: "NOT_ENABLED",
          detail:
            "No goal records exist yet. The FIN-003 plan core (versioned goals, explicit basis, APPROVED plans measurable) is merged and dormant with no storage and no read surface.",
        }}
        subject="Goal reads"
      >
        <div className="ns-table-wrap">
          <table className="ns-table">
            <caption className="fo-sr-only">Versioned goals</caption>
            <thead>
              <tr>
                <th scope="col">Scope</th>
                <th scope="col">
                  Basis
                  <FinAnnotation tip="A GROSS_MARGIN-basis goal reads 'Active · not computable' while FIN-006 cost supply is missing — the goal stands; only its attainment waits." />
                </th>
                <th scope="col" className="ns-num">Target</th>
                <th scope="col">Period</th>
                <th scope="col">Version</th>
                <th scope="col">Approval</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
          </table>
        </div>
        <p className="fin-section-note">
          Basis vocabulary:{" "}
          {MEASUREMENT_BASES.map((b, i) => (
            <span key={b.key}>
              {i > 0 ? " " : null}
              <BasisChip basis={b.label} />
            </span>
          ))}
        </p>
        <p className="fin-section-note">
          <Link to="/financials/sales-to-goal">Sales to Goal →</Link>
        </p>
      </FinancialsHonestSection>
    </FinancialsPageFrame>
  );
}
