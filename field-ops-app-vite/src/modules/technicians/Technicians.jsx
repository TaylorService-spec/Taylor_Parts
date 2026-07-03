import { useState } from "react";
import { techniciansStore, TECHNICIANS_COLLECTION } from "../../firebase/collectionStore";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";

// A technician is: { id, name, phone, status }
// status is one of "available" | "on_job" | "off_shift"

export default function Technicians() {
  const { data: technicians, loading } = useFirestoreCollection(TECHNICIANS_COLLECTION);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  function addTechnician(e) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const trimmedPhone = phone.trim();
    setName("");
    setPhone("");
    techniciansStore.add({ name: trimmedName, phone: trimmedPhone, status: "available" });
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
