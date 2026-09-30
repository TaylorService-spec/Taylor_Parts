// THE GOVERNED TECHNICIAN AVAILABILITY AUTHORITY (Owner ruling DECISION 5, 2026-09-30:
// TECHNICIAN AVAILABILITY MODEL APPROVED).
//
// The smallest PostgreSQL availability representation governed Service scheduling needs, keyed by the canonical
// EMPLOYEE (migration 1764320000000_technician-availability.sql). It is not a second Employee identity and not an
// HR / timekeeping system: it says when an Employee normally works and when they cannot, and nothing else.
//
//   technician_working_schedules + technician_working_hours   recurring weekly hours, LOCAL wall-clock time in one
//                                                            IANA zone, effective over a date range, optionally for
//                                                            ONE operating company
//   technician_unavailability                                dated absolute exceptions (PTO, TRAINING, ...)
//
// ════════════════════ THE PLACEMENT RULE (DECISION 5) ════════════════════
//
// A governed schedule / reschedule / dispatch succeeds only when the technician is
//     ELIGIBLE      (workOrderAssignmentAuthority.assertEmployeeAssignable -- unchanged)
//     WORKING       every minute of the window falls inside configured working hours      else OUTSIDE_WORKING_HOURS
//     NOT BLOCKED   no unavailability overlaps the window                                  else TECHNICIAN_UNAVAILABLE
//     FREE          no other window-holding Work Order overlaps (SCHEDULE_CONFLICT / DOUBLE_BOOKED -- unchanged,
//                   in workOrderScheduling.ts)
// and a window any part of which has NO working schedule governing it is refused AVAILABILITY_NOT_CONFIGURED. There
// is no 24/7 default: absent is not empty, and absent REFUSES.
//
// SUPERSEDES FIREBASE ND-20. In the Firebase process (scheduling/placementPolicy.ts, availabilityModel.ts
// assessWorkingHours) outside-working-hours and no-hours-recorded were only WARNINGS riding on a successful
// placement. DECISION 5 supersedes that for EOS: both REFUSE here. Emergency work outside normal hours is placed by
// first configuring the hours (or a schedule for that company) through the same governed commands -- a recorded,
// attributable act -- never by the placement silently ignoring the calendar.
//
// ════════════════════ ONE MODEL, EVERY READER ════════════════════
//
// The placement check, the board read (readTechnicianAvailability) and the self-scheduling foundation query
// (findAvailableTechnicianSlots) all compute availability through the SAME calendar functions below, so what the
// board shades, what the slot query offers and what a placement is refused for cannot disagree. A second
// availability engine anywhere is the defect this file exists to prevent.
//
// ════════════════════ GOVERNANCE ════════════════════
//
// NO NEW CAPABILITY. Firebase governed working hours and blocked time with the admin/dispatcher bucket
// (schedulingCommands.ts requireDispatcher) -- the bucket that schedules. So every write here requires
// workOrder.lifecycle.schedule, and the reads accept workOrder.lifecycle.schedule or workOrder.lifecycle.dispatch
// (the same pair as the technician picker, workOrderQueries.listWorkOrderTechnicians).
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import {
  OperatingCompanyBindingError, resolveActiveOperatingCompanyId, resolveOperatingCompanyKeyForCompany,
} from "./operatingCompanyBinding";
import {
  WorkOrderLifecycleError, WORK_ORDER_LIFECYCLE_DISPATCH, WORK_ORDER_LIFECYCLE_SCHEDULE, type LifecycleActor,
} from "./workOrderLifecycle";
import type { WorkOrderOp } from "./workOrderOperationTypes";
import { notQuarantined } from "./workOrderQuarantine";
import {
  WORK_ORDER_ASSIGNABLE_EMPLOYMENT_STATUSES, WORK_ORDER_ASSIGNMENT_QUALIFICATION,
} from "./workOrderAssignmentAuthority";

type Category = WorkOrderLifecycleError["category"];
const refuse = (code: string, category: Category, message: string): never => {
  throw new WorkOrderLifecycleError(code, category, message);
};

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

// ════════════════════ vocabulary and bounds ════════════════════

/** The refusal codes a placement can carry from this authority. Distinct, so a client can render each. */
export const AVAILABILITY_REFUSALS = Object.freeze({
  NOT_CONFIGURED: "AVAILABILITY_NOT_CONFIGURED",
  OUTSIDE_WORKING_HOURS: "OUTSIDE_WORKING_HOURS",
  UNAVAILABLE: "TECHNICIAN_UNAVAILABLE",
} as const);

/** scheduling/types.ts BLOCKED_TIME_KINDS -- the one vocabulary, reused (and CHECKed by the migration). */
export const UNAVAILABILITY_KINDS = Object.freeze([
  "PTO", "LUNCH", "TRAINING", "MEETING", "TRUCK_SERVICE", "UNAVAILABLE", "COMPANY_CLOSURE",
] as const);

/**
 * JOB TYPE COMPATIBILITY -- THE SEAM. The Work Eligibility qualification a Work Order type requires of the
 * technician. Today every native type requires SERVICE_TECHNICIAN (the only qualification assignment enforces,
 * workOrderAssignmentAuthority.WORK_ORDER_ASSIGNMENT_QUALIFICATION). When a type needs a narrower qualification
 * (e.g. INSTALL -> an installer code) it is added to the platform vocabulary by migration and mapped HERE, in this
 * one table, and nowhere else; the slot query and assignment then read the same answer.
 */
export const QUALIFICATION_BY_WORK_ORDER_TYPE: Readonly<Record<string, string>> = Object.freeze({
  SERVICE_CALL: WORK_ORDER_ASSIGNMENT_QUALIFICATION,
  PM: WORK_ORDER_ASSIGNMENT_QUALIFICATION,
  INSTALL: WORK_ORDER_ASSIGNMENT_QUALIFICATION,
  WARRANTY: WORK_ORDER_ASSIGNMENT_QUALIFICATION,
  INSPECTION: WORK_ORDER_ASSIGNMENT_QUALIFICATION,
});

export const MAX_INTERVALS_PER_WEEKDAY = 6;
export const MAX_UNAVAILABILITY_DAYS = 90;
/** The board asks for at most a fortnight either side of today (DispatcherBoard: -7 .. +21 days). */
export const MAX_READ_RANGE_DAYS = 31;
export const MAX_READ_EMPLOYEES = 200;
/** The self-scheduling horizon bound. */
export const MAX_SLOT_HORIZON_DAYS = 30;
export const MAX_SLOT_DURATION_MINUTES = 24 * 60;
export const MAX_SLOT_RESULTS = 200;
export const DEFAULT_SLOT_RESULTS = 50;
export const SLOT_INCREMENTS_MINUTES = Object.freeze([15, 30, 60] as const);
/** workOrderScheduling.ts PAST_START_TOLERANCE_MS; restated so this module does not import the command module. */
const PAST_START_TOLERANCE_MS = 60_000;
/** workOrderScheduling.ts WINDOW_HOLDING_STATUSES: a placed, not-yet-finished job holds its window. */
const WINDOW_HOLDING_STATUSES = Object.freeze(["SCHEDULED", "DISPATCHED", "ACCEPTED", "EN_ROUTE", "ARRIVED", "WORK_IN_PROGRESS"]);

// ════════════════════ pure calendar arithmetic ════════════════════

/** A half-open absolute interval in epoch milliseconds. */
export interface Interval { readonly start: number; readonly end: number }

