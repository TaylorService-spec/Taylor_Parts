// Work Order Engine v1.2 -- transitionWorkOrder callable.
//
// Input is { workOrderId, action } -- action-based, never a raw target
// status -- so a client can never smuggle an arbitrary transition by
// naming a status directly; the server alone resolves action -> status
// via transitionEngine.ts's ACTION_TO_STATUS.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { getCallerContext } from "./callerContext";
import {
  canTransition,
  getAllowedActions,
  ACTION_TO_STATUS,
  ACTION_TIMESTAMP_FIELD,
} from "./transitionEngine";
import { WORK_ORDERS_COLLECTION } from "./constants/collections";
import type { ActionName, WorkOrder } from "./types/workOrder";

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
  }
  if (input.action === "Dispatch" && !input.assignedTechId) {
    throw new HttpsError("invalid-argument", "Dispatch requires assignedTechId.");
  }
}

export const transitionWorkOrder = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be signed in.");
  }

  assertValidInput(request.data);
  const { workOrderId, action, scheduledStart, scheduledEnd, scheduledTechId, assignedTechId } =
    request.data;

  const caller = await getCallerContext(request.auth.uid);
  const db = getFirestore();
  const woRef = db.collection(WORK_ORDERS_COLLECTION).doc(workOrderId);

  return db.runTransaction(async (tx) => {
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

    if (action === "Schedule") {
      payload.scheduledStart = Timestamp.fromMillis(scheduledStart as number);
      payload.scheduledEnd = Timestamp.fromMillis(scheduledEnd as number);
      payload.scheduledTechId = scheduledTechId;
    } else if (action === "Dispatch") {
      payload.assignedTechId = assignedTechId;
      payload.dispatchedAt = FieldValue.serverTimestamp();
    } else {
      const timestampField = ACTION_TIMESTAMP_FIELD[action];
      if (timestampField) {
        payload[timestampField] = FieldValue.serverTimestamp();
      }
    }

    tx.update(woRef, payload);
    return { id: workOrderId, status: nextStatus };
  });
});
