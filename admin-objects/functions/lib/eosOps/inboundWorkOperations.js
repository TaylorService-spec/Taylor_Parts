"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isInboundWorkOperation = exports.INBOUND_WORK_READ_OPERATIONS = exports.EOS_INBOUND_WORK_OPERATIONS = exports.INBOUND_WORK_ROUTE = void 0;
const inboundWorkIntake_1 = require("./inboundWorkIntake");
const inboundWorkDecisions_1 = require("./inboundWorkDecisions");
const inboundProviderRuntime_1 = require("./inboundProviderRuntime");
const inboundWorkRecovery_1 = require("./inboundWorkRecovery");
exports.INBOUND_WORK_ROUTE = "/operations/inbound-work";
exports.EOS_INBOUND_WORK_OPERATIONS = Object.freeze({
    // The readiness probe. executeWorkOrderOperation answers it BEFORE the table is consulted (it works while the
    // authority is INACTIVE); it is listed so the transport's closed-table check admits it on this route too.
    readWorkOrderAuthorityStatus: async () => {
        throw new Error("readWorkOrderAuthorityStatus is answered by the Work Order executor, never by this table");
    },
    // ── reads ──
    readInboundWorkAccess: async (_deps, caller, input) => ((0, inboundWorkIntake_1.only)(input, []), (0, inboundWorkDecisions_1.readInboundWorkAccess)(caller.actor)),
    listInboundWork: (deps, caller, input) => (0, inboundWorkDecisions_1.listInboundWork)({ pool: deps.pool, now: deps.now }, caller.actor, input),
    readInboundWorkRequest: (deps, caller, input) => (0, inboundWorkDecisions_1.readInboundWorkRequest)({ pool: deps.pool, now: deps.now }, caller.actor, input),
    // ── the three decisions ──
    acceptInboundWork: (deps, caller, input) => (0, inboundWorkDecisions_1.acceptInboundWork)({ pool: deps.pool, now: deps.now }, caller.actor, input),
    declineInboundWork: (deps, caller, input) => (0, inboundWorkDecisions_1.declineInboundWork)({ pool: deps.pool, now: deps.now }, caller.actor, input),
    attachInboundWork: (deps, caller, input) => (0, inboundWorkDecisions_1.attachInboundWork)({ pool: deps.pool, now: deps.now }, caller.actor, input),
    // ── intake administration (inboundWork.intake.manage) ──
    readInboundIntakeConfiguration: (deps, caller, input) => ((0, inboundWorkIntake_1.only)(input, []), (0, inboundWorkIntake_1.readInboundIntakeConfiguration)({ pool: deps.pool }, caller.actor)),
    saveInboundMailbox: (deps, caller, input) => (0, inboundWorkIntake_1.saveInboundMailbox)({ pool: deps.pool, now: deps.now }, caller.actor, input),
    saveInboundRoutingRule: (deps, caller, input) => (0, inboundWorkIntake_1.saveInboundRoutingRule)({ pool: deps.pool, now: deps.now }, caller.actor, input),
    // The non-production delivery seam (parity: deliverInboundEmailMessage). The EOS API refuses to start in production.
    deliverInboundMessage: (deps, caller, input) => (0, inboundWorkIntake_1.deliverInboundMessage)({ pool: deps.pool, now: deps.now }, caller.actor, input),
    // ── the EOS provider runtime: connections, OAuth, polling, retry, attachment custody (inboundProviderRuntime.ts) ──
    ...inboundProviderRuntime_1.INBOUND_PROVIDER_OPERATIONS,
    // ── recovery of an unfinished accept claim: RELEASE / REASSIGN (inboundWorkRecovery.ts) ──
    ...inboundWorkRecovery_1.INBOUND_RECOVERY_OPERATIONS,
});
exports.INBOUND_WORK_READ_OPERATIONS = Object.freeze([
    "readWorkOrderAuthorityStatus", "readInboundWorkAccess", "listInboundWork", "readInboundWorkRequest", "readInboundIntakeConfiguration",
    ...inboundProviderRuntime_1.INBOUND_PROVIDER_READ_OPERATIONS, ...inboundWorkRecovery_1.INBOUND_RECOVERY_READ_OPERATIONS,
]);
const isInboundWorkOperation = (name) => typeof name === "string" && Object.prototype.hasOwnProperty.call(exports.EOS_INBOUND_WORK_OPERATIONS, name);
exports.isInboundWorkOperation = isInboundWorkOperation;
//# sourceMappingURL=inboundWorkOperations.js.map