export function mergeIntervals(list: readonly Interval[]): Interval[] {
  // An open-ended span (end = +Infinity) is legitimate; NaN never is.
  const sorted = list.filter((i) => !Number.isNaN(i.start) && !Number.isNaN(i.end) && i.end > i.start)
    .map((i) => ({ start: i.start, end: i.end })).sort((a, b) => a.start - b.start);
  const out: { start: number; end: number }[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    // Touching intervals merge: there is no minute between them.
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

/** `from` minus the union of `cut`. */
export function subtractIntervals(from: readonly Interval[], cut: readonly Interval[]): Interval[] {
  const cuts = mergeIntervals(cut);
  const out: Interval[] = [];
  for (const f of mergeIntervals(from)) {
    let cursor = f.start;
    for (const c of cuts) {
      if (c.end <= cursor || c.start >= f.end) continue;
      if (c.start > cursor) out.push({ start: cursor, end: c.start });
      cursor = Math.max(cursor, c.end);
      if (cursor >= f.end) break;
    }
    if (cursor < f.end) out.push({ start: cursor, end: f.end });
  }
  return out;
}

export function intersectIntervals(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const bs = mergeIntervals(b);
  const out: Interval[] = [];
  for (const x of mergeIntervals(a)) {
    for (const y of bs) {
      const start = Math.max(x.start, y.start);
      const end = Math.min(x.end, y.end);
      if (end > start) out.push({ start, end });
    }
  }
  return mergeIntervals(out);
}

const minutesIn = (list: readonly Interval[]): number => Math.round(mergeIntervals(list).reduce((s, i) => s + (i.end - i.start), 0) / MINUTE);

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = FORMATTERS.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
      hourCycle: "h23",
    });
    FORMATTERS.set(timeZone, f);
  }
  return f;
}

/** A real IANA zone the runtime can compute in. "UTC" is valid; an offset string or a typo is not. */
export function isValidTimeZone(value: unknown): value is string {
  // A NAMED zone only: a bare offset ("+05:00") is exactly the stored-offset error that shifts a schedule by an hour
  // twice a year, even though Intl would accept it.
  if (typeof value !== "string" || value.length > 64 || !/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/.test(value)) return false;
  try {
    formatterFor(value).format(0);
    return true;
  } catch {
    return false;
  }
}

interface WallClock { readonly year: number; readonly month: number; readonly day: number; readonly hour: number; readonly minute: number; readonly second: number }

function wallClock(ms: number, timeZone: string): WallClock {
  const parts = formatterFor(timeZone).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") % 24, minute: get("minute"), second: get("second") };
}

/** The zone's UTC offset at an instant, in ms (wall clock read as UTC, minus the instant). Intl, never a stored offset. */
function offsetAt(ms: number, timeZone: string): number {
  const whole = Math.floor(ms / 1000) * 1000;
  const w = wallClock(whole, timeZone);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - whole;
}

/** "YYYY-MM-DD" -> [y, m, d], validated as a real calendar date. */
function parseDateKey(value: unknown): [number, number, number] | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return [y, m, d];
}

const pad = (n: number) => String(n).padStart(2, "0");
const dateKeyOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

