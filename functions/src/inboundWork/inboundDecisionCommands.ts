// Email Connections + Inbound Work -- THE THREE GOVERNED DECISIONS: accept, decline, attach to existing.
//
// ACCEPT IS THE WHOLE POINT OF THE FEATURE, and it is one server-authoritative transaction, not a sequence
// of client writes. Everything it must be true about is proven inside that transaction: the intake exists
// and is still undecided, the chosen customer / location / equipment really exist and belong together, the
// Work Order is created through the SAME governed createWorkOrderRecord core an admin uses by hand, the
// intake is linked to it, and the audit event commits with the write or not at all.
//
// TWO CLICKS CANNOT MAKE TWO WORK ORDERS. The intake's own status is the idempotency substrate: the second
// transaction reads ACCEPTED, writes nothing, and returns the SAME workItemId the first one created. That
// is stronger than a client-supplied idempotency key, because it holds for two different clients, a retry
// after a lost response, and a double-submit alike.
//
// MASTER DATA IS NOT TOUCHED. Accepting uses the reviewer's chosen ids for the Work Order. If the email
// spells the site address differently, or names a contact EOS does not have, no Customer / Location /
// Contact / Equipment record is created or edited here -- proposing a master-data change is the governance
// product's job (Verenward Data Governance, or whichever platform the customer uses), and base EOS silently
// rewriting mastered data from an unauthenticated email would be the worst possible version of "helpful".
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { INBOUND_WORK_REQUESTS_COLLECTION, WORK_ORDERS_COLLECTION } from "../constants/collections";
import { stageAuditEvent } from "../access/auditEventWriter";
import { createWorkOrderRecord } from "../createWorkOrder";
import { EQUIPMENT_COLLECTION } from "../workOrderInstall/workOrderInstallCommand";
import { assertEquipmentAllowedForType, assertEquipmentIntegrity } from "../workOrderEquipment";
import type { Priority, WorkOrderType } from "../types/workOrder";
import {
  DECIDABLE_STATUSES,
  boundedString,
  isInboundDeclineReason,
  isInboundRequestType,
  type InboundDeclineReason,
  type InboundRequestType,
  type InboundWorkStatus,
} from "./inboundWorkModel";

const ACCOUNTS_COLLECTION = "accounts";
const LOCATIONS_COLLECTION = "locations";

export type InboundDecisionErrorCode =
  | "NOT_FOUND"
  | "ALREADY_DECIDED"
  | "INVALID_INPUT"
  | "CUSTOMER_NOT_FOUND"
  | "LOCATION_NOT_FOUND"
  | "LOCATION_CUSTOMER_MISMATCH"
  | "EQUIPMENT_INVALID"
  | "WORK_ORDER_NOT_FOUND";

export class InboundDecisionError extends Error {
  code: InboundDecisionErrorCode;
  constructor(code: InboundDecisionErrorCode, message: string) {
    super(message);
    this.name = "InboundDecisionError";
    this.code = code;
  }
}

/** Inbound classification -> the governed Work Order type. PARTS/OTHER are ordinary service calls. */
export function workOrderTypeForRequestType(requestType: InboundRequestType | null | undefined): WorkOrderType {
  switch (requestType) {
    case "WARRANTY":
      return "WARRANTY";
    case "INSTALL":
      return "INSTALL";
    case "PM":
      return "PM";
    default:
      return "SERVICE_CALL";
  }
}

export interface AcceptInboundWorkInput {
  requestId: string;
  actorUid: string;
  /** The reviewer's confirmed selections. Suggestions are never accepted on the extractor's word. */
  customerId: string;
  locationId: string;
  equipmentId?: string | null;
  requestType?: InboundRequestType | null;
  priority?: Priority | null;
  problemDescription?: string | null;
}

export interface AcceptInboundWorkResult {
  requestId: string;
  workItemId: string;
  woNumber: string | null;
  replayed: boolean;
}

