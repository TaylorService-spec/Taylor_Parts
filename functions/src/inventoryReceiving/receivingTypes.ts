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

// The receiving SOURCE AUTHORITIES, as a closed set.
//
// REORDER_PURCHASE_ORDER -- the immutable legacy single-part reorder chain. Full-quantity receipt
//   only, and the PO document is never written (firestore.rules:1092 makes it immutable, and that
//   contract is preserved exactly).
// PURCHASE_ORDER         -- the canonical multi-line supplier PO (purchase_orders). Partial and
//   multi-line receipts, and the PO document IS written on every receipt (its version), which is
//   what serializes concurrent receipts. See
//   docs/specifications/multi-line-receiving-transaction-order.md §1 for the proof.
//
// This discriminator is why there is NO ambiguous collection lookup: the request STATES which
// authority it addresses, it is checked against this closed set, and anything else fails closed.
// Nothing sniffs a document to work out which collection it came from.
export const RECEIVING_SOURCE_TYPES = ["REORDER_PURCHASE_ORDER", "PURCHASE_ORDER"] as const;
export type ReceivingSourceType = (typeof RECEIVING_SOURCE_TYPES)[number];

export const LEGACY_SOURCE_TYPE = "REORDER_PURCHASE_ORDER";
export const CANONICAL_SOURCE_TYPE = "PURCHASE_ORDER";

// NONE remains the default/first-slice mode. Kept as its own constant because a great deal of existing
// code and test data refers to "the NONE line".
export const RECEIVING_LINE_TRACKING_MODE = "NONE" as const;

// Wave 7 (Owner decision, docs/releases/serialized-asset-registry-slice-b-boundary.md): Receiving is
// authorized to accept SERIAL in ADDITION to NONE, so that receipt creates/activates the authoritative
// Serialized Asset per the serialized-asset Specification §F. LOT stays deferred and fails closed --
// it is deliberately absent from this list, so it still resolves to "tracking_mode_unsupported".
export const RECEIVING_SUPPORTED_TRACKING_MODES = ["NONE", "SERIAL"] as const;
export type ReceivingLineTrackingMode = (typeof RECEIVING_SUPPORTED_TRACKING_MODES)[number];

export const RECEIVING_LINE_STATUS = "RECEIVED" as const;

export interface ReceivingSourceRef {
  readonly type: ReceivingSourceType;
  // LEGACY ONLY, and ABSENT for a canonical PO rather than blank-filled. A canonical purchase order
  // has no reorder request; writing an empty string would assert it has one whose id we do not know.
  // Absence is the true statement, and the deserializer enforces the pairing in both directions.
  readonly reorderRequestId?: string;
  readonly purchaseOrderId: string; // legacy: == reorderRequestId (spec §2)
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
  readonly trackingMode: ReceivingLineTrackingMode;
  // EXPECTED is what REMAINED on this PO line when the receipt was taken; RECEIVED is what was
  // actually observed now. The first slice required them EQUAL. From Phase C they may differ, and
  // that is the whole point: received < expected IS a partial receipt. received > expected is still
  // rejected -- by the batch validator, before any write, measured against REMAINING not ordered.
  readonly expectedQuantity: number;
  readonly receivedQuantity: number;
  readonly status: typeof RECEIVING_LINE_STATUS;
  // SERIAL ONLY. Present iff trackingMode === "SERIAL", and then exactly `receivedQuantity` distinct
  // serial numbers -- one physical unit, one serial, one Serialized Asset, one ledger effect. Absent
  // for NONE (its presence there fails closed): a NONE line has no serial identity to record, and
  // accepting one would create a second, unauthoritative place serial identity could live.
  readonly serialNumbers?: readonly string[];
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
  // RO-YYYY-###### — allocated server-side at create (receivingOrderNumbering.ts). Absent (undefined)
  // on legacy records created before this field existed; never backfilled by this deserializer.
  readonly receivingOrderNumber?: string;
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
