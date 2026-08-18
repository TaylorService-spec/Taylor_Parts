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
//
// S-INV-MANUFACTURERS -- the list itself now renders through the metadata list runtime
// (manufacturerIndexList/manufacturerEntity, definitions/manufacturer.js), the same
// column/state/cell contract every other migrated INDEX surface uses
// (AccountsList.jsx/MetadataListGrid.jsx), rather than a hand-rolled <table>.
//
// NOT THROUGH useMetadataList/buildQueryDescriptor. getManufacturerCatalog is a single
// UNBOUNDED read of the whole catalog with no `limit`/`cursor` parameters and an envelope
// shape ({status, manufacturers, excludedCount}) callableListSource.js's CALLABLE_SOURCES
// registry does not (and, being outside this lane's writeScope -- src/metadata/** -- could
// not) declare. Routing this surface's fetch through useMetadataList would either silently
// ignore the descriptor's bound/cursor (dishonest) or throw at every load ("no known
// response mapping for readCallable"). So the EXISTING fetchManufacturerList() read is kept
// exactly as-is (ONE read, unchanged), and its result is reshaped in memory into the same
// `{rows, hasMore}` page shape buildListPresentation expects -- the identical "inject a
// listRenderer over data already flowing instead of issuing a second read" pattern
// definitions/accountPageComponents.js's buildAccountRelatedListPresentation established
// for Contacts/Locations. See buildManufacturersPresentation below, and the handoff notes
// for the exact registration gap this leaves in callableListSource.js (out of writeScope,
// reported rather than worked around).
//
// DECISIONS #106 FIX (X-MANUFACTURER-ID-AS-COLUMN class defect, live in this file until
// now): the table used to render `m.manufacturerId` (the Firestore document id) as its own
// visible "ID" column, and both the Rename and Change Status dialog headers echoed it back
// as `${panel.m.manufacturerId}`. manufacturerEntity declares `identity.nameField: "name"`
// and `referenceField: null` -- there is no business reference, and a missing one is not
// permission to show a record id instead (manufacturer.js's own header makes the same call
// for manufacturerIndexList's columns). All three instances are fixed here: the ID column is
// dropped entirely (manufacturerIndexList declares none), and both dialog headers now read
// the manufacturer's `name`. manufacturerId is still used -- as the row's routing/keying
// value and as the write commands' addressing key -- but never as displayed content.
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchManufacturerList } from "../../services/manufacturerQueries";
import { useManufacturerWrite } from "../../hooks/useManufacturerWrite";
import { allowedStatusTransitions } from "../../domain/manufacturerWrite";
import { manufacturerEntity, manufacturerIndexList } from "../../metadata/definitions/manufacturer.js";
import { buildListPresentation } from "../../metadata/listPresentation.js";
import MetadataListGrid from "../../metadata/MetadataListGrid.jsx";

const STATUS_TONE = {
  ACTIVE: { background: "var(--color-success-surface)", color: "var(--color-success)" },
  INACTIVE: { background: "var(--color-warning-surface)", color: "var(--color-warning)" },
};
// Still used by the Change Status dialog (not the list -- the list's own status cell now
// renders through cellValue's ENUM branch, using manufacturerEntity's declared enumLabels,
// same as every other migrated list's status column).
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

// Preserves this workspace's own, more specific copy over buildListPresentation's generic
// per-state defaults (emptyMessageFor, listPresentation.js) -- overriding is the same
// explicitly-supported "own copy" choice buildAccountRelatedListPresentation exercises.
const EMPTY_MESSAGE = "No manufacturers are recorded yet. Use “New manufacturer” to create the first governed record.";
const DENIED_MESSAGE = "You do not have access to Manufacturers. Contact an administrator if you believe this is an error.";
const UNAVAILABLE_MESSAGE = "Manufacturers are currently unavailable. Try again later.";

/**
 * Reshape this workspace's own load state into a metadata list presentation, without a
 * second read. `state.manufacturers` (when phase === "ready") is the SAME
 * fetchManufacturerList() result the workspace already holds for the write dialogs'
 * `expectedVersion` -- reused, not re-fetched.
 */
