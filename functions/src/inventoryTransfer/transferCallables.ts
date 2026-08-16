// Enterprise Inventory Phase 4 -- the trusted transfer CALLABLES (createTransferOrder,
// dispatchTransferOrder, receiveTransferOrder, cancelTransferOrder) and their exact, sanitized
// request/response/error contracts. firebase-functions v2 onCall. Mirrors receivingCallables.ts. The
// actor is derived ONLY from request.auth.uid; authorization is the merged governed resolver for each
// UNGRANTED inventory.transfer.* capability (active: false), so every real user is denied until a
// separate grant + activation gate. No production caller can supply an actor, resolver, or audit seam.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest, FunctionsErrorCode } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import {
  createTransferOrderProduction,
  dispatchTransferOrderProduction,
  receiveTransferOrderProduction,
  cancelTransferOrderProduction,
  type TransferCommandCompositionInput,
} from "./transferCommandComposition.js";
import { TransferCommandError, type TransferCommandFailureCode } from "./transferOrderTypes.js";
import { makeResolveTransferPermissionThroughTxn, resolveTransferPartThroughTxn, stageTransferAuditEvent } from "./transferCallableWiring.js";

const REGION = { region: "us-central1" } as const;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isNonBlankString(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "";
}
function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
function invalidArg(msg: string): HttpsError {
  return new HttpsError("invalid-argument", msg);
}
function noUnknownKeys(obj: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(obj).every((k) => allowed.has(k));
}
function requireAuth(request: { auth?: { uid?: unknown } | null }): string {
  if (!request.auth || typeof request.auth.uid !== "string" || request.auth.uid.length === 0) {
    throw new HttpsError("unauthenticated", "Must be signed in.");
  }
  return request.auth.uid;
}

// -------- CREATE request contract --------
const CREATE_KEYS: ReadonlySet<string> = new Set(["partId", "quantity", "origin", "destination", "serialNumbers", "idempotencyKey"]);
const LOCATION_KEYS: ReadonlySet<string> = new Set(["type", "locationId"]);
function validateLocationShape(loc: unknown, field: string): void {
  if (!isPlainObject(loc) || !noUnknownKeys(loc, LOCATION_KEYS)) throw invalidArg(`${field} is missing or has unknown fields.`);
  if (loc.type !== "WAREHOUSE" && loc.type !== "MOBILE") throw invalidArg(`${field}.type is invalid.`);
  if (!isNonBlankString(loc.locationId)) throw invalidArg(`${field}.locationId is invalid.`);
}
function validateCreateRequest(data: unknown): Record<string, unknown> {
  if (!isPlainObject(data)) throw invalidArg("Request data must be an object.");
  if (!noUnknownKeys(data, CREATE_KEYS)) throw invalidArg("The request has unknown fields.");
  if (!isNonBlankString(data.partId)) throw invalidArg("partId is invalid.");
  if (!isFiniteNumber(data.quantity)) throw invalidArg("quantity is invalid.");
  validateLocationShape(data.origin, "origin");
  validateLocationShape(data.destination, "destination");
  if (data.serialNumbers !== undefined) {
    if (!Array.isArray(data.serialNumbers) || !data.serialNumbers.every((s) => isNonBlankString(s))) throw invalidArg("serialNumbers is invalid.");
  }
  if (!isNonBlankString(data.idempotencyKey)) throw invalidArg("idempotencyKey is invalid.");
  return data;
}

// -------- transferOrderId-only request contract (dispatch/receive/cancel) --------
const ID_ONLY_KEYS: ReadonlySet<string> = new Set(["transferOrderId"]);
function validateIdOnlyRequest(data: unknown): Record<string, unknown> {
  if (!isPlainObject(data)) throw invalidArg("Request data must be an object.");
  if (!noUnknownKeys(data, ID_ONLY_KEYS)) throw invalidArg("The request has unknown fields.");
  if (!isNonBlankString(data.transferOrderId)) throw invalidArg("transferOrderId is invalid.");
  return data;
}

// -------- sanitized error matrix --------
function mapTransferError(err: unknown): HttpsError {
  if (err instanceof HttpsError) return err;
  if (err instanceof TransferCommandError) {
    const code: FunctionsErrorCode = mapCode(err.code);
    const message =
      code === "permission-denied" ? "You are not authorized to perform this transfer action."
      : code === "not-found" ? "The transfer order could not be found."
      : code === "failed-precondition" ? "This transfer action is not currently permitted."
      : "The transfer action could not be completed.";
    return new HttpsError(code, message);
  }
  return new HttpsError("internal", "The transfer action could not be completed.");
}
function mapCode(code: TransferCommandFailureCode): FunctionsErrorCode {
  switch (code) {
    case "PERMISSION_DENIED":
      return "permission-denied";
    case "TRANSFER_NOT_FOUND":
      return "not-found";
    case "ORIGIN_INVALID":
    case "DESTINATION_INVALID":
    case "SAME_LOCATION":
    case "PART_INVALID":
    case "SERIAL_INVALID":
    case "INSUFFICIENT_STOCK":
    case "STATUS_INVALID":
    case "IDEMPOTENCY_CONFLICT":
    case "MALFORMED_STORED_RECORD":
      return "failed-precondition";
    default:
      return "internal"; // TRANSFER_INTEGRITY / unknown
  }
}

