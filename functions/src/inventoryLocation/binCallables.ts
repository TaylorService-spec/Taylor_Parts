// DESCRIPTIVE BIN REGISTRY — thin onCall adapters. Same pattern as partAliasCallables.ts: derive
// actorUid ONLY from request.auth.uid, forward request.data into the service, and map thrown service
// errors to HttpsError. ALL real logic — capability enforcement, validation, duplicate prevention,
// single-transaction — lives inside the command service. These adapters add NO authority.
//
// ============================ TWO CAPABILITIES, TWO AUDIENCES ============================
//
// `inventory.location.bin.manage` writes racking. `inventory.location.bin.read` checks that a
// scanned bin is real.
//
// They are separate because the audiences are: an operator putting stock away needs to know a bin
// exists, and giving them that check must not also let them create and retire racking. That is the
// same split Phase G drew between alias lookup and alias administration, for the same reason — and
// the mistake it avoids is the one the catalog exists to prevent, broadening a write capability to
// serve a read.
//
// Both are registered active:false and granted to no Role, so both deny for every principal until
// activation and grant are separately authorized. EXPORT != DEPLOY.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import type { Transaction } from "firebase-admin/firestore";
import { recordPutAway, PlacementInvalidError, PlacementUnauthorizedError, PlacementBinError } from "./putAwayCommand.js";
import {
  createBin,
  renameBin,
  setBinStatus,
  resolveBinCode,
  resolveBinToken,
  listBinsForWarehouse,
  BinInvalidError,
  BinUnauthorizedError,
  BinNotFoundError,
  BinIdempotencyConflictError,
  BinCodeReservedError,
  BinClaimIntegrityError,
  BinMalformedStoredRecordError,
  BIN_MANAGE_CAPABILITY,
  BIN_READ_CAPABILITY,
} from "./binCommands.js";
import { resolveEffectiveAccess } from "../access/effectiveAccessFeed.js";
import { previewBinCreates, BinPreviewInvalidError } from "./binPreviewService.js";

const REGION = { region: "us-central1" } as const;

function requireAuth(request: { auth?: { uid: string } | null }): string {
  if (!request.auth || typeof request.auth.uid !== "string" || request.auth.uid.length === 0) {
    throw new HttpsError("unauthenticated", "Must be signed in.");
  }
  return request.auth.uid;
}

/** A THROWING resolver is a denial, never an allow. */
async function allows(uid: string, capability: string): Promise<boolean> {
  try {
    const { decisions } = await resolveEffectiveAccess({ principalUid: uid, permissionIds: [capability] });
    return decisions[capability] === true;
  } catch (err) {
    console.error(`[bins] capability resolution failed for ${capability}`, err);
    return false;
  }
}

async function requireBinRead(uid: string): Promise<void> {
  if (!(await allows(uid, BIN_READ_CAPABILITY))) {
    throw new HttpsError("permission-denied", "You are not authorized to look up bins.", "DENIED");
  }
}

/** The write commands resolve their own capability inside their transaction; this is the wiring. */
const authorizeThroughTxn = (_txn: Transaction, actorId: string, capability: string) => allows(actorId, capability);

function mapError(err: unknown): HttpsError {
  if (err instanceof BinUnauthorizedError) {
    return new HttpsError("permission-denied", "You are not authorized to manage bins.", "DENIED");
  }
  if (err instanceof BinInvalidError) {
    return new HttpsError("invalid-argument", "That bin could not be accepted.", err.message || "INVALID");
  }
  if (err instanceof BinNotFoundError) {
    return new HttpsError("not-found", "That bin was not found.", "NOT_FOUND");
  }
  // Each of these is a DIFFERENT physical fix, so none collapses into another. Telling an operator
  // "that bin could not be accepted" when the real answer is "that code belongs to another rack"
  // sends them to change the wrong thing. None of them echoes a stored value.
  if (err instanceof BinIdempotencyConflictError) {
    return new HttpsError("already-exists", "That request id was already used for a different bin.", "IDEMPOTENCY_CONFLICT");
  }
  if (err instanceof BinCodeReservedError) {
    return new HttpsError("already-exists", "That bin code is already reserved in this warehouse.", "CODE_RESERVED");
  }
  if (err instanceof BinClaimIntegrityError) {
    // Deliberately NOT invalid-argument: the caller's request was fine, the stored reservation is
    // not. Nothing was repaired, and an operator retrying will not fix it either.
    return new HttpsError("failed-precondition", "That bin's code reservation could not be verified.", "CLAIM_INTEGRITY");
  }
  if (err instanceof BinMalformedStoredRecordError) {
    console.error("[bins] malformed stored record", err);
    return new HttpsError("failed-precondition", "That bin record could not be read.", "MALFORMED_STORED_RECORD");
  }
  console.error("[bins] command failed", err);
  return new HttpsError("internal", "The request could not be completed.", "INTERNAL");
}

const productionDeps = (actorUid: string) => ({
  db: getFirestore(),
  actor: { kind: "USER" as const, id: actorUid },
  authorize: authorizeThroughTxn,
  now: () => new Date(),
});

export const createBinCallable = onCall(REGION, async (request) => {
  const actorUid = requireAuth(request);
  try {
    return await createBin(request.data, productionDeps(actorUid));
  } catch (err) {
    throw mapError(err);
  }
});

/**
 * Correct a mislabelled or renumbered rack.
 *
 * Gated on `inventory.location.bin.manage` — the SAME capability as create and retire, because this
 * is maintaining the physical bin registry, which is exactly what that capability describes and what
 * `inventoryBinAdministrator` already carries. Registering a new capability merely because a
 * function name is new would add a rollout step without adding a boundary.
 */
