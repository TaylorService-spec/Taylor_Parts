// Sales Agreement — the governed WRITE path.
//
// GOVERNANCE: Owner Slice 4 §A/§B/§H. D1 shipped the pure commands with ZERO callers, so the
// commercial chain was correct and unreachable: WON → Sales Order now requires an accepted
// Agreement, and nothing but a test fixture could create one.
//
// ════════════════════ WHAT THE SERVER DERIVES, AND WHY ════════════════════
//
// The client sends `opportunityId` and the COMMERCIAL TERMS. It does not send the account.
//
// accountId is read from the Opportunity, never trusted from the payload. It is the one fact that
// decides who is being billed, and a caller who could name it could write an agreement — and then a
// Sales Order, and then an invoice — against a customer they never opened. The agreement-to-order
// conversion already re-checks that the two agree (agreementToSalesOrder.ts); deriving it here
// means the check can never fail for a reason a caller chose.
//
// Also server-owned: actor uid (request.auth), every timestamp, the state, the allocated number,
// and the totals (computed from the lines by the pure command). The client cannot set state,
// acceptedAt, acceptedBy, currency, or salesOrderId through any input on this file.
//
// VALIDATION IS NOT DUPLICATED HERE. Line shape, money integrality, quantity, the serialized-line
// ban, intent vocabulary and the totals all live in salesAgreementCommands.ts and are reached by
// calling it. A second copy in the callable is how the two come to disagree, and the laxer one
// always wins because it is the one on the path that runs.
//
// ════════════════════ IDEMPOTENCY BEFORE ALLOCATION ════════════════════
//
// Create reads the prior audit event FIRST. A retry returns the original agreement and never
// reaches the counter, so a retried create cannot consume a sequence number or produce a second
// agreement for the same Opportunity. Allocating first and de-duplicating after would leave gaps
// that read like deleted agreements.
//
// ONE AGREEMENT PER OPPORTUNITY, enforced in-transaction by the same single-field query the
// conversion uses — so two concurrent creates see a consistent snapshot and Firestore serializes
// the loser.
//
// NO GENERIC UPDATE. There are exactly three write verbs: create, bounded draft edit, accept.
// Nothing here can move identity, and nothing can amend an ACCEPTED agreement.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue, type Firestore, type Transaction } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import { resolveEffectiveAccess } from "../access/effectiveAccessFeed";
import { auditEventDocRef, stageAuditEventWithId } from "../access/auditEventWriter";
import { OPPORTUNITIES_COLLECTION, SALES_AGREEMENTS_COLLECTION } from "../constants/collections";
import {
  buildCreateSalesAgreement,
  buildAcceptSalesAgreement,
  buildUpdateSalesAgreementDraft,
  SalesAgreementCommandError,
  type CreateSalesAgreementInput,
  type UpdateSalesAgreementDraftInput,
  type BuiltAgreementLine,
  type AgreementTotals,
} from "./salesAgreementCommands";
import type { SalesAgreementState } from "./salesAgreementLifecycle";
import { allocateSalesAgreementNumber } from "./salesAgreementNumbering";
import { validateSalesAgreementLineReferences } from "./salesAgreementLineReferences";

export const SALES_AGREEMENT_CREATE_CAPABILITY = "salesAgreement.create";
export const SALES_AGREEMENT_ACCEPT_CAPABILITY = "salesAgreement.accept";
export const SALES_AGREEMENT_UPDATE_DRAFT_CAPABILITY = "salesAgreement.updateDraft";

/** Maps a pure-command failure to the wire. Unknown failures stay generic — never echoed. */
function mapCommandError(err: unknown): HttpsError {
  if (err instanceof HttpsError) return err;
  if (err instanceof SalesAgreementCommandError) return new HttpsError("invalid-argument", err.message);
  console.error("[salesAgreementCallables] unexpected failure", err);
  return new HttpsError("internal", "The Sales Agreement command failed.");
}

