// Work Order Engine v1.2 -- transitionWorkOrder callable.
//
// Input is { workOrderId, action } -- action-based, never a raw target
// status -- so a client can never smuggle an arbitrary transition by
// naming a status directly; the server alone resolves action -> status
// via transitionEngine.ts's ACTION_TO_STATUS.
//
// Epic 2D (see docs/architecture/ADR-003): after the transaction below
// commits successfully, triggerInventoryEffects() runs as a strictly
// post-commit side effect -- it never runs inside the transaction,
// never blocks or delays the response beyond its own execution, and a
// failure inside it is caught and logged (inventoryService.ts's own
// job) rather than ever surfacing as a transitionWorkOrder failure.
// The Work Order transition itself has already succeeded by the time
// this runs; nothing about the state machine changes here.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import { getCallerContext } from "./callerContext";
import {
  canTransition,
  getAllowedActions,
  ACTION_TO_STATUS,
  ACTION_TIMESTAMP_FIELD,
} from "./transitionEngine";
import { WORK_ORDERS_COLLECTION, SALES_ORDERS_COLLECTION } from "./constants/collections";
import { triggerInventoryEffects } from "./inventoryService";
import { findDoubleBookingConflict, findScheduleConflict } from "./workOrderAvailability";
// ND-24: THE governed placement policy, shared with the Scheduling command service so the initial
// placement and every later change cannot disagree about what a legal placement is.
import { checkPlacement } from "./scheduling/placementPolicy";
import { mapError as mapSchedulingError } from "./scheduling/errorMapping";
import { SchedulingError, type SchedulingWarning } from "./scheduling/types";
import { stageAuditEvent, stageAuditEventWithId } from "./access/auditEventWriter";
import { transitionWorkOrderAuditId } from "./workOrderTransitionMath";
import {
  applyFulfillmentAcceptance,
  type FulfillmentAcceptance,
  type SalesOrderFulfillmentLine,
} from "./salesOrder/salesOrderFulfillmentWriteBack";
import { allLinesFulfilled, checkTransition } from "./salesOrder/salesOrderLifecycle";
import type { ActionName, WorkOrder, WorkOrderStatus } from "./types/workOrder";

// Same-technician concurrency guard (site-work r3 item M). The Schedule/Dispatch branches below read the
// technician's OTHER Work Orders inside this transaction, then write only THIS Work Order doc -- Firestore only
// conflict-detects on documents actually in a transaction's read/write set, so two concurrent transitions that
// target two DIFFERENT Work Order docs for the SAME technician each see a pre-commit snapshot with no conflict
// and both can commit, bypassing the double-booking/overlap guard entirely. A per-technician sentinel document,
// deliberately read AND written inside the same transaction (mirrors inventoryService.ts's
// reservationLockRef/RESERVATION_LOCKS_COLLECTION pattern), forces write-write contention: a second concurrent
// transition for the same technician now collides on this doc and Firestore retries it, so it re-reads the
// first transition's already-committed result instead of a stale snapshot. The doc carries no scheduling data
// and is never read for availability -- it exists purely to serialize same-technician transitions.
const TECH_LOCKS_COLLECTION = "work_order_tech_locks";
const techLockRef = (db: Firestore, technicianId: string) =>
  db.collection(TECH_LOCKS_COLLECTION).doc(technicianId);

// Stored scheduling windows are Firestore Timestamps, but a Work Order written by an older path (or
// read back mid-migration) can carry a raw number. Both are read here, and anything else is null
// rather than a guess -- an audit line that says "an unrecorded window" is honest, and one that says
// "1970-01-01" is not.
function toMillisOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const millis = (value as { toMillis?: () => number } | null)?.toMillis?.();
  return typeof millis === "number" && Number.isFinite(millis) ? millis : null;
}

