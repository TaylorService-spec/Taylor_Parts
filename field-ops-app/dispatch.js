// ---------- Dispatch ----------
//
// Assigns open jobs to available technicians. Writes back to both the
// job (technicianId, status) and the technician (status) so Jobs,
// Technicians, and Control Tower all stay in sync via their own
// onSnapshot listeners.

function DispatchView() {
  const [jobs, setJobs] = React.useState([]);
  const [technicians, setTechnicians] = React.useState([]);

  React.useEffect(() => {
    const unsubJobs = window.FieldOps.jobsStore.onChange(setJobs);
    const unsubTechs = window.FieldOps.techniciansStore.onChange(setTechnicians);
    return () => {
      unsubJobs();
      unsubTechs();
    };
  }, []);

  const unassignedJobs = jobs.filter((j) => !j.technicianId);

  function assign(jobId, technicianId) {
    if (!technicianId) return;
    window.FieldOps.jobsStore.update(jobId, { technicianId, status: "assigned" });
    window.FieldOps.techniciansStore.update(technicianId, { status: "on_job" });
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
              <th>Customer</th>
              <th>Description</th>
              <th>Assign to</th>
            </tr>
          </thead>
          <tbody>
            {unassignedJobs.map((job) => (
              <tr key={job.id}>
                <td>{job.customer}</td>
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

window.FieldOps = window.FieldOps || {};
window.FieldOps.DispatchView = DispatchView;
