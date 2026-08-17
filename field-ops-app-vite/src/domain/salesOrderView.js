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
    accountId: so.accountId,
    sourceOpportunityId: so.sourceOpportunityId,
    // Carried through so the detail page can label the lineage link with a reference
    // rather than a document id. Null on Sales Orders predating Opportunity identity.
    sourceOpportunityNumber: so.sourceOpportunityNumber ?? null,
    ownerEmployeeId: so.ownerEmployeeId,
    salesChannel: so.salesChannel,
    state: so.state,
    tone: salesOrderStateTone(so.state),
    customerPO: so.customerPO,
    notes: so.notes,
    lines,
    allLinesFulfilled: lines.length > 0 && lines.every((l) => l.fullyFulfilled),
    serviceWorkOrderIds: Array.isArray(so.serviceWorkOrderIds) ? so.serviceWorkOrderIds : [],
  };
}
