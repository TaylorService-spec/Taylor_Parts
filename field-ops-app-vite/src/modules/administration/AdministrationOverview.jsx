import { Link } from "react-router-dom";

// Issue #226 Row 10 -- Admin Portal foundation. The Overview screen is the
// Administration domain's new landing/hub: a real, built screen (not
// PlaceholderPage) that orients an admin/dispatcher toward the MVP surfaces
// Spec sec16 names, without itself reading or mutating any governed access
// data -- that content lands per-surface in Row 11 (read-only) and Row 12
// (mutation UI, gated inert until Issue #15's Functions are deployed and
// verified). No client-direct permission administration happens here or
// anywhere in this portal (Spec sec16).
const MVP_SURFACES = [
  {
    key: "users",
    path: "users",
    title: "Users",
    description: "View and set user status (enable/disable) once trusted commands are activated.",
  },
  {
    key: "rolesPermissions",
    path: "roles-permissions",
    title: "Roles & Permissions",
    description: "Review a user's assigned Role and assign an already-approved Role.",
  },
  {
    key: "permissionPreview",
    path: "permission-preview",
    title: "Permission Preview",
    description: "Read-only explanation of why a selected user can or can't perform a given action.",
  },
  {
    key: "auditLogs",
    path: "audit-logs",
    title: "Audit Logs",
    description: "Read-only, immutable history of every access grant, revoke, assignment, and status change.",
  },
];

export default function AdministrationOverview() {
  return (
    <div className="fo-panel">
      <h2>Administration Overview</h2>
      <p className="fo-muted">
        Enterprise Access &amp; Administration surfaces. Read-only content and trusted-command-backed actions
        roll out across these surfaces in later phases -- see each surface for its current status.
      </p>
      <ul>
        {MVP_SURFACES.map((surface) => (
          <li key={surface.key}>
            <Link to={`/administration/${surface.path}`}>{surface.title}</Link>
            <p className="fo-muted">{surface.description}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
