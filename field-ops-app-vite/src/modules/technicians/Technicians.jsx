import { useState, useEffect } from "react";
import { techniciansStore } from "../../firebase/collectionStore";

// A technician is: { id, name, phone, status }
// status is one of "available" | "on_job" | "off_shift"

export default function Technicians() {
  const [technicians, setTechnicians] = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  useEffect(() => {
    const unsubscribe = techniciansStore.onChange((rows) => {
      setTechnicians(rows);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  function addTechnician(e) {
    e.preventDefault();
    if (!name.trim()) return;
    techniciansStore
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