export const renameBinCallable = onCall(REGION, async (request) => {
  const actorUid = requireAuth(request);
  try {
    return await renameBin(request.data, productionDeps(actorUid));
  } catch (err) {
    throw mapError(err);
  }
});

export const deactivateBinCallable = onCall(REGION, async (request) => {
  const actorUid = requireAuth(request);
  try {
    return await setBinStatus(request.data, "INACTIVE", productionDeps(actorUid));
  } catch (err) {
    throw mapError(err);
  }
});

export const reactivateBinCallable = onCall(REGION, async (request) => {
  const actorUid = requireAuth(request);
  try {
    return await setBinStatus(request.data, "ACTIVE", productionDeps(actorUid));
  } catch (err) {
    throw mapError(err);
  }
});

/**
 * Resolve one scanned bin. READ-ONLY, and gated on the READ capability.
 *
 * Returns the resolver's own vocabulary unchanged — FOUND / INACTIVE / WRONG_WAREHOUSE / NOT_FOUND /
 * MALFORMED — because each calls for a different physical fix and collapsing any pair would send an
 * operator to the wrong shelf, or to the wrong building.
 */
export const resolveBinCallable = onCall(REGION, async (request) => {
  const actorUid = requireAuth(request);
  await requireBinRead(actorUid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const warehouseId = typeof data.warehouseId === "string" ? data.warehouseId : "";
  if (warehouseId === "") throw new HttpsError("invalid-argument", "A warehouseId is required.");
  try {
    return await resolveBinCode(getFirestore(), data.code, warehouseId);
  } catch (err) {
    throw mapError(err);
  }
});

/**
 * Resolve a scanned MACHINE TOKEN — the stable binId — against the operator's warehouse.
 *
 * This is the governed lookup the shared scan boundary deliberately does not perform.
 * `resolveScannedIdentity` is pure: it matches only candidates its caller already read. This
 * callable PRODUCES the canonical `{ type: "BIN", locationId }` candidate; the pure matcher never
 * fetches it. That is why there is no client-direct `bins` read and no cross-warehouse preload.
 *
 * `WRONG_WAREHOUSE` is answerable here, and only here, because the token identifies one bin globally.
 */
export const resolveBinTokenCallable = onCall(REGION, async (request) => {
  const actorUid = requireAuth(request);
  await requireBinRead(actorUid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const warehouseId = typeof data.warehouseId === "string" ? data.warehouseId : "";
  if (warehouseId === "") throw new HttpsError("invalid-argument", "A warehouseId is required.");
  try {
    return await resolveBinToken(getFirestore(), data.token ?? data.binId, warehouseId);
  } catch (err) {
    throw mapError(err);
  }
});

/**
 * Classify what createBin WOULD do with a batch of proposed bins. READ-ONLY.
 *
 * Gated on `inventory.location.bin.read` -- the SAME capability as resolving a scanned bin and
 * listing a warehouse's racking. Asking the registry what it says about a PROPOSED location is
 * the same audience as asking what it says about a scanned one, and it confers nothing about
 * creating anything.
 *
 * It writes nothing. BIN-P3 Administration needs it because the client cannot honestly classify
 * ALREADY_EXISTS or CODE_RESERVED on its own: listBins reads `bins` only and returns no
 * idempotencyKey, and `bin_code_claims` is deny-all to every client and stays that way.
 */
export const previewBinCreatesCallable = onCall(REGION, async (request) => {
  const actorUid = requireAuth(request);
  await requireBinRead(actorUid);
  try {
    return await previewBinCreates(getFirestore(), request.data);
  } catch (err) {
    if (err instanceof BinPreviewInvalidError) {
      throw new HttpsError("invalid-argument", "That preview request could not be accepted.", err.message || "INVALID");
    }
    throw mapError(err);
  }
});

export const listBinsCallable = onCall(REGION, async (request) => {
  const actorUid = requireAuth(request);
  await requireBinRead(actorUid);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const warehouseId = typeof data.warehouseId === "string" ? data.warehouseId : "";
  if (warehouseId === "") throw new HttpsError("invalid-argument", "A warehouseId is required.");
  try {
    return await listBinsForWarehouse(getFirestore(), warehouseId);
  } catch (err) {
    throw mapError(err);
  }
});

/**
 * PUT-AWAY. Record where stock was stowed.
 *
 * Gated on `inventory.placement.record` -- its own capability, because stowing is a third audience
 * again: not labelling racking, not merely checking a bin is real, and emphatically not receiving.
 *
 * The command writes a placement record and NOTHING else -- no ledger event, no quantity change, no
 * balance -- which is the DECISIONS #116 invariant that keeps stowed stock in warehouse on-hand.
 */
export const recordPutAwayCallable = onCall(REGION, async (request) => {
  const actorUid = requireAuth(request);
  try {
    return await recordPutAway(request.data, productionDeps(actorUid));
  } catch (err) {
    if (err instanceof PlacementUnauthorizedError) {
      throw new HttpsError("permission-denied", "You are not authorized to put stock away.", "DENIED");
    }
    if (err instanceof PlacementBinError) {
      // The bin's own vocabulary is preserved: INACTIVE, WRONG_WAREHOUSE and NOT_FOUND are three
      // different physical problems, and collapsing them would send an operator to the wrong shelf
      // or to the wrong building.
      throw new HttpsError("failed-precondition", "That bin cannot be used.", err.resolution);
    }
    if (err instanceof PlacementInvalidError) {
      throw new HttpsError("invalid-argument", "That put-away could not be accepted.", err.message || "INVALID");
    }
    throw mapError(err);
  }
});
