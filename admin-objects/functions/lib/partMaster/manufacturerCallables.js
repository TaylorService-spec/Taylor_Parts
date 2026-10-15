"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.changeManufacturerStatusCallable = exports.updateManufacturerCallable = exports.createManufacturerCallable = void 0;
exports.mapError = mapError;
// Manufacturer (catalog reference object) -- thin onCall adapters for the existing trusted write service
// (partMasterCommands.ts createManufacturer/updateManufacturer/changeManufacturerStatus). Same pattern as
// partMasterCallables.ts / supplierMasterCallables.ts: derive actorUid ONLY from request.auth.uid (NEVER
// request.data), pass request.data into the service, and map thrown service errors to HttpsError via a
// sanitized, generic-per-type taxonomy. ALL real logic -- capability enforcement, validation, idempotency,
// versioning, audit, single-transaction -- lives INSIDE the command service; these adapters add NO write
// authority. There is ONE Manufacturer authority (partMasterCommands) -- this is not a second one, and no
// second model / parallel validator / parallel status vocabulary is introduced.
//
// Exported from functions/src/index.ts and deployed to eos-platform-sandbox under the per-environment
// activation program; NOT deployed to the production project, and NOT capability-granted. NO App Check
// requirement (matching every other callable here). Authorization is enforced INSIDE the
// command against the actor's real governed roles -- inventory.catalog.manage for create/update,
// inventory.catalog.activate for status change (the SAME catalog authority Part/Supplier use; the accepted
// future inventoryCatalogAdministrator role). NO capability is granted here; catalog capabilities are carried
// by no standing role, so create/update/status fail closed until a deferred protected grant.
const https_1 = require("firebase-functions/v2/https");
const partMasterCommands_js_1 = require("./partMasterCommands.js");
const partMasterRepository_js_1 = require("./partMasterRepository.js");
const catalogWriterState_js_1 = require("../catalogMaster/catalogWriterState.js");
// Sanitized error -> HttpsError. Each error TYPE surfaces a GENERIC message so no internal state
// (existence, current version) leaks past the trust boundary; the stable `code` is what a client acts on.
// Unexpected errors collapse to "internal".
function mapError(err) {
    if (err instanceof partMasterCommands_js_1.InvalidInputError)
        return new https_1.HttpsError("invalid-argument", "The request is missing or has invalid fields.");
    if (err instanceof partMasterCommands_js_1.UnauthorizedActorError)
        return new https_1.HttpsError("permission-denied", "You are not authorized to perform this action.");
    if (err instanceof partMasterCommands_js_1.NotFoundError)
        return new https_1.HttpsError("not-found", "No manufacturer exists at that id.");
    if (err instanceof partMasterCommands_js_1.AlreadyExistsError)
        return new https_1.HttpsError("already-exists", "A manufacturer already exists at that id.");
    if (err instanceof partMasterCommands_js_1.VersionConflictError)
        return new https_1.HttpsError("aborted", "The record changed since you loaded it. Reload and retry.");
    if (err instanceof partMasterCommands_js_1.IdempotencyConflictError)
        return new https_1.HttpsError("aborted", "That idempotency key was already used for a different request.");
    if (err instanceof partMasterCommands_js_1.InvalidStatusTransitionError)
        return new https_1.HttpsError("failed-precondition", "That status change is not allowed.");
    // Catalog cutover: FROZEN (the controlled freeze window) and RETIRED are governed refusals, not faults --
    // the same failed-precondition outcome partMasterCallables.ts maps them to. Never "internal".
    if (err instanceof catalogWriterState_js_1.FirestoreCatalogWriterClosedError) {
        return new https_1.HttpsError("failed-precondition", err.state === "FROZEN" ? "Manufacturer records are frozen for the catalog cutover." : "Manufacturer records are no longer written here.", { code: err.code });
    }
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
const REGION = { region: "us-central1" };
exports.createManufacturerCallable = (0, https_1.onCall)(REGION, async (request) => {
    const actorUid = requireAuth(request);
    const d = asObject(request.data);
    try {
        return await (0, partMasterCommands_js_1.createManufacturer)({ actorUid, idempotencyKey: d.idempotencyKey, manufacturerId: d.manufacturerId, name: d.name });
    }
    catch (err) {
        throw mapError(err);
    }
});
exports.updateManufacturerCallable = (0, https_1.onCall)(REGION, async (request) => {
    const actorUid = requireAuth(request);
    const d = asObject(request.data);
    try {
        return await (0, partMasterCommands_js_1.updateManufacturer)({ actorUid, idempotencyKey: d.idempotencyKey, manufacturerId: d.manufacturerId, expectedVersion: d.expectedVersion, name: d.name });
    }
    catch (err) {
        throw mapError(err);
    }
});
exports.changeManufacturerStatusCallable = (0, https_1.onCall)(REGION, async (request) => {
    const actorUid = requireAuth(request);
    const d = asObject(request.data);
    try {
        return await (0, partMasterCommands_js_1.changeManufacturerStatus)({ actorUid, idempotencyKey: d.idempotencyKey, manufacturerId: d.manufacturerId, expectedVersion: d.expectedVersion, newStatus: d.newStatus });
    }
    catch (err) {
        throw mapError(err);
    }
});
//# sourceMappingURL=manufacturerCallables.js.map