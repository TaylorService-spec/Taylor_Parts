// EMPLOYEE > DIRECT EXCEPTIONS -- governed capability grants to THIS Employee's Principal, administered through the
// server and ENFORCED by every runtime gate exactly as a Role grant is (lane DX).
//
// Contract: docs/architecture/administration-control-plane-2026-09-26.md section 15.
//
//   read       explainEffectiveAccess { principalId }: each action's `directGrant` { label, source, exceptionReason,
//              expiresAt, grantedBy, grantedAt, condition, enforced } and the evaluator's result for it
//   grant      grantObjectActionToPrincipal { objectKey, actionKey, principalId, reason, expiresAt?, condition? }
//   revoke     revokeObjectActionFromPrincipal { objectKey, actionKey, principalId, reason }
//   condition  setGrantCondition / retireGrantCondition { objectKey, actionKey, principalId, condition?, reason }
//
// NO CLIENT PERMISSION LOGIC. Whether the caller may administer security is the SERVER's admin.securityPolicy.write
// gate; self-grant, Owner ruling A, anti-lockout, "a direct exception has no scope" and "retiring a held grant's
// condition would widen it" are all the SERVER's refusals, shown verbatim. The reason is required by the server; the
// submit stays disabled without one only so the administrator is not sent a refusal for nothing. Every mutation is
// followed by a RE-READ; nothing is drawn optimistically. The condition vocabulary is the server's
// (listSupportedConditionKinds) -- with no vocabulary, no condition.
import { useMemo, useState } from "react";
import { Button } from "../../shared/ui/primitives/index.js";
import { adminControlPlaneClient, refusalText } from "../../services/adminControlPlaneClient.js";
import { useControlPlaneRead } from "./useControlPlaneRead.js";
import { useConditionVocabulary } from "./useConditionVocabulary.js";
import { ConditionFields, Outcome, ReasonField } from "./GrantControls.jsx";
import { buildCondition, directExceptionRows, explanationModel, statedReason } from "./controlPlaneModel.js";

const NO_CONDITION = "";

/** A datetime-local value as an ISO instant, or null when none was chosen (never guessed). */
function isoFromLocal(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? new Date(at).toISOString() : null;
}

function DirectExceptionRowControls({ api, principalId, row, vocabulary, onChanged }) {
  const [mode, setMode] = useState(null);
  const [reason, setReason] = useState("");
  const [condition, setCondition] = useState({ kind: NO_CONDITION });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const open = (next) => { setMode(next); setReason(""); setCondition({ kind: NO_CONDITION }); setResult(null); };
  const spec = vocabulary?.kinds?.find((k) => k.kind === condition.kind) ?? null;
  const built = condition.kind ? buildCondition(spec, condition) : null;
  const reasonText = statedReason(reason);
  const ready = Boolean(reasonText) && (mode === "setCondition" ? Boolean(built) : true);
  const verb = { revoke: "Revoke", setCondition: row.conditionRaw ? "Replace condition" : "Attach condition", retireCondition: "Retire condition" }[mode];

  const submit = async (event) => {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    const base = { objectKey: row.objectKey, actionKey: row.actionKey, principalId, reason: reasonText };
    let outcome;
    if (mode === "revoke") outcome = await api.revokeObjectActionFromPrincipal(base);
    else if (mode === "setCondition") outcome = await api.setGrantCondition({ ...base, condition: built });
    else outcome = await api.retireGrantCondition(base);
    setBusy(false);
    setResult(outcome);
    if (outcome?.ok) { setMode(null); onChanged?.(); }
  };

  return (
    <div data-direct-exception-controls={row.capabilityKey}>
      <div className="fo-btn-row">
        <Button type="button" variant="secondary" onClick={() => open("revoke")} aria-label={`Revoke direct exception ${row.capabilityKey}`}>Revoke</Button>
        <Button type="button" variant="secondary" onClick={() => open("setCondition")} aria-label={`Attach condition to direct exception ${row.capabilityKey}`}>
          {row.conditionRaw ? "Replace condition" : "Attach condition"}
        </Button>
        {row.conditionRaw ? (
          <Button type="button" variant="secondary" onClick={() => open("retireCondition")} aria-label={`Retire condition on direct exception ${row.capabilityKey}`}>Retire condition</Button>
        ) : null}
      </div>
      {mode ? (
        <form className="fo-cp-form" onSubmit={submit} aria-label={`${verb} ${row.capabilityKey}`}>
          {mode === "setCondition" ? (
            <ConditionFields value={condition} onChange={setCondition} vocabulary={vocabulary} capabilityKey={row.capabilityKey} idPrefix={`dx-${row.capabilityKey}-cond`} />
          ) : null}
          {mode === "retireCondition" ? (
            <p className="fo-muted">Retiring the condition while the direct exception is held would WIDEN it, so the server refuses that. Revoke it first.</p>
          ) : null}
          <ReasonField value={reason} onChange={setReason} />
          <div className="fo-btn-row">
            <Button type="submit" variant="primary" disabled={!ready || busy}>{`Confirm ${verb?.toLowerCase()}`}</Button>
            <Button type="button" variant="secondary" onClick={() => setMode(null)}>Cancel</Button>
          </div>
        </form>
      ) : null}
      <Outcome result={result} success="Saved by the server; re-reading." />
    </div>
  );
}

