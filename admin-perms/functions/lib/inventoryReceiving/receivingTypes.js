"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.MalformedStoredRecordError = exports.IdempotencyConflictError = exports.InvalidReceivingError = exports.ReceivingError = exports.RECEIVING_LINE_STATUS = exports.RECEIVING_SUPPORTED_TRACKING_MODES = exports.RECEIVING_LINE_TRACKING_MODE = exports.CANONICAL_SOURCE_TYPE = exports.LEGACY_SOURCE_TYPE = exports.RECEIVING_SOURCE_TYPES = exports.RECEIVING_ORDER_STATUSES = exports.RECEIVING_INITIAL_VERSION = exports.RECEIVING_SCHEMA_VERSION = exports.RECEIVING_ORDERS_COLLECTION = void 0;
// The receiving_orders collection name lives here (self-contained Phase-A surface; a later gate may
// promote it to functions/src/constants/collections.ts alongside the Rules gate, Phase D).
exports.RECEIVING_ORDERS_COLLECTION = "receiving_orders";
// Storage-schema discriminator for the dedicated receiving_orders collection (fail-closed on mismatch).
exports.RECEIVING_SCHEMA_VERSION = 1;
exports.RECEIVING_INITIAL_VERSION = 1;
// Full lifecycle (spec §3). The FIRST slice creates directly at PUTAWAY_COMPLETE (one governed
// transition, final version 1); EXPECTED/CHECKED_IN/CANCELLED are specified for later multi-step gates.
exports.RECEIVING_ORDER_STATUSES = ["EXPECTED", "CHECKED_IN", "PUTAWAY_COMPLETE", "CANCELLED"];
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
exports.RECEIVING_SOURCE_TYPES = ["REORDER_PURCHASE_ORDER", "PURCHASE_ORDER"];
exports.LEGACY_SOURCE_TYPE = "REORDER_PURCHASE_ORDER";
exports.CANONICAL_SOURCE_TYPE = "PURCHASE_ORDER";
// NONE remains the default/first-slice mode. Kept as its own constant because a great deal of existing
// code and test data refers to "the NONE line".
exports.RECEIVING_LINE_TRACKING_MODE = "NONE";
// Wave 7 (Owner decision, docs/releases/serialized-asset-registry-slice-b-boundary.md): Receiving is
// authorized to accept SERIAL in ADDITION to NONE, so that receipt creates/activates the authoritative
// Serialized Asset per the serialized-asset Specification §F. LOT stays deferred and fails closed --
// it is deliberately absent from this list, so it still resolves to "tracking_mode_unsupported".
exports.RECEIVING_SUPPORTED_TRACKING_MODES = ["NONE", "SERIAL"];
exports.RECEIVING_LINE_STATUS = "RECEIVED";
class ReceivingError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = new.target.name;
    }
}
exports.ReceivingError = ReceivingError;
class InvalidReceivingError extends ReceivingError {
    constructor(reason) {
        super("INVALID_RECEIVING", reason);
    }
}
exports.InvalidReceivingError = InvalidReceivingError;
class IdempotencyConflictError extends ReceivingError {
    constructor(message) {
        super("IDEMPOTENCY_CONFLICT", message);
    }
}
exports.IdempotencyConflictError = IdempotencyConflictError;
class MalformedStoredRecordError extends ReceivingError {
    constructor(message) {
        super("MALFORMED_STORED_RECORD", message);
    }
}
exports.MalformedStoredRecordError = MalformedStoredRecordError;
//# sourceMappingURL=receivingTypes.js.map