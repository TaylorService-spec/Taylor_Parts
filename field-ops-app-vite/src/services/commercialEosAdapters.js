// EOS Commercial projections -> the shapes the Opportunity / Sales Order screens already consume (Pass 11 Retail Sales).
//
// The Opportunity and Sales Order screens were built against the Firebase read callables' projections
// (functions/src/opportunity/opportunityReadService.ts, functions/src/salesOrder/salesOrderReadService.ts). Their data
// now comes from the governed PostgreSQL Commercial transport (the server's governed Commercial read layer), whose projections
// state the same facts in EOS vocabulary: ISO timestamps, person references, lineage DERIVED from the children, and an
// `editVersion` concurrency token. This module is the ONE translation between the two. It is pure and adds nothing:
// a fact the EOS projection does not carry is null here, never invented.
//
// DELIBERATELY NOT CARRIED (the held downstream boundary, Owner ruling D2): allocated / fulfilled / billed quantities and
// service Work Order lineage. PostgreSQL holds no such authority yet, so they are null / empty and the screens show
// them as not tracked -- never as zero.

const millisOf = (iso) => {
  if (typeof iso !== "string" || iso.length === 0) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
};
const personId = (ref) => (ref && typeof ref.employeeId === "string" ? ref.employeeId : null);

/** EOS OpportunityDetail/Summary projection -> the Opportunity projection the screens read. */
export function toOpportunityProjection(o) {
  if (!o || typeof o !== "object") return null;
  return {
    id: o.id,
    name: null, // never persisted by any writer (see the server's governed Commercial read layer)
    opportunityNumber: o.opportunityNumber ?? null,
    accountId: o.accountId ?? null,
    salesChannel: o.salesChannel ?? null,
    ownerEmployeeId: personId(o.owner),
    creditedSalespersonId: personId(o.creditedSalesperson),
    accountableEmployeeId: personId(o.accountablePerson),
    operatingCompanyId: o.operatingCompanyId ?? null,
    stage: o.stage ?? null,
    outcome: o.outcome ?? null,
    need: o.need ?? null,
    expectedValue: o.expectedValue ?? null,
    expectedCloseAt: millisOf(o.expectedCloseAt),
    nextAction: o.nextAction ?? null,
    lines: Array.isArray(o.lines) ? o.lines.map((l) => ({ kind: l.kind, ref: l.ref, qty: l.qty })) : [],
    salesOrderId: o.salesOrder?.id ?? null,
    salesAgreementId: o.salesAgreement?.id ?? null,
    createdAtMillis: millisOf(o.createdAt),
    updatedAtMillis: millisOf(o.updatedAt),
    closedAtMillis: millisOf(o.closedAt),
    // THE CONCURRENCY TOKEN. A governed edit applies only `WHERE edit_version = expected`; the screens pass this back.
    editVersion: Number.isInteger(o.editVersion) ? o.editVersion : null,
  };
}

/** EOS getOpportunityDetail result -> the { status, opportunity, accountName, salesOrderNumber } context the page reads. */
export function toOpportunityContextResult(detail) {
  if (!detail) return { status: "not-found", opportunity: null, accountName: null, salesOrderNumber: null };
  return {
    status: "ready",
    opportunity: toOpportunityProjection(detail),
    accountName: detail.accountName ?? null,
    salesOrderNumber: detail.salesOrder?.number ?? null,
    salesAgreementNumber: detail.salesAgreement?.number ?? null,
  };
}

