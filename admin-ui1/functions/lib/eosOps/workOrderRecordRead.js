"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkOrderReadError = exports.WORK_ORDER_RECORD_READ = void 0;
exports.authorizeWorkOrderRecordRead = authorizeWorkOrderRecordRead;
exports.readWorkOrderTransitionHistoryGoverned = readWorkOrderTransitionHistoryGoverned;
exports.readWorkOrderPartsPlanGoverned = readWorkOrderPartsPlanGoverned;
const entitledActionAuthority_1 = require("./entitledActionAuthority");
const workOrderLifecycle_1 = require("./workOrderLifecycle");
const workOrderPartsPlanAuthority_1 = require("./workOrderPartsPlanAuthority");
exports.WORK_ORDER_RECORD_READ = "workOrder.record.read";
class WorkOrderReadError extends Error {
    code;
    category;
    constructor(code, category, message) {
        super(message);
        this.code = code;
        this.category = category;
        this.name = "WorkOrderReadError";
    }
}
exports.WorkOrderReadError = WorkOrderReadError;
const ID_SHAPE = (v) => typeof v === "string" && v !== "" && v.trim() === v && v.length <= 200 && !v.includes("/");
/**
 * Decide whether this actor may read THIS Work Order. Returns the evaluator's decision unchanged; never
 * widens it. A missing record id refuses before the evaluator is consulted.
 */
async function authorizeWorkOrderRecordRead(reader, actor, workOrderId) {
    if (!ID_SHAPE(workOrderId)) {
        throw new WorkOrderReadError("WORK_ORDER_ID_REQUIRED", "INVALID_INPUT", "a Work Order read names ONE Work Order; there is no tenant-wide read through this gate");
    }
    if (!actor || typeof actor.entitlements !== "function") {
        throw new WorkOrderReadError("ACTOR_CONTEXT_REQUIRED", "FORBIDDEN", "a resolved actor with its entitlements is required; a flat capability set is not a substitute");
    }
    return (0, entitledActionAuthority_1.authorizeOperationalAction)(reader, actor, { capabilityKey: exports.WORK_ORDER_RECORD_READ, recordId: workOrderId });
}
async function requireRead(reader, actor, workOrderId) {
    const decision = await authorizeWorkOrderRecordRead(reader, actor, workOrderId);
    if (!decision.allowed) {
        // The OUTCOME is the refusal code (CAPABILITY_MISSING, NOT_ASSIGNED, EMPLOYEE_LINK_REQUIRED, ...): one
        // generic FORBIDDEN would hide which authority refused. A real id and a guessed one refuse identically.
        throw new WorkOrderReadError(String(decision.outcome), "FORBIDDEN", "this Work Order may not be read by this caller");
    }
}
/** A Work Order's transition history, oldest first -- only after the governed read decision allows it. */
async function readWorkOrderTransitionHistoryGoverned(deps, actor, workOrderId) {
    await requireRead(deps.reader, actor, workOrderId);
    return (0, workOrderLifecycle_1.readTransitionHistory)(deps.db, actor.tenantId, workOrderId);
}
/** A Work Order's current parts plan -- only after the governed read decision allows it. */
async function readWorkOrderPartsPlanGoverned(deps, actor, workOrderId) {
    await requireRead(deps.reader, actor, workOrderId);
    return (0, workOrderPartsPlanAuthority_1.readPartsPlan)(deps.db, actor.tenantId, workOrderId);
}
//# sourceMappingURL=workOrderRecordRead.js.map