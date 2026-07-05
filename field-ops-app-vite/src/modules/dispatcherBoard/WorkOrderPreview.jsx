import { useState } from "react";

// Epic 2 Phase 2C -- center pane. Pure renderer, no Firestore access,
// no scoring logic of its own -- recommendations are passed in
// already-computed from DispatcherBoard.jsx's recommendTechnicians()
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

export default function WorkOrderPreview({ workOrder, technicians, recommendations }) {
  const [expandedTechId, setExpandedTechId] = useState(null);
  const techName = (id) => technicians.find((t) => t.id === id)?.name ?? id;

  if (!workOrder) {
    return (
      <div className="disp-pane disp-pane--preview">
        <p className="fo-muted">Select a Work Order from the queue to see details and recommendations.</p>
      </div>
    );
  }

  const top3 = recommendations.slice(0, 3);

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
            >
              #{rec.rank} {techName(rec.techId)} -- {rec.score}%{rec.rank === 1 ? " (Recommended)" : ""}
            </button>
            {expandedTechId === rec.techId && <ScoreBreakdown recommendation={rec} />}
          </div>
        ))
      )}
    </div>
  );
}
