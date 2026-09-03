// GOAL TILE -- one governed TARGET beside one governed ACTUAL.
//
// The tile draws a pair, and its whole job is to never let the two halves be confused. The target
// comes from the Performance Goal Authority; the actual comes from the domain that owns it; this
// component computes neither and receives both.
//
// FOUR ABSENCES, DRAWN DIFFERENTLY (domain/goalProgress.js explains why they are not one empty):
//
//   NO_GOAL     nobody set a target. Worth showing -- it is a management gap, not a system limit,
//               and naming it is what invites someone to close it.
//   DENIED      outside your governed reach. A permission fact, never an apology and never an error
//               a reader could fix by retrying.
//   NO_ACTUAL   the target is real and the measurement is not. The target STAYS ON SCREEN, because
//               "we know what you should do and cannot yet tell you how you did" is the honest shape
//               and hiding the target would lose the half that IS governed.
//   UNRESOLVED  a contradictory version chain. A data defect, shown as one -- rendering "no goal"
//               here would hide it behind a state that looks deliberate.
//
// NEVER `0 of 400`. An unknown actual has no number slot on this component at all, which is the same
// construction HonestState uses for UNKNOWN: a caller cannot accidentally print a zero beside a
// sentence that says the answer is not known.
import StatusIndicator from "../../shared/ui/primitives/StatusIndicator.jsx";
import { GOAL_PROGRESS_STATE, goalBarPercent, goalTone } from "../../domain/goalProgress.js";

function formatValue(value, unit, currency) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  if (unit === "PERCENT") return `${value}%`;
  if (unit === "CURRENCY_MINOR") {
    // Minor units are integers on the wire; the display is the caller's currency, stated. No locale
    // guessing and no symbol lookup -- a wrong currency symbol is a wrong number.
    return `${(value / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency ?? ""}`.trim();
  }
  return value.toLocaleString();
}

/**
 * @param progress  from domain/goalProgress.js `goalProgress(...)`.
 * @param label     what is being measured, in the reader's language.
 * @param actualLabel  what the actual half is called ("Completed", "Open"). Named per tile because
 *                     "Actual" tells a reader nothing about which number they are looking at.
 */
export default function GoalTile({ progress, label, actualLabel = "Actual" }) {
  const state = progress?.state ?? GOAL_PROGRESS_STATE.NO_GOAL;

  if (state === GOAL_PROGRESS_STATE.DENIED) {
    return (
      <div className="fo-goal-tile fo-goal-tile--quiet">
        <span className="fo-goal-tile__label">{label}</span>
        <p className="fo-muted">This target is outside your access.</p>
      </div>
    );
  }

  if (state === GOAL_PROGRESS_STATE.NO_GOAL) {
    return (
      <div className="fo-goal-tile fo-goal-tile--quiet">
        <span className="fo-goal-tile__label">{label}</span>
        <p className="fo-muted">No target has been set.</p>
      </div>
    );
  }

  if (state === GOAL_PROGRESS_STATE.UNRESOLVED) {
    return (
      <div className="fo-goal-tile fo-goal-tile--quiet">
        <span className="fo-goal-tile__label">{label}</span>
        <StatusIndicator tone="attention" label="Target unavailable" />
        <p className="fo-muted">{progress.reason}</p>
      </div>
    );
  }

  const { goal } = progress;
  const target = formatValue(goal.targetValue, goal.unit, goal.currency);
  const direction = goal.direction === "AT_MOST" ? "at most" : goal.direction === "EXACT" ? "exactly" : "at least";

  if (state === GOAL_PROGRESS_STATE.NO_ACTUAL) {
    return (
      <div className="fo-goal-tile">
        <span className="fo-goal-tile__label">{label}</span>
        {/* The TARGET stays. Only the measurement is missing, and the sentence says which. */}
        <span className="fo-goal-tile__target fo-tabular-nums">{direction} {target}</span>
        <StatusIndicator tone="neutral" label="Not measured yet" />
        <p className="fo-muted">{progress.reason}</p>
      </div>
    );
  }

  const bar = goalBarPercent(progress);
  const tone = goalTone(progress);

  return (
    <div className="fo-goal-tile">
      <span className="fo-goal-tile__label">{label}</span>
      <span className="fo-goal-tile__value fo-tabular-nums">{formatValue(progress.actual, goal.unit, goal.currency)}</span>
      <span className="fo-goal-tile__target fo-tabular-nums">{actualLabel} · target {direction} {target}</span>

      {bar !== null && (
        // Clamped at 100: a bar overflowing its track to show 140% stops being a bar. The number
        // above carries the overshoot, and the number is the precise thing.
        <div
          className="fo-goal-bar"
          role="img"
          aria-label={`${progress.attainmentPercent}% of target`}
        >
          <span className={`fo-goal-bar__fill fo-goal-bar__fill--${tone}`} style={{ width: `${bar}%` }} />
        </div>
      )}

      {/* Tone is ALWAYS paired with a word -- never colour alone. */}
      <StatusIndicator tone={tone} label={progress.met ? "Met" : "Below target"} />

      {progress.remaining !== null && progress.remaining > 0 && (
        <p className="fo-muted">
          {goal.direction === "AT_MOST"
            ? `${formatValue(progress.remaining, goal.unit, goal.currency)} over target`
            : `${formatValue(progress.remaining, goal.unit, goal.currency)} remaining to goal`}
        </p>
      )}
    </div>
  );
}
