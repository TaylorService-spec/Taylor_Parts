// RETURNS INTAKE — the thin onCall adapter. All real logic (capability enforcement, validation,
// idempotency, single-transaction) lives inside the command service; this adds NO authority.
//
// `inventory_returns` has no firestore.rules match block, so it is deny-all to every client
// including admin — the established part_aliases / bins posture. No Rules change was needed.
//
// EXPORT != DEPLOY, and `inventory.returns.intake` is registered active:false and granted to no
// Role, so this denies for every principal until activation and grant are separately authorized.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import type { Transaction } from "firebase-admin/firestore";
import {
  recordReturnIntake,
  ReturnInvalidError,
  ReturnUnauthorizedError,
  RETURN_INTAKE_CAPABILITY,
} from "./returnIntakeCommand.js";
import { resolveEffectiveAccess } from "../access/effectiveAccessFeed.js";

const REGION = { region: "us-central1" } as const;

/** A THROWING resolver is a denial, never an allow. */
async function allows(uid: string, capability: string): Promise<boolean> {
  try {
    const { decisions } = await resolveEffectiveAccess({ principalUid: uid, permissionIds: [capability] });
    return decisions[capability] === true;
  } catch (err) {
    console.error(`[returns] capability resolution failed for ${capability}`, err);
    return false;
  }
}

const authorizeThroughTxn = (_txn: Transaction, actorId: string, capability: string) => allows(actorId, capability);

export const recordReturnIntakeCallable = onCall(REGION, async (request) => {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Must be signed in.");
  const actorUid = request.auth.uid;
  try {
    return await recordReturnIntake(request.data, {
      db: getFirestore(),
      actor: { kind: "USER", id: actorUid },
      authorize: authorizeThroughTxn,
      now: () => new Date(),
    });
  } catch (err) {
    if (err instanceof ReturnUnauthorizedError) {
      throw new HttpsError("permission-denied", "You are not authorized to take returns in.", "DENIED");
    }
    if (err instanceof ReturnInvalidError) {
      throw new HttpsError("invalid-argument", "That return could not be accepted.", err.message || "INVALID");
    }
    console.error("[returns] intake failed", err);
    throw new HttpsError("internal", "The request could not be completed.", "INTERNAL");
  }
});