interface TransitionWorkOrderInput {
  workOrderId: string;
  action: ActionName;
  // Only required/used for the "Schedule" action -- these are Planning
  // (mutable) fields the dispatcher is choosing, not an execution
  // timestamp the server stamps automatically (see transitionEngine.ts's
  // comment on why Schedule is excluded from ACTION_TIMESTAMP_FIELD).
  scheduledStart?: number; // epoch ms
  scheduledEnd?: number; // epoch ms
  scheduledTechId?: string;
  // Only required/used for the "Dispatch" action -- which technician is
  // actually being dispatched (distinct from scheduledTechId, which was
  // only a planning-stage placeholder that may have changed since).
  assignedTechId?: string;
  // H20 fix (dispatch reassignment): required ONLY when a Dispatch call's assignedTechId
  // differs from the Work Order's current scheduledTechId -- i.e. the dispatcher is sending
  // this job to someone other than who it was scheduled for. A same-technician Dispatch
  // (assignedTechId === scheduledTechId, the ordinary case) never requires or records this.
  // See transitionWorkOrder()'s Dispatch branch for the enforcement.
  reassignReason?: string;
  // ND-18 (Owner ruling 2026-08-27): required for "Unschedule", and valid for nothing else.
  // Un-scheduling discards a placement a dispatcher already made and a technician may already be
  // planning around, so it is never a bare click -- the reason is what the Audit Event records
  // alongside the technician and window being given up.
  unscheduleReason?: string;
  // P1.1 (Sales->Cash fulfillment spine): Complete-only. Explicit technician-declared acceptance for
  // EQUIPMENT_MODEL/SERVICE Sales Order lines (which have no inventorySnapshot to derive from). PART actuals
  // are derived solely from governed inventorySnapshot (qtyUsed when recorded, else qtyPlanned -- completion
  // is the governed acceptance of planned usage when the tech recorded nothing else), never supplied by the
  // caller.
  fulfillmentAccepted?: FulfillmentAcceptance[];
}

function assertValidInput(data: unknown): asserts data is TransitionWorkOrderInput {
  const input = data as Partial<TransitionWorkOrderInput> | null;
  if (!input || typeof input !== "object") {
    throw new HttpsError("invalid-argument", "Request data must be an object.");
  }
  if (!input.workOrderId) {
    throw new HttpsError("invalid-argument", "workOrderId is required.");
  }
  if (!input.action || !(input.action in ACTION_TO_STATUS)) {
    throw new HttpsError("invalid-argument", `Unknown action: ${String(input.action)}`);
  }
  if (input.action === "Schedule") {
    if (!input.scheduledStart || !input.scheduledEnd || !input.scheduledTechId) {
      throw new HttpsError(
        "invalid-argument",
        "Schedule requires scheduledStart, scheduledEnd, and scheduledTechId."
      );
    }
    if (input.scheduledEnd <= input.scheduledStart) {
      throw new HttpsError("invalid-argument", "scheduledEnd must be after scheduledStart.");
    }
  }
  if (input.action === "Dispatch" && !input.assignedTechId) {
    throw new HttpsError("invalid-argument", "Dispatch requires assignedTechId.");
  }
  if (input.reassignReason !== undefined) {
    if (input.action !== "Dispatch") {
      throw new HttpsError("invalid-argument", "reassignReason is only valid for the Dispatch action.");
    }
    if (typeof input.reassignReason !== "string" || input.reassignReason.trim().length === 0) {
      throw new HttpsError("invalid-argument", "reassignReason must be a non-empty string when present.");
    }
  }
  if (input.action === "Unschedule") {
    if (typeof input.unscheduleReason !== "string" || input.unscheduleReason.trim().length === 0) {
      throw new HttpsError("invalid-argument", "Unschedule requires a non-empty unscheduleReason.");
    }
  } else if (input.unscheduleReason !== undefined) {
    throw new HttpsError("invalid-argument", "unscheduleReason is only valid for the Unschedule action.");
  }
  if (input.fulfillmentAccepted !== undefined) {
    if (input.action !== "Complete") {
      throw new HttpsError("invalid-argument", "fulfillmentAccepted is only valid for the Complete action.");
    }
    if (!Array.isArray(input.fulfillmentAccepted)) {
      throw new HttpsError("invalid-argument", "fulfillmentAccepted must be an array when present.");
    }
    for (const entry of input.fulfillmentAccepted) {
      if (
        !entry ||
        typeof entry !== "object" ||
        typeof entry.ref !== "string" ||
        entry.ref.trim().length === 0 ||
        typeof entry.kind !== "string" ||
        entry.kind.trim().length === 0 ||
        typeof entry.qty !== "number" ||
        !Number.isFinite(entry.qty) ||
        entry.qty <= 0
      ) {
        throw new HttpsError(
          "invalid-argument",
          "Each fulfillmentAccepted entry requires a non-empty ref, non-empty kind, and a positive qty."
        );
      }
      // pass4 B-2: lineId is OPTIONAL (legacy callers/tests omit it and fall back to (ref,kind) matching --
      // see salesOrderFulfillmentWriteBack.ts) but must be a non-empty string when present.
      if (entry.lineId !== undefined && (typeof entry.lineId !== "string" || entry.lineId.trim().length === 0)) {
        throw new HttpsError("invalid-argument", "fulfillmentAccepted entry lineId must be a non-empty string when present.");
      }
      if (entry.kind === "PART") {
        throw new HttpsError("invalid-argument", "fulfillmentAccepted cannot declare PART fulfillment; PART actuals are governed inventory usage.");
      }
    }
  }
}

