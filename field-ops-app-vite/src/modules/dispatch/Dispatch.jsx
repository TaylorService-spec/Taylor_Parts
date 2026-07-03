import { useState, useEffect } from "react";
import { jobsStore, techniciansStore, workOrdersStore } from "../../firebase/collectionStore";
import { JOB_STATUS } from "../../domain/constants";

// Assigns pending jobs to available technicians. Writes back to both the
// job (technicianId, status) and the technician (status) so Jobs,
// Technicians, and Control Tower all stay in sync via their own
// onSnapshot listeners.
//
// Light dispatch decision rule: unassigned jobs are listed oldest work
// order first, so the longest-waiting work gets attention first.

export default function Dispatch() {
  const [jobs, setJobs] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [workOrders, setWorkOrders] = useState([]);

  useEffect(() => {
    const unsubJobs = jobsStore.onChange(setJobs);
    const unsubTechs = techniciansStore.onChange(setTechnicians);
    const unsubWorkOrders = workOrdersStore.onChange(setWorkOrders);
    return () => {
      unsubJobs();
      unsubTechs();
      unsubWorkOrders();
    };
  }, []);

  const workOrderTitle = (id) => workOrders.find((wo) => wo.id === id)?.title || "—";
  const workOrderCreatedAt = (id) => workOrders.find((wo) => wo.id === id)?.createdAt || 0;

  const unassignedJobs = jobs
    .filter((j) => !j.technicianId)
    .sort((a, b) => workOrderCreatedAt(a.workOrderId) - workOrderCreatedAt(b.workOrderId));

  function assign(jobId, technicianId) {
    if (!technicianId) return;
    jobsStore.update(jobId, { technicianId, status: JOB_STATUS.IN_PROGRESS });
    techniciansStore.update(technicianId, { status: "on_job" });
  }

  return (
    <div className="fo-panel">
      <h2>Dispatch</h2>

      {unassignedJobs.length === 0 ? (
        <p className="fo-muted">No unassigned jobs.</p>
      ) : (
        <table className="fo-table">
          <thead>
            <tr>
              <th>Work Order</th>
              <th>Description</th>
              <th>Assign to</th>
            </tr>
          </thead>
          <tbody>
            {unassignedJobs.map((job) => (
              <tr key={job.id}>
                <td>{workOrderTitle(job.workOrderId)}</td>
                <td>{job.description}</td>
                <td>
                  <select defaultValue="" onChange={(e) => assign(job.id, e.target.value)}>
                    <option value="" disabled>
                      Select technician…
                    </option>
                    {technicians
                      .filter((t) => t.status === "available")
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
