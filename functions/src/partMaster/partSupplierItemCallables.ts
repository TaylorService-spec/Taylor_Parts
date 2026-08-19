// Part↔Supplier procurement terms (part_supplier_items) -- thin onCall adapters for the existing trusted
// write service (partSupplierItems.ts). Same pattern as manufacturerCallables/partMasterCallables/
// supplierMasterCallables: derive actorUid ONLY from request.auth.uid (NEVER request.data), pass
// request.data into the service, map thrown service errors to HttpsError via a sanitized generic-per-type
// taxonomy. ALL real logic -- capability enforcement, validation, idempotency, versioning, audit,
// single-transaction, and the atomic ≤1-ACTIVE-preferred invariant -- lives INSIDE the command service;
// these adapters add NO write authority and no parallel validator/status vocabulary.
//
// Exported from functions/src/index.ts and deployed to eos-platform-sandbox under the per-environment
// activation program; NOT deployed to the production project. NO capability
// granted, NO App Check. Authorization enforced INSIDE the command against real governed roles --
// inventory.catalog.manage for create/update/setPreferred, inventory.catalog.activate for status change
// (the SAME catalog authority Part/Supplier/Manufacturer use; the future inventoryCatalogAdministrator
// role). Catalog capabilities are carried by no standing role, so all four fail closed until a deferred
// protected grant. The part_supplier_items READ stays governed by projections gated on R-1's
// inventory.catalog.read / inventory.catalog.cost.read (see the design + R-1 requirement docs) -- these
// are WRITE callables only.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  createPartSupplierItem,
  updatePartSupplierItem,
  changePartSupplierItemStatus,
  setPreferredSupplier,
  TERM_KEYS as TERM_KEYS_SET,
} from "./partSupplierItems.js";
import {
  InvalidInputError,
  UnauthorizedActorError,
  NotFoundError,
  AlreadyExistsError,
  VersionConflictError,
  IdempotencyConflictError,
  InvalidStatusTransitionError,
} from "./partMasterCommands.js";
import { MalformedStoredRecordError } from "./partMasterRepository.js";

// Recognized procurement-term fields -- imported from the command (single source of truth; no drift).
// Forwarded as-is; the command owns validation. Cost is among these -- WRITE authority is
// inventory.catalog.manage; cost READ exposure is a SEPARATE concern (inventory.catalog.cost.read
// projection, partSupplierItemProjections.ts), not decided by this adapter.
const TERM_KEYS = [...TERM_KEYS_SET];

// Sanitized error -> HttpsError: each error TYPE surfaces a GENERIC message so no internal state
// (existence, current version) leaks past the trust boundary; the stable `code` is what a client acts on.
// Unexpected errors collapse to "internal".
export function mapError(err: unknown): HttpsError {
  if (err instanceof InvalidInputError) return new HttpsError("invalid-argument", "The request is missing or has invalid fields.");
  if (err instanceof UnauthorizedActorError) return new HttpsError("permission-denied", "You are not authorized to perform this action.");
  if (err instanceof NotFoundError) return new HttpsError("not-found", "The referenced part or part-supplier item could not be found.");
  if (err instanceof AlreadyExistsError) return new HttpsError("already-exists", "A part-supplier item already exists for that part and supplier.");
  if (err instanceof VersionConflictError) return new HttpsError("aborted", "The record changed since you loaded it. Reload and retry.");
  if (err instanceof IdempotencyConflictError) return new HttpsError("aborted", "That idempotency key was already used for a different request.");
  if (err instanceof InvalidStatusTransitionError) return new HttpsError("failed-precondition", "That change isn't allowed for this item's current state.");
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
// Copy the recognized term fields that are actually PRESENT (validated-if-present semantics preserved).
function pickTerms(d: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of TERM_KEYS) if (Object.prototype.hasOwnProperty.call(d, k)) out[k] = d[k];
  return out;
}

const REGION = { region: "us-central1" } as const;

export const createPartSupplierItemCallable = onCall(REGION, async (request) => {
  const actorUid = requireAuth(request);
  const d = asObject(request.data);
  try {
    return await createPartSupplierItem({ actorUid, idempotencyKey: d.idempotencyKey as string, partId: d.partId as string, supplierId: d.supplierId as string, ...pickTerms(d) });
  } catch (err) {
    throw mapError(err);
  }
});

export const updatePartSupplierItemCallable = onCall(REGION, async (request) => {
  const actorUid = requireAuth(request);
  const d = asObject(request.data);
  try {
    // `changes` is already scoped to term fields by the request shape (unlike create's flat top-level
    // terms, which pickTerms allowlists), so it is forwarded directly; the command validates it.
    return await updatePartSupplierItem({ actorUid, idempotencyKey: d.idempotencyKey as string, itemId: d.itemId as string, expectedVersion: d.expectedVersion as number, changes: (d.changes ?? {}) as Record<string, unknown> });
  } catch (err) {
    throw mapError(err);
  }
});

export const changePartSupplierItemStatusCallable = onCall(REGION, async (request) => {
  const actorUid = requireAuth(request);
  const d = asObject(request.data);
  try {
    return await changePartSupplierItemStatus({ actorUid, idempotencyKey: d.idempotencyKey as string, itemId: d.itemId as string, expectedVersion: d.expectedVersion as number, newStatus: d.newStatus as string });
  } catch (err) {
    throw mapError(err);
  }
});

export const setPreferredSupplierCallable = onCall(REGION, async (request) => {
  const actorUid = requireAuth(request);
  const d = asObject(request.data);
  try {
    return await setPreferredSupplier({ actorUid, idempotencyKey: d.idempotencyKey as string, partId: d.partId as string, supplierId: d.supplierId as string, expectedVersion: d.expectedVersion as number });
  } catch (err) {
    throw mapError(err);
  }
});
