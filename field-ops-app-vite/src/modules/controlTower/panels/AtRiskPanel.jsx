import { Link } from "react-router-dom";
import { AT_RISK_SORT, SECTION_ID } from "../../../domain/serviceOperationsNorthStar";
import { useTableSort } from "../../../shared/ui/sorting/useTableSort.js";
import SortableHeader from "../../../shared/ui/sorting/SortableHeader.jsx";

// Column-header sorting over the rows already composed. With no header sort the rows keep the order the
// "Sorted by" control asked the domain for -- that order stays the table's default.
const SEVERITY_RANK = Object.freeze({ CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 });
const AT_RISK_COLUMNS = Object.freeze({
  reference: { value: (row) => row.reference },
  account: { value: (row) => row.account },
  severity: { value: (row) => SEVERITY_RANK[row.severity] ?? null },
  age: { value: (row) => row.ageHours },
  why: { value: (row) => row.why },
  technician: { value: (row) => row.technicianName },
});

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
  const { sort: headerSort, toggle, sorted } = useTableSort({ rows, columns: AT_RISK_COLUMNS });
  return (
    <section className="ns-section" id={SECTION_ID.atRisk} aria-label="At Risk">
      <div className="ns-section__head">
        <h2 className="ns-section__title">At Risk</h2>
        <div className="ns-section__actions">
          <label className="ns-section__meta" htmlFor="service-ops-at-risk-sort">
            Sorted By
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
                <SortableHeader columnKey="reference" label="Work Order" sort={headerSort} onSort={toggle} />
                <SortableHeader columnKey="account" label="Account" sort={headerSort} onSort={toggle} />
                <SortableHeader columnKey="severity" label="Severity" sort={headerSort} onSort={toggle} />
                <SortableHeader columnKey="age" label="Age" sort={headerSort} onSort={toggle} className="ns-num" />
                <SortableHeader columnKey="why" label="Why" sort={headerSort} onSort={toggle} />
                <SortableHeader columnKey="technician" label="Technician" sort={headerSort} onSort={toggle} />
                <th scope="col"><span className="ns-visually-hidden">Open</span></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
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
