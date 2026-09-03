import { useState } from "react";
import { snapshotPartName, snapshotPartSku } from "../../domain/workOrderInventorySnapshot";
import { updateWorkOrderExecutionData, listWorkOrderConsumptionSources } from "../../services/workOrderService";
import { workflowActionErrorMessage } from "../../domain/workflowActionError";
import { Button } from "../../shared/ui/primitives/index.js";

// Epic 6 Phase 6.3 -- Field Execution Capture UI. This is NOT lifecycle
// logic: nothing here calls transitionWorkOrder() or changes status/
// assignedTechId. All writes go through updateWorkOrderExecutionData()
// (services/workOrderService.ts), which calls the Cloud Function of
// the same name -- the only write path for qtyUsed/executionLog/
// lastUpdated (firestore.rules denies direct client writes to
// fieldops_wos unconditionally, same as every other Work Order write).
//
// Parts Used: +/- buttons per planned part, each click sends a single
// delta (+1 or -1) -- additive, matching Step 2's "increment/decrement"
// requirement. The Cloud Function does the actual read-modify-write
// inside a transaction; this component just fires one delta at a time
// and lets the live useAssignedWorkOrders() snapshot (already
// powering the whole dashboard) reflect the result -- no local
// optimistic state, no second source of truth for quantities.
//
// Work Notes: a single textarea + explicit "Add Note" button (not
// autosave/debounced) -- appended via the Cloud Function's arrayUnion,
// never overwriting prior notes, safe for concurrent technicians (if
// that were ever possible) or concurrent tabs.
// The source control for ONE planned part.
//
// Deliberately a native <select>, not a modal or a custom dropdown. This screen is used one-handed on
// a phone at a customer site: a native picker gets the platform's own full-height wheel, works with
// gloves, and cannot become a desktop-only overlay a technician gets trapped in. It also costs no
// layout width, which is what keeps the row from overflowing at 320px.
//
// It renders NOTHING until the sources are known, so the common case -- one unambiguous pick -- shows
// a line of text rather than a control nobody needs to touch.
function PartSource({ item, options, selected, loading, onLoad, onSelect }) {
  if (loading) return <p className="fo-muted fo-execution-capture__source">Checking where this part came from...</p>;

  if (!options) {
    return (
      <button type="button" className="fo-link-button fo-execution-capture__source" onClick={onLoad}>
        Set inventory source
      </button>
    );
  }

  // SERIALIZED -- custody decides. Shown, never offered as a choice.
  if (options.serializedSource) {
    return (
      <p className="fo-muted fo-execution-capture__source">
        Source: {options.serializedSource.label} (tracked unit)
      </p>
    );
  }

  if (options.autoSourceUnavailableReason === "SERIAL_CUSTODY_UNKNOWN") {
    return (
      <p className="fo-muted fo-execution-capture__source">
        EOS does not know where this tracked unit currently is, so its usage cannot be recorded yet.
      </p>
    );
  }

  const chosen = selected ?? options.autoSource?.locationId ?? "";
  const isAuto = options.autoSource && chosen === options.autoSource.locationId;
  const choices = options.autoSource
    ? [options.autoSource, ...options.selectableSources.filter((o) => o.locationId !== options.autoSource.locationId)]
    : options.selectableSources;
  const warehouses = choices.filter((o) => o.locationType === "WAREHOUSE");
  const mobile = choices.filter((o) => o.locationType === "MOBILE");
  const selectId = `wo-source-${snapshotPartSku(item) || "part"}`;

  return (
    <div className="fo-execution-capture__source">
      <label htmlFor={selectId}>Inventory source</label>
      <select id={selectId} value={chosen} onChange={(e) => onSelect(e.target.value)}>
        {/* An empty option only while nothing is chosen, so the control cannot silently default. */}
        {chosen === "" && <option value="">Select where this part came from</option>}
        {warehouses.length > 0 && (
          <optgroup label="Warehouses">
            {warehouses.map((o) => (
              <option key={o.locationId} value={o.locationId}>{o.label}</option>
            ))}
          </optgroup>
        )}
        {mobile.length > 0 && (
          <optgroup label="My truck">
            {mobile.map((o) => (
              <option key={o.locationId} value={o.locationId}>{o.label}</option>
            ))}
          </optgroup>
        )}
      </select>
      {isAuto && <span className="fo-muted">From Work Order pick</span>}
      {options.autoSourceUnavailableReason === "SOURCE_AMBIGUOUS" && (
        <span className="fo-muted">Picked from more than one place -- choose the one you used.</span>
      )}
    </div>
  );
}

