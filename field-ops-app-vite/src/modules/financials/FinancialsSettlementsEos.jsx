// SETTLEMENTS -- /financials/payments WHERE AN EOS API IS DECLARED (Firebase exit B1, DECISIONS #B1).
//
// The Finance register's settlement EVIDENCE: a customer payment, provider funding receipt, vendor payment or intercompany payment /
// receipt, for one operating company and one counterparty, with what has been applied to which receivable (DECISIONS #206).
// Replaces the Firebase `listFinancialFacts` Payments page. Received, applied, unapplied and reconciled are four different facts and
// are never blended. A restricted reader (credited-person / team reach) sees a settlement only when EVERY application ever recorded on
// it is to a receivable it may see; unapplied settlements are not shown to it, and the page says so.
import { useState } from "react";
import { Link } from "react-router-dom";
import { FinancialsPageFrame, FinancialsFilterRail, FinancialsHonestSection, FinSortableHeader, FinAnnotation } from "./FinancialsPrimitives.jsx";
import { companyWords } from "./financialsDisplay.js";
import { useTableSort } from "../../shared/ui/sorting/useTableSort.js";
import FilterBar from "../../shared/ui/FilterBar";
import { useFinancialsPeriod } from "../../hooks/useFinancialsPeriod.js";
import { useEosFinanceRead, scopedRead } from "../../hooks/useEosFinanceRead.js";
import { periodWindows, settlementRecord, settlementKindWords, isRestrictedView } from "../../domain/financialsEos.js";
import { FACTS_STATE, FACTS_DETAIL } from "../../domain/financialFactsView.js";
import { formatMoneyDisplay } from "../../domain/moneyDisplay.js";

const VIEW_OPTIONS = [
  { key: "all", label: "All" },
  { key: "unapplied", label: "Unapplied" },
  { key: "applied", label: "Fully Applied" },
  { key: "void", label: "Void" },
];
const applyView = (rows, view) =>
  view === "unapplied" ? rows.filter((s) => s.status !== "VOID" && s.unappliedMinor > 0)
    : view === "applied" ? rows.filter((s) => s.status !== "VOID" && s.unappliedMinor === 0)
      : view === "void" ? rows.filter((s) => s.status === "VOID") : rows;

const dateWords = (ms) => (typeof ms === "number" ? new Date(ms).toLocaleDateString() : "—");
const money = (minor, currency) => formatMoneyDisplay(minor, currency);
export const settlementRef = (s) => s.sourceReference ?? s.id;

