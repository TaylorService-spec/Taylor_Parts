// ACCOUNTS RECEIVABLE — /financials/accounts-receivable (North Star P1, page 04).
//
// Design authority: docs/north-star/financials/North Star - Financials 04 Accounts Receivable.dc.html.
// Issued-but-unpaid OPERATIONAL exposure — explicitly not accounting-reconciled. Aging
// starts from the governed dueDate (established by current invoice authority); no DSO or
// risk score exists because no authority computes one.
//
// Current-main truth: A/R derives from issued invoices minus applications/credits inside
// the dormant finance cores. The only wired read is per-account (listAccountInvoiceAr,
// inactive capability); the cross-customer exposure read this page composes is not
// activated. Structure ships whole; the body states its truth.
import { useState } from "react";
import {
  FinancialsPageFrame,
  FinancialsFilterRail,
  FinancialsHonestSection,
  FinAnnotation,
} from "./FinancialsPrimitives.jsx";
import { AR_AGING_BUCKETS, READ_STATE_DETAIL } from "../../domain/financialsSurface.js";

export default function FinancialsAccountsReceivable() {
  const [company, setCompany] = useState("consolidated");

  return (
    <FinancialsPageFrame
      title="Accounts Receivable"
      crumb="Accounts Receivable"
      custody="Issued but unpaid operational exposure. Operational actual — not an accounting-reconciled balance; no accounting authority is connected."
      custodyTip="A/R composes issued invoices minus governed applications and credits. Aging starts from the governed dueDate established by invoice authority. Disputed-invoice, promise-to-pay and terms-change aging treatments are not implemented (FIN-AG-DUEDATE-POLICY) and are never silently invented."
    >
      <FinancialsFilterRail company={company} onCompanyChange={setCompany} />

      <section className="fin-scorecard-section" aria-label="Aging">
        <div className="fin-scorecard fin-scorecard--aging">
          {AR_AGING_BUCKETS.map((bucket) => (
            <div key={bucket.key} className="fin-scorecard__slot">
              <div className="fin-figure">
                <div className="fin-figure__label">{bucket.label}</div>
                <div className="fin-figure__absence">No read on this surface</div>
                <span className="fin-factclass">Operational actual</span>
              </div>
            </div>
          ))}
        </div>
        <p className="fin-section-note">
          One aging grammar, everywhere
          <FinAnnotation tip="One canonical bucket vocabulary — Current / 1–30 / 31–60 / 61+ — used on every surface that ages receivables. No repository authority distinguishes finer buckets yet; this display choice is UI-only and recorded in the reconciliation doc. Current invoices show no day count. No DSO and no risk score: neither has authority." />
        </p>
      </section>

      <FinancialsHonestSection
        id="fin-ar-by-customer"
        title="Exposure by customer"
        meta="largest exposure first · drills to invoice records and Customer Financials"
        honest={{ state: "NOT_ENABLED", detail: READ_STATE_DETAIL.noReadOnSurface }}
        subject="A/R reads"
      >
        <div className="ns-table-wrap">
          <table className="ns-table">
            <caption className="fo-sr-only">Receivables grouped by customer</caption>
            <thead>
              <tr>
                <th scope="col">Customer</th>
                <th scope="col">Invoice</th>
                <th scope="col">Due</th>
                <th scope="col">Age</th>
                <th scope="col" className="ns-num">Original</th>
                <th scope="col" className="ns-num">Applied</th>
                <th scope="col" className="ns-num">Outstanding</th>
              </tr>
            </thead>
          </table>
        </div>
      </FinancialsHonestSection>
    </FinancialsPageFrame>
  );
}
