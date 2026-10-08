import { Link } from "react-router-dom";
import ObjectAuthorityMatrix from "./ObjectAuthorityMatrix.jsx";
import ObjectActionSecurityPanel from "./ObjectActionSecurity.jsx";
import { NotConfiguredNotice } from "./AdminPolicySurfaces.jsx";
import { readAdminQueryParam } from "../../domain/workflowResponsibilityLinks.js";
import { isPolicyApiConfigured } from "../../services/adminPolicyApiClient.js";
import WorkspaceShell from "../../shared/ui/WorkspaceShell.jsx";

// ADMINISTRATION > PERMISSIONS (approved IA; Owner decision 2026-10-08, DECISIONS #212).
//
// The SAME governed matrix and condition controls Objects renders, on their own destination. No new
// read, command or authority: both components resolve and enforce through the policy API exactly as
// they do on Objects, and this destination is gated by the same administration.objects surface.
export default function AdminPermissions() {
  const initialObjectKey = readAdminQueryParam("object");
  if (!isPolicyApiConfigured()) {
    return (
      <WorkspaceShell title="Permissions">
        <NotConfiguredNotice what="Stored permissions" />
        <p className="fo-muted">
          The code reference grid is on <Link to="/administration/objects">Objects</Link>.
        </p>
      </WorkspaceShell>
    );
  }
  return (
    <WorkspaceShell title="Permissions">
      <p className="fo-muted">
        What each Security Role can do on an object. Read-only until you choose to edit; every change asks
        for a reason and is recorded.
      </p>
      <ObjectAuthorityMatrix initialObjectKey={initialObjectKey} />
      <ObjectActionSecurityPanel initialObjectKey={initialObjectKey} />
    </WorkspaceShell>
  );
}
