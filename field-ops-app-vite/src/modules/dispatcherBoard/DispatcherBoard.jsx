import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { useWorkOrders } from "../../hooks/useWorkOrders";
import { useWorkOrderTechnicians } from "../../hooks/useWorkOrderTechnicians";
import { useSessionActivityFeed } from "../../hooks/useSessionActivityFeed";
import { useTechnicianAvailability } from "../../hooks/useTechnicianAvailability.js";
import { useAccountNames } from "../../hooks/useAccountNames";
import { useAuth } from "../../auth/AuthContext";
import { getAllowedActions } from "../../domain/workOrderWorkflow";
import { suggestWorkOrderPlacement } from "../../services/workOrderService";
import { callWorkspaceApi } from "../../services/workspaceApiClient";
import { useMyWorkOrderCapabilities } from "../../hooks/useMyWorkOrderCapabilities";
import { boardTimeZone, formatDay, formatInstant, setBoardTimeZone } from "../../domain/boardClock.js";
import { recommendTechniciansBatch } from "../../domain/technicianRecommendationEngine";
import {
  SLOT_MS,
  dayBand,
  dayOccupancy,
  fleetBookedPercent,
  isPlaced,
  isSlotSelectable,
  laneCapacity,
  moveWindow,
  placementWindow,
  resizeWindow,
  startOfDayMillis,
  windowForDrop,
} from "../../domain/dispatchBoardGeometry.js";
import { resolveTechnicianIdentity } from "../../domain/actorDisplayName.js";
import { workOrderPastDueItem } from "../../domain/workOrderAttentionProjection.js";
import { workOrderStatusLabel } from "../../domain/workOrderStatus";
import { loadErrorMessage } from "../../domain/loadErrorMessage";
import { availabilityReadRefusalMessage } from "../../domain/workOrderOutcome.js";
import { readBoardUrlState, writeBoardUrlState } from "../../domain/dispatchBoardUrlState.js";
import WorkspaceIdentity from "../../shared/ui/WorkspaceIdentity.jsx";
import DispatchLaneGrid from "./DispatchLaneGrid.jsx";
import ReadyToScheduleQueue from "./ReadyToScheduleQueue.jsx";
import PlacementDialog, { PLACEMENT_INTENT } from "./PlacementDialog.jsx";
import { usePlacementCommands } from "./usePlacementCommands.js";
import ReasonPrompt from "./ReasonPrompt.jsx";
import {
  DISPATCH_VIEW,
  DispatchTwoWeekLoad,
  DispatchViewSwitcher,
  DispatchWeekView,
} from "./DispatchViews.jsx";
import TechnicianFilter, { visibleTechnicians } from "./TechnicianFilter.jsx";
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
// UNKNOWN and renders as "No schedule" with no percentage — never 0%.
/** The governed capability every placement gesture on this board needs (Schedule, Move, Resize, Reassign, Return). */
const SCHEDULE_CAPABILITY = "workOrder.lifecycle.schedule";
/** Dispatch from the preview needs its own capability -- the same rule as the Jobs page (DECISIONS #239). */
const DISPATCH_CAPABILITY = "workOrder.lifecycle.dispatch";

