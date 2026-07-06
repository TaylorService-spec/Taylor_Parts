import { useMemo, useState } from "react";
import { useCurrentTechnician } from "../../hooks/useCurrentTechnician";
import { useAssignedWorkOrders } from "../../hooks/useAssignedWorkOrders";
import { technicianStatusLabel } from "../dispatcherBoard/technicianStatusLabel";
import TechnicianWorkOrderCard from "./TechnicianWorkOrderCard";
import TechnicianWorkOrderDetail from "./TechnicianWorkOrderDetail";

// Epic 6 Phase 6.1/6.2 -- Technician Dashboard, the landing page for
// the technician role. UI + read-layer composition (6.1) plus the
// lifecycle action detail view (6.2, TechnicianWorkOrderDetail.jsx) --
// no writes happen in this file itself; selecting a card just shows
// the detail view inline, no new route/navigation architecture.
//
// Data source is exactly useAssignedWorkOrders(technicianId) (PT-002)
// -- never the dispatcher-side unfiltered useWorkOrders(). technicianId
// comes from useCurrentTechnician() (users/{uid}.technicianId ->
// fieldops_technicians/{technicianId}, see that hook's header comment).
//
// Section bucketing is a pure client-side grouping of the real
// 11-value WorkOrderStatus enum -- no new backend concept, no
// timestamp-based workflow inference (the one exception, Completed
// Today's date filter, uses the real persisted `completedAt` field
// purely for display grouping of an already-terminal status, not to
// infer lifecycle state -- same category as WorkOrderQueue.jsx's
// existing "age" display).
//
// A technician's assignedTechId is only ever set by the Dispatch
// action (SCHEDULED -> DISPATCHED), so CREATED/READY_TO_DISPATCH/
// SCHEDULED work orders never appear here regardless of bucketing --
// there is nothing to additionally filter out for those statuses.
const READY_TO_START_STATUSES = new Set(["DISPATCHED"]);
const WAITING_STATUSES = new Set(["ACCEPTED", "EN_ROUTE", "ARRIVED"]);
const IN_PROGRESS_STATUSES = new Set(["WORK_IN_PROGRESS"]);
const ACTIVE_STATUSES = new Set(["DISPATCHED", "ACCEPTED", "EN_ROUTE", "ARRIVED", "WORK_IN_PROGRESS"]);

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function Section({ title, workOrders, selectedId, onSelect, emptyMessage }) {
  return (
    <div className="fo-card">
      <h3>
        {title} ({workOrders.length})
      </h3>
      {workOrders.length === 0 ? (
        <p className="fo-muted">{emptyMessage}</p>
      ) : (
        workOrders.map((wo) => (
          <TechnicianWorkOrderCard key={wo.id} workOrder={wo} isSelected={selectedId === wo.id} onSelect={onSelect} />
        ))
      )}
    </div>
  );
}

export default function TechnicianDashboard() {
  const { technician, loading: technicianLoading } = useCurrentTechnician();
  const { data: workOrders, loading: workOrdersLoading, error } = useAssignedWorkOrders(technician?.id ?? null);
  const [selectedId, setSelectedId] = useState(null);

  const buckets = useMemo(() => {
    const readyToStart = [];
    const inProgress = [];
    const waiting = [];
    const completedToday = [];
    const today = new Date();

    for (const wo of workOrders) {
      if (READY_TO_START_STATUSES.has(wo.status)) readyToStart.push(wo);
      else if (IN_PROGRESS_STATUSES.has(wo.status)) inProgress.push(wo);
      else if (WAITING_STATUSES.has(wo.status)) waiting.push(wo);
      else if (wo.status === "COMPLETED" && wo.completedAt?.toDate && isSameDay(wo.completedAt.toDate(), today)) {
        completedToday.push(wo);
      }
    }

    const activeCount = workOrders.filter((wo) => ACTIVE_STATUSES.has(wo.status)).length;

    return { readyToStart, inProgress, waiting, completedToday, activeCount };
  }, [workOrders]);

  const selectedWorkOrder = workOrders.find((wo) => wo.id === selectedId) ?? null;

  const loading = technicianLoading || workOrdersLoading;

  if (loading) {
    return (
      <div className="fo-panel">
        <h2>My Work Orders</h2>
        <p className="fo-muted">Loading your Work Orders...</p>
      </div>
    );
  }

  if (!technician) {
    return (
      <div className="fo-panel">
        <h2>My Work Orders</h2>
        <p className="fo-muted">
          Your account isn't linked to a technician record yet. Contact an admin to get this set up (see PT-001's
          technician identity mapping).
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fo-panel">
        <h2>My Work Orders</h2>
        <p className="fo-muted">Couldn't load your Work Orders: {error.message}</p>
      </div>
    );
  }

  return (
    <div className="fo-panel">
      <div className="disp-board-toolbar" style={{ justifyContent: "space-between" }}>
        <div>
          <h2 style={{ margin: 0 }}>Hi, {technician.name}</h2>
          <span className={`fo-badge fo-badge-${technician.status}`}>{technicianStatusLabel(technician.status)}</span>
        </div>
        <div className="fo-stat">
          <div className="fo-stat-value">{buckets.activeCount}</div>
          <div className="fo-stat-label">My Active Work Orders</div>
        </div>
      </div>

      {selectedWorkOrder ? (
        <TechnicianWorkOrderDetail workOrder={selectedWorkOrder} onClose={() => setSelectedId(null)} />
      ) : (
        <>
          <Section
            title="Ready to Start"
            workOrders={buckets.readyToStart}
            selectedId={selectedId}
            onSelect={setSelectedId}
            emptyMessage="No Work Orders waiting on you to accept."
          />
          <Section
            title="In Progress"
            workOrders={buckets.inProgress}
            selectedId={selectedId}
            onSelect={setSelectedId}
            emptyMessage="Nothing actively in progress right now."
          />
          <Section
            title="Waiting"
            workOrders={buckets.waiting}
            selectedId={selectedId}
            onSelect={setSelectedId}
            emptyMessage="Nothing accepted/en route/arrived right now."
          />
          <Section
            title="Completed Today"
            workOrders={buckets.completedToday}
            selectedId={selectedId}
            onSelect={setSelectedId}
            emptyMessage="Nothing completed yet today."
          />
        </>
      )}
    </div>
  );
}
