// THE GRANT CONTROLS -- one Security Role x one Object action, administered through the server.
//
// Every control here sends a governed control-plane mutation (contract section 8) with a STATED reason,
// then asks its parent to RE-READ. Nothing is drawn optimistically: a grant the server refused did not
// happen, and the refusal is shown VERBATIM (code and message) -- in particular the 409
// CONDITION_RETIREMENT_WOULD_WIDEN the server returns for retiring a condition on a held grant.
//
// NO CLIENT PERMISSION LOGIC. Whether the caller may administer security is the SERVER's
// admin.securityPolicy.write gate; the controls are offered and a FORBIDDEN comes back as itself. The
// only things this screen withholds are the ones the server has said are not grantable: a
// SYSTEM_INVARIANT cell (refused on write) and a condition kind the server's own vocabulary
// (listSupportedConditionKinds) marks unsupported or inapplicable. With no vocabulary, no condition.
import { useState } from "react";
import { Button } from "../../shared/ui/primitives/index.js";
import { refusalText } from "../../services/adminControlPlaneClient.js";
import {
  buildCondition,
  describeCondition,
  describeGrantSource,
  initialConditionValues,
  isSystemInvariant,
  kindApplies,
  statedReason,
} from "./controlPlaneModel.js";

const NO_CONDITION = "";

/** Why the picker is disabled, in words, from the vocabulary read's state. */
export function vocabularyUnavailableWords(vocabulary) {
  if (!vocabulary || vocabulary.status === "loading" || vocabulary.status === "idle") return "Reading the server's condition vocabulary…";
  if (vocabulary.status === "unavailable") {
    return `Conditions cannot be set here yet: this EOS API does not serve its condition vocabulary (listSupportedConditionKinds). No local list is substituted. (${refusalText(vocabulary.error)})`;
  }
  if (vocabulary.status === "failed") return `Conditions cannot be set: the condition vocabulary could not be read. (${refusalText(vocabulary.error)})`;
  return null;
}

/**
 * The condition kind picker plus the parameters the SERVER says each kind needs. Kinds the server
 * marks unsupported, or scopes to other capabilities, are disabled. With no vocabulary the picker is
 * disabled and says why -- there is no local fallback.
 */
