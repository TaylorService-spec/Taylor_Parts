// Part identifier administration -- thin onCall adapters for the existing trusted alias service
// (partAliasCommands.ts). Same pattern as partMasterCallables.ts: derive actorUid ONLY from
// request.auth.uid (NEVER request.data), forward request.data into the service, and map thrown
// service errors to HttpsError through a sanitized taxonomy. ALL real logic -- capability
// enforcement, validation, idempotency, versioning, conflict handling, audit, single-transaction --
// lives INSIDE the command service. These adapters add NO authority.
//
// WHY THESE EXIST. partAliasCommands.ts has been written, unit-tested, and unreachable: no onCall
// adapter was ever exported, so no browser could call it, and firestore.rules closes `part_aliases`
// to every principal including admin. The Part Master "Barcodes & Identifiers" section rendered
// UNAVAILABLE and named those exact gaps. This closes the transport gap. It does not open the Rules
// one, and does not need to: a callable runs on the Admin SDK, which Rules do not govern.
//
// ================== NO NEW CAPABILITY ==================
//
// Identifier administration is governed by `inventory.catalog.manage` -- the capability the alias
// commands ALREADY enforce, per the recorded O-gate direction ("reused per O-gate direction, no new
// capability", partAliasCommands.ts header). It is registered ACTIVE and is already granted.
//
// The READ (listPartAliases) and the scan-to-test PROBE are gated on that same capability rather
// than on a read capability, and that is a deliberate decision rather than an oversight:
//
//   - This is an ADMINISTRATION surface. The people who should see a Part's identifier list are the
//     people who administer identifiers; there is no separate audience for it.
//   - Seeing INACTIVE identifiers is load-bearing for the write path. Re-adding a deactivated
//     identifier is rejected as a conflict, and an administrator who cannot see the inactive record
//     cannot understand the refusal. Gating the list more loosely than the write would let someone
//     see conflicts they cannot resolve; gating it more tightly would hide the reason for a refusal
//     they just hit.
//   - `inventory.catalog.read` exists but is scoped to the Manufacturer catalog projection and is
//     registered INERT. Reusing it would be a synonym for something it does not mean.
//
// The alternative -- a dedicated `inventory.catalog.alias.read` -- is recorded here as the option
// NOT taken, so the choice is visible if the audience ever splits.
//
// ================== NOT DEPLOYED, NOT ACTIVATED ==================
//
// Exporting a callable is not deployment, and this slice authorizes neither. The client transport
// additionally fails closed behind PART_IDENTIFIER_TRANSPORT_READY, which is false in every
// environment. Classification: RELEASE CANDIDATE -- NOT USER-OPERABLE.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import {
  createPartAlias,
  deactivatePartAlias,
  reactivatePartAlias,
  resolvePartAlias,
} from "./partAliasCommands.js";
import {
  InvalidInputError,
  UnauthorizedActorError,
  NotFoundError,
  AlreadyExistsError,
  VersionConflictError,
  IdempotencyConflictError,
  CAP_CATALOG_MANAGE,
} from "./partMasterCommands.js";
import { MalformedStoredRecordError } from "./partMasterRepository.js";
import { listPartAliases } from "./partAliasReadService.js";
import { parsePartId } from "./validation.js";
import { resolveEffectiveAccess } from "../access/effectiveAccessFeed.js";
import type { PartId } from "./types.js";

const REGION = { region: "us-central1" } as const;

/**
 * Sanitized error -> HttpsError, with the DOMAIN CODE carried in `details`.
 *
 * There are more distinct outcomes here than there are HttpsError codes to carry them, and three of
 * them need different words in the UI: a version conflict is not a malformed request, an
 * already-owned identifier is not a validation failure, and neither is a permission denial. Without
 * the detail all three arrive as one generic message and the surface has to guess. `details` is the
 * supported channel for exactly this.
 *
 * Messages stay GENERIC PER TYPE -- no internal ids, versions, or existence facts leak past the
 * boundary, matching partMasterCallables.ts's taxonomy.
 */
