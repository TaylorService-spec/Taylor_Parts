// Dispatch & Scheduler -- governed Scheduling domain types.
//
// Two authorities, deliberately separate (ND-22, Owner ruling 2026-08-27): a technician's RECURRING
// weekly working schedule, and DATED one-off exceptions. They have different shapes and different
// lifecycles; folding them together would make every lunch break carry a recurrence rule it does not
// need.
//
// Neither collection is a second Work Order state machine and neither stores Work Order state. The
// Work Order remains the sole owner of `scheduledStart` / `scheduledEnd` / `scheduledTechId` -- these
// records say when a technician CAN work, never what they are working on.
//
// Both collections are Admin-SDK-only: firestore.rules denies all client read AND write, matching the
// `sales_orders` / `opportunities` / `cycle_counts` posture. The Dispatch board reads them through a
// trusted read path, never directly.
import type { Timestamp } from "firebase-admin/firestore";

export const TECHNICIAN_WORKING_AVAILABILITY_COLLECTION = "technician_working_availability";
export const TECHNICIAN_BLOCKED_TIME_COLLECTION = "technician_blocked_time";

// 0 = Sunday .. 6 = Saturday, matching JavaScript's Date.getDay() so no translation layer is needed
// anywhere. Stored as the string form of the number because Firestore map keys are strings.
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export const WEEKDAYS: readonly Weekday[] = [0, 1, 2, 3, 4, 5, 6];

/**
 * One working interval on one weekday, as LOCAL WALL-CLOCK time in the record's own `timeZone`.
 * "07:00"-"16:00" means seven in the morning where the technician works, on every matching weekday,
 * across daylight-saving boundaries -- which is the only reading that stays true in March and
 * November. Storing an absolute offset instead would silently shift a technician's whole schedule
 * twice a year.
 *
 * A weekday may carry MORE THAN ONE interval. That is how an unpaid lunch is expressed without
 * inventing a second record type: 07:00-12:00 and 13:00-16:00 leaves a real gap at noon.
 */
export interface WorkingInterval {
  start: string; // "HH:MM", 24-hour
  end: string; // "HH:MM", 24-hour, strictly after start
}

/**
 * The recurring authority. Document id IS the technicianId -- a technician has exactly one working
 * schedule, so there is no way to write two that disagree.
 *
 * ABSENT IS NOT EMPTY. A technician with no document has an UNRECORDED schedule, not a zero-hour
 * one. Every consumer must distinguish the two: the board says "no working schedule recorded"
 * rather than drawing 0% booked, and the scheduling commands warn rather than refuse. Treating
 * absence as emptiness would make every technician unschedulable the moment this collection ships.
 */
export interface TechnicianWorkingAvailability {
  technicianId: string;
  /** IANA zone, e.g. "America/Phoenix". Required -- wall-clock times are meaningless without it. */
  timeZone: string;
  /** Keyed by the STRING form of Weekday. A weekday absent from the map is a non-working day. */
  weeklyHours: Partial<Record<`${Weekday}`, WorkingInterval[]>>;
  updatedAt: Timestamp;
  updatedByUid: string;
}

// Why a technician is unavailable. A closed vocabulary, because these words appear on the dispatch
// board and an open string field would become seven spellings of "vacation" within a month.
export const BLOCKED_TIME_KINDS = [
  "PTO",
  "LUNCH",
  "TRAINING",
  "MEETING",
  "TRUCK_SERVICE",
  "UNAVAILABLE",
  "COMPANY_CLOSURE",
] as const;
export type BlockedTimeKind = (typeof BLOCKED_TIME_KINDS)[number];

/**
 * The exception authority. A single dated absolute window -- no recurrence rule, on purpose: a
 * recurring absence belongs in `weeklyHours` as a gap (that is what the multi-interval shape above
 * is for), and everything else genuinely happens once.
 *
 * Absolute epoch millis rather than wall-clock, because an exception is a specific moment: PTO on
 * the 14th is that day, not "the 14th in whatever zone the reader is sitting in".
 */
export interface TechnicianBlockedTime {
  blockId: string;
  technicianId: string;
  kind: BlockedTimeKind;
  startMillis: number;
  endMillis: number;
  /** Free text shown on the board. Never load-bearing -- `kind` carries the meaning. */
  note?: string;
  createdAt: Timestamp;
  createdByUid: string;
}

// ---------------------------------------------------------------------------------------------
// Failure taxonomy
// ---------------------------------------------------------------------------------------------

// One stable code per reason a scheduling command can refuse. Callables map these to HttpsError
// codes and a GENERIC per-code message (schedulingCallables.ts) so no internal state leaks past the
// trust boundary -- the code is what a client acts on, not the prose.
export const SCHEDULING_FAILURE_CODES = [
  "INVALID_INPUT",
  "PERMISSION_DENIED",
  "WORK_ORDER_NOT_FOUND",
  "NOT_SCHEDULED", // the Work Order is not in SCHEDULED, so there is no schedule to change
  "REASON_REQUIRED",
  "TECHNICIAN_NOT_FOUND",
  "TECHNICIAN_INELIGIBLE",
  "SCHEDULE_CONFLICT", // same technician, overlapping window
  "BLOCKED_TIME_CONFLICT",
  "START_IN_PAST",
  "STALE_WORK_ORDER", // the client's view of the schedule is not what is stored
] as const;
export type SchedulingFailureCode = (typeof SCHEDULING_FAILURE_CODES)[number];

export class SchedulingError extends Error {
  readonly code: SchedulingFailureCode;
  constructor(code: SchedulingFailureCode, message: string) {
    super(message);
    this.name = "SchedulingError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------------------------
// Assessment
// ---------------------------------------------------------------------------------------------

// ND-20 (Owner ruling 2026-08-27) split the conditions into two buckets, and the split is the
// product decision, not an implementation convenience:
//
//   REFUSE  blocked time, a start in the past, an ineligible technician, an overlapping window
//   WARN    outside the technician's recorded working hours, or no working hours recorded at all
//
// Working hours are a PLANNING AID, not a gate. Field service legitimately schedules emergency work
// at 02:00, and a system that refused would be refusing real business.
export type SchedulingWarningCode = "OUTSIDE_WORKING_HOURS" | "NO_WORKING_AVAILABILITY_RECORDED";

export interface SchedulingWarning {
  code: SchedulingWarningCode;
  detail: string;
}

/** What the pure model concluded about one proposed window. Refusals throw; warnings ride along. */
export interface SchedulingAssessment {
  warnings: SchedulingWarning[];
}