/** EOS SalesOrderDetail/Summary projection -> the Sales Order projection the screens read. */
export function toSalesOrderProjection(s) {
  if (!s || typeof s !== "object") return null;
  return {
    id: s.id,
    salesOrderNumber: s.salesOrderNumber ?? null,
    accountId: s.accountId ?? null,
    accountName: s.accountName ?? null,
    ownerEmployeeId: personId(s.owner),
    creditedSalespersonId: personId(s.creditedSalesperson),
    accountableEmployeeId: personId(s.accountablePerson),
    operatingCompanyId: s.operatingCompanyId ?? null,
    salesChannel: s.salesChannel ?? null,
    currency: s.currency ?? null,
    locationId: s.location?.locationId ?? null,
    locationName: s.location?.name ?? null,
    sourceOpportunityId: s.sourceOpportunity?.id ?? s.opportunityId ?? null,
    sourceAgreementId: s.sourceAgreement?.id ?? s.salesAgreementId ?? null,
    sourceOpportunityNumber: s.sourceOpportunity?.number ?? null,
    customerPO: s.customerPO ?? null,
    notes: s.notes ?? null,
    state: s.state ?? null,
    lines: Array.isArray(s.lines)
      ? s.lines.map((l) => ({
          lineId: `line-${l.lineNumber}`,
          kind: l.kind,
          ref: l.ref,
          businessUnitId: l.businessUnit ?? null,
          orderedQty: l.orderedQty,
          // Held downstream facts: not tracked in PostgreSQL yet (D2). Null, never zero.
          allocatedQty: null,
          fulfilledQty: null,
          billedQty: null,
          unitPriceMinor: l.unitPriceMinor ?? null,
          extendedMinor: l.extendedMinor ?? null,
        }))
      : [],
    serviceWorkOrderIds: [],
    serviceWorkOrders: [],
    totalMinor: s.totalMinor ?? null,
    pricingState: s.pricingState ?? null,
    unpricedLineCount: Number.isInteger(s.unpricedLineCount) ? s.unpricedLineCount : 0,
    bookedAtMillis: millisOf(s.bookedAt),
    createdAtMillis: millisOf(s.createdAt),
    updatedAtMillis: millisOf(s.updatedAt),
    downstreamTracked: false,
  };
}

/** EOS getSalesOrderDetail result -> the { status, salesOrder } context the page reads. */
export function toSalesOrderContextResult(detail) {
  if (!detail) return { status: "not-found", salesOrder: null };
  return { status: "ready", salesOrder: toSalesOrderProjection(detail) };
}

/**
 * EOS failure category -> the error status vocabulary the screens already branch on (the Firebase callable codes).
 * A version conflict stays distinguishable ("aborted") from a refused precondition ("failed-precondition").
 */
export function legacyErrorStatus(failure) {
  switch (failure?.code) {
    case "FORBIDDEN":
    case "UNAUTHENTICATED":
    case "NOT_SIGNED_IN":
      return "permission-denied";
    case "NOT_FOUND":
      return "not-found";
    case "INVALID_INPUT":
    case "UNKNOWN_OPERATION":
      return "invalid-argument";
    case "CONFLICT":
      return failure?.reason === "VERSION_CONFLICT" ? "aborted" : "already-exists";
    case "PRECONDITION_FAILED":
      return "failed-precondition";
    case "NOT_CONFIGURED":
      return "transport-not-ready";
    case "UNAVAILABLE":
    case "UNREACHABLE":
      return "unavailable";
    default:
      return "internal";
  }
}

/** The read-side status the detail hooks use: denied vs unavailable (and not-found as its own answer). */
export function readErrorStatus(failure) {
  const s = legacyErrorStatus(failure);
  if (s === "permission-denied") return "denied";
  if (s === "not-found") return "not-found";
  return "unavailable";
}

/**
 * EOS list page(s) -> the list envelope the Opportunity / Sales Order list consumers read
 * ({ status, opportunities | salesOrders, accountNameById, truncated }). `family` picks the list key and projection.
 */
export function toLegacyListPayload(family, items, truncated) {
  const rows = Array.isArray(items) ? items : [];
  const project = family === "opportunity" ? toOpportunityProjection : toSalesOrderProjection;
  const accountNameById = {};
  for (const r of rows) if (r && typeof r.accountId === "string" && typeof r.accountName === "string") accountNameById[r.accountId] = r.accountName;
  return {
    status: "ready",
    [family === "opportunity" ? "opportunities" : "salesOrders"]: rows.map(project),
    accountNameById,
    skipped: 0,
    truncated: truncated === true,
  };
}

/** Largest page the EOS Commercial lists serve (the server's governed Commercial read layer). */
export const EOS_COMMERCIAL_PAGE_MAX = 200;

/**
 * Read an EOS Commercial list, following the server's cursor up to `cap` rows. Returns `{ ok: true, items, truncated }`
 * or the transport's failure unchanged.
 */
