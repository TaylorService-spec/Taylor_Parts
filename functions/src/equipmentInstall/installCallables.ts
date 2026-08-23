// EQUIPMENT INSTALL — the thin onCall adapter, and deliberately nothing more.
//
// ============================ WHY THIS ADDS NO AUTHORITY ============================
//
// Every rule that matters already lives in installSerializedAssetCommand: capability enforcement,
// request validation, the account/location consistency check Rules enforce on the client path,
// idempotency through a derived Equipment id, and the single transaction that makes "Equipment
// created" and "asset linked" one fact rather than two. This file authenticates a caller, hands the
// request to that command, and translates its refusals into HTTPS codes.
//
// A callable that re-implemented any of it would be a second answer to a question one authority
// already owns -- and the second answer is the one that would drift.
//
// ============================ THE RULES BOUNDARY IS UNCHANGED ============================
//
// `equipment` is client-writable only under the Rules that require accountId/locationId on create
// and forbid changing them afterwards; `serialized_assets` is deny-all to every client. So the LINK
// between them cannot be written from a browser at all, which is exactly why this callable exists.
// It is a trusted writer, and it is the only path that can put a unit into a customer's hands.
//
// EXPORT != DEPLOY, and `equipment.install` is registered active:false. This denies for every
// principal in every environment that has not activated it AND granted a Role that carries it --
// both, never either.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import {
  installSerializedAsset,
  InstallCommandError,
  EQUIPMENT_INSTALL_CAPABILITY,
  type InstallFailureCode,
} from "./installSerializedAssetCommand.js";
import { makeResolveInstallPermissionThroughTxn, stageInstallAuditEvent } from "./installCallableWiring.js";

const REGION = { region: "us-central1" } as const;

// Resolved THROUGH the transaction, not alongside it. A capability checked outside the transaction
// can be revoked between the check and the write, and this command's write is irreversible --
// Equipment accountId and locationId are immutable after create. The in-transaction read makes a
// concurrent revocation conflict the commit instead of losing the race silently.
const authorizeThroughTxn = makeResolveInstallPermissionThroughTxn(EQUIPMENT_INSTALL_CAPABILITY);

/**
 * How each refusal reaches the caller.
 *
 * Mapped explicitly rather than by defaulting, because these codes are the difference between a
 * message a user can act on and one they cannot. ALREADY_INSTALLED in particular is not an error to
 * bury: the client uses it to show the truthful state and offer the Equipment that already exists,
 * rather than letting somebody try again and again on a unit that is already at a customer.
 */
const FAILURE: Readonly<Record<InstallFailureCode, { status: "permission-denied" | "invalid-argument" | "failed-precondition" | "not-found" | "internal"; message: string }>> = Object.freeze({
  PERMISSION_DENIED: { status: "permission-denied", message: "You are not authorized to install equipment at a customer." },
  ASSET_NOT_FOUND: { status: "not-found", message: "That serialized unit no longer exists." },
  ASSET_MALFORMED: { status: "failed-precondition", message: "That unit's record cannot be read, so it cannot be installed." },
  ALREADY_INSTALLED: { status: "failed-precondition", message: "That unit is already installed at a customer." },
  STATE_NOT_INSTALLABLE: { status: "failed-precondition", message: "That unit is not in a state that can be installed." },
  ACCOUNT_NOT_FOUND: { status: "not-found", message: "That customer could not be found." },
  LOCATION_NOT_FOUND: { status: "not-found", message: "That location could not be found." },
  LOCATION_NOT_OF_ACCOUNT: { status: "invalid-argument", message: "That location does not belong to the selected customer." },
  REQUEST_INVALID: { status: "invalid-argument", message: "That installation request is not valid." },
  IDEMPOTENCY_CONFLICT: { status: "failed-precondition", message: "A different installation was already recorded under this request." },
  INSTALL_INTEGRITY: { status: "internal", message: "The installation could not be completed." },
});

export const installSerializedAssetCallable = onCall(REGION, async (request) => {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Must be signed in.");
  const db = getFirestore();
  try {
    return await installSerializedAsset(request.data, {
      db,
      // The ACTOR IS THE AUTHENTICATED SESSION, never a field in the payload. A client-supplied
      // installer id would let anyone attribute an installation to somebody else -- and this is the
      // record of who placed a machine at a customer.
      actor: { kind: "USER", id: request.auth.uid },
      authorize: (txn, actorId) => authorizeThroughTxn(txn, db, actorId),
      stageAudit: stageInstallAuditEvent,
      now: () => new Date(),
    });
  } catch (err) {
    if (err instanceof InstallCommandError) {
      const mapped = FAILURE[err.code];
      // The CODE travels in the details field so the client can branch on it -- specifically so an
      // already-installed unit can be shown as the state it is rather than as a failure.
      throw new HttpsError(mapped.status, mapped.message, err.code);
    }
    console.error("[equipmentInstall] install failed", err);
    throw new HttpsError("internal", "The request could not be completed.", "INTERNAL");
  }
});
