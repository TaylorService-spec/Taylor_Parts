// Account-scoped Sales Orders — PURE view-model for the trusted `listSalesOrdersForAccount` read
// (functions/src/salesOrder/salesOrderReadService.ts). No Firebase import, unit-testable in Node.
// Wave 7 completion PART 3.
//
// Distinct honest states: loading / denied / unavailable / empty / ready -- same contract as
// domain/accountOpportunitiesView.js. EMPTY renders ONLY for a genuinely succeeded ("ready") read with
// zero rows; denied/unavailable are never relabeled as empty. Never renders a price: PR #991
// deliberately stripped unitPrice from the underlying projection, and this view adds no amount of its
// own -- only a bounded service-lineage indicator (serviceWorkOrderIds.length) is authoritative here.

import { salesOrderStateTone } from "./salesOrderView.js";

export const ACCOUNT_SALES_ORDERS_STATE = Object.freeze({
  LOADING: "loading",
  DENIED: "denied",
  UNAVAILABLE: "unavailable",
  EMPTY: "empty",
  READY: "ready",
});

// Build the render-ready view from the callable's raw result ({status, salesOrders, skipped,
// truncated}) or a transport-level error status. `result` is null while still loading or on failure.
export function accountSalesOrdersView({ loading = false, errorStatus = null, result = null } = {}) {
  if (loading) return { kind: ACCOUNT_SALES_ORDERS_STATE.LOADING };
  if (errorStatus) return { kind: errorStatus };
  if (!result || result.status !== "ready") return { kind: ACCOUNT_SALES_ORDERS_STATE.UNAVAILABLE };

  const salesOrders = Array.isArray(result.salesOrders) ? result.salesOrders : [];
  const truncated = result.truncated === true;
  const skipped = typeof result.skipped === "number" ? result.skipped : 0;

  if (salesOrders.length === 0) {
    return { kind: ACCOUNT_SALES_ORDERS_STATE.EMPTY };
  }

  return {
    kind: ACCOUNT_SALES_ORDERS_STATE.READY,
    truncated,
    skipped,
    rows: salesOrders.map((so) => {
      const serviceWorkOrderIds = Array.isArray(so.serviceWorkOrderIds) ? so.serviceWorkOrderIds : [];
      return {
        key: so.id,
        id: so.id,
        // The order id is the only stable identifier the projection carries -- customerPO is an
        // external reference, not a substitute order number, so it is surfaced separately, not blended
        // into the identifier.
        customerPO: so.customerPO,
        state: so.state,
        tone: salesOrderStateTone(so.state),
        ownerEmployeeId: so.ownerEmployeeId,
        updatedAtMillis: so.updatedAtMillis,
        serviceWorkOrderCount: serviceWorkOrderIds.length,
        hasServiceLineage: serviceWorkOrderIds.length > 0,
      };
    }),
  };
}
