import { memo } from "react";

import { workOrderPriorityLabel, workOrderPriorityText } from "../../domain/workOrderPriority.js";
import { workOrderTypeLabel } from "../../domain/workOrderType.js";
import { resolveTechnicianIdentity } from "../../domain/actorDisplayName.js";
import { Button } from "../../shared/ui/primitives/index.js";

// Dispatch North Star P1 · frame 1a — "Ready to schedule".
//
// Cards, not rows: the artifact draws each queue item as a card carrying priority word, reference,
// duration + type, resolved customer, an attention note, and the top recommendation with its score.
// A dispatcher scans these to decide what to place next, and a table row cannot carry the attention
// note without becoming a column that is empty on most rows.
//
// ════════════════════ WHAT THIS DELIBERATELY DOES NOT SHOW ════════════════════
//
// * NO recommendation REASON sentences. 1d classifies those VERIFY AUTHORITY: the engine projects a
//   score and the factors behind it are not confirmed projectable as words. A plausible-sounding
//   "closest technician" that the engine never computed is a fabrication, so the score stands alone.
// * NO document ids. The do-not-invent list is explicit that document ids never render; the customer
//   is a resolved name or an honest note that it is unavailable, never a raw customerId.
// * NO fabricated duration. Where `estimatedDurationMinutes` is unrecorded the card says nothing
//   about length rather than assuming one — the duration is what a dispatcher sizes a slot by.
// * NO "past due" note, though the artifact draws one on a queue card. EOS cannot render it
//   honestly: there is no due-date model for UNSCHEDULED work, and workOrderAttentionProjection.js
//   states the rule outright — "scheduledStart is the ONLY date authority and only exists once
//   scheduled — inventing one here would be exactly the fabrication this pattern forbids." The
//   governed PAST_DUE signal is real, but it describes SCHEDULED work whose window has passed, which
//   sits on a LANE rather than in this queue; the workload line above the board counts those from the
//   governed projection. Recorded as gap DB-G1 rather than filled in with a plausible date.
function ReadyToScheduleQueue({
  workOrders,
  recommendations,
  technicians,
  customerNames,
  selectedWorkOrderId,
  onSelectWorkOrder,
  onOpenPlacementPicker,
  onDragStartWorkOrder,
  onDragEndWorkOrder,
  isDragOver,
  onDragOverQueue,
  onDragLeaveQueue,
  onDropOnQueue,
  canReturnToQueue,
  busyWorkOrderId,
  boardHasAnyWorkOrders = true,
  readFailed = false,
}) {
  return (
    <section
      className={`ns-dispatch-queue${isDragOver && canReturnToQueue ? " ns-dispatch-queue--over" : ""}`}
      aria-label="Ready to schedule"
      onDragOver={canReturnToQueue ? (e) => { e.preventDefault(); onDragOverQueue?.(); } : undefined}
      onDragLeave={canReturnToQueue ? onDragLeaveQueue : undefined}
      onDrop={canReturnToQueue ? (e) => { e.preventDefault(); onDropOnQueue?.(); } : undefined}
    >
      <div className="ns-dispatch-queue__head">
        <h2 className="ns-dispatch-queue__title">
          Ready to schedule
          <span className="ns-dispatch-queue__count">{workOrders.length}</span>
        </h2>
        <p className="ns-dispatch-queue__note">
          Ranked by priority and age. Drag a card onto a lane to schedule it, or drop a scheduled job
          here to return it to the queue. “Schedule…” on each card is the keyboard and touch path —
          the same governed command.
        </p>
      </div>

      {workOrders.length === 0 ? (
        // 1c keeps THREE outcomes apart, and the distinction is the whole point of the state:
        //
        //   queue clear   there ARE work orders and every ready one is placed — good news.
        //   true empty    there are no work orders at all — not an achievement, just nothing yet.
        //   read failed   the board says so above; this must stay SILENT rather than add a second,
        //
        //                 contradictory sentence claiming the queue is clear.
        //
        // Collapsing the first two would congratulate a dispatcher on an empty database; letting the
        // third fall through to either would state as fact something the failed read cannot know.
        readFailed ? null : (
          <p className="ns-dispatch-queue__clear">
            {boardHasAnyWorkOrders
              ? "✓ Every ready work order has a window and a technician."
              : "No work orders exist yet."}
          </p>
        )
      ) : (
        <div className="ns-dispatch-queue__cards">
          {workOrders.map((wo) => {
            const top = (recommendations?.get?.(wo.id) ?? [])[0] ?? null;
            const topIdentity = top ? resolveTechnicianIdentity(top.techId, { technicians }) : null;
            const priorityText = workOrderPriorityText(wo.priority);
            const customer = customerNames?.get?.(wo.customerId) ?? null;
            const isBusy = busyWorkOrderId === wo.id;

            return (
              <article
                key={wo.id}
                className={`ns-dispatch-card${wo.id === selectedWorkOrderId ? " ns-dispatch-card--selected" : ""}${
                  isBusy ? " ns-dispatch-card--busy" : ""
                }`}
                draggable={!isBusy}
                onDragStart={() => onDragStartWorkOrder?.(wo)}
                onDragEnd={onDragEndWorkOrder}
                onClick={() => onSelectWorkOrder?.(wo.id)}
              >
                <div className="ns-dispatch-card__line1">
                  <span className="ns-dispatch-card__priority">
                    {priorityText ? `${priorityText.toUpperCase()} (${wo.priority})` : workOrderPriorityLabel(wo.priority)}
                  </span>
                  <strong className="ns-dispatch-card__ref">{wo.woNumber}</strong>
                  <span className="ns-dispatch-card__type">
                    {durationText(wo)}
                    {durationText(wo) && workOrderTypeLabel(wo.type) ? " · " : ""}
                    {workOrderTypeLabel(wo.type) ?? ""}
                  </span>
                </div>

                <div className="ns-dispatch-card__customer">
                  {customer ?? <span className="ns-dispatch-card__unresolved">Customer — name unavailable</span>}
                </div>

                <div className="ns-dispatch-card__actions">
                  {top && topIdentity?.state === "resolved" ? (
                    <span className="ns-dispatch-card__rec">
                      ★ {topIdentity.name} <span className="ns-dispatch-card__score">({top.score}%)</span>
                    </span>
                  ) : (
                    <span className="ns-dispatch-card__rec ns-dispatch-card__unresolved">
                      No technicians available to recommend
                    </span>
                  )}
                  <Button
                    variant="tertiary"
                    onClick={(e) => { e.stopPropagation(); onOpenPlacementPicker?.(wo); }}
                    disabled={isBusy}
                  >
                    Schedule…
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** Duration from the governed planning estimate, or nothing. Never a default slot length. */
function durationText(wo) {
  const minutes = wo?.estimatedDurationMinutes;
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0) return "";
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

export default memo(ReadyToScheduleQueue);
