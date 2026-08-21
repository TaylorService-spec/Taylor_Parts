import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useWorkOrders } from "../../hooks/useWorkOrders";
import { fieldPhaseTone } from "../../domain/fieldWorkOrder";
import WorkspaceShell from "../../shared/ui/WorkspaceShell.jsx";
import ActionRail from "../../shared/ui/ActionRail.jsx";
import StatusPill from "../../shared/ui/StatusPill.jsx";
import Button from "../../shared/ui/primitives/Button.jsx";
import { useAuth } from "../../auth/AuthContext";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";
import { TECHNICIANS_COLLECTION } from "../../domain/constants";
import { resolveTechnicianIdentity } from "../../domain/actorDisplayName";
import { loadErrorMessage } from "../../domain/loadErrorMessage";
import { createPermissionPreviewer } from "../../access/navPermissionPreview";
import { resolveEffectivePermission } from "../../access/resolveEffectivePermission";
import { COMPATIBILITY_ROLES } from "../../access/compatibilityRoles";
import { CAPABILITY_ACTIVATION_OVERRIDE_SET } from "../../config/capabilityActivationOverrides";

const previewHasPermission = createPermissionPreviewer(
  resolveEffectivePermission,
  COMPATIBILITY_ROLES,
  CAPABILITY_ACTIVATION_OVERRIDE_SET,
);

// F0 -- this surface now READS the governed Work Order Engine (fieldops_wos)
// instead of the legacy fieldops_jobs collection.
//
// Its legacy "New Job" form is REMOVED rather than migrated. Creating a
// governed Work Order requires a governed customerId + locationId + priority +
// classification (functions/src/createWorkOrder.ts), which the legacy form's
// free-text customer and optional address could not supply. Inventing a
// placeholder customer to keep a create button here would have manufactured
// exactly the ungoverned data F0 exists to eliminate. The governed creation
// path already exists -- WorkOrderWizard at /service/work-orders/new, with a
// real CustomerPicker -- so this surface links there.

export default function Jobs() {
  const { data: jobs, loading, error } = useWorkOrders();
  // The "Assigned" column showed a bare `fieldops_technicians` document id, which tells the reader
  // nothing about who is doing the work. Naming a technician requires reading the technician names,
  // so this surface now reads that collection -- the SAME read Dispatch and Control Tower already
  // perform. It fails independently and never blocks the work-order table: a technician who cannot
  // read the collection still gets the full list, with the assignment column honestly reporting that
  // the name is unavailable rather than falling back to the id.
  const {
    data: technicians,
    loading: techniciansLoading,
    error: techniciansError,
  } = useFirestoreCollection(TECHNICIANS_COLLECTION);
  const [announcement, setAnnouncement] = useState("");
  // The new row keeps a stable tabIndex=-1 (focusRowId is not cleared) so focusing
  // it never blurs when a follow-up render runs -- removing tabIndex from the
  // focused <tr> would drop focus to <body>. focusedOnceRef guards against
  // re-focusing on every later subscription tick.
  const [focusRowId, setFocusRowId] = useState(null);
  const focusedOnceRef = useRef(null);
  const newRowRef = useRef(null);

  // After a successful add, move focus to the new row once the live subscription
  // has delivered it. The id is only an internal match key -- never rendered.
  useEffect(() => {
    if (focusRowId && focusRowId !== focusedOnceRef.current && newRowRef.current) {
      newRowRef.current.focus();
      focusedOnceRef.current = focusRowId;
    }
  }, [focusRowId, jobs]);

  const { role } = useAuth();
  // Row 43 fix -- this button must stay in lockstep with App.jsx's own gate on the
  // /service/work-orders/new route (same permission id + same admin/dispatcher
  // fallback). Without this, a technician (who reaches this page via the "jobs"
  // legacyKey in ROLE_NAV_ACCESS) sees a live-looking primary action that matches
  // no mounted route and silently bounces them to /dashboard via the catch-all.
  const canCreateWorkOrder = previewHasPermission("workOrder.create", role, {
    fallback: role === "admin" || role === "dispatcher",
  });

  // "Nobody is assigned" and "assigned to someone we cannot name" are different facts, and an
  // em dash for both would hide the second one entirely.
  const assignedLabel = (job) => {
    const identity = resolveTechnicianIdentity(job.assignedTechId, {
      technicians,
      loading: techniciansLoading,
      error: techniciansError,
    });
    return identity.state === "unset" ? "Unassigned" : identity.name ?? "…";
  };

  const actions = (
    <ActionRail
      primary={
        canCreateWorkOrder ? (
          <Link className="fo-btn-link" to="/service/work-orders/new">New Work Order</Link>
        ) : (
          <Button variant="protected" reason="Requires admin or dispatcher role">
            New Work Order
          </Button>
        )
      }
    />
  );

  return (
    <WorkspaceShell title="Job Assignments" actions={actions}>
      {/* Success announcement -- polite live region for assistive tech. */}
      <p className="fo-sr-only" role="status" aria-live="polite">{announcement}</p>

      {loading ? (
        <p className="fo-muted">Loading work orders…</p>
      ) : error ? (
        // Fail VISIBLY -- the denial used to be swallowed, leaving the page spinning forever.
        //
        // It then failed visibly but INACCURATELY: every failure was reported as "you don't have
        // access", so an offline device, a dropped connection or a broken index all accused the user
        // of lacking permission they may well have. The cause now comes from the shared
        // loadErrorMessage helper that Dispatch and Control Tower already use, which keeps
        // permission-denied, unavailable and unknown distinct.
        //
        // The wayfinding half is kept, because it is genuinely useful -- but ONLY when the cause is
        // actually a permission denial. Telling someone whose network dropped to go look somewhere
        // else sends them on an errand that will not work either.
        <p className="fo-muted" role="alert">
          {loadErrorMessage(error, { entity: "work orders" })}
          {(error?.code === "permission-denied" || error?.code === "firestore/permission-denied") && (
            <> Your own assigned work is available in Technician Workspace.</>
          )}
        </p>
      ) : jobs.length === 0 ? (
        <p className="fo-muted">No work orders yet.</p>
      ) : (
        <div className="fo-table-scroll">
          <table className="fo-table">
            <thead>
              <tr>
                <th>Work Order</th>
                <th>Complaint</th>
                <th>Assigned</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr
                  key={job.id}
                  ref={job.id === focusRowId ? newRowRef : null}
                  tabIndex={job.id === focusRowId ? -1 : undefined}
                >
                  {/* A listed work order was a dead end -- the row named a record with no way to
                      open it. Linking the WO number is how every other list in this app navigates
                      (WorkOrdersList, ServiceActivitySection, EquipmentTimeline,
                      PartWorkOrderDemandSection), so this follows that convention rather than
                      introducing a whole-row click handler those surfaces deliberately avoid. */}
                  <td><Link to={`/service/work-orders/${job.id}`}>{job.woNumber ?? job.id}</Link></td>
                  <td>{job.complaint ?? job.description ?? "—"}</td>
                  <td className="fo-muted">{assignedLabel(job)}</td>
                  <td>
                    <StatusPill tone={fieldPhaseTone(job)} label={job.status} />
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
