// Issue #226 Row 11 -- Read-only Admin MVP (Task 16). Shared honest-empty-state
// for the four MVP surfaces (Users, Roles & Permissions, Permission Preview,
// Audit Logs): firestore.rules denies ALL client-direct read/write on every
// governed collection (permissions/roles/roleAssignments/accessRequests/
// auditEvents -- Row 3/PR #276), and no Cloud Function read path for these
// surfaces is deployed yet (Enterprise Access activation gate, Issue #226 Rows
// 19-22, Spec sec17 -- NOT Issue #15, whose Functions are deployed). Per the
// Specification's explicit
// prohibition, this surface must never imply a capability that isn't actually
// there -- so it says so plainly instead of showing empty tables or mock rows.
export default function AdministrationUnavailable({ title }) {
  return (
    <div className="fo-panel">
      <h2>{title}</h2>
      <p className="fo-muted">
        This surface's read-only content requires the Enterprise Access &amp; Administration
        Platform's trusted read path, which is not yet deployed and verified for this surface
        (tracked under the Enterprise Access activation gate, Issue #226 -- not Issue #15, whose
        Work Order and receiving Functions are deployed). Firestore Rules deny all client-direct
        access to governed Role/Permission/Audit data by design (Spec sec12) -- this surface will
        show real, live content once that read path ships and is verified.
      </p>
    </div>
  );
}
