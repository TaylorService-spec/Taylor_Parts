import { useMemo, useState } from "react";
import { detectStalledJobs } from "../../../domain/jobRiskScoring";

// Read-only panel: renders RiskSignal objects from jobRiskScoring. Takes
// only { jobs, technicians, workOrders } -- never fetches Firestore
// itself, never calls assignJob()/updateJobStatus(). All scoring logic
// lives in domain/jobRiskScoring.js; this component only sorts for
// display and renders.
export default function AtRiskPanel({ jobs, technicians }) {
  const [sort, setSort] = useState("severity");

  const stalledJobs = useMemo(() => detectStalledJobs(jobs, technicians), [jobs, technicians]);

  const sorted = useMemo(() => {
    if (sort === "age") {
      return [...stalledJobs].sort((a, b) => b.metadata.ageHours - a.metadata.ageHours);
    }
    return stalledJobs; // already severity -> score sorted by detectStalledJobs()
  }, [stalledJobs, sort]);

  return (
    <div className="tech-overview">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h3>At Risk Jobs</h3>
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="severity">Sort: Severity</option>
          <option value="age">Sort: Age</option>
        </select>
      </div>
      {sorted.length === 0 ? (
        <p className="fo-muted">No stalled jobs detected.</p>
      ) : (
        sorted.map((signal) => (
          <div key={signal.id} className="work-order-card">
            <h3>
              {signal.label}
              <span className={`risk-badge risk-${signal.severity.toLowerCase()}`}>
                {signal.severity}
              </span>
            </h3>
            <div className="fo-muted">
              Work Order: {signal.metadata.workOrderId || "unassigned"} · ~
              {Math.round(signal.metadata.ageHours)}h since creation (approx.)
            </div>
            <div className="fo-muted">
              {signal.metadata.factors.map((f) => f.explanation).join(" · ")}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
