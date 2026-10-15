"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveEffectiveAccessCallable = void 0;
// Enterprise Access & Administration Platform (Issue #226) -- thin
// onCall adapter for effectiveAccessFeed.ts, same pattern as
// accessCommandCallables.ts's wrappers around trustedWriterCommands.ts
// and reporting/runReportDefinitionCallable.ts's wrapper around
// reportExecutionService.ts: authenticate, derive the caller's identity
// from the SERVER auth context only, map the module's typed errors to
// safe HttpsErrors, and nothing else -- every real decision lives in
// effectiveAccessFeed.ts.
//
// The single most important property of this file: `principalUid` is
// ALWAYS `request.auth.uid`. `request.data` is never read for uid,
// role, company authority, or Scope -- there is no field in this
// callable's accepted input shape that could carry any of those, so
// there is nothing to ignore-if-present; the shape itself cannot
// express a client-claimed identity or authority.
//
// Per the Owner's deployment-candidate authorization posture already
// established for this program (accessCommandCallables.ts,
// runReportDefinitionCallable.ts): exporting this callable from
// functions/src/index.ts is not itself a deployment or activation
// action. It is deployed to eos-platform-sandbox under the per-environment
// activation program; it is NOT deployed to the production project, and no
// client calls it, until a separate, later Owner production authorization.
const https_1 = require("firebase-functions/v2/https");
const effectiveAccessFeed_1 = require("./effectiveAccessFeed");
exports.resolveEffectiveAccessCallable = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    }
    const data = request.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new https_1.HttpsError("invalid-argument", "Request data must be an object.");
    }
    const extraKeys = Object.keys(data).filter((k) => k !== "permissionIds");
    if (extraKeys.length > 0) {
        // Fail closed on any unrecognized key -- this callable's accepted
        // shape is deliberately narrow (permissionIds only); an extra key
        // (e.g. a client attempting to pass "role"/"principalUid"/"scope"/
        // "companyId") is refused outright rather than silently ignored,
        // so a caller can never be confused into believing such a field had
        // any effect.
        throw new https_1.HttpsError("invalid-argument", `Unrecognized field(s): ${extraKeys.join(", ")}. Only permissionIds is accepted.`);
    }
    try {
        return await (0, effectiveAccessFeed_1.resolveEffectiveAccess)({
            principalUid: request.auth.uid,
            permissionIds: (data.permissionIds ?? []),
        });
    }
    catch (err) {
        if (err instanceof effectiveAccessFeed_1.InvalidInputError) {
            throw new https_1.HttpsError("invalid-argument", err.message);
        }
        if (err instanceof effectiveAccessFeed_1.MalformedAccessDataError) {
            // Internal data-shape detail -- never forward the message (it
            // names an internal Firestore field), only a safe, generic reason.
            throw new https_1.HttpsError("failed-precondition", "Your access record could not be evaluated. Try again shortly.");
        }
        throw new https_1.HttpsError("unavailable", "Access could not be evaluated right now. Try again shortly.");
    }
});
//# sourceMappingURL=effectiveAccessFeedCallable.js.map