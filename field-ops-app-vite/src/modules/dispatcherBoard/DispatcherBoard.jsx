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
import { useAccountNames } from "../../hooks/useAccountNames";
import WorkOrderPreview from "./WorkOrderPreview";
import TechnicianBoard from "./TechnicianBoard";
import DispatcherActivityFeed from "./DispatcherActivityFeed";
import { loadErrorMessage } from "../../domain/loadErrorMessage";
import { workflowActionErrorMessage } from "../../domain/workflowActionError";
import { WORK_ORDER_STATUS_VALUES, workOrderStatusLabel } from "../../domain/workOrderStatus";
import { Button } from "../../shared/ui/primitives/index.js";
import { resolveTechnicianIdentity } from "../../domain/actorDisplayName";

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
  const { data: workOrders, loading: workOrdersLoading, error: workOrdersError } = useWorkOrders();
  const customerNames = useAccountNames((workOrders ?? []).map((w) => w.customerId));
  const { data: technicians, loading: techniciansLoading, error: techniciansError } = useFirestoreCollection(TECHNICIANS_COLLECTION);
  const activityEntries = useSessionActivityFeed(workOrders, technicians);

  const [selectedId, setSelectedId] = useState(null);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [dispatchError, setDispatchError] = useState(null);
  const [dispatchingWorkOrderId, setDispatchingWorkOrderId] = useState(null);
  // H20 fix: reassigning a Work Order away from the technician it was Scheduled for is a distinct,
  // audited, reason-required action (Owner ruling) -- never a silent side effect of a drag-drop or a
  // picker selection. Both handleDispatchDrop call sites (WorkOrderPreview's picker button AND
  // TechnicianBoard's drag-and-drop) funnel through this ONE function, so this is the single place that
  // decides whether to dispatch immediately or hold for a reason -- {workOrder, technicianId} awaiting a
  // typed reason, or null when nothing is pending.
  const [pendingReassignment, setPendingReassignment] = useState(null);
  const [reassignReasonInput, setReassignReasonInput] = useState("");
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

  // H20 fix: extracted so both the immediate (same-technician) path below AND confirmReassignment() share
  // the exact same transitionWorkOrder() call and error handling -- one dispatch code path, not two.
  async function dispatch(workOrder, technicianId, reassignReason) {
    setDispatchingWorkOrderId(workOrder.id);
    try {
      await transitionWorkOrder(workOrder.id, "Dispatch", {
        assignedTechId: technicianId,
        ...(reassignReason ? { reassignReason } : {}),
      });
    } catch (err) {
      console.error(err);
      // site-work r3 L: previously surfaced err.message verbatim, leaking raw
      // Firebase/Functions codes. Route through the same safe-copy helper
      // Dispatch.jsx's assign() uses for this identical transitionWorkOrder()
      // "Dispatch" failure shape.
      setDispatchError(workflowActionErrorMessage(err));
    } finally {
      setDispatchingWorkOrderId((id) => (id === workOrder.id ? null : id));
    }
  }

  // H20 fix: the single entry point both WorkOrderPreview's picker button AND TechnicianBoard's drag-drop
  // call. The server is the real authority on whether this is a reassignment (it compares against
  // wo.scheduledTechId at the moment Dispatch runs) -- this client-side check only decides whether to hold
  // for a reason before calling dispatch(); the server still enforces the requirement itself regardless.
  async function handleDispatchDrop(workOrder, technicianId) {
    if (dispatchingWorkOrderId === workOrder.id) return;
    setDispatchError(null);
    const allowed = getAllowedActions(workOrder.status, role, false);
    if (!allowed.includes("Dispatch")) {
      setDispatchError(
        `Cannot dispatch ${workOrder.woNumber ?? workOrder.id}: only SCHEDULED work orders can be dispatched (current status: ${workOrder.status}).`
      );
      return;
    }
    if (workOrder.scheduledTechId && workOrder.scheduledTechId !== technicianId) {
      setPendingReassignment({ workOrder, technicianId });
      setReassignReasonInput("");
      return;
    }
    await dispatch(workOrder, technicianId);
  }

  async function confirmReassignment() {
    if (!pendingReassignment || !reassignReasonInput.trim()) return;
    const { workOrder, technicianId } = pendingReassignment;
    setPendingReassignment(null);
    await dispatch(workOrder, technicianId, reassignReasonInput.trim());
    setReassignReasonInput("");
  }

  function cancelReassignment() {
    setPendingReassignment(null);
    setReassignReasonInput("");
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
          {WORK_ORDER_STATUS_VALUES.map((s) => (
            <option key={s} value={s}>
              {workOrderStatusLabel(s)}
            </option>
          ))}
        </select>
      </div>

      <DispatcherActivityFeed entries={activityEntries} />

      {dispatchError && (
        <div className="warning" role="alert">
          {dispatchError}
        </div>
      )}

      {/* H20 fix: a dispatcher MAY reassign a Work Order away from the technician it was Scheduled for,
          but a reason is REQUIRED (Owner ruling) -- this blocks the drag-drop/picker dispatch until one is
          typed, so a reassignment is always a visible, deliberate, accountable choice, never an accident. */}
      {pendingReassignment && (
        <div className="fo-form disp-reassign-confirm" role="group" aria-label="Reassignment reason required">
          <p role="alert">
            Reassigning {pendingReassignment.workOrder.woNumber ?? pendingReassignment.workOrder.id} from{" "}
            {resolveTechnicianIdentity(pendingReassignment.workOrder.scheduledTechId, { technicians }).name}{" "}
            to {resolveTechnicianIdentity(pendingReassignment.technicianId, { technicians }).name} —
            a reason is required.
          </p>
          <textarea
            value={reassignReasonInput}
            onChange={(e) => setReassignReasonInput(e.target.value)}
            placeholder="Why is this job being reassigned?"
            aria-label="Reassignment reason"
            rows={2}
          />
          <div className="fo-dispatch__reassign-actions">
            <Button variant="primary" onClick={confirmReassignment} disabled={!reassignReasonInput.trim()}>
              Confirm reassignment
            </Button>
            <Button variant="secondary" onClick={cancelReassignment}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="fo-muted">Loading dispatcher board...</p>
      ) : workOrdersError ? (
        // Fail VISIBLY. A denied/unavailable work-order read used to fall
        // through to "No work orders exist yet" -- a false empty board a
        // dispatcher could read as nothing to do, missing real jobs with no
        // indication anything failed.
        <p className="fo-muted" role="alert">
          {loadErrorMessage(workOrdersError, { entity: "work orders" })}
        </p>
      ) : techniciansError ? (
        // Same fail-visibly fix as workOrdersError above, applied to the
        // technicians read: a denied/unavailable technicians listener used to
        // fall through to TechnicianBoard's "No technicians exist yet" empty
        // state -- a dispatcher would read that as "there are no technicians"
        // rather than "this read failed," with no recommendations, no drop
        // targets, and no indication anything is wrong.
        <p className="fo-muted" role="alert">
          {loadErrorMessage(techniciansError, { entity: "technicians" })}
        </p>
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
            customerNames={customerNames}
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
            isDispatching={dispatchingWorkOrderId === selectedWorkOrder?.id}
          />
          <TechnicianBoard
            technicians={technicians}
            selectedWorkOrder={selectedWorkOrder}
            recommendations={selectedWorkOrder ? recommendationsByWorkOrderId.get(selectedWorkOrder.id) ?? [] : []}
            allWorkOrders={workOrders}
            onDropTechnician={handleDispatchDrop}
            isDispatching={dispatchingWorkOrderId === selectedWorkOrder?.id}
          />
        </div>
      )}
    </div>
  );
}
