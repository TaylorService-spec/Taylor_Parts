// ADMINISTRATION > WORKFLOWS > one VERSION -- definition, validation, lifecycle, instances, history.
//
// Every fact here is the server's answer (readWorkflowVersion, validateWorkflowVersion,
// listWorkflowInstances, readWorkflowHistory). Every control sends one governed mutation with a
// stated reason and then re-reads; a refusal is shown verbatim as `CODE: message`.
import { useMemo, useState } from "react";
import { Button } from "../../shared/ui/primitives/index.js";
import { refusalText } from "../../services/adminControlPlaneClient.js";
import {
  buildWorkflowVersionView,
  lifecycleActions,
  lifecycleLabel,
  validationSummary,
} from "../../domain/adminWorkflowView.js";
import { useControlPlaneRead } from "./useControlPlaneRead.js";
import { ReadState } from "./ObjectActionSecurity.jsx";
import WorkflowDraftEditor from "./WorkflowDraftEditor.jsx";
import { useMyWorkflowAdministration } from "./useMyWorkflowAdministration.js";
import ValidationResults from "./WorkflowValidationResults.jsx";
import { identifierLabel, statusLabel, titleCase } from "../../shared/display/displayLabels.js";
import { useTableSort } from "../../shared/ui/sorting/useTableSort.js";
import SortableHeader from "../../shared/ui/sorting/SortableHeader.jsx";

const ACTION_WORDS = Object.freeze({
  publish: "Publish (Becomes Active)",
  activate: "Make Active",
  retire: "Retire",
  newVersion: "New Draft from This Version",
});
// W01 D2: the server operation each lifecycle button calls -- what readMyWorkflowAdministration answers for.
const LIFECYCLE_OPERATION = Object.freeze({
  publish: "publishWorkflowVersion", activate: "activateWorkflowVersion", retire: "retireWorkflowVersion", newVersion: "createWorkflowVersion",
});

/**
 * #210: RUN RECORDS ON THE ACTIVE VERSION. Start a record's workflow (pinned to this ACTIVE version at its initial step), or move
 * the records still pinned to another version onto this one -- same step keys map to themselves; the server refuses any step the
 * target lacks. Both are governed commands (workflowDefinition.publish), audited; the screen re-reads.
 */
function ActiveVersionRecords({ api, workflow, versionId, steps, reason, onDone, permissions }) {
  const [recordId, setRecordId] = useState("");
  const [fromVersionId, setFromVersionId] = useState("");
  const [result, setResult] = useState(null);
  const versions = (workflow.versions ?? []).filter((v) => v.id !== versionId);
  const start = async () => {
    const r = await api.startWorkflowInstance({ workflowKey: workflow.key, recordId: recordId.trim(), reason });
    setResult(r.ok ? { ok: `Started ${recordId.trim()} at the initial step.` } : { error: refusalText(r) });
    if (r.ok) { setRecordId(""); onDone(); }
  };
  const migrate = async () => {
    const stepMap = Object.fromEntries(steps.map((s) => [s.key, s.key]));
    const r = await api.migrateWorkflowInstances({ fromVersionId, toVersionId: versionId, stepMap, reason });
    setResult(r.ok ? { ok: `Moved ${r.data?.moved ?? r.data?.instances?.length ?? "the"} record(s) onto this version.` } : { error: refusalText(r) });
    if (r.ok) onDone();
  };
  return (
    <div className="fo-cp-section" aria-label="Run records on this version">
      <h4>Run Records on This Version</h4>
      <div className="fo-roster__filters">
        <label className="fo-form-field"><span>Record ID</span>
          <input type="text" aria-label="Record to start" value={recordId} onChange={(e) => setRecordId(e.target.value)} /></label>
        <Button variant="secondary" disabled={!recordId.trim() || !reason.trim() || !permissions?.allows("startWorkflowInstance")}
          title={permissions?.reason("startWorkflowInstance") ?? undefined} onClick={start}>Start Workflow for Record</Button>
      </div>
      {versions.length > 0 ? (
        <div className="fo-roster__filters">
          <label className="fo-form-field"><span>Move Records From</span>
            <select aria-label="Version to move records from" value={fromVersionId} onChange={(e) => setFromVersionId(e.target.value)}>
              <option value="">Choose a Version…</option>
              {versions.map((v) => <option key={v.id} value={v.id}>v{v.version} · {statusLabel(v.status)}</option>)}
            </select></label>
          <Button variant="secondary" disabled={!fromVersionId || !reason.trim() || !permissions?.allows("migrateWorkflowInstances")}
            title={permissions?.reason("migrateWorkflowInstances") ?? undefined} onClick={migrate}>Move In-Flight Records Here</Button>
        </div>
      ) : null}
      <p className="fo-muted">Uses the Reason above. In-flight records stay on the version they started on until moved.</p>
      {result?.ok && <p className="fo-success" role="status">{result.ok}</p>}
      {result?.error && <p className="fo-warning" role="alert">{result.error}</p>}
    </div>
  );
}

