import { useEffect, useState } from "react";
import { jobsStore } from "../../firebase/collectionStore";

export default function FieldMode() {
  const [jobs, setJobs] = useState([]);

  useEffect(() => {
    return jobsStore.onChange(setJobs);
  }, []);

  const assignedJobs = jobs.filter(j => j.status === "assigned" || j.status === "in_progress");

  function updateStatus(jobId, status) {
    jobsStore.update(jobId, { status });
  }

  return (
    <div className="fo-panel">
      <h2>Field Mode</h2>

      {assignedJobs.length === 0 ? (
        <p className="fo-muted">No assigned jobs</p>
      ) : (
        assignedJobs.map(job => (
          <div key={job.id} className="fo-field-card">
            <h3>{job.customer}</h3>
            <p>{job.description}</p>

            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => updateStatus(job.id, "in_progress")}>
                Start
              </button>
              <button onClick={() => updateStatus(job.id, "complete")}>
                Complete
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
