"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.changePartStatusCallable = exports.updatePartCallable = exports.createPartCallable = void 0;
exports.mapError = mapError;
// Part Master -- thin onCall adapters for the existing trusted write service (partMasterCommands.ts).
// Same pattern as supplierMasterCallables.ts / truckRegistryCallables.ts: derive actorUid ONLY from
// request.auth.uid (NEVER request.data), pass request.data into the service, and map thrown service
// errors to HttpsError via a sanitized, generic-per-type taxonomy. ALL real logic -- capability
// enforcement, validation, idempotency, versioning, audit, single-transaction -- lives INSIDE the
// command service; these adapters add NO write authority and are deliberately thin so both stay
// independently testable. There is ONE Part authority (partMasterCommands) -- this is not a second one.
//
// "Export is not deployment/grant": exporting these from functions/src/index.ts does NOT deploy or
// grant them. NO App Check requirement (matching every other callable here). Authorization is enforced
// INSIDE the command against the actor's real governed roles: inventory.catalog.manage for
// create/update, inventory.catalog.activate for status change (the accepted catalog authority, carried
// by the future durable inventoryCatalogAdministrator role). NO capability is granted here; catalog
// capabilities are carried by no standing role today, so every real user fails closed until a
// separate, protected grant (see docs/releases/part-master-write-rc.md when authored).
const https_1 = require("firebase-functions/v2/https");
const partMasterCommands_js_1 = require("./partMasterCommands.js");
const partMasterRepository_js_1 = require("./partMasterRepository.js");
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
        return new https_1.HttpsError("not-found", "No part exists at that id.");
    if (err instanceof partMasterCommands_js_1.AlreadyExistsError)
        return new https_1.HttpsError("already-exists", "A part already exists at that id.");
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
const REGION = { region: "us-central1" };
exports.createPartCallable = (0, https_1.onCall)(REGION, async (request) => {
    const actorUid = requireAuth(request);
    const d = asObject(request.data);
    try {
        // The command's validatePart owns full field validation of `part`; the adapter forwards it as-is.
        // PartInput's fields are all `unknown` (it is the untyped-input boundary type), so this cast is honest.
        return await (0, partMasterCommands_js_1.createPart)({ actorUid, idempotencyKey: d.idempotencyKey, part: d.part });
    }
    catch (err) {
        throw mapError(err);
    }
});
exports.updatePartCallable = (0, https_1.onCall)(REGION, async (request) => {
    const actorUid = requireAuth(request);
    const d = asObject(request.data);
    try {
        // Forward `changes` as-is: the command owns the updatable-field allowlist + re-validation (the
        // adapter must not reimplement it), same deferral as createPart's `part`.
        return await (0, partMasterCommands_js_1.updatePart)({
            actorUid,
            idempotencyKey: d.idempotencyKey,
            partId: d.partId,
            expectedVersion: d.expectedVersion,
            changes: (d.changes ?? {}),
        });
    }
    catch (err) {
        throw mapError(err);
    }
});
exports.changePartStatusCallable = (0, https_1.onCall)(REGION, async (request) => {
    const actorUid = requireAuth(request);
    const d = asObject(request.data);
    try {
        return await (0, partMasterCommands_js_1.changePartStatus)({
            actorUid,
            idempotencyKey: d.idempotencyKey,
            partId: d.partId,
            expectedVersion: d.expectedVersion,
            newStatus: d.newStatus,
        });
    }
    catch (err) {
        throw mapError(err);
    }
});
//# sourceMappingURL=partMasterCallables.js.map