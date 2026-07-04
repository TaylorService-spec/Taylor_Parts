import { useMemo } from "react";
import { detectOverloadedTechnicians } from "../../../domain/dispatchScoring";

// Read-only panel: renders technician workload signals from
// dispatchScoring.detectOverloadedTechnicians() (Sprint 3.2's technician
// utilization check). Takes only { jobs, technicians, workOrders } --
// never fetches Firestore itself, never mutates technician state.
export default function OverloadedTechPanel({ jobs, technicians }) {
  const overloaded = useMemo(
    () => detectOverloadedTechnicians(technicians, jobs),
    [technicians, jobs]
  );

  return (
    <div className="tech-overview">
      <h3>Overloaded Technicians</h3>
      {overloaded.length === 0 ? (
        <p className="fo-muted">No technicians currently overloaded.</p>
      ) : (
        overloaded.map(({ technician, activeJobCount }) => (
          <div key={technician.id} className="fo-card">
            {technician.name}
            <span className="heat-badge heat-high"> {activeJobCount} active jobs</span>
          </div>
        ))
      )}
    </div>
  );
}
