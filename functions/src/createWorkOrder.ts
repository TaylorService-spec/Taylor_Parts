// Work Order Engine v1.2 -- createWorkOrder callable.
//
// Only admin/dispatcher may call this (see the Create row of the
// permissions matrix, functions/src/transitionEngine.ts's
// ACTION_PERMISSIONS). This is the first of exactly two ways
// fieldops_wos is ever written -- firestore.rules denies all direct
// client writes to that collection unconditionally.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue, type Firestore, type Transaction } from "firebase-admin/firestore";
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

// The governed Work Order creation CORE, factored out so the callable AND other trusted server commands (e.g.
// the Sales Order → Service seam) create Work Orders through the SAME authority instead of duplicating it.
// `salesOrderId` is an optional DEMAND-LINEAGE link: a Work Order created to fulfill a Sales Order carries it
// so the same underlying parts demand is never double-counted (ATP counts SO-origin demand via the Sales
// Order allocation, not again via this Work Order's reservation). Must be called inside a transaction.
export async function createWorkOrderRecord(
  db: Firestore,
  tx: Transaction,
  // `type` is optional here (a Work Order is valid with EITHER a type OR a complaint — see assertValidInput);
  // callers that omit both must supply a complaint. `salesOrderId`/`salesOrderLineRefs` are the demand-lineage link.
  input: Omit<CreateWorkOrderInput, "type"> & { type?: WorkOrderType; salesOrderId?: string; salesOrderLineRefs?: string[] },
  nowYear: number
): Promise<{ id: string; woNumber: string }> {
  const { woNumber } = await allocateWorkOrderNumber(tx, nowYear);
  const woRef = db.collection(WORK_ORDERS_COLLECTION).doc();
  tx.set(woRef, {
    woNumber,
    status: "CREATED",
    priority: input.priority,
    ...(input.severity ? { severity: input.severity } : {}),
    ...(input.type ? { type: input.type } : {}),
    customerId: input.customerId,
    locationId: input.locationId,
    ...(input.complaint ? { complaint: input.complaint } : {}),
    ...(input.salesOrderId ? { salesOrderId: input.salesOrderId } : {}),
    ...(Array.isArray(input.salesOrderLineRefs) && input.salesOrderLineRefs.length ? { salesOrderLineRefs: input.salesOrderLineRefs } : {}),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { id: woRef.id, woNumber };
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

  return db.runTransaction(async (tx) => createWorkOrderRecord(db, tx, { customerId, locationId, priority, severity, type, complaint }, year));
});
