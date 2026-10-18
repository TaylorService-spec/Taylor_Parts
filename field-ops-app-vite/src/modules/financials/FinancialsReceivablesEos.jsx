// RECEIVABLES -- /financials/invoices and /financials/accounts-receivable WHERE AN EOS API IS DECLARED (Firebase exit B1, DECISIONS #B1).
//
// The Finance register's RECEIVABLE obligations -- EOS operational truth that money is owed (DECISIONS #197), NOT the accounting
// invoice. This is the replacement for the Firebase `listFinancialFacts` Invoices and Accounts Receivable pages: the same grammar
// (filter rail, views, honest states), the EOS vocabulary (Receivable), and the server's own figures. The company boundary AND the
// credited-person / team reach are decided by the server; a restricted reader sees a part of the book and the page says so.
//
// NOTHING IS INVENTED. The register carries no invoice number, no issue date and no business unit: each is named as a model decision
// (domain/financialsEos.js NOT_SUPPLIED) instead of being shown as a blank or fabricated. No amount is totalled here: the scorecard
// and the aging buckets are the server's, per currency.
import { useState } from "react";
import { Link } from "react-router-dom";
import { FinancialsPageFrame, FinancialsFilterRail, FinancialsHonestSection, FinSortableHeader, FinAnnotation } from "./FinancialsPrimitives.jsx";
import { companyWords, labelWords } from "./financialsDisplay.js";
import { useTableSort } from "../../shared/ui/sorting/useTableSort.js";
import FilterBar from "../../shared/ui/FilterBar";
import { useAccountNames } from "../../hooks/useAccountNames.js";
import { useFinancialsPeriod } from "../../hooks/useFinancialsPeriod.js";
import { useEosFinanceRead } from "../../hooks/useEosFinanceRead.js";
import { fetchFinancialFactsFromEos, OBLIGATION_PAGE_LIMIT } from "../../services/eosFinancialsClient.js";
import { AR_AGING_BUCKETS } from "../../domain/financialsSurface.js";
import { NOT_SUPPLIED } from "../../domain/financialsEos.js";
import { FACTS_STATE, FACTS_DETAIL, financialFactsState, invoiceRow, agingSlots, unagedNote, formatByCurrency } from "../../domain/financialFactsView.js";

const VIEW_OPTIONS = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "settled", label: "Settled" },
  { key: "void", label: "Void" },
];

function applyView(rows, view) {
  if (view === "open") return rows.filter((r) => r.raw.outstandingMinor > 0 && r.raw.arPosition !== "VOID");
  if (view === "settled") return rows.filter((r) => r.raw.arPosition === "SETTLED");
  if (view === "void") return rows.filter((r) => r.raw.arPosition === "VOID");
  return rows;
}

const dateWords = (ms) => (typeof ms === "number" ? new Date(ms).toLocaleDateString() : "—");
/** The EOS record reference: the register's own id, shortened. Not an invoice number (MD-B1-1). */
export const recordRef = (id) => String(id).replace(/^obl_/, "").slice(0, 8).toUpperCase();

