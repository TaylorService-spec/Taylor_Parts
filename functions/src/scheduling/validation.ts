// Dispatch & Scheduler -- pure validation of scheduling command INPUT. No Firestore, no clock, never
// throws; returns { valid, value } | { valid:false, errors }, the same contract truckRegistry's
// validation.ts uses so both families read alike.
//
// This file validates SHAPE. It does not validate POLICY -- whether a technician is eligible, whether
// the window collides, whether it lands in blocked time are all transactional questions answered in
// schedulingCommands.ts against real reads. The split matters: shape can be checked before any read,
// and rejecting a malformed request early keeps a garbage payload from ever opening a transaction.
import { BLOCKED_TIME_KINDS, type BlockedTimeKind, type WorkingInterval, type Weekday, WEEKDAYS } from "./types";
import { parseTimeOfDay } from "./availabilityModel";

export interface ValidationError {
  path: string;
  code: string;
}
export type ValidationResult<T> = { valid: true; value: T } | { valid: false; errors: ValidationError[] };

const ID_MAX = 200;
const NOTE_MAX = 500;
const REASON_MAX = 500;

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isId = (v: unknown): v is string => isNonEmptyString(v) && v.length <= ID_MAX && v === (v as string).trim();

// A scheduled window may not exceed this. Not a business rule about how long a job can take -- it is
// a guard so a malformed or hostile payload cannot ask the availability model to walk a million
// minutes, and so a fat-fingered year cannot silently reserve a technician for a decade.
export const MAX_WINDOW_MINUTES = 60 * 24 * 14; // two weeks

// The longest planning estimate a Work Order may carry (ND-21). Same reasoning: an estimate is a
// planning aid, and one longer than the maximum window it could ever be placed into is a typo.
export const MAX_ESTIMATED_DURATION_MINUTES = MAX_WINDOW_MINUTES;

export function parseTechnicianId(v: unknown, path = "technicianId"): ValidationResult<string> {
  return isId(v) ? { valid: true, value: v } : { valid: false, errors: [{ path, code: "invalid" }] };
}

export function parseReason(v: unknown, path = "reason"): ValidationResult<string> {
  if (!isNonEmptyString(v) || v.length > REASON_MAX) {
    return { valid: false, errors: [{ path, code: "invalid" }] };
  }
  return { valid: true, value: v.trim() };
}

export interface ScheduleWindow {
  startMillis: number;
  endMillis: number;
}

/**
 * A proposed scheduled window. Epoch millis, integral, ordered, and bounded.
 *
 * `start < end` is enforced here rather than in the command because it is the one window rule that
 * is true regardless of technician, policy or clock -- a window that ends before it begins is not a
 * conflict to be warned about, it is not a window.
 */
export function parseScheduleWindow(raw: unknown): ValidationResult<ScheduleWindow> {
  const errors: ValidationError[] = [];
  const data = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const start = data.scheduledStart;
  const end = data.scheduledEnd;

  const startOk = typeof start === "number" && Number.isSafeInteger(start) && start > 0;
  const endOk = typeof end === "number" && Number.isSafeInteger(end) && end > 0;
  if (!startOk) errors.push({ path: "scheduledStart", code: "invalid" });
  if (!endOk) errors.push({ path: "scheduledEnd", code: "invalid" });
  if (errors.length) return { valid: false, errors };

  const startMillis = start as number;
  const endMillis = end as number;
  if (endMillis <= startMillis) {
    return { valid: false, errors: [{ path: "scheduledEnd", code: "not_after_start" }] };
  }
  if (endMillis - startMillis > MAX_WINDOW_MINUTES * 60_000) {
    return { valid: false, errors: [{ path: "scheduledEnd", code: "window_too_long" }] };
  }
  return { valid: true, value: { startMillis, endMillis } };
}

/**
 * ND-21's planning estimate. OPTIONAL by ruling -- `undefined` and `null` both mean "not estimated"
 * and are valid, and are NOT the same as zero. A Work Order without an estimate is the normal case
 * (every record written before this field existed has none), so the absence must never be an error.
 */
export function parseEstimatedDurationMinutes(v: unknown): ValidationResult<number | null> {
  if (v === undefined || v === null) return { valid: true, value: null };
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v <= 0 || v > MAX_ESTIMATED_DURATION_MINUTES) {
    return { valid: false, errors: [{ path: "estimatedDurationMinutes", code: "invalid" }] };
  }
  return { valid: true, value: v };
}

export function isBlockedTimeKind(v: unknown): v is BlockedTimeKind {
  return typeof v === "string" && (BLOCKED_TIME_KINDS as readonly string[]).includes(v);
}