function GrantDirectExceptionForm({ api, principalId, vocabulary, onChanged }) {
  const objects = useControlPlaneRead(() => api.listObjectsWithActions(), "dx:objects");
  const [objectKey, setObjectKey] = useState("");
  const [actionKey, setActionKey] = useState("");
  const [expires, setExpires] = useState("");
  const [reason, setReason] = useState("");
  const [condition, setCondition] = useState({ kind: NO_CONDITION });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const objectList = objects.status === "ready" && Array.isArray(objects.data) ? objects.data : [];
  const object = objectList.find((o) => o.key === objectKey) ?? null;
  const action = (object?.actions ?? []).find((a) => a.actionKey === actionKey) ?? null;
  const spec = vocabulary?.kinds?.find((k) => k.kind === condition.kind) ?? null;
  const built = condition.kind ? buildCondition(spec, condition) : null;
  const reasonText = statedReason(reason);
  const expiresAt = isoFromLocal(expires);
  const ready = Boolean(object && action && reasonText) && (!condition.kind || Boolean(built)) && (expires.trim() === "" || Boolean(expiresAt));

  const submit = async (event) => {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    const outcome = await api.grantObjectActionToPrincipal({
      objectKey, actionKey, principalId, reason: reasonText,
      ...(expiresAt ? { expiresAt } : {}),
      ...(built ? { condition: built } : {}),
    });
    setBusy(false);
    setResult(outcome);
    if (outcome?.ok) {
      setObjectKey(""); setActionKey(""); setExpires(""); setReason(""); setCondition({ kind: NO_CONDITION });
      onChanged?.();
    }
  };

  if (objects.status === "failed" || objects.status === "unavailable") {
    return <p className="fo-warning" role="alert" data-direct-exception-grant="UNAVAILABLE">{`The governed Object actions could not be read, so no direct exception can be granted here. (${refusalText(objects.error)})`}</p>;
  }
  return (
    <form className="fo-cp-form" onSubmit={submit} aria-label="Grant a direct exception" data-direct-exception-grant="READY">
      <p className="fo-muted">
        A direct exception grants ONE Object action to this Principal alone, outside every Security Role. It is enforced
        everywhere a Role grant is, carries no scope, and needs a reason. It may carry a supported condition and may expire.
      </p>
      <label className="fo-form-field">
        <span>Object</span>
        <select aria-label="Object" value={objectKey} onChange={(e) => { setObjectKey(e.target.value); setActionKey(""); setCondition({ kind: NO_CONDITION }); }}>
          <option value="">{objects.status === "ready" ? "Choose an Object…" : "Reading the governed Objects…"}</option>
          {objectList.map((o) => <option key={o.key} value={o.key}>{o.label ? `${o.label} (${o.key})` : o.key}</option>)}
        </select>
      </label>
      <label className="fo-form-field">
        <span>Action</span>
        <select aria-label="Action" value={actionKey} disabled={!object} onChange={(e) => { setActionKey(e.target.value); setCondition({ kind: NO_CONDITION }); }}>
          <option value="">Choose an action…</option>
          {(object?.actions ?? []).map((a) => (
            <option key={a.actionKey} value={a.actionKey}>{`${a.displayLabel ?? a.actionKey} — ${a.capabilityKey}`}</option>
          ))}
        </select>
      </label>
      {action ? (
        <ConditionFields value={condition} onChange={setCondition} vocabulary={vocabulary} capabilityKey={action.capabilityKey} allowNone idPrefix="dx-grant" />
      ) : null}
      <label className="fo-form-field">
        <span>Expires (optional; must be in the future)</span>
        <input type="datetime-local" aria-label="Expires" value={expires} onChange={(e) => setExpires(e.target.value)} />
      </label>
      <ReasonField value={reason} onChange={setReason} />
      <div className="fo-btn-row">
        <Button type="submit" variant="primary" disabled={!ready || busy}>Grant direct exception</Button>
      </div>
      <Outcome result={result} success="Granted by the server; re-reading." />
    </form>
  );
}

