"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PAST_START_TOLERANCE_MS = void 0;
exports.rescheduleWorkOrder = rescheduleWorkOrder;
exports.reassignScheduledWorkOrder = reassignScheduledWorkOrder;
exports.setWorkOrderEstimatedDuration = setWorkOrderEstimatedDuration;
exports.setTechnicianWorkingAvailability = setTechnicianWorkingAvailability;
exports.createTechnicianBlockedTime = createTechnicianBlockedTime;
exports.deleteTechnicianBlockedTime = deleteTechnicianBlockedTime;
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
const firestore_1 = require("firebase-admin/firestore");
const callerContext_1 = require("../callerContext");
const collections_1 = require("../constants/collections");
const auditEventWriter_1 = require("../access/auditEventWriter");
const availabilityModel_1 = require("./availabilityModel");
const placementPolicy_1 = require("./placementPolicy");
Object.defineProperty(exports, "PAST_START_TOLERANCE_MS", { enumerable: true, get: function () { return placementPolicy_1.PAST_START_TOLERANCE_MS; } });
const schedulingRepository_1 = require("./schedulingRepository");
const types_1 = require("./types");
const validation_1 = require("./validation");
// The same sentinel collection transitionWorkOrder.ts serializes on. Named here rather than imported
// because that module does not export it -- if either name changes, both must. A scheduling command
// that took a DIFFERENT lock would serialize against nothing, which is worse than taking none at all
// because it would look like it was protected.
const TECH_LOCKS_COLLECTION = "work_order_tech_locks";
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
const SCHEDULING_TRANSACTION_OPTIONS = { maxAttempts: 10 };
function unwrap(result, field) {
    if (result.valid)
        return result.value;
    const detail = result.errors.map((e) => `${e.path}:${e.code}`).join(", ");
    throw new types_1.SchedulingError("INVALID_INPUT", `${field} is invalid (${detail}).`);
}
async function requireDispatcher(actorUid) {
    const caller = await (0, callerContext_1.getCallerContext)(actorUid);
    // Owner ruling 2026-08-27: the same admin/dispatcher bucket ACTION_PERMISSIONS already uses for
    // Schedule and Dispatch. No new capability is registered -- a second authorization pattern before
    // any demonstrated need for finer separation would be a cost with no buyer.
    if (caller.role !== "admin" && caller.role !== "dispatcher") {
        throw new types_1.SchedulingError("PERMISSION_DENIED", "Only an admin or dispatcher may change a schedule.");
    }
    return caller.role;
}
function toMillisOrNull(value) {
    if (typeof value === "number" && Number.isFinite(value))
        return value;
    const millis = value?.toMillis?.();
    return typeof millis === "number" && Number.isFinite(millis) ? millis : null;
}
function describeWindow(startMillis, endMillis) {
    if (startMillis === null || endMillis === null)
        return "an unrecorded window";
    return `${new Date(startMillis).toISOString()} to ${new Date(endMillis).toISOString()}`;
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
async function applyScheduleChange(actorUid, auditAction, input, nowMillis) {
    const role = await requireDispatcher(actorUid);
    const woRef = (0, schedulingRepository_1.db)().collection(collections_1.WORK_ORDERS_COLLECTION).doc(input.workOrderId);
    return (0, schedulingRepository_1.db)().runTransaction(async (tx) => {
        const snap = await tx.get(woRef);
        if (!snap.exists) {
            throw new types_1.SchedulingError("WORK_ORDER_NOT_FOUND", `No Work Order with id ${input.workOrderId}.`);
        }
        const wo = snap.data();
        // A Work Order that is not SCHEDULED has no schedule to change. This is the refusal that keeps
        // these commands out of the lifecycle: they cannot be used to place unplaced work (that is
        // Schedule), and they cannot be used to re-time a job a technician is already driving to (that is
        // committed -- see ND-18's reasoning, which applies identically here).
        if (wo.status !== "SCHEDULED") {
            throw new types_1.SchedulingError("NOT_SCHEDULED", `Work Order ${input.workOrderId} is ${wo.status}, so its schedule cannot be changed.`);
        }
        const priorTechId = wo.scheduledTechId ?? null;
        const priorStart = toMillisOrNull(wo.scheduledStart);
        const priorEnd = toMillisOrNull(wo.scheduledEnd);
        if (input.expectedScheduledStart !== undefined && input.expectedScheduledStart !== priorStart) {
            throw new types_1.SchedulingError("STALE_WORK_ORDER", "This Work Order's schedule changed since it was loaded. Reload and try again.");
        }
        // Serialize against every other schedule-touching transaction for this technician, exactly as
        // transitionWorkOrder does. Read before any write, per Firestore's transaction rule.
        const lockRef = (0, schedulingRepository_1.db)().collection(TECH_LOCKS_COLLECTION).doc(input.technicianId);
        await tx.get(lockRef);
        const warnings = await (0, placementPolicy_1.checkPlacement)(tx, {
            technicianId: input.technicianId,
            workOrderId: input.workOrderId,
            startMillis: input.startMillis,
            endMillis: input.endMillis,
            nowMillis,
        });
        tx.set(lockRef, { technicianId: input.technicianId, touchedAt: firestore_1.FieldValue.serverTimestamp() }, { merge: true });
        tx.update(woRef, {
            scheduledTechId: input.technicianId,
            scheduledStart: firestore_1.Timestamp.fromMillis(input.startMillis),
            scheduledEnd: firestore_1.Timestamp.fromMillis(input.endMillis),
            // The denormalized snapshot of the placement being given up -- for board display only. It is
            // the LATEST change, not the history: a second reschedule overwrites it. The append-only record
            // is the Audit Event staged below, in this same transaction.
            ...(priorStart !== null ? { rescheduledFromStart: firestore_1.Timestamp.fromMillis(priorStart) } : {}),
            ...(priorEnd !== null ? { rescheduledFromEnd: firestore_1.Timestamp.fromMillis(priorEnd) } : {}),
            ...(priorTechId ? { rescheduledFromTechId: priorTechId } : {}),
            rescheduledAt: firestore_1.FieldValue.serverTimestamp(),
            rescheduledReason: input.reason,
            rescheduledByUid: actorUid,
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
            // status is deliberately NOT written. ND-19: this is a plan change, not a transition.
        });
        // Historical integrity, which is the whole reason this event carries the prior facts rather than
        // just the new ones: the document now says the new technician and the new window, and without
        // this line nothing anywhere would remember the old ones.
        (0, auditEventWriter_1.stageAuditEvent)(tx, {
            actorUid,
            action: auditAction,
            targetType: "workOrder",
            targetId: input.workOrderId,
            outcome: "applied",
            summary: `${role} ${actorUid} moved Work Order ${input.workOrderId} from technician ${priorTechId ?? "unrecorded"} ` +
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
async function rescheduleWorkOrder(actorUid, raw, nowMillis = Date.now()) {
    const data = (raw ?? {});
    const workOrderId = unwrap((0, validation_1.parseTechnicianId)(data.workOrderId, "workOrderId"), "workOrderId");
    const reason = unwrap((0, validation_1.parseReason)(data.reason), "reason");
    const window = unwrap((0, validation_1.parseScheduleWindow)(data), "window");
    // The technician is optional: a plain re-time keeps whoever is already on the job. Resolved inside
    // the transaction so it reads the stored value rather than whatever the client believed it was.
    const technicianId = data.scheduledTechId === undefined || data.scheduledTechId === null
        ? null
        : unwrap((0, validation_1.parseTechnicianId)(data.scheduledTechId, "scheduledTechId"), "scheduledTechId");
    const resolvedTechnicianId = technicianId ?? (await resolveCurrentTechnician(workOrderId));
    return applyScheduleChange(actorUid, "rescheduleWorkOrder", {
        workOrderId,
        reason,
        technicianId: resolvedTechnicianId,
        startMillis: window.startMillis,
        endMillis: window.endMillis,
        ...(typeof data.expectedScheduledStart === "number"
            ? { expectedScheduledStart: data.expectedScheduledStart }
            : {}),
    }, nowMillis);
}
/** Move a SCHEDULED Work Order to a different technician, keeping its window. */
async function reassignScheduledWorkOrder(actorUid, raw, nowMillis = Date.now()) {
    const data = (raw ?? {});
    const workOrderId = unwrap((0, validation_1.parseTechnicianId)(data.workOrderId, "workOrderId"), "workOrderId");
    const technicianId = unwrap((0, validation_1.parseTechnicianId)(data.scheduledTechId, "scheduledTechId"), "scheduledTechId");
    const reason = unwrap((0, validation_1.parseReason)(data.reason), "reason");
    // The window comes from the RECORD, never the caller. A reassignment that also silently re-timed
    // the job would be two changes wearing one reason.
    const snap = await (0, schedulingRepository_1.db)().collection(collections_1.WORK_ORDERS_COLLECTION).doc(workOrderId).get();
    if (!snap.exists)
        throw new types_1.SchedulingError("WORK_ORDER_NOT_FOUND", `No Work Order with id ${workOrderId}.`);
    const wo = snap.data();
    const startMillis = toMillisOrNull(wo.scheduledStart);
    const endMillis = toMillisOrNull(wo.scheduledEnd);
    if (startMillis === null || endMillis === null) {
        throw new types_1.SchedulingError("NOT_SCHEDULED", `Work Order ${workOrderId} has no scheduled window to reassign.`);
    }
    return applyScheduleChange(actorUid, "reassignScheduledWorkOrder", {
        workOrderId,
        reason,
        technicianId,
        startMillis,
        endMillis,
        ...(typeof data.expectedScheduledStart === "number"
            ? { expectedScheduledStart: data.expectedScheduledStart }
            : {}),
    }, nowMillis);
}
async function resolveCurrentTechnician(workOrderId) {
    const snap = await (0, schedulingRepository_1.db)().collection(collections_1.WORK_ORDERS_COLLECTION).doc(workOrderId).get();
    if (!snap.exists)
        throw new types_1.SchedulingError("WORK_ORDER_NOT_FOUND", `No Work Order with id ${workOrderId}.`);
    const techId = snap.data().scheduledTechId;
    if (!techId) {
        throw new types_1.SchedulingError("NOT_SCHEDULED", `Work Order ${workOrderId} is not scheduled to a technician.`);
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
async function setWorkOrderEstimatedDuration(actorUid, raw) {
    const role = await requireDispatcher(actorUid);
    const data = (raw ?? {});
    const workOrderId = unwrap((0, validation_1.parseTechnicianId)(data.workOrderId, "workOrderId"), "workOrderId");
    const minutes = unwrap((0, validation_1.parseEstimatedDurationMinutes)(data.estimatedDurationMinutes), "estimatedDurationMinutes");
    const woRef = (0, schedulingRepository_1.db)().collection(collections_1.WORK_ORDERS_COLLECTION).doc(workOrderId);
    await (0, schedulingRepository_1.db)().runTransaction(async (tx) => {
        const snap = await tx.get(woRef);
        if (!snap.exists)
            throw new types_1.SchedulingError("WORK_ORDER_NOT_FOUND", `No Work Order with id ${workOrderId}.`);
        const prior = snap.data().estimatedDurationMinutes ?? null;
        tx.update(woRef, {
            estimatedDurationMinutes: minutes === null ? firestore_1.FieldValue.delete() : minutes,
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        });
        (0, auditEventWriter_1.stageAuditEvent)(tx, {
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
async function setTechnicianWorkingAvailability(actorUid, raw) {
    const role = await requireDispatcher(actorUid);
    const input = unwrap((0, validation_1.validateWorkingAvailabilityInput)(raw), "workingAvailability");
    const ref = (0, schedulingRepository_1.db)().collection(types_1.TECHNICIAN_WORKING_AVAILABILITY_COLLECTION).doc(input.technicianId);
    await (0, schedulingRepository_1.db)().runTransaction(async (tx) => {
        const technician = await (0, schedulingRepository_1.loadTechnician)(tx, input.technicianId);
        if (!technician) {
            throw new types_1.SchedulingError("TECHNICIAN_NOT_FOUND", `No technician record exists at ${input.technicianId}.`);
        }
        const priorDays = Object.keys((await tx.get(ref)).data()?.weeklyHours ?? {}).length;
        tx.set(ref, {
            technicianId: input.technicianId,
            timeZone: input.timeZone,
            weeklyHours: input.weeklyHours,
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
            updatedByUid: actorUid,
        });
        (0, auditEventWriter_1.stageAuditEvent)(tx, {
            actorUid,
            action: "setTechnicianWorkingAvailability",
            targetType: "technician",
            targetId: input.technicianId,
            outcome: "applied",
            summary: `${role} ${actorUid} set the working schedule for technician ${input.technicianId} in ${input.timeZone} ` +
                `(${priorDays} weekday(s) recorded before, ${Object.keys(input.weeklyHours).length} after).`,
        });
    }, SCHEDULING_TRANSACTION_OPTIONS);
    return { technicianId: input.technicianId };
}
/**
 * Record one dated absence.
 *
 * Enforcement in both directions, and they are not symmetric. Blocked time REFUSES an overlapping
 * PLACEMENT (checkPlacement), and since ND-25 an overlapping ABSENCE is refused here -- but a
 * placement already sitting in the window is not, and must not be. See the reasoning inline.
 */
async function createTechnicianBlockedTime(actorUid, raw) {
    const role = await requireDispatcher(actorUid);
    const input = unwrap((0, validation_1.validateBlockedTimeInput)(raw), "blockedTime");
    const ref = (0, schedulingRepository_1.db)().collection(types_1.TECHNICIAN_BLOCKED_TIME_COLLECTION).doc();
    const lockRef = (0, schedulingRepository_1.db)().collection(TECH_LOCKS_COLLECTION).doc(input.technicianId);
    await (0, schedulingRepository_1.db)().runTransaction(async (tx) => {
        // Serialize against every other blocked-time write for this technician, on the SAME sentinel the
        // placement commands take. This read is not optional and it is not defensive habit: the overlap
        // check below is a query-then-insert, and a transactional query locks only the documents it
        // RETURNS. A record that does not exist yet is not in that set, so two concurrent creates would
        // each query, each find nothing, and each commit -- the classic check-then-act race, with a guard
        // in front of it that looks like protection and is not. Writing the sentinel below puts it in
        // this transaction's WRITE set, which is what actually forces contention.
        await tx.get(lockRef);
        const technician = await (0, schedulingRepository_1.loadTechnician)(tx, input.technicianId);
        if (!technician) {
            throw new types_1.SchedulingError("TECHNICIAN_NOT_FOUND", `No technician record exists at ${input.technicianId}.`);
        }
        // ND-25: one technician's absences may not overlap each other.
        //
        // This is not new business policy, it is the model refusing a record it cannot represent. A
        // blocked-time record asserts exactly one fact -- "this technician is unavailable from A to B".
        // A second record overlapping the first asserts that same fact again with a different label, and
        // every consumer in this domain reads the set as a UNION, so the second one adds no availability
        // information at all. What it does add is arithmetic that disagrees with itself:
        //
        //   availabilityModel.blockedMinutesInWindow  walks minutes, so it DE-DUPLICATES the overlap
        //   dispatchBoardGeometry.blockedMinutesInBand  sums durations, so it DOUBLE-COUNTS it
        //
        // Both numbers are drawn on the same lane. A duplicate PTO record from a double-clicked form --
        // there is no idempotency key on this command and nothing else stops one -- makes an eight-hour
        // day report sixteen hours blocked on one line and eight on another. Removing the overlap at the
        // write path makes sum == union by construction, which fixes both readers at once and does not
        // leave a reconciler behind to rot.
        //
        // It also makes deletion honest. Under overlap, deleting one of two identical PTO records leaves
        // the technician still fully blocked while staging an Audit Event that says the absence was
        // removed -- current state and history disagreeing, which is the one thing this domain's audit
        // contract exists to prevent.
        //
        // Reuses loadBlockedTime + findBlockedTimeConflict: the SAME query, the SAME composite index
        // (technicianId ASC, endMillis ASC) and the SAME half-open overlap test checkPlacement uses to
        // refuse a PLACEMENT into blocked time. No second overlap rule, and no second index.
        const existingBlocks = await (0, schedulingRepository_1.loadBlockedTime)(tx, input.technicianId, input.startMillis);
        const overlapping = (0, availabilityModel_1.findBlockedTimeConflict)(existingBlocks, input.startMillis, input.endMillis);
        if (overlapping) {
            throw new types_1.SchedulingError("BLOCKED_TIME_CONFLICT", `Technician ${input.technicianId} already has ${overlapping.kind} blocked time ` +
                `${describeWindow(overlapping.startMillis, overlapping.endMillis)} overlapping that window ` +
                `(block ${overlapping.blockId}).`);
        }
        // Blocked time is still NOT checked against existing scheduled WORK, and that asymmetry is
        // deliberate. Recording that someone is on PTO must never be refused because a job was already
        // placed there -- the absence is the fact, and the placement is the problem. The board surfaces
        // that collision so a dispatcher can move the job, which is a decision a person makes. An
        // absence colliding with ANOTHER ABSENCE is a different situation entirely: there is no job to
        // move and no decision to make, only a record that says nothing new.
        tx.set(lockRef, { technicianId: input.technicianId, touchedAt: firestore_1.FieldValue.serverTimestamp() }, { merge: true });
        tx.set(ref, {
            blockId: ref.id,
            technicianId: input.technicianId,
            kind: input.kind,
            startMillis: input.startMillis,
            endMillis: input.endMillis,
            ...(input.note ? { note: input.note } : {}),
            createdAt: firestore_1.FieldValue.serverTimestamp(),
            createdByUid: actorUid,
        });
        (0, auditEventWriter_1.stageAuditEvent)(tx, {
            actorUid,
            action: "createTechnicianBlockedTime",
            targetType: "technician",
            targetId: input.technicianId,
            outcome: "applied",
            summary: `${role} ${actorUid} recorded ${input.kind} blocked time ${describeWindow(input.startMillis, input.endMillis)} ` +
                `for technician ${input.technicianId} (block ${ref.id}).`,
        });
    }, SCHEDULING_TRANSACTION_OPTIONS);
    return { blockId: ref.id };
}
/** Remove one blocked-time record. The deletion itself is audited, so a vanished absence is explicable. */
async function deleteTechnicianBlockedTime(actorUid, raw) {
    const role = await requireDispatcher(actorUid);
    const data = (raw ?? {});
    const blockId = unwrap((0, validation_1.parseTechnicianId)(data.blockId, "blockId"), "blockId");
    const ref = (0, schedulingRepository_1.db)().collection(types_1.TECHNICIAN_BLOCKED_TIME_COLLECTION).doc(blockId);
    await (0, schedulingRepository_1.db)().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists)
            throw new types_1.SchedulingError("INVALID_INPUT", `No blocked-time record at ${blockId}.`);
        const block = snap.data();
        // Removing an absence RELEASES a window, so it contends for the same sentinel the create above
        // claims one on -- the same reason ND-18's Unschedule takes it (transitionWorkOrder.ts). Without
        // this, a dispatcher correcting a mistake by deleting one record and adding a wider one could
        // have the create read a snapshot in which the deleted block still exists and be refused for a
        // window that is in fact free. Read before write, as Firestore requires; the id comes from the
        // block document, which is why this read cannot be hoisted above it.
        const lockRef = block.technicianId
            ? (0, schedulingRepository_1.db)().collection(TECH_LOCKS_COLLECTION).doc(block.technicianId)
            : null;
        if (lockRef) {
            await tx.get(lockRef);
            tx.set(lockRef, { technicianId: block.technicianId, touchedAt: firestore_1.FieldValue.serverTimestamp() }, { merge: true });
        }
        tx.delete(ref);
        (0, auditEventWriter_1.stageAuditEvent)(tx, {
            actorUid,
            action: "deleteTechnicianBlockedTime",
            targetType: "technician",
            targetId: block.technicianId ?? blockId,
            outcome: "applied",
            summary: `${role} ${actorUid} removed ${block.kind ?? "unrecorded"} blocked time ` +
                `${describeWindow(block.startMillis ?? null, block.endMillis ?? null)} for technician ` +
                `${block.technicianId ?? "unrecorded"} (block ${blockId}).`,
        });
    }, SCHEDULING_TRANSACTION_OPTIONS);
    return { blockId };
}
//# sourceMappingURL=schedulingCommands.js.map