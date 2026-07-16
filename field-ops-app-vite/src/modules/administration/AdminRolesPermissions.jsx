import { COMPATIBILITY_ROLES } from "../../access/compatibilityRoles";

// Issue #226 Row 12 -- Admin mutation UI (Task 17), gated inert. Spec sec16's
// in-scope MVP mutation "assign already-approved Roles" maps to the
// already-merged, already-tested trusted-writer command `assignApprovedRole`
// (functions/src/access/trustedWriterCommands.ts), which is deliberately
// restricted to NON-PRIVILEGED Roles only (ADR-005 sec2.4) -- so the
// selectable list here excludes any Role marked `privileged` (today, only
// `admin`). Same "visible but inert" treatment as AdminUsers.jsx: the command
// is server-side only and not yet a deployed, callable Cloud Function
// (blocked on Issue #15). Activation is a separate, later Owner-authorized
// gate (Row 22), not this PR.
const ASSIGNABLE_ROLES = Object.values(COMPATIBILITY_ROLES).filter((role) => !role.privileged);

export default function AdminRolesPermissions() {
  return (
    <div className="fo-panel">
      <h2>Roles &amp; Permissions</h2>
      <p className="fo-muted">
        This surface's read-only content requires the Enterprise Access &amp; Administration
        Platform's trusted backend, which is not yet deployed and verified (Issue #15). Firestore
        Rules deny all client-direct access to governed Role/Permission/Audit data by design
        (Spec sec12) -- this surface will show real, live content once that backend ships and is
        verified.
      </p>
      <h3>Assign an already-approved Role</h3>
      <p className="fo-muted">
        Assigning a Role calls the trusted <code>assignApprovedRole</code> command, limited to
        non-privileged Roles only. It is implemented and tested but not deployed as a callable
        Cloud Function yet, so this form is shown to preview the intended surface and cannot be
        submitted.
      </p>
      <select disabled aria-disabled="true" defaultValue="">
        <option value="" disabled>
          Select a Role
        </option>
        {ASSIGNABLE_ROLES.map((role) => (
          <option key={role.id} value={role.id}>
            {role.id}
          </option>
        ))}
      </select>{" "}
      <button type="button" disabled aria-disabled="true">
        Assign Role
      </button>
    </div>
  );
}
