import { useMemo } from "react";
import { JOBS_COLLECTION, TECHNICIANS_COLLECTION, JOB_STATUS, TECH_STATUS } from "../../domain/constants";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";
import { useWorkOrders } from "../../hooks/useWorkOrders";
import { useAuth } from "../../auth/AuthContext";
import { groupJobsByTechnician } from "./techUtils";
import AtRiskPanel from "./panels/AtRiskPanel";
import DispatchQueuePanel from "./panels/DispatchQueuePanel";
import OverloadedTechPanel from "./panels/OverloadedTechPanel";
import ActivityTimelinePanel from "./panels/ActivityTimelinePanel";
import PartsOverviewPanel from "./panels/PartsOverviewPanel";
import WorkOrderDetail from "./WorkOrderDetail";

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
//
// Reconciled dependency chain (Sprint 3.3 + 3.4, updated for Work Order
// Engine v1.2 -- see docs/architecture/ADR-002): Control Tower never
// computes Work Order lifecycle itself -- it only renders.
//
//   Firestore
//     -> Job Workflow (3.1: assignJob()/updateJobStatus()) -- unchanged
//     -> fieldops_wos (Epic 1: real, persisted Work Order docs, written
//        only by the createWorkOrder/transitionWorkOrder Cloud
//        Functions -- replaces the old derived-from-jobs grouping this
//        component used before)
//     -> Signal Layer (workOrderScoring.js's computeWorkOrderSignalFromDoc,
//        a map from workOrder.status -- wraps
//        domain/workOrderLifecycle.js's explainWorkOrder())
//     -> Control Tower Panels (3.3: AtRiskPanel/DispatchQueuePanel/
//        OverloadedTechPanel, ActivityTimelinePanel, and
//        WorkOrderDetail) -- consume Signals, never recompute them.

export default function ControlTower() {
  const { role } = useAuth();
  const { data: jobs } = useFirestoreCollection(JOBS_COLLECTION);
  const { data: technicians } = useFirestoreCollection(TECHNICIANS_COLLECTION);
  const { data: workOrders } = useWorkOrders();

  const openJobs = jobs.filter((j) => j.status === JOB_STATUS.OPEN).length;
  const assignedJobs = jobs.filter((j) => j.status === JOB_STATUS.ASSIGNED || j.status === JOB_STATUS.IN_PROGRESS).length;
  const completeJobs = jobs.filter((j) => j.status === JOB_STATUS.COMPLETE).length;
  const availableTechs = technicians.filter((t) => t.status === TECH_STATUS.AVAILABLE).length;
  const onJobTechs = technicians.filter((t) => t.status === TECH_STATUS.ON_JOB).length;

  // Jobs with no workOrderId at all -- still a legitimate operational
  // signal now that job.workOrderId is a real (soft, unenforced) FK to
  // fieldops_wos. Separately, a job.workOrderId that points at a WO doc
  // that never existed or was since removed is now also *possible* --
  // there's no referential integrity between the two collections
  // (deliberate, see docs/architecture/ADR-002) -- but that anomaly
  // isn't detected/surfaced this pass.
  const unassignedJobs = useMemo(() => jobs.filter((job) => !job.workOrderId), [jobs]);

  // Jobs linked to a given real Work Order doc, for that WO's
  // "Operational History" (WorkOrderDetail.jsx) -- a soft-coupled join
  // done at render time, no denormalization, no write-time sync.
  const jobsForWorkOrder = (workOrderId) => jobs.filter((j) => j.workOrderId === workOrderId);

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

      {unassignedJobs.length > 0 && (
        <div className="warning">
          ⚠ Jobs missing Work Order assignment: {unassignedJobs.length}
        </div>
      )}

      {workOrders.map((wo) => (
        <WorkOrderDetail key={wo.id} workOrder={wo} jobs={jobsForWorkOrder(wo.id)} role={role} technicians={technicians} />
      ))}

      <div className="tech-overview">
        <h3>Technician Load</h3>
        {Object.entries(techGroups).map(([tech, techJobs]) => (
          <div key={tech}>
            {tech === "UNASSIGNED" ? "Unassigned" : technicianName(tech)}: {techJobs.length} jobs
          </div>
        ))}
      </div>

      <AtRiskPanel jobs={jobs} technicians={technicians} workOrders={workOrders} />
      <DispatchQueuePanel jobs={jobs} technicians={technicians} workOrders={workOrders} />
      <OverloadedTechPanel jobs={jobs} technicians={technicians} workOrders={workOrders} />
      <ActivityTimelinePanel jobs={jobs} technicians={technicians} workOrders={workOrders} />
      <PartsOverviewPanel jobs={jobs} technicians={technicians} workOrders={workOrders} />
    </div>
  );
}