export default function FinancialsSettlementsEos() {
  const [company, setCompany] = useState("consolidated");
  const [view, setView] = useState("all");
  const period = useFinancialsPeriod();
  const dateWindow = periodWindows(period.requestFields).settlements;

  const key = JSON.stringify({ company, dateWindow });
  const read = useEosFinanceRead(scopedRead(company === "consolidated" ? null : company, async (reader, scope, access) => {
    const asked = scope.companies.length > 1 && scope.total === "consolidated" ? ["consolidated"] : scope.companies;
    const lists = await Promise.all(asked.map((operatingCompanyId) => reader.settlements({ operatingCompanyId, ...dateWindow })));
    const failed = lists.find((l) => l.errorStatus);
    if (failed) return failed;
    const items = lists.flatMap((l) => (Array.isArray(l.result?.items) ? l.result.items : null));
    if (items.includes(null)) return { errorStatus: "unavailable" };
    const rows = items.map(settlementRecord);
    if (rows.includes(null)) return { errorStatus: "unavailable" };
    return { result: { rows, restricted: isRestrictedView(access), truncated: lists.some((l) => l.result.items.length >= 100) } };
  }), key, { enabled: !period.blocked });

  const answered = !read.loading && !read.errorStatus && read.result !== null;
  const state = read.loading ? FACTS_STATE.LOADING : read.errorStatus === "denied" ? FACTS_STATE.DENIED : answered ? (read.result.rows.length === 0 ? FACTS_STATE.EMPTY : FACTS_STATE.READY) : FACTS_STATE.UNAVAILABLE;
  const rows = answered ? applyView(read.result.rows, view) : [];

  const columns = {
    reference: { value: (s) => settlementRef(s) },
    kind: { value: (s) => settlementKindWords(s.kind) },
    company: { value: (s) => companyWords(s.operatingCompanyId) },
    date: { value: (s) => s.businessDateMillis },
    amount: { value: (s) => s.amountMinor },
    applied: { value: (s) => s.appliedMinor },
    unapplied: { value: (s) => s.unappliedMinor },
    reconciliation: { value: (s) => s.reconciliationStatus },
  };
  const { sort, toggle, sorted } = useTableSort({ rows, columns });
  const th = (k, label, extra = {}) => <FinSortableHeader columnKey={k} label={label} sort={sort} onSort={toggle} {...extra} />;

  const honest = answered && rows.length === 0
    ? { state: "EMPTY", detail: period.presetKey === "all"
      ? "The Finance register answered, and no settlement within your visibility matches this view."
      : `No settlements with a business date in this period (${period.label}), or none match this view. Choose All activity to see the full set.` }
    : answered ? { state: null } : { state, detail: FACTS_DETAIL[state] ?? null };

  return (
    <FinancialsPageFrame
      title="Settlements"
      crumb="Settlements"
      custody="Settlement evidence from the Finance register. Received, applied, unapplied and reconciled are four different facts and are never blended."
      custodyTip="EOS records settlement evidence (a payment, a provider funding receipt) for one company and one counterparty and applies it to receivables, fully or partially. It is never a bank fact and never nets. Reconciliation is the evidence of the external accounting system's reference and amount; with none, a settlement is simply unreconciled."
    >
      <FinancialsFilterRail company={company} onCompanyChange={setCompany} period={period.controlProps} />
      <FilterBar variant="views" label="Settlement Views" options={VIEW_OPTIONS} activeKey={view} onChange={setView} />

      {answered && read.result.restricted ? (
        <div className="fin-truth-band" role="note">
          <strong>A part of the book.</strong> Your Finance visibility is limited to the receivables credited to you or your team. A settlement
          is shown only when every application recorded on it is to one of those receivables; unapplied settlements are not shown.
        </div>
      ) : null}

      <FinancialsHonestSection
        id="fin-settlements-collection"
        title="Settlement Collection"
        meta="applications drill to receivable records · reconciliation stated, never implied"
        honest={honest}
        subject="Settlement reads"
        footer={answered && read.result.truncated ? <p className="fin-section-note">Showing the 100 most recent settlements per read; narrow the company or period to see others.</p> : null}
      >
        <div className="ns-table-wrap">
          <table className="ns-table">
            <caption className="fo-sr-only">Settlements</caption>
            <thead>
              <tr>
                {th("reference", "Reference")}
                {th("kind", "Kind")}
                {th("company", "Company")}
                {th("date", "Business Date")}
                {th("amount", "Amount", { className: "ns-num" })}
                {th("applied", "Applied", { className: "ns-num" })}
                {th("unapplied", "Unapplied", { className: "ns-num" })}
                {th("reconciliation", "Reconciliation")}
              </tr>
            </thead>
            {rows.length > 0 ? (
              <tbody>
                {sorted.map((s) => (
                  <tr key={s.id}>
                    <td className="fin-nowrap"><Link to={`/financials/payments/${s.id}`}>{settlementRef(s)}</Link></td>
                    <td>{settlementKindWords(s.kind)}{s.status === "VOID" ? " · Void" : ""}</td>
                    <td>{companyWords(s.operatingCompanyId)}</td>
                    <td>{dateWords(s.businessDateMillis)}</td>
                    <td className="ns-num">{money(s.amountMinor, s.currency)}</td>
                    <td className="ns-num">{money(s.appliedMinor, s.currency)}</td>
                    <td className="ns-num">{money(s.unappliedMinor, s.currency)}</td>
                    <td>{s.reconciliationStatus === "NOT_APPLICABLE" ? "Not applicable" : (s.reconciliationStatus ?? "Not recorded")}</td>
                  </tr>
                ))}
              </tbody>
            ) : null}
          </table>
        </div>
        <FinAnnotation tip="Amount, Applied and Unapplied are the server's figures (the unapplied remainder is derived by the register from the applications, never here)." />
      </FinancialsHonestSection>
    </FinancialsPageFrame>
  );
}
