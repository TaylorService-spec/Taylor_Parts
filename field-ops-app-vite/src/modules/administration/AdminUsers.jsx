// Issue #226 Row 12 -- Admin mutation UI (Task 17), gated inert. Spec sec16's
// in-scope MVP mutation "view/set user status" maps to the already-merged,
// already-tested trusted-writer command `setUserStatus` (functions/src/access/
// trustedWriterCommands.ts) -- but that command is server-side only and not
// yet exported as a deployed, callable Cloud Function (blocked on Issue #15,
// Spec sec17/ADR-005 sec2.6). Per the Implementation Plan's Row 12
// ("actions visibly unavailable until #15 Functions are deployed+verified"),
// the action is shown -- not hidden -- but genuinely disabled: there is no
// path from this button to any Firestore/Auth mutation today. Activating it
// is a separate, later Owner-authorized gate (Row 22), not this PR.
export default function AdminUsers() {
  return (
    <div className="fo-panel">
      <h2>Users</h2>
      <p className="fo-muted">
        This surface's read-only content requires the Enterprise Access &amp; Administration
        Platform's trusted backend, which is not yet deployed and verified (Issue #15). Firestore
        Rules deny all client-direct access to governed Role/Permission/Audit data by design
        (Spec sec12) -- this surface will show real, live content once that backend ships and is
        verified.
      </p>
      <h3>Set user status</h3>
      <p className="fo-muted">
        Enabling or disabling a user calls the trusted <code>setUserStatus</code> command. It is
        implemented and tested but not deployed as a callable Cloud Function yet, so these actions
        are shown to preview the intended surface and cannot be triggered.
      </p>
      <button type="button" disabled aria-disabled="true">
        Enable user
      </button>{" "}
      <button type="button" disabled aria-disabled="true">
        Disable user
      </button>
    </div>
  );
}
