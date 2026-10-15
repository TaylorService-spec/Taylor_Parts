"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SchedulingError = exports.SCHEDULING_FAILURE_CODES = exports.BLOCKED_TIME_KINDS = exports.WEEKDAYS = exports.TECHNICIAN_BLOCKED_TIME_COLLECTION = exports.TECHNICIAN_WORKING_AVAILABILITY_COLLECTION = void 0;
exports.TECHNICIAN_WORKING_AVAILABILITY_COLLECTION = "technician_working_availability";
exports.TECHNICIAN_BLOCKED_TIME_COLLECTION = "technician_blocked_time";
exports.WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];
// Why a technician is unavailable. A closed vocabulary, because these words appear on the dispatch
// board and an open string field would become seven spellings of "vacation" within a month.
exports.BLOCKED_TIME_KINDS = [
    "PTO",
    "LUNCH",
    "TRAINING",
    "MEETING",
    "TRUCK_SERVICE",
    "UNAVAILABLE",
    "COMPANY_CLOSURE",
];
// ---------------------------------------------------------------------------------------------
// Failure taxonomy
// ---------------------------------------------------------------------------------------------
// One stable code per reason a scheduling command can refuse. Callables map these to HttpsError
// codes and a GENERIC per-code message (schedulingCallables.ts) so no internal state leaks past the
// trust boundary -- the code is what a client acts on, not the prose.
exports.SCHEDULING_FAILURE_CODES = [
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
];
class SchedulingError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = "SchedulingError";
        this.code = code;
    }
}
exports.SchedulingError = SchedulingError;
