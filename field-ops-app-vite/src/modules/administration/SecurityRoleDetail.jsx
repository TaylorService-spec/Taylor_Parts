// ADMINISTRATION > ROLES & PERMISSIONS > one SECURITY ROLE -- the enforced view of a Role.
//
// Contract: docs/architecture/administration-control-plane-2026-09-26.md section 8
// (getSecurityRoleDetail, listRoleCapabilityDecisionHistory, grant/revoke/condition mutations).
//
//   the Role (name, key, protected)
//   Holders -- the Principals with an active assignment of this Role
//   Objects & actions -- every governed action, held or not, with SOURCE and CONDITION, and the
//     controls to grant / revoke / set or retire a condition (reason required)
//   Decision history -- every Administration decision on this Role, oldest first, superseded included
//
// A SECURITY ROLE IS ACCESS. It is not a Job Role (business function, Workforce) and is never shown as
// one. The server's evaluator reads exactly these rows; nothing here is a projection it does not use.
import { useMemo, useState } from "react";
import { Button } from "../../shared/ui/primitives/index.js";
import { adminControlPlaneClient } from "../../services/adminControlPlaneClient.js";
import { useControlPlaneRead } from "./useControlPlaneRead.js";
import { GrantCellControls, GrantCellFacts } from "./GrantControls.jsx";
import { ReadState } from "./ObjectActionSecurity.jsx";
import { roleActionsByObject } from "./controlPlaneModel.js";
import { principalLabel } from "./principalDisplay.js";
import { useConditionVocabulary } from "./useConditionVocabulary.js";
import { Link } from "react-router-dom";
import { workforceApiClient } from "../../services/workforceApiClient.js";

/**
 * #210: ASSIGN this Security Role to an employee, from the role -- the SAME governed assignRole the employee record uses, with
 * an optional supported scope (salesChannel for a seller or Sales Manager). The server decides (Owner protection, self-
 * administration, staffing rules, scope validity) and the page re-reads; nothing is assumed.
 */
