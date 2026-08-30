import { Link } from "react-router-dom";
import { SECTION_ID, SERVICE_OPS_LINKS } from "../../../domain/serviceOperationsNorthStar";

// Technician load — one table where the page previously had two readings of technician state: an
// unstyled "Technician Load" list of `Name: 3 jobs` divs, and a separate Overloaded Technicians panel
// that repeated a subset of the same people. Same data, same overload domain function
// (detectOverloadedTechnicians), one place to look.
//
// Rows come from domain/serviceOperationsNorthStar.js's technicianLoadRows(). Status is a word via
// technicianStatusLabel (never the raw `on_job` enum); names resolve through resolveTechnicianIdentity,
// which refuses to print a document id where a person belongs (F-UID-1).
//
// SO-N6 — the row action is "Open board →" and nothing more. The design asked for a board link with
// this technician preselected in its lane filter; TechnicianFilter takes its selection through props
// and has no URL-parameter seam, so a preselect link would be a promise the board cannot keep. The
// wording states what the link actually does. Adding governed URL-filter semantics is separate work.
//
// SO-N2 — unassigned work is deliberately absent from this table. It is already Ready to Schedule in
// the attention block; a second "Unassigned: 4" row would state the same backlog twice.
export default function TechnicianLoadPanel({ rows = [], available = true, unavailableReason = null }) {
  return (
    <section className="ns-section" id={SECTION_ID.technicianLoad} aria-label="Technician load">
      <div className="ns-section__head">
        <h2 className="ns-section__title">Technician load</h2>
      </div>

      {/* The technician read can fail independently of the work-order read. When it has, this table
          states that rather than computing a load table over ids or rendering an empty one, which
          would read as "nobody is working". */}
      {!available ? (
        <p className="ns-state ns-state--denied">
          Technician load is unavailable because technicians could not be loaded.
          {unavailableReason ? ` ${unavailableReason}` : ""} Your work elsewhere is unaffected.
        </p>
      ) : rows.length === 0 ? (
        <p className="ns-state">No technicians are set up yet.</p>
      ) : (
        <div className="ns-table-wrap">
          <table className="ns-table">
            <thead>
              <tr>
                <th scope="col">Technician</th>
                <th scope="col">Status</th>
                <th scope="col" className="ns-num">Active work orders</th>
                <th scope="col">Load</th>
                <th scope="col"><span className="ns-visually-hidden">Board</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td>{row.statusLabel}</td>
                  <td className="ns-num">{row.activeCount}</td>
                  <td>
                    {row.overloaded ? (
                      <span className="ns-tone--warn">Overloaded</span>
                    ) : (
                      <span className="ns-muted">Normal</span>
                    )}
                  </td>
                  <td>
                    <Link to={SERVICE_OPS_LINKS.dispatcherBoard}>Open board →</Link>
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