export function addDays(dateKey: string, days: number): string {
  const [y, m, d] = parseDateKey(dateKey)!;
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return dateKeyOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** The local calendar date an instant falls on in a zone. */
export function localDateKey(ms: number, timeZone: string): string {
  const w = wallClock(ms, timeZone);
  return dateKeyOf(w.year, w.month, w.day);
}

/**
 * The instant at which the local wall clock in `timeZone` reads `minutes` past midnight on `dateKey` (minutes may be
 * 1440: the next local midnight). DST-safe: resolved through the zone's offset AT that instant, re-checked once so a
 * boundary on a transition day lands on the right side of it. A wall time that does not exist (inside a
 * spring-forward gap) resolves to the instant the clock jumps past it.
 */
export function zonedInstant(dateKey: string, minutes: number, timeZone: string): number {
  const [y, m, d] = parseDateKey(dateKey)!;
  const naive = Date.UTC(y, m - 1, d, 0, minutes);
  const first = offsetAt(naive, timeZone);
  let t = naive - first;
  const second = offsetAt(t, timeZone);
  if (second !== first) t = naive - second;
  return t;
}

const weekdayOf = (dateKey: string): number => {
  const [y, m, d] = parseDateKey(dateKey)!;
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

/** "HH:MM" (end may be "24:00") -> minutes past local midnight, or null. */
export function parseTimeOfDay(value: unknown, allowEndOfDay = false): number | null {
  if (typeof value !== "string") return null;
  if (allowEndOfDay && value === "24:00") return 1440;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
const formatTimeOfDay = (minutes: number): string => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

/** One weekly schedule as the calendar reads it. `effectiveTo` is EXCLUSIVE; null is open-ended. */
export interface WorkingSchedule {
  readonly scheduleId: string;
  readonly employeeId: string;
  readonly operatingCompanyId: string | null;
  readonly timeZone: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly recordedAt: number;
  /** Keyed by the string weekday "0".."6"; minutes past local midnight. */
  readonly weekly: Readonly<Record<string, readonly { readonly start: number; readonly end: number }[]>>;
}

/** The absolute span a schedule governs, clipped to [from, to). */
function governedSpan(s: WorkingSchedule, range: Interval): Interval[] {
  const start = zonedInstant(s.effectiveFrom, 0, s.timeZone);
  const end = s.effectiveTo === null ? Number.POSITIVE_INFINITY : zonedInstant(s.effectiveTo, 0, s.timeZone);
  return intersectIntervals([{ start, end }], [range]);
}

/** The schedule's working intervals inside `range`, walking the LOCAL dates the range touches. */
function scheduleWorkingIntervals(s: WorkingSchedule, range: Interval): Interval[] {
  const out: Interval[] = [];
  const last = localDateKey(range.end + DAY, s.timeZone);
  for (let date = localDateKey(range.start - DAY, s.timeZone); date <= last; date = addDays(date, 1)) {
    if (date < s.effectiveFrom || (s.effectiveTo !== null && date >= s.effectiveTo)) continue;
    for (const iv of s.weekly[String(weekdayOf(date))] ?? []) {
      out.push({ start: zonedInstant(date, iv.start, s.timeZone), end: zonedInstant(date, iv.end, s.timeZone) });
    }
  }
  return intersectIntervals(out, [range]);
}

export interface EffectiveCalendar {
  /** Where SOME schedule governs (configured) -- working or not. */
  readonly governed: Interval[];
  /** Where the governing schedule says the Employee works. */
  readonly working: Interval[];
}

/**
 * The Employee's effective calendar for Work Orders of `operatingCompanyId`, inside `range`.
 *
 * PRECEDENCE. A schedule for THIS company outranks a company-wide one (operating_company_id NULL); a schedule for
 * another company does not apply at all. Within one applicability the most recently RECORDED schedule governs the
 * dates it covers -- history is never rewritten, so a later record supersedes an earlier one instead of editing it.
 */
export function effectiveCalendar(schedules: readonly WorkingSchedule[], operatingCompanyId: string, range: Interval): EffectiveCalendar {
  const applicable = schedules.filter((s) => s.operatingCompanyId === null || s.operatingCompanyId === operatingCompanyId);
  const ranked = [...applicable].sort((a, b) =>
    (a.operatingCompanyId === null ? 1 : 0) - (b.operatingCompanyId === null ? 1 : 0)
    || b.recordedAt - a.recordedAt || (a.scheduleId < b.scheduleId ? 1 : -1));
  let claimed: Interval[] = [];
  let working: Interval[] = [];
  for (const s of ranked) {
    const own = subtractIntervals(governedSpan(s, range), claimed);
    if (own.length === 0) continue;
    working = mergeIntervals([...working, ...intersectIntervals(scheduleWorkingIntervals(s, range), own)]);
    claimed = mergeIntervals([...claimed, ...own]);
  }
  return { governed: claimed, working };
}

// ════════════════════ reads from PostgreSQL ════════════════════

type Db = Pick<PoolClient, "query">;

async function loadSchedules(db: Db, tenantId: string, employeeIds: readonly string[], range: Interval): Promise<WorkingSchedule[]> {
  if (employeeIds.length === 0) return [];
  // A two-day margin either side covers every zone's local date; the calendar clips exactly.
  const fromDate = new Date(range.start - 2 * DAY).toISOString().slice(0, 10);
  const toDate = new Date(range.end + 2 * DAY).toISOString().slice(0, 10);
  const { rows } = await db.query(
    `SELECT s.id, s.employee_id, s.operating_company_id, s.time_zone,
            to_char(s.effective_from, 'YYYY-MM-DD') AS effective_from,
            to_char(s.effective_to, 'YYYY-MM-DD') AS effective_to, s.recorded_at,
            COALESCE(json_agg(json_build_object('weekday', h.weekday,
                       'start', to_char(h.start_time, 'HH24:MI'), 'end', to_char(h.end_time, 'HH24:MI'))
                     ORDER BY h.weekday, h.start_time) FILTER (WHERE h.id IS NOT NULL), '[]') AS hours
       FROM eos_workforce.technician_working_schedules s
       LEFT JOIN eos_workforce.technician_working_hours h ON h.tenant_id = s.tenant_id AND h.schedule_id = s.id
      WHERE s.tenant_id = $1 AND s.employee_id = ANY($2::text[])
        AND (s.effective_to IS NULL OR s.effective_to > s.effective_from)
        AND s.effective_from <= $4::date AND (s.effective_to IS NULL OR s.effective_to >= $3::date)
      GROUP BY s.id
      ORDER BY s.employee_id, s.recorded_at, s.id`,
    [tenantId, [...employeeIds], fromDate, toDate]);
  return rows.map((r) => {
    const weekly: Record<string, { start: number; end: number }[]> = {};
    for (const h of r.hours as { weekday: number; start: string; end: string }[]) {
      // PostgreSQL renders TIME '24:00' as 24:00 under HH24.
      const end = h.end === "24:00" ? 1440 : parseTimeOfDay(h.end)!;
      (weekly[String(h.weekday)] ??= []).push({ start: parseTimeOfDay(h.start)!, end });
    }
    return Object.freeze({
      scheduleId: r.id, employeeId: r.employee_id, operatingCompanyId: r.operating_company_id ?? null,
      timeZone: r.time_zone, effectiveFrom: r.effective_from, effectiveTo: r.effective_to ?? null,
      recordedAt: new Date(r.recorded_at).getTime(), weekly,
    });
  });
}

export interface UnavailabilityRecord {
  readonly unavailabilityId: string;
  readonly employeeId: string;
  readonly kind: string;
  readonly start: number;
  /** The EFFECTIVE end: ended_at when the period was ended, else its recorded end. */
  readonly end: number;
  readonly scheduledEnd: number;
  readonly ended: boolean;
  readonly reason: string | null;
}

async function loadUnavailability(db: Db, tenantId: string, employeeIds: readonly string[], range: Interval): Promise<UnavailabilityRecord[]> {
  if (employeeIds.length === 0) return [];
  const { rows } = await db.query(
    `SELECT id, employee_id, kind, starts_at, ends_at, ended_at, reason
       FROM eos_workforce.technician_unavailability
      WHERE tenant_id = $1 AND employee_id = ANY($2::text[])
        AND starts_at < $4 AND COALESCE(ended_at, ends_at) > $3 AND COALESCE(ended_at, ends_at) > starts_at
      ORDER BY employee_id, starts_at, id`,
    [tenantId, [...employeeIds], new Date(range.start), new Date(range.end)]);
  return rows.map((r) => Object.freeze({
    unavailabilityId: r.id, employeeId: r.employee_id, kind: r.kind,
    start: new Date(r.starts_at).getTime(), end: new Date(r.ended_at ?? r.ends_at).getTime(),
    scheduledEnd: new Date(r.ends_at).getTime(), ended: r.ended_at !== null, reason: r.reason ?? null,
  }));
}

/**
 * THE ONE READ OF eos_ops.work_orders IN THIS MODULE: the window-holding Work Orders currently assigned to a set of
 * Employees ($2) and overlapping [$3, $4) in tenant $1. Both the slot query and the unavailability overlap warning go
 * through it, so a predicate every Work Order read must carry (e.g. a quarantine exclusion) is added HERE, once.
 */
const WINDOW_HOLDING_WORK_ORDERS_SQL = `
  SELECT w.id, a.assignee_employee_id, w.scheduled_start, w.scheduled_end
    FROM eos_ops.work_orders w
    JOIN eos_ops.work_order_assignments a ON a.tenant_id = w.tenant_id AND a.work_order_id = w.id AND a.effective_to IS NULL
   WHERE w.tenant_id = $1 AND a.assignee_employee_id = ANY($2::text[]) AND ${notQuarantined("w")}
     AND w.status::text = ANY('{${WINDOW_HOLDING_STATUSES.join(",")}}'::text[])
     AND w.scheduled_start IS NOT NULL AND w.scheduled_start < $4 AND $3 < w.scheduled_end
   ORDER BY w.scheduled_start, w.id`;

/** Other window-holding Work Orders assigned to these Employees and overlapping the range. */
async function loadWorkOrderHolds(db: Db, tenantId: string, employeeIds: readonly string[], range: Interval): Promise<{ workOrderId: string; employeeId: string; start: number; end: number }[]> {
  if (employeeIds.length === 0) return [];
  const { rows } = await db.query(WINDOW_HOLDING_WORK_ORDERS_SQL,
    [tenantId, [...employeeIds], new Date(range.start), new Date(range.end)]);
  return rows.map((r) => ({
    workOrderId: r.id, employeeId: r.assignee_employee_id,
    start: new Date(r.scheduled_start).getTime(), end: new Date(r.scheduled_end).getTime(),
  }));
}

// ════════════════════ THE PLACEMENT CHECK ════════════════════

/** A warning that rides on a successful placement (never a refusal). */
export interface AvailabilityWarning { readonly code: string; readonly message: string }

const iso = (ms: number) => new Date(ms).toISOString();

/**
 * THE PLACEMENT AVAILABILITY CHECK every governed schedule / reschedule / dispatch calls, inside its transaction,
 * under the per-Employee placement lock, after eligibility and before the write. It REFUSES (PRECONDITION_FAILED)
 * with AVAILABILITY_NOT_CONFIGURED, TECHNICIAN_UNAVAILABLE (naming the kind) or OUTSIDE_WORKING_HOURS, and returns
 * the warnings to carry on success -- none today: DECISION 5 made the Firebase ND-20 warnings refusals.
 */
export async function checkTechnicianAvailability(
  client: PoolClient,
  input: { readonly tenantId: string; readonly employeeId: string; readonly operatingCompanyKey: string; readonly start: Date; readonly end: Date },
): Promise<readonly AvailabilityWarning[]> {
  const window: Interval = { start: input.start.getTime(), end: input.end.getTime() };
  let companyId: string;
  try {
    companyId = await resolveActiveOperatingCompanyId(client, input.tenantId, input.operatingCompanyKey);
  } catch (err) {
    if (err instanceof OperatingCompanyBindingError) {
      refuse("WORK_ORDER_OPERATING_COMPANY_NOT_GOVERNED", "PRECONDITION_FAILED",
        "the Work Order's operating company is not bound to an ACTIVE governed company; nothing is inferred");
    }
    throw err;
  }
  const schedules = await loadSchedules(client, input.tenantId, [input.employeeId], window);
  const calendar = effectiveCalendar(schedules, companyId!, window);
  const unconfigured = subtractIntervals([window], calendar.governed);
  if (unconfigured.length > 0) {
    refuse(AVAILABILITY_REFUSALS.NOT_CONFIGURED, "PRECONDITION_FAILED",
      `the Employee has no working hours configured for ${companyId!} work at ${iso(unconfigured[0].start)}; `
      + "availability is never assumed -- configure working hours (setTechnicianWorkingHours) first");
  }
  const blocks = await loadUnavailability(client, input.tenantId, [input.employeeId], window);
  const block = blocks.find((b) => b.start < window.end && window.start < b.end);
  if (block) {
    refuse(AVAILABILITY_REFUSALS.UNAVAILABLE, "PRECONDITION_FAILED",
      `the Employee is unavailable (${block.kind}) from ${iso(block.start)} to ${iso(block.end)}, overlapping that window`);
  }
  const outside = subtractIntervals([window], calendar.working);
  if (outside.length > 0) {
    refuse(AVAILABILITY_REFUSALS.OUTSIDE_WORKING_HOURS, "PRECONDITION_FAILED",
      `${minutesIn(outside)} minute(s) of that window fall outside the Employee's working hours (first at ${iso(outside[0].start)}); `
      + "DECISION 5: outside working hours refuses in EOS (the Firebase ND-20 warning is superseded)");
  }
  return Object.freeze([]);
}

// ════════════════════ shared input handling ════════════════════

const ID_SHAPE = (v: unknown): v is string =>
  typeof v === "string" && v !== "" && v.trim() === v && v.length <= 200 && !v.includes("/");

function acceptOnly(input: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) refuse("INPUT_INVALID", "INVALID_INPUT", "input must be an object");
  const extra = Object.keys(input as object).filter((k) => !allowed.includes(k));
  if (extra.length > 0) refuse("INPUT_FIELD_NOT_ACCEPTED", "INVALID_INPUT", `this operation does not accept: ${extra.sort().join(", ")}`);
  return input as Record<string, unknown>;
}

function requireCapability(actor: LifecycleActor, keys: readonly string[], what: string): void {
  if (!ID_SHAPE(actor?.tenantId) || !ID_SHAPE(actor?.principalId)) refuse("ACTOR_INVALID", "INVALID_INPUT", "an actor is a Principal within a tenant");
  if (!(actor.capabilities instanceof Set) || !keys.some((k) => actor.capabilities.has(k))) {
    refuse("CAPABILITY_MISSING", "FORBIDDEN", `${what} requires ${keys.join(" or ")}`);
  }
}
const requireWrite = (actor: LifecycleActor, what: string) => requireCapability(actor, [WORK_ORDER_LIFECYCLE_SCHEDULE], what);
const requireRead = (actor: LifecycleActor, what: string) =>
  requireCapability(actor, [WORK_ORDER_LIFECYCLE_SCHEDULE, WORK_ORDER_LIFECYCLE_DISPATCH], what);

/** An instant as epoch milliseconds or an ISO-8601 string with a zone (workOrderScheduling.parseInstant's rule). */
function parseInstant(value: unknown, field: string): number {
  let ms = Number.NaN;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) ms = value;
  else if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/.test(value)) ms = Date.parse(value);
  if (!Number.isFinite(ms)) refuse("TIME_INVALID", "INVALID_INPUT", `${field} must be epoch milliseconds or an ISO-8601 instant with a zone`);
  return ms;
}

