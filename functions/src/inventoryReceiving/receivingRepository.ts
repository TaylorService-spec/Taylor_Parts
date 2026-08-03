// Enterprise Inventory -- EI Phase-2 Receiving, Phase A: INERT receiving_orders PERSISTENCE boundary.
// INERT: no callable, no client writer, no ledger-append orchestration, no reorder closeout, no PO
// mutation, not invoked by any behavior. Provides deterministic path-safe identity + fingerprint,
// serialize / fail-closed deserialize (Timestamp->millis, no leak), and an idempotent stage function
// over an INJECTED store (reusing the merged inventoryLedger LedgerIdempotencyStore seam) so a future
// trusted command (Phase B) can stage the Receiving Order create INSIDE its own transaction. Reuses the
// merged inventoryLedger foundation; creates NO second ledger and touches no legacy collection.

import { createHash } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { validateLocationRef, isPlainObject, isNonEmptyString } from "../inventoryLedger/operationalMovementValidation.js";
import type { LedgerIdempotencyStore } from "../inventoryLedger/operationalMovementRepository.js";
import {
  RECEIVING_ORDERS_COLLECTION,
  RECEIVING_SCHEMA_VERSION,
  RECEIVING_INITIAL_VERSION,
  RECEIVING_SOURCE_TYPES,
  RECEIVING_LINE_TRACKING_MODE,
  RECEIVING_LINE_STATUS,
  IdempotencyConflictError,
  InvalidReceivingError,
  MalformedStoredRecordError,
  type ReceivingOrderValue,
  type ReceivingLineValue,
  type ReceivingActor,
  type ReceivingOutcome,
  type DeserializedReceivingOrder,
} from "./receivingTypes.js";
import { validateReceivingOrderInput } from "./receivingValidation.js";

// The injected idempotency store is the ledger foundation's generic { read, create } doc seam.
export type ReceivingIdempotencyStore = LedgerIdempotencyStore;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

// 16-hex fingerprint over the request-derived value only (not the server-authored actor/timestamps):
// replay iff equal, conflict iff not (mirrors the ledger/truck-registry precedent).
export function fingerprintReceivingOrder(value: ReceivingOrderValue): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex").slice(0, 16);
}

// Deterministic, PATH-SAFE receiving identity from the caller idempotencyKey. The raw caller string is
// never a Firestore path; the deterministic doc IS the idempotency record.
export function receivingOrderDocId(idempotencyKey: string): string {
  return "rcv_" + createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 40);
}

// Serialize a validated value into the stored order. actor + createdAt/updatedAt/createdBy/updatedBy are
// SERVER-AUTHORED from the trusted caller's actor and clock (never accepted from untrusted input).
export function serializeReceivingOrder(value: ReceivingOrderValue, actor: ReceivingActor, now: Date, fingerprint: string): Record<string, unknown> {
  return {
    schemaVersion: RECEIVING_SCHEMA_VERSION,
    receivingId: receivingOrderDocId(value.idempotencyKey), // stored identity == doc path; server-derived, never from input
    source: { type: value.source.type, reorderRequestId: value.source.reorderRequestId, purchaseOrderId: value.source.purchaseOrderId },
    receivingLocation: { type: value.receivingLocation.type, locationId: value.receivingLocation.locationId },
    status: value.status,
    version: value.version,
    lines: value.lines.map((l) => ({ lineId: l.lineId, partId: l.partId, trackingMode: l.trackingMode, expectedQuantity: l.expectedQuantity, receivedQuantity: l.receivedQuantity, status: l.status })),
    idempotencyKey: value.idempotencyKey,
    actor: { kind: actor.kind, id: actor.id },
    createdAt: Timestamp.fromDate(now),
    createdBy: actor.id,
    updatedAt: Timestamp.fromDate(now),
    updatedBy: actor.id,
    fingerprint,
  };
}

function isActor(a: unknown): a is ReceivingActor {
  return isPlainObject(a) && (a.kind === "USER" || a.kind === "SYSTEM") && isNonEmptyString(a.id);
}
function isPositiveFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

const STORED_KEYS = new Set([
  "schemaVersion", "receivingId", "source", "receivingLocation", "status", "version", "lines", "idempotencyKey",
  "actor", "createdAt", "createdBy", "updatedAt", "updatedBy", "fingerprint",
]);
const RECEIVING_ID_RE = /^rcv_[0-9a-f]{40}$/;
const STORED_LINE_KEYS = new Set(["lineId", "partId", "trackingMode", "expectedQuantity", "receivedQuantity", "status"]);

