// THE GOVERNED WORK ORDER COMMAND EDGES: Schedule, Unschedule, Reschedule, Dispatch, Complete.
//
// Each of these asserts a FACT besides the status -- a window, an assignee, a stated reason, the absence of a
// competing job, the Sales Order prerequisite -- so each is a command that establishes the fact and moves the
// status in ONE transaction. The status itself is written only by workOrderLifecycle.ts's
// applyTransitionWithinTransaction; this module never writes `status`, and a test pins that.
//
// ════════════════════ WHAT IS PRESERVED FROM THE FIREBASE PROCESS ════════════════════
//
//   Schedule    start/end, end > start, window <= 14 days (scheduling/validation.ts), START_IN_PAST with the
//               60-second tolerance (placementPolicy.ts), technician eligibility, SCHEDULE_CONFLICT (overlap
//               with the technician's other placed jobs).
//   Unschedule  ND-18: a stated reason, the technician and window given up recorded (the ENDED assignment
//               interval + the schedule history row), the placement CLEARED.
//   Reschedule  a stated reason, the stale check on the window being moved, the same placement rules.
//   Dispatch    H20: a reason when the job goes to someone other than the scheduled technician; DQ-014: the
//               dispatched technician is re-checked (eligibility; the overlap re-run against THEIR calendar);
//               the double-booking guard over the occupying statuses (workOrderAvailability.ts).
//   Complete    own assignment (RECORD_ASSIGNMENT, via the lifecycle authorization); DQ-015 below.
//
// ════════════════════ TECHNICIAN AVAILABILITY (DECISION 5, 2026-09-30) ════════════════════
//
// Schedule, Reschedule and Dispatch each call workOrderAvailability.checkTechnicianAvailability inside their
// transaction, after eligibility: it REFUSES AVAILABILITY_NOT_CONFIGURED / TECHNICIAN_UNAVAILABLE /
// OUTSIDE_WORKING_HOURS (superseding the Firebase ND-20 warnings) and returns the warnings a successful placement
// carries -- none today, so `warnings` is an empty list rather than a claim the calendar was not consulted.
//
// Inventory: see workOrderLifecycle.ts -- DISPATCHED reserves nothing and COMPLETED consumes nothing here; the
// edge's `inventoryBoundary` is returned with the result.
import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import type { ContextualReader } from "./contextualAuthorization";
import {
  applyTransitionWithinTransaction, authorizeEdgeOrRefuse, WorkOrderLifecycleError,
  WORK_ORDER_LIFECYCLE_SCHEDULE, type LifecycleActor, type TransitionResult,
} from "./workOrderLifecycle";
import {
  assertEmployeeAssignable, assignWithinTransaction, type WorkOrderAssignmentResult,
} from "./workOrderAssignmentAuthority";
import { checkTechnicianAvailability } from "./workOrderAvailability";
import { CommercialFulfillmentError, recordWorkOrderFulfillmentOn, type WorkOrderFulfillmentOutcome } from "../eosCommercial/fulfillment/salesOrderFulfillmentAuthority";
import { prepareBillingPackageOn, type BillingPackageOutcome } from "../eosFinance/billingPackage";
import { FinanceFoundationError } from "../eosFinance/financeFoundation";
import { isQuarantined, notQuarantined, WORK_ORDER_QUARANTINED, WORK_ORDER_QUARANTINED_MESSAGE } from "./workOrderQuarantine";

const SCHEMA = "eos_ops";

/** scheduling/validation.ts MAX_WINDOW_MINUTES: two weeks. */
export const MAX_SCHEDULE_WINDOW_MS = 14 * 24 * 60 * 60_000;
/** scheduling/placementPolicy.ts PAST_START_TOLERANCE_MS. */
export const PAST_START_TOLERANCE_MS = 60_000;
export const MAX_REASON_LENGTH = 500;

/** workOrderAvailability.ts OCCUPYING_STATUSES: a technician in one of these is on a job. */
export const OCCUPYING_STATUSES = Object.freeze(["DISPATCHED", "ACCEPTED", "EN_ROUTE", "ARRIVED", "WORK_IN_PROGRESS"] as const);
/** workOrderAvailability.ts blocksSchedule: a placed, not-yet-finished job holds its window. */
export const WINDOW_HOLDING_STATUSES = Object.freeze(["SCHEDULED", ...OCCUPYING_STATUSES] as const);


