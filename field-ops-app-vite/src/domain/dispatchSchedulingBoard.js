// Wave 7 completion, PART 1 -- pure domain for the combined Dispatch / Scheduling operating workspace.
// This module builds NO new lifecycle and NO new scoring engine: it reshapes the SAME governed inputs
// (workOrders, technicians) that schedulingWorkspace.js already turns into the weekly board into a
// single-DAY, technician-rows x time-axis view model, and it validates/positions a drag-drop the exact
// same way ScheduleWorkOrderForm already does (buildScheduleInput -> transitionWorkOrder("Schedule", ...)).
//
// Authority reused, not duplicated:
//   - buildWeeklySchedule / SCHEDULABLE_STATUS / toMillis / detectDayOverlaps  (./schedulingWorkspace.js)
//   - buildScheduleInput                                                       (./schedulingWorkspace.js)
//   - workOrderPriorityLabel                                                   (./workOrderPriority.js)
//
// Duration authority (AUDITED, see docs/roadmaps and this file's header): there is NO estimated-duration
// or estimated-effort field anywhere on a Work Order (functions/src/types/workOrder.ts /
// src/types/workOrder.ts). `durationMinutes` only exists AFTER a job is scheduled (derived from
// scheduledEnd - scheduledStart, see schedulingWorkspace.durationMinutes) -- it is a FACT about a placed
// job, not an estimate a dispatcher could use to group unscheduled work. Grouping "Ready for Work" by
// duration would therefore be fabricated. This module groups the ready queue by PRIORITY instead --
// `priority` is a real, governed, chosen-at-creation field (workOrderPriority.js) that already has its own
// canonical vocabulary.
//
// Non-work time: there is no shift/break/PTO time-block model anywhere in this codebase (audited --
// TECHNICIAN docs carry only a live `status` of available/on_job/off_shift, no start/end shift times). This
// module does NOT invent one. It exposes `tech.status` (via technicianStatusTone.js, already the ONE tone
// map for that field) so an OFF_SHIFT technician's row reads as non-work-available, but it draws no
// break/lunch/PTO blocks on the timeline -- that would require data that does not exist.

import {
  buildWeeklySchedule,
  startOfWeekMillis,
  toMillis,
} from "./schedulingWorkspace.js";
import { workOrderPriorityLabel } from "./workOrderPriority.js";

const MS_PER_MINUTE = 60_000;

// The VISIBLE timeline window. A display convention (field-service business hours), not an authoritative
// business rule -- a job placed outside this window is still shown (clipped to the nearer edge), never
// hidden, matching buildWeekDays' "a hidden job is a correctness bug" convention in schedulingWorkspace.js.
export const DAY_WINDOW_START_HOUR = 6; // 6:00 AM
export const DAY_WINDOW_END_HOUR = 19; // 7:00 PM
export const DEFAULT_SLOT_DURATION_MINUTES = 60; // drop-time suggestion only, see buildDropDefaults below
export const DROP_SNAP_MINUTES = 15;

