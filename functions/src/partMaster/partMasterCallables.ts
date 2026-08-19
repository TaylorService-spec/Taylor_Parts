// Part Master -- thin onCall adapters for the existing trusted write service (partMasterCommands.ts).
// Same pattern as supplierMasterCallables.ts / truckRegistryCallables.ts: derive actorUid ONLY from
// request.auth.uid (NEVER request.data), pass request.data into the service, and map thrown service
// errors to HttpsError via a sanitized, generic-per-type taxonomy. ALL real logic -- capability
// enforcement, validation, idempotency, versioning, audit, single-transaction -- lives INSIDE the
// command service; these adapters add NO write authority and are deliberately thin so both stay
// independently testable. There is ONE Part authority (partMasterCommands) -- this is not a second one.
//
// Exported from functions/src/index.ts and deployed to eos-platform-sandbox under the per-environment
// activation program; NOT deployed to the production project, and NOT capability-granted. NO App Check
// requirement (matching every other callable here). Authorization is enforced
// INSIDE the command against the actor's real governed roles: inventory.catalog.manage for
// create/update, inventory.catalog.activate for status change (the accepted catalog authority, carried
// by the future durable inventoryCatalogAdministrator role). NO capability is granted here; catalog
// capabilities are carried by no standing role today, so every real user fails closed until a
// separate, protected grant (see docs/releases/part-master-write-rc.md when authored).
import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  createPart,
  updatePart,
  changePartStatus,
  InvalidInputError,
  UnauthorizedActorError,
  NotFoundError,
  AlreadyExistsError,
  VersionConflictError,
  IdempotencyConflictError,
  InvalidStatusTransitionError,
  type UpdatePartInput,
} from "./partMasterCommands.js";
import type { PartInput } from "./validation.js";
import { MalformedStoredRecordError } from "./partMasterRepository.js";

// Sanitized error -> HttpsError. The service's messages may embed internal ids/versions; each error
// TYPE surfaces a GENERIC message so no internal state (existence, current version) leaks past the
// trust boundary. The stable `code` is what a client acts on. An unexpected error collapses to
// "internal".
export function mapError(err: unknown): HttpsError {
  if (err instanceof InvalidInputError) return new HttpsError("invalid-argument", "The request is missing or has invalid fields.");
  if (err instanceof UnauthorizedActorError) return new HttpsError("permission-denied", "You are not authorized to perform this action.");
  if (err instanceof NotFoundError) return new HttpsError("not-found", "No part exists at that id.");
  if (err instanceof AlreadyExistsError) return new HttpsError("already-exists", "A part already exists at that id.");
  if (err instanceof VersionConflictError) return new HttpsError("aborted", "The record changed since you loaded it. Reload and retry.");
  if (err instanceof IdempotencyConflictError) return new HttpsError("aborted", "That idempotency key was already used for a different request.");
  if (err instanceof InvalidStatusTransitionError) return new HttpsError("failed-precondition", "That status change is not allowed.");
  // Named explicitly for readers tracing a malformed stored record, though it maps to the same
  // generic "internal" response as the catch-all below (a stored-shape problem is never surfaced).
  if (err instanceof MalformedStoredRecordError) return new HttpsError("internal", "The request could not be completed.");
  return new HttpsError("internal", "The request could not be completed.");
}

function requireAuth(request: { auth?: { uid: string } | null }): string {
  if (!request.auth || typeof request.auth.uid !== "string" || request.auth.uid.length === 0) {
    throw new HttpsError("unauthenticated", "Must be signed in.");
  }
  return request.auth.uid;
}

function asObject(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new HttpsError("invalid-argument", "Request data must be an object.");
  }
  return data as Record<string, unknown>;
}

const REGION = { region: "us-central1" } as const;

export const createPartCallable = onCall(REGION, async (request) => {
  const actorUid = requireAuth(request);
  const d = asObject(request.data);
  try {
    // The command's validatePart owns full field validation of `part`; the adapter forwards it as-is.
    // PartInput's fields are all `unknown` (it is the untyped-input boundary type), so this cast is honest.
    return await createPart({ actorUid, idempotencyKey: d.idempotencyKey as string, part: d.part as PartInput });
  } catch (err) {
    throw mapError(err);
  }
});

export const updatePartCallable = onCall(REGION, async (request) => {
  const actorUid = requireAuth(request);
  const d = asObject(request.data);
  try {
    // Forward `changes` as-is: the command owns the updatable-field allowlist + re-validation (the
    // adapter must not reimplement it), same deferral as createPart's `part`.
    return await updatePart({
      actorUid,
      idempotencyKey: d.idempotencyKey as string,
      partId: d.partId as string,
      expectedVersion: d.expectedVersion as number,
      changes: (d.changes ?? {}) as UpdatePartInput["changes"],
    });
  } catch (err) {
    throw mapError(err);
  }
});

export const changePartStatusCallable = onCall(REGION, async (request) => {
  const actorUid = requireAuth(request);
  const d = asObject(request.data);
  try {
    return await changePartStatus({
      actorUid,
      idempotencyKey: d.idempotencyKey as string,
      partId: d.partId as string,
      expectedVersion: d.expectedVersion as number,
      newStatus: d.newStatus as string,
    });
  } catch (err) {
    throw mapError(err);
  }
});
