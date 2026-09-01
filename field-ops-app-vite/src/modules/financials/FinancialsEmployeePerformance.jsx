// SALESPERSON & EMPLOYEE PERFORMANCE — /financials/employee-performance (North Star P1, page 15).
//
// Design authority: docs/north-star/financials/North Star - Financials 15 Employee Performance.dc.html.
// Individual and team financial performance where VISIBILITY IS THE COMPOSITION: the
// viewer's governed scope decides what renders, the scope statement sits in the header,
// and out-of-scope facts render as a NAMED withheld panel — never zeros, never silent
// absence. Salesperson credit and Service responsibility are two views that are never
// merged; attribution is labelled per row (creditedSalespersonId ≠ ownerEmployeeId ≠
// createdBy ≠ responsibleEmployeeId).
//
// Current-main truth: FIN-004 visibility is implemented server-side (five scopes, five
// capabilities, FIN-BLOCK-001's governed company/BU bindings). This page does not yet
// issue a scoped performance read, so it states THAT — it does not assert what reach the
// principal has.
//
// IT USED TO ASSERT ONE, AND THE ASSERTION WAS WRONG. The header said "no financial
// visibility scope granted" and the body said "finance.visibility.* inactive". In
// platform-sandbox the governed AR read answers `{status:"ready"}` for the admin persona,
// which the callable only reaches when the fact-family gate AND at least one visibility
// scope both resolve ALLOW — so the page was denying reach the principal actually had.
// The error ran conservative (under-claiming, never leaking), but a page stating an
// authority fact it never resolved is the same defect class as inventing a number.
// Scope is enforced in the read layer; this page renders whatever slice returns.
import { useState } from "react";
import {
  FinancialsPageFrame,
  FinancialsHonestSection,
  FinAnnotation,
} from "./FinancialsPrimitives.jsx";
import FilterBar from "../../shared/ui/FilterBar";

const VIEW_OPTIONS = [
  { key: "credit", label: "Salesperson credit" },
  { key: "responsibility", label: "Service responsibility" },
];

export default function FinancialsEmployeePerformance() {
  const [view, setView] = useState("credit");

  return (
    <FinancialsPageFrame
      title="Salesperson & Employee Performance"
      crumb="Salesperson & Employee Performance"
      custody="Individual and team performance, composed by governed financial visibility. Your scope decides what renders — restriction follows the number everywhere."
      custodyTip="Visibility scopes SELF / TEAM / BUSINESS_UNIT / OPERATING_COMPANY / CONSOLIDATED are enforced at the read (FIN-004, server-side; scope bindings are governed access facts per DECISIONS #157). A fact outside your scope is refused by the server and named as withheld here — it is never fetched-and-hidden, and never a zero."
    >
      <p className="fin-custody-note">
        Scope: <strong>resolved by the server when this page issues its read</strong>
        <FinAnnotation tip="Visibility scopes SELF / TEAM / BUSINESS_UNIT / OPERATING_COMPANY / CONSOLIDATED are resolved server-side per principal (FIN-004). This page does not yet issue a scoped performance read, so it does NOT state your reach — asserting a scope it has not resolved would be a claim about your authority that this page cannot make. When the read is wired, this line names the reach the server actually returned." />
      </p>

      <FilterBar variant="chips" label="Attribution view" options={VIEW_OPTIONS} activeKey={view} onChange={setView} />

      <div className="fin-overview-grid">
        <FinancialsHonestSection
          id="fin-employee-performance"
          title={view === "credit" ? "Salesperson credit" : "Service responsibility"}
          meta="two attributions, never merged · per-row attribution label when rows render"
          honest={{
            state: "NOT_ENABLED",
            detail:
              "This page does not issue a scoped performance read yet, so no rows are shown. Nothing failed, and nothing is withheld from you by this page — when the read is wired, your governed visibility scope decides which rows return, and anything outside it is named as withheld rather than zeroed.",
          }}
          subject="Performance reads"
        >
          <div className="ns-table-wrap">
            <table className="ns-table">
              <caption className="fo-sr-only">Performance by person</caption>
              <thead>
                <tr>
                  <th scope="col">
                    Person
                    <FinAnnotation tip="Attribution is labelled per row: creditedSalespersonId ≠ ownerEmployeeId ≠ createdBy ≠ responsibleEmployeeId. The credit view attributes strictly by creditedSalespersonId (a FIN-002-complete fact)." />
                  </th>
                  <th scope="col">Basis</th>
                  <th scope="col" className="ns-num">Actual</th>
                  <th scope="col" className="ns-num">Goal</th>
                  <th scope="col">Attainment</th>
                </tr>
              </thead>
            </table>
          </div>
        </FinancialsHonestSection>

        <aside className="fin-rail">
          <section className="ns-section" aria-label="Outside your scope">
            <div className="ns-section__head">
              <h2 className="ns-section__title">Outside your scope</h2>
            </div>
            <p className="ns-state ns-state--denied">
              Figures beyond your visibility scope are withheld by the server and named here — they
              are never rendered as zeros and never silently omitted.
            </p>
          </section>
          <section className="ns-section" aria-label="Margin by person">
            <div className="ns-section__head">
              <h2 className="ns-section__title">Margin by person</h2>
            </div>
            <p className="ns-state ns-state--na">
              Unavailable: gross margin requires FIN-006 cost supply, and who may see margin by
              person is an open product question (FIN-PQ-15a).
            </p>
          </section>
        </aside>
      </div>
    </FinancialsPageFrame>
  );
}
