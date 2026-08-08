// Sales Order — governed WRITE callables (Cycle 4). Thin onCall adapters over the PURE command core
// (salesOrderCommands.ts) + lifecycle authority (salesOrderLifecycle.ts). They supply only I/O + auth:
//   • actor identity from request.auth.uid (never trusted from the payload);
//   • authorization = capability `salesOrder.write`, resolved fail-closed via the trusted effective-access
//     feed; registered active:false ⇒ hard DENY for everyone until a separate Owner grant;
//   • writes go to the `sales_orders` collection via the Admin SDK; firestore.rules denies ALL direct client
//     access to that collection, so the trusted command is the only write path.
// EXPORT != DEPLOY, REGISTER != GRANT. Sales Order is the committed commercial order; it does NOT assign
// serialized assets (fulfillment does) and does NOT write Work Orders/inventory (later governed seams do).
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { resolveEffectiveAccess } from "../access/effectiveAccessFeed";
import { SALES_ORDERS_COLLECTION } from "../constants/collections";
import {
  buildCreateSalesOrder,
  buildTransitionPatch,
  SalesOrderCommandError,
  type CreateSalesOrderInput,
  type SalesOrderDocState,
} from "./salesOrderCommands";
import type { SalesOrderTransition } from "./salesOrderLifecycle";

export const SALES_ORDER_WRITE_CAPABILITY = "salesOrder.write";

function mapCommandError(err: unknown): HttpsError {
  if (err instanceof HttpsError) return err;
  if (err instanceof SalesOrderCommandError) {
    switch (err.code) {
      case "TERMINAL":
      case "ILLEGAL_TRANSITION":
      case "NOT_FULFILLABLE":
        return new HttpsError("failed-precondition", err.message);
      default:
        return new HttpsError("invalid-argument", err.message);
    }
  }
  return new HttpsError("internal", "Sales Order command failed.");
}

async function requireSalesOrderWrite(uid: string): Promise<void> {
  let allowed = false;
  try {
    const { decisions } = await resolveEffectiveAccess({ principalUid: uid, permissionIds: [SALES_ORDER_WRITE_CAPABILITY] });
    allowed = decisions[SALES_ORDER_WRITE_CAPABILITY] === true;
  } catch {
    allowed = false;
  }
  if (!allowed) throw new HttpsError("permission-denied", "You are not authorized to write Sales Orders.");
}

// Create a committed Sales Order (CONFIRMED) from commercial inputs (typically a WON Opportunity). Product-
// level lines only; a serialized-asset line is rejected by the pure builder.
export const createSalesOrder = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
  await requireSalesOrderWrite(request.auth.uid);

  let built;
  try {
    built = buildCreateSalesOrder(request.data as CreateSalesOrderInput, { actorUid: request.auth.uid, nowMillis: Date.now() });
  } catch (err) {
    throw mapCommandError(err);
  }

  const db = getFirestore();
  const { createdAtMillis: _c, updatedAtMillis: _u, ...fields } = built;
  const ref = await db.collection(SALES_ORDERS_COLLECTION).add({
    ...fields,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { success: true as const, salesOrderId: ref.id, state: built.state };
});

interface TransitionSalesOrderInput {
  salesOrderId: string;
  transition: SalesOrderTransition;
}

// Advance a Sales Order along its lifecycle, or cancel it (before FULFILLED). Legality is enforced by the
// pure authority; FULFILLED requires every line fully fulfilled.
export const transitionSalesOrder = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
  await requireSalesOrderWrite(request.auth.uid);

  const data = (request.data ?? {}) as TransitionSalesOrderInput;
  if (typeof data.salesOrderId !== "string" || data.salesOrderId.trim().length === 0) {
    throw new HttpsError("invalid-argument", "salesOrderId is required.");
  }
  if (data.transition !== "ADVANCE" && data.transition !== "CANCEL") {
    throw new HttpsError("invalid-argument", "transition must be ADVANCE or CANCEL.");
  }

  const db = getFirestore();
  const ref = db.collection(SALES_ORDERS_COLLECTION).doc(data.salesOrderId);
  try {
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new HttpsError("not-found", `No Sales Order with id ${data.salesOrderId}`);
      const current = snap.data() as SalesOrderDocState;
      const patch = buildTransitionPatch(current, data.transition, { actorUid: request.auth!.uid, nowMillis: Date.now() });
      const { updatedAtMillis: _u, ...rest } = patch;
      tx.update(ref, { ...rest, updatedAt: FieldValue.serverTimestamp() });
      return { state: patch.state };
    });
    return { success: true as const, salesOrderId: data.salesOrderId, ...result };
  } catch (err) {
    throw mapCommandError(err);
  }
});
