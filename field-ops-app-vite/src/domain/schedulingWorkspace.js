// Work Order Scheduling -- PURE domain for the weekly dispatcher scheduling workspace (no Firebase/I/O;
// unit-tested). This is the CORRECTNESS SPINE of the Scheduling program: it turns the governed
// fieldops_wos read + the technicians read into a weekly view model (technician rows x day columns), a
// READY-TO-SCHEDULE queue, per-technician weekly workload, overlap detection, and a needs-attention
// list. It writes NOTHING and invents NO new lifecycle -- the one governed write is the existing
// deployed transitionWorkOrder("Schedule", ...) call (see buildScheduleInput below + workOrderService).
//
// Authority alignment (docs/architecture/SYSTEM_AUTHORITIES.md, ADR-002 / transitionEngine.ts):
//   - READY_TO_DISPATCH is the ONLY status from which "Schedule" is a valid transition, so the
//     READY-TO-SCHEDULE queue is exactly the WOs in that status. We MIRROR that constant here; we do not
//     re-implement the state machine.
//   - Schedule requires scheduledStart + scheduledEnd + scheduledTechId (admin/dispatcher only). Changing
//     an ALREADY-SCHEDULED WO's time (true "reschedule") is NOT a supported transition in the deployed
//     backend (SCHEDULED -> {DISPATCHED, CANCELLED} only), so this domain never fabricates one. A
//     scheduled job can be OPENED (drill-down) and Dispatched/Cancelled; re-timing it is a recorded
//     governed follow-on, not invented here.

import { WORK_ORDER_TRANSITIONS, ACTION_TO_STATUS } from "./workOrderWorkflow.js";

// The single status from which a WO is schedulable. DERIVED (not a third hardcoded literal) from the
// established client-side lifecycle mirror domain/workOrderWorkflow.js -- the unique status whose valid
// transitions include the "Schedule" action's target (SCHEDULED). This keeps us in lockstep with that
// mirror (itself mirrored from functions/src/transitionEngine.ts) automatically; if the table changes,
// this resolves along with it instead of silently drifting.
const SCHEDULED_STATUS = ACTION_TO_STATUS.Schedule; // "SCHEDULED"
export const SCHEDULABLE_STATUS = Object.keys(WORK_ORDER_TRANSITIONS).find((status) =>
  WORK_ORDER_TRANSITIONS[status].includes(SCHEDULED_STATUS)
);

// Downstream statuses that still represent real "scheduled work this week" once a WO has a scheduledStart
// (a scheduled job that has since been dispatched / is in-flight / finished is still on the week's board).
// CANCELLED is excluded -- a cancelled job is not scheduled work. CREATED/READY_TO_DISPATCH never carry a
// scheduledStart. This is a DISPLAY inclusion rule, not a lifecycle rule.
const CANCELLED_STATUS = "CANCELLED";

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;
const DAYS_PER_WEEK = 7;

// Normalize any timestamp shape this codebase can hand us to epoch-ms (or null). Firestore reads return
// client-SDK Timestamp instances (toMillis()); createWorkOrder/transitionWorkOrder write serverTimestamp /
// Timestamp.fromMillis. Defensive against: number (already ms), Date, Firestore Timestamp {toMillis},
// plain {seconds,nanoseconds} (serialized), and null/garbage -> null (never throws).
export function toMillis(value) {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof value.toMillis === "function") {
    const t = value.toMillis();
    return typeof t === "number" && Number.isFinite(t) ? t : null;
  }
  if (typeof value.seconds === "number") return value.seconds * 1000;
  return null;
}

// Monday 00:00 (LOCAL time) of the week containing `millis`. Local, because dispatchers plan in their own
// day boundaries and Schedule times are chosen as local wall-clock. Uses the Date API so day bucketing is
// self-consistent with buildWeekDays regardless of the runtime timezone (tests never hardcode an absolute
// ms->day mapping that assumes a zone).
export function startOfWeekMillis(millis) {
  const d = new Date(millis);
  d.setHours(0, 0, 0, 0);
  // getDay(): 0=Sun..6=Sat. Days since Monday: Sun -> 6, Mon -> 0, ... Sat -> 5.
  const daysSinceMonday = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - daysSinceMonday);
  d.setHours(0, 0, 0, 0); // re-normalize across any DST shift within the week
  return d.getTime();
}

