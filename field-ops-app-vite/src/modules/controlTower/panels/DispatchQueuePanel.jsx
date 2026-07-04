import { useMemo } from "react";
import { computeDispatchRecommendations } from "../../../domain/dispatchScoring";

// Read-only panel: renders DispatchRecommendation signals from
// dispatchScoring. Takes only { jobs, technicians, workOrders } -- never
// fetches Firestore itself. Purely a suggestion display; assigning a job
// still only happens through Dispatch.jsx's call to assignJob().
export default function DispatchQueuePanel({ jobs, technicians }) {
  const recommendations = useMemo(
    () => computeDispatchRecommendations(jobs, technicians),
    [jobs, technicians]
  );

  const technicianName = (id) => technicians.find((t) => t.id === id)?.name || id;

  return (
    <div className="tech-overview">
      <h3>Recommended Dispatch Queue</h3>
      {recommendations.length === 0 ? (
        <p className="fo-muted">No open jobs awaiting dispatch.</p>
      ) : (
        recommendations.map((signal) => (
          <div key={signal.id} className="fo-card">
            <strong>{signal.metadata.job.customer || signal.id}</strong>
            {" → "}
            {signal.metadata.recommended ? (
              <span>
                {technicianName(signal.metadata.recommended.technicianId)}{" "}
                <span className="fo-muted">(score {Math.round(signal.score)})</span>
                <div className="fo-muted">
                  {signal.metadata.recommended.reasons.join(" · ")}
                </div>
              </span>
            ) : (
              <span className="fo-muted">No eligible technician</span>
            )}
          </div>
        ))
      )}
    </div>
  );
}
