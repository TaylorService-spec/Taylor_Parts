// COMPANY & BUSINESS UNIT PERFORMANCE — /financials/company-performance (North Star P1, page 14).
//
// Design authority: docs/north-star/financials/North Star - Financials 14 Company Performance.dc.html.
// Taylor vs Ventana made easy WITHOUT intercompany accounting: the contract sentence says
// consolidation here is arithmetic, and the current FIN-009 truth names it explicitly —
// UNELIMINATED_SUM until elimination policy exists. Never presented as accounting
// consolidation, GL consolidation or intercompany elimination. Consolidated attainment is
// deliberately "—" (it would silently mix bases). Metric rows appear only where authority
// exists; cost/margin/budget-variance rows are reserved with one-line truth.
//
// Current-main truth: same reads as Overview — FIN-002 attribution complete, lifecycle
// reads merged and inactive; FIN-009 allocation arithmetic + company summarization merged
// and dormant. Cells drill to owning pages with the company filter pre-applied — hierarchy
// is navigation, not new data.
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  FinancialsPageFrame,
  FinAnnotation,
} from "./FinancialsPrimitives.jsx";
import FilterBar from "../../shared/ui/FilterBar";
import { LIFECYCLE_SCORECARD_SLOTS } from "../../domain/financialsSurface.js";

const VIEW_OPTIONS = [
  { key: "metrics", label: "Metrics table" },
  { key: "byUnit", label: "By unit" },
];

// The metric rows the approved table carries where authority exists today (lifecycle
// reads, dormant): Booked / Billed / Collected / A-R. Cost, margin and budget variance are
// reserved rows with their one-line truth.
const METRIC_ROWS = LIFECYCLE_SCORECARD_SLOTS.filter((s) =>
  ["booked", "billed", "collected", "arOutstanding"].includes(s.key),
);

export default function FinancialsCompanyPerformance() {
  const [view, setView] = useState("metrics");

  return (
    <FinancialsPageFrame
      title="Company & Business Unit Performance"
      crumb="Company & Business Unit Performance"
      custody="Cross-company operational performance. Consolidated figures are an arithmetic operational sum — UNELIMINATED_SUM — not accounting consolidation."
      custodyTip="FIN-009 owns intercompany classification; eliminations belong to the future external accounting authority and are never drawn or implied here. Consolidated stays labelled UNELIMINATED_SUM until an elimination policy exists (FIN-BLOCK-004, Owner decision). Taylor/Ventana treatment is never inferred."
    >
      <FilterBar variant="chips" label="View" options={VIEW_OPTIONS} activeKey={view} onChange={setView} />

      <section className="ns-section" aria-label="Metric by company">
        <div className="ns-section__head">
          <h2 className="ns-section__title">Metric × company</h2>
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
                <th scope="col" className="ns-num">Taylor</th>
                <th scope="col" className="ns-num">Ventana</th>
                <th scope="col" className="ns-num">
                  Consolidated
                  <FinAnnotation tip="Arithmetic operational consolidation — UNELIMINATED_SUM. Not GL consolidation and not intercompany elimination; FIN-009 classification is merged and dormant, elimination policy does not exist." />
                </th>
                <th scope="col">Fact class</th>
              </tr>
            </thead>
            <tbody>
              {METRIC_ROWS.map((row) => (
                <tr key={row.key}>
                  <td>{row.label}</td>
                  <td className="ns-num"><span className="fin-inact">Read not activated</span></td>
                  <td className="ns-num"><span className="fin-inact">Read not activated</span></td>
                  <td className="ns-num"><span className="fin-inact">Read not activated</span></td>
                  <td><span className="fin-factclass">Operational actual</span></td>
                </tr>
              ))}
              <tr>
                <td>Goal attainment</td>
                <td className="ns-num"><span className="fin-inact">No goal records</span></td>
                <td className="ns-num"><span className="fin-inact">No goal records</span></td>
                <td className="ns-num">
                  —
                  <FinAnnotation tip="Consolidated attainment is deliberately '—' even when per-company attainment exists: summing attainment across companies would silently mix measurement bases." />
                </td>
                <td><span className="fin-factclass">Goal</span></td>
              </tr>
              <tr>
                <td>Cost · Gross margin · Budget variance</td>
                <td colSpan={3}>
                  <span className="fin-inact">
                    Reserved — cost authority is built and dormant; cost-fact supply missing (FIN-BLOCK-003)
                  </span>
                </td>
                <td><span className="fin-factclass">Operational actual</span></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="fin-section-note">
          <Link to="/financials">Overview →</Link> ·{" "}
          <Link to="/financials/intercompany">Intercompany →</Link>
        </p>
      </section>
    </FinancialsPageFrame>
  );
}
