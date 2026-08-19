import { useState } from "react";
import { snapshotPartName, snapshotPartSku } from "../../domain/workOrderInventorySnapshot";
import { updateWorkOrderExecutionData } from "../../services/workOrderService";
import { workflowActionErrorMessage } from "../../domain/workflowActionError";

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
export default function ExecutionCapture({ workOrder }) {
  const [submittingSku, setSubmittingSku] = useState(null);
  const [noteText, setNoteText] = useState("");
  const [submittingNote, setSubmittingNote] = useState(false);
  const [error, setError] = useState(null);

  const plannedParts = (workOrder.inventorySnapshot ?? []).filter((item) => item.qtyPlanned);
  const executionLog = workOrder.executionLog ?? [];

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
    setSubmittingSku(sku);
    setError(null);
    try {
      await updateWorkOrderExecutionData(workOrder.id, { qtyUsedUpdates: [{ sku, delta }] });
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
                <button type="button" disabled={busy || qtyUsed <= 0} onClick={() => adjustQty(item.sku, -1, item)}>
                  -
                </button>
                <button type="button" disabled={busy} onClick={() => adjustQty(item.sku, 1, item)}>
                  +
                </button>
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
          <button type="button" disabled={submittingNote || !noteText.trim()} onClick={submitNote}>
            {submittingNote ? "Saving..." : "Add Note"}
          </button>
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
