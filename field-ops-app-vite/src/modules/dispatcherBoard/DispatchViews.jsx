import { memo, useId } from "react";

import {
  bucketBlockedByDay,
  bucketByDay,
  dayLoadCapacity,
  dayTimeState,
  fortnightDays,
  occupiedDays,
  startOfDayMillis,
  weekDays,
} from "../../domain/dispatchBoardGeometry.js";
import { blockedKindChipLabel } from "../../domain/schedulingRefusal.js";
import { resolveTechnicianIdentity } from "../../domain/actorDisplayName.js";

// Dispatch North Star P1 · frames 1a and 1e — the view switcher and the coarser-grain views.
//
// ════════════════════ THREE PROJECTIONS, ONE SCHEDULE ════════════════════
//
// Day, Week and 2 Weeks read the SAME `workOrders` array and the SAME availability read. None of
// them holds schedule state, none writes, and switching between them mutates nothing. That is what
// makes them agree by construction: the artifact says "Both views read the same schedule data as the
// day board", and the way to honour that is to have no second copy for them to disagree from.

export const DISPATCH_VIEW = Object.freeze({
  DAY: "DAY",
  WEEK: "WEEK",
  FORTNIGHT: "FORTNIGHT",
});

const VIEW_ORDER = [DISPATCH_VIEW.DAY, DISPATCH_VIEW.WEEK, DISPATCH_VIEW.FORTNIGHT];

export const MAP_UNAVAILABLE_REASON =
  "No map provider or job coordinates are configured yet. Day, Week and 2 weeks are the scheduling views.";

export function DispatchViewSwitcher({ view, onChange, dayLabel, weekLabel, anchorMillis, onAnchorChange, isToday, children }) {
  const mapReasonId = useId();
  const label = {
    [DISPATCH_VIEW.DAY]: `Day · ${dayLabel}`,
    [DISPATCH_VIEW.WEEK]: `Week · ${weekLabel}`,
    [DISPATCH_VIEW.FORTNIGHT]: "2 weeks · load",
  };

  return (
    <div className="ns-dispatch-views">
      <div className="ns-dispatch-views__group" role="tablist" aria-label="Board view">
        {VIEW_ORDER.map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            className={`ns-dispatch-views__tab${view === v ? " ns-dispatch-views__tab--on" : ""}`}
            onClick={() => onChange(v)}
          >
            {label[v]}
          </button>
        ))}
      </div>
      {/* WHICH day / week the board is showing. The artifact heads the Day tab "Day · Tue 26" — a
          SPECIFIC day — and 1e has the week and fortnight views jumping to one. Without a way to
          move the anchor directly, the board could only ever show the next fortnight, so a job
          scheduled five weeks out was unreachable. Steps by a day in Day view and by a week in the
          other two, because that is the unit each of them is drawn in. */}
      <div className="ns-dispatch-views__nav">
        <button type="button" className="ns-dispatch-views__step" onClick={() => onAnchorChange?.(stepAnchor(anchorMillis, view, -1))} aria-label={view === DISPATCH_VIEW.DAY ? "Previous day" : "Previous week"}>‹</button>
        <button type="button" className="ns-dispatch-views__step" onClick={() => onAnchorChange?.(Date.now())} disabled={isToday}>Today</button>
        <button type="button" className="ns-dispatch-views__step" onClick={() => onAnchorChange?.(stepAnchor(anchorMillis, view, 1))} aria-label={view === DISPATCH_VIEW.DAY ? "Next day" : "Next week"}>›</button>
        <label className="ns-dispatch-views__jump">
          <span className="ns-dispatch-views__jump-label">Go To</span>
          <input type="date" value={toDateInput(anchorMillis)} onChange={(e) => { const t = fromDateInput(e.target.value); if (t != null) onAnchorChange?.(t); }} />
        </label>
      </div>
      {/* MAP — HONESTLY UNAVAILABLE (Owner, 2026-10-15). It used to be an active-looking tab that
          switched to a paragraph. No map provider, job coordinates or map read exist yet
          (docs/architecture/employee-work-schedule-design.md §7), so the control stays where the
          design puts it — the gap stays visible — but says it is unavailable and does nothing.
          aria-disabled rather than `disabled`, so keyboard and screen-reader users can still reach
          it and hear why. */}
      <button
        type="button"
        aria-disabled="true"
        aria-describedby={mapReasonId}
        className="ns-dispatch-views__tab ns-dispatch-views__tab--standalone ns-dispatch-views__tab--unavailable"
        title={MAP_UNAVAILABLE_REASON}
        onClick={(e) => e.preventDefault()}
      >
        Map · not available
      </button>
      <span id={mapReasonId} className="sr-only">{MAP_UNAVAILABLE_REASON}</span>
      {children ? <><span className="ns-dispatch-views__spacer" />{children}</> : null}
    </div>
  );
}

