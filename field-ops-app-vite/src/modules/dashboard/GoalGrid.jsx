// GOAL GRID -- the tiles for a set of targets, shared by every surface that shows goals.
//
// ONE COMPONENT, TWO SURFACES. My Dashboard and the technician screen both render performance
// against goal, and two implementations would agree on the day they were written and drift on the
// first change to how an absent measurement reads. The drift would be silent in the worst
// direction: one screen honest about a missing actual and the other showing a zero.
//
// ACTUALS ARRIVE THROUGH `actualsByKey` AND NOWHERE ELSE. They live behind each domain's own read at
// that domain's own scope, and must never be short-cut by a dashboard-local count -- precisely the
// second implementation of domain logic this platform has been bitten by.
//
// Four are connected today (the three service work-order signals and active accounts), each from a
// COMPLETE governed read: the attention projection over the unbounded work-order subscription, and
// the account portfolio aggregate that takes no bound by design. The rest show their real target
// beside the specific reason the measurement is missing -- see GOAL_ACTUAL_BLOCKER. A tile with a
// target and no actual is an honest state, not an oversight; a tile showing 0 for an unknown would
// be a false one.
import HonestState, { HONEST_STATE } from "../../shared/ui/HonestState.jsx";
import { GOAL_FEED_STATUS, goalKey } from "../../hooks/usePerformanceGoals.js";
import { goalProgress, GOAL_PROGRESS_STATE } from "../../domain/goalProgress.js";
import { GOAL_ACTUAL_BLOCKER, GOAL_ACTUAL_BLOCKER_DEFAULT } from "../../domain/dashboardGoalActuals.js";
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

// ONE SENTENCE PER METRIC, not one sentence for all of them. "This measurement is not connected"
// was true of every unwired actual and told a reader nothing about which were engineering debt and
// which were governance boundaries -- a bounded read that cannot total, a scope this surface does
// not hold, an input it deliberately refuses to guess. GOAL_ACTUAL_BLOCKER names each.
function blockerFor(metricId) {
  return GOAL_ACTUAL_BLOCKER[metricId] ?? GOAL_ACTUAL_BLOCKER_DEFAULT;
}

export default function GoalGrid({ targets, feed, actualsByKey = null, scopeLabelFor = null }) {
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
      // THE SCOPE IS PART OF THE NAME when a metric is asked at more than one scope. The live
      // dashboard showed "Open reorder requests" and "Awaiting receipt" repeated once per governed
      // warehouse -- legitimately DISTINCT targets, and visually identical, so the screen read as
      // duplicated. The scope label comes from the caller, which is the only layer that knows what a
      // warehouse id is called.
      const scope = typeof scopeLabelFor === "function" ? scopeLabelFor(t) : null;
      return {
        key,
        label: scope ? `${label} — ${scope}` : label,
        actualLabel,
        progress: goalProgress(result, actualsByKey?.[key] ?? null, blockerFor(t.metricId)),
      };
    })
    .filter(Boolean);

  if (tiles.length === 0) {
    return <HonestState state={HONEST_STATE.EMPTY} subject="Goals" detail="No targets have been set for you yet." />;
  }

  // ============================ ABSENCE MUST NOT OUTWEIGH PERFORMANCE ============================
  //
  // Every metric this viewer's scope can carry a goal for is asked about, so on a dashboard where
  // few targets are configured the grid became a wall of identical "No target has been set." tiles
  // with the real performance lost among them. The Owner saw exactly that.
  //
  // A tile with a target keeps its full treatment. A metric with NO GOAL AT ALL collapses into one
  // counted line -- the distinction between "target exists" and "target absent" is PRESERVED, it is
  // simply no longer the loudest thing on the screen. Every other absence (denied, unresolved, or a
  // target present without a measurement) keeps its own tile, because each says something different
  // and none of them means "nobody set this".
  const configured = tiles.filter((t) => t.progress.state !== GOAL_PROGRESS_STATE.NO_GOAL);
  const unset = tiles.length - configured.length;

  return (
    <>
      {configured.length > 0 && (
        <div className="fo-goal-grid">
          {configured.map((t) => (
            <GoalTile key={t.key} progress={t.progress} label={t.label} actualLabel={t.actualLabel} />
          ))}
        </div>
      )}
      {unset > 0 && (
        <p className="fo-muted">
          {/* NOT A BUSINESS METRIC. This counts goal SLOTS in the resolved registry that carry no
              target -- a management gap worth naming, and deliberately not derived into anything. */}
          {unset === 1
            ? "1 further measure has no target set yet."
            : `${unset} further measures have no target set yet.`}
        </p>
      )}
    </>
  );
}
