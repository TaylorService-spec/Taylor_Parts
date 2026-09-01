// BUDGET MANAGEMENT — /financials/budgets (North Star P1, page 12).
//
// Design authority: docs/north-star/financials/North Star - Financials 12 Budget Management.dc.html.
// Governed creation, revision, review and approval of versioned budgets; plan history is
// never rewritten. Superseded rows stay listed, quieted; the version chain is visible in
// place. Scope, category and period are immutable on revision — only amount and reason
// move, in a new version.
//
// Current-main truth: FIN-003 budget records merged, dormant, no storage; FIN-007 approval
// policy not configured (no thresholds, self-approval rules or routing asserted). All
// mutating actions render disabled with that truth. Single-currency operation (USD);
// multi-currency is named FUTURE by the design and not drawn.
import { useState } from "react";
import {
  FinancialsPageFrame,
  FinancialsFilterRail,
  FinancialsHonestSection,
  FinAnnotation,
} from "./FinancialsPrimitives.jsx";
import FilterBar from "../../shared/ui/FilterBar";

const VIEW_OPTIONS = [
  // "Active budgets", not bare "Active" — ADR-012 §2.2a: name the concept.
  { key: "active", label: "Active budgets" },
  { key: "awaiting", label: "Awaiting approval" },
  { key: "superseded", label: "Superseded" },
  { key: "draft", label: "Draft" },
];

export default function FinancialsBudgets() {
  const [company, setCompany] = useState("consolidated");
  const [view, setView] = useState("active");

  return (
    <FinancialsPageFrame
      title="Budget Management"
      crumb="Budget Management"
      custody="Versioned budgets under governed creation, revision and approval. Plan history is never rewritten — a revision is a new version; the old one stays, superseded."
      custodyTip="Scope, category and period are immutable on revision; only the amount and reason move, in a new version whose chain stays visible. Approval routing and thresholds are FIN-007 policy — not configured, and never asserted by this page."
      action={
        <span className="fin-action-slot">
          <button type="button" className="fin-primary-action" disabled>
            New budget
          </button>
          <span className="fin-inact">
            Budget commands are not active · approval policy not configured
            <FinAnnotation tip="The FIN-003 plan core is merged and dormant — no budget collection or command is activated, and no plan capability exists in the catalog yet. FIN-007 approval policy (thresholds, routing, self-approval rules) is unconfigured and fails closed." />
          </span>
        </span>
      }
    >
      <FinancialsFilterRail company={company} onCompanyChange={setCompany} periodLabel="Period — fiscal period" />
      <FilterBar variant="views" label="Budget views" options={VIEW_OPTIONS} activeKey={view} onChange={setView} />

      <FinancialsHonestSection
        id="fin-budgets"
        title="Budgets"
        meta="version chains visible in place · superseded stays listed, quieted · USD single-currency operation"
        honest={{
          state: "NOT_ENABLED",
          detail:
            "No budget records exist yet. The FIN-003 plan core (versioned budgets, distinct from goals, explicit measurement basis) is merged and dormant with no storage and no read surface.",
        }}
        subject="Budget reads"
      >
        <div className="ns-table-wrap">
          <table className="ns-table">
            <caption className="fo-sr-only">Versioned budgets</caption>
            <thead>
              <tr>
                <th scope="col">Scope</th>
                <th scope="col">Category</th>
                <th scope="col">Period</th>
                <th scope="col" className="ns-num">Amount</th>
                <th scope="col">
                  Version
                  <FinAnnotation tip="The chain reads in place: v1 superseded → v2 active → v3 pending. A version is immutable once created." />
                </th>
                <th scope="col">Approval</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
          </table>
        </div>
      </FinancialsHonestSection>
    </FinancialsPageFrame>
  );
}
