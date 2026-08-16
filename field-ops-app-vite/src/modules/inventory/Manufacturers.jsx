// Manufacturer administration workspace (catalog reference object). Closes the referential gap Part
// write created (parts.manufacturerId -> a manageable/readable Manufacturer).
//
// READ via services/manufacturerQueries.fetchManufacturerList -> the trusted `getManufacturerCatalog`
// callable (capability `inventory.catalog.read`). Part 11 reconciliation (2026-08-15): this surface
// used to read the `manufacturers` collection DIRECTLY over the client SDK -- always permission-denied,
// since that collection is Rules-closed (`allow read, write: if false`) for every principal. Revalidated
// rather than repeating that stale blocker: the governed read that already serves the Parts picker
// surfaces now also carries the `version` field this workspace's write actions need for optimistic
// concurrency, so it is reused here as-is -- no new capability, no Rules change, no parallel read path.
//
// WRITE via useManufacturerWrite -> manufacturerCommandClient -> the trusted
// createManufacturer/updateManufacturer/changeManufacturerStatus callables. ONE Manufacturer authority;
// NO client Firestore writes; NO parallel validator; NO parallel status vocabulary (client mirror; the
// command re-validates). FAIL-CLOSED: MANUFACTURER_WRITE_READY=false (config/environments.json, every
// environment today) -> write-disabled + zero callable attempts, independent of the read-side fix above.
// Honest outcomes; never claims a success it did not receive.
import { useCallback, useEffect, useState } from "react";
import { fetchManufacturerList } from "../../services/manufacturerQueries";
import { useManufacturerWrite } from "../../hooks/useManufacturerWrite";
import { allowedStatusTransitions } from "../../domain/manufacturerWrite";