function optionalReason(value: unknown, field = "reason"): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.trim() === "" || value.length > 500) {
    refuse("REASON_INVALID", "INVALID_INPUT", `${field} must be a non-empty string of at most 500 characters`);
  }
  return (value as string).trim();
}

async function inTransaction<T>(deps: { readonly pool: import("pg").Pool }, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await deps.pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    if ((err as { code?: string })?.code === "23505") refuse("AVAILABILITY_CONCURRENT_CHANGE", "CONFLICT", "availability changed concurrently; retry");
    throw err;
  } finally {
    client.release();
  }
}

/** The SAME per-Employee lock the placement commands take, so a placement and an availability change serialize. */
async function lockEmployeePlacement(client: PoolClient, tenantId: string, employeeId: string): Promise<void> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`wo-placement:${tenantId}:${employeeId}`]);
}

async function requireActiveMember(client: PoolClient, actor: LifecycleActor): Promise<void> {
  const { rows } = await client.query(
    `SELECT 1 FROM eos_policy.tenant_memberships m JOIN eos_policy.principals p ON p.id = m.principal_id
      WHERE m.tenant_id = $1 AND m.principal_id = $2 AND m.status = 'active' AND p.status = 'active'`,
    [actor.tenantId, actor.principalId]);
  if (rows.length === 0) refuse("ACTOR_NOT_TENANT_MEMBER", "FORBIDDEN", "the principal is not an active member of this tenant");
}

async function requireEmployee(db: Db, tenantId: string, employeeId: unknown): Promise<{ id: string; operatingCompanyId: string }> {
  if (!ID_SHAPE(employeeId)) refuse("EMPLOYEE_ID_REQUIRED", "INVALID_INPUT", "employeeId is required and must be a governed Employee id");
  const { rows } = await db.query(
    `SELECT id, operating_company_id FROM eos_workforce.employees WHERE tenant_id = $1 AND id = $2`, [tenantId, employeeId]);
  if (rows.length === 0) refuse("EMPLOYEE_NOT_FOUND", "NOT_FOUND", "the Employee does not exist in this tenant");
  return { id: rows[0].id, operatingCompanyId: rows[0].operating_company_id };
}

async function requireActiveCompany(db: Db, tenantId: string, companyId: unknown): Promise<string> {
  if (!ID_SHAPE(companyId)) refuse("OPERATING_COMPANY_ID_INVALID", "INVALID_INPUT", "operatingCompanyId must be a governed operating company id");
  const { rows } = await db.query(
    `SELECT 1 FROM eos_policy.tenant_operating_companies WHERE tenant_id = $1 AND operating_company_id = $2 AND status = 'ACTIVE'`,
    [tenantId, companyId]);
  if (rows.length === 0) refuse("OPERATING_COMPANY_NOT_GOVERNED", "PRECONDITION_FAILED", "the operating company is not ACTIVE for this tenant");
  return companyId as string;
}

// ════════════════════ setTechnicianWorkingHours ════════════════════

type WeeklyInput = Record<string, { start: string; end: string }[]>;

