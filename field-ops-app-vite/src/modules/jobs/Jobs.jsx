import { useState } from "react";
import { createJob } from "../../domain/jobActions";
import { JOBS_COLLECTION } from "../../domain/constants";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";

// A job is: { id, workOrderId, description, status, technicianId }
// status is one of JOB_STATUS: "open" | "assigned" | "in_progress" | "complete"
// Jobs are execution units grouped under a Work Order via workOrderId.
// Jobs MUST NOT carry customer fields — customers are a separate domain.

export default function Jobs() {
  const { data: jobs, loading } = useFirestoreCollection(JOBS_COLLECTION);
  const [customer, setCustomer] = useState("");
  const [description, setDescription] = useState("");

  function addJob(e) {
    e.preventDefault();
    const trimmedCustomer = customer.trim();
    const trimmedDescription = description.trim();
    if (!trimmedCustomer || !trimmedDescription) return;
    setCustomer("");
    setDescription("");
    createJob(trimmedCustomer, trimmedDescription);
  }

  return (
    <div className="fo-panel">
      <h2>Work Orders</h2>
      <form className="fo-form" onSubmit={addJob}>
        <input placeholder="Customer" value={customer} onChange={(e) => setCustomer(e.target.value)} />
        <input placeholder="Work order description" value={description} onChange={(e) => setDescription(e.target.value)} />
        <button type="submit">Add Work Order</button>
      </form>

      {loading ? (
        <p className="fo-muted">Loading work orders…</p>
      ) : jobs.length === 0 ? (
        <p className="fo-muted">No work orders yet.</p>
      ) : (
        <table className="fo-table">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Description</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id}>
                <td>{job.customer}</td>
                <td>{job.description}</td>
                <td>
                  <span className={`fo-badge fo-badge-${job.status}`}>{job.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