const bindingWords = (a) => (a.bindings.length === 0 ? "no Role bound" : a.bindings.map((b) => (
  b.bindingKind === "SECURITY_ROLE" ? identifierLabel(b.roleKey)
    : b.bindingKind === "FUNCTIONAL_ROLE" ? `Functional Role ${identifierLabel(b.functionalRoleKey)} (narrows)`
      : `${identifierLabel(b.roleKey ?? b.functionalRoleKey)} (${titleCase(b.bindingKind)})`
)).join(", "));
const stepKind = (s) => (s.initial ? "Start" : s.terminal ? "End" : "In Progress");

const STATE_COLUMNS = Object.freeze({
  state: { value: (s) => s.label ?? s.key },
  kind: { value: (s) => (s.initial ? 0 : s.terminal ? 2 : 1) },
  outgoing: { value: (s) => s.outgoing.join(", ") },
});

function StatesTable({ steps }) {
  const { sort, toggle, sorted } = useTableSort({ rows: steps, columns: STATE_COLUMNS });
  const header = (key, label) => <SortableHeader columnKey={key} label={label} sort={sort} onSort={toggle} />;
  return (
    <table className="fo-table" aria-label="States">
      <thead><tr>{header("state", "State")}{header("kind", "Kind")}{header("outgoing", "Actions From Here")}</tr></thead>
      <tbody>
        {sorted.map((s) => (
          <tr key={s.key}>
            <td>{s.label} <span className="fo-muted">· {s.key}</span></td>
            <td className="fo-muted">{stepKind(s)}</td>
            <td className="fo-muted">{s.outgoing.length ? s.outgoing.join(", ") : (s.terminal ? "None — terminal" : "None")}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const ACTION_COLUMNS = Object.freeze({
  action: { value: (a) => a.label ?? a.key },
  path: { value: (a) => `${titleCase(a.from)} → ${titleCase(a.to)}` },
  capability: { value: (a) => a.capabilityKey },
  guard: { value: (a) => (a.guardKind ? titleCase(a.guardKind) : null) },
  bindings: { value: (a) => (a.bindings.length === 0 ? null : bindingWords(a)) },
});

function ActionsTable({ actions }) {
  const { sort, toggle, sorted } = useTableSort({ rows: actions, columns: ACTION_COLUMNS });
  const header = (key, label) => <SortableHeader columnKey={key} label={label} sort={sort} onSort={toggle} />;
  return (
    <table className="fo-table" aria-label="Actions">
      <thead><tr>{header("action", "Action")}{header("path", "From → To")}{header("capability", "Capability")}{header("guard", "Guard")}{header("bindings", "Bound Security Roles")}</tr></thead>
      <tbody>
        {sorted.map((a) => (
          <tr key={a.key} data-workflow-action={a.key}>
            <td>{a.label} <span className="fo-muted">· {a.key}</span></td>
            <td className="fo-muted">{titleCase(a.from)} → {titleCase(a.to)}</td>
            <td>{a.capabilityKey ? <code>{a.capabilityKey}</code> : <span className="fo-warning">none</span>}</td>
            <td className="fo-muted">{a.guardKind ? titleCase(a.guardKind) : "—"}</td>
            <td className="fo-muted">{bindingWords(a)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const INSTANCE_COLUMNS = Object.freeze({
  record: { value: (i) => i.recordId },
  step: { value: (i) => titleCase(i.currentStepKey) },
  since: { value: (i) => i.updatedAt },
});

function InstancesTable({ instances }) {
  const { sort, toggle, sorted } = useTableSort({ rows: instances, columns: INSTANCE_COLUMNS });
  const header = (key, label) => <SortableHeader columnKey={key} label={label} sort={sort} onSort={toggle} />;
  return (
    <table className="fo-table" aria-label="Pinned instances">
      <thead><tr>{header("record", "Record")}{header("step", "Current Step")}{header("since", "Since")}</tr></thead>
      <tbody>
        {sorted.map((i) => (
          <tr key={i.id}><td><code>{i.recordId}</code></td><td>{titleCase(i.currentStepKey)}</td><td className="fo-muted">{i.updatedAt ?? "—"}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

const HISTORY_COLUMNS = Object.freeze({
  when: { value: (e) => e.occurredAt },
  change: { value: (e) => titleCase(e.action) },
  version: { value: (e) => (typeof e.after?.version === "number" ? e.after.version : null) },
  reason: { value: (e) => e.reason },
  actor: { value: (e) => e.actorUid },
});

function HistoryTable({ events }) {
  const newestFirst = useMemo(() => [...events].reverse(), [events]);
  const { sort, toggle, sorted } = useTableSort({ rows: newestFirst, columns: HISTORY_COLUMNS });
  const header = (key, label) => <SortableHeader columnKey={key} label={label} sort={sort} onSort={toggle} />;
  return (
    <table className="fo-table" aria-label="Workflow history">
      <thead><tr>{header("when", "When")}{header("change", "Change")}{header("version", "Version")}{header("reason", "Reason")}{header("actor", "Actor")}</tr></thead>
      <tbody>
        {sorted.map((e) => (
          <tr key={e.id} data-history-action={e.action}>
            <td className="fo-muted">{e.occurredAt}</td>
            <td>{titleCase(e.action)}</td>
            <td className="fo-muted">{e.after?.version ? `v${e.after.version}` : "—"}{e.after?.status ? ` · ${statusLabel(e.after.status)}` : ""}</td>
            <td>{e.reason ?? "—"}</td>
            <td className="fo-muted"><code>{e.actorUid}</code></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function WorkflowVersionPanel({ api, workflow, versionId, onVersionCreated, onChanged, onDirtyChange }) {
  const read = useControlPlaneRead(() => api.readWorkflowVersion(versionId), `version:${versionId}`);
  const validation = useControlPlaneRead(() => api.validateWorkflowVersion(versionId), `validate:${versionId}`);
  const instances = useControlPlaneRead(() => api.listWorkflowInstances(versionId), `instances:${versionId}`);
  const history = useControlPlaneRead(() => api.readWorkflowHistory(workflow.id), `history:${workflow.id}`);
  const view = useMemo(() => buildWorkflowVersionView(read.data), [read.data]);
  const summary = useMemo(() => validationSummary(validation.data), [validation.data]);
  const [reason, setReason] = useState("");
  const [outcome, setOutcome] = useState(null);
  const [busy, setBusy] = useState(false);
  const permissions = useMyWorkflowAdministration(api);

  if (!read.data) return <section className="fo-panel"><ReadState read={read} what="this workflow version" /></section>;
  if (!view) return <p className="fo-warning" role="alert">The server returned a workflow version this screen cannot read, so nothing is shown.</p>;

  const version = { ...view.version, active: view.active };
  const reloadAll = () => { read.reload(); validation.reload(); instances.reload(); history.reload(); onChanged?.(); };

  const run = async (action) => {
    setBusy(true);
    setOutcome(null);
    const input = { versionId, reason };
    const result = action === "publish" ? await api.publishWorkflowVersion(input)
      : action === "activate" ? await api.activateWorkflowVersion(input)
        : action === "retire" ? await api.retireWorkflowVersion(input)
          : await api.createWorkflowVersion({ workflowId: workflow.id, copyFromVersionId: versionId, reason });
    setBusy(false);
    if (!result?.ok) { setOutcome({ ok: false, text: refusalText(result) }); return; }
    setOutcome({ ok: true, text: `${ACTION_WORDS[action]}: done.` });
    setReason("");
    if (action === "newVersion" && result.data?.version?.id) onVersionCreated?.(result.data.version.id);
    else reloadAll();
  };

  return (
    <section className="fo-panel" aria-label={`Version ${version.version}`} data-workflow-version={versionId} data-version-status={version.status}>
      <h3>
        {workflow.name} v{version.version} <span className="fo-muted">· {lifecycleLabel(version)}</span>
      </h3>
      <dl className="fo-wf-meta">
        <div><dt>Governs</dt><dd>{workflow.objectKey ? <>{titleCase(workflow.objectKey)} <code>{workflow.objectKey}</code></> : "—"}</dd></div>
        <div><dt>States</dt><dd>{view.steps.length}</dd></div>
        <div><dt>Actions</dt><dd>{view.actions.length}</dd></div>
        <div><dt>Role Bindings</dt><dd>{view.bindingCount}</dd></div>
        {version.publishedAt ? <div><dt>Published</dt><dd>{version.publishedAt}</dd></div> : null}
      </dl>
      {version.status !== "DRAFT" ? (
        <p className="fo-muted">This version is {statusLabel(version.status)} and cannot be edited. Changing the workflow means a new draft.</p>
      ) : null}

      <div className="fo-cp-section" aria-label="Lifecycle">
        <h4>Lifecycle</h4>
        <label className="fo-form-field">
          <span>Reason (Required)</span>
          <input type="text" aria-label="Reason for the workflow change" value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <div className="fo-pill-row">
          {lifecycleActions(version).map((action) => (
            <Button key={action} type="button" variant="secondary" disabled={busy || !permissions.allows(LIFECYCLE_OPERATION[action])}
              title={permissions.reason(LIFECYCLE_OPERATION[action]) ?? undefined} onClick={() => run(action)} data-lifecycle-action={action}>
              {ACTION_WORDS[action]}
            </Button>
          ))}
        </div>
        {[...new Set(lifecycleActions(version).map((action) => permissions.reason(LIFECYCLE_OPERATION[action])).filter(Boolean))].map((why) => (
          <p key={why} className="fo-muted" data-permission-note="lifecycle">{why}</p>
        ))}
        {outcome ? (
          <p className={outcome.ok ? "fo-muted" : "fo-warning"} role={outcome.ok ? "status" : "alert"} data-lifecycle-outcome={outcome.ok ? "ok" : "refused"}>
            {outcome.text}
          </p>
        ) : null}
      </div>

      <ValidationResults read={validation} summary={summary} />

      <div className="fo-cp-section" aria-label="States">
        <h4>States</h4>
        <StatesTable steps={view.steps} />
      </div>

      <div className="fo-cp-section" aria-label="Actions and bindings">
        <h4>Actions, Capabilities and Bindings</h4>
        <p className="fo-muted">
          Each action names the capability it IS. A bound Security Role performs the action only while it
          holds that capability (and passes the guard) — the binding itself grants nothing.
        </p>
        <ActionsTable actions={view.actions} />
      </div>

      {version.status === "DRAFT" ? (
        <WorkflowDraftEditor
          api={api}
          workflow={workflow}
          versionId={versionId}
          view={read.data}
          onSaved={(id) => onVersionCreated?.(id)}
          onDirtyChange={onDirtyChange}
          permissions={permissions}
        />
      ) : null}

      {view.active ? (
        <ActiveVersionRecords api={api} workflow={workflow} versionId={versionId} steps={view.steps} reason={reason} onDone={reloadAll} permissions={permissions} />
      ) : null}

      <div className="fo-cp-section" aria-label="Pinned instances">
        <h4>Records Running on This Version</h4>
        {!instances.data ? <ReadState read={instances} what="the pinned instances" /> : null}
        {Array.isArray(instances.data) && instances.data.length === 0 ? <p className="fo-muted">No record is pinned to this version.</p> : null}
        {Array.isArray(instances.data) && instances.data.length > 0 ? (
          <InstancesTable instances={instances.data} />
        ) : null}
      </div>

      <div className="fo-cp-section" aria-label="Workflow history">
        <h4>History</h4>
        {!history.data ? <ReadState read={history} what="the workflow history" /> : null}
        {Array.isArray(history.data) && history.data.length === 0 ? <p className="fo-muted">No workflow change has been recorded.</p> : null}
        {Array.isArray(history.data) && history.data.length > 0 ? (
          <HistoryTable events={history.data} />
        ) : null}
      </div>
    </section>
  );
}
