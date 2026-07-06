import { useState } from "react";
import { getCatalogItem } from "../../data/partsCatalog";
import { updateWorkOrderExecutionData } from "../../services/workOrderService";

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

  async function adjustQty(sku, delta) {
    setSubmittingSku(sku);
    setError(null);
    try {
      await updateWorkOrderExecutionData(workOrder.id, { qtyUsedUpdates: [{ sku, delta }] });
    } catch (err) {
      console.error(err);
      setError(err.message);
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
      console.error(err);
      setError(err.message);
    } finally {
      setSubmittingNote(false);
    }
  }

  return (
    <div className="fo-card">
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
          plannedParts.map((item) => {
            const catalogEntry = getCatalogItem(item.sku);
            const displayName = item.name || catalogEntry?.name || item.sku;
            const qtyUsed = item.qtyUsed ?? 0;
            const busy = submittingSku === item.sku;
            return (
              <div key={item.sku} className="fo-btn-row" style={{ alignItems: "center" }}>
                <span style={{ flex: 1 }}>
                  {displayName} -- {qtyUsed} / {item.qtyPlanned} used
                </span>
                <button type="button" disabled={busy || qtyUsed <= 0} onClick={() => adjustQty(item.sku, -1)}>
                  -
                </button>
                <button type="button" disabled={busy} onClick={() => adjustQty(item.sku, 1)}>
                  +
                </button>
              </div>
            );
          })
        )}
      </div>

      <div style={{ marginTop: 12 }}>
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
