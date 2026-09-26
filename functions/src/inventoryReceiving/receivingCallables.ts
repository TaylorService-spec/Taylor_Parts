// Receiving Phase-2 E1: the trusted Receiving CALLABLES (receiveInventoryStock, listReceivingLocationOptions)
// and their exact, sanitized request/response/error contracts. Deployed and live in eos-platform-sandbox
// (2026-08-06, Decision #63). firebase-functions v2 onCall. The actor is derived ONLY from
// request.auth.uid; authorization is the merged governed resolver for the GRANTED inventory.stock.receive
// capability (admin, dispatcher, owner -- Decisions #65/#68; every other principal is still denied). The
// receive callable runs the pinned
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
import { IdempotencyConflictError, MalformedStoredRecordError, InvalidReceivingError, LEGACY_SOURCE_TYPE, CANONICAL_SOURCE_TYPE } from "./receivingTypes.js";
import { listEligibleReceivingLocationOptions, ReceivingLocationOptionsError } from "../warehouseGovernance/receivingLocationOptionsService.js";
import { resolveReceivePermissionThroughTxn, resolveReceivePartThroughTxn, resolveReceivePartOutsideTxn, stageReceiveAuditEvent } from "./receivingCallableWiring.js";
import { resolveEffectiveAccess } from "../access/effectiveAccessFeed.js";
import {
  readPurchaseOrderProgress,
  listReceivablePurchaseOrders,
  PurchaseOrderProgressNotFoundError,
  PurchaseOrderProgressInvalidError,
} from "./purchaseOrderProgressRead.js";

const RECEIVE_CAPABILITY_ID = "inventory.stock.receive";

// The capability gate for the two READ paths. The write path resolves through its own transaction
// (commit-time authoritative, so a concurrent revocation conflicts the commit); a read has no
// transaction and uses the established non-transactional resolver. A THROWING resolver is a denial,
// never an allow.
async function requireReceiveCapability(uid: string): Promise<void> {
  let allowed = false;
  try {
    const { decisions } = await resolveEffectiveAccess({ principalUid: uid, permissionIds: [RECEIVE_CAPABILITY_ID] });
    allowed = decisions[RECEIVE_CAPABILITY_ID] === true;
  } catch (err) {
    console.error("[requireReceiveCapability] capability resolution failed", err);
    allowed = false;
  }
  if (!allowed) throw new HttpsError("permission-denied", "You are not authorized to receive stock.");
}

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
//
// TWO SOURCE AUTHORITIES, ONE CALLABLE, ONE COMMAND. The request states its authority in
// `source.type` (receivingTypes.ts RECEIVING_SOURCE_TYPES) and this boundary checks the exact shape
// for THAT authority, then hands the unchanged payload to the one receiving command. Everything
// semantic -- line membership, part match, remaining/over-receipt, serial count/duplication, the
// optimistic version, idempotency -- stays the command's decision; this layer only rejects payloads
// that are structurally not a receipt.
//
// REORDER_PURCHASE_ORDER (legacy, deployed callers): UNCHANGED -- source {type, reorderRequestId,
//   purchaseOrderId}, exactly one line, expectedQuantity required, no expectedVersion.
// PURCHASE_ORDER (canonical multi-line, MultiScanReceiving): source {type, purchaseOrderId} and NO
//   reorderRequestId; one or more lines; a line carries NO expectedQuantity (what remains is a server
//   fact); optional top-level expectedVersion. This is exactly the shape
//   field-ops-app-vite/src/domain/receivingTransport.js buildCanonicalReceiveRequest sends. Before this
//   branch existed the boundary rejected every canonical request as invalid-argument, so the command's
//   canonical path was unreachable from the deployed callable.
const LEGACY_TOP_KEYS: ReadonlySet<string> = new Set(["source", "receivingLocation", "lines", "idempotencyKey"]);
const CANONICAL_TOP_KEYS: ReadonlySet<string> = new Set(["source", "receivingLocation", "lines", "idempotencyKey", "expectedVersion"]);
const LEGACY_SOURCE_KEYS: ReadonlySet<string> = new Set(["type", "reorderRequestId", "purchaseOrderId"]);
const CANONICAL_SOURCE_KEYS: ReadonlySet<string> = new Set(["type", "purchaseOrderId"]);
const LOCATION_KEYS: ReadonlySet<string> = new Set(["type", "locationId"]);
// `serialNumbers` is permitted STRUCTURALLY here (SERIAL receipts, Wave 7). This layer only checks
// shape; whether serials are required, forbidden, correctly counted or duplicated is decided by the
// command's own validator against the AUTHORITATIVE Part tracking mode and PO ordered quantity, which
// this boundary cannot see. Omitting the key here silently broke SERIAL receiving end to end: this
// check runs BEFORE the command, so a well-formed serial payload was rejected as an unknown field.
const LEGACY_LINE_KEYS: ReadonlySet<string> = new Set(["lineId", "partId", "expectedQuantity", "receivedQuantity", "serialNumbers"]);
const CANONICAL_LINE_KEYS: ReadonlySet<string> = new Set(["lineId", "partId", "receivedQuantity", "serialNumbers"]);

