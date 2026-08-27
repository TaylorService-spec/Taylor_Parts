import { useCallback, useEffect, useMemo, useState } from "react";

import { useWorkOrders } from "../../hooks/useWorkOrders";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";
import { useSessionActivityFeed } from "../../hooks/useSessionActivityFeed";
import { useTechnicianAvailability } from "../../hooks/useTechnicianAvailability.js";
import { useAccountNames } from "../../hooks/useAccountNames";
import { useAuth } from "../../auth/AuthContext";
import { TECHNICIANS_COLLECTION } from "../../domain/constants";
import { getAllowedActions } from "../../domain/workOrderWorkflow";
import { transitionWorkOrder } from "../../services/workOrderService";
import {
  reassignScheduledWorkOrder,
  rescheduleWorkOrder,
} from "../../services/schedulingCommandClient.js";
import { recommendTechniciansBatch } from "../../domain/technicianRecommendationEngine";
import {
  dayBand,
  fleetBookedPercent,
  isPlaced,
  laneCapacity,
  placementWindow,
  startOfDayMillis,
} from "../../domain/dispatchBoardGeometry.js";
import {
  refusalContextFor,
  schedulingRefusalMessage,
  schedulingWarningMessages,
} from "../../domain/schedulingRefusal.js";
import { workOrderPastDueItem } from "../../domain/workOrderAttentionProjection.js";
import { workOrderStatusLabel } from "../../domain/workOrderStatus";
import { loadErrorMessage } from "../../domain/loadErrorMessage";
import { workflowActionErrorMessage } from "../../domain/workflowActionError";
import WorkspaceIdentity from "../../shared/ui/WorkspaceIdentity.jsx";
import DispatchLaneGrid from "./DispatchLaneGrid.jsx";
import ReadyToScheduleQueue from "./ReadyToScheduleQueue.jsx";
import PlacementDialog, { PLACEMENT_INTENT } from "./PlacementDialog.jsx";
import {
  DISPATCH_VIEW,
  DispatchMapView,
  DispatchTwoWeekLoad,
  DispatchViewSwitcher,
  DispatchWeekView,
} from "./DispatchViews.jsx";
import WorkOrderPreview from "./WorkOrderPreview";
import DispatcherActivityFeed from "./DispatcherActivityFeed";

