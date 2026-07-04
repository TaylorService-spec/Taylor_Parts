import { useMemo } from "react";
import { JOBS_COLLECTION, TECHNICIANS_COLLECTION, JOB_STATUS, TECH_STATUS } from "../../domain/constants";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";
import { computeWorkOrderStatus } from "../../domain/workOrderScoring";
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
  // also the `workOrders` snapshot passed to every panel below -- there's
  // no populated Firestore "workOrders" collection yet (see
  // domain/workOrders.js), so work orders are derived from jobs, same as
  // everywhere else in Control Tower.
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

      <AtRiskPanel jobs={jobs} technicians={technicians} workOrders={workOrderGroups} />
      <DispatchQueuePanel jobs={jobs} technicians={technicians} workOrders={workOrderGroups} />
      <OverloadedTechPanel jobs={jobs} technicians={technicians} workOrders={workOrderGroups} />
    </div>
  );
}