/**
 * Week view — one row per technician, one cell per weekday.
 *
 * The artifact's rule: *"drop a chip on a tech-day to schedule the day; the window is set on the day
 * board."* A week cell has no clock, so a drop here proposes a placement at the start of that
 * technician's recorded working day, and the dispatcher refines it on the day board. Where no
 * working hours are recorded there is no honest hour to choose, so the cell does not invite a drop
 * at all — inventing a 9am start for a technician whose shift nobody has recorded is exactly the
 * fabrication this board is built to avoid.
 */
function WeekViewImpl({
  technicians,
  placedWorkOrders,
  availabilityByTechnicianId,
  availabilityFailed = false,
  anchorMillis,
  nowMillis,
  onSelectDay,
  draggingWorkOrder,
  onDropOnTechnicianDay,
}) {
  // ALL SEVEN DAYS. schedulingWorkspace.buildWeekDays says why in its own comment -- a job scheduled
  // on a weekend is never silently hidden, because a hidden job is a correctness bug -- and filtering
  // to Mon-Fri reintroduced exactly that: the live gate navigated to a Saturday carrying two
  // placements and the week view showed nothing. Weekends are de-emphasised in CSS instead, which
  // keeps the artifact's weekday-forward reading without dropping work off the board.
  const days = weekDays(anchorMillis, nowMillis);

  return (
    <div className="ns-dispatch-week" role="table" aria-label="Week schedule">
      <div className="ns-dispatch-week__head" role="row">
        <div className="ns-dispatch-week__identity-col" />
        {days.map((d) => (
          <div key={d.dateMillis} role="columnheader" className="ns-dispatch-week__dayhead">
            {dayHeading(d)}
            {d.isToday ? <span className="ns-dispatch-week__today"> · today</span> : null}
          </div>
        ))}
      </div>

      {technicians.map((tech) => {
        const identity = resolveTechnicianIdentity(tech.id, { technicians });
        const mine = placedWorkOrders.filter((wo) => wo.scheduledTechId === tech.id);
        const byDay = bucketByDay(mine, days);
        const availability = availabilityByTechnicianId.get(tech.id) ?? null;
        const blockedByDay = bucketBlockedByDay(availability, days);
        const hasHours = Boolean(availability?.workingAvailability);

        return (
          <div className="ns-dispatch-week__row" role="row" key={tech.id}>
            <div className="ns-dispatch-week__identity" role="rowheader">{identity.name}</div>
            {days.map((d) => {
              const entries = byDay.get(d.dateMillis) ?? [];
              const blocks = blockedByDay.get(d.dateMillis) ?? [];
              const canDrop = Boolean(draggingWorkOrder) && hasHours && blocks.length === 0;
              return (
                <div
                  key={d.dateMillis}
                  role="cell"
                  className={`ns-dispatch-week__cell${canDrop ? " ns-dispatch-week__cell--droppable" : ""}${d.isWeekend ? " ns-dispatch-week__cell--weekend" : ""}${dayStateClass(availability, d.dateMillis, nowMillis, availabilityFailed)}`}
                  onDragOver={canDrop ? (e) => e.preventDefault() : undefined}
                  onDrop={canDrop ? (e) => { e.preventDefault(); onDropOnTechnicianDay?.(tech.id, d.dateMillis); } : undefined}
                  onClick={() => onSelectDay?.(d.dateMillis)}
                >
                  {blocks.map((b) => (
                    <span key={b.blockId} className="ns-dispatch-week__blocked">{blockedKindChipLabel(b.kind)}</span>
                  ))}
                  {entries.map(({ workOrder, window }) => (
                    <span key={workOrder.id} className="ns-dispatch-week__chip">
                      {workOrder.woNumber} · {hoursText(window.durationMinutes)}
                    </span>
                  ))}
                  {entries.length === 0 && blocks.length === 0 ? (
                    <span className="ns-dispatch-week__open">{availabilityFailed ? "schedule unavailable" : EMPTY_DAY_WORDS[dayTimeState(availability, d.dateMillis)]}</span>
                  ) : null}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Two-week load band — balancing only, per the artifact. No drop targets here on purpose: the
 * artifact says *"Two-week: balancing only … click a day to jump."*
 *
 * A day whose denominator is unknown renders a muted em-dash, NOT 0%. That is the same rule the
 * lane meta line holds, and it matters more here: ten cells of confident "0%" would read as a fleet
 * with nothing booked rather than a fleet whose shifts nobody has recorded.
 */
function TwoWeekLoadImpl({
  technicians,
  placedWorkOrders,
  availabilityByTechnicianId,
  availabilityFailed = false,
  anchorMillis,
  nowMillis,
  onSelectDay,
}) {
  const days = fortnightDays(anchorMillis, nowMillis, occupiedDays(placedWorkOrders, [...availabilityByTechnicianId.values()]));
  const weekBreakIndex = 5;

  return (
    <div className="ns-dispatch-load" role="table" aria-label="Two-week load">
      <div className="ns-dispatch-load__head" role="row">
        <div className="ns-dispatch-load__identity-col">2-week load</div>
        {days.map((d, i) => (
          <div
            key={d.dateMillis}
            role="columnheader"
            className={`ns-dispatch-load__dayhead${i === weekBreakIndex - 1 ? " ns-dispatch-load__weekbreak" : ""}`}
          >
            {shortDayHeading(d)}
          </div>
        ))}
      </div>

      {technicians.map((tech) => {
        const identity = resolveTechnicianIdentity(tech.id, { technicians });
        const mine = placedWorkOrders.filter((wo) => wo.scheduledTechId === tech.id);
        const byDay = bucketByDay(mine, days);
        const availability = availabilityByTechnicianId.get(tech.id) ?? null;
        const blockedByDay = bucketBlockedByDay(availability, days);

        return (
          <div className="ns-dispatch-load__row" role="row" key={tech.id}>
            <div className="ns-dispatch-load__identity" role="rowheader">{identity.name}</div>
            {days.map((d, i) => {
              const placed = (byDay.get(d.dateMillis) ?? []).map((e) => e.workOrder);
              // Availability is read for the whole visible range; each day's capacity divides that
              // day's bookings by THAT DAY's available minutes, never the whole range's (G-11).
              const capacity = dayLoadCapacity(availability, placed, d.dateMillis);
              const blocked = (blockedByDay.get(d.dateMillis) ?? []).length > 0;
              return (
                <button
                  type="button"
                  key={d.dateMillis}
                  className={`ns-dispatch-load__cell${blocked ? " ns-dispatch-load__cell--blocked" : ""}${
                    i === weekBreakIndex - 1 ? " ns-dispatch-load__weekbreak" : ""
                  }${dayStateClass(availability, d.dateMillis, nowMillis, availabilityFailed)}`}
                  data-load={loadBucket(capacity.percentBooked)}
                  onClick={() => onSelectDay?.(d.dateMillis)}
                  aria-label={loadCellLabel(identity.name, d, capacity, blocked, availabilityFailed ? "unknown" : dayTimeState(availability, d.dateMillis))}
                >
                  {capacity.percentBooked == null ? (
                    <span className="ns-dispatch-load__unknown">—</span>
                  ) : (
                    `${capacity.percentBooked}%`
                  )}
                </button>
              );
            })}
          </div>
        );
      })}
      <p className="ns-dispatch-load__legend">
        Darker is more booked. A dash means no working hours are recorded for that day, which is not
        the same as an empty one. Click a day to open it.
      </p>
    </div>
  );
}

/** Step the anchor by the unit the current view is drawn in. DST-safe via the Date API. */
function stepAnchor(anchorMillis, view, direction) {
  const d = new Date(anchorMillis);
  d.setDate(d.getDate() + direction * (view === DISPATCH_VIEW.DAY ? 1 : 7));
  return d.getTime();
}

function toDateInput(millis) {
  const d = new Date(millis);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parsed as LOCAL midnight, matching how the rest of the board buckets days. */
function fromDateInput(value) {
  if (!value) return null;
  const [y, m, day] = value.split("-").map(Number);
  if (!y || !m || !day) return null;
  return new Date(y, m - 1, day, 12, 0, 0, 0).getTime();
}

function dayHeading(day) {
  return new Date(day.dateMillis).toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
}

function shortDayHeading(day) {
  const d = new Date(day.dateMillis);
  return `${d.toLocaleDateString(undefined, { weekday: "narrow" })} ${d.getDate()}`;
}

/** What an empty Week cell says. "open" only where the schedule records working time. */
const EMPTY_DAY_WORDS = Object.freeze({ working: "open", nonWorking: "off", unconfigured: "no schedule" });

/** Elapsed (a day already over), not working, or no schedule — the same three states the lanes draw. */
function dayStateClass(availability, dayStartMillis, nowMillis, failed = false) {
  const over = Number.isFinite(nowMillis) && startOfDayMillis(nowMillis) > dayStartMillis;
  // A failed read draws no schedule state at all: unknown is neither "off" nor "no schedule" (S-1).
  if (failed) return over ? " ns-dispatch-day--elapsed" : "";
  const state = dayTimeState(availability, dayStartMillis);
  return `${over ? " ns-dispatch-day--elapsed" : ""}${state === "working" ? "" : ` ns-dispatch-day--${state === "nonWorking" ? "off" : "unconfigured"}`}`;
}

function hoursText(minutes) {
  if (minutes == null) return "";
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

/** Four buckets for the heat shading. Unknown is its own bucket, never folded into "empty". */
function loadBucket(percent) {
  if (percent == null) return "unknown";
  if (percent >= 80) return "high";
  if (percent >= 55) return "medium";
  return "low";
}

function loadCellLabel(name, day, capacity, blocked, state) {
  const when = new Date(day.dateMillis).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  if (capacity.percentBooked == null) {
    const why = state === "unknown" ? "schedule could not be read"
      : state === "nonWorking" ? "not a working day" : state === "working" ? "no available hours" : "no working schedule recorded";
    return `${name}, ${when}: ${why}${blocked ? ", has blocked time" : ""}`;
  }
  return `${name}, ${when}: ${capacity.percentBooked}% booked${blocked ? ", has blocked time" : ""}`;
}

export const DispatchWeekView = memo(WeekViewImpl);
export const DispatchTwoWeekLoad = memo(TwoWeekLoadImpl);
