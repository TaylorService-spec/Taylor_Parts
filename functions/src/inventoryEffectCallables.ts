import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getCallerContext } from "./callerContext";
import { WORK_ORDERS_COLLECTION, INVENTORY_SYNC_STATUS_COLLECTION } from "./constants/collections";
import { detectWorkOrderInventoryEffects } from "./inventoryEffectDetection";

export const detectInventoryEffects = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
  const id = (request.data as { workOrderId?: unknown } | null)?.workOrderId;
  if (typeof id !== "string" || !id.trim()) throw new HttpsError("invalid-argument", "workOrderId is required.");
  const caller = await getCallerContext(request.auth.uid);
  if (caller.role !== "admin" && caller.role !== "dispatcher") throw new HttpsError("permission-denied", "Not authorized to inspect inventory effects.");
  const db = getFirestore();
  const [wo, sync] = await Promise.all([db.collection(WORK_ORDERS_COLLECTION).doc(id).get(), db.collection(INVENTORY_SYNC_STATUS_COLLECTION).doc(id).get()]);
  if (!wo.exists) throw new HttpsError("not-found", "Work Order not found.");
  const data = wo.data() ?? {};
  return detectWorkOrderInventoryEffects({ workOrderId: id, status: data.status, executionTimestamps: data, inventorySnapshotItemCount: Array.isArray(data.inventorySnapshot) ? data.inventorySnapshot.length : null }, { exists: sync.exists, ...(sync.data() ?? {}) });
});
