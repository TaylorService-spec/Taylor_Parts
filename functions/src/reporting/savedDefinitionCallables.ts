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
import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  createSavedDefinition,
  getSavedDefinition,
  listSavedDefinitions,
  renameSavedDefinition,
  duplicateSavedDefinition,
  deleteSavedDefinition,
  InvalidReportDefinitionError,
  InvalidInputError,
  UnauthorizedActorError,
  NotFoundError,
  NotOwnerError,
} from "./savedDefinitionCommands";

function mapError(err: unknown): HttpsError {
  if (err instanceof InvalidReportDefinitionError || err instanceof InvalidInputError) {
    return new HttpsError("invalid-argument", err.message);
  }
  if (err instanceof UnauthorizedActorError) {
    return new HttpsError("permission-denied", err.message);
  }
  // NotFoundError and NotOwnerError are deliberately mapped to the SAME
  // "not-found" code -- a caller must never be able to distinguish
  // "this id doesn't exist" from "this id exists but isn't yours" from
  // the HttpsError alone (see savedDefinitionCommands.ts's own
  // requireOwnershipOrAudit comment on this same principle).
  if (err instanceof NotFoundError || err instanceof NotOwnerError) {
    return new HttpsError("not-found", "No saved definition exists at that id.");
  }
  return new HttpsError("internal", "The request could not be completed.");
}

function requireAuth(request: { auth?: { uid: string } | null }): string {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be signed in.");
  }
  return request.auth.uid;
}

export const createSavedDefinitionCallable = onCall({ region: "us-central1" }, async (request) => {
  const actorUid = requireAuth(request);
  const data = request.data as { name?: unknown; definition?: unknown } | null;
  if (!data || typeof data !== "object") {
    throw new HttpsError("invalid-argument", "Request data must be an object.");
  }
  try {
    return await createSavedDefinition({ actorUid, name: data.name as string, definition: data.definition });
  } catch (err) {
    throw mapError(err);
  }
});

export const getSavedDefinitionCallable = onCall({ region: "us-central1" }, async (request) => {
  const actorUid = requireAuth(request);
  const data = request.data as { definitionId?: unknown } | null;
  if (!data || typeof data.definitionId !== "string") {
    throw new HttpsError("invalid-argument", "definitionId must be a string.");
  }
  try {
    return await getSavedDefinition({ actorUid, definitionId: data.definitionId });
  } catch (err) {
    throw mapError(err);
  }
});

export const listSavedDefinitionsCallable = onCall({ region: "us-central1" }, async (request) => {
  const actorUid = requireAuth(request);
  try {
    return await listSavedDefinitions({ actorUid });
  } catch (err) {
    throw mapError(err);
  }
});

export const renameSavedDefinitionCallable = onCall({ region: "us-central1" }, async (request) => {
  const actorUid = requireAuth(request);
  const data = request.data as { definitionId?: unknown; name?: unknown } | null;
  if (!data || typeof data.definitionId !== "string") {
    throw new HttpsError("invalid-argument", "definitionId must be a string.");
  }
  try {
    return await renameSavedDefinition({ actorUid, definitionId: data.definitionId, name: data.name as string });
  } catch (err) {
    throw mapError(err);
  }
});

export const duplicateSavedDefinitionCallable = onCall({ region: "us-central1" }, async (request) => {
  const actorUid = requireAuth(request);
  const data = request.data as { definitionId?: unknown; name?: unknown } | null;
  if (!data || typeof data.definitionId !== "string") {
    throw new HttpsError("invalid-argument", "definitionId must be a string.");
  }
  if (data.name !== undefined && typeof data.name !== "string") {
    throw new HttpsError("invalid-argument", "name must be a string when present.");
  }
  try {
    return await duplicateSavedDefinition({
      actorUid,
      definitionId: data.definitionId,
      name: data.name as string | undefined,
    });
  } catch (err) {
    throw mapError(err);
  }
});

export const deleteSavedDefinitionCallable = onCall({ region: "us-central1" }, async (request) => {
  const actorUid = requireAuth(request);
  const data = request.data as { definitionId?: unknown } | null;
  if (!data || typeof data.definitionId !== "string") {
    throw new HttpsError("invalid-argument", "definitionId must be a string.");
  }
  try {
    await deleteSavedDefinition({ actorUid, definitionId: data.definitionId });
    return { deleted: true };
  } catch (err) {
    throw mapError(err);
  }
});
