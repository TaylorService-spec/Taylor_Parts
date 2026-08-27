// Dispatch & Scheduler -- the governed Scheduling command service.
//
// WHAT LIVES HERE AND WHY IT IS NOT IN transitionWorkOrder.ts
//
// ND-19 (Owner ruling 2026-08-27): re-timing a job and moving it to another technician change the
// PLAN, not the lifecycle. The Work Order stays SCHEDULED throughout. `transitionEngine.ts` already
// says as much in its own comments -- scheduledStart / scheduledEnd / scheduledTechId are Planning
// (mutable) fields, deliberately excluded from ACTION_TIMESTAMP_FIELD because they are a dispatcher's
// chosen future window rather than the instant something happened. So these commands sit beside the
// state machine and never touch its table.
//
// Un-scheduling is the exception and is NOT here: returning a job to the Ready queue genuinely does
// change its operational readiness, so it is a real transition and lives in transitionWorkOrder.ts as
// the "Unschedule" action (ND-18).
//
// WHAT THIS FILE REUSES RATHER THAN REBUILDS
//
//   findScheduleConflict      workOrderAvailability.ts   the SAME overlap engine Schedule already uses
//   stageAuditEvent           access/auditEventWriter    the SAME immutable audit path
//   work_order_tech_locks     transitionWorkOrder.ts     the SAME per-technician serialization sentinel
//
// There is no second state machine, no second audit system, no second conflict rule. A dispatcher
// moving a job through this file and a dispatcher placing one through transitionWorkOrder are
// arguing with the same referee.
import { FieldValue, Timestamp, type Transaction } from "firebase-admin/firestore";
import { getCallerContext } from "../callerContext";
import { WORK_ORDERS_COLLECTION } from "../constants/collections";
import { findScheduleConflict } from "../workOrderAvailability";
import { stageAuditEvent } from "../access/auditEventWriter";
import type { AuditAction } from "../types/access";
import type { WorkOrder } from "../types/workOrder";
import { checkPlacement, PAST_START_TOLERANCE_MS } from "./placementPolicy";
import { db, loadTechnician } from "./schedulingRepository";
import {
  TECHNICIAN_BLOCKED_TIME_COLLECTION,
  TECHNICIAN_WORKING_AVAILABILITY_COLLECTION,
  SchedulingError,
  type SchedulingWarning,
} from "./types";
import {
  parseEstimatedDurationMinutes,
  parseReason,
  parseScheduleWindow,
  parseTechnicianId,
  validateBlockedTimeInput,
  validateWorkingAvailabilityInput,
  type ValidationResult,
} from "./validation";

// The same sentinel collection transitionWorkOrder.ts serializes on. Named here rather than imported
// because that module does not export it -- if either name changes, both must. A scheduling command
// that took a DIFFERENT lock would serialize against nothing, which is worse than taking none at all
// because it would look like it was protected.
const TECH_LOCKS_COLLECTION = "work_order_tech_locks";

// Re-exported from the placement policy rather than redeclared (ND-24). Existing importers keep
// working; there is still exactly one number.
export { PAST_START_TOLERANCE_MS };

// These commands CONTEND ON PURPOSE. Every schedule-touching write for one technician is serialized
// through a single sentinel document, and each one also runs a transactional query over
// `fieldops_wos` -- so losing a contention race is a normal outcome here, not an exceptional one.
// Firestore's default of five attempts is tuned for transactions that rarely collide.
//
// Raised to ten after the emulator suite hit `10 ABORTED: Transaction lock timeout` on a sequential
// run. Part of that is an emulator artifact -- its lock manager is coarser than production Firestore,
// which locks the documents a transactional query returns rather than a broader range -- so this is
// not purely a production fix, and saying so matters. But the underlying fact is real in both places:
// a design that funnels a technician's writes through one document should retry more than one that
// does not. The corrected error mapping in schedulingCallables.ts is the other half: when the retries
// ARE exhausted, the caller now learns it was contention and can try again, instead of being told the
// system is broken.
const SCHEDULING_TRANSACTION_OPTIONS = { maxAttempts: 10 } as const;

function unwrap<T>(result: ValidationResult<T>, field: string): T {
  if (result.valid) return result.value;
  const detail = result.errors.map((e) => `${e.path}:${e.code}`).join(", ");
  throw new SchedulingError("INVALID_INPUT", `${field} is invalid (${detail}).`);
}

