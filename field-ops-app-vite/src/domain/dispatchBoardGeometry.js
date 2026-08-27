// Dispatch North Star P1 -- the pure geometry behind the lane grid, the week grid and the
// two-week load band.
//
// ════════════════════ ONE SCHEDULE, THREE PROJECTIONS ════════════════════
//
// Day, Week and 2 Weeks are three renderings of the SAME governed placements. Nothing here holds
// per-view state and nothing here writes: every function takes the same Work Orders and the same
// availability read and answers a different question about them. That is what makes the three views
// agree by construction rather than by discipline -- a board that kept a per-view copy would drift
// the first time one of them refreshed and the others did not.
//
// ════════════════════ ABSENT IS NOT EMPTY ════════════════════
//
// The rule this file exists to hold. `readTechnicianAvailability` returns `workingAvailability: null`
// and `availableMinutes: null` for a technician with NO recorded schedule, and that is not the same
// fact as a technician with zero available minutes. Percent booked over an unknown denominator is
// unanswerable, and a board that rendered it as 0% would be reporting a fact about our data entry as
// though it were a fact about the business -- every technician looking permanently off-shift on the
// day the collection ships and nobody has filled it in.
//
// So `laneCapacity` returns { known: false } and callers render "Shift not recorded" with NO
// percentage. There is no default, no `?? 0`, and there must never be one.
//
// Time helpers come from ./schedulingWorkspace.js (startOfWeekMillis, addWeeks, buildWeekDays,
// durationMinutes) and ./timestampMillis.js (toMillis). This file adds NO second time-utility system.
import { toMillis } from "./timestampMillis.js";
import { buildWeekDays, durationMinutes, startOfWeekMillis } from "./schedulingWorkspace.js";

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/**
 * The day board's visible hour band, matching the artifact's 7a–4p header.
 *
 * Not a business rule and not a constraint on scheduling -- the server happily places work at 02:00
 * and ND-20 says it must. This is the window the GRID draws; work outside it is reported by
 * `outsideBand` rather than hidden, because a placement that vanished from the board would be worse
 * than one drawn awkwardly.
 */
export const DAY_BAND_START_HOUR = 7;
export const DAY_BAND_END_HOUR = 17;

