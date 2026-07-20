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
// action. It is not deployed, and no client calls it, until a separate,
// later Owner production authorization.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  resolveEffectiveAccess,
  InvalidInputError,
  MalformedAccessDataError,
} from "./effectiveAccessFeed";

export const resolveEffectiveAccessCallable = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be signed in.");
  }

  const data = request.data as { permissionIds?: unknown } | null;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new HttpsError("invalid-argument", "Request data must be an object.");
  }
  const extraKeys = Object.keys(data).filter((k) => k !== "permissionIds");
  if (extraKeys.length > 0) {
    // Fail closed on any unrecognized key -- this callable's accepted
    // shape is deliberately narrow (permissionIds only); an extra key
    // (e.g. a client attempting to pass "role"/"principalUid"/"scope"/
    // "companyId") is refused outright rather than silently ignored,
    // so a caller can never be confused into believing such a field had
    // any effect.
    throw new HttpsError(
      "invalid-argument",
      `Unrecognized field(s): ${extraKeys.join(", ")}. Only permissionIds is accepted.`,
    );
  }

  try {
    return await resolveEffectiveAccess({
      principalUid: request.auth.uid,
      permissionIds: (data.permissionIds ?? []) as unknown[],
    });
  } catch (err) {
    if (err instanceof InvalidInputError) {
      throw new HttpsError("invalid-argument", err.message);
    }
    if (err instanceof MalformedAccessDataError) {
      // Internal data-shape detail -- never forward the message (it
      // names an internal Firestore field), only a safe, generic reason.
      throw new HttpsError("failed-precondition", "Your access record could not be evaluated. Try again shortly.");
    }
    throw new HttpsError("unavailable", "Access could not be evaluated right now. Try again shortly.");
  }
});
