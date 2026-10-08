import { useCallback, useMemo, useState } from "react";
import ConfirmDialog from "../../shared/ui/ConfirmDialog.jsx";
import WorkspaceShell from "../../shared/ui/WorkspaceShell.jsx";
import { Button } from "../../shared/ui/primitives/index.js";
import { workflowAdminClient } from "../../services/workflowAdminClient.js";
import { groupWorkflowsByArea, lifecycleLabel, summarizeWorkflow } from "../../domain/adminWorkflowView.js";
import { useControlPlaneRead } from "./useControlPlaneRead.js";
import { ReadState } from "./ObjectActionSecurity.jsx";
import WorkflowVersionPanel from "./WorkflowVersionPanel.jsx";
import { readAdminQueryParam } from "../../domain/workflowResponsibilityLinks.js";
import { titleCase } from "../../shared/display/displayLabels.js";

// ADMINISTRATION > WORKFLOWS -- the workflow control plane.
//
// ════════════════════ WHAT A WORKFLOW IS, AND IS NOT ════════════════════
//
// A workflow answers "what business ACTION may I perform" -- Approve, Dispatch, Void. That is a
// different question from "what DATA may I access", which Objects and Roles & Permissions answer.
// And A BINDING NEVER GRANTS: an action is performed only when a Security Role the person holds is
// bound to it AND the runtime evaluator allows the action's capability. The screen says so.
//
// ════════════════════ EVERYTHING HERE IS THE SERVER'S ════════════════════
//
// The list, every version, its steps, actions, bindings and guards, the validation findings, the
// pinned instances and the audit history are read from the EOS API. There is no client copy of any
// definition. Every mutation (edit a draft, publish, activate, retire, new version) is sent with a
// stated reason, is re-checked by the server against its workflowDefinition capability and the
// version lifecycle, and is followed by a re-read. A refusal is shown VERBATIM.
//
// ════════════════════ AREAS ARE PRESENTATION ════════════════════
//
// Three business areas group the state machines for reading (Sales is three machines chained by
// events). An area has no state, transition or binding, and authority is never resolved against one.
//
// ════════════════════ SELECTION IS A VIEW, NOT A CHANGE (UI corrections item F) ════════════════════
//
// Click an unselected workflow: select it. Click the selected one again: DESELECT -- the page returns to a neutral
// empty state. Click another: switch. Selecting or deselecting reads; it never writes a workflow, a version or anything
// in PostgreSQL. When the open draft editor holds unsaved changes, leaving it (switch, deselect or another version)
// asks first, and "Keep Editing" leaves everything as it was.
const DESELECTED = "__deselected__";

