import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import WorkspaceShell from "../../shared/ui/WorkspaceShell.jsx";
import ConfirmDialog from "../../shared/ui/ConfirmDialog.jsx";
import { Button } from "../../shared/ui/primitives/index.js";
import { refusalText } from "../../services/adminControlPlaneClient.js";
import { summarizeWorkflow, buildWorkflowVersionView, editableDefinition, definitionForServer } from "../../domain/adminWorkflowView.js";
import { readAdminQueryParam } from "../../domain/workflowResponsibilityLinks.js";
import { appHref, rememberSelectedWorkflow, workflowBuilderHref } from "../../domain/workflowPageLinks.js";
import { identifierLabel, titleCase } from "../../shared/display/displayLabels.js";
import { useControlPlaneRead } from "./useControlPlaneRead.js";
import { ReadState } from "./ObjectActionSecurity.jsx";
import KeyListPicker from "./KeyListPicker.jsx";
import { useMyWorkflowAdministration } from "./useMyWorkflowAdministration.js";

function assignmentDefinition(view) {
  return editableDefinition({ ...view, actions: view.actions.map((action) => ({
    ...action, guardKind: action.guardKind ?? (action.requiresOwnAssignment ? "RECORD_ASSIGNMENT" : null),
  })) });
}

// W01 holder lookup: the Employees holding ONE Role relevant to ONE action -- the server applies the assigner gate and the
// EXISTING Employee visibility; anyone it does not name is only counted. Nothing here decides who is shown.
const NOT_APPLICABLE_WORDS = Object.freeze({
  SCOPE_DOES_NOT_DECIDE: "This action doesn't apply at this assignment scope",
  CONDITIONED_GRANT: "This role's permission is conditional, so the action isn't assured",
  ROLE_NOT_ELIGIBLE: "This role doesn't hold the action's permission",
});
function CoveredEmployees({ api, versionId, actionKey, roleKey }) {
  const read = useControlPlaneRead(() => api.listWorkflowActionRoleHolders({ versionId, actionKey, roleKey }), `workflow-holders:${versionId}:${actionKey}:${roleKey}`);
  const r = read.data;
  return <div data-role-holders={`${actionKey}:${roleKey}`}>
    <ReadState read={read} what="employees holding this role" />
    {r && Array.isArray(r.holders) && <>
      {/* Decision #221: the server counts only the people this caller may view as Employees; nothing here is inferred. */}
      <p className="fo-muted" data-holder-counts>
        {r.employeeVisibility === "NONE"
          ? "You can't view employees, so the holders of this role aren't shown."
          : `${r.totalHolders} ${r.totalHolders === 1 ? "person you can view holds" : "people you can view hold"} this role; this action applies to ${r.holdersForAction}.`}
      </p>
      {r.employeeVisibility === "NONE" ? null : r.holders.length === 0 ? <p>No employee you can view holds this role.</p> : <ul>{r.holders.map((h) => <li key={h.employeeId}>
        <a href={appHref(`/administration/users/${encodeURIComponent(h.employeeId)}`)}>{h.displayName ?? h.employeeId}</a>
        {" · "}{h.scope?.type === "global" ? "All (Global)" : `${titleCase(h.scope?.type ?? "")}${h.scope?.value ? `: ${h.scope.value}` : ""}`}
        {h.appliesToAction ? null : <span className="fo-muted" data-not-applicable={h.notApplicableReason ?? "UNKNOWN"}> · {NOT_APPLICABLE_WORDS[h.notApplicableReason] ?? "This action doesn't apply to them"}</span>}
      </li>)}</ul>}
      {r.truncated && <p className="fo-muted" data-holders-truncated>Showing the first {r.holders.length} employees.</p>}
      <p className="fo-muted">Actual actions still depend on each employee's permissions, record scope and workflow requirements.</p>
    </>}
  </div>;
}

function AssignmentEditor({ api, workflow, versionId, onDirtyChange, onSaved }) {
  const read = useControlPlaneRead(() => api.readWorkflowVersion(versionId), `assignment-version:${versionId}`);
  const readable = buildWorkflowVersionView(read.data) && read.data?.version;
  return <section className="fo-panel" aria-label="Workflow assignments" data-selected-workflow={workflow.key}>
    <ReadState read={read} what="workflow assignments" />
    {read.status === "ready" && !readable && <p role="alert">This workflow version could not be read. No assignment controls are available.</p>}
    {read.status === "ready" && readable && <AssignmentForm key={versionId} api={api} workflow={workflow}
      view={read.data} versionId={versionId} onDirtyChange={onDirtyChange} onSaved={onSaved} />}
  </section>;
}

