// Enterprise Inventory Phase 4 -- Transfer operating authority: shared TYPES + failure taxonomy.
//
// CORRECTED PREMISE (do not re-litigate): the repository already has a `transfer_orders` READ model
// (field-ops-app-vite/src/domain/transferOrderView.js's `toTransferRef`, the Operations dashboard, the
// Inventory > Transfers workspace, useTransferOrders) and PURE contracts governing its lifecycle
// (inventoryTransferPairing.js's TRANSFER_ORDER_STATUSES + deriveSerialTransferState, transferLine.js's
// SERIAL membership rules). What was missing is the governed AUTHORITY that actually CREATES and MOVES
// a transfer order. This module is that authority's backend type mirror -- reusing the EXISTING
// TRANSFER_ORDER_STATUSES vocabulary and the EXISTING inventoryLedger TRANSFER_OUT/TRANSFER_IN contract,
// never inventing a parallel one.
//
// SCOPE FENCE (Phase 4): WAREHOUSE and MOBILE (truck) endpoints only. CUSTOMER delivery/custody policy
// is a closed boundary (Ventana/Taylor ownership unresolved) -- deliberately NOT modeled here.
//
// SCOPE DECISION (documented, not an oversight): the pure `transferLine.js` contract governs an
// INCREMENTAL pre-dispatch add/remove-serial-membership workflow. This Phase instead accepts the full
// serial set at CREATE time (the same shape Receiving already uses for a SERIAL line) rather than also
// building the incremental membership-mutation callables -- that stays a later, separately-scoped UI
// affordance. Every serial this command persists is a valid "add" per transferLine.js's own rules (a
// freshly REQUESTED order, no prior OUT event, no other active membership), just applied in one batch.

export const TRANSFER_ORDER_STATUSES = ["REQUESTED", "IN_TRANSIT", "COMPLETED", "CANCELLED"] as const;
export type TransferOrderStatus = (typeof TRANSFER_ORDER_STATUSES)[number];

export const TRANSFER_SCHEMA_VERSION = 1;
export const TRANSFER_INITIAL_VERSION = 1;

// Phase 4 endpoint fence: WAREHOUSE + MOBILE(truck) only. Not the full EI-P1a INVENTORY_LOCATION_TYPES
// set (BIN/VENDOR/CUSTOMER/VIRTUAL) -- those stay out of scope for this authority.
export const TRANSFER_ENDPOINT_TYPES = ["WAREHOUSE", "MOBILE"] as const;
export type TransferEndpointType = (typeof TRANSFER_ENDPOINT_TYPES)[number];

// NONE + SERIAL only (LOT deferred, same posture as Receiving's RECEIVING_SUPPORTED_TRACKING_MODES).
export const TRANSFER_SUPPORTED_TRACKING_MODES = ["NONE", "SERIAL"] as const;
export type TransferTrackingMode = (typeof TRANSFER_SUPPORTED_TRACKING_MODES)[number];

export interface TransferLocationRef {
  readonly type: TransferEndpointType;
  readonly locationId: string;
}
export interface TransferActor {
  readonly kind: "USER" | "SYSTEM";
  readonly id: string;
}

// The normalized, shape-validated CREATE value (the untrusted-input-derived part). Server-authored
// fields (status/version/actor/timestamps) are NOT part of this value.
export interface TransferOrderValue {
  readonly partId: string;
  readonly trackingMode: TransferTrackingMode;
  readonly quantity: number;
  readonly origin: TransferLocationRef;
  readonly destination: TransferLocationRef;
  readonly serialNumbers?: readonly string[]; // SERIAL only; quantity === serialNumbers.length
  readonly idempotencyKey: string;
}

export interface DeserializedTransferOrder {
  readonly transferOrderId: string;
  readonly value: TransferOrderValue;
  readonly status: TransferOrderStatus;
  readonly version: number;
  readonly actor: TransferActor;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly createdBy: string;
  readonly updatedBy: string;
  readonly schemaVersion: number;
  readonly fingerprint: string;
}

export type ValidationResult<T> =
  | { readonly valid: true; readonly value: T; readonly reason: null }
  | { readonly valid: false; readonly value: null; readonly reason: string };

export type TransferCreateOutcome = {
  readonly outcome: "applied" | "replayed";
  readonly transferOrderId: string;
  readonly fingerprint: string;
};

// -------- sanitized, class-per-reason failure taxonomy (mirrors the Receiving/Truck-Registry precedent) --
export type TransferCommandFailureCode =
  | "PERMISSION_DENIED"
  | "TRANSFER_NOT_FOUND"
  | "ORIGIN_INVALID"
  | "DESTINATION_INVALID"
  | "SAME_LOCATION"
  | "PART_INVALID"
  | "SERIAL_INVALID"
  | "INSUFFICIENT_STOCK"
  | "STATUS_INVALID"
  | "IDEMPOTENCY_CONFLICT"
  | "MALFORMED_STORED_RECORD"
  | "TRANSFER_INTEGRITY";

export class TransferCommandError extends Error {
  readonly code: TransferCommandFailureCode;
  constructor(code: TransferCommandFailureCode, message: string) {
    super(message);
    this.code = code;
    this.name = new.target.name;
  }
}
export class UnauthorizedTransferError extends TransferCommandError {
  constructor(m = "actor is not authorized to perform this transfer action") {
    super("PERMISSION_DENIED", m);
  }
}
export class TransferNotFoundError extends TransferCommandError {
  constructor(m = "transfer order not found") {
    super("TRANSFER_NOT_FOUND", m);
  }
}
export class OriginInvalidError extends TransferCommandError {
  constructor(m: string) {
    super("ORIGIN_INVALID", m);
  }
}
export class DestinationInvalidError extends TransferCommandError {
  constructor(m: string) {
    super("DESTINATION_INVALID", m);
  }
}
export class SameLocationError extends TransferCommandError {
  constructor(m = "origin and destination must be different locations") {
    super("SAME_LOCATION", m);
  }
}
export class TransferPartInvalidError extends TransferCommandError {
  constructor(m: string) {
    super("PART_INVALID", m);
  }
}
export class TransferSerialInvalidError extends TransferCommandError {
  constructor(m: string) {
    super("SERIAL_INVALID", m);
  }
}
export class InsufficientStockError extends TransferCommandError {
  constructor(m = "insufficient stock at origin for this transfer") {
    super("INSUFFICIENT_STOCK", m);
  }
}
export class TransferStatusInvalidError extends TransferCommandError {
  constructor(m: string) {
    super("STATUS_INVALID", m);
  }
}
export class TransferIdempotencyConflictError extends TransferCommandError {
  constructor(m = "idempotencyKey was already used for a different transfer order") {
    super("IDEMPOTENCY_CONFLICT", m);
  }
}
export class TransferMalformedStoredRecordError extends TransferCommandError {
  constructor(m: string) {
    super("MALFORMED_STORED_RECORD", m);
  }
}
export class TransferIntegrityError extends TransferCommandError {
  constructor(m = "the transfer could not be completed due to a transient integrity error") {
    super("TRANSFER_INTEGRITY", m);
  }
}