async function requireDispatcher(actorUid: string): Promise<string> {
  const caller = await getCallerContext(actorUid);
  // Owner ruling 2026-08-27: the same admin/dispatcher bucket ACTION_PERMISSIONS already uses for
  // Schedule and Dispatch. No new capability is registered -- a second authorization pattern before
  // any demonstrated need for finer separation would be a cost with no buyer.
  if (caller.role !== "admin" && caller.role !== "dispatcher") {
    throw new SchedulingError("PERMISSION_DENIED", "Only an admin or dispatcher may change a schedule.");
  }
  return caller.role;
}

function toMillisOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const millis = (value as { toMillis?: () => number } | null)?.toMillis?.();
  return typeof millis === "number" && Number.isFinite(millis) ? millis : null;
}

function describeWindow(startMillis: number | null, endMillis: number | null): string {
  if (startMillis === null || endMillis === null) return "an unrecorded window";
  return `${new Date(startMillis).toISOString()} to ${new Date(endMillis).toISOString()}`;
}

// ---------------------------------------------------------------------------------------------
// The shared placement check -- MOVED OUT (ND-24)
// ---------------------------------------------------------------------------------------------
//
// checkPlacement used to be defined right here, private to this file. That is exactly why the
// Schedule transition never got it: the policy was reachable only by the callers that happened to
// live in this module. It now lives in ./placementPolicy.ts and both placement paths import it.
//
// Do not reintroduce a local copy. schedulingPlacementSymmetry.test.mjs asserts that this file and
// transitionWorkOrder.ts each reach the policy by import and neither reimplements it.

// ---------------------------------------------------------------------------------------------
// Reschedule / Reassign
// ---------------------------------------------------------------------------------------------

export interface SchedulingCommandResult {
  workOrderId: string;
  scheduledTechId: string;
  scheduledStart: number;
  scheduledEnd: number;
  warnings: SchedulingWarning[];
}

interface ScheduleChangeInput {
  workOrderId: string;
  reason: string;
  technicianId: string;
  startMillis: number;
  endMillis: number;
  /** Optimistic-concurrency guard, see below. */
  expectedScheduledStart?: number;
}

/**
 * The one write path shared by both commands.
 *
 * `expectedScheduledStart` is what makes the drag-and-drop board safe. A dispatcher drags a job from
 * the position they can see, and between the render and the drop someone else may have moved it. If
 * the caller states the start it believed it was moving, and that is not what is stored, this refuses
 * with STALE_WORK_ORDER instead of silently overwriting a placement the dispatcher never saw. It is
 * optional so a non-drag caller (a form that just loaded the record) is not forced to fake one.
 */
