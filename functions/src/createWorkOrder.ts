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
import {
  assertEquipmentAllowedForType,
  assertEquipmentIntegrity,
  WorkOrderEquipmentError,
} from "./workOrderEquipment";
// Reused from the install command rather than re-declared: two constants naming the same collection
// is exactly how a read and a write come to disagree about where a record lives.
import { EQUIPMENT_COLLECTION } from "./workOrderInstall/workOrderInstallCommand";
import { auditEventDocRef, stageAuditEvent, stageAuditEventWithId } from "./access/auditEventWriter";
import { createWorkOrderAuditId } from "./workOrderCreateMath";
import { WORK_ORDERS_COLLECTION } from "./constants/collections";
import type { Priority, Severity, WorkOrderType, SalesOrderLineRef, InventorySnapshotItem } from "./types/workOrder";

interface CreateWorkOrderInput {
  customerId: string;
  locationId: string;
  priority: Priority;
  severity?: Severity;
  type: WorkOrderType;
  complaint?: string;
  // Optional client-supplied idempotency key. When present, a retry / double-submit carrying the SAME key
  // returns the already-created Work Order instead of minting a second one and burning a WO number (finance
  // callable pattern). OPTIONAL, so deploy-safe: a keyless legacy client keeps today's behavior. Closing the
  // defect in production has a paired dependency -- the client (WorkOrderWizard) must send a STABLE key per
  // submit. The key guards ONLY this callable, not the shared createWorkOrderRecord core (the Sales -> Service
  // seam creates through the core and is intentionally unaffected).
  idempotencyKey?: string;
  // WHICH MACHINE THIS IS ABOUT. Optional, and validated server-side when present -- see
  // workOrderEquipment.ts for the two rules (existing unit for service types; refused on INSTALL,
  // where the unit does not exist until completion).
  equipmentId?: string;
}

