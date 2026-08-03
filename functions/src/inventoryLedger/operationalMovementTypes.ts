// Enterprise Inventory -- EI-P1 INERT backend foundation: location-aware operational Inventory
// Ledger event TYPES + failure taxonomy. This is a TypeScript MIRROR of the merged frontend pure
// contract field-ops-app-vite/src/domain/inventoryLedgerEvent.js (validated for parity in the tests).
// It is INERT: nothing here is exported from functions/src/index.ts, there is NO callable/HTTP
// surface, no client writer, and it is NOT invoked by existing Work-Order behavior. It writes to the
// SINGLE existing append-only ledger `inventory_transactions` (never a second ledger), additively.
//
// Legacy Work-Order entries (RESERVED / RELEASED / CONSUMED, owned by inventoryService.ts) remain
// valid, readable, and untouched; new operational-movement records carry a schema discriminator so
// the two are never conflated. This module authors NO on-hand/available/reserved/valuation math.

export const OPERATIONAL_MOVEMENT_TYPES = [
  "RECEIVED",
  "ADJUSTED",
  "TRANSFER_OUT",
  "TRANSFER_IN",
  "COUNTED",
  "RETURNED",
  "SCRAPPED",
] as const;
export type OperationalMovementType = (typeof OPERATIONAL_MOVEMENT_TYPES)[number];

// The legacy WO reservation/consumption ledger types (owned by inventoryService.ts). Deliberately
// DISJOINT from the operational set, so `type` alone distinguishes the two ledger families.
export const LEGACY_TRANSACTION_TYPES = ["RESERVED", "RELEASED", "CONSUMED"] as const;
export type LegacyTransactionType = (typeof LEGACY_TRANSACTION_TYPES)[number];

export type MovementDirection = "IN" | "OUT" | "SIGNED" | "SNAPSHOT";
export const MOVEMENT_DIRECTION: Readonly<Record<OperationalMovementType, MovementDirection>> = {
  RECEIVED: "IN",
  RETURNED: "IN",
  TRANSFER_IN: "IN",
  TRANSFER_OUT: "OUT",
  SCRAPPED: "OUT",
  ADJUSTED: "SIGNED",
  COUNTED: "SNAPSHOT",
};

export const SOURCE_OBJECT_TYPES = [
  "WORK_ORDER",
  "RECEIVING_ORDER",
  "TRANSFER_ORDER",
  "COUNT_SHEET",
  "ADJUSTMENT",
  "RMA",
  "SCRAP",
] as const;
export type SourceObjectType = (typeof SOURCE_OBJECT_TYPES)[number];

// Each operational movement type is produced by exactly one source-object type (WORK_ORDER is
// intentionally absent -- it belongs to the deferred reservation/consumption ledger).
export const MOVEMENT_SOURCE_TYPE: Readonly<Record<OperationalMovementType, SourceObjectType>> = {
  RECEIVED: "RECEIVING_ORDER",
  RETURNED: "RMA",
  TRANSFER_OUT: "TRANSFER_ORDER",
  TRANSFER_IN: "TRANSFER_ORDER",
  COUNTED: "COUNT_SHEET",
  ADJUSTED: "ADJUSTMENT",
  SCRAPPED: "SCRAP",
};

export const ACTOR_KINDS = ["USER", "SYSTEM"] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

// SYSTEM-actor allowlist (mirrors the pure contract): initially only the existing trusted
// Work-Order-transition actor. Adding one is an additive governance change, never an ad-hoc string.
export const SYSTEM_ACTOR_IDS = ["WORK_ORDER_TRANSITION"] as const;

// EI-P1a inventory location types (mirror of inventoryLocation.js; inlined -- no backend validator
// exists to reuse).
export const INVENTORY_LOCATION_TYPES = ["WAREHOUSE", "BIN", "MOBILE", "VENDOR", "CUSTOMER", "VIRTUAL"] as const;
export type InventoryLocationType = (typeof INVENTORY_LOCATION_TYPES)[number];

// EI-P1a Part tracking modes (mirror of partTrackingMode.js).
export const PART_TRACKING_MODES = ["NONE", "SERIAL", "LOT"] as const;
export type PartTrackingMode = (typeof PART_TRACKING_MODES)[number];

// The storage-schema discriminator for NEW operational-movement records. Legacy WO entries carry NO
// schemaVersion; only records with this exact value are read as location-aware operational events.
export const OPERATIONAL_LEDGER_SCHEMA_VERSION = 2;

export interface LocationRef {
  readonly type: InventoryLocationType;
  readonly locationId: string;
}
export interface SourceObjectRef {
  readonly type: SourceObjectType;
  readonly id: string;
}
export interface ActorRef {
  readonly kind: ActorKind;
  readonly id: string;
}

// The normalized, shape-validated operational movement value (mirrors the pure contract's `value`).
// occurredAt is caller-supplied business time in epoch millis; recordedAt is NOT part of this value
// (it is a server-authored field on the stored record, exposed separately on deserialize).
export interface OperationalMovementValue {
  readonly type: OperationalMovementType;
  readonly direction: MovementDirection;
  readonly partId: string;
  readonly trackingMode: PartTrackingMode;
  readonly location: LocationRef;
  readonly quantity: number;
  readonly sourceObject: SourceObjectRef;
  readonly idempotencyKey: string;
  readonly actor: ActorRef;
  readonly occurredAt: number;
  readonly serialNo?: string;
  readonly lotId?: string;
  readonly counterpartyLocation?: LocationRef;
}

export type ValidationResult<T> =
  | { readonly valid: true; readonly value: T; readonly reason: null }
  | { readonly valid: false; readonly value: null; readonly reason: string };

export type MovementOutcome = {
  readonly outcome: "applied" | "replayed";
  readonly docId: string;
  readonly fingerprint: string;
};

export type LedgerDocClassification = "operational" | "legacy" | "malformed";

// A deserialized operational record. recordedAt is server-authored, exposed as epoch millis -- NO raw
// Firestore Timestamp leaks into the pure value.
export interface DeserializedOperationalMovement {
  readonly value: OperationalMovementValue;
  readonly recordedAt: number;
  readonly schemaVersion: number;
  readonly fingerprint: string;
}

// -------- sanitized, class-per-reason failure taxonomy (mirrors the truck-registry precedent) ------
export type OperationalLedgerFailureCode =
  | "INVALID_MOVEMENT"
  | "IDEMPOTENCY_CONFLICT"
  | "MALFORMED_STORED_RECORD";

export class OperationalLedgerError extends Error {
  readonly code: OperationalLedgerFailureCode;
  constructor(code: OperationalLedgerFailureCode, message: string) {
    super(message);
    this.code = code;
    this.name = new.target.name;
  }
}
export class InvalidMovementError extends OperationalLedgerError {
  constructor(reason: string) {
    super("INVALID_MOVEMENT", reason);
  }
}
export class IdempotencyConflictError extends OperationalLedgerError {
  constructor(message: string) {
    super("IDEMPOTENCY_CONFLICT", message);
  }
}
export class MalformedStoredRecordError extends OperationalLedgerError {
  constructor(message: string) {
    super("MALFORMED_STORED_RECORD", message);
  }
}
