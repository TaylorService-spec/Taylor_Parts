import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";
import { assignJob } from "../../domain/jobActions";
import { JOBS_COLLECTION, TECHNICIANS_COLLECTION, TECH_STATUS } from "../../domain/constants";

// Assigns open jobs to available technicians. Writes back to both the
// job (technicianId, status) and the technician (status) so Jobs,
// Technicians, and Control Tower all stay in sync via their own
// realtime listeners. The write itself goes through assignJob(), which
// re-checks technician availability inside a Firestore transaction so two
// dispatchers can't both win the same technician.

export default function Dispatch() {
  const { data: jobs, loading } = useFirestoreCollection(JOBS_COLLECTION);
  const { data: technicians } = useFirestoreCollection(TECHNICIANS_COLLECTION);

  const unassignedJobs = jobs.filter((j) => !j.technicianId);

  async function assign(job, technicianId) {
    if (!technicianId) return;
    const technician = technicians.find((t) => t.id === technicianId);
    if (!technician) return;
    try {
      await assignJob(job, technician);
    } catch (err) {
      console.error(err);
      alert(err.message);
    }
  }

  return (
    <div className="fo-panel">
      <h2>Dispatch</h2>

      {loading ? (
        <p className="fo-muted">Loading jobs…</p>
      ) : unassignedJobs.length === 0 ? (
        <p className="fo-muted">No unassigned jobs.</p>
      ) : (
        unassignedJobs.map((job) => (
          <div key={job.id} className="fo-card fo-card--dispatch">
            <h3>{job.customer}</h3>
            <p>{job.description}</p>
            <select defaultValue="" onChange={(e) => assign(job, e.target.value)}>
              <option value="" disabled>
                Select technician…
              </option>
              {technicians
                .filter((t) => t.status === TECH_STATUS.AVAILABLE)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
          </div>
        ))
      )}
    </div>
  );
}