/** Fail closed. A throwing resolver is a DENIAL, never an allow. */
async function requireCapability(uid: string, capability: string, humanAction: string): Promise<void> {
  let allowed = false;
  try {
    const { decisions } = await resolveEffectiveAccess({ principalUid: uid, permissionIds: [capability] });
    allowed = decisions[capability] === true;
  } catch (err) {
    console.error(`[salesAgreementCallables] capability resolution failed for ${capability}`, err);
    allowed = false;
  }
  if (!allowed) throw new HttpsError("permission-denied", `You are not authorized to ${humanAction}.`);
}

// ═══════════════════════════════════════════════════════════ CREATE

export interface CreateSalesAgreementCallableInput
  extends Omit<CreateSalesAgreementInput, "accountId" | "sourceOpportunityId"> {
  /** The negotiation this agreement records. The ACCOUNT is derived from it, never sent. */
  opportunityId: string;
  idempotencyKey: string;
}

export interface CreateSalesAgreementResult {
  success: true;
  replayed: boolean;
  salesAgreementId: string;
  salesAgreementNumber: string | null;
  opportunityId: string;
}

const createAuditId = (actorUid: string, opportunityId: string, key: string): string =>
  `createSalesAgreement_${createHash("sha256").update(`${actorUid}|${opportunityId}|${key}`).digest("hex").slice(0, 40)}`;

