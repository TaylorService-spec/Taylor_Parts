import { useState } from "react";
import { createJob } from "../../domain/jobActions";
import { JOBS_COLLECTION } from "../../domain/constants";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";

// A job is: { id, workOrderId, description, status, technicianId, address }
// status is one of JOB_STATUS: "open" | "assigned" | "in_progress" | "complete"
// Jobs are execution units grouped under a Work Order via workOrderId.
// Jobs MUST NOT carry customer fields — customers are a separate domain.
// address: { street, city, state, zip } -- optional. `geo` (lat/lng) is
// reserved for later, not implemented yet.

function formatAddress(address) {
  if (!address) return "";
  const { street, city, state, zip } = address;
  const cityStateZip = [city, state].filter(Boolean).join(", ") + (zip ? ` ${zip}` : "");
  return [street, cityStateZip].filter(Boolean).join(", ");
}

export default function Jobs() {
  const { data: jobs, loading } = useFirestoreCollection(JOBS_COLLECTION);
  const [customer, setCustomer] = useState("");
  const [description, setDescription] = useState("");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");

  function addJob(e) {
    e.preventDefault();
    const trimmedCustomer = customer.trim();
    const trimmedDescription = description.trim();
    if (!trimmedCustomer || !trimmedDescription) return;

    const trimmedStreet = street.trim();
    const trimmedCity = city.trim();
    const trimmedState = state.trim();
    const trimmedZip = zip.trim();
    const hasAddress = trimmedStreet || trimmedCity || trimmedState || trimmedZip;
    const address = hasAddress
      ? { street: trimmedStreet, city: trimmedCity, state: trimmedState, zip: trimmedZip }
      : null;

    setCustomer("");
    setDescription("");
    setStreet("");
    setCity("");
    setState("");
    setZip("");
    createJob(trimmedCustomer, trimmedDescription, address);
  }

  return (
    <div className="fo-panel">
      <h2>Work Orders</h2>
      <form className="fo-form" onSubmit={addJob}>
        <input placeholder="Customer" value={customer} onChange={(e) => setCustomer(e.target.value)} />
        <input placeholder="Work order description" value={description} onChange={(e) => setDescription(e.target.value)} />
        <input placeholder="Street (optional)" value={street} onChange={(e) => setStreet(e.target.value)} />
        <input placeholder="City (optional)" value={city} onChange={(e) => setCity(e.target.value)} />
        <input placeholder="State (optional)" value={state} onChange={(e) => setState(e.target.value)} />
        <input placeholder="Zip (optional)" value={zip} onChange={(e) => setZip(e.target.value)} />
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
              <th>Address</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id}>
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
      )}
    </div>
  );
}
