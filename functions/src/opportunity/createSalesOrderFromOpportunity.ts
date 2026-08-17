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
import { OPPORTUNITIES_COLLECTION, SALES_ORDERS_COLLECTION } from "../constants/collections";
import { buildCreateSalesOrder, SalesOrderCommandError, type BuiltSalesOrder, type SalesOrderLineInput } from "../salesOrder/salesOrderCommands";
import { allocateSalesOrderNumber } from "../salesOrder/salesOrderNumbering";
import { isChannel, type SalesChannel } from "./opportunityLifecycle";

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

interface OpportunityDoc {
  opportunityNumber?: string | null;
  outcome?: string | null;
  accountId?: string;
  lines?: OpportunityLineDoc[];
  salesOrderId?: string | null;
}

export interface CreateSalesOrderFromOpportunityInput {
  opportunityId: string;
  ownerEmployeeId: string;
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
function deriveSalesOrderLines(lines: OpportunityLineDoc[] | undefined): SalesOrderLineInput[] {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new HttpsError("failed-precondition", "Opportunity has no lines to seed a Sales Order from.");
  }
  return lines.map((l, i) => {
    if (typeof l.qty !== "number" || !Number.isFinite(l.qty) || l.qty <= 0) {
      throw new HttpsError(
        "failed-precondition",
        `Opportunity line ${i} (${l.ref ?? "unknown"}) is missing a qty; refusing to default a Sales Order quantity.`,
      );
    }
    return {
      kind: l.kind as SalesOrderLineInput["kind"],
      ref: l.ref,
      orderedQty: l.qty,
    };
  });
}

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
  const lines = deriveSalesOrderLines(opp.lines);

  let built: BuiltSalesOrder;
  try {
    built = buildCreateSalesOrder(
      {
        accountId: opp.accountId,
        ownerEmployeeId: input.ownerEmployeeId,
        salesChannel: input.salesChannel,
        locationId: input.locationId,
        sourceOpportunityId: opportunityId,
        customerPO: input.customerPO,
        lines,
      },
      { actorUid, nowMillis: Date.now() },
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
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  tx.update(opportunityRef, { salesOrderId: soRef.id, updatedAt: FieldValue.serverTimestamp() });

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
  } catch {
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
  if (typeof data.ownerEmployeeId !== "string" || data.ownerEmployeeId.trim().length === 0) {
    throw new HttpsError("invalid-argument", "ownerEmployeeId (canonical Employee) is required.");
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
          ownerEmployeeId: data.ownerEmployeeId.trim(),
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
