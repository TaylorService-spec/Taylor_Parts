// CREDITS & ADJUSTMENTS — /financials/credits-adjustments (North Star P1, page 06).
//
// Design authority: docs/north-star/financials/North Star - Financials 06 Credits Adjustments.dc.html.
// Invariant (visible contract copy): corrections create new governed events; the original
// remains history. Every row points at the event it corrects; nothing edits an issued
// record in place. Declined corrections are shown, never hidden.
//
// Current-main truth: the adjustment/refund cores (recordInvoiceAdjustment, recordRefund)
// are merged and dormant — not greenfield. What is missing is governance: approval
// thresholds, dual-control, write-off and discount/override policy (FIN-007). The approval
// mechanism itself forbids self-approval and fails closed on missing policy. No corrections
// read callable exists. Actions render disabled with the policy truth; the body states its
// state. Attribution adjustments (salesperson recredit) are FUTURE and not drawn as a type.
import { useState } from "react";
import {
  FinancialsPageFrame,
  FinancialsFilterRail,
  FinancialsHonestSection,
  FinAnnotation,
} from "./FinancialsPrimitives.jsx";
import FilterBar from "../../shared/ui/FilterBar";
import { unwiredReadHonestState } from "../../domain/financialsSurface.js";

const TYPE_OPTIONS = [
  { key: "all", label: "All types" },
  { key: "credit", label: "Credit" },
  { key: "adjustment", label: "Adjustment" },
  { key: "refund", label: "Refund" },
  { key: "writeOff", label: "Write-off" },
];

const VIEW_OPTIONS = [
  { key: "all", label: "All" },
  { key: "awaiting", label: "Awaiting approval" },
  { key: "approved", label: "Approved" },
  { key: "declined", label: "Declined" },
];

export default function FinancialsCreditsAdjustments() {
  const [company, setCompany] = useState("consolidated");
  const [type, setType] = useState("all");
  const [view, setView] = useState("all");

  return (
    <FinancialsPageFrame
      title="Credits & Adjustments"
      crumb="Credits & Adjustments"
      custody="Corrections create new governed events. The original event remains history."
      custodyTip="The page's invariant, permanently visible. Every correction points at the original event it corrects; nothing here edits an issued record in place. FIN-007 governs who may correct what, at what threshold, with whose approval — self-approval is forbidden by current authority, and missing approval policy fails closed."
      action={
        <span className="fin-action-slot">
          <button type="button" className="fin-primary-action" disabled>
            New correction
          </button>
          <span className="fin-inact">
            Corrections aren&rsquo;t wired to this surface · approval policy not configured
            <FinAnnotation tip="The adjustment and refund cores exist, but this page has no governed command path wired to them, and FIN-007 approval policy — thresholds, approver roles, dual-control, escalation, expiry — is not configured; the mechanism fails closed rather than inventing a policy. Whether under-threshold corrections auto-approve is an open FIN-007 governance decision. This line does not assert any capability's activation state." />
          </span>
        </span>
      }
    >
      <FinancialsFilterRail company={company} onCompanyChange={setCompany} />
      <FilterBar variant="chips" label="Correction type" options={TYPE_OPTIONS} activeKey={type} onChange={setType} />
      <FilterBar variant="views" label="Approval state" options={VIEW_OPTIONS} activeKey={view} onChange={setView} />

      <FinancialsHonestSection
        id="fin-corrections"
        title="Corrections"
        meta="every row keeps original event, reason, actor, approver and resulting effect · declined shown, never hidden"
        honest={unwiredReadHonestState()}
        subject="Correction reads"
      >
        <div className="ns-table-wrap">
          <table className="ns-table">
            <caption className="fo-sr-only">Governed correction events</caption>
            <thead>
              <tr>
                <th scope="col">Correction</th>
                <th scope="col">Original event</th>
                <th scope="col">Type</th>
                <th scope="col" className="ns-num">Amount</th>
                <th scope="col">Reason</th>
                <th scope="col">
                  Actor → Approver
                  <FinAnnotation tip="Actor and approver are distinct governed facts. Self-approval is forbidden. Attribution adjustments (recrediting a sale to a different salesperson) are FUTURE scope — no attribution-correction authority exists, so the type is not offered." />
                </th>
                <th scope="col">Status</th>
              </tr>
            </thead>
          </table>
        </div>
      </FinancialsHonestSection>
    </FinancialsPageFrame>
  );
}