async function applyScheduleChange(
  actorUid: string,
  auditAction: Extract<AuditAction, "rescheduleWorkOrder" | "reassignScheduledWorkOrder">,
  input: ScheduleChangeInput,
  nowMillis: number,
): Promise<SchedulingCommandResult> {
  const role = await requireDispatcher(actorUid);
  const woRef = db().collection(WORK_ORDERS_COLLECTION).doc(input.workOrderId);

  return db().runTransaction(async (tx) => {
    const snap = await tx.get(woRef);
    if (!snap.exists) {
      throw new SchedulingError("WORK_ORDER_NOT_FOUND", `No Work Order with id ${input.workOrderId}.`);
    }
    const wo = snap.data() as WorkOrder;

    // A Work Order that is not SCHEDULED has no schedule to change. This is the refusal that keeps
    // these commands out of the lifecycle: they cannot be used to place unplaced work (that is
    // Schedule), and they cannot be used to re-time a job a technician is already driving to (that is
    // committed -- see ND-18's reasoning, which applies identically here).
    if (wo.status !== "SCHEDULED") {
      throw new SchedulingError(
        "NOT_SCHEDULED",
        `Work Order ${input.workOrderId} is ${wo.status}, so its schedule cannot be changed.`,
      );
    }

    const priorTechId = wo.scheduledTechId ?? null;
    const priorStart = toMillisOrNull(wo.scheduledStart);
    const priorEnd = toMillisOrNull(wo.scheduledEnd);

    if (input.expectedScheduledStart !== undefined && input.expectedScheduledStart !== priorStart) {
      throw new SchedulingError(
        "STALE_WORK_ORDER",
        "This Work Order's schedule changed since it was loaded. Reload and try again.",
      );
    }

    // Serialize against every other schedule-touching transaction for this technician, exactly as
    // transitionWorkOrder does. Read before any write, per Firestore's transaction rule.
    const lockRef = db().collection(TECH_LOCKS_COLLECTION).doc(input.technicianId);
    await tx.get(lockRef);

    const warnings = await checkPlacement(tx, {
      technicianId: input.technicianId,
      workOrderId: input.workOrderId,
      startMillis: input.startMillis,
      endMillis: input.endMillis,
      nowMillis,
    });

    tx.set(lockRef, { technicianId: input.technicianId, touchedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.update(woRef, {
      scheduledTechId: input.technicianId,
      scheduledStart: Timestamp.fromMillis(input.startMillis),
      scheduledEnd: Timestamp.fromMillis(input.endMillis),
      // The denormalized snapshot of the placement being given up -- for board display only. It is
      // the LATEST change, not the history: a second reschedule overwrites it. The append-only record
      // is the Audit Event staged below, in this same transaction.
      ...(priorStart !== null ? { rescheduledFromStart: Timestamp.fromMillis(priorStart) } : {}),
      ...(priorEnd !== null ? { rescheduledFromEnd: Timestamp.fromMillis(priorEnd) } : {}),
      ...(priorTechId ? { rescheduledFromTechId: priorTechId } : {}),
      rescheduledAt: FieldValue.serverTimestamp(),
      rescheduledReason: input.reason,
      rescheduledByUid: actorUid,
      updatedAt: FieldValue.serverTimestamp(),
      // status is deliberately NOT written. ND-19: this is a plan change, not a transition.
    });

    // Historical integrity, which is the whole reason this event carries the prior facts rather than
    // just the new ones: the document now says the new technician and the new window, and without
    // this line nothing anywhere would remember the old ones.
    stageAuditEvent(tx, {
      actorUid,
      action: auditAction,
      targetType: "workOrder",
      targetId: input.workOrderId,
      outcome: "applied",
      summary:
        `${role} ${actorUid} moved Work Order ${input.workOrderId} from technician ${priorTechId ?? "unrecorded"} ` +
        `(${describeWindow(priorStart, priorEnd)}) to technician ${input.technicianId} ` +
        `(${describeWindow(input.startMillis, input.endMillis)}). Reason: ${input.reason}` +
        (warnings.length ? ` Warnings: ${warnings.map((w) => w.code).join(", ")}` : ""),
    });

    return {
      workOrderId: input.workOrderId,
      scheduledTechId: input.technicianId,
      scheduledStart: input.startMillis,
      scheduledEnd: input.endMillis,
      warnings,
    };
  }, SCHEDULING_TRANSACTION_OPTIONS);
}

/** Re-time a SCHEDULED Work Order, optionally onto a different technician. */
export async function rescheduleWorkOrder(
  actorUid: string,
  raw: unknown,
  nowMillis: number = Date.now(),
): Promise<SchedulingCommandResult> {
  const data = (raw ?? {}) as Record<string, unknown>;
  const workOrderId = unwrap(parseTechnicianId(data.workOrderId, "workOrderId"), "workOrderId");
  const reason = unwrap(parseReason(data.reason), "reason");
  const window = unwrap(parseScheduleWindow(data), "window");
  // The technician is optional: a plain re-time keeps whoever is already on the job. Resolved inside
  // the transaction so it reads the stored value rather than whatever the client believed it was.
  const technicianId =
    data.scheduledTechId === undefined || data.scheduledTechId === null
      ? null
      : unwrap(parseTechnicianId(data.scheduledTechId, "scheduledTechId"), "scheduledTechId");

  const resolvedTechnicianId = technicianId ?? (await resolveCurrentTechnician(workOrderId));
  return applyScheduleChange(
    actorUid,
    "rescheduleWorkOrder",
    {
      workOrderId,
      reason,
      technicianId: resolvedTechnicianId,
      startMillis: window.startMillis,
      endMillis: window.endMillis,
      ...(typeof data.expectedScheduledStart === "number"
        ? { expectedScheduledStart: data.expectedScheduledStart }
        : {}),
    },
    nowMillis,
  );
}

/** Move a SCHEDULED Work Order to a different technician, keeping its window. */
export async function reassignScheduledWorkOrder(
  actorUid: string,
  raw: unknown,
  nowMillis: number = Date.now(),
): Promise<SchedulingCommandResult> {
  const data = (raw ?? {}) as Record<string, unknown>;
  const workOrderId = unwrap(parseTechnicianId(data.workOrderId, "workOrderId"), "workOrderId");
  const technicianId = unwrap(parseTechnicianId(data.scheduledTechId, "scheduledTechId"), "scheduledTechId");
  const reason = unwrap(parseReason(data.reason), "reason");

  // The window comes from the RECORD, never the caller. A reassignment that also silently re-timed
  // the job would be two changes wearing one reason.
  const snap = await db().collection(WORK_ORDERS_COLLECTION).doc(workOrderId).get();
  if (!snap.exists) throw new SchedulingError("WORK_ORDER_NOT_FOUND", `No Work Order with id ${workOrderId}.`);
  const wo = snap.data() as WorkOrder;
  const startMillis = toMillisOrNull(wo.scheduledStart);
  const endMillis = toMillisOrNull(wo.scheduledEnd);
  if (startMillis === null || endMillis === null) {
    throw new SchedulingError("NOT_SCHEDULED", `Work Order ${workOrderId} has no scheduled window to reassign.`);
  }

  return applyScheduleChange(
    actorUid,
    "reassignScheduledWorkOrder",
    {
      workOrderId,
      reason,
      technicianId,
      startMillis,
      endMillis,
      ...(typeof data.expectedScheduledStart === "number"
        ? { expectedScheduledStart: data.expectedScheduledStart }
        : {}),
    },
    nowMillis,
  );
}

async function resolveCurrentTechnician(workOrderId: string): Promise<string> {
  const snap = await db().collection(WORK_ORDERS_COLLECTION).doc(workOrderId).get();
  if (!snap.exists) throw new SchedulingError("WORK_ORDER_NOT_FOUND", `No Work Order with id ${workOrderId}.`);
  const techId = (snap.data() as WorkOrder).scheduledTechId;
  if (!techId) {
    throw new SchedulingError("NOT_SCHEDULED", `Work Order ${workOrderId} is not scheduled to a technician.`);
  }
  return techId;
}

// ---------------------------------------------------------------------------------------------
// The planning estimate (ND-21)
// ---------------------------------------------------------------------------------------------

/**
 * Set or clear a Work Order's planning estimate.
 *
 * Deliberately NOT restricted to SCHEDULED work -- an estimate is most useful on a Work Order that
 * has not been placed yet, since proposing a placement is what it is for. It is also deliberately
 * clearable (null): an estimate someone now knows to be wrong should be removable, and the honest
 * way to say "we do not know" is absence, not zero.
 */
export async function setWorkOrderEstimatedDuration(actorUid: string, raw: unknown): Promise<{ workOrderId: string; estimatedDurationMinutes: number | null }> {
  const role = await requireDispatcher(actorUid);
  const data = (raw ?? {}) as Record<string, unknown>;
  const workOrderId = unwrap(parseTechnicianId(data.workOrderId, "workOrderId"), "workOrderId");
  const minutes = unwrap(parseEstimatedDurationMinutes(data.estimatedDurationMinutes), "estimatedDurationMinutes");

  const woRef = db().collection(WORK_ORDERS_COLLECTION).doc(workOrderId);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(woRef);
    if (!snap.exists) throw new SchedulingError("WORK_ORDER_NOT_FOUND", `No Work Order with id ${workOrderId}.`);
    const prior = (snap.data() as WorkOrder).estimatedDurationMinutes ?? null;

    tx.update(woRef, {
      estimatedDurationMinutes: minutes === null ? FieldValue.delete() : minutes,
      updatedAt: FieldValue.serverTimestamp(),
    });
    stageAuditEvent(tx, {
      actorUid,
      action: "setWorkOrderEstimatedDuration",
      targetType: "workOrder",
      targetId: workOrderId,
      outcome: "applied",
      summary: `${role} ${actorUid} set the planning estimate on Work Order ${workOrderId} from ${prior ?? "none"} to ${minutes ?? "none"} minutes.`,
    });
  }, SCHEDULING_TRANSACTION_OPTIONS);
  return { workOrderId, estimatedDurationMinutes: minutes };
}

