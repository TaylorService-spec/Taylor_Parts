// Enterprise Inventory -- EI-P1 INERT backend foundation: operational movement PERSISTENCE boundary
// for the SINGLE existing append-only ledger `inventory_transactions`. INERT: no callable, no client
// writer, not invoked by existing behavior. Provides serialize / fail-closed deserialize / legacy vs
// operational classification / deterministic idempotency, plus an injected idempotency-store seam so
// a future trusted writer can stage exactly one operational event INSIDE a larger transaction
// (workflow-object change + ledger append + projection update + Audit Event commit together or not at
// all). Authors NO on-hand/available/reserved/valuation math and never rewrites historical entries.

import { createHash } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { INVENTORY_TRANSACTIONS_COLLECTION } from "../constants/collections.js";
import {
  OPERATIONAL_MOVEMENT_TYPES,
  LEGACY_TRANSACTION_TYPES,
  MOVEMENT_DIRECTION,
  MOVEMENT_SOURCE_TYPE,
  OPERATIONAL_LEDGER_SCHEMA_VERSION,
  IdempotencyConflictError,
  InvalidMovementError,
  MalformedStoredRecordError,
  type OperationalMovementType,
  type OperationalMovementValue,
  type LocationRef,
  type MovementOutcome,
  type LedgerDocClassification,
  type DeserializedOperationalMovement,
} from "./operationalMovementTypes.js";
import {
  validateOperationalMovementEvent,
  validateLocationRef,
  validateSourceObjectReason,
  validateActorReason,
  validateQuantityReason,
  isEpochMillis,
  isNonEmptyString,
  isPlainObject,
  isTrackingMode,
} from "./operationalMovementValidation.js";

// Deterministic, canonical JSON (sorted keys) so a fingerprint is stable regardless of key order.
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

// 16-hex payload fingerprint (mirrors the truck-registry precedent): replay iff equal, conflict iff not.
export function fingerprintMovement(value: OperationalMovementValue): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex").slice(0, 16);
}

// Deterministic, PATH-SAFE storage identity derived from the caller idempotencyKey -- the raw caller
// string is NEVER used as a Firestore path. The deterministic doc IS the idempotency record.
export function operationalMovementDocId(idempotencyKey: string): string {
  return "imv_" + createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 40);
}

// Serialize a validated value into the stored operational record. recordedAt is SERVER-AUTHORED from
// the injected trusted-writer clock (never accepted from input); occurredAt stays a plain millis
// number (business time). Serial/lot/counterparty are included only for their governing mode/type.
export function serializeOperationalMovement(value: OperationalMovementValue, now: Date, fingerprint: string): Record<string, unknown> {
  const data: Record<string, unknown> = {
    schemaVersion: OPERATIONAL_LEDGER_SCHEMA_VERSION,
    type: value.type,
    direction: value.direction,
    partId: value.partId,
    trackingMode: value.trackingMode,
    location: { type: value.location.type, locationId: value.location.locationId },
    quantity: value.quantity,
    sourceObject: { type: value.sourceObject.type, id: value.sourceObject.id },
    idempotencyKey: value.idempotencyKey,
    actor: { kind: value.actor.kind, id: value.actor.id },
    occurredAt: value.occurredAt,
    recordedAt: Timestamp.fromDate(now),
    fingerprint,
  };
  if (value.serialNo !== undefined) data.serialNo = value.serialNo;
  if (value.lotId !== undefined) data.lotId = value.lotId;
  if (value.counterpartyLocation !== undefined) {
    data.counterpartyLocation = { type: value.counterpartyLocation.type, locationId: value.counterpartyLocation.locationId };
  }
  return data;
}

