import { computeWorkOrderSignal } from "../../domain/workOrderScoring";

// Work Order lifecycle summary for one work order. Pure rendering --
// consumes the canonical WorkOrderSignal from domain/workOrderScoring.js
// (Sprint 3.3's Signal layer), which itself wraps
// domain/workOrderLifecycle.js's explainWorkOrderState() (Sprint 3.4's
// lifecycle engine -- the single source of truth for state/reasons/
// metrics). This component never computes lifecycle itself, never
// fetches Firestore, never mutates jobs or work orders -- it only reads
// signal.metadata for display:
//
//   Lifecycle Engine (workOrderLifecycle.js)
//         -> Signal Layer (workOrderScoring.js)
//         -> WorkOrderDetail (here)
//         -> React UI
export default function WorkOrderDetail({ workOrderId, jobs }) {
  const signal = computeWorkOrderSignal(workOrderId, jobs);
  const { state, reasons, metrics } = signal.metadata;

  return (
    <div className="work-order-card">
      <h3>
        Work Order: {workOrderId}
        <span className={`wo-status wo-${state.toLowerCase()}`}>{state}</span>
      </h3>

      <div className="fo-muted">{reasons.join(" · ")}</div>

      <div>
        Open: {metrics.openJobs} |
        Assigned: {metrics.assignedJobs} |
        In Progress: {metrics.inProgressJobs} |
        Completed: {metrics.completedJobs}
      </div>
    </div>
  );
}
