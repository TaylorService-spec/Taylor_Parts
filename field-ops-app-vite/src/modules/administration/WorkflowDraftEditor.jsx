// ADMINISTRATION > WORKFLOWS > the DRAFT editor -- states, transitions, capabilities, guards, bindings.
//
// WHOLE-DEFINITION editing, as the server requires: the administrator edits the draft's states and
// actions here, may ask the server to VALIDATE the unsaved definition, and saves it -- which the
// server stores as the NEXT draft version (a draft is never rewritten in place, so the superseded
// one stays readable). Nothing is validated in the browser; the server's findings and refusals are
// shown verbatim. The guard is chosen from the server's closed list, never authored.
import { useEffect, useMemo, useState } from "react";
import { Button } from "../../shared/ui/primitives/index.js";
import { refusalText } from "../../services/adminControlPlaneClient.js";
import {
  WORKFLOW_GUARD_OPTIONS,
  blankAction,
  blankStep,
  definitionForServer,
  editableDefinition,
  validationSummary,
} from "../../domain/adminWorkflowView.js";
import ValidationResults from "./WorkflowValidationResults.jsx";
import { workforceApiClient } from "../../services/workforceApiClient.js";
import { WORKFORCE_READ_STATE, useWorkforceRead } from "../../hooks/useWorkforceRead.js";
import { adminControlPlaneClient } from "../../services/adminControlPlaneClient.js";
import { useControlPlaneRead } from "./useControlPlaneRead.js";
import KeyListPicker from "./KeyListPicker.jsx";

