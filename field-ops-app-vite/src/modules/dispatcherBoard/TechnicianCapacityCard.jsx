import { memo } from "react";

// Epic 2 Phase 2C -- Priority 2 UX: "Technician Capacity Card."
// Extracted into its own file to keep TechnicianBoard.jsx from
// growing past a size worth splitting (Priority 3 component-size
// audit). Status-label logic lives in ./technicianStatusLabel.js, not
// here, to keep this file component-only.
//
// Bucket definitions, mapped from the real 11-value WorkOrderStatus
// (no invented categories):
//   In Progress = WORK_IN_PROGRESS (actually being worked right now)
//   Scheduled   = SCHEDULED or DISPATCHED (awaiting technician action)
//   Traveling   = ACCEPTED, EN_ROUTE, or ARRIVED (en route to or at
//                 site, not yet started work)
//
// NOTE on the "Active" vocabulary: this card intentionally does NOT
// label the WORK_IN_PROGRESS-only count "Active." The Work Orders list
// (WorkOrdersList.jsx) and the Technician Dashboard's ACTIVE_STATUSES
// both use "Active" for a broader 5-status bucket (DISPATCHED,
// ACCEPTED, EN_ROUTE, ARRIVED, WORK_IN_PROGRESS). A bare "Active" here
// would silently disagree with those counts on the same data. See the
// "Active" vocabulary note in docs/architecture/ADR-012-persona-authority-composition-and-scope.md
// (this is the discovered 5th sense: Work Order "in progress," which
// is distinct from the four canonical Employee/Role/Capability/Record
// "active" concepts documented there). Do not rename this to "Active"
// without also reconciling it with the other two buckets.
const SCHEDULED_STATUSES = new Set(["SCHEDULED", "DISPATCHED"]);
const TRAVELING_STATUSES = new Set(["ACCEPTED", "EN_ROUTE", "ARRIVED"]);

function TechnicianCapacityCard({ technician, workOrders }) {
  const assigned = workOrders.filter((wo) => wo.assignedTechId === technician.id);
  const inProgress = assigned.filter((wo) => wo.status === "WORK_IN_PROGRESS").length;
  const scheduled = assigned.filter((wo) => SCHEDULED_STATUSES.has(wo.status)).length;
  const traveling = assigned.filter((wo) => TRAVELING_STATUSES.has(wo.status)).length;
  const total = inProgress + scheduled + traveling;

  // Bar width relative to a soft cap of 10 concurrent WOs -- purely a
  // visual proportion, not a real capacity limit (no such field exists
  // anywhere in the technician schema).
  const barPct = Math.min(100, (total / 10) * 100);

  return (
    <div className="disp-capacity-card">
      <div className="disp-capacity-bar-track" role="img" aria-label={`Workload: ${total} in-progress work orders`}>
        <div className="disp-capacity-bar-fill" style={{ width: `${barPct}%` }} />
      </div>
      <div className="fo-muted disp-capacity-counts">
        In Progress: {inProgress} &middot; Scheduled: {scheduled} &middot; Traveling: {traveling}
      </div>
    </div>
  );
}

export default memo(TechnicianCapacityCard);

