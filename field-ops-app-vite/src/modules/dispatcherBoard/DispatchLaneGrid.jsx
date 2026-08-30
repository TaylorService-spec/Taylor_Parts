import { memo, useRef } from "react";

import {
  SLOT_MS,
  bandHours,
  blockedMinutesInBand,
  laneCapacity,
  placeInBand,
  placedBlockedTime,
  pastFractionOfBand,
  placementWindow,
  shiftLabel,
} from "../../domain/dispatchBoardGeometry.js";
import { blockedKindChipLabel, blockedKindLabel } from "../../domain/schedulingRefusal.js";
import { resolveTechnicianIdentity } from "../../domain/actorDisplayName.js";
import { workOrderTypeLabel } from "../../domain/workOrderType.js";

// Dispatch North Star P1 · frame 1a — the hour-header lane grid.
//
// ════════════════════ THE SLOT THAT WAS DARK ════════════════════
//
// The artifact classified this whole surface DB-D1 · PRODUCT BUILD and specified an interim: lanes
// listing jobs in order with durations, no hour header, shift line reading "Shift not recorded".
// That interim was correct on 2026-08-27 at 04:54 and is obsolete: ND-22 shipped the shift records,
// ND-24 certified the placement policy, and the trusted read now carries both. This is the lit
// version of the same composition — nothing about the DESIGN changed, only what is behind it.
//
// ════════════════════ GEOMETRY IS FROM COMMITTED FACTS ════════════════════
//
// Every chip's position comes from `scheduledStart` / `scheduledEnd` through
// domain/dispatchBoardGeometry.js. Nothing is placed by row order, index, or arrival sequence — a
// board that faked position would put a 2pm job where an 8am job belongs and be believed.
//
// This component RENDERS. It performs no writes, holds no schedule state, and decides no policy:
// drop handling is delegated to the callbacks its parent supplies, and every refusal comes back from
// the server. `canAcceptDrop` only decides whether to show an INVITATION — the server refuses
// regardless, and a lane that invited a drop the server would reject is a smaller sin than a lane
// that hid one it would have accepted.

// VC-3 — the bindings, stated where a user can find them. A shortcut nobody can discover is not an
// accessible path, so this rides on the chip itself and is echoed in the board rules footer.
const CHIP_KEY_HINT =
  "Arrow keys move by 15 min (Shift = 1 hour) · Alt+Arrow resizes · R reassigns";

