// Receiving Phase-2 E1: the trusted Receiving CALLABLES (receiveInventoryStock, listReceivingLocationOptions)
// and their exact, sanitized request/response/error contracts. firebase-functions v2 onCall. The actor is
// derived ONLY from request.auth.uid; authorization is the merged governed resolver for the UNGRANTED
// inventory.stock.receive capability (so every real user is denied). The receive callable runs the pinned
// production composition (concrete §3A resolver); the option callable runs the merged trusted option
// service. Errors map to a bounded public HttpsError matrix -- no raw Firestore path/value/code/reason
// escapes. Handlers are exported for focused tests; the exported onCall symbols pin the real production
// wiring so no client can supply an actor, resolver, or audit seam.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest, FunctionsErrorCode } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { receiveInventoryStockProduction } from "./receiveInventoryStockComposition.js";
import { ReceiveCommandError, type ResolvedPart, type ReceiveAuditInput } from "./receiveInventoryStockCommand.js";
import { IdempotencyConflictError, MalformedStoredRecordError, InvalidReceivingError } from "./receivingTypes.js";
import { listEligibleReceivingLocationOptions, ReceivingLocationOptionsError } from "../warehouseGovernance/receivingLocationOptionsService.js";
import { resolveReceivePermissionThroughTxn, resolveReceivePartThroughTxn, stageReceiveAuditEvent } from "./receivingCallableWiring.js";

const REGION = { region: "us-central1" } as const;

// -------- helpers --------
function isPlainObject(v: unknown): v is Record<string, unknown> { return typeof v === "object" && v !== null && !Array.isArray(v); }
function isNonBlankString(v: unknown): v is string { return typeof v === "string" && v.trim() !== ""; }
function isFiniteNumber(v: unknown): v is number { return typeof v === "number" && Number.isFinite(v); }
function invalidArg(msg: string): HttpsError { return new HttpsError("invalid-argument", msg); }
function noUnknownKeys(obj: Record<string, unknown>, allowed: ReadonlySet<string>): boolean { return Object.keys(obj).every((k) => allowed.has(k)); }

// Derive the trusted actor UID from the server-verified auth context ONLY (never request.data).
export function requireAuth(request: { auth?: { uid?: unknown } | null }): string {
  if (!request.auth || typeof request.auth.uid !== "string" || request.auth.uid.length === 0) {
    throw new HttpsError("unauthenticated", "Must be signed in.");
  }
  return request.auth.uid;
}

// -------- exact request contracts (structural -> invalid-argument) --------
const RECEIVE_TOP_KEYS: ReadonlySet<string> = new Set(["source", "receivingLocation", "lines", "idempotencyKey"]);
const SOURCE_KEYS: ReadonlySet<string> = new Set(["type", "reorderRequestId", "purchaseOrderId"]);
const LOCATION_KEYS: ReadonlySet<string> = new Set(["type", "locationId"]);
const LINE_KEYS: ReadonlySet<string> = new Set(["lineId", "partId", "expectedQuantity", "receivedQuantity"]);

// Validate the exact receive payload; any unknown/server-owned/actor field or wrong type is invalid-argument.
export function validateReceiveRequest(data: unknown): Record<string, unknown> {
  if (!isPlainObject(data)) throw invalidArg("Request data must be an object.");
  if (!noUnknownKeys(data, RECEIVE_TOP_KEYS)) throw invalidArg("The request has unknown fields.");
  const source = data.source;
  if (!isPlainObject(source) || !noUnknownKeys(source, SOURCE_KEYS)) throw invalidArg("source is missing or has unknown fields.");
  if (source.type !== "REORDER_PURCHASE_ORDER") throw invalidArg("source.type is invalid.");
  if (!isNonBlankString(source.reorderRequestId)) throw invalidArg("source.reorderRequestId is invalid.");
  if (!isNonBlankString(source.purchaseOrderId)) throw invalidArg("source.purchaseOrderId is invalid.");
  const loc = data.receivingLocation;
  if (!isPlainObject(loc) || !noUnknownKeys(loc, LOCATION_KEYS)) throw invalidArg("receivingLocation is missing or has unknown fields.");
  if (loc.type !== "WAREHOUSE") throw invalidArg("receivingLocation.type is invalid.");
  if (!isNonBlankString(loc.locationId)) throw invalidArg("receivingLocation.locationId is invalid.");
  const lines = data.lines;
  // First slice: exactly one line. Empty or multiple lines are an invalid payload (invalid-argument),
  // rejected at the callable boundary before authorization or any Firestore read.
  if (!Array.isArray(lines) || lines.length !== 1) throw invalidArg("lines must contain exactly one line.");
  for (const line of lines) {
    if (!isPlainObject(line) || !noUnknownKeys(line, LINE_KEYS)) throw invalidArg("a line is missing or has unknown fields.");
    if (!isNonBlankString(line.lineId)) throw invalidArg("line.lineId is invalid.");
    if (!isNonBlankString(line.partId)) throw invalidArg("line.partId is invalid.");
    if (!isFiniteNumber(line.expectedQuantity)) throw invalidArg("line.expectedQuantity is invalid.");
    if (!isFiniteNumber(line.receivedQuantity)) throw invalidArg("line.receivedQuantity is invalid.");
  }
  if (!isNonBlankString(data.idempotencyKey)) throw invalidArg("idempotencyKey is invalid.");
  return data;
}

