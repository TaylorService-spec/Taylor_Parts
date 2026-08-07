// Manufacturer administration workspace (catalog reference object). Closes the referential gap Part
// write created (parts.manufacturerId -> a manageable/readable Manufacturer). READ via
// services/manufacturerQueries.fetchManufacturerList + domain/manufacturersView (the `manufacturers`
// collection read is a PREPARED, not-deployed Rules delta mirroring `parts`; until deployed the read fails
// closed to a denied state). WRITE via useManufacturerWrite -> manufacturerCommandClient -> the trusted
// createManufacturer/updateManufacturer/changeManufacturerStatus callables. ONE Manufacturer authority;
// NO client Firestore writes; NO parallel validator; NO parallel status vocabulary (client mirror; the
// command re-validates). FAIL-CLOSED: MANUFACTURER_WRITE_READY=false -> write-disabled + zero callable
// attempts. Honest outcomes; never claims a success it did not receive.
import { useCallback, useEffect, useState } from "react";
import { fetchManufacturerList } from "../../services/manufacturerQueries";
import { useManufacturerWrite } from "../../hooks/useManufacturerWrite";
import { allowedStatusTransitions } from "../../domain/manufacturerWrite";

const STATUS_TONE = {
  ACTIVE: { background: "#e6f4ea", color: "#137333" },
  INACTIVE: { background: "#fef7e0", color: "#b06000" },
};
function StatusBadge({ status }) {
  const tone = STATUS_TONE[status] ?? STATUS_TONE.INACTIVE;
  return <span style={{ ...tone, padding: "2px 8px", borderRadius: 12, fontSize: 12, fontWeight: 600 }}>{status}</span>;
}
const OUTCOME_TONE = {
  applied: { background: "#e6f4ea", color: "#137333" }, replayed: { background: "#e8f0fe", color: "#1a56db" },
  noop: { background: "#e8eaed", color: "#3c4043" }, denied: { background: "#fce8e6", color: "#c5221f" },
  invalid: { background: "#fef7e0", color: "#b06000" }, conflict: { background: "#fef7e0", color: "#b06000" },
  notFound: { background: "#fce8e6", color: "#c5221f" }, unavailable: { background: "#e8eaed", color: "#3c4043" },
  error: { background: "#fce8e6", color: "#c5221f" },
};
function OutcomeBanner({ outcome }) {
  if (!outcome) return null;
  const tone = OUTCOME_TONE[outcome.kind] ?? OUTCOME_TONE.error;
  return <div role="status" style={{ ...tone, padding: "8px 12px", borderRadius: 6, margin: "8px 0", fontSize: 13 }}>{outcome.message}</div>;
}
const INPUT = { padding: 6, fontSize: 13, width: "100%", boxSizing: "border-box" };
const LABEL = { display: "block", fontSize: 12, color: "#5f6368", marginBottom: 4 };