export default function AdminWorkflows({ api = workflowAdminClient }) {
  const list = useControlPlaneRead(() => api.listWorkflows(), "workflows");
  const summaries = useMemo(
    () => (Array.isArray(list.data) ? list.data.map(summarizeWorkflow).filter(Boolean) : []),
    [list.data],
  );
  const [selectedId, setSelectedId] = useState(null);
  const [versionId, setVersionId] = useState(null);
  // DEEP LINK (Employee > Workflow responsibilities -> "Change it in"): ?workflow=<key>&version=<id> pre-selects that
  // workflow and version until the administrator chooses another. Selection only; nothing is decided from the URL.
  const [linked] = useState(() => ({ workflow: readAdminQueryParam("workflow"), version: readAdminQueryParam("version") }));
  const linkedWorkflow = selectedId === null && linked.workflow ? summaries.find((w) => w.key === linked.workflow || w.id === linked.workflow) ?? null : null;
  const effectiveSelectedId = selectedId === DESELECTED ? null : selectedId ?? linkedWorkflow?.id ?? null;
  const effectiveVersionId = versionId
    ?? (linkedWorkflow ? (linkedWorkflow.versions.some((v) => v.id === linked.version) ? linked.version
      : linkedWorkflow.activeVersionId ?? linkedWorkflow.versions[linkedWorkflow.versions.length - 1]?.id ?? null) : null);
  const selected = summaries.find((w) => w.id === effectiveSelectedId) ?? null;
  const groups = groupWorkflowsByArea(summaries);

  const [dirty, setDirty] = useState(false);
  const onDirtyChange = useCallback((d) => setDirty(Boolean(d)), []);
  const [pending, setPending] = useState(null); // a selection change waiting on "discard unsaved changes?"

  const apply = (change) => {
    setDirty(false);
    if (change.kind === "deselect") { setSelectedId(DESELECTED); setVersionId(null); return; }
    if (change.kind === "version") { setSelectedId(change.workflowId); setVersionId(change.versionId); return; }
    setSelectedId(change.workflow.id);
    setVersionId(change.workflow.activeVersionId ?? change.workflow.versions[change.workflow.versions.length - 1]?.id ?? null);
  };
  const request = (change) => (dirty ? setPending(change) : apply(change));
  // The toggle: the selected workflow deselects; any other one selects (or switches).
  const choose = (workflow) => request(workflow.id === effectiveSelectedId ? { kind: "deselect" } : { kind: "select", workflow });

  return (
    <WorkspaceShell title="Workflows" subtitle="Business processes, their versions, and who may act in them">
      <section className="fo-panel" aria-label="What a workflow governs">
        <p className="fo-muted">
          A workflow governs <strong>business actions</strong> — Approve, Dispatch, Void — not data
          access. A Security Role bound to an action may perform it <strong>only if</strong> the Role
          also holds the action&rsquo;s capability: a binding never grants. Publishing is refused while
          any bound Role lacks the capability.
        </p>
        <p className="fo-muted">
          Lifecycle: <strong>Draft</strong> → <strong>Published</strong> (the active version is where new
          records start) → <strong>Retired</strong>. A published version never changes; records already
          running stay on the version they started on.
        </p>
      </section>

      <section className="fo-panel" aria-label="Workflow list">
        <h3>Workflows</h3>
        <ReadState read={list} what="the workflow list" />
        {list.status === "ready" && summaries.length === 0 ? (
          <p className="fo-muted">This tenant has no workflows.</p>
        ) : null}
        {groups.map((group) => (
          <div key={group.key} className="fo-wf-area" data-workflow-area={group.key}>
            <h4>{group.name}</h4>
            <p className="fo-muted">{group.description}</p>
            <table className="fo-table" aria-label={`${group.name} workflows`}>
              <thead><tr><th>Workflow</th><th>Governs</th><th>Active Version</th><th>Versions</th></tr></thead>
              <tbody>
                {group.workflows.map((w) => (
                  <tr key={w.id} data-workflow={w.key} aria-selected={w.id === effectiveSelectedId}>
                    <td>
                      <Button type="button" variant={w.id === effectiveSelectedId ? "primary" : "secondary"} onClick={() => choose(w)}
                        aria-pressed={w.id === effectiveSelectedId}
                        title={w.id === effectiveSelectedId ? `Deselect ${w.name}` : `Select ${w.name}`}>
                        {w.name}
                      </Button>
                    </td>
                    <td className="fo-muted">{w.objectKey ? titleCase(w.objectKey) : "—"}</td>
                    <td>{w.activeVersion === null ? <span className="fo-muted">None</span> : `v${w.activeVersion}`}</td>
                    <td className="fo-muted">
                      {w.counts.draft} draft · {w.counts.published} published · {w.counts.retired} retired
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </section>

      {!selected && list.status === "ready" && summaries.length > 0 ? (
        <section className="fo-panel" aria-label="No workflow selected" data-workflow-selection="NONE">
          <p className="fo-muted">No workflow selected. Choose a workflow above to see its versions, steps, actions and bindings.</p>
        </section>
      ) : null}

      {selected ? (
        <section className="fo-panel" aria-label="Versions" data-selected-workflow={selected.key}>
          <h3>{selected.name} <span className="fo-muted">· Versions</span></h3>
          {selected.description ? <p className="fo-muted">{selected.description}</p> : null}
          <div className="fo-pill-row">
            {selected.versions.map((v) => (
              <Button
                key={v.id}
                type="button"
                variant={v.id === effectiveVersionId ? "primary" : "secondary"}
                onClick={() => { if (v.id !== effectiveVersionId) request({ kind: "version", workflowId: selected.id, versionId: v.id }); }}
                aria-pressed={v.id === effectiveVersionId}
                data-version-status={v.status}
              >
                v{v.version} · {lifecycleLabel(v)}
              </Button>
            ))}
          </div>
        </section>
      ) : null}

      {selected && effectiveVersionId ? (
        <WorkflowVersionPanel
          key={effectiveVersionId}
          api={api}
          workflow={selected}
          versionId={effectiveVersionId}
          onVersionCreated={(id) => { list.reload(); setDirty(false); setSelectedId(selected.id); setVersionId(id); }}
          onChanged={() => list.reload()}
          onDirtyChange={onDirtyChange}
        />
      ) : null}

      {pending ? (
        <ConfirmDialog
          title="Discard Unsaved Changes?"
          consequence="The draft you are editing has changes that are not saved. Leaving it discards them; nothing is written."
          confirmLabel="Discard Changes"
          cancelLabel="Keep Editing"
          destructive={false}
          onConfirm={async () => { const change = pending; setPending(null); apply(change); }}
          onClose={() => setPending(null)}
        />
      ) : null}
    </WorkspaceShell>
  );
}