// Options request must be the EXACT empty object {}. null/undefined/arrays/primitives/any keyed object
// are invalid-argument (the client must explicitly send {}).
export function validateEmptyRequest(data: unknown): void {
  if (!isPlainObject(data) || Object.keys(data).length > 0) throw invalidArg("This request takes no fields.");
}

// -------- error matrices (bounded, sanitized public codes) --------
export function mapReceiveError(err: unknown): HttpsError {
  if (err instanceof HttpsError) return err; // the structural invalid-argument we threw
  if (err instanceof ReceiveCommandError) {
    const code: FunctionsErrorCode =
      err.code === "PERMISSION_DENIED" ? "permission-denied"
      : err.code === "SOURCE_NOT_FOUND" ? "not-found"
      : err.code === "SOURCE_NOT_RECEIVABLE" ? "failed-precondition"
      : err.code === "DESTINATION_INVALID" ? "failed-precondition"
      : err.code === "PART_INVALID" ? "failed-precondition"
      : "internal"; // RECEIVING_INTEGRITY / unknown -> internal
    const message =
      code === "permission-denied" ? "You are not authorized to receive stock."
      : code === "not-found" ? "The referenced source could not be found."
      : code === "failed-precondition" ? "The receipt is not currently permitted for the referenced source, destination, or part."
      : "The receipt could not be completed.";
    return new HttpsError(code, message);
  }
  if (err instanceof IdempotencyConflictError) return new HttpsError("failed-precondition", "This receipt conflicts with a prior request for the same key.");
  if (err instanceof MalformedStoredRecordError) return new HttpsError("failed-precondition", "The stored receiving state is inconsistent.");
  if (err instanceof InvalidReceivingError) return new HttpsError("invalid-argument", "The request is missing or has invalid fields.");
  return new HttpsError("internal", "The receipt could not be completed.");
}

export function mapOptionsError(err: unknown): HttpsError {
  if (err instanceof HttpsError) return err;
  if (err instanceof ReceivingLocationOptionsError) {
    const code: FunctionsErrorCode =
      err.code === "INVALID_REQUEST" ? "invalid-argument"
      : err.code === "PERMISSION_DENIED" ? "permission-denied"
      : "internal"; // SOURCE_UNAVAILABLE / unknown -> internal
    const message =
      code === "invalid-argument" ? "This request takes no fields."
      : code === "permission-denied" ? "You are not authorized to list receiving locations."
      : "Receiving locations are temporarily unavailable.";
    return new HttpsError(code, message);
  }
  return new HttpsError("internal", "Receiving locations are temporarily unavailable.");
}

// -------- testable handlers (production wiring pinned; tests inject a synthetic grant seam) --------
export interface ReceiveCallableWiring {
  readonly db: Firestore;
  readonly resolvePermission: (txn: Transaction, actorId: string) => Promise<boolean>;
  readonly resolvePart: (txn: Transaction, partId: string) => Promise<ResolvedPart | null>;
  readonly stageAudit: (txn: Transaction, audit: ReceiveAuditInput) => void;
  readonly now: () => Date;
}

export async function runReceiveInventoryStock(request: CallableRequest<unknown>, wiring: ReceiveCallableWiring) {
  const actorUid = requireAuth(request);
  const validated = validateReceiveRequest(request.data);
  try {
    return await receiveInventoryStockProduction(validated, {
      db: wiring.db,
      actor: { kind: "USER", id: actorUid },
      authorize: (txn, actorId, _capability) => wiring.resolvePermission(txn, actorId),
      resolvePart: (txn, partId) => wiring.resolvePart(txn, partId),
      stageAudit: wiring.stageAudit,
      now: wiring.now,
    });
  } catch (err) {
    throw mapReceiveError(err);
  }
}

export async function runListReceivingLocationOptions(request: CallableRequest<unknown>, wiring: ReceiveCallableWiring) {
  const actorUid = requireAuth(request);
  validateEmptyRequest(request.data);
  try {
    const options = await listEligibleReceivingLocationOptions({}, {
      actor: { kind: "USER", id: actorUid },
      authorize: (txn, actorId) => wiring.resolvePermission(txn, actorId),
      readCandidateWarehouses: async (txn) => {
        const snap = await txn.get(wiring.db.collection("warehouses"));
        return snap.docs.map((d) => ({ warehouseId: d.id, data: d.data() }));
      },
      runRead: (fn) => wiring.db.runTransaction(fn),
    });
    return { options };
  } catch (err) {
    throw mapOptionsError(err);
  }
}

// Real production wiring, built lazily at invocation (after initializeApp). Pins the governed resolver,
// Part authority, and immutable audit writer -- no client-supplied actor/resolver/audit seam.
function productionWiring(): ReceiveCallableWiring {
  const db = getFirestore();
  return {
    db,
    resolvePermission: (txn, actorId) => resolveReceivePermissionThroughTxn(txn, db, actorId),
    resolvePart: (txn, partId) => resolveReceivePartThroughTxn(txn, db, partId),
    stageAudit: stageReceiveAuditEvent,
    now: () => new Date(),
  };
}

export const receiveInventoryStockCallable = onCall(REGION, (request) => runReceiveInventoryStock(request, productionWiring()));
export const listReceivingLocationOptionsCallable = onCall(REGION, (request) => runListReceivingLocationOptions(request, productionWiring()));
