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

// COUNTED WAS REMOVED (CERT-LEDGER-COUNTED-08). It was declared here and never written once: a
// cycle count records its counted quantity on the count record, and the reconciliation writes the
// real stock correction as ADJUSTED (cycleCountCommand.ts). Its SNAPSHOT direction and COUNT_SHEET
// source type went with it, because they existed only to serve it. Do not re-add any of the three
// to make a future count "look complete" -- a count that moves no stock must not author a movement.
// The Cycle Count workflow STATUS "COUNTED" (cycleCountTypes.ts) is a different thing and is live.
export const OPERATIONAL_MOVEMENT_TYPES = [
  "RECEIVED",
  "ADJUSTED",
  "TRANSFER_OUT",
  "TRANSFER_IN",
  "RETURNED",
  "SCRAPPED",
  // Decision (Customer 1 physical consumption): inventory permanently leaves physical custody
  // because a Work Order used it. SIGNED, and deliberately so -- a correction to recorded usage is
  // the SAME fact with the opposite sign, restoring the quantity to the location it left. That
  // follows ADJUSTED's existing signed precedent rather than inventing a second reversal type, and
  // it means the on-hand derivation needs one rule, not two.
  //
  // NOT named CONSUMED. The location-less CONSUMED in LEGACY_TRANSACTION_TYPES below is a
  // commitment/reservation event and stays exactly what it is; naming this the same thing would
  // collapse two facts that must remain separable -- one reconciles a promise, this one moves stock.
  "WORK_ORDER_CONSUMPTION",
] as const;
export type OperationalMovementType = (typeof OPERATIONAL_MOVEMENT_TYPES)[number];

// The legacy WO reservation/consumption ledger types (owned by inventoryService.ts). Deliberately
// DISJOINT from the operational set, so `type` alone distinguishes the two ledger families.
export const LEGACY_TRANSACTION_TYPES = ["RESERVED", "RELEASED", "CONSUMED"] as const;
export type LegacyTransactionType = (typeof LEGACY_TRANSACTION_TYPES)[number];

export type MovementDirection = "IN" | "OUT" | "SIGNED";
export const MOVEMENT_DIRECTION: Readonly<Record<OperationalMovementType, MovementDirection>> = {
  RECEIVED: "IN",
  RETURNED: "IN",
  TRANSFER_IN: "IN",
  TRANSFER_OUT: "OUT",
  SCRAPPED: "OUT",
  ADJUSTED: "SIGNED",
  WORK_ORDER_CONSUMPTION: "SIGNED",
};

export const SOURCE_OBJECT_TYPES = [
  "WORK_ORDER",
  "RECEIVING_ORDER",
  "TRANSFER_ORDER",
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
  ADJUSTED: "ADJUSTMENT",
  SCRAPPED: "SCRAP",
  // THE BOUNDARY THIS RULING MOVED. WORK_ORDER was a declared source-object type that deliberately
  // produced no physical movement -- "it belongs to the deferred reservation/consumption ledger".
  // The Owner ruling makes physical consumption a governed movement, so the mapping is added on
  // purpose. Nothing else about the reservation ledger changed.
  WORK_ORDER_CONSUMPTION: "WORK_ORDER",
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