function startOfDayMillis(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

// "YYYY-MM-DD" for a local day -- the exact string shape schedulingWorkspace.buildScheduleInput expects.
export function toDateString(dayMillis) {
  const d = new Date(dayMillis);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// "HH:MM" for a local time -- the exact string shape schedulingWorkspace.buildScheduleInput expects.
export function toTimeString(millis) {
  const d = new Date(millis);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// Position a [startMillis, endMillis) interval within one day's visible window as a left%/width% pair for
// absolute placement on the horizontal time axis. Pure arithmetic, no I/O. Clips to the window edges
// (never returns an interval outside [0,100]) and reports whether it clipped, so the UI can flag a job that
// starts before/ends after the visible hours instead of silently misrepresenting it.
export function computeTimelineSlot({ startMillis, endMillis, dayStartMillis, windowStartHour = DAY_WINDOW_START_HOUR, windowEndHour = DAY_WINDOW_END_HOUR }) {
  if (startMillis == null) return null;
  const windowStart = dayStartMillis + windowStartHour * 60 * MS_PER_MINUTE;
  const windowEnd = dayStartMillis + windowEndHour * 60 * MS_PER_MINUTE;
  const windowSpan = windowEnd - windowStart;
  if (windowSpan <= 0) return null;

  const rawEnd = endMillis != null && endMillis > startMillis ? endMillis : startMillis + DEFAULT_SLOT_DURATION_MINUTES * MS_PER_MINUTE;

  const clippedStart = Math.min(Math.max(startMillis, windowStart), windowEnd);
  const clippedEnd = Math.min(Math.max(rawEnd, windowStart), windowEnd);
  const startClipped = startMillis < windowStart || startMillis > windowEnd;
  const endClipped = rawEnd > windowEnd || rawEnd < windowStart;

  const leftPct = ((clippedStart - windowStart) / windowSpan) * 100;
  const widthPct = Math.max(((clippedEnd - clippedStart) / windowSpan) * 100, 0.5); // never a zero-width chip

  return { leftPct, widthPct, startClipped, endClipped, hasEnd: endMillis != null };
}

// Inverse of computeTimelineSlot's x-axis math: given a fractional drop position [0,1] along the visible
// window, resolve the local wall-clock instant it represents, snapped to DROP_SNAP_MINUTES. Used ONLY to
// prefill the governed Schedule form after a drop -- it never itself becomes a write.
export function offsetFractionToMillis(dayStartMillis, offsetFraction, { windowStartHour = DAY_WINDOW_START_HOUR, windowEndHour = DAY_WINDOW_END_HOUR, snapMinutes = DROP_SNAP_MINUTES } = {}) {
  const clamped = Math.min(Math.max(offsetFraction, 0), 1);
  const windowStart = dayStartMillis + windowStartHour * 60 * MS_PER_MINUTE;
  const windowEnd = dayStartMillis + windowEndHour * 60 * MS_PER_MINUTE;
  const raw = windowStart + clamped * (windowEnd - windowStart);
  const snapMs = snapMinutes * MS_PER_MINUTE;
  return Math.round(raw / snapMs) * snapMs;
}

// Builds the prefill (never a silent write) for the drop-confirm step: date + start from the drop position,
// a SUGGESTED end (start + DEFAULT_SLOT_DURATION_MINUTES, since no authoritative duration exists to derive
// it from) that the dispatcher must review/can change, and the technician from the row dropped onto.
// Nothing here calls transitionWorkOrder -- see workOrderService.transitionWorkOrder for the actual write.
export function buildDropDefaults({ dayStartMillis, offsetFraction, techId, windowStartHour = DAY_WINDOW_START_HOUR, windowEndHour = DAY_WINDOW_END_HOUR }) {
  const startMillis = offsetFractionToMillis(dayStartMillis, offsetFraction, { windowStartHour, windowEndHour });
  const endMillis = startMillis + DEFAULT_SLOT_DURATION_MINUTES * MS_PER_MINUTE;
  return {
    date: toDateString(dayStartMillis),
    start: toTimeString(startMillis),
    end: toTimeString(endMillis),
    techId: techId ?? "",
  };
}

// Groups the READY-TO-SCHEDULE queue (schedulingWorkspace.buildWeeklySchedule's own `readyToSchedule`,
// unmodified) by the one real, governed field available on unscheduled work: priority. Buckets in priority
// order (1 Emergency .. 4 Low), with an honest "Unspecified" bucket last for rows missing a priority --
// never dropped, never guessed into a bucket that wasn't chosen.
export function groupReadyQueueByPriority(readyToSchedule = []) {
  const byPriority = new Map();
  const unspecified = [];
  for (const row of readyToSchedule) {
    const label = workOrderPriorityLabel(row.priority);
    if (label == null) {
      unspecified.push(row);
      continue;
    }
    if (!byPriority.has(row.priority)) byPriority.set(row.priority, []);
    byPriority.get(row.priority).push(row);
  }
  const groups = [...byPriority.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([priority, items]) => ({ key: `priority-${priority}`, label: workOrderPriorityLabel(priority), items }));
  if (unspecified.length > 0) groups.push({ key: "priority-unspecified", label: "Unspecified priority", items: unspecified });
  return groups;
}

// THE view model for one day of the combined board. Reuses buildWeeklySchedule (the SAME weekly board
// domain SchedulingWorkspace.jsx already renders) for a week containing `dayMillis`, then slices out just
// that day + adds timeline positions. No lifecycle, no overlap detection, no ready-queue filtering is
// reimplemented here -- all of it is the identical output buildWeeklySchedule already computed.
export function buildDayBoard({ workOrders = [], technicians = [], dayMillis, nowMillis, windowStartHour = DAY_WINDOW_START_HOUR, windowEndHour = DAY_WINDOW_END_HOUR } = {}) {
  const dayStart = startOfDayMillis(dayMillis ?? nowMillis ?? Date.now());
  const weekStart = startOfWeekMillis(dayStart);
  const vm = buildWeeklySchedule({ workOrders, technicians, weekStartMillis: weekStart, nowMillis });

  const dayIndex = vm.days.findIndex((d) => d.dateMillis === dayStart);
  const day = dayIndex === -1 ? null : vm.days[dayIndex];

  const technicianRows = vm.technicianRows.map((row) => {
    const jobs = dayIndex === -1 ? [] : row.jobsByDay[dayIndex];
    return {
      tech: row.tech,
      overlapIds: row.overlapIds,
      jobs: jobs.map((job) => ({
        ...job,
        slot: computeTimelineSlot({ startMillis: job.startMillis, endMillis: job.endMillis, dayStartMillis: dayStart, windowStartHour, windowEndHour }),
      })),
    };
  });

  // unassignedScheduled / needsAttention are week-scoped in buildWeeklySchedule's output; slice to this day
  // by the job's own startMillis (never re-derived -- just filtered).
  const unassignedScheduledToday = vm.unassignedScheduled.filter(
    (job) => job.startMillis != null && startOfDayMillis(job.startMillis) === dayStart
  );
  const needsAttentionToday = vm.needsAttention.filter(
    (item) => item.job?.startMillis != null && startOfDayMillis(item.job.startMillis) === dayStart
  );

  return {
    dayMillis: dayStart,
    day,
    technicianRows,
    unassignedScheduledToday,
    needsAttentionToday,
    readyToSchedule: vm.readyToSchedule, // global queue, not day-bound -- unscheduled work has no date yet
    readyGroups: groupReadyQueueByPriority(vm.readyToSchedule),
    windowStartHour,
    windowEndHour,
    totals: {
      scheduledToday: technicianRows.reduce((n, r) => n + r.jobs.length, 0) + unassignedScheduledToday.length,
      readyToSchedule: vm.totals.readyToSchedule,
      technicians: vm.totals.technicians,
    },
  };
}

// Hour tick labels for the visible window (e.g. "6 AM" .. "7 PM"), for the timeline header.
export function buildHourTicks(windowStartHour = DAY_WINDOW_START_HOUR, windowEndHour = DAY_WINDOW_END_HOUR) {
  const ticks = [];
  for (let h = windowStartHour; h <= windowEndHour; h += 1) {
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    const suffix = h < 12 || h === 24 ? "AM" : "PM";
    ticks.push({ hour: h, leftPct: ((h - windowStartHour) / (windowEndHour - windowStartHour)) * 100, label: `${hour12} ${suffix}` });
  }
  return ticks;
}

export { toMillis };
