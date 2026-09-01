// REPORTING & EXPORTS — /financials/reports (North Star P1, page 19).
//
// Design authority: docs/north-star/financials/North Star - Financials 19 Reports Exports.dc.html.
// The governed reporting hub: reports compose the same authority as the pages — never a
// new truth source — and export is a governed, audited act whose scope is re-checked at
// execution time. A restricted report renders as a named panel stating the required
// authority, never a partial render. Unavailable reports are listed WITH the phase that
// blocks them, so the catalog is a map, not a mystery.
//
// Current-main truth: no report registry, scope-checked execution, or audited export
// exists (FIN-AG-REPORT-REGISTRY). The catalog therefore lists the designed report groups
// with each group's blocking truth, and no export action is wired.
import {
  FinancialsPageFrame,
  FinAnnotation,
} from "./FinancialsPrimitives.jsx";

const CATALOG = [
  {
    group: "Sales",
    blocking: "Awaits the report registry and activated booked/attribution reads",
  },
  {
    group: "Revenue & collections",
    blocking: "Awaits the report registry and activated billed/collected reads",
  },
  {
    group: "Plan",
    blocking: "Awaits the report registry and FIN-003 plan records",
  },
  {
    group: "Margin & cost",
    blocking: "Awaits FIN-006 cost supply (FIN-BLOCK-003) — margin reports stay UNKNOWN-safe",
  },
  {
    group: "Governance",
    blocking: "Awaits the report registry and the financial audit lens",
  },
];

export default function FinancialsReports() {
  return (
    <FinancialsPageFrame
      title="Reporting & Exports"
      crumb="Reporting & Exports"
      custody="Reports compose the same governed authority as the pages — never a new truth source. Export is a governed, audited act; scope is re-checked when the export runs."
      custodyTip="A shared report re-authorizes per viewer (FIN-004): sharing a report shares its definition, never its numbers. There is no download-everything. Export appears in the financial audit lens. The registry, scope-checked execution and audited export are FIN-AG-REPORT-REGISTRY — not built yet, so no export action is wired."
    >
      <section className="ns-section" aria-label="Report catalog">
        <div className="ns-section__head">
          <h2 className="ns-section__title">Catalog</h2>
          <span className="ns-section__meta">· unavailable reports are named with their blocking phase — never hidden</span>
        </div>
        <div className="ns-table-wrap">
          <table className="ns-table">
            <caption className="fo-sr-only">Report catalog groups and their current availability</caption>
            <thead>
              <tr>
                <th scope="col">Report group</th>
                <th scope="col">Availability</th>
              </tr>
            </thead>
            <tbody>
              {CATALOG.map((entry) => (
                <tr key={entry.group}>
                  <td>{entry.group}</td>
                  <td>
                    <span className="fin-inact">{entry.blocking}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="fin-section-note">
          Restricted reports render as a named panel stating the required authority and your scope —
          never a partial render, never silence.
          <FinAnnotation tip="The explicit DENIED design: a viewer without the required visibility scope sees the report named, with the authority it requires versus theirs. Report scheduling/sharing semantics are an open product question — a shared report must re-authorize per viewer." />
        </p>
      </section>
    </FinancialsPageFrame>
  );
}
