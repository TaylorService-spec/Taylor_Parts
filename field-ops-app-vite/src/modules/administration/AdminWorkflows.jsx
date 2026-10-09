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
import { sortRows, useTableSort } from "../../shared/ui/sorting/useTableSort.js";
import SortableHeader from "../../shared/ui/sorting/SortableHeader.jsx";

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

const WORKFLOW_COLUMNS = Object.freeze({
  name: { value: (w) => w.name },
  governs: { value: (w) => (w.objectKey ? titleCase(w.objectKey) : null) },
  active: { value: (w) => (typeof w.activeVersion === "number" ? w.activeVersion : null) },
  versions: { value: (w) => (w.counts?.draft ?? 0) + (w.counts?.published ?? 0) + (w.counts?.retired ?? 0) },
});

/**
 * ADMIN-UI-008: ONE table with ONE header row; each business area is a group of rows under its own group heading, so
 * the grouping keeps its meaning without repeating the column headers. Sorting reorders rows WITHIN each area; selection
 * is unchanged by it. A workflow is chosen by its name in the row (a selectable row, not an outlined button).
 */
function WorkflowTable({ groups, selectedId, onChoose }) {
  const { sort, toggle } = useTableSort();
  const header = (key, label) => <SortableHeader columnKey={key} label={label} sort={sort} onSort={toggle} />;
  return (
    <div className="fo-table-scroll">
      <table className="fo-table fo-admin-grouptable" aria-label="Workflows">
        <thead><tr>{header("name", "Workflow")}{header("governs", "Governs")}{header("active", "Active Version")}{header("versions", "Versions & Status")}</tr></thead>
        {groups.map((group) => (
          <tbody key={group.key} data-workflow-area={group.key}>
            <tr className="fo-admin-grouprow">
              <th scope="rowgroup" colSpan={4}>
                <span className="fo-admin-grouprow__name">{group.name}</span>
                {group.description ? <span className="fo-admin-grouprow__note">{group.description}</span> : null}
              </th>
            </tr>
            {sortRows(group.workflows, sort, WORKFLOW_COLUMNS).map((w) => (
              <tr key={w.id} data-workflow={w.key} aria-selected={w.id === selectedId} className={w.id === selectedId ? "fo-admin-row--selected" : undefined}>
                <td>
                  <button type="button" className="fo-admin-rowselect" onClick={() => onChoose(w)} aria-pressed={w.id === selectedId}
                    title={w.id === selectedId ? `Deselect ${w.name}` : `Select ${w.name}`}>
                    {w.name}
                  </button>
                </td>
                <td className="fo-muted">{w.objectKey ? titleCase(w.objectKey) : "—"}</td>
                <td>{w.activeVersion === null ? <span className="fo-muted">None</span> : `v${w.activeVersion}`}</td>
                <td className="fo-muted">
                  {w.counts.draft} Draft · {w.counts.published} Published · {w.counts.retired} Retired
                </td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

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
      {/* ADMIN-UI-008: one heading (the shell's), one concise line, and the workflow policy as contextual help. */}
      <section className="fo-panel" aria-label="Workflow list">
        <p className="fo-muted">Choose a workflow to see its versions, steps, actions and who may perform them.</p>
        <details className="fo-admin-help" aria-label="What a workflow governs">
          <summary>How workflows, bindings and versions work</summary>
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
        </details>
        <ReadState read={list} what="the workflow list" />
        {list.status === "ready" && summaries.length === 0 ? (
          <p className="fo-muted">This tenant has no workflows.</p>
        ) : null}
        {groups.length > 0 ? <WorkflowTable groups={groups} selectedId={effectiveSelectedId} onChoose={choose} /> : null}
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
