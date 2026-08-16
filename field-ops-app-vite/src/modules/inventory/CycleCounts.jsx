import { useEffect, useMemo, useState } from "react";
import { fetchWarehouses } from "../../services/operationsQueries";
import { fetchMobileLocationDocs } from "../../services/truckRegistryQueries";
import { useCycleCountActions } from "../../hooks/useCycleCountActions";
import { normalizeScanToken, resolveScannedIdentity, SCAN_RESOLUTION } from "../../domain/scannedIdentity";
import WorkspaceHeader from "../../shared/ui/WorkspaceHeader";
import LoadingState from "../../shared/ui/LoadingState";
import EmptyState from "../../shared/ui/EmptyState";

// Enterprise Inventory -- Cycle Count operating authority: the Cycle Counts workspace
// (functions/src/cycleCount/*). Create a count against an active WAREHOUSE/MOBILE(truck) location +
// Part, record the counted quantity/serials, review variance, and reconcile (with a reason required
// on any non-zero variance). Mirrors modules/inventory/Transfers.jsx's honest-posture convention:
// every inventory.cycleCount.* capability is registered `active: false` and granted to NO Role today,
// so every real action attempt resolves `permission-denied` server-side. The controls render (so the
// workspace is reviewable and ready for the day the grant lands) but every call is re-authorized by
// the trusted backend regardless of what this UI shows.
//
// NO LIVE READ: cycle_counts is Rules-denied to every client (Admin-SDK-only, same posture as
// receiving_orders). The list below is SESSION state built entirely from callable responses (see
// useCycleCountActions.js) -- "history" here means "what this tab did this session," not a durable
// cross-session view. That is a deliberate, documented boundary, not an oversight.
//
// SERIAL scan entry REUSES the existing scan identity boundary (domain/scannedIdentity.js) against
// this count's own expected-serial snapshot as the candidate set -- it does NOT stand up a second
// scanner. A token that resolves is added as an expected hit; a token that does not resolve is still
// offered as an "unexpected" find (the count's job is to capture what is physically there, not to
// silently reject it).

function LocationLabel({ location }) {
  if (!location) return <span className="fo-muted">—</span>;
  return (
    <span>
      {location.locationId}
      {location.type === "MOBILE" && <span className="fo-transfer-endpoint-type"> truck</span>}
    </span>
  );
}

function statusTone(status) {
  switch (status) {
    case "OPEN": return "pending";
    case "COUNTED": return "active";
    case "RECONCILED": return "done";
    case "CANCELLED": return "muted";
    default: return "muted";
  }
}

function CreateCycleCountForm({ warehouseOptions, truckOptions, submitting, onCancel, onSubmit }) {
  const [partId, setPartId] = useState("");
  const [locationType, setLocationType] = useState("WAREHOUSE");
  const [locationId, setLocationId] = useState("");
  const [errors, setErrors] = useState({});
  const options = locationType === "MOBILE" ? truckOptions : warehouseOptions;

  return (
    <form
      className="fo-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const result = await onSubmit({ partId, locationType, locationId });
        if (!result.ok) setErrors(result.errors || {});
      }}
    >
      <label>
        Part
        <input value={partId} onChange={(e) => setPartId(e.target.value)} placeholder="Part ID" />
        {errors.partId && <span className="fo-form-error">{errors.partId}</span>}
      </label>
      <label>
        Location type
        <select value={locationType} onChange={(e) => { setLocationType(e.target.value); setLocationId(""); }}>
          <option value="WAREHOUSE">Warehouse</option>
          <option value="MOBILE">Truck</option>
        </select>
      </label>
      <label>
        Location
        <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
          <option value="">Select…</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
        {errors.locationId && <span className="fo-form-error">{errors.locationId}</span>}
      </label>
      <div className="fo-form-actions">
        <button type="submit" className="fo-btn-primary" disabled={submitting}>
          {submitting ? "Starting…" : "Start count"}
        </button>
        <button type="button" className="fo-btn-secondary" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function NoneCountEntry({ count, busy, onSubmit }) {
  const [value, setValue] = useState("");
  return (
    <form
      className="fo-inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ countedQuantity: Number(value) });
      }}
    >
      <span className="fo-muted">Expected: {count.expectedQuantity}</span>
      <input
        type="number"
        min="0"
        step="1"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Counted quantity"
        aria-label="Counted quantity"
      />
      <button type="submit" className="fo-transfer-action-btn" disabled={busy || value === ""}>
        {busy ? "Recording…" : "Record count"}
      </button>
    </form>
  );
}

