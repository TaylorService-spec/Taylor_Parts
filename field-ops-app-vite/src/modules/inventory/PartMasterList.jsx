// INV-1 / ADR-009 G2 -- governed Part Master administration workspace. Evolves the former READ-ONLY
// registry (PR 1.9) into the first-class catalog-admin surface WITHOUT a second Parts read model: it
// still reads via services/partMasterQueries.fetchPartMasterList + domain/partMasterView, and adds
// create / edit / status flows that go ONLY through the trusted Part callables (usePartMasterWrite ->
// partMasterCommandClient -> createPart/updatePart/changePartStatus). There is ONE Part authority and
// ONE trusted command path; NO client Firestore writes, NO parallel validator, NO parallel status
// vocabulary (the selects are client MIRRORS; the command re-validates and is authoritative).
//
// FAIL-CLOSED: the write callables are undeployed/ungranted, so config/partMasterWriteReadiness is false
// and the workspace shows a write-disabled notice + makes zero callable attempts. When a shared sandbox
// injects an explicit readiness + a mocked client (usePartMasterWrite deps), the same flows exercise the
// governed outcomes. Authorization is enforced server-side regardless; the UI never claims a success it
// did not receive.
import { useCallback, useEffect, useState } from "react";
import { fetchPartMasterList } from "../../services/partMasterQueries";
import { usePartMasterWrite } from "../../hooks/usePartMasterWrite";
import {
  CONTROL_TYPES, STOCKING_CLASSES, UNIT_CODES,
  allowedStatusTransitions,
} from "../../domain/partMasterWrite";

const STATUS_TONE = {
  ACTIVE: { background: "#e6f4ea", color: "#137333" },
  DRAFT: { background: "#e8eaed", color: "#3c4043" },
  INACTIVE: { background: "#fef7e0", color: "#b06000" },
  SUPERSEDED: { background: "#e8f0fe", color: "#1a56db" },
  DISCONTINUED: { background: "#fce8e6", color: "#c5221f" },
};
function StatusBadge({ status }) {
  const tone = STATUS_TONE[status] ?? STATUS_TONE.DRAFT;
  return <span style={{ ...tone, padding: "2px 8px", borderRadius: 12, fontSize: 12, fontWeight: 600 }}>{status}</span>;
}

// Governed-outcome banner: maps the domain outcome.kind to a tone + keeps the governed message verbatim.
const OUTCOME_TONE = {
  applied: { background: "#e6f4ea", color: "#137333" },
  replayed: { background: "#e8f0fe", color: "#1a56db" },
  noop: { background: "#e8eaed", color: "#3c4043" },
  denied: { background: "#fce8e6", color: "#c5221f" },
  invalid: { background: "#fef7e0", color: "#b06000" },
  conflict: { background: "#fef7e0", color: "#b06000" },
  notFound: { background: "#fce8e6", color: "#c5221f" },
  unavailable: { background: "#e8eaed", color: "#3c4043" },
  error: { background: "#fce8e6", color: "#c5221f" },
};
function OutcomeBanner({ outcome }) {
  if (!outcome) return null;
  const tone = OUTCOME_TONE[outcome.kind] ?? OUTCOME_TONE.error;
  return <div role="status" style={{ ...tone, padding: "8px 12px", borderRadius: 6, margin: "8px 0", fontSize: 13 }}>{outcome.message}</div>;
}

const SELECT = { padding: 6, fontSize: 13, minWidth: 140 };
const INPUT = { padding: 6, fontSize: 13, width: "100%", boxSizing: "border-box" };
const LABEL = { display: "block", fontSize: 12, color: "#5f6368", marginBottom: 4 };
const FIELD = { marginBottom: 10 };

