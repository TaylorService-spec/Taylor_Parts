import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useWorkOrders } from "../../hooks/useWorkOrders";
import { fieldPhase } from "../../domain/fieldWorkOrder";

// F0 -- this surface now READS the governed Work Order Engine (fieldops_wos)
// instead of the legacy fieldops_jobs collection.
//
// Its legacy "New Job" form is REMOVED rather than migrated. Creating a
// governed Work Order requires a governed customerId + locationId + priority +
// classification (functions/src/createWorkOrder.ts), which the legacy form's
// free-text customer and optional address could not supply. Inventing a
// placeholder customer to keep a create button here would have manufactured
// exactly the ungoverned data F0 exists to eliminate. The governed creation
// path already exists -- WorkOrderWizard at /service/work-orders/new, with a
// real CustomerPicker -- so this surface links there.

export default function Jobs() {
  const { data: jobs, loading } = useWorkOrders();
  const [announcement, setAnnouncement] = useState("");
  // The new row keeps a stable tabIndex=-1 (focusRowId is not cleared) so focusing
  // it never blurs when a follow-up render runs -- removing tabIndex from the
  // focused <tr> would drop focus to <body>. focusedOnceRef guards against
  // re-focusing on every later subscription tick.
  const [focusRowId, setFocusRowId] = useState(null);
  const focusedOnceRef = useRef(null);
  const newRowRef = useRef(null);

  // After a successful add, move focus to the new row once the live subscription
  // has delivered it. The id is only an internal match key -- never rendered.
  useEffect(() => {
    if (focusRowId && focusRowId !== focusedOnceRef.current && newRowRef.current) {
      newRowRef.current.focus();
      focusedOnceRef.current = focusRowId;
    }
  }, [focusRowId, jobs]);

  return (
    <div className="fo-panel">
      <div className="fo-panel-head">
        <h2>Job Assignments</h2>
        <Link className="fo-btn-link" to="/service/work-orders/new">New Work Order</Link>
      </div>

      {/* Success announcement -- polite live region for assistive tech. */}
      <p className="fo-sr-only" role="status" aria-live="polite">{announcement}</p>

      {loading ? (
        <p className="fo-muted">Loading work orders…</p>
      ) : jobs.length === 0 ? (
        <p className="fo-muted">No work orders yet.</p>
      ) : (
        <div className="fo-table-scroll">
          <table className="fo-table">
            <thead>
              <tr>
                <th>Work Order</th>
                <th>Complaint</th>
                <th>Assigned</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr
                  key={job.id}
                  ref={job.id === focusRowId ? newRowRef : null}
                  tabIndex={job.id === focusRowId ? -1 : undefined}
                >
                  <td>{job.woNumber ?? job.id}</td>
                  <td>{job.complaint ?? job.description ?? "—"}</td>
                  <td className="fo-muted">{job.assignedTechId ?? "—"}</td>
                  <td>
                    <span className={`fo-badge fo-badge-${fieldPhase(job)}`}>{job.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