export default function ExecutionCapture({ workOrder }) {
  const [submittingSku, setSubmittingSku] = useState(null);
  // Decision #169 -- the governed source per sku, and the options the server offered for it.
  //
  // Fetched LAZILY, on first increment of a part, rather than for every planned part on render. A
  // technician who records nothing should cost nothing, and the common case (one unambiguous pick)
  // resolves without the person ever seeing a control.
  const [sourceBySku, setSourceBySku] = useState({});
  const [optionsBySku, setOptionsBySku] = useState({});
  const [loadingSourceSku, setLoadingSourceSku] = useState(null);
  const [noteText, setNoteText] = useState("");
  const [submittingNote, setSubmittingNote] = useState(false);
  const [error, setError] = useState(null);

  const plannedParts = (workOrder.inventorySnapshot ?? []).filter((item) => item.qtyPlanned);
  const executionLog = workOrder.executionLog ?? [];

  // Ask the server what this part's source may be. Identities only -- no quantities come back.
  async function loadSources(item) {
    const cached = optionsBySku[item.sku];
    if (cached) return cached;
    setLoadingSourceSku(item.sku);
    try {
      const options = await listWorkOrderConsumptionSources({
        workOrderId: workOrder.id,
        partId: item.partId ?? item.sku,
        requestedQuantity: 1,
      });
      setOptionsBySku((prev) => ({ ...prev, [item.sku]: options }));
      // Pre-select the pick when there is one. The technician can still change it -- an auto source
      // is a default, not a decision.
      if (options.autoSource) {
        setSourceBySku((prev) => ({ ...prev, [item.sku]: prev[item.sku] ?? options.autoSource.locationId }));
      }
      return options;
    } finally {
      setLoadingSourceSku(null);
    }
  }

  async function adjustQty(sku, delta, item) {
    // Recording more than the plan is legitimate but must be deliberate:
    // field testing booked 13 against a 1-part plan with a stray thumb and no
    // warning at all. Mirrors PartsScanner's over-plan guard exactly (same
    // copy, same window.confirm gate) so the two write paths behave alike.
    const planned = item?.qtyPlanned;
    const nextQty = (item?.qtyUsed ?? 0) + delta;
    if (delta > 0 && typeof planned === "number" && nextQty > planned) {
      const ok = window.confirm(`The plan says ${planned}. Record ${nextQty}?`);
      if (!ok) return;
    }
    // A POSITIVE delta needs a governed source. A decrement does not -- it reverses against the
    // original lineage, and asking would let a correction move stock somewhere it never was.
    let chosenSource = null;
    if (delta > 0) {
      let options = optionsBySku[sku];
      if (!options) {
        try {
          options = await loadSources(item);
        } catch (err) {
          console.error(err);
          setError(workflowActionErrorMessage(err));
          return;
        }
      }
      // Serialized: custody decides and there is nothing to choose.
      if (options.serializedSource) {
        chosenSource = options.serializedSource.locationId;
      } else {
        chosenSource = sourceBySku[sku] ?? options.autoSource?.locationId ?? null;
      }
      if (!chosenSource) {
        // The refusal happens HERE rather than at the server, so the technician sees what to do
        // instead of a failed submit. The server refuses too -- this is not the enforcement.
        setError("Select where this part came from before recording usage.");
        return;
      }
    }
    setSubmittingSku(sku);
    setError(null);
    try {
      await updateWorkOrderExecutionData(workOrder.id, {
        qtyUsedUpdates: [{ sku, delta }],
        ...(chosenSource ? { consumptionSources: [{ sku, locationId: chosenSource }] } : {}),
      });
    } catch (err) {
      // Safe, categorized copy -- never the raw message / Functions code.
      console.error(err);
      setError(workflowActionErrorMessage(err));
    } finally {
      setSubmittingSku(null);
    }
  }

  async function submitNote() {
    const trimmed = noteText.trim();
    if (!trimmed) return;
    setSubmittingNote(true);
    setError(null);
    try {
      await updateWorkOrderExecutionData(workOrder.id, { executionNote: trimmed });
      setNoteText("");
    } catch (err) {
      // Safe, categorized copy -- never the raw message / Functions code.
      console.error(err);
      setError(workflowActionErrorMessage(err));
    } finally {
      setSubmittingNote(false);
    }
  }

  return (
    <div className="fo-card fo-touch-targets">
      <h4>Execution Capture</h4>
      {error && (
        <div className="warning" role="alert">
          {error}
        </div>
      )}

      <div>
        <strong>Parts Used</strong>
        {plannedParts.length === 0 ? (
          <p className="fo-muted">No planned parts on this Work Order.</p>
        ) : (
          plannedParts.map((item, idx) => {
            // Snapshot-authoritative name (recorded on the Work Order) -- no catalog lookup;
            // missing/empty/whitespace/malformed -> raw SKU. Safe sku projection for the key so
            // a malformed legacy sku can never reach React output. The action path
            // (adjustQty -> updateWorkOrderExecutionData) still uses the recorded item.sku.
            const displayName = snapshotPartName(item);
            const qtyUsed = item.qtyUsed ?? 0;
            const busy = submittingSku === item.sku;
            return (
              <div
                key={snapshotPartSku(item) || idx}
                className="fo-btn-row fo-execution-capture__part-row"
              >
                <span className="fo-execution-capture__part-label">
                  {displayName} -- {qtyUsed} / {item.qtyPlanned} used
                </span>
                <Button
                  variant="secondary"
                  disabled={busy || qtyUsed <= 0}
                  onClick={() => adjustQty(item.sku, -1, item)}
                >
                  -
                </Button>
                <Button variant="secondary" disabled={busy} onClick={() => adjustQty(item.sku, 1, item)}>
                  +
                </Button>
                <PartSource
                  item={item}
                  options={optionsBySku[item.sku]}
                  selected={sourceBySku[item.sku]}
                  loading={loadingSourceSku === item.sku}
                  onLoad={() => loadSources(item)}
                  onSelect={(locationId) => setSourceBySku((prev) => ({ ...prev, [item.sku]: locationId }))}
                />
              </div>
            );
          })
        )}
      </div>

      <div className="fo-execution-capture__notes">
        <strong>Work Notes</strong>
        <div className="fo-form">
          <input
            type="text"
            placeholder="Add a note about this work..."
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            aria-label="Execution note"
          />
          <Button
            variant="secondary"
            disabled={!noteText.trim()}
            loading={submittingNote}
            onClick={submitNote}
          >
            Add Note
          </Button>
        </div>
        {executionLog.length === 0 ? (
          <p className="fo-muted">No notes yet.</p>
        ) : (
          <ul>
            {[...executionLog]
              .sort((a, b) => (b.at?.toMillis?.() ?? 0) - (a.at?.toMillis?.() ?? 0))
              .map((entry, i) => (
                <li key={i} className="fo-muted">
                  {entry.at?.toDate ? entry.at.toDate().toLocaleString() : ""} -- {entry.note}
                </li>
              ))}
          </ul>
        )}
      </div>
    </div>
  );
}
