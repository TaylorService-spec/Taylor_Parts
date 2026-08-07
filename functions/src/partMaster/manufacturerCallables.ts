// Manufacturer (catalog reference object) -- thin onCall adapters for the existing trusted write service
// (partMasterCommands.ts createManufacturer/updateManufacturer/changeManufacturerStatus). Same pattern as
// partMasterCallables.ts / supplierMasterCallables.ts: derive actorUid ONLY from request.auth.uid (NEVER
// request.data), pass request.data into the service, and map thrown service errors to HttpsError via a
// sanitized, generic-per-type taxonomy. ALL real logic -- capability enforcement, validation, idempotency,
// versioning, audit, single-transaction -- lives INSIDE the command service; these adapters add NO write
// authority. There is ONE Manufacturer authority (partMasterCommands) -- this is not a second one, and no
// second model / parallel validator / parallel status vocabulary is introduced.
//
// "Export is not deployment/grant": exporting these from functions/src/index.ts does NOT deploy or grant
// them. NO App Check requirement (matching every other callable here). Authorization is enforced INSIDE the
// command against the actor's real governed roles -- inventory.catalog.manage for create/update,
// inventory.catalog.activate for status change (the SAME catalog authority Part/Supplier use; the accepted
// future inventoryCatalogAdministrator role). NO capability is granted here; catalog capabilities are carried
// by no standing role, so create/update/status fail closed until a deferred protected grant.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  createManufacturer,
  updateManufacturer,
  changeManufacturerStatus,
  InvalidInputError,
  UnauthorizedActorError,
  NotFoundError,
  AlreadyExistsError,
  VersionConflictError,
  IdempotencyConflictError,
  InvalidStatusTransitionError,
} from "./partMasterCommands.js";
import { MalformedStoredRecordError } from "./partMasterRepository.js";

// Sanitized error -> HttpsError. Each error TYPE surfaces a GENERIC message so no internal state
// (existence, current version) leaks past the trust boundary; the stable `code` is what a client acts on.
// Unexpected errors collapse to "internal".
export function mapError(err: unknown): HttpsError {
  if (err instanceof InvalidInputError) return new HttpsError("invalid-argument", "The request is missing or has invalid fields.");
  if (err instanceof UnauthorizedActorError) return new HttpsError("permission-denied", "You are not authorized to perform this action.");
  if (err instanceof NotFoundError) return new HttpsError("not-found", "No manufacturer exists at that id.");
  if (err instanceof AlreadyExistsError) return new HttpsError("already-exists", "A manufacturer already exists at that id.");
  if (err instanceof VersionConflictError) return new HttpsError("aborted", "The record changed since you loaded it. Reload and retry.");
  if (err instanceof IdempotencyConflictError) return new HttpsError("aborted", "That idempotency key was already used for a different request.");
  if (err instanceof InvalidStatusTransitionError) return new HttpsError("failed-precondition", "That status change is not allowed.");
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

export const createManufacturerCallable = onCall(REGION, async (request) => {
  const actorUid = requireAuth(request);
  const d = asObject(request.data);
  try {
    return await createManufacturer({ actorUid, idempotencyKey: d.idempotencyKey as string, manufacturerId: d.manufacturerId as string, name: d.name as string });
  } catch (err) {
    throw mapError(err);
  }
});

export const updateManufacturerCallable = onCall(REGION, async (request) => {
  const actorUid = requireAuth(request);
  const d = asObject(request.data);
  try {
    return await updateManufacturer({ actorUid, idempotencyKey: d.idempotencyKey as string, manufacturerId: d.manufacturerId as string, expectedVersion: d.expectedVersion as number, name: d.name as string });
  } catch (err) {
    throw mapError(err);
  }
});

export const changeManufacturerStatusCallable = onCall(REGION, async (request) => {
  const actorUid = requireAuth(request);
  const d = asObject(request.data);
  try {
    return await changeManufacturerStatus({ actorUid, idempotencyKey: d.idempotencyKey as string, manufacturerId: d.manufacturerId as string, expectedVersion: d.expectedVersion as number, newStatus: d.newStatus as string });
  } catch (err) {
    throw mapError(err);
  }
});
