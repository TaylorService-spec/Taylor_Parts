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
import Autocomplete from "../../shared/ui/Autocomplete.jsx";
import { identifierLabel, operatingCompanyLabel, statusLabel, titleCase } from "../../shared/display/displayLabels.js";
import { useTableSort } from "../../shared/ui/sorting/useTableSort.js";
import SortableHeader from "../../shared/ui/sorting/SortableHeader.jsx";
import { formatDateOnly, formatTimestamp } from "../../domain/displayTimestamp.js";
import AdminDisclosure from "./AdminDisclosure.jsx";

const scopeWords = (h) => {
  const type = !h.scopeType || h.scopeType === "global" ? "All (Global)" : titleCase(h.scopeType);
  if (!h.scopeValue) return type;
  return `${type} · ${h.scopeType === "operatingCompany" ? operatingCompanyLabel(h.scopeValue) : h.scopeValue}`;
};

const HOLDER_COLUMNS = Object.freeze({
  holder: { value: (h) => principalLabel(h) },
  scope: { value: scopeWords },
  since: { value: (h) => h.grantedAt },
});

function HoldersTable({ holders, onRemove, technical = false }) {
  const { sort, toggle, sorted } = useTableSort({ rows: holders, columns: HOLDER_COLUMNS });
  const header = (key, label) => <SortableHeader columnKey={key} label={label} sort={sort} onSort={toggle} />;
  return (
    <table className="fo-table fo-table--stack" aria-label="Holders">
      <thead><tr>{header("holder", "Employee")}{header("scope", "Applies To")}{header("since", "Since")}<th>Administer</th></tr></thead>
      <tbody>
        {sorted.map((h) => (
          <tr key={h.assignmentId} data-holder={h.employeeId ?? h.principalId}>
            <td data-label="Employee">{h.employeeId ? <Link to={`/administration/users/${h.employeeId}`}>{principalLabel(h)}</Link> : principalLabel(h)}
              {technical ? <>{" "}<span className="fo-muted">ID <code>{h.principalId}</code></span></> : null}
              {h.employeeId ? null : <span className="fo-muted"> · no linked Employee</span>}</td>
            <td data-label="Applies To" className="fo-muted">{scopeWords(h)}</td>
            <td data-label="Since" className="fo-muted">{h.grantedAt ? formatDateOnly(h.grantedAt) : "—"}</td>
            <td data-label="Administer"><Button size="sm" variant="secondary" onClick={() => onRemove(h)}>Remove</Button></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const ASSIGNMENT_EVENT_COLUMNS = Object.freeze({
  when: { value: (ev) => ev.occurredAt },
  what: { value: (ev) => titleCase(ev.action) },
  by: { value: (ev) => ev.actorUid },
  reason: { value: (ev) => ev.reason },
});

function AssignmentHistoryTable({ events }) {
  const { sort, toggle, sorted } = useTableSort({ rows: events, columns: ASSIGNMENT_EVENT_COLUMNS });
  const header = (key, label) => <SortableHeader columnKey={key} label={label} sort={sort} onSort={toggle} />;
  return (
    <table className="fo-table fo-table--stack" aria-label="Assignment history">
      <thead><tr>{header("when", "When")}{header("what", "What")}{header("by", "By")}{header("reason", "Reason")}</tr></thead>
      <tbody>{sorted.map((ev) => (
        <tr key={ev.id}><td data-label="When">{formatTimestamp(ev.occurredAt)}</td><td data-label="What">{titleCase(ev.action)}</td>
          <td data-label="By"><code>{ev.actorUid}</code></td><td data-label="Reason">{ev.reason ?? "—"}</td></tr>))}</tbody>
    </table>
  );
}

/**
 * #210: ASSIGN this Security Role to an employee, from the role -- the SAME governed assignRole the employee record uses, with
 * an optional supported scope (salesChannel for a seller or Sales Manager). The server decides (Owner protection, self-
 * administration, staffing rules, scope validity) and the page re-reads; nothing is assumed.
 */
function AssignRoleToEmployee({ api, workforce, role, onChanged }) {
  const scopes = useControlPlaneRead(() => (api.listSupportedAssignmentScopes ? api.listSupportedAssignmentScopes(role.roleKey) : Promise.resolve({ ok: true, data: { scopeTypes: [] } })), `assign-scopes:${role.roleKey}`);
  // The employee is found by TYPEAHEAD over the governed roster (UI corrections item E): only people with an application
  // user can hold a Security Role, so suggestions without a linked Principal are not offered.
  const [person, setPerson] = useState(null);
  const searchPeople = async (query) => {
    const res = await workforce.call("listWorkforceRoster", { query, limit: 25 });
    if (!res.ok) return { ok: false, code: res.code, message: res.message };
    const items = res.result.items.filter((e) => e.principalId).slice(0, 8);
    return { ok: true, items, total: items.length };
  };
  const [scope, setScope] = useState("global");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState(null);
  const scopeOptions = (scopes.data?.scopeTypes ?? [])
    .filter((s) => s.supported && s.scopeType !== "global")
    .flatMap((s) => (s.values ?? []).map((v) => ({ value: `${s.scopeType}|${v.value}`, label: `${s.label ?? titleCase(s.scopeType)}: ${v.label ?? (s.scopeType === "operatingCompany" ? operatingCompanyLabel(v.value) : v.value)}` })));
  const submit = async (e) => {
    e.preventDefault();
    if (!person) { setResult({ error: "Choose an employee with an application user." }); return; }
    const [scopeType, scopeValue] = scope === "global" ? [null, null] : scope.split("|");
    const res = await api.assignRole({ principalId: person.principalId, roleId: role.roleId ?? role.id, reason, scopeType, scopeValue });
    setResult(res.ok ? { ok: `Assigned ${identifierLabel(role.roleKey, role.name)} to ${person.displayName}.` } : { error: `${res.code}: ${res.message}` });
    if (res.ok) { setReason(""); onChanged(); }
  };
  return (
    <form className="fo-roster__filters" onSubmit={submit} aria-label="Assign this Security Role">
      <Autocomplete
        id={`assign-role-employee-${role.roleKey}`}
        label="Employee to Assign"
        placeholder="Type a name or employee number"
        search={searchPeople}
        selected={person}
        getKey={(p) => p.employeeId}
        getLabel={(p) => p.displayName ?? p.employeeId}
        getContext={(p) => [p.jobRole?.label ?? "No Job Role", operatingCompanyLabel(p.operatingCompanyId)].join(" · ")}
        onSelect={setPerson}
      />
      <label className="fo-form-field"><span>Scope</span>
        <select className="fo-input" aria-label="Assignment scope" value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="global">All (Global)</option>
          {scopeOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select></label>
      <label className="fo-form-field"><span>Reason (Recorded)</span>
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
  // Approved Administration IA, Phase 3 (finding R02): the permission task is the first tab; employees and
  // history are their own tabs instead of preceding it. Same reads, same controls.
  const [tab, setTab] = useState("objects");
  const [technical, setTechnical] = useState(false);

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
        {identifierLabel(roleKey, role.name)} <span className="fo-muted">· Security Role{role.protected ? " · Protected" : ""}</span>
      </h3>
      {role.description ? <p className="fo-muted">{role.description}</p> : null}
      <p className="fo-muted">
        {holders.length} {holders.length === 1 ? "employee holds" : "employees hold"} this role · {groups.length} {groups.length === 1 ? "object" : "objects"}.
        Where it applies is set on each employee&rsquo;s assignment.
      </p>
      <label className="fo-form-field">
        <span>Show Technical Details</span>
        <input type="checkbox" checked={technical} onChange={(e) => setTechnical(e.target.checked)} />
      </label>
      {technical ? <p className="fo-muted">Role key <code>{roleKey}</code></p> : null}
      {detail.status === "loading" ? <p className="fo-muted" role="status">Re-reading from the server…</p> : null}

      <div className="fo-chip-row" role="tablist" aria-label="Security Role sections">
        {[["objects", "Objects & Permissions"], ["employees", `Employees (${holders.length})`], ["history", "History"]].map(([id, label]) => (
          <Button key={id} role="tab" aria-selected={tab === id} variant={tab === id ? "primary" : "secondary"} onClick={() => setTab(id)}>
            {label}
          </Button>
        ))}
      </div>

      {tab === "employees" && (
        <div role="tabpanel" aria-label="Employees">
          {holders.length === 0 ? (
            <p className="fo-muted">No employee holds this Security Role.</p>
          ) : (
            <>
            <label className="fo-form-field"><span>Reason for a Removal (Recorded)</span>
              <input className="fo-input" aria-label="Removal reason" value={removeReason} onChange={(e) => setRemoveReason(e.target.value)} /></label>
            {removeResult?.ok && <p className="fo-success" role="status">{removeResult.ok}</p>}
            {removeResult?.error && <p className="fo-warning" role="alert">{removeResult.error}</p>}
            <HoldersTable holders={holders} onRemove={remove} technical={technical} />
            </>
          )}
          <h4>Assign to an Employee</h4>
          <AssignRoleToEmployee api={api} workforce={workforce} role={{ ...role, roleKey }} onChanged={onChanged} />
        </div>
      )}

      {tab === "history" && (
        <div role="tabpanel" aria-label="History">
          <h4>Assignment History</h4>
          {Array.isArray(assignments.data) && assignments.data.length > 0 ? (
            <AssignmentHistoryTable events={assignments.data} />
          ) : <p className="fo-muted">{assignments.status === "failed" ? "Assignment history is not available to you (audit.event.read)." : "No recorded events for this Role yet."}</p>}
          <DecisionHistory read={history} />
        </div>
      )}

      {tab === "objects" && (
        <div role="tabpanel" aria-label="Objects & Permissions">
          <p className="fo-muted">
            Every governed action, grouped by Object. Expand an Object to administer its actions for this Role.
          </p>
          <table className="fo-table" aria-label="Objects and actions">
            <thead><tr><th>Object / Action</th><th>State</th><th>Administer</th></tr></thead>
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
                    technical={technical}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ADMIN-UI-001/002: the Object's business name only (its key and each capability key behind Show Technical
// Details), on a full-width disclosure row instead of an outlined button.
function ObjectGroupRows({ group, open, onToggle, api, roleKey, vocabulary, onChanged, technical = false }) {
  return (
    <>
      <tr>
        <td colSpan={3}>
          <AdminDisclosure open={open} onToggle={onToggle} meta={`${group.heldCount} of ${group.actions.length} held`}>
            {titleCase(group.objectKey)}
            {technical ? <> <code>{group.objectKey}</code></> : null}
          </AdminDisclosure>
        </td>
      </tr>
      {open ? group.actions.map((action) => (
        <tr key={action.capabilityKey} className="fo-row-nested" data-role-action={action.capabilityKey}>
          <td>
            {action.displayLabel ?? (action.actionKey ? titleCase(action.actionKey) : "Unlabelled action")}
            {technical ? <>{" "}<span className="fo-muted"><code>{action.capabilityKey}</code></span></> : null}
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

const DECISION_COLUMNS = Object.freeze({
  when: { value: (d) => d.decidedAt },
  capability: { value: (d) => d.capabilityKey },
  decision: { value: (d) => statusLabel(d.decision) },
  reason: { value: (d) => d.reason },
  actor: { value: (d) => d.actorPrincipalId },
  current: { value: (d) => (d.supersededAt ? `superseded ${d.supersededAt}` : "current") },
});
const NO_ROWS = Object.freeze([]);

function DecisionHistory({ read }) {
  const rows = Array.isArray(read.data) ? read.data : NO_ROWS;
  const { sort, toggle, sorted } = useTableSort({ rows, columns: DECISION_COLUMNS });
  const header = (key, label) => <SortableHeader columnKey={key} label={label} sort={sort} onSort={toggle} />;
  return (
    <div className="fo-cp-section" aria-label="Decision history">
      <h4>Decision History</h4>
      {!read.data ? <ReadState read={read} what="the decision history" /> : null}
      {read.data && rows.length === 0 ? <p className="fo-muted">No Administration decision has been recorded for this Security Role.</p> : null}
      {rows.length > 0 ? (
        <table className="fo-table" aria-label="Decision history">
          <thead><tr>{header("when", "When")}{header("capability", "Capability")}{header("decision", "Decision")}{header("reason", "Reason")}{header("actor", "Actor")}{header("current", "Current")}</tr></thead>
          <tbody>
            {sorted.map((d, i) => (
              <tr key={d.id ?? `${d.capabilityKey}-${d.decidedAt}-${i}`}>
                <td className="fo-muted">{d.decidedAt ?? "—"}</td>
                <td><code>{d.capabilityKey}</code></td>
                <td>{statusLabel(d.decision)} <code>{d.decision}</code>{d.requiresCondition ? " · requires condition" : ""}</td>
                <td>{d.reason}</td>
                <td className="fo-muted"><code>{d.actorPrincipalId ?? "—"}</code></td>
                <td className="fo-muted">{d.supersededAt ? `Superseded ${d.supersededAt}` : "Current"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