type Category = WorkOrderLifecycleError["category"];
const refuse = (code: string, category: Category, message: string): never => {
  throw new WorkOrderLifecycleError(code, category, message);
};

const ID_SHAPE = (v: unknown): v is string =>
  typeof v === "string" && v !== "" && v.trim() === v && v.length <= 200 && !v.includes("/");

export interface SchedulingDeps {
  readonly pool: Pool;
  readonly now?: () => Date;
  readonly contextualReader?: ContextualReader;
}

export interface PlacementWarning { readonly code: string; readonly message: string }

export interface ScheduleResult {
  readonly transition: TransitionResult;
  readonly assignment: WorkOrderAssignmentResult;
  readonly scheduledStart: string;
  readonly scheduledEnd: string;
  readonly warnings: readonly PlacementWarning[];
}

function acceptOnly(input: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) refuse("INPUT_INVALID", "INVALID_INPUT", "input must be an object");
  const extra = Object.keys(input as object).filter((k) => !allowed.includes(k));
  if (extra.length > 0) {
    refuse("INPUT_FIELD_NOT_ACCEPTED", "INVALID_INPUT", `this command does not accept: ${extra.sort().join(", ")}`);
  }
  return input as Record<string, unknown>;
}

/** An instant stated as epoch milliseconds or an ISO-8601 string with a zone. Never a local wall-clock time. */
export function parseInstant(value: unknown, field: string): Date {
  let ms: number;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) ms = value;
  else if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/.test(value)) ms = Date.parse(value);
  else ms = Number.NaN;
  if (!Number.isFinite(ms)) {
    refuse("SCHEDULE_TIME_INVALID", "INVALID_INPUT", `${field} must be epoch milliseconds or an ISO-8601 instant with a zone`);
  }
  return new Date(ms);
}

function validateWindow(startValue: unknown, endValue: unknown, now: Date): { start: Date; end: Date } {
  const start = parseInstant(startValue, "scheduledStart");
  const end = parseInstant(endValue, "scheduledEnd");
  if (end.getTime() <= start.getTime()) refuse("SCHEDULE_END_NOT_AFTER_START", "INVALID_INPUT", "scheduledEnd must be after scheduledStart");
  if (end.getTime() - start.getTime() > MAX_SCHEDULE_WINDOW_MS) {
    refuse("SCHEDULE_WINDOW_TOO_LONG", "INVALID_INPUT", "a scheduled window is at most 14 days");
  }
  if (start.getTime() < now.getTime() - PAST_START_TOLERANCE_MS) {
    refuse("START_IN_PAST", "PRECONDITION_FAILED", "a Work Order cannot be scheduled to start in the past");
  }
  return { start, end };
}

function requireReason(value: unknown, code = "REASON_REQUIRED"): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > MAX_REASON_LENGTH) {
    refuse(code, "INVALID_INPUT", `a stated reason (at most ${MAX_REASON_LENGTH} characters) is required`);
  }
  return (value as string).trim();
}

/**
 * Serialize every placement decision for ONE Employee. The overlap and double-booking reads are only true if no
 * other transaction can place the same person between the read and the commit -- the Firebase process used a
 * per-technician lock document for exactly this. A transaction-scoped advisory lock is released at COMMIT or
 * ROLLBACK and cannot leak.
 */
async function lockEmployeePlacement(client: PoolClient, tenantId: string, employeeId: string): Promise<void> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`wo-placement:${tenantId}:${employeeId}`]);
}

/** The first other Work Order whose held window overlaps [start, end) for this Employee, or null. */
async function findScheduleConflict(
  client: PoolClient, tenantId: string, employeeId: string, workOrderId: string, start: Date, end: Date,
): Promise<string | null> {
  const { rows } = await client.query(
    `SELECT w.id FROM ${SCHEMA}.work_orders w
       JOIN ${SCHEMA}.work_order_assignments a
         ON a.tenant_id = w.tenant_id AND a.work_order_id = w.id AND a.effective_to IS NULL
      WHERE w.tenant_id = $1 AND a.assignee_employee_id = $2 AND w.id <> $3 AND ${notQuarantined("w")}
        AND w.status::text = ANY($4::text[])
        AND w.scheduled_start IS NOT NULL AND w.scheduled_start < $6 AND $5 < w.scheduled_end
      ORDER BY w.id LIMIT 1`,
    [tenantId, employeeId, workOrderId, [...WINDOW_HOLDING_STATUSES], start, end]);
  return rows[0]?.id ?? null;
}

