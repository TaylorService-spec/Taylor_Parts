"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readTechnicianAvailability = readTechnicianAvailability;
// Dispatch & Scheduler -- the trusted READ path for technician availability.
//
// WHY THIS EXISTS. Both availability collections deny client reads as well as client writes (Owner
// ruling 2026-08-27, matching the sales_orders / opportunities posture). So the Dispatch board cannot
// query them, and without a read service the lane shading, blocked-time blocks and capacity figures
// the North Star draws would have nothing behind them.
//
// It is READ-ONLY. It writes nothing, audits nothing, and refuses nothing except an unauthorized
// caller -- there is no state to protect here beyond who may look.
//
// The capacity numbers it returns come from the SAME pure functions the scheduling commands validate
// against (availabilityModel.ts). That is deliberate and it is the point: a board fed by a different
// calculation than the one the server enforces is a board that lies, slowly, in ways nobody notices
// until a dispatcher trusts it.
const callerContext_1 = require("../callerContext");
const availabilityModel_1 = require("./availabilityModel");
const schedulingRepository_1 = require("./schedulingRepository");
const types_1 = require("./types");
const validation_1 = require("./validation");
// A board asks for a day, a week or a fortnight of technicians. Past this the caller is not drawing a
// board, and a query fanning out over hundreds of technicians belongs in a report.
const MAX_TECHNICIANS = 200;
/**
 * Availability for the named technicians over one window, or for every technician when none are
 * named (what the Dispatch board asks for).
 */
async function readTechnicianAvailability(actorUid, raw) {
    const caller = await (0, callerContext_1.getCallerContext)(actorUid);
    if (caller.role !== "admin" && caller.role !== "dispatcher") {
        throw new types_1.SchedulingError("PERMISSION_DENIED", "Only an admin or dispatcher may read technician availability.");
    }
    const data = (raw ?? {});
    const window = (0, validation_1.parseScheduleWindow)({ scheduledStart: data.startMillis, scheduledEnd: data.endMillis });
    if (!window.valid) {
        throw new types_1.SchedulingError("INVALID_INPUT", "startMillis and endMillis must be a valid, bounded window.");
    }
    const { startMillis, endMillis } = window.value;
    let technicianIds;
    if (Array.isArray(data.technicianIds)) {
        technicianIds = data.technicianIds.filter((id) => typeof id === "string" && id.trim().length > 0);
    }
    else {
        const snap = await (0, schedulingRepository_1.db)().collection(schedulingRepository_1.TECHNICIANS_COLLECTION).limit(MAX_TECHNICIANS).get();
        technicianIds = snap.docs.map((d) => d.id);
    }
    if (technicianIds.length > MAX_TECHNICIANS) {
        throw new types_1.SchedulingError("INVALID_INPUT", `At most ${MAX_TECHNICIANS} technicians may be read at once.`);
    }
    const technicians = await Promise.all(technicianIds.map(async (technicianId) => {
        const [availabilitySnap, blockedSnap] = await Promise.all([
            (0, schedulingRepository_1.db)().collection(types_1.TECHNICIAN_WORKING_AVAILABILITY_COLLECTION).doc(technicianId).get(),
            (0, schedulingRepository_1.db)()
                .collection(types_1.TECHNICIAN_BLOCKED_TIME_COLLECTION)
                .where("technicianId", "==", technicianId)
                .where("endMillis", ">", startMillis)
                .get(),
        ]);
        const workingAvailability = availabilitySnap.exists
            ? availabilitySnap.data()
            : null;
        // The same half-open overlap the commands enforce, applied here so a block the board draws is
        // exactly a block the server would refuse a placement into.
        const blockedTime = blockedSnap.docs
            .map((d) => ({ ...d.data(), blockId: d.id }))
            .filter((b) => b.startMillis < endMillis);
        const available = (0, availabilityModel_1.availableMinutesInWindow)(workingAvailability, { startMillis, endMillis });
        const blocked = (0, availabilityModel_1.blockedMinutesInWindow)(workingAvailability, blockedTime, { startMillis, endMillis });
        const availableMinutes = available === null || blocked === null ? null : Math.max(0, available - blocked);
        return { technicianId, workingAvailability, blockedTime, availableMinutes };
    }));
    return { startMillis, endMillis, technicians };
}