// Classify a stored ledger doc WITHOUT normalizing anything into validity. A legacy WO entry (no
// schemaVersion, legacy type) is never read as a location-aware operational event.
export function classifyLedgerDoc(data: unknown): LedgerDocClassification {
  if (!isPlainObject(data)) return "malformed";
  const type = data.type;
  if (data.schemaVersion === OPERATIONAL_LEDGER_SCHEMA_VERSION) {
    return typeof type === "string" && (OPERATIONAL_MOVEMENT_TYPES as readonly string[]).includes(type) ? "operational" : "malformed";
  }
  if (data.schemaVersion === undefined && typeof type === "string" && (LEGACY_TRANSACTION_TYPES as readonly string[]).includes(type)) {
    return "legacy";
  }
  return "malformed";
}

const STORED_BASE_KEYS = new Set([
  "schemaVersion", "type", "direction", "partId", "trackingMode", "location", "quantity",
  "sourceObject", "idempotencyKey", "actor", "occurredAt", "recordedAt", "fingerprint",
]);

// Fail-closed deserialize of a stored OPERATIONAL record. Validates self-consistency, converts the
// server Timestamp to millis (no Timestamp leaks into the value), and throws MalformedStoredRecordError
// on anything unexpected -- never normalizes malformed data into validity.
export function deserializeOperationalMovement(data: unknown): DeserializedOperationalMovement {
  if (classifyLedgerDoc(data) !== "operational") throw new MalformedStoredRecordError("stored record is not a well-formed operational movement");
  const d = data as Record<string, unknown>;
  const type = d.type as OperationalMovementType;
  const direction = MOVEMENT_DIRECTION[type];
  const isTransfer = type === "TRANSFER_OUT" || type === "TRANSFER_IN";

  const allowed = new Set(STORED_BASE_KEYS);
  if (!isTrackingMode(d.trackingMode)) throw new MalformedStoredRecordError("stored trackingMode invalid");
  const mode = d.trackingMode;
  if (mode === "SERIAL") allowed.add("serialNo");
  if (mode === "LOT") allowed.add("lotId");
  if (isTransfer) allowed.add("counterpartyLocation");
  if (Object.keys(d).some((k) => !allowed.has(k))) throw new MalformedStoredRecordError("stored record has unknown field");

  if (d.direction !== direction) throw new MalformedStoredRecordError("stored direction inconsistent with type");
  if (!isNonEmptyString(d.partId)) throw new MalformedStoredRecordError("stored partId invalid");
  const location = validateLocationRef(d.location);
  if (location === null) throw new MalformedStoredRecordError("stored location invalid");
  if (mode === "SERIAL" && !isNonEmptyString(d.serialNo)) throw new MalformedStoredRecordError("stored serialNo invalid");
  if (mode === "LOT" && !isNonEmptyString(d.lotId)) throw new MalformedStoredRecordError("stored lotId invalid");

  let counterparty: LocationRef | null = null;
  if (isTransfer) {
    counterparty = validateLocationRef(d.counterpartyLocation);
    if (counterparty === null) throw new MalformedStoredRecordError("stored counterparty invalid");
    if (counterparty.type === location.type && counterparty.locationId === location.locationId) {
      throw new MalformedStoredRecordError("stored transfer has same origin/destination");
    }
  }
  if (validateQuantityReason(mode, direction, d.quantity)) throw new MalformedStoredRecordError("stored quantity invalid");
  if (validateSourceObjectReason(d.sourceObject, MOVEMENT_SOURCE_TYPE[type])) throw new MalformedStoredRecordError("stored sourceObject invalid");
  if (!isNonEmptyString(d.idempotencyKey)) throw new MalformedStoredRecordError("stored idempotencyKey invalid");
  if (validateActorReason(d.actor)) throw new MalformedStoredRecordError("stored actor invalid");
  if (!isEpochMillis(d.occurredAt)) throw new MalformedStoredRecordError("stored occurredAt invalid");
  if (!(d.recordedAt instanceof Timestamp)) throw new MalformedStoredRecordError("stored recordedAt is not a server Timestamp");
  if (typeof d.fingerprint !== "string" || !/^[0-9a-f]{16}$/.test(d.fingerprint)) throw new MalformedStoredRecordError("stored fingerprint invalid");

  const source = d.sourceObject as Record<string, unknown>;
  const actor = d.actor as Record<string, unknown>;
  const value: OperationalMovementValue = {
    type,
    direction,
    partId: d.partId,
    trackingMode: mode,
    location,
    quantity: d.quantity as number,
    sourceObject: { type: source.type as never, id: source.id as string },
    idempotencyKey: d.idempotencyKey,
    actor: { kind: actor.kind as never, id: actor.id as string },
    occurredAt: d.occurredAt,
    ...(mode === "SERIAL" ? { serialNo: d.serialNo as string } : {}),
    ...(mode === "LOT" ? { lotId: d.lotId as string } : {}),
    ...(isTransfer && counterparty ? { counterpartyLocation: counterparty } : {}),
  };
  return { value, recordedAt: (d.recordedAt as Timestamp).toDate().getTime(), schemaVersion: OPERATIONAL_LEDGER_SCHEMA_VERSION, fingerprint: d.fingerprint };
}

