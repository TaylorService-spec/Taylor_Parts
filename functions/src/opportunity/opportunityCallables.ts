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
import { allocateOpportunityNumber } from "./opportunityNumbering";
import {
  buildCreateOpportunity,
  buildTransitionPatch,
  buildUpdateOpportunity,
  OpportunityCommandError,
  type CreateOpportunityInput,
  type UpdateOpportunityInput,
  type OpportunityFieldChange,
  type OpportunityDocState, type BuiltOpportunity,
} from "./opportunityCommands";
import { isOutcome, isStage, type TransitionIntent } from "./opportunityLifecycle";
import { deriveAccountOwner } from "../ownership/typedOwner";

export const OPPORTUNITY_WRITE_CAPABILITY = "opportunity.write";

// Declared locally, matching opportunityReadService.ts's own local const. Three modules already
// define this same string independently -- consolidating them into constants/collections.ts is a
// worthwhile tidy but it is not this change's business, so this one follows the local precedent
// rather than adding a fourth spelling.
const ACCOUNTS_COLLECTION = "accounts";

// Shared deterministic Audit Event id builder (same shape as coverageCallables.ts's mkAuditId): a retried
// call with the same actorUid + idempotencyKey resolves to the SAME Audit Event document id, so the
// transactional existence check below is the single source of truth for "was this exact call already applied."
const mkAuditId = (action: string, actorUid: string, key: string): string =>
  `${action}_${createHash("sha256").update(`${actorUid}|${key}`).digest("hex").slice(0, 40)}`;

// Map the pure command's error code onto the right HttpsError. Bad payloads are invalid-argument; governed
// precondition failures (already closed / illegal transition / outcome gate) are failed-precondition.
function mapCommandError(err: unknown): HttpsError {
  if (err instanceof HttpsError) return err;
  if (err instanceof OpportunityCommandError) {
    // THE DOMAIN CODE TRAVELS IN `details`, and it has to.
    //
    // There are more distinct outcomes here than there are HttpsError codes to carry them, so
    // without this every one of VERSION_CONFLICT, CLOSED, NO_CHANGES, OWNER_REQUIRED and
    // CHANNEL_INVALID reached the client as bare "invalid-argument" and was rendered as one
    // generic "that request was invalid" -- which is actively wrong for the first three. A
    // version conflict is not an invalid request; telling someone their edit was malformed when
    // the truth is that a colleague saved first sends them looking for a mistake they did not
    // make. `details` is the supported channel for exactly this, so the client can say the
    // true thing instead of the nearest available one.
    const detail = err.code;
    switch (err.code) {
      case "ALREADY_CLOSED":
      case "ILLEGAL_TRANSITION":
      case "OUTCOME_REQUIRES_DECISION":
      case "NO_LINES":
      case "LINE_QTY_REQUIRED_FOR_WON":
      // A closed Opportunity is a historical record, not a malformed request.
      case "CLOSED":
      // Nothing changed. Not a failure of the request -- a statement about it.
      case "NO_CHANGES":
        return new HttpsError("failed-precondition", err.message, detail);
      // Concurrency, not validity. `aborted` is the established code for "someone else got
      // there first, retry against the new state" and is what lets the client offer a reload-
      // and-reapply instead of a dead end.
      case "VERSION_CONFLICT":
        return new HttpsError("aborted", err.message, detail);
      default:
        return new HttpsError("invalid-argument", err.message, detail);
    }
  }
  return new HttpsError("internal", "Opportunity command failed.");
}

