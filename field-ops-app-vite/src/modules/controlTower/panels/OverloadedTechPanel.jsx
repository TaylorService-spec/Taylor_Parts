import { useMemo } from "react";
import { detectOverloadedTechnicians } from "../../../domain/dispatchScoring";
import { severityFromScore, assertPanelProps } from "../../../domain/controlTower/types";
import SignalBadge from "../../../shared/ui/SignalBadge";

// Workload -> severity scale for display only (detectOverloadedTechnicians
// already filtered to "overloaded"; this just differentiates how
// overloaded, using the same 0-100 severityFromScore scale every other
// Control Tower signal uses).
const SCORE_PER_ACTIVE_JOB = 20;

// Read-only panel: renders technician workload signals from
// dispatchScoring.detectOverloadedTechnicians() (Sprint 3.2's technician
// utilization check). Takes only { jobs, technicians, workOrders } --
// never fetches Firestore itself, never mutates technician state.
export default function OverloadedTechPanel({ jobs, technicians, workOrders }) {
  if (import.meta.env.DEV) assertPanelProps({ jobs, technicians, workOrders });

  const overloaded = useMemo(
    () => detectOverloadedTechnicians(technicians, jobs),
    [technicians, jobs]
  );

  return (
    <div className="tech-overview tech-overview--compact">
      <h3>Overloaded Technicians</h3>
      {overloaded.length === 0 ? (
        <p className="fo-muted">No technicians currently overloaded.</p>
      ) : (
        overloaded.map(({ technician, activeJobCount }) => {
          const severity = severityFromScore(Math.min(100, activeJobCount * SCORE_PER_ACTIVE_JOB));
          return (
            <div key={technician.id} className="fo-card">
              {technician.name}
              <SignalBadge severity={severity}>{activeJobCount} active jobs</SignalBadge>
            </div>
          );
        })
      )}
    </div>
  );
}