export default function EmployeeDirectExceptions({ api = adminControlPlaneClient, principalId, onChanged }) {
  const read = useControlPlaneRead(principalId ? () => api.explainEffectiveAccess(principalId) : null, `dx:${principalId}`);
  const vocabulary = useConditionVocabulary(api);
  const model = useMemo(() => (read.status === "ready" ? explanationModel(read.data) : null), [read.status, read.data]);
  const rows = useMemo(() => directExceptionRows(model), [model]);
  const [granting, setGranting] = useState(false);
  const changed = () => { read.reload(); onChanged?.(); };

  if (!principalId) {
    return <p className="fo-muted" data-direct-exceptions="NO_PRINCIPAL">No governed Principal is linked to this Employee, so it can hold no direct exception.</p>;
  }
  if (read.status === "loading" || read.status === "idle") return <p className="fo-muted" data-direct-exceptions="LOADING">Reading direct exceptions from the server…</p>;
  if (read.status === "unavailable" || read.status === "failed") {
    return <p className="fo-warning" role="alert" data-direct-exceptions={read.status === "unavailable" ? "UNAVAILABLE" : "FAILED"}>{refusalText(read.error)}</p>;
  }
  if (!model) {
    return <p className="fo-warning" role="alert" data-direct-exceptions="UNREADABLE">The server returned a payload this screen cannot read, so no direct exception is shown.</p>;
  }

  return (
    <div data-direct-exceptions="READY" data-direct-exception-count={rows.length}>
      {rows.length === 0 ? <p className="fo-muted">This Principal holds no unexpired direct exception.</p> : (
        <table className="fo-table" aria-label="Direct exceptions">
          <thead>
            <tr><th>Object action</th><th>Source</th><th>Reason</th><th>Granted by</th><th>Created</th><th>Expires</th><th>Condition</th><th>Evaluator</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.capabilityKey} data-direct-exception={row.capabilityKey} data-enforced={row.enforced ? "true" : "false"}>
                <td>{`${row.objectKey ?? "?"} · ${row.actionKey ?? "?"}`} <span className="fo-muted"><code>{row.capabilityKey}</code></span></td>
                <td>
                  <span className="fo-cp-tag fo-cp-tag--direct">DIRECT EXCEPTION</span>
                  <div className="fo-muted">
                    {row.enforced ? "Enforced by every runtime gate, like a Role grant."
                      : row.notEnforced ? "Not enforced on Role-only runtime paths (older server)." : "Enforcement not stated by the server."}
                  </div>
                </td>
                <td>{row.exceptionReason ?? "none recorded"}</td>
                <td className="fo-muted">{row.grantedBy ?? "—"}</td>
                <td className="fo-muted">{row.grantedAt ?? "—"}</td>
                <td className="fo-muted">{row.expiresAt ?? "never"}</td>
                <td className="fo-muted">{row.condition ?? "none — unconditioned"}</td>
                <td><span className="fo-muted">{`${row.resultWords} (${row.reasonCode ?? "—"})`}</span></td>
                <td><DirectExceptionRowControls api={api} principalId={principalId} row={row} vocabulary={vocabulary} onChanged={changed} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="fo-btn-row">
        <Button type="button" variant="secondary" onClick={() => setGranting((g) => !g)} aria-expanded={granting}>
          {granting ? "Close" : "Grant a direct exception"}
        </Button>
      </div>
      {granting ? <GrantDirectExceptionForm api={api} principalId={principalId} vocabulary={vocabulary} onChanged={changed} /> : null}
    </div>
  );
}