const STATUS_TONE = {
  ACTIVE: { background: "var(--color-success-surface)", color: "var(--color-success)" },
  INACTIVE: { background: "var(--color-warning-surface)", color: "var(--color-warning)" },
};
function StatusBadge({ status }) {
  const tone = STATUS_TONE[status] ?? STATUS_TONE.INACTIVE;
  return <span style={{ ...tone, padding: "2px 8px", borderRadius: 12, fontSize: 12, fontWeight: 600 }}>{status}</span>;
}
const OUTCOME_TONE = {
  applied: { background: "var(--color-success-surface)", color: "var(--color-success)" }, replayed: { background: "var(--color-surface-sunken)", color: "var(--color-info)" },
  noop: { background: "var(--color-border)", color: "var(--color-text-primary)" }, denied: { background: "var(--color-danger-surface)", color: "var(--color-danger)" },
  invalid: { background: "var(--color-warning-surface)", color: "var(--color-warning)" }, conflict: { background: "var(--color-warning-surface)", color: "var(--color-warning)" },
  notFound: { background: "var(--color-danger-surface)", color: "var(--color-danger)" }, unavailable: { background: "var(--color-border)", color: "var(--color-text-primary)" },
  error: { background: "var(--color-danger-surface)", color: "var(--color-danger)" },
};
function OutcomeBanner({ outcome }) {
  if (!outcome) return null;
  const tone = OUTCOME_TONE[outcome.kind] ?? OUTCOME_TONE.error;
  return <div role="status" style={{ ...tone, padding: "8px 12px", borderRadius: 6, margin: "8px 0", fontSize: 13 }}>{outcome.message}</div>;
}
const INPUT = { padding: 6, fontSize: 13, width: "100%", boxSizing: "border-box" };
const LABEL = { display: "block", fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 4 };

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
      else setState({ phase: "ready", manufacturers: r.manufacturers, invalidCount: r.invalidCount });
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
        <button onClick={openCreate} disabled={busy} style={{ padding: "8px 14px", fontSize: 13, fontWeight: 600, borderRadius: 6, border: "1px solid var(--color-brand-secondary)", background: "var(--color-brand-secondary)", color: "white", cursor: "pointer" }}>New manufacturer</button>
      </div>
      <p style={{ color: "var(--color-text-secondary)", fontSize: 13 }}>
        Governed manufacturer reference records that Parts link to. Create, rename, and activate/deactivate
        here; every change goes through the catalog administration service and is authorized server-side.
        {state.invalidCount > 0 ? ` ${state.invalidCount} malformed record(s) were excluded and need review.` : ""}
      </p>
      {!writeReady && (
        <div style={{ background: "var(--color-border)", color: "var(--color-text-primary)", padding: "8px 12px", borderRadius: 6, fontSize: 13, marginBottom: 8 }}>
          Editing isn’t enabled in this environment yet. You can review manufacturers; create/rename/status
          changes are activated with the catalog administration service (a governed deployment + grant).
        </div>
      )}
      {!panel && <OutcomeBanner outcome={outcome} />}

      {panel && (
        <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, padding: 16, margin: "8px 0", background: "#fff" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>{panel.mode === "create" ? "New manufacturer" : panel.mode === "edit" ? `Rename ${panel.m.manufacturerId}` : `Change status — ${panel.m.manufacturerId}`}</h3>
            <button onClick={close} disabled={busy} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 18, color: "var(--color-text-secondary)" }}>×</button>
          </div>
          <OutcomeBanner outcome={outcome} />
          {panel.mode === "status" ? (
            <div>
              <p style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>Current status: <StatusBadge status={panel.m.status} />. Choose a governed transition:</p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {allowedStatusTransitions(panel.m.status).map((s) => (
                  <button key={s} onClick={() => submitStatus(s)} disabled={busy || !writeReady} style={{ padding: "8px 14px", fontSize: 13, borderRadius: 6, border: "1px solid var(--color-border)", background: "#fff", cursor: writeReady ? "pointer" : "not-allowed" }}>→ {s}</button>
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
                <button onClick={panel.mode === "create" ? submitCreate : submitEdit} disabled={busy || !writeReady} style={{ padding: "8px 16px", fontSize: 13, fontWeight: 600, borderRadius: 6, border: "1px solid var(--color-brand-secondary)", background: writeReady ? "var(--color-brand-secondary)" : "var(--color-info-surface)", color: "white", cursor: writeReady ? "pointer" : "not-allowed" }}>{busy ? "Saving…" : panel.mode === "create" ? "Create manufacturer" : "Save name"}</button>
                <button onClick={close} disabled={busy} style={{ padding: "8px 16px", fontSize: 13, borderRadius: 6, border: "1px solid var(--color-border)", background: "#fff", cursor: "pointer" }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {list.length === 0 ? (
        <p>No manufacturers are recorded yet. Use “New manufacturer” to create the first governed record.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr style={{ textAlign: "left", borderBottom: "2px solid var(--color-border)" }}><th style={{ padding: 8 }}>ID</th><th style={{ padding: 8 }}>Name</th><th style={{ padding: 8 }}>Status</th><th style={{ padding: 8 }}>Actions</th></tr></thead>
          <tbody>
            {list.map((m) => (
              <tr key={m.manufacturerId} style={{ borderBottom: "1px solid var(--color-surface-sunken)" }}>
                <td style={{ padding: 8, fontFamily: "monospace" }}>{m.manufacturerId}</td>
                <td style={{ padding: 8 }}>{m.name}</td>
                <td style={{ padding: 8 }}><StatusBadge status={m.status} /></td>
                <td style={{ padding: 8, whiteSpace: "nowrap" }}>
                  <button onClick={() => openEdit(m)} disabled={busy} style={{ marginRight: 6, padding: "4px 10px", fontSize: 12, borderRadius: 4, border: "1px solid var(--color-border)", background: "#fff", cursor: "pointer" }}>Rename</button>
                  <button onClick={() => openStatus(m)} disabled={busy} style={{ padding: "4px 10px", fontSize: 12, borderRadius: 4, border: "1px solid var(--color-border)", background: "#fff", cursor: "pointer" }}>Status</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
