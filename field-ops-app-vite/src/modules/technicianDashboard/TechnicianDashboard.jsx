import { useMemo, useState } from "react";
import { useCurrentTechnician } from "../../hooks/useCurrentTechnician";
import { useAssignedWorkOrders } from "../../hooks/useAssignedWorkOrders";
import { technicianStatusLabel } from "../dispatcherBoard/technicianStatusLabel";
import { technicianStatusTone } from "../../domain/technicianStatusTone";
import TechnicianWorkOrderCard from "./TechnicianWorkOrderCard";
import TechnicianWorkOrderDetail from "./TechnicianWorkOrderDetail";
import PerformanceSnapshot from "./PerformanceSnapshot";
import TechnicianPerformance from "./TechnicianPerformance.jsx";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import WorkspaceShell from "../../shared/ui/WorkspaceShell.jsx";
import ContextBand from "../../shared/ui/ContextBand.jsx";
import StatusPill from "../../shared/ui/StatusPill.jsx";
import { Button } from "../../shared/ui/primitives/index.js";

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
  const { operationalRoles, employeeId } = useAuth();
  const {
    technician,
    loading: technicianLoading,
    error: technicianError,
    retry: retryTechnician,
  } = useCurrentTechnician();
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
      <WorkspaceShell title="My Work Orders">
        <p className="fo-muted">Loading your Work Orders...</p>
      </WorkspaceShell>
    );
  }

  if (technicianError) {
    return (
      <WorkspaceShell title="My Work Orders">
        <p className="fo-muted" role="alert">
          Your technician profile could not be loaded. {technicianError}
        </p>
        <Button variant="secondary" onClick={retryTechnician}>Retry</Button>
      </WorkspaceShell>
    );
  }

  if (!technician) {
    // Operational roles (Warehouse Manager, Parts Manager, Parts Associate) sit ON TOP
    // of the base "technician" role, so they land here and read a technician-record
    // message they can never satisfy -- two personas reported it as the first thing
    // they saw. They are not mis-provisioned; this simply is not their workspace.
    // Point them at the one that is, rather than leaving an error as their landing page.
    if (operationalRoles && operationalRoles.length > 0) {
      return (
        <WorkspaceShell title="My Dashboard">
          <p className="fo-muted">
            This account is set up for inventory and purchasing work, not field work.
          </p>
          <p><Link className="fo-inline-action" to="/inventory-role">Go to My Inventory Role</Link></p>
        </WorkspaceShell>
      );
    }
    return (
      <WorkspaceShell title="My Work Orders">
        <p className="fo-muted">
          Your account isn't linked to a technician record yet. Contact an admin to get this set up (see PT-001's
          technician identity mapping).
        </p>
      </WorkspaceShell>
    );
  }

  if (error) {
    return (
      <WorkspaceShell title="My Work Orders">
        <p className="fo-muted">Couldn't load your Work Orders: {error}</p>
      </WorkspaceShell>
    );
  }

  const context = (
    <ContextBand
      items={[
        { key: "status", label: "Status", value: <StatusPill tone={technicianStatusTone(technician.status)} label={technicianStatusLabel(technician.status)} /> },
        { key: "active", label: "My Active Work Orders", value: buckets.activeCount },
      ]}
    />
  );

  return (
    <WorkspaceShell title={`Hi, ${technician.name}`} context={context}>
      {selectedWorkOrder ? (
        <TechnicianWorkOrderDetail workOrder={selectedWorkOrder} onClose={() => setSelectedId(null)} />
      ) : (
        <>
          <PerformanceSnapshot technicianId={technician.id} />
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
          {/* PERFORMANCE COMES AFTER THE WORK, at every width, and that ordering is the product
              decision rather than a layout convenience. A technician opening this screen is usually
              standing in front of a machine; what they need to DO must not be below what they are
              measured on. The all-time snapshot above stays where it was -- it is a compact strip
              about identity, not a scorecard -- and this is the section that carries targets. */}
          <TechnicianPerformance employeeId={employeeId ?? null} />
        </>
      )}
    </WorkspaceShell>
  );
}