/** The first other Work Order this Employee is actively on (an occupying status), or null. */
async function findDoubleBooking(client: PoolClient, tenantId: string, employeeId: string, workOrderId: string): Promise<string | null> {
  const { rows } = await client.query(
    `SELECT w.id FROM ${SCHEMA}.work_orders w
       JOIN ${SCHEMA}.work_order_assignments a
         ON a.tenant_id = w.tenant_id AND a.work_order_id = w.id AND a.effective_to IS NULL
      WHERE w.tenant_id = $1 AND a.assignee_employee_id = $2 AND w.id <> $3 AND ${notQuarantined("w")}
        AND w.status::text = ANY($4::text[])
      ORDER BY w.id LIMIT 1`,
    [tenantId, employeeId, workOrderId, [...OCCUPYING_STATUSES]]);
  return rows[0]?.id ?? null;
}

interface LockedWorkOrder {
  readonly status: string;
  readonly operatingCompanyKey: string;
  readonly scheduledStart: Date | null;
  readonly scheduledEnd: Date | null;
  readonly salesOrderId: string | null;
  readonly currentAssignee: { readonly id: string; readonly employeeId: string } | null;
}

async function lockWorkOrder(client: PoolClient, tenantId: string, workOrderId: string, expectedStatus: string): Promise<LockedWorkOrder> {
  const { rows } = await client.query(
    `SELECT status::text AS status, operating_company_key, scheduled_start, scheduled_end, sales_order_id
       FROM ${SCHEMA}.work_orders WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
    [tenantId, workOrderId]);
  if (rows.length === 0) refuse("WORK_ORDER_NOT_FOUND", "NOT_FOUND", `no work order ${workOrderId} in this tenant`);
  if (await isQuarantined(client, tenantId, workOrderId)) refuse(WORK_ORDER_QUARANTINED, "PRECONDITION_FAILED", WORK_ORDER_QUARANTINED_MESSAGE);
  if (rows[0].status !== expectedStatus) {
    refuse("STALE_WORK_ORDER_STATE", "CONFLICT", `the work order is ${rows[0].status}, not ${expectedStatus}. Another transition won this race.`);
  }
  const current = await client.query(
    `SELECT id, assignee_employee_id FROM ${SCHEMA}.work_order_assignments
      WHERE tenant_id = $1 AND work_order_id = $2 AND effective_to IS NULL`,
    [tenantId, workOrderId]);
  return {
    status: rows[0].status,
    operatingCompanyKey: rows[0].operating_company_key,
    scheduledStart: rows[0].scheduled_start ? new Date(rows[0].scheduled_start) : null,
    scheduledEnd: rows[0].scheduled_end ? new Date(rows[0].scheduled_end) : null,
    salesOrderId: rows[0].sales_order_id ?? null,
    currentAssignee: current.rows[0] ? { id: current.rows[0].id, employeeId: current.rows[0].assignee_employee_id } : null,
  };
}

async function recordScheduleHistory(
  client: PoolClient, actor: LifecycleActor, workOrderId: string,
  previous: { start: Date | null; end: Date | null }, next: { start: Date | null; end: Date | null },
  reason: string | null, at: Date,
): Promise<void> {
  await client.query(
    `INSERT INTO ${SCHEMA}.work_order_schedule_history
       (id, tenant_id, work_order_id, previous_start, previous_end, new_start, new_end, reason,
        changed_by_principal_id, changed_at, provenance)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'NATIVE')`,
    [`wosh_${randomUUID()}`, actor.tenantId, workOrderId, previous.start, previous.end, next.start, next.end, reason,
     actor.principalId, at]);
}

async function inTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => { /* the original error is the one that matters */ });
    if ((err as { code?: string })?.code === "23505") {
      refuse("WORK_ORDER_CONCURRENT_CHANGE", "CONFLICT", "the Work Order changed concurrently; retry");
    }
    throw err;
  } finally {
    client.release();
  }
}

// ════════════════════ Schedule ════════════════════

/**
 * READY_TO_DISPATCH -> SCHEDULED: place the job in a window and assign it to an eligible Employee.
 *
 * The assignee is an EMPLOYEE (DQ-013: eligible for the Work Order's operating company), and assignment happens
 * under workOrder.lifecycle.schedule -- the capability Firebase's Schedule set scheduledTechId under. It is
 * the SAME assignment rule set as every other assignment (assignWithinTransaction), never a weaker copy.
 */
export async function scheduleWorkOrder(deps: SchedulingDeps, actor: LifecycleActor, input: unknown): Promise<ScheduleResult> {
  const i = acceptOnly(input, ["workOrderId", "employeeId", "scheduledStart", "scheduledEnd", "reason", "note"]);
  if (!ID_SHAPE(i.employeeId)) refuse("EMPLOYEE_ID_REQUIRED", "INVALID_INPUT", "employeeId is required and must be a governed Employee id");
  const edge = { workOrderId: i.workOrderId as string, expectedStatus: "READY_TO_DISPATCH" as const, toStatus: "SCHEDULED" as const,
    note: i.note as string | undefined };
  await authorizeEdgeOrRefuse(deps, actor, edge);
  const now = (deps.now ?? (() => new Date()))();
  const window = validateWindow(i.scheduledStart, i.scheduledEnd, now);
  const employeeId = i.employeeId as string;

  return inTransaction(deps.pool, async (client) => {
    const wo = await lockWorkOrder(client, actor.tenantId, edge.workOrderId, edge.expectedStatus);
    // A job already carrying a DIFFERENT open assignee is being re-pointed, and a re-pointing states why.
    const repoints = wo.currentAssignee !== null && wo.currentAssignee.employeeId !== employeeId;
    const reason = repoints ? requireReason(i.reason, "REASSIGN_REASON_REQUIRED") : null;
    await lockEmployeePlacement(client, actor.tenantId, employeeId);
    const conflict = await findScheduleConflict(client, actor.tenantId, employeeId, edge.workOrderId, window.start, window.end);
    if (conflict) refuse("SCHEDULE_CONFLICT", "PRECONDITION_FAILED", `the Employee is already scheduled for overlapping Work Order ${conflict}`);
    const assignment = await assignWithinTransaction(client, actor,
      { workOrderId: edge.workOrderId, employeeId, source: repoints ? "REASSIGN_SCHEDULED" : "SCHEDULE", reason }, now);
    const warnings = await checkTechnicianAvailability(client,
      { tenantId: actor.tenantId, employeeId, operatingCompanyKey: wo.operatingCompanyKey, start: window.start, end: window.end });
    const transition = await applyTransitionWithinTransaction(client, actor,
      { ...edge, placement: { start: window.start, end: window.end } }, now);
    await recordScheduleHistory(client, actor, edge.workOrderId, { start: wo.scheduledStart, end: wo.scheduledEnd },
      { start: window.start, end: window.end }, reason, now);
    return Object.freeze({
      transition, assignment, scheduledStart: window.start.toISOString(), scheduledEnd: window.end.toISOString(),
      warnings,
    });
  });
}

// ════════════════════ Unschedule (ND-18) ════════════════════

export interface UnscheduleResult {
  readonly transition: TransitionResult;
  readonly endedAssignmentId: string | null;
  readonly priorAssigneeEmployeeId: string | null;
  readonly priorScheduledStart: string | null;
  readonly priorScheduledEnd: string | null;
}

export async function unscheduleWorkOrder(deps: SchedulingDeps, actor: LifecycleActor, input: unknown): Promise<UnscheduleResult> {
  const i = acceptOnly(input, ["workOrderId", "reason"]);
  const edge = { workOrderId: i.workOrderId as string, expectedStatus: "SCHEDULED" as const, toStatus: "READY_TO_DISPATCH" as const };
  await authorizeEdgeOrRefuse(deps, actor, edge);
  const reason = requireReason(i.reason);
  const now = (deps.now ?? (() => new Date()))();

  return inTransaction(deps.pool, async (client) => {
    const wo = await lockWorkOrder(client, actor.tenantId, edge.workOrderId, edge.expectedStatus);
    // The technician given up is recorded by ENDING their interval with the reason -- the interval is the
    // durable record of who the job was scheduled for, once the Work Order no longer says.
    if (wo.currentAssignee) {
      await client.query(
        `UPDATE ${SCHEMA}.work_order_assignments
            SET effective_to = $3, end_source = 'UNSCHEDULE', end_reason = $4, ended_by_principal_id = $5
          WHERE tenant_id = $1 AND id = $2 AND effective_to IS NULL`,
        [actor.tenantId, wo.currentAssignee.id, now, reason, actor.principalId]);
    }
    const transition = await applyTransitionWithinTransaction(client, actor,
      { ...edge, note: reason, placement: { start: null, end: null } }, now);
    if (wo.scheduledStart) {
      await recordScheduleHistory(client, actor, edge.workOrderId, { start: wo.scheduledStart, end: wo.scheduledEnd },
        { start: null, end: null }, reason, now);
    }
    return Object.freeze({
      transition,
      endedAssignmentId: wo.currentAssignee?.id ?? null,
      priorAssigneeEmployeeId: wo.currentAssignee?.employeeId ?? null,
      priorScheduledStart: wo.scheduledStart?.toISOString() ?? null,
      priorScheduledEnd: wo.scheduledEnd?.toISOString() ?? null,
    });
  });
}

// ════════════════════ Reschedule ════════════════════

export interface RescheduleResult {
  readonly workOrderId: string;
  readonly scheduledStart: string;
  readonly scheduledEnd: string;
  readonly assignment: WorkOrderAssignmentResult | null;
  readonly warnings: readonly PlacementWarning[];
}

/**
 * Move a SCHEDULED job's window, and optionally its technician. No status changes, so no transition is written;
 * the schedule history row and (when the technician changes) the assignment interval are the record.
 *
 * STALE CHECK: the caller states the window it is moving (expectedScheduledStart); a job someone else already
 * moved is a CONFLICT, not a silent overwrite of their move.
 */
export async function rescheduleWorkOrder(deps: SchedulingDeps, actor: LifecycleActor, input: unknown): Promise<RescheduleResult> {
  const i = acceptOnly(input, ["workOrderId", "expectedScheduledStart", "scheduledStart", "scheduledEnd", "employeeId", "reason"]);
  if (!ID_SHAPE(actor?.tenantId) || !ID_SHAPE(actor?.principalId)) refuse("ACTOR_INVALID", "INVALID_INPUT", "an actor is a Principal within a tenant");
  if (!(actor.capabilities instanceof Set) || !actor.capabilities.has(WORK_ORDER_LIFECYCLE_SCHEDULE)) {
    refuse("CAPABILITY_MISSING", "FORBIDDEN", `rescheduling requires ${WORK_ORDER_LIFECYCLE_SCHEDULE}`);
  }
  if (!ID_SHAPE(i.workOrderId)) refuse("WORK_ORDER_ID_INVALID", "INVALID_INPUT", "a workOrderId is required");
  if (i.employeeId !== undefined && !ID_SHAPE(i.employeeId)) refuse("EMPLOYEE_ID_INVALID", "INVALID_INPUT", "employeeId must be a governed Employee id");
  const reason = requireReason(i.reason);
  const expected = parseInstant(i.expectedScheduledStart, "expectedScheduledStart");
  const now = (deps.now ?? (() => new Date()))();
  const window = validateWindow(i.scheduledStart, i.scheduledEnd, now);
  const workOrderId = i.workOrderId as string;

  return inTransaction(deps.pool, async (client) => {
    const wo = await lockWorkOrder(client, actor.tenantId, workOrderId, "SCHEDULED");
    if (!wo.scheduledStart || wo.scheduledStart.getTime() !== expected.getTime()) {
      refuse("STALE_SCHEDULE", "CONFLICT", "the scheduled window changed since it was read; reload before moving it");
    }
    const employeeId = (i.employeeId as string | undefined) ?? wo.currentAssignee?.employeeId;
    if (!employeeId) refuse("ASSIGNEE_REQUIRED", "PRECONDITION_FAILED", "the scheduled Work Order has no assignee; name one");
    await lockEmployeePlacement(client, actor.tenantId, employeeId!);
    const conflict = await findScheduleConflict(client, actor.tenantId, employeeId!, workOrderId, window.start, window.end);
    if (conflict) refuse("SCHEDULE_CONFLICT", "PRECONDITION_FAILED", `the Employee is already scheduled for overlapping Work Order ${conflict}`);
    let assignment: WorkOrderAssignmentResult | null = null;
    if (!wo.currentAssignee || wo.currentAssignee.employeeId !== employeeId) {
      assignment = await assignWithinTransaction(client, actor,
        { workOrderId, employeeId: employeeId!, source: wo.currentAssignee ? "RESCHEDULE" : "SCHEDULE", reason: wo.currentAssignee ? reason : null }, now);
    } else {
      await assertEmployeeAssignable(client, actor.tenantId, employeeId!, wo.operatingCompanyKey);
    }
    const warnings = await checkTechnicianAvailability(client,
      { tenantId: actor.tenantId, employeeId: employeeId!, operatingCompanyKey: wo.operatingCompanyKey, start: window.start, end: window.end });
    await client.query(
      `UPDATE ${SCHEMA}.work_orders SET scheduled_start = $3, scheduled_end = $4, updated_at = $5, updated_by_principal_id = $6
        WHERE tenant_id = $1 AND id = $2`,
      [actor.tenantId, workOrderId, window.start, window.end, now, actor.principalId]);
    await recordScheduleHistory(client, actor, workOrderId, { start: wo.scheduledStart, end: wo.scheduledEnd },
      { start: window.start, end: window.end }, reason, now);
    return Object.freeze({
      workOrderId, scheduledStart: window.start.toISOString(), scheduledEnd: window.end.toISOString(), assignment,
      warnings,
    });
  });
}

// ════════════════════ Dispatch ════════════════════

export interface DispatchResult {
  readonly transition: TransitionResult;
  readonly assigneeEmployeeId: string;
  readonly reassignment: WorkOrderAssignmentResult | null;
  readonly inventoryBoundary: string | null;
  readonly warnings: readonly PlacementWarning[];
}

export async function dispatchWorkOrder(deps: SchedulingDeps, actor: LifecycleActor, input: unknown): Promise<DispatchResult> {
  const i = acceptOnly(input, ["workOrderId", "employeeId", "reassignReason", "note"]);
  if (i.employeeId !== undefined && !ID_SHAPE(i.employeeId)) refuse("EMPLOYEE_ID_INVALID", "INVALID_INPUT", "employeeId must be a governed Employee id");
  const edge = { workOrderId: i.workOrderId as string, expectedStatus: "SCHEDULED" as const, toStatus: "DISPATCHED" as const,
    note: i.note as string | undefined };
  await authorizeEdgeOrRefuse(deps, actor, edge);
  const now = (deps.now ?? (() => new Date()))();

  return inTransaction(deps.pool, async (client) => {
    const wo = await lockWorkOrder(client, actor.tenantId, edge.workOrderId, edge.expectedStatus);
    const target = (i.employeeId as string | undefined) ?? wo.currentAssignee?.employeeId;
    if (!target) refuse("ASSIGNEE_REQUIRED", "PRECONDITION_FAILED", "a Work Order is dispatched TO someone; it has no assignee");
    await lockEmployeePlacement(client, actor.tenantId, target!);
    let reassignment: WorkOrderAssignmentResult | null = null;
    if (wo.currentAssignee && wo.currentAssignee.employeeId !== target) {
      // H20: sending the job to someone other than the scheduled technician is a distinct, reasoned event.
      const reason = requireReason(i.reassignReason, "REASSIGN_REASON_REQUIRED");
      reassignment = await assignWithinTransaction(client, actor,
        { workOrderId: edge.workOrderId, employeeId: target!, source: "DISPATCH_REASSIGN", reason }, now);
    } else if (!wo.currentAssignee) {
      reassignment = await assignWithinTransaction(client, actor,
        { workOrderId: edge.workOrderId, employeeId: target!, source: "SCHEDULE", reason: null }, now);
    } else {
      // DQ-014: the technician being dispatched is re-checked now; a status can change after Schedule.
      await assertEmployeeAssignable(client, actor.tenantId, target!, wo.operatingCompanyKey);
    }
    const busy = await findDoubleBooking(client, actor.tenantId, target!, edge.workOrderId);
    if (busy) refuse("DOUBLE_BOOKED", "PRECONDITION_FAILED", `the Employee is already on active Work Order ${busy}`);
    if (wo.scheduledStart && wo.scheduledEnd) {
      const conflict = await findScheduleConflict(client, actor.tenantId, target!, edge.workOrderId, wo.scheduledStart, wo.scheduledEnd);
      if (conflict) refuse("SCHEDULE_CONFLICT", "PRECONDITION_FAILED", `the Employee is already scheduled for overlapping Work Order ${conflict}`);
    }
    // DQ-014: the dispatched Employee's availability over the job's own window (dispatch takes no window).
    const warnings = wo.scheduledStart && wo.scheduledEnd
      ? await checkTechnicianAvailability(client,
        { tenantId: actor.tenantId, employeeId: target!, operatingCompanyKey: wo.operatingCompanyKey, start: wo.scheduledStart, end: wo.scheduledEnd })
      : Object.freeze([]);
    const transition = await applyTransitionWithinTransaction(client, actor, edge, now);
    return Object.freeze({
      transition, assigneeEmployeeId: target!, reassignment, inventoryBoundary: transition.inventoryBoundary,
      warnings,
    });
  });
}

// ════════════════════ Complete (DQ-015) ════════════════════

/** Retained for the record: the refusal DQ-015 imposed until the Commercial fulfillment authority existed (now retired). */
export const FULFILLMENT_AUTHORITY_UNAVAILABLE = "SALES_ORDER_FULFILLMENT_AUTHORITY_UNAVAILABLE";

export interface CompleteResult {
  readonly transition: TransitionResult;
  readonly inventoryBoundary: string | null;
  /** NOT_APPLICABLE for a Work Order with no Sales Order; RECORDED with the governed Commercial fulfillment otherwise. */
  readonly fulfillment: WorkOrderFulfillmentOutcome;
  /** The Finance consequence (DECISIONS #196): the Operational Billing Package when the Sales Order is now ELIGIBLE in full. */
  readonly billingPackage: BillingPackageOutcome | null;
}

/**
 * WORK_IN_PROGRESS -> COMPLETED, by the ASSIGNED Employee (workOrder.lifecycle.complete + RECORD_ASSIGNMENT).
 *
 * DQ-015 END STATE (Controller COMMERCIAL FINANCE ACTIVATION, 2026-10-02; DECISIONS #195): completing a Sales-Order-linked
 * Work Order invokes the Commercial fulfillment authority SERVER-SIDE, in THIS transaction, which records the fulfillment
 * the completion proves (eosCommercial/fulfillment/salesOrderFulfillmentAuthority.ts). The employee's authority stays
 * authority to complete their own assigned work -- no Commercial capability is asked of them. If the fulfillment cannot be
 * recorded (a missing or mismatched Sales Order, an unresolved company, an overage) the COMPLETION IS REFUSED and rolls back:
 * a completed Work Order whose fulfillment vanished, or a fulfillment whose evidence never committed, cannot exist. A Work
 * Order with no Sales Order completes normally. Idempotent by construction: COMPLETED is one-way, so a replay is a
 * STALE_WORK_ORDER_STATE conflict, and every fulfillment row is unique per (Work Order, Sales Order line).
 */
export async function completeWorkOrder(deps: SchedulingDeps, actor: LifecycleActor, input: unknown): Promise<CompleteResult> {
  const i = acceptOnly(input, ["workOrderId", "note"]);
  const edge = { workOrderId: i.workOrderId as string, expectedStatus: "WORK_IN_PROGRESS" as const, toStatus: "COMPLETED" as const,
    note: i.note as string | undefined };
  await authorizeEdgeOrRefuse(deps, actor, edge);
  const now = (deps.now ?? (() => new Date()))();

  return inTransaction(deps.pool, async (client) => {
    await lockWorkOrder(client, actor.tenantId, edge.workOrderId, edge.expectedStatus);
    const transition = await applyTransitionWithinTransaction(client, actor, edge, now);
    let fulfillment: WorkOrderFulfillmentOutcome;
    try {
      fulfillment = await recordWorkOrderFulfillmentOn(client, { tenantId: actor.tenantId, principalId: actor.principalId },
        { workOrderId: edge.workOrderId, completedAt: now });
    } catch (err) {
      if (err instanceof CommercialFulfillmentError) {
        refuse(err.code, err.category === "NOT_FOUND" ? "NOT_FOUND" : "PRECONDITION_FAILED",
          `this Work Order fulfils a Sales Order and its completion must record that fulfillment (DQ-015): ${err.message}`);
      }
      throw err;
    }
    // THE FINANCE CONSEQUENCE (DECISIONS #196), same transaction: when the fulfillment leaves the Sales Order ELIGIBLE in full,
    // the Operational Billing Package is prepared (READY, or HELD with its explicit evidence exceptions). Not an invoice, not a
    // receivable, not a posting, nothing sent; no Finance capability is asked of the technician.
    let billingPackage: BillingPackageOutcome | null = null;
    if (fulfillment.status === "RECORDED") {
      try {
        billingPackage = await prepareBillingPackageOn(client, { tenantId: actor.tenantId, principalId: actor.principalId },
          { salesOrderId: fulfillment.salesOrderId });
      } catch (err) {
        if (err instanceof FinanceFoundationError) {
          refuse(err.code, "PRECONDITION_FAILED", `the Sales Order's billing package could not be prepared: ${err.message}`);
        }
        throw err;
      }
    }
    return Object.freeze({ transition, inventoryBoundary: transition.inventoryBoundary, fulfillment, billingPackage });
  });
}

