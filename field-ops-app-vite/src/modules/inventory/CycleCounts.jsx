import { useEffect, useMemo, useState } from "react";
import { fetchWarehouses } from "../../services/operationsQueries";
import { fetchMobileLocationDocs } from "../../services/truckRegistryQueries";
import { useCycleCountActions } from "../../hooks/useCycleCountActions";
import { normalizeScanToken, resolveScannedIdentity, SCAN_RESOLUTION } from "../../domain/scannedIdentity";
import WorkspaceHeader from "../../shared/ui/WorkspaceHeader";
import LoadingState from "../../shared/ui/LoadingState";
import EmptyState from "../../shared/ui/EmptyState";
import { Button } from "../../shared/ui/primitives/index.js";

// Enterprise Inventory -- Cycle Count operating authority: the Cycle Counts workspace
// (functions/src/cycleCount/*). Create a count against an active WAREHOUSE/MOBILE(truck) location +
// Part, record the counted quantity/serials, review variance, and let a manager APPROVE (stage the
// ADJUSTED ledger correction) or REJECT (record the count as disputed, no ledger effect) it -- a reason
// is required either way on any non-zero variance. Mirrors modules/inventory/Transfers.jsx's honest-
// posture convention: every inventory.cycleCount.* capability is registered `active: false` and
// granted to NO Role today, so every real action attempt resolves `permission-denied` server-side. The
// controls render (so the workspace is reviewable and ready for the day the grant lands) but every call
// is re-authorized by the trusted backend regardless of what this UI shows.
//
// M23 BLIND-COUNT REMEDIATION (Owner ruling, 2026-08-18): a count exists to catch discrepancy
// independently, so this workspace hides the expected quantity/serial count from the counter for as
// long as the count is OPEN -- NoneCountEntry/SerialCountEntry below never render it, and (more than a
// UI choice) createCycleCount's own response no longer carries it over the network at all
// (cycleCountCallableWiring/cycleCountCallables.ts) -- a determined user reading the raw response in
// devtools would not find it either. It first appears once the count is COUNTED, sourced from
// submitCycleCount's OWN response (after the counted value already left the counter's hands in that
// same request), and separately, the disposing manager review step (ManagerReviewForm) is a SEPARATE
// action from counting -- reconcileCycleCount's `decision` field -- with its own server-side separation-
// of-duties check: the actor who submitted a count cannot approve or reject that count's own MATERIAL
// variance (functions/src/cycleCount/cycleCountCommand.ts). This UI does not attempt to model "who is
// the manager" (there is no role split in this session-scoped prototype) -- it always renders both the
// Approve and Reject controls, and lets the trusted backend be the actual enforcement point; a self-
// approval attempt surfaces as an honest, specific error (see cycleCountActionResult.js) rather than a
// silently-hidden button, since hiding the button would not itself be a guarantee of anything.
//
// NO LIVE READ: cycle_counts is Rules-denied to every client (Admin-SDK-only, same posture as
// receiving_orders). The list below is SESSION state built entirely from callable responses (see
// useCycleCountActions.js) -- "history" here means "what this tab did this session," not a durable
// cross-session view. That is a deliberate, documented boundary, not an oversight -- and it means a
// manager reviewing on a DIFFERENT device/session cannot yet browse pending COUNTED records from here;
// that would need a new read capability, which is out of this remediation's scope.
//
// SERIAL scan entry REUSES the existing scan identity boundary (domain/scannedIdentity.js) against
// this count's own expected-serial snapshot as the candidate set -- it does NOT stand up a second
// scanner. A token that resolves is added as an expected hit; a token that does not resolve is still
// offered as an "unexpected" find (the count's job is to capture what is physically there, not to
// silently reject it). The candidate set itself is only available once expectedSerialNumbers has
// arrived (post-submit) -- see SerialCountEntry's own note on scanning blind.

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
    case "REJECTED": return "muted";
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
        <Button type="submit" variant="primary" disabled={submitting}>
          {submitting ? "Starting…" : "Start count"}
        </Button>
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
      {/* M23: no expected-quantity hint here on purpose -- the count is blind until it is recorded.
          The server never even sends this count's expectedQuantity in this state (see this file's
          header note); it first appears in the row's variance summary once status is COUNTED. */}
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
  // M23: NO candidate set here on purpose. This count's expected serials are not sent to the client
  // while it is OPEN (see this file's header note), so resolveScannedIdentity below is deliberately
  // called with an empty candidate list -- it still validates a scan's SHAPE (SCAN_RESOLUTION.INVALID
  // for garbage input), but can never tell the counter, scan by scan, whether a unit was expected. That
  // per-scan tell would be exactly the same anchoring problem this remediation removes, just leaked one
  // unit at a time instead of as a single number. The real missing/unexpected breakdown is computed
  // server-side at submit and shown afterward in this count's variance summary.
  const candidates = useMemo(() => ({ serializedAssets: [] }), []);

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
    setFeedback({ kind: "success", message: `${token} added to this count.` });
    setScanInput("");
  };

  return (
    <div className="fo-inline-form fo-inline-form--stacked">
      {/* M23: no "Expected units" hint here on purpose -- see this file's header note. */}
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
      <Button
        variant="primary"
        disabled={busy}
        onClick={() => onSubmit({ countedSerialNumbers: counted })}
      >
        {busy ? "Recording…" : "Record count"}
      </Button>
    </div>
  );
}

