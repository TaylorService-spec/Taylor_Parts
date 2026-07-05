import { useState } from "react";

// Epic 2 Phase 2B -- confirmation modal shown before any dispatcher
// action executes (per this phase's interaction model: no navigation
// on click, always confirm, show current -> target state). Schedule/
// Dispatch need extra fields the Cloud Function requires (see
// transitionWorkOrder.ts) -- collected here rather than assuming a
// bare confirm click supplies them.
const ACTION_LABELS = {
  MarkReady: "Mark Ready to Dispatch",
  Schedule: "Schedule",
  Dispatch: "Dispatch",
  Close: "Close",
  Cancel: "Cancel",
};

export default function ActionConfirmModal({
  workOrder,
  action,
  targetState,
  technicians,
  submitting,
  error,
  onConfirm,
  onCancel,
}) {
  const [scheduledTechId, setScheduledTechId] = useState("");
  const [scheduledStart, setScheduledStart] = useState("");
  const [scheduledEnd, setScheduledEnd] = useState("");
  const [assignedTechId, setAssignedTechId] = useState("");

  function buildExtra() {
    if (action === "Schedule") {
      return {
        scheduledStart: scheduledStart ? new Date(scheduledStart).getTime() : undefined,
        scheduledEnd: scheduledEnd ? new Date(scheduledEnd).getTime() : undefined,
        scheduledTechId: scheduledTechId || undefined,
      };
    }
    if (action === "Dispatch") {
      return { assignedTechId: assignedTechId || undefined };
    }
    return undefined;
  }

  const scheduleIncomplete = action === "Schedule" && (!scheduledStart || !scheduledEnd || !scheduledTechId);
  const dispatchIncomplete = action === "Dispatch" && !assignedTechId;
  const canConfirm = !scheduleIncomplete && !dispatchIncomplete && !submitting;

  return (
    <div className="fo-modal-overlay" role="dialog" aria-modal="true">
      <div className="fo-modal fo-panel">
        <h3>{ACTION_LABELS[action] ?? action}</h3>
        <p>
          {workOrder.woNumber}: <strong>{workOrder.status}</strong> &rarr; <strong>{targetState}</strong>
        </p>

        {action === "Schedule" && (
          <div className="fo-wizard-step">
            <label>
              Scheduled Start
              <input type="datetime-local" value={scheduledStart} onChange={(e) => setScheduledStart(e.target.value)} />
            </label>
            <label>
              Scheduled End
              <input type="datetime-local" value={scheduledEnd} onChange={(e) => setScheduledEnd(e.target.value)} />
            </label>
            <label>
              Technician
              <select value={scheduledTechId} onChange={(e) => setScheduledTechId(e.target.value)}>
                <option value="">Select technician…</option>
                {technicians.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {action === "Dispatch" && (
          <div className="fo-wizard-step">
            <label>
              Assign Technician
              <select value={assignedTechId} onChange={(e) => setAssignedTechId(e.target.value)}>
                <option value="">Select technician…</option>
                {technicians.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {(action === "MarkReady" || action === "Close" || action === "Cancel") && (
          <p className="fo-muted">This action cannot be undone from this screen.</p>
        )}

        {error && <p className="fo-error">{error}</p>}

        <div className="fo-wizard-actions">
          <button type="button" onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
          <button type="button" className="fo-btn-large" onClick={() => onConfirm(buildExtra())} disabled={!canConfirm}>
            {submitting ? "Working…" : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
