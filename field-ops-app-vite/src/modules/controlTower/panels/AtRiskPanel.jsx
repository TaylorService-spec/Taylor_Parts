import { Link } from "react-router-dom";
import { AT_RISK_SORT, SECTION_ID } from "../../../domain/serviceOperationsNorthStar";

// At risk — the page's primary operational table (Service Operations North Star P1, pattern 5).
//
// A pure presenter. Every row comes from domain/serviceOperationsNorthStar.js's atRiskRows(), which
// composes domain/jobRiskScoring.js's detectStalledJobs(). Severity, score, factors and their order
// are that module's; this file sorts nothing and scores nothing.
//
// ONE TABLE PATTERN, NEVER IN A CARD (grammar R13 + pattern 5): .ns-table is the same table the Work
// Order, Sales Order and Account families render. Numerals right-aligned and tabular via .ns-num.
//
// R23, LOSSLESS COMPOSITION — the "age unknown" row is the point. A work order whose createdAt cannot
// be read still gets a row: it reads "age unknown", its Why column says why, and under the age sort it
// goes last. An exception record never disappears because one of its fields is missing, and it is
// never shown as "0h", which would be a fabricated fact rather than an absent one.
//
// Severity renders as a WORD (severityWord). The panel this replaces printed the raw enum "CRITICAL".
export default function AtRiskPanel({ rows = [], sort, onSortChange, openWorkOrderCount = null }) {
  return (
    <section className="ns-section" id={SECTION_ID.atRisk} aria-label="At risk">
      <div className="ns-section__head">
        <h2 className="ns-section__title">At risk</h2>
        <div className="ns-section__actions">
          <label className="ns-section__meta" htmlFor="service-ops-at-risk-sort">
            Sorted by
          </label>
          <select
            id="service-ops-at-risk-sort"
            className="ns-select"
            value={sort}
            onChange={(event) => onSortChange?.(event.target.value)}
          >
            <option value={AT_RISK_SORT.SEVERITY}>Severity</option>
            <option value={AT_RISK_SORT.AGE}>Age</option>
          </select>
        </div>
      </div>

      {rows.length === 0 ? (
        // The honest empty state names what IS true rather than leaving a blank region. The open
        // count is stated only when it is known — never a zero standing in for an unread number.
        <p className="ns-state">
          No work orders at risk.
          {openWorkOrderCount === null
            ? ""
            : ` ${openWorkOrderCount} open work order${openWorkOrderCount === 1 ? "" : "s"} ${
                openWorkOrderCount === 1 ? "exists" : "exist"
              } and ${openWorkOrderCount === 1 ? "is" : "are"} moving normally.`}
        </p>
      ) : (
        <div className="ns-table-wrap">
          <table className="ns-table">
            <thead>
              <tr>
                <th scope="col">Work order</th>
                <th scope="col">Account</th>
                <th scope="col">Severity</th>
                <th scope="col" className="ns-num">Age</th>
                <th scope="col">Why</th>
                <th scope="col">Technician</th>
                <th scope="col"><span className="ns-visually-hidden">Open</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.reference}</td>
                  <td>{row.account ?? <span className="ns-muted">Account not resolved</span>}</td>
                  <td>{row.severityWord}</td>
                  <td className={`ns-num${row.ageHours === null ? " ns-muted" : ""}`}>{row.ageText}</td>
                  <td>{row.why}</td>
                  <td>
                    {row.technicianName ?? <span className="ns-muted">Unassigned</span>}
                  </td>
                  <td>
                    <Link to={row.href}>Open →</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
