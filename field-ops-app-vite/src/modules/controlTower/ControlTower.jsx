import { JOBS_COLLECTION, TECHNICIANS_COLLECTION } from "../../firebase/collectionStore";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";

// High-level rollup of jobs + technicians. This is the "at a glance"
// dashboard for a dispatcher/manager.

export default function ControlTower() {
  const { data: jobs } = useFirestoreCollection(JOBS_COLLECTION);
  const { data: technicians } = useFirestoreCollection(TECHNICIANS_COLLECTION);

  const openJobs = jobs.filter((j) => j.status === "open").length;
  const assignedJobs = jobs.filter((j) => j.status === "assigned" || j.status === "in_progress").length;
  const completeJobs = jobs.filter((j) => j.status === "complete").length;
  const availableTechs = technicians.filter((t) => t.status === "available").length;
  const onJobTechs = technicians.filter((t) => t.status === "on_job").length;

  return (
    <div className="fo-panel">
      <h2>Control Tower</h2>
      <div className="fo-stat-grid">
        <div className="fo-stat">
          <div className="fo-stat-value">{openJobs}</div>
          <div className="fo-stat-label">Open Jobs</div>
        </div>
        <div className="fo-stat">
          <div className="fo-stat-value">{assignedJobs}</div>
          <div className="fo-stat-label">In Progress</div>
        </div>
        <div className="fo-stat">
          <div className="fo-stat-value">{completeJobs}</div>
          <div className="fo-stat-label">Completed</div>
        </div>
        <div className="fo-stat">
          <div className="fo-stat-value">{availableTechs}</div>
          <div className="fo-stat-label">Techs Available</div>
        </div>
        <div className="fo-stat">
          <div className="fo-stat-value">{onJobTechs}</div>
          <div className="fo-stat-label">Techs On Job</div>
        </div>
      </div>
    </div>
  );
}