// Shift a week-start by N weeks (N may be negative). DST-safe: rebuilds via startOfWeekMillis rather than
// adding 7*MS_PER_DAY blindly (a spring-forward/fall-back week is not exactly 7*24h).
export function addWeeks(weekStartMillis, n) {
  const d = new Date(weekStartMillis);
  d.setDate(d.getDate() + n * DAYS_PER_WEEK);
  return startOfWeekMillis(d.getTime());
}

// The 7 day cells (Mon..Sun) of the week starting at weekStartMillis. We render all 7 days -- NOT only
// Mon-Fri -- so a job scheduled on a weekend is never silently hidden (a hidden job is a correctness bug);
// the UI may visually de-emphasize weekends. `isToday` compares against nowMillis' local day.
export function buildWeekDays(weekStartMillis, nowMillis) {
  const todayStart = nowMillis == null ? null : startOfDayMillis(nowMillis);
  const days = [];
  for (let i = 0; i < DAYS_PER_WEEK; i += 1) {
    const d = new Date(weekStartMillis);
    d.setDate(d.getDate() + i);
    d.setHours(0, 0, 0, 0);
    const dateMillis = d.getTime();
    const dow = d.getDay(); // 0=Sun..6=Sat
    days.push({
      index: i,
      dateMillis,
      dow,
      isWeekend: dow === 0 || dow === 6,
      isToday: todayStart != null && dateMillis === todayStart,
    });
  }
  return days;
}