function parseWeeklyHours(value: unknown): Record<string, { start: number; end: number }[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    refuse("WEEKLY_HOURS_INVALID", "INVALID_INPUT", "weeklyHours maps weekday \"0\" (Sunday) .. \"6\" (Saturday) to [{ start: \"HH:MM\", end: \"HH:MM\" }]");
  }
  const out: Record<string, { start: number; end: number }[]> = {};
  let total = 0;
  for (const [key, list] of Object.entries(value as Record<string, unknown>)) {
    if (!/^[0-6]$/.test(key) || !Array.isArray(list)) refuse("WEEKLY_HOURS_INVALID", "INVALID_INPUT", `weeklyHours["${key}"] is not a weekday interval list`);
    if ((list as unknown[]).length > MAX_INTERVALS_PER_WEEKDAY) {
      refuse("WEEKLY_HOURS_INVALID", "INVALID_INPUT", `at most ${MAX_INTERVALS_PER_WEEKDAY} intervals per weekday`);
    }
    const parsed = (list as unknown[]).map((iv) => {
      const r = iv as { start?: unknown; end?: unknown } | null;
      const start = parseTimeOfDay(r?.start);
      const end = parseTimeOfDay(r?.end, true);
      if (start === null || end === null || end <= start) {
        refuse("WORKING_INTERVAL_INVALID", "INVALID_INPUT", `weekday ${key}: an interval is { start: "HH:MM", end: "HH:MM" } with end after start (end may be "24:00")`);
      }
      return { start: start!, end: end! };
    }).sort((a, b) => a.start - b.start);
    for (let i = 1; i < parsed.length; i += 1) {
      if (parsed[i].start < parsed[i - 1].end) refuse("WORKING_INTERVALS_OVERLAP", "INVALID_INPUT", `weekday ${key}: intervals overlap`);
    }
    if (parsed.length > 0) out[key] = parsed;
    total += parsed.length;
  }
  if (total === 0) {
    refuse("WEEKLY_HOURS_EMPTY", "INVALID_INPUT",
      "a working schedule states at least one interval; to stop configuring hours, pass weeklyHours: null with a reason");
  }
  return out;
}

const weeklyView = (weekly: WorkingSchedule["weekly"]): WeeklyInput => {
  const out: WeeklyInput = {};
  for (const [k, list] of Object.entries(weekly)) out[k] = list.map((iv) => ({ start: formatTimeOfDay(iv.start), end: formatTimeOfDay(iv.end) }));
  return out;
};

/**
 * Set an Employee's weekly working hours from `effectiveFrom` (a local date in `timeZone`, default today there,
 * never earlier). The open schedule of the same applicability is ENDED at that date (a schedule that had not yet
 * taken effect is ended ON its own start: it governed nothing), and the new one is recorded open-ended.
 * `weeklyHours: null` ends the open schedule with no replacement (a stated reason is then required): from that date
 * the Employee has NO configured availability and placements refuse AVAILABILITY_NOT_CONFIGURED.
 * `operatingCompanyId` (optional) makes the schedule apply only to that company's Work Orders.
 */
export const setTechnicianWorkingHours: WorkOrderOp = async (deps, caller, input) => {
  const actor = caller.actor;
  requireWrite(actor, "configuring technician working hours");
  const i = acceptOnly(input, ["employeeId", "timeZone", "weeklyHours", "effectiveFrom", "operatingCompanyId", "reason"]);
  if (!isValidTimeZone(i.timeZone)) refuse("TIME_ZONE_INVALID", "INVALID_INPUT", "timeZone must be an IANA time zone, e.g. America/Phoenix");
  const timeZone = i.timeZone as string;
  const ending = i.weeklyHours === null;
  const weekly = ending ? null : parseWeeklyHours(i.weeklyHours);
  const reason = optionalReason(i.reason);
  if (ending && reason === null) refuse("REASON_REQUIRED", "INVALID_INPUT", "ending a working schedule without a replacement states why");
  const now = (deps.now ?? (() => new Date()))().getTime();
  const today = localDateKey(now, timeZone);
  const effectiveFrom = i.effectiveFrom === undefined ? today : (i.effectiveFrom as string);
  if (!parseDateKey(effectiveFrom)) refuse("EFFECTIVE_FROM_INVALID", "INVALID_INPUT", "effectiveFrom is a calendar date YYYY-MM-DD");
  if (effectiveFrom < today) {
    refuse("EFFECTIVE_FROM_IN_PAST", "INVALID_INPUT",
      `effectiveFrom ${effectiveFrom} is before today (${today} in ${timeZone}); past availability is history and is not rewritten`);
  }
  const companyScope = i.operatingCompanyId === undefined || i.operatingCompanyId === null ? null : i.operatingCompanyId;

  return inTransaction(deps, async (client) => {
    await requireActiveMember(client, actor);
    const employee = await requireEmployee(client, actor.tenantId, i.employeeId);
    const operatingCompanyId = companyScope === null ? null : await requireActiveCompany(client, actor.tenantId, companyScope);
    await lockEmployeePlacement(client, actor.tenantId, employee.id);
    const open = await client.query(
      `SELECT id, to_char(effective_from, 'YYYY-MM-DD') AS effective_from FROM eos_workforce.technician_working_schedules
        WHERE tenant_id = $1 AND employee_id = $2 AND COALESCE(operating_company_id, '') = COALESCE($3::text, '') AND effective_to IS NULL
        FOR UPDATE`,
      [actor.tenantId, employee.id, operatingCompanyId]);
    if (ending && open.rows.length === 0) refuse("NO_OPEN_SCHEDULE", "PRECONDITION_FAILED", "there is no open working schedule to end");
    const endedScheduleIds: string[] = [];
    for (const row of open.rows) {
      const endDate = row.effective_from < effectiveFrom ? effectiveFrom : row.effective_from;
      await client.query(
        `UPDATE eos_workforce.technician_working_schedules
            SET effective_to = $3::date, ended_by_principal_id = $4, ended_at = $5, end_reason = $6
          WHERE tenant_id = $1 AND id = $2 AND effective_to IS NULL`,
        [actor.tenantId, row.id, endDate, actor.principalId, new Date(now), reason]);
      endedScheduleIds.push(row.id);
    }
    if (ending) {
      return Object.freeze({ employeeId: employee.id, scheduleId: null, operatingCompanyId, effectiveFrom, endedScheduleIds });
    }
    const scheduleId = `tws_${randomUUID()}`;
    await client.query(
      `INSERT INTO eos_workforce.technician_working_schedules
         (id, tenant_id, employee_id, operating_company_id, time_zone, effective_from, recorded_by_principal_id, recorded_at, reason)
       VALUES ($1,$2,$3,$4,$5,$6::date,$7,$8,$9)`,
      [scheduleId, actor.tenantId, employee.id, operatingCompanyId, timeZone, effectiveFrom, actor.principalId, new Date(now), reason]);
    for (const [weekday, list] of Object.entries(weekly!)) {
      for (const iv of list) {
        await client.query(
          `INSERT INTO eos_workforce.technician_working_hours (id, tenant_id, schedule_id, weekday, start_time, end_time)
           VALUES ($1,$2,$3,$4,$5::time,$6::time)`,
          [`twh_${randomUUID()}`, actor.tenantId, scheduleId, Number(weekday), formatTimeOfDay(iv.start),
           iv.end === 1440 ? "24:00" : formatTimeOfDay(iv.end)]);
      }
    }
    return Object.freeze({
      employeeId: employee.id, scheduleId, operatingCompanyId, timeZone, effectiveFrom, effectiveTo: null,
      weeklyHours: weeklyView(weekly!), endedScheduleIds,
    });
  });
};

// ════════════════════ recordTechnicianUnavailability / endTechnicianUnavailability ════════════════════

/**
 * Record a dated unavailability (PTO, TRAINING, ...). Overlapping another unavailability is LEGITIMATE (Owner
 * ruling 2026-09-12: a closure may cover a lunch). Like Firebase, recording one does NOT refuse over already
 * scheduled work -- moving that work is a decision a person makes -- but the overlapping Work Orders are returned
 * as a warning so the dispatcher sees them.
 */