export async function acceptInboundWorkRequest(db: Firestore, input: AcceptInboundWorkInput): Promise<AcceptInboundWorkResult> {
  const requestId = boundedString(input?.requestId, 255);
  const actorUid = boundedString(input?.actorUid, 255);
  const customerId = boundedString(input?.customerId, 255);
  const locationId = boundedString(input?.locationId, 255);
  const equipmentId = boundedString(input?.equipmentId, 255) || null;
  if (!requestId) throw new InboundDecisionError("INVALID_INPUT", "requestId is required.");
  if (!actorUid) throw new InboundDecisionError("INVALID_INPUT", "An authenticated actor is required.");
  if (!customerId) throw new InboundDecisionError("INVALID_INPUT", "A customer must be selected before accepting.");
  if (!locationId) throw new InboundDecisionError("INVALID_INPUT", "A location must be selected before accepting.");

  const requestRef = db.collection(INBOUND_WORK_REQUESTS_COLLECTION).doc(requestId);
  const year = new Date().getFullYear();

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(requestRef);
    if (!snap.exists) throw new InboundDecisionError("NOT_FOUND", "That inbound request does not exist.");
    const data = snap.data() as Record<string, unknown>;
    const status = data.status as InboundWorkStatus;

    // REPLAY, NOT A SECOND WORK ORDER. An already-accepted intake returns what it created.
    if (status === "ACCEPTED" && boundedString(data.workItemId, 255)) {
      const workItemId = boundedString(data.workItemId, 255);
      const wo = await tx.get(db.collection(WORK_ORDERS_COLLECTION).doc(workItemId));
      return { requestId, workItemId, woNumber: boundedString(wo.data()?.woNumber, 64) || null, replayed: true };
    }
    if (!DECIDABLE_STATUSES.has(status)) {
      throw new InboundDecisionError("ALREADY_DECIDED", `This request is ${status} and can no longer be accepted.`);
    }

    const requestType = isInboundRequestType(input.requestType)
      ? input.requestType
      : isInboundRequestType(data.requestType)
        ? (data.requestType as InboundRequestType)
        : null;
    const type = workOrderTypeForRequestType(requestType);
    assertEquipmentAllowedForType(type, equipmentId ?? undefined);

    // IDENTITY IS PROVEN FROM THE STORED RECORDS, INSIDE THE TRANSACTION. The reviewer's picker filtered
    // the choices, and a filter is a convenience for the person choosing -- it is not evidence.
    const [customerSnap, locationSnap] = await Promise.all([
      tx.get(db.collection(ACCOUNTS_COLLECTION).doc(customerId)),
      tx.get(db.collection(LOCATIONS_COLLECTION).doc(locationId)),
    ]);
    if (!customerSnap.exists) throw new InboundDecisionError("CUSTOMER_NOT_FOUND", "The selected customer does not exist.");
    if (!locationSnap.exists) throw new InboundDecisionError("LOCATION_NOT_FOUND", "The selected location does not exist.");
    const locationAccountId = boundedString((locationSnap.data() as Record<string, unknown>)?.accountId, 255);
    if (locationAccountId && locationAccountId !== customerId) {
      throw new InboundDecisionError("LOCATION_CUSTOMER_MISMATCH", "The selected location belongs to a different customer.");
    }
    if (equipmentId) {
      const eqSnap = await tx.get(db.collection(EQUIPMENT_COLLECTION).doc(equipmentId));
      const eq = eqSnap.data() as Record<string, unknown> | undefined;
      assertEquipmentIntegrity(
        { exists: eqSnap.exists, accountId: boundedString(eq?.accountId, 255) || null, locationId: boundedString(eq?.locationId, 255) || null },
        { customerId, locationId },
      );
    }

    const priority: Priority =
      input.priority === 1 || input.priority === 2 || input.priority === 3 || input.priority === 4
        ? input.priority
        : data.priority === 1 || data.priority === 2 || data.priority === 3 || data.priority === 4
          ? (data.priority as Priority)
          : 3;
    // NO RE-TYPING. The complaint the Work Order carries is the problem the message described, unless the
    // reviewer corrected it. Falling back to the subject keeps a Work Order from being created blank when
    // extraction found nothing.
    const complaint =
      boundedString(input.problemDescription, 500) ||
      boundedString(data.problemDescription, 500) ||
      boundedString(data.subject, 500) ||
      "Inbound request";
    const externalReference = boundedString(data.externalReference, 120);
    const authorizationNumber = boundedString(data.authorizationNumber, 120);

    const created = await createWorkOrderRecord(
      db,
      tx,
      {
        customerId,
        locationId,
        priority,
        type,
        complaint,
        ...(equipmentId ? { equipmentId } : {}),
        inboundWorkRequestId: requestId,
        ...(externalReference ? { externalReference } : {}),
        ...(authorizationNumber ? { authorizationNumber } : {}),
      },
      year,
    );

    tx.update(requestRef, {
      status: "ACCEPTED",
      decision: "ACCEPTED",
      decisionReason: null,
      decisionBy: actorUid,
      decisionAt: FieldValue.serverTimestamp(),
      customerId,
      customerLocationId: locationId,
      equipmentId,
      requestType,
      priority,
      problemDescription: complaint,
      workItemId: created.id,
      updatedAt: FieldValue.serverTimestamp(),
    });
    // TWO EVENTS, ONE TRANSACTION, and both are needed to answer the question this trail exists for.
    // The first is the DECISION, filed against the inbound request: who accepted it and when. The second
    // is the CREATE, filed against the Work Order -- the plain createWorkOrder callable writes exactly
    // this event for a hand-made Work Order, and an accepted one must not be the single Work Order in the
    // estate whose creation has no event under its own id. Reading either way round works: from the Work
    // Order back to the request that caused it, or from the request forward to the job it became.
    stageAuditEvent(tx, {
      actorUid,
      action: "acceptInboundWorkRequest",
      targetType: "inboundWorkRequest",
      targetId: requestId,
      outcome: "applied",
      summary: `accepted inbound request and created work order ${created.woNumber}`,
    });
    stageAuditEvent(tx, {
      actorUid,
      action: "createWorkOrder",
      targetType: "workOrder",
      targetId: created.id,
      outcome: "applied",
      summary: `created work order ${created.woNumber} from inbound request ${requestId}`,
    });
    return { requestId, workItemId: created.id, woNumber: created.woNumber, replayed: false };
  });
}

