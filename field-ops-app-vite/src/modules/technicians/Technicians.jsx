import { useEffect, useRef, useState } from "react";
import { createTechnician } from "../../domain/jobActions";
import { TECHNICIANS_COLLECTION } from "../../domain/constants";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";
import { technicianStatusTone } from "../../domain/technicianStatusTone";
import NewTechnicianModal from "./NewTechnicianModal";
import WorkspaceShell from "../../shared/ui/WorkspaceShell.jsx";
import ActionRail from "../../shared/ui/ActionRail.jsx";
import StatusPill from "../../shared/ui/StatusPill.jsx";
import FailureState from "../../shared/ui/FailureState";

// A technician is: { id, name, phone, status }
// status is one of "available" | "on_job" | "off_shift"
//
// Issue #214 PR-5: the create form that used to sit above this live table is now
// a "New Technician" action opening the shared accessible Modal
// (NewTechnicianModal). The table, its live subscription, and every
// field/payload/validation are unchanged.
//
// S-ADM-EMPLOYEES -- ATTEMPTED and DECLINED for cause. The admin nav item labelled
// "Employees" renders this module, which reads TECHNICIANS_COLLECTION
// ("fieldops_technicians") -- a distinct, live Firestore collection from `employees`,
// the collection employeeEntity/employeeIndexList (src/metadata/definitions/employee.js)
// describe. Migrating this table onto the metadata list runtime would mean swapping the
// underlying dataset (different fields, no wired create path onto `employees`, different
// lifecycle semantics for `status`) under a label that currently means "the live
// technician roster" -- a material product/data-model decision, not a rendering-layer
// migration a metadata-consumption lane may make on its own. See
// test/techniciansSurfaceEmployeeDivergence.test.jsx for the full reasoning and the
// regression-locking tests, and the S-ADM-EMPLOYEES ledger entry
// (docs/orchestration/metadata-program/ledger.json) for the record. No functional change
// was made to this file; the hand-written table below, its live subscription, and its
// create flow are unchanged.

export default function Technicians() {
  const { data: technicians, loading, error } = useFirestoreCollection(TECHNICIANS_COLLECTION);
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

  const actions = (
    <ActionRail
      primary={<button type="button" className="fo-btn-primary" onClick={() => setShowCreate(true)}>New Technician</button>}
    />
  );

  return (
    <WorkspaceShell title="Technicians" actions={actions}>
      <p className="fo-sr-only" role="status" aria-live="polite">{announcement}</p>

      {showCreate && (
        <NewTechnicianModal onCreate={handleCreate} onClose={() => setShowCreate(false)} />
      )}

      {loading ? (
        <p className="fo-muted">Loading technicians…</p>
      ) : error ? (
        // Fail VISIBLY -- the exact bug Jobs.jsx was fixed for (site-work
        // #3), sitting in its sibling: a denied/failed Technicians read
        // used to render identically to the genuinely-empty "No technicians
        // yet." state, hiding a real roster from an admin whose read failed.
        <FailureState message="You don't have access to the technician list. Please try again." />
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
                    <StatusPill tone={technicianStatusTone(tech.status)} label={tech.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </WorkspaceShell>
  );
}
