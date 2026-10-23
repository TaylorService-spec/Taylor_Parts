// EMPLOYEE > ACCESS EXPLAINED -- "why can or can't this person do X", gate by gate. READ-ONLY.
//
// Design: simplified permission model proposal, sections 3A.1 (the eleven-gate chain) and 9A.2 (Access explained).
// The SERVER decides every gate (explainAccessGates, the same admin.principalAccess.read authority as Effective Access);
// this panel draws the answer in the server's order and computes nothing: no pass, no fail, no first failure.
//
// Layer names: the proposal's layer for each gate ships in the payload (`proposedLayer`) but is NOT shown until the Owner
// approves the model -- the server reports `layerNamesApproved`, and only a literal true turns the column on.
import { useMemo, useState } from "react";
import { adminControlPlaneClient, refusalText } from "../../services/adminControlPlaneClient.js";
import { useControlPlaneRead } from "./useControlPlaneRead.js";
import { identifierLabel, titleCase } from "../../shared/display/displayLabels.js";

const STATUS_WORDS = Object.freeze({
  PASS: "Pass", FAIL: "Fail", NOT_APPLICABLE: "Not applicable", NOT_EVALUATED: "Not evaluated", NOT_COVERED: "Not covered",
});
const STATUS_TAG = Object.freeze({
  PASS: "fo-cp-tag fo-cp-tag--allowed", FAIL: "fo-cp-tag fo-cp-tag--denied",
  NOT_APPLICABLE: "fo-cp-tag", NOT_EVALUATED: "fo-cp-tag", NOT_COVERED: "fo-cp-tag fo-cp-tag--conditional",
});
const EMPTY_DRAFT = Object.freeze({ kind: "person", objectKey: "", actionKey: "", surfaceKey: "", operatingCompanyId: "", warehouseId: "", salesChannel: "" });

/** The question the server is asked: pure data from the form, never a decision. */
export function questionFromDraft(draft) {
  if (draft.kind === "action" && draft.objectKey && draft.actionKey) {
    const businessContext = {};
    for (const key of ["operatingCompanyId", "warehouseId", "salesChannel"]) if (draft[key].trim()) businessContext[key] = draft[key].trim();
    return { objectKey: draft.objectKey, actionKey: draft.actionKey, ...(Object.keys(businessContext).length ? { businessContext } : {}) };
  }
  if (draft.kind === "page" && draft.surfaceKey) return { surfaceKey: draft.surfaceKey };
  return null;
}

function Headline({ data }) {
  if (data.verdict === "BLOCKED" && data.firstFailure) {
    return <p className="fo-warning" role="alert" data-access-verdict="BLOCKED" data-first-failure={data.firstFailure.key}>{data.firstFailure.text}</p>;
  }
  const text = {
    ALLOWED: "Every gate that can be checked passes. Gates marked Not covered could not be checked here.",
    NEEDS_RECORD: "No gate refuses so far. The rest depends on the particular record: name its company, warehouse or channel, or see the Record access gate.",
    OVERVIEW: "Sign-in, principal, employment, company and door for this person. Choose an action or a page to check the rest.",
  }[data.verdict];
  return <p className="fo-muted" data-access-verdict={data.verdict}>{text ?? "The server returned a verdict this screen does not know, so none is shown."}</p>;
}

