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
exports.MalformedStoredRecordError = exports.IdempotencyConflictError = exports.InvalidMovementError = exports.OperationalLedgerError = exports.OPERATIONAL_LEDGER_SCHEMA_VERSION = exports.PART_TRACKING_MODES = exports.INVENTORY_LOCATION_TYPES = exports.SYSTEM_ACTOR_IDS = exports.ACTOR_KINDS = exports.COUNTERPARTY_MOVEMENT_TYPES = exports.MOVEMENT_SOURCE_TYPE = exports.SOURCE_OBJECT_TYPES = exports.MOVEMENT_DIRECTION = exports.LEGACY_TRANSACTION_TYPES = exports.OPERATIONAL_MOVEMENT_TYPES = void 0;
// COUNTED WAS REMOVED (CERT-LEDGER-COUNTED-08). It was declared here and never written once: a
// cycle count records its counted quantity on the count record, and the reconciliation writes the
// real stock correction as ADJUSTED (cycleCountCommand.ts). Its SNAPSHOT direction and COUNT_SHEET
// source type went with it, because they existed only to serve it. Do not re-add any of the three
// to make a future count "look complete" -- a count that moves no stock must not author a movement.
// The Cycle Count workflow STATUS "COUNTED" (cycleCountTypes.ts) is a different thing and is live.
exports.OPERATIONAL_MOVEMENT_TYPES = [
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
    // BIN-P6 / Decision #170 -- INTERNAL RELOCATION inside one Warehouse custody parent. A PAIR, not
    // one signed row: a relocation genuinely has two endpoints, it leaves one exact location and
    // arrives at another, and a single row cannot say both. Deliberately NOT TRANSFER_OUT/IN, which
    // stay owned by TRANSFER_ORDER: reusing them would make every shelf-to-shelf move read as stock
    // leaving the building.
    "RELOCATION_OUT",
    "RELOCATION_IN",
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
    WORK_ORDER_CONSUMPTION: "SIGNED",
    RELOCATION_OUT: "OUT",
    RELOCATION_IN: "IN",
};
exports.SOURCE_OBJECT_TYPES = [
    "WORK_ORDER",
    "RECEIVING_ORDER",
    "TRANSFER_ORDER",
    "ADJUSTMENT",
    "RMA",
    "SCRAP",
    // BIN-P6 / Decision #170: the relocation command is the only producer of the relocation pair.
    "STOCK_RELOCATION",
];
// Each operational movement type is produced by exactly one source-object type (WORK_ORDER is
// intentionally absent -- it belongs to the deferred reservation/consumption ledger).
exports.MOVEMENT_SOURCE_TYPE = {
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
    RELOCATION_OUT: "STOCK_RELOCATION",
    RELOCATION_IN: "STOCK_RELOCATION",
};
// Movement types that name the OTHER end of a two-endpoint movement. Required on these, forbidden on
// every other type. One list, read by the validator and the stored-record deserializer alike, so the
// two can never disagree about which movements carry a counterparty.
exports.COUNTERPARTY_MOVEMENT_TYPES = new Set([
    "TRANSFER_OUT",
    "TRANSFER_IN",
    "RELOCATION_OUT",
    "RELOCATION_IN",
]);
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