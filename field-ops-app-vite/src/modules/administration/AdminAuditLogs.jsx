import { Link } from "react-router-dom";

// Administration > Audit Logs (Pass 10 UI truthfulness repair, D2).
//
// The governed access audit IS deployed: every Administration change is audited in PostgreSQL with who,
// when and the reason, and it is already readable on two surfaces -- an Employee's "Access Audit History"
// (readPolicyAuditHistory, filtered to that Employee's Principal) and a Security Role's "Decision history"
// (listRoleCapabilityDecisionHistory). What this page does not have is a consolidated tenant-wide list,
// so it says exactly that and routes to where the audit is shown. It reads nothing and wires no endpoint.
export default function AdminAuditLogs() {
  return (
    <div className="fo-panel">
      <h2>Audit Logs</h2>
      <p className="fo-muted">
        Governed access changes made through Administration are recorded with who made them, when, and
        the reason given. This page does not yet show a consolidated, tenant-wide list of them. The
        recorded audit is shown where each change applies:
      </p>
      <ul>
        <li>
          <strong>Access Audit History</strong> — open an Employee from{" "}
          <Link to="/administration/users">Users</Link>: the Security Role and direct-grant events for
          that Employee&rsquo;s sign-in identity.
        </li>
        <li>
          <strong>Decision history</strong> — choose a Security Role in{" "}
          <Link to="/administration/roles-permissions">Roles &amp; Permissions</Link>: the grants and
          revokes recorded for that Security Role.
        </li>
      </ul>
    </div>
  );
}
