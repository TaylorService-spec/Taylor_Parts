// Governed WON -> Create Sales Order action (P1.3, decision #3). A HUMAN-INVOKED onCall callable — there is
// deliberately NO Firestore trigger that auto-creates a Sales Order when an Opportunity is set to WON. The
// operator explicitly invokes this action; nothing runs implicitly on the WON write.
//
// Lines/quantities/account are NEVER client-supplied here — they are read from the WON Opportunity doc inside
// the transaction, so the Sales Order can never diverge from the commercial commitment it is sealing.
// `ownerEmployeeId`/`salesChannel`/`locationId`/`customerPO` ARE caller-supplied (the Sales Order's own
// owning/channel/location/PO facts, which may legitimately differ from the Opportunity's).
//
// Reuses `buildCreateSalesOrder` (salesOrder/salesOrderCommands.ts) AS-IS — no changes to that pure builder —
// so a Sales Order created via this path is validated by the exact same invariants (product-level lines only,
// orderedQty a positive integer, etc.) as one created via the direct `createSalesOrder` callable.
//
// Authorization = capability `opportunity.createSalesOrder`, resolved fail-closed via the trusted
// effective-access feed; registered active:false ⇒ hard DENY for everyone until a separate Owner grant.
// EXPORT != DEPLOY, REGISTER != GRANT.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue, type Firestore, type Transaction } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import { resolveEffectiveAccess } from "../access/effectiveAccessFeed";
import { auditEventDocRef, stageAuditEventWithId } from "../access/auditEventWriter";
import { SALES_AGREEMENTS_COLLECTION } from "../constants/collections.js";
import {
  assertAgreementConvertible,
  salesOrderLinesFromAgreement,
  salesOrderFieldsFromAgreement,
} from "../salesAgreement/agreementToSalesOrder.js";
import { OPPORTUNITIES_COLLECTION, SALES_ORDERS_COLLECTION } from "../constants/collections";
import { buildCreateSalesOrder, SalesOrderCommandError, type BuiltSalesOrder, type SalesOrderLineInput } from "../salesOrder/salesOrderCommands";
import { allocateSalesOrderNumber } from "../salesOrder/salesOrderNumbering";
import { isChannel, type SalesChannel } from "./opportunityLifecycle";
import { deriveEmployeeRefOwner } from "../ownership/typedOwner";

export const OPPORTUNITY_CREATE_SALES_ORDER_CAPABILITY = "opportunity.createSalesOrder";

// Shared deterministic Audit Event id builder (same shape as salesOrderCallables.ts's mkAuditId), but keyed by
// its OWN action string ("createSalesOrderFromOpportunity") so a replay key collides only with a prior call
// through THIS action, never with the direct createSalesOrder callable's own idempotency space.
const mkAuditId = (actorUid: string, opportunityId: string, key: string): string =>
  `createSalesOrderFromOpportunity_${createHash("sha256").update(`${actorUid}|${opportunityId}|${key}`).digest("hex").slice(0, 40)}`;

function mapCommandError(err: unknown): HttpsError {
  if (err instanceof HttpsError) return err;
  if (err instanceof SalesOrderCommandError) return new HttpsError("invalid-argument", err.message);
  return new HttpsError("internal", "Create Sales Order from Opportunity failed.");
}

interface OpportunityLineDoc {
  kind: string;
  ref: string;
  qty?: number;
}

export interface OpportunityDoc {
  opportunityNumber?: string | null;
  outcome?: string | null;
  accountId?: string;
  // Declared so the Sales Order's owner inheritance (ruling D-4) reads a named field rather than
  // an untyped property. The cast at the call site remains because a TS interface is not assignable
  // to Record<string, unknown> -- the field being declared here is what makes the read honest.
  ownerEmployeeId?: string | null;
  // FIN-002: attribution the conversion inherits (copied, not followed).
  operatingCompanyId?: string | null;
  creditedSalespersonId?: string | null;
  lines?: OpportunityLineDoc[];
  salesOrderId?: string | null;
  // The commercial commitment this Opportunity produced. Distinct from salesOrderId: one names the
  // agreement, the other the order, and overloading a single id with both meanings is how lineage
  // becomes unreadable.
  salesAgreementId?: string | null;
}

export interface CreateSalesOrderFromOpportunityInput {
  opportunityId: string;
  ownerEmployeeId?: string;
  salesChannel: SalesChannel;
  locationId?: string;
  customerPO?: string;
  idempotencyKey: string;
}

