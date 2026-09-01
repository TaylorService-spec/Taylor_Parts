// BILLING QUEUE — /financials/billing-queue (North Star P1, page 02).
//
// Design authority: docs/north-star/financials/North Star - Financials 02 Billing Queue.dc.html.
// The page answers "what can be billed, what is blocked, why" before any list. Billing
// readiness ≠ Work Order COMPLETE: a complete WO can be unbillable and an incomplete one can
// carry billable milestones. Responsible ≠ credited — never collapsed into one "owner".
//
// Current-main truth: Commercial Sales Order billing eligibility is governed logic that
// exists server-side; SERVICE billing readiness is the open gap (FIN-BLOCK-002, Owner
// decision package prepared). No billing-readiness read callable exists, and the invoice
// command core (issueInvoice / finance.invoice.issue) is merged and inactive — so the bulk
// Create-invoices action renders disabled with the capability-inactive one-liner the design
// draws, and the queue body states its truth.
import { useState } from "react";
import {
  FinancialsPageFrame,
  FinancialsFilterRail,
  FinancialsHonestSection,
  FinancialFigure,
  FinAnnotation,
} from "./FinancialsPrimitives.jsx";
import FilterBar from "../../shared/ui/FilterBar";
import { unwiredReadHonestState } from "../../domain/financialsSurface.js";

const VIEW_OPTIONS = [
  { key: "eligible", label: "Eligible" },
  { key: "blocked", label: "Blocked" },
  { key: "partial", label: "Partially invoiced" },
  { key: "all", label: "All" },
];

export default function FinancialsBillingQueue() {
  const [company, setCompany] = useState("consolidated");
  const [businessUnit, setBusinessUnit] = useState("all");
  const [view, setView] = useState("eligible");

  return (
    <FinancialsPageFrame
      title="Billing Queue"
      crumb="Billing Queue"
      custody="Work financially eligible or potentially eligible to invoice. Billing readiness is a governed fact — never inferred from Work Order COMPLETE."
      custodyTip="Eligibility is a governed billing-readiness fact. Commercial Sales Order eligibility logic exists; SERVICE billing readiness (Work Order COMPLETE ≠ billed) is an open Owner decision (FIN-BLOCK-002) — the two readiness models stay separate, and no universal model is implied."
      action={
        <span className="fin-action-slot">
          <button type="button" className="fin-primary-action" disabled>
            Create invoices
          </button>
          <span className="fin-inact">
            Issuing isn&rsquo;t wired to this queue yet, and no items are listed to issue
            <FinAnnotation tip="The invoice command core (issueInvoice) exists, but this page has no governed command path wired to it and no readiness read to select items from — so the action stays disabled. Blocked items would never expose the action regardless of capability. This one-liner deliberately does not assert whether any capability is active: the page has not resolved that, and the server decides at execution time." />
          </span>
        </span>
      }
    >
      <FinancialsFilterRail
        company={company}
        onCompanyChange={setCompany}
        businessUnit={businessUnit}
        onBusinessUnitChange={setBusinessUnit}
        periodLabel="Period — all open"
      />

      <section className="fin-scorecard-section" aria-label="Queue totals">
        {/* Two slots, so a two-column band — the four-column variant left the right half
            of a full-width ruled row empty. */}
        <div className="fin-scorecard fin-scorecard--pair">
          <div className="fin-scorecard__slot">
            <FinancialFigure label="Eligible to invoice" factClass="OPERATIONAL_ACTUAL" absence="No readiness read" />
          </div>
          <div className="fin-scorecard__slot">
            <FinancialFigure label="Blocked" factClass="OPERATIONAL_ACTUAL" absence="No readiness read" />
          </div>
        </div>
      </section>

      <FilterBar variant="views" label="Queue views" options={VIEW_OPTIONS} activeKey={view} onChange={setView} />

      <FinancialsHonestSection
        id="fin-billing-queue"
        title="Queue"
        meta="blocked rows carry their governed blocking reason inline · responsible ≠ credited, labelled per row"
        honest={unwiredReadHonestState()}
        subject="Billing-readiness reads"
      >
        <div className="ns-table-wrap">
          <table className="ns-table">
            <caption className="fo-sr-only">Billing queue items</caption>
            <thead>
              <tr>
                <th scope="col">Source</th>
                <th scope="col">Customer</th>
                <th scope="col">Company · Unit</th>
                <th scope="col">
                  Responsible
                  <FinAnnotation tip="Responsible vs credited person is labelled per row because ownerEmployeeId ≠ creditedSalespersonId ≠ createdBy — the queue never collapses them into one 'owner'." />
                </th>
                <th scope="col" className="ns-num">Amount</th>
                <th scope="col">Eligibility</th>
                <th scope="col" className="ns-num">Age</th>
                <th scope="col">Invoice state</th>
              </tr>
            </thead>
          </table>
        </div>
      </FinancialsHonestSection>
    </FinancialsPageFrame>
  );
}
