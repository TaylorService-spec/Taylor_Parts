// Sales Opportunity — governed WRITE callables (Cycle 3). Thin onCall adapters over the PURE command core
// (opportunityCommands.ts) + lifecycle authority (opportunityLifecycle.ts). They supply ONLY I/O + auth:
//
//   • actor identity comes from request.auth.uid (never trusted from the payload);
//   • authorization is the governed capability `opportunity.write`, resolved fail-closed through the trusted
//     effective-access feed — NOT a role/UI/device check. The capability is registered active:false in the
//     permission catalog, so it is a hard DENY for every principal until a SEPARATE Owner grant;
//   • writes go to the `opportunities` collection via the Admin SDK; firestore.rules denies ALL direct client
//     access to that collection (Admin-SDK-only), so the trusted command is the only write path.
//
// EXPORT != DEPLOY, REGISTER != GRANT. These are exported for build/test only; nothing runs in production
// until a separate deploy + capability grant, each its own Owner-authorized action. Opportunity is
// PRE-COMMITMENT: these commands never create inventory movement, Work Orders, or invoices.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue, type Firestore, type Transaction } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import { resolveEffectiveAccess } from "../access/effectiveAccessFeed";
import { auditEventDocRef, stageAuditEventWithId } from "../access/auditEventWriter";
import { OPPORTUNITIES_COLLECTION } from "../constants/collections";
import {
  buildCreateOpportunity,
  buildTransitionPatch,
  OpportunityCommandError,
  type CreateOpportunityInput,
  type OpportunityDocState, type BuiltOpportunity,
} from "./opportunityCommands";
import { isOutcome, isStage, type TransitionIntent } from "./opportunityLifecycle";

export const OPPORTUNITY_WRITE_CAPABILITY = "opportunity.write";

const createAuditId = (actorUid: string, key: string): string =>
  `createOpportunity_${createHash("sha256").update(`${actorUid}|${key}`).digest("hex").slice(0, 40)}`;

// Map the pure command's error code onto the right HttpsError. Bad payloads are invalid-argument; governed
// precondition failures (already closed / illegal transition / outcome gate) are failed-precondition.
function mapCommandError(err: unknown): HttpsError {
  if (err instanceof HttpsError) return err;
  if (err instanceof OpportunityCommandError) {
    switch (err.code) {
      case "ALREADY_CLOSED":
      case "ILLEGAL_TRANSITION":
      case "OUTCOME_REQUIRES_DECISION":
        return new HttpsError("failed-precondition", err.message);
      default:
        return new HttpsError("invalid-argument", err.message);
    }
  }
  return new HttpsError("internal", "Opportunity command failed.");
}

export async function persistCreatedOpportunity(
  db: Firestore, tx: Transaction, built: BuiltOpportunity, actorUid: string, idempotencyKey?: string,
) {
  const aid = idempotencyKey ? createAuditId(actorUid, idempotencyKey) : null;
  const { createdAtMillis: _c, updatedAtMillis: _u, ...fields } = built;
  if (aid) {
    const prior = await tx.get(auditEventDocRef(aid));
    if (prior.exists) return { success: true as const, replayed: true as const, opportunityId: ((prior.data() ?? {}).targetId as string) ?? null, stage: built.stage };
  }
  const ref = db.collection(OPPORTUNITIES_COLLECTION).doc();
  tx.set(ref, { ...fields, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  if (aid) stageAuditEventWithId(tx, aid, { actorUid, action: "createOpportunity", targetType: "opportunity", targetId: ref.id, outcome: "applied", summary: `created opportunity for account ${built.accountId}` });
  return { success: true as const, replayed: false as const, opportunityId: ref.id, stage: built.stage };
}

async function requireOpportunityWrite(uid: string): Promise<void> {
  let allowed = false;
  try {
    const { decisions } = await resolveEffectiveAccess({
      principalUid: uid,
      permissionIds: [OPPORTUNITY_WRITE_CAPABILITY],
    });
    allowed = decisions[OPPORTUNITY_WRITE_CAPABILITY] === true;
  } catch {
    allowed = false; // a throwing resolver is a denial, never an allow
  }
  if (!allowed) throw new HttpsError("permission-denied", "You are not authorized to write Opportunities.");
}

// Create a new Opportunity (always starts IDENTIFIED, open). Product-level lines only; a serialized-asset
// line is rejected by the pure builder.
export const createOpportunity = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
  await requireOpportunityWrite(request.auth.uid);

  const data = (request.data ?? {}) as CreateOpportunityInput & { idempotencyKey?: string };
  if (data.idempotencyKey !== undefined && (typeof data.idempotencyKey !== "string" || data.idempotencyKey.trim().length === 0)) {
    throw new HttpsError("invalid-argument", "idempotencyKey, when provided, must be a non-empty string.");
  }
  let built;
  try {
    built = buildCreateOpportunity(data, {
      actorUid: request.auth.uid,
      nowMillis: Date.now(),
    });
  } catch (err) {
    throw mapCommandError(err);
  }

  const db = getFirestore();
  return db.runTransaction((tx) => persistCreatedOpportunity(db, tx, built, request.auth!.uid, data.idempotencyKey));
});

interface TransitionOpportunityInput {
  opportunityId: string;
  toStage?: string;
  outcome?: string;
}

// Advance an Opportunity one stage, or set its outcome (WON from DECISION, LOST from any open stage). Legality
// is enforced by the pure transition authority; illegal transitions fail closed.
export const transitionOpportunity = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
  await requireOpportunityWrite(request.auth.uid);

  const data = (request.data ?? {}) as TransitionOpportunityInput;
  if (typeof data.opportunityId !== "string" || data.opportunityId.trim().length === 0) {
    throw new HttpsError("invalid-argument", "opportunityId is required.");
  }
  // Exactly one intent: advance to a stage, OR set an outcome.
  const hasStage = data.toStage !== undefined;
  const hasOutcome = data.outcome !== undefined;
  if (hasStage === hasOutcome) {
    throw new HttpsError("invalid-argument", "Provide exactly one of toStage or outcome.");
  }
  let intent: TransitionIntent;
  if (hasStage) {
    if (!isStage(data.toStage)) throw new HttpsError("invalid-argument", "toStage is not a valid stage.");
    intent = { kind: "ADVANCE", toStage: data.toStage };
  } else {
    if (!isOutcome(data.outcome)) throw new HttpsError("invalid-argument", "outcome must be WON or LOST.");
    intent = { kind: "OUTCOME", outcome: data.outcome };
  }

  const db = getFirestore();
  const ref = db.collection(OPPORTUNITIES_COLLECTION).doc(data.opportunityId);
  try {
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new HttpsError("not-found", `No Opportunity with id ${data.opportunityId}`);
      const current = snap.data() as OpportunityDocState;
      const patch = buildTransitionPatch(current, intent, { actorUid: request.auth!.uid, nowMillis: Date.now() });
      const { updatedAtMillis: _u, closedAtMillis, ...rest } = patch;
      tx.update(ref, {
        ...rest,
        ...(closedAtMillis != null ? { closedAt: FieldValue.serverTimestamp() } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { stage: patch.stage, outcome: patch.outcome };
    });
    return { success: true as const, opportunityId: data.opportunityId, ...result };
  } catch (err) {
    throw mapCommandError(err);
  }
});
