// INVOICES — /financials/invoices (North Star P1, page 03).
//
// Design authority: docs/north-star/financials/North Star - Financials 03 Invoices.dc.html.
// The governed invoice collection: tabs → one table. Deliberately NO "New Invoice" action —
// invoice issuance is Billing Queue-owned. Issued records are immutable; a mixed-BU invoice
// says "Mixed" at collection level because line-level BU is the only unit truth.
//
// WIRED to the governed reporting read (`listFinancialFacts`). The company chip and the view tab
// travel as REQUESTED FILTERS: the server intersects them with the principal's governed reach and
// may only narrow the result. Nothing on this page is authorization, and no figure below is
// computed here — every amount is the server's own derivation.
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  FinancialsPageFrame,
  FinancialsFilterRail,
  FinancialsHonestSection,
  FinAnnotation,
} from "./FinancialsPrimitives.jsx";
import FilterBar from "../../shared/ui/FilterBar";
import { useFinancialFacts } from "../../hooks/useFinancialFacts.js";
import { useFinancialsPeriod } from "../../hooks/useFinancialsPeriod.js";
import {
  FACTS_STATE,
  FACTS_DETAIL,
  financialFactsState,
  invoiceRow,
} from "../../domain/financialFactsView.js";

const VIEW_OPTIONS = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "paid", label: "Paid" },
  { key: "corrected", label: "Corrected" },
];

// The view tab selects among facts the server already returned — it is a display narrowing over an
// authorized set, never a second authorization. "Corrected" has no persisted marker on an invoice
// (corrections are separate governed adjustment events), so it selects nothing and says so.
function applyView(rows, view) {
  if (view === "open") return rows.filter((r) => r.raw.outstandingMinor > 0);
  if (view === "paid") return rows.filter((r) => r.raw.outstandingMinor <= 0 && r.raw.state !== "VOID");
  if (view === "corrected") return [];
  return rows;
}

const dateWords = (ms) => (typeof ms === "number" ? new Date(ms).toLocaleDateString() : "—");

export default function FinancialsInvoices() {
  const [company, setCompany] = useState("consolidated");
  const [view, setView] = useState("all");
  const period = useFinancialsPeriod();

  // Company, period and the view tab COMPOSE: each narrows independently and none resets another.
  // Company and period narrow on the SERVER; the view tab selects among what it returned.
  const read = useFinancialFacts(
    {
      companyId: company === "consolidated" ? null : company,
      factTypes: ["INVOICE"],
      ...period.requestFields,
    },
    // An invalid custom range issues NO read at all — see useFinancialsPeriod.
    { enabled: !period.blocked },
  );
  const { state, result } = financialFactsState(read);

  // READY and EMPTY both mean the server ANSWERED; EMPTY simply means the answer held no
  // records. Keying the filtered-empty wording on READY alone let a period-filtered zero fall
  // through to the generic sentence, which reads as "no invoices exist".
  const answered = state === FACTS_STATE.READY || state === FACTS_STATE.EMPTY;
  const rows =
    answered
      ? applyView(
          result.invoices.map((i) => ({ ...invoiceRow(i), raw: i })),
          view,
        )
      : [];

  // A view that legitimately selects nothing from a ready read is EMPTY — a fact about the filter,
  // not about authorization or availability, so it must not borrow either of those sentences.
  const honest =
    answered && rows.length === 0
      ? {
          state: "EMPTY",
          detail:
            view === "corrected"
              ? "Corrections are governed adjustment events recorded separately, not a state stamped on an invoice. No invoice can be selected by this view, and none is invented to fill it."
              : period.presetKey === "all"
                ? "The governed read answered, and no invoice in your visibility scope matches this view."
                : `No invoices in this period (${period.label}). Records outside it are not shown — this is not a statement that no invoices exist. Choose All activity to see the full set.`,
        }
      : answered
        ? { state: null }
        : { state, detail: FACTS_DETAIL[state] ?? null };

  return (
    <FinancialsPageFrame
      title="Invoices"
      crumb="Invoices"
      custody="Governed invoice collection. Issued invoices are immutable history — corrections are governed events in Credits & Adjustments, never edits here."
      custodyTip="Invoice issuance is Billing Queue-owned: there is deliberately no New Invoice action on this collection. Company authority comes from the Sales Order's operatingCompanyId (FIN-002); business unit is line-level, so a mixed invoice reads 'Mixed' at collection level rather than forcing one unit onto it."
    >
      <FinancialsFilterRail company={company} onCompanyChange={setCompany} period={period.controlProps} />
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
            {rows.length > 0 ? (
              <tbody>
                {rows.map((row) => (
                  <tr key={row.invoiceId}>
                    {/* The number is the human identity; the URL carries the document id, because
                        numbers repeat across operating companies. */}
                    <td className="fin-nowrap">
                      <Link to={`/financials/invoices/${row.invoiceId}`}>{row.invoiceNumber}</Link>
                    </td>
                    <td>{row.accountId ?? "—"}</td>
                    <td>
                      {row.companyId ?? "Not attributed"} · {row.businessUnit}
                    </td>
                    <td>{dateWords(row.issuedAtMillis)}</td>
                    <td>{dateWords(row.dueDate)}</td>
                    <td className="ns-num">{row.total}</td>
                    <td className="ns-num">{row.applied}</td>
                    <td className="ns-num">{row.outstanding}</td>
                    <td>{row.position}</td>
                  </tr>
                ))}
              </tbody>
            ) : null}
          </table>
        </div>
      </FinancialsHonestSection>
    </FinancialsPageFrame>
  );
}
