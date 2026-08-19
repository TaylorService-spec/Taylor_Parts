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
  const { workOrderId, action, scheduledStart, scheduledEnd, scheduledTechId, assignedTechId, fulfillmentAccepted } =
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
    if (action === "Schedule") {
      lockRef = techLockRef(db, scheduledTechId as string);
      await tx.get(lockRef);
    } else if (action === "Dispatch") {
      lockRef = techLockRef(db, assignedTechId as string);
      await tx.get(lockRef);
    }

    if (action === "Schedule") {
      const otherSnap = await tx.get(
        db.collection(WORK_ORDERS_COLLECTION).where("scheduledTechId", "==", scheduledTechId)
      );
      const others = otherSnap.docs.map((d) => {
        const data = d.data() as WorkOrder;
        return { id: d.id, scheduledTechId: data.scheduledTechId, scheduledStart: data.scheduledStart, scheduledEnd: data.scheduledEnd, status: data.status };
      });
      const conflict = findScheduleConflict(scheduledTechId as string, workOrderId, scheduledStart as number, scheduledEnd as number, others);
      if (conflict) throw new HttpsError("failed-precondition", `Technician ${scheduledTechId} is already scheduled for overlapping Work Order ${conflict}.`);
      payload.scheduledStart = Timestamp.fromMillis(scheduledStart as number);
      payload.scheduledEnd = Timestamp.fromMillis(scheduledEnd as number);
      payload.scheduledTechId = scheduledTechId;
    } else if (action === "Dispatch") {
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
      payload.assignedTechId = assignedTechId;
      payload.dispatchedAt = FieldValue.serverTimestamp();
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
    } | null = null;
    if (action === "Complete" && wo.salesOrderId) {
      const soRef = db.collection(SALES_ORDERS_COLLECTION).doc(wo.salesOrderId);
      const soSnap = await tx.get(soRef);
      if (soSnap.exists) {
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
            const { nextLines } = applyFulfillmentAcceptance(currentLines, acceptances);
            const autoAdvance = so.state === "IN_FULFILLMENT"
              ? checkTransition(so.state, "ADVANCE", { allLinesFulfilled: allLinesFulfilled(nextLines) })
              : null;
            soWriteBack = {
              soRef,
              nextLines,
              ...(autoAdvance?.ok ? { nextState: autoAdvance.to } : {}),
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
    stageAuditEventWithId(tx, transitionWorkOrderAuditId(workOrderId, action), {
      actorUid,
      action: "transitionWorkOrder",
      targetType: "workOrder",
      targetId: workOrderId,
      outcome: "applied",
      summary: `${caller.role ?? "unknown"} ${actorUid} performed ${action} on Work Order ${workOrderId} (${wo.status} -> ${nextStatus})`,
    });

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
        summary: `Work Order ${workOrderId} Complete wrote back fulfillment to Sales Order ${wo.salesOrderId}`,
      });
    }
    return { id: workOrderId, status: nextStatus };
  });

  // Post-commit only -- see header comment. Never throws: a failure
  // here is inventoryService.ts's own concern (logged in
  // inventory_sync_status for later retry), not this callable's.
  await triggerInventoryEffects(result.id, result.status as WorkOrderStatus);

  return result;
});
