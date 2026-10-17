// Operations dashboard + shadow-parity reads of the GOVERNED PostgreSQL Reorder authority. No Firebase import: this file
// is the EOS half of what services/operationsQueries.ts used to hold (Firebase exit F2-remainder). It is why the Operations
// dashboard no longer pulls the Firestore SDK in through an import: the two Firestore reads that remain (warehouses for the
// racking planner, the inventory_transactions diagnostic) stay in operationsQueries.ts for the builds where Firebase is
// the sole source.
import { REORDER_REQUEST_STATUS } from "../domain/constants";
import { buildPurchaseOrdersView } from "../domain/purchaseOrdersView.js";
import { reorderApiClient } from "./reorderApiClient.js";
import { fetchReorderPurchaseOrdersByIds } from "./reorderPurchaseOrderReads.js";

// INV-CONVERGENCE-E Stage A completion -- one-shot read-only lists of the reorder
// workflow objects for the shadow-parity diagnostic (modules/inventory/partsShadowParityReaders.js).
// Both sides read the GOVERNED PostgreSQL Reorder authority: a parity diagnostic that still read the
// retired Firestore source would be comparing the new world against a snapshot nobody writes to any
// more, and would report drift forever. The PO list is the Reorder Purchase Order, NOT the dormant
// Epic-5 `purchase_orders`.
export interface RawReorderRequest { id: string; partId: string; status: string; }
export interface RawReorderPurchaseOrder { id: string; partId: string; status: string; }

const readReorderQueueOrThrow = async (input?: Record<string, unknown>): Promise<(Record<string, unknown> & { id: string })[]> => {
  const res = await reorderApiClient.call("readReorderQueue", input);
  if (!res.ok) {
    // Thrown rather than returned empty: an empty list and an unreadable one are different facts.
    const err = new Error(res.message ?? "the Reorder requests could not be read");
    (err as Error & { code?: string }).code = res.reason ?? res.code;
    throw err;
  }
  return (Array.isArray(res.result) ? res.result : []) as (Record<string, unknown> & { id: string })[];
};

const readPurchaseOrdersOrThrow = async (ids: string[]): Promise<Record<string, Record<string, unknown>>> => {
  const res = await fetchReorderPurchaseOrdersByIds(ids);
  if (!res.ok) {
    const err = new Error("the Reorder purchase orders could not be read");
    (err as Error & { code?: string }).code = res.error;
    throw err;
  }
  return res.purchaseOrdersById as Record<string, Record<string, unknown>>;
};

export const fetchReorderRequests = async (): Promise<RawReorderRequest[]> =>
  (await readReorderQueueOrThrow()) as unknown as RawReorderRequest[];

// The purchase orders of the Reorder Requests the caller's governed queue reach covers -- the same
// population fetchReorderRequests returns, so the two sides of the diagnostic describe one set.
export const fetchReorderPurchaseOrders = async (): Promise<RawReorderPurchaseOrder[]> => {
  const requests = await readReorderQueueOrThrow();
  const byId = await readPurchaseOrdersOrThrow(requests.map((r) => r.id));
  return Object.values(byId).map((po) => ({
    id: String(po.id), partId: String(po.partId), status: String(po.status),
  }));
};

// site-work r4 item A: the Operations dashboard's Procurement panel was reading the
// dormant Epic-5 `purchase_orders` collection -- its only writer is a demo seed script, no deployed callable writes
// it, so the panel was permanently empty/stale. The LIVE purchase orders are the Reorder Purchase Orders, keyed 1:1 by
// reorderRequestId, exactly as Purchasing > Purchase Orders (modules/purchasing/PurchaseOrders.jsx)
// reads them -- and, since the Reorder activation, read from the governed PostgreSQL authority.
//
// This reuses the SAME pure field-mapping domain module (domain/purchaseOrdersView.js's
// buildPurchaseOrdersView/buildPurchaseOrderRow -- already unit-tested in
// test/purchaseOrdersView.test.mjs) instead of inventing a second mapping.
const PROCUREMENT_PO_REQUEST_STATUSES = [
  REORDER_REQUEST_STATUS.ORDERED,
  REORDER_REQUEST_STATUS.RECEIVED,
  REORDER_REQUEST_STATUS.VOIDED,
];

export interface ProcurementPurchaseOrderRow {
  reorderRequestId: string;
  purchaseOrderId: string | null;
  partId: string | null;
  supplierName: string | null;
  externalPoNumber: string | null;
  orderedQuantity: number | null;
  orderedDate: string | null;
  expectedArrivalDate: string | null;
  orderedByUserId: string | null;
  orderedAt: number | null;
  viewStatus: string;
  isReceiptCandidate: boolean;
  receiptSource: { type: string; reorderRequestId: string; purchaseOrderId: string } | null;
}

export const fetchProcurementPurchaseOrders = async (): Promise<ProcurementPurchaseOrderRow[]> => {
  // BOTH SIDES COME FROM THE GOVERNED POSTGRESQL REORDER AUTHORITY: the Reorder Requests from
  // readReorderQueue and their purchase orders from readReorderPurchaseOrders. At the Reorder
  // activation the Firestore reorder_purchase_orders collection became a frozen snapshot, so it is
  // no longer read here at all. A failed read of either is thrown, never returned empty: an empty
  // procurement panel and an unreadable one are different facts, and the caller renders a failure.
  const requests = await readReorderQueueOrThrow({ statuses: PROCUREMENT_PO_REQUEST_STATUSES });
  const purchaseOrdersById = await readPurchaseOrdersOrThrow(requests.map((r) => r.id));

  const view = buildPurchaseOrdersView({
    requestsRead: { data: requests, loading: false, error: null },
    purchaseOrdersRead: { purchaseOrdersById, loading: false, error: null },
  });
  return view.rows as ProcurementPurchaseOrderRow[];
};