// ════════════════════ DISPATCH & SCHEDULING — NORTH STAR P1 ════════════════════
//
// Visual authority: docs/north-star/dispatch-board/North Star - Dispatch Board P1.dc.html (frame 1a
// canonical, 1e week/fortnight, 1b guarded moves, 1c honest states, 1d the slot matrix).
// Reconciliation: docs/design/dispatch-north-star-composition-map.md.
//
// This replaces a master-detail board (queue on the left, technician COLUMNS on the right) with the
// artifact's composition: an hour-header LANE GRID over the day, the ready queue beneath it, and the
// board rules + session feed as a footer band. That is the change; everything governed underneath it
// is reused rather than rebuilt.
//
// ════════════════════ THE BOARD IS A FASTER HAND, NOT A NEW AUTHORITY ════════════════════
//
// Every gesture ends in a trusted command and the server decides. Nothing is written optimistically,
// nothing is patched into the local array on success, and the live `useWorkOrders` subscription is
// the ONLY thing that moves a chip — so what the board draws is always committed truth, including
// after a refusal, where the previous placement is simply still there because nothing ever changed.
//
//   queue card  → lane          transitionWorkOrder "Schedule"        READY_TO_DISPATCH → SCHEDULED
//   lane chip   → same lane     rescheduleWorkOrderCallable           status unchanged
//   lane chip   → another lane  reassignScheduledWorkOrderCallable    window taken from the record
//   lane chip   → queue         transitionWorkOrder "Unschedule"      SCHEDULED → READY_TO_DISPATCH
//
// The artifact maps its drop to the governed DISPATCH transition, because Dispatch was the only board
// action that existed when it was drawn (2026-08-27 04:54 — about fourteen hours before the governed
// Scheduling domain merged). A queue Work Order is READY_TO_DISPATCH and has no window at all, so
// "drop onto a time slot in a technician's day" was always describing a Schedule. The composition map
// records that divergence in full. Dispatch itself is untouched and stays reachable through the
// preview pane — retiring a surface must never delete a governed capability with it.
//
// ════════════════════ AVAILABILITY IS READ, NOT SUBSCRIBED ════════════════════
//
// Both availability collections deny client reads (deployed; proved live by the Scheduling Functional
// Gate). `useTechnicianAvailability` is the trusted projection and the only source of shift lines,
// hatched blocked time and every percentage on this page. A technician with no record reads as
// UNKNOWN and renders as "Shift not recorded" with no percentage — never 0%.
export default function DispatcherBoard() {
  const { role } = useAuth();
  const { data: workOrders, loading: workOrdersLoading, error: workOrdersError } = useWorkOrders();
  const { data: technicians, loading: techniciansLoading, error: techniciansError } =
    useFirestoreCollection(TECHNICIANS_COLLECTION);
  const customerNames = useAccountNames((workOrders ?? []).map((w) => w.customerId));
  const activityEntries = useSessionActivityFeed(workOrders, technicians);

  const [view, setView] = useState(DISPATCH_VIEW.DAY);
  const [anchorMillis, setAnchorMillis] = useState(() => startOfDayMillis(Date.now()));
  const [selectedId, setSelectedId] = useState(null);
  const [dragging, setDragging] = useState(null);
  const [dragOverLaneId, setDragOverLaneId] = useState(null);
  const [queueDragOver, setQueueDragOver] = useState(false);
  const [busyWorkOrderId, setBusyWorkOrderId] = useState(null);
  const [boardMessage, setBoardMessage] = useState(null);
  const [pendingPlacement, setPendingPlacement] = useState(null);

  const band = useMemo(() => dayBand(anchorMillis), [anchorMillis]);

  // The availability window spans what the CURRENT VIEW can show, so one read serves the day board,
  // the week grid and the fortnight band without any of them issuing their own.
  const availabilityWindow = useMemo(() => {
    if (view === DISPATCH_VIEW.FORTNIGHT) {
      return { startMillis: anchorMillis - 7 * 86_400_000, endMillis: anchorMillis + 21 * 86_400_000 };
    }
    if (view === DISPATCH_VIEW.WEEK) {
      return { startMillis: anchorMillis - 7 * 86_400_000, endMillis: anchorMillis + 14 * 86_400_000 };
    }
    return { startMillis: startOfDayMillis(anchorMillis), endMillis: startOfDayMillis(anchorMillis) + 86_400_000 };
  }, [view, anchorMillis]);

  const {
    byTechnicianId: availabilityByTechnicianId,
    loading: availabilityLoading,
    error: availabilityError,
    refresh: refreshAvailability,
  } = useTechnicianAvailability({
    startMillis: availabilityWindow.startMillis,
    endMillis: availabilityWindow.endMillis,
    enabled: view !== DISPATCH_VIEW.MAP,
  });

  // ---- derived, all from the one live array -------------------------------------------------

  const placedWorkOrders = useMemo(() => (workOrders ?? []).filter(isPlaced), [workOrders]);

  // SCHEDULED work with NO window cannot be drawn on a lane — there is no geometry for it. It must
  // not therefore vanish: it is a real work order in a real state, and a board that silently dropped
  // it would hide exactly the record a dispatcher most needs to find. The governed Schedule path
  // requires a window, so this is empty in practice; when it is not, the board says so rather than
  // pretending the job does not exist.
  const scheduledWithoutWindow = useMemo(
    () => (workOrders ?? []).filter((wo) => wo.status === "SCHEDULED" && !isPlaced(wo)),
    [workOrders],
  );

  const queueWorkOrders = useMemo(
    () =>
      (workOrders ?? [])
        .filter((wo) => wo.status === "READY_TO_DISPATCH")
        // Priority ascending (1 is highest), then oldest first — the artifact's "ranked by priority
        // and age".
        .sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9) || millisOf(a.createdAt) - millisOf(b.createdAt)),
    [workOrders],
  );

  const workOrdersByTechnician = useMemo(() => {
    const map = new Map();
    for (const wo of placedWorkOrders) {
      const start = placementWindow(wo)?.startMillis;
      if (start == null) continue;
      if (view === DISPATCH_VIEW.DAY && startOfDayMillis(start) !== startOfDayMillis(anchorMillis)) continue;
      if (!map.has(wo.scheduledTechId)) map.set(wo.scheduledTechId, []);
      map.get(wo.scheduledTechId).push(wo);
    }
    for (const list of map.values()) {
      list.sort((a, b) => placementWindow(a).startMillis - placementWindow(b).startMillis);
    }
    return map;
  }, [placedWorkOrders, view, anchorMillis]);

  // Scored for the queue AND for whatever is selected.
  //
  // Queue-only was a real regression: the preview's "Dispatch to…" picker renders only when it has
  // recommendations, and Dispatch is legal from SCHEDULED — which is never in the queue. Scoring the
  // queue alone therefore removed a governed capability from the board without removing a single
  // line of the code that implements it. Retiring a surface's presentation must not delete a
  // capability with it (the SA-G7 lesson, one family earlier).
  const scoringTargets = useMemo(() => {
    const selected = (workOrders ?? []).find((wo) => wo.id === selectedId);
    return selected && !queueWorkOrders.some((wo) => wo.id === selected.id)
      ? [...queueWorkOrders, selected]
      : queueWorkOrders;
  }, [queueWorkOrders, workOrders, selectedId]);

  const recommendationsByWorkOrderId = useMemo(
    () => recommendTechniciansBatch(scoringTargets, technicians ?? [], workOrders ?? []),
    [scoringTargets, technicians, workOrders],
  );

  const selectedWorkOrder = (workOrders ?? []).find((wo) => wo.id === selectedId) ?? null;
  useEffect(() => {
    if (selectedId && !(workOrders ?? []).some((wo) => wo.id === selectedId)) setSelectedId(null);
  }, [workOrders, selectedId]);

  // The header's workload sentence. Every number here is governed or it is absent: `pastDue` comes
  // from the same projection the rest of the product uses, and the fleet percentage renders only
  // when every technician in view has a recorded schedule (see fleetBookedPercent).
  const summaryItems = useMemo(() => {
    const items = [];
    if (!workOrdersLoading && !workOrdersError) {
      items.push({ label: `${queueWorkOrders.length} unassigned`, tone: queueWorkOrders.length ? "attention" : undefined });
      const pastDue = (workOrders ?? []).filter((wo) => workOrderPastDueItem(wo)).length;
      if (pastDue > 0) items.push({ label: `${pastDue} past due`, tone: "attention" });
    }
    const capacities = (technicians ?? []).map((t) =>
      laneCapacity(availabilityByTechnicianId.get(t.id) ?? null, workOrdersByTechnician.get(t.id) ?? [], band),
    );
    const fleet = fleetBookedPercent(capacities);
    if (fleet != null) items.push({ label: `fleet booked ${fleet}%` });
    return items;
  }, [
    queueWorkOrders.length, workOrders, workOrdersLoading, workOrdersError,
    technicians, availabilityByTechnicianId, workOrdersByTechnician, band,
  ]);

  // ---- the four governed placement commands -------------------------------------------------

  const runPlacement = useCallback(
    async ({ intent, workOrderId, technicianId, startMillis, endMillis, reason }) => {
      const workOrder = (workOrders ?? []).find((wo) => wo.id === workOrderId);
      if (!workOrder) return { ok: false, message: "That work order is no longer on the board." };

      setBusyWorkOrderId(workOrderId);
      setBoardMessage(null);
      const context = refusalContextFor(technicians ?? [], technicianId ?? workOrder.scheduledTechId, workOrder);

      try {
        if (intent === PLACEMENT_INTENT.SCHEDULE) {
          // The EXISTING governed Schedule path — the same transition every other surface uses. No
          // second scheduling function was invented for the board (ND-24 was exactly that lesson).
          const result = await transitionWorkOrder(workOrder.id, "Schedule", {
            scheduledStart: startMillis,
            scheduledEnd: endMillis,
            scheduledTechId: technicianId,
          });
          announce(schedulingWarningMessages(result?.warnings, context), `${workOrder.woNumber} scheduled.`);
          return { ok: true };
        }

        if (intent === PLACEMENT_INTENT.RESCHEDULE) {
          const res = await rescheduleWorkOrder({
            workOrderId: workOrder.id,
            scheduledStart: startMillis,
            scheduledEnd: endMillis,
            ...(technicianId ? { scheduledTechId: technicianId } : {}),
            reason,
            // The optimistic-concurrency guard: the start this board BELIEVED it was moving. If
            // somebody else moved it between render and drop, the server refuses STALE_WORK_ORDER
            // rather than silently overwriting a placement this dispatcher never saw.
            expectedScheduledStart: placementWindow(workOrder)?.startMillis,
          });
          if (res.errorStatus) return refusal(res, context);
          announce(schedulingWarningMessages(res.result?.warnings, context), `${workOrder.woNumber} moved.`);
          return { ok: true };
        }

        if (intent === PLACEMENT_INTENT.REASSIGN) {
          const res = await reassignScheduledWorkOrder({
            workOrderId: workOrder.id,
            scheduledTechId: technicianId,
            reason,
          });
          if (res.errorStatus) return refusal(res, context);
          announce(schedulingWarningMessages(res.result?.warnings, context), `${workOrder.woNumber} reassigned.`);
          return { ok: true };
        }

        if (intent === PLACEMENT_INTENT.UNSCHEDULE) {
          // ND-18's governed reverse edge. MarkReady is NEVER used here: it targets the same status
          // and would be a second, reason-free way out of SCHEDULED — the exact defect
          // ACTION_ALLOWED_FROM exists to prevent.
          await transitionWorkOrder(workOrder.id, "Unschedule", { unscheduleReason: reason });
          setBoardMessage({ tone: "ok", text: `${workOrder.woNumber} returned to the queue.` });
          return { ok: true };
        }

        return { ok: false, message: "That action is not available." };
      } catch (err) {
        // transitionWorkOrder throws; the scheduling callables return. Both end up as a sentence.
        const code = err?.details?.code ?? null;
        const message = code
          ? schedulingRefusalMessage(code, stripPrefix(err?.code), context)
          : workflowActionErrorMessage(err);
        setBoardMessage({ tone: "error", text: message });
        return { ok: false, message };
      } finally {
        setBusyWorkOrderId(null);
        // A placement just consumed or released capacity; re-read so the lane is not still reporting
        // the availability it had a moment ago.
        refreshAvailability();
      }

      function refusal(res, ctx) {
        const message = schedulingRefusalMessage(res.errorCode, res.errorStatus, ctx);
        setBoardMessage({ tone: "error", text: message });
        return { ok: false, message };
      }

      function announce(warnings, okText) {
        // ND-20's warnings ride along with a SUCCESSFUL placement and must not be styled as failures
        // — nor dropped, which would make an out-of-hours placement look unremarkable.
        if (warnings.length) setBoardMessage({ tone: "warn", text: `${okText} ${warnings.join(" ")}` });
        else setBoardMessage({ tone: "ok", text: okText });
      }
    },
    [workOrders, technicians, refreshAvailability],
  );

  // ---- gestures -> intents -------------------------------------------------------------------

  const intentForDrop = useCallback((workOrder, targetTechnicianId) => {
    if (workOrder.status === "READY_TO_DISPATCH") return PLACEMENT_INTENT.SCHEDULE;
    if (workOrder.status !== "SCHEDULED") return null;
    return workOrder.scheduledTechId === targetTechnicianId
      ? PLACEMENT_INTENT.RESCHEDULE
      : PLACEMENT_INTENT.REASSIGN;
  }, []);

  const handleDropOnLane = useCallback(
    (technicianId, fraction) => {
      const workOrder = dragging;
      setDragging(null);
      setDragOverLaneId(null);
      if (!workOrder) return;

      const intent = intentForDrop(workOrder, technicianId);
      if (!intent) {
        setBoardMessage({
          tone: "error",
          text: `${workOrder.woNumber} cannot be moved from the board — it is ${statusWords(workOrder.status)}.`,
        });
        return;
      }

      const dropStart = band.startMillis + Math.round(fraction * (band.endMillis - band.startMillis));
      // Snapped to the quarter hour: the pointer resolves to the minute, and a job starting at 9:07
      // because of where a cursor landed is precision the gesture does not actually have.
      const startMillis = Math.round(dropStart / 900_000) * 900_000;
      const existing = placementWindow(workOrder);
      const durationMinutes =
        existing?.durationMinutes ?? workOrder.estimatedDurationMinutes ?? 120;

      // Reassign takes its window from the RECORD, so it opens the gate without a time; the other two
      // carry the dropped time in. All three land in the same dialog, which is the same gate the
      // picker path opens (artifact 1b: "One gate serves drag and picker").
      setPendingPlacement({
        intent,
        workOrder,
        technicianId,
        startMillis: intent === PLACEMENT_INTENT.REASSIGN ? null : startMillis,
        durationMinutes,
      });
    },
    [dragging, intentForDrop, band],
  );

  const handleDropOnQueue = useCallback(() => {
    const workOrder = dragging;
    setDragging(null);
    setQueueDragOver(false);
    if (!workOrder) return;

    // Only from SCHEDULED, and the client mirror of ACTION_ALLOWED_FROM is what says so. From
    // DISPATCHED onward there is no reverse command — ND-3 still holds past that point, exactly as
    // the artifact's board rules say, and the board must not offer one.
    if (!getAllowedActions(workOrder.status, role, false).includes("Unschedule")) {
      setBoardMessage({
        tone: "error",
        text: `${workOrder.woNumber} cannot be returned to the queue — it is ${statusWords(workOrder.status)}.`,
      });
      return;
    }
    setPendingPlacement({ intent: PLACEMENT_INTENT.UNSCHEDULE, workOrder, technicianId: null });
  }, [dragging, role]);

  const confirmPlacement = useCallback(
    async (payload) => {
      const outcome = await runPlacement(payload);
      // A refusal keeps the dialog open with its sentence, so the dispatcher can adjust rather than
      // rebuild their intent. A success closes it; the live subscription moves the chip.
      if (outcome.ok) setPendingPlacement(null);
      else setPendingPlacement((p) => (p ? { ...p, errorMessage: outcome.message } : null));
    },
    [runPlacement],
  );

  // ---- honest states (artifact 1c) -----------------------------------------------------------

  if (role !== "admin" && role !== "dispatcher") {
    return (
      <div className="ns-page">
        <p className="ns-dispatch-denied">The Dispatch Board is not available to you.</p>
      </div>
    );
  }

  const dayLabel = new Date(anchorMillis).toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
  const weekLabel = new Date(anchorMillis).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  return (
    <div className="ns-page ns-dispatch">
      <WorkspaceIdentity
        crumb="Service → Dispatch Board"
        title="Dispatch &amp; Scheduling"
        summaryItems={summaryItems}
      >
        <p className="ns-dispatch__live">
          <span className="ns-dispatch__live-dot" aria-hidden="true" /> Live — updates as work orders change
        </p>
      </WorkspaceIdentity>

      <p className="ns-dispatch__rule">
        Drag a queue card onto a lane to schedule · between lanes to reassign · back to the queue to
        return it. <span className="ns-dispatch__hatch-key" aria-hidden="true" /> Hatched is blocked
        time — its own governed record, never a work order; drops onto it are refused.
      </p>

      <DispatchViewSwitcher view={view} onChange={setView} dayLabel={dayLabel} weekLabel={weekLabel} />

      {boardMessage ? (
        // A REFUSAL is an alert; a success or a warning is a status. Both are announced, but only a
        // refusal interrupts — a screen-reader user who just lost a placement needs to know now,
        // and one who scheduled successfully does not need their reading interrupted to hear it.
        <p
          className={`ns-dispatch__message ns-dispatch__message--${boardMessage.tone}`}
          role={boardMessage.tone === "error" ? "alert" : "status"}
        >
          {boardMessage.text}
        </p>
      ) : null}

      {/* Each read failure gets its OWN sentence (1c). A failed Work Order read is never a
          false-empty board, and a failed technician read never reads as "no technicians exist". */}
      {workOrdersError ? (
        <p className="ns-dispatch__failure" role="alert">
          Work orders could not be loaded. Your work elsewhere is unaffected. {loadErrorMessage(workOrdersError)}
        </p>
      ) : null}
      {techniciansError ? (
        <p className="ns-dispatch__failure" role="alert">
          Technicians could not be loaded, so the lanes cannot be drawn. {loadErrorMessage(techniciansError)}
        </p>
      ) : null}
      {availabilityError ? (
        <p className="ns-dispatch__failure" role="alert">
          Working hours and blocked time could not be read, so shifts and capacity are not shown.
          Scheduling still works and the server still enforces both.
        </p>
      ) : null}

      {workOrdersLoading || techniciansLoading ? (
        <p className="ns-dispatch__loading">Loading the board…</p>
      ) : (
        <>
          {view === DISPATCH_VIEW.DAY ? (
            <DispatchLaneGrid
              technicians={technicians ?? []}
              workOrdersByTechnician={workOrdersByTechnician}
              availabilityByTechnicianId={availabilityByTechnicianId}
              availabilityLoading={availabilityLoading}
              band={band}
              draggingWorkOrder={dragging}
              onDropOnLane={handleDropOnLane}
              onDragStartWorkOrder={setDragging}
              onDragEndWorkOrder={() => { setDragging(null); setDragOverLaneId(null); setQueueDragOver(false); }}
              onSelectWorkOrder={setSelectedId}
              selectedWorkOrderId={selectedId}
              dragOverLaneId={dragOverLaneId}
              onDragOverLane={setDragOverLaneId}
              onDragLeaveLane={() => setDragOverLaneId(null)}
              busyWorkOrderId={busyWorkOrderId}
            />
          ) : null}

          {view === DISPATCH_VIEW.WEEK ? (
            <DispatchWeekView
              technicians={technicians ?? []}
              placedWorkOrders={placedWorkOrders}
              availabilityByTechnicianId={availabilityByTechnicianId}
              anchorMillis={anchorMillis}
              nowMillis={Date.now()}
              draggingWorkOrder={dragging}
              onSelectDay={(d) => { setAnchorMillis(d); setView(DISPATCH_VIEW.DAY); }}
              onDropOnTechnicianDay={(technicianId, dateMillis) => {
                const workOrder = dragging;
                setDragging(null);
                if (!workOrder) return;
                const intent = intentForDrop(workOrder, technicianId);
                if (!intent) return;
                // The week cell has no clock. The dialog opens on that day so the dispatcher names
                // the hour — the artifact's own rule: "the window is set on the day board".
                setPendingPlacement({
                  intent,
                  workOrder,
                  technicianId,
                  startMillis: intent === PLACEMENT_INTENT.REASSIGN ? null : dayBand(dateMillis).startMillis,
                  durationMinutes: placementWindow(workOrder)?.durationMinutes ?? workOrder.estimatedDurationMinutes ?? 120,
                });
              }}
            />
          ) : null}

          {view === DISPATCH_VIEW.FORTNIGHT ? (
            <DispatchTwoWeekLoad
              technicians={technicians ?? []}
              placedWorkOrders={placedWorkOrders}
              availabilityByTechnicianId={availabilityByTechnicianId}
              anchorMillis={anchorMillis}
              nowMillis={Date.now()}
              onSelectDay={(d) => { setAnchorMillis(d); setView(DISPATCH_VIEW.DAY); }}
            />
          ) : null}

          {view === DISPATCH_VIEW.MAP ? <DispatchMapView /> : null}

          {scheduledWithoutWindow.length > 0 ? (
            <section className="ns-dispatch-unplaced" aria-label="Scheduled without a window">
              <h2 className="ns-dispatch-unplaced__title">Scheduled without a window</h2>
              <p className="ns-dispatch-unplaced__note">
                These are scheduled but carry no start and end, so they cannot be drawn on a lane.
                Open one to give it a window.
              </p>
              <div className="ns-dispatch-unplaced__rows">
                {scheduledWithoutWindow.map((wo) => (
                  <button
                    key={wo.id}
                    type="button"
                    className="ns-dispatch-unplaced__row"
                    onClick={() => setSelectedId(wo.id)}
                  >
                    {wo.woNumber}
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <ReadyToScheduleQueue
            workOrders={queueWorkOrders}
            recommendations={recommendationsByWorkOrderId}
            technicians={technicians ?? []}
            customerNames={customerNames}
            selectedWorkOrderId={selectedId}
            onSelectWorkOrder={setSelectedId}
            onOpenPlacementPicker={(wo) =>
              setPendingPlacement({
                intent: PLACEMENT_INTENT.SCHEDULE,
                workOrder: wo,
                technicianId: (recommendationsByWorkOrderId.get(wo.id) ?? [])[0]?.techId ?? null,
                startMillis: band.startMillis,
                durationMinutes: wo.estimatedDurationMinutes ?? 120,
              })
            }
            onDragStartWorkOrder={setDragging}
            onDragEndWorkOrder={() => { setDragging(null); setDragOverLaneId(null); setQueueDragOver(false); }}
            isDragOver={queueDragOver}
            canReturnToQueue={Boolean(dragging && dragging.status === "SCHEDULED")}
            onDragOverQueue={() => setQueueDragOver(true)}
            onDragLeaveQueue={() => setQueueDragOver(false)}
            onDropOnQueue={handleDropOnQueue}
            busyWorkOrderId={busyWorkOrderId}
            boardHasAnyWorkOrders={(workOrders ?? []).length > 0}
            readFailed={Boolean(workOrdersError)}
          />

          <div className="ns-dispatch__footer">
            <section className="ns-dispatch__rules">
              <h3 className="ns-dispatch__footer-title">Board rules (unchanged authority)</h3>
              <p>
                A drop proposes the governed command through the existing engine — the board is a
                faster hand, not a new authority. Illegal moves (a start in the past, a window that
                overlaps other work or blocked time, a technician who cannot be scheduled) are refused
                and the chip stays where it was, with the reason in words. Moving or reassigning a
                scheduled job demands a typed reason. Dispatched work is a fact, not a drag handle:
                there is no reverse command past that point.
              </p>
            </section>
            <aside className="ns-dispatch__session">
              <h3 className="ns-dispatch__footer-title">This session</h3>
              <DispatcherActivityFeed entries={activityEntries} />
            </aside>
          </div>

          {selectedWorkOrder ? (
            <WorkOrderPreview
              workOrder={selectedWorkOrder}
              technicians={technicians ?? []}
              recommendations={recommendationsByWorkOrderId.get(selectedWorkOrder.id) ?? []}
              onDispatchToTechnician={async (workOrder, technicianId) => {
                // DISPATCH — untouched by this migration and deliberately still reachable. Retiring
                // the old board's presentation must not delete a governed capability with it.
                setBusyWorkOrderId(workOrder.id);
                try {
                  await transitionWorkOrder(workOrder.id, "Dispatch", { assignedTechId: technicianId });
                  setBoardMessage({ tone: "ok", text: `${workOrder.woNumber} dispatched.` });
                } catch (err) {
                  setBoardMessage({ tone: "error", text: workflowActionErrorMessage(err) });
                } finally {
                  setBusyWorkOrderId(null);
                }
              }}
              isDispatching={busyWorkOrderId === selectedWorkOrder.id}
            />
          ) : null}
        </>
      )}

      {pendingPlacement ? (
        <PlacementDialog
          intent={pendingPlacement.intent}
          workOrder={pendingPlacement.workOrder}
          technicians={technicians ?? []}
          defaultTechnicianId={pendingPlacement.technicianId}
          defaultStartMillis={pendingPlacement.startMillis}
          defaultDurationMinutes={pendingPlacement.durationMinutes ?? 120}
          submitting={busyWorkOrderId === pendingPlacement.workOrder.id}
          errorMessage={pendingPlacement.errorMessage ?? null}
          onConfirm={confirmPlacement}
          onCancel={() => setPendingPlacement(null)}
        />
      ) : null}
    </div>
  );
}

function millisOf(value) {
  return value?.toMillis?.() ?? (typeof value === "number" ? value : 0);
}

// The GOVERNED display label, never a hand-rolled lowercase of the enum. A locally humanised status
// is a second status vocabulary: it drifts from the real one the moment a label is reworded, and it
// puts the raw enum on screen for any value the local transform does not know about.
function statusWords(status) {
  return workOrderStatusLabel(status) ?? "in a state that cannot be moved from here";
}

function stripPrefix(code) {
  if (typeof code !== "string") return "";
  return code.startsWith("functions/") ? code.slice("functions/".length) : code;
}