function startOfDayMillis(millis) {
  const d = new Date(millis);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Which day index (0..6) within [weekStartMillis, +7d) a given instant falls on, or -1 if outside the
// week. Uses local-day comparison via buildWeekDays' same convention.
function dayIndexInWeek(instantMillis, weekDays) {
  for (const day of weekDays) {
    const next = day.dateMillis + MS_PER_DAY;
    // MS_PER_DAY is fine for the in/out test at day granularity; DST edges shift the boundary by at most
    // an hour and never move a wall-clock-chosen time across a whole day bucket in practice. Day starts
    // themselves come from setHours(0,0,0,0), which is DST-correct.
    if (instantMillis >= day.dateMillis && instantMillis < next) return day.index;
  }
  return -1;
}

export function durationMinutes(startMillis, endMillis) {
  if (startMillis == null || endMillis == null) return null;
  const diff = endMillis - startMillis;
  if (!Number.isFinite(diff) || diff <= 0) return null;
  return Math.round(diff / MS_PER_MINUTE);
}

// Given a technician's scheduled jobs for ONE day (each {startMillis, endMillis, id}), return the set of
// job ids that overlap at least one other job (interval overlap: a.start < b.end && b.start < a.end).
// Jobs missing a start or end are ignored (can't overlap-test). Pure; O(n log n) sort + O(n^2) worst-case
// pairwise check (fine for realistic per-technician/day job counts).
export function detectDayOverlaps(jobs) {
  const timed = jobs.filter((j) => j.startMillis != null && j.endMillis != null && j.endMillis > j.startMillis);
  const sorted = [...timed].sort((a, b) => a.startMillis - b.startMillis);
  const overlapping = new Set();
  for (let i = 0; i < sorted.length; i += 1) {
    for (let k = i + 1; k < sorted.length; k += 1) {
      if (sorted[k].startMillis >= sorted[i].endMillis) break; // sorted by start -> no later job can overlap i
      // sorted[k].start < sorted[i].end AND (start-sorted) sorted[i].start <= sorted[k].start < end -> overlap
      overlapping.add(sorted[i].id);
      overlapping.add(sorted[k].id);
    }
  }
  return overlapping;
}

// Shape a raw WO into a scheduled-job view (or null if it isn't scheduled work). Scheduled work =
// has a scheduledStart AND status !== CANCELLED. The row owner is the ACTUAL current owner: assignedTechId
// (set at Dispatch, and it may differ from the originally scheduled tech if the dispatcher reassigned)
// takes precedence, falling back to scheduledTechId when the WO is still pre-Dispatch (assignedTechId not
// yet set) or for a legacy/malformed record missing assignedTechId. This keeps the board honest about who
// actually holds a job rather than pinning it to the stale original plan.
function toScheduledJob(wo) {
  const startMillis = toMillis(wo.scheduledStart);
  if (startMillis == null) return null;
  if (wo.status === CANCELLED_STATUS) return null;
  const endMillis = toMillis(wo.scheduledEnd);
  const techId = wo.assignedTechId || wo.scheduledTechId || null;
  return {
    id: wo.id,
    woNumber: wo.woNumber ?? wo.id,
    status: wo.status,
    priority: wo.priority ?? null,
    type: wo.type ?? null,
    customerId: wo.customerId ?? null,
    locationId: wo.locationId ?? null,
    techId,
    startMillis,
    endMillis,
    durationMinutes: durationMinutes(startMillis, endMillis),
  };
}

// Shape a raw READY_TO_DISPATCH WO into a ready-to-schedule queue row.
function toReadyRow(wo) {
  return {
    id: wo.id,
    woNumber: wo.woNumber ?? wo.id,
    status: wo.status,
    priority: wo.priority ?? null,
    type: wo.type ?? null,
    customerId: wo.customerId ?? null,
    locationId: wo.locationId ?? null,
  };
}

// THE view model. Inputs: raw workOrders + technicians (both from governed reads), the week window
// (weekStartMillis; caller derives via startOfWeekMillis), and nowMillis (for isToday / past-due).
//
// Output:
//   weekStartMillis, weekEndMillis, days[7]
//   technicianRows: [{ tech, jobsByDay: {0..6: job[]}, weekJobCount, weekMinutes, overlapIds:Set }]
//     -- one row per technician, in name order; each day's jobs sorted by start.
//   unassignedScheduled: job[]  -- scheduled work whose techId matches no known technician (data gap)
//   readyToSchedule: readyRow[] -- status === READY_TO_DISPATCH (priority then woNumber)
//   needsAttention: [{ kind, job }] -- past-due-scheduled (scheduledStart before today and still pre-Dispatch,
//                                       checked across ALL of workOrders, not just the viewed week -- a stuck
//                                       job must never vanish from this list just because the dispatcher paged
//                                       away from its original week) and overlap (a job that overlaps another
//                                       on the same tech/day, which IS week-scoped since overlap is computed
//                                       per rendered day cell)
//   totals: { scheduledThisWeek, readyToSchedule, technicians }
export function buildWeeklySchedule({ workOrders = [], technicians = [], weekStartMillis, nowMillis } = {}) {
  const weekStart = weekStartMillis ?? startOfWeekMillis(nowMillis ?? 0);
  const days = buildWeekDays(weekStart, nowMillis);
  const weekEndMillis = days[days.length - 1].dateMillis + MS_PER_DAY;
  const todayStart = nowMillis == null ? null : startOfDayMillis(nowMillis);

  // Technician rows scaffold (name order; fall back to id).
  const techsSorted = [...technicians].sort((a, b) => String(a.name ?? a.id).localeCompare(String(b.name ?? b.id)));
  const rowByTechId = new Map();
  const rows = techsSorted.map((tech) => {
    const jobsByDay = {};
    for (let i = 0; i < DAYS_PER_WEEK; i += 1) jobsByDay[i] = [];
    const row = { tech, jobsByDay, weekJobCount: 0, weekMinutes: 0, overlapIds: new Set() };
    rowByTechId.set(tech.id, row);
    return row;
  });

  const unassignedScheduled = [];
  const needsAttention = [];
  let scheduledThisWeekCount = 0;

  for (const wo of workOrders) {
    const job = toScheduledJob(wo);
    if (!job) continue;

    // Past-due: scheduled before today and still not dispatched (pre-Dispatch statuses that carry a
    // schedule are SCHEDULED). A past SCHEDULED job needs dispatcher attention -- checked GLOBALLY
    // (independent of the currently-viewed week) so a stuck job from a prior week is never silently
    // dropped from "Needs attention" just because the dispatcher has since paged to "This week".
    if (todayStart != null && job.startMillis < todayStart && job.status === "SCHEDULED") {
      needsAttention.push({ kind: "PAST_DUE", job });
    }

    const dayIndex = dayIndexInWeek(job.startMillis, days);
    if (dayIndex === -1) continue; // scheduled, but not in the viewed week -- board/board-only, not attention
    scheduledThisWeekCount += 1;

    const row = job.techId ? rowByTechId.get(job.techId) : null;
    if (!row) {
      unassignedScheduled.push(job); // scheduled work with no matching technician row -> surface it, never drop it
      continue;
    }
    row.jobsByDay[dayIndex].push(job);
    row.weekJobCount += 1;
    if (job.durationMinutes) row.weekMinutes += job.durationMinutes;
  }

  // Sort each day's jobs by start and compute per-day overlaps.
  for (const row of rows) {
    for (let i = 0; i < DAYS_PER_WEEK; i += 1) {
      row.jobsByDay[i].sort((a, b) => (a.startMillis ?? 0) - (b.startMillis ?? 0));
      const overlaps = detectDayOverlaps(row.jobsByDay[i]);
      for (const id of overlaps) {
        row.overlapIds.add(id);
        const job = row.jobsByDay[i].find((j) => j.id === id);
        if (job) needsAttention.push({ kind: "OVERLAP", job });
      }
    }
  }

  const readyToSchedule = workOrders
    .filter((wo) => wo.status === SCHEDULABLE_STATUS)
    .map(toReadyRow)
    .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99) || String(a.woNumber).localeCompare(String(b.woNumber)));

  return {
    weekStartMillis: weekStart,
    weekEndMillis,
    days,
    technicianRows: rows,
    unassignedScheduled,
    readyToSchedule,
    needsAttention,
    totals: {
      scheduledThisWeek: scheduledThisWeekCount,
      readyToSchedule: readyToSchedule.length,
      technicians: rows.length,
    },
  };
}