export interface BlockedTimeInput {
  technicianId: string;
  kind: BlockedTimeKind;
  startMillis: number;
  endMillis: number;
  note?: string;
}

export function validateBlockedTimeInput(raw: unknown): ValidationResult<BlockedTimeInput> {
  const errors: ValidationError[] = [];
  const data = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};

  if (!isId(data.technicianId)) errors.push({ path: "technicianId", code: "invalid" });
  if (!isBlockedTimeKind(data.kind)) errors.push({ path: "kind", code: "invalid" });
  if (data.note !== undefined && (typeof data.note !== "string" || data.note.length > NOTE_MAX)) {
    errors.push({ path: "note", code: "invalid" });
  }

  // Blocked time reuses the schedule-window parser so a PTO day and a service call are bounded and
  // ordered by exactly the same rule -- two different answers to "is this a valid window" is how the
  // two authorities would drift apart.
  const window = parseScheduleWindow({ scheduledStart: data.startMillis, scheduledEnd: data.endMillis });
  if (!window.valid) {
    for (const err of window.errors) {
      errors.push({ path: err.path === "scheduledStart" ? "startMillis" : "endMillis", code: err.code });
    }
  }
  if (errors.length) return { valid: false, errors };

  const value: BlockedTimeInput = {
    technicianId: data.technicianId as string,
    kind: data.kind as BlockedTimeKind,
    startMillis: (window as { valid: true; value: ScheduleWindow }).value.startMillis,
    endMillis: (window as { valid: true; value: ScheduleWindow }).value.endMillis,
  };
  if (typeof data.note === "string" && data.note.trim().length > 0) value.note = data.note.trim();
  return { valid: true, value };
}

export interface WorkingAvailabilityInput {
  technicianId: string;
  timeZone: string;
  weeklyHours: Partial<Record<`${Weekday}`, WorkingInterval[]>>;
}

/** An IANA zone the runtime actually knows. Checked by asking Intl, not by pattern-matching a string. */
export function isUsableTimeZone(v: unknown): v is string {
  if (!isNonEmptyString(v)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: v });
    return true;
  } catch {
    return false;
  }
}

export function validateWorkingAvailabilityInput(raw: unknown): ValidationResult<WorkingAvailabilityInput> {
  const errors: ValidationError[] = [];
  const data = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};

  if (!isId(data.technicianId)) errors.push({ path: "technicianId", code: "invalid" });
  if (!isUsableTimeZone(data.timeZone)) errors.push({ path: "timeZone", code: "invalid" });

  const rawHours = data.weeklyHours;
  if (!rawHours || typeof rawHours !== "object" || Array.isArray(rawHours)) {
    errors.push({ path: "weeklyHours", code: "invalid" });
    return { valid: false, errors };
  }

  const weeklyHours: Partial<Record<`${Weekday}`, WorkingInterval[]>> = {};
  for (const [key, value] of Object.entries(rawHours as Record<string, unknown>)) {
    const weekday = Number(key);
    if (!WEEKDAYS.includes(weekday as Weekday) || String(weekday) !== key) {
      errors.push({ path: `weeklyHours.${key}`, code: "invalid_weekday" });
      continue;
    }
    if (!Array.isArray(value)) {
      errors.push({ path: `weeklyHours.${key}`, code: "invalid" });
      continue;
    }
    const intervals: WorkingInterval[] = [];
    value.forEach((interval, index) => {
      const start = parseTimeOfDay((interval as WorkingInterval)?.start);
      const end = parseTimeOfDay((interval as WorkingInterval)?.end);
      if (start === null || end === null) {
        errors.push({ path: `weeklyHours.${key}[${index}]`, code: "invalid_time" });
        return;
      }
      if (end <= start) {
        // Refused rather than silently dropped. normalizeIntervals() ignores a reversed interval so
        // the READ path stays safe, but accepting one on the WRITE path would store a record whose
        // displayed hours and enforced hours differ -- the exact disagreement this domain exists to
        // prevent.
        errors.push({ path: `weeklyHours.${key}[${index}]`, code: "end_not_after_start" });
        return;
      }
      intervals.push({ start: (interval as WorkingInterval).start, end: (interval as WorkingInterval).end });
    });
    // A weekday explicitly set to [] is a NON-WORKING DAY that someone chose. That is meaningful and
    // is kept -- it is not the same as the weekday being absent from an unrecorded schedule.
    weeklyHours[`${weekday as Weekday}`] = intervals;
  }

  if (errors.length) return { valid: false, errors };
  return {
    valid: true,
    value: {
      technicianId: data.technicianId as string,
      timeZone: data.timeZone as string,
      weeklyHours,
    },
  };
}
