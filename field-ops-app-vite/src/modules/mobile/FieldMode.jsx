import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";
import { updateJobStatus } from "../../domain/jobActions";
import { JOBS_COLLECTION, JOB_STATUS } from "../../domain/constants";

export default function FieldMode() {
  const { data: jobs, loading } = useFirestoreCollection(JOBS_COLLECTION);

  const assignedJobs = jobs.filter(
    (j) => j.status === JOB_STATUS.ASSIGNED || j.status === JOB_STATUS.IN_PROGRESS
  );

  async function updateStatus(job, status) {
    try {
      await updateJobStatus(job, status);
    } catch (err) {
      console.error(err);
      alert(err.message);
    }
  }

  return (
    <div className="fo-panel">
      <h2>Field Mode</h2>

      {loading ? (
        <p className="fo-muted">Loading jobs…</p>
      ) : assignedJobs.length === 0 ? (
        <p className="fo-muted">No assigned jobs</p>
      ) : (
        assignedJobs.map(job => (
          <div key={job.id} className="fo-card fo-card--field">
            <h3>{job.customer}</h3>
            <p>{job.description}</p>

            <div style={{ display: "flex", gap: 8 }}>
              {job.status === JOB_STATUS.ASSIGNED && (
                <button onClick={() => updateStatus(job, JOB_STATUS.IN_PROGRESS)}>
                  Start
                </button>
              )}
              {job.status === JOB_STATUS.IN_PROGRESS && (
                <button onClick={() => updateStatus(job, JOB_STATUS.COMPLETE)}>
                  Complete
                </button>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
