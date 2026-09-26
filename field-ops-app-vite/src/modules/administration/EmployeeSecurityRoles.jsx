// EMPLOYEE > SECURITY ROLES -- assigned through PostgreSQL, never Firebase.
//
// Contract: docs/architecture/administration-control-plane-2026-09-26.md sections 6, 8 and 12 (assignment scope).
//
//   read   listPrincipalRoleAssignments { principalId }   (admin.principalAccess.read, server-side)
//          listRoles                                      (admin.securityPolicy.read)
//          listSupportedAssignmentScopes                  (admin.principalAccess.read) -- the scope vocabulary the
//                                                          RUNTIME decides, this tenant's governed values, and per
//                                                          Role which scopes it may be assigned at
//   write  assignRole { principalId, roleId, reason[, scopeType, scopeValue] }   (admin.roleAssignment.write)
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
// NO CLIENT GATE AND NO CLIENT SCOPE LOGIC. Whether the caller may assign is the server's
// admin.roleAssignment.write check. Which scopes a Role may take, which values a scope may take, and what a
// scoped assignment would confer are ALL the server's listSupportedAssignmentScopes answer, drawn as returned.
// When the server does not serve that read, only a global assignment is offered -- never a local scope list.
import { useState } from "react";
import { Button } from "../../shared/ui/primitives/index.js";
import { adminControlPlaneClient, refusalText } from "../../services/adminControlPlaneClient.js";
import { useControlPlaneRead } from "./useControlPlaneRead.js";
import { ReadState } from "./ObjectActionSecurity.jsx";
import { Outcome, ReasonField } from "./GrantControls.jsx";
import { statedReason } from "./controlPlaneModel.js";

const GLOBAL = "global";

/** The server's scope vocabulary, or null. Nothing here is invented when it is absent or unreadable. */
function scopeVocabularyFrom(data) {
  if (!data || typeof data !== "object" || !Array.isArray(data.scopeTypes) || !Array.isArray(data.roles)) return null;
  return data;
}

const dateOnly = (iso) => (typeof iso === "string" && iso.length >= 10 ? iso.slice(0, 10) : "—");

