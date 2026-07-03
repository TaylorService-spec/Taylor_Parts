import { useState, useEffect, useMemo } from "react";
import { jobsStore, techniciansStore, workOrdersStore } from "../../firebase/collectionStore";
import { JOB_STATUS, JOB_STATUS_LABEL } from "../../domain/constants";
import { computeWorkOrderStatus } from "../../domain/workOrderScoring";
import { groupJobsByTechnician } from "./techUtils";

// Work Order-centric operational dashboard. Groups jobs by workOrderId,
// aggregates status using JOB_STATUS constants, and surfaces unassigned
// jobs. This view is aggregation-only — it never mutates jobs, work
// orders, or technicians.

function WorkOrderDetail({ workOrder, jobs, technicians, onBack }) {
  const technicianName = (id) => technicians.find((t) => t.id === id)?.name || "Unassigned";

  return (
    <div className="fo-panel">
      <button className="fo-back-btn" onClick={onBack}>
        ← Back to Control Tower
      </button>
      <h2>{workOrder.title}</h2>
      {workOrder.notes && <p className="fo-muted">{workOrder.notes}</p>}

      <table className="fo-table">
        <thead>
          <tr>
            <th>Job</th>
            <th>Status</th>
            <th>Technician</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.id}>
              <td>{job.description}</td>
              <td>
                <span className={`fo-badge fo-badge-${job.status}`}>{JOB_STATUS_LABEL[job.status] || job.status}</span>
              </td>
              <td>{job.technicianId ? technicianName(job.technicianId) : <span className="fo-muted">Unassigned</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ControlTower() {
  const [jobs, setJobs] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [workOrders, setWorkOrders] = useState([]);
  const [selectedWorkOrderId, setSelectedWorkOrderId] = useState(null);

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

  const jobsByWorkOrder = useMemo(() => {
    const map = {};
    jobs.forEach((job) => {
      const key = job.workOrderId || "__unassigned__";
      (map[key] = map[key] || []).push(job);
    });
    return map;
  }, [jobs]);

  const workOrderGroups = useMemo(
    () => workOrders.map((wo) => ({ workOrderId: wo.id, workOrder: wo, jobs: jobsByWorkOrder[wo.id] || [] })),
    [workOrders, jobsByWorkOrder]
  );

  const workOrderStatusMap = useMemo(() => {
    const map = {};
    workOrderGroups.forEach((wo) => {
      map[wo.workOrderId] = computeWorkOrderStatus(wo.jobs);
    });
    return map;
  }, [workOrderGroups]);

  const activeWorkOrderGroups = workOrderGroups.filter((wo) => workOrderStatusMap[wo.workOrderId] !== "COMPLETED");

  const techGroups = useMemo(() => {
    const allJobs = workOrderGroups.flatMap((wo) => wo.jobs);
    return groupJobsByTechnician(allJobs);
  }, [workOrderGroups]);

  const technicianName = (id) => technicians.find((t) => t.id === id)?.name || id;

  const unassignedJobs = jobs.filter((j) => !j.workOrderId);
  const pendingJobs = jobs.filter((j) => j.status === JOB_STATUS.PENDING).length;
  const inProgressJobs = jobs.filter((j) => j.status === JOB_STATUS.IN_PROGRESS).length;
  const completedJobs = jobs.filter((j) => j.status === JOB_STATUS.COMPLETED).length;
  const availableTechs = technicians.filter((t) => t.status === "available").length;
  const onJobTechs = technicians.filter((t) => t.status === "on_job").length;

  if (selectedWorkOrderId) {
    const group = workOrderGroups.find((wo) => wo.workOrderId === selectedWorkOrderId);
    if (group) {
      return (
        <WorkOrderDetail
          workOrder={group.workOrder}
          jobs={group.jobs}
          technicians={technicians}
          onBack={() => setSelectedWorkOrderId(null)}
        />
      );
    }
    setSelectedWorkOrderId(null);
  }

  return (
    <div className="fo-panel">
      <h2>Control Tower</h2>
      <div className="fo-stat-grid">
        <div className="fo-stat">
          <div className="fo-stat-value">{activeWorkOrderGroups.length}</div>
          <div className="fo-stat-label">Active Work Orders</div>
        </div>
        <div className="fo-stat">
          <div className="fo-stat-value">{pendingJobs}</div>
          <div className="fo-stat-label">Pending Jobs</div>
        </div>
        <div className="fo-stat">
          <div className="fo-stat-value">{inProgressJobs}</div>
          <div className="fo-stat-label">In Progress</div>
        </div>
        <div className="fo-stat">
          <div className="fo-stat-value">{completedJobs}</div>
          <div className="fo-stat-label">Completed</div>
        </div>
        <div className="fo-stat">
          <div className="fo-stat-value">{unassignedJobs.length}</div>
          <div className="fo-stat-label">Unassigned Jobs</div>
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

      <h3 className="fo-section-title">Work Orders</h3>
      {activeWorkOrderGroups.length === 0 ? (
        <p className="fo-muted">No active work orders.</p>
      ) : (
        <div className="fo-wo-grid">
          {activeWorkOrderGroups.map((wo) => {
            const status = workOrderStatusMap[wo.workOrderId];
            return (
              <button key={wo.workOrderId} className="fo-wo-card" onClick={() => setSelectedWorkOrderId(wo.workOrderId)}>
                <div className="fo-wo-card-title">
                  {wo.workOrder.title}
                  <span className={`wo-status wo-${status.toLowerCase()}`}>{status}</span>
                </div>
                <div className="fo-wo-card-meta">
                  <span className="fo-muted">
                    {wo.jobs.length} job{wo.jobs.length === 1 ? "" : "s"}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <div className="tech-overview">
        <h3>Technician Load</h3>
        {Object.entries(techGroups).map(([tech, techJobs]) => (
          <div key={tech}>
            {tech === "UNASSIGNED" ? "Unassigned" : technicianName(tech)}: {techJobs.length} jobs
          </div>
        ))}
      </div>
    </div>
  );
}
