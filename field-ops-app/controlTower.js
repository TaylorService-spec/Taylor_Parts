// ---------- Control Tower ----------
//
// Work Order-centric operational dashboard. Groups jobs by workOrderId,
// aggregates status using JOB_STATUS constants, and surfaces unassigned
// jobs. This view is aggregation-only — it never mutates jobs, work
// orders, or technicians.

function WorkOrderDetailView({ workOrder, jobs, technicians, onBack }) {
  const { JOB_STATUS_LABEL } = window.FieldOps;
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

function ControlTowerView() {
  const { JOB_STATUS, JOB_STATUS_LABEL, aggregateWorkOrderStatus } = window.FieldOps;

  const [jobs, setJobs] = React.useState([]);
  const [technicians, setTechnicians] = React.useState([]);
  const [workOrders, setWorkOrders] = React.useState([]);
  const [selectedWorkOrderId, setSelectedWorkOrderId] = React.useState(null);

  React.useEffect(() => {
    const unsubJobs = window.FieldOps.jobsStore.onChange(setJobs);
    const unsubTechs = window.FieldOps.techniciansStore.onChange(setTechnicians);
    const unsubWorkOrders = window.FieldOps.workOrdersStore.onChange(setWorkOrders);
    return () => {
      unsubJobs();
      unsubTechs();
      unsubWorkOrders();
    };
  }, []);

  const jobsByWorkOrder = {};
  jobs.forEach((job) => {
    const key = job.workOrderId || "__unassigned__";
    (jobsByWorkOrder[key] = jobsByWorkOrder[key] || []).push(job);
  });

  const workOrderSummaries = workOrders
    .map((wo) => {
      const woJobs = jobsByWorkOrder[wo.id] || [];
      return { workOrder: wo, jobs: woJobs, status: aggregateWorkOrderStatus(woJobs) };
    })
    .filter((summary) => summary.status !== JOB_STATUS.COMPLETED);

  const unassignedJobs = jobs.filter((j) => !j.workOrderId);
  const pendingJobs = jobs.filter((j) => j.status === JOB_STATUS.PENDING).length;
  const inProgressJobs = jobs.filter((j) => j.status === JOB_STATUS.IN_PROGRESS).length;
  const completedJobs = jobs.filter((j) => j.status === JOB_STATUS.COMPLETED).length;
  const availableTechs = technicians.filter((t) => t.status === "available").length;
  const onJobTechs = technicians.filter((t) => t.status === "on_job").length;

  if (selectedWorkOrderId) {
    const summary = workOrderSummaries.find((s) => s.workOrder.id === selectedWorkOrderId);
    const workOrder = summary ? summary.workOrder : workOrders.find((wo) => wo.id === selectedWorkOrderId);
    if (workOrder) {
      return (
        <WorkOrderDetailView
          workOrder={workOrder}
          jobs={jobsByWorkOrder[workOrder.id] || []}
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
          <div className="fo-stat-value">{workOrderSummaries.length}</div>
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
      {workOrderSummaries.length === 0 ? (
        <p className="fo-muted">No active work orders.</p>
      ) : (
        <div className="fo-wo-grid">
          {workOrderSummaries.map(({ workOrder, jobs: woJobs, status }) => (
            <button key={workOrder.id} className="fo-wo-card" onClick={() => setSelectedWorkOrderId(workOrder.id)}>
              <div className="fo-wo-card-title">{workOrder.title}</div>
              <div className="fo-wo-card-meta">
                <span className={`fo-badge fo-badge-${status}`}>{JOB_STATUS_LABEL[status] || status}</span>
                <span className="fo-muted">{woJobs.length} job{woJobs.length === 1 ? "" : "s"}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

window.FieldOps = window.FieldOps || {};
window.FieldOps.ControlTowerView = ControlTowerView;
