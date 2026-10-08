// ADMINISTRATION → USERS → FUNCTIONAL ROLES -- the tenant catalog of business responsibilities (migration 1762819200000).
//
//   reads     listFunctionalRoles, listFunctionalRoleHolders, listFunctionalRoleHistory  (employee.record.read)
//   commands  createFunctionalRole, updateFunctionalRoleMetadata, setFunctionalRoleStatus (admin.employeeFunctionalRole.write)
//
// A FUNCTIONAL ROLE GRANTS NOTHING: it is not a Security Role (access) and not a Job Role (position). In a workflow it
// can only NARROW an action a Security Role capability already authorizes. Everything here is read from, and written
// through, the governed Workforce transport; the server decides and every refusal is shown verbatim (e.g.
// FUNCTIONAL_ROLE_HAS_CURRENT_HOLDERS on a deactivation, FUNCTIONAL_ROLE_KEY_COLLISION on a create). Write controls
// are OFFERED from readMyWorkforceCapabilities -- the same set the commands re-check -- and decide nothing.
//
// Reached from Administration → Users (a link above the directory), under the same Administration visibility as the
// Users surface; it has no navigation item of its own yet.
import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { Button } from "../../shared/ui/primitives/index.js";
import RuledSection from "../../shared/ui/RuledSection.jsx";
import { workforceApiClient } from "../../services/workforceApiClient.js";
import { WORKFORCE_READ_STATE, useWorkforceRead } from "../../hooks/useWorkforceRead.js";
import { useWorkforceCapabilities } from "../../hooks/useWorkforceCapabilities.js";
import { statedReason } from "./controlPlaneModel.js";
import { workforceRefusal } from "./EmployeeWorkAuthorization.jsx";
import { FUNCTIONAL_ROLE_WRITE_CAPABILITY } from "./EmployeeFunctionalRoles.jsx";
import { statusLabel, titleCase } from "../../shared/display/displayLabels.js";
import { useTableSort } from "../../shared/ui/sorting/useTableSort.js";
import SortableHeader from "../../shared/ui/sorting/SortableHeader.jsx";

const HOLDER_COLUMNS = Object.freeze({
  employee: { value: (h) => h.employee?.displayName ?? h.employee?.employeeId },
  state: { value: (h) => statusLabel(h.state) },
  from: { value: (h) => h.effectiveFrom },
  to: { value: (h) => h.effectiveTo },
  reason: { value: (h) => h.reason },
});

