// INVOICES — /financials/invoices (North Star P1, page 03).
//
// Design authority: docs/north-star/financials/North Star - Financials 03 Invoices.dc.html.
// The governed invoice collection: tabs → one table. Deliberately NO "New Invoice" action —
// invoice issuance is Billing Queue-owned. Issued records are immutable; a mixed-BU invoice
// says "Mixed" at collection level because line-level BU is the only unit truth.
//
// Current-main truth: the invoice command core and the account-scoped AR read are merged and
// dormant; no invoice-collection read callable exists, and the `invoices` collection is
// deny-all to clients. The approved composition therefore renders with its one honest body
// state — never a raw collection read, never specimen rows.
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
  { key: "open", label: "Open" },
  { key: "paid", label: "Paid" },
  { key: "corrected", label: "Corrected" },
];

export default function FinancialsInvoices() {
  const [company, setCompany] = useState("consolidated");
  const [view, setView] = useState("all");
  const honest = unwiredReadHonestState();

  return (
    <FinancialsPageFrame
      title="Invoices"
      crumb="Invoices"
      custody="Governed invoice collection. Issued invoices are immutable history — corrections are governed events in Credits & Adjustments, never edits here."
      custodyTip="Invoice issuance is Billing Queue-owned: there is deliberately no New Invoice action on this collection. Company authority comes from the Sales Order's operatingCompanyId (FIN-002); business unit is line-level, so a mixed invoice reads 'Mixed' at collection level rather than forcing one unit onto it."
    >
      <FinancialsFilterRail company={company} onCompanyChange={setCompany} />
      <FilterBar variant="views" label="Invoice views" options={VIEW_OPTIONS} activeKey={view} onChange={setView} />

      <FinancialsHonestSection
        id="fin-invoices-collection"
        title="Invoice collection"
        meta="reconciliation status column reserved until FIN-010 activates"
        honest={honest}
        subject="Invoice reads"
      >
        <div className="ns-table-wrap">
          <table className="ns-table">
            <caption className="fo-sr-only">Governed invoices</caption>
            <thead>
              <tr>
                <th scope="col">Invoice</th>
                <th scope="col">Customer</th>
                <th scope="col">
                  Company · Unit
                  <FinAnnotation tip="Line-level business unit is the only unit truth (FIN-002). An invoice whose lines span units reads 'Mixed' here; unit filtering resolves per line, never per header." />
                </th>
                <th scope="col">Issued</th>
                <th scope="col">Due</th>
                <th scope="col" className="ns-num">Total</th>
                <th scope="col" className="ns-num">Applied</th>
                <th scope="col" className="ns-num">Outstanding</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
          </table>
        </div>
      </FinancialsHonestSection>
    </FinancialsPageFrame>
  );
}