function Gate({ gate, showLayer }) {
  return (
    <li data-gate={gate.key} data-gate-status={gate.status} data-gate-step={gate.step}>
      <p>
        <strong>{`${gate.step}. ${gate.label}`}</strong>{" "}
        <span className={STATUS_TAG[gate.status] ?? "fo-cp-tag"}>{STATUS_WORDS[gate.status] ?? gate.status}</span>
        {showLayer ? <span className="fo-muted" data-gate-layer>{` · ${gate.proposedLayer}`}</span> : null}
      </p>
      <p className="fo-muted">{gate.summary}</p>
      {gate.settings.length > 0 ? (
        <table className="fo-table" aria-label={`${gate.label} settings`}>
          <thead><tr><th>Setting</th><th>Current value</th><th>Where it lives</th></tr></thead>
          <tbody>
            {gate.settings.map((s) => (
              <tr key={`${s.id}-${s.label}`} data-setting={s.id}>
                <td>{s.label} <span className="fo-muted">{`(${s.id})`}</span></td>
                <td>{s.value}</td>
                <td><code>{s.authority}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </li>
  );
}

export default function EmployeeAccessExplained({ api = adminControlPlaneClient, principalId }) {
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [asked, setAsked] = useState(null);
  // The overview (no question) also supplies the picker's vocabulary, so it is always read once.
  const overview = useControlPlaneRead(principalId ? () => api.explainAccessGates(principalId) : null, `gates:${principalId}`);
  const answer = useControlPlaneRead(principalId && asked ? () => api.explainAccessGates(principalId, asked) : null, `gates:${principalId}:${JSON.stringify(asked)}`);
  const options = overview.status === "ready" ? overview.data.options : null;
  const objects = useMemo(() => [...new Set((options?.actions ?? []).map((a) => a.objectKey))], [options]);
  const actions = (options?.actions ?? []).filter((a) => a.objectKey === draft.objectKey);

  if (!principalId) {
    return <p className="fo-muted" data-access-explained="NO_PRINCIPAL">No governed Principal is linked to this Employee, so there is no access to explain.</p>;
  }
  const shown = asked ? answer : overview;
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const question = questionFromDraft(draft);
  const ready = shown.status === "ready" && shown.data && Array.isArray(shown.data.gates);

  return (
    <div data-access-explained={shown.status === "ready" ? (ready ? "READY" : "UNREADABLE") : shown.status.toUpperCase()}>
      <p className="fo-muted">
        Why this person can or cannot do something, checked gate by gate in the order EOS applies them. The first gate that
        refuses stops the request. The server decides every gate; this page only shows its answer.
      </p>
      <form
        aria-label="Access question"
        onSubmit={(e) => { e.preventDefault(); setAsked(question); }}
        className="fo-cp-facts"
      >
        <label>Question{" "}
          <select value={draft.kind} onChange={(e) => set({ ...EMPTY_DRAFT, kind: e.target.value })} disabled={!options}>
            <option value="person">This person overall</option>
            <option value="action">An action on an object</option>
            <option value="page">A page</option>
          </select>
        </label>
        {draft.kind === "action" ? (
          <>
            <label>Object{" "}
              <select value={draft.objectKey} onChange={(e) => set({ objectKey: e.target.value, actionKey: "" })}>
                <option value="">Choose…</option>
                {objects.map((o) => <option key={o} value={o}>{titleCase(o)}</option>)}
              </select>
            </label>
            <label>Action{" "}
              <select value={draft.actionKey} onChange={(e) => set({ actionKey: e.target.value })} disabled={!draft.objectKey}>
                <option value="">Choose…</option>
                {actions.map((a) => <option key={a.capabilityKey} value={a.actionKey}>{titleCase(a.actionKey)}</option>)}
              </select>
            </label>
            <fieldset>
              <legend className="fo-muted">The record, if you have one (optional)</legend>
              <label>Company <input value={draft.operatingCompanyId} onChange={(e) => set({ operatingCompanyId: e.target.value })} /></label>{" "}
              <label>Warehouse <input value={draft.warehouseId} onChange={(e) => set({ warehouseId: e.target.value })} /></label>{" "}
              <label>Sales channel <input value={draft.salesChannel} onChange={(e) => set({ salesChannel: e.target.value })} /></label>
            </fieldset>
          </>
        ) : null}
        {draft.kind === "page" ? (
          <label>Page{" "}
            <select value={draft.surfaceKey} onChange={(e) => set({ surfaceKey: e.target.value })}>
              <option value="">Choose…</option>
              {(options?.surfaces ?? []).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
        ) : null}
        <button type="submit" disabled={draft.kind !== "person" && !question}>Explain</button>
        {asked ? <button type="button" onClick={() => { setAsked(null); setDraft(EMPTY_DRAFT); }}>Clear</button> : null}
      </form>

      {shown.status === "loading" || shown.status === "idle" ? <p className="fo-muted">Asking the server…</p> : null}
      {shown.status === "unavailable" ? (
        <div>
          <p className="fo-warning">Access explained is unavailable: this EOS API does not serve it. Nothing is shown rather than an answer computed anywhere else.</p>
          <p className="fo-muted">{refusalText(shown.error)}</p>
        </div>
      ) : null}
      {shown.status === "failed" ? <p className="fo-warning" role="alert">{refusalText(shown.error)}</p> : null}
      {shown.status === "ready" && !ready
        ? <p className="fo-warning" role="alert">The server returned an Access explained payload this screen cannot read, so nothing is shown.</p> : null}
      {ready ? (
        <>
          <p className="fo-muted" data-access-question>
            {shown.data.question.kind === "PERSON" ? "Question: this person overall"
              : `Question: ${shown.data.question.kind === "PAGE" ? "open" : "do"} ${shown.data.question.label ?? identifierLabel(shown.data.question.capabilityKey ?? shown.data.question.surfaceKey)}`}
          </p>
          <Headline data={shown.data} />
          <ol aria-label="Access gates, in the order they are applied" data-access-gates>
            {shown.data.gates.map((g) => <Gate key={g.key} gate={g} showLayer={shown.data.layerNamesApproved === true} />)}
          </ol>
        </>
      ) : null}
    </div>
  );
}