export default function Manufacturers(props) {
  const [state, setState] = useState({ phase: "loading" });
  const [panel, setPanel] = useState(null); // {mode:"create"} | {mode:"edit", m} | {mode:"status", m}
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const { writeReady, runCreate, runRename, runChangeStatus } = useManufacturerWrite(props?.writeDeps);

  const load = useCallback(() => {
    let cancelled = false;
    setState({ phase: "loading" });
    fetchManufacturerList().then((r) => {
      if (cancelled) return;
      if (!r.ok) setState({ phase: r.code === "permission-denied" ? "denied" : "error" });
      else setState({ phase: "ready", manufacturers: r.manufacturers, invalidCount: r.invalid.length });
    });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => load(), [load]);

  const openCreate = () => { setForm({}); setOutcome(null); setPanel({ mode: "create" }); };
  const openEdit = (m) => { setForm({ name: m.name }); setOutcome(null); setPanel({ mode: "edit", m }); };
  const openStatus = (m) => { setOutcome(null); setPanel({ mode: "status", m }); };
  const close = () => { setPanel(null); setForm({}); };
  const afterWrite = useCallback((o) => { setOutcome(o); if (o.kind === "applied" || o.kind === "replayed") { close(); load(); } }, [load]);

  const submitCreate = async () => { setBusy(true); afterWrite(await runCreate(form)); setBusy(false); };
  const submitEdit = async () => { setBusy(true); afterWrite(await runRename(panel.m.manufacturerId, panel.m.version, form, panel.m)); setBusy(false); };
  const submitStatus = async (s) => { setBusy(true); afterWrite(await runChangeStatus(panel.m.manufacturerId, panel.m.version, s)); setBusy(false); };

  if (state.phase === "loading") return <p>Loading Manufacturers…</p>;
  if (state.phase === "denied") return <p>You do not have access to Manufacturers. Contact an administrator if you believe this is an error.</p>;
  if (state.phase === "error") return <p>Manufacturers are currently unavailable. Try again later.</p>;

  const list = state.manufacturers ?? [];
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Manufacturers</h2>
        <button onClick={openCreate} disabled={busy} style={{ padding: "8px 14px", fontSize: 13, fontWeight: 600, borderRadius: 6, border: "1px solid #1a73e8", background: "#1a73e8", color: "white", cursor: "pointer" }}>New manufacturer</button>
      </div>
      <p style={{ color: "#5f6368", fontSize: 13 }}>
        Governed manufacturer reference records that Parts link to. Create, rename, and activate/deactivate
        here; every change goes through the catalog administration service and is authorized server-side.
        {state.invalidCount > 0 ? ` ${state.invalidCount} malformed record(s) were excluded and need review.` : ""}
      </p>
      {!writeReady && (
        <div style={{ background: "#e8eaed", color: "#3c4043", padding: "8px 12px", borderRadius: 6, fontSize: 13, marginBottom: 8 }}>
          Editing isn’t enabled in this environment yet. You can review manufacturers; create/rename/status
          changes are activated with the catalog administration service (a governed deployment + grant).
        </div>
      )}
      {!panel && <OutcomeBanner outcome={outcome} />}

      {panel && (
        <div style={{ border: "1px solid #dadce0", borderRadius: 8, padding: 16, margin: "8px 0", background: "#fff" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>{panel.mode === "create" ? "New manufacturer" : panel.mode === "edit" ? `Rename ${panel.m.manufacturerId}` : `Change status — ${panel.m.manufacturerId}`}</h3>
            <button onClick={close} disabled={busy} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 18, color: "#5f6368" }}>×</button>
          </div>
          <OutcomeBanner outcome={outcome} />
          {panel.mode === "status" ? (
            <div>
              <p style={{ fontSize: 13, color: "#5f6368" }}>Current status: <StatusBadge status={panel.m.status} />. Choose a governed transition:</p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {allowedStatusTransitions(panel.m.status).map((s) => (
                  <button key={s} onClick={() => submitStatus(s)} disabled={busy || !writeReady} style={{ padding: "8px 14px", fontSize: 13, borderRadius: 6, border: "1px solid #dadce0", background: "#fff", cursor: writeReady ? "pointer" : "not-allowed" }}>→ {s}</button>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ maxWidth: 420 }}>
              {panel.mode === "create" && (
                <div style={{ marginBottom: 10 }}><label style={LABEL}>Manufacturer ID</label><input style={INPUT} value={form.manufacturerId ?? ""} onChange={(e) => setForm((f) => ({ ...f, manufacturerId: e.target.value }))} disabled={busy || !writeReady} /></div>
              )}
              <div style={{ marginBottom: 10 }}><label style={LABEL}>Name</label><input style={INPUT} value={form.name ?? ""} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} disabled={busy || !writeReady} /></div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={panel.mode === "create" ? submitCreate : submitEdit} disabled={busy || !writeReady} style={{ padding: "8px 16px", fontSize: 13, fontWeight: 600, borderRadius: 6, border: "1px solid #1a73e8", background: writeReady ? "#1a73e8" : "#c6d4f0", color: "white", cursor: writeReady ? "pointer" : "not-allowed" }}>{busy ? "Saving…" : panel.mode === "create" ? "Create manufacturer" : "Save name"}</button>
                <button onClick={close} disabled={busy} style={{ padding: "8px 16px", fontSize: 13, borderRadius: 6, border: "1px solid #dadce0", background: "#fff", cursor: "pointer" }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {list.length === 0 ? (
        <p>No manufacturers are recorded yet. Use “New manufacturer” to create the first governed record.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr style={{ textAlign: "left", borderBottom: "2px solid #dadce0" }}><th style={{ padding: 8 }}>ID</th><th style={{ padding: 8 }}>Name</th><th style={{ padding: 8 }}>Status</th><th style={{ padding: 8 }}>Actions</th></tr></thead>
          <tbody>
            {list.map((m) => (
              <tr key={m.manufacturerId} style={{ borderBottom: "1px solid #f1f3f4" }}>
                <td style={{ padding: 8, fontFamily: "monospace" }}>{m.manufacturerId}</td>
                <td style={{ padding: 8 }}>{m.name}</td>
                <td style={{ padding: 8 }}><StatusBadge status={m.status} /></td>
                <td style={{ padding: 8, whiteSpace: "nowrap" }}>
                  <button onClick={() => openEdit(m)} disabled={busy} style={{ marginRight: 6, padding: "4px 10px", fontSize: 12, borderRadius: 4, border: "1px solid #dadce0", background: "#fff", cursor: "pointer" }}>Rename</button>
                  <button onClick={() => openStatus(m)} disabled={busy} style={{ padding: "4px 10px", fontSize: 12, borderRadius: 4, border: "1px solid #dadce0", background: "#fff", cursor: "pointer" }}>Status</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
