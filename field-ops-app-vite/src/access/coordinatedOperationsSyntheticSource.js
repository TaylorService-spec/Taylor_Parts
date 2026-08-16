// Coordinated-operations SYNTHETIC source — TEST/STORY-ONLY. Split out of access/coordinatedOperationsSource.js
// (2026-08-15 fidelity fix — see that file's header) so the PRODUCTION module structurally CANNOT import
// synthetic fixtures, even by accident: nothing under src/modules, src/App.jsx, or any other production
// call site may import this file — only test/story code should. This is what makes "the production default
// is not synthetic" a STRUCTURAL fact (provable by grepping coordinatedOperationsSource.js for this
// module's name) rather than a naming convention someone could quietly regress.
//
// A source is a plain function returning a snapshot:
//   { status, workOrders, fieldSignalsByWorkOrderId, operationalContextByWorkOrderId,
//     accountNameById, locationNameById, salesOrderLabelById, error }.

import {
  COORDINATED_WORK_ORDERS,
  COORDINATED_FIELD_SIGNALS,
  COORDINATED_OPERATIONAL_CONTEXT,
  COORDINATED_ACCOUNT_NAMES,
  COORDINATED_LOCATION_NAMES,
  COORDINATED_SALES_ORDER_LABELS,
} from "../data/coordinatedOperationsFixtures.js";

// Synthetic, in-memory source. Read-only by construction: returns copies, exposes no writer. Nothing here (or
// downstream) creates warehouse demand, reserves inventory, writes Work Order state, or touches an invoice.
// Inject this explicitly (`<CoordinatedVisitsWorkspace source={syntheticCoordinatedOperationsSource} />`) in
// tests and stories that want the sample C713×5 scenario -- production never does.
export function syntheticCoordinatedOperationsSource() {
  return {
    status: "ready",
    synthetic: true,
    workOrders: COORDINATED_WORK_ORDERS.map((w) => ({ ...w })),
    fieldSignalsByWorkOrderId: { ...COORDINATED_FIELD_SIGNALS },
    operationalContextByWorkOrderId: { ...COORDINATED_OPERATIONAL_CONTEXT },
    accountNameById: { ...COORDINATED_ACCOUNT_NAMES },
    locationNameById: { ...COORDINATED_LOCATION_NAMES },
    salesOrderLabelById: { ...COORDINATED_SALES_ORDER_LABELS },
    error: null,
  };
}