export interface DeclineInboundWorkInput {
  requestId: string;
  actorUid: string;
  reason: InboundDeclineReason;
  note?: string | null;
}

/** Declined intake is RETAINED, never deleted: decline reasons are a reporting fact and an audit fact. */
export async function declineInboundWorkRequest(
  db: Firestore,
  input: DeclineInboundWorkInput,
): Promise<{ requestId: string; replayed: boolean }> {
  const requestId = boundedString(input?.requestId, 255);
  const actorUid = boundedString(input?.actorUid, 255);
  if (!requestId) throw new InboundDecisionError("INVALID_INPUT", "requestId is required.");
  if (!actorUid) throw new InboundDecisionError("INVALID_INPUT", "An authenticated actor is required.");
  if (!isInboundDeclineReason(input?.reason)) throw new InboundDecisionError("INVALID_INPUT", "A valid decline reason is required.");
  const note = boundedString(input?.note, 500) || null;
  const requestRef = db.collection(INBOUND_WORK_REQUESTS_COLLECTION).doc(requestId);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(requestRef);
    if (!snap.exists) throw new InboundDecisionError("NOT_FOUND", "That inbound request does not exist.");
    const status = (snap.data() as Record<string, unknown>).status as InboundWorkStatus;
    if (status === "DECLINED") return { requestId, replayed: true };
    if (!DECIDABLE_STATUSES.has(status)) {
      throw new InboundDecisionError("ALREADY_DECIDED", `This request is ${status} and can no longer be declined.`);
    }
    tx.update(requestRef, {
      status: "DECLINED",
      decision: "DECLINED",
      decisionReason: input.reason,
      decisionNote: note,
      decisionBy: actorUid,
      decisionAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    stageAuditEvent(tx, {
      actorUid,
      action: "declineInboundWorkRequest",
      targetType: "inboundWorkRequest",
      targetId: requestId,
      outcome: "applied",
      summary: `declined inbound request (${input.reason})`,
    });
    return { requestId, replayed: false };
  });
}

export interface AttachInboundWorkInput {
  requestId: string;
  actorUid: string;
  workOrderId: string;
}

/**
 * The message belongs to work that already exists. The intake, its original message and its attachments are
 * preserved against that Work Order and NO new Work Order is created -- which is the same protection thread
 * association gives automatically, made available to a reviewer who recognises the connection themselves.
 */
export async function attachInboundWorkRequest(
  db: Firestore,
  input: AttachInboundWorkInput,
): Promise<{ requestId: string; workItemId: string; replayed: boolean }> {
  const requestId = boundedString(input?.requestId, 255);
  const actorUid = boundedString(input?.actorUid, 255);
  const workOrderId = boundedString(input?.workOrderId, 255);
  if (!requestId) throw new InboundDecisionError("INVALID_INPUT", "requestId is required.");
  if (!actorUid) throw new InboundDecisionError("INVALID_INPUT", "An authenticated actor is required.");
  if (!workOrderId) throw new InboundDecisionError("INVALID_INPUT", "A Work Order must be selected.");
  const requestRef = db.collection(INBOUND_WORK_REQUESTS_COLLECTION).doc(requestId);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(requestRef);
    if (!snap.exists) throw new InboundDecisionError("NOT_FOUND", "That inbound request does not exist.");
    const data = snap.data() as Record<string, unknown>;
    const status = data.status as InboundWorkStatus;
    if (status === "ATTACHED" && boundedString(data.workItemId, 255) === workOrderId) {
      return { requestId, workItemId: workOrderId, replayed: true };
    }
    if (!DECIDABLE_STATUSES.has(status)) {
      throw new InboundDecisionError("ALREADY_DECIDED", `This request is ${status} and can no longer be attached.`);
    }
    const woSnap = await tx.get(db.collection(WORK_ORDERS_COLLECTION).doc(workOrderId));
    if (!woSnap.exists) throw new InboundDecisionError("WORK_ORDER_NOT_FOUND", "That Work Order does not exist.");
    const wo = woSnap.data() as Record<string, unknown>;

    tx.update(requestRef, {
      status: "ATTACHED",
      decision: "ATTACHED",
      decisionBy: actorUid,
      decisionAt: FieldValue.serverTimestamp(),
      workItemId: workOrderId,
      // The Work Order's own customer/location become the intake's resolved references: the record it is
      // filed against is the authority on who it is for, never the email.
      customerId: boundedString(wo.customerId, 255) || null,
      customerLocationId: boundedString(wo.locationId, 255) || null,
      updatedAt: FieldValue.serverTimestamp(),
    });
    stageAuditEvent(tx, {
      actorUid,
      action: "attachInboundWorkRequest",
      targetType: "inboundWorkRequest",
      targetId: requestId,
      outcome: "applied",
      summary: `attached inbound request to work order ${boundedString(wo.woNumber, 64) || workOrderId}`,
    });
    return { requestId, workItemId: workOrderId, replayed: false };
  });
}
