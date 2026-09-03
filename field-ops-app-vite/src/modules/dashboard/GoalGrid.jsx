// GOAL GRID -- the tiles for a set of targets, shared by every surface that shows goals.
//
// ONE COMPONENT, TWO SURFACES. My Dashboard and the technician screen both render performance
// against goal, and two implementations would agree on the day they were written and drift on the
// first change to how an absent measurement reads. The drift would be silent in the worst
// direction: one screen honest about a missing actual and the other showing a zero.
//
// EVERY ACTUAL IS NULL TODAY, and that is a visible state rather than an oversight. The TARGETS are
// governed and readable now; the ACTUALS live behind each domain's own read at that domain's own
// scope, and connecting them is per-domain work that must not be short-cut by a dashboard-local
// count -- which is precisely the second implementation of domain logic this platform has been
// bitten by. Until a domain's actual is wired, the tile shows the real target and says the
// measurement is not connected. When one IS wired it arrives through `actualsByKey` and nothing else
// about this component changes.
import HonestState, { HONEST_STATE } from "../../shared/ui/HonestState.jsx";
import { GOAL_FEED_STATUS, goalKey } from "../../hooks/usePerformanceGoals.js";
import { goalProgress } from "../../domain/goalProgress.js";
import GoalTile from "./GoalTile.jsx";

/** How each metric reads to a person. A metric id is not a label. */
export const GOAL_LABELS = Object.freeze({
  "technician.workOrder.completed.cumulative.count": ["Work orders completed", "All time"],
  "technician.workOrder.open.count": ["Open assigned work", "Open now"],
  "service.workOrder.pastDue.count": ["Past due scheduled work", "Past due now"],
  "service.workOrder.readyToSchedule.count": ["Ready to schedule", "Waiting now"],
  "service.workOrder.schedulingConflict.count": ["Scheduling conflicts", "Conflicts now"],
  "service.workOrder.partsBlocked.count": ["Work blocked on parts", "Blocked now"],
  "crm.account.active.count": ["Active accounts", "Active now"],
  "purchasing.purchaseOrder.open.count": ["Open purchase orders", "Open now"],
  "parts.reorderRequest.open.count": ["Open reorder requests", "Open now"],
  "receiving.purchaseOrder.receivable.count": ["Awaiting receipt", "Awaiting now"],
});

const NOT_CONNECTED = "This measurement is not connected to the dashboard yet.";

export default function GoalGrid({ targets, feed, actualsByKey = null }) {
  if (feed?.status === GOAL_FEED_STATUS.DENIED) {
    return <HonestState state={HONEST_STATE.DENIED} subject="Goals" detail="Your access does not include performance targets." />;
  }
  if (feed?.status === GOAL_FEED_STATUS.UNAVAILABLE) {
    return <HonestState state={HONEST_STATE.UNAVAILABLE} subject="Goals" detail="Targets could not be read just now." />;
  }
  if (!feed || feed.status === GOAL_FEED_STATUS.LOADING || feed.status === GOAL_FEED_STATUS.IDLE) {
    return <HonestState state={HONEST_STATE.LOADING} subject="Goals" />;
  }

  const tiles = (targets ?? [])
    .map((t) => {
      const key = goalKey(t.metricId, t.targetScopeType, t.targetScopeId);
      const result = feed.byKey.get(key);
      // A target absent from the response was not asked for. A target this viewer may not READ comes
      // back with denied:true and IS rendered, because a vanishing tile would make "you may not see
      // this" indistinguishable from "there isn't one".
      if (!result) return null;
      const [label, actualLabel] = GOAL_LABELS[t.metricId] ?? [t.metricId, "Actual"];
      return {
        key,
        label,
        actualLabel,
        progress: goalProgress(result, actualsByKey?.[key] ?? null, NOT_CONNECTED),
      };
    })
    .filter(Boolean);

  if (tiles.length === 0) {
    return <HonestState state={HONEST_STATE.EMPTY} subject="Goals" detail="No targets have been set for you yet." />;
  }

  return (
    <div className="fo-goal-grid">
      {tiles.map((t) => (
        <GoalTile key={t.key} progress={t.progress} label={t.label} actualLabel={t.actualLabel} />
      ))}
    </div>
  );
}
