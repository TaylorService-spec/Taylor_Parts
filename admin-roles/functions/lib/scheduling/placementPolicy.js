"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PAST_START_TOLERANCE_MS = void 0;
exports.checkPlacement = checkPlacement;
const collections_1 = require("../constants/collections");
const workOrderAvailability_1 = require("../workOrderAvailability");
const availabilityModel_1 = require("./availabilityModel");
const schedulingRepository_1 = require("./schedulingRepository");
const types_1 = require("./types");
/**
 * How far into the past a start may fall before it is refused.
 *
 * Not zero, on purpose: a dispatcher pressing Schedule for "now" loses a race against their own
 * network. Client clocks, request latency and server clocks all differ by seconds, and refusing on
 * that would refuse a correct action for a reason nobody could see.
 */
exports.PAST_START_TOLERANCE_MS = 60_000;
/**
 * Every refusal in ND-20 except the ones input validation already made, applied in one place so no
 * placement path can drift into a different idea of what a legal placement is.
 *
 * REFUSES on: a start in the past, a technician that does not exist or carries no governed status,
 * blocked time, and an overlapping Work Order.
 *
 * RETURNS the warnings that ride along with a placement that is legal but worth mentioning --
 * outside recorded working hours, or no working hours recorded at all. Warnings are returned rather
 * than thrown because ND-20 says they must not refuse: field service legitimately schedules emergency
 * work at 02:00, and a system that refused would be refusing real business. A caller that discards
 * the return value is discarding the only signal a dispatcher gets, and is wrong to.
 */
async function checkPlacement(tx, check) {
    const { technicianId, workOrderId, startMillis, endMillis, nowMillis } = check;
    if (startMillis < nowMillis - exports.PAST_START_TOLERANCE_MS) {
        throw new types_1.SchedulingError("START_IN_PAST", "A Work Order cannot be scheduled to start in the past.");
    }
    const technician = await (0, schedulingRepository_1.loadTechnician)(tx, technicianId);
    if (!technician) {
        throw new types_1.SchedulingError("TECHNICIAN_NOT_FOUND", `No technician record exists at ${technicianId}.`);
    }
    // Eligibility, as far as this repository can honestly assert it today: a governed technician record
    // whose status is one the platform recognises. There is no skill, certification or territory model
    // to check against -- inventing one here would be inventing business policy, so this refuses only
    // what it can actually see is wrong. When a real eligibility authority exists, it belongs on this
    // line and nowhere else -- and now that both placement paths run through here, "this line" is a
    // single line rather than one per entry point.
    if (!schedulingRepository_1.GOVERNED_TECHNICIAN_STATUSES.has(technician.status)) {
        throw new types_1.SchedulingError("TECHNICIAN_INELIGIBLE", `Technician ${technicianId} has no governed status and cannot be scheduled.`);
    }
    const blocks = await (0, schedulingRepository_1.loadBlockedTime)(tx, technicianId, startMillis);
    const blocked = (0, availabilityModel_1.findBlockedTimeConflict)(blocks, startMillis, endMillis);
    if (blocked) {
        throw new types_1.SchedulingError("BLOCKED_TIME_CONFLICT", `Technician ${technicianId} has ${blocked.kind} blocked time overlapping that window.`);
    }
    // The same query and the same pure overlap function the Schedule transition used inline before
    // ND-24 -- which is why moving Schedule onto this function changed its overlap behavior not at all,
    // and changed everything above.
    const otherSnap = await tx.get((0, schedulingRepository_1.db)().collection(collections_1.WORK_ORDERS_COLLECTION).where("scheduledTechId", "==", technicianId));
    const others = otherSnap.docs.map((d) => {
        const data = d.data();
        return {
            id: d.id,
            scheduledTechId: data.scheduledTechId,
            scheduledStart: data.scheduledStart,
            scheduledEnd: data.scheduledEnd,
            status: data.status,
        };
    });
    const conflict = (0, workOrderAvailability_1.findScheduleConflict)(technicianId, workOrderId, startMillis, endMillis, others);
    if (conflict) {
        throw new types_1.SchedulingError("SCHEDULE_CONFLICT", `Technician ${technicianId} is already scheduled for overlapping Work Order ${conflict}.`);
    }
    const availability = await (0, schedulingRepository_1.loadWorkingAvailability)(tx, technicianId);
    return (0, availabilityModel_1.assessWorkingHours)(availability, startMillis, endMillis).warnings;
}
//# sourceMappingURL=placementPolicy.js.map