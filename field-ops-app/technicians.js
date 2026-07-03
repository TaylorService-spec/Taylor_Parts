// ---------- Technicians ----------
//
// A technician is: { id, name, phone, status }
// status is one of "available" | "on_job" | "off_shift"

function TechniciansView() {
  const [technicians, setTechnicians] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");

  React.useEffect(() => {
    const unsubscribe = window.FieldOps.techniciansStore.onChange((rows) => {
      setTechnicians(rows);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  function addTechnician(e) {
    e.preventDefault();
    if (!name.trim()) return;
    window.FieldOps.techniciansStore
      .add({ name: name.trim(), phone: phone.trim(), status: "available" })
      .then(() => {
        setName("");
        setPhone("");
      });
  }

  return (
    <div className="fo-panel">
      <h2>Technicians</h2>
      <form className="fo-form" onSubmit={addTechnician}>
        <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <input placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <button type="submit">Add Technician</button>
      </form>

      {loading ? (
        <p className="fo-muted">Loading technicians…</p>
      ) : technicians.length === 0 ? (
        <p className="fo-muted">No technicians yet.</p>
      ) : (
        <table className="fo-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Phone</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {technicians.map((tech) => (
              <tr key={tech.id}>
                <td>{tech.name}</td>
                <td>{tech.phone}</td>
                <td>
                  <span className={`fo-badge fo-badge-${tech.status}`}>{tech.status}</span>
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
window.FieldOps.TechniciansView = TechniciansView;
