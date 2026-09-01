// NON-PO SERIALIZED ASSET ACQUISITION — the thin onCall adapter, and deliberately nothing more.
//
// ============================ WHY THIS ADDS NO AUTHORITY ============================
//
// Every rule that matters already lives in `acquireSerializedAssetCommand`: capability enforcement
// read THROUGH the transaction, request validation with a closed reason set, the SERIAL-only Part
// check, the governed active-warehouse check, the derived identity that makes `create` the duplicate
// check, replay-versus-conflict, and the audit event. This file authenticates a caller, hands the
// request to that command, and translates its refusals into HTTPS codes.
//
// A callable that re-implemented any of it would be a second answer to a question one authority
// already owns — and the second answer is the one that would drift. There is deliberately NO
// validation here.
//
// ============================ WHY IT EXISTS AT ALL ============================
//
// `serialized_assets` is deny-all to every client, so an acquisition cannot be written from a
// browser. It is a trusted write, and until this file there was no path to it: the command and its
// production seams were both built and nothing exposed them. A documentation claim that the callable
// was "wired" was wrong — `acquireCallableWiring.ts` holds the dependency seams, not a callable —
// and ND-33 records that correction rather than quietly closing the gap.
//
// ============================ WHAT THIS COMMAND IS ============================
//
// HIGH TRUST, and narrow by construction: it creates company-owned inventory with NO procurement
// record. Every acquisition must name a reason from a closed set in which "we bought it" does not
// appear, because a unit that was bought has a purchase order and belongs in Receiving. The acquired
// unit starts AVAILABLE with `acquisitionProvenance: NON_PO_ACQUISITION` and no
// `activatedByReceivingId`, so no report that asks "what did we receive?" can ever answer with one.
//
// EXPORT != DEPLOY. `inventory.serializedAsset.acquire` is registered `active: false` in the
// catalog; a principal reaches this command only where the capability is BOTH activated for the
// environment AND carried by a Role they hold — both, never either.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import {
  acquireSerializedAsset,
  AcquireCommandError,
  SERIALIZED_ASSET_ACQUIRE_CAPABILITY,
  type AcquireFailureCode,
} from "./acquireSerializedAssetCommand.js";
import {
  makeResolveAcquirePermissionThroughTxn,
  resolveAcquirePartThroughTxn,
  makeResolveAcquireLocationActive,
  stageAcquireAuditEvent,
} from "./acquireCallableWiring.js";

const REGION = { region: "us-central1" } as const;

// Resolved THROUGH the transaction, not alongside it. A capability checked outside the transaction
// can be revoked between the check and the write, and this write creates owned inventory — the
// in-transaction read makes a concurrent revocation conflict the commit instead of losing the race.
const authorizeThroughTxn = makeResolveAcquirePermissionThroughTxn(SERIALIZED_ASSET_ACQUIRE_CAPABILITY);

/**
 * How each refusal reaches the caller.
 *
 * Mapped explicitly rather than by defaulting, because these codes are the difference between a
 * message a person can act on and one they cannot. Two matter most:
 *
 *   PART_NOT_SERIALIZED      the Part is real and the wrong KIND — a quantity part has no
 *                            individually identified units to acquire. "Not found" would send
 *                            somebody hunting for a Part that is sitting right there.
 *   ALREADY_EXISTS_CONFLICT  the unit exists under different intent, OR it arrived by RECEIPT and
 *                            acquisition must not overwrite purchasing history. Distinct from a
 *                            replay, which is a success.
 */
const FAILURE: Readonly<Record<AcquireFailureCode, {
  status: "permission-denied" | "invalid-argument" | "failed-precondition" | "not-found" | "internal";
  message: string;
}>> = Object.freeze({
  PERMISSION_DENIED: {
    status: "permission-denied",
    message: "You are not authorized to bring existing units into company inventory.",
  },
  REQUEST_INVALID: {
    status: "invalid-argument",
    message: "That acquisition request is not valid.",
  },
  PART_NOT_FOUND: {
    status: "not-found",
    message: "That part could not be found, or is not active.",
  },
  PART_NOT_SERIALIZED: {
    status: "failed-precondition",
    message: "That part is not serial-tracked, so it has no individual units to acquire.",
  },
  LOCATION_INVALID: {
    status: "invalid-argument",
    message: "That is not an active company location.",
  },
  ALREADY_EXISTS_CONFLICT: {
    status: "failed-precondition",
    message: "A unit with that serial already exists for this part, recorded differently.",
  },
  ACQUIRE_INTEGRITY: {
    status: "internal",
    message: "The acquisition could not be completed.",
  },
});

export const acquireSerializedAssetCallable = onCall(REGION, async (request) => {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Must be signed in.");
  const db = getFirestore();
  const resolveLocationActive = makeResolveAcquireLocationActive(db);
  try {
    return await acquireSerializedAsset(request.data, {
      db,
      // THE ACTOR IS THE AUTHENTICATED SESSION, never a field in the payload. `actorId` is not an
      // accepted request key — the command's ALLOWED_KEYS set would refuse it — and it is not read
      // from `request.data` here either. This is the record of who asserted the company owns a
      // machine with no supplier document to check it against.
      actor: { kind: "USER", id: request.auth.uid },
      // The capability is bound by the factory above, so it is not re-passed here — the command
      // supplies it as a third argument and the resolver already knows which one it is checking.
      // Two sources for one capability id is how a callable comes to check a different permission
      // from the command it fronts.
      authorize: (txn, actorId) => authorizeThroughTxn(txn, db, actorId),
      resolvePart: (txn, partId) => resolveAcquirePartThroughTxn(txn, db, partId),
      resolveLocationActive,
      stageAudit: stageAcquireAuditEvent,
      now: () => new Date(),
    });
  } catch (err) {
    if (err instanceof AcquireCommandError) {
      const mapped = FAILURE[err.code];
      // FAIL CLOSED ON AN UNMAPPED CODE. A future failure code with no entry here would otherwise
      // reach `mapped.status` as undefined and throw a TypeError inside the catch — reported to the
      // caller as an unhandled internal error with no message they could act on.
      if (!mapped) {
        console.error("[serializedAsset] unmapped acquire failure code", err.code);
        throw new HttpsError("internal", "The request could not be completed.", "INTERNAL");
      }
      // The CODE travels in the details field so the client can branch on it — specifically so a
      // conflict can be shown as the state it is rather than as a generic failure.
      throw new HttpsError(mapped.status, mapped.message, err.code);
    }
    console.error("[serializedAsset] acquire failed", err);
    throw new HttpsError("internal", "The request could not be completed.", "INTERNAL");
  }
});