// Validate the exact receive payload; any unknown/server-owned/actor field or wrong type is invalid-argument.
export function validateReceiveRequest(data: unknown): Record<string, unknown> {
  if (!isPlainObject(data)) throw invalidArg("Request data must be an object.");
  const source = data.source;
  if (!isPlainObject(source)) throw invalidArg("source is missing or has unknown fields.");
  const isCanonical = source.type === CANONICAL_SOURCE_TYPE;
  if (!isCanonical && source.type !== LEGACY_SOURCE_TYPE) throw invalidArg("source.type is invalid.");
  if (!noUnknownKeys(data, isCanonical ? CANONICAL_TOP_KEYS : LEGACY_TOP_KEYS)) throw invalidArg("The request has unknown fields.");
  if (!noUnknownKeys(source, isCanonical ? CANONICAL_SOURCE_KEYS : LEGACY_SOURCE_KEYS)) throw invalidArg("source is missing or has unknown fields.");
  if (!isCanonical && !isNonBlankString(source.reorderRequestId)) throw invalidArg("source.reorderRequestId is invalid.");
  if (!isNonBlankString(source.purchaseOrderId)) throw invalidArg("source.purchaseOrderId is invalid.");
  const loc = data.receivingLocation;
  if (!isPlainObject(loc) || !noUnknownKeys(loc, LOCATION_KEYS)) throw invalidArg("receivingLocation is missing or has unknown fields.");
  if (loc.type !== "WAREHOUSE") throw invalidArg("receivingLocation.type is invalid.");
  if (!isNonBlankString(loc.locationId)) throw invalidArg("receivingLocation.locationId is invalid.");
  const lines = data.lines;
  // Legacy: exactly one line (a legacy PO is one part by construction). Canonical: one or more.
  // Empty/non-array is invalid-argument for both, rejected before authorization or any Firestore read.
  if (!Array.isArray(lines) || lines.length === 0) throw invalidArg("lines must contain at least one line.");
  if (!isCanonical && lines.length !== 1) throw invalidArg("lines must contain exactly one line.");
  const lineKeys = isCanonical ? CANONICAL_LINE_KEYS : LEGACY_LINE_KEYS;
  for (const line of lines) {
    if (!isPlainObject(line) || !noUnknownKeys(line, lineKeys)) throw invalidArg("a line is missing or has unknown fields.");
    if (!isNonBlankString(line.lineId)) throw invalidArg("line.lineId is invalid.");
    if (!isNonBlankString(line.partId)) throw invalidArg("line.partId is invalid.");
    if (!isCanonical && !isFiniteNumber(line.expectedQuantity)) throw invalidArg("line.expectedQuantity is invalid.");
    if (!isFiniteNumber(line.receivedQuantity)) throw invalidArg("line.receivedQuantity is invalid.");
    // Canonical only: a fractional quantity is structurally not a receipt, so it is invalid-argument
    // here rather than a later failed-precondition. Positivity stays the command's rule. The legacy
    // branch is deliberately untouched so deployed callers see exactly the error codes they always did.
    if (isCanonical && !Number.isInteger(line.receivedQuantity)) throw invalidArg("line.receivedQuantity is invalid.");
    // Shape only: when present it must be an array of non-blank strings. Count, duplication and
    // whether serials are required at all are the command's decisions, made against the authoritative
    // Part tracking mode -- this boundary must not second-guess them or it would fork the rule.
    if (line.serialNumbers !== undefined) {
      if (!Array.isArray(line.serialNumbers)) throw invalidArg("line.serialNumbers is invalid.");
      if (!line.serialNumbers.every((s) => isNonBlankString(s))) throw invalidArg("line.serialNumbers is invalid.");
    }
  }
  // Canonical only (legacy rejects the key above). Shape only; whether it matches the PO's current
  // version is the command's optimistic-concurrency check.
  if (data.expectedVersion !== undefined && (!isFiniteNumber(data.expectedVersion) || !Number.isInteger(data.expectedVersion) || data.expectedVersion < 0)) {
    throw invalidArg("expectedVersion is invalid.");
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
    // A serial already registered to another asset/receipt is a PERMANENT business refusal, not a
    // transient failure. It must not surface as "internal": the client maps that to UNAVAILABLE and
    // queues the receipt for an offline retry that can never succeed. failed-precondition is this
    // callable's conflict code (the client maps it to CONFLICT), matching acquireSerializedAsset's
    // ALREADY_EXISTS_CONFLICT. details carry ONLY the stable reason -- no serial, asset or receipt id.
    // Firebase repair (S1-S); deleted with the callable when Receiving cuts over to Render/PG (#1961).
    if (err.code === "SERIAL_IDENTITY_CONFLICT") {
      return new HttpsError(
        "failed-precondition",
        "A serial number in this receipt is already registered to another unit.",
        { reason: "SERIAL_IDENTITY_CONFLICT" },
      );
    }
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
    const outcome = await receiveInventoryStockProduction(validated, {
      db: wiring.db,
      actor: { kind: "USER", id: actorUid },
      authorize: (txn, actorId, _capability) => wiring.resolvePermission(txn, actorId),
      resolvePart: (txn, partId) => wiring.resolvePart(txn, partId),
      stageAudit: wiring.stageAudit,
      now: wiring.now,
    });
    // The callable's LEGACY public response stays exactly these three fields. The command's own outcome also
    // carries `ledgerEventIds` (and `serializedAssetIds` for a SERIAL receipt), but those are internal
    // detail: widening a deployed callable's response is a contract change in its own right, and a
    // client has no use for per-serial ids it cannot read anyway (serialized_assets is client-denied).
    // receivingCallablesEmulator.test.mjs pins this key set deliberately.
    //
    // A CANONICAL (PURCHASE_ORDER) receipt additionally returns the per-line progress the Multi-Scan
    // screen needs -- exactly the allow-list field-ops-app-vite/src/domain/receivingTransport.js
    // validateCanonicalReceiveResponse requires (purchaseOrderId, derivedState, storedStatus, lines).
    // Without them that validator rejects a COMMITTED receipt as a malformed response and the screen
    // reports the transport unavailable. Still no ledgerEventIds / serializedAssetIds /
    // acquisitionCostIds. The legacy response is unchanged (three keys).
    if (outcome.sourceType === CANONICAL_SOURCE_TYPE) {
      return {
        outcome: outcome.outcome,
        receivingId: outcome.receivingId,
        ledgerEventId: outcome.ledgerEventId,
        purchaseOrderId: outcome.purchaseOrderId,
        derivedState: outcome.derivedState,
        storedStatus: outcome.storedStatus,
        lines: outcome.lines.map((l) => ({
          lineId: l.lineId,
          partId: l.partId,
          orderedQuantity: l.orderedQuantity,
          previouslyReceived: l.previouslyReceived,
          receivedNow: l.receivedNow,
          remainingQuantity: l.remainingQuantity,
          state: l.state,
        })),
      };
    }
    return { outcome: outcome.outcome, receivingId: outcome.receivingId, ledgerEventId: outcome.ledgerEventId };
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

// ═══════════════════════════ CANONICAL PO RECEIVING PROGRESS (read) ═══════════════════════════
//
// Phase D. The multi-scan surface needs the ordered lines AND what remains before an operator starts
// scanning. `purchase_orders` is client-readable, but `receiving_orders` is deny-all — so remaining
// cannot be derived in a browser, and without these reads the surface could show what was ordered and
// never what is outstanding.
//
// Gated on `inventory.stock.receive`: no new capability, and the people who may take a receipt are
// exactly the people who need to see what is left on it. READ-ONLY — no transaction, no write, no
// lifecycle change. The command re-derives inside its own transaction and remains the authority.
export const getPurchaseOrderReceivingProgressCallable = onCall(REGION, async (request) => {
  const actorId = requireAuth(request);
  await requireReceiveCapability(actorId);
  const data = (request.data ?? {}) as Record<string, unknown>;
  try {
    return await readPurchaseOrderProgress(
      getFirestore(),
      String(data.purchaseOrderId ?? ""),
      async (partId: string) => {
        const resolved = await resolveReceivePartOutsideTxn(getFirestore(), partId);
        return resolved === null ? null : resolved.trackingMode;
      },
    );
  } catch (err) {
    if (err instanceof PurchaseOrderProgressNotFoundError) throw new HttpsError("not-found", "That purchase order was not found.");
    if (err instanceof PurchaseOrderProgressInvalidError) throw new HttpsError("failed-precondition", "That purchase order cannot be received.");
    throw new HttpsError("internal", "The request could not be completed.");
  }
});

export const listReceivablePurchaseOrdersCallable = onCall(REGION, async (request) => {
  const actorId = requireAuth(request);
  await requireReceiveCapability(actorId);
  try {
    return { purchaseOrders: await listReceivablePurchaseOrders(getFirestore()) };
  } catch {
    throw new HttpsError("internal", "The request could not be completed.");
  }
});