function HolderTable({ rows }) {
  const { sort, toggle, sorted } = useTableSort({ rows, columns: HOLDER_COLUMNS });
  const header = (key, label) => <SortableHeader columnKey={key} label={label} sort={sort} onSort={toggle} />;
  return (
    <table className="fo-table" aria-label="Functional Role holders" data-functional-role-holders={rows.length}>
      <thead><tr>{header("employee", "Employee")}{header("state", "State")}{header("from", "From")}{header("to", "To")}{header("reason", "Reason")}</tr></thead>
      <tbody>
        {sorted.map((h) => (
          <tr key={h.assignmentId}>
            <td><Link to={`/administration/users/${h.employee?.employeeId}`}>{h.employee?.displayName ?? h.employee?.employeeId}</Link></td>
            <td>{statusLabel(h.state)}</td>
            <td className="fo-muted">{h.effectiveFrom}</td>
            <td className="fo-muted">{h.effectiveTo ?? "—"}</td>
            <td className="fo-muted">{h.reason}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const CATALOG_COLUMNS = Object.freeze({
  name: { value: (r) => r.name },
  key: { value: (r) => r.key },
  status: { value: (r) => statusLabel(r.status) },
  holders: { value: (r) => (typeof r.currentHolderCount === "number" ? r.currentHolderCount : null) },
});

function CatalogTable({ items, onOpen }) {
  const { sort, toggle, sorted } = useTableSort({ rows: items, columns: CATALOG_COLUMNS });
  const header = (key, label) => <SortableHeader columnKey={key} label={label} sort={sort} onSort={toggle} />;
  return (
    <table className="fo-table" aria-label="Functional Roles" data-functional-role-rows={items.length}>
      <thead><tr>{header("name", "Name")}{header("key", "Key")}{header("status", "Status")}{header("holders", "Current Holders")}<th /></tr></thead>
      <tbody>
        {sorted.map((r) => (
          <tr key={r.functionalRoleId} data-functional-role-row={r.key}>
            <td>{r.name}</td>
            <td><code>{r.key}</code></td>
            <td>{statusLabel(r.status)}</td>
            <td>{r.currentHolderCount}</td>
            <td><Button type="button" variant="secondary" onClick={() => onOpen(r.functionalRoleId)} aria-label={`Open ${r.key}`}>Open</Button></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// NOT GrantControls' ReasonField: that one is `required`, and here the reason is optional for a create or a metadata
// edit (the server requires it only for a status change, and says so if it is missing).
function ReasonText({ value, onChange, label }) {
  return (
    <label className="fo-form-field">
      <span>{label}</span>
      <textarea aria-label="Reason" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

const unreachable = { ok: false, code: "UNREACHABLE", message: "the Workforce service could not be reached" };

function ServerOutcome({ outcome, success = "Saved by the server; re-reading." }) {
  if (!outcome) return null;
  if (outcome.ok) return <p className="fo-muted" role="status">{success}</p>;
  return <p className="fo-warning" role="alert" data-functional-role-refusal={outcome.reason ?? outcome.code}>{workforceRefusal(outcome)}</p>;
}

function ReadState({ read, what }) {
  if (read.status === WORKFORCE_READ_STATE.LOADING) return <p className="fo-muted">{`Reading ${what}…`}</p>;
  if (read.status === WORKFORCE_READ_STATE.FAILED) return <p className="fo-warning" role="alert">{workforceRefusal(read.error)}</p>;
  return null;
}

function CreateFunctionalRole({ workforce, onCreated }) {
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [reason, setReason] = useState("");
  const [outcome, setOutcome] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    const input = { key: key.trim(), name: name.trim() };
    if (description.trim()) input.description = description.trim();
    const why = statedReason(reason);
    if (why) input.reason = why;
    const result = await Promise.resolve(workforce.call("createFunctionalRole", input)).catch(() => unreachable);
    setOutcome(result);
    if (result?.ok) { setKey(""); setName(""); setDescription(""); setReason(""); onCreated?.(); }
  };
  return (
    <form className="fo-cp-form" aria-label="Create Functional Role" onSubmit={submit}>
      <label className="fo-form-field">
        <span>Key (lowercase letters, digits and hyphens; never changes)</span>
        <input aria-label="Functional Role key" value={key} onChange={(e) => setKey(e.target.value)} />
      </label>
      <label className="fo-form-field">
        <span>Name</span>
        <input aria-label="Functional Role name" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="fo-form-field">
        <span>Description (Optional)</span>
        <textarea aria-label="Functional Role description" value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <ReasonText value={reason} onChange={setReason} label="Reason (optional, recorded in the audit trail)" />
      <div className="fo-btn-row">
        <Button type="submit" variant="primary" disabled={!key.trim() || !name.trim()}>Create</Button>
      </div>
      <ServerOutcome outcome={outcome} success="Created by the server; re-reading." />
    </form>
  );
}

function FunctionalRoleDetail({ role, workforce, canWrite, onChanged }) {
  const holders = useWorkforceRead("listFunctionalRoleHolders", { functionalRoleId: role.functionalRoleId }, { client: workforce });
  const history = useWorkforceRead("listFunctionalRoleHistory", { functionalRoleId: role.functionalRoleId }, { client: workforce });
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description ?? "");
  const [reason, setReason] = useState("");
  const [outcome, setOutcome] = useState(null);
  const reasonText = statedReason(reason);
  const nextStatus = role.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";

  const run = async (operation, input) => {
    const result = await Promise.resolve(workforce.call(operation, input)).catch(() => unreachable);
    setOutcome(result);
    if (result?.ok) { setReason(""); holders.reload(); history.reload(); onChanged?.(); }
  };
  const metadataChange = () => {
    const input = { functionalRoleId: role.functionalRoleId };
    if (name.trim() !== role.name) input.name = name.trim();
    const d = description.trim();
    if (d !== (role.description ?? "")) input.description = d === "" ? null : d;
    if (reasonText) input.reason = reasonText;
    return input;
  };
  const holderRows = holders.status === WORKFORCE_READ_STATE.READY && Array.isArray(holders.data?.holders) ? holders.data.holders : null;
  const events = history.status === WORKFORCE_READ_STATE.READY && Array.isArray(history.data?.items) ? history.data.items : null;

  return (
    <div className="fo-cp-panel" data-functional-role-detail={role.key}>
      <h3>{role.name} <span className="fo-muted"><code>{role.key}</code> · {statusLabel(role.status)}</span></h3>
      {role.description ? <p className="fo-muted">{role.description}</p> : null}

      {canWrite ? (
        <form
          className="fo-cp-form"
          aria-label="Edit Functional Role"
          onSubmit={(e) => { e.preventDefault(); run("updateFunctionalRoleMetadata", metadataChange()); }}
        >
          <label className="fo-form-field">
            <span>Name</span>
            <input aria-label="Edit Functional Role name" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="fo-form-field">
            <span>Description</span>
            <textarea aria-label="Edit Functional Role description" value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <ReasonText value={reason} onChange={setReason} label="Reason (required to activate or deactivate; recorded in the audit trail)" />
          <div className="fo-btn-row">
            <Button type="submit" variant="secondary">Save Name and Description</Button>
            <Button
              type="button"
              variant={nextStatus === "INACTIVE" ? "destructive" : "primary"}
              disabled={!reasonText}
              onClick={() => run("setFunctionalRoleStatus", { functionalRoleId: role.functionalRoleId, status: nextStatus, reason: reasonText })}
            >
              {nextStatus === "INACTIVE" ? "Deactivate" : "Activate"}
            </Button>
          </div>
          <p className="fo-muted">
            Deactivation is refused while any Employee holds (or is scheduled to hold) this Functional Role, or an active
            workflow version requires it. Nothing is ended implicitly.
          </p>
        </form>
      ) : <p className="fo-muted">Changing the catalog is offered to holders of {FUNCTIONAL_ROLE_WRITE_CAPABILITY}; the Workforce service re-checks it.</p>}
      <ServerOutcome outcome={outcome} />

      <h4>Holders</h4>
      <ReadState read={holders} what="holders" />
      {holderRows ? (holderRows.length === 0 ? <p className="fo-muted">Nobody holds this Functional Role.</p> : (
        <HolderTable rows={holderRows} />
      )) : null}

      <h4>Audit History</h4>
      <ReadState read={history} what="history" />
      {events ? (events.length === 0 ? <p className="fo-muted">No recorded change.</p> : (
        <ul className="fo-cp-history" data-functional-role-events={events.length}>
          {events.map((ev, i) => (
            <li key={`${ev.occurredAt}-${i}`}>
              {titleCase(ev.action)} <code>{ev.action}</code> <span className="fo-muted">{ev.occurredAt}{ev.employeeId ? ` · Employee ${ev.employeeId}` : ""}{ev.reason ? ` · ${ev.reason}` : ""}</span>
            </li>
          ))}
        </ul>
      )) : null}
    </div>
  );
}

export default function AdminFunctionalRoles({ workforce = workforceApiClient }) {
  const { user } = useAuth() ?? {};
  const capabilities = useWorkforceCapabilities({ client: workforce, principalKey: user?.uid ?? null });
  const canWrite = capabilities.has(FUNCTIONAL_ROLE_WRITE_CAPABILITY);
  const catalog = useWorkforceRead("listFunctionalRoles", {}, { client: workforce });
  const [selected, setSelected] = useState(null);
  const items = catalog.status === WORKFORCE_READ_STATE.READY && Array.isArray(catalog.data?.items) ? catalog.data.items : null;
  const current = items && selected ? items.find((r) => r.functionalRoleId === selected) ?? null : null;

  return (
    <div className="fo-cp-page" data-admin-functional-roles>
      <p className="fo-muted"><Link to="/administration/users">Administration → Users</Link> → Functional Roles</p>
      <h1>Functional Roles</h1>
      <p className="fo-muted">
        Business responsibilities an Employee may hold. A Functional Role is not a Security Role and not a Job Role, and
        it grants nothing: a workflow may require one in addition to a Security Role, which only narrows who may act.
      </p>
      <RuledSection title="Catalog" meta="Tenant Functional Roles — Active and Inactive">
        <ReadState read={catalog} what="Functional Roles" />
        {items ? (items.length === 0 ? <p className="fo-muted">No Functional Role exists yet.</p> : (
          <CatalogTable items={items} onOpen={setSelected} />
        )) : null}
      </RuledSection>
      {current ? (
        <RuledSection title="Functional Role" meta="Holders, metadata, status and audit history">
          <FunctionalRoleDetail key={`${current.functionalRoleId}:${current.status}:${current.name}`} role={current} workforce={workforce} canWrite={canWrite} onChanged={catalog.reload} />
        </RuledSection>
      ) : null}
      {canWrite ? (
        <RuledSection title="New Functional Role" meta="admin.employeeFunctionalRole.write">
          <CreateFunctionalRole workforce={workforce} onCreated={catalog.reload} />
        </RuledSection>
      ) : null}
    </div>
  );
}