export async function readCommercialList(client, operation, { accountId = null, cap = EOS_COMMERCIAL_PAGE_MAX } = {}) {
  const items = [];
  let cursor = null;
  for (;;) {
    const limit = Math.min(EOS_COMMERCIAL_PAGE_MAX, cap - items.length);
    const input = { limit, ...(accountId ? { accountId } : {}), ...(cursor ? { cursor } : {}) };
    const answer = await client.call(operation, { input });
    if (!answer.ok) return answer;
    const page = answer.result ?? {};
    items.push(...(Array.isArray(page.items) ? page.items : []));
    if (!page.truncated || !page.nextCursor) return { ok: true, items, truncated: false };
    if (items.length >= cap) return { ok: true, items, truncated: true };
    cursor = page.nextCursor;
  }
}

/** EOS SalesAgreementDetail projection -> the Sales Agreement projection the agreement screens read. */
export function toSalesAgreementProjection(a) {
  if (!a || typeof a !== "object") return null;
  const t = a.totals ?? {};
  return {
    id: a.id,
    salesAgreementNumber: a.salesAgreementNumber ?? null,
    state: a.state ?? null,
    accountId: a.accountId ?? null,
    accountName: a.accountName ?? null,
    ownerEmployeeId: personId(a.owner),
    creditedSalespersonId: personId(a.creditedSalesperson),
    accountableEmployeeId: personId(a.accountablePerson),
    operatingCompanyId: a.operatingCompanyId ?? null,
    locationId: a.location?.locationId ?? null,
    currency: a.currency ?? null,
    customerPO: a.customerPO ?? null,
    isLease: a.isLease === true,
    fulfillmentIntent: a.fulfillmentIntent ?? null,
    shippingInstructions: a.shippingInstructions ?? null,
    shipVia: a.shipVia ?? null,
    specialInstructions: a.specialInstructions ?? null,
    lines: Array.isArray(a.lines)
      ? a.lines.map((l) => ({
          lineId: `line-${l.lineNumber}`,
          kind: l.kind ?? null,
          ref: l.ref ?? null,
          businessUnitId: l.businessUnit ?? null,
          quantity: Number.isInteger(l.quantity) ? l.quantity : null,
          unitPriceMinor: l.unitPriceMinor ?? null,
          extendedMinor: l.extendedMinor ?? null,
          condition: l.condition ?? null,
          warranty: l.warranty ?? null,
          estimatedArrivalMillis: millisOf(l.estimatedArrivalAt),
        }))
      : [],
    subtotalMinor: t.subtotalMinor ?? null,
    shippingMinor: t.shippingMinor ?? null,
    installChargeMinor: t.installChargeMinor ?? null,
    taxMinor: t.taxMinor ?? null,
    // DECISIONS #197: the tax's EVIDENCE travels with it. Absent evidence (an older backend) is not a determination.
    taxEvidenceStatus: a.taxEvidence?.status ?? null,
    taxEvidenceAmountMinor: a.taxEvidence?.amountMinor ?? null,
    totalMinor: t.totalMinor ?? null,
    downPaymentMinor: t.downPaymentMinor ?? null,
    tradeInMinor: t.tradeInMinor ?? null,
    balanceMinor: t.balanceMinor ?? null,
    sourceOpportunityId: a.sourceOpportunity?.id ?? a.opportunityId ?? null,
    salesOrderId: a.salesOrder?.id ?? null,
    acceptedAtMillis: millisOf(a.acceptedAt),
    acceptedByUid: null, // EOS records the accepting PRINCIPAL (acceptedByPrincipalId), never a Firebase uid
    acceptedByPrincipalId: a.acceptedByPrincipalId ?? null,
    createdAtMillis: millisOf(a.createdAt),
    updatedAtMillis: millisOf(a.updatedAt),
  };
}

/** EOS getSalesAgreementDetail result -> the { status, salesAgreement } read result the agreement seam consumes. */
export function toSalesAgreementReadResult(detail) {
  if (!detail) return { status: "not-found", salesAgreement: null };
  return { status: "ready", salesAgreement: toSalesAgreementProjection(detail) };
}
