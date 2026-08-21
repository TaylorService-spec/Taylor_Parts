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
import {
  createBin,
  setBinStatus,
  resolveBinCode,
  listBinsForWarehouse,
  BinInvalidError,
  BinUnauthorizedError,
  BinNotFoundError,
  BIN_MANAGE_CAPABILITY,
  BIN_READ_CAPABILITY,
} from "./binCommands.js";
import { resolveEffectiveAccess } from "../access/effectiveAccessFeed.js";

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
