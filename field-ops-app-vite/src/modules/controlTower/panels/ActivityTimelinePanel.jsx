import { useMemo, useState } from "react";
import { buildTimeline } from "../../../domain/timelineBuilder";
import { describeEvent } from "../../../domain/eventModel";
import { EVENT_ICON } from "../../../domain/eventTypes";
import { assertPanelProps } from "../../../domain/controlTower/types";
import SignalBadge from "../../../shared/ui/SignalBadge";

const FILTERS = [
  { value: "ALL", label: "All" },
  { value: "JOB", label: "Job" },
  { value: "WORK_ORDER", label: "Work Order" },
  { value: "SYSTEM", label: "System" },
];

// Read-only panel: renders the derived Operational Timeline from
// domain/timelineBuilder.js (Sprint 3.5). Takes only
// { jobs, technicians, workOrders } -- never fetches Firestore itself,
// never mutates jobs/work orders. All event generation lives in
// timelineBuilder.js; this component only filters for display and
// renders -- it never builds events itself.
export default function ActivityTimelinePanel({ jobs, technicians, workOrders }) {
  if (import.meta.env.DEV) assertPanelProps({ jobs, technicians, workOrders });

  const [filter, setFilter] = useState("ALL");

  const timeline = useMemo(() => buildTimeline(jobs), [jobs]);

  const filtered = useMemo(() => {
    if (filter === "ALL") return timeline;
    return timeline.filter((event) => event.entity.type === filter);
  }, [timeline, filter]);

  return (
    <div className="tech-overview tech-overview--compact">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h3>Activity Timeline</h3>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          {FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              Filter: {f.label}
            </option>
          ))}
        </select>
      </div>
      {filtered.length === 0 ? (
        <p className="fo-muted">No activity to show.</p>
      ) : (
        filtered.map((event, index) => (
          <div key={`${event.entity.type}-${event.entity.id}-${event.type}-${index}`} className="fo-card">
            <span aria-hidden="true">{EVENT_ICON[event.type] ?? "•"}</span>{" "}
            <strong>{describeEvent(event)}</strong>
            <SignalBadge severity={event.severity}>{event.entity.type}</SignalBadge>
            <div className="fo-muted">{event.entity.id}</div>
          </div>
        ))
      )}
    </div>
  );
}
