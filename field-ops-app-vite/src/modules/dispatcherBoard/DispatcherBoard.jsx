import { useEffect, useMemo, useRef, useState } from "react";
import { useWorkOrders } from "../../hooks/useWorkOrders";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";
import { useSessionActivityFeed } from "../../hooks/useSessionActivityFeed";
import { useAuth } from "../../auth/AuthContext";
import { TECHNICIANS_COLLECTION } from "../../domain/constants";
import { getAllowedActions } from "../../domain/workOrderWorkflow";
import { transitionWorkOrder } from "../../services/workOrderService";
import { recommendTechniciansBatch } from "../../domain/technicianRecommendationEngine";
import WorkOrderQueue from "./WorkOrderQueue";
import WorkOrderPreview from "./WorkOrderPreview";
import TechnicianBoard from "./TechnicianBoard";
import DispatcherActivityFeed from "./DispatcherActivityFeed";

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
// already-loaded workOrders array. Recommendations are computed once
// per render via recommendTechniciansBatch() (technician aggregates
// computed once, not once per queue card -- see that function's
// header comment for the complexity difference at scale).
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
// as everywhere else in this app. `isDispatching` guards against a
// rapid double-drop firing two concurrent transitionWorkOrder() calls
// for the same Work Order.
export default function DispatcherBoard() {
  const { role } = useAuth();
  const { data: workOrders, loading: workOrdersLoading } = useWorkOrders();
  const { data: technicians, loading: techniciansLoading } = useFirestoreCollection(TECHNICIANS_COLLECTION);
  const activityEntries = useSessionActivityFeed(workOrders, technicians);

  const [selectedId, setSelectedId] = useState(null);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [dispatchError, setDispatchError] = useState(null);
  const [isDispatching, setIsDispatching] = useState(false);
  const queueRef = useRef(null);

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
  // selected; if it was removed/filtered out, selection just clears
  // (falls back to null, WorkOrderPreview shows its empty state).
  const selectedWorkOrder = filteredWorkOrders.find((wo) => wo.id === selectedId) ?? null;

  useEffect(() => {
    if (selectedId && !workOrders.some((wo) => wo.id === selectedId)) {
      setSelectedId(null);
    }
  }, [workOrders, selectedId]);

  const recommendationsByWorkOrderId = useMemo(
    () => recommendTechniciansBatch(filteredWorkOrders, technicians, workOrders),
    [filteredWorkOrders, technicians, workOrders]
  );

  async function handleDispatchDrop(workOrder, technicianId) {
    if (isDispatching) return; // rapid repeated drops -- ignore while one is already in flight
    setDispatchError(null);
    const allowed = getAllowedActions(workOrder.status, role, false);
    if (!allowed.includes("Dispatch")) {
      setDispatchError(
        `Cannot dispatch ${workOrder.woNumber ?? workOrder.id}: only SCHEDULED work orders can be dispatched (current status: ${workOrder.status}).`
      );
      return;
    }
    setIsDispatching(true);
    try {
      await transitionWorkOrder(workOrder.id, "Dispatch", { assignedTechId: technicianId });
    } catch (err) {
      console.error(err);
      setDispatchError(err.message);
    } finally {
      setIsDispatching(false);
    }
  }

  // Keyboard navigation (Priority 4 accessibility + Priority 2 UX):
  // Up/Down moves selection through the currently-filtered queue,
  // Enter is a no-op beyond selection (the preview pane is always
  // visible once selected, there's no separate "open" step), Escape
  // clears selection. Scoped to the queue pane via onKeyDown so it
  // doesn't hijack typing in the search input.
  function handleQueueKeyDown(e) {
    if (filteredWorkOrders.length === 0) return;
    const currentIndex = filteredWorkOrders.findIndex((wo) => wo.id === selectedId);

    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = filteredWorkOrders[Math.min(currentIndex + 1, filteredWorkOrders.length - 1)] ?? filteredWorkOrders[0];
      setSelectedId(next.id);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = filteredWorkOrders[Math.max(currentIndex - 1, 0)] ?? filteredWorkOrders[0];
      setSelectedId(prev.id);
    } else if (e.key === "Escape") {
      setSelectedId(null);
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
          aria-label="Search work orders"
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
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

      <DispatcherActivityFeed entries={activityEntries} />

      {dispatchError && (
        <div className="warning" role="alert">
          {dispatchError}
        </div>
      )}

      {loading ? (
        <p className="fo-muted">Loading dispatcher board...</p>
      ) : workOrders.length === 0 ? (
        <p className="fo-muted">No work orders exist yet. Create one from the Work Orders tab to see it here.</p>
      ) : filteredWorkOrders.length === 0 ? (
        <p className="fo-muted">No work orders match "{searchInput}" / the selected status filter. Try clearing the search or choosing "All statuses".</p>
      ) : (
        <div
          className="disp-board-layout"
          ref={queueRef}
          onKeyDown={handleQueueKeyDown}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => e.preventDefault()}
        >
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
            onDispatchToTechnician={handleDispatchDrop}
            isDispatching={isDispatching}
          />
          <TechnicianBoard
            technicians={technicians}
            selectedWorkOrder={selectedWorkOrder}
            recommendations={selectedWorkOrder ? recommendationsByWorkOrderId.get(selectedWorkOrder.id) ?? [] : []}
            allWorkOrders={workOrders}
            onDropTechnician={handleDispatchDrop}
            isDispatching={isDispatching}
          />
        </div>
      )}
    </div>
  );
}