// Shared create/edit fields. `mode` = "create" | "edit". partId + internalPartNumber are identity and
// only editable at create (internalPartNumber IS updatable server-side, but we keep edit focused on the
// descriptive fields the read model exposes; identity edits stay a governed concern).
function PartForm({ mode, form, setForm, disabled }) {
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <div style={{ maxWidth: 520 }}>
      {mode === "create" && (
        <>
          <div style={FIELD}><label style={LABEL}>Part ID</label><input style={INPUT} value={form.partId ?? ""} onChange={set("partId")} disabled={disabled} /></div>
          <div style={FIELD}><label style={LABEL}>Internal part number</label><input style={INPUT} value={form.internalPartNumber ?? ""} onChange={set("internalPartNumber")} disabled={disabled} /></div>
        </>
      )}
      <div style={FIELD}><label style={LABEL}>Name</label><input style={INPUT} value={form.name ?? ""} onChange={set("name")} disabled={disabled} /></div>
      <div style={FIELD}><label style={LABEL}>Description</label><input style={INPUT} value={form.description ?? ""} onChange={set("description")} disabled={disabled} /></div>
      <div style={FIELD}><label style={LABEL}>Category</label><input style={INPUT} value={form.category ?? ""} onChange={set("category")} disabled={disabled} /></div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={FIELD}><label style={LABEL}>Stocking unit</label><select style={SELECT} value={form.stockingUnit ?? "EACH"} onChange={set("stockingUnit")} disabled={disabled}>{UNIT_CODES.map((u) => <option key={u} value={u}>{u}</option>)}</select></div>
        <div style={FIELD}><label style={LABEL}>Control type</label><select style={SELECT} value={form.controlType ?? "STANDARD"} onChange={set("controlType")} disabled={disabled}>{CONTROL_TYPES.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
        <div style={FIELD}><label style={LABEL}>Stocking class</label><select style={SELECT} value={form.stockingClass ?? "STOCKED"} onChange={set("stockingClass")} disabled={disabled}>{STOCKING_CLASSES.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
      </div>
    </div>
  );
}

export default function PartMasterList(props) {
  const [state, setState] = useState({ phase: "loading" });
  const [panel, setPanel] = useState(null); // {mode:"create"} | {mode:"edit", part} | {mode:"status", part}
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const { writeReady, runCreate, runUpdate, runChangeStatus } = usePartMasterWrite(props?.writeDeps);

  const load = useCallback(() => {
    let cancelled = false;
    setState({ phase: "loading" });
    fetchPartMasterList().then((result) => {
      if (cancelled) return;
      if (!result.ok) setState({ phase: result.code === "permission-denied" ? "denied" : "error" });
      else setState({ phase: "ready", parts: result.parts, invalidCount: result.invalid.length });
    });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => load(), [load]);

  const openCreate = () => { setForm({ stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED" }); setOutcome(null); setPanel({ mode: "create" }); };
  const openEdit = (part) => { setForm({ ...part }); setOutcome(null); setPanel({ mode: "edit", part }); };
  const openStatus = (part) => { setOutcome(null); setPanel({ mode: "status", part }); };
  const close = () => { setPanel(null); setForm({}); };

  // After a governed applied/replayed change, refresh from the trusted read so the UI reflects real state.
  const afterWrite = useCallback((o) => {
    setOutcome(o);
    if (o.kind === "applied" || o.kind === "replayed") { close(); load(); }
  }, [load]);

  const submitCreate = async () => { setBusy(true); afterWrite(await runCreate(form)); setBusy(false); };
  const submitEdit = async () => { setBusy(true); afterWrite(await runUpdate(panel.part.partId, panel.part.version, form, panel.part)); setBusy(false); };
  const submitStatus = async (newStatus) => { setBusy(true); afterWrite(await runChangeStatus(panel.part.partId, panel.part.version, newStatus)); setBusy(false); };

  if (state.phase === "loading") return <p>Loading Part Master…</p>;
  if (state.phase === "denied") return <p>You do not have access to the Part Master. Contact an administrator if you believe this is an error.</p>;
  if (state.phase === "error") return <p>The Part Master is currently unavailable. Try again later.</p>;

  const parts = state.parts ?? [];
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Part Master</h2>
        <button onClick={openCreate} disabled={busy} style={{ padding: "8px 14px", fontSize: 13, fontWeight: 600, borderRadius: 6, border: "1px solid #1a73e8", background: "#1a73e8", color: "white", cursor: "pointer" }}>New part</button>
      </div>
      <p style={{ color: "#5f6368", fontSize: 13 }}>
        Governed canonical part registry. Create and edit parts here; stock levels live in the inventory ledger.
        Every change goes through the catalog administration service and is authorized server-side.
        {state.invalidCount > 0 ? ` ${state.invalidCount} malformed record(s) were excluded and need review.` : ""}
      </p>
      {!writeReady && (
        <div style={{ background: "#e8eaed", color: "#3c4043", padding: "8px 12px", borderRadius: 6, fontSize: 13, marginBottom: 8 }}>
          Editing isn’t enabled in this environment yet. You can review parts; create/edit/status changes are activated
          with the catalog administration service (a governed deployment + grant), not from this screen.
        </div>
      )}
      {!panel && <OutcomeBanner outcome={outcome} />}

      {panel && (
        <div style={{ border: "1px solid #dadce0", borderRadius: 8, padding: 16, margin: "8px 0", background: "#fff" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>
              {panel.mode === "create" ? "New part" : panel.mode === "edit" ? `Edit ${panel.part.internalPartNumber}` : `Change status — ${panel.part.internalPartNumber}`}
            </h3>
            <button onClick={close} disabled={busy} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 18, color: "#5f6368" }}>×</button>
          </div>
          <OutcomeBanner outcome={outcome} />
          {panel.mode === "status" ? (
            <div>
              <p style={{ fontSize: 13, color: "#5f6368" }}>Current status: <StatusBadge status={panel.part.status} />. Choose a governed transition:</p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {allowedStatusTransitions(panel.part.status).length === 0
                  ? <span style={{ fontSize: 13, color: "#5f6368" }}>No status changes are available from {panel.part.status}.</span>
                  : allowedStatusTransitions(panel.part.status).map((s) => (
                      <button key={s} onClick={() => submitStatus(s)} disabled={busy || !writeReady} style={{ padding: "8px 14px", fontSize: 13, borderRadius: 6, border: "1px solid #dadce0", background: "#fff", cursor: writeReady ? "pointer" : "not-allowed" }}>→ {s}</button>
                    ))}
              </div>
            </div>
          ) : (
            <>
              <PartForm mode={panel.mode} form={form} setForm={setForm} disabled={busy || !writeReady} />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button onClick={panel.mode === "create" ? submitCreate : submitEdit} disabled={busy || !writeReady} style={{ padding: "8px 16px", fontSize: 13, fontWeight: 600, borderRadius: 6, border: "1px solid #1a73e8", background: writeReady ? "#1a73e8" : "#c6d4f0", color: "white", cursor: writeReady ? "pointer" : "not-allowed" }}>{busy ? "Saving…" : panel.mode === "create" ? "Create part" : "Save changes"}</button>
                <button onClick={close} disabled={busy} style={{ padding: "8px 16px", fontSize: 13, borderRadius: 6, border: "1px solid #dadce0", background: "#fff", cursor: "pointer" }}>Cancel</button>
              </div>
            </>
          )}
        </div>
      )}

      {parts.length === 0 ? (
        <p>No canonical Part records exist yet. Use “New part” to create the first governed part.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "2px solid #dadce0" }}>
              <th style={{ padding: 8 }}>Part #</th><th style={{ padding: 8 }}>Name</th><th style={{ padding: 8 }}>Category</th>
              <th style={{ padding: 8 }}>Control</th><th style={{ padding: 8 }}>Class</th><th style={{ padding: 8 }}>Unit</th>
              <th style={{ padding: 8 }}>Status</th><th style={{ padding: 8 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {parts.map((part) => (
              <tr key={part.partId} style={{ borderBottom: "1px solid #f1f3f4" }}>
                <td style={{ padding: 8, fontFamily: "monospace" }}>{part.internalPartNumber}</td>
                <td style={{ padding: 8 }}>{part.name}</td>
                <td style={{ padding: 8 }}>{part.category || "—"}</td>
                <td style={{ padding: 8 }}>{part.controlType}</td>
                <td style={{ padding: 8 }}>{part.stockingClass}</td>
                <td style={{ padding: 8 }}>{part.stockingUnit}</td>
                <td style={{ padding: 8 }}><StatusBadge status={part.status} /></td>
                <td style={{ padding: 8, whiteSpace: "nowrap" }}>
                  <button onClick={() => openEdit(part)} disabled={busy} style={{ marginRight: 6, padding: "4px 10px", fontSize: 12, borderRadius: 4, border: "1px solid #dadce0", background: "#fff", cursor: "pointer" }}>Edit</button>
                  <button onClick={() => openStatus(part)} disabled={busy} style={{ padding: "4px 10px", fontSize: 12, borderRadius: 4, border: "1px solid #dadce0", background: "#fff", cursor: "pointer" }}>Status</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
