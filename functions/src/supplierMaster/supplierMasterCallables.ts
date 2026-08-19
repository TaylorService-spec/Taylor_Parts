// Supplier Master -- thin onCall adapters for the merged trusted write service
// (supplierMasterCommands.ts). Same pattern as truckRegistryCallables.ts / accessCommandCallables.ts:
// derive actorUid ONLY from request.auth.uid (NEVER request.data), pass request.data into the service,
// and map thrown service errors to HttpsError via a sanitized, generic-per-type taxonomy. ALL real
// logic -- capability enforcement, idempotency, versioning, audit, single-transaction -- lives inside
// the command service; these adapters add NO write authority and are deliberately thin so both stay
// independently testable.
//
// Exported from functions/src/index.ts and deployed to eos-platform-sandbox under the per-environment
// activation program; NOT deployed to the production project. As wired here there is NO App Check
// requirement (matching every other callable in this repo),
// and NO capability is granted -- authorization is enforced INSIDE the command against the actor's
// real governed roles (inventory.catalog.manage for create/update, inventory.catalog.activate for
// activate/deactivate). NOTE (production gap, see docs/releases/supplier-master-rc-1.md): no STANDING
// role currently carries inventory.catalog.activate, so activate/deactivate fail closed
// (permission-denied) until a role is defined + granted that capability -- a deferred protected step.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  createSupplier,
  updateSupplier,
  activateSupplier,
  deactivateSupplier,
} from "./supplierMasterCommands.js";
import {
  InvalidInputError,
  UnauthorizedActorError,
  NotFoundError,
  AlreadyExistsError,
  VersionConflictError,
  IdempotencyConflictError,
  InvalidStatusTransitionError,
} from "../partMaster/partMasterCommands.js";
import { MalformedStoredRecordError } from "../partMaster/partMasterRepository.js";
import { SUPPLIER_OPTIONAL_STRING_FIELDS } from "./supplierMasterTypes.js";

// Sanitized error -> HttpsError. The service's messages may embed internal ids/versions; each error
// TYPE surfaces a GENERIC message so no internal state (existence, current version) leaks past the
// trust boundary. The stable `code` is what a client acts on. An unexpected error collapses to
// "internal".
export function mapError(err: unknown): HttpsError {
  if (err instanceof InvalidInputError) return new HttpsError("invalid-argument", "The request is missing or has invalid fields.");
  if (err instanceof UnauthorizedActorError) return new HttpsError("permission-denied", "You are not authorized to perform this action.");
  if (err instanceof NotFoundError) return new HttpsError("not-found", "No supplier exists at that id.");
  if (err instanceof AlreadyExistsError) return new HttpsError("already-exists", "A supplier already exists at that id.");
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

// Copy only the recognized optional string fields that are actually PRESENT, so the command's
// "validated-if-present" semantics hold (passing an explicit undefined would fail validation).
function pickOptionalStrings(d: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of SUPPLIER_OPTIONAL_STRING_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(d, f)) out[f] = d[f];
  }
  return out;
}

const REGION = { region: "us-central1" } as const;

export const createSupplierCallable = onCall(REGION, async (request) => {
  const actorUid = requireAuth(request);
  const d = asObject(request.data);
  try {
    return await createSupplier({
      actorUid,
      idempotencyKey: d.idempotencyKey as string,
      supplierId: d.supplierId as string,
      name: d.name as string,
      ...pickOptionalStrings(d),
    });
  } catch (err) {
    throw mapError(err);
  }
});

export const updateSupplierCallable = onCall(REGION, async (request) => {
  const actorUid = requireAuth(request);
  const d = asObject(request.data);
  try {
    return await updateSupplier({
      actorUid,
      idempotencyKey: d.idempotencyKey as string,
      supplierId: d.supplierId as string,
      expectedVersion: d.expectedVersion as number,
      changes: (d.changes ?? {}) as Record<string, unknown>,
    });
  } catch (err) {
    throw mapError(err);
  }
});

export const activateSupplierCallable = onCall(REGION, async (request) => {
  const actorUid = requireAuth(request);
  const d = asObject(request.data);
  try {
    return await activateSupplier({
      actorUid,
      idempotencyKey: d.idempotencyKey as string,
      supplierId: d.supplierId as string,
      expectedVersion: d.expectedVersion as number,
    });
  } catch (err) {
    throw mapError(err);
  }
});

export const deactivateSupplierCallable = onCall(REGION, async (request) => {
  const actorUid = requireAuth(request);
  const d = asObject(request.data);
  try {
    return await deactivateSupplier({
      actorUid,
      idempotencyKey: d.idempotencyKey as string,
      supplierId: d.supplierId as string,
      expectedVersion: d.expectedVersion as number,
    });
  } catch (err) {
    throw mapError(err);
  }
});