export async function persistCreateSalesAgreement(
  db: Firestore,
  tx: Transaction,
  input: CreateSalesAgreementCallableInput,
  actorUid: string,
): Promise<CreateSalesAgreementResult> {
  const opportunityId = input.opportunityId;

  // ── 1. READ: idempotency, FIRST. A replay must not reach the counter.
  const aid = createAuditId(actorUid, opportunityId, input.idempotencyKey);
  const priorAudit = await tx.get(auditEventDocRef(aid));
  if (priorAudit.exists) {
    const priorId = (priorAudit.data()?.targetId as string) ?? "";
    // THE NUMBER COMES FROM THE AGREEMENT, NOT FROM THE AUDIT EVENT.
    //
    // Reading it off the audit doc looked right and returned null forever: buildAuditEventDoc
    // writes a FIXED field set (at/actor/action/target/outcome/summary and a few optional
    // governance fields), so a `salesAgreementNumber` staged onto the input is silently dropped.
    // A caller retrying would have lost the reference it had just been given.
    //
    // The number lives on the agreement, which is the only place it is authoritative anyway.
    const priorDoc = priorId ? await tx.get(db.collection(SALES_AGREEMENTS_COLLECTION).doc(priorId)) : null;
    return {
      success: true,
      replayed: true,
      salesAgreementId: priorId,
      salesAgreementNumber: (priorDoc?.data()?.salesAgreementNumber as string) ?? null,
      opportunityId,
    };
  }

  // ── 2. READ: the Opportunity. The ACCOUNT comes from here, and from nowhere else.
  const oppRef = db.collection(OPPORTUNITIES_COLLECTION).doc(opportunityId);
  const oppSnap = await tx.get(oppRef);
  if (!oppSnap.exists) throw new HttpsError("not-found", `No Opportunity with id ${opportunityId}`);
  const opp = oppSnap.data() as { accountId?: string; outcome?: string | null };
  if (typeof opp.accountId !== "string" || opp.accountId.trim().length === 0) {
    throw new HttpsError("failed-precondition", "Opportunity has no accountId; cannot derive the Agreement's customer.");
  }
  // NOT gated on a stage. An agreement is drafted DURING the negotiation (QUOTING / CUSTOMER_REVIEW),
  // so requiring WON here would invert the chain: WON is what an accepted agreement leads TO.
  // A LOST opportunity is refused, because there is nothing left to commit to.
  if (opp.outcome === "LOST") {
    throw new HttpsError("failed-precondition", "This Opportunity is LOST; there is nothing left to agree to.");
  }

  // ── 3. READ: one agreement per Opportunity. In-transaction, so concurrent creates serialize.
  const dupSnap = await tx.get(
    db.collection(SALES_AGREEMENTS_COLLECTION).where("sourceOpportunityId", "==", opportunityId).limit(1),
  );
  if (!dupSnap.empty) {
    // Fail closed rather than returning the existing one: a DIFFERENT idempotency key asking to
    // create means the caller believes there is no agreement, and handing back somebody else's
    // terms as though they were the ones just submitted would launder that into a success.
    throw new HttpsError(
      "failed-precondition",
      `Opportunity ${opportunityId} already has a Sales Agreement. Edit that draft rather than creating a second.`,
    );
  }

  // ── 4. BUILD, before any write. Every rule lives in the pure command; a validation failure here
  //       must not leave a reserved counter behind.
  const built = buildCreateSalesAgreement(
    { ...input, accountId: opp.accountId.trim(), sourceOpportunityId: opportunityId },
    { actorUid, nowMillis: Date.now() },
  );

  // ── 4b. READ: every product reference must name something that exists. Placed HERE, after the
  //        pure build and before the counter, for the reason step 4 already states: a validation
  //        failure must not leave a reserved agreement number behind. Inside the transaction, so
  //        these reads belong to the same snapshot as the write.
  await validateSalesAgreementLineReferences(db, tx, built.lines);

  // ── 5. READ+WRITE: the number. Last read in the phase, exactly as the Sales Order path orders it.
  const { salesAgreementNumber } = await allocateSalesAgreementNumber(tx, new Date().getUTCFullYear());

  // ── 6. WRITES.
  const ref = db.collection(SALES_AGREEMENTS_COLLECTION).doc();
  tx.set(ref, {
    ...built,
    salesAgreementNumber,
    // Set once here so the field always exists and reads as an honest "not converted yet" rather
    // than as an absent key a consumer has to guess about.
    salesOrderId: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // The Opportunity's forward link, written in the SAME commit so it can never name an agreement
  // that was not created. `salesOrderId` is untouched — a different field meaning a different thing.
  tx.update(oppRef, { salesAgreementId: ref.id, updatedAt: FieldValue.serverTimestamp() });

  stageAuditEventWithId(tx, aid, {
    actorUid,
    action: "createSalesAgreement",
    targetType: "salesAgreement",
    targetId: ref.id,
    outcome: "applied",
    summary: `created sales agreement ${salesAgreementNumber} for account ${built.accountId} from opportunity ${opportunityId}`,
  });

  return { success: true, replayed: false, salesAgreementId: ref.id, salesAgreementNumber, opportunityId };
}

export const createSalesAgreement = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
  await requireCapability(request.auth.uid, SALES_AGREEMENT_CREATE_CAPABILITY, "create Sales Agreements");

  const data = (request.data ?? {}) as Partial<CreateSalesAgreementCallableInput>;
  if (typeof data.opportunityId !== "string" || data.opportunityId.trim().length === 0) {
    throw new HttpsError("invalid-argument", "opportunityId is required.");
  }
  if (typeof data.idempotencyKey !== "string" || data.idempotencyKey.trim().length === 0) {
    throw new HttpsError("invalid-argument", "idempotencyKey is required.");
  }
  if (typeof data.ownerEmployeeId !== "string" || data.ownerEmployeeId.trim().length === 0) {
    throw new HttpsError("invalid-argument", "ownerEmployeeId (canonical Employee) is required.");
  }
  // accountId and sourceOpportunityId are DERIVED. Accepting them silently would make the payload
  // look authoritative to the next reader of this file; rejecting says which fact the server owns.
  for (const derived of ["accountId", "sourceOpportunityId", "state", "salesAgreementNumber", "salesOrderId", "acceptedByUid", "acceptedAtMillis", "currency", "totals"]) {
    if (derived in (request.data ?? {})) {
      throw new HttpsError("invalid-argument", `${derived} is server-derived and must not be supplied.`);
    }
  }

  const db = getFirestore();
  try {
    return await db.runTransaction((tx) =>
      persistCreateSalesAgreement(
        db,
        tx,
        { ...(data as CreateSalesAgreementCallableInput), opportunityId: data.opportunityId!.trim() },
        request.auth!.uid,
      ),
    );
  } catch (err) {
    throw mapCommandError(err);
  }
});

// ═══════════════════════════════════════════════════════════ BOUNDED DRAFT EDIT

const updateAuditId = (actorUid: string, agreementId: string, key: string): string =>
  `updateSalesAgreementDraft_${createHash("sha256").update(`${actorUid}|${agreementId}|${key}`).digest("hex").slice(0, 40)}`;

export interface UpdateSalesAgreementDraftCallableInput extends UpdateSalesAgreementDraftInput {
  salesAgreementId: string;
  idempotencyKey: string;
}

