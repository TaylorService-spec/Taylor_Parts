// Epic 6 Phase 6.3 -- Field Execution Capture. A deliberately narrow,
// separate callable from transitionWorkOrder() -- never touches
// status, assignedTechId, or any of transitionEngine.ts's lifecycle
// timestamp fields. This is the ONLY write path for qtyUsed/
// executionLog/lastUpdated; firestore.rules denies all direct client
// writes to fieldops_wos unconditionally (see that file's comment --
// "no future path for an admin UI to grow a direct-write shortcut
// around the Cloud Functions"), so this had to be a Cloud Function,
// not a client-side write, exactly like createWorkOrder/
// transitionWorkOrder already are.
//
// Same structural pattern as transitionWorkOrder.ts: onCall + HttpsError
// + getCallerContext + a single runTransaction doing read-verify-write.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { getCallerContext } from "./callerContext";
import { WORK_ORDERS_COLLECTION } from "./constants/collections";
import type { WorkOrder, InventorySnapshotItem } from "./types/workOrder";

interface QtyUsedDelta {
  sku: string;
  delta: number; // positive to increment, negative to decrement -- see Step 2's "increment/decrement parts used"
}

interface UpdateWorkOrderExecutionDataInput {
  workOrderId: string;
  qtyUsedUpdates?: QtyUsedDelta[];
  executionNote?: string;
}

interface UpdateWorkOrderExecutionDataResult {
  success: true;
  workOrderId: string;
  updatedFields: string[];
}

function assertValidInput(data: unknown): asserts data is UpdateWorkOrderExecutionDataInput {
  const input = data as Partial<UpdateWorkOrderExecutionDataInput> | null;
  if (!input || typeof input !== "object") {
    throw new HttpsError("invalid-argument", "Request data must be an object.");
  }
  if (!input.workOrderId) {
    throw new HttpsError("invalid-argument", "workOrderId is required.");
  }

  const hasQtyUpdates = Array.isArray(input.qtyUsedUpdates) && input.qtyUsedUpdates.length > 0;
  const hasNote = typeof input.executionNote === "string" && input.executionNote.trim().length > 0;
  if (!hasQtyUpdates && !hasNote) {
    throw new HttpsError("invalid-argument", "At least one of qtyUsedUpdates or executionNote is required.");
  }

  if (hasQtyUpdates) {
    for (const item of input.qtyUsedUpdates as unknown[]) {
      const entry = item as Partial<QtyUsedDelta>;
      if (!entry || typeof entry.sku !== "string" || typeof entry.delta !== "number") {
        throw new HttpsError("invalid-argument", "Each qtyUsedUpdates entry requires { sku: string, delta: number }.");
      }
    }
  }
}

export const updateWorkOrderExecutionData = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be signed in.");
  }

  assertValidInput(request.data);
  const { workOrderId, qtyUsedUpdates, executionNote } = request.data;

  // Rule 2: role must be exactly "technician" -- admin/dispatcher are
  // rejected too, not just anonymous/unauthenticated callers. Rule 3:
  // technicianId must be resolvable (PT-001's mapping).
  const caller = await getCallerContext(request.auth.uid);
  if (caller.role !== "technician") {
    throw new HttpsError("permission-denied", "Only technicians may record execution data.");
  }
  if (!caller.technicianId) {
    throw new HttpsError(
      "failed-precondition",
      "This account has no technicianId mapping yet (see PT-001's assignTechnicianToUser.js)."
    );
  }

  const db = getFirestore();
  const woRef = db.collection(WORK_ORDERS_COLLECTION).doc(workOrderId);

  const updatedFields = await db.runTransaction(async (tx) => {
    const snap = await tx.get(woRef);
    if (!snap.exists) {
      throw new HttpsError("not-found", `No Work Order with id ${workOrderId}`);
    }
    const wo = snap.data() as WorkOrder;

    // Rule 4: ownership -- assignedTechId must match the caller's own
    // technicianId. Never assignedTechId itself; only ever compared,
    // never written by this function.
    if (wo.assignedTechId !== caller.technicianId) {
      throw new HttpsError("permission-denied", "This Work Order is not assigned to you.");
    }

    const fields: string[] = [];
    const payload: Record<string, unknown> = { lastUpdated: FieldValue.serverTimestamp() };
    fields.push("lastUpdated");

    // qtyUsed lives per-item inside inventorySnapshot[], not as a
    // top-level scalar field -- Firestore has no "update array element
    // matching a key" primitive, so this reads the whole array,
    // replaces only the matching sku's qtyUsed (additive delta, floored
    // at 0), and writes the whole array back -- still only touching
    // the inventorySnapshot field, nothing else on the document. Doing
    // this inside the same transaction as the ownership check above
    // is what makes it concurrency-safe (Step 6): a second concurrent
    // call re-reads the post-first-write array, never clobbers it.
    if (qtyUsedUpdates && qtyUsedUpdates.length > 0) {
      const snapshot: InventorySnapshotItem[] = wo.inventorySnapshot ? [...wo.inventorySnapshot] : [];
      for (const { sku, delta } of qtyUsedUpdates) {
        const index = snapshot.findIndex((item) => item.sku === sku);
        if (index === -1) {
          throw new HttpsError("invalid-argument", `No planned part with sku "${sku}" on this Work Order.`);
        }
        const current = snapshot[index].qtyUsed ?? 0;
        snapshot[index] = { ...snapshot[index], qtyUsed: Math.max(0, current + delta) };
      }
      payload.inventorySnapshot = snapshot;
      fields.push("inventorySnapshot");
    }

    // executionLog is append-only via arrayUnion -- chosen over a
    // single overwritable executionNotes string specifically because
    // it's safe for concurrent edits (Step 6) with no read-modify-write
    // needed at all (arrayUnion is its own atomic merge). `at` uses
    // Timestamp.now(), not FieldValue.serverTimestamp() -- Firestore
    // does not support serverTimestamp() sentinels nested inside
    // arrayUnion() elements. Still server-computed (Admin SDK), not
    // client-supplied.
    if (executionNote && executionNote.trim().length > 0) {
      payload.executionLog = FieldValue.arrayUnion({
        note: executionNote.trim(),
        at: Timestamp.now(),
        byTechnicianId: caller.technicianId,
      });
      fields.push("executionLog");
    }

    tx.update(woRef, payload);
    return fields;
  });

  const result: UpdateWorkOrderExecutionDataResult = { success: true, workOrderId, updatedFields };
  return result;
});