// -------- testable handlers (production wiring pinned) --------
export interface TransferCallableWiring {
  readonly db: Firestore;
  readonly resolveCreatePermission: (txn: Transaction, actorId: string) => Promise<boolean>;
  readonly resolveDispatchPermission: (txn: Transaction, actorId: string) => Promise<boolean>;
  readonly resolveReceivePermission: (txn: Transaction, actorId: string) => Promise<boolean>;
  readonly resolveCancelPermission: (txn: Transaction, actorId: string) => Promise<boolean>;
  readonly resolvePart: TransferCommandCompositionInput["resolvePart"];
  readonly stageAudit: TransferCommandCompositionInput["stageAudit"];
  readonly now: () => Date;
}

export async function runCreateTransferOrder(request: CallableRequest<unknown>, wiring: TransferCallableWiring) {
  const actorUid = requireAuth(request);
  const validated = validateCreateRequest(request.data);
  try {
    const outcome = await createTransferOrderProduction(validated, {
      db: wiring.db,
      actor: { kind: "USER", id: actorUid },
      authorize: (txn, actorId) => wiring.resolveCreatePermission(txn, actorId),
      resolvePart: wiring.resolvePart,
      stageAudit: wiring.stageAudit,
      now: wiring.now,
    });
    return { outcome: outcome.outcome, transferOrderId: outcome.transferOrderId };
  } catch (err) {
    throw mapTransferError(err);
  }
}

export async function runDispatchTransferOrder(request: CallableRequest<unknown>, wiring: TransferCallableWiring) {
  const actorUid = requireAuth(request);
  const validated = validateIdOnlyRequest(request.data);
  try {
    const outcome = await dispatchTransferOrderProduction(validated, {
      db: wiring.db,
      actor: { kind: "USER", id: actorUid },
      authorize: (txn, actorId) => wiring.resolveDispatchPermission(txn, actorId),
      resolvePart: wiring.resolvePart,
      stageAudit: wiring.stageAudit,
      now: wiring.now,
    });
    return { outcome: outcome.outcome, transferOrderId: outcome.transferOrderId };
  } catch (err) {
    throw mapTransferError(err);
  }
}

export async function runReceiveTransferOrder(request: CallableRequest<unknown>, wiring: TransferCallableWiring) {
  const actorUid = requireAuth(request);
  const validated = validateIdOnlyRequest(request.data);
  try {
    const outcome = await receiveTransferOrderProduction(validated, {
      db: wiring.db,
      actor: { kind: "USER", id: actorUid },
      authorize: (txn, actorId) => wiring.resolveReceivePermission(txn, actorId),
      resolvePart: wiring.resolvePart,
      stageAudit: wiring.stageAudit,
      now: wiring.now,
    });
    return { outcome: outcome.outcome, transferOrderId: outcome.transferOrderId };
  } catch (err) {
    throw mapTransferError(err);
  }
}

export async function runCancelTransferOrder(request: CallableRequest<unknown>, wiring: TransferCallableWiring) {
  const actorUid = requireAuth(request);
  const validated = validateIdOnlyRequest(request.data);
  try {
    const outcome = await cancelTransferOrderProduction(validated, {
      db: wiring.db,
      actor: { kind: "USER", id: actorUid },
      authorize: (txn, actorId) => wiring.resolveCancelPermission(txn, actorId),
      resolvePart: wiring.resolvePart,
      stageAudit: wiring.stageAudit,
      now: wiring.now,
    });
    return { outcome: outcome.outcome, transferOrderId: outcome.transferOrderId };
  } catch (err) {
    throw mapTransferError(err);
  }
}

function productionWiring(): TransferCallableWiring {
  const db = getFirestore();
  return {
    db,
    resolveCreatePermission: (txn, actorId) => makeResolveTransferPermissionThroughTxn("inventory.transfer.create")(txn, db, actorId),
    resolveDispatchPermission: (txn, actorId) => makeResolveTransferPermissionThroughTxn("inventory.transfer.dispatch")(txn, db, actorId),
    resolveReceivePermission: (txn, actorId) => makeResolveTransferPermissionThroughTxn("inventory.transfer.receive")(txn, db, actorId),
    resolveCancelPermission: (txn, actorId) => makeResolveTransferPermissionThroughTxn("inventory.transfer.cancel")(txn, db, actorId),
    resolvePart: (txn, partId) => resolveTransferPartThroughTxn(txn, db, partId),
    stageAudit: stageTransferAuditEvent,
    now: () => new Date(),
  };
}

export const createTransferOrderCallable = onCall(REGION, (request) => runCreateTransferOrder(request, productionWiring()));
export const dispatchTransferOrderCallable = onCall(REGION, (request) => runDispatchTransferOrder(request, productionWiring()));
export const receiveTransferOrderCallable = onCall(REGION, (request) => runReceiveTransferOrder(request, productionWiring()));
export const cancelTransferOrderCallable = onCall(REGION, (request) => runCancelTransferOrder(request, productionWiring()));
