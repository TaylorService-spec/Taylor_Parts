// Enterprise Inventory -- EI Phase-2 Receiving, Phase A: INERT Receiving Order types + failure taxonomy.
// Repository-only foundation for the ratified spec
// (docs/specifications/enterprise-inventory-receiving-phase2.md). INERT: nothing here is exported from
// functions/src/index.ts, there is NO callable/command/ledger-append orchestration/reorder-closeout/PO
// mutation, and it is not invoked by any behavior. Phase A defines the pure receiving_orders workflow
// object + its first-slice validation + a deterministic, idempotent, injected repository seam ONLY.
//
// First slice (this Phase): create exactly ONE receiving_orders order directly at PUTAWAY_COMPLETE with
// version 1, holding exactly ONE NONE-tracked line whose expectedQuantity == receivedQuantity ==
// PO.orderedQuantity. SERIAL/LOT fail closed. No aggregates, no stock, no ledger append (Phase B+).

// The receiving_orders collection name lives here (self-contained Phase-A surface; a later gate may
// promote it to functions/src/constants/collections.ts alongside the Rules gate, Phase D).
export const RECEIVING_ORDERS_COLLECTION = "receiving_orders";

// Storage-schema discriminator for the dedicated receiving_orders collection (fail-closed on mismatch).
export const RECEIVING_SCHEMA_VERSION = 1;
export const RECEIVING_INITIAL_VERSION = 1;

// Full lifecycle (spec §3). The FIRST slice creates directly at PUTAWAY_COMPLETE (one governed
// transition, final version 1); EXPECTED/CHECKED_IN/CANCELLED are specified for later multi-step gates.
export const RECEIVING_ORDER_STATUSES = ["EXPECTED", "CHECKED_IN", "PUTAWAY_COMPLETE", "CANCELLED"] as const;
export type ReceivingOrderStatus = (typeof RECEIVING_ORDER_STATUSES)[number];

// First supported source only (spec §2): the live reorder purchasing chain.
export const RECEIVING_SOURCE_TYPES = ["REORDER_PURCHASE_ORDER"] as const;
export type ReceivingSourceType = (typeof RECEIVING_SOURCE_TYPES)[number];

// First slice: NONE tracking only; SERIAL/LOT fail closed (deferred).
export const RECEIVING_LINE_TRACKING_MODE = "NONE" as const;
export const RECEIVING_LINE_STATUS = "RECEIVED" as const;

export interface ReceivingSourceRef {
  readonly type: ReceivingSourceType;
  readonly reorderRequestId: string;
  readonly purchaseOrderId: string; // == reorderRequestId (spec §2)
}
export interface LocationRef {
  readonly type: string;
  readonly locationId: string;
}
export interface ReceivingActor {
  readonly kind: "USER" | "SYSTEM";
  readonly id: string;
}
export interface ReceivingLineValue {
  readonly lineId: string;
  readonly partId: string;
  readonly trackingMode: typeof RECEIVING_LINE_TRACKING_MODE;
  readonly expectedQuantity: number;
  readonly receivedQuantity: number;
  readonly status: typeof RECEIVING_LINE_STATUS;
}

// The normalized, shape-validated Receiving Order value (the untrusted-input-derived part). Server-
// authored fields (createdAt/updatedAt/createdBy/updatedBy) and the actor are NOT part of this value --
// they are authored by the repository at stage time from the trusted caller's actor + server clock.
export interface ReceivingOrderValue {
  readonly source: ReceivingSourceRef;
  readonly receivingLocation: LocationRef;
  readonly status: "PUTAWAY_COMPLETE";
  readonly version: number; // RECEIVING_INITIAL_VERSION
  readonly lines: readonly ReceivingLineValue[];
  readonly idempotencyKey: string;
}

// The injected authoritative context the validator binds against (supplied by the Phase-B command from
// the read-only source PO + Part authority; NOT read here).
export interface ReceivingAuthority {
  readonly part: { readonly partId: string; readonly trackingMode: string };
  readonly orderedQuantity: number; // reorder_purchase_orders.orderedQuantity (authoritative)
}

export type ValidationResult<T> =
  | { readonly valid: true; readonly value: T; readonly reason: null }
  | { readonly valid: false; readonly value: null; readonly reason: string };

export type ReceivingOutcome = {
  readonly outcome: "applied" | "replayed";
  readonly receivingId: string;
  readonly fingerprint: string;
};

// A deserialized stored order. Server timestamps are exposed as epoch millis (no Timestamp leak).
export interface DeserializedReceivingOrder {
  readonly receivingId: string; // stored doc identity (== receivingOrderDocId(idempotencyKey))
  readonly value: ReceivingOrderValue;
  readonly actor: ReceivingActor;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly createdBy: string;
  readonly updatedBy: string;
  readonly schemaVersion: number;
  readonly fingerprint: string;
}

// -------- sanitized, class-per-reason failure taxonomy (mirrors the truck-registry / ledger precedent) --
export type ReceivingFailureCode =
  | "INVALID_RECEIVING"
  | "IDEMPOTENCY_CONFLICT"
  | "MALFORMED_STORED_RECORD";

export class ReceivingError extends Error {
  readonly code: ReceivingFailureCode;
  constructor(code: ReceivingFailureCode, message: string) {
    super(message);
    this.code = code;
    this.name = new.target.name;
  }
}
export class InvalidReceivingError extends ReceivingError {
  constructor(reason: string) {
    super("INVALID_RECEIVING", reason);
  }
}
export class IdempotencyConflictError extends ReceivingError {
  constructor(message: string) {
    super("IDEMPOTENCY_CONFLICT", message);
  }
}
export class MalformedStoredRecordError extends ReceivingError {
  constructor(message: string) {
    super("MALFORMED_STORED_RECORD", message);
  }
}
