// Sales Agreement — TRUSTED MINIMAL READ PROJECTION (repo-only, fail-closed).
//
// GOVERNANCE: Owner Slice 4 §F. Follows the `salesOrder.read` / `opportunity.read` pattern exactly:
// the client gets NO direct `sales_agreements` access (firestore.rules denies read and write for
// every client), a trusted backend resolves the caller's governed capability, reads the canonical
// document through the Admin SDK, and returns only the projection the Agreement UX needs.
//
// TWO ENTRY POINTS, BECAUSE THERE ARE TWO WAYS A PERSON ARRIVES:
//
//   getSalesAgreementContext        by agreement id — from a link they already hold
//   getSalesAgreementForOpportunity by OPPORTUNITY id — the real entry point, because a
//                                   salesperson standing on an Opportunity does not know whether
//                                   an agreement exists yet. Answering "none yet" is the whole
//                                   point: the Opportunity screen has to decide between offering
//                                   CREATE and offering VIEW, and a not-found is the answer that
//                                   distinguishes them.
//
// LINEAGE IS PROJECTED IN BOTH DIRECTIONS. `sourceOpportunityId` (which negotiation this came from)
// and `salesOrderId` (which order it became, once converted) both travel, because the Agreement is
// the middle of the chain and a screen that can only see one side cannot show where it sits.
//
// IDENTITY: `salesAgreementNumber` is the displayed identity, allocated server-side at creation.
// Null on nothing today — numbering ships in the same slice as the create path — but projected as
// honestly nullable anyway, because DECISIONS #106 forbids the document id standing in for it and a
// non-nullable type would invite exactly that substitution the first time one is missing.
//
// EXPORT != DEPLOY, REGISTER != GRANT. Exported for build/test only; nothing runs until a separate
// deploy + capability grant + per-environment activation.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { resolveEffectiveAccess } from "../access/effectiveAccessFeed";
import { SALES_AGREEMENTS_COLLECTION } from "../constants/collections";
import {
  SALES_AGREEMENT_STATES,
  SALES_AGREEMENT_LINE_KINDS,
  type SalesAgreementState,
  type SalesAgreementLineKind,
} from "./salesAgreementLifecycle";

export const SALES_AGREEMENT_READ_CAPABILITY = "salesAgreement.read";

export interface SalesAgreementLineProjection {
  lineId: string;
  kind: SalesAgreementLineKind | null;
  ref: string | null;
  quantity: number | null;
  /** The committed unit price, integer minor units. NULL while a draft line is still unpriced. */
  unitPriceMinor: number | null;
  /** quantity x unitPriceMinor. Null when unpriced — never 0, which would say the line is free. */
  extendedMinor: number | null;
  condition: string | null;
  warranty: string | null;
  estimatedArrivalMillis: number | null;
}

export interface SalesAgreementProjection {
  /** For routing only. Never displayed as identity (DECISIONS #106). */
  id: string;
  /** The governed business reference (SA-YYYY-######). Honestly null if absent; never backfilled. */
  salesAgreementNumber: string | null;
  state: SalesAgreementState | null;
  accountId: string | null;
  ownerEmployeeId: string | null;
  locationId: string | null;
  currency: string | null;
  customerPO: string | null;
  isLease: boolean;
  fulfillmentIntent: string | null;
  shippingInstructions: string | null;
  shipVia: string | null;
  specialInstructions: string | null;
  lines: SalesAgreementLineProjection[];
  subtotalMinor: number | null;
  shippingMinor: number | null;
  installChargeMinor: number | null;
  taxMinor: number | null;
  totalMinor: number | null;
  downPaymentMinor: number | null;
  tradeInMinor: number | null;
  balanceMinor: number | null;
  /** Which negotiation this came from. */
  sourceOpportunityId: string | null;
  /** Which order it became. Null until conversion — the honest "not yet converted". */
  salesOrderId: string | null;
  acceptedAtMillis: number | null;
  acceptedByUid: string | null;
  createdAtMillis: number | null;
  updatedAtMillis: number | null;
}

export type SalesAgreementReadStatus = "ready" | "not-found";

export interface SalesAgreementReadResult {
  status: SalesAgreementReadStatus;
  salesAgreement: SalesAgreementProjection | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim().length > 0 ? v.trim() : null);
// Integer minor units or null. A stored float is NOT rounded into a plausible number here — money
// that arrived wrong should read as absent, not as a value nobody wrote.
const money = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);
const millis = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function projectLine(raw: unknown, index: number): SalesAgreementLineProjection {
  const l = (raw ?? {}) as Record<string, unknown>;
  const kind = SALES_AGREEMENT_LINE_KINDS.includes(l.kind as SalesAgreementLineKind)
    ? (l.kind as SalesAgreementLineKind)
    : null;
  const quantity = typeof l.quantity === "number" && Number.isInteger(l.quantity) ? l.quantity : null;
  const unitPriceMinor = money(l.unitPrice);
  return {
    lineId: str(l.lineId) ?? `line-${index + 1}`,
    kind,
    ref: str(l.ref),
    quantity,
    unitPriceMinor,
    // Recomputed rather than read: a stored extension that disagreed with quantity x price would be
    // a second answer, and the two factors are right there.
    extendedMinor: quantity === null || unitPriceMinor === null ? null : quantity * unitPriceMinor,
    condition: str(l.condition),
    warranty: str(l.warranty),
    estimatedArrivalMillis: millis(l.estimatedArrivalMillis),
  };
}

