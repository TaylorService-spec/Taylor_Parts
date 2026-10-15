"use strict";
// Technician double-booking guard (Work Order Engine). Dispatch assigns a technician to a Work Order; without
// this guard `transitionWorkOrder` would set `assignedTechId` unconditionally, so the SAME technician could be
// dispatched to two Work Orders at once — a double-booking the dispatch/availability model (TECH_STATUS,
// getTechnicianAvailability, dispatch scoring) treats as invalid. Pure so it is unit-testable without Firestore.
Object.defineProperty(exports, "__esModule", { value: true });
exports.OCCUPYING_STATUSES = void 0;
exports.isOccupyingStatus = isOccupyingStatus;
exports.findDoubleBookingConflict = findDoubleBookingConflict;
exports.findScheduleConflict = findScheduleConflict;
// Statuses in which a dispatched technician is actively occupied by a Work Order. Assigning them to another one
// while in any of these is a double-booking. Pre-dispatch statuses carry no assignedTechId; terminal statuses
// (COMPLETED / CLOSED / CANCELLED) free the technician.
exports.OCCUPYING_STATUSES = new Set([
    "DISPATCHED",
    "ACCEPTED",
    "EN_ROUTE",
    "ARRIVED",
    "WORK_IN_PROGRESS",
]);
function isOccupyingStatus(status) {
    return exports.OCCUPYING_STATUSES.has(status);
}
/**
 * Return the id of a Work Order that would be double-booked by dispatching `assignedTechId` to `workOrderId`, or
 * null if the technician is free. `others` are the technician's other Work Orders (typically fetched by
 * `assignedTechId`); the current Work Order is excluded (re-dispatching the same one is not a conflict), as are
 * assignments to a different technician and any Work Order in a non-occupying (pre-dispatch/terminal) status.
 */
function findDoubleBookingConflict(assignedTechId, workOrderId, others) {
    for (const wo of others) {
        if (!wo || wo.id === workOrderId)
            continue; // re-dispatch of the same WO is fine
        if (wo.assignedTechId !== assignedTechId)
            continue; // a different technician
        if (isOccupyingStatus(wo.status))
            return wo.id; // already occupied → double-booking
    }
    return null;
}
const scheduleMillis = (value) => {
    if (typeof value === "number")
        return value;
    const millis = value?.toMillis?.();
    return typeof millis === "number" ? millis : null;
};
const blocksSchedule = (status) => status !== "CREATED" && status !== "READY_TO_DISPATCH" && status !== "COMPLETED" && status !== "CLOSED" && status !== "CANCELLED";
function findScheduleConflict(scheduledTechId, workOrderId, scheduledStart, scheduledEnd, others) {
    for (const wo of others) {
        if (!wo || wo.id === workOrderId || wo.scheduledTechId !== scheduledTechId || !blocksSchedule(wo.status))
            continue;
        const otherStart = scheduleMillis(wo.scheduledStart);
        const otherEnd = scheduleMillis(wo.scheduledEnd);
        if (otherStart === null || otherEnd === null)
            continue;
        if (scheduledStart < otherEnd && otherStart < scheduledEnd)
            return wo.id;
    }
    return null;
}