// ---------------------------------------------------------------------------------------------
// Availability authority (ND-22)
// ---------------------------------------------------------------------------------------------

/**
 * Replace a technician's recurring working schedule. Whole-record replacement, not a merge: a
 * partial update of a weekly schedule is how a Tuesday nobody meant to keep survives a change, and
 * the record is small enough that resending it costs nothing.
 */
export async function setTechnicianWorkingAvailability(actorUid: string, raw: unknown): Promise<{ technicianId: string }> {
  const role = await requireDispatcher(actorUid);
  const input = unwrap(validateWorkingAvailabilityInput(raw), "workingAvailability");
  const ref = db().collection(TECHNICIAN_WORKING_AVAILABILITY_COLLECTION).doc(input.technicianId);

  await db().runTransaction(async (tx) => {
    const technician = await loadTechnician(tx, input.technicianId);
    if (!technician) {
      throw new SchedulingError("TECHNICIAN_NOT_FOUND", `No technician record exists at ${input.technicianId}.`);
    }
    const priorDays = Object.keys(((await tx.get(ref)).data()?.weeklyHours as object) ?? {}).length;

    tx.set(ref, {
      technicianId: input.technicianId,
      timeZone: input.timeZone,
      weeklyHours: input.weeklyHours,
      updatedAt: FieldValue.serverTimestamp(),
      updatedByUid: actorUid,
    });
    stageAuditEvent(tx, {
      actorUid,
      action: "setTechnicianWorkingAvailability",
      targetType: "technician",
      targetId: input.technicianId,
      outcome: "applied",
      summary:
        `${role} ${actorUid} set the working schedule for technician ${input.technicianId} in ${input.timeZone} ` +
        `(${priorDays} weekday(s) recorded before, ${Object.keys(input.weeklyHours).length} after).`,
    });
  }, SCHEDULING_TRANSACTION_OPTIONS);
  return { technicianId: input.technicianId };
}