export async function persistUpdateSalesAgreementDraft(
  db: Firestore,
  tx: Transaction,
  input: UpdateSalesAgreementDraftCallableInput,
  actorUid: string,
): Promise<{ success: true; replayed: boolean; salesAgreementId: string }> {
  const { salesAgreementId, idempotencyKey, ...patchInput } = input;

  const aid = updateAuditId(actorUid, salesAgreementId, idempotencyKey);
  const priorAudit = await tx.get(auditEventDocRef(aid));
  if (priorAudit.exists) return { success: true, replayed: true, salesAgreementId };

  const ref = db.collection(SALES_AGREEMENTS_COLLECTION).doc(salesAgreementId);
  const snap = await tx.get(ref);
  if (!snap.exists) throw new HttpsError("not-found", `No Sales Agreement with id ${salesAgreementId}`);
  const current = snap.data() as { state: SalesAgreementState; lines: BuiltAgreementLine[]; totals: AgreementTotals };

  // The DRAFT-only rule and the field allowlist both live in the pure command.
  const patch = buildUpdateSalesAgreementDraft(current, patchInput, { actorUid, nowMillis: Date.now() });

  // Validate the lines the draft will ACTUALLY have after this patch, not the ones that were sent.
  // An edit that touches only the PO number leaves the existing lines in place, and those were
  // already validated when they were written -- but re-checking them costs one batched read and
  // means the rule is stated once, over the resulting document, rather than conditionally over the
  // input. A conditional check is where "we only validate when lines change" turns into a way to
  // keep an invalid line alive by never editing it again.
  const linesAfterPatch = (patch as { lines?: BuiltAgreementLine[] }).lines ?? current.lines ?? [];
  await validateSalesAgreementLineReferences(db, tx, linesAfterPatch);

  tx.update(ref, { ...patch, updatedAt: FieldValue.serverTimestamp() });
  stageAuditEventWithId(tx, aid, {
    actorUid,
    action: "updateSalesAgreementDraft",
    targetType: "salesAgreement",
    targetId: salesAgreementId,
    outcome: "applied",
    summary: `edited draft sales agreement ${salesAgreementId}: ${Object.keys(patchInput).sort().join(", ") || "no fields"}`,
  });

  return { success: true, replayed: false, salesAgreementId };
}

export const updateSalesAgreementDraft = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
  await requireCapability(request.auth.uid, SALES_AGREEMENT_UPDATE_DRAFT_CAPABILITY, "edit Sales Agreement drafts");

  const data = (request.data ?? {}) as Partial<UpdateSalesAgreementDraftCallableInput>;
  if (typeof data.salesAgreementId !== "string" || data.salesAgreementId.trim().length === 0) {
    throw new HttpsError("invalid-argument", "salesAgreementId is required.");
  }
  if (typeof data.idempotencyKey !== "string" || data.idempotencyKey.trim().length === 0) {
    throw new HttpsError("invalid-argument", "idempotencyKey is required.");
  }

  const db = getFirestore();
  try {
    return await db.runTransaction((tx) =>
      persistUpdateSalesAgreementDraft(
        db,
        tx,
        { ...(data as UpdateSalesAgreementDraftCallableInput), salesAgreementId: data.salesAgreementId!.trim() },
        request.auth!.uid,
      ),
    );
  } catch (err) {
    throw mapCommandError(err);
  }
});

// ═══════════════════════════════════════════════════════════ ACCEPT

const acceptAuditId = (actorUid: string, agreementId: string, key: string): string =>
  `acceptSalesAgreement_${createHash("sha256").update(`${actorUid}|${agreementId}|${key}`).digest("hex").slice(0, 40)}`;

