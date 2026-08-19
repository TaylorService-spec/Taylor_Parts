import { memo, useState } from "react";
import { getAllowedActions } from "../../domain/workOrderWorkflow";
import { useAccountNames } from "../../hooks/useAccountNames";
import { resolveCustomerIdentity } from "../../domain/fieldCurrentJob";
import CustomerIdentity from "../../shared/ui/CustomerIdentity.jsx";
import { workOrderPriorityText } from "../../domain/workOrderPriority";
import { workOrderStatusLabel } from "../../domain/workOrderStatus";
import { Button } from "../../shared/ui/primitives/index.js";

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
  const accountNames = useAccountNames(workOrder?.customerId ? [workOrder.customerId] : []);
  const customerIdentity = resolveCustomerIdentity(
    workOrder,
    (id) => accountNames.get(id) ?? null,
  );

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
        <span className={`wo-status wo-${workOrder.status.toLowerCase()}`}>{workOrderStatusLabel(workOrder.status)}</span>
      </div>
      <div className="fo-muted">
        Priority: {workOrderPriorityText(workOrder.priority) ?? "Priority not set"} | Type: {workOrder.type}
      </div>
      {/* Dispatcher holds canonical accounts read, so identity resolves through the
          existing useAccountNames path -- same four states as the technician surfaces,
          a different authorized transport. showReference keeps the id quotable on a
          support call without ever presenting it as the name. */}
      <div className="fo-muted">Customer: <CustomerIdentity identity={customerIdentity} showReference /></div>

      {/* H20 fix: name who this Work Order was actually Scheduled for, visibly, on the surface where a
          dispatcher picks (or drags) a technician to Dispatch to -- so sending it to someone else is a
          choice made with the fact in view, not an accident discoverable only on the Scheduling board. */}
      {workOrder.scheduledTechId && (
        <div className="fo-muted">Scheduled for: {techName(workOrder.scheduledTechId)}</div>
      )}

      <h4>Assigned Technician</h4>
      <div>{workOrder.assignedTechId ? techName(workOrder.assignedTechId) : "Unassigned"}</div>

      <h4>Recommended Technicians (Top 3)</h4>
      {top3.length === 0 ? (
        <p className="fo-muted">No technicians available to recommend.</p>
      ) : (
        top3.map((rec) => (
          <div key={rec.techId} className={`disp-rec-row${rec.rank === 1 ? " disp-rec-row--top" : ""}`}>
            {/* Left as a raw <button> -- disp-rec-score-btn is a bespoke, full-width, left-aligned,
                multi-line recommendation card (score line + a nested qualitative-summary div). The
                Button primitive centers its content in a fixed inline-flex box with its own
                padding/background; wrapping this card in fo-button classes would fight that layout
                without an index.css change. See migration report. */}
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
          <Button
            variant="primary"
            disabled={!pickerTechId || isDispatching}
            loading={isDispatching}
            onClick={() => {
              onDispatchToTechnician(workOrder, pickerTechId);
              setPickerTechId("");
            }}
          >
            Dispatch
          </Button>
          {/* H20 fix: picking anyone other than who this Work Order was Scheduled for is a reassignment --
              flagged here BEFORE the dispatcher clicks Dispatch. onDispatchToTechnician (handleDispatchDrop
              in DispatcherBoard.jsx) still owns the actual reason prompt/confirmation for both this picker
              and the drag-and-drop path below, so both routes share one enforcement point. */}
          {pickerTechId && workOrder.scheduledTechId && pickerTechId !== workOrder.scheduledTechId && (
            <p className="fo-muted" role="alert">
              This reassigns the job from {techName(workOrder.scheduledTechId)} to {techName(pickerTechId)} --
              a reason will be required.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// React.memo -- Priority 3 render audit.
export default memo(WorkOrderPreview);