// The governed Work Order creation CORE, factored out so the callable AND other trusted server commands (e.g.
// the Sales Order → Service seam) create Work Orders through the SAME authority instead of duplicating it.
// `salesOrderId` is an optional DEMAND-LINEAGE link: a Work Order created to fulfill a Sales Order carries it
// so the same underlying parts demand is never double-counted (ATP counts SO-origin demand via the Sales
// Order allocation, not again via this Work Order's reservation). `salesOrderLineRefs` (P1.2) is quantity+kind
// -bearing (SalesOrderLineRef[], not a bare string[]) so P1.1's fulfilledQty write-back can match the right SO
// line -- primarily by the line's own stable `lineId` (pass4 B-2), falling back to (ref,kind) only for legacy
// callers that predate lineId. `inventorySnapshot` (P1.2) lets the Sales Order -> Service seam seed real planned parts
// on creation (resolved through Part Master by the caller -- this core never resolves identity itself). Must
// be called inside a transaction. The plain createWorkOrder onCall below never supplies either field.
export async function createWorkOrderRecord(
  db: Firestore,
  tx: Transaction,
  // `type` is optional here (a Work Order is valid with EITHER a type OR a complaint — see assertValidInput);
  // callers that omit both must supply a complaint. `salesOrderId`/`salesOrderLineRefs`/`inventorySnapshot`
  // are the demand-lineage + parts-plan-continuity link (P1.2).
  input: Omit<CreateWorkOrderInput, "type"> & {
    type?: WorkOrderType;
    salesOrderId?: string;
    salesOrderLineRefs?: SalesOrderLineRef[];
    inventorySnapshot?: InventorySnapshotItem[];
    // INBOUND PROVENANCE (Email Connections + Inbound Work). The same optional-lineage shape as
    // `salesOrderId` above and added for the same reason: a Work Order created by accepting an inbound
    // request must be able to answer "why does this exist" from the record itself, not only from the audit
    // trail. `externalReference`/`authorizationNumber` are the vendor's or manufacturer's own identifiers
    // (a warranty authorization, a case number) carried through so nobody retypes them. All three are
    // untrusted external text by origin -- bounded and validated by the inbound command before it gets here
    // -- and none of them is authority: they name nothing EOS resolves a permission against.
    inboundWorkRequestId?: string;
    externalReference?: string;
    authorizationNumber?: string;
  },
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
    ...(input.equipmentId ? { equipmentId: input.equipmentId } : {}),
    ...(input.salesOrderId ? { salesOrderId: input.salesOrderId } : {}),
    ...(Array.isArray(input.salesOrderLineRefs) && input.salesOrderLineRefs.length ? { salesOrderLineRefs: input.salesOrderLineRefs } : {}),
    ...(Array.isArray(input.inventorySnapshot) && input.inventorySnapshot.length ? { inventorySnapshot: input.inventorySnapshot } : {}),
    ...(input.inboundWorkRequestId ? { inboundWorkRequestId: input.inboundWorkRequestId } : {}),
    ...(input.externalReference ? { externalReference: input.externalReference } : {}),
    ...(input.authorizationNumber ? { authorizationNumber: input.authorizationNumber } : {}),
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
  // TYPE RULE FIRST, and it needs no read: an INSTALL naming a unit is wrong regardless of whether
  // that unit exists, and refusing it here means never fetching a document to reject the request
  // for a reason the fetch had nothing to do with.
  try {
    assertEquipmentAllowedForType(input.type, input.equipmentId);
  } catch (err) {
    if (err instanceof WorkOrderEquipmentError) throw new HttpsError("invalid-argument", err.message);
    throw err;
  }
  if (input.idempotencyKey !== undefined) {
    if (typeof input.idempotencyKey !== "string" || input.idempotencyKey.trim().length === 0) {
      throw new HttpsError("invalid-argument", "idempotencyKey, when provided, must be a non-empty string.");
    }
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
  const { customerId, locationId, priority, severity, type, complaint, idempotencyKey, equipmentId } = request.data;
  const actorUid = request.auth.uid;
  const aid = idempotencyKey ? createWorkOrderAuditId(actorUid, `${customerId}|${locationId}`, idempotencyKey) : null;

  const db = getFirestore();
  const year = new Date().getFullYear();

  return db.runTransaction(async (tx) => {
    // Idempotency / replay: read the deterministic marker up front (before any write). If a prior create with
    // this key already applied, return the SAME Work Order -- never mint a second one or burn a WO number.
    if (aid) {
      const prior = await tx.get(auditEventDocRef(aid));
      if (prior.exists) {
        const targetId = (prior.data()?.targetId as string) ?? "";
        const woSnap = targetId ? await tx.get(db.collection(WORK_ORDERS_COLLECTION).doc(targetId)) : null;
        return { id: targetId, woNumber: (woSnap?.data()?.woNumber as string) ?? null, replayed: true as const };
      }
    }
    // EQUIPMENT INTEGRITY IS PROVEN FROM THE STORED RECORD, INSIDE THE TRANSACTION.
    //
    // The client picker filters by account, and that filter is a convenience for the person
    // choosing -- it is not evidence. A caller can send any id, so the account and location are
    // checked against the Equipment document itself, read here, before anything is written.
    if (equipmentId) {
      const eqSnap = await tx.get(db.collection(EQUIPMENT_COLLECTION).doc(equipmentId));
      const eq = eqSnap.data();
      try {
        assertEquipmentIntegrity(
          { exists: eqSnap.exists, accountId: (eq?.accountId as string) ?? null, locationId: (eq?.locationId as string) ?? null },
          { customerId, locationId },
        );
      } catch (err) {
        if (err instanceof WorkOrderEquipmentError) throw new HttpsError("invalid-argument", err.message);
        throw err;
      }
    }
    const created = await createWorkOrderRecord(db, tx, { customerId, locationId, priority, severity, type, complaint, equipmentId }, year);
    // Audit trail (M9/H19 remediation): EVERY create gets an Audit Event, staged in the SAME transaction so
    // the WO and its Audit Event commit atomically -- no longer conditional on an optional idempotencyKey
    // (a keyless legacy caller previously left no audit trail at all). When a key IS supplied, the event is
    // ALSO the deterministic idempotency marker (stageAuditEventWithId, unchanged replay behavior above) --
    // when no key is supplied, it is a plain auto-id Audit Event (stageAuditEvent) -- there is nothing to
    // dedupe against, so it carries no replay semantics, only the record that this create happened.
    if (aid) {
      stageAuditEventWithId(tx, aid, {
        actorUid,
        action: "createWorkOrder",
        targetType: "workOrder",
        targetId: created.id,
        outcome: "applied",
        summary: `created work order ${created.woNumber}`,
      });
    } else {
      stageAuditEvent(tx, {
        actorUid,
        action: "createWorkOrder",
        targetType: "workOrder",
        targetId: created.id,
        outcome: "applied",
        summary: `created work order ${created.woNumber}`,
      });
    }
    return { ...created, replayed: false as const };
  });
});