export async function persistAcceptSalesAgreement(
  db: Firestore,
  tx: Transaction,
  input: { salesAgreementId: string; idempotencyKey: string },
  actorUid: string,
): Promise<{ success: true; replayed: boolean; salesAgreementId: string; acceptedAtMillis: number | null }> {
  const aid = acceptAuditId(actorUid, input.salesAgreementId, input.idempotencyKey);
  const priorAudit = await tx.get(auditEventDocRef(aid));
  if (priorAudit.exists) {
    // Same rule as the create replay: the audit event carries a FIXED field set, so the acceptance
    // time is read from the agreement, where it is authoritative. A replay that reported a null
    // acceptance time would look, to a retrying caller, exactly like an agreement that was never
    // accepted -- and the obvious response to that is to accept it again.
    const priorSnap = await tx.get(db.collection(SALES_AGREEMENTS_COLLECTION).doc(input.salesAgreementId));
    return {
      success: true,
      replayed: true,
      salesAgreementId: input.salesAgreementId,
      acceptedAtMillis: (priorSnap.data()?.acceptedAtMillis as number) ?? null,
    };
  }

  const ref = db.collection(SALES_AGREEMENTS_COLLECTION).doc(input.salesAgreementId);
  const snap = await tx.get(ref);
  if (!snap.exists) throw new HttpsError("not-found", `No Sales Agreement with id ${input.salesAgreementId}`);
  const current = snap.data() as { state: SalesAgreementState; lines: BuiltAgreementLine[] };

  // The DRAFT check and the pricing-completeness gate both live in the pure command. Acceptance is
  // the moment provisional prices become a commitment, so it is the right place for the gate — and
  // the only place it is stated.
  //
  // ACCEPTANCE IS SERVER-STAMPED. acceptedByUid comes from request.auth and acceptedAtMillis from
  // the server clock; neither is reachable from any input on this callable. A client that could set
  // them could record somebody else as having accepted, on a date of its choosing.
  const patch = buildAcceptSalesAgreement(current, { actorUid, nowMillis: Date.now() });

  // REVALIDATION AT THE COMMITMENT BOUNDARY, and this is the one that matters.
  //
  // The draft's references were checked when they were written. That proves they were real THEN.
  // Acceptance is the moment the business becomes bound, and a product deleted or renamed in
  // between must not bind anybody merely because it existed on the day somebody typed it. Trusting
  // the earlier check here is exactly the TOCTOU hole a picker-only fix would have left: the UI
  // validates, and ACCEPT takes the draft's word for it.
  //
  // Same transaction, same snapshot, so a concurrent catalogue change retries rather than commits.
  await validateSalesAgreementLineReferences(db, tx, current.lines ?? []);

  tx.update(ref, { ...patch, updatedAt: FieldValue.serverTimestamp() });
  stageAuditEventWithId(tx, aid, {
    actorUid,
    action: "acceptSalesAgreement",
    targetType: "salesAgreement",
    targetId: input.salesAgreementId,
    outcome: "applied",
    summary: `accepted sales agreement ${input.salesAgreementId}`,
  });

  return { success: true, replayed: false, salesAgreementId: input.salesAgreementId, acceptedAtMillis: patch.acceptedAtMillis };
}

export const acceptSalesAgreement = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
  await requireCapability(request.auth.uid, SALES_AGREEMENT_ACCEPT_CAPABILITY, "accept Sales Agreements");

  const data = (request.data ?? {}) as { salesAgreementId?: string; idempotencyKey?: string };
  if (typeof data.salesAgreementId !== "string" || data.salesAgreementId.trim().length === 0) {
    throw new HttpsError("invalid-argument", "salesAgreementId is required.");
  }
  if (typeof data.idempotencyKey !== "string" || data.idempotencyKey.trim().length === 0) {
    throw new HttpsError("invalid-argument", "idempotencyKey is required.");
  }
  // Acceptance takes NO commercial input. Anything else on the payload is a caller trying to change
  // terms in the same breath as committing to them.
  for (const forbidden of ["state", "acceptedAtMillis", "acceptedByUid", "lines", "totals"]) {
    if (forbidden in (request.data ?? {})) {
      throw new HttpsError("invalid-argument", `${forbidden} is server-owned and must not be supplied on accept.`);
    }
  }

  const db = getFirestore();
  try {
    return await db.runTransaction((tx) =>
      persistAcceptSalesAgreement(
        db,
        tx,
        { salesAgreementId: data.salesAgreementId!.trim(), idempotencyKey: data.idempotencyKey!.trim() },
        request.auth!.uid,
      ),
    );
  } catch (err) {
    throw mapCommandError(err);
  }
});
