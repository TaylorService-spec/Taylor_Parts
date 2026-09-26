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
import ValidationResults from "./WorkflowValidationResults.jsx";

const ACTION_WORDS = Object.freeze({
  publish: "Publish (becomes ACTIVE)",
  activate: "Make ACTIVE",
  retire: "Retire",
  newVersion: "New draft from this version",
});

export default function WorkflowVersionPanel({ api, workflow, versionId, onVersionCreated, onChanged }) {
  const read = useControlPlaneRead(() => api.readWorkflowVersion(versionId), `version:${versionId}`);
  const validation = useControlPlaneRead(() => api.validateWorkflowVersion(versionId), `validate:${versionId}`);
  const instances = useControlPlaneRead(() => api.listWorkflowInstances(versionId), `instances:${versionId}`);
  const history = useControlPlaneRead(() => api.readWorkflowHistory(workflow.id), `history:${workflow.id}`);
  const view = useMemo(() => buildWorkflowVersionView(read.data), [read.data]);
  const summary = useMemo(() => validationSummary(validation.data), [validation.data]);
  const [reason, setReason] = useState("");
  const [outcome, setOutcome] = useState(null);
  const [busy, setBusy] = useState(false);

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
        <div><dt>Governs</dt><dd><code>{workflow.objectKey ?? "—"}</code></dd></div>
        <div><dt>States</dt><dd>{view.steps.length}</dd></div>
        <div><dt>Actions</dt><dd>{view.actions.length}</dd></div>
        <div><dt>Role bindings</dt><dd>{view.bindingCount}</dd></div>
        {version.publishedAt ? <div><dt>Published</dt><dd>{version.publishedAt}</dd></div> : null}
      </dl>
      {version.status !== "DRAFT" ? (
        <p className="fo-muted">This version is {version.status} and cannot be edited. Changing the workflow means a new draft.</p>
      ) : null}

      <div className="fo-cp-section" aria-label="Lifecycle">
        <h4>Lifecycle</h4>
        <label className="fo-form-field">
          <span>Reason (required)</span>
          <input type="text" aria-label="Reason for the workflow change" value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <div className="fo-pill-row">
          {lifecycleActions(version).map((action) => (
            <Button key={action} type="button" variant="secondary" disabled={busy} onClick={() => run(action)} data-lifecycle-action={action}>
              {ACTION_WORDS[action]}
            </Button>
          ))}
        </div>
        {outcome ? (
          <p className={outcome.ok ? "fo-muted" : "fo-warning"} role={outcome.ok ? "status" : "alert"} data-lifecycle-outcome={outcome.ok ? "ok" : "refused"}>
            {outcome.text}
          </p>
        ) : null}
      </div>

      <ValidationResults read={validation} summary={summary} />

      <div className="fo-cp-section" aria-label="States">
        <h4>States</h4>
        <table className="fo-table" aria-label="States">
          <thead><tr><th>State</th><th>Kind</th><th>Actions from here</th></tr></thead>
          <tbody>
            {view.steps.map((s) => (
              <tr key={s.key}>
                <td>{s.label} <span className="fo-muted">· {s.key}</span></td>
                <td className="fo-muted">{s.initial ? "Start" : s.terminal ? "End" : "In progress"}</td>
                <td className="fo-muted">{s.outgoing.length ? s.outgoing.join(", ") : (s.terminal ? "None — terminal" : "None")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="fo-cp-section" aria-label="Actions and bindings">
        <h4>Actions, capabilities and bindings</h4>
        <p className="fo-muted">
          Each action names the capability it IS. A bound Security Role performs the action only while it
          holds that capability (and passes the guard) — the binding itself grants nothing.
        </p>
        <table className="fo-table" aria-label="Actions">
          <thead><tr><th>Action</th><th>From → To</th><th>Capability</th><th>Guard</th><th>Bound Security Roles</th></tr></thead>
          <tbody>
            {view.actions.map((a) => (
              <tr key={a.key} data-workflow-action={a.key}>
                <td>{a.label} <span className="fo-muted">· {a.key}</span></td>
                <td className="fo-muted">{a.from} → {a.to}</td>
                <td>{a.capabilityKey ? <code>{a.capabilityKey}</code> : <span className="fo-warning">none</span>}</td>
                <td className="fo-muted">{a.guardKind ?? "—"}</td>
                <td className="fo-muted">
                  {a.bindings.length === 0 ? "no Role bound" : a.bindings.map((b) => (
                    b.bindingKind === "SECURITY_ROLE" ? b.roleKey : `${b.roleKey} (${b.bindingKind})`
                  )).join(", ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {version.status === "DRAFT" ? (
        <WorkflowDraftEditor
          api={api}
          workflow={workflow}
          versionId={versionId}
          view={read.data}
          onSaved={(id) => onVersionCreated?.(id)}
        />
      ) : null}

      <div className="fo-cp-section" aria-label="Pinned instances">
        <h4>Records running on this version</h4>
        {!instances.data ? <ReadState read={instances} what="the pinned instances" /> : null}
        {Array.isArray(instances.data) && instances.data.length === 0 ? <p className="fo-muted">No record is pinned to this version.</p> : null}
        {Array.isArray(instances.data) && instances.data.length > 0 ? (
          <table className="fo-table" aria-label="Pinned instances">
            <thead><tr><th>Record</th><th>Current step</th><th>Since</th></tr></thead>
            <tbody>
              {instances.data.map((i) => (
                <tr key={i.id}><td><code>{i.recordId}</code></td><td>{i.currentStepKey}</td><td className="fo-muted">{i.updatedAt ?? "—"}</td></tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>

      <div className="fo-cp-section" aria-label="Workflow history">
        <h4>History</h4>
        {!history.data ? <ReadState read={history} what="the workflow history" /> : null}
        {Array.isArray(history.data) && history.data.length === 0 ? <p className="fo-muted">No workflow change has been recorded.</p> : null}
        {Array.isArray(history.data) && history.data.length > 0 ? (
          <table className="fo-table" aria-label="Workflow history">
            <thead><tr><th>When</th><th>Change</th><th>Version</th><th>Reason</th><th>Actor</th></tr></thead>
            <tbody>
              {[...history.data].reverse().map((e) => (
                <tr key={e.id} data-history-action={e.action}>
                  <td className="fo-muted">{e.occurredAt}</td>
                  <td>{e.action}</td>
                  <td className="fo-muted">{e.after?.version ? `v${e.after.version}` : "—"}{e.after?.status ? ` · ${e.after.status}` : ""}</td>
                  <td>{e.reason ?? "—"}</td>
                  <td className="fo-muted"><code>{e.actorUid}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </section>
  );
}