export function buildManufacturersPresentation(state) {
  const loading = state.phase === "loading";
  const errorStatus = state.phase === "denied" ? "denied" : state.phase === "error" ? "unavailable" : null;
  const manufacturers = state.phase === "ready" ? state.manufacturers ?? [] : [];
  // `id` is the routing/keying field ONLY -- it is never among the declared columns
  // (manufacturerIndexList: name, status), so cellValue never has a chance to render it.
  const rows = manufacturers.map((m) => ({ id: m.manufacturerId, name: m.name, status: m.status }));
  // getManufacturerCatalog returns the WHOLE catalog, unbounded -- there is no truncation
  // to disclose here (unlike a capped RELATED section), so hasMore is always false.
  const presentation = buildListPresentation({
    def: manufacturerIndexList,
    entity: manufacturerEntity,
    page: { rows, hasMore: false },
    loading,
    errorStatus,
    filtersActive: false,
  });
  const emptyMessage =
    presentation.state === "EMPTY" ? EMPTY_MESSAGE :
    presentation.state === "DENIED" ? DENIED_MESSAGE :
    presentation.state === "UNAVAILABLE" ? UNAVAILABLE_MESSAGE :
    presentation.emptyMessage;
  return { ...presentation, emptyMessage };
}

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

  // MetadataListGrid's row actions receive only the row KEY (manufacturerId) -- the
  // document id routes the row and never labels it (MetadataListGrid.jsx's own comment).
  // This looks the real record back up for the dialogs, which need the full manufacturer.
  const byId = useMemo(() => {
    const map = new Map();
    for (const m of state.manufacturers ?? []) map.set(m.manufacturerId, m);
    return map;
  }, [state.manufacturers]);

  const openCreate = () => { setForm({}); setOutcome(null); setPanel({ mode: "create" }); };
  const openEdit = (m) => { setForm({ name: m.name }); setOutcome(null); setPanel({ mode: "edit", m }); };
  const openStatus = (m) => { setOutcome(null); setPanel({ mode: "status", m }); };
  const close = () => { setPanel(null); setForm({}); };
  const afterWrite = useCallback((o) => { setOutcome(o); if (o.kind === "applied" || o.kind === "replayed") { close(); load(); } }, [load]);

  const submitCreate = async () => { setBusy(true); afterWrite(await runCreate(form)); setBusy(false); };
  const submitEdit = async () => { setBusy(true); afterWrite(await runRename(panel.m.manufacturerId, panel.m.version, form, panel.m)); setBusy(false); };
  const submitStatus = async (s) => { setBusy(true); afterWrite(await runChangeStatus(panel.m.manufacturerId, panel.m.version, s)); setBusy(false); };

  const presentation = useMemo(() => buildManufacturersPresentation(state), [state]);

  // Row actions mirror the original table's per-row Rename/Status buttons exactly:
  // disabled while a write is in flight (`busy`), same as before -- never gated on
  // `writeReady` here (the panel's own Save/transition controls are what enforce that,
  // same as the pre-migration table).
  const rowActions = [
    {
      id: "rename",
      label: "Rename",
      denied: busy,
      onActivate: (rowKey) => { const m = byId.get(rowKey); if (m) openEdit(m); },
    },
    {
      id: "status",
      label: "Status",
      denied: busy,
      onActivate: (rowKey) => { const m = byId.get(rowKey); if (m) openStatus(m); },
    },
  ];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Manufacturers</h2>
        <button onClick={openCreate} disabled={busy} style={{ padding: "8px 14px", fontSize: 13, fontWeight: 600, borderRadius: 6, border: "1px solid var(--color-brand-secondary)", background: "var(--color-brand-secondary)", color: "white", cursor: "pointer" }}>New manufacturer</button>
      </div>
      <p style={{ color: "var(--color-text-secondary)", fontSize: 13 }}>
        Governed manufacturer reference records that Parts link to. Create, rename, and activate/deactivate
        here; every change goes through the catalog administration service and is authorized server-side.
        {state.phase === "ready" && state.invalidCount > 0 ? ` ${state.invalidCount} malformed record(s) were excluded and need review.` : ""}
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
            <h3 style={{ margin: 0, fontSize: 15 }}>{panel.mode === "create" ? "New manufacturer" : panel.mode === "edit" ? `Rename ${panel.m.name}` : `Change status — ${panel.m.name}`}</h3>
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

      <MetadataListGrid presentation={presentation} rowActions={rowActions} caption="Manufacturers" onRetry={load} />
    </div>
  );
}
