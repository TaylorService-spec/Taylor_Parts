// ---------- Jobs ----------
//
// A job is: { id, workOrderId, description, status, technicianId }
// status is one of JOB_STATUS: "pending" | "in_progress" | "completed"
// Jobs are execution units grouped under a Work Order via workOrderId.
// Jobs MUST NOT carry customer fields — customers are a separate domain.

function JobsView() {
  const { JOB_STATUS, JOB_STATUS_LABEL } = window.FieldOps;

  const [jobs, setJobs] = React.useState([]);
  const [workOrders, setWorkOrders] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [workOrderId, setWorkOrderId] = React.useState("");
  const [description, setDescription] = React.useState("");

  React.useEffect(() => {
    const unsubJobs = window.FieldOps.jobsStore.onChange((rows) => {
      setJobs(rows);
      setLoading(false);
    });
    const unsubWorkOrders = window.FieldOps.workOrdersStore.onChange(setWorkOrders);
    return () => {
      unsubJobs();
      unsubWorkOrders();
    };
  }, []);

  const workOrderTitle = (id) => workOrders.find((wo) => wo.id === id)?.title || "—";

  function addJob(e) {
    e.preventDefault();
    if (!workOrderId || !description.trim()) return;
    window.FieldOps.jobsStore
      .add({ workOrderId, description: description.trim(), status: JOB_STATUS.PENDING, technicianId: null })
      .then(() => {
        setDescription("");
      });
  }

  return (
    <div className="fo-panel">
      <h2>Jobs</h2>
      <form className="fo-form" onSubmit={addJob}>
        <select value={workOrderId} onChange={(e) => setWorkOrderId(e.target.value)}>
          <option value="" disabled>
            Select work order…
          </option>
          {workOrders.map((wo) => (
            <option key={wo.id} value={wo.id}>
              {wo.title}
            </option>
          ))}
        </select>
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
              <th>Work Order</th>
              <th>Description</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id}>
                <td>{workOrderTitle(job.workOrderId)}</td>
                <td>{job.description}</td>
                <td>
                  <span className={`fo-badge fo-badge-${job.status}`}>{JOB_STATUS_LABEL[job.status] || job.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

window.FieldOps = window.FieldOps || {};
window.FieldOps.JobsView = JobsView;