// Renders expected vs. counted vs. variance -- ONLY ever called for a count that has been submitted
// (status COUNTED or later), so expectedQuantity/expectedSerialNumbers are safe to show here: this is
// the manager review data, not the pre-submission blind-count entry (see NoneCountEntry/SerialCountEntry
// above, which never render an expected value).
function VarianceSummary({ count }) {
  if (count.trackingMode === "SERIAL") {
    const sv = count.serialVariance;
    if (!sv) return null;
    const expectedCount = count.expectedSerialNumbers?.length;
    const header = expectedCount === undefined ? null : (
      <p className="fo-muted">{count.countedSerialNumbers?.length ?? 0} counted vs {expectedCount} expected</p>
    );
    if (sv.missing.length === 0 && sv.unexpected.length === 0) {
      return (
        <div>
          {header}
          <p className="fo-muted">No variance — every expected unit was counted.</p>
        </div>
      );
    }
    return (
      <div>
        {header}
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
  if (count.variance === 0) return <p className="fo-muted">No variance — {count.countedQuantity} counted matches {count.expectedQuantity} expected.</p>;
  const sign = count.variance > 0 ? "+" : "";
  return <p className="fo-warning">Variance: {sign}{count.variance} ({count.countedQuantity} counted vs {count.expectedQuantity} expected)</p>;
}

// M23: the manager review step, separate from counting. `decision` is "APPROVE" (stage the ADJUSTED
// ledger correction) or "REJECT" (record the count as disputed, no ledger effect) -- reconcileCycleCount
// requires a reason on any non-zero variance regardless of which way it goes. The SERVER independently
// enforces that the disposing actor cannot be the same principal who submitted this count when the
// variance is material; this form does not attempt to guess or pre-empt that, it just offers both
// actions and surfaces whatever the server decides (see cycleCountActionResult.js's error mapping).
function ManagerReviewForm({ count, busy, onSubmit }) {
  const [reason, setReason] = useState("");
  const hasVariance =
    count.trackingMode === "SERIAL"
      ? (count.serialVariance?.missing.length ?? 0) > 0 || (count.serialVariance?.unexpected.length ?? 0) > 0
      : (count.variance ?? 0) !== 0;
  const reasonMissing = hasVariance && reason.trim() === "";
  return (
    <form
      className="fo-inline-form fo-inline-form--stacked"
      onSubmit={(e) => e.preventDefault()}
    >
      {hasVariance && (
        <label>
          Review reason (required for a non-zero variance, either decision)
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
        </label>
      )}
      <div className="fo-form-actions">
        <Button type="button" variant="primary" disabled={busy || reasonMissing} loading={busy} onClick={() => onSubmit(reason, "APPROVE")}>
          Approve
        </Button>
        <Button type="button" variant="secondary" disabled={busy || reasonMissing} loading={busy} onClick={() => onSubmit(reason, "REJECT")}>
          Reject
        </Button>
      </div>
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
          <ManagerReviewForm count={count} busy={busy} onSubmit={(reason, decision) => onReconcile(count.cycleCountId, reason, decision)} />
        </>
      )}

      {count.status === "RECONCILED" && (
        <>
          <VarianceSummary count={count} />
          {count.reconciliationReason && <p className="fo-muted">Reason: {count.reconciliationReason}</p>}
          <p className="fo-muted">
            Approved. {count.ledgerEventIds?.length ? `${count.ledgerEventIds.length} ledger adjustment(s) recorded.` : "No adjustment needed — exact match."}
          </p>
        </>
      )}

      {count.status === "REJECTED" && (
        <>
          <VarianceSummary count={count} />
          {count.reconciliationReason && <p className="fo-muted">Reason: {count.reconciliationReason}</p>}
          <p className="fo-muted">Rejected — the count was disputed. No ledger effect; the expected quantity is unchanged.</p>
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
          <Button variant="primary" onClick={() => setShowForm(true)}>
            New count
          </Button>
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