export interface CreateSalesOrderFromOpportunityResult {
  success: true;
  replayed: boolean;
  salesOrderId: string | null;
  opportunityId: string;
}

// Translate the Opportunity's PRE-COMMITMENT lines (kind/ref/qty?) into the Sales Order builder's
// SalesOrderLineInput shape. `qty` is OPTIONAL on an Opportunity line but REQUIRED (as orderedQty) on a Sales
// Order line — a missing qty is a fail-closed condition here, never defaulted (e.g. to 1).
// ═══ RETIRED — deriveSalesOrderLines ═══
//
// It mapped Opportunity { kind, ref, qty } to Sales Order lines and carried NO PRICE, because an
// Opportunity has none: it holds `expectedValue`, one forecast number on the header. Every order
// it produced was therefore unpriced, and invoicing refuses to bill an unpriced line — which is
// exactly the contradiction the seven sandbox records demonstrate.
//
// DELETED RATHER THAN DEPRECATED. Both WON routes now source their lines from the accepted Sales
// Agreement (salesAgreement/agreementToSalesOrder.ts), and a function that still produced unpriced
// lines would sit here as the obvious thing for the next person to call. A comment saying "do not
// use this" is not a control.
//
// The replacement is deriveSalesOrderLinesFromAgreement, which refuses a DRAFT outright: a price
// nobody accepted is not a commitment.