function AssignmentForm({ api, workflow, view, versionId, onDirtyChange, onSaved }) {
  // D3: the Roles an action may be assigned to come from the workflow read itself -- the Roles that HOLD the
  // action's capability, decided by the same authority validation uses. No Security Policy read is needed.
  const roleNames = view.roleNames && typeof view.roleNames === "object" ? view.roleNames : null;
  const eligibleByAction = new Map((view.actions ?? []).map((a) => [a.key, Array.isArray(a.eligibleRoles) ? a.eligibleRoles : null]));
  const roleLabel = (key) => identifierLabel(key, roleNames?.[key]);
  // D2: the save calls updateWorkflowDefinition on a draft, createWorkflowVersion otherwise -- offered only when the
  // server says this caller may (fail closed while unknown). The server re-checks either way.
  const permissions = useMyWorkflowAdministration(api);
  const saveOperation = view.version?.status === "DRAFT" ? "updateWorkflowDefinition" : "createWorkflowVersion";
  const mayAssign = permissions.allows(saveOperation);
  const [draft, setDraft] = useState(() => assignmentDefinition(view));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [covered, setCovered] = useState(null); // { actionKey, roleKey }
  const mayViewHolders = permissions.allows("updateWorkflowDefinition") || permissions.allows("createWorkflowVersion");
  const [search, setSearch] = useState("");
  const assignmentsChanged = JSON.stringify(draft) !== JSON.stringify(assignmentDefinition(view));
  const dirty = !result?.saved && (assignmentsChanged || reason.trim() !== "");
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  const eligibilityKnown = roleNames !== null && draft.actions.every((a) => eligibleByAction.get(a.key) !== null && eligibleByAction.has(a.key));
  const ready = draft.actions.length > 0 && draft.actions.every((a) => Boolean(a.capabilityKey)) && eligibilityKnown;
  const conflictsOf = (a) => a.roleKeys.split(",").map((k) => k.trim()).filter(Boolean)
    .filter((k) => !(eligibleByAction.get(a.key) ?? []).some((r) => r.key === k));
  // Read-only whenever EITHER the workflow is not set up for assignment OR the server does not allow this caller's save;
  // every reason that applies is said together (never only the first one).
  const readOnly = !(ready && mayAssign);
  const editable = !readOnly && !busy && !result?.saved;
  const missingPermission = draft.actions.filter((a) => !a.capabilityKey).length;
  const setupReason = draft.actions.length === 0 ? "it has no actions to assign."
    : missingPermission > 0 ? `${missingPermission} of ${draft.actions.length} ${draft.actions.length === 1 ? "action has" : "actions have"} no required permission configured.`
    : "the roles eligible for each action could not be determined.";
  const holderLabels = ["updateWorkflowDefinition", "createWorkflowVersion"].map(permissions.requiredLabel).filter(Boolean);
  const builderHref = workflowBuilderHref(workflow, versionId);
  const save = async () => {
    setBusy(true); setResult(null);
    try {
      const definition = definitionForServer(draft);
      const checked = await api.validateUnsavedDefinition({ objectKey: workflow.objectKey, definition });
      if (!checked?.ok) { setResult({ error: refusalText(checked) }); return; }
      if (checked.data?.valid !== true || checked.data?.errors?.length > 0) {
        // Say WHY, in the server's words (e.g. a Role bound to an action whose capability it does not hold).
        const reasons = (checked.data?.errors ?? []).map((e) => e?.message).filter(Boolean);
        setResult({ error: reasons.length
          ? `These assignments cannot be saved: ${reasons.join(" ")}`
          : "These assignments cannot be saved yet. Review the workflow requirements in the Builder." }); return;
      }
      // Published definitions remain immutable. Assignment-only changes create a new draft
      // through the existing governed command; no publishing, grant or activation is implied.
      const saved = view.version?.status === "DRAFT"
        ? await api.updateWorkflowDefinition({ versionId, definition, reason })
        : await api.createWorkflowVersion({ workflowId: workflow.id, definition, reason });
      if (!saved?.ok) { setResult({ error: refusalText(saved) }); return; }
      const id = saved.data?.version?.id;
      setReason(""); setResult({ saved: id }); onDirtyChange(false);
      onSaved();
    } catch {
      setResult({ error: "The assignment request could not be completed. Check the saved version before retrying." });
    } finally { setBusy(false); }
  };
  return <>
    <h2>{workflow.name}</h2>
    <p>{view.active ? "Active assignments" : view.version?.status === "DRAFT" ? "Draft assignments — not active" : "Previous assignments"} · Version {view.version?.version}</p>
    <p className="fo-muted">Assign Security Roles to workflow actions. Employees participate through their roles; an assignment never grants additional permissions.</p>
    {!ready && <p role="status" data-setup-note>This workflow is not ready for assignment changes: {setupReason}{" "}
      {mayAssign
        ? <>Each action needs its required permission before roles can be assigned. <a href={builderHref}>Open Workflow Builder</a> to set it up.</>
        : permissions.status === "ready" ? "Workflow Builder is read-only for you, so this setup can't be completed there either." : null}</p>}
    {!mayAssign && <p role="status" data-permission-note="assignments">{permissions.reason(saveOperation)} Assignments are shown read-only.</p>}
    {ready && mayAssign && <>
      <label className="fo-form-field"><span>Reason for assignment changes</span><input aria-label="Reason for assignment changes" value={reason}
        disabled={busy || Boolean(result?.saved)} onChange={(e) => setReason(e.target.value)} /></label>
      <Button disabled={busy || !assignmentsChanged || !reason.trim() || Boolean(result?.saved)} onClick={save}>Save Assignment Draft</Button>
      <p className="fo-muted">Changes stay inactive until the new version is reviewed and published in Workflow Builder. Existing records keep their current version.</p>
    </>}
    <label className="fo-form-field"><span>Find an action</span><input type="search" aria-label="Find a workflow action" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
    <div className="fo-table-scroll"><table className="fo-table" aria-label="Action role assignments">
      <thead><tr><th>Action</th><th>Step</th><th>Assigned Security Roles</th><th>Employees</th></tr></thead>
      <tbody>{draft.actions.map((a, i) => ({ a, i })).filter(({ a }) => `${a.label} ${a.key} ${a.from} ${a.to}`.toLowerCase().includes(search.toLowerCase())).map(({ a, i }) => <tr key={a.key}>
        <td>{a.label || titleCase(a.key)}</td>
        <td>{view.steps.find((s) => s.key === a.from)?.label ?? titleCase(a.from)} → {view.steps.find((s) => s.key === a.to)?.label ?? titleCase(a.to)}</td>
        <td><KeyListPicker id={`wf-assignment-${i}`} label={`${a.label || a.key} Security Roles`} value={a.roleKeys}
          options={(eligibleByAction.get(a.key) ?? []).map((r) => ({ key: r.key, label: r.name }))}
          labels={roleNames} unlistedNote={ready ? "not eligible" : null}
          readOnly={readOnly} disabled={!editable}
          onChange={(roleKeys) => setDraft((d) => ({ ...d, actions: d.actions.map((item, n) => n === i ? { ...item, roleKeys } : item) }))} />
          {ready && conflictsOf(a).length > 0 && <p className="fo-warning" data-binding-conflict={a.key}>
            {conflictsOf(a).map(roleLabel).join(", ")} {conflictsOf(a).length === 1 ? "does" : "do"} not hold this action's permission ({a.capabilityKey}). Saving will be refused until {conflictsOf(a).length === 1 ? "it is" : "they are"} removed; nothing is removed automatically.
          </p>}
          {a.functionalRoleKeys && <p className="fo-muted">Also requires: {a.functionalRoleKeys.split(",").map((k) => identifierLabel(k.trim())).join(", ")}</p>}
        </td>
        <td>{mayViewHolders ? a.roleKeys.split(",").map((k) => k.trim()).filter(Boolean).map((key) => <Button key={key} size="sm" variant="secondary"
          onClick={() => setCovered(covered?.actionKey === a.key && covered?.roleKey === key ? null : { actionKey: a.key, roleKey: key })}>View {roleLabel(key)} employees</Button>)
          : <span className="fo-muted" data-permission-note="holders">{permissions.status === "ready"
            ? `Viewing role holders requires permission to change assignments${holderLabels.length ? `: the ${holderLabels.map((l) => `“${l}”`).join(" or ")} permission` : ""}.`
            : permissions.reason("createWorkflowVersion")}</span>}</td>
      </tr>)}</tbody>
    </table></div>
    {covered && <section aria-label="Covered employees"><h3>{roleLabel(covered.roleKey)} employees · {draft.actions.find((x) => x.key === covered.actionKey)?.label ?? covered.actionKey}</h3>
      <CoveredEmployees api={api} versionId={versionId} actionKey={covered.actionKey} roleKey={covered.roleKey} /></section>}
    {result?.error && <p role="alert" className="fo-warning">{result.error}</p>}
    {result?.saved && <p role="status">Assignment draft saved. <a href={workflowBuilderHref(workflow, result.saved)}>Review and activate in Workflow Builder</a>.</p>}
    <p><a href={builderHref}>{mayAssign ? "Open Workflow Builder" : "View in Workflow Builder (read-only for you)"}</a></p>
  </>;
}