export async function persistCreatedOpportunity(
  db: Firestore, tx: Transaction, built: BuiltOpportunity, actorUid: string, idempotencyKey?: string,
) {
  const aid = idempotencyKey ? mkAuditId("createOpportunity", actorUid, idempotencyKey) : null;
  const { createdAtMillis: _c, updatedAtMillis: _version, ...fields } = built;
  if (aid) {
    const prior = await tx.get(auditEventDocRef(aid));
    if (prior.exists) return { success: true as const, replayed: true as const, opportunityId: ((prior.data() ?? {}).targetId as string) ?? null, stage: built.stage };
  }
  const ref = db.collection(OPPORTUNITIES_COLLECTION).doc();

  // HUMAN IDENTITY. Allocated inside the caller's transaction, alongside the document
  // write, so a reference is never issued without its Opportunity appearing and an
  // Opportunity never appears without one. Same contract as WO numbering, which owns the
  // identical problem.
  //
  // Immutable by construction: it is set here at creation and no transition path writes
  // it. That is the whole point of a reference — a value that changes is a label, not an
  // identifier, and the lineage links on Sales Order detail depend on it not moving.
  const { opportunityNumber } = await allocateOpportunityNumber(tx, new Date().getUTCFullYear());

  tx.set(ref, {
    ...fields,
    opportunityNumber,
    // A VERSION FROM BIRTH. updatedAtMillis is the optimistic-concurrency token
    // updateOpportunity compares against, and it was previously stripped here -- so a
    // newly created Opportunity had no version until its FIRST edit wrote one. The command
    // treats a missing version as 0, which means two people editing a never-yet-edited
    // Opportunity both read 0, both pass the check, and the second silently overwrites the
    // first. Writing the version at creation closes that window at the only moment it was
    // ever open. Records created before this keep the 0 fallback and stay editable.
    //
    // createdAtMillis stays stripped: createdAt (serverTimestamp) is the authority on WHEN,
    // and a second creation time would be a second answer to a question already answered.
    // This field is a VERSION, not a time -- which is why only this one is kept.
    updatedAtMillis: _version,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  if (aid) stageAuditEventWithId(tx, aid, { actorUid, action: "createOpportunity", targetType: "opportunity", targetId: ref.id, outcome: "applied", summary: `created opportunity for account ${built.accountId}` });
  return { success: true as const, replayed: false as const, opportunityId: ref.id, stage: built.stage };
}

// Transactional core of transitionOpportunity, exported so tests can exercise the idempotency invariant
// directly (below the capability gate — opportunity.write is registered active:false, a hard deny for
// everyone until a separate Owner grant), exactly the pattern persistCreatedOpportunity already established.
export async function persistTransitionedOpportunity(
  db: Firestore, tx: Transaction, ref: FirebaseFirestore.DocumentReference,
  opportunityId: string, intent: TransitionIntent, actorUid: string, idempotencyKey: string,
) {
  // TARGET-SCOPED IDEMPOTENCY, with the legacy id still honoured.
  //
  // THE DEFECT. mkAuditId hashes actorUid|key with NO target. One actor reusing an
  // idempotency key across two DIFFERENT Opportunities therefore collides: the second call
  // finds the first call's audit event, returns "replayed", and SKIPS EVERY VALIDATION
  // without applying anything. The caller is told it succeeded.
  //
  // THE FIX. Compose the id with the opportunityId so each record has its own replay space --
  // the shape createSalesOrderFromOpportunity and updateOpportunity already use.
  //
  // BACKWARD COMPATIBILITY, EXPLICITLY. Changing the derivation orphans every id already
  // written: a genuine retry of an in-flight pre-change call would hash to a NEW id, find
  // nothing, and RE-APPLY -- turning a safety mechanism into a double-apply during the
  // rollout window. So the legacy id is still read. If either exists, this is a replay.
  // Only the NEW id is ever written, so the legacy lookup ages out on its own and no
  // existing audit record becomes unsafe or unreachable.
  const aid = mkAuditId("transitionOpportunity", actorUid, `${opportunityId}|${idempotencyKey}`);
  const legacyAid = mkAuditId("transitionOpportunity", actorUid, idempotencyKey);
  const prior = await tx.get(auditEventDocRef(aid));
  const legacyPrior = aid === legacyAid ? prior : await tx.get(auditEventDocRef(legacyAid));
  const snap = await tx.get(ref);
  if (!snap.exists) throw new HttpsError("not-found", `No Opportunity with id ${opportunityId}`);
  const current = snap.data() as OpportunityDocState;
  if (prior.exists || legacyPrior.exists) {
    return { success: true as const, replayed: true as const, opportunityId, stage: current.stage, outcome: current.outcome };
  }
  const patch = buildTransitionPatch(current, intent, { actorUid, nowMillis: Date.now() });
  const { updatedAtMillis: _u, closedAtMillis, ...rest } = patch;
  tx.update(ref, {
    ...rest,
    ...(closedAtMillis != null ? { closedAt: FieldValue.serverTimestamp() } : {}),
    updatedAt: FieldValue.serverTimestamp(),
  });
  stageAuditEventWithId(tx, aid, {
    actorUid,
    action: "transitionOpportunity",
    targetType: "opportunity",
    targetId: opportunityId,
    outcome: "applied",
    summary: `transitioned opportunity ${opportunityId} to stage ${patch.stage}`,
  });
  return { success: true as const, replayed: false as const, opportunityId, stage: patch.stage, outcome: patch.outcome };
}

async function requireOpportunityWrite(uid: string): Promise<void> {
  let allowed = false;
  try {
    const { decisions } = await resolveEffectiveAccess({
      principalUid: uid,
      permissionIds: [OPPORTUNITY_WRITE_CAPABILITY],
    });
    allowed = decisions[OPPORTUNITY_WRITE_CAPABILITY] === true;
  } catch (err) {
    console.error(`[requireOpportunityWrite] capability resolution failed for ${OPPORTUNITY_WRITE_CAPABILITY}`, err);
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
  const db = getFirestore();
  const actorUid = request.auth.uid;
  // Computed ONCE, outside the transaction. A transaction callback can run more than once on
  // contention, and re-reading the clock there would give the retry a different createdAt than the
  // attempt it replaced.
  const nowMillis = Date.now();

  // EOS Ownership Model v1, ruling D-4: the build moved INSIDE the transaction so the Account owner
  // it may inherit is read under the same lock as the write that consumes it -- an owner read
  // outside the transaction could be handed off by someone else before this Opportunity commits,
  // and the new record would be born owned by the previous owner.
  try {
    return await db.runTransaction(async (tx) => {
      const explicitOwner = typeof data.ownerEmployeeId === "string" && data.ownerEmployeeId.trim().length > 0;
      const accountId = typeof data.accountId === "string" ? data.accountId.trim() : "";
      // Only read the Account when inheritance is actually in play. An existing caller that supplies
      // an owner performs exactly the reads it always did -- the relaxation costs it nothing.
      let inheritedOwner = null;
      if (!explicitOwner && accountId.length > 0) {
        const accountSnap = await tx.get(db.collection(ACCOUNTS_COLLECTION).doc(accountId));
        inheritedOwner = deriveAccountOwner(accountSnap.exists ? accountSnap.data()! : null);
      }
      const built = buildCreateOpportunity({ ...data, inheritedOwner }, { actorUid, nowMillis });
      return persistCreatedOpportunity(db, tx, built, actorUid, data.idempotencyKey);
    });
  } catch (err) {
    throw mapCommandError(err);
  }
});

interface TransitionOpportunityInput {
  opportunityId: string;
  toStage?: string;
  outcome?: string;
  idempotencyKey?: string;
}

// Advance an Opportunity one stage, or set its outcome (WON from DECISION, LOST from any open stage). Legality
// is enforced by the pure transition authority; illegal transitions fail closed.
//
// Idempotency (site-work r3 item G): a retried ADVANCE/OUTCOME call — client timeout retry, double-tap — must
// never apply twice. Mirrors createOpportunity's guard precisely: a REQUIRED idempotencyKey resolves to a
// deterministic Audit Event id (mkAuditId), staged atomically with the state mutation in the SAME transaction.
// A duplicate call finds that Audit Event already exists and returns `replayed:true` with the Opportunity's
// CURRENT stage/outcome instead of recomputing and reapplying the transition.
export const transitionOpportunity = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
  await requireOpportunityWrite(request.auth.uid);

  const data = (request.data ?? {}) as TransitionOpportunityInput;
  if (typeof data.opportunityId !== "string" || data.opportunityId.trim().length === 0) {
    throw new HttpsError("invalid-argument", "opportunityId is required.");
  }
  if (typeof data.idempotencyKey !== "string" || data.idempotencyKey.trim().length === 0) {
    throw new HttpsError("invalid-argument", "idempotencyKey is required.");
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

  const actorUid = request.auth.uid;
  const db = getFirestore();
  const ref = db.collection(OPPORTUNITIES_COLLECTION).doc(data.opportunityId);
  try {
    return await db.runTransaction((tx) =>
      persistTransitionedOpportunity(db, tx, ref, data.opportunityId, intent, actorUid, data.idempotencyKey!),
    );
  } catch (err) {
    throw mapCommandError(err);
  }
});

// ============================ ORDINARY EDIT ============================
//
// The third write path. Before it, every Edit control in the Opportunity workspace was
// disabled with "the governed save command is not wired in this build" -- accurate, and
// understated: no such command existed, so an Opportunity could be created and advanced but
// never corrected.
//
// Transactional core, exported for the same reason the other two are: tests exercise the
// idempotency and concurrency invariants directly, below the capability gate.
export async function persistUpdatedOpportunity(
  db: Firestore, tx: Transaction, ref: FirebaseFirestore.DocumentReference,
  input: UpdateOpportunityInput, actorUid: string, idempotencyKey: string,
) {
  // SCOPED TO THE OPPORTUNITY, not just actor+key. mkAuditId hashes only actorUid|key, so an
  // actor reusing one idempotency key across two DIFFERENT Opportunities would collide and the
  // second edit would return a false "replayed" -- skipping every validation and silently not
  // applying. Found by test: three assertions failed because earlier tests in the same file had
  // already burned the key. Composing the id with the opportunityId gives this action a
  // per-record replay space, which is what createSalesOrderFromOpportunity already does.
  //
  // NOTE, deliberately not fixed here: transitionOpportunity and createOpportunity call the
  // same helper without a target in the key and have the same latent collision. That is a
  // pre-existing idempotency space with keys already in use, so narrowing it is a behaviour
  // change of its own rather than a rider on this one. Recorded in the execution backlog.
  const aid = mkAuditId("updateOpportunity", actorUid, `${input.opportunityId}|${idempotencyKey}`);
  // Reads first, both of them, before any write -- Firestore's rule, and the same shape the
  // transition core uses.
  const prior = await tx.get(auditEventDocRef(aid));
  const snap = await tx.get(ref);
  if (!snap.exists) throw new HttpsError("not-found", `No Opportunity with id ${input.opportunityId}`);
  if (prior.exists) {
    // A replay returns the prior outcome untouched rather than re-validating against a
    // document that may have moved on since.
    return { success: true as const, replayed: true as const, opportunityId: input.opportunityId, changed: [] as string[] };
  }
  const current = snap.data() as Record<string, unknown>;

  const { patch, changes } = buildUpdateOpportunity(
    current as never,
    input,
    { actorUid, nowMillis: Date.now() },
  );

  // updatedAtMillis is the optimistic-concurrency token the NEXT caller will send back, so it
  // is written as a plain number the client can echo. updatedAt stays a server timestamp for
  // ordering. Both, deliberately: one is a version, the other is a time.
  tx.update(ref, { ...patch, updatedAt: FieldValue.serverTimestamp() });

  stageAuditEventWithId(tx, aid, {
    actorUid,
    action: "updateOpportunity",
    targetType: "opportunity",
    targetId: input.opportunityId,
    outcome: "applied",
    // CHANGED FIELD NAMES ONLY, and that is a contract limit rather than a choice.
    // RecordAuditEventInput has no metadata/detail field, so BEFORE/AFTER VALUES CANNOT BE
    // RECORDED without altering the governed audit schema -- which is not this change to
    // make. Names are recorded here (fully supported); the values remain recoverable from the
    // document history. Stated rather than silently dropped, since the ask was explicitly
    // "before/after values where policy permits" and the policy currently does not.
    summary: `updated opportunity ${input.opportunityId}: ${changes.map((c: OpportunityFieldChange) => c.field).join(", ")}`,
  });

  return {
    success: true as const,
    replayed: false as const,
    opportunityId: input.opportunityId,
    changed: changes.map((c: OpportunityFieldChange) => c.field),
  };
}

// Ordinary edit of an Opportunity's deal fields. Lifecycle is NOT reachable from here --
// buildUpdateOpportunity never reads stage or outcome from the input, so no payload can move
// an Opportunity through its lifecycle by this route.
export const updateOpportunity = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
  await requireOpportunityWrite(request.auth.uid);

  const data = (request.data ?? {}) as Record<string, unknown>;
  if (typeof data.opportunityId !== "string" || data.opportunityId.trim().length === 0) {
    throw new HttpsError("invalid-argument", "opportunityId is required.");
  }
  if (typeof data.idempotencyKey !== "string" || data.idempotencyKey.trim().length === 0) {
    throw new HttpsError("invalid-argument", "idempotencyKey is required.");
  }
  if (typeof data.expectedUpdatedAtMillis !== "number" || !Number.isFinite(data.expectedUpdatedAtMillis)) {
    throw new HttpsError("invalid-argument", "expectedUpdatedAtMillis is required.");
  }

  // FIELDS ARE COPIED INDIVIDUALLY, NEVER SPREAD. `request.data` is attacker-controlled, and
  // spreading it would let any key reach the command core -- including one the core does not
  // read today but might tomorrow. Only these seven can arrive, and each is copied ONLY when
  // present, so "absent" and "explicit null" stay distinguishable all the way down.
  const input: UpdateOpportunityInput = {
    opportunityId: data.opportunityId.trim(),
    expectedUpdatedAtMillis: data.expectedUpdatedAtMillis,
  };
  if (data.accountId !== undefined) input.accountId = String(data.accountId);
  if (data.ownerEmployeeId !== undefined) input.ownerEmployeeId = String(data.ownerEmployeeId);
  if (data.salesChannel !== undefined) input.salesChannel = data.salesChannel as never;
  if (data.need !== undefined) input.need = data.need === null ? null : String(data.need);
  if (data.expectedValue !== undefined) input.expectedValue = data.expectedValue as number | null;
  if (data.expectedCloseAt !== undefined) input.expectedCloseAt = data.expectedCloseAt as number | null;
  if (data.lines !== undefined) input.lines = data.lines as never;

  const db = getFirestore();
  const ref = db.collection(OPPORTUNITIES_COLLECTION).doc(input.opportunityId);
  try {
    return await db.runTransaction((tx) =>
      persistUpdatedOpportunity(db, tx, ref, input, request.auth!.uid, (data.idempotencyKey as string).trim()),
    );
  } catch (err) {
    throw mapCommandError(err);
  }
});