export function projectSalesAgreement(id: string, data: Record<string, unknown>): SalesAgreementProjection {
  const totals = (data.totals ?? {}) as Record<string, unknown>;
  const rawLines = Array.isArray(data.lines) ? data.lines : [];
  return {
    id,
    salesAgreementNumber: str(data.salesAgreementNumber),
    state: SALES_AGREEMENT_STATES.includes(data.state as SalesAgreementState)
      ? (data.state as SalesAgreementState)
      : null,
    accountId: str(data.accountId),
    ownerEmployeeId: str(data.ownerEmployeeId),
    locationId: str(data.locationId),
    currency: str(data.currency),
    customerPO: str(data.customerPO),
    isLease: data.isLease === true,
    fulfillmentIntent: str(data.fulfillmentIntent),
    shippingInstructions: str(data.shippingInstructions),
    shipVia: str(data.shipVia),
    specialInstructions: str(data.specialInstructions),
    lines: rawLines.map(projectLine),
    subtotalMinor: money(totals.subtotalMinor),
    shippingMinor: money(totals.shippingMinor),
    installChargeMinor: money(totals.installChargeMinor),
    taxMinor: money(totals.taxMinor),
    totalMinor: money(totals.totalMinor),
    downPaymentMinor: money(totals.downPaymentMinor),
    tradeInMinor: money(totals.tradeInMinor),
    balanceMinor: money(totals.balanceMinor),
    sourceOpportunityId: str(data.sourceOpportunityId),
    salesOrderId: str(data.salesOrderId),
    acceptedAtMillis: millis(data.acceptedAtMillis),
    acceptedByUid: str(data.acceptedByUid),
    createdAtMillis: millis(data.createdAtMillis),
    updatedAtMillis: millis(data.updatedAtMillis),
  };
}

/** Fail-closed capability check. A throwing resolver is a DENIAL, never an allow. */
async function requireAgreementRead(uid: string, label: string): Promise<void> {
  let allowed = false;
  try {
    const { decisions } = await resolveEffectiveAccess({
      principalUid: uid,
      permissionIds: [SALES_AGREEMENT_READ_CAPABILITY],
    });
    allowed = decisions[SALES_AGREEMENT_READ_CAPABILITY] === true;
  } catch (err) {
    console.error(`[${label}] capability resolution failed for ${SALES_AGREEMENT_READ_CAPABILITY}`, err);
    allowed = false;
  }
  if (!allowed) throw new HttpsError("permission-denied", "You are not authorized to read Sales Agreements.");
}

export async function readSalesAgreementById(db: Firestore, id: string): Promise<SalesAgreementReadResult> {
  const snap = await db.collection(SALES_AGREEMENTS_COLLECTION).doc(id).get();
  if (!snap.exists) return { status: "not-found", salesAgreement: null };
  return { status: "ready", salesAgreement: projectSalesAgreement(snap.id, snap.data() as Record<string, unknown>) };
}

/**
 * The Agreement for one Opportunity, or an honest "none yet".
 *
 * ONE equality predicate on ONE field: Firestore's automatic single-field index serves it. No
 * composite is declared and none is needed — the same query the conversion already runs.
 */
export async function readSalesAgreementForOpportunity(
  db: Firestore,
  opportunityId: string,
): Promise<SalesAgreementReadResult> {
  const snap = await db
    .collection(SALES_AGREEMENTS_COLLECTION)
    .where("sourceOpportunityId", "==", opportunityId)
    .limit(1)
    .get();
  if (snap.empty) return { status: "not-found", salesAgreement: null };
  const doc = snap.docs[0];
  return { status: "ready", salesAgreement: projectSalesAgreement(doc.id, doc.data() as Record<string, unknown>) };
}

export const getSalesAgreementContext = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
  const data = (request.data ?? {}) as { salesAgreementId?: unknown };
  if (typeof data.salesAgreementId !== "string" || data.salesAgreementId.trim().length === 0) {
    throw new HttpsError("invalid-argument", "salesAgreementId is required.");
  }
  await requireAgreementRead(request.auth.uid, "getSalesAgreementContext");
  try {
    return await readSalesAgreementById(getFirestore(), data.salesAgreementId.trim());
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    // A read failure is UNAVAILABLE, distinct from denied and from not-found. Logged server-side
    // only; the client message stays generic.
    console.error("getSalesAgreementContext: read failed", err);
    throw new HttpsError("internal", "The Sales Agreement read is temporarily unavailable.");
  }
});

export const getSalesAgreementForOpportunity = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
  const data = (request.data ?? {}) as { opportunityId?: unknown };
  if (typeof data.opportunityId !== "string" || data.opportunityId.trim().length === 0) {
    throw new HttpsError("invalid-argument", "opportunityId is required.");
  }
  await requireAgreementRead(request.auth.uid, "getSalesAgreementForOpportunity");
  try {
    return await readSalesAgreementForOpportunity(getFirestore(), data.opportunityId.trim());
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    console.error("getSalesAgreementForOpportunity: read failed", err);
    throw new HttpsError("internal", "The Sales Agreement read is temporarily unavailable.");
  }
});