export const recordTechnicianUnavailability: WorkOrderOp = async (deps, caller, input) => {
  const actor = caller.actor;
  requireWrite(actor, "recording technician unavailability");
  const i = acceptOnly(input, ["employeeId", "kind", "start", "end", "reason"]);
  if (!(UNAVAILABILITY_KINDS as readonly string[]).includes(i.kind as string)) {
    refuse("UNAVAILABILITY_KIND_INVALID", "INVALID_INPUT", `kind is one of ${UNAVAILABILITY_KINDS.join(", ")}`);
  }
  const start = parseInstant(i.start, "start");
  const end = parseInstant(i.end, "end");
  if (end <= start) refuse("UNAVAILABILITY_END_NOT_AFTER_START", "INVALID_INPUT", "end must be after start");
  if (end - start > MAX_UNAVAILABILITY_DAYS * DAY) refuse("UNAVAILABILITY_TOO_LONG", "INVALID_INPUT", `an unavailability is at most ${MAX_UNAVAILABILITY_DAYS} days`);
  const reason = optionalReason(i.reason);
  const now = (deps.now ?? (() => new Date()))();
  return inTransaction(deps, async (client) => {
    await requireActiveMember(client, actor);
    const employee = await requireEmployee(client, actor.tenantId, i.employeeId);
    await lockEmployeePlacement(client, actor.tenantId, employee.id);
    const id = `tua_${randomUUID()}`;
    await client.query(
      `INSERT INTO eos_workforce.technician_unavailability
         (id, tenant_id, employee_id, kind, starts_at, ends_at, reason, recorded_by_principal_id, recorded_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, actor.tenantId, employee.id, i.kind, new Date(start), new Date(end), reason, actor.principalId, now]);
    const overlapping = (await loadWorkOrderHolds(client, actor.tenantId, [employee.id], { start, end })).map((h) => h.workOrderId);
    return Object.freeze({
      unavailabilityId: id, employeeId: employee.id, kind: i.kind, start: iso(start), end: iso(end), reason,
      overlappingWorkOrderIds: overlapping,
      warnings: overlapping.length === 0 ? [] : [{ code: "SCHEDULED_WORK_OVERLAPS",
        message: `${overlapping.length} scheduled Work Order(s) overlap this unavailability and were not moved: ${overlapping.join(", ")}` }],
    });
  });
};

/**
 * END an unavailability -- never delete or edit it. `endAt` (default: now) is the instant it actually stopped,
 * within [start, end]; ending one that has not started yet withdraws it entirely (ended at its own start). An
 * unavailability already over is only ended with an explicit endAt (a correction), and an ended one is immutable.
 */
export const endTechnicianUnavailability: WorkOrderOp = async (deps, caller, input) => {
  const actor = caller.actor;
  requireWrite(actor, "ending technician unavailability");
  const i = acceptOnly(input, ["unavailabilityId", "endAt", "reason"]);
  if (!ID_SHAPE(i.unavailabilityId)) refuse("UNAVAILABILITY_ID_REQUIRED", "INVALID_INPUT", "unavailabilityId is required");
  const reason = optionalReason(i.reason);
  if (reason === null) refuse("REASON_REQUIRED", "INVALID_INPUT", "ending an unavailability states why");
  const explicitEnd = i.endAt === undefined ? null : parseInstant(i.endAt, "endAt");
  const now = (deps.now ?? (() => new Date()))().getTime();
  return inTransaction(deps, async (client) => {
    await requireActiveMember(client, actor);
    const found = await client.query(
      `SELECT employee_id FROM eos_workforce.technician_unavailability WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, i.unavailabilityId]);
    if (found.rows.length === 0) refuse("UNAVAILABILITY_NOT_FOUND", "NOT_FOUND", "no such unavailability in this tenant");
    await lockEmployeePlacement(client, actor.tenantId, found.rows[0].employee_id);
    const { rows } = await client.query(
      `SELECT id, employee_id, kind, starts_at, ends_at, ended_at FROM eos_workforce.technician_unavailability
        WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [actor.tenantId, i.unavailabilityId]);
    const row = rows[0];
    if (row.ended_at !== null) refuse("UNAVAILABILITY_ALREADY_ENDED", "CONFLICT", "this unavailability was already ended");
    const start = new Date(row.starts_at).getTime();
    const end = new Date(row.ends_at).getTime();
    let endAt: number;
    if (explicitEnd !== null) {
      if (explicitEnd < start || explicitEnd > end) refuse("END_AT_OUT_OF_RANGE", "INVALID_INPUT", `endAt must fall within [${iso(start)}, ${iso(end)}]`);
      endAt = explicitEnd;
    } else {
      if (now >= end) refuse("UNAVAILABILITY_ALREADY_OVER", "PRECONDITION_FAILED", "this unavailability is already over; state endAt to correct it");
      endAt = Math.max(start, now);
    }
    await client.query(
      `UPDATE eos_workforce.technician_unavailability
          SET ended_at = $3, ended_by_principal_id = $4, ended_recorded_at = $5, end_reason = $6
        WHERE tenant_id = $1 AND id = $2 AND ended_at IS NULL`,
      [actor.tenantId, row.id, new Date(endAt), actor.principalId, new Date(now), reason]);
    return Object.freeze({
      unavailabilityId: row.id, employeeId: row.employee_id, kind: row.kind, start: iso(start), scheduledEnd: iso(end),
      endedAt: iso(endAt), withdrawn: endAt === start,
    });
  });
};

// ════════════════════ readTechnicianAvailability (the board) ════════════════════

const scheduleView = (s: WorkingSchedule) => Object.freeze({
  scheduleId: s.scheduleId, operatingCompanyId: s.operatingCompanyId, timeZone: s.timeZone,
  effectiveFrom: s.effectiveFrom, effectiveTo: s.effectiveTo, weeklyHours: weeklyView(s.weekly),
});

/** The schedulable technicians: the SAME predicate as the technician picker (workOrderQueries.listWorkOrderTechnicians). */
async function schedulableEmployees(
  db: Db, tenantId: string, companyId: string | null, qualification: string, onlyIds: readonly string[] | null,
): Promise<{ id: string; displayName: string | null; operatingCompanyId: string }[]> {
  const { rows } = await db.query(
    `SELECT e.id, e.display_name, e.operating_company_id FROM eos_workforce.employees e
      WHERE e.tenant_id = $1 AND ($2::text IS NULL OR e.operating_company_id = $2) AND e.employment_status::text = ANY($3::text[])
        AND ($5::text[] IS NULL OR e.id = ANY($5::text[]))
        AND EXISTS (SELECT 1 FROM eos_policy.employee_principal_links l
                     WHERE l.tenant_id = e.tenant_id AND l.employee_id = e.id AND l.status = 'active')
        AND EXISTS (SELECT 1 FROM eos_workforce.employee_work_eligibility q
                     WHERE q.tenant_id = e.tenant_id AND q.employee_id = e.id AND q.qualification_code = $4 AND q.effective_to IS NULL)
      ORDER BY e.display_name NULLS LAST, e.id LIMIT ${MAX_READ_EMPLOYEES}`,
    [tenantId, companyId, [...WORK_ORDER_ASSIGNABLE_EMPLOYMENT_STATUSES], qualification, onlyIds === null ? null : [...onlyIds]]);
  return rows.map((r) => ({ id: r.id, displayName: r.display_name ?? null, operatingCompanyId: r.operating_company_id }));
}

/**
 * Working hours and unavailability for a range (at most 31 days), per Employee, computed by the SAME calendar the
 * placement check uses. Named `employeeIds` are read as they are (any Employee of the tenant; unknown ids are
 * reported, not guessed); without them, every schedulable technician (optionally of one company).
 *
 * `workingAvailability: null` / `availableMinutes: null` mean NOT CONFIGURED anywhere in the range -- never zero.
 */
export const readTechnicianAvailability: WorkOrderOp = async (deps, caller, input) => {
  const actor = caller.actor;
  requireRead(actor, "reading technician availability");
  const i = acceptOnly(input ?? {}, ["start", "end", "employeeIds", "operatingCompanyId"]);
  const start = parseInstant(i.start, "start");
  const end = parseInstant(i.end, "end");
  if (end <= start) refuse("RANGE_INVALID", "INVALID_INPUT", "end must be after start");
  if (end - start > MAX_READ_RANGE_DAYS * DAY) refuse("RANGE_TOO_LONG", "INVALID_INPUT", `a read covers at most ${MAX_READ_RANGE_DAYS} days`);
  let ids: string[] | null = null;
  if (i.employeeIds !== undefined) {
    if (!Array.isArray(i.employeeIds) || i.employeeIds.length > MAX_READ_EMPLOYEES || !i.employeeIds.every(ID_SHAPE)) {
      refuse("EMPLOYEE_IDS_INVALID", "INVALID_INPUT", `employeeIds is a list of at most ${MAX_READ_EMPLOYEES} Employee ids`);
    }
    ids = [...new Set(i.employeeIds as string[])];
  }
  if (i.operatingCompanyId !== undefined && !ID_SHAPE(i.operatingCompanyId)) {
    refuse("OPERATING_COMPANY_ID_INVALID", "INVALID_INPUT", "operatingCompanyId must be a governed operating company id");
  }
  const companyFilter = (i.operatingCompanyId as string | undefined) ?? null;
  const range: Interval = { start, end };
  const pool = deps.pool;

  let employees: { id: string; displayName: string | null; operatingCompanyId: string }[];
  if (ids === null) {
    employees = await schedulableEmployees(pool, actor.tenantId, companyFilter, WORK_ORDER_ASSIGNMENT_QUALIFICATION, null);
  } else {
    const { rows } = await pool.query(
      `SELECT id, display_name, operating_company_id FROM eos_workforce.employees WHERE tenant_id = $1 AND id = ANY($2::text[])
        AND ($3::text IS NULL OR operating_company_id = $3) ORDER BY display_name NULLS LAST, id`,
      [actor.tenantId, ids, companyFilter]);
    employees = rows.map((r) => ({ id: r.id, displayName: r.display_name ?? null, operatingCompanyId: r.operating_company_id }));
  }
  const empIds = employees.map((e) => e.id);
  const [schedules, blocks] = await Promise.all([
    loadSchedules(pool, actor.tenantId, empIds, range), loadUnavailability(pool, actor.tenantId, empIds, range),
  ]);
  const found = new Set(empIds);
  const technicians = employees.map((e) => {
    const mine = schedules.filter((s) => s.employeeId === e.id);
    // An Employee works for their own operating company (DQ-013), so their lane is that company's calendar.
    const calendar = effectiveCalendar(mine, companyFilter ?? e.operatingCompanyId, range);
    const configured = calendar.governed.length > 0;
    const blocked = blocks.filter((b) => b.employeeId === e.id);
    const governing = mine.filter((s) => s.operatingCompanyId === null || s.operatingCompanyId === (companyFilter ?? e.operatingCompanyId))
      .filter((s) => governedSpan(s, range).length > 0);
    const atStart = [...governing].sort((a, b) =>
      (a.operatingCompanyId === null ? 1 : 0) - (b.operatingCompanyId === null ? 1 : 0) || b.recordedAt - a.recordedAt)
      .find((s) => governedSpan(s, { start, end: start + 1 }).length > 0) ?? governing[0] ?? null;
    return Object.freeze({
      employeeId: e.id,
      displayName: e.displayName,
      operatingCompanyId: e.operatingCompanyId,
      availabilityState: configured ? "CONFIGURED" : "NOT_CONFIGURED",
      workingAvailability: configured && atStart ? scheduleView(atStart) : null,
      schedules: governing.map(scheduleView),
      workingIntervals: calendar.working.map((w) => ({ startMillis: w.start, endMillis: w.end })),
      notConfiguredIntervals: subtractIntervals([range], calendar.governed).map((w) => ({ startMillis: w.start, endMillis: w.end })),
      blockedTime: blocked.map((b) => ({
        unavailabilityId: b.unavailabilityId, kind: b.kind, startMillis: b.start, endMillis: b.end,
        scheduledEndMillis: b.scheduledEnd, ended: b.ended, reason: b.reason,
      })),
      availableMinutes: configured
        ? minutesIn(subtractIntervals(calendar.working, blocked.map((b) => ({ start: b.start, end: b.end }))))
        : null,
    });
  });
  return Object.freeze({
    startMillis: start, endMillis: end, technicians,
    notFoundEmployeeIds: ids === null ? [] : ids.filter((id) => !found.has(id)),
  });
};

// ════════════════════ THE SLOT COMPUTATION (one engine, every caller) ════════════════════

export interface TechnicianSlot { readonly employeeId: string; readonly displayName: string | null; readonly start: number; readonly end: number }

/**
 * Every window the placement check would accept, for the schedulable technicians of one company and qualification:
 * working, configured, not blocked, no window-holding Work Order, on the slot grid. The office slot query
 * (findAvailableTechnicianSlots) and customer self-scheduling (selfScheduling.ts) BOTH ask this one function -- a
 * second engine anywhere is the defect this module exists to prevent. `excludeWorkOrderId` ignores that Work Order's
 * own hold (a reschedule never conflicts with itself).
 */
export async function computeTechnicianSlots(
  db: Db,
  input: { readonly tenantId: string; readonly companyId: string; readonly qualification: string; readonly durationMs: number;
    readonly range: Interval; readonly incrementMs: number; readonly onlyIds: readonly string[] | null; readonly excludeWorkOrderId?: string | null },
): Promise<{ slots: TechnicianSlot[]; notConfigured: string[] }> {
  const { tenantId, companyId, qualification, durationMs, range, incrementMs } = input;
  if (range.end <= range.start) return { slots: [], notConfigured: [] };
  const employees = await schedulableEmployees(db, tenantId, companyId, qualification, input.onlyIds);
  const ids = employees.map((e) => e.id);
  // Sequential: one client runs one query at a time.
  const schedules = await loadSchedules(db, tenantId, ids, range);
  const blocks = await loadUnavailability(db, tenantId, ids, range);
  const holds = (await loadWorkOrderHolds(db, tenantId, ids, range)).filter((h) => h.workOrderId !== (input.excludeWorkOrderId ?? null));
  const slots: TechnicianSlot[] = [];
  const notConfigured: string[] = [];
  for (const e of employees) {
    const calendar = effectiveCalendar(schedules.filter((s) => s.employeeId === e.id), companyId, range);
    if (calendar.governed.length === 0) { notConfigured.push(e.id); continue; }
    const busy = [
      ...blocks.filter((b) => b.employeeId === e.id).map((b) => ({ start: b.start, end: b.end })),
      ...holds.filter((h) => h.employeeId === e.id),
    ];
    for (const free of subtractIntervals(calendar.working, busy)) {
      for (let s = Math.ceil(free.start / incrementMs) * incrementMs; s + durationMs <= free.end; s += incrementMs) {
        slots.push({ employeeId: e.id, displayName: e.displayName, start: s, end: s + durationMs });
      }
    }
  }
  slots.sort((a, b) => a.start - b.start || (a.employeeId < b.employeeId ? -1 : a.employeeId > b.employeeId ? 1 : 0));
  return { slots, notConfigured };
}

// ════════════════════ findAvailableTechnicianSlots (the self-scheduling FOUNDATION) ════════════════════

/**
 * THE OFFICE SLOT QUERY. Customer self-scheduling (selfScheduling.ts, Controller SERVICE EXPERIENCE COMPLETION
 * 2026-09-30) computes its offers through the SAME computeTechnicianSlots, so there is never a second engine.
 *
 * Input:  operatingCompanyId (required; ACTIVE and keyed), durationMinutes (1..1440), earliestDate (YYYY-MM-DD, the
 *         earliest allowed scheduling date, in `timeZone`), timeZone (IANA; how earliestDate and the horizon are
 *         read), horizonDays (1..30, default 14), workOrderType? (job type compatibility, via
 *         QUALIFICATION_BY_WORK_ORDER_TYPE), qualificationCode? (must agree with the type; default
 *         SERVICE_TECHNICIAN), employeeIds? (restrict the candidates), slotIncrementMinutes (15 | 30 | 60, default
 *         30), limit (1..200, default 50).
 * Output: slots [{ employeeId, displayName, start, end }] earliest first -- each one a window the placement check
 *         would accept (working, configured, not blocked, no window-holding Work Order, not in the past) --
 *         `truncated`, the searched range, and `notConfiguredEmployeeIds` (eligible, but no hours in the range).
 */
export const findAvailableTechnicianSlots: WorkOrderOp = async (deps, caller, input) => {
  const actor = caller.actor;
  requireRead(actor, "finding available technician slots");
  const i = acceptOnly(input, ["operatingCompanyId", "workOrderType", "qualificationCode", "durationMinutes", "earliestDate",
    "horizonDays", "timeZone", "employeeIds", "slotIncrementMinutes", "limit"]);
  if (!ID_SHAPE(i.operatingCompanyId)) refuse("OPERATING_COMPANY_REQUIRED", "INVALID_INPUT", "operatingCompanyId is required");
  let qualification = WORK_ORDER_ASSIGNMENT_QUALIFICATION;
  if (i.workOrderType !== undefined) {
    const q = QUALIFICATION_BY_WORK_ORDER_TYPE[i.workOrderType as string];
    if (typeof i.workOrderType !== "string" || !q) {
      refuse("WORK_ORDER_TYPE_INVALID", "INVALID_INPUT", `workOrderType is one of ${Object.keys(QUALIFICATION_BY_WORK_ORDER_TYPE).join(", ")}`);
    }
    qualification = q;
  }
  if (i.qualificationCode !== undefined && i.qualificationCode !== qualification) {
    refuse("QUALIFICATION_NOT_SCHEDULABLE", "INVALID_INPUT",
      `${String(i.qualificationCode)} is not the qualification ${i.workOrderType === undefined ? "Work Orders require" : `a ${String(i.workOrderType)} requires`} (${qualification})`);
  }
  const duration = i.durationMinutes;
  if (typeof duration !== "number" || !Number.isSafeInteger(duration) || duration < 1 || duration > MAX_SLOT_DURATION_MINUTES) {
    refuse("DURATION_INVALID", "INVALID_INPUT", `durationMinutes is a whole number 1..${MAX_SLOT_DURATION_MINUTES}`);
  }
  if (!isValidTimeZone(i.timeZone)) refuse("TIME_ZONE_INVALID", "INVALID_INPUT", "timeZone must be an IANA time zone");
  const timeZone = i.timeZone as string;
  if (!parseDateKey(i.earliestDate)) refuse("EARLIEST_DATE_INVALID", "INVALID_INPUT", "earliestDate is a calendar date YYYY-MM-DD");
  const horizonDays = i.horizonDays === undefined ? 14 : i.horizonDays;
  if (typeof horizonDays !== "number" || !Number.isSafeInteger(horizonDays) || horizonDays < 1 || horizonDays > MAX_SLOT_HORIZON_DAYS) {
    refuse("HORIZON_INVALID", "INVALID_INPUT", `horizonDays is a whole number 1..${MAX_SLOT_HORIZON_DAYS}`);
  }
  const increment = i.slotIncrementMinutes === undefined ? 30 : i.slotIncrementMinutes;
  if (!(SLOT_INCREMENTS_MINUTES as readonly unknown[]).includes(increment)) {
    refuse("SLOT_INCREMENT_INVALID", "INVALID_INPUT", `slotIncrementMinutes is one of ${SLOT_INCREMENTS_MINUTES.join(", ")}`);
  }
  const limit = i.limit === undefined ? DEFAULT_SLOT_RESULTS : i.limit;
  if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_SLOT_RESULTS) {
    refuse("LIMIT_INVALID", "INVALID_INPUT", `limit is a whole number 1..${MAX_SLOT_RESULTS}`);
  }
  let onlyIds: string[] | null = null;
  if (i.employeeIds !== undefined) {
    if (!Array.isArray(i.employeeIds) || i.employeeIds.length > MAX_READ_EMPLOYEES || !i.employeeIds.every(ID_SHAPE)) {
      refuse("EMPLOYEE_IDS_INVALID", "INVALID_INPUT", `employeeIds is a list of at most ${MAX_READ_EMPLOYEES} Employee ids`);
    }
    onlyIds = [...new Set(i.employeeIds as string[])];
  }
  const companyId = i.operatingCompanyId as string;
  const now = (deps.now ?? (() => new Date()))().getTime();
  const earliest = i.earliestDate as string;
  const rangeStart = zonedInstant(earliest, 0, timeZone);
  const rangeEnd = zonedInstant(addDays(earliest, horizonDays as number), 0, timeZone);
  const incMs = (increment as number) * MINUTE;
  // Never before now (with the placement's own tolerance), rounded up onto the slot grid.
  const notBefore = Math.ceil((now - PAST_START_TOLERANCE_MS) / incMs) * incMs;
  const range: Interval = { start: Math.max(rangeStart, notBefore), end: rangeEnd };
  const durMs = (duration as number) * MINUTE;

  const client = await deps.pool.connect();
  try {
    try {
      // The company must hold Work Orders at all: ACTIVE and keyed (the symmetric resolver), never inferred.
      await resolveOperatingCompanyKeyForCompany(client, actor.tenantId, companyId);
    } catch (err) {
      if (err instanceof OperatingCompanyBindingError) {
        refuse("OPERATING_COMPANY_NOT_GOVERNED", "PRECONDITION_FAILED", "the operating company is not ACTIVE and keyed for Work Orders in this tenant");
      }
      throw err;
    }
    const base = Object.freeze({
      operatingCompanyId: companyId, workOrderType: (i.workOrderType as string | undefined) ?? null, qualificationCode: qualification,
      durationMinutes: duration, slotIncrementMinutes: increment, timeZone, earliestDate: earliest, horizonDays,
      searchedFrom: iso(Math.min(range.start, range.end)), searchedTo: iso(range.end),
    });
    if (range.end <= range.start) return Object.freeze({ ...base, slots: [], truncated: false, notConfiguredEmployeeIds: [] });

    const { slots, notConfigured } = await computeTechnicianSlots(client, {
      tenantId: actor.tenantId, companyId, qualification, durationMs: durMs, range, incrementMs: incMs, onlyIds,
    });
    return Object.freeze({
      ...base,
      slots: slots.slice(0, limit as number).map((s) => Object.freeze({ employeeId: s.employeeId, displayName: s.displayName, start: iso(s.start), end: iso(s.end) })),
      truncated: slots.length > (limit as number),
      notConfiguredEmployeeIds: notConfigured,
    });
  } finally {
    client.release();
  }
};
