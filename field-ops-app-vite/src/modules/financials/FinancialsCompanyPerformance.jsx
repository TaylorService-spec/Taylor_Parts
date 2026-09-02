// COMPANY & BUSINESS UNIT PERFORMANCE — /financials/company-performance (North Star P1, page 14).
//
// Design authority: docs/north-star/financials/North Star - Financials 14 Company Performance.dc.html.
// Taylor vs Ventana made easy WITHOUT intercompany accounting: the contract sentence says
// consolidation here is arithmetic, and the current FIN-009 truth names it explicitly —
// UNELIMINATED_SUM until elimination policy exists. Never presented as accounting
// consolidation, GL consolidation or intercompany elimination. Consolidated attainment is
// deliberately "—" (it would silently mix bases).
//
// WIRED to the governed reporting read, which returns per-company rollups the SERVER computed over
// the invoices the principal may see. Two metric rows fill from it — Billed and A/R outstanding —
// and Collected fills from the applied-cash rollup. BOOKED DOES NOT FILL: booked value is a Sales
// Order fact, not an invoice fact, and this read exposes invoices. Its cell says so rather than
// borrowing Billed, which would quietly redefine the metric.
import { useState } from "react";
import { Link } from "react-router-dom";
import { FinancialsPageFrame, FinancialsPeriodControl, FinAnnotation } from "./FinancialsPrimitives.jsx";
import FilterBar from "../../shared/ui/FilterBar";
import { LIFECYCLE_SCORECARD_SLOTS } from "../../domain/financialsSurface.js";
import { OPERATING_COMPANY_IDS } from "../../domain/operatingCompanyAuthority.js";
import { useFinancialFacts } from "../../hooks/useFinancialFacts.js";
import { useFinancialsPeriod } from "../../hooks/useFinancialsPeriod.js";
import { FACTS_STATE, FACTS_DETAIL, financialFactsState, formatByCurrency } from "../../domain/financialFactsView.js";

const VIEW_OPTIONS = [
  { key: "metrics", label: "Metrics table" },
  { key: "byUnit", label: "By unit" },
];

const METRIC_ROWS = LIFECYCLE_SCORECARD_SLOTS.filter((s) =>
  ["booked", "billed", "collected", "arOutstanding"].includes(s.key),
);

// Which server-computed rollup field each metric row reads. `null` = this read does not carry the
// metric, and the row says so instead of substituting a near-enough number.
const METRIC_FIELD = {
  booked: null,
  billed: "billedByCurrency",
  collected: "collectedByCurrency",
  arOutstanding: "outstandingByCurrency",
};

