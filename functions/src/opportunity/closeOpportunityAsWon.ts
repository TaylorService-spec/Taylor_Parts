// CLOSE OPPORTUNITY AS WON — the atomic Won + Sales Order operation.
//
// ======================= WHY THIS EXISTS =======================
//
// Closing an Opportunity as WON must produce exactly one Sales Order. Before this, the two
// halves were separate transactions: `transitionOpportunity` committed WON, and
// `createSalesOrderFromOpportunity` then REQUIRED `outcome === "WON"` to already be
// committed. If the second call failed or was never made, the Opportunity was WON, terminal,
// and had no Sales Order — a state the business does not permit, reachable by an ordinary
// network failure between two calls.
//
// ============ WHY THE TWO EXISTING CORES CANNOT SIMPLY BE COMPOSED ============
//
// Both `persistTransitionedOpportunity` and `persistSalesOrderFromOpportunity` accept a
// Transaction, so composing them looks trivial. It is not: Firestore requires ALL reads
// before ANY writes, and each core is internally read-then-write. Calling them in either
// order puts a read after a write and the transaction is rejected outright.
//
// So this orchestrator re-derives the ORDER, not the LOGIC. Every decision it makes is made
// by the same pure builders the standalone callables use — `buildTransitionPatch`,
// `buildCreateSalesOrder`, `deriveSalesOrderLines`, `allocateSalesOrderNumber`. There is no
// second Sales Order service and no second numbering scheme.
//
// ============ THE ORDERING CONSTRAINT, INCLUDING THE ALLOCATOR ============
//
// `allocateSalesOrderNumber` is itself a MIXED operation: it reads the year counter and then
// writes it back. That makes it the transaction's first write boundary, and it must
// therefore run after every other read. Calling it earlier would be harmless; calling it
// after the transition or audit writes would break the transaction at runtime, in the exact
// path that must never fail. The order below is load-bearing and is stated step by step:
//
//   READS
//     1. idempotency / audit state
//     2. the Opportunity
//     3. any existing Sales Order for this Opportunity
//     4. remaining validation (pure, over what was read)
//     5. existing order found -> reconcile and return, WITHOUT allocating a number
//   WRITES
//     6. allocate + reserve the counter   <- first write
//     7. the Opportunity transition
//     8. the Sales Order
//     9. lineage, both directions
//    10. audit evidence
//
// A number is never allocated on a path that returns an existing order, so a retry cannot
// burn a sequence value.
//
// ============ NO CLIENT-REACHABLE "ALREADY WON" FLAG ============
//
// A tempting shortcut is to let the caller assert "WON is being set in this transaction" so
// the Sales Order half skips its precondition. This does not do that, and deliberately: any
// such flag becomes a way to create a Sales Order against an Opportunity that is not WON.
// This function reads the Opportunity itself and decides. The standalone callables keep
// their own preconditions unchanged.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue, type Firestore, type Transaction } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import { resolveEffectiveAccess } from "../access/effectiveAccessFeed";
import { auditEventDocRef, stageAuditEventWithId } from "../access/auditEventWriter";
import { OPPORTUNITIES_COLLECTION, SALES_ORDERS_COLLECTION } from "../constants/collections";
import { buildCreateSalesOrder, SalesOrderCommandError, type BuiltSalesOrder } from "../salesOrder/salesOrderCommands";
import { allocateSalesOrderNumber } from "../salesOrder/salesOrderNumbering";
import { OPPORTUNITY_CREATE_SALES_ORDER_CAPABILITY, type OpportunityDoc } from "./createSalesOrderFromOpportunity";
import { SALES_AGREEMENTS_COLLECTION } from "../constants/collections.js";
import {
  assertAgreementConvertible,
  salesOrderLinesFromAgreement,
  salesOrderFieldsFromAgreement,
} from "../salesAgreement/agreementToSalesOrder.js";
import { buildTransitionPatch, OpportunityCommandError } from "./opportunityCommands";
import { OPPORTUNITY_WRITE_CAPABILITY } from "./opportunityCallables";
import { isChannel, type SalesChannel } from "./opportunityLifecycle";

// The shared OpportunityDoc describes only what Sales Order derivation needs. Closing as WON
// also reads the LIFECYCLE fields, so this narrows the same document one step further rather
// than widening the shared type for a consumer that does not need them.
type WonOpportunityDoc = OpportunityDoc & {
  stage?: string;
  outcome?: string | null;
};

export interface CloseOpportunityAsWonInput {
  opportunityId: string;
  ownerEmployeeId: string;
  salesChannel: SalesChannel;
  locationId?: string | null;
  customerPO?: string | null;
  idempotencyKey: string;
}

