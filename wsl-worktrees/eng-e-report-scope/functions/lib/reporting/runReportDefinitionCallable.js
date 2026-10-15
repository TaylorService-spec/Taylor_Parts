"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runReportDefinitionCallable = void 0;
// Issue #325 / ADR-007 D-FN -- thin onCall adapter for
// reportExecutionService.ts's runReportDefinition(), same pattern as
// access/accessCommandCallables.ts's thin wrappers around
// trustedWriterCommands.ts: auth check, map the caller's uid + request
// data into the service call, map thrown errors to HttpsError codes.
// All the real logic lives in the service; this file is deliberately
// thin so both stay independently testable.
//
// ENG-E CORRECTION (main @ 64008d5ae0bdd9532909671b15a91122400accf1). The
// paragraph that stood here said:
//
//   "NOT WIRED to any client -- field-ops-app-vite/src/domain/reporting/
//    reportExecutionSeam.js (the client's gated run seam) is UNCHANGED by this
//    PR and still unconditionally resolves to the 'unavailable' outcome."
//
// THAT IS FALSE. reportExecutionSeam.js:32-39 has no gate of any kind:
// `runReport()` calls `httpsCallable(functions, RUN_REPORT_CALLABLE)`
// UNCONDITIONALLY and maps whatever comes back. What resolves to "unavailable"
// is a FAILED call (mapCallableError's default branch), which is error handling,
// not a gate. The seam is wired; it simply has nothing to reach unless the
// callable is deployed.
//
// Exporting this callable from functions/src/index.ts is still not itself a
// deployment or activation action -- that part was and remains true, and matches
// access/accessCommandCallables.ts's own header ("export is not deployment").
//
// NOTE for the client lane (ENG-E did not touch field-ops-app-vite): the service
// can now return kind "company-unresolved", which is NOT in
// reportRunOutcome.js's SERVICE_KINDS set, so mapServiceOutcome() maps it to
// reportRunFailure(). That is FAIL-SAFE (no rows, safe copy) but it loses the
// tenancy-specific explanation. Adding the kind to SERVICE_KINDS with its own
// user-facing copy is a follow-up in that lane's surface, not this one's.
const https_1 = require("firebase-functions/v2/https");
const reportExecutionService_1 = require("./reportExecutionService");
exports.runReportDefinitionCallable = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    }
    const data = request.data;
    if (!data || typeof data !== "object") {
        throw new https_1.HttpsError("invalid-argument", "Request data must be an object.");
    }
    if (data.definitionId !== undefined && typeof data.definitionId !== "string") {
        throw new https_1.HttpsError("invalid-argument", "definitionId must be a string when present.");
    }
    try {
        return await (0, reportExecutionService_1.runReportDefinition)({
            runnerUid: request.auth.uid,
            definition: data.definition,
            definitionId: data.definitionId,
        });
    }
    catch (err) {
        if (err instanceof reportExecutionService_1.InvalidReportDefinitionError) {
            throw new https_1.HttpsError("invalid-argument", err.message);
        }
        if (err instanceof reportExecutionService_1.UnknownReportObjectError) {
            throw new https_1.HttpsError("failed-precondition", err.message);
        }
        // Truncation honesty (census X-9): an aggregate whose scan was cut
        // is REFUSED, never returned as a partial figure. "resource-
        // exhausted" is the honest code -- the request was well-formed and
        // authorized; the engine's own scan bound is what it exceeded. The
        // message is actionable (narrow the report, or drop the aggregates)
        // and carries no row data.
        if (err instanceof reportExecutionService_1.IncompleteAggregateScanError) {
            throw new https_1.HttpsError("resource-exhausted", err.message);
        }
        throw new https_1.HttpsError("internal", "The report could not run.");
    }
});
//# sourceMappingURL=runReportDefinitionCallable.js.map