// Validate + assemble the governed Schedule payload from a dispatcher's form inputs. PURE + honest: never
// produces a partial/invalid payload. `date` is "YYYY-MM-DD" (local day), `start`/`end` are "HH:MM"
// (local wall-clock), techId is a governed technician id. Returns { ok:true, value:{ scheduledStart,
// scheduledEnd, scheduledTechId } } (millis) or { ok:false, error } with a stable, user-safe code.
// The three fields mirror transitionWorkOrder.ts:57's required set exactly, so a valid result here is a
// valid Schedule call (defense-in-depth; the server re-validates and is the authority).
export function buildScheduleInput({ date, start, end, techId } = {}) {
  if (!techId) return { ok: false, error: "TECH_REQUIRED" };
  if (!date) return { ok: false, error: "DATE_REQUIRED" };
  if (!start || !end) return { ok: false, error: "TIME_REQUIRED" };

  const startMillis = localDateTimeToMillis(date, start);
  const endMillis = localDateTimeToMillis(date, end);
  if (startMillis == null || endMillis == null) return { ok: false, error: "TIME_INVALID" };
  if (endMillis <= startMillis) return { ok: false, error: "END_BEFORE_START" };

  return { ok: true, value: { scheduledStart: startMillis, scheduledEnd: endMillis, scheduledTechId: techId } };
}

// "YYYY-MM-DD" + "HH:MM" -> local epoch ms (or null if malformed). Built via the Date constructor's
// numeric form (local time), NOT Date.parse of an ISO string (which is UTC for date-only) -- a dispatcher
// picks a local day/time.
function localDateTimeToMillis(date, time) {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date));
  const tm = /^(\d{2}):(\d{2})$/.exec(String(time));
  if (!dm || !tm) return null;
  const y = Number(dm[1]), mo = Number(dm[2]), d = Number(dm[3]);
  const h = Number(tm[1]), mi = Number(tm[2]);
  const dt = new Date(y, mo - 1, d, h, mi, 0, 0);
  const t = dt.getTime();
  if (!Number.isFinite(t)) return null;
  // Reject well-formed-but-out-of-range values (e.g. "2026-02-30", "09:99"): the Date constructor silently
  // rolls them over, so verify each component round-trips instead of accepting a shifted instant.
  if (
    dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d ||
    dt.getHours() !== h || dt.getMinutes() !== mi
  ) return null;
  return t;
}
