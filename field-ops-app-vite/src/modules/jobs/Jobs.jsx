import { useState } from "react";
import { jobsStore } from "../../firebase/collectionStore";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";

// A job is: { id, customer, description, status, technicianId }
// status is one of "open" | "assigned" | "in_progress" | "complete"

export default function Jobs() {
  const { data: jobs, loading } = useFirestoreCollection("fieldops_jobs");
  const [customer, setCustomer] = useState("");
  const [description, setDescription] = useState("");

  function addJob(e) {
    e.preventDefault();
    const trimmedCustomer = customer.trim();
    const trimmedDescription = description.trim();
    if (!trimmedCustomer || !trimmedDescription) return;
    setCustomer("");
    setDescription("");
    jobsStore.add({ customer: trimmedCustomer, description: trimmedDescription, status: "open", technicianId: null });
  }

  return (
    <div className="fo-panel">
      <h2>Jobs</h2>
      <form className="fo-form" onSubmit={addJob}>
        <input placeholder="Customer" value={customer} onChange={(e) => setCustomer(e.target.value)} />
        <input placeholder="Job description" value={description} onChange={(e) => setDescription(e.target.value)} />
        <button type="submit">Add Job</button>
      </form>

      {loading ? (
        <p className="fo-muted">Loading jobs…</p>
      ) : jobs.length === 0 ? (
        <p className="fo-muted">No jobs yet.</p>
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
