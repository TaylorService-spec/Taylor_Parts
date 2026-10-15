"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.goalPacing = goalPacing;
exports.goalWindowContains = goalWindowContains;
const reportingPeriod_1 = require("../reportingPeriod/reportingPeriod");
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
function goalPacing(goal, calendar, asOfMillis) {
    if (!goal || typeof goal.effectiveFrom !== "string") {
        throw new reportingPeriod_1.ReportingPeriodError("GOAL_REQUIRED", "a goal with an effectiveFrom is required");
    }
    // Both boundaries are resolved through the ONE day-boundary implementation, by asking the
    // resolver for the DAY containing each end. That is why this file holds no date arithmetic: the
    // reporting timezone's midnight is a decision, and it is made in exactly one place.
    const dayWindow = (iso) => {
        const [y, m, d] = iso.split("-").map(Number);
        // Midday avoids any question about which local day an instant belongs to before the resolver
        // normalises it -- the resolver then snaps to that day's own local midnight.
        return (0, reportingPeriod_1.resolveReportingPeriod)({
            calendar,
            periodType: "DAY",
            asOfMillis: Date.UTC(y, m - 1, d, 12, 0, 0),
        }).current;
    };
    const startWindow = dayWindow(goal.effectiveFrom);
    const asOfWindow = (0, reportingPeriod_1.resolveReportingPeriod)({ calendar, periodType: "DAY", asOfMillis }).current;
    const notStarted = asOfWindow.startMillis < startWindow.startMillis;
    const endWindow = goal.effectiveTo ? dayWindow(goal.effectiveTo) : null;
    const ended = endWindow !== null && asOfWindow.startMillis > endWindow.startMillis;
    const MS_PER_DAY = 86_400_000;
    // Day counts are taken from local MIDNIGHT-to-MIDNIGHT instants, so a 23- or 25-hour DST day still
    // counts as one. Dividing raw elapsed milliseconds would be wrong by a day twice a year in any
    // zone that observes it -- Phoenix never would, and the next operating company might.
    const dayIndex = (millis) => Math.round(millis / MS_PER_DAY);
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
function goalWindowContains(goal, calendar, eventMillis) {
    if (typeof eventMillis !== "number" || !Number.isFinite(eventMillis))
        return false;
    const dayStart = (iso) => {
        const [y, m, d] = iso.split("-").map(Number);
        return (0, reportingPeriod_1.resolveReportingPeriod)({ calendar, periodType: "DAY", asOfMillis: Date.UTC(y, m - 1, d, 12, 0, 0) }).current;
    };
    if (eventMillis < dayStart(goal.effectiveFrom).startMillis)
        return false;
    if (goal.effectiveTo === null)
        return true;
    return eventMillis < dayStart(goal.effectiveTo).endExclusiveMillis;
}
//# sourceMappingURL=goalReportingPeriod.js.map