function DispatchLaneGrid({
  technicians,
  workOrdersByTechnician,
  availabilityByTechnicianId,
  availabilityLoading,
  band,
  draggingWorkOrder,
  onDropOnLane,
  onDragStartWorkOrder,
  onDragEndWorkOrder,
  onSelectWorkOrder,
  selectedWorkOrderId,
  dragOverLaneId,
  onDragOverLane,
  onDragLeaveLane,
  busyWorkOrderId,
  onAdjustPlacement,
  onReassignRequest,
  slotMillis = SLOT_MS,
  nowMillis,
}) {
  const hours = bandHours(band);
  const resizeOriginRef = useRef(null);
  // VC-4 — how much of THIS band is already gone. Rendered as a dead region so a dispatcher can see
  // that those minutes are not targets, instead of discovering it from a refusal after the drop.
  // Only today has one: pastFractionOfBand answers 0 for a future day and 1 for a finished one.
  const now = Number.isFinite(nowMillis) ? nowMillis : Date.now();
  const pastFraction = pastFractionOfBand(band, now);

  return (
    <div className="ns-dispatch-grid">
      <div className="ns-dispatch-grid__head" aria-hidden="true">
        <div className="ns-dispatch-grid__identity-col" />
        <div className="ns-dispatch-grid__hours" style={{ gridTemplateColumns: `repeat(${hours.length}, 1fr)` }}>
          {hours.map((h) => (
            <div key={h.hour} className="ns-dispatch-grid__hour">{h.label}</div>
          ))}
        </div>
      </div>

      {technicians.map((tech) => {
        const identity = resolveTechnicianIdentity(tech.id, { technicians });
        const placed = workOrdersByTechnician.get(tech.id) ?? [];
        const availability = availabilityByTechnicianId.get(tech.id) ?? null;
        const capacity = laneCapacity(availability, placed, band);
        const shift = shiftLabel(availability, band);
        const blocked = placedBlockedTime(availability, band);
        const blockedMinutes = blockedMinutesInBand(availability, band);
        const canAccept = Boolean(draggingWorkOrder);
        const isDragOver = dragOverLaneId === tech.id;

        return (
          <div className="ns-dispatch-grid__row" key={tech.id}>
            <div className="ns-dispatch-lane__identity">
              <div className="ns-dispatch-lane__name">{identity.name}</div>
              <div className="ns-dispatch-lane__meta">
                <LaneMeta
                  shift={shift}
                  capacity={capacity}
                  blockedMinutes={blockedMinutes}
                  availabilityLoading={availabilityLoading}
                />
              </div>
            </div>

            <div
              className={`ns-dispatch-lane${isDragOver && canAccept ? " ns-dispatch-lane--over" : ""}`}
              style={{ backgroundSize: `${100 / hours.length}% 100%` }}
              data-technician-id={tech.id}
              onDragOver={canAccept ? (e) => { e.preventDefault(); onDragOverLane?.(tech.id); } : undefined}
              onDragLeave={canAccept ? () => onDragLeaveLane?.(tech.id) : undefined}
              onDrop={canAccept ? (e) => { e.preventDefault(); onDropOnLane?.(tech.id, dropFractionOf(e)); } : undefined}
            >
              {pastFraction > 0 ? (
                <div
                  className="ns-dispatch-lane__past"
                  style={{ width: `${Math.min(100, pastFraction * 100)}%` }}
                  aria-hidden="true"
                  title="Already passed — not a valid placement target"
                />
              ) : null}

              {/* Blocked time first, so a work-order chip drawn over the same minutes reads as the
                  collision it is rather than disappearing behind a hatch. */}
              {blocked.map(({ block, geometry }) => (
                <div
                  key={block.blockId}
                  className="ns-dispatch-chip ns-dispatch-chip--blocked"
                  style={{ left: `${geometry.leftPercent}%`, width: `${geometry.widthPercent}%` }}
                  title={`${blockedKindChipLabel(block.kind)} — ${blockedKindLabel(block.kind)}`}
                >
                  <b>{blockedKindChipLabel(block.kind)}</b>
                  {block.reason ? <span>{block.reason}</span> : null}
                </div>
              ))}

              {placed.map((wo) => {
                const window = placementWindow(wo);
                const geometry = window ? placeInBand(window.startMillis, window.endMillis, band) : null;
                if (!geometry) return null;
                const isBusy = busyWorkOrderId === wo.id;
                return (
                  <button
                    type="button"
                    key={wo.id}
                    className={`ns-dispatch-chip ns-dispatch-chip--wo${
                      selectedWorkOrderId === wo.id ? " ns-dispatch-chip--selected" : ""
                    }${isBusy ? " ns-dispatch-chip--busy" : ""}`}
                    style={{ left: `${geometry.leftPercent}%`, width: `${geometry.widthPercent}%` }}
                    draggable={!isBusy}
                    onClick={() => onSelectWorkOrder?.(wo.id)}
                    onDragStart={(e) => {
                      // Optional: a synthetic drag event (and jsdom) carries no dataTransfer. The
                      // hint is a nicety; losing it must never break the gesture.
                      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
                      // THE CHIP MUST ANNOUNCE ITSELF. Without this the board has no idea what is
                      // being dragged, so reschedule, reassign and return-to-queue all silently do
                      // nothing — the chip looks draggable and no drop ever lands.
                      onDragStartWorkOrder?.(wo);
                      onSelectWorkOrder?.(wo.id);
                    }}
                    onDragEnd={onDragEndWorkOrder}
                    // VC-3 — the keyboard equivalent of VC-2's pointer manipulation. Every binding
                    // lands in the SAME governed command its pointer twin does; none of them writes
                    // anything here. Arrow keys are claimed only while a chip is focused, and only
                    // with a modifier or on the horizontal axis, so ordinary tab/scroll navigation
                    // is left alone — a board that swallowed plain arrows would break the page for
                    // everyone to serve one gesture.
                    onKeyDown={(e) => {
                      if (isBusy || !onAdjustPlacement) return;
                      const step = e.shiftKey ? 4 * slotMillis : slotMillis; // Shift = one hour
                      if (e.key === "ArrowLeft" && !e.altKey) {
                        e.preventDefault(); onAdjustPlacement(wo, "move", -step);
                      } else if (e.key === "ArrowRight" && !e.altKey) {
                        e.preventDefault(); onAdjustPlacement(wo, "move", step);
                      } else if (e.key === "ArrowLeft" && e.altKey) {
                        e.preventDefault(); onAdjustPlacement(wo, "resize", -step);
                      } else if (e.key === "ArrowRight" && e.altKey) {
                        e.preventDefault(); onAdjustPlacement(wo, "resize", step);
                      } else if (e.key.toLowerCase() === "r") {
                        e.preventDefault(); onReassignRequest?.(wo);
                      }
                    }}
                    aria-label={laneChipLabel(wo, identity.name, geometry)}
                    aria-keyshortcuts="ArrowLeft ArrowRight Alt+ArrowLeft Alt+ArrowRight R"
                    title={CHIP_KEY_HINT}
                  >
                    <b>{wo.woNumber} · {workOrderTypeLabel(wo.type)}</b>
                    <span>
                      {geometry.outsideBand ? "Extends outside the shown hours · " : ""}
                      {wo.customerName ?? "Customer — name unavailable"}
                    </span>
                    {/* VC-2 — drag the trailing edge to change how long the job takes. Separate
                        from the chip's own drag (which MOVES it): grabbing the edge must not also
                        start a reschedule-by-move, hence stopPropagation on the drag start. */}
                    {onAdjustPlacement ? (
                      <span
                        className="ns-dispatch-chip__resize"
                        role="separator"
                        aria-label={`Resize ${wo.woNumber}`}
                        draggable={!isBusy}
                        onClick={(e) => e.stopPropagation()}
                        onDragStart={(e) => {
                          e.stopPropagation();
                          if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
                          resizeOriginRef.current = { id: wo.id, clientX: e.clientX };
                        }}
                        onDragEnd={(e) => {
                          e.stopPropagation();
                          const origin = resizeOriginRef.current;
                          resizeOriginRef.current = null;
                          if (!origin || origin.id !== wo.id) return;
                          const laneEl = e.currentTarget.closest(".ns-dispatch-lane");
                          const width = laneEl?.getBoundingClientRect?.().width ?? 0;
                          if (!width) return;
                          // Pixels → minutes through the band the lane actually draws, then snapped
                          // by the domain helper. The grid never invents a duration of its own.
                          const deltaMillis =
                            ((e.clientX - origin.clientX) / width) * (band.endMillis - band.startMillis);
                          if (Math.abs(deltaMillis) < slotMillis / 2) return;
                          onAdjustPlacement(wo, "resize", deltaMillis);
                        }}
                      />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Where in the lane a drop landed, as a fraction of the band.
 *
 * The lane is the drop target rather than ten per-hour cells, so a job can be placed at any minute
 * the grid can express instead of being quantised to the hour the design happens to draw gridlines
 * at. The caller turns the fraction into a start time.
 */
function dropFractionOf(event) {
  const rect = event.currentTarget.getBoundingClientRect();
  if (!rect.width) return 0;
  const x = event.clientX - rect.left;
  return Math.min(Math.max(x / rect.width, 0), 1);
}

function laneChipLabel(wo, technicianName, geometry) {
  const outside = geometry.outsideBand ? ", extends outside the shown hours" : "";
  return `${wo.woNumber}, ${workOrderTypeLabel(wo.type)}, scheduled for ${technicianName}${outside}`;
}

/**
 * The lane's second line: shift · % booked · blocked.
 *
 * THE RULE THIS COMPONENT EXISTS TO HOLD. A technician with no recorded availability renders
 * "Shift not recorded" and NO percentage. Not 0%, not "—%", not "0 of 0". Percent booked over an
 * unknown denominator is unanswerable, and rendering it as zero would report a fact about our data
 * entry as though it were a fact about the business — every technician looking permanently free on
 * the day the collection ships and nobody has filled it in.
 *
 * Booked HOURS still render in that case, because they are known: they come from committed
 * placements. Only the ratio is withheld.
 */
function LaneMeta({ shift, capacity, blockedMinutes, availabilityLoading }) {
  if (availabilityLoading) return <span className="ns-dispatch-lane__meta-muted">Loading availability…</span>;

  const parts = [];
  parts.push(shift ?? "Shift not recorded");
  if (capacity.percentBooked != null) {
    parts.push(`${capacity.percentBooked}% booked`);
  } else if (capacity.bookedMinutes > 0) {
    parts.push(`${formatHours(capacity.bookedMinutes)} booked`);
  }
  if (blockedMinutes > 0) parts.push(`${formatHours(blockedMinutes)} blocked`);

  const strained = capacity.percentBooked != null && capacity.percentBooked >= 70;
  return (
    <span className={strained ? "ns-dispatch-lane__meta-strained" : undefined}>{parts.join(" · ")}</span>
  );
}

function formatHours(minutes) {
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

export default memo(DispatchLaneGrid);
