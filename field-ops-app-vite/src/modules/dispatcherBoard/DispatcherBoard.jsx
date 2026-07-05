import { useEffect, useMemo, useState } from "react";
import { useWorkOrders } from "../../hooks/useWorkOrders";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";
import { useAuth } from "../../auth/AuthContext";
import { TECHNICIANS_COLLECTION } from "../../domain/constants";
import { getAllowedActions } from "../../domain/workOrderWorkflow";
import { transitionWorkOrder } from "../../services/workOrderService";
import { recommendTechnicians } from "../../domain/technicianRecommendationEngine";
import WorkOrderQueue from "./WorkOrderQueue";
import WorkOrderPreview from "./WorkOrderPreview";
import TechnicianBoard from "./TechnicianBoard";

// Epic 2 Phase 2C -- Dispatcher Operations Board. A new, additional
// screen -- does NOT replace or modify ControlTower.jsx, Dispatch.jsx,
// or WorkOrderDetail.jsx/WorkOrderActions.jsx, all of which are
// untouched by this feature and keep working exactly as before.
//
// Named "dispatcherBoard", deliberately NOT "DispatcherWorkspace" --
// that name already belongs to unrelated work on the still-unmerged
// epic-2-work-order-interactive-ui branch; reusing it here would
// recreate exactly the kind of naming collision this project has hit
// repeatedly this session.
//
// Single Firestore listener per collection (useWorkOrders() +
// useFirestoreCollection(TECHNICIANS_COLLECTION)) -- no per-column or
// per-technician listeners, matching this epic's performance
// requirement. All filtering/search is client-side over the one
// already-loaded workOrders array.
//
// Drag-and-drop dispatch: on drop, this calls transitionWorkOrder()
// directly (the same Cloud Function WorkOrderActions.jsx's Dispatch
// button already calls) -- never writes Firestore directly, never
// optimistically persists an assignment. The backend remains
// authoritative: a drop is only enabled when
// getAllowedActions(status, role, false) actually includes "Dispatch"
// (i.e. only for SCHEDULED work orders, matching the real transition
// table -- see ADR-002's "Work Order Lifecycle Authority" section).
// Board refresh comes entirely from useWorkOrders()'s onSnapshot, same
// as everywhere else in this app.
export default function DispatcherBoard() {
  const { role } = useAuth();
  const { data: workOrders, loading: workOrdersLoading } = useWorkOrders();
  const { data: technicians, loading: techniciansLoading } = useFirestoreCollection(TECHNICIANS_COLLECTION);

  const [selectedId, setSelectedId] = useState(null);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [dispatchError, setDispatchError] = useState(null);

  // Debounced search -- no shared debounce hook exists on main (only
  // on an unmerged branch), so this is a small self-contained
  // setTimeout debounce rather than a new shared abstraction.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput.trim().toLowerCase()), 250);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const filteredWorkOrders = useMemo(() => {
    return workOrders.filter((wo) => {
      if (statusFilter !== "ALL" && wo.status !== statusFilter) return false;
      if (!debouncedSearch) return true;
      const haystack = `${wo.woNumber ?? ""} ${wo.customerId ?? ""} ${wo.type ?? ""}`.toLowerCase();
      return haystack.includes(debouncedSearch);
    });
  }, [workOrders, statusFilter, debouncedSearch]);

  // Persistent selection: looked up by id from the live array every
  // render, so it survives onSnapshot refreshes without any extra
  // bookkeeping -- if the selected WO still exists, it's still
  // selected; if it was removed/filtered out, selection just clears.
  const selectedWorkOrder = filteredWorkOrders.find((wo) => wo.id === selectedId) ?? null;

  useEffect(() => {
    if (selectedId && !workOrders.some((wo) => wo.id === selectedId)) {
      setSelectedId(null);
    }
  }, [workOrders, selectedId]);

  const recommendationsByWorkOrderId = useMemo(() => {
    const map = new Map();
    for (const wo of filteredWorkOrders) {
      map.set(wo.id, recommendTechnicians(wo, technicians, workOrders));
    }
    return map;
  }, [filteredWorkOrders, technicians, workOrders]);

  async function handleDispatchDrop(workOrder, technicianId) {
    setDispatchError(null);
    const allowed = getAllowedActions(workOrder.status, role, false);
    if (!allowed.includes("Dispatch")) {
      setDispatchError(
        `Cannot dispatch ${workOrder.woNumber ?? workOrder.id}: only SCHEDULED work orders can be dispatched (current status: ${workOrder.status}).`
      );
      return;
    }
    try {
      await transitionWorkOrder(workOrder.id, "Dispatch", { assignedTechId: technicianId });
    } catch (err) {
      console.error(err);
      setDispatchError(err.message);
    }
  }

  const loading = workOrdersLoading || techniciansLoading;

  return (
    <div className="fo-panel">
      <h2>Dispatcher Board</h2>

      <div className="disp-board-toolbar">
        <input
          type="text"
          placeholder="Search work orders, customer, type..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="ALL">All statuses</option>
          {["CREATED", "READY_TO_DISPATCH", "SCHEDULED", "DISPATCHED", "ACCEPTED", "EN_ROUTE", "ARRIVED", "WORK_IN_PROGRESS", "COMPLETED", "CLOSED", "CANCELLED"].map(
            (s) => (
              <option key={s} value={s}>
                {s}
              </option>
            )
          )}
        </select>
      </div>

      {dispatchError && <div className="warning">{dispatchError}</div>}

      {loading ? (
        <p className="fo-muted">Loading dispatcher board...</p>
      ) : filteredWorkOrders.length === 0 ? (
        <p className="fo-muted">No work orders match the current search/filter.</p>
      ) : (
        <div className="disp-board-layout">
          <WorkOrderQueue
            workOrders={filteredWorkOrders}
            recommendationsByWorkOrderId={recommendationsByWorkOrderId}
            technicians={technicians}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
          <WorkOrderPreview
            workOrder={selectedWorkOrder}
            technicians={technicians}
            recommendations={selectedWorkOrder ? recommendationsByWorkOrderId.get(selectedWorkOrder.id) ?? [] : []}
          />
          <TechnicianBoard
            technicians={technicians}
            selectedWorkOrder={selectedWorkOrder}
            recommendations={selectedWorkOrder ? recommendationsByWorkOrderId.get(selectedWorkOrder.id) ?? [] : []}
            onDropTechnician={handleDispatchDrop}
          />
        </div>
      )}
    </div>
  );
}