function SerialCountEntry({ count, busy, onSubmit }) {
  const [scanInput, setScanInput] = useState("");
  const [counted, setCounted] = useState([]);
  const [feedback, setFeedback] = useState(null);
  const expected = count.expectedSerialNumbers ?? [];
  const candidates = useMemo(() => ({ serializedAssets: expected.map((serialNo) => ({ serialNo, partId: count.partId })) }), [expected, count.partId]);

  const addToken = (raw) => {
    const identity = resolveScannedIdentity(raw, candidates);
    if (identity.resolutionState === SCAN_RESOLUTION.INVALID) {
      setFeedback({ kind: "error", message: "That doesn't look like a usable serial number." });
      return;
    }
    const token = normalizeScanToken(raw);
    if (counted.includes(token)) {
      setFeedback({ kind: "info", message: `${token} was already added.` });
      return;
    }
    setCounted((prev) => [...prev, token]);
    setFeedback(
      identity.resolutionState === SCAN_RESOLUTION.RESOLVED
        ? { kind: "success", message: `${token} — expected here.` }
        : { kind: "warning", message: `${token} — not on this count's expected list (recorded as an unexpected find).` },
    );
    setScanInput("");
  };

  return (
    <div className="fo-inline-form fo-inline-form--stacked">
      <span className="fo-muted">Expected units: {expected.length}</span>
      <div className="fo-inline-form">
        <input
          value={scanInput}
          onChange={(e) => setScanInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); if (scanInput.trim()) addToken(scanInput); }
          }}
          placeholder="Scan or type a serial number"
          aria-label="Scan or type a serial number"
        />
        <button type="button" className="fo-transfer-action-btn" onClick={() => scanInput.trim() && addToken(scanInput)}>
          Add
        </button>
      </div>
      {feedback && <p className={feedback.kind === "error" ? "fo-warning" : "fo-muted"} role="status">{feedback.message}</p>}
      {counted.length > 0 && (
        <ul className="fo-chip-list">
          {counted.map((sn) => (
            <li key={sn} className="fo-chip">
              {sn}
              <button type="button" aria-label={`Remove ${sn}`} onClick={() => setCounted((prev) => prev.filter((s) => s !== sn))}>×</button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        className="fo-btn-primary"
        disabled={busy}
        onClick={() => onSubmit({ countedSerialNumbers: counted })}
      >
        {busy ? "Recording…" : "Record count"}
      </button>
    </div>
  );
}

function VarianceSummary({ count }) {
  if (count.trackingMode === "SERIAL") {
    const sv = count.serialVariance;
    if (!sv) return null;
    if (sv.missing.length === 0 && sv.unexpected.length === 0) return <p className="fo-muted">No variance — every expected unit was counted.</p>;
    return (
      <div>
        {sv.missing.length > 0 && (
          <p className="fo-warning">Missing ({sv.missing.length}): {sv.missing.join(", ")}</p>
        )}
        {sv.unexpected.length > 0 && (
          <p className="fo-warning">Unexpected ({sv.unexpected.length}): {sv.unexpected.join(", ")}</p>
        )}
      </div>
    );
  }
  if (count.variance === undefined) return null;
  if (count.variance === 0) return <p className="fo-muted">No variance — counted matches expected.</p>;
  const sign = count.variance > 0 ? "+" : "";
  return <p className="fo-warning">Variance: {sign}{count.variance} ({count.countedQuantity} counted vs {count.expectedQuantity} expected)</p>;
}

function ReconcileForm({ count, busy, onSubmit }) {
  const [reason, setReason] = useState("");
  const hasVariance =
    count.trackingMode === "SERIAL"
      ? (count.serialVariance?.missing.length ?? 0) > 0 || (count.serialVariance?.unexpected.length ?? 0) > 0
      : (count.variance ?? 0) !== 0;
  return (
    <form
      className="fo-inline-form fo-inline-form--stacked"
      onSubmit={(e) => { e.preventDefault(); onSubmit(reason); }}
    >
      {hasVariance && (
        <label>
          Reconciliation reason (required for a non-zero variance)
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
        </label>
      )}
      <button type="submit" className="fo-btn-primary" disabled={busy || (hasVariance && reason.trim() === "")}>
        {busy ? "Reconciling…" : "Reconcile"}
      </button>
    </form>
  );
}

function CycleCountRow({ count, busy, onSubmitCount, onReconcile, onCancel }) {
  return (
    <li className="fo-panel fo-panel--nested">
      <div className="fo-transfer-status-row">
        <strong>{count.partId ?? count.cycleCountId}</strong>
        <span className={`fo-transfer-status fo-transfer-status--${statusTone(count.status)}`}>{count.status}</span>
      </div>
      <p className="fo-muted">
        Location: <LocationLabel location={count.location} /> · Mode: {count.trackingMode ?? "…"}
      </p>

      {count.status === "OPEN" && (
        <>
          {count.trackingMode === "SERIAL" ? (
            <SerialCountEntry count={count} busy={busy} onSubmit={(draft) => onSubmitCount(count.cycleCountId, draft)} />
          ) : (
            <NoneCountEntry count={count} busy={busy} onSubmit={(draft) => onSubmitCount(count.cycleCountId, draft)} />
          )}
          <button type="button" className="fo-transfer-action-btn fo-transfer-action-btn--muted" disabled={busy} onClick={() => onCancel(count.cycleCountId)}>
            Cancel count
          </button>
        </>
      )}

      {count.status === "COUNTED" && (
        <>
          <VarianceSummary count={count} />
          <ReconcileForm count={count} busy={busy} onSubmit={(reason) => onReconcile(count.cycleCountId, reason)} />
        </>
      )}

      {count.status === "RECONCILED" && (
        <>
          <VarianceSummary count={count} />
          {count.reconciliationReason && <p className="fo-muted">Reason: {count.reconciliationReason}</p>}
          <p className="fo-muted">
            {count.ledgerEventIds?.length ? `${count.ledgerEventIds.length} ledger adjustment(s) recorded.` : "No adjustment needed — exact match."}
          </p>
        </>
      )}

      {count.status === "CANCELLED" && <p className="fo-muted">Cancelled — no ledger effect.</p>}
    </li>
  );
}

export default function CycleCounts() {
  const [showForm, setShowForm] = useState(false);
  const { status, clearStatus, busyId, counts, createCount, submitCount, reconcileCount, cancelCount } = useCycleCountActions();

  const [locations, setLocations] = useState({ loading: true, warehouses: [], trucks: [] });
  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchWarehouses(), fetchMobileLocationDocs()])
      .then(([warehouses, truckDocs]) => {
        if (cancelled) return;
        setLocations({
          loading: false,
          warehouses: (Array.isArray(warehouses) ? warehouses : []).map((w) => ({ id: w.id, label: w.name || w.id })),
          trucks: (Array.isArray(truckDocs) ? truckDocs : [])
            .filter((d) => d?.data?.active !== false)
            .map((d) => ({ id: d.docId, label: d.data?.displayLabel || d.docId })),
        });
      })
      .catch(() => { if (!cancelled) setLocations({ loading: false, warehouses: [], trucks: [] }); });
    return () => { cancelled = true; };
  }, []);

  const intro = (
    <p className="fo-muted">
      Count a Part's on-hand quantity or serialized units at a location against the governed ledger/registry
      authority, review any variance, and reconcile with an auditable adjustment.
    </p>
  );

  return (
    <div className="fo-panel">
      <WorkspaceHeader title="Cycle Counts">
        {!showForm && (
          <button type="button" className="fo-btn-primary" onClick={() => setShowForm(true)}>
            New count
          </button>
        )}
      </WorkspaceHeader>
      {intro}
      {status && (
        <p className={status.kind === "error" ? "fo-warning" : "fo-muted"} role={status.kind === "error" ? "alert" : "status"}>
          {status.message}{" "}
          <button type="button" className="fo-transfer-dismiss" onClick={clearStatus}>Dismiss</button>
        </p>
      )}

      {showForm && locations.loading && <LoadingState>Loading locations…</LoadingState>}
      {showForm && !locations.loading && (
        <CreateCycleCountForm
          warehouseOptions={locations.warehouses}
          truckOptions={locations.trucks}
          submitting={busyId === "create"}
          onCancel={() => setShowForm(false)}
          onSubmit={async (draft) => {
            const result = await createCount(draft);
            if (result.ok) setShowForm(false);
            return result;
          }}
        />
      )}

      {counts.length === 0 ? (
        <EmptyState
          variant="database"
          title="No cycle counts this session"
          message="Counts you start appear here. History is session-scoped — there is no durable cross-session list yet."
        />
      ) : (
        <ul className="fo-list">
          {counts.map((count) => (
            <CycleCountRow
              key={count.cycleCountId}
              count={count}
              busy={busyId === count.cycleCountId}
              onSubmitCount={submitCount ? (id, draft) => submitCount(id, count.trackingMode, draft) : undefined}
              onReconcile={reconcileCount}
              onCancel={cancelCount}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