// Fail-closed deserialize of a stored receiving_orders record. Validates self-consistency (first-slice
// shape: PUTAWAY_COMPLETE / version 1 / one NONE line / expected == received), converts server
// Timestamps to millis (no Timestamp leaks into the value), and throws MalformedStoredRecordError on
// anything unexpected -- never normalizes malformed data into validity.
export function deserializeReceivingOrder(data: unknown): DeserializedReceivingOrder {
  if (!isPlainObject(data)) throw new MalformedStoredRecordError("stored receiving order is not an object");
  if (data.schemaVersion !== RECEIVING_SCHEMA_VERSION) throw new MalformedStoredRecordError("stored schemaVersion invalid");
  if (Object.keys(data).some((k) => !STORED_KEYS.has(k))) throw new MalformedStoredRecordError("stored record has unknown field");

  if (data.status !== "PUTAWAY_COMPLETE") throw new MalformedStoredRecordError("stored status invalid for first-slice order");
  if (data.version !== RECEIVING_INITIAL_VERSION) throw new MalformedStoredRecordError("stored version invalid for first-slice order");

  const source = data.source;
  if (!isPlainObject(source) || typeof source.type !== "string" || !(RECEIVING_SOURCE_TYPES as readonly string[]).includes(source.type) ||
      !isNonEmptyString(source.reorderRequestId) || !isNonEmptyString(source.purchaseOrderId) || source.purchaseOrderId !== source.reorderRequestId) {
    throw new MalformedStoredRecordError("stored source invalid");
  }
  const location = validateLocationRef(data.receivingLocation);
  if (location === null) throw new MalformedStoredRecordError("stored receivingLocation invalid");

  if (!Array.isArray(data.lines) || data.lines.length !== 1) throw new MalformedStoredRecordError("stored lines invalid");
  const l = data.lines[0];
  if (!isPlainObject(l) || Object.keys(l).some((k) => !STORED_LINE_KEYS.has(k))) throw new MalformedStoredRecordError("stored line shape invalid");
  if (!isNonEmptyString(l.lineId) || !isNonEmptyString(l.partId)) throw new MalformedStoredRecordError("stored line identity invalid");
  if (l.trackingMode !== RECEIVING_LINE_TRACKING_MODE || l.status !== RECEIVING_LINE_STATUS) throw new MalformedStoredRecordError("stored line mode/status invalid");
  if (!isPositiveFiniteNumber(l.expectedQuantity) || !isPositiveFiniteNumber(l.receivedQuantity) || l.expectedQuantity !== l.receivedQuantity) {
    throw new MalformedStoredRecordError("stored line quantity invalid");
  }
  if (!isNonEmptyString(data.idempotencyKey)) throw new MalformedStoredRecordError("stored idempotencyKey invalid");
  // Stored identity must be a path-safe receivingId that agrees with the idempotency-derived doc id.
  if (typeof data.receivingId !== "string" || !RECEIVING_ID_RE.test(data.receivingId)) throw new MalformedStoredRecordError("stored receivingId invalid");
  if (data.receivingId !== receivingOrderDocId(data.idempotencyKey)) throw new MalformedStoredRecordError("stored receivingId does not agree with its idempotencyKey");
  if (!isActor(data.actor)) throw new MalformedStoredRecordError("stored actor invalid");
  if (!isNonEmptyString(data.createdBy) || !isNonEmptyString(data.updatedBy)) throw new MalformedStoredRecordError("stored createdBy/updatedBy invalid");
  if (!(data.createdAt instanceof Timestamp) || !(data.updatedAt instanceof Timestamp)) throw new MalformedStoredRecordError("stored timestamps are not server Timestamps");
  // First-slice immutable single-version-1 creation: metadata must be internally coherent.
  if (data.createdBy !== data.actor.id) throw new MalformedStoredRecordError("stored createdBy does not match actor.id");
  if (data.updatedBy !== data.actor.id) throw new MalformedStoredRecordError("stored updatedBy does not match actor.id");
  if (data.createdAt.toMillis() !== data.updatedAt.toMillis()) throw new MalformedStoredRecordError("stored createdAt/updatedAt are not the same instant");
  if (typeof data.fingerprint !== "string" || !/^[0-9a-f]{16}$/.test(data.fingerprint)) throw new MalformedStoredRecordError("stored fingerprint invalid");

  const line: ReceivingLineValue = { lineId: l.lineId, partId: l.partId, trackingMode: RECEIVING_LINE_TRACKING_MODE, expectedQuantity: l.expectedQuantity, receivedQuantity: l.receivedQuantity, status: RECEIVING_LINE_STATUS };
  const value: ReceivingOrderValue = {
    source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId: source.reorderRequestId, purchaseOrderId: source.purchaseOrderId },
    receivingLocation: { type: location.type, locationId: location.locationId },
    status: "PUTAWAY_COMPLETE",
    version: RECEIVING_INITIAL_VERSION,
    lines: [line],
    idempotencyKey: data.idempotencyKey,
  };
  return {
    receivingId: data.receivingId,
    value,
    actor: { kind: data.actor.kind, id: data.actor.id },
    createdAt: data.createdAt.toDate().getTime(),
    updatedAt: data.updatedAt.toDate().getTime(),
    createdBy: data.createdBy,
    updatedBy: data.updatedBy,
    schemaVersion: RECEIVING_SCHEMA_VERSION,
    fingerprint: data.fingerprint,
  };
}

