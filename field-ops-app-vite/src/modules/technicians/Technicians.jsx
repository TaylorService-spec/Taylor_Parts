import { useEffect, useRef, useState } from "react";
import { createTechnician } from "../../domain/jobActions";
import { TECHNICIANS_COLLECTION } from "../../domain/constants";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";
import NewTechnicianModal from "./NewTechnicianModal";

// A technician is: { id, name, phone, status }
// status is one of "available" | "on_job" | "off_shift"
//
// Issue #214 PR-5: the create form that used to sit above this live table is now
// a "New Technician" action opening the shared accessible Modal
// (NewTechnicianModal). The table, its live subscription, and every
// field/payload/validation are unchanged.

export default function Technicians() {
  const { data: technicians, loading } = useFirestoreCollection(TECHNICIANS_COLLECTION);
  const [showCreate, setShowCreate] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  // Stable tabIndex=-1 on the new row (focusRowId not cleared) so focusing it
  // never blurs on a follow-up render; focusedOnceRef focuses it only once.
  const [focusRowId, setFocusRowId] = useState(null);
  const focusedOnceRef = useRef(null);
  const newRowRef = useRef(null);

  useEffect(() => {
    if (focusRowId && focusRowId !== focusedOnceRef.current && newRowRef.current) {
      newRowRef.current.focus();
      focusedOnceRef.current = focusRowId;
    }
  }, [focusRowId, technicians]);

  // Called by NewTechnicianModal. THROWS on a blocked/denied write so the modal
  // stays open with safe copy and nothing is persisted. On success: close once,
  // announce, and queue focus onto the new row. Payload/write path
  // (createTechnician) unchanged from the old inline form.
  async function handleCreate({ name, phone }) {
    const created = await createTechnician(name, phone);
    if (created?.blocked) {
      const blockedErr = new Error("write blocked");
      blockedErr.blocked = true;
      throw blockedErr;
    }
    setShowCreate(false);
    setFocusRowId(created.id);
    setAnnouncement(`Technician ${created.name} added.`);
  }

  return (
    <div className="fo-panel">
      <div className="fo-panel-head">
        <h2>Technicians</h2>
        <button type="button" onClick={() => setShowCreate(true)}>New Technician</button>
      </div>

      <p className="fo-sr-only" role="status" aria-live="polite">{announcement}</p>

      {showCreate && (
        <NewTechnicianModal onCreate={handleCreate} onClose={() => setShowCreate(false)} />
      )}

      {loading ? (
        <p className="fo-muted">Loading technicians…</p>
      ) : technicians.length === 0 ? (
        <p className="fo-muted">No technicians yet.</p>
      ) : (
        <div className="fo-table-scroll">
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
                <tr
                  key={tech.id}
                  ref={tech.id === focusRowId ? newRowRef : null}
                  tabIndex={tech.id === focusRowId ? -1 : undefined}
                >
                  <td>{tech.name}</td>
                  <td>{tech.phone}</td>
                  <td>
                    <span className={`fo-badge fo-badge-${tech.status}`}>{tech.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
