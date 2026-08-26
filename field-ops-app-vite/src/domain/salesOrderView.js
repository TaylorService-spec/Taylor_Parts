// Sales Order — PURE view-model for the trusted `getSalesOrderContext` read
// (functions/src/salesOrder/salesOrderReadService.ts). No Firebase import, unit-testable in
// Node. Distinct honest states: loading / denied / unavailable / not-found / ready — never
// renders denied as empty, never renders not-found (a real answer) the same as unavailable
// (a read failure).
//
// Minimum usable Sales Order view per Owner direction (2026-08-15): identity, account,
// originating Opportunity, lifecycle state, lines (ordered/allocated/fulfilled/billed),
// service/Work Order lineage. Invents no pricing policy, no quote state, no
// operatingCompanyId, no Ventana/D-5 semantics — renders only what the projection supplies.

export const SALES_ORDER_VIEW_STATE = Object.freeze({
  LOADING: "loading",
  DENIED: "denied",
  UNAVAILABLE: "unavailable",
  NOT_FOUND: "not-found",
  READY: "ready",
});

const STATE_TONE = Object.freeze({
  CONFIRMED: "info",
  IN_FULFILLMENT: "attention",
  FULFILLED: "positive",
  CLOSED: "muted",
  CANCELLED: "critical",
});

export function salesOrderStateTone(state) {
  return STATE_TONE[state] ?? "unknown";
}

function lineView(line) {
  const remaining = Math.max(0, (line.orderedQty ?? 0) - (line.fulfilledQty ?? 0));
  return {
    key: line.lineId,
    kind: line.kind,
    ref: line.ref,
    orderedQty: line.orderedQty,
    allocatedQty: line.allocatedQty,
    fulfilledQty: line.fulfilledQty,
    billedQty: line.billedQty,
    remainingQty: remaining,
    fullyFulfilled: remaining === 0,
  };
}

// Build the render-ready view from the callable's raw result ({status, salesOrder}) or a
// transport-level error status. `result` is null while still loading.
export function salesOrderView({ loading = false, errorStatus = null, result = null } = {}) {
  if (loading) return { kind: SALES_ORDER_VIEW_STATE.LOADING };
  if (errorStatus) return { kind: errorStatus };
  if (!result) return { kind: SALES_ORDER_VIEW_STATE.UNAVAILABLE };
  if (result.status === "not-found") return { kind: SALES_ORDER_VIEW_STATE.NOT_FOUND };
  if (result.status !== "ready" || !result.salesOrder) return { kind: SALES_ORDER_VIEW_STATE.UNAVAILABLE };

  const so = result.salesOrder;
  const lines = Array.isArray(so.lines) ? so.lines.map(lineView) : [];
  return {
    kind: SALES_ORDER_VIEW_STATE.READY,
    id: so.id,
    // The governed business reference (SO-YYYY-######), allocated server-side at creation. Null
    // on Sales Orders that predate numbering -- honestly null. `id` remains available for routing
    // only; it must never stand in for this as displayed identity (DECISIONS #106).
    salesOrderNumber: so.salesOrderNumber ?? null,
    accountId: so.accountId,
    sourceOpportunityId: so.sourceOpportunityId,
    // The accepted Sales Agreement this order fulfils. Carried through here rather than left on
    // the server projection for the same reason the money was: a field the view model drops is a
    // field the screen can never show, however faithfully the server returns it.
    sourceAgreementId: so.sourceAgreementId ?? null,
    // Carried through so the detail page can label the lineage link with a reference
    // rather than a document id. Null on Sales Orders predating Opportunity identity.
    sourceOpportunityNumber: so.sourceOpportunityNumber ?? null,
    ownerEmployeeId: so.ownerEmployeeId,
    salesChannel: so.salesChannel,
    locationId: so.locationId ?? null,
    // ════════════ THE MONEY, WHICH THIS VIEW MODEL WAS SILENTLY DROPPING ════════════
    //
    // The server projection has returned totalMinor / currency / pricingState since the Sales
    // Order money work, and this function carried NONE of them through. Every consumer therefore
    // read `view.totalMinor` as undefined and rendered an em dash — on orders that are fully
    // priced. The stored data was right, the callable was right, and the value never crossed
    // this line.
    //
    // It is the exact failure this programme keeps finding: a value asserted at one layer and
    // never proved to arrive at the next. SO-2026-000001 carries unitPrice 5000 and displayed
    // no dollars. `currency` and `locationId` were being dropped the same way, which is why the
    // record page showed "—" for both.
    currency: so.currency ?? null,
    totalMinor: typeof so.totalMinor === "number" ? so.totalMinor : null,
    // PRICED / PARTIALLY_PRICED / UNPRICED / NO_LINES. Carried so a reader is told WHY there is
    // no total, instead of being shown a blank they have to interpret.
    pricingState: so.pricingState ?? null,
    unpricedLineCount: typeof so.unpricedLineCount === "number" ? so.unpricedLineCount : null,
    // ═══ THE TWO TIMES THE ORDER ACTUALLY RECORDS ═══
    //
    // The server has projected these since the read service was corrected, and its own comment
    // predicted the defect would surface "the first time a timestamp was displayed". This is that
    // first time: the North Star lifecycle band needs a creation time for the Confirmed stage, and
    // it would have read `undefined` through this view model exactly as the money did.
    //
    // ONLY TWO EXIST. There is no confirmedAt, allocatedAt, fulfilledAt, closedAt or cancelledAt on
    // a Sales Order document. `updatedAt` is the time of the LAST WRITE OF ANY KIND and must never
    // be presented as a stage time (ND-8) -- domain/salesOrderNorthStar.js states that in words
    // rather than borrowing it.
    createdAtMillis: typeof so.createdAtMillis === "number" ? so.createdAtMillis : null,
    updatedAtMillis: typeof so.updatedAtMillis === "number" ? so.updatedAtMillis : null,
    state: so.state,
    tone: salesOrderStateTone(so.state),
    customerPO: so.customerPO,
    notes: so.notes,
    lines,
    allLinesFulfilled: lines.length > 0 && lines.every((l) => l.fullyFulfilled),
    serviceWorkOrderIds: Array.isArray(so.serviceWorkOrderIds) ? so.serviceWorkOrderIds : [],
    // THE SAME LINEAGE, CARRYING A READABLE REFERENCE.
    //
    // Built from the ids so the surface ALWAYS has one entry per linked Work Order, whether or not
    // the projection resolved a number for it — and never has to reach for the id to fill a gap.
    //
    // COMPATIBLE WITH THE PROJECTION CURRENTLY DEPLOYED, which returns no `serviceWorkOrders` at
    // all: every entry then carries workOrderNumber null and the surface says so truthfully. When
    // the read service ships, the same code shows real WO-YYYY-###### references with no further
    // change here.
    serviceWorkOrders: (Array.isArray(so.serviceWorkOrderIds) ? so.serviceWorkOrderIds : []).map((workOrderId) => {
      const resolved = Array.isArray(so.serviceWorkOrders)
        ? so.serviceWorkOrders.find((w) => w?.workOrderId === workOrderId)
        : null;
      return { workOrderId, workOrderNumber: resolved?.workOrderNumber ?? null };
    }),
  };
}