// Build a store from a live Firestore Transaction so the Receiving Order create composes inside a larger
// trusted transaction (Phase B). Constructing this performs no I/O.
export function firestoreReceivingStore(txn: Transaction, db: Firestore): ReceivingIdempotencyStore {
  const coll = db.collection(RECEIVING_ORDERS_COLLECTION);
  return {
    async read(docId) {
      const snap = await txn.get(coll.doc(docId));
      return snap.exists ? (snap.data() ?? {}) : null;
    },
    create(docId, data) {
      txn.create(coll.doc(docId), data);
    },
  };
}

export interface ReceivingStageDeps {
  readonly actor: ReceivingActor; // trusted-writer actor (server-derived; NOT from untrusted input)
  readonly now: Date; // server clock
}

// Stage exactly one Receiving Order into the injected store, idempotently. Validates first (throws
// InvalidReceivingError on a bad request or actor -> nothing staged). On an existing idempotency doc it
// FULLY validates the stored record (deserialize + docId-derivation + recomputed-fingerprint coherence):
// same fingerprint -> replayed (no duplicate); different -> IdempotencyConflictError; malformed ->
// MalformedStoredRecordError. It never independently commits (staging is via the injected store) and does
// not mutate its inputs.
export async function stageReceivingOrder(
  store: ReceivingIdempotencyStore,
  input: unknown,
  authority: unknown,
  deps: ReceivingStageDeps,
): Promise<ReceivingOutcome> {
  const validated = validateReceivingOrderInput(input, authority);
  if (!validated.valid) throw new InvalidReceivingError(validated.reason);
  if (!isActor(deps.actor) || !(deps.now instanceof Date) || Number.isNaN(deps.now.getTime())) {
    throw new InvalidReceivingError("stage_deps_invalid");
  }
  const value = validated.value;
  const docId = receivingOrderDocId(value.idempotencyKey);
  const fp = fingerprintReceivingOrder(value);

  const existing = await store.read(docId);
  if (existing !== null) {
    const stored = deserializeReceivingOrder(existing); // malformed -> MalformedStoredRecordError
    if (stored.receivingId !== docId) {
      throw new MalformedStoredRecordError("stored receivingId does not match its document id");
    }
    if (receivingOrderDocId(stored.value.idempotencyKey) !== docId) {
      throw new MalformedStoredRecordError("stored idempotencyKey does not derive its document id");
    }
    const storedRecomputed = fingerprintReceivingOrder(stored.value);
    if (storedRecomputed !== stored.fingerprint) {
      throw new MalformedStoredRecordError("stored fingerprint does not match stored value");
    }
    if (storedRecomputed !== fp) {
      throw new IdempotencyConflictError("idempotencyKey was already used for a different receiving order");
    }
    return { outcome: "replayed", receivingId: docId, fingerprint: fp };
  }
  store.create(docId, serializeReceivingOrder(value, deps.actor, deps.now, fp));
  return { outcome: "applied", receivingId: docId, fingerprint: fp };
}
