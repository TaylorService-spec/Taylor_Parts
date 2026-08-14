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
import { getFirestore, FieldValue, type Firestore, type Transaction } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import { resolveEffectiveAccess } from "../access/effectiveAccessFeed";
import { auditEventDocRef, stageAuditEventWithId } from "../access/auditEventWriter";
import { SALES_ORDERS_COLLECTION } from "../constants/collections";
import {
  buildCreateSalesOrder,
  buildTransitionPatch,
  SalesOrderCommandError,
  type CreateSalesOrderInput,
  type SalesOrderDocState, type BuiltSalesOrder,
} from "./salesOrderCommands";
import type { SalesOrderTransition } from "./salesOrderLifecycle";

export const SALES_ORDER_WRITE_CAPABILITY = "salesOrder.write";

// Shared deterministic Audit Event id builder (same shape as coverageCallables.ts's mkAuditId): a retried
// call with the same actorUid + idempotencyKey resolves to the SAME Audit Event document id, so the
// transactional existence check below is the single source of truth for "was this exact call already applied."
const mkAuditId = (action: string, actorUid: string, key: string): string =>
  `${action}_${createHash("sha256").update(`${actorUid}|${key}`).digest("hex").slice(0, 40)}`;

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

export async function persistCreatedSalesOrder(
  db: Firestore, tx: Transaction, built: BuiltSalesOrder, actorUid: string, idempotencyKey?: string,
) {
  const aid = idempotencyKey ? mkAuditId("createSalesOrder", actorUid, idempotencyKey) : null;
  const { createdAtMillis: _c, updatedAtMillis: _u, ...fields } = built;
  if (aid) {
    const prior = await tx.get(auditEventDocRef(aid));
    if (prior.exists) return { success: true as const, replayed: true as const, salesOrderId: ((prior.data() ?? {}).targetId as string) ?? null, state: built.state };
  }
  const ref = db.collection(SALES_ORDERS_COLLECTION).doc();
  tx.set(ref, { ...fields, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  if (aid) stageAuditEventWithId(tx, aid, { actorUid, action: "createSalesOrder", targetType: "salesOrder", targetId: ref.id, outcome: "applied", summary: `created sales order for account ${built.accountId}` });
  return { success: true as const, replayed: false as const, salesOrderId: ref.id, state: built.state };
}

// Transactional core of transitionSalesOrder, exported so tests can exercise the idempotency invariant
// directly (below the capability gate — salesOrder.write is registered active:false, a hard deny for
// everyone until a separate Owner grant), exactly the pattern persistCreatedSalesOrder already established.
export async function persistTransitionedSalesOrder(
  db: Firestore, tx: Transaction, ref: FirebaseFirestore.DocumentReference,
  salesOrderId: string, transition: SalesOrderTransition, actorUid: string, idempotencyKey: string,
) {
  const aid = mkAuditId("transitionSalesOrder", actorUid, idempotencyKey);
  const prior = await tx.get(auditEventDocRef(aid));
  const snap = await tx.get(ref);
  if (!snap.exists) throw new HttpsError("not-found", `No Sales Order with id ${salesOrderId}`);
  const current = snap.data() as SalesOrderDocState;
  if (prior.exists) {
    return { success: true as const, replayed: true as const, salesOrderId, state: current.state };
  }
  const patch = buildTransitionPatch(current, transition, { actorUid, nowMillis: Date.now() });
  const { updatedAtMillis: _u, ...rest } = patch;
  tx.update(ref, { ...rest, updatedAt: FieldValue.serverTimestamp() });
  stageAuditEventWithId(tx, aid, {
    actorUid,
    action: "transitionSalesOrder",
    targetType: "salesOrder",
    targetId: salesOrderId,
    outcome: "applied",
    summary: `transitioned sales order ${salesOrderId} to state ${patch.state}`,
  });
  return { success: true as const, replayed: false as const, salesOrderId, state: patch.state };
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

  const data = (request.data ?? {}) as CreateSalesOrderInput & { idempotencyKey?: string };
  if (data.idempotencyKey !== undefined && (typeof data.idempotencyKey !== "string" || data.idempotencyKey.trim().length === 0)) {
    throw new HttpsError("invalid-argument", "idempotencyKey, when provided, must be a non-empty string.");
  }
  let built;
  try {
    built = buildCreateSalesOrder(data, { actorUid: request.auth.uid, nowMillis: Date.now() });
  } catch (err) {
    throw mapCommandError(err);
  }

  const db = getFirestore();
  return db.runTransaction((tx) => persistCreatedSalesOrder(db, tx, built, request.auth!.uid, data.idempotencyKey));
});

interface TransitionSalesOrderInput {
  salesOrderId: string;
  transition: SalesOrderTransition;
  idempotencyKey?: string;
}

// Advance a Sales Order along its lifecycle, or cancel it (before FULFILLED). Legality is enforced by the
// pure authority; FULFILLED requires every line fully fulfilled.
//
// Idempotency (site-work r3 item G): a retried ADVANCE/CANCEL call — client timeout retry, double-tap — must
// never apply twice. Mirrors createSalesOrder's guard precisely: a REQUIRED idempotencyKey resolves to a
// deterministic Audit Event id (mkAuditId), staged atomically with the state mutation in the SAME transaction.
// A duplicate call finds that Audit Event already exists and returns `replayed:true` with the Sales Order's
// CURRENT state instead of recomputing and reapplying the transition.
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
  if (typeof data.idempotencyKey !== "string" || data.idempotencyKey.trim().length === 0) {
    throw new HttpsError("invalid-argument", "idempotencyKey is required.");
  }

  const actorUid = request.auth.uid;
  const db = getFirestore();
  const ref = db.collection(SALES_ORDERS_COLLECTION).doc(data.salesOrderId);
  try {
    return await db.runTransaction((tx) =>
      persistTransitionedSalesOrder(db, tx, ref, data.salesOrderId, data.transition, actorUid, data.idempotencyKey!),
    );
  } catch (err) {
    throw mapCommandError(err);
  }
});
