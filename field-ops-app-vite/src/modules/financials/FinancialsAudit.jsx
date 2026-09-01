// FINANCIAL AUDIT & HISTORY — /financials/audit (North Star P1, page 18).
//
// Design authority: docs/north-star/financials/North Star - Financials 18 Audit History.dc.html.
// A financials-focused LENS over the existing append-only auditEvents authority — never a
// second audit system, never new storage, read-only always. Rows exist only for event
// types whose authorities exist; audit rows about restricted numbers obey financial
// visibility scopes (FIN-004 protects the fact inside audit views too).
//
// Current-main truth: auditEvents IS the audit authority and exists. The financial
// filter/index over it (FIN-AG-AUDIT-LENS) is not built, and correlation-id exposure is an
// open product question (FIN-PQ-CORRELATION-IDS) — so the lens body states that truth
// rather than issuing an ungoverned raw read over the whole log.
import { useState } from "react";
import {
  FinancialsPageFrame,
  FinancialsHonestSection,
  FinAnnotation,
} from "./FinancialsPrimitives.jsx";
import FilterBar from "../../shared/ui/FilterBar";

const EVENT_CLASS_OPTIONS = [
  { key: "all", label: "All event classes" },
  { key: "invoice", label: "Invoice" },
  { key: "payment", label: "Payment" },
  { key: "correction", label: "Correction" },
  { key: "plan", label: "Plan" },
  { key: "governance", label: "Governance" },
];

export default function FinancialsAudit() {
  const [eventClass, setEventClass] = useState("all");

  return (
    <FinancialsPageFrame
      title="Financial Audit & History"
      crumb="Financial Audit & History"
      custody="A financials lens over the one append-only audit authority. Never a second audit ledger; read-only always."
      custodyTip="auditEvents is the existing audit authority — this page filters and projects it, creating no storage. Every financial phase feeds events into it; rows appear only for event types whose authorities exist. Restricted financial facts stay restricted inside audit views (FIN-004 follows the number)."
    >
      <FilterBar variant="chips" label="Event class" options={EVENT_CLASS_OPTIONS} activeKey={eventClass} onChange={setEventClass} />

      <FinancialsHonestSection
        id="fin-audit-lens"
        title="Financial events"
        meta="newest first · read-only · rows link to their financial records"
        honest={{
          state: "NOT_ENABLED",
          detail:
            "The financial lens over auditEvents (FIN-AG-AUDIT-LENS: a governed filter/index scoped to financial event classes) is not built. This page never issues a raw read over the whole audit log in its place — an ungoverned sweep would bypass the visibility scopes that protect restricted financial facts.",
        }}
        subject="Audit lens reads"
      >
        <div className="ns-table-wrap">
          <table className="ns-table">
            <caption className="fo-sr-only">Financial audit events</caption>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Actor</th>
                <th scope="col">Action</th>
                <th scope="col">Record</th>
                <th scope="col">Reason / approval</th>
                <th scope="col">
                  Correlation
                  <FinAnnotation tip="Correlation/request ids may expose sensitive implementation detail — their exposure policy is an open product question (FIN-PQ-CORRELATION-IDS, FIN-010). The column is reserved; nothing renders in it before that decision." />
                </th>
              </tr>
            </thead>
          </table>
        </div>
      </FinancialsHonestSection>
    </FinancialsPageFrame>
  );
}
