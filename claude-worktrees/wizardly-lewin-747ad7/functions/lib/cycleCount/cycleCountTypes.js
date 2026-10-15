"use strict";
// Enterprise Inventory -- Cycle Count operating authority: shared TYPES + failure taxonomy.
//
// AUDIT PREMISE (re-established, not assumed): PR #1032 (Transfer operating authority) made the
// location-aware operational ledger (functions/src/inventoryLedger/operationalMovement*) a LIVE
// expected-quantity authority for NONE-mode Parts -- transferOrderCommand.ts's
// computeNoneOnHandThroughTxn sums RECEIVED/RETURNED/TRANSFER_IN (+), TRANSFER_OUT/SCRAPPED (-), and
// ADJUSTED (signed) at a (partId, location) pair, and that sum is what gates whether a Transfer may be
// created. This module reuses the SAME sourcing discipline for Cycle Count's "expected quantity" -- it
// is never a second manually maintained on-hand number (data/partsCatalog.ts's warehouseQty baseline and
// the legacy RESERVED/RELEASED/CONSUMED WO ledger are a DIFFERENT, disjoint, non-location-aware system
// this module never reads). For SERIAL-tracked Parts, the authority is the serialized_assets registry's
// AVAILABLE units at a location (the same rule transferOrderCommand.ts's SERIAL sufficiency check uses),
// not a ledger sum.
//
// LIFECYCLE (new vocabulary -- COUNTED/ADJUSTED already existed as INERT OPERATIONAL_MOVEMENT_TYPES
// members with zero writers before this module; this is their first live producer for COUNTED semantics
// on the count-sheet side, and ADJUSTED's first live producer for count-driven reconciliation):
//   createCycleCount    : (none) -> OPEN        (snapshots expected quantity/serials at creation time)
//   submitCycleCount    : OPEN -> COUNTED        (records counted quantity/serials, computes variance)
//   reconcileCycleCount : COUNTED -> RECONCILED  (manager APPROVES; stages ADJUSTED ledger evidence;
//                                                  reason required on non-zero variance; never
//                                                  overwrites stock truth)
//   reconcileCycleCount : COUNTED -> REJECTED    (manager REJECTS the same submitted count via the same
//                                                  callable's `decision: "REJECT"`; stages NO ledger
//                                                  evidence -- the expected-quantity authority is left
//                                                  untouched, the count is simply recorded as disputed)
//   cancelCycleCount    : OPEN -> CANCELLED       (domain-safe only -- before any count is submitted)
//
// M23 BLIND-COUNT REMEDIATION (Owner ruling, 2026-08-18): the counter no longer sees expectedQuantity
// before submitting (field-ops-app-vite/src/modules/inventory/CycleCounts.jsx), and a manager now
// disposes of every submitted count as APPROVE or REJECT. SEPARATION OF DUTIES is enforced HERE, at the
// only place a variance can be dispositioned: reconcileCycleCount refuses (CycleCountSelfApprovalError)
// when the disposing actor is the SAME principal recorded as `submittedBy` AND the variance is material
// (cycleCountMateriality.ts). This is a server-side authorization check inside the transaction that
// reads and writes the record -- a client cannot bypass it by omitting a button or hiding a UI state.
Object.defineProperty(exports, "__esModule", { value: true });
exports.CycleCountIntegrityError = exports.CycleCountMalformedStoredRecordError = exports.CycleCountIdempotencyConflictError = exports.CycleCountStatusInvalidError = exports.CycleCountReasonRequiredError = exports.CycleCountQuantityInvalidError = exports.CycleCountSerialInvalidError = exports.CycleCountPartInvalidError = exports.CycleCountLocationInvalidError = exports.CycleCountNotFoundError = exports.CycleCountSelfApprovalError = exports.UnauthorizedCycleCountError = exports.CycleCountCommandError = exports.CYCLE_COUNT_SUPPORTED_TRACKING_MODES = exports.CYCLE_COUNT_LOCATION_TYPES = exports.CYCLE_COUNT_SCHEMA_VERSION = exports.CYCLE_COUNT_REVIEW_DECISIONS = exports.CYCLE_COUNT_STATUSES = void 0;
exports.CYCLE_COUNT_STATUSES = ["OPEN", "COUNTED", "RECONCILED", "REJECTED", "CANCELLED"];
exports.CYCLE_COUNT_REVIEW_DECISIONS = ["APPROVE", "REJECT"];
exports.CYCLE_COUNT_SCHEMA_VERSION = 1;
// Same endpoint fence as Transfer Phase 4: WAREHOUSE + MOBILE(truck) only. A cycle count at a BIN/VENDOR/
// CUSTOMER/VIRTUAL location is out of scope (matches the reused location-resolver's own fence).
exports.CYCLE_COUNT_LOCATION_TYPES = ["WAREHOUSE", "MOBILE"];
// NONE + SERIAL only (LOT deferred, same posture as Receiving/Transfer).
exports.CYCLE_COUNT_SUPPORTED_TRACKING_MODES = ["NONE", "SERIAL"];
class CycleCountCommandError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = new.target.name;
    }
}
exports.CycleCountCommandError = CycleCountCommandError;
class UnauthorizedCycleCountError extends CycleCountCommandError {
    constructor(m = "actor is not authorized to perform this cycle count action") {
        super("PERMISSION_DENIED", m);
    }
}
exports.UnauthorizedCycleCountError = UnauthorizedCycleCountError;
// M23 blind-count remediation -- separation-of-duties guard. Distinct from UnauthorizedCycleCountError
// (which means "this principal never holds the capability at all"): this principal DOES hold
// inventory.cycleCount.reconcile, but is the same principal who submitted THIS specific count, and the
// variance is material (cycleCountMateriality.ts) -- a self-review, not a missing grant. Still maps to
// HTTP permission-denied at the callable boundary (the caller may not perform this specific action),
// but is kept as its own failure code so a UI/test can tell the two apart.
class CycleCountSelfApprovalError extends CycleCountCommandError {
    constructor(m = "the actor who submitted this count cannot approve or reject its own material variance") {
        super("SEPARATION_OF_DUTIES", m);
    }
}
exports.CycleCountSelfApprovalError = CycleCountSelfApprovalError;
class CycleCountNotFoundError extends CycleCountCommandError {
    constructor(m = "cycle count not found") {
        super("CYCLE_COUNT_NOT_FOUND", m);
    }
}
exports.CycleCountNotFoundError = CycleCountNotFoundError;
class CycleCountLocationInvalidError extends CycleCountCommandError {
    constructor(m) {
        super("LOCATION_INVALID", m);
    }
}
exports.CycleCountLocationInvalidError = CycleCountLocationInvalidError;
class CycleCountPartInvalidError extends CycleCountCommandError {
    constructor(m) {
        super("PART_INVALID", m);
    }
}
exports.CycleCountPartInvalidError = CycleCountPartInvalidError;
class CycleCountSerialInvalidError extends CycleCountCommandError {
    constructor(m) {
        super("SERIAL_INVALID", m);
    }
}
exports.CycleCountSerialInvalidError = CycleCountSerialInvalidError;
class CycleCountQuantityInvalidError extends CycleCountCommandError {
    constructor(m) {
        super("QUANTITY_INVALID", m);
    }
}
exports.CycleCountQuantityInvalidError = CycleCountQuantityInvalidError;
class CycleCountReasonRequiredError extends CycleCountCommandError {
    constructor(m = "a reconciliation reason is required when there is a non-zero variance") {
        super("REASON_REQUIRED", m);
    }
}
exports.CycleCountReasonRequiredError = CycleCountReasonRequiredError;
class CycleCountStatusInvalidError extends CycleCountCommandError {
    constructor(m) {
        super("STATUS_INVALID", m);
    }
}
exports.CycleCountStatusInvalidError = CycleCountStatusInvalidError;
class CycleCountIdempotencyConflictError extends CycleCountCommandError {
    constructor(m = "idempotencyKey was already used for a different cycle count") {
        super("IDEMPOTENCY_CONFLICT", m);
    }
}
exports.CycleCountIdempotencyConflictError = CycleCountIdempotencyConflictError;
class CycleCountMalformedStoredRecordError extends CycleCountCommandError {
    constructor(m) {
        super("MALFORMED_STORED_RECORD", m);
    }
}
exports.CycleCountMalformedStoredRecordError = CycleCountMalformedStoredRecordError;
class CycleCountIntegrityError extends CycleCountCommandError {
    constructor(m = "the cycle count could not be completed due to a transient integrity error") {
        super("CYCLE_COUNT_INTEGRITY", m);
    }
}
exports.CycleCountIntegrityError = CycleCountIntegrityError;
//# sourceMappingURL=cycleCountTypes.js.map