export default function EmployeeSecurityRoles({ api = adminControlPlaneClient, principalId, employeeName = "this Employee" }) {
  const assignments = useControlPlaneRead(principalId ? () => api.listPrincipalRoleAssignments(principalId) : null, `assignments:${principalId}`);
  const roles = useControlPlaneRead(principalId ? () => api.listRoles() : null, "roles");
  const scopes = useControlPlaneRead(principalId && typeof api.listSupportedAssignmentScopes === "function"
    ? () => api.listSupportedAssignmentScopes() : null, "assignmentScopes");
  const [roleId, setRoleId] = useState("");
  const [scopeType, setScopeType] = useState(GLOBAL);
  const [scopeValue, setScopeValue] = useState("");
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
  const vocabulary = scopes.status === "ready" ? scopeVocabularyFrom(scopes.data) : null;
  const scopeTypeEntry = (type) => vocabulary?.scopeTypes.find((s) => s.scopeType === type) ?? null;
  const scopeLabel = (type) => (type === GLOBAL || !type ? "All (global)" : scopeTypeEntry(type)?.label ?? type);
  const valueLabel = (type, value) => scopeTypeEntry(type)?.values?.find((v) => v.value === value)?.label ?? value;
  const nameOf = (a) => roleList.find((r) => r.id === a.roleId)?.name ?? a.roleKey ?? a.roleId;
  const active = rows.filter((a) => a.status === "active");
  const heldGlobally = new Set(active.filter((a) => a.scopeType === GLOBAL && !a.scopeValue).map((a) => a.roleId));
  const assignable = roleList.filter((r) => !heldGlobally.has(r.id));
  const reasonText = statedReason(reason);

  // The chosen Role's scopes, exactly as the server states them.
  const roleScopes = vocabulary?.roles.find((r) => r.roleId === roleId)?.assignableScopes ?? [];
  const chosenScope = scopeType === GLOBAL ? null : roleScopes.find((s) => s.scopeType === scopeType) ?? null;
  const chosenValues = scopeType === GLOBAL ? [] : scopeTypeEntry(scopeType)?.values ?? [];
  // Only a value the server listed for the chosen scope type can be submitted.
  const scopeReady = scopeType === GLOBAL
    || (chosenScope?.assignable === true && chosenValues.some((v) => v.value === scopeValue));

  const chooseRole = (id) => { setRoleId(id); setScopeType(GLOBAL); setScopeValue(""); };
  const chooseScope = (type) => { setScopeType(type); setScopeValue(""); };

  const assign = async (event) => {
    event.preventDefault();
    if (!roleId || !reasonText || busy || !scopeReady) return;
    setBusy(true);
    const outcome = scopeType === GLOBAL
      ? await api.assignRole({ principalId, roleId, reason: reasonText })
      : await api.assignRole({ principalId, roleId, reason: reasonText, scopeType, scopeValue });
    setBusy(false);
    setResult(outcome);
    if (outcome?.ok) { chooseRole(""); setReason(""); assignments.reload(); }
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
          <thead>
            <tr><th>Security Role</th><th>Assignment status</th><th>Scope</th><th>Scope value</th><th>Effective from</th><th /></tr>
          </thead>
          <tbody>
            {active.map((a) => (
              <tr key={a.id} data-assignment={a.id} data-assignment-scope={a.scopeType ?? GLOBAL}>
                <td>{nameOf(a)} <span className="fo-muted"><code>{a.roleKey ?? a.roleId}</code></span></td>
                <td>{a.status === "active" ? "Role assignment active" : String(a.status)}</td>
                <td>{scopeLabel(a.scopeType)}</td>
                <td className="fo-muted">{a.scopeValue ? valueLabel(a.scopeType, a.scopeValue) : "—"}</td>
                <td className="fo-muted">{dateOnly(a.grantedAt)}</td>
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
          <p>{`Remove ${nameOf(removing)}${removing.scopeValue ? ` (${scopeLabel(removing.scopeType)}: ${valueLabel(removing.scopeType, removing.scopeValue)})` : ""} from ${employeeName}? They lose what that assignment carries unless another Role they hold carries it too.`}</p>
          <ReasonField value={reason} onChange={setReason} />
          <div className="fo-btn-row">
            <Button type="submit" variant="primary" disabled={!reasonText || busy}>Confirm removal</Button>
            <Button type="button" variant="secondary" onClick={() => setRemoving(null)}>Cancel</Button>
          </div>
        </form>
      ) : (
        <form className="fo-cp-form" onSubmit={assign} aria-label="Assign a Security Role">
          <label className="fo-form-field">
            <span>Assign a Security Role</span>
            <select aria-label="Security Role to assign" value={roleId} onChange={(e) => chooseRole(e.target.value)}>
              <option value="">Choose a Security Role…</option>
              {assignable.map((r) => <option key={r.id} value={r.id}>{r.name ?? r.key}</option>)}
            </select>
          </label>
          {roleId ? (
            <ScopePicker
              scopes={scopes} vocabulary={vocabulary} roleScopes={roleScopes} scopeType={scopeType} scopeValue={scopeValue}
              chosenScope={chosenScope} chosenValues={chosenValues} scopeLabel={scopeLabel}
              onScopeType={chooseScope} onScopeValue={setScopeValue}
            />
          ) : null}
          <ReasonField value={reason} onChange={setReason} />
          <Button type="submit" variant="primary" disabled={!roleId || !reasonText || busy || !scopeReady}>Assign Security Role</Button>
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

/**
 * The scope choice for the chosen Role, drawn from the server's answer. Global is always offered. A scope the
 * server marks not assignable for this Role is shown disabled with the server's refusal code; a scope type the
 * runtime does not decide is not offered at all (its reason is listed beneath).
 */
function ScopePicker({ scopes, vocabulary, roleScopes, scopeType, scopeValue, chosenScope, chosenValues, scopeLabel, onScopeType, onScopeValue }) {
  if (!vocabulary) {
    return (
      <p className="fo-muted" data-assignment-scope-picker={scopes.status === "idle" ? "UNAVAILABLE" : scopes.status.toUpperCase()}>
        {scopes.status === "loading"
          ? "Reading the assignment scopes the server enforces…"
          : `Scope: All (global). Scoped assignment is not offered: the server's scope vocabulary (listSupportedAssignmentScopes) is not available${scopes.error ? ` (${refusalText(scopes.error)})` : ""}.`}
      </p>
    );
  }
  const unsupported = vocabulary.scopeTypes.filter((s) => !s.supported);
  const valueCount = (type) => (vocabulary.scopeTypes.find((s) => s.scopeType === type)?.values ?? []).length;
  return (
    <div data-assignment-scope-picker="READY">
      <label className="fo-form-field">
        <span>Scope</span>
        <select aria-label="Assignment scope" value={scopeType} onChange={(e) => onScopeType(e.target.value)}>
          <option value={GLOBAL}>All (global)</option>
          {roleScopes.map((s) => {
            // A scope the runtime decides but for which this tenant has NO governed value yet (e.g. no Sales Channel
            // activated) is shown unavailable, never offered with an empty or free-text value.
            const noValues = s.assignable && valueCount(s.scopeType) === 0;
            return (
              <option key={s.scopeType} value={s.scopeType} disabled={!s.assignable || noValues}>
                {!s.assignable ? `${scopeLabel(s.scopeType)} — not available for this Role (${s.refusal})`
                  : noValues ? `${scopeLabel(s.scopeType)} — unavailable: no governed value in this tenant`
                    : scopeLabel(s.scopeType)}
              </option>
            );
          })}
        </select>
      </label>
      {chosenScope ? (
        <>
          <label className="fo-form-field">
            <span>{scopeLabel(chosenScope.scopeType)}</span>
            <select aria-label="Scope value" value={scopeValue} onChange={(e) => onScopeValue(e.target.value)}>
              <option value="">{`Choose a ${scopeLabel(chosenScope.scopeType)}…`}</option>
              {chosenValues.map((v) => <option key={v.value} value={v.value}>{v.label ?? v.value}</option>)}
            </select>
          </label>
          <p className="fo-muted" data-scoped-confers>
            {`At this scope the Role grants only: ${chosenScope.scopedCapabilities.join(", ") || "nothing"}.`}
            {chosenScope.inertCapabilities.length > 0
              ? ` Its other capabilities (${chosenScope.inertCapabilities.join(", ")}) are not granted by a scoped assignment.`
              : ""}
          </p>
        </>
      ) : null}
      {unsupported.length > 0 ? (
        <p className="fo-muted" data-unsupported-scopes>
          {`Not offered — the runtime does not decide them: ${unsupported.map((s) => `${s.label} (${s.reason})`).join("; ")}.`}
        </p>
      ) : null}
    </div>
  );
}