export function ConditionFields({ value, onChange, vocabulary, capabilityKey, allowNone = false, idPrefix }) {
  const kinds = vocabulary?.status === "ready" ? vocabulary.kinds : null;
  const spec = kinds?.find((k) => k.kind === value.kind) ?? null;
  const set = (name, v) => onChange({ ...value, [name]: v });
  const unavailable = kinds ? null : vocabularyUnavailableWords(vocabulary);
  return (
    <>
      <label className="fo-form-field">
        <span>Condition</span>
        <select
          id={`${idPrefix}-kind`}
          aria-label="Condition kind"
          value={value.kind}
          disabled={!kinds}
          onChange={(e) => {
            const next = kinds?.find((k) => k.kind === e.target.value) ?? null;
            onChange({ kind: e.target.value, ...initialConditionValues(next) });
          }}
        >
          {allowNone ? <option value={NO_CONDITION}>No condition — unconditioned grant</option> : <option value={NO_CONDITION}>Choose a condition kind…</option>}
          {(kinds ?? []).map((k) => {
            const applies = kindApplies(k, capabilityKey);
            const why = !k.supported ? (k.why ?? "not supported") : "not applicable to this capability";
            return (
              <option key={k.kind} value={k.kind} disabled={!applies}>
                {applies ? k.label : `${k.label} — ${why}`}
              </option>
            );
          })}
        </select>
      </label>
      {unavailable ? <p className="fo-muted" data-condition-vocabulary={vocabulary?.status ?? "none"}>{unavailable}</p> : null}
      {(spec?.parameters ?? []).map((p) => (
        <label className="fo-form-field" key={p.name}>
          <span>{p.required ? p.label : `${p.label} (optional)`}</span>
          {p.values ? (
            <select aria-label={p.label} value={value[p.name] ?? ""} onChange={(e) => set(p.name, e.target.value)}>
              <option value="">Choose…</option>
              {p.values.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          ) : (
            <input aria-label={p.label} value={value[p.name] ?? ""} onChange={(e) => set(p.name, e.target.value)} />
          )}
        </label>
      ))}
    </>
  );
}

export function ReasonField({ value, onChange, label = "Reason (required, recorded in the audit trail)" }) {
  return (
    <label className="fo-form-field">
      <span>{label}</span>
      <textarea aria-label="Reason" value={value} onChange={(e) => onChange(e.target.value)} required />
    </label>
  );
}

/** A server outcome, in the server's words. */
export function Outcome({ result, success }) {
  if (!result) return null;
  if (result.ok) return <p className="fo-muted" role="status">{success}</p>;
  return <p className="fo-warning" role="alert" data-control-plane-refusal={result.code}>{refusalText(result)}</p>;
}

/** The cell's ACTIVE condition as stored, from either read shape (matrix: raw; role detail: {condition,status}). */
function cellCondition(cell) {
  const c = cell?.condition ?? null;
  if (!c) return null;
  if (typeof c === "object" && "status" in c && "condition" in c) return c.status === "ACTIVE" ? c.condition : null;
  return c;
}

/**
 * The controls for ONE Role x action cell: grant (optionally conditioned, atomically) or revoke, and
 * set or retire the grant's condition. Each asks for a reason; each re-reads on success.
 */
export function GrantCellControls({ api, objectKey, actionKey, roleKey, capabilityKey, cell, vocabulary, onChanged }) {
  const [mode, setMode] = useState(null);
  const [reason, setReason] = useState("");
  const [condition, setCondition] = useState({ kind: NO_CONDITION });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  if (isSystemInvariant(cell)) {
    return <span className="fo-cp-tag fo-cp-tag--invariant" data-grant-cell="SYSTEM_INVARIANT">Not grantable — system invariant</span>;
  }

  const held = cell?.held === true;
  const active = cellCondition(cell);
  const open = (next) => { setMode(next); setReason(""); setCondition({ kind: NO_CONDITION }); setResult(null); };
  const spec = vocabulary?.kinds?.find((k) => k.kind === condition.kind) ?? null;
  const built = condition.kind ? buildCondition(spec, condition) : null;
  const reasonText = statedReason(reason);
  const ready = Boolean(reasonText) && (mode === "setCondition" ? Boolean(built) : mode === "grant" ? (!condition.kind || Boolean(built)) : true);

  const submit = async (event) => {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    const base = { objectKey, actionKey, roleKey, reason: reasonText };
    let outcome;
    if (mode === "grant") outcome = await api.grantObjectActionToRole({ ...base, ...(built ? { condition: built } : {}) });
    else if (mode === "revoke") outcome = await api.revokeObjectActionFromRole(base);
    else if (mode === "setCondition") outcome = await api.setGrantCondition({ ...base, condition: built });
    else outcome = await api.retireGrantCondition(base);
    setBusy(false);
    setResult(outcome);
    if (outcome?.ok) { setMode(null); onChanged?.(); }
  };

  const verb = { grant: "Grant", revoke: "Revoke", setCondition: "Set condition", retireCondition: "Retire condition" }[mode];

  return (
    <div data-grant-cell={cell?.source ?? "NONE"}>
      <div className="fo-btn-row">
        {held ? (
          <Button type="button" variant="secondary" onClick={() => open("revoke")} aria-label={`Revoke ${actionKey} from ${roleKey}`}>Revoke</Button>
        ) : (
          <Button type="button" variant="secondary" onClick={() => open("grant")} aria-label={`Grant ${actionKey} to ${roleKey}`}>Grant</Button>
        )}
        <Button type="button" variant="secondary" onClick={() => open("setCondition")} aria-label={`Set condition on ${actionKey} for ${roleKey}`}>
          {active ? "Replace condition" : "Set condition"}
        </Button>
        {active ? (
          <Button type="button" variant="secondary" onClick={() => open("retireCondition")} aria-label={`Retire condition on ${actionKey} for ${roleKey}`}>Retire condition</Button>
        ) : null}
      </div>
      {mode ? (
        <form className="fo-cp-form" onSubmit={submit} aria-label={`${verb} ${actionKey} for ${roleKey}`}>
          {mode === "grant" ? <ConditionFields value={condition} onChange={setCondition} vocabulary={vocabulary} capabilityKey={capabilityKey} allowNone idPrefix={`${roleKey}-${actionKey}-grant`} /> : null}
          {mode === "setCondition" ? <ConditionFields value={condition} onChange={setCondition} vocabulary={vocabulary} capabilityKey={capabilityKey} idPrefix={`${roleKey}-${actionKey}-cond`} /> : null}
          {mode === "retireCondition" ? (
            <p className="fo-muted">
              Retiring a condition while the grant is held would WIDEN it, so the server refuses that. Revoke the grant first.
            </p>
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

/** One Role cell in words: held or not, its source, its condition. */
export function GrantCellFacts({ cell }) {
  const active = cellCondition(cell);
  return (
    <>
      <span className={cell?.source === "SYSTEM_INVARIANT" ? "fo-cp-tag fo-cp-tag--invariant" : "fo-cp-tag"}>{describeGrantSource(cell?.source)}</span>
      {" "}
      <span className="fo-muted">{cell?.held ? "Held" : "Not held"}</span>
      {active ? <span className="fo-muted">{` · Condition: ${describeCondition(active)}`}</span> : null}
    </>
  );
}
