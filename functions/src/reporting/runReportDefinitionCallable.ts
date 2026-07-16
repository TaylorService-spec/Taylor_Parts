// Issue #325 / ADR-007 D-FN -- thin onCall adapter for
// reportExecutionService.ts's runReportDefinition(), same pattern as
// access/accessCommandCallables.ts's thin wrappers around
// trustedWriterCommands.ts: auth check, map the caller's uid + request
// data into the service call, map thrown errors to HttpsError codes.
// All the real logic lives in the service; this file is deliberately
// thin so both stay independently testable.
//
// NOT WIRED to any client -- field-ops-app-vite/src/domain/reporting/
// reportExecutionSeam.js (the client's gated run seam) is UNCHANGED by
// this PR and still unconditionally resolves to the "unavailable"
// outcome. Exporting this callable from functions/src/index.ts (same
// file, next commit) is not itself a deployment or activation action --
// same posture access/accessCommandCallables.ts's own header already
// documents for Row 7's six commands ("export is not deployment").
import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  runReportDefinition,
  InvalidReportDefinitionError,
  UnknownReportObjectError,
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
    throw new HttpsError("internal", "The report could not run.");
  }
});
