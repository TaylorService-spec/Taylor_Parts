import { useCallback, useEffect, useState } from "react";
import { fetchWarehouses } from "../../services/operationsQueries";
import { fetchMobileLocationDocs } from "../../services/truckRegistryQueries";
import { cycleCountCommandClient } from "../../services/cycleCountCommandClient";
import {
  buildCreateSheetRequest, buildSubmitLineRequest, buildReconcileLineRequest,
} from "../../domain/cycleCountCommandRequest";
import { mapCycleCountActionError, describeCycleCountOutcome } from "../../domain/cycleCountActionResult";
import { loadErrorMessage } from "../../domain/loadErrorMessage";
import WorkspaceHeader from "../../shared/ui/WorkspaceHeader";
import LoadingState from "../../shared/ui/LoadingState";
import EmptyState from "../../shared/ui/EmptyState";
import { Button } from "../../shared/ui/primitives/index.js";

// CYCLE COUNTS -- the durable workspace over count SHEETS (Cycle Count A1 + A4, Decision #179).
//
// A sheet is one governed location; each Part counted there is a line. Counters mostly work from
// Scan → Cycle count (bin first, many parts). This workspace is where counts are FOUND again -- from any
// device, through the governed read (listCycleCountSheets / getCycleCountSheet), never a client
// `cycle_counts` read -- and where a reviewer disposes of each counted line.
//
// BLIND, PER LINE. A line's expected value and variance are shown only once THAT line is submitted; the
// server does not even send them for an open line, so there is nothing here to hide.
//
// OBSERVATION IS NOT ADJUSTMENT. Approving a counted line with a variance is what stages the ledger
// adjustment -- for that line, at that exact location, in one transaction. Rejecting records a dispute
// and moves nothing. A reason is required either way when the count differs. A reviewer cannot approve
// or reject a MATERIAL variance on a line they counted themselves; the server refuses it and the reason
// is shown on that line.

const FILTERS = [
  { value: "OPEN", label: "Open" },
  { value: "CLOSED", label: "Closed" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "", label: "All" },
];
const TYPE_LABEL = { BIN: "Bin", WAREHOUSE: "Warehouse", MOBILE: "Truck" };
const STATUS_TEXT = { OPEN: "Not counted", COUNTED: "Counted -- awaiting review", RECONCILED: "Approved", REJECTED: "Rejected", CANCELLED: "Removed" };

