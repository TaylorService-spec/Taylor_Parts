// GOAL x REPORTING PERIOD -- the composition, and deliberately nothing more.
//
// Decision #162 made the Performance Goal Authority reconcile FIN-003 rather than compete with it.
// G-05 adds the third leg without adding a fourth authority:
//
//     FIN-003 plan authority        the target's shape and the never-blend comparison
//   + the domain's actual authority  the number
//   + G-05 reporting period          WHEN
//   = a measured goal
//
// This file is the seam between the first and third. It computes NOTHING about periods itself: every
// boundary and every day count comes from `resolveReportingPeriod`, and every plan record still comes
// from `buildPlanRecord`. If this file ever grows month arithmetic, the seam has become a fourth
// authority and the reconciliation has failed.
//
// ============================ WHY A GOAL DOES NOT HAVE A "PERIOD TYPE" ============================
//
// A goal declares an effective WINDOW (effectiveFrom / effectiveTo), not a period type. That is not
// an oversight to be corrected by bolting MTD onto a goal: the two answer different questions, and
// conflating them would break the history rule Decision #162 exists to protect.
//
//   A goal's window says WHEN THIS TARGET APPLIED. It is fixed at authoring, versioned, and
//   superseded rather than edited -- September's target stays September's target.
//
//   A reporting period says WHAT SPAN WE ARE LOOKING AT NOW. It moves with `asOf`.
//
// A goal whose window was a period TYPE would silently re-scope every historical version each time
// the month rolled over, which is exactly the retroactive redefinition the versioning was built to
// prevent. So G-05's job here is to interpret the goal's OWN window in the governed reporting
// timezone, and to say how far through it we are.
//
// PURE. No Firestore, no clock -- `asOfMillis` is supplied.
import type { ReportingCalendar } from "../reportingPeriod/reportingCalendar";
import { resolveReportingPeriod, ReportingPeriodError } from "../reportingPeriod/reportingPeriod";
import type { PerformanceGoal } from "./performanceGoal";

export interface GoalPacing {
  /** Calendar days elapsed in the goal's own window at `asOf`, inclusive of the current day. */
  readonly elapsedDays: number;
  /** Calendar days in the whole window. Null when the goal is open-ended. */
  readonly totalDays: number | null;
  /** elapsed/total, capped at 1. Null when the goal is open-ended. */
  readonly fraction: number | null;
  /** True once `asOf` is past the window. A goal is measured, not paced, after it ends. */
  readonly ended: boolean;
  /** True before the window opens. Pacing a goal that has not started would divide by intent. */
  readonly notStarted: boolean;
  readonly reportingTimeZone: string;
}

/**
 * How far through its own effective window a goal is, in CALENDAR days -- G-05 §13.
 *
 * "Day 22 of 30". A metric may not silently switch this to weekdays, working days or scheduled
 * employee days; each is a different denominator needing its own governed authority, and none
 * exists. Switching would rebase every goal in the platform without anyone editing a target.
 *
 * AN OPEN-ENDED GOAL HAS NO PACING, and that is reported rather than approximated. A goal with no
 * effectiveTo has no whole to be a portion of, so `totalDays` and `fraction` are null -- a screen
 * showing "day 22 of ?" is honest, and one showing a progress bar against an unknown denominator is
 * not.
 */
export function goalPacing(goal: PerformanceGoal, calendar: ReportingCalendar, asOfMillis: number): GoalPacing {
  if (!goal || typeof goal.effectiveFrom !== "string") {
    throw new ReportingPeriodError("GOAL_REQUIRED", "a goal with an effectiveFrom is required");
  }

  // Both boundaries are resolved through the ONE day-boundary implementation, by asking the
  // resolver for the DAY containing each end. That is why this file holds no date arithmetic: the
  // reporting timezone's midnight is a decision, and it is made in exactly one place.
  const dayWindow = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    // Midday avoids any question about which local day an instant belongs to before the resolver
    // normalises it -- the resolver then snaps to that day's own local midnight.
    return resolveReportingPeriod({
      calendar,
      periodType: "DAY",
      asOfMillis: Date.UTC(y, m - 1, d, 12, 0, 0),
    }).current;
  };

  const startWindow = dayWindow(goal.effectiveFrom);
  const asOfWindow = resolveReportingPeriod({ calendar, periodType: "DAY", asOfMillis }).current;

  const notStarted = asOfWindow.startMillis < startWindow.startMillis;
  const endWindow = goal.effectiveTo ? dayWindow(goal.effectiveTo) : null;
  const ended = endWindow !== null && asOfWindow.startMillis > endWindow.startMillis;

  const MS_PER_DAY = 86_400_000;
  // Day counts are taken from local MIDNIGHT-to-MIDNIGHT instants, so a 23- or 25-hour DST day still
  // counts as one. Dividing raw elapsed milliseconds would be wrong by a day twice a year in any
  // zone that observes it -- Phoenix never would, and the next operating company might.
  const dayIndex = (millis: number) => Math.round(millis / MS_PER_DAY);

  const cappedAsOf = ended && endWindow ? endWindow.startMillis : asOfWindow.startMillis;
  const elapsedDays = notStarted ? 0 : dayIndex(cappedAsOf) - dayIndex(startWindow.startMillis) + 1;
  const totalDays = endWindow ? dayIndex(endWindow.startMillis) - dayIndex(startWindow.startMillis) + 1 : null;

  return Object.freeze({
    elapsedDays,
    totalDays,
    fraction: totalDays === null || totalDays <= 0 ? null : Math.min(1, elapsedDays / totalDays),
    ended,
    notStarted,
    reportingTimeZone: calendar.reportingTimeZone,
  });
}

/**
 * Is a business event inside a goal's effective window?
 *
 * The half-open comparison G-05 rules (`start <= eventTime < end`), applied to a goal's own window
 * and evaluated in the reporting timezone. Callers pass the GOVERNED event time for the fact --
 * `bookedAtMillis`, `eventAtMillis`, `recordedAtMillis`, `completedAt` -- never `createdAt`.
 *
 * An open-ended goal has no upper bound, which is the one place this differs from a reporting
 * period: a target with no end date genuinely applies until it is superseded or retired.
 */
export function goalWindowContains(
  goal: PerformanceGoal,
  calendar: ReportingCalendar,
  eventMillis: number,
): boolean {
  if (typeof eventMillis !== "number" || !Number.isFinite(eventMillis)) return false;

  const dayStart = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return resolveReportingPeriod({ calendar, periodType: "DAY", asOfMillis: Date.UTC(y, m - 1, d, 12, 0, 0) }).current;
  };

  if (eventMillis < dayStart(goal.effectiveFrom).startMillis) return false;
  if (goal.effectiveTo === null) return true;
  return eventMillis < dayStart(goal.effectiveTo).endExclusiveMillis;
}
