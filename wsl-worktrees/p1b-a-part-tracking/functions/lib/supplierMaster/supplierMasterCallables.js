"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivateSupplierCallable = exports.activateSupplierCallable = exports.updateSupplierCallable = exports.createSupplierCallable = void 0;
exports.mapError = mapError;
// Supplier Master -- thin onCall adapters for the merged trusted write service
// (supplierMasterCommands.ts). Same pattern as truckRegistryCallables.ts / accessCommandCallables.ts:
// derive actorUid ONLY from request.auth.uid (NEVER request.data), pass request.data into the service,
// and map thrown service errors to HttpsError via a sanitized, generic-per-type taxonomy. ALL real
// logic -- capability enforcement, idempotency, versioning, audit, single-transaction -- lives inside
// the command service; these adapters add NO write authority and are deliberately thin so both stay
// independently testable.
//
// Exported from functions/src/index.ts and deployed to eos-platform-sandbox under the per-environment
// activation program; NOT deployed to the production project. As wired here there is NO App Check
// requirement (matching every other callable in this repo),
// and NO capability is granted -- authorization is enforced INSIDE the command against the actor's
// real governed roles (inventory.catalog.manage for create/update, inventory.catalog.activate for
// activate/deactivate). NOTE (production gap, see docs/releases/supplier-master-rc-1.md): no STANDING
// role currently carries inventory.catalog.activate, so activate/deactivate fail closed
// (permission-denied) until a role is defined + granted that capability -- a deferred protected step.
const https_1 = require("firebase-functions/v2/https");
const supplierMasterCommands_js_1 = require("./supplierMasterCommands.js");
const partMasterCommands_js_1 = require("../partMaster/partMasterCommands.js");
const partMasterRepository_js_1 = require("../partMaster/partMasterRepository.js");
const supplierMasterTypes_js_1 = require("./supplierMasterTypes.js");
// Sanitized error -> HttpsError. The service's messages may embed internal ids/versions; each error
// TYPE surfaces a GENERIC message so no internal state (existence, current version) leaks past the
// trust boundary. The stable `code` is what a client acts on. An unexpected error collapses to
// "internal".
function mapError(err) {
    if (err instanceof partMasterCommands_js_1.InvalidInputError)
        return new https_1.HttpsError("invalid-argument", "The request is missing or has invalid fields.");
    if (err instanceof partMasterCommands_js_1.UnauthorizedActorError)
        return new https_1.HttpsError("permission-denied", "You are not authorized to perform this action.");
    if (err instanceof partMasterCommands_js_1.NotFoundError)
        return new https_1.HttpsError("not-found", "No supplier exists at that id.");
    if (err instanceof partMasterCommands_js_1.AlreadyExistsError)
        return new https_1.HttpsError("already-exists", "A supplier already exists at that id.");
    if (err instanceof partMasterCommands_js_1.VersionConflictError)
        return new https_1.HttpsError("aborted", "The record changed since you loaded it. Reload and retry.");
    if (err instanceof partMasterCommands_js_1.IdempotencyConflictError)
        return new https_1.HttpsError("aborted", "That idempotency key was already used for a different request.");
    if (err instanceof partMasterCommands_js_1.InvalidStatusTransitionError)
        return new https_1.HttpsError("failed-precondition", "That status change is not allowed.");
    // Named explicitly for readers tracing a malformed stored record, though it maps to the same
    // generic "internal" response as the catch-all below (a stored-shape problem is never surfaced).
    if (err instanceof partMasterRepository_js_1.MalformedStoredRecordError)
        return new https_1.HttpsError("internal", "The request could not be completed.");
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
// Copy only the recognized optional string fields that are actually PRESENT, so the command's
// "validated-if-present" semantics hold (passing an explicit undefined would fail validation).
function pickOptionalStrings(d) {
    const out = {};
    for (const f of supplierMasterTypes_js_1.SUPPLIER_OPTIONAL_STRING_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(d, f))
            out[f] = d[f];
    }
    return out;
}
const REGION = { region: "us-central1" };
exports.createSupplierCallable = (0, https_1.onCall)(REGION, async (request) => {
    const actorUid = requireAuth(request);
    const d = asObject(request.data);
    try {
        return await (0, supplierMasterCommands_js_1.createSupplier)({
            actorUid,
            idempotencyKey: d.idempotencyKey,
            supplierId: d.supplierId,
            name: d.name,
            ...pickOptionalStrings(d),
        });
    }
    catch (err) {
        throw mapError(err);
    }
});
exports.updateSupplierCallable = (0, https_1.onCall)(REGION, async (request) => {
    const actorUid = requireAuth(request);
    const d = asObject(request.data);
    try {
        return await (0, supplierMasterCommands_js_1.updateSupplier)({
            actorUid,
            idempotencyKey: d.idempotencyKey,
            supplierId: d.supplierId,
            expectedVersion: d.expectedVersion,
            changes: (d.changes ?? {}),
        });
    }
    catch (err) {
        throw mapError(err);
    }
});
exports.activateSupplierCallable = (0, https_1.onCall)(REGION, async (request) => {
    const actorUid = requireAuth(request);
    const d = asObject(request.data);
    try {
        return await (0, supplierMasterCommands_js_1.activateSupplier)({
            actorUid,
            idempotencyKey: d.idempotencyKey,
            supplierId: d.supplierId,
            expectedVersion: d.expectedVersion,
        });
    }
    catch (err) {
        throw mapError(err);
    }
});
exports.deactivateSupplierCallable = (0, https_1.onCall)(REGION, async (request) => {
    const actorUid = requireAuth(request);
    const d = asObject(request.data);
    try {
        return await (0, supplierMasterCommands_js_1.deactivateSupplier)({
            actorUid,
            idempotencyKey: d.idempotencyKey,
            supplierId: d.supplierId,
            expectedVersion: d.expectedVersion,
        });
    }
    catch (err) {
        throw mapError(err);
    }
});
//# sourceMappingURL=supplierMasterCallables.js.map