export interface CloseOpportunityAsWonResult {
  success: true;
  /** true when this call did not create anything: replay, or an order already existed. */
  replayed: boolean;
  /** true when the Opportunity was already WON and only the missing order was created. */
  recovered: boolean;
  opportunityId: string;
  salesOrderId: string;
  salesOrderNumber: string | null;
}

// Keyed by THIS action, so a replay key collides only with a prior call through this
// operation — never with the standalone transition or create callables, which own their own
// idempotency spaces.
const mkParentAuditId = (actorUid: string, opportunityId: string, key: string): string =>
  `closeOpportunityAsWon_${createHash("sha256").update(`${actorUid}|${opportunityId}|${key}`).digest("hex").slice(0, 40)}`;

// The two child facts hang off the parent id, so the audit trail shows one atomic action
// with its two constituent events rather than two unrelated ones that happen to share a
// timestamp.
const childAuditId = (parentAid: string, suffix: string): string => `${parentAid}__${suffix}`;

export async function persistCloseOpportunityAsWon(
  db: Firestore,
  tx: Transaction,
  input: CloseOpportunityAsWonInput,
  actorUid: string,
): Promise<CloseOpportunityAsWonResult> {
  const opportunityId = input.opportunityId;
  const opportunityRef = db.collection(OPPORTUNITIES_COLLECTION).doc(opportunityId);

  // ---------------------------------------------------------------- 1. READ: idempotency
  // First, so a replay returns the prior outcome without re-deriving anything against an
  // Opportunity that may have changed since.
  const parentAid = mkParentAuditId(actorUid, opportunityId, input.idempotencyKey);
  const priorAudit = await tx.get(auditEventDocRef(parentAid));
  if (priorAudit.exists) {
    const prior = priorAudit.data() ?? {};
    return {
      success: true,
      replayed: true,
      recovered: false,
      opportunityId,
      salesOrderId: (prior.targetId as string) ?? "",
      salesOrderNumber: (prior.salesOrderNumber as string) ?? null,
    };
  }

  // ---------------------------------------------------------------- 2. READ: Opportunity
  const oppSnap = await tx.get(opportunityRef);
  if (!oppSnap.exists) throw new HttpsError("not-found", `No Opportunity with id ${opportunityId}`);
  const opp = oppSnap.data() as WonOpportunityDoc;

  // ------------------------------------------------- 3. READ: an existing Sales Order
  // Queried IN-TRANSACTION so concurrent Won attempts see a consistent snapshot and
  // Firestore serializes the conflicting one.
  const dupSnap = await tx.get(
    db.collection(SALES_ORDERS_COLLECTION).where("sourceOpportunityId", "==", opportunityId).limit(1),
  );

  // ---------------------------------------------------------- 4. remaining validation
  // Pure, over what was read. No further reads occur after this point except the counter.
  if (opp.outcome === "LOST") {
    throw new HttpsError("failed-precondition", "Opportunity is LOST and cannot be closed as WON.");
  }
  if (!opp.accountId) {
    throw new HttpsError("failed-precondition", "Opportunity has no accountId; cannot derive Sales Order account.");
  }
  if (!isChannel(input.salesChannel)) {
    throw new HttpsError("invalid-argument", "salesChannel is invalid.");
  }
  const alreadyWon = opp.outcome === "WON";

  // The stage gate. Delegated to the ratified lifecycle graph rather than restated here, so
  // "WON only from DECISION" has exactly one definition. Skipped when already WON, because
  // the recovery path is not performing a transition.
  let transitionPatch: ReturnType<typeof buildTransitionPatch> | null = null;
  if (!alreadyWon) {
    try {
      transitionPatch = buildTransitionPatch(
        // Cast at the boundary: the stored document is untyped Firestore data, and
        // buildTransitionPatch validates `stage` itself (isStage) rather than trusting it.
        { stage: opp.stage, outcome: opp.outcome ?? null, lines: opp.lines } as Parameters<typeof buildTransitionPatch>[0],
        { kind: "OUTCOME", outcome: "WON" },
        { actorUid, nowMillis: Date.now() },
      );
    } catch (err) {
      if (err instanceof OpportunityCommandError) {
        // NO_LINES and an illegal stage are both business preconditions, not server faults.
        throw new HttpsError("failed-precondition", err.message);
      }
      throw err;
    }
  }

  // ------------------------------- 5. existing order -> reconcile and return, NO allocation
  if (!dupSnap.empty) {
    const existing = dupSnap.docs[0];
    const existingData = existing.data() ?? {};

    // FAIL CLOSED on conflicting lineage. An order claiming this Opportunity but belonging to
    // a different account is not something to quietly hand back — it means the lineage is
    // already wrong, and returning it would launder that into a success.
    if (existingData.accountId && existingData.accountId !== opp.accountId) {
      throw new HttpsError(
        "failed-precondition",
        `Existing Sales Order ${existing.id} is for account ${existingData.accountId}, not this Opportunity's account ${opp.accountId}.`,
      );
    }

    // Recover a missing back-link. The order exists and points here; the Opportunity does not
    // point back. That is a repairable half-write from an older split-brain, and repairing it
    // is a WRITE with no read after it, so the ordering constraint still holds.
    const patch: Record<string, unknown> = {};
    if (opp.salesOrderId !== existing.id) patch.salesOrderId = existing.id;
    // An Opportunity holding an order but not marked WON is the other half of the same
    // split-brain. Close it, using the same lifecycle-derived patch.
    if (!alreadyWon && transitionPatch) Object.assign(patch, transitionPatch);
    if (Object.keys(patch).length > 0) {
      patch.updatedAt = FieldValue.serverTimestamp();
      tx.update(opportunityRef, patch);
    }

    stageAuditEventWithId(tx, parentAid, {
      actorUid,
      action: "closeOpportunityAsWon",
      targetType: "salesOrder",
      targetId: existing.id,
      outcome: "applied",
      summary: `reconciled existing sales order ${existing.id} for opportunity ${opportunityId}`,
    });

    return {
      success: true,
      replayed: true,
      recovered: Object.keys(patch).length > 0,
      opportunityId,
      salesOrderId: existing.id,
      salesOrderNumber: (existingData.salesOrderNumber as string) ?? null,
    };
  }

  // ══════════ THE AGREEMENT IS THE PRICE SOURCE — STILL IN THE READ PHASE ══════════
  //
  // This path had the SAME unpriced shortcut as createSalesOrderFromOpportunity: it mapped
  // Opportunity { kind, ref, qty } through with no price. Fixing only the other one would have left
  // the hole open through the atomic WON route, which is the route that actually runs.
  //
  // Read here, before the first write, because Firestore requires every read to precede every write
  // and the counter allocation below is a write.
  //
  // ONE equality predicate on one field: Firestore's automatic single-field index serves it. No
  // composite is declared, and none is needed.
  const agreementSnap = await tx.get(
    db.collection(SALES_AGREEMENTS_COLLECTION).where("sourceOpportunityId", "==", opportunityId).limit(1),
  );
  const agreementDoc = agreementSnap.empty ? null : agreementSnap.docs[0];
  const agreementData = agreementDoc?.data() ?? {};

  assertAgreementConvertible(
    {
      exists: agreementDoc !== null,
      state: agreementData.state,
      accountId: agreementData.accountId ?? null,
      sourceOpportunityId: agreementData.sourceOpportunityId ?? null,
      lines: agreementData.lines ?? [],
    },
    { id: opportunityId, accountId: opp.accountId },
  );

  const agreementLines = salesOrderLinesFromAgreement({ state: agreementData.state, lines: agreementData.lines ?? [] });
  const fromAgreement = salesOrderFieldsFromAgreement({
    locationId: agreementData.locationId ?? null,
    customerPO: agreementData.customerPO ?? null,
    specialInstructions: agreementData.specialInstructions ?? null,
  });

  // Build the Sales Order body BEFORE the first write: pure, and a validation failure here
  // must not leave a reserved counter behind.
  let built: BuiltSalesOrder;
  try {
    built = buildCreateSalesOrder(
      {
        accountId: opp.accountId,
        ownerEmployeeId: input.ownerEmployeeId,
        salesChannel: input.salesChannel,
        // The caller's own values still win where supplied; the Agreement fills what was left out.
        locationId: input.locationId ?? fromAgreement.locationId,
        sourceOpportunityId: opportunityId,
        customerPO: input.customerPO ?? fromAgreement.customerPO,
        notes: fromAgreement.notes,
        lines: agreementLines,
      },
      { actorUid, nowMillis: Date.now() },
    );
  } catch (err) {
    if (err instanceof SalesOrderCommandError) throw new HttpsError("invalid-argument", err.message);
    throw err;
  }

  // ============================== WRITE PHASE BEGINS ==============================
  // ------------------------------------------- 6. allocate + reserve the counter (1st write)
  const { salesOrderNumber } = await allocateSalesOrderNumber(tx, new Date().getUTCFullYear());

  const soRef = db.collection(SALES_ORDERS_COLLECTION).doc();
  const { createdAtMillis: _c, updatedAtMillis: _u, ...fields } = built;

  // ------------------------------------------------ 7 + 9. transition and lineage, one write
  const oppPatch: Record<string, unknown> = {
    salesOrderId: soRef.id,
    // BESIDE salesOrderId, never instead of it: existing consumers navigate by the order link, and
    // one id field cannot mean two objects.
    salesAgreementId: agreementDoc!.id,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (transitionPatch) Object.assign(oppPatch, transitionPatch);
  tx.update(opportunityRef, oppPatch);
  // The agreement's result link, in the SAME commit -- it can never point at an order that was not
  // committed. A replay returns the prior outcome long before reaching here.
  tx.update(agreementDoc!.ref, { salesOrderId: soRef.id, updatedAt: FieldValue.serverTimestamp() });

  // ------------------------------------------------------------------ 8. the Sales Order
  tx.set(soRef, {
    ...fields,
    salesOrderNumber,
    // Denormalized deliberately: the reference is IMMUTABLE, so a copy cannot go stale. The
    // Opportunity's human NAME is deliberately not copied, for the opposite reason.
    sourceOpportunityNumber: opp.opportunityNumber ?? null,
    // Which commitment this order fulfils.
    sourceAgreementId: agreementDoc!.id,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // ------------------------------------------------------------------ 10. audit evidence
  // Three facts: the parent atomic action, and the two constituent events preserved
  // separately so the trail is not collapsed into one entry that hides half of what happened.
  stageAuditEventWithId(tx, parentAid, {
    actorUid,
    action: "closeOpportunityAsWon",
    targetType: "salesOrder",
    targetId: soRef.id,
    outcome: "applied",
    summary: `closed opportunity ${opportunityId} as WON and created sales order ${salesOrderNumber}`,
  });
  if (transitionPatch) {
    stageAuditEventWithId(tx, childAuditId(parentAid, "transition"), {
      actorUid,
      action: "transitionOpportunity",
      targetType: "opportunity",
      targetId: opportunityId,
      outcome: "applied",
      summary: `opportunity ${opportunityId} closed as WON`,
    });
  }
  stageAuditEventWithId(tx, childAuditId(parentAid, "salesOrder"), {
    actorUid,
    action: "createSalesOrderFromOpportunity",
    targetType: "salesOrder",
    targetId: soRef.id,
    outcome: "applied",
    summary: `created sales order ${salesOrderNumber} for account ${opp.accountId} from opportunity ${opportunityId}`,
  });

  return {
    success: true,
    replayed: false,
    recovered: alreadyWon,
    opportunityId,
    salesOrderId: soRef.id,
    salesOrderNumber,
  };
}

// ================================ THE CALLABLE ================================
//
// REQUIRES BOTH CAPABILITIES. Closing as WON is a transition (opportunity.write) that also
// creates a Sales Order (opportunity.createSalesOrder). Requiring both is not belt-and-braces:
// this operation is a strictly greater authority than either alone, and someone who may
// advance stages but may not commit an order must not gain that power by routing through the
// combined action. Fail-closed on a throwing resolver, same as every other gate here.
async function requireCloseAsWon(uid: string): Promise<void> {
  const ids = [OPPORTUNITY_WRITE_CAPABILITY, OPPORTUNITY_CREATE_SALES_ORDER_CAPABILITY];
  let decisions: Record<string, boolean> = {};
  try {
    ({ decisions } = await resolveEffectiveAccess({ principalUid: uid, permissionIds: ids }));
  } catch (err) {
    console.error("[requireCloseAsWon] capability resolution failed", err);
    throw new HttpsError("permission-denied", "You are not authorized to close this Opportunity as Won.");
  }
  const missing = ids.filter((id) => decisions[id] !== true);
  if (missing.length > 0) {
    throw new HttpsError("permission-denied", "You are not authorized to close this Opportunity as Won.");
  }
}

export const closeOpportunityAsWon = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
  await requireCloseAsWon(request.auth.uid);

  const data = (request.data ?? {}) as CloseOpportunityAsWonInput;
  if (typeof data.opportunityId !== "string" || data.opportunityId.trim().length === 0) {
    throw new HttpsError("invalid-argument", "opportunityId is required.");
  }
  if (typeof data.ownerEmployeeId !== "string" || data.ownerEmployeeId.trim().length === 0) {
    throw new HttpsError("invalid-argument", "ownerEmployeeId (canonical Employee) is required.");
  }
  if (!isChannel(data.salesChannel)) throw new HttpsError("invalid-argument", "salesChannel is invalid.");
  if (typeof data.idempotencyKey !== "string" || data.idempotencyKey.trim().length === 0) {
    throw new HttpsError("invalid-argument", "idempotencyKey is required.");
  }

  const db = getFirestore();
  // Fields are copied individually, never spread from `data` — so no client key can reach the
  // persist core except the five named here. Account and lines are always server-derived.
  return await db.runTransaction((tx) =>
    persistCloseOpportunityAsWon(
      db,
      tx,
      {
        opportunityId: data.opportunityId.trim(),
        ownerEmployeeId: data.ownerEmployeeId.trim(),
        salesChannel: data.salesChannel,
        locationId: typeof data.locationId === "string" ? data.locationId.trim() : null,
        customerPO: typeof data.customerPO === "string" ? data.customerPO.trim() : null,
        idempotencyKey: data.idempotencyKey.trim(),
      },
      request.auth!.uid,
    ),
  );
});
