"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteTruckCreatedInErrorCallable = exports.reactivateTruckCallable = exports.deactivateTruckCallable = exports.changeTruckHomeWarehouseCallable = exports.changeTruckStatusCallable = exports.unassignTruckDriverCallable = exports.reassignTruckDriverCallable = exports.assignTruckDriverCallable = exports.createTruckCallable = void 0;
exports.mapError = mapError;
// EI Truck Registry (ADR-010 / Decision #60) -- thin onCall adapters for the merged trusted
// write service (truckRegistryCommands.ts). Same pattern as reporting/savedDefinitionCallables.ts
// and access/accessCommandCallables.ts: derive actorUid ONLY from request.auth.uid (NEVER
// request.data), pass request.data into the service, and map thrown service errors to HttpsError
// codes via the sanitized class-per-reason taxonomy. All real logic lives in the service -- these
// adapters are deliberately thin so both stay independently testable.
//
// "Export is not deployment": exporting these from functions/src/index.ts does NOT deploy or
// activate them. As wired here there is NO App Check requirement (matching every other callable
// in this repo -- no callable enforces App Check), NO Admin UI calls them. Enterprise Inventory
// Phase 5: deactivateTruck now runs with a REAL default governed-inventory predicate
// (mobileLocationPresenceProbe.ts, wired as truckRegistryCommands.ts's own resolveDeps default) --
// it genuinely resolves ABSENT for an empty MOBILE location and PRESENT for one carrying SERIAL or
// NONE-mode inventory; it still FAILS CLOSED (INVENTORY_STATE_UNKNOWN -> failed-precondition) when
// its own reads are inconclusive. deleteTruckCreatedInErrorCallable explicitly injects the real
// operational-reference registry (also now the truckRegistryCommands.ts default) -- five of eleven
// governed authorities are conclusive; six remain unverifiable on the current schema, so a delete
// is still necessarily blocked (REFERENCE_STATE_UNKNOWN -> failed-precondition) until they exist.
// Authorization is admin/dispatcher (users/{uid}.role), enforced inside the service -- no new
// capability, no Issue #100 change.
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const operationalReferenceProbe_1 = require("./operationalReferenceProbe");
const truckRegistryCommands_1 = require("./truckRegistryCommands");
const types_1 = require("./types");
// Sanitized code -> HttpsError code + a generic client message. The service's own error
// messages may embed internal ids/versions; the wrappers deliberately surface a GENERIC message
// per code so no internal state (existence, current version, reference status) leaks past the
// trust boundary -- the stable `code` is what a client acts on.
const FAILURE_MAP = {
    INVALID_INPUT: { code: "invalid-argument", message: "The request is missing or has invalid fields." },
    PERMISSION_DENIED: { code: "permission-denied", message: "You are not authorized to perform this action." },
    TRUCK_NOT_FOUND: { code: "not-found", message: "No truck exists at that id." },
    LOCATION_NOT_FOUND: { code: "not-found", message: "No mobile location exists at that id." },
    TRUCK_EXISTS: { code: "already-exists", message: "A truck already exists at that id." },
    LOCATION_CLAIMED: { code: "already-exists", message: "That location is already linked to a truck." },
    EMPLOYEE_INVALID: { code: "failed-precondition", message: "The referenced employee is missing or not active." },
    WAREHOUSE_INVALID: { code: "failed-precondition", message: "The referenced warehouse is missing or inactive." },
    INVALID_STATUS_TRANSITION: { code: "failed-precondition", message: "That status change is not allowed." },
    INVENTORY_PRESENT: { code: "failed-precondition", message: "Governed inventory remains at the location. Move it via Transfers first." },
    INVENTORY_STATE_UNKNOWN: { code: "failed-precondition", message: "Inventory state cannot be confirmed, so deactivation is blocked." },
    VERSION_CONFLICT: { code: "aborted", message: "The record changed since you loaded it. Reload and retry." },
    IDEMPOTENCY_CONFLICT: { code: "aborted", message: "That idempotency key was already used for a different request." },
    CLAIM_INTEGRITY: { code: "failed-precondition", message: "The truck-location link is missing or inconsistent." },
    TRUCK_REFERENCED: { code: "failed-precondition", message: "This truck has operational history and cannot be deleted." },
    REFERENCE_STATE_UNKNOWN: { code: "failed-precondition", message: "The truck's operational history cannot be confirmed, so deletion is blocked." },
    MALFORMED_STORED_RECORD: { code: "internal", message: "The request could not be completed." },
    STATUS_TRANSITION_FORBIDDEN: { code: "failed-precondition", message: "That status change is not allowed; use the deactivate action instead." },
    DRIVER_ALREADY_ASSIGNED: { code: "failed-precondition", message: "That driver is already assigned to a different truck." },
};
// Exported for direct sanitization tests: proves a known service error surfaces ONLY its
// generic per-code message (never its raw internal message) and an unexpected non-
// TruckRegistryError collapses to the generic "internal" response.
function mapError(err) {
    if (err instanceof types_1.TruckRegistryError) {
        const mapped = FAILURE_MAP[err.code] ?? { code: "internal", message: "The request could not be completed." };
        return new https_1.HttpsError(mapped.code, mapped.message);
    }
    return new https_1.HttpsError("internal", "The request could not be completed.");
}
function requireAuth(request) {
    if (!request.auth || typeof request.auth.uid !== "string" || request.auth.uid.length === 0) {
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    }
    return request.auth.uid;
}
function asObject(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new https_1.HttpsError("invalid-argument", "Request data must be an object.");
    }
    return data;
}
const REGION = { region: "us-central1" };
exports.createTruckCallable = (0, https_1.onCall)(REGION, async (request) => {
    const actorUid = requireAuth(request);
    const d = asObject(request.data);
    try {
        return await (0, truckRegistryCommands_1.createTruck)({
            actorUid,
            idempotencyKey: d.idempotencyKey,
            truckId: d.truckId,
            locationId: d.locationId,
            homeWarehouseId: d.homeWarehouseId,
            status: d.status,
            assignedDriverEmployeeId: (d.assignedDriverEmployeeId ?? null),
            displayLabel: d.displayLabel,
            vehicleNumber: d.vehicleNumber,
        });
    }
    catch (err) {
        throw mapError(err);
    }
});
exports.assignTruckDriverCallable = (0, https_1.onCall)(REGION, async (request) => {
    const actorUid = requireAuth(request);
    const d = asObject(request.data);
    try {
        return await (0, truckRegistryCommands_1.assignDriver)({ actorUid, idempotencyKey: d.idempotencyKey, truckId: d.truckId, employeeId: d.employeeId, expectedVersion: d.expectedVersion });
    }
    catch (err) {
        throw mapError(err);
    }
});
exports.reassignTruckDriverCallable = (0, https_1.onCall)(REGION, async (request) => {
    const actorUid = requireAuth(request);
    const d = asObject(request.data);
    try {
        return await (0, truckRegistryCommands_1.reassignDriver)({ actorUid, idempotencyKey: d.idempotencyKey, truckId: d.truckId, employeeId: d.employeeId, expectedVersion: d.expectedVersion });
    }
    catch (err) {
        throw mapError(err);
    }
});
exports.unassignTruckDriverCallable = (0, https_1.onCall)(REGION, async (request) => {
    const actorUid = requireAuth(request);
    const d = asObject(request.data);
    try {
        return await (0, truckRegistryCommands_1.unassignDriver)({ actorUid, idempotencyKey: d.idempotencyKey, truckId: d.truckId, expectedVersion: d.expectedVersion });
    }
    catch (err) {
        throw mapError(err);
    }
});
exports.changeTruckStatusCallable = (0, https_1.onCall)(REGION, async (request) => {
    const actorUid = requireAuth(request);
    const d = asObject(request.data);
    try {
        return await (0, truckRegistryCommands_1.changeStatus)({ actorUid, idempotencyKey: d.idempotencyKey, truckId: d.truckId, status: d.status, expectedVersion: d.expectedVersion });
    }
    catch (err) {
        throw mapError(err);
    }
});
exports.changeTruckHomeWarehouseCallable = (0, https_1.onCall)(REGION, async (request) => {
    const actorUid = requireAuth(request);
    const d = asObject(request.data);
    try {
        return await (0, truckRegistryCommands_1.changeHomeWarehouse)({ actorUid, idempotencyKey: d.idempotencyKey, truckId: d.truckId, homeWarehouseId: d.homeWarehouseId, expectedVersion: d.expectedVersion });
    }
    catch (err) {
        throw mapError(err);
    }
});
// Runs with the default UNKNOWN inventory predicate -> fail-closed (INVENTORY_STATE_UNKNOWN)
// until a real governed inventory predicate is injected by a separate, later gate.
exports.deactivateTruckCallable = (0, https_1.onCall)(REGION, async (request) => {
    const actorUid = requireAuth(request);
    const d = asObject(request.data);
    try {
        return await (0, truckRegistryCommands_1.deactivateTruck)({ actorUid, idempotencyKey: d.idempotencyKey, truckId: d.truckId, expectedVersion: d.expectedVersion });
    }
    catch (err) {
        throw mapError(err);
    }
});
exports.reactivateTruckCallable = (0, https_1.onCall)(REGION, async (request) => {
    const actorUid = requireAuth(request);
    const d = asObject(request.data);
    try {
        return await (0, truckRegistryCommands_1.reactivateTruck)({ actorUid, idempotencyKey: d.idempotencyKey, truckId: d.truckId, targetStatus: d.targetStatus, expectedVersion: d.expectedVersion });
    }
    catch (err) {
        throw mapError(err);
    }
});
// ADMIN-ONLY Created-in-Error hard delete. Injects the REAL cross-collection operational-reference
// probe (operationalReferenceProbe.ts). On the current schema every governed authority is
// unverifiable, so the probe returns UNKNOWN and the delete FAILS CLOSED (REFERENCE_STATE_UNKNOWN ->
// failed-precondition) -- it will only succeed once a governed authority ships a MOBILE-location/
// truck-indexed reference and its check is wired in. The service enforces admin-only + all safety
// checks; this adapter derives actorUid, injects the probe, and maps sanitized errors (no collection
// names / document data / query details leak).
exports.deleteTruckCreatedInErrorCallable = (0, https_1.onCall)(REGION, async (request) => {
    const actorUid = requireAuth(request);
    const d = asObject(request.data);
    try {
        return await (0, truckRegistryCommands_1.deleteTruckCreatedInError)({ actorUid, idempotencyKey: d.idempotencyKey, truckId: d.truckId, expectedVersion: d.expectedVersion, deletionReason: d.deletionReason }, { hasOperationalReferences: (0, operationalReferenceProbe_1.buildOperationalReferenceProbe)({ db: (0, firestore_1.getFirestore)() }) });
    }
    catch (err) {
        throw mapError(err);
    }
});
//# sourceMappingURL=truckRegistryCallables.js.map