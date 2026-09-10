// listMyReceivableTransfers -- the ONE command-scoped read that lets a technician find the Transfer they
// are about to receive onto their own truck.
//
// WHY IT EXISTS. The handheld Transfer screen listed orders from a client `transfer_orders` read that
// Rules admit only to admin/dispatcher and assigned warehouse managers. A technician holding
// inventory.transfer.receive could therefore RECEIVE but never SEE the order to receive -- an unusable
// grant. Rules are NOT widened; this trusted read answers exactly one question instead:
//
//   "Which IN_TRANSIT Transfers are destined for the authenticated caller's own governed truck?"
//
// IT GRANTS NOTHING STANDING. It is authorized by inventory.transfer.receive through the SAME resolver
// receiveTransferOrder uses, so it can only reveal work the same principal may attempt to receive. The
// receipt itself still goes through receiveTransferOrder, which re-authorizes and re-derives everything.
//
// NOTHING IS CALLER-SCOPED. The request carries no employee, truck, destination, status or filter --
// the caller is auth.uid, the technician is users/{uid}.technicianId, and the truck is the Truck
// Registry's own driver assignment (readAssignedMobileLocation, the resolver Work Order consumption
// already uses; one interpretation of "my truck", not two). Another technician's truck is therefore
// structurally unreachable: there is no input that names it.
//
// NO INVENTORY VISIBILITY. The projection is an allow-list of the order's own fields. No balance,
// availability, other serialized units, actors or audit metadata.

import type { Firestore, Transaction } from "firebase-admin/firestore";
import { FieldPath } from "firebase-admin/firestore";
import { readAssignedMobileLocation } from "../workOrderConsumption/consumptionSourceService.js";
import { deserializeTransferOrder } from "./transferOrderRepository.js";
import { isSafeDocumentIdSegment } from "./transferDocIdGuard.js";
import type { DeserializedTransferOrder } from "./transferOrderTypes.js";

export const TRANSFER_ORDERS_COLLECTION = "transfer_orders";
export const RECEIVABLE_PAGE_MAX = 50;
/** The only lifecycle state receiveTransferOrder accepts (IN_TRANSIT -> COMPLETED). */
export const RECEIVABLE_STATUS = "IN_TRANSIT";

export type ReceivableReadFailure =
  | "PERMISSION_DENIED"
  | "READ_INVALID"
  | "TECHNICIAN_IDENTITY_UNAVAILABLE"
  | "NO_TRUCK_ASSIGNMENT"
  | "TRUCK_ASSIGNMENT_AMBIGUOUS"
  | "MALFORMED_STORED_RECORD";

export class ReceivableReadError extends Error {
  constructor(readonly code: ReceivableReadFailure, message: string) {
    super(message);
    this.name = "ReceivableReadError";
  }
}

export interface ReceivableReadDeps {
  readonly db: Firestore;
  /** The receiveTransferOrder resolver for inventory.transfer.receive. */
  readonly resolveReceivePermission: (txn: Transaction, actorId: string) => Promise<boolean>;
}

/** The allow-listed projection: what the handheld needs to render and verify one receipt. Nothing else. */
export function receivableProjection(o: DeserializedTransferOrder) {
  return {
    transferOrderId: o.transferOrderId,
    ...(o.transferOrderNumber === undefined ? {} : { transferOrderNumber: o.transferOrderNumber }),
    partId: o.value.partId,
    trackingMode: o.value.trackingMode,
    quantity: o.value.quantity,
    ...(o.value.serialNumbers === undefined ? {} : { serialNumbers: [...o.value.serialNumbers] }),
    origin: { type: o.value.origin.type, locationId: o.value.origin.locationId },
    destination: { type: o.value.destination.type, locationId: o.value.destination.locationId },
    status: o.status,
  };
}

function validateRequest(data: unknown): { cursor: string | null } {
  if (data === undefined || data === null) return { cursor: null };
  if (typeof data !== "object" || Array.isArray(data)) throw new ReceivableReadError("READ_INVALID", "request must be an object");
  const obj = data as Record<string, unknown>;
  // Only a cursor. employeeId / truckId / destination / status / filters are server facts and are refused.
  if (Object.keys(obj).some((k) => k !== "cursor")) throw new ReceivableReadError("READ_INVALID", "request has unknown fields");
  if (obj.cursor === undefined || obj.cursor === null) return { cursor: null };
  if (typeof obj.cursor !== "string" || !isSafeDocumentIdSegment(obj.cursor)) throw new ReceivableReadError("READ_INVALID", "cursor invalid");
  return { cursor: obj.cursor };
}

export async function listMyReceivableTransfers(actorUid: string, data: unknown, deps: ReceivableReadDeps) {
  const { cursor } = validateRequest(data);
  const { db } = deps;
  return db.runTransaction(async (txn) => {
    // Authority first: an unauthorized caller learns nothing about identities or trucks.
    if (!(await deps.resolveReceivePermission(txn, actorUid))) {
      throw new ReceivableReadError("PERMISSION_DENIED", "not authorized to receive transfers");
    }
    const userSnap = await txn.get(db.collection("users").doc(actorUid));
    const technicianId = userSnap.exists ? (userSnap.data() ?? {}).technicianId : undefined;
    if (typeof technicianId !== "string" || technicianId.trim() === "") {
      throw new ReceivableReadError("TECHNICIAN_IDENTITY_UNAVAILABLE", "this account has no technician mapping");
    }
    const { mobile, ambiguous } = await readAssignedMobileLocation(db, technicianId, txn);
    // Two trucks is a broken one-driver-one-truck promise: fail closed, never pick one.
    if (ambiguous) throw new ReceivableReadError("TRUCK_ASSIGNMENT_AMBIGUOUS", "truck assignment is ambiguous");
    if (mobile === null) throw new ReceivableReadError("NO_TRUCK_ASSIGNMENT", "no active truck is assigned");

    // Equality filters only, ordered by document id: served by the automatic single-field indexes.
    let q = db.collection(TRANSFER_ORDERS_COLLECTION)
      .where("destination.type", "==", "MOBILE")
      .where("destination.locationId", "==", mobile.locationId)
      .where("status", "==", RECEIVABLE_STATUS)
      .orderBy(FieldPath.documentId())
      .limit(RECEIVABLE_PAGE_MAX + 1);
    if (cursor) q = q.startAfter(cursor);
    const snap = await txn.get(q);
    const docs = snap.docs.slice(0, RECEIVABLE_PAGE_MAX);

    let orders: DeserializedTransferOrder[];
    try {
      orders = docs.map((d) => deserializeTransferOrder(d.id, d.data()));
    } catch {
      // Fails closed: a malformed order is never shown half-read, and never silently dropped as "no work".
      throw new ReceivableReadError("MALFORMED_STORED_RECORD", "a stored transfer order is malformed");
    }
    // Belt and braces: the query decided scope; the deserialized record must agree with it.
    for (const o of orders) {
      if (o.status !== RECEIVABLE_STATUS || o.value.destination.type !== "MOBILE" || o.value.destination.locationId !== mobile.locationId) {
        throw new ReceivableReadError("MALFORMED_STORED_RECORD", "a stored transfer order disagrees with its index");
      }
    }
    return {
      truck: { locationId: mobile.locationId, label: mobile.label },
      transfers: orders.map(receivableProjection),
      nextCursor: snap.docs.length > RECEIVABLE_PAGE_MAX ? docs[docs.length - 1].id : null,
    };
  }, { readOnly: true });
}