export function startOfDayMillis(millis) {
  const d = new Date(millis);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * The [start, end) instants of the drawn hour band for the local day containing `millis`.
 *
 * `occupancy` — placements and blocked time on that day — WIDENS the band when something falls
 * outside 7a–5p. That is not a cosmetic nicety, it is a correctness requirement:
 *
 * ND-20 deliberately allows work outside recorded hours, because field service legitimately
 * schedules an emergency at 02:00 and a system that refused would be refusing real business. A board
 * with a fixed 7a–5p window would accept that placement, commit it, and then draw NOTHING — the job
 * would exist, be billable, and be invisible on the surface built to see it. Found by the live Quick
 * Gate against real sandbox data, where every scheduled job sat outside the fixed band and the day
 * board rendered empty while insisting it was fine.
 *
 * So the band is 7a–5p by DEFAULT and stretches to whole hours around anything the day actually
 * holds. It never shrinks below the default: a quiet day still reads as a working day.
 */
export function dayBand(millis, occupancy = []) {
  const dayStart = startOfDayMillis(millis);
  const at = (hour) => {
    const d = new Date(dayStart);
    d.setHours(hour, 0, 0, 0);
    return d.getTime();
  };

  let startHour = DAY_BAND_START_HOUR;
  let endHour = DAY_BAND_END_HOUR;
  const dayEnd = dayStart + MS_PER_DAY;

  for (const span of occupancy) {
    if (span?.startMillis == null || span?.endMillis == null) continue;
    // Only what falls on THIS day moves the band; a job running past midnight stretches today to
    // midnight rather than dragging tomorrow's hours onto today's grid.
    if (span.endMillis <= dayStart || span.startMillis >= dayEnd) continue;
    const from = new Date(Math.max(span.startMillis, dayStart));
    const to = new Date(Math.min(span.endMillis, dayEnd));
    startHour = Math.min(startHour, from.getHours());
    // Round the end UP to the next whole hour so a job ending at 17:30 is fully drawn.
    const toHour = to.getHours() + (to.getMinutes() > 0 || to.getSeconds() > 0 ? 1 : 0);
    endHour = Math.max(endHour, Math.min(toHour, 24));
  }

  return { startMillis: at(startHour), endMillis: startHour === 0 && endHour === 24 ? dayEnd : at(endHour) };
}

/** Every span the day board must be able to draw, for `dayBand`'s occupancy argument. */
export function dayOccupancy(workOrders, availabilityViews = []) {
  const spans = [];
  for (const wo of workOrders ?? []) {
    const w = placementWindow(wo);
    if (w) spans.push(w);
  }
  for (const view of availabilityViews) {
    for (const b of view?.blockedTime ?? []) spans.push({ startMillis: b.startMillis, endMillis: b.endMillis });
  }
  return spans;
}

/** The hour labels the grid header renders across whatever band is in force. */
export function bandHours(band) {
  const startHour = new Date(band.startMillis).getHours();
  const span = Math.max(1, Math.round((band.endMillis - band.startMillis) / MS_PER_HOUR));
  const hours = [];
  for (let i = 0; i < span; i += 1) {
    const h = (startHour + i) % 24;
    const suffix = h < 12 ? "a" : "p";
    const display = h % 12 === 0 ? 12 : h % 12;
    hours.push({ hour: h, label: `${display}${suffix}` });
  }
  return hours;
}

/**
 * Where a window sits in the drawn band, as percentages.
 *
 * Returns null when the window is unusable or falls entirely outside the band -- callers must not
 * draw it in the lane. `outsideBand` marks a window that overlaps the band but extends past either
 * edge, so the chip can say so instead of silently appearing shorter than the job really is.
 *
 * Percentages, not pixels: the lane is fluid and the hour header is a 10-column grid over the same
 * band, so both stay aligned at any width without either knowing the other's size.
 */
export function placeInBand(startMillis, endMillis, band) {
  if (startMillis == null || endMillis == null || !(endMillis > startMillis)) return null;
  if (endMillis <= band.startMillis || startMillis >= band.endMillis) return null;

  const span = band.endMillis - band.startMillis;
  const clampedStart = Math.max(startMillis, band.startMillis);
  const clampedEnd = Math.min(endMillis, band.endMillis);

  return {
    leftPercent: ((clampedStart - band.startMillis) / span) * 100,
    widthPercent: ((clampedEnd - clampedStart) / span) * 100,
    outsideBand: startMillis < band.startMillis || endMillis > band.endMillis,
  };
}

/** A Work Order's committed window, normalised. Null start or end means it is not placed. */
export function placementWindow(workOrder) {
  const startMillis = toMillis(workOrder?.scheduledStart);
  const endMillis = toMillis(workOrder?.scheduledEnd);
  if (startMillis == null || endMillis == null || !(endMillis > startMillis)) return null;
  return { startMillis, endMillis, durationMinutes: durationMinutes(startMillis, endMillis) };
}

/** Only SCHEDULED work is placed on a lane. Later statuses are facts elsewhere, not board chips. */
export function isPlaced(workOrder) {
  return workOrder?.status === "SCHEDULED" && placementWindow(workOrder) !== null;
}

/**
 * Capacity for one technician over one window, derived ONLY from governed facts.
 *
 * `availableMinutes` comes from the server, computed by the same pure functions the placement policy
 * validates against -- deliberately NOT recomputed here. A board fed by a different calculation than
 * the one the server enforces is a board that lies, slowly, in ways nobody notices until a dispatcher
 * trusts it.
 *
 * Returns { known: false } when the denominator is unknown. Callers branch; they never default.
 */
export function laneCapacity(availabilityView, placedWorkOrders, band) {
  const available = availabilityView?.availableMinutes;
  const bookedMinutes = placedWorkOrders.reduce((sum, wo) => {
    const w = placementWindow(wo);
    if (!w) return sum;
    const overlapStart = Math.max(w.startMillis, band.startMillis);
    const overlapEnd = Math.min(w.endMillis, band.endMillis);
    return overlapEnd > overlapStart ? sum + (overlapEnd - overlapStart) / MS_PER_MINUTE : sum;
  }, 0);

  if (available == null) {
    // Booked minutes ARE known -- they come from committed placements. Only the denominator is
    // missing, so the hours are reported and the percentage is not.
    return { known: false, bookedMinutes: Math.round(bookedMinutes), percentBooked: null };
  }
  if (available <= 0) {
    // A recorded schedule with no available minutes in this window. Genuinely zero, and different
    // from unknown -- a percentage over zero is still unanswerable, so it is withheld too.
    return { known: true, availableMinutes: 0, bookedMinutes: Math.round(bookedMinutes), percentBooked: null };
  }
  return {
    known: true,
    availableMinutes: available,
    bookedMinutes: Math.round(bookedMinutes),
    percentBooked: Math.round((bookedMinutes / available) * 100),
  };
}

/**
 * Fleet-wide booked percentage, or null.
 *
 * Null unless EVERY technician in view has a recorded schedule. A fleet number averaged over unknown
 * denominators would be a fabrication wearing an aggregate's clothes -- the header simply omits it,
 * which is what the artifact's own do-not-invent list requires.
 */
export function fleetBookedPercent(capacities) {
  if (!capacities.length) return null;
  if (capacities.some((c) => !c.known || c.availableMinutes == null || c.availableMinutes <= 0)) return null;
  const available = capacities.reduce((s, c) => s + c.availableMinutes, 0);
  const booked = capacities.reduce((s, c) => s + c.bookedMinutes, 0);
  if (available <= 0) return null;
  return Math.round((booked / available) * 100);
}

/** Blocked-time records overlapping the drawn band, positioned the same way placements are. */
export function placedBlockedTime(availabilityView, band) {
  const blocks = Array.isArray(availabilityView?.blockedTime) ? availabilityView.blockedTime : [];
  return blocks
    .map((b) => ({ block: b, geometry: placeInBand(b.startMillis, b.endMillis, band) }))
    .filter((b) => b.geometry !== null);
}

/** Total blocked minutes inside the band -- the lane line's "0.5h blocked". */
export function blockedMinutesInBand(availabilityView, band) {
  const blocks = Array.isArray(availabilityView?.blockedTime) ? availabilityView.blockedTime : [];
  const total = blocks.reduce((sum, b) => {
    const start = Math.max(b.startMillis, band.startMillis);
    const end = Math.min(b.endMillis, band.endMillis);
    return end > start ? sum + (end - start) / MS_PER_MINUTE : sum;
  }, 0);
  return Math.round(total);
}

/**
 * The recorded working-hours sentence for a lane, or null when unrecorded.
 *
 * Reads the governed weeklyHours for the band's own weekday and renders the earliest start and
 * latest end. A technician whose day is split by an unpaid lunch has two intervals; the line reports
 * the outer bounds and the gap shows in the grid, rather than inventing a summary the record does
 * not make.
 */
export function shiftLabel(availabilityView, band) {
  const weekly = availabilityView?.workingAvailability?.weeklyHours;
  if (!weekly) return null;
  const dow = new Date(band.startMillis).getDay();
  const intervals = weekly[String(dow)] ?? weekly[dow];
  if (!Array.isArray(intervals) || intervals.length === 0) return null;
  const starts = intervals.map((i) => i.start).filter(Boolean).sort();
  const ends = intervals.map((i) => i.end).filter(Boolean).sort();
  if (!starts.length || !ends.length) return null;
  return `${clock(starts[0])}–${clock(ends[ends.length - 1])}`;
}

/** "07:00" -> "7a". The artifact's lane line reads 7a–4p, not 07:00–16:00. */
function clock(hhmm) {
  const [h, m] = String(hhmm).split(":").map((n) => Number(n));
  if (!Number.isFinite(h)) return String(hhmm);
  const suffix = h < 12 ? "a" : "p";
  const display = h % 12 === 0 ? 12 : h % 12;
  return m ? `${display}:${String(m).padStart(2, "0")}${suffix}` : `${display}${suffix}`;
}

// ---------------------------------------------------------------------------------------------
// Week and two-week projections
// ---------------------------------------------------------------------------------------------

/**
 * Work Orders bucketed by local day for one technician across a set of days.
 *
 * The SAME `placementWindow` the day board uses decides which day a job belongs to, so a job cannot
 * appear on Tuesday in the week view and Wednesday on the day board.
 */
export function bucketByDay(workOrders, days) {
  const buckets = new Map(days.map((d) => [d.dateMillis, []]));
  for (const wo of workOrders) {
    const w = placementWindow(wo);
    if (!w) continue;
    const dayStart = startOfDayMillis(w.startMillis);
    if (buckets.has(dayStart)) buckets.get(dayStart).push({ workOrder: wo, window: w });
  }
  for (const list of buckets.values()) list.sort((a, b) => a.window.startMillis - b.window.startMillis);
  return buckets;
}

/** Blocked-time records bucketed by local day, so the week grid can hatch a PTO day. */
export function bucketBlockedByDay(availabilityView, days) {
  const blocks = Array.isArray(availabilityView?.blockedTime) ? availabilityView.blockedTime : [];
  const buckets = new Map(days.map((d) => [d.dateMillis, []]));
  for (const b of blocks) {
    // A block spanning several days marks each of them; a two-day PTO that only hatched its first
    // day would invite a drop onto the second.
    let cursor = startOfDayMillis(b.startMillis);
    while (cursor < b.endMillis) {
      if (buckets.has(cursor)) buckets.get(cursor).push(b);
      cursor += MS_PER_DAY;
    }
  }
  return buckets;
}

/** The five weekday cells the week view draws, plus weekend days when work is placed on them. */
export function weekDays(anchorMillis, nowMillis) {
  return buildWeekDays(startOfWeekMillis(anchorMillis), nowMillis);
}

/**
 * The load band's days across two weeks.
 *
 * Ten weekday cells, as the artifact draws them — PLUS any weekend day that actually carries work or
 * blocked time. `buildWeekDays` renders all seven for a reason its own comment states outright: "a
 * job scheduled on a weekend is never silently hidden (a hidden job is a correctness bug)". A fixed
 * Mon–Fri band would keep the drawing tidy by dropping real placements out of the load picture,
 * which is the one thing this board must not do.
 *
 * So a quiet fortnight looks exactly like the artifact, and a fortnight with Saturday work says so.
 */
export function fortnightDays(anchorMillis, nowMillis, occupiedDayStarts = new Set()) {
  const first = weekDays(anchorMillis, nowMillis);
  const second = weekDays(startOfWeekMillis(anchorMillis) + 7 * MS_PER_DAY + MS_PER_HOUR, nowMillis);
  return [...first, ...second].filter((d) => !d.isWeekend || occupiedDayStarts.has(d.dateMillis));
}

/** The local day-starts carrying a placement or blocked time — for `fortnightDays`' weekend rule. */
export function occupiedDays(workOrders, availabilityViews = []) {
  const days = new Set();
  for (const wo of workOrders ?? []) {
    const w = placementWindow(wo);
    if (w) days.add(startOfDayMillis(w.startMillis));
  }
  for (const view of availabilityViews) {
    for (const b of view?.blockedTime ?? []) {
      let cursor = startOfDayMillis(b.startMillis);
      while (cursor < b.endMillis) { days.add(cursor); cursor += MS_PER_DAY; }
    }
  }
  return days;
}

/**
 * Per-day load for the two-week band: a percentage where the denominator is known, `null` where it
 * is not. Rendered as a muted "—", never as 0%.
 */
export function dayLoad(availabilityByDay, workOrdersByDay, days) {
  return days.map((day) => {
    const band = dayBand(day.dateMillis);
    const view = availabilityByDay?.get?.(day.dateMillis) ?? null;
    const placed = (workOrdersByDay?.get?.(day.dateMillis) ?? []).map((e) => e.workOrder);
    const capacity = laneCapacity(view, placed, band);
    const blocks = bucketBlockedByDay(view, [day]).get(day.dateMillis) ?? [];
    return { day, capacity, blocked: blocks.length > 0 };
  });
}