export default function DispatcherBoard({ callWorkspace = callWorkspaceApi } = {}) {
  const { role } = useAuth();
  // WHAT IS OFFERED follows the caller's governed capabilities (readMyWorkOrderCapabilities), failing closed while
  // unknown -- the same rule the Jobs page uses (DECISIONS #239). The server still re-checks every command.
  const caps = useMyWorkOrderCapabilities();
  const canSchedule = caps.has(SCHEDULE_CAPABILITY);

  // THE GRID'S CLOCK: the governed business time zone of the caller's companies (readMyCompanyAuthority), so the day,
  // the hour band and the dates are the company's, not the browser's. One zone across the caller's companies is used;
  // none or several -> the browser's zone, and the board says so. Set during render so every geometry call below
  // draws in it; cleared on unmount so other screens keep the browser clock.
  const [companyZones, setCompanyZones] = useState(null);
  useEffect(() => {
    let live = true;
    callWorkspace("readMyCompanyAuthority", {}).then((res) => {
      if (!live) return;
      setCompanyZones(res?.ok ? [...new Set((res.result.companies ?? []).map((c) => c.businessTimeZone).filter(Boolean))] : []);
    });
    return () => { live = false; };
  }, [callWorkspace]);
  const governedZone = companyZones?.length === 1 ? companyZones[0] : null;
  setBoardTimeZone(governedZone);
  useEffect(() => () => setBoardTimeZone(null), []);
  const { data: workOrders, loading: workOrdersLoading, error: workOrdersError } = useWorkOrders();
  // The GOVERNED roster (listWorkOrderTechnicians): lane ids are EMPLOYEE ids, the same ids the governed
  // Work Orders' assignedTechId / scheduledTechId carry. NOT fieldops_technicians (whose ids never match).
  const { data: technicians, loading: techniciansLoading, error: techniciansError } = useWorkOrderTechnicians();
  const customerNames = useAccountNames((workOrders ?? []).map((w) => w.customerId));
  const activityEntries = useSessionActivityFeed(workOrders, technicians);

  // G-6: view, date and technician filter live in the URL (domain/dispatchBoardUrlState.js), so Back
  // from a Work Order or an Employee record returns to the same board. Selection and drag state are
  // gestures, not places, and stay in memory.
  const [searchParams, setSearchParams] = useSearchParams();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- governedZone: the board clock the date parse reads
  const { view, anchorMillis, technicianFilter } = useMemo(() => readBoardUrlState(searchParams, Date.now()), [searchParams, governedZone]);
  // Stepping through days REPLACES the entry (Back should not walk every day you clicked past);
  // changing view or filter pushes one.
  const updateBoardUrl = useCallback((patch, { replace = false } = {}) => {
    setSearchParams((prev) => writeBoardUrlState(prev, { ...readBoardUrlState(prev, Date.now()), ...patch }, Date.now()), { replace });
  }, [setSearchParams]);
  const setView = useCallback((v) => updateBoardUrl({ view: v }), [updateBoardUrl]);
  const setAnchorMillis = useCallback((t) => updateBoardUrl({ anchorMillis: t }, { replace: true }), [updateBoardUrl]);
  const setTechnicianFilter = useCallback((f) => updateBoardUrl({ technicianFilter: f }), [updateBoardUrl]);
  const openDay = useCallback((d) => updateBoardUrl({ anchorMillis: d, view: DISPATCH_VIEW.DAY }), [updateBoardUrl]);
  // EMPLOYEE REVIEW: a lane name opens that technician's schedule and work -- the week view filtered to them, with
  // their placed work listed. `back` holds the board exactly as it was (date, view, filters) for the return. It shows
  // only what the board already read for this caller (company-isolated, capability-gated server-side); it opens no
  // Employee record and reads nothing new.
  const focusId = searchParams.get("focus");
  const reviewTechnician = useCallback((techId) => {
    setSearchParams((prev) => {
      const next = writeBoardUrlState(prev, { ...readBoardUrlState(prev, Date.now()), view: DISPATCH_VIEW.WEEK, technicianFilter: new Set([techId]) }, Date.now());
      next.set("focus", techId);
      next.set("back", prev.has("focus") ? prev.get("back") ?? "" : prev.toString());
      return next;
    });
  }, [setSearchParams]);
  const endReview = useCallback(
    () => setSearchParams(new URLSearchParams(searchParams.get("back") ?? "")),
    [searchParams, setSearchParams],
  );
  // The current-time line and the elapsed region move with the clock, not only with data: one
  // re-render a minute keeps them honest on a board left open all day.
  const [, setMinuteTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setMinuteTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  const [selectedId, setSelectedId] = useState(null);
  const [dragging, setDragging] = useState(null);
  const [dragOverLaneId, setDragOverLaneId] = useState(null);
  const [queueDragOver, setQueueDragOver] = useState(false);
  const [pendingPlacement, setPendingPlacement] = useState(null);
  // VC-1: the compact reason-only step. Distinct from pendingPlacement, which still drives the FULL
  // picker — the accessible non-drag path genuinely has to collect a placement, so it keeps its
  // fields. A drag does not, and must not be sent through the same form.
  const [pendingReason, setPendingReason] = useState(null);

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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- governedZone: the board clock these day computations read
  }, [view, anchorMillis, governedZone]);

  const {
    byTechnicianId: availabilityByTechnicianId,
    loading: availabilityLoading,
    error: availabilityError,
    refresh: refreshAvailability,
  } = useTechnicianAvailability({
    startMillis: availabilityWindow.startMillis,
    endMillis: availabilityWindow.endMillis,
  });

  // ---- the four governed placement commands + Dispatch: shared with the Jobs page ------------
  const {
    runPlacement, dispatchTo, busyWorkOrderId, message: boardMessage, setMessage: setBoardMessage,
  } = usePlacementCommands({ workOrders, technicians, onAfterPlacement: refreshAvailability });

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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- governedZone: the board clock these day computations read
  }, [placedWorkOrders, view, anchorMillis, governedZone]);

  // The drawn hour band, WIDENED by whatever this day actually holds.
  //
  // Computed here rather than from the date alone because it depends on the day's placements and
  // blocked time: ND-20 allows work outside recorded hours, so a fixed 7a-5p window would commit an
  // 02:00 emergency and then draw nothing. Derived from the same two sources the lanes render from,
  // so the grid can always draw everything the lanes contain.
  // The lanes the three views draw. Presentation only — availability is still read for the WHOLE
  // roster, recommendations still score every technician, and the queue is untouched.
  const lanes = useMemo(() => visibleTechnicians(technicians ?? [], technicianFilter), [technicians, technicianFilter]);
  const missingFilterIds = useMemo(() => {
    if (!(technicianFilter instanceof Set) || !Array.isArray(technicians)) return 0;
    const known = new Set(technicians.map((t) => t.id));
    return [...technicianFilter].filter((id) => !known.has(id)).length;
  }, [technicians, technicianFilter]);

  const band = useMemo(
    () => dayBand(anchorMillis, dayOccupancy([...workOrdersByTechnician.values()].flat(), [...availabilityByTechnicianId.values()])),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- governedZone: the board clock these day computations read
    [anchorMillis, workOrdersByTechnician, availabilityByTechnicianId, governedZone],
  );

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


  // ---- gestures -> intents -------------------------------------------------------------------

  const intentForDrop = useCallback((workOrder, targetTechnicianId) => {
    if (workOrder.status === "READY_TO_DISPATCH") return PLACEMENT_INTENT.SCHEDULE;
    if (workOrder.status !== "SCHEDULED") return null;
    return workOrder.scheduledTechId === targetTechnicianId
      ? PLACEMENT_INTENT.RESCHEDULE
      : PLACEMENT_INTENT.REASSIGN;
  }, []);

  // ONE placement path for both hands: a drop and a tap ("Place on a lane", then click a time) land here with the
  // work order, the lane and where on the lane, and go through the same checks and governed commands.
  const placeOnLane = useCallback(
    (workOrder, technicianId, fraction) => {
      if (!workOrder) return;

      const intent = intentForDrop(workOrder, technicianId);
      if (!intent) {
        setBoardMessage({
          tone: "error",
          text: `${workOrder.woNumber} cannot be moved from the board — it is ${statusWords(workOrder.status)}.`,
        });
        return;
      }

      const existing = placementWindow(workOrder);
      const durationMinutes =
        existing?.durationMinutes ?? workOrder.estimatedDurationMinutes ?? 120;
      // Snapped to the quarter hour: the pointer resolves to the minute, and a job starting at 9:07
      // because of where a cursor landed is precision the gesture does not actually have.
      const dropped = windowForDrop(band, fraction, durationMinutes);

      // VC-4. A slot already past is not a target. The board used to accept the drop and then
      // pre-fill a form the server was certain to refuse with START_IN_PAST — the refusal was
      // guaranteed before the dispatcher typed anything. Refused HERE, and deliberately NOT snapped
      // forward: moving the time to the next free slot would silently change what was asked for.
      if (intent !== PLACEMENT_INTENT.REASSIGN && !isSlotSelectable(dropped.startMillis, Date.now())) {
        setBoardMessage({
          tone: "error",
          text: "That time has already passed. Pick a later slot — the board will not move it forward for you.",
        });
        return;
      }

      // VC-1. The gesture already said technician, start and duration. What happens next depends
      // only on whether the governed command needs something the gesture CANNOT supply.
      if (intent === PLACEMENT_INTENT.SCHEDULE) {
        // Schedule takes no reason server-side, so there is nothing left to ask. Commit.
        runPlacement({
          intent,
          workOrderId: workOrder.id,
          technicianId,
          startMillis: dropped.startMillis,
          endMillis: dropped.endMillis,
        });
        return;
      }

      // Reschedule and Reassign both REQUIRE a reason (schedulingCommands.ts parseReason). That is
      // the one thing a drag cannot express, so it is the only thing asked for.
      setPendingReason(
        intent === PLACEMENT_INTENT.REASSIGN
          // Reassign takes its window from the RECORD — a reassignment that also re-timed the job
          // would be two changes wearing one reason.
          ? { intent, workOrder, technicianId }
          : { intent, workOrder, technicianId, startMillis: dropped.startMillis, endMillis: dropped.endMillis },
      );
    },
    [intentForDrop, band, runPlacement, setBoardMessage],
  );

  const handleDropOnLane = useCallback(
    (technicianId, fraction) => {
      const workOrder = dragging;
      setDragging(null);
      setDragOverLaneId(null);
      placeOnLane(workOrder, technicianId, fraction);
    },
    [dragging, placeOnLane],
  );

  // TAP / CLICK PLACEMENT — the alternative to dragging (touch screens have no HTML drag at all). "Place on a lane"
  // arms one work order; the next click on a lane places it there through placeOnLane; Esc or Cancel disarms.
  const [placing, setPlacing] = useState(null);
  const handleTapOnLane = useCallback(
    (technicianId, fraction) => {
      const workOrder = placing;
      setPlacing(null);
      placeOnLane(workOrder, technicianId, fraction);
    },
    [placing, placeOnLane],
  );
  useEffect(() => {
    if (!placing) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setPlacing(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [placing]);

  /**
   * VC-2/VC-3 — direct manipulation of a placed chip, pointer or keyboard, same governed command.
   *
   * `mode` is what the gesture MEANT: "move" keeps the duration and shifts both edges, "resize"
   * keeps the start and moves the end. Both end at rescheduleWorkOrderCallable; neither invents a
   * duration write path (setWorkOrderEstimatedDuration is a PLANNING estimate, not a placement).
   */
  const adjustPlacement = useCallback(
    (workOrder, mode, deltaMillis) => {
      const current = placementWindow(workOrder);
      if (!current) {
        // The R23 windowless case. There is no time to move, and inventing one here would schedule
        // by side effect — it must go through a real placement instead.
        setBoardMessage({
          tone: "error",
          text: `${workOrder.woNumber} has no scheduled window to adjust. Give it a time first.`,
        });
        return;
      }
      const next = mode === "resize"
        ? resizeWindow(current, deltaMillis)
        : moveWindow(current, deltaMillis);

      if (!isSlotSelectable(next.startMillis, Date.now())) {
        setBoardMessage({ tone: "error", text: "That would start in the past. Pick a later time." });
        return;
      }
      setPendingReason({
        intent: PLACEMENT_INTENT.RESCHEDULE,
        workOrder,
        technicianId: workOrder.scheduledTechId ?? null,
        startMillis: next.startMillis,
        endMillis: next.endMillis,
      });
    },
    [setBoardMessage],
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
  }, [dragging, role, setBoardMessage]);

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

  /**
   * VC-1 — the reason-only step commits the placement the GESTURE already described.
   *
   * On refusal the prompt stays open carrying the sanitized sentence, and the chip has not moved:
   * nothing is written optimistically, so "return the chip to its original position" is simply what
   * happens when the live subscription never reports a change.
   */
  const confirmReason = useCallback(
    async (reason) => {
      const pending = pendingReason;
      if (!pending) return;
      const outcome = await runPlacement({
        intent: pending.intent,
        workOrderId: pending.workOrder.id,
        technicianId: pending.technicianId,
        startMillis: pending.startMillis,
        endMillis: pending.endMillis,
        reason,
      });
      if (outcome.ok) setPendingReason(null);
      else setPendingReason((p) => (p ? { ...p, errorMessage: outcome.message } : null));
    },
    [pendingReason, runPlacement],
  );

  // ---- honest states (artifact 1c) -----------------------------------------------------------

  if (role !== "admin" && role !== "dispatcher") {
    return (
      <div className="ns-page">
        <p className="ns-dispatch-denied">The Dispatch Board is not available to you.</p>
      </div>
    );
  }

  const dayLabel = formatDay(anchorMillis, { weekday: "short", day: "numeric" });
  const weekLabel = formatDay(anchorMillis, { month: "short", day: "numeric" });

  return (
    <div className="ns-page ns-dispatch">
      <WorkspaceIdentity
        crumb="Service → Dispatch Board"
        title="Dispatch &amp; Scheduling"
        summaryItems={summaryItems}
      >
        <p className="ns-dispatch__live">
          <span className="ns-dispatch__live-dot" aria-hidden="true" /> Refreshes every 30 seconds, and right after your own changes
        </p>
        <p className="ns-dispatch__zone">
          Times are in {boardTimeZone()}
          {companyZones !== null && !governedZone
            ? companyZones.length > 1 ? " (your browser's zone; your companies keep different business time zones)" : " (your browser's zone; the company's could not be read)"
            : ""}
          .
        </p>
      </WorkspaceIdentity>

      {/* One compact legend line instead of a paragraph. Each swatch is bound to the SAME CSS rule as the
          thing it explains, so the legend and the lane cannot drift apart. */}
      <ul className="ns-dispatch__legend" aria-label="Board legend">
        <li><span className="ns-dispatch__swatch ns-dispatch__swatch--booked" aria-hidden="true" />Booked</li>
        <li><span className="ns-dispatch__swatch ns-dispatch__hatch-key" aria-hidden="true" />Unavailable (PTO, training…) — drops refused</li>
        <li><span className="ns-dispatch__swatch ns-dispatch__swatch--off" aria-hidden="true" />Not working</li>
        <li><span className="ns-dispatch__swatch ns-dispatch__swatch--unconfigured" aria-hidden="true" />No schedule recorded</li>
        <li><span className="ns-dispatch__swatch ns-dispatch__swatch--elapsed" aria-hidden="true" />Elapsed — not a target</li>
        <li><span className="ns-dispatch__swatch ns-dispatch__swatch--now" aria-hidden="true" />Now</li>
      </ul>
      {caps.status === "ready" && !canSchedule ? (
        <p className="fo-muted" role="status">You can see the board, but scheduling is not part of your access.</p>
      ) : null}
      {canSchedule ? (
        <p className="ns-dispatch__rule">
          Drag a queue card onto a lane to schedule, between lanes to reassign, back to the queue to return
          it; drag a chip&rsquo;s trailing edge to resize. No drag? Use <b>Place on a lane</b>, then click a time.
          Focused chip: <kbd>←</kbd>/<kbd>→</kbd> 15 min (<kbd>Shift</kbd> = 1 h), <kbd>Alt</kbd>+arrow resizes,
          <kbd>R</kbd> reassigns. Click a technician&rsquo;s name to review their schedule and work.
        </p>
      ) : (
        <p className="ns-dispatch__rule">Click a technician&rsquo;s name to review their schedule and work.</p>
      )}

      <DispatchViewSwitcher
        view={view}
        onChange={setView}
        dayLabel={dayLabel}
        weekLabel={weekLabel}
        anchorMillis={anchorMillis}
        onAnchorChange={(t) => setAnchorMillis(startOfDayMillis(t))}
        isToday={startOfDayMillis(anchorMillis) === startOfDayMillis(Date.now())}
      >
        <TechnicianFilter
          technicians={technicians ?? []}
          selectedIds={technicianFilter}
          onChange={setTechnicianFilter}
        />
        {missingFilterIds > 0 ? (
          // A shared link can name technicians who are no longer on the governed roster. Say so,
          // rather than leaving a board filtered to nothing with no cue why.
          <span className="ns-dispatch__filter-missing" role="status">
            {missingFilterIds === 1 ? "1 selected technician not found" : `${missingFilterIds} selected technicians not found`}
          </span>
        ) : null}
      </DispatchViewSwitcher>

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
        // A REFUSED read (no company authority, no capability) is said as the refusal it is; only a genuine outage gets
        // the "could not be read" sentence -- telling a refused caller the server "still enforces both" is not the cause.
        <p className="ns-dispatch__failure" role="alert">
          {availabilityReadRefusalMessage(availabilityError) ?? (
            <>
              Working hours and blocked time could not be read, so shifts and capacity are not shown.
              Scheduling still works and the server still enforces both.
            </>
          )}
        </p>
      ) : null}

      {placing ? (
        <p className="ns-dispatch-placing" role="status">
          <span>Placing <b>{placing.woNumber}</b>: click a time on a technician&rsquo;s lane (day view). Esc cancels.</span>
          <button type="button" className="fo-button fo-button--tertiary" onClick={() => setPlacing(null)}>Cancel</button>
        </p>
      ) : null}

      {focusId ? (
        <TechnicianReview
          name={resolveTechnicianIdentity(focusId, { technicians: technicians ?? [] })?.name ?? "This technician"}
          workOrders={placedWorkOrders.filter((wo) => wo.scheduledTechId === focusId)}
          onSelectWorkOrder={setSelectedId}
          onBack={endReview}
        />
      ) : null}

      {workOrdersLoading || techniciansLoading ? (
        <p className="ns-dispatch__loading">Loading the board…</p>
      ) : (
        <>
          {view === DISPATCH_VIEW.DAY ? (
            <DispatchLaneGrid
              technicians={lanes}
              workOrdersByTechnician={workOrdersByTechnician}
              availabilityByTechnicianId={availabilityByTechnicianId}
              availabilityLoading={availabilityLoading}
              availabilityFailed={Boolean(availabilityError)}
              band={band}
              draggingWorkOrder={dragging}
              onDropOnLane={canSchedule ? handleDropOnLane : undefined}
              onDragStartWorkOrder={canSchedule ? setDragging : undefined}
              onDragEndWorkOrder={() => { setDragging(null); setDragOverLaneId(null); setQueueDragOver(false); }}
              onSelectWorkOrder={setSelectedId}
              selectedWorkOrderId={selectedId}
              dragOverLaneId={dragOverLaneId}
              onDragOverLane={setDragOverLaneId}
              onDragLeaveLane={() => setDragOverLaneId(null)}
              busyWorkOrderId={busyWorkOrderId}
              onAdjustPlacement={canSchedule ? adjustPlacement : undefined}
              onReassignRequest={canSchedule ? (wo) => setPendingReason({ intent: PLACEMENT_INTENT.REASSIGN, workOrder: wo, technicianId: wo.scheduledTechId ?? null }) : undefined}
              slotMillis={SLOT_MS}
              placingWorkOrder={canSchedule ? placing : null}
              onTapLane={canSchedule ? handleTapOnLane : undefined}
              onSelectTechnician={reviewTechnician}
            />
          ) : null}

          {view === DISPATCH_VIEW.WEEK ? (
            <DispatchWeekView
              technicians={lanes}
              placedWorkOrders={placedWorkOrders}
              availabilityByTechnicianId={availabilityByTechnicianId}
              availabilityFailed={Boolean(availabilityError)}
              anchorMillis={anchorMillis}
              nowMillis={Date.now()}
              draggingWorkOrder={dragging}
              onSelectDay={openDay}
              onSelectTechnician={reviewTechnician}
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
              technicians={lanes}
              placedWorkOrders={placedWorkOrders}
              availabilityByTechnicianId={availabilityByTechnicianId}
              availabilityFailed={Boolean(availabilityError)}
              anchorMillis={anchorMillis}
              nowMillis={Date.now()}
              onSelectDay={openDay}
            />
          ) : null}

          {scheduledWithoutWindow.length > 0 ? (
            <section className="ns-dispatch-unplaced" aria-label="Scheduled Without a Window">
              <h2 className="ns-dispatch-unplaced__title">Scheduled Without a Window</h2>
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
            onOpenPlacementPicker={canSchedule ? (wo) =>
              setPendingPlacement({
                intent: PLACEMENT_INTENT.SCHEDULE,
                workOrder: wo,
                technicianId: (recommendationsByWorkOrderId.get(wo.id) ?? [])[0]?.techId ?? null,
                // No guessed start: the dialog asks suggestWorkOrderPlacement for the earliest valid window.
                startMillis: null,
                durationMinutes: wo.estimatedDurationMinutes ?? 120,
              }) : undefined
            }
            onDragStartWorkOrder={canSchedule ? setDragging : undefined}
            onStartPlacing={canSchedule ? (wo) => { setPlacing(wo); if (view !== DISPATCH_VIEW.DAY) setView(DISPATCH_VIEW.DAY); } : undefined}
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
              <h3 className="ns-dispatch__footer-title">Board Rules (Unchanged Authority)</h3>
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
              <h3 className="ns-dispatch__footer-title">This Session</h3>
              <DispatcherActivityFeed entries={activityEntries} />
            </aside>
          </div>

          {selectedWorkOrder ? (
            <WorkOrderPreview
              workOrder={selectedWorkOrder}
              technicians={technicians ?? []}
              recommendations={recommendationsByWorkOrderId.get(selectedWorkOrder.id) ?? []}
              // DISPATCH — deliberately still reachable here; the same governed transition the Jobs page uses.
              onDispatchToTechnician={caps.has(DISPATCH_CAPABILITY) ? (workOrder, technicianId) => dispatchTo(workOrder, technicianId) : undefined}
              onStartPlacing={canSchedule ? (wo) => { setPlacing(wo); if (view !== DISPATCH_VIEW.DAY) setView(DISPATCH_VIEW.DAY); } : undefined}
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
          suggestPlacement={suggestWorkOrderPlacement}
          submitting={busyWorkOrderId === pendingPlacement.workOrder.id}
          errorMessage={pendingPlacement.errorMessage ?? null}
          onConfirm={confirmPlacement}
          onCancel={() => setPendingPlacement(null)}
        />
      ) : null}

      {pendingReason ? (
        <ReasonPrompt
          title={
            pendingReason.intent === PLACEMENT_INTENT.REASSIGN
              ? "Reassign this work order"
              : "Move this work order"
          }
          context={reasonPromptContext(pendingReason, technicians ?? [])}
          confirmLabel={pendingReason.intent === PLACEMENT_INTENT.REASSIGN ? "Reassign" : "Move"}
          submitting={busyWorkOrderId === pendingReason.workOrder.id}
          errorMessage={pendingReason.errorMessage ?? null}
          onConfirm={confirmReason}
          onCancel={() => setPendingReason(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * The read-only sentence above the reason field. A SENTENCE, not fields — these values came from the
 * gesture and are not editable here; restating them as inputs is the defect this correction removes.
 */
function reasonPromptContext(pending, technicians) {
  const name = resolveTechnicianIdentity(pending.technicianId, { technicians })?.name ?? "this technician";
  if (pending.intent === PLACEMENT_INTENT.REASSIGN) {
    return `${pending.workOrder.woNumber} → ${name}, keeping its current time.`;
  }
  const at = formatInstant(pending.startMillis, {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
  const minutes = Math.round((pending.endMillis - pending.startMillis) / 60_000);
  return `${pending.workOrder.woNumber} → ${name}, ${at} for ${minutes} min.`;
}

/**
 * One technician's schedule and work, opened from a lane name. The week view below is already filtered to them (their
 * working hours, blocked time and placements); this lists their placed work in the loaded range, earliest first.
 */
function TechnicianReview({ name, workOrders, onSelectWorkOrder, onBack }) {
  const rows = [...workOrders]
    .map((wo) => ({ wo, window: placementWindow(wo) }))
    .sort((a, b) => (a.window?.startMillis ?? Infinity) - (b.window?.startMillis ?? Infinity));
  return (
    <section className="ns-dispatch-focus" aria-label={`${name}: schedule and work`}>
      <div className="ns-dispatch-focus__head">
        <h2 className="ns-dispatch-focus__title">{name} — schedule and work</h2>
        <button type="button" className="fo-button fo-button--secondary" onClick={onBack}>Back to the board</button>
      </div>
      {rows.length === 0 ? (
        <p className="fo-muted">No scheduled work for {name} in the weeks shown.</p>
      ) : (
        <ul className="ns-dispatch-focus__list">
          {rows.map(({ wo, window }) => (
            <li key={wo.id} className="ns-dispatch-focus__item">
              <button type="button" className="ns-dispatch-lane__name--link" onClick={() => onSelectWorkOrder(wo.id)}>{wo.woNumber}</button>
              <span>{window ? formatInstant(window.startMillis, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "No window"}</span>
              <span className="fo-muted">{statusWords(wo.status)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
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
