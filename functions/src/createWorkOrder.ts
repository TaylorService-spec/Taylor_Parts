// Work Order Engine v1.2 -- createWorkOrder callable.
//
// Only admin/dispatcher may call this (see the Create row of the
// permissions matrix, functions/src/transitionEngine.ts's
// ACTION_PERMISSIONS). This is the first of exactly two ways
// fieldops_wos is ever written -- firestore.rules denies all direct
// client writes to that collection unconditionally.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getCallerContext } from "./callerContext";
import { allocateWorkOrderNumber } from "./woNumbering";
import { WORK_ORDERS_COLLECTION } from "./constants/collections";
import type { Priority, Severity, WorkOrderType } from "./types/workOrder";

interface CreateWorkOrderInput {
  customerId: string;
  locationId: string;
  priority: Priority;
  severity?: Severity;
  type: WorkOrderType;
  complaint?: string;
}

function assertValidInput(data: unknown): asserts data is CreateWorkOrderInput {
  const input = data as Partial<CreateWorkOrderInput> | null;
  if (!input || typeof input !== "object") {
    throw new HttpsError("invalid-argument", "Request data must be an object.");
  }
  if (!input.customerId) {
    throw new HttpsError("invalid-argument", "customerId is required.");
  }
  if (!input.locationId) {
    throw new HttpsError("invalid-argument", "locationId is required.");
  }
  if (![1, 2, 3, 4].includes(input.priority as number)) {
    throw new HttpsError("invalid-argument", "priority is required and must be 1-4.");
  }
  if (!input.type && !input.complaint) {
    throw new HttpsError(
      "invalid-argument",
      "Either complaint or type (service classification) is required."
    );
  }
}

export const createWorkOrder = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be signed in.");
  }

  const caller = await getCallerContext(request.auth.uid);
  if (caller.role !== "admin" && caller.role !== "dispatcher") {
    throw new HttpsError("permission-denied", "Only admin/dispatcher may create Work Orders.");
  }

  assertValidInput(request.data);
  const { customerId, locationId, priority, severity, type, complaint } = request.data;

  const db = getFirestore();
  const year = new Date().getFullYear();

  return db.runTransaction(async (tx) => {
    const { woNumber } = await allocateWorkOrderNumber(tx, year);
    const woRef = db.collection(WORK_ORDERS_COLLECTION).doc();

    tx.set(woRef, {
      woNumber,
      status: "CREATED",
      priority,
      ...(severity ? { severity } : {}),
      type,
      customerId,
      locationId,
      ...(complaint ? { complaint } : {}),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return { id: woRef.id, woNumber };
  });
});
