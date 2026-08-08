// Sales Order → Service/Dispatch seam (Cycle 7). Creates governed Service demand for a committed Sales Order
// by producing a Work Order through the EXISTING governed Work Order authority (createWorkOrderRecord, ADR-009)
// — the Sales Order NEVER authors Work Order state, technician/truck assignment, or the dispatch schedule
// directly. Dispatch/Scheduling then pick the Work Order up through their own governed surfaces.
//
// DEMAND LINEAGE (Owner C7 invariant): the created Work Order carries `salesOrderId` (+ line refs). Its parts
// reservations are therefore counted via the Sales Order's allocation, not double-counted (allocateSalesOrder
// excludes SO-linked WO reservations). The Sales Order records the resulting workOrderIds so the trace is
// bidirectional: SO line → allocation → Work Order → reservation/consumption.
//
// Authorization = capability `salesOrder.service`, resolved fail-closed via the trusted effective-access feed;
// registered active:false ⇒ DENY for everyone until a separate Owner grant. EXPORT != DEPLOY, REGISTER != GRANT.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { resolveEffectiveAccess } from "../access/effectiveAccessFeed";
import { SALES_ORDERS_COLLECTION } from "../constants/collections";
import { createWorkOrderRecord } from "../createWorkOrder";

export const SALES_ORDER_SERVICE_CAPABILITY = "salesOrder.service";

interface SoLine { kind: string; ref: string; orderedQty: number }
interface SalesOrderDoc {
  state?: string;
  accountId?: string;
  locationId?: string;
  lines?: SoLine[];
  serviceWorkOrderIds?: string[];
}

export const createServiceForSalesOrder = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
  let allowed = false;
  try {
    const { decisions } = await resolveEffectiveAccess({ principalUid: request.auth.uid, permissionIds: [SALES_ORDER_SERVICE_CAPABILITY] });
    allowed = decisions[SALES_ORDER_SERVICE_CAPABILITY] === true;
  } catch {
    allowed = false;
  }
  if (!allowed) throw new HttpsError("permission-denied", "You are not authorized to create Service for Sales Orders.");

  const salesOrderId = (request.data as { salesOrderId?: string })?.salesOrderId;
  if (typeof salesOrderId !== "string" || salesOrderId.trim().length === 0) {
    throw new HttpsError("invalid-argument", "salesOrderId is required.");
  }

  const db = getFirestore();
  const soRef = db.collection(SALES_ORDERS_COLLECTION).doc(salesOrderId);
  const year = new Date().getFullYear();

  try {
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(soRef);
      if (!snap.exists) throw new HttpsError("not-found", `No Sales Order with id ${salesOrderId}`);
      const so = snap.data() as SalesOrderDoc;
      if (so.state !== "CONFIRMED" && so.state !== "IN_FULFILLMENT") {
        throw new HttpsError("failed-precondition", `Sales Order is ${so.state}; only CONFIRMED/IN_FULFILLMENT can create Service.`);
      }
      if (!so.accountId) throw new HttpsError("failed-precondition", "Sales Order has no accountId (customer) to route Service to.");
      if (!so.locationId) throw new HttpsError("failed-precondition", "Sales Order has no delivery/service locationId; set one before creating Service.");
      // Idempotency: don't re-create Service if this SO already has a linked Work Order (C7 = one coordinated
      // Work Order per SO; C8 will assess per-equipment coordination).
      if (Array.isArray(so.serviceWorkOrderIds) && so.serviceWorkOrderIds.length > 0) {
        throw new HttpsError("failed-precondition", "Sales Order already has Service Work Order(s).");
      }
      const lineRefs = (Array.isArray(so.lines) ? so.lines : []).map((l) => l.ref);

      const wo = await createWorkOrderRecord(
        db,
        tx,
        {
          customerId: so.accountId,
          locationId: so.locationId,
          priority: 3,
          complaint: `Sales Order fulfillment ${salesOrderId}: deliver/install ordered items`,
          salesOrderId,
          salesOrderLineRefs: lineRefs,
        },
        year
      );

      tx.update(soRef, {
        state: "IN_FULFILLMENT",
        serviceWorkOrderIds: FieldValue.arrayUnion(wo.id),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { workOrderId: wo.id, woNumber: wo.woNumber };
    });
    return { success: true as const, salesOrderId, ...result };
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    throw new HttpsError("internal", "Create Service for Sales Order failed.");
  }
});