export default function WorkflowDraftEditor({ api, workflow, versionId, view, onSaved, onDirtyChange, workforce = workforceApiClient, rolesApi = adminControlPlaneClient, permissions }) {
  // The Functional Role keys an action may require, from the governed catalog. A convenience list only:
  // the server resolves every key and refuses one it does not have (UNKNOWN_FUNCTIONAL_ROLE).
  const functionalCatalog = useWorkforceRead("listFunctionalRoles", {}, { client: workforce });
  const knownFunctionalRoles = functionalCatalog.status === WORKFORCE_READ_STATE.READY && Array.isArray(functionalCatalog.data?.items)
    ? functionalCatalog.data.items : [];
  // The tenant's Security Roles, for the binding typeahead (the same governed listRoles read Roles & Permissions uses).
  // A workflow API that serves listRoles itself (tests, a combined client) is asked; otherwise the control-plane client.
  const rolesSource = typeof api?.listRoles === "function" ? api : rolesApi;
  const roleCatalog = useControlPlaneRead(() => rolesSource.listRoles(), "workflow-binding-roles");
  const securityRoleOptions = (Array.isArray(roleCatalog.data) ? roleCatalog.data : roleCatalog.data?.items ?? [])
    .filter((r) => r && typeof r.key === "string").map((r) => ({ key: r.key, label: r.name ?? null }));
  const functionalRoleOptions = knownFunctionalRoles.map((r) => ({ key: r.key, label: r.name ?? null, context: r.status === "ACTIVE" ? null : r.status }));
  const [draft, setDraft] = useState(() => editableDefinition(view));
  const [reason, setReason] = useState("");
  // UNSAVED CHANGES (UI corrections item F): the draft differs from what the server returned, or a reason was typed.
  // Reported to the Workflows page so leaving this workflow (switch or deselect) asks first. Presentation only.
  const pristine = useMemo(() => JSON.stringify(editableDefinition(view)), [view]);
  const [savedAs, setSavedAs] = useState(null);
  const dirty = savedAs === null && (JSON.stringify(draft) !== pristine || reason.trim() !== "");
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  const [checked, setChecked] = useState(null);
  const [outcome, setOutcome] = useState(null);
  const [busy, setBusy] = useState(false);

  const setStep = (i, patch) => setDraft((d) => ({ ...d, steps: d.steps.map((s, n) => (n === i ? { ...s, ...patch } : s)) }));
  const setAction = (i, patch) => setDraft((d) => ({ ...d, actions: d.actions.map((a, n) => (n === i ? { ...a, ...patch } : a)) }));
  const removeStep = (i) => setDraft((d) => ({ ...d, steps: d.steps.filter((_, n) => n !== i) }));
  const removeAction = (i) => setDraft((d) => ({ ...d, actions: d.actions.filter((_, n) => n !== i) }));

  const validate = async () => {
    setBusy(true);
    const result = await api.validateUnsavedDefinition({ objectKey: workflow.objectKey, definition: definitionForServer(draft) });
    setBusy(false);
    setChecked(result?.ok ? { status: "ready", data: result.data } : { status: "failed", data: null, error: result });
  };

  const save = async () => {
    setBusy(true);
    setOutcome(null);
    const result = await api.updateWorkflowDefinition({ versionId, definition: definitionForServer(draft), reason });
    setBusy(false);
    if (!result?.ok) { setOutcome({ ok: false, text: refusalText(result) }); return; }
    const notes = [
      result.data?.missingRoleKeys?.length ? `Role keys this tenant does not have (not bound): ${result.data.missingRoleKeys.join(", ")}` : null,
      result.data?.unknownCapabilityKeys?.length ? `Capabilities the catalog does not have (stored as none): ${result.data.unknownCapabilityKeys.join(", ")}` : null,
    ].filter(Boolean);
    setOutcome({ ok: true, text: [`Saved as draft v${result.data?.version?.version}.`, ...notes].join(" ") });
    setSavedAs(result.data?.version?.id ?? "saved");
    if (result.data?.version?.id) onSaved?.(result.data.version.id);
  };

  return (
    <div className="fo-cp-section" aria-label="Draft editor" data-draft-editor={versionId}>
      <h4>Edit This Draft</h4>
      <p className="fo-muted">
        Saving stores the whole definition as the next draft version. Bind Security Roles by typing their name; a
        bound Role still needs the action&rsquo;s capability, or publishing is refused. Functional Roles
        only narrow an action: the Employee must also hold one of them, and they never grant the capability.
      </p>
      <p className="fo-muted" data-known-functional-roles={knownFunctionalRoles.length}>
        {knownFunctionalRoles.length > 0
          ? `Functional Roles: ${knownFunctionalRoles.map((r) => `${r.key}${r.status === "ACTIVE" ? "" : ` (${r.status})`}`).join(", ")}`
          : "No Functional Role is available to require."}
      </p>

      <table className="fo-table" aria-label="Editable states">
        <thead><tr><th>Key</th><th>Label</th><th>Start</th><th>End</th><th /></tr></thead>
        <tbody>
          {draft.steps.map((s, i) => (
            <tr key={i}>
              <td><input aria-label={`State ${i + 1} key`} value={s.key} onChange={(e) => setStep(i, { key: e.target.value })} /></td>
              <td><input aria-label={`State ${i + 1} label`} value={s.label} onChange={(e) => setStep(i, { label: e.target.value })} /></td>
              <td><input type="checkbox" aria-label={`State ${i + 1} is the start`} checked={s.initial} onChange={(e) => setStep(i, { initial: e.target.checked })} /></td>
              <td><input type="checkbox" aria-label={`State ${i + 1} is an end`} checked={s.terminal} onChange={(e) => setStep(i, { terminal: e.target.checked })} /></td>
              <td><Button type="button" variant="secondary" onClick={() => removeStep(i)}>Remove</Button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <Button type="button" variant="secondary" onClick={() => setDraft((d) => ({ ...d, steps: [...d.steps, blankStep()] }))}>Add State</Button>

      <table className="fo-table" aria-label="Editable actions">
        <thead><tr><th>Key</th><th>Label</th><th>From</th><th>To</th><th>Capability</th><th>Guard</th><th>Security Roles</th><th>Functional Roles</th><th /></tr></thead>
        <tbody>
          {draft.actions.map((a, i) => (
            <tr key={i}>
              <td><input aria-label={`Action ${i + 1} key`} value={a.key} onChange={(e) => setAction(i, { key: e.target.value })} /></td>
              <td><input aria-label={`Action ${i + 1} label`} value={a.label} onChange={(e) => setAction(i, { label: e.target.value })} /></td>
              <td><input aria-label={`Action ${i + 1} from`} value={a.from} onChange={(e) => setAction(i, { from: e.target.value })} /></td>
              <td><input aria-label={`Action ${i + 1} to`} value={a.to} onChange={(e) => setAction(i, { to: e.target.value })} /></td>
              <td><input aria-label={`Action ${i + 1} capability`} value={a.capabilityKey} onChange={(e) => setAction(i, { capabilityKey: e.target.value })} /></td>
              <td>
                <select aria-label={`Action ${i + 1} guard`} value={a.guardKind} onChange={(e) => setAction(i, { guardKind: e.target.value })}>
                  {WORKFLOW_GUARD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </td>
              <td><KeyListPicker id={`wf-action-${i}-roles`} label={`Action ${i + 1} Security Roles`} value={a.roleKeys} options={securityRoleOptions} onChange={(v) => setAction(i, { roleKeys: v })} /></td>
              <td><KeyListPicker id={`wf-action-${i}-functional`} label={`Action ${i + 1} Functional Roles`} value={a.functionalRoleKeys ?? ""} options={functionalRoleOptions} onChange={(v) => setAction(i, { functionalRoleKeys: v })} /></td>
              <td><Button type="button" variant="secondary" onClick={() => removeAction(i)}>Remove</Button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <Button type="button" variant="secondary" onClick={() => setDraft((d) => ({ ...d, actions: [...d.actions, blankAction()] }))}>Add Action</Button>

      <div className="fo-pill-row">
        <Button type="button" variant="secondary" disabled={busy} onClick={validate}>Validate (Server)</Button>
      </div>
      {checked ? <ValidationResults read={checked} summary={validationSummary(checked.data)} /> : null}

      <label className="fo-form-field">
        <span>Reason</span>
        <input type="text" aria-label="Reason for saving the draft" value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <Button type="button" variant="primary" disabled={busy || !permissions?.allows("updateWorkflowDefinition")}
        title={permissions?.reason("updateWorkflowDefinition") ?? undefined} onClick={save}>Save as New Draft</Button>
      {permissions?.reason("updateWorkflowDefinition") ? <p className="fo-muted" data-permission-note="draft">{permissions.reason("updateWorkflowDefinition")}</p> : null}
      {outcome ? (
        <p className={outcome.ok ? "fo-muted" : "fo-warning"} role={outcome.ok ? "status" : "alert"} data-draft-outcome={outcome.ok ? "ok" : "refused"}>
          {outcome.text}
        </p>
      ) : null}
    </div>
  );
}
