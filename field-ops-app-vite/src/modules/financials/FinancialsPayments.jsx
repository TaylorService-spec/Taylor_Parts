// PAYMENTS — /financials/payments (North Star P1, page 05).
//
// Design authority: docs/north-star/financials/North Star - Financials 05 Payments.dc.html —
// APPROVED AS DRAWN. RECEIVED ≠ APPLIED ≠ UNAPPLIED ≠ RECONCILED.
//
// Current-main truth: the payment command core is merged and dormant — it supports cash
// receipt, application to an invoice and derived outstanding balance, and REFUSES
// over-application. A real unapplied-cash balance workflow is FUTURE AUTHORITY
// (FIN-AG-PAYMENT-UNAPPLIED, Owner policy question open) and is NOT operationalized here:
// the North Star target stays visible, clearly labelled future/unavailable, with no fake
// records behind it. No payments read callable exists yet (NOT USER-EXPOSED).
import { useState } from "react";
import {
  FinancialsPageFrame,
  FinancialsFilterRail,
  FinancialsHonestSection,
  FinAnnotation,
} from "./FinancialsPrimitives.jsx";
import FilterBar from "../../shared/ui/FilterBar";
import { unwiredReadHonestState } from "../../domain/financialsSurface.js";

const VIEW_OPTIONS = [
  { key: "all", label: "All" },
  { key: "unapplied", label: "Unapplied" },
  { key: "applied", label: "Fully applied" },
];

export default function FinancialsPayments() {
  const [company, setCompany] = useState("consolidated");
  const [view, setView] = useState("all");

  return (
    <FinancialsPageFrame
      title="Payments"
      crumb="Payments"
      custody="Governed operational payment workspace. Received, applied, unapplied and reconciled are four different facts and are never blended."
      custodyTip="The payment core records cash receipt and application to an invoice, derives outstanding balance, and refuses over-application. Applied-in-full is an operational state, not reconciliation — no banking or settlement authority is drawn, deliberately."
    >
      <FinancialsFilterRail company={company} onCompanyChange={setCompany} />
      <FilterBar variant="views" label="Payment views" options={VIEW_OPTIONS} activeKey={view} onChange={setView} />

      <div className="fin-truth-band fin-truth-band--future" role="note">
        <strong>Unapplied cash — FUTURE AUTHORITY.</strong>
        <p>
          A real unapplied-cash balance workflow is not implemented: current payment authority
          refuses over-application, so no record can truthfully carry an unapplied balance today.
          Whether such a workflow should exist at all is an open Owner policy question
          (FIN-PQ-UNAPPLIED-POLICY). This composition keeps the North Star target visible without
          enabling the behavior or seeding fake records.
          <FinAnnotation tip="Design page 05 is approved as drawn with the unapplied-cash content labelled FUTURE AUTHORITY (FIN-AG-PAYMENT-UNAPPLIED). The Unapplied view above stays part of the approved grammar; when the read activates it can only ever show what governed records truthfully contain." />
        </p>
      </div>

      <FinancialsHonestSection
        id="fin-payments-collection"
        title="Payment collection"
        meta="applications drill to invoice records · reconciliation absence stated, never implied"
        honest={unwiredReadHonestState()}
        subject="Payment reads"
      >
        <div className="ns-table-wrap">
          <table className="ns-table">
            <caption className="fo-sr-only">Governed payments</caption>
            <thead>
              <tr>
                <th scope="col">Payment</th>
                <th scope="col">Customer</th>
                <th scope="col">Received</th>
                <th scope="col">Method · Reference</th>
                <th scope="col" className="ns-num">Amount</th>
                <th scope="col" className="ns-num">Applied</th>
                <th scope="col" className="ns-num">Unapplied</th>
              </tr>
            </thead>
          </table>
        </div>
      </FinancialsHonestSection>
    </FinancialsPageFrame>
  );
}