export default function FinancialsCompanyPerformance() {
  const [view, setView] = useState("metrics");

  // Performance is measured over a window, so period is a first-class control here. It scopes by
  // the invoice issued date — the canonical event date this read carries — and narrows on the server.
  const period = useFinancialsPeriod();
  const read = useFinancialFacts(
    { factTypes: ["INVOICE"], ...period.requestFields },
    { enabled: !period.blocked },
  );
  const { state, result } = financialFactsState(read);
  const ready = state === FACTS_STATE.READY;
  const rollups = ready ? (view === "byUnit" ? result.byBusinessUnit : result.byCompany) : [];

  const cell = (key, field) => {
    if (!field) {
      return (
        <span className="fin-inact">
          Not an invoice fact
          <FinAnnotation tip="Booked value is established on the Sales Order, not the invoice. This read exposes invoice facts, so it cannot state booked — and Billed is not substituted for it, which would redefine the metric." />
        </span>
      );
    }
    if (!ready) return <span className="fin-inact">No figure returned</span>;
    const row = rollups.find((r) => r.key === key);
    if (!row) return <span className="fin-inact">No records</span>;
    return formatByCurrency(row[field]);
  };

  // Consolidated is an ARITHMETIC operational sum the server did not compute as one row, and this
  // page will not add the company rows together to fake it. It reads as unavailable with its reason.
  const columns =
    view === "byUnit"
      ? rollups.map((r) => ({ key: r.key, label: r.key }))
      : [
          { key: OPERATING_COMPANY_IDS.TAYLOR, label: "Taylor" },
          { key: OPERATING_COMPANY_IDS.VENTANA, label: "Ventana" },
        ];

  return (
    <FinancialsPageFrame
      title="Company & Business Unit Performance"
      crumb="Company & Business Unit Performance"
      custody="Cross-company operational performance. Consolidated figures are an arithmetic operational sum — UNELIMINATED_SUM — not accounting consolidation."
      custodyTip="FIN-009 owns intercompany classification; eliminations belong to the future external accounting authority and are never drawn or implied here. Consolidated stays labelled UNELIMINATED_SUM until an elimination policy exists (FIN-BLOCK-004, Owner decision). Taylor/Ventana treatment is never inferred."
    >
      <div className="fin-filter-rail">
        <FilterBar variant="chips" label="View" options={VIEW_OPTIONS} activeKey={view} onChange={setView} />
        <FinancialsPeriodControl {...period.controlProps} />
      </div>

      {ready ? null : (
        <p className="ns-state ns-state--na">{FACTS_DETAIL[state] ?? "The governed read has not answered yet."}</p>
      )}

      <section className="ns-section" aria-label="Metric by company">
        <div className="ns-section__head">
          <h2 className="ns-section__title">{view === "byUnit" ? "Metric × business unit" : "Metric × company"}</h2>
          <span className="ns-section__meta">
            · each cell drills to its owning page with the company filter pre-applied
          </span>
        </div>
        <div className="ns-table-wrap">
          <table className="ns-table">
            <caption className="fo-sr-only">Operational metrics by operating company</caption>
            <thead>
              <tr>
                <th scope="col">Metric</th>
                {columns.map((c) => (
                  <th key={c.key} scope="col" className="ns-num">
                    {c.label}
                  </th>
                ))}
                <th scope="col" className="ns-num">
                  Consolidated
                  <FinAnnotation tip="Arithmetic operational consolidation — UNELIMINATED_SUM. Not GL consolidation and not intercompany elimination. The governed read returns per-company rollups and no consolidated row; this page does not add the columns together to produce one, because a total assembled client-side over a scoped slice would read as a book-wide figure." />
                </th>
                <th scope="col">Fact class</th>
              </tr>
            </thead>
            <tbody>
              {METRIC_ROWS.map((row) => (
                <tr key={row.key}>
                  <td>{row.label}</td>
                  {columns.map((c) => (
                    <td key={c.key} className="ns-num">
                      {cell(c.key, METRIC_FIELD[row.key])}
                    </td>
                  ))}
                  <td className="ns-num">
                    <span className="fin-inact">Not summed here</span>
                  </td>
                  <td>
                    <span className="fin-factclass">Operational actual</span>
                  </td>
                </tr>
              ))}
              <tr>
                <td>Goal attainment</td>
                {columns.map((c) => (
                  <td key={c.key} className="ns-num">
                    <span className="fin-inact">No goal records</span>
                  </td>
                ))}
                <td className="ns-num">
                  —
                  <FinAnnotation tip="Consolidated attainment is deliberately '—' even when per-company attainment exists: summing attainment across companies would silently mix measurement bases." />
                </td>
                <td>
                  <span className="fin-factclass">Goal</span>
                </td>
              </tr>
              <tr>
                <td>Cost · Gross margin · Budget variance</td>
                <td colSpan={columns.length + 1}>
                  <span className="fin-inact">
                    Reserved — cost authority is built and dormant; cost-fact supply missing (FIN-BLOCK-003)
                  </span>
                </td>
                <td>
                  <span className="fin-factclass">Operational actual</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="fin-section-note">
          <Link to="/financials">Overview →</Link> · <Link to="/financials/intercompany">Intercompany →</Link>
        </p>
      </section>
    </FinancialsPageFrame>
  );
}
