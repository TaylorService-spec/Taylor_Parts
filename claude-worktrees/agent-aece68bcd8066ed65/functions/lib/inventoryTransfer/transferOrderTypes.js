"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransferIntegrityError = exports.TransferMalformedStoredRecordError = exports.TransferIdempotencyConflictError = exports.TransferStatusInvalidError = exports.InsufficientStockError = exports.TransferSerialInvalidError = exports.TransferPartInvalidError = exports.SameLocationError = exports.DestinationInvalidError = exports.OriginInvalidError = exports.TransferNotFoundError = exports.UnauthorizedTransferError = exports.TransferCommandError = exports.TRANSFER_SUPPORTED_TRACKING_MODES = exports.TRANSFER_ENDPOINT_TYPES = exports.TRANSFER_INITIAL_VERSION = exports.TRANSFER_SCHEMA_VERSION = exports.TRANSFER_ORDER_STATUSES = void 0;
exports.TRANSFER_ORDER_STATUSES = ["REQUESTED", "IN_TRANSIT", "COMPLETED", "CANCELLED"];
exports.TRANSFER_SCHEMA_VERSION = 1;
exports.TRANSFER_INITIAL_VERSION = 1;
// Phase 4 endpoint fence: WAREHOUSE + MOBILE(truck) only. Not the full EI-P1a INVENTORY_LOCATION_TYPES
// set (BIN/VENDOR/CUSTOMER/VIRTUAL) -- those stay out of scope for this authority.
exports.TRANSFER_ENDPOINT_TYPES = ["WAREHOUSE", "MOBILE"];
// NONE + SERIAL only (LOT deferred, same posture as Receiving's RECEIVING_SUPPORTED_TRACKING_MODES).
exports.TRANSFER_SUPPORTED_TRACKING_MODES = ["NONE", "SERIAL"];
class TransferCommandError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = new.target.name;
    }
}
exports.TransferCommandError = TransferCommandError;
class UnauthorizedTransferError extends TransferCommandError {
    constructor(m = "actor is not authorized to perform this transfer action") {
        super("PERMISSION_DENIED", m);
    }
}
exports.UnauthorizedTransferError = UnauthorizedTransferError;
class TransferNotFoundError extends TransferCommandError {
    constructor(m = "transfer order not found") {
        super("TRANSFER_NOT_FOUND", m);
    }
}
exports.TransferNotFoundError = TransferNotFoundError;
class OriginInvalidError extends TransferCommandError {
    constructor(m) {
        super("ORIGIN_INVALID", m);
    }
}
exports.OriginInvalidError = OriginInvalidError;
class DestinationInvalidError extends TransferCommandError {
    constructor(m) {
        super("DESTINATION_INVALID", m);
    }
}
exports.DestinationInvalidError = DestinationInvalidError;
class SameLocationError extends TransferCommandError {
    constructor(m = "origin and destination must be different locations") {
        super("SAME_LOCATION", m);
    }
}
exports.SameLocationError = SameLocationError;
class TransferPartInvalidError extends TransferCommandError {
    constructor(m) {
        super("PART_INVALID", m);
    }
}
exports.TransferPartInvalidError = TransferPartInvalidError;
class TransferSerialInvalidError extends TransferCommandError {
    constructor(m) {
        super("SERIAL_INVALID", m);
    }
}
exports.TransferSerialInvalidError = TransferSerialInvalidError;
class InsufficientStockError extends TransferCommandError {
    constructor(m = "insufficient stock at origin for this transfer") {
        super("INSUFFICIENT_STOCK", m);
    }
}
exports.InsufficientStockError = InsufficientStockError;
class TransferStatusInvalidError extends TransferCommandError {
    constructor(m) {
        super("STATUS_INVALID", m);
    }
}
exports.TransferStatusInvalidError = TransferStatusInvalidError;
class TransferIdempotencyConflictError extends TransferCommandError {
    constructor(m = "idempotencyKey was already used for a different transfer order") {
        super("IDEMPOTENCY_CONFLICT", m);
    }
}
exports.TransferIdempotencyConflictError = TransferIdempotencyConflictError;
class TransferMalformedStoredRecordError extends TransferCommandError {
    constructor(m) {
        super("MALFORMED_STORED_RECORD", m);
    }
}
exports.TransferMalformedStoredRecordError = TransferMalformedStoredRecordError;
class TransferIntegrityError extends TransferCommandError {
    constructor(m = "the transfer could not be completed due to a transient integrity error") {
        super("TRANSFER_INTEGRITY", m);
    }
}
exports.TransferIntegrityError = TransferIntegrityError;
//# sourceMappingURL=transferOrderTypes.js.map