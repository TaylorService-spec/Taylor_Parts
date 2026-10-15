"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.isWorkOrderOperation = exports.WORK_ORDER_READ_OPERATIONS = exports.EOS_WORK_ORDER_OPERATIONS = void 0;
// THE WORK ORDER COMMAND ROUTE'S CLOSED OPERATION TABLE (/operations/work-orders).
//
// A route names a domain, and this table is the whole of this one: every operation is a governed command or read
// from workOrder*.ts, with its capability and record relation enforced INSIDE the command. The transport resolves
// the caller, hands ONE named operation its input, and writes the result -- the Cycle Count / Placement shape.
//
// FAIL-CLOSED READINESS (DQ-S4). While WORK_ORDER_WRITER_AUTHORITY.postgres is INACTIVE every operation refuses
// NOT_ACTIVATED before it resolves anyone or reads anything -- except `readWorkOrderAuthorityStatus`, which exists
// so the client can say NOT_YET_ACTIVATED instead of guessing.
//
// EQUIPMENT INSTALL IS ON THIS ROUTE (Controller EQUIPMENT ACTIVATION AUTHORIZED, 2026-10-01; OD-5): the governed INSTALL
// Work Order is the ONLY installation workflow. workOrderEquipmentInstall.ts owns it -- equipment.install + the assigned
// Employee + an INSTALL Work Order in WORK_IN_PROGRESS, and one transaction for ledger, custody, Equipment, the Work
// Order link and the Equipment event.
const selfScheduling_1 = require("./selfScheduling");
const workOrderCreateCommand_1 = require("./workOrderCreateCommand");
const workOrderLifecycle_1 = require("./workOrderLifecycle");
const workOrderScheduling_1 = require("./workOrderScheduling");
const workOrderExecution_1 = require("./workOrderExecution");
const workOrderPartsPlanAuthority_1 = require("./workOrderPartsPlanAuthority");
const workOrderQueries_1 = require("./workOrderQueries");
const availability = __importStar(require("./workOrderAvailability"));
const labor = __importStar(require("./workOrderLabor"));
const fieldContext = __importStar(require("./workOrderFieldContext"));
const readiness = __importStar(require("./workOrderReadiness"));
const analytics = __importStar(require("./workOrderAnalytics"));
const workOrderEquipmentInstall_1 = require("./workOrderEquipmentInstall");
const refuse = (code, category, message) => {
    throw new workOrderLifecycle_1.WorkOrderLifecycleError(code, category, message);
};
function only(input, allowed) {
    const extra = Object.keys(input).filter((k) => !allowed.includes(k));
    if (extra.length > 0)
        refuse("INPUT_FIELD_NOT_ACCEPTED", "INVALID_INPUT", `this operation does not accept: ${extra.sort().join(", ")}`);
}
/** A status-only edge, bound to its named operation so a caller never states a raw target status. */
const edge = (from, to) => (deps, caller, input) => {
    only(input, from === null ? ["workOrderId", "expectedStatus", "note"] : ["workOrderId", "note"]);
    const expectedStatus = (from ?? input.expectedStatus);
    if (from === null && !workOrderLifecycle_1.WORK_ORDER_STATUSES.includes(expectedStatus)) {
        refuse("EXPECTED_STATUS_REQUIRED", "INVALID_INPUT", "state the status the Work Order is being cancelled from");
    }
    return (0, workOrderLifecycle_1.transitionWorkOrder)({ pool: deps.pool, now: deps.now }, caller.actor, { workOrderId: input.workOrderId, expectedStatus, toStatus: to, note: input.note });
};
exports.EOS_WORK_ORDER_OPERATIONS = Object.freeze({
    // ── reads ──
    readWorkOrder: (deps, caller, input) => (only(input, ["workOrderId"]),
        (0, workOrderQueries_1.readWorkOrderDetail)({ pool: deps.pool, reader: deps.reader }, caller.operational, input)),
    listWorkOrders: (deps, caller, input) => (0, workOrderQueries_1.listWorkOrders)({ pool: deps.pool }, caller.actor, input),
    listMyAssignedWorkOrders: (deps, caller, input) => (0, workOrderQueries_1.listMyAssignedWorkOrders)({ pool: deps.pool, reader: deps.reader }, caller.operational, input),
    listWorkOrderTechnicians: (deps, caller, input) => (only(input, ["workOrderId"]), (0, workOrderQueries_1.listWorkOrderTechnicians)({ pool: deps.pool }, caller.actor, input)),
    listWorkOrderOperatingCompanies: (deps, caller, input) => (only(input, []), (0, workOrderQueries_1.listWorkOrderOperatingCompanies)({ pool: deps.pool }, caller.actor)),
    // WHICH Work Order controls (and routes) the CALLER may be OFFERED (UI corrections integration, 2026-10-08) -- the
    // readMyCommercialCapabilities / readMyWorkforceCapabilities pattern for Work Orders: the caller's OWN resolved
    // capabilities (the exact set every Work Order command re-checks), narrowed to the workOrder.* keys. Discloses nothing
    // about any other Principal; grants nothing; a command still decides every write.
    readMyWorkOrderCapabilities: async (_deps, caller, input) => {
        only(input, []);
        return Object.freeze({ capabilities: Object.freeze([...caller.actor.capabilities].filter((k) => k.startsWith("workOrder.")).sort()) });
    },
    // ── create: the operating company is STATED by the caller's command context and validated as governed ──
    createWorkOrder: (deps, caller, input) => {
        const { operatingCompanyId, ...workOrder } = input;
        return (0, workOrderCreateCommand_1.createWorkOrder)({ pool: deps.pool, now: deps.now }, { ...caller.actor, operatingCompanyId: operatingCompanyId }, workOrder);
    },
    // ── the office lifecycle ──
    markWorkOrderReady: edge("CREATED", "READY_TO_DISPATCH"),
    scheduleWorkOrder: (deps, caller, input) => (0, workOrderScheduling_1.scheduleWorkOrder)({ pool: deps.pool, now: deps.now }, caller.actor, input),
    unscheduleWorkOrder: (deps, caller, input) => (0, workOrderScheduling_1.unscheduleWorkOrder)({ pool: deps.pool, now: deps.now }, caller.actor, input),
    rescheduleWorkOrder: (deps, caller, input) => (0, workOrderScheduling_1.rescheduleWorkOrder)({ pool: deps.pool, now: deps.now }, caller.actor, input),
    dispatchWorkOrder: (deps, caller, input) => (0, workOrderScheduling_1.dispatchWorkOrder)({ pool: deps.pool, now: deps.now }, caller.actor, input),
    closeWorkOrder: edge("COMPLETED", "CLOSED"),
    cancelWorkOrder: edge(null, "CANCELLED"),
    setWorkOrderPartsPlan: (deps, caller, input) => (only(input, ["workOrderId", "plan"]),
        (0, workOrderPartsPlanAuthority_1.setPartsPlan)({ pool: deps.pool, now: deps.now }, caller.actor, { workOrderId: input.workOrderId, plan: input.plan })),
    // ── the technician, on their OWN assignment ──
    acceptWorkOrder: edge("DISPATCHED", "ACCEPTED"),
    startWorkOrderTravel: edge("ACCEPTED", "EN_ROUTE"),
    arriveAtWorkOrder: edge("EN_ROUTE", "ARRIVED"),
    startWorkOrderWork: edge("ARRIVED", "WORK_IN_PROGRESS"),
    recordWorkOrderExecution: (deps, caller, input) => (0, workOrderExecution_1.recordWorkOrderExecution)({ pool: deps.pool, now: deps.now }, caller.actor, input),
    completeWorkOrder: (deps, caller, input) => (0, workOrderScheduling_1.completeWorkOrder)({ pool: deps.pool, now: deps.now }, caller.actor, input),
    // ── equipment installation on the assigned INSTALL Work Order (OD-1 / OD-2 / OD-5) ──
    listInstallableEquipmentForWorkOrder: (deps, caller, input) => (only(input, ["workOrderId", "serialNumber"]),
        (0, workOrderEquipmentInstall_1.listInstallableUnitsForWorkOrder)({ pool: deps.pool, reader: deps.reader }, caller.actor, input)),
    recordWorkOrderEquipmentInstall: (deps, caller, input) => (0, workOrderEquipmentInstall_1.recordWorkOrderEquipmentInstall)({ pool: deps.pool }, caller.actor, input),
    // ── the completion pass (2026-09-30): each implemented in its own module ──
    readTechnicianAvailability: availability.readTechnicianAvailability,
    setTechnicianWorkingHours: availability.setTechnicianWorkingHours,
    recordTechnicianUnavailability: availability.recordTechnicianUnavailability,
    endTechnicianUnavailability: availability.endTechnicianUnavailability,
    findAvailableTechnicianSlots: availability.findAvailableTechnicianSlots,
    readWorkOrderLabor: labor.readWorkOrderLabor,
    recordWorkOrderLabor: labor.recordWorkOrderLabor,
    readWorkOrderFieldContext: fieldContext.readWorkOrderFieldContext,
    readWorkOrderReadiness: readiness.readWorkOrderReadiness,
    readTechnicianExecutionStats: analytics.readTechnicianExecutionStats,
    readWorkOrderConsumptionSnapshot: analytics.readWorkOrderConsumptionSnapshot,
    readTechnicianVolumeBreakdown: analytics.readTechnicianVolumeBreakdown,
    setWorkOrderEstimatedDuration: (deps, caller, input) => (0, workOrderScheduling_1.setWorkOrderEstimatedDuration)({ pool: deps.pool, now: deps.now }, caller.actor, input),
    // ── customer self-scheduling: policy, links and their history (selfScheduling.ts; the customer route is public) ──
    saveSelfSchedulingPolicy: selfScheduling_1.SELF_SCHEDULING_WORK_ORDER_OPERATIONS.saveSelfSchedulingPolicy,
    listSelfSchedulingPolicies: selfScheduling_1.SELF_SCHEDULING_WORK_ORDER_OPERATIONS.listSelfSchedulingPolicies,
    issueSelfSchedulingLink: selfScheduling_1.SELF_SCHEDULING_WORK_ORDER_OPERATIONS.issueSelfSchedulingLink,
    revokeSelfSchedulingLink: selfScheduling_1.SELF_SCHEDULING_WORK_ORDER_OPERATIONS.revokeSelfSchedulingLink,
    readSelfSchedulingSessions: selfScheduling_1.SELF_SCHEDULING_WORK_ORDER_OPERATIONS.readSelfSchedulingSessions,
});
exports.WORK_ORDER_READ_OPERATIONS = Object.freeze([
    "readWorkOrderAuthorityStatus", "readWorkOrder", "listWorkOrders", "listMyAssignedWorkOrders", "listWorkOrderTechnicians",
    "listWorkOrderOperatingCompanies", "readMyWorkOrderCapabilities",
    "readTechnicianAvailability", "findAvailableTechnicianSlots", "readWorkOrderLabor", "readWorkOrderFieldContext",
    "readWorkOrderReadiness", "readTechnicianExecutionStats", "listInstallableEquipmentForWorkOrder", "readWorkOrderConsumptionSnapshot", "readTechnicianVolumeBreakdown",
    ...selfScheduling_1.SELF_SCHEDULING_READ_OPERATIONS,
]);
const isWorkOrderOperation = (name) => typeof name === "string"
    && (name === "readWorkOrderAuthorityStatus" || Object.prototype.hasOwnProperty.call(exports.EOS_WORK_ORDER_OPERATIONS, name));
exports.isWorkOrderOperation = isWorkOrderOperation;
//# sourceMappingURL=workOrderOperations.js.map