/** @param {{ mode?: "invoices" | "ar" }} props  invoices = the whole collection with views; ar = the open exposure with aging. */
export default function FinancialsReceivablesEos({ mode = "invoices" }) {
  const [company, setCompany] = useState("consolidated");
  const [view, setView] = useState(mode === "ar" ? "open" : "all");
  const period = useFinancialsPeriod();
  const isAr = mode === "ar";

  const filters = { companyId: company === "consolidated" ? null : company, factTypes: ["INVOICE"], ...period.requestFields };
  const read = useEosFinanceRead(() => fetchFinancialFactsFromEos(filters), JSON.stringify(filters), { enabled: !period.blocked });
  const { state, result } = financialFactsState(read);
  const answered = state === FACTS_STATE.READY || state === FACTS_STATE.EMPTY;
  const all = answered ? result.invoices.map((i) => ({ ...invoiceRow(i), raw: i })) : [];
  const rows = applyView(all, isAr ? "open" : view);
  const names = useAccountNames(rows.map((r) => r.accountId).filter(Boolean));
  const aging = agingSlots(state, result);
  const unaged = answered ? unagedNote(result) : null;

  const columns = {
    record: { value: (r) => r.invoiceId },
    customer: { value: (r) => (r.accountId ? (names.get(r.accountId) ?? null) : null) },
    company: { value: (r) => companyWords(r.companyId) },
    due: { value: (r) => (typeof r.dueDate === "number" ? r.dueDate : null) },
    total: { value: (r) => r.raw.totalMinor ?? null },
    applied: { value: (r) => r.raw.appliedMinor ?? null },
    outstanding: { value: (r) => r.raw.outstandingMinor ?? null },
    status: { value: (r) => r.position },
  };
  const { sort, toggle, sorted } = useTableSort({ rows, columns });
  const th = (key, label, extra = {}) => <FinSortableHeader columnKey={key} label={label} sort={sort} onSort={toggle} {...extra} />;

  const honest = answered && rows.length === 0
    ? { state: "EMPTY", detail: period.presetKey === "all"
      ? "The Finance register answered, and no receivable within your visibility matches this view."
      : `No receivables were recorded in this period (${period.label}), or none match this view. The period narrows by the date EOS recorded the receivable. Choose All activity to see the full set.` }
    : answered ? { state: null } : { state, detail: FACTS_DETAIL[state] ?? null };

  return (
    <FinancialsPageFrame
      title={isAr ? "Accounts Receivable" : "Receivables"}
      crumb={isAr ? "Accounts Receivable" : "Receivables"}
      custody={isAr
        ? "Open receivables from the Finance register. Operational actual — not an accounting-reconciled balance; the formal invoice belongs to the accounting authority."
        : "The Finance register's receivables. EOS operational truth that money is owed — not the accounting invoice. Corrections are separate governed events, never edits here."}
      custodyTip="A Receivable is the register's record that a customer owes money, with its settlement applications and history. The formal invoice number and issue date belong to the accounting authority (DECISIONS #191, #197) and are named as not supplied, never invented. Company reach and credited-person / team reach are decided by the server."
    >
      <FinancialsFilterRail company={company} onCompanyChange={setCompany} period={period.controlProps} />
      {!isAr ? <FilterBar variant="views" label="Receivable Views" options={VIEW_OPTIONS} activeKey={view} onChange={setView} /> : null}

      {answered && result.restricted ? (
        <div className="fin-truth-band" role="note">
          <strong>A part of the book.</strong> Your Finance visibility is limited to the receivables credited to you or your team, so every
          row and every total below covers only those. Other receivables are not hidden by a filter — they are outside your visibility.
        </div>
      ) : null}

      {isAr ? (
        <section className="fin-scorecard-section" aria-label="Aging">
          <div className="fin-scorecard fin-scorecard--aging">
            {AR_AGING_BUCKETS.map((bucket) => (
              <div key={bucket.key} className="fin-scorecard__slot">
                <div className="fin-figure">
                  <div className="fin-figure__label">{labelWords(bucket.label)}</div>
                  {aging[bucket.key] ? (
                    <div className="fin-figure__value">{aging[bucket.key]}</div>
                  ) : (
                    <div className="fin-figure__absence">{answered ? "Not supplied for this scope" : "Reading…"}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
          {unaged ? <p className="fin-section-note">{unaged}</p> : null}
        </section>
      ) : answered && result.summary ? (
        <section className="fin-scorecard-section" aria-label="Receivable totals">
          <div className="fin-scorecard fin-scorecard--three">
            {[["Billed", result.summary.billedByCurrency], ["Collected", result.summary.collectedByCurrency], ["Outstanding", result.summary.outstandingByCurrency]].map(([label, byCurrency]) => (
              <div key={label} className="fin-scorecard__slot">
                <div className="fin-figure"><div className="fin-figure__label">{label}</div><div className="fin-figure__value">{formatByCurrency(byCurrency)}</div></div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <FinancialsHonestSection
        id="fin-receivables-collection"
        title={isAr ? "Open Receivables" : "Receivable Collection"}
        meta="the register's records · settlement applications and history on each"
        honest={honest}
        subject="Receivable reads"
        footer={answered ? (
          <p className="fin-section-note">
            Invoice number, issue date and business unit are <strong>not supplied</strong> by the Finance register: {NOT_SUPPLIED.invoiceNumber.id}, {NOT_SUPPLIED.issueDate.id} and {NOT_SUPPLIED.businessUnit.id} are named model decisions.
            {result.truncated ? ` Showing the first ${OBLIGATION_PAGE_LIMIT} per company; narrow the company or period to see the rest.` : ""}
          </p>
        ) : null}
      >
        <div className="ns-table-wrap">
          <table className="ns-table">
            <caption className="fo-sr-only">Receivables</caption>
            <thead>
              <tr>
                {th("record", "Record", { tip: "The Finance register's own reference (not an invoice number: MD-B1-1)." })}
                {th("customer", "Customer")}
                {th("company", "Company")}
                {th("due", "Due")}
                {th("total", "Original", { className: "ns-num" })}
                {th("applied", "Settled", { className: "ns-num" })}
                {th("outstanding", "Outstanding", { className: "ns-num" })}
                {th("status", "Status")}
              </tr>
            </thead>
            {rows.length > 0 ? (
              <tbody>
                {sorted.map((row) => (
                  <tr key={row.invoiceId}>
                    <td className="fin-nowrap"><Link to={`/financials/invoices/${row.invoiceId}`}>{recordRef(row.invoiceId)}</Link></td>
                    <td>
                      {row.accountId ? <Link to={`/customers/${row.accountId}`}>{names.get(row.accountId) ?? row.counterpartyName ?? "Customer name not resolved"}</Link> : "—"}
                    </td>
                    <td>{companyWords(row.companyId)}</td>
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
        <FinAnnotation tip="Original is what the receivable originated for; Settled is the sum of applied settlements net of reversals; Outstanding is what remains. All three are the server's figures." />
      </FinancialsHonestSection>
    </FinancialsPageFrame>
  );
}
