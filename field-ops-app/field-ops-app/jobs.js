// ---------- Jobs ----------
//
// A job is: { id, customer, description, status, technicianId }
// status is one of "open" | "assigned" | "in_progress" | "complete"

function JobsView() {
  const [jobs, setJobs] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [customer, setCustomer] = React.useState("");
  const [description, setDescription] = React.useState("");

  React.useEffect(() => {
    const unsubscribe = window.FieldOps.jobsStore.onChange((rows) => {
      setJobs(rows);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  function addJob(e) {
    e.preventDefault();
    if (!customer.trim() || !description.trim()) return;
    window.FieldOps.jobsStore
      .add({ customer: customer.trim(), description: description.trim(), status: "open", technicianId: null })
      .then(() => {
        setCustomer("");
        setDescription("");
      });
  }

  return (
    <div className="fo-panel">
      <h2>Jobs</h2>
      <form className="fo-form" onSubmit={addJob}>
        <input placeholder="Customer" value={customer} onChange={(e) => setCustomer(e.target.value)} />
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
              <th>Customer</th>
              <th>Description</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id}>
                <td>{job.customer}</td>
                <td>{job.description}</td>
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

window.FieldOps = window.FieldOps || {};
window.FieldOps.JobsView = JobsView;
