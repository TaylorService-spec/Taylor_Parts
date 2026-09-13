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
//
// NOTE for the client lane (RPT-FIX, also did not touch field-ops-app-vite).
// THREE follow-ups, none of them in this lane's surface:
//
//  1. reportRunOutcome.js:13 SERVICE_KINDS is a CLOSED set and still omits
//     "company-unresolved" (ENG-E's, above).
//  2. reportRunOutcome.js mapCallableError() has no "resource-exhausted" branch,
//     so BOTH refusals -- the aggregate one that already shipped and the
//     unproven-absence one added here -- fall to `default:` and render
//     reportRunUnavailable(): "Running reports isn't available yet. Nothing was
//     read or changed." That is fail-safe but FACTUALLY WRONG (documents were
//     read) and it hides an actionable message ("narrow the report"). It needs
//     its own branch and its own copy.
//  3. reportResultState.js:26-29's "empty" branch reads NO truncation flag and
//     says "This report ran successfully but no records matched." The service no
//     longer produces a truncated "empty", so that copy is no longer reachable
//     from a live run -- but the branch is also driven by FIXTURES (Spec sec12),
//     and its partially-authorized sibling already reads outcome.truncated for
//     exactly this reason. It should read the new orthogonal fields
//     (completeness/scanTruncated) rather than trusting the kind.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  runReportDefinition,
  InvalidReportDefinitionError,
  UnknownReportObjectError,
  IncompleteAggregateScanError,
  UnprovenAbsenceError,
} from "./reportExecutionService";

export const runReportDefinitionCallable = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be signed in.");
  }

  const data = request.data as { definition?: unknown; definitionId?: unknown } | null;
  if (!data || typeof data !== "object") {
    throw new HttpsError("invalid-argument", "Request data must be an object.");
  }
  if (data.definitionId !== undefined && typeof data.definitionId !== "string") {
    throw new HttpsError("invalid-argument", "definitionId must be a string when present.");
  }

  try {
    return await runReportDefinition({
      runnerUid: request.auth.uid,
      definition: data.definition,
      definitionId: data.definitionId as string | undefined,
    });
  } catch (err) {
    if (err instanceof InvalidReportDefinitionError) {
      throw new HttpsError("invalid-argument", err.message);
    }
    if (err instanceof UnknownReportObjectError) {
      throw new HttpsError("failed-precondition", err.message);
    }
    // Truncation honesty (census X-9): an aggregate whose scan was cut
    // is REFUSED, never returned as a partial figure. "resource-
    // exhausted" is the honest code -- the request was well-formed and
    // authorized; the engine's own scan bound is what it exceeded. The
    // message is actionable (narrow the report, or drop the aggregates)
    // and carries no row data.
    if (err instanceof IncompleteAggregateScanError) {
      throw new HttpsError("resource-exhausted", err.message);
    }
    // RPT-FIX -- the same census X-9 / FIN-004 reasoning applied to an ABSENCE.
    // A zero-row result out of a truncated scan is not a proven "no results";
    // matching rows may lie beyond the page. It is REFUSED rather than returned
    // as kind "empty", and it maps to the SAME code as the aggregate refusal for
    // the same reason: the request was well-formed and authorized, and the
    // engine's own scan bound is what it exceeded. Deliberately NOT the default
    // "internal" branch, which the client maps to "unavailable -- nothing was
    // read", a statement that would be false here (documents WERE read).
    if (err instanceof UnprovenAbsenceError) {
      throw new HttpsError("resource-exhausted", err.message);
    }
    throw new HttpsError("internal", "The report could not run.");
  }
});
