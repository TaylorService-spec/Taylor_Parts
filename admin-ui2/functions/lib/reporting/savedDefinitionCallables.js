"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteSavedDefinitionCallable = exports.duplicateSavedDefinitionCallable = exports.renameSavedDefinitionCallable = exports.listSavedDefinitionsCallable = exports.getSavedDefinitionCallable = exports.createSavedDefinitionCallable = void 0;
// Issue #325 / ADR-007 D-RULES, CORRECTED -- thin onCall adapters for
// savedDefinitionCommands.ts, same pattern as reportExecutionService.ts's
// own runReportDefinitionCallable.ts and access/accessCommandCallables.ts's
// thin wrappers around trustedWriterCommands.ts: auth check, map the
// caller's uid (request.auth.uid -- NEVER request.data) + request data
// into the service call, map thrown errors to HttpsError codes. All the
// real logic lives in the service; these adapters are deliberately thin
// so both stay independently testable.
//
// NOT WIRED to any client -- Customer persistence integration is
// explicitly out of scope for this task. Exporting these callables from
// functions/src/index.ts (same PR, next commit) is not itself a
// deployment or activation action -- same posture every other trusted-
// writer callable in this repo already documents ("export is not
// deployment").
const https_1 = require("firebase-functions/v2/https");
const savedDefinitionCommands_1 = require("./savedDefinitionCommands");
function mapError(err) {
    if (err instanceof savedDefinitionCommands_1.InvalidReportDefinitionError || err instanceof savedDefinitionCommands_1.InvalidInputError) {
        return new https_1.HttpsError("invalid-argument", err.message);
    }
    if (err instanceof savedDefinitionCommands_1.UnauthorizedActorError) {
        return new https_1.HttpsError("permission-denied", err.message);
    }
    // NotFoundError and NotOwnerError are deliberately mapped to the SAME
    // "not-found" code -- a caller must never be able to distinguish
    // "this id doesn't exist" from "this id exists but isn't yours" from
    // the HttpsError alone (see savedDefinitionCommands.ts's own
    // requireOwnershipOrAudit comment on this same principle).
    if (err instanceof savedDefinitionCommands_1.NotFoundError || err instanceof savedDefinitionCommands_1.NotOwnerError) {
        return new https_1.HttpsError("not-found", "No saved definition exists at that id.");
    }
    return new https_1.HttpsError("internal", "The request could not be completed.");
}
function requireAuth(request) {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    }
    return request.auth.uid;
}
exports.createSavedDefinitionCallable = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    const actorUid = requireAuth(request);
    const data = request.data;
    if (!data || typeof data !== "object") {
        throw new https_1.HttpsError("invalid-argument", "Request data must be an object.");
    }
    try {
        return await (0, savedDefinitionCommands_1.createSavedDefinition)({ actorUid, name: data.name, definition: data.definition });
    }
    catch (err) {
        throw mapError(err);
    }
});
exports.getSavedDefinitionCallable = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    const actorUid = requireAuth(request);
    const data = request.data;
    if (!data || typeof data.definitionId !== "string") {
        throw new https_1.HttpsError("invalid-argument", "definitionId must be a string.");
    }
    try {
        return await (0, savedDefinitionCommands_1.getSavedDefinition)({ actorUid, definitionId: data.definitionId });
    }
    catch (err) {
        throw mapError(err);
    }
});
exports.listSavedDefinitionsCallable = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    const actorUid = requireAuth(request);
    try {
        return await (0, savedDefinitionCommands_1.listSavedDefinitions)({ actorUid });
    }
    catch (err) {
        throw mapError(err);
    }
});
exports.renameSavedDefinitionCallable = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    const actorUid = requireAuth(request);
    const data = request.data;
    if (!data || typeof data.definitionId !== "string") {
        throw new https_1.HttpsError("invalid-argument", "definitionId must be a string.");
    }
    try {
        return await (0, savedDefinitionCommands_1.renameSavedDefinition)({ actorUid, definitionId: data.definitionId, name: data.name });
    }
    catch (err) {
        throw mapError(err);
    }
});
exports.duplicateSavedDefinitionCallable = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    const actorUid = requireAuth(request);
    const data = request.data;
    if (!data || typeof data.definitionId !== "string") {
        throw new https_1.HttpsError("invalid-argument", "definitionId must be a string.");
    }
    if (data.name !== undefined && typeof data.name !== "string") {
        throw new https_1.HttpsError("invalid-argument", "name must be a string when present.");
    }
    try {
        return await (0, savedDefinitionCommands_1.duplicateSavedDefinition)({
            actorUid,
            definitionId: data.definitionId,
            name: data.name,
        });
    }
    catch (err) {
        throw mapError(err);
    }
});
exports.deleteSavedDefinitionCallable = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    const actorUid = requireAuth(request);
    const data = request.data;
    if (!data || typeof data.definitionId !== "string") {
        throw new https_1.HttpsError("invalid-argument", "definitionId must be a string.");
    }
    try {
        await (0, savedDefinitionCommands_1.deleteSavedDefinition)({ actorUid, definitionId: data.definitionId });
        return { deleted: true };
    }
    catch (err) {
        throw mapError(err);
    }
});
//# sourceMappingURL=savedDefinitionCallables.js.map