import { useEffect, useRef, useState } from "react";
import { createJob } from "../../domain/jobActions";
import { JOBS_COLLECTION } from "../../domain/constants";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";
import NewJobModal from "./NewJobModal";

// A job is: { id, workOrderId, description, status, technicianId, address }
// status is one of JOB_STATUS: "open" | "assigned" | "in_progress" | "complete"
// Jobs are execution units grouped under a Work Order via workOrderId.
// Jobs MUST NOT carry customer fields — customers are a separate domain.
// address: { street, city, state, zip } -- optional. `geo` (lat/lng) is
// reserved for later, not implemented yet.
//
// Issue #214 PR-5: the create form that used to sit above this live table is now
// a "New Job" action opening the shared accessible Modal (NewJobModal). The table,
// its live subscription, and every field/payload/validation are unchanged.

function formatAddress(address) {
  if (!address) return "";
  const { street, city, state, zip } = address;
  const cityStateZip = [city, state].filter(Boolean).join(", ") + (zip ? ` ${zip}` : "");
  return [street, cityStateZip].filter(Boolean).join(", ");
}

export default function Jobs() {
  const { data: jobs, loading } = useFirestoreCollection(JOBS_COLLECTION);
  const [showCreate, setShowCreate] = useState(false);
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

  // Called by NewJobModal. THROWS on a blocked/denied write so the modal stays
  // open with safe copy and nothing is persisted. On success: close once, announce
  // a human-readable summary, and queue focus onto the new row. Payload/write path
  // (createJob) unchanged from the old inline form.
  async function handleCreate({ customer, description, address }) {
    const created = await createJob(customer, description, address);
    if (created?.blocked) {
      const blockedErr = new Error("write blocked");
      blockedErr.blocked = true;
      throw blockedErr;
    }
    setShowCreate(false);
    setFocusRowId(created.id);
    setAnnouncement(`Work order for ${created.customer} added.`);
  }

  return (
    <div className="fo-panel">
      <div className="fo-panel-head">
        <h2>Work Orders</h2>
        <button type="button" onClick={() => setShowCreate(true)}>New Job</button>
      </div>

      {/* Success announcement -- polite live region for assistive tech. */}
      <p className="fo-sr-only" role="status" aria-live="polite">{announcement}</p>

      {showCreate && (
        <NewJobModal onCreate={handleCreate} onClose={() => setShowCreate(false)} />
      )}

      {loading ? (
        <p className="fo-muted">Loading work orders…</p>
      ) : jobs.length === 0 ? (
        <p className="fo-muted">No work orders yet.</p>
      ) : (
        <div className="fo-table-scroll">
          <table className="fo-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Description</th>
                <th>Address</th>
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
                  <td>{job.customer}</td>
                  <td>{job.description}</td>
                  <td className="fo-muted">{formatAddress(job.address) || "—"}</td>
                  <td>
                    <span className={`fo-badge fo-badge-${job.status}`}>{job.status}</span>
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
