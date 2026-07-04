import { computeWorkOrderSignal } from "../../domain/workOrderScoring";
import { buildTimeline } from "../../domain/timelineBuilder";
import { describeEvent } from "../../domain/eventModel";
import { EVENT_ICON } from "../../domain/eventTypes";

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
//
// Sprint 3.5.4: also renders this work order's Operational History --
// the same domain/timelineBuilder.js used by
// modules/controlTower/panels/ActivityTimelinePanel.jsx, scoped to just
// this work order's jobs (buildTimeline() only needs a jobs array, and
// `jobs` here is already exactly one work order's jobs). No event
// generation happens in this component -- timelineBuilder.js is the only
// builder, so both this history and the Activity Timeline panel are
// guaranteed to describe the same job/work-order the same way.
export default function WorkOrderDetail({ workOrderId, jobs }) {
  const signal = computeWorkOrderSignal(workOrderId, jobs);
  const { state, reasons, metrics } = signal.metadata;
  const history = buildTimeline(jobs);

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

      {history.length > 0 && (
        <div className="wo-history">
          <h4>Operational History</h4>
          {/* Timestamps are approximated from job.createdAt (see
              timelineBuilder.js) -- displayed as a time-of-day for
              readability, not as a claim of precise event timing. */}
          {history.map((event, index) => (
            <div key={`${event.type}-${event.entity.id}-${index}`} className="wo-history-row">
              <span className="fo-muted">
                {new Date(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>{" "}
              <span aria-hidden="true">{EVENT_ICON[event.type] ?? "•"}</span>{" "}
              {describeEvent(event)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