// Transactional core, exported so tests can exercise the business rules directly (below the capability gate —
// `opportunity.createSalesOrder` is registered active:false, a hard deny for everyone until a separate Owner
// grant), exactly the pattern the sibling commercial callables already establish
// (persistCreatedSalesOrder / persistTransitionedOpportunity).
export async function persistSalesOrderFromOpportunity(
  db: Firestore,
  tx: Transaction,
  input: CreateSalesOrderFromOpportunityInput,
  actorUid: string,
): Promise<CreateSalesOrderFromOpportunityResult> {
  const opportunityId = input.opportunityId;
  const opportunityRef = db.collection(OPPORTUNITIES_COLLECTION).doc(opportunityId);

  // Idempotency check FIRST (read-phase): a replayed call must never re-derive/re-validate against a
  // possibly-since-changed Opportunity — it returns the prior outcome untouched.
  const aid = mkAuditId(actorUid, opportunityId, input.idempotencyKey);
  const priorAuditSnap = await tx.get(auditEventDocRef(aid));
  if (priorAuditSnap.exists) {
    return {
      success: true,
      replayed: true,
      salesOrderId: ((priorAuditSnap.data() ?? {}).targetId as string) ?? null,
      opportunityId,
    };
  }

  const oppSnap = await tx.get(opportunityRef);
  if (!oppSnap.exists) throw new HttpsError("not-found", `No Opportunity with id ${opportunityId}`);
  const opp = oppSnap.data() as OpportunityDoc;

  // [P1.4] Only a WON Opportunity may seed a Sales Order.
  if (opp.outcome !== "WON") {
    throw new HttpsError("failed-precondition", `Opportunity is not WON (outcome=${opp.outcome ?? "none"}).`);
  }

  // [P1.5] Dedup: no existing Sales Order may already carry this sourceOpportunityId. Queried IN-TRANSACTION
  // so a concurrent duplicate call sees a consistent snapshot (Firestore serializes conflicting transactions).
  const dupQuery = db.collection(SALES_ORDERS_COLLECTION).where("sourceOpportunityId", "==", opportunityId).limit(1);
  const dupSnap = await tx.get(dupQuery);
  if (!dupSnap.empty) {
    throw new HttpsError("failed-precondition", `Opportunity ${opportunityId} already has a Sales Order.`);
  }

  if (!opp.accountId) {
    throw new HttpsError("failed-precondition", "Opportunity has no accountId; cannot derive Sales Order account.");
  }
  // ══════════ THE AGREEMENT IS THE PRICE SOURCE, NOT THE OPPORTUNITY ══════════
  //
  // deriveSalesOrderLines mapped Opportunity { kind, ref, qty } through with NO price, because an
  // Opportunity has none. That shortcut produced the unpriced CONFIRMED orders.
  //
  // READ PHASE. Firestore requires every read before any write, so the agreement is fetched here,
  // alongside the opportunity and the duplicate check, and never after the first tx.set.
  //
  // LOOKED UP BY THE AGREEMENT'S OWN DECLARATION of its source, not by the Opportunity's backlink:
  // the backlink is navigation, the declaration is the relationship. A single equality predicate on
  // one field — Firestore's automatic single-field index serves it, and no composite is required.
  const agreementQuery = db
    .collection(SALES_AGREEMENTS_COLLECTION)
    .where("sourceOpportunityId", "==", opportunityId)
    .limit(1);
  const agreementSnap = await tx.get(agreementQuery);
  const agreementDoc = agreementSnap.empty ? null : agreementSnap.docs[0];
  const agreement = agreementDoc?.data() ?? {};

  assertAgreementConvertible(
    {
      exists: agreementDoc !== null,
      state: agreement.state,
      accountId: agreement.accountId ?? null,
      sourceOpportunityId: agreement.sourceOpportunityId ?? null,
      locationId: agreement.locationId ?? null,
      customerPO: agreement.customerPO ?? null,
      specialInstructions: agreement.specialInstructions ?? null,
      lines: agreement.lines ?? [],
    },
    { id: opportunityId, accountId: opp.accountId },
  );

  const lines = salesOrderLinesFromAgreement({ state: agreement.state, lines: agreement.lines ?? [] });
  const fromAgreement = salesOrderFieldsFromAgreement({
    locationId: agreement.locationId ?? null,
    customerPO: agreement.customerPO ?? null,
    specialInstructions: agreement.specialInstructions ?? null,
  });
  const agreementId = agreementDoc!.id;

  let built: BuiltSalesOrder;
  try {
    built = buildCreateSalesOrder(
      {
        accountId: opp.accountId,
        ownerEmployeeId: input.ownerEmployeeId,
        // Ruling D-4: the Opportunity's own owner is the default for the Sales Order it produces.
        // `opp` was read inside this transaction, so the inherited owner is the one in force at commit.
        inheritedOwner: deriveEmployeeRefOwner(opp as unknown as Record<string, unknown>),
        // FIN-002: attribution flows deliberately — agreement's frozen snapshot first, Opportunity
        // fallback; copied, not followed. This path previously passed neither (FIN-001 finding).
        inheritedOperatingCompanyId: (agreement.operatingCompanyId ?? opp.operatingCompanyId ?? null) as string | null,
        inheritedCreditedSalespersonId:
          (agreement.creditedSalespersonId ?? opp.creditedSalespersonId ?? null) as string | null,
        salesChannel: input.salesChannel,
        // The CALLER's value still wins where it supplied one -- this callable's own contract has
        // always accepted a location and a PO. The Agreement fills what the caller left out rather
        // than overriding an operational decision made at order time.
        locationId: input.locationId ?? fromAgreement.locationId,
        sourceOpportunityId: opportunityId,
        customerPO: input.customerPO ?? fromAgreement.customerPO,
        notes: fromAgreement.notes,
        lines,
      },
      // BOOKED at acceptance (DECISIONS #146); fallback to now for pre-FIN-002 agreements.
      { actorUid, nowMillis: Date.now(), bookedAtMillis: (agreement.acceptedAtMillis as number | undefined) ?? undefined },
    );
  } catch (err) {
    throw mapCommandError(err);
  }

  // [P1.6] Persist the Sales Order AND the Opportunity back-link atomically — same transaction, same commit.
  const soRef = db.collection(SALES_ORDERS_COLLECTION).doc();
  const { createdAtMillis: _c, updatedAtMillis: _u, ...fields } = built;

  // HUMAN IDENTITY, same contract as the direct createSalesOrder callable (persistCreatedSalesOrder):
  // allocated inside this transaction, alongside the document write, never client-supplied, and never
  // rewritten by any later transition path.
  const { salesOrderNumber } = await allocateSalesOrderNumber(tx, new Date().getUTCFullYear());

  // LINEAGE IDENTITY, denormalized deliberately rather than joined at read time.
  //
  // Sales Order detail shows an "Originating Opportunity" link and had nothing to label it
  // with but the raw document id. The obvious fix — have getSalesOrderContext read the
  // Opportunity — would be wrong: that callable is gated on salesOrder.read, and returning
  // Opportunity data through it would hand a caller fields governed by opportunity.read.
  // A read must not become a side door around the capability that guards what it returns.
  //
  // So the reference is copied here instead, by the governed command that is ALREADY
  // authorized to read this Opportunity and has already loaded it in this transaction. No
  // extra read, no cross-capability leak.
  //
  // Denormalization is safe for this specific value because the reference is IMMUTABLE —
  // written once at creation and never updated. A copy of an immutable value cannot go
  // stale. The Opportunity's human NAME is deliberately NOT copied for the opposite
  // reason: it is editable, so a copy would drift and the Sales Order would eventually
  // display a name the Opportunity no longer has.
  tx.set(soRef, {
    ...fields,
    salesOrderNumber,
    sourceOpportunityNumber: opp.opportunityNumber ?? null,
    // WHICH COMMITMENT THIS ORDER FULFILS. Its own field, never folded into the opportunity
    // reference: the order came FROM an agreement, and the agreement came from the opportunity.
    sourceAgreementId: agreementId,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  // BOTH BACKLINKS, in the same commit as the order. salesOrderId is preserved exactly as it was --
  // existing consumers navigate by it -- and salesAgreementId is added beside it rather than
  // replacing it.
  tx.update(opportunityRef, {
    salesOrderId: soRef.id,
    salesAgreementId: agreementId,
    updatedAt: FieldValue.serverTimestamp(),
  });
  // The agreement's own result link, written in the SAME transaction so it can never point at an
  // order that was not committed. Set once: a retry returns the prior outcome before reaching here.
  tx.update(agreementDoc!.ref, { salesOrderId: soRef.id, updatedAt: FieldValue.serverTimestamp() });

  stageAuditEventWithId(tx, aid, {
    actorUid,
    action: "createSalesOrderFromOpportunity",
    targetType: "salesOrder",
    targetId: soRef.id,
    outcome: "applied",
    summary: `created sales order for account ${built.accountId} from WON opportunity ${opportunityId}`,
  });

  return { success: true, replayed: false, salesOrderId: soRef.id, opportunityId };
}

async function requireCreateSalesOrderFromOpportunity(uid: string): Promise<void> {
  let allowed = false;
  try {
    const { decisions } = await resolveEffectiveAccess({
      principalUid: uid,
      permissionIds: [OPPORTUNITY_CREATE_SALES_ORDER_CAPABILITY],
    });
    allowed = decisions[OPPORTUNITY_CREATE_SALES_ORDER_CAPABILITY] === true;
  } catch (err) {
    console.error(`[requireCreateSalesOrderFromOpportunity] capability resolution failed for ${OPPORTUNITY_CREATE_SALES_ORDER_CAPABILITY}`, err);
    allowed = false; // a throwing resolver is a denial, never an allow
  }
  if (!allowed) throw new HttpsError("permission-denied", "You are not authorized to create a Sales Order from an Opportunity.");
}

// Explicit, human-invoked WON -> Create Sales Order action (decision #3: no Firestore trigger, not
// auto-created on WON). Input carries only opportunityId + the Sales Order's own owner/channel/location/PO —
// account and lines are always server-derived from the WON Opportunity, never trusted from the payload.
export const createSalesOrderFromOpportunity = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
  await requireCreateSalesOrderFromOpportunity(request.auth.uid);

  const data = (request.data ?? {}) as CreateSalesOrderFromOpportunityInput;
  if (typeof data.opportunityId !== "string" || data.opportunityId.trim().length === 0) {
    throw new HttpsError("invalid-argument", "opportunityId is required.");
  }
  // Ruling D-4: OPTIONAL now. An omitted owner inherits from the Opportunity and the builder still
  // REFUSES if nothing resolves. A supplied-but-malformed value is still a bad payload, not an
  // omission, so it is rejected rather than silently inherited over.
  if (data.ownerEmployeeId !== undefined && data.ownerEmployeeId !== null) {
    if (typeof data.ownerEmployeeId !== "string" || data.ownerEmployeeId.trim().length === 0) {
      throw new HttpsError("invalid-argument", "ownerEmployeeId, when provided, must be a non-empty string.");
    }
  }
  if (!isChannel(data.salesChannel)) {
    throw new HttpsError("invalid-argument", "salesChannel is invalid.");
  }
  if (typeof data.idempotencyKey !== "string" || data.idempotencyKey.trim().length === 0) {
    throw new HttpsError("invalid-argument", "idempotencyKey is required.");
  }

  const db = getFirestore();
  try {
    return await db.runTransaction((tx) =>
      persistSalesOrderFromOpportunity(
        db,
        tx,
        {
          opportunityId: data.opportunityId.trim(),
          // undefined travels through to the builder, which inherits the Opportunity owner.
          ownerEmployeeId: typeof data.ownerEmployeeId === "string" ? data.ownerEmployeeId.trim() : undefined,
          salesChannel: data.salesChannel,
          locationId: data.locationId,
          customerPO: data.customerPO,
          idempotencyKey: data.idempotencyKey,
        },
        request.auth!.uid,
      ),
    );
  } catch (err) {
    throw mapCommandError(err);
  }
});