/** Record one dated absence. Blocked time REFUSES an overlapping placement, so this is enforcement, not decoration. */
export async function createTechnicianBlockedTime(actorUid: string, raw: unknown): Promise<{ blockId: string }> {
  const role = await requireDispatcher(actorUid);
  const input = unwrap(validateBlockedTimeInput(raw), "blockedTime");
  const ref = db().collection(TECHNICIAN_BLOCKED_TIME_COLLECTION).doc();

  await db().runTransaction(async (tx) => {
    const technician = await loadTechnician(tx, input.technicianId);
    if (!technician) {
      throw new SchedulingError("TECHNICIAN_NOT_FOUND", `No technician record exists at ${input.technicianId}.`);
    }
    // Blocked time is NOT checked against existing scheduled work. Recording that someone is on PTO
    // must never be refused because a job was already placed there -- the absence is the fact, and
    // the placement is the problem. The board surfaces the collision so a dispatcher can move the
    // job, which is a decision a person makes, not one this command should make for them.
    tx.set(ref, {
      blockId: ref.id,
      technicianId: input.technicianId,
      kind: input.kind,
      startMillis: input.startMillis,
      endMillis: input.endMillis,
      ...(input.note ? { note: input.note } : {}),
      createdAt: FieldValue.serverTimestamp(),
      createdByUid: actorUid,
    });
    stageAuditEvent(tx, {
      actorUid,
      action: "createTechnicianBlockedTime",
      targetType: "technician",
      targetId: input.technicianId,
      outcome: "applied",
      summary:
        `${role} ${actorUid} recorded ${input.kind} blocked time ${describeWindow(input.startMillis, input.endMillis)} ` +
        `for technician ${input.technicianId} (block ${ref.id}).`,
    });
  }, SCHEDULING_TRANSACTION_OPTIONS);
  return { blockId: ref.id };
}

/** Remove one blocked-time record. The deletion itself is audited, so a vanished absence is explicable. */
export async function deleteTechnicianBlockedTime(actorUid: string, raw: unknown): Promise<{ blockId: string }> {
  const role = await requireDispatcher(actorUid);
  const data = (raw ?? {}) as Record<string, unknown>;
  const blockId = unwrap(parseTechnicianId(data.blockId, "blockId"), "blockId");
  const ref = db().collection(TECHNICIAN_BLOCKED_TIME_COLLECTION).doc(blockId);

  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new SchedulingError("INVALID_INPUT", `No blocked-time record at ${blockId}.`);
    const block = snap.data() as { technicianId?: string; kind?: string; startMillis?: number; endMillis?: number };

    tx.delete(ref);
    stageAuditEvent(tx, {
      actorUid,
      action: "deleteTechnicianBlockedTime",
      targetType: "technician",
      targetId: block.technicianId ?? blockId,
      outcome: "applied",
      summary:
        `${role} ${actorUid} removed ${block.kind ?? "unrecorded"} blocked time ` +
        `${describeWindow(block.startMillis ?? null, block.endMillis ?? null)} for technician ` +
        `${block.technicianId ?? "unrecorded"} (block ${blockId}).`,
    });
  }, SCHEDULING_TRANSACTION_OPTIONS);
  return { blockId };
}