// The injected idempotency-store seam. `read` returns the existing stored data for the deterministic
// doc id (within the caller's transaction) or null; `create` stages a create (which fails the whole
// transaction on commit if the doc already exists). Both are backed by the OUTER trusted transaction,
// so the ledger append commits atomically with everything else that transaction stages.
export interface LedgerIdempotencyStore {
  read(docId: string): Promise<Record<string, unknown> | null>;
  create(docId: string, data: Record<string, unknown>): void;
}

// Build a store from a live Firestore Transaction (so the append composes inside a larger trusted txn).
export function firestoreLedgerStore(txn: Transaction, db: Firestore): LedgerIdempotencyStore {
  const coll = db.collection(INVENTORY_TRANSACTIONS_COLLECTION);
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

export interface StageDeps {
  readonly now: Date; // server-authored recordedAt clock (trusted writer supplies this)
}

// Stage exactly one operational movement into the injected store, idempotently. Validates first
// (throws InvalidMovementError on a bad envelope -> nothing staged); on an existing idempotency doc,
// same fingerprint -> replayed (no duplicate), different fingerprint -> IdempotencyConflictError;
// otherwise stages the create -> applied. Deterministic and non-mutating (inputs untouched).
export async function stageOperationalMovement(
  store: LedgerIdempotencyStore,
  event: unknown,
  part: unknown,
  deps: StageDeps,
): Promise<MovementOutcome> {
  const validated = validateOperationalMovementEvent(event, part);
  if (!validated.valid) throw new InvalidMovementError(validated.reason);
  const value = validated.value;
  const docId = operationalMovementDocId(value.idempotencyKey);
  const fp = fingerprintMovement(value);

  const existing = await store.read(docId);
  if (existing !== null) {
    // Fully validate the stored record before trusting it -- never rely on its raw fingerprint field.
    // A malformed / partial / schema-mismatched record throws MalformedStoredRecordError.
    const stored = deserializeOperationalMovement(existing);
    // Internal coherence: its own idempotencyKey must derive THIS document id...
    if (operationalMovementDocId(stored.value.idempotencyKey) !== docId) {
      throw new MalformedStoredRecordError("stored idempotencyKey does not derive its document id");
    }
    // ...and its stored fingerprint must equal the fingerprint recomputed from its deserialized value.
    const storedRecomputed = fingerprintMovement(stored.value);
    if (storedRecomputed !== stored.fingerprint) {
      throw new MalformedStoredRecordError("stored fingerprint does not match stored value");
    }
    // Replay only when the (coherent) stored value fingerprint equals the incoming validated value's.
    if (storedRecomputed !== fp) {
      throw new IdempotencyConflictError("idempotencyKey was already used for a different movement");
    }
    return { outcome: "replayed", docId, fingerprint: fp };
  }
  store.create(docId, serializeOperationalMovement(value, deps.now, fp));
  return { outcome: "applied", docId, fingerprint: fp };
}
