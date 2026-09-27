// ADMINISTRATION > WORKFLOWS > the DRAFT editor -- states, transitions, capabilities, guards, bindings.
//
// WHOLE-DEFINITION editing, as the server requires: the administrator edits the draft's states and
// actions here, may ask the server to VALIDATE the unsaved definition, and saves it -- which the
// server stores as the NEXT draft version (a draft is never rewritten in place, so the superseded
// one stays readable). Nothing is validated in the browser; the server's findings and refusals are
// shown verbatim. The guard is chosen from the server's closed list, never authored.
import { useState } from "react";
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

export default function WorkflowDraftEditor({ api, workflow, versionId, view, onSaved }) {
  const [draft, setDraft] = useState(() => editableDefinition(view));
  const [reason, setReason] = useState("");
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
    if (result.data?.version?.id) onSaved?.(result.data.version.id);
  };

  return (
    <div className="fo-cp-section" aria-label="Draft editor" data-draft-editor={versionId}>
      <h4>Edit this draft</h4>
      <p className="fo-muted">
        Saving stores the whole definition as the next draft version. Bind Security Roles by key; a
        bound Role still needs the action&rsquo;s capability, or publishing is refused.
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
      <Button type="button" variant="secondary" onClick={() => setDraft((d) => ({ ...d, steps: [...d.steps, blankStep()] }))}>Add state</Button>

      <table className="fo-table" aria-label="Editable actions">
        <thead><tr><th>Key</th><th>Label</th><th>From</th><th>To</th><th>Capability</th><th>Guard</th><th>Security Roles</th><th /></tr></thead>
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
              <td><input aria-label={`Action ${i + 1} Security Roles`} value={a.roleKeys} onChange={(e) => setAction(i, { roleKeys: e.target.value })} /></td>
              <td><Button type="button" variant="secondary" onClick={() => removeAction(i)}>Remove</Button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <Button type="button" variant="secondary" onClick={() => setDraft((d) => ({ ...d, actions: [...d.actions, blankAction()] }))}>Add action</Button>

      <div className="fo-pill-row">
        <Button type="button" variant="secondary" disabled={busy} onClick={validate}>Validate (server)</Button>
      </div>
      {checked ? <ValidationResults read={checked} summary={validationSummary(checked.data)} /> : null}

      <label className="fo-form-field">
        <span>Reason</span>
        <input type="text" aria-label="Reason for saving the draft" value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <Button type="button" variant="primary" disabled={busy} onClick={save}>Save as new draft</Button>
      {outcome ? (
        <p className={outcome.ok ? "fo-muted" : "fo-warning"} role={outcome.ok ? "status" : "alert"} data-draft-outcome={outcome.ok ? "ok" : "refused"}>
          {outcome.text}
        </p>
      ) : null}
    </div>
  );
}
