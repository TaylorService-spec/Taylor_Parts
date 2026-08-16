import { COMPATIBILITY_ROLES } from "../../access/compatibilityRoles";

// Issue #226 Row 12 -- Admin mutation UI (Task 17), gated inert. Spec sec16's
// in-scope MVP mutation "assign already-approved Roles" maps to the
// already-merged, already-tested trusted-writer command `assignApprovedRole`
// (functions/src/access/trustedWriterCommands.ts), which is deliberately
// restricted to NON-PRIVILEGED Roles only (ADR-005 sec2.4) -- so the
// selectable list here excludes any Role marked `privileged` (today, only
// `admin`).
//
// CURRENT REPO TRUTH (Part 9 reconciliation, 2026-08-15): this comment
// previously claimed the command was "not yet a deployed, callable Cloud
// Function" -- stale. `assignApprovedRole` IS deployed as a live Cloud
// Function in eos-platform-sandbox (DECISIONS.md #90 finding F-2, 2026-08-06);
// it remains undeployed to production only (DECISIONS.md #97 line 562). Its
// Permission (`admin.roleAssignment.write`) carries no `active:false` gate and
// IS granted to the `admin` compatibility Role (compatibilityRoles.ts). Still
// shown disabled here for an HONEST reason: this surface has no trusted READ
// path to list real principals/roleAssignments to act on (Row 11's read path,
// separately gated -- see AdministrationUnavailable.jsx), and no principal in
// any environment yet holds the `roleAssignments` document every real call
// requires (the governed bootstrap step, `bootstrapCompatibilityAdmin`, exists
// in trustedWriterCommands.ts but is not exported/callable). Activation of a
// real, usable surface is a separate, later Owner-authorized gate (Row 22),
// not this reconciliation.
const ASSIGNABLE_ROLES = Object.values(COMPATIBILITY_ROLES).filter((role) => !role.privileged);

export default function AdminRolesPermissions() {
  return (
    <div className="fo-panel">
      <h2>Roles &amp; Permissions</h2>
      <p className="fo-muted">
        This surface's read-only content requires the Enterprise Access &amp; Administration
        Platform's trusted read path, which is not yet deployed and verified for this surface
        (tracked under the Enterprise Access activation gate, Issue #226 -- not Issue #15, whose
        Work Order and receiving Functions are deployed). Firestore Rules deny all client-direct
        access to governed Role/Permission/Audit data by design (Spec sec12) -- this surface will
        show real, live content once that read path ships and is verified.
      </p>
      <h3>Assign an already-approved Role</h3>
      <p className="fo-muted">
        Assigning a Role calls the trusted <code>assignApprovedRole</code> command, limited to
        non-privileged Roles only. It is implemented, tested, and deployed as a live Cloud
        Function in some environments (not yet in production). This form stays disabled because
        no trusted read exists yet to list real principals to act on, and no principal currently
        holds the access-record grant every real call requires -- not because the backend is
        unbuilt.
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
