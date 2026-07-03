import { JOBS_COLLECTION, TECHNICIANS_COLLECTION, JOB_STATUS, TECH_STATUS } from "../../domain/constants";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";

// High-level rollup of jobs + technicians. This is the "at a glance"
// dashboard for a dispatcher/manager.

export default function ControlTower() {
  const { data: jobs } = useFirestoreCollection(JOBS_COLLECTION);
  const { data: technicians } = useFirestoreCollection(TECHNICIANS_COLLECTION);

  const openJobs = jobs.filter((j) => j.status === JOB_STATUS.OPEN).length;
  const assignedJobs = jobs.filter((j) => j.status === JOB_STATUS.ASSIGNED || j.status === JOB_STATUS.IN_PROGRESS).length;
  const completeJobs = jobs.filter((j) => j.status === JOB_STATUS.COMPLETE).length;
  const availableTechs = technicians.filter((t) => t.status === TECH_STATUS.AVAILABLE).length;
  const onJobTechs = technicians.filter((t) => t.status === TECH_STATUS.ON_JOB).length;

  const activeWorkOrders = new Set(
    jobs.map((j) => j.workOrderId).filter(Boolean)
  ).size;

  return (
    <div className="fo-panel">
      <h2>Control Tower</h2>
      <div className="fo-stat-grid">
        <div className="fo-stat">
          <div className="fo-stat-value">{openJobs}</div>
          <div className="fo-stat-label">Open Work Orders</div>
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
          <div className="fo-stat-label">Techs On Work Order</div>
        </div>
      </div>

      <div className="fo-card">
        <h3>CRM Activity</h3>
        <p>Active Work Orders: {activeWorkOrders}</p>
      </div>
    </div>
  );
}
