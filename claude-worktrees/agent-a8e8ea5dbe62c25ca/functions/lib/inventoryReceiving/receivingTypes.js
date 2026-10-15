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
exports.MalformedStoredRecordError = exports.IdempotencyConflictError = exports.InvalidReceivingError = exports.ReceivingError = exports.RECEIVING_LINE_STATUS = exports.RECEIVING_LINE_TRACKING_MODE = exports.RECEIVING_SOURCE_TYPES = exports.RECEIVING_ORDER_STATUSES = exports.RECEIVING_INITIAL_VERSION = exports.RECEIVING_SCHEMA_VERSION = exports.RECEIVING_ORDERS_COLLECTION = void 0;
// The receiving_orders collection name lives here (self-contained Phase-A surface; a later gate may
// promote it to functions/src/constants/collections.ts alongside the Rules gate, Phase D).
exports.RECEIVING_ORDERS_COLLECTION = "receiving_orders";
// Storage-schema discriminator for the dedicated receiving_orders collection (fail-closed on mismatch).
exports.RECEIVING_SCHEMA_VERSION = 1;
exports.RECEIVING_INITIAL_VERSION = 1;
// Full lifecycle (spec §3). The FIRST slice creates directly at PUTAWAY_COMPLETE (one governed
// transition, final version 1); EXPECTED/CHECKED_IN/CANCELLED are specified for later multi-step gates.
exports.RECEIVING_ORDER_STATUSES = ["EXPECTED", "CHECKED_IN", "PUTAWAY_COMPLETE", "CANCELLED"];
// First supported source only (spec §2): the live reorder purchasing chain.
exports.RECEIVING_SOURCE_TYPES = ["REORDER_PURCHASE_ORDER"];
// First slice: NONE tracking only; SERIAL/LOT fail closed (deferred).
exports.RECEIVING_LINE_TRACKING_MODE = "NONE";
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