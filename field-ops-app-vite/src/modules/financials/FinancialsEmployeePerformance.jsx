// SALESPERSON & EMPLOYEE PERFORMANCE — /financials/employee-performance (North Star P1, page 15).
//
// Design authority: docs/north-star/financials/North Star - Financials 15 Employee Performance.dc.html.
// Individual and team financial performance where VISIBILITY IS THE COMPOSITION: the viewer's
// governed scope decides what renders, the scope statement sits in the header, and out-of-scope
// facts are named rather than zeroed. Salesperson credit and Service responsibility are two views
// that are never merged.
//
// ════════════════ WIRED — AND HONESTLY PARTIAL ════════════════
//
// The credit view reads the governed reporting seam's per-salesperson rollup, which the SERVER
// computes from each invoice's frozen `attribution.creditedSalespersonId`. Credit is never
// re-derived here from customer owner, createdBy, assignment or territory, and this page does not
// join back to the Sales Order to recover it — historical credit is frozen at issuance, and
// recomputing it from a mutable record would replace history with a guess.
//
// That fidelity has a visible cost, and it is the correct cost. Invoices issued by a command build
// that predates attribution stamping carry no credited salesperson at all. They are real, they are
// visible, and they are NOT placed on this axis — the note beneath the table says how many, so the
// table reconciles against the invoice collection instead of quietly disagreeing with it. No
// person gets a zero row for work the record cannot attribute to them.
//
// The scope line states what the SERVER returned as the principal's reach. It is not a guess: an
// earlier revision of this page asserted "no financial visibility scope granted" without ever
// resolving it, and in sandbox that assertion was false.
import { useState } from "react";
import { FinancialsPageFrame, FinancialsHonestSection, FinAnnotation } from "./FinancialsPrimitives.jsx";
import FilterBar from "../../shared/ui/FilterBar";
import { useFinancialFacts } from "../../hooks/useFinancialFacts.js";
import { useEmployeeDirectory } from "../../hooks/useEmployeeDirectory.js";
import { resolveEmployeeIdentity } from "../../domain/actorDisplayName.js";
import {
  FACTS_STATE,
  FACTS_DETAIL,
  financialFactsState,
  rollupRow,
  unattributedNote,
  scopeSentence,
} from "../../domain/financialFactsView.js";

const VIEW_OPTIONS = [
  { key: "credit", label: "Salesperson credit" },
  { key: "responsibility", label: "Service responsibility" },
];

const RESPONSIBILITY_DETAIL =
  "Service responsibility is a different attribution from salesperson credit and is never merged with it. No governed financial read exposes a responsible-employee dimension, so this view has no rows to show — and credit rows are not relabelled to fill it.";

export default function FinancialsEmployeePerformance() {
  const [view, setView] = useState("credit");

  const read = useFinancialFacts({ factTypes: ["INVOICE"] });
  const { state, result } = financialFactsState(read);
  const ready = state === FACTS_STATE.READY;

  // A PERSON'S NAME, NOT THEIR KEY. The rollup is keyed by creditedSalespersonId because that is
  // the frozen financial fact; the directory only supplies the label a human reads. The grouping
  // never uses the name — a display name is mutable, and money must not regroup when someone marries.
  const { byEmployeeId, loading: directoryLoading, error: directoryError } = useEmployeeDirectory();

  const rows = ready && view === "credit" ? (result.byCreditedSalesperson ?? []).map(rollupRow) : [];
  const unattributed = ready && view === "credit" ? unattributedNote(result, "creditedSalesperson") : null;
  const scope = ready ? scopeSentence(result) : null;

  const honest =
    view === "responsibility"
      ? { state: "NOT_ENABLED", detail: RESPONSIBILITY_DETAIL }
      : ready && rows.length === 0
        ? {
            state: "EMPTY",
            detail:
              "The governed read answered, and no invoice in your visibility scope carries a credited salesperson. This is a fact about the records, not about your reach — the note below states how many facts could not be attributed.",
          }
        : ready
          ? { state: null }
          : { state, detail: FACTS_DETAIL[state] ?? null };

  return (
    <FinancialsPageFrame
      title="Salesperson & Employee Performance"
      crumb="Salesperson & Employee Performance"
      custody="Individual and team performance, composed by governed financial visibility. Your scope decides what renders — restriction follows the number everywhere."
      custodyTip="Visibility scopes SELF / TEAM / BUSINESS_UNIT / OPERATING_COMPANY / CONSOLIDATED are enforced at the read (FIN-004, server-side; scope bindings are governed access facts per DECISIONS #157). A fact outside your scope is refused by the server and named as withheld here — it is never fetched-and-hidden, and never a zero."
    >
      <p className="fin-custody-note">
        Scope: <strong>{scope ?? "resolved by the server when this read answers"}</strong>
        <FinAnnotation tip="This line reports the reach the SERVER returned for your principal, not a scope this page inferred. Visibility scopes are resolved per principal at the read (FIN-004); a page asserting an authority fact it has not resolved is the same defect class as a page inventing a number." />
      </p>

      <FilterBar variant="chips" label="Attribution view" options={VIEW_OPTIONS} activeKey={view} onChange={setView} />

      <div className="fin-overview-grid">
        <FinancialsHonestSection
          id="fin-employee-performance"
          title={view === "credit" ? "Salesperson credit" : "Service responsibility"}
          meta="two attributions, never merged · per-row attribution label when rows render"
          honest={honest}
          subject="Performance reads"
          footer={unattributed ? <p className="fin-section-note">{unattributed}</p> : null}
        >
          <div className="ns-table-wrap">
            <table className="ns-table">
              <caption className="fo-sr-only">Performance by person</caption>
              <thead>
                <tr>
                  <th scope="col">
                    Person
                    <FinAnnotation tip="Attribution is labelled per row: creditedSalespersonId ≠ ownerEmployeeId ≠ createdBy ≠ responsibleEmployeeId. The credit view attributes strictly by the invoice's frozen creditedSalespersonId (a FIN-002 fact), never by who owns the customer or who created the record." />
                  </th>
                  <th scope="col">Basis</th>
                  <th scope="col" className="ns-num">Billed</th>
                  <th scope="col" className="ns-num">Collected</th>
                  <th scope="col" className="ns-num">Outstanding</th>
                  <th scope="col" className="ns-num">
                    Goal
                    <FinAnnotation tip="No goal records exist: FIN-005 goal authority is merged and dormant with no persisted goals, so attainment cannot be computed truthfully and is never estimated." />
                  </th>
                </tr>
              </thead>
              {rows.length > 0 ? (
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.key}>
                      <td>
                        {resolveEmployeeIdentity(row.key, {
                          byEmployeeId,
                          loading: directoryLoading,
                          error: directoryError,
                          noun: "salesperson",
                        }).name ?? "Resolving…"}
                        <span className="fin-attr-label"> · credited salesperson</span>
                      </td>
                      <td>Billed</td>
                      <td className="ns-num">{row.billed}</td>
                      <td className="ns-num">{row.collected}</td>
                      <td className="ns-num">{row.outstanding}</td>
                      <td className="ns-num">
                        <span className="fin-inact">No goal records</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              ) : null}
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
