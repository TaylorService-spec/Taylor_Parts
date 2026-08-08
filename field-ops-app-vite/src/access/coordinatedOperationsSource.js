// Coordinated-operations SOURCE seam — the ONE boundary between "where coordinated Work-Order / field-signal
// data comes from" and the projections/hooks/UI above it. READ-FIRST on SYNTHETIC fixtures today; a governed
// read model (a listener over fieldops_wos filtered to salesOrderId-bearing Work Orders + the WO parts-
// readiness projection + Scheduling/assignment reads) replaces the default source later WITHOUT touching the
// projection or the surfaces. A source is a plain function returning a snapshot:
//   { status, workOrders, fieldSignalsByWorkOrderId, operationalContextByWorkOrderId,
//     accountNameById, locationNameById, salesOrderLabelById }.
//
// status: "ready" (data present) | "unavailable" (no source wired / disabled) | "error". The synthetic source
// is the default so the surfaces render today; swapping to governed = pass a different source into the hook
// (or change DEFAULT_COORDINATED_OPERATIONS_SOURCE) — nothing else changes.

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

// Explicitly-empty source for the "no governed source wired yet" state — lets the UI render an honest
// "not connected" surface instead of pretending there are zero coordinated visits.
export function inertCoordinatedOperationsSource() {
  return {
    status: "unavailable",
    synthetic: false,
    workOrders: [],
    fieldSignalsByWorkOrderId: {},
    operationalContextByWorkOrderId: {},
    accountNameById: {},
    locationNameById: {},
    salesOrderLabelById: {},
    error: null,
  };
}

// The default the surfaces use today. Centralized so the synthetic→governed swap is a one-line change.
export const DEFAULT_COORDINATED_OPERATIONS_SOURCE = syntheticCoordinatedOperationsSource;
