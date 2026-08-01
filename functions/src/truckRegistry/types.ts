// EI Truck Registry -- trusted internal write service, shared types + failure taxonomy.
// ADR-010 (trucks = MOBILE Inventory Locations; the optional business record links 1:1 but is
// NOT custody authority) / Decision #59. Same "export is not deployment" posture as
// partMasterCommands.ts: nothing here is exported from functions/src/index.ts, there is no
// callable/HTTP surface, and every mutation is Admin-SDK-only (Rules deny all client writes).
//
// The cross-document 1:1 Truck<->MOBILE-Location invariant CANNOT be expressed in Firestore
// Rules, so it is enforced HERE, inside one transaction, via the create-if-absent of a
// location_truck_claims/{locationId} guard doc.

export const TRUCK_STATUSES = ["ACTIVE", "IDLE", "OUT_OF_SERVICE"] as const;
export type TruckStatus = (typeof TRUCK_STATUSES)[number];

// Reactivation requires an explicit operational target (never OUT_OF_SERVICE -- that is the
// deactivated state) -- Owner decision.
export const REACTIVATION_STATUSES = ["ACTIVE", "IDLE"] as const;
export type ReactivationStatus = (typeof REACTIVATION_STATUSES)[number];

// Deactivation atomically forces this status alongside active=false -- Owner decision.
export const DEACTIVATED_STATUS: TruckStatus = "OUT_OF_SERVICE";

// The injected governed-inventory-at-location predicate result. UNKNOWN means "no governed
// inventory source is connected / could not be determined" and FAILS CLOSED (blocks
// deactivation) -- today it is always UNKNOWN because the EI serialized-asset/ledger-at-
// location persistence does not exist yet.
export type InventoryPresence = "PRESENT" | "ABSENT" | "UNKNOWN";

// The seven NARROW Truck Registry audit actions (mirrored into the functions-authoritative
// AuditAction union in types/access.ts and the runtime AUDIT_ACTIONS allow-list in
// auditEventWriter.ts). assign and reassign share assignTruckDriver -- both are the same
// governed write (set the driver to a value); the summary records prior/next.
export const TRUCK_REGISTRY_AUDIT_ACTIONS = [
  "createTruck",
  "assignTruckDriver",
  "unassignTruckDriver",
  "changeTruckStatus",
  "changeTruckHomeWarehouse",
  "deactivateTruck",
  "reactivateTruck",
] as const;
export type TruckRegistryAuditAction = (typeof TRUCK_REGISTRY_AUDIT_ACTIONS)[number];

export interface MutationOutcome {
  readonly outcome: "applied" | "replayed";
  readonly version: number;
}

// ---------------------------------------------------------------------------
// Sanitized, class-per-reason error taxonomy. `code` is the STABLE, sanitized
// symbol a future callable maps to an HttpsError -- it carries no document
// contents, no employee/warehouse identifiers beyond the echoed request, and
// no internal state. Never surface `message` past the trust boundary.
// ---------------------------------------------------------------------------
export type TruckRegistryFailureCode =
  | "INVALID_INPUT"
  | "PERMISSION_DENIED"
  | "TRUCK_NOT_FOUND"
  | "LOCATION_NOT_FOUND"
  | "TRUCK_EXISTS"
  | "LOCATION_CLAIMED"
  | "EMPLOYEE_INVALID"
  | "WAREHOUSE_INVALID"
  | "INVALID_STATUS_TRANSITION"
  | "INVENTORY_PRESENT"
  | "INVENTORY_STATE_UNKNOWN"
  | "VERSION_CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "CLAIM_INTEGRITY"
  | "MALFORMED_STORED_RECORD";

export class TruckRegistryError extends Error {
  readonly code: TruckRegistryFailureCode;
  constructor(code: TruckRegistryFailureCode, message: string) {
    super(message);
    this.code = code;
    this.name = new.target.name;
  }
}
export class InvalidInputError extends TruckRegistryError { constructor(m: string) { super("INVALID_INPUT", m); } }
export class UnauthorizedActorError extends TruckRegistryError { constructor(m: string) { super("PERMISSION_DENIED", m); } }
export class TruckNotFoundError extends TruckRegistryError { constructor(m: string) { super("TRUCK_NOT_FOUND", m); } }
export class LocationNotFoundError extends TruckRegistryError { constructor(m: string) { super("LOCATION_NOT_FOUND", m); } }
export class TruckAlreadyExistsError extends TruckRegistryError { constructor(m: string) { super("TRUCK_EXISTS", m); } }
export class LocationClaimedError extends TruckRegistryError { constructor(m: string) { super("LOCATION_CLAIMED", m); } }
export class EmployeeInvalidError extends TruckRegistryError { constructor(m: string) { super("EMPLOYEE_INVALID", m); } }
export class WarehouseInvalidError extends TruckRegistryError { constructor(m: string) { super("WAREHOUSE_INVALID", m); } }
export class InvalidStatusTransitionError extends TruckRegistryError { constructor(m: string) { super("INVALID_STATUS_TRANSITION", m); } }
export class InventoryPresentError extends TruckRegistryError { constructor(m: string) { super("INVENTORY_PRESENT", m); } }
export class InventoryStateUnknownError extends TruckRegistryError { constructor(m: string) { super("INVENTORY_STATE_UNKNOWN", m); } }
export class VersionConflictError extends TruckRegistryError { constructor(m: string) { super("VERSION_CONFLICT", m); } }
export class IdempotencyConflictError extends TruckRegistryError { constructor(m: string) { super("IDEMPOTENCY_CONFLICT", m); } }
export class ClaimIntegrityError extends TruckRegistryError { constructor(m: string) { super("CLAIM_INTEGRITY", m); } }
export class MalformedStoredRecordError extends TruckRegistryError { constructor(m: string) { super("MALFORMED_STORED_RECORD", m); } }
