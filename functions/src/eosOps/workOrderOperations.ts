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
// NOT ON THIS ROUTE, deliberately: Equipment INSTALL. It moves a serialized unit's custody into EQUIPMENT, which is
// the Equipment activation -- a separate package not yet authorized (the Work Order and Inventory activations did
// not include it). The built module (workOrderEquipmentInstall.ts) stays inert; the Equipment on a Work Order is READ
// through readWorkOrder.
import { SELF_SCHEDULING_READ_OPERATIONS, SELF_SCHEDULING_WORK_ORDER_OPERATIONS } from "./selfScheduling";
import { createWorkOrder } from "./workOrderCreateCommand";
import {
  transitionWorkOrder, WorkOrderLifecycleError, WORK_ORDER_STATUSES, type LifecycleActor, type WorkOrderStatus,
} from "./workOrderLifecycle";
import {
  scheduleWorkOrder, unscheduleWorkOrder, rescheduleWorkOrder, dispatchWorkOrder, completeWorkOrder, setWorkOrderEstimatedDuration,
} from "./workOrderScheduling";
import { recordWorkOrderExecution } from "./workOrderExecution";
import { setPartsPlan } from "./workOrderPartsPlanAuthority";
import { readWorkOrderDetail, listWorkOrders, listMyAssignedWorkOrders, listWorkOrderTechnicians, listWorkOrderOperatingCompanies } from "./workOrderQueries";
import type { WorkOrderOp as Op } from "./workOrderOperationTypes";
import * as availability from "./workOrderAvailability";
import * as labor from "./workOrderLabor";
import * as fieldContext from "./workOrderFieldContext";
import * as readiness from "./workOrderReadiness";
import * as analytics from "./workOrderAnalytics";
export type { WorkOrderOperationDeps, WorkOrderCaller } from "./workOrderOperationTypes";

const refuse = (code: string, category: WorkOrderLifecycleError["category"], message: string): never => {
  throw new WorkOrderLifecycleError(code, category, message);
};

function only(input: Record<string, unknown>, allowed: readonly string[]): void {
  const extra = Object.keys(input).filter((k) => !allowed.includes(k));
  if (extra.length > 0) refuse("INPUT_FIELD_NOT_ACCEPTED", "INVALID_INPUT", `this operation does not accept: ${extra.sort().join(", ")}`);
}

/** A status-only edge, bound to its named operation so a caller never states a raw target status. */
const edge = (from: WorkOrderStatus | null, to: WorkOrderStatus): Op => (deps, caller, input) => {
  only(input, from === null ? ["workOrderId", "expectedStatus", "note"] : ["workOrderId", "note"]);
  const expectedStatus = (from ?? input.expectedStatus) as WorkOrderStatus;
  if (from === null && !(WORK_ORDER_STATUSES as readonly string[]).includes(expectedStatus)) {
    refuse("EXPECTED_STATUS_REQUIRED", "INVALID_INPUT", "state the status the Work Order is being cancelled from");
  }
  return transitionWorkOrder({ pool: deps.pool, now: deps.now }, caller.actor,
    { workOrderId: input.workOrderId as string, expectedStatus, toStatus: to, note: input.note as string | undefined });
};

export const EOS_WORK_ORDER_OPERATIONS = Object.freeze({
  // ── reads ──
  readWorkOrder: (deps, caller, input) => (only(input, ["workOrderId"]),
    readWorkOrderDetail({ pool: deps.pool, reader: deps.reader }, caller.operational, input)),
  listWorkOrders: (deps, caller, input) => listWorkOrders({ pool: deps.pool }, caller.actor, input),
  listMyAssignedWorkOrders: (deps, caller, input) => listMyAssignedWorkOrders({ pool: deps.pool, reader: deps.reader }, caller.operational, input),
  listWorkOrderTechnicians: (deps, caller, input) => (only(input, ["workOrderId"]), listWorkOrderTechnicians({ pool: deps.pool }, caller.actor, input)),
  listWorkOrderOperatingCompanies: (deps, caller, input) => (only(input, []), listWorkOrderOperatingCompanies({ pool: deps.pool }, caller.actor)),

  // ── create: the operating company is STATED by the caller's command context and validated as governed ──
  createWorkOrder: (deps, caller, input) => {
    const { operatingCompanyId, ...workOrder } = input;
    return createWorkOrder({ pool: deps.pool, now: deps.now },
      { ...caller.actor, operatingCompanyId: operatingCompanyId as string }, workOrder as never);
  },

  // ── the office lifecycle ──
  markWorkOrderReady: edge("CREATED", "READY_TO_DISPATCH"),
  scheduleWorkOrder: (deps, caller, input) => scheduleWorkOrder({ pool: deps.pool, now: deps.now }, caller.actor, input),
  unscheduleWorkOrder: (deps, caller, input) => unscheduleWorkOrder({ pool: deps.pool, now: deps.now }, caller.actor, input),
  rescheduleWorkOrder: (deps, caller, input) => rescheduleWorkOrder({ pool: deps.pool, now: deps.now }, caller.actor, input),
  dispatchWorkOrder: (deps, caller, input) => dispatchWorkOrder({ pool: deps.pool, now: deps.now }, caller.actor, input),
  closeWorkOrder: edge("COMPLETED", "CLOSED"),
  cancelWorkOrder: edge(null, "CANCELLED"),
  setWorkOrderPartsPlan: (deps, caller, input) => (only(input, ["workOrderId", "plan"]),
    setPartsPlan({ pool: deps.pool, now: deps.now }, caller.actor, { workOrderId: input.workOrderId as string, plan: input.plan })),

  // ── the technician, on their OWN assignment ──
  acceptWorkOrder: edge("DISPATCHED", "ACCEPTED"),
  startWorkOrderTravel: edge("ACCEPTED", "EN_ROUTE"),
  arriveAtWorkOrder: edge("EN_ROUTE", "ARRIVED"),
  startWorkOrderWork: edge("ARRIVED", "WORK_IN_PROGRESS"),
  recordWorkOrderExecution: (deps, caller, input) => recordWorkOrderExecution({ pool: deps.pool, now: deps.now }, caller.actor, input),
  completeWorkOrder: (deps, caller, input) => completeWorkOrder({ pool: deps.pool, now: deps.now }, caller.actor, input),

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
  setWorkOrderEstimatedDuration: (deps, caller, input) => setWorkOrderEstimatedDuration({ pool: deps.pool, now: deps.now }, caller.actor, input),

  // ── customer self-scheduling: policy, links and their history (selfScheduling.ts; the customer route is public) ──
  saveSelfSchedulingPolicy: SELF_SCHEDULING_WORK_ORDER_OPERATIONS.saveSelfSchedulingPolicy,
  listSelfSchedulingPolicies: SELF_SCHEDULING_WORK_ORDER_OPERATIONS.listSelfSchedulingPolicies,
  issueSelfSchedulingLink: SELF_SCHEDULING_WORK_ORDER_OPERATIONS.issueSelfSchedulingLink,
  revokeSelfSchedulingLink: SELF_SCHEDULING_WORK_ORDER_OPERATIONS.revokeSelfSchedulingLink,
  readSelfSchedulingSessions: SELF_SCHEDULING_WORK_ORDER_OPERATIONS.readSelfSchedulingSessions,
} satisfies Record<string, Op>);

export type EosWorkOrderOperation = keyof typeof EOS_WORK_ORDER_OPERATIONS | "readWorkOrderAuthorityStatus";

export const WORK_ORDER_READ_OPERATIONS: readonly string[] = Object.freeze([
  "readWorkOrderAuthorityStatus", "readWorkOrder", "listWorkOrders", "listMyAssignedWorkOrders", "listWorkOrderTechnicians",
  "listWorkOrderOperatingCompanies",
  "readTechnicianAvailability", "findAvailableTechnicianSlots", "readWorkOrderLabor", "readWorkOrderFieldContext",
  "readWorkOrderReadiness", "readTechnicianExecutionStats", "readWorkOrderConsumptionSnapshot", "readTechnicianVolumeBreakdown",
  ...SELF_SCHEDULING_READ_OPERATIONS,
]);

export const isWorkOrderOperation = (name: unknown): name is EosWorkOrderOperation =>
  typeof name === "string"
  && (name === "readWorkOrderAuthorityStatus" || Object.prototype.hasOwnProperty.call(EOS_WORK_ORDER_OPERATIONS, name));