export const transitionWorkOrder = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be signed in.");
  }

  assertValidInput(request.data);
  const { workOrderId, action, scheduledStart, scheduledEnd, scheduledTechId, assignedTechId, fulfillmentAccepted, reassignReason, unscheduleReason } =
    request.data;

  const caller = await getCallerContext(request.auth.uid);
  const actorUid = request.auth.uid;
  const db = getFirestore();
  const woRef = db.collection(WORK_ORDERS_COLLECTION).doc(workOrderId);

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(woRef);
    if (!snap.exists) {
      throw new HttpsError("not-found", `No Work Order with id ${workOrderId}`);
    }
    const wo = snap.data() as WorkOrder;

    const nextStatus = ACTION_TO_STATUS[action];
    if (!canTransition(wo.status, nextStatus)) {
      throw new HttpsError(
        "failed-precondition",
        `Invalid transition: ${wo.status} -> ${nextStatus} (action ${action})`
      );
    }

    const isOwnAssignment =
      caller.role === "technician" && !!wo.assignedTechId && wo.assignedTechId === caller.technicianId;
    const allowed = getAllowedActions(wo.status, caller.role, isOwnAssignment);
    if (!allowed.includes(action)) {
      throw new HttpsError(
        "permission-denied",
        `Role "${caller.role}" may not perform action "${action}" on this Work Order.`
      );
    }

    const payload: Record<string, unknown> = {
      status: nextStatus,
      updatedAt: FieldValue.serverTimestamp(),
    };

    // See this file's header comment on TECH_LOCKS_COLLECTION: read the same-technician sentinel doc up front
    // (Firestore requires all reads before any write in a transaction) for Schedule/Dispatch so the write below
    // puts it in this transaction's write set too, forcing contention with any other concurrent transition for
    // this same technician.
    let lockRef: ReturnType<typeof techLockRef> | null = null;
    // H20 fix: set only when Dispatch reassigns away from wo.scheduledTechId -- staged as its own Audit
    // Event (reassignWorkOrderTechnician) alongside the WO write below, in the SAME transaction, so the
    // audit record and the business mutation commit atomically (or neither does).
    let reassignmentAudit: { priorTechId: string; newTechId: string; reason: string } | null = null;
    // ND-18: the prior scheduling facts, captured before the Unschedule branch below deletes them, and
    // staged as an unscheduleWorkOrder Audit Event in this SAME transaction -- the durable record of
    // who this job was scheduled for and when, once the document no longer says.
    let unscheduleAudit: {
      priorTechId: string | null;
      priorStartMillis: number | null;
      priorEndMillis: number | null;
      reason: string;
    } | null = null;
    // ND-24: warnings from the shared placement policy on a SUCCESSFUL Schedule -- outside recorded
    // working hours, or no working hours recorded at all. ND-20 says these must not refuse, because
    // field service legitimately schedules emergency work at 02:00. They ride out on the response so
    // a dispatcher is told; discarding them here would make the placement look unremarkable.
    let scheduleWarnings: SchedulingWarning[] = [];
    if (action === "Schedule") {
      lockRef = techLockRef(db, scheduledTechId as string);
      await tx.get(lockRef);
    } else if (action === "Dispatch") {
      lockRef = techLockRef(db, assignedTechId as string);
      await tx.get(lockRef);
    } else if (action === "Unschedule" && wo.scheduledTechId) {
      // Unschedule RELEASES a technician's window, so it contends for the same sentinel as the
      // Schedule/Dispatch calls that claim one. Without this, a concurrent Schedule for the same
      // technician could read a snapshot in which this job still occupies the slot and refuse a
      // placement that is in fact free -- or, worse, the reverse once the delete commits.
      lockRef = techLockRef(db, wo.scheduledTechId);
      await tx.get(lockRef);
    }

    if (action === "Schedule") {
      // ND-24. This branch used to call findScheduleConflict directly and check nothing else, which
      // meant the INITIAL placement enforced overlap alone while Reschedule enforced the whole of
      // ND-20. Live, that let a dispatcher Schedule a job into the past or into a technician's PTO
      // and be refused for the identical window on Reschedule -- two entry points, two answers, same
      // business question.
      //
      // It now calls the SAME checkPlacement the scheduling commands call. Not a copy of the table:
      // the function itself, so the two paths cannot drift. Overlap behavior is unchanged (the policy
      // runs the same query and the same pure findScheduleConflict this branch used to run inline);
      // past start, technician eligibility and blocked time are what is new here.
      //
      // Reads only, and it runs before every write below -- Firestore's all-reads-before-writes rule
      // is why it sits here rather than beside the payload assembly.
      try {
        scheduleWarnings = await checkPlacement(tx, {
          technicianId: scheduledTechId as string,
          workOrderId,
          startMillis: scheduledStart as number,
          endMillis: scheduledEnd as number,
          nowMillis: Date.now(),
        });
      } catch (err) {
        // A SchedulingError crossing this boundary unmapped would reach the caller as a generic
        // `internal` 500 -- telling a dispatcher the system is broken when the truthful answer is
        // "that technician has PTO then". mapSchedulingError is the SAME sanitized table the
        // scheduling callables use, so a refusal reads identically whichever path produced it.
        //
        // Anything that is not a SchedulingError propagates untouched: the surrounding transaction's
        // contention and Firestore errors are not this catch's business, and swallowing them into a
        // scheduling refusal would misreport a retryable race as a business rule.
        if (err instanceof SchedulingError) throw mapSchedulingError(err);
        throw err;
      }
      payload.scheduledStart = Timestamp.fromMillis(scheduledStart as number);
      payload.scheduledEnd = Timestamp.fromMillis(scheduledEnd as number);
      payload.scheduledTechId = scheduledTechId;
    } else if (action === "Dispatch") {
      // H20 fix: a dispatcher MAY send this Work Order to a technician other than the one it was
      // Scheduled for (wo.scheduledTechId) -- but doing so is a distinct, audited event, not a silent
      // side effect of an ordinary Dispatch. A reason is required ONLY in that case; dispatching to the
      // same technician the WO was scheduled for (the ordinary path) needs none.
      const priorScheduledTechId = wo.scheduledTechId;
      const isReassignment = !!priorScheduledTechId && priorScheduledTechId !== assignedTechId;
      if (isReassignment && (!reassignReason || !reassignReason.trim())) {
        throw new HttpsError(
          "failed-precondition",
          `A reason is required to dispatch Work Order ${workOrderId} to a technician other than ` +
            `${priorScheduledTechId}, who it was scheduled for.`
        );
      }

      // Double-booking guard: a technician actively assigned to another Work Order cannot be dispatched to this
      // one. Read (inside the transaction, before the write) the technician's other Work Orders and reject if any
      // is in an occupying status. This closes the availability gap the legacy dispatch path enforced.
      const otherSnap = await tx.get(
        db.collection(WORK_ORDERS_COLLECTION).where("assignedTechId", "==", assignedTechId)
      );
      const others = otherSnap.docs.map((d) => {
        const data = d.data() as WorkOrder;
        return { id: d.id, assignedTechId: data.assignedTechId, status: data.status };
      });
      const conflict = findDoubleBookingConflict(assignedTechId as string, workOrderId, others);
      if (conflict) {
        throw new HttpsError(
          "failed-precondition",
          `Technician ${assignedTechId} is already assigned to active Work Order ${conflict}; cannot double-book.`
        );
      }

      // H20 fix: the SCHEDULE conflict guard (time-window overlap) previously ran exactly once, at Schedule
      // time, against the ORIGINALLY scheduled technician's calendar. When Dispatch sends the job to a
      // DIFFERENT technician, that technician's calendar was never checked at all -- the double-booking guard
      // was silently bypassed for the person who actually gets the job. Re-run it here, against the technician
      // actually being dispatched, using this Work Order's own already-committed scheduledStart/scheduledEnd
      // window (Dispatch does not accept a caller-supplied window -- only Schedule does).
      const scheduledStartMs = wo.scheduledStart?.toMillis?.();
      const scheduledEndMs = wo.scheduledEnd?.toMillis?.();
      if (typeof scheduledStartMs === "number" && typeof scheduledEndMs === "number") {
        const scheduleOtherSnap = await tx.get(
          db.collection(WORK_ORDERS_COLLECTION).where("scheduledTechId", "==", assignedTechId)
        );
        const scheduleOthers = scheduleOtherSnap.docs.map((d) => {
          const data = d.data() as WorkOrder;
          return {
            id: d.id,
            scheduledTechId: data.scheduledTechId,
            scheduledStart: data.scheduledStart,
            scheduledEnd: data.scheduledEnd,
            status: data.status,
          };
        });
        const scheduleConflict = findScheduleConflict(
          assignedTechId as string,
          workOrderId,
          scheduledStartMs,
          scheduledEndMs,
          scheduleOthers
        );
        if (scheduleConflict) {
          throw new HttpsError(
            "failed-precondition",
            `Technician ${assignedTechId} is already scheduled for overlapping Work Order ${scheduleConflict}.`
          );
        }
      }

      payload.assignedTechId = assignedTechId;
      // H20 fix (field reconciliation): assignedTechId is authoritative for WHO IS ACTUALLY DOING THE JOB
      // from Dispatch onward -- it is what the technician-facing boards key on, and it is what Dispatch
      // itself exists to set. scheduledTechId is authoritative only pre-Dispatch (the SCHEDULED planning
      // stage, before any assignedTechId exists). Writing scheduledTechId here too, on every Dispatch (not
      // only a reassignment), keeps the two fields in agreement going forward: the scheduling board's
      // overlap query (findScheduleConflict, keyed on scheduledTechId) stops reserving the ORIGINAL
      // technician's slot the moment the job is actually dispatched to someone else, and starts correctly
      // reflecting the technician who is now really on the hook for this time window. Before this fix the
      // two fields could disagree indefinitely: the scheduling board kept showing the original technician
      // occupied while the technician board showed the reassigned one -- exactly the H20 defect.
      payload.scheduledTechId = assignedTechId;
      payload.dispatchedAt = FieldValue.serverTimestamp();

      if (isReassignment) {
        payload.reassignedFromTechId = priorScheduledTechId;
        payload.reassignedAt = FieldValue.serverTimestamp();
        payload.reassignedReason = reassignReason;
        payload.reassignedByUid = actorUid;
      }

      reassignmentAudit = isReassignment
        ? {
            priorTechId: priorScheduledTechId as string,
            newTechId: assignedTechId as string,
            reason: reassignReason as string,
          }
        : null;
    } else if (action === "Unschedule") {
      // ND-18 (Owner ruling 2026-08-27). The only reverse edge in the lifecycle, and the only place
      // the scheduling projection is CLEARED rather than rewritten.
      //
      // Order matters here: the prior facts are captured BEFORE the deletes are staged, because once
      // this Work Order is back in READY_TO_DISPATCH nothing on the document remembers who it was
      // scheduled for or when. That memory moves into the Audit Event staged below, in this same
      // transaction. Current state may change -- history may not.
      unscheduleAudit = {
        priorTechId: wo.scheduledTechId ?? null,
        priorStartMillis: toMillisOrNull(wo.scheduledStart),
        priorEndMillis: toMillisOrNull(wo.scheduledEnd),
        reason: unscheduleReason as string,
      };

      // Deleted, not blanked. A Work Order back in the Ready queue must be indistinguishable from one
      // that was never scheduled -- a lingering empty-string scheduledTechId would keep it inside
      // findScheduleConflict's equality query and silently reserve a technician's time for a job that
      // is no longer placed. That is the H20 defect in a different costume.
      payload.scheduledStart = FieldValue.delete();
      payload.scheduledEnd = FieldValue.delete();
      payload.scheduledTechId = FieldValue.delete();

      // The reschedule snapshot describes a placement that no longer exists, so it goes too. The
      // durable rescheduleWorkOrder Audit Events stay where they are -- clearing a projection is not
      // erasing history.
      payload.rescheduledFromStart = FieldValue.delete();
      payload.rescheduledFromEnd = FieldValue.delete();
      payload.rescheduledFromTechId = FieldValue.delete();
      payload.rescheduledAt = FieldValue.delete();
      payload.rescheduledReason = FieldValue.delete();
      payload.rescheduledByUid = FieldValue.delete();
    } else {
      const timestampField = ACTION_TIMESTAMP_FIELD[action];
      if (timestampField) {
        payload[timestampField] = FieldValue.serverTimestamp();
      }
    }

    // P1.1 (Sales->Cash fulfillment spine): Complete on a Sales-Order-linked Work Order writes back accepted
    // fulfillment onto the SO's lines. Entirely NO-OP when salesOrderId is absent (most Work Orders). The SO
    // read happens here, in the read phase, before any write below (Firestore transaction rule -- all reads
    // before any write).
    let soWriteBack: {
      soRef: FirebaseFirestore.DocumentReference;
      nextLines: SalesOrderFulfillmentLine[];
      nextState?: string;
      unmatchedSummary?: string;
    } | null = null;
    // H19: when the linked Sales Order cannot be resolved, the write-back below is skipped -- Complete still
    // proceeds (whether a missing SO should instead BLOCK completion is an Owner decision, out of this lane's
    // scope). Captured here so the skip can be logged and staged as an Audit Event alongside the other writes,
    // instead of vanishing with no trace (which is exactly what happened live for wo-c713-1,2,4,5 against the
    // non-existent so-harbor-c713).
    let soWriteBackSkipped: { salesOrderId: string; reason: string } | null = null;
    if (action === "Complete" && wo.salesOrderId) {
      const soRef = db.collection(SALES_ORDERS_COLLECTION).doc(wo.salesOrderId);
      const soSnap = await tx.get(soRef);
      if (!soSnap.exists) {
        soWriteBackSkipped = {
          salesOrderId: wo.salesOrderId,
          reason: `Sales Order ${wo.salesOrderId} does not exist.`,
        };
      } else {
        const so = soSnap.data() as { state?: string; lines?: SalesOrderFulfillmentLine[] };
        const currentLines = Array.isArray(so.lines) ? so.lines : [];

        // PART lines: derive acceptance exclusively from governed inventorySnapshot, matched by canonical
        // partId<->SO ref (never sku<->ref). Completion is a role-gated, terminal, governed transition --
        // reaching it IS the governed act that accepts planned usage as actual unless the tech recorded
        // otherwise (Owner-ratified Option A). Recorded qtyUsed always overrides the planned quantity;
        // consumeParts (inventoryService.ts) already consumes qtyUsed ?? qtyPlanned, so this keeps the SO
        // write-back consistent with what was actually consumed from inventory -- closing the gap where a
        // WO could complete (a terminal, non-backfillable transition), consume inventory, but credit zero
        // fulfilledQty, wedging the Sales Order in IN_FULFILLMENT forever.
        // pass4 B-2: keyed by the snapshot row's OWN lineId when present (so two rows sharing a partId --
        // seeded from two distinct SO lines, e.g. duplicate-ref lines -- accumulate into SEPARATE acceptances
        // instead of being merged into one and checked against only the first matching SO line's remainingQty,
        // which is the false-OVERAGE deadlock this fix closes). Legacy snapshot rows without lineId fall back
        // to the old partId-only key (unchanged behavior for Work Orders created before this field existed).
        const derivedByKey = new Map<string, FulfillmentAcceptance>();
        for (const item of Array.isArray(wo.inventorySnapshot) ? wo.inventorySnapshot : []) {
          if (typeof item.partId !== "string" || item.partId.trim().length === 0) continue;
          const qty = Number.isFinite(item.qtyUsed)
            ? (item.qtyUsed as number)
            : Number.isFinite(item.qtyPlanned)
              ? (item.qtyPlanned as number)
              : 0;
          if (qty <= 0) continue;
          const lineId = typeof item.lineId === "string" && item.lineId.trim().length > 0 ? item.lineId : undefined;
          const key = lineId ? `LINE:${lineId}` : `PART:${item.partId}`;
          const existing = derivedByKey.get(key);
          derivedByKey.set(key, {
            ref: item.partId,
            kind: "PART",
            qty: (existing?.qty ?? 0) + qty,
            ...(lineId ? { lineId } : {}),
          });
        }

        // Explicit declarations are allowed only for non-PART lines that have no governed inventory actuals.
        for (const entry of (fulfillmentAccepted as FulfillmentAcceptance[] | undefined) ?? []) {
          const key = typeof entry.lineId === "string" && entry.lineId.trim().length > 0
            ? `LINE:${entry.lineId}`
            : `${entry.kind}:${entry.ref}`;
          derivedByKey.set(key, entry);
        }

        const acceptances = [...derivedByKey.values()];
        if (acceptances.length > 0) {
          try {
            const { nextLines, unmatched } = applyFulfillmentAcceptance(currentLines, acceptances);
            // Same silent-skip shape as the missing-SO case above, one level down: applyFulfillmentAcceptance
            // (salesOrderFulfillmentWriteBack.ts) deliberately does NOT throw for an acceptance that matches no
            // SO line -- by design it returns it in `unmatched` for the caller to decide what that means (its
            // own header comment). Previously this caller discarded `unmatched` entirely, so a match-key miss
            // (e.g. a part consumed that isn't actually an SO line) vanished the same way the missing-SO case
            // did. Log + note it; it does not block Complete or the rest of the write-back.
            if (unmatched.length > 0) {
              console.error(
                `transitionWorkOrder: Complete on Work Order ${workOrderId} had ${unmatched.length} fulfillment ` +
                  `acceptance(s) that matched no line on Sales Order ${wo.salesOrderId}: ` +
                  unmatched.map((u) => `${u.kind}:${u.ref}${u.lineId ? ` (lineId ${u.lineId})` : ""}`).join(", ")
              );
            }
            const autoAdvance = so.state === "IN_FULFILLMENT"
              ? checkTransition(so.state, "ADVANCE", { allLinesFulfilled: allLinesFulfilled(nextLines) })
              : null;
            soWriteBack = {
              soRef,
              nextLines,
              ...(autoAdvance?.ok ? { nextState: autoAdvance.to } : {}),
              ...(unmatched.length > 0
                ? {
                    unmatchedSummary: `${unmatched.length} acceptance(s) matched no SO line: ` +
                      unmatched.map((u) => `${u.kind}:${u.ref}${u.lineId ? ` (lineId ${u.lineId})` : ""}`).join(", "),
                  }
                : {}),
            };
          } catch (err) {
            // Fail-closed (decision #2): never silently cap/clamp/fabricate an overage. Abort the WHOLE
            // Complete transaction -- the Work Order does not complete with an un-recorded fulfillment.
            const message = err instanceof Error ? err.message : "Sales Order fulfillment write-back failed.";
            throw new HttpsError("failed-precondition", message);
          }
        }
      }
    }

    if (lockRef) {
      tx.set(lockRef, { technicianId: lockRef.id, touchedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
    tx.update(woRef, payload);

    // M9/H19 remediation: EVERY applied transition gets its own Audit Event, staged in this SAME transaction
    // as the status write above -- not only Complete-with-a-linked-Sales-Order (the salesOrderFulfillmentWriteBack
    // event below is a separate, additional record about the SO write-back, not a substitute for this one).
    // Deterministic id (workOrderId + action) -- see workOrderTransitionMath.ts's header comment for why this
    // is collision-free without a caller-supplied idempotency key.
    //
    // H20 fix (merge note): this generic event records the STATE TRANSITION only (status A -> status B) --
    // it carries no technician-identity detail and structurally cannot express a reassignment on its own.
    // When this Dispatch IS a reassignment, its summary gets a short pointer to that fact so a reader
    // scanning only this per-Work-Order trail isn't left wondering why the assignee changed; the full
    // prior-tech/new-tech/reason detail lives in the dedicated reassignWorkOrderTechnician event below,
    // staged in this SAME transaction -- one Audit Event per meaningfully distinct fact about this call,
    // not a duplicate record of the same fact twice.
    stageAuditEventWithId(tx, transitionWorkOrderAuditId(workOrderId, action), {
      actorUid,
      action: "transitionWorkOrder",
      targetType: "workOrder",
      targetId: workOrderId,
      outcome: "applied",
      summary: `${caller.role ?? "unknown"} ${actorUid} performed ${action} on Work Order ${workOrderId} (${wo.status} -> ${nextStatus})` +
        (reassignmentAudit
          ? ` -- reassigned from technician ${reassignmentAudit.priorTechId} to ${reassignmentAudit.newTechId} (see reassignWorkOrderTechnician event for the reason).`
          : ""),
    });

    if (unscheduleAudit) {
      // ND-18: an ADDITIONAL event beside the generic "transitionWorkOrder" one above, for the same
      // reason the reassignment event exists -- the generic event records SCHEDULED -> READY_TO_DISPATCH
      // and structurally cannot say which technician and which window were given up. Those facts have
      // just been deleted from the document, so if they are not here they are nowhere.
      const priorWindow =
        unscheduleAudit.priorStartMillis !== null && unscheduleAudit.priorEndMillis !== null
          ? `${new Date(unscheduleAudit.priorStartMillis).toISOString()} to ${new Date(unscheduleAudit.priorEndMillis).toISOString()}`
          : "an unrecorded window";
      stageAuditEvent(tx, {
        actorUid,
        action: "unscheduleWorkOrder",
        targetType: "workOrder",
        targetId: workOrderId,
        outcome: "applied",
        summary:
          `Work Order ${workOrderId} unscheduled from technician ${unscheduleAudit.priorTechId ?? "unrecorded"} ` +
          `(was ${priorWindow}) and returned to the Ready queue. Reason: ${unscheduleAudit.reason}`,
      });
    }

    if (reassignmentAudit) {
      // H20 fix: an ADDITIONAL event beside "transitionWorkOrder" above (same coexistence pattern as
      // salesOrderFulfillmentWriteBack beside it for Complete) -- the durable record of prior technician,
      // new technician, actor, and timestamp (actorUid/`at` are always captured by stageAuditEvent itself),
      // plus the dispatcher's reason in `summary`. Staged in the SAME transaction as the WO write above, so
      // the audit trail and the reassignment commit atomically together.
      //
      // NOTIFICATION: this repo has no notification/messaging delivery mechanism today (no push, email, or
      // in-app "notify this technician" pipeline exists anywhere in functions/src or field-ops-app-vite --
      // NotificationPanel.jsx is a reorder-request-only projection, unrelated). Per the Owner ruling this
      // fix does NOT invent one. This Audit Event is the intended integration point: a future notifier
      // would subscribe to `reassignWorkOrderTechnician` events (or auditEvents generally) and notify the
      // prior technician (no longer on this job), the new technician (now on it), and the dispatcher of
      // record. Notification delivery remains UNIMPLEMENTED and needs its own, separately authorized slice.
      stageAuditEvent(tx, {
        actorUid,
        action: "reassignWorkOrderTechnician",
        targetType: "workOrder",
        targetId: workOrderId,
        outcome: "applied",
        summary: `Work Order ${workOrderId} dispatch reassigned from technician ${reassignmentAudit.priorTechId} ` +
          `to ${reassignmentAudit.newTechId}. Reason: ${reassignmentAudit.reason} ` +
          `(Notification not yet implemented -- see this event for the future notifier trigger.)`,
      });
    }

    if (soWriteBack) {
      tx.update(soWriteBack.soRef, {
        lines: soWriteBack.nextLines,
        ...(soWriteBack.nextState ? { state: soWriteBack.nextState } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      });
      stageAuditEvent(tx, {
        actorUid,
        action: "salesOrderFulfillmentWriteBack",
        targetType: "salesOrder",
        targetId: wo.salesOrderId as string,
        outcome: "applied",
        summary: `Work Order ${workOrderId} Complete wrote back fulfillment to Sales Order ${wo.salesOrderId}` +
          (soWriteBack.unmatchedSummary ? `; ${soWriteBack.unmatchedSummary}` : ""),
      });
    }
    if (soWriteBackSkipped) {
      // H19 fix: the write-back is still skipped (whether a missing SO should instead block Complete is an
      // Owner decision, not this lane's to make) -- but the skip is now observable: a server-side log line
      // naming both ids, plus a durable Audit Event so a query over auditEvents surfaces every occurrence
      // instead of relying on someone noticing inventory moved with no matching SO fulfillment.
      console.error(
        `transitionWorkOrder: Complete on Work Order ${workOrderId} could not write back fulfillment -- ` +
          `linked Sales Order ${soWriteBackSkipped.salesOrderId} was not found. ${soWriteBackSkipped.reason}`
      );
      stageAuditEvent(tx, {
        actorUid,
        action: "salesOrderFulfillmentWriteBack",
        targetType: "salesOrder",
        targetId: soWriteBackSkipped.salesOrderId,
        outcome: "uncertain",
        summary: `Work Order ${workOrderId} Complete skipped Sales Order fulfillment write-back: ${soWriteBackSkipped.reason} The Work Order still completed.`,
      });
    }
    // ND-24: warnings are part of a SUCCESSFUL Schedule response, exactly as they already are for
    // reschedule and reassign. Empty for every other action, and empty for a Schedule with nothing to
    // say -- so no existing caller sees a shape it did not before, it just gains a field.
    return { id: workOrderId, status: nextStatus, warnings: scheduleWarnings };
  });

  // Post-commit only -- see header comment. Never throws: a failure
  // here is inventoryService.ts's own concern (logged in
  // inventory_sync_status for later retry), not this callable's.
  await triggerInventoryEffects(result.id, result.status as WorkOrderStatus);

  return result;
});
