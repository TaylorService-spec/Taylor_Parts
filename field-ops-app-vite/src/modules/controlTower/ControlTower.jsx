import { useMemo, useState } from "react";
import { JOBS_COLLECTION, TECHNICIANS_COLLECTION, JOB_STATUS, TECH_STATUS } from "../../domain/constants";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";
import { computeWorkOrderStatus } from "../../domain/workOrderScoring";
import { groupJobsByTechnician } from "./techUtils";
import { detectStalledJobs } from "../../domain/jobRiskScoring";
import { computeDispatchRecommendations, detectOverloadedTechnicians } from "../../domain/dispatchScoring";

// Work Order-centric operational dashboard. Job state, technician state,
// and work-order grouping all come from main's domain layer — this view
// only aggregates and displays; it never mutates jobs, work orders, or
// technicians.

export default function ControlTower() {
  const { data: jobs } = useFirestoreCollection(JOBS_COLLECTION);
  const { data: technicians } = useFirestoreCollection(TECHNICIANS_COLLECTION);

  const openJobs = jobs.filter((j) => j.status === JOB_STATUS.OPEN).length;
  const assignedJobs = jobs.filter((j) => j.status === JOB_STATUS.ASSIGNED || j.status === JOB_STATUS.IN_PROGRESS).length;
  const completeJobs = jobs.filter((j) => j.status === JOB_STATUS.COMPLETE).length;
  const availableTechs = technicians.filter((t) => t.status === TECH_STATUS.AVAILABLE).length;
  const onJobTechs = technicians.filter((t) => t.status === TECH_STATUS.ON_JOB).length;

  // Group jobs by workOrderId. Jobs without one yet (no work-order picker
  // exists in the UI so far) fall into the "unassigned" bucket.
  const workOrderGroups = useMemo(() => {
    const groups = {};

    jobs.forEach((job) => {
      const id = job.workOrderId || "unassigned";

      if (!groups[id]) {
        groups[id] = {
          workOrderId: id,
          jobs: [],
          statusCounts: {
            pending: 0,
            inProgress: 0,
            completed: 0,
          },
        };
      }

      groups[id].jobs.push(job);

      if (job.status === JOB_STATUS.OPEN || job.status === JOB_STATUS.ASSIGNED) groups[id].statusCounts.pending++;
      if (job.status === JOB_STATUS.IN_PROGRESS) groups[id].statusCounts.inProgress++;
      if (job.status === JOB_STATUS.COMPLETE) groups[id].statusCounts.completed++;
    });

    return Object.values(groups);
  }, [jobs]);

  const activeWorkOrders = workOrderGroups.filter(
    (wo) => wo.statusCounts.completed !== wo.jobs.length
  );

  const unassignedWorkOrders = workOrderGroups.find(
    (wo) => wo.workOrderId === "unassigned"
  );

  // Sprint 2 derived layer: readiness state per work order and a
  // technician workload rollup. Neither owns or mutates state.
  const workOrderStatusMap = useMemo(() => {
    const map = {};
    workOrderGroups.forEach((wo) => {
      map[wo.workOrderId] = computeWorkOrderStatus(wo.jobs);
    });
    return map;
  }, [workOrderGroups]);

  const techGroups = useMemo(() => groupJobsByTechnician(jobs), [jobs]);
  const technicianName = (id) => technicians.find((t) => t.id === id)?.name || id;

  // Sprint 3.2 derived layer: dispatch intelligence. All three are pure
  // functions over the same jobs/technicians snapshot Control Tower
  // already listens to -- nothing here writes to Firestore or mutates
  // job/technician state. See domain/jobRiskScoring.js and
  // domain/dispatchScoring.js.
  const [riskSort, setRiskSort] = useState("severity");

  const stalledJobs = useMemo(() => detectStalledJobs(jobs, technicians), [jobs, technicians]);
  const sortedStalledJobs = useMemo(() => {
    if (riskSort === "age") {
      return [...stalledJobs].sort((a, b) => b.metadata.ageHours - a.metadata.ageHours);
    }
    return stalledJobs;
  }, [stalledJobs, riskSort]);

  const overloadedTechnicians = useMemo(
    () => detectOverloadedTechnicians(technicians, jobs),
    [technicians, jobs]
  );

  const dispatchRecommendations = useMemo(
    () => computeDispatchRecommendations(jobs, technicians),
    [jobs, technicians]
  );

  return (
    <div className="fo-panel">
      <h2>Control Tower</h2>
      <div className="fo-stat-grid">
        <div className="fo-stat">
          <div className="fo-stat-value">{openJobs}</div>
          <div className="fo-stat-label">Open Work Orders</div>
        </div>
        <div className="fo-stat">
          <div className="fo-stat-value">{assignedJobs}</div>
          <div className="fo-stat-label">In Progress</div>
        </div>
        <div className="fo-stat">
          <div className="fo-stat-value">{completeJobs}</div>
          <div className="fo-stat-label">Completed</div>
        </div>
        <div className="fo-stat">
          <div className="fo-stat-value">{availableTechs}</div>
          <div className="fo-stat-label">Techs Available</div>
        </div>
        <div className="fo-stat">
          <div className="fo-stat-value">{onJobTechs}</div>
          <div className="fo-stat-label">Techs On Work Order</div>
        </div>
      </div>

      <div className="fo-card">
        <h3>CRM Activity</h3>
        <p>Active Work Orders: {activeWorkOrders.length}</p>
      </div>

      {unassignedWorkOrders && (
        <div className="warning">
          ⚠ Jobs missing Work Order assignment: {unassignedWorkOrders.jobs.length}
        </div>
      )}

      {workOrderGroups.map((wo) => {
        const status = workOrderStatusMap[wo.workOrderId];
        return (
          <div key={wo.workOrderId} className="work-order-card">
            <h3>
              Work Order: {wo.workOrderId}
              <span className={`wo-status wo-${status.toLowerCase()}`}>{status}</span>
            </h3>

            <div>Jobs: {wo.jobs.length}</div>

            <div>
              Pending: {wo.statusCounts.pending} |
              In Progress: {wo.statusCounts.inProgress} |
              Completed: {wo.statusCounts.completed}
            </div>
          </div>
        );
      })}

      <div className="tech-overview">
        <h3>Technician Load</h3>
        {Object.entries(techGroups).map(([tech, techJobs]) => (
          <div key={tech}>
            {tech === "UNASSIGNED" ? "Unassigned" : technicianName(tech)}: {techJobs.length} jobs
          </div>
        ))}
      </div>

      <div className="tech-overview">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h3>At Risk Jobs</h3>
          <select value={riskSort} onChange={(e) => setRiskSort(e.target.value)}>
            <option value="severity">Sort: Severity</option>
            <option value="age">Sort: Age</option>
          </select>
        </div>
        {sortedStalledJobs.length === 0 ? (
          <p className="fo-muted">No stalled jobs detected.</p>
        ) : (
          sortedStalledJobs.map((signal) => (
            <div key={signal.id} className="work-order-card">
              <h3>
                {signal.label}
                <span className={`risk-badge risk-${signal.severity.toLowerCase()}`}>{signal.severity}</span>
              </h3>
              <div className="fo-muted">
                Work Order: {signal.metadata.workOrderId || "unassigned"} · ~{Math.round(signal.metadata.ageHours)}h since creation (approx.)
              </div>
              <div className="fo-muted">
                {signal.metadata.factors.map((f) => f.explanation).join(" · ")}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="tech-overview">
        <h3>Overloaded Technicians</h3>
        {overloadedTechnicians.length === 0 ? (
          <p className="fo-muted">No technicians currently overloaded.</p>
        ) : (
          overloadedTechnicians.map(({ technician, activeJobCount }) => (
            <div key={technician.id} className="fo-card">
              {technician.name}
              <span className="heat-badge heat-high"> {activeJobCount} active jobs</span>
            </div>
          ))
        )}
      </div>

      <div className="tech-overview">
        <h3>Recommended Dispatch Queue</h3>
        {dispatchRecommendations.length === 0 ? (
          <p className="fo-muted">No open jobs awaiting dispatch.</p>
        ) : (
          dispatchRecommendations.map((signal) => (
            <div key={signal.id} className="fo-card">
              <strong>{signal.metadata.job.customer || signal.id}</strong>
              {" → "}
              {signal.metadata.recommended ? (
                <span>
                  {technicianName(signal.metadata.recommended.technicianId)}{" "}
                  <span className="fo-muted">(score {Math.round(signal.score)})</span>
                </span>
              ) : (
                <span className="fo-muted">No eligible technician</span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