function AssignRoleToEmployee({ api, workforce, role, onChanged }) {
  const roster = useControlPlaneRead(() => workforce.call("listWorkforceRoster", {}).then((r) => (r.ok ? { ok: true, data: r.result } : r)), "roster-for-assign");
  const scopes = useControlPlaneRead(() => (api.listSupportedAssignmentScopes ? api.listSupportedAssignmentScopes(role.roleKey) : Promise.resolve({ ok: true, data: { scopeTypes: [] } })), `assign-scopes:${role.roleKey}`);
  const [employeeId, setEmployeeId] = useState("");
  const [scope, setScope] = useState("global");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState(null);
  const people = (roster.data?.items ?? []).filter((e) => e.principalId);
  const scopeOptions = (scopes.data?.scopeTypes ?? [])
    .filter((s) => s.supported && s.scopeType !== "global")
    .flatMap((s) => (s.values ?? []).map((v) => ({ value: `${s.scopeType}|${v.value}`, label: `${s.label ?? s.scopeType}: ${v.label ?? v.value}` })));
  const submit = async (e) => {
    e.preventDefault();
    const person = people.find((p) => p.employeeId === employeeId);
    if (!person) { setResult({ error: "Choose an employee with an application user." }); return; }
    const [scopeType, scopeValue] = scope === "global" ? [null, null] : scope.split("|");
    const res = await api.assignRole({ principalId: person.principalId, roleId: role.roleId ?? role.id, reason, scopeType, scopeValue });
    setResult(res.ok ? { ok: `Assigned ${role.name ?? role.roleKey} to ${person.displayName}.` } : { error: `${res.code}: ${res.message}` });
    if (res.ok) { setReason(""); onChanged(); }
  };
  return (
    <form className="fo-roster__filters" onSubmit={submit} aria-label="Assign this Security Role">
      <label className="fo-form-field"><span>Employee</span>
        <select className="fo-input" aria-label="Employee to assign" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
          <option value="">Choose an employee…</option>
          {people.map((p) => <option key={p.employeeId} value={p.employeeId}>{p.displayName} — {p.jobRole?.label ?? "no Job Role"}</option>)}
        </select></label>
      <label className="fo-form-field"><span>Scope</span>
        <select className="fo-input" aria-label="Assignment scope" value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="global">All (global)</option>
          {scopeOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select></label>
      <label className="fo-form-field"><span>Reason (recorded)</span>
        <input className="fo-input" aria-label="Assignment reason" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <Button type="submit" variant="primary">Assign</Button>
      {result?.ok && <p className="fo-success" role="status">{result.ok}</p>}
      {result?.error && <p className="fo-warning" role="alert">{result.error}</p>}
    </form>
  );
}

export default function SecurityRoleDetail({ api = adminControlPlaneClient, workforce = workforceApiClient, roleKey }) {
  const detail = useControlPlaneRead(roleKey ? () => api.getSecurityRoleDetail(roleKey) : null, `role:${roleKey}`);
  const history = useControlPlaneRead(roleKey ? () => api.listRoleCapabilityDecisionHistory({ roleKey, limit: 200 }) : null, `history:${roleKey}`);
  const groups = useMemo(() => (detail.data ? roleActionsByObject(detail.data) : null), [detail.data]);
  const [openObject, setOpenObject] = useState(null);
  const vocabulary = useConditionVocabulary(api);
  // #210: who was given or lost this Role, and when -- the governed policy audit filtered to this Role (assignment events included).
  const assignments = useControlPlaneRead(roleKey ? () => api.readPolicyAuditHistory({ roleKey, limit: 50 }) : null, `role-audit:${roleKey}`);
  const [removeReason, setRemoveReason] = useState("");
  const [removeResult, setRemoveResult] = useState(null);

  if (!roleKey) return null;
  if (!detail.data) return <ReadState read={detail} what="this Security Role" />;
  if (!groups) return <p className="fo-warning" role="alert">The server returned a Security Role payload this screen cannot read, so nothing is shown.</p>;

  const role = detail.data;
  const holders = Array.isArray(role.holders) ? role.holders : [];
  const onChanged = () => { detail.reload(); history.reload(); assignments.reload(); };
  const remove = async (h) => {
    if (removeReason.trim().length < 4) { setRemoveResult({ error: "State the reason for removing this assignment first." }); return; }
    const res = await api.revokeRole({ assignmentId: h.assignmentId, reason: removeReason.trim() });
    setRemoveResult(res.ok ? { ok: `Removed from ${principalLabel(h)}.` } : { error: `${res.code}: ${res.message}` });
    if (res.ok) onChanged();
  };

  return (
    <section className="fo-panel" aria-label={`Security Role ${role.name ?? roleKey}`} data-security-role={roleKey}>
      <h3>
        {role.name ?? roleKey} <span className="fo-muted">· Security Role <code>{roleKey}</code>{role.protected ? " · protected" : ""}</span>
      </h3>
      {role.description ? <p className="fo-muted">{role.description}</p> : null}
      {detail.status === "loading" ? <p className="fo-muted" role="status">Re-reading from the server…</p> : null}

      <h4>Holders ({holders.length})</h4>
      {holders.length === 0 ? (
        <p className="fo-muted">No Principal holds this Security Role.</p>
      ) : (
        <>
        <label className="fo-form-field"><span>Reason for a removal (recorded)</span>
          <input className="fo-input" aria-label="Removal reason" value={removeReason} onChange={(e) => setRemoveReason(e.target.value)} /></label>
        {removeResult?.ok && <p className="fo-success" role="status">{removeResult.ok}</p>}
        {removeResult?.error && <p className="fo-warning" role="alert">{removeResult.error}</p>}
        <table className="fo-table fo-table--stack" aria-label="Holders">
          <thead><tr><th>Holder</th><th>Scope</th><th>Since</th><th>Administer</th></tr></thead>
          <tbody>
            {holders.map((h) => (
              <tr key={h.assignmentId} data-holder={h.employeeId ?? h.principalId}>
                <td data-label="Holder">{h.employeeId ? <Link to={`/administration/users/${h.employeeId}`}>{principalLabel(h)}</Link> : principalLabel(h)}
                  <span className="fo-muted"> · Principal <code>{h.principalId}</code>{h.employeeId ? "" : " · no linked Employee"}</span></td>
                <td data-label="Scope" className="fo-muted">{h.scopeType}{h.scopeValue ? ` · ${h.scopeValue}` : ""}</td>
                <td data-label="Since" className="fo-muted">{h.grantedAt ?? "—"}</td>
                <td data-label="Administer"><Button size="sm" variant="secondary" onClick={() => remove(h)}>Remove</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
        </>
      )}
      <h4>Assign to an employee</h4>
      <AssignRoleToEmployee api={api} workforce={workforce} role={{ ...role, roleKey }} onChanged={onChanged} />
      <h4>Assignment history</h4>
      {Array.isArray(assignments.data) && assignments.data.length > 0 ? (
        <table className="fo-table fo-table--stack" aria-label="Assignment history">
          <thead><tr><th>When</th><th>What</th><th>By</th><th>Reason</th></tr></thead>
          <tbody>{assignments.data.map((ev) => (
            <tr key={ev.id}><td data-label="When">{ev.occurredAt}</td><td data-label="What">{ev.action}</td>
              <td data-label="By"><code>{ev.actorUid}</code></td><td data-label="Reason">{ev.reason ?? "—"}</td></tr>))}</tbody>
        </table>
      ) : <p className="fo-muted">{assignments.status === "failed" ? "Assignment history is not available to you (audit.event.read)." : "No recorded events for this Role yet."}</p>}

      <h4>Objects &amp; actions</h4>
      <p className="fo-muted">
        Every governed action, grouped by Object. Expand an Object to administer its actions for this Role.
      </p>
      <table className="fo-table" aria-label="Objects and actions">
        <thead><tr><th>Object / action</th><th>State</th><th>Administer</th></tr></thead>
        <tbody>
          {groups.map((group) => {
            const open = openObject === group.objectKey;
            return (
              <ObjectGroupRows
                key={group.objectKey}
                group={group}
                open={open}
                onToggle={() => setOpenObject(open ? null : group.objectKey)}
                api={api}
                roleKey={roleKey}
                vocabulary={vocabulary}
                onChanged={onChanged}
              />
            );
          })}
        </tbody>
      </table>

      <DecisionHistory read={history} />
    </section>
  );
}

function ObjectGroupRows({ group, open, onToggle, api, roleKey, vocabulary, onChanged }) {
  return (
    <>
      <tr>
        <td colSpan={3}>
          <Button type="button" variant="secondary" onClick={onToggle} aria-expanded={open}>
            {open ? "▾" : "▸"} {group.objectKey}
          </Button>
          <span className="fo-muted">{` ${group.heldCount} of ${group.actions.length} held`}</span>
        </td>
      </tr>
      {open ? group.actions.map((action) => (
        <tr key={action.capabilityKey} className="fo-row-nested" data-role-action={action.capabilityKey}>
          <td>
            {action.displayLabel ?? "Unlabelled action"}{" "}
            <span className="fo-muted"><code>{action.capabilityKey}</code></span>
            {action.forbiddenBy ? <span className="fo-muted">{` · ${action.forbiddenBy}`}</span> : null}
          </td>
          <td><GrantCellFacts cell={action} /></td>
          <td>
            <GrantCellControls
              api={api}
              objectKey={action.objectKey}
              actionKey={action.actionKey}
              roleKey={roleKey}
              capabilityKey={action.capabilityKey}
              cell={action}
              vocabulary={vocabulary}
              onChanged={onChanged}
            />
          </td>
        </tr>
      )) : null}
    </>
  );
}

function DecisionHistory({ read }) {
  const rows = Array.isArray(read.data) ? read.data : [];
  return (
    <div className="fo-cp-section" aria-label="Decision history">
      <h4>Decision history</h4>
      {!read.data ? <ReadState read={read} what="the decision history" /> : null}
      {read.data && rows.length === 0 ? <p className="fo-muted">No Administration decision has been recorded for this Security Role.</p> : null}
      {rows.length > 0 ? (
        <table className="fo-table" aria-label="Decision history">
          <thead><tr><th>When</th><th>Capability</th><th>Decision</th><th>Reason</th><th>Actor</th><th>Current</th></tr></thead>
          <tbody>
            {rows.map((d, i) => (
              <tr key={d.id ?? `${d.capabilityKey}-${d.decidedAt}-${i}`}>
                <td className="fo-muted">{d.decidedAt ?? "—"}</td>
                <td><code>{d.capabilityKey}</code></td>
                <td>{d.decision}{d.requiresCondition ? " · requires condition" : ""}</td>
                <td>{d.reason}</td>
                <td className="fo-muted"><code>{d.actorPrincipalId ?? "—"}</code></td>
                <td className="fo-muted">{d.supersededAt ? `superseded ${d.supersededAt}` : "current"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
