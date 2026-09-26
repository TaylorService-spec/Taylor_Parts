// EMPLOYEE > SECURITY ROLES -- assigned through PostgreSQL, never Firebase.
//
// Contract: docs/architecture/administration-control-plane-2026-09-26.md sections 6 and 8.
//
//   read   listPrincipalRoleAssignments { principalId }   (admin.principalAccess.read, server-side)
//          listRoles                                      (admin.securityPolicy.read)
//   write  assignRole { principalId, roleId, reason }     (admin.roleAssignment.write)
//          revokeRole { assignmentId, reason }
//
// This REPLACES the Employee page's former Security Role control, which called the Firebase callable
// `assignApprovedRole` / `revokeRole` and wrote Firestore `roleAssignments` -- a second assignment store
// beside PostgreSQL, offered from a client registry of Roles. That path is gone from this page: the
// Roles offered are the tenant's PostgreSQL Roles, and the only writes are the governed PG commands.
//
// A SECURITY ROLE IS ACCESS, NOT A JOB ROLE. Job Role (business function) has its own section and its
// own Workforce authority; nothing here reads or writes it.
//
// NO CLIENT GATE. Whether the caller may assign is the server's admin.roleAssignment.write check (the
// last-administration-path guard and the protected-Role guard included). The controls are offered and
// a refusal comes back verbatim. Assignments are GLOBAL scope; a scoped PG assignment confers nothing
// at runtime today (contract section 8), so this page does not offer a scope picker.
import { useState } from "react";
import { Button } from "../../shared/ui/primitives/index.js";
import { adminControlPlaneClient } from "../../services/adminControlPlaneClient.js";
import { useControlPlaneRead } from "./useControlPlaneRead.js";
import { ReadState } from "./ObjectActionSecurity.jsx";
import { Outcome, ReasonField } from "./GrantControls.jsx";
import { statedReason } from "./controlPlaneModel.js";

export default function EmployeeSecurityRoles({ api = adminControlPlaneClient, principalId, employeeName = "this Employee" }) {
  const assignments = useControlPlaneRead(principalId ? () => api.listPrincipalRoleAssignments(principalId) : null, `assignments:${principalId}`);
  const roles = useControlPlaneRead(principalId ? () => api.listRoles() : null, "roles");
  const [roleId, setRoleId] = useState("");
  const [reason, setReason] = useState("");
  const [removing, setRemoving] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  if (!principalId) {
    return (
      <p className="fo-muted" data-employee-security-roles="NO_PRINCIPAL">
        No governed Principal is linked to this Employee, so there is no Security Role to administer.
      </p>
    );
  }
  if (!assignments.data) return <ReadState read={assignments} what="this Employee's Security Roles" />;

  const rows = Array.isArray(assignments.data?.assignments) ? assignments.data.assignments : null;
  if (!rows) return <p className="fo-warning" role="alert">The server returned a Role-assignment payload this screen cannot read, so nothing is shown.</p>;

  const roleList = Array.isArray(roles.data) ? roles.data : [];
  const nameOf = (a) => roleList.find((r) => r.id === a.roleId)?.name ?? a.roleKey ?? a.roleId;
  const active = rows.filter((a) => a.status === "active");
  const heldGlobally = new Set(active.filter((a) => a.scopeType === "global" && !a.scopeValue).map((a) => a.roleId));
  const assignable = roleList.filter((r) => !heldGlobally.has(r.id));
  const reasonText = statedReason(reason);

  const assign = async (event) => {
    event.preventDefault();
    if (!roleId || !reasonText || busy) return;
    setBusy(true);
    const outcome = await api.assignRole({ principalId, roleId, reason: reasonText });
    setBusy(false);
    setResult(outcome);
    if (outcome?.ok) { setRoleId(""); setReason(""); assignments.reload(); }
  };

  const revoke = async (event) => {
    event.preventDefault();
    if (!removing || !reasonText || busy) return;
    setBusy(true);
    const outcome = await api.revokeRole({ assignmentId: removing.id, reason: reasonText });
    setBusy(false);
    setResult(outcome);
    if (outcome?.ok) { setRemoving(null); setReason(""); assignments.reload(); }
  };

  return (
    <div data-employee-security-roles={active.length}>
      {assignments.status === "loading" ? <p className="fo-muted" role="status">Re-reading from the server…</p> : null}
      {active.length === 0 ? (
        <p className="fo-muted">{`${employeeName} holds no Security Role in the governed policy store.`}</p>
      ) : (
        <table className="fo-table" aria-label="Security Roles held">
          <thead><tr><th>Security Role</th><th>Scope</th><th /></tr></thead>
          <tbody>
            {active.map((a) => (
              <tr key={a.id} data-assignment={a.id}>
                <td>{nameOf(a)} <span className="fo-muted"><code>{a.roleKey ?? a.roleId}</code></span></td>
                <td className="fo-muted">{a.scopeType}{a.scopeValue ? ` · ${a.scopeValue}` : ""}</td>
                <td>
                  <Button type="button" variant="secondary" onClick={() => { setRemoving(a); setReason(""); setResult(null); }} aria-label={`Remove ${nameOf(a)}`}>
                    Remove
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {removing ? (
        <form className="fo-cp-form" onSubmit={revoke} aria-label="Remove a Security Role">
          <p>{`Remove ${nameOf(removing)} from ${employeeName}? They lose what that Role carries unless another Role they hold carries it too.`}</p>
          <ReasonField value={reason} onChange={setReason} />
          <div className="fo-btn-row">
            <Button type="submit" variant="primary" disabled={!reasonText || busy}>Confirm removal</Button>
            <Button type="button" variant="secondary" onClick={() => setRemoving(null)}>Cancel</Button>
          </div>
        </form>
      ) : (
        <form className="fo-cp-form" onSubmit={assign} aria-label="Assign a Security Role">
          <label className="fo-form-field">
            <span>Assign a Security Role (global scope)</span>
            <select aria-label="Security Role to assign" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
              <option value="">Choose a Security Role…</option>
              {assignable.map((r) => <option key={r.id} value={r.id}>{r.name ?? r.key}</option>)}
            </select>
          </label>
          <ReasonField value={reason} onChange={setReason} />
          <Button type="submit" variant="primary" disabled={!roleId || !reasonText || busy}>Assign Security Role</Button>
          <p className="fo-muted">
            Security Roles are additive — a person holds any number and their access is what those Roles
            carry together. The server decides whether you may assign one, and says so if not.
          </p>
        </form>
      )}
      <Outcome result={result} success="Saved by the server; re-reading." />
    </div>
  );
}
