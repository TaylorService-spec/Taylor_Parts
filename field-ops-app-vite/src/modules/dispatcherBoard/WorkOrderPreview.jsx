import { memo, useState } from "react";
import { getAllowedActions } from "../../domain/workOrderWorkflow";

// Epic 2 Phase 2C -- center pane. Pure renderer, no Firestore access,
// no scoring logic of its own -- recommendations are passed in
// already-computed from DispatcherBoard.jsx's recommendTechniciansBatch()
// call.
function ScoreBreakdown({ recommendation }) {
  const { breakdown, reasons } = recommendation;
  return (
    <div className="disp-score-breakdown">
      <div>Workload contribution: {breakdown.workload}/100</div>
      <div>Assignment history contribution: {breakdown.experienceAffinity}/100</div>
      <div>Availability contribution: {breakdown.availability}/100</div>
      <div>Territory contribution: {breakdown.territoryMatch}/100</div>
      <ul>
        {reasons.map((reason, i) => (
          <li key={i}>{reason}</li>
        ))}
      </ul>
    </div>
  );
}

// Short qualitative summary line instead of a bare percentage --
// Priority 2's "Better Recommendation Display." Derived purely from
// the already-computed breakdown, no new scoring logic.
function qualitativeSummary(breakdown) {
  const parts = [];
  if (breakdown.workload >= 70) parts.push("Light workload");
  else if (breakdown.workload <= 30) parts.push("Heavier workload");
  if (breakdown.experienceAffinity > 0) parts.push("Recent similar assignments");
  if (breakdown.availability === 100) parts.push("Available now");
  return parts.join(" · ") || "No standout factors";
}

function WorkOrderPreview({ workOrder, technicians, recommendations, onDispatchToTechnician, isDispatching }) {
  const [expandedTechId, setExpandedTechId] = useState(null);
  const [pickerTechId, setPickerTechId] = useState("");
  const techName = (id) => technicians.find((t) => t.id === id)?.name ?? id;

  if (!workOrder) {
    return (
      <div className="disp-pane disp-pane--preview">
        <p className="fo-muted">Select a Work Order from the queue (click, or use Up/Down + Enter) to see details and recommendations.</p>
      </div>
    );
  }

  const top3 = recommendations.slice(0, 3);
  const canDispatch = getAllowedActions(workOrder.status, "dispatcher", false).includes("Dispatch");

  return (
    <div className="disp-pane disp-pane--preview">
      <h3>{workOrder.woNumber}</h3>
      <div>
        <span className={`wo-status wo-${workOrder.status.toLowerCase()}`}>{workOrder.status}</span>
      </div>
      <div className="fo-muted">
        Priority {workOrder.priority} | Type: {workOrder.type}
      </div>
      <div className="fo-muted">Customer: {workOrder.customerId}</div>

      <h4>Assigned Technician</h4>
      <div>{workOrder.assignedTechId ? techName(workOrder.assignedTechId) : "Unassigned"}</div>

      <h4>Recommended Technicians (Top 3)</h4>
      {top3.length === 0 ? (
        <p className="fo-muted">No technicians available to recommend.</p>
      ) : (
        top3.map((rec) => (
          <div key={rec.techId} className={`disp-rec-row${rec.rank === 1 ? " disp-rec-row--top" : ""}`}>
            <button
              type="button"
              className="disp-rec-score-btn"
              onClick={() => setExpandedTechId(expandedTechId === rec.techId ? null : rec.techId)}
              aria-expanded={expandedTechId === rec.techId}
              aria-label={`${techName(rec.techId)}, score ${rec.score} percent, ${rec.rank === 1 ? "top recommendation" : `rank ${rec.rank}`}. Click for score breakdown.`}
            >
              {rec.rank === 1 && "⭐ "}#{rec.rank} {techName(rec.techId)} -- {rec.score}%
              <div className="fo-muted">{qualitativeSummary(rec.breakdown)}</div>
            </button>
            {expandedTechId === rec.techId && <ScoreBreakdown recommendation={rec} />}
          </div>
        ))
      )}

      {/* Keyboard/mobile-accessible dispatch action -- native HTML5
          drag-and-drop (TechnicianBoard.jsx's drop targets) doesn't
          reliably work via keyboard or on touch devices (a real,
          documented limitation, not something ARIA attributes fix on
          their own). This is the equivalent non-drag path, using the
          exact same onDispatchToTechnician callback (and therefore the
          exact same transitionWorkOrder()/getAllowedActions() gating)
          as a drop does. */}
      {canDispatch && top3.length > 0 && (
        <div className="fo-form">
          <select
            value={pickerTechId}
            onChange={(e) => setPickerTechId(e.target.value)}
            aria-label="Select technician to dispatch"
          >
            <option value="" disabled>
              Dispatch to...
            </option>
            {technicians.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!pickerTechId || isDispatching}
            onClick={() => {
              onDispatchToTechnician(workOrder, pickerTechId);
              setPickerTechId("");
            }}
          >
            {isDispatching ? "Dispatching..." : "Dispatch"}
          </button>
        </div>
      )}
    </div>
  );
}

// React.memo -- Priority 3 render audit.
export default memo(WorkOrderPreview);
