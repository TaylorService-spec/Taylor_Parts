import { useMemo, useState } from "react";
import WorkspaceShell from "../../shared/ui/WorkspaceShell.jsx";
import { Button } from "../../shared/ui/primitives/index.js";
import { workflowAdminClient } from "../../services/workflowAdminClient.js";
import { groupWorkflowsByArea, lifecycleLabel, summarizeWorkflow } from "../../domain/adminWorkflowView.js";
import { useControlPlaneRead } from "./useControlPlaneRead.js";
import { ReadState } from "./ObjectActionSecurity.jsx";
import WorkflowVersionPanel from "./WorkflowVersionPanel.jsx";

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

export default function AdminWorkflows({ api = workflowAdminClient }) {
  const list = useControlPlaneRead(() => api.listWorkflows(), "workflows");
  const summaries = useMemo(
    () => (Array.isArray(list.data) ? list.data.map(summarizeWorkflow).filter(Boolean) : []),
    [list.data],
  );
  const [selectedId, setSelectedId] = useState(null);
  const [versionId, setVersionId] = useState(null);
  const selected = summaries.find((w) => w.id === selectedId) ?? null;
  const groups = groupWorkflowsByArea(summaries);

  const choose = (workflow) => {
    setSelectedId(workflow.id);
    setVersionId(workflow.activeVersionId ?? workflow.versions[workflow.versions.length - 1]?.id ?? null);
  };

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
              <thead><tr><th>Workflow</th><th>Governs</th><th>Active version</th><th>Versions</th></tr></thead>
              <tbody>
                {group.workflows.map((w) => (
                  <tr key={w.id} data-workflow={w.key} aria-selected={w.id === selectedId}>
                    <td>
                      <Button type="button" variant={w.id === selectedId ? "primary" : "secondary"} onClick={() => choose(w)}>
                        {w.name}
                      </Button>
                    </td>
                    <td className="fo-muted"><code>{w.objectKey ?? "—"}</code></td>
                    <td>{w.activeVersion === null ? <span className="fo-muted">none</span> : `v${w.activeVersion}`}</td>
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

      {selected ? (
        <section className="fo-panel" aria-label="Versions" data-selected-workflow={selected.key}>
          <h3>{selected.name} <span className="fo-muted">· versions</span></h3>
          {selected.description ? <p className="fo-muted">{selected.description}</p> : null}
          <div className="fo-pill-row">
            {selected.versions.map((v) => (
              <Button
                key={v.id}
                type="button"
                variant={v.id === versionId ? "primary" : "secondary"}
                onClick={() => setVersionId(v.id)}
                aria-pressed={v.id === versionId}
                data-version-status={v.status}
              >
                v{v.version} · {lifecycleLabel(v)}
              </Button>
            ))}
          </div>
        </section>
      ) : null}

      {selected && versionId ? (
        <WorkflowVersionPanel
          key={versionId}
          api={api}
          workflow={selected}
          versionId={versionId}
          onVersionCreated={(id) => { list.reload(); setVersionId(id); }}
          onChanged={() => list.reload()}
        />
      ) : null}
    </WorkspaceShell>
  );
}