// ════════════════════ the planning estimate (ND-21) ════════════════════

/** scheduling/validation.ts MAX_ESTIMATED_DURATION_MINUTES: the longest planning estimate, the same two weeks. */
export const MAX_ESTIMATED_DURATION_MINUTES = 14 * 24 * 60;

/**
 * Set or clear a Work Order's planning estimate (Firebase setWorkOrderEstimatedDuration, ND-21). A dispatcher-bucket
 * act, so it is governed by workOrder.lifecycle.schedule. Deliberately NOT restricted to SCHEDULED work, and
 * deliberately clearable (null): "we do not know" is absence, not zero. Terminal Work Orders are not re-planned.
 * Audited in eos_policy.audit_events with the prior and new values, in the same transaction.
 */
export async function setWorkOrderEstimatedDuration(
  deps: SchedulingDeps, actor: LifecycleActor, input: unknown,
): Promise<{ readonly workOrderId: string; readonly estimatedDurationMinutes: number | null }> {
  const i = acceptOnly(input, ["workOrderId", "estimatedDurationMinutes"]);
  if (!ID_SHAPE(actor?.tenantId) || !ID_SHAPE(actor?.principalId)) refuse("ACTOR_INVALID", "INVALID_INPUT", "an actor is a Principal within a tenant");
  if (!(actor.capabilities instanceof Set) || !actor.capabilities.has(WORK_ORDER_LIFECYCLE_SCHEDULE)) {
    refuse("CAPABILITY_MISSING", "FORBIDDEN", `setting a planning estimate requires ${WORK_ORDER_LIFECYCLE_SCHEDULE}`);
  }
  if (!ID_SHAPE(i.workOrderId)) refuse("WORK_ORDER_ID_INVALID", "INVALID_INPUT", "a workOrderId is required");
  const raw = i.estimatedDurationMinutes;
  const minutes = raw === undefined || raw === null ? null : (raw as number);
  if (minutes !== null && (typeof minutes !== "number" || !Number.isSafeInteger(minutes) || minutes <= 0 || minutes > MAX_ESTIMATED_DURATION_MINUTES)) {
    refuse("ESTIMATED_DURATION_INVALID", "INVALID_INPUT", `estimatedDurationMinutes is a whole number of minutes, 1..${MAX_ESTIMATED_DURATION_MINUTES}, or null to clear`);
  }
  const workOrderId = i.workOrderId as string;
  const now = (deps.now ?? (() => new Date()))();
  return inTransaction(deps.pool, async (client) => {
    const { rows } = await client.query(
      `SELECT status::text AS status, estimated_duration_minutes FROM ${SCHEMA}.work_orders WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [actor.tenantId, workOrderId]);
    if (rows.length === 0) refuse("WORK_ORDER_NOT_FOUND", "NOT_FOUND", "the Work Order does not exist in this tenant");
    if (await isQuarantined(client, actor.tenantId, workOrderId)) refuse(WORK_ORDER_QUARANTINED, "PRECONDITION_FAILED", WORK_ORDER_QUARANTINED_MESSAGE);
    if (["COMPLETED", "CLOSED", "CANCELLED"].includes(rows[0].status)) {
      refuse("WORK_ORDER_TERMINAL", "PRECONDITION_FAILED", `a ${rows[0].status} Work Order is not re-planned`);
    }
    const prior = rows[0].estimated_duration_minutes === null ? null : Number(rows[0].estimated_duration_minutes);
    await client.query(
      `UPDATE ${SCHEMA}.work_orders SET estimated_duration_minutes = $3, updated_at = $4, updated_by_principal_id = $5
        WHERE tenant_id = $1 AND id = $2`,
      [actor.tenantId, workOrderId, minutes, now, actor.principalId]);
    await client.query(
      `INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at)
       VALUES ($1,$2,'setWorkOrderEstimatedDuration',$3,'workOrder',$4,$5,$6,$7)`,
      [`aud_${randomUUID()}`, actor.tenantId, actor.principalId, workOrderId,
       JSON.stringify({ estimatedDurationMinutes: prior }), JSON.stringify({ estimatedDurationMinutes: minutes }), now]);
    return Object.freeze({ workOrderId, estimatedDurationMinutes: minutes });
  });
}
