// Issue #226 Row 11 -- Read-only Admin MVP (Task 16). Shared honest-empty-state
// for the four MVP surfaces (Users, Roles & Permissions, Permission Preview,
// Audit Logs): firestore.rules denies ALL client-direct read/write on every
// governed collection (permissions/roles/roleAssignments/accessRequests/
// auditEvents -- Row 3/PR #276), and no Cloud Function read path is deployed
// yet (blocked on Issue #15, Spec sec17). Per the Specification's explicit
// prohibition, this surface must never imply a capability that isn't actually
// there -- so it says so plainly instead of showing empty tables or mock rows.
export default function AdministrationUnavailable({ title }) {
  return (
    <div className="fo-panel">
      <h2>{title}</h2>
      <p className="fo-muted">
        This surface's read-only content requires the Enterprise Access &amp; Administration
        Platform's trusted backend, which is not yet deployed and verified (Issue #15). Firestore
        Rules deny all client-direct access to governed Role/Permission/Audit data by design
        (Spec sec12) -- this surface will show real, live content once that backend ships and is
        verified.
      </p>
    </div>
  );
}