export default function WorkflowAssignments({ api }) {
  const list = useControlPlaneRead(() => api.listWorkflows(), "assignment-workflows");
  const workflows = useMemo(() => (Array.isArray(list.data) ? list.data.map(summarizeWorkflow).filter(Boolean) : []), [list.data]);
  const [selected, setSelected] = useState(() => readAdminQueryParam("workflow") ?? "");
  const workflow = workflows.find((w) => w.id === selected || w.key === selected);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const onDirtyChange = useCallback((value) => setDirty(value), []);
  const [pending, setPending] = useState(null);
  const [revision, setRevision] = useState(0);
  const [pinnedVersion, setPinnedVersion] = useState(null);
  useEffect(() => {
    if (!dirty) return undefined;
    const beforeUnload = (event) => { if (dirtyRef.current) { event.preventDefault(); event.returnValue = ""; } };
    const navigation = (event) => {
      const link = event.target.closest?.("a[href]");
      if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target === "_blank" || link.hasAttribute("download")) return;
      event.preventDefault(); event.stopPropagation();
      setPending({ href: link.getAttribute("href") });
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", navigation, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", navigation, true);
    };
  }, [dirty]);
  const choose = (id) => { setSelected(id); setPinnedVersion(null); rememberSelectedWorkflow(workflows.find((w) => w.id === id) ?? null); };
  const linkedVersion = readAdminQueryParam("version");
  const versionId = (pinnedVersion && pinnedVersion.workflowId === workflow?.id ? pinnedVersion.versionId : null)
    ?? workflow?.versions.find((v) => v.id === linkedVersion)?.id
    ?? workflow?.activeVersionId ?? workflow?.versions.at(-1)?.id;
  return <div><WorkspaceShell title="Workflow Assignments" actions={<a href={workflowBuilderHref(workflow, versionId)}>Open Workflow Builder</a>}>
    <p>Choose a workflow to review its role assignments and the employees holding those roles.</p>
    <ReadState read={list} what="workflows" />
    {list.status === "ready" && <label className="fo-form-field"><span>Workflow</span><select aria-label="Workflow" value={workflow?.id ?? ""}
      onChange={(e) => dirty ? setPending({ selected: e.target.value }) : choose(e.target.value)}>
      <option value="">Choose a workflow…</option>{workflows.map((w) => <option key={w.id} value={w.id}>{w.name} · {w.activeVersionId ? "Published" : "Not published"}</option>)}
    </select></label>}
    {list.status === "ready" && workflows.length === 0 && <p>No workflows are available.</p>}
    {!workflow && workflows.length > 0 && <p>No workflow selected.</p>}
    {workflow && versionId && <AssignmentEditor key={`${workflow.id}:${versionId}:${revision}`} api={api}
      workflow={workflow} versionId={versionId} onDirtyChange={onDirtyChange} onSaved={() => {
        setPinnedVersion({ workflowId: workflow.id, versionId }); list.reload();
      }} />}
    {workflow && !versionId && <p>This workflow has no version. Prepare it in Workflow Builder.</p>}
    {pending !== null && <ConfirmDialog title="Discard Unsaved Assignments?" consequence="Your unsaved assignment changes will be discarded."
      confirmLabel="Discard Changes" cancelLabel="Keep Editing" destructive={false}
      onConfirm={async () => { const change = pending; dirtyRef.current = false; setPending(null); setDirty(false); if (change.href) window.location.assign(change.href);
        else { choose(change.selected); setRevision((n) => n + 1); } }} onClose={() => setPending(null)} />}
  </WorkspaceShell></div>;
}
