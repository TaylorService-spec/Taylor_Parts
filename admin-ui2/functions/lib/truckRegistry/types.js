"use strict";
// EI Truck Registry -- trusted internal write service, shared types + failure taxonomy.
// ADR-010 (trucks = MOBILE Inventory Locations; the optional business record links 1:1 but is
// NOT custody authority) / Decision #60. Same "export is not deployment" posture as
// partMasterCommands.ts: nothing here is exported from functions/src/index.ts, there is no
// callable/HTTP surface, and every mutation is Admin-SDK-only (Rules deny all client writes).
//
// The cross-document 1:1 Truck<->MOBILE-Location invariant CANNOT be expressed in Firestore
// Rules, so it is enforced HERE, inside one transaction, via the create-if-absent of a
// location_truck_claims/{locationId} guard doc.
Object.defineProperty(exports, "__esModule", { value: true });
exports.DriverAlreadyAssignedError = exports.StatusTransitionForbiddenError = exports.MalformedStoredRecordError = exports.ReferenceStateUnknownError = exports.TruckReferencedError = exports.ClaimIntegrityError = exports.IdempotencyConflictError = exports.VersionConflictError = exports.InventoryStateUnknownError = exports.InventoryPresentError = exports.InvalidStatusTransitionError = exports.WarehouseInvalidError = exports.EmployeeInvalidError = exports.LocationClaimedError = exports.TruckAlreadyExistsError = exports.LocationNotFoundError = exports.TruckNotFoundError = exports.UnauthorizedActorError = exports.InvalidInputError = exports.TruckRegistryError = exports.TRUCK_REGISTRY_AUDIT_ACTIONS = exports.DEACTIVATED_STATUS = exports.REACTIVATION_STATUSES = exports.TRUCK_STATUSES = void 0;
exports.TRUCK_STATUSES = ["ACTIVE", "IDLE", "OUT_OF_SERVICE"];
// Reactivation requires an explicit operational target (never OUT_OF_SERVICE -- that is the
// deactivated state) -- Owner decision.
exports.REACTIVATION_STATUSES = ["ACTIVE", "IDLE"];
// Deactivation atomically forces this status alongside active=false -- Owner decision.
exports.DEACTIVATED_STATUS = "OUT_OF_SERVICE";
// The NARROW Truck Registry audit actions (mirrored into the functions-authoritative
// AuditAction union in types/access.ts and the runtime AUDIT_ACTIONS allow-list in
// auditEventWriter.ts). assign and reassign share assignTruckDriver -- both are the same
// governed write (set the driver to a value); the summary records prior/next.
// deleteTruckCreatedInError is the admin-only Created-in-Error hard delete; its Audit Event
// is the immutable deletion TOMBSTONE (it survives the deleted truck/location/claim) and is
// also the idempotency record for the delete.
exports.TRUCK_REGISTRY_AUDIT_ACTIONS = [
    "createTruck",
    "assignTruckDriver",
    "unassignTruckDriver",
    "changeTruckStatus",
    "changeTruckHomeWarehouse",
    "deactivateTruck",
    "reactivateTruck",
    "deleteTruckCreatedInError",
];
class TruckRegistryError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = new.target.name;
    }
}
exports.TruckRegistryError = TruckRegistryError;
class InvalidInputError extends TruckRegistryError {
    constructor(m) { super("INVALID_INPUT", m); }
}
exports.InvalidInputError = InvalidInputError;
class UnauthorizedActorError extends TruckRegistryError {
    constructor(m) { super("PERMISSION_DENIED", m); }
}
exports.UnauthorizedActorError = UnauthorizedActorError;
class TruckNotFoundError extends TruckRegistryError {
    constructor(m) { super("TRUCK_NOT_FOUND", m); }
}
exports.TruckNotFoundError = TruckNotFoundError;
class LocationNotFoundError extends TruckRegistryError {
    constructor(m) { super("LOCATION_NOT_FOUND", m); }
}
exports.LocationNotFoundError = LocationNotFoundError;
class TruckAlreadyExistsError extends TruckRegistryError {
    constructor(m) { super("TRUCK_EXISTS", m); }
}
exports.TruckAlreadyExistsError = TruckAlreadyExistsError;
class LocationClaimedError extends TruckRegistryError {
    constructor(m) { super("LOCATION_CLAIMED", m); }
}
exports.LocationClaimedError = LocationClaimedError;
class EmployeeInvalidError extends TruckRegistryError {
    constructor(m) { super("EMPLOYEE_INVALID", m); }
}
exports.EmployeeInvalidError = EmployeeInvalidError;
class WarehouseInvalidError extends TruckRegistryError {
    constructor(m) { super("WAREHOUSE_INVALID", m); }
}
exports.WarehouseInvalidError = WarehouseInvalidError;
class InvalidStatusTransitionError extends TruckRegistryError {
    constructor(m) { super("INVALID_STATUS_TRANSITION", m); }
}
exports.InvalidStatusTransitionError = InvalidStatusTransitionError;
class InventoryPresentError extends TruckRegistryError {
    constructor(m) { super("INVENTORY_PRESENT", m); }
}
exports.InventoryPresentError = InventoryPresentError;
class InventoryStateUnknownError extends TruckRegistryError {
    constructor(m) { super("INVENTORY_STATE_UNKNOWN", m); }
}
exports.InventoryStateUnknownError = InventoryStateUnknownError;
class VersionConflictError extends TruckRegistryError {
    constructor(m) { super("VERSION_CONFLICT", m); }
}
exports.VersionConflictError = VersionConflictError;
class IdempotencyConflictError extends TruckRegistryError {
    constructor(m) { super("IDEMPOTENCY_CONFLICT", m); }
}
exports.IdempotencyConflictError = IdempotencyConflictError;
class ClaimIntegrityError extends TruckRegistryError {
    constructor(m) { super("CLAIM_INTEGRITY", m); }
}
exports.ClaimIntegrityError = ClaimIntegrityError;
class TruckReferencedError extends TruckRegistryError {
    constructor(m) { super("TRUCK_REFERENCED", m); }
}
exports.TruckReferencedError = TruckReferencedError;
class ReferenceStateUnknownError extends TruckRegistryError {
    constructor(m) { super("REFERENCE_STATE_UNKNOWN", m); }
}
exports.ReferenceStateUnknownError = ReferenceStateUnknownError;
class MalformedStoredRecordError extends TruckRegistryError {
    constructor(m) { super("MALFORMED_STORED_RECORD", m); }
}
exports.MalformedStoredRecordError = MalformedStoredRecordError;
class StatusTransitionForbiddenError extends TruckRegistryError {
    constructor(m) { super("STATUS_TRANSITION_FORBIDDEN", m); }
}
exports.StatusTransitionForbiddenError = StatusTransitionForbiddenError;
class DriverAlreadyAssignedError extends TruckRegistryError {
    constructor(m) { super("DRIVER_ALREADY_ASSIGNED", m); }
}
exports.DriverAlreadyAssignedError = DriverAlreadyAssignedError;
//# sourceMappingURL=types.js.map