export default function CycleCounts({ deps }) {
  const client = deps?.cycleCountClient ?? cycleCountCommandClient;
  const [filter, setFilter] = useState("OPEN");
  const [sheets, setSheets] = useState({ loading: true, rows: [], nextCursor: null, error: null });
  const [selected, setSelected] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [status, setStatus] = useState(null);

  const load = useCallback(async (cursor = null) => {
    setSheets((s) => ({ ...s, loading: true, error: null }));
    try {
      const page = await client.listCycleCountSheets({ ...(filter ? { status: filter } : {}), ...(cursor ? { cursor } : {}) });
      setSheets((s) => ({ loading: false, rows: cursor ? [...s.rows, ...(page.sheets ?? [])] : (page.sheets ?? []), nextCursor: page.nextCursor ?? null, error: null }));
    } catch (err) {
      setSheets({ loading: false, rows: [], nextCursor: null, error: mapCycleCountActionError(err) });
    }
  }, [client, filter]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="fo-panel">
      <WorkspaceHeader title="Cycle Counts">
        {!showCreate && <Button variant="primary" onClick={() => setShowCreate(true)}>New count</Button>}
      </WorkspaceHeader>
      <p className="fo-muted">
        Counts are kept on the server: open one to continue counting or to review it. Bins are counted from
        Scan → Cycle count. An expected quantity appears only after that part has been counted.
      </p>
      {status && (
        <p className={status.kind === "error" ? "fo-warning" : "fo-muted"} role={status.kind === "error" ? "alert" : "status"}>
          {status.message} <button type="button" className="fo-transfer-dismiss" onClick={() => setStatus(null)}>Dismiss</button>
        </p>
      )}

      {showCreate && (
        <CreateSheetForm client={client} onCancel={() => setShowCreate(false)} onCreated={(sheet) => {
          setShowCreate(false); setStatus({ kind: "ok", message: describeCycleCountOutcome("createSheet", "applied") });
          setSelected(sheet.sheetId); load();
        }} />
      )}

      {selected ? (
        <SheetDetail client={client} sheetId={selected} onBack={() => { setSelected(null); load(); }} onStatus={setStatus} />
      ) : (
        <>
          <label className="fo-inline-form">
            Show{" "}
            <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Show counts">
              {FILTERS.map((f) => <option key={f.label} value={f.value}>{f.label}</option>)}
            </select>
          </label>
          {sheets.error && <p className="fo-warning" role="alert">{sheets.error}</p>}
          {sheets.loading && sheets.rows.length === 0 ? <LoadingState>Loading counts…</LoadingState> : null}
          {!sheets.loading && !sheets.error && sheets.rows.length === 0 && (
            <EmptyState variant="database" title="No counts here" message="Start a count, or scan a bin from Scan → Cycle count." />
          )}
          {sheets.rows.length > 0 && (
            <ul className="fo-list" aria-label="Count sheets">
              {sheets.rows.map((s) => (
                <li key={s.sheetId}>
                  <button type="button" className="fo-link-btn" onClick={() => setSelected(s.sheetId)}>
                    {TYPE_LABEL[s.location?.type] ?? "Location"} {s.locationLabel ?? s.location?.locationId}
                  </button>{" "}
                  <span className="fo-muted">· {s.status} · started {new Date(s.createdAt).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
          {sheets.nextCursor && <Button variant="secondary" onClick={() => load(sheets.nextCursor)} disabled={sheets.loading}>Load more</Button>}
        </>
      )}
    </div>
  );
}

function CreateSheetForm({ client, onCancel, onCreated }) {
  const [locationType, setLocationType] = useState("WAREHOUSE");
  const [locationId, setLocationId] = useState("");
  const [options, setOptions] = useState({ loading: true, warehouses: [], trucks: [], warehousesError: null, trucksError: null });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    Promise.allSettled([fetchWarehouses(), fetchMobileLocationDocs()]).then(([w, t]) => {
      if (!live) return;
      setOptions({
        loading: false,
        warehousesError: w.status === "rejected" ? w.reason : null,
        trucksError: t.status === "rejected" ? t.reason : null,
        warehouses: (w.status === "fulfilled" && Array.isArray(w.value) ? w.value : []).map((x) => ({ id: x.id, label: x.name || x.id })),
        trucks: (t.status === "fulfilled" && Array.isArray(t.value) ? t.value : []).filter((d) => d?.data?.active !== false).map((d) => ({ id: d.docId, label: d.data?.displayLabel || d.docId })),
      });
    });
    return () => { live = false; };
  }, []);

  const list = locationType === "MOBILE" ? options.trucks : options.warehouses;
  const listError = locationType === "MOBILE" ? options.trucksError : options.warehousesError;

  return (
    <form className="fo-form" onSubmit={async (e) => {
      e.preventDefault();
      const built = buildCreateSheetRequest({ locationType, locationId });
      if (!built.ok) { setError(Object.values(built.errors)[0]); return; }
      setBusy(true); setError(null);
      try { onCreated(await client.createCycleCountSheet(built.value)); }
      catch (err) { setError(mapCycleCountActionError(err)); }
      finally { setBusy(false); }
    }}>
      <label>
        Where
        <select value={locationType} onChange={(e) => { setLocationType(e.target.value); setLocationId(""); }}>
          <option value="WAREHOUSE">Warehouse</option>
          <option value="MOBILE">Truck</option>
        </select>
      </label>
      <label>
        Location
        {options.loading ? <span className="fo-muted"> Loading…</span> : (
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)} disabled={list.length === 0}>
            <option value="">{listError ? "Unavailable" : list.length === 0 ? "None available" : "Select…"}</option>
            {list.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        )}
        {listError && <span className="fo-form-error" role="alert">{loadErrorMessage(listError, { entity: locationType === "MOBILE" ? "trucks" : "warehouses" })}</span>}
      </label>
      {error && <p className="fo-form-error" role="alert">{error}</p>}
      <div className="fo-form-actions">
        <Button type="submit" variant="primary" disabled={busy}>{busy ? "Starting…" : "Start count"}</Button>
        <button type="button" className="fo-btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </form>
  );
}

function SheetDetail({ client, sheetId, onBack, onStatus }) {
  const [state, setState] = useState({ loading: true, sheet: null, lines: [], error: null });
  const [busy, setBusy] = useState(null); // partId | "sheet"
  const [lineErrors, setLineErrors] = useState({});

  const reload = useCallback(async () => {
    try {
      let cursor = null; const lines = []; let sheet = null;
      do { // every page: a review must never quietly show only its first lines
        const page = await client.getCycleCountSheet({ sheetId, ...(cursor ? { cursor } : {}) });
        sheet = page.sheet; lines.push(...(page.lines ?? [])); cursor = page.nextCursor ?? null;
      } while (cursor);
      setState({ loading: false, sheet, lines, error: null });
    } catch (err) {
      setState({ loading: false, sheet: null, lines: [], error: mapCycleCountActionError(err) });
    }
  }, [client, sheetId]);
  useEffect(() => { reload(); }, [reload]);

  const act = async (key, fn, label, decision) => {
    setBusy(key); setLineErrors((e) => ({ ...e, [key]: null }));
    try {
      const out = await fn();
      onStatus({ kind: "ok", message: describeCycleCountOutcome(label, out?.outcome, decision) });
      await reload();
    } catch (err) {
      setLineErrors((e) => ({ ...e, [key]: mapCycleCountActionError(err) }));
    } finally { setBusy(null); }
  };

  if (state.loading) return <LoadingState>Loading count…</LoadingState>;
  if (state.error) return <><p className="fo-warning" role="alert">{state.error}</p><Button variant="secondary" onClick={onBack}>Back to counts</Button></>;
  const { sheet, lines } = state;
  const open = sheet.status === "OPEN";
  const live = lines.filter((l) => l.status !== "CANCELLED");
  const canClose = open && live.length > 0 && live.every((l) => l.status === "RECONCILED" || l.status === "REJECTED");
  const canCancel = open && !lines.some((l) => ["COUNTED", "RECONCILED", "REJECTED"].includes(l.status));

  return (
    <section aria-label="Count sheet">
      <Button variant="tertiary" onClick={onBack}>← All counts</Button>
      <h3>{TYPE_LABEL[sheet.location?.type] ?? "Location"} {sheet.locationLabel ?? sheet.location?.locationId} <span className="fo-muted">· {sheet.status}</span></h3>

      {open && sheet.location?.type !== "BIN" && <AddPartLine onAdd={(partId) => act("add", () => client.openCycleCountLine({ sheetId, partId }), "openLine")} busy={busy !== null} />}
      {lineErrors.add && <p className="fo-warning" role="alert">{lineErrors.add}</p>}

      {lines.length === 0 ? <p className="fo-muted">No parts counted yet.</p> : (
        <ul className="fo-list" aria-label="Lines">
          {lines.map((l) => (
            <li key={l.partId}>
              <strong>{l.partId}</strong> <span className="fo-muted">· {STATUS_TEXT[l.status] ?? l.status}</span>
              <LineFigures line={l} />
              {l.reconciliationReason && <p className="fo-muted">Reason: {l.reconciliationReason}</p>}
              {open && l.status === "OPEN" && (
                <CountEntry line={l} busy={busy === l.partId} onSubmit={(draft) => {
                  const built = buildSubmitLineRequest(sheetId, l.partId, l.trackingMode, draft);
                  if (!built.ok) { setLineErrors((e) => ({ ...e, [l.partId]: Object.values(built.errors)[0] })); return; }
                  act(l.partId, () => client.submitCycleCountLine(built.value), "submit");
                }} onRemove={() => act(l.partId, () => client.cancelCycleCountLine({ sheetId, partId: l.partId }), "cancelLine")} />
              )}
              {open && l.status === "COUNTED" && (
                <ReviewLine line={l} busy={busy === l.partId} onDecide={(reason, decision) => {
                  const built = buildReconcileLineRequest(sheetId, l.partId, reason, decision);
                  if (built.ok) act(l.partId, () => client.reconcileCycleCountLine(built.value), "reconcile", decision);
                }} />
              )}
              {lineErrors[l.partId] && <p className="fo-warning" role="alert">{lineErrors[l.partId]}</p>}
            </li>
          ))}
        </ul>
      )}

      <div className="fo-form-actions">
        {canClose && <Button variant="primary" disabled={busy !== null} onClick={() => act("sheet", () => client.closeCycleCountSheet({ sheetId }), "closeSheet")}>Close this count</Button>}
        {canCancel && <button type="button" className="fo-btn-secondary" disabled={busy !== null} onClick={() => act("sheet", () => client.cancelCycleCountSheet({ sheetId }), "cancelSheet")}>Cancel this count</button>}
      </div>
      {lineErrors.sheet && <p className="fo-warning" role="alert">{lineErrors.sheet}</p>}
    </section>
  );
}

/** Figures only for a SUBMITTED line -- the server sends nothing else, and nothing else is shown. */
function LineFigures({ line }) {
  if (!["COUNTED", "RECONCILED", "REJECTED"].includes(line.status)) return null;
  if (line.trackingMode === "SERIAL") {
    const sv = line.serialVariance ?? {};
    return (
      <ul className="fo-list">
        <li>Counted: {line.countedSerialNumbers?.length ?? 0} of {line.expectedQuantity} expected</li>
        <li>Expected but not found: {sv.missing?.length ? sv.missing.join(", ") : "none"}</li>
        <li>Found but not expected: {sv.unexpected?.length ? sv.unexpected.join(", ") : "none"}</li>
      </ul>
    );
  }
  return (
    <p>
      Counted {line.countedQuantity} · expected {line.expectedQuantity} ·{" "}
      {line.variance === 0 ? "matches" : `variance ${line.variance > 0 ? "+" : ""}${line.variance}`}
    </p>
  );
}

function AddPartLine({ onAdd, busy }) {
  const [partId, setPartId] = useState("");
  return (
    <form className="fo-inline-form" onSubmit={(e) => { e.preventDefault(); if (partId.trim()) { onAdd(partId.trim()); setPartId(""); } }}>
      <input value={partId} onChange={(e) => setPartId(e.target.value)} placeholder="Part ID" aria-label="Part to count" />
      <button type="submit" className="fo-transfer-action-btn" disabled={busy || partId.trim() === ""}>Add part</button>
    </form>
  );
}

function CountEntry({ line, busy, onSubmit, onRemove }) {
  const [value, setValue] = useState("");
  const serial = line.trackingMode === "SERIAL";
  return (
    <form className="fo-inline-form" onSubmit={(e) => {
      e.preventDefault();
      onSubmit(serial ? { countedSerialNumbers: value.split(/[\s,]+/).filter(Boolean) } : { countedQuantity: Number(value) });
    }}>
      {/* Blind: no expected figure here, and the server never sent one for this open line. */}
      {serial
        ? <textarea value={value} onChange={(e) => setValue(e.target.value)} placeholder="Serial numbers found (one per line)" aria-label="Serial numbers counted" />
        : <input type="number" min="0" step="1" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Counted quantity" aria-label="Counted quantity" />}
      <button type="submit" className="fo-transfer-action-btn" disabled={busy || (!serial && value === "")}>{busy ? "Recording…" : "Record count"}</button>
      <button type="button" className="fo-transfer-action-btn fo-transfer-action-btn--muted" disabled={busy} onClick={onRemove}>Remove part</button>
    </form>
  );
}

function ReviewLine({ line, busy, onDecide }) {
  const [reason, setReason] = useState("");
  const differs = line.trackingMode === "SERIAL"
    ? ((line.serialVariance?.missing?.length ?? 0) + (line.serialVariance?.unexpected?.length ?? 0)) > 0
    : line.variance !== 0;
  const needsReason = differs && reason.trim() === "";
  return (
    <form className="fo-inline-form" onSubmit={(e) => e.preventDefault()}>
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={differs ? "Reason (required)" : "Reason (optional)"} aria-label="Review reason" />
      <button type="button" className="fo-transfer-action-btn" disabled={busy || needsReason} onClick={() => onDecide(reason, "APPROVE")}>
        {differs ? "Approve and adjust" : "Approve"}
      </button>
      <button type="button" className="fo-transfer-action-btn fo-transfer-action-btn--muted" disabled={busy || needsReason} onClick={() => onDecide(reason, "REJECT")}>Reject</button>
    </form>
  );
}
