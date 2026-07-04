import { useMemo } from "react";
import { JOBS_COLLECTION, TECHNICIANS_COLLECTION, JOB_STATUS, TECH_STATUS } from "../../domain/constants";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";
import { explainWorkOrderState } from "../../domain/workOrderLifecycle";
import { groupJobsByTechnician } from "./techUtils";
import AtRiskPanel from "./panels/AtRiskPanel";
import DispatchQueuePanel from "./panels/DispatchQueuePanel";
import OverloadedTechPanel from "./panels/OverloadedTechPanel";

// Work Order-centric operational dashboard. Job state, technician state,
// and work-order grouping all come from main's domain layer — this view
// only aggregates and displays; it never mutates jobs, work orders, or
// technicians.
//
// Sprint 3.3.4: the dispatch-intelligence panels (At Risk / Dispatch
// Queue / Overloaded Technicians) are isolated components in ./panels --
// each is a pure renderer of one domain module's signals, taking only
// { jobs, technicians, workOrders } as props. Control Tower itself stays
// the composition root: it owns the Firestore listeners and passes the
// same snapshot down to every panel; no panel fetches Firestore itself.
//
// Sprint 3.3.6 invariants (enforced, not just documented -- see
// domain/controlTower/types.js's assertPanelProps/assertValidSignal,
// called at the top of each panel in dev builds):
//   1. Every panel receives exactly { jobs, technicians, workOrders } --
//      no panel may accept or require any other prop shape.
//   2. No panel may call useFirestoreCollection or import firebase/*
//      directly -- ControlTower is the only Firestore listener owner.
//   3. No panel may inline scoring/derivation logic -- panels call into
//      domain/*.js and render the result; they don't compute severity,
//      risk, or rankings themselves.
//   4. Every signal a panel renders must be a canonical Signal
//      ({ id, score, severity, label, metadata }) per
//      domain/controlTower/types.js -- asserted via assertValidSignal.

export default function ControlTower() {
  const { data: jobs } = useFirestoreCollection(JOBS_COLLECTION);
  const { data: technicians } = useFirestoreCollection(TECHNICIANS_COLLECTION);

  const openJobs = jobs.filter((j) => j.status === JOB_STATUS.OPEN).length;
  const assignedJobs = jobs.filter((j) => j.status === JOB_STATUS.ASSIGNED || j.status === JOB_STATUS.IN_PROGRESS).length;
  const completeJobs = jobs.filter((j) => j.status === JOB_STATUS.COMPLETE).length;
  const availableTechs = technicians.filter((t) => t.status === TECH_STATUS.AVAILABLE).length;
  const onJobTechs = technicians.filter((t) => t.status === TECH_STATUS.ON_JOB).length;

  // Group jobs by workOrderId. Jobs without one yet (no work-order picker
  // exists in the UI so far) fall into the "unassigned" bucket. This is
  // grouping only -- no lifecycle decision is made here; state/counts
  // come from domain/workOrderLifecycle.js below. It's also the
  // `workOrders` snapshot passed to every panel -- there's no populated
  // Firestore "workOrders" collection yet (see domain/workOrders.js), so
  // work orders are derived from jobs, same as everywhere else in
  // Control Tower.
  const workOrderGroups = useMemo(() => {
    const groups = {};

    jobs.forEach((job) => {
      const id = job.workOrderId || "unassigned";

      if (!groups[id]) {
        groups[id] = { workOrderId: id, jobs: [] };
      }

      groups[id].jobs.push(job);
    });

    return Object.values(groups);
  }, [jobs]);

  const unassignedWorkOrders = workOrderGroups.find(
    (wo) => wo.workOrderId === "unassigned"
  );

  // Sprint 3.4: Work Order state + reason, one call into the single
  // aggregation engine (domain/workOrderLifecycle.js) per work order.
  // Neither owns or mutates state.
  const workOrderExplanations = useMemo(() => {
    const map = {};
    workOrderGroups.forEach((wo) => {
      map[wo.workOrderId] = explainWorkOrderState(wo.jobs);
    });
    return map;
  }, [workOrderGroups]);

  const techGroups = useMemo(() => groupJobsByTechnician(jobs), [jobs]);
  const technicianName = (id) => technicians.find((t) => t.id === id)?.name || id;

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

      {unassignedWorkOrders && (
        <div className="warning">
          ⚠ Jobs missing Work Order assignment: {unassignedWorkOrders.jobs.length}
        </div>
      )}

      {workOrderGroups.map((wo) => {
        const explanation = workOrderExplanations[wo.workOrderId];
        return (
          <div key={wo.workOrderId} className="work-order-card">
            <h3>
              Work Order: {wo.workOrderId}
              <span className={`wo-status wo-${explanation.state.toLowerCase()}`}>
                {explanation.state}
              </span>
            </h3>

            <div className="fo-muted">{explanation.reasons.join(" · ")}</div>

            <div>
              Open: {explanation.metrics.openJobs} |
              Assigned: {explanation.metrics.assignedJobs} |
              In Progress: {explanation.metrics.inProgressJobs} |
              Completed: {explanation.metrics.completedJobs}
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

      <AtRiskPanel jobs={jobs} technicians={technicians} workOrders={workOrderGroups} />
      <DispatchQueuePanel jobs={jobs} technicians={technicians} workOrders={workOrderGroups} />
      <OverloadedTechPanel jobs={jobs} technicians={technicians} workOrders={workOrderGroups} />
    </div>
  );
}