export function mapError(err: unknown): HttpsError {
  if (err instanceof HttpsError) return err;
  if (err instanceof InvalidInputError) {
    return new HttpsError("invalid-argument", "The request is missing or has invalid fields.", "INVALID");
  }
  if (err instanceof UnauthorizedActorError) {
    return new HttpsError("permission-denied", "You are not authorized to manage part identifiers.", "DENIED");
  }
  if (err instanceof NotFoundError) {
    return new HttpsError("not-found", "That record no longer exists.", "NOT_FOUND");
  }
  if (err instanceof AlreadyExistsError) {
    // The one the surface most needs to distinguish: the identifier is taken. The command
    // distinguishes "inactive on this part" from "owned by another part" in its own message, which
    // is not repeated here -- the client asks the list, which it is authorized to read.
    return new HttpsError("already-exists", "That identifier is already recorded.", "ALIAS_CONFLICT");
  }
  if (err instanceof VersionConflictError) {
    return new HttpsError("aborted", "This identifier changed since it was loaded. Reload and retry.", "VERSION_CONFLICT");
  }
  if (err instanceof IdempotencyConflictError) {
    return new HttpsError("aborted", "That idempotency key was already used for a different request.", "IDEMPOTENCY_CONFLICT");
  }
  if (err instanceof MalformedStoredRecordError) {
    return new HttpsError("internal", "The request could not be completed.", "INTERNAL");
  }
  return new HttpsError("internal", "The request could not be completed.", "INTERNAL");
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

/**
 * Capability gate for the two READ paths.
 *
 * The write commands enforce this themselves (and audit the denial); a read has no command behind
 * it, so the adapter is where it has to happen. A THROWING resolver is a denial, never an allow --
 * the same fail-closed posture requireOpportunityWrite uses.
 */
async function requireCatalogManage(uid: string): Promise<void> {
  let allowed = false;
  try {
    const { decisions } = await resolveEffectiveAccess({
      principalUid: uid,
      permissionIds: [CAP_CATALOG_MANAGE],
    });
    allowed = decisions[CAP_CATALOG_MANAGE] === true;
  } catch (err) {
    console.error(`[requireCatalogManage] capability resolution failed for ${CAP_CATALOG_MANAGE}`, err);
    allowed = false;
  }
  if (!allowed) {
    throw new HttpsError("permission-denied", "You are not authorized to manage part identifiers.", "DENIED");
  }
}

function requirePartId(value: unknown): PartId {
  const parsed = parsePartId(value as string);
  if (!parsed.valid) throw new HttpsError("invalid-argument", "A valid partId is required.", "INVALID");
  return parsed.value;
}

// -------------------------------------------------------------------- writes

export const createPartAliasCallable = onCall(REGION, async (request) => {
  const actorUid = requireAuth(request);
  const d = asObject(request.data);
  try {
    // Every field is forwarded as-is: the command owns alias-type membership, value normalization,
    // manufacturer parsing, and the effective-date ordering rule. Re-checking any of them here
    // would create a second, drifting validator.
    return await createPartAlias({
      actorUid,
      idempotencyKey: d.idempotencyKey as string,
      partId: d.partId as string,
      aliasType: d.aliasType as string,
      rawValue: d.rawValue as string,
      ...(d.source !== undefined ? { source: d.source as string } : {}),
      ...(d.manufacturerId !== undefined ? { manufacturerId: d.manufacturerId as string } : {}),
      ...(d.effectiveFrom !== undefined ? { effectiveFrom: d.effectiveFrom as string } : {}),
      ...(d.effectiveTo !== undefined ? { effectiveTo: d.effectiveTo as string } : {}),
    });
  } catch (err) {
    throw mapError(err);
  }
});

export const deactivatePartAliasCallable = onCall(REGION, async (request) => {
  const actorUid = requireAuth(request);
  const d = asObject(request.data);
  try {
    return await deactivatePartAlias({
      actorUid,
      idempotencyKey: d.idempotencyKey as string,
      aliasId: d.aliasId as string,
      expectedVersion: d.expectedVersion as number,
    });
  } catch (err) {
    throw mapError(err);
  }
});

// Reactivation is exposed because deactivation is not a delete. Without it, an identifier
// deactivated in error is unrecoverable through the UI, and the create path deliberately refuses to
// silently reactivate -- so the ONLY governed way back is this command.
export const reactivatePartAliasCallable = onCall(REGION, async (request) => {
  const actorUid = requireAuth(request);
  const d = asObject(request.data);
  try {
    return await reactivatePartAlias({
      actorUid,
      idempotencyKey: d.idempotencyKey as string,
      aliasId: d.aliasId as string,
      expectedVersion: d.expectedVersion as number,
    });
  } catch (err) {
    throw mapError(err);
  }
});

// -------------------------------------------------------------------- reads

export const listPartAliasesCallable = onCall(REGION, async (request) => {
  const actorUid = requireAuth(request);
  const d = asObject(request.data);
  await requireCatalogManage(actorUid);
  try {
    return await listPartAliases(getFirestore(), requirePartId(d.partId));
  } catch (err) {
    throw mapError(err);
  }
});

/**
 * SCAN-TO-TEST. Resolves a scanned or typed identifier exactly as the scanner would, and reports
 * what the system sees -- without changing anything.
 *
 * It is the one honest way to answer "did I register this correctly?", and it uses the SAME
 * resolver the real scan path uses (resolvePartAlias). A second, test-only matcher would be able to
 * agree with the administrator and disagree with the scanner, which is the whole failure this
 * exists to prevent.
 *
 * Returns the resolver's own outcome vocabulary unchanged: FOUND / INACTIVE / NOT_FOUND /
 * MALFORMED / CONFLICT. INACTIVE is deliberately not collapsed into NOT_FOUND -- "registered but
 * switched off" and "never registered" call for different fixes.
 */
export const probePartAliasCallable = onCall(REGION, async (request) => {
  const actorUid = requireAuth(request);
  const d = asObject(request.data);
  await requireCatalogManage(actorUid);
  try {
    return await resolvePartAlias({
      aliasType: d.aliasType as string,
      rawValue: d.rawValue as string,
      ...(d.manufacturerId !== undefined ? { manufacturerId: d.manufacturerId as string } : {}),
    });
  } catch (err) {
    throw mapError(err);
  }
});
