"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.MalformedStoredRecordError = exports.IdempotencyConflictError = exports.InvalidMovementError = exports.OperationalLedgerError = exports.OPERATIONAL_LEDGER_SCHEMA_VERSION = exports.PART_TRACKING_MODES = exports.INVENTORY_LOCATION_TYPES = exports.SYSTEM_ACTOR_IDS = exports.ACTOR_KINDS = exports.MOVEMENT_SOURCE_TYPE = exports.SOURCE_OBJECT_TYPES = exports.MOVEMENT_DIRECTION = exports.LEGACY_TRANSACTION_TYPES = exports.OPERATIONAL_MOVEMENT_TYPES = void 0;
exports.OPERATIONAL_MOVEMENT_TYPES = [
    "RECEIVED",
    "ADJUSTED",
    "TRANSFER_OUT",
    "TRANSFER_IN",
    "COUNTED",
    "RETURNED",
    "SCRAPPED",
];
// The legacy WO reservation/consumption ledger types (owned by inventoryService.ts). Deliberately
// DISJOINT from the operational set, so `type` alone distinguishes the two ledger families.
exports.LEGACY_TRANSACTION_TYPES = ["RESERVED", "RELEASED", "CONSUMED"];
exports.MOVEMENT_DIRECTION = {
    RECEIVED: "IN",
    RETURNED: "IN",
    TRANSFER_IN: "IN",
    TRANSFER_OUT: "OUT",
    SCRAPPED: "OUT",
    ADJUSTED: "SIGNED",
    COUNTED: "SNAPSHOT",
};
exports.SOURCE_OBJECT_TYPES = [
    "WORK_ORDER",
    "RECEIVING_ORDER",
    "TRANSFER_ORDER",
    "COUNT_SHEET",
    "ADJUSTMENT",
    "RMA",
    "SCRAP",
];
// Each operational movement type is produced by exactly one source-object type (WORK_ORDER is
// intentionally absent -- it belongs to the deferred reservation/consumption ledger).
exports.MOVEMENT_SOURCE_TYPE = {
    RECEIVED: "RECEIVING_ORDER",
    RETURNED: "RMA",
    TRANSFER_OUT: "TRANSFER_ORDER",
    TRANSFER_IN: "TRANSFER_ORDER",
    COUNTED: "COUNT_SHEET",
    ADJUSTED: "ADJUSTMENT",
    SCRAPPED: "SCRAP",
};
exports.ACTOR_KINDS = ["USER", "SYSTEM"];
// SYSTEM-actor allowlist (mirrors the pure contract): initially only the existing trusted
// Work-Order-transition actor. Adding one is an additive governance change, never an ad-hoc string.
exports.SYSTEM_ACTOR_IDS = ["WORK_ORDER_TRANSITION"];
// EI-P1a inventory location types (mirror of inventoryLocation.js; inlined -- no backend validator
// exists to reuse).
exports.INVENTORY_LOCATION_TYPES = ["WAREHOUSE", "BIN", "MOBILE", "VENDOR", "CUSTOMER", "VIRTUAL"];
// EI-P1a Part tracking modes (mirror of partTrackingMode.js).
exports.PART_TRACKING_MODES = ["NONE", "SERIAL", "LOT"];
// The storage-schema discriminator for NEW operational-movement records. Legacy WO entries carry NO
// schemaVersion; only records with this exact value are read as location-aware operational events.
exports.OPERATIONAL_LEDGER_SCHEMA_VERSION = 2;
class OperationalLedgerError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = new.target.name;
    }
}
exports.OperationalLedgerError = OperationalLedgerError;
class InvalidMovementError extends OperationalLedgerError {
    constructor(reason) {
        super("INVALID_MOVEMENT", reason);
    }
}
exports.InvalidMovementError = InvalidMovementError;
class IdempotencyConflictError extends OperationalLedgerError {
    constructor(message) {
        super("IDEMPOTENCY_CONFLICT", message);
    }
}
exports.IdempotencyConflictError = IdempotencyConflictError;
class MalformedStoredRecordError extends OperationalLedgerError {
    constructor(message) {
        super("MALFORMED_STORED_RECORD", message);
    }
}
exports.MalformedStoredRecordError = MalformedStoredRecordError;
//# sourceMappingURL=operationalMovementTypes.js.map