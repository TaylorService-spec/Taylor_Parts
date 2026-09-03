// Operations dashboard -- one-shot reads only (getDocs, not onSnapshot),
// same precedent as firebase/collectionStore.js's list() and
// AuthContext's role lookup. These seven collections are all
// Cloud-Function-only writes (firestore.rules denies create/update/
// delete unconditionally) -- this file never writes to any of them,
// it only reads what an admin/dispatcher is allowed to see.
import { collection, getDocs, query, where, documentId, orderBy, limit, Timestamp } from "firebase/firestore";
import { db } from "../firebase/firebase";
import {
  REORDER_REQUESTS_COLLECTION as LIVE_REORDER_REQUESTS_COLLECTION,
  REORDER_REQUEST_STATUS,
  PURCHASE_ORDERS_COLLECTION as LIVE_REORDER_PURCHASE_ORDERS_COLLECTION,
} from "../domain/constants";
import { buildPurchaseOrdersView } from "../domain/purchaseOrdersView.js";

const INVENTORY_TRANSACTIONS_COLLECTION = "inventory_transactions";
const WAREHOUSES_COLLECTION = "warehouses";
const TRANSFER_ORDERS_COLLECTION = "transfer_orders";
const SUPPLIERS_COLLECTION = "suppliers";
const SUPPLIER_CATALOG_COLLECTION = "supplier_catalog";
const PURCHASE_ORDERS_COLLECTION = "purchase_orders";

export interface RawInventoryTransaction {
  id: string;
  workOrderId: string;
  partId: string;
  type: "RESERVED" | "RELEASED" | "CONSUMED";
  quantity: number;
  timestamp: Timestamp;
}

export interface RawWarehouse {
  id: string;
  name: string;
  location: string;
  status?: string; // governed §3A status (ACTIVE/INACTIVE); present at runtime, consumed by the Warehouses workspace
}

export interface RawTransferOrder {
  id: string;
  partId: string;
  quantity: number;
  fromWarehouseId: string;
  toWarehouseId: string;
  status: "REQUESTED" | "IN_TRANSIT" | "COMPLETED" | "CANCELLED";
}

export interface RawSupplier {
  id: string;
  name: string;
  // Governed Supplier Master fields (functions/src/supplierMaster/*). Optional here because the
  // client read cannot re-run the backend governed validator and legacy Epic-5 demo docs predate
  // governance; the Suppliers workspace surfaces a missing `status` honestly as "ungoverned".
  status?: string; // "ACTIVE" | "INACTIVE"
  normalizedKey?: string;
  version?: number;
  vendorNumber?: string;
  contactName?: string;
  phone?: string;
  email?: string;
  address?: string;
  paymentTermsRef?: string;
  notes?: string;
  // Legacy Epic-5 demo fields retained (optional) for the Operations ProcurementPanel consumer.
  contactEmail?: string;
  leadTimeDays?: number;
}

export interface RawSupplierCatalogItem {
  id: string;
  supplierId: string;
  partId: string;
  unitPrice: number;
  available: boolean;
}

export interface RawPurchaseOrder {
  id: string;
  supplierId: string;
  status: "DRAFT" | "APPROVED" | "SENT" | "RECEIVED" | "CANCELLED";
  items: { partId: string; quantity: number; unitPrice: number }[];
  totalCost: number;
}

async function listCollection<T>(name: string): Promise<T[]> {
  const snap = await getDocs(collection(db, name));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T);
}

/**
 * Default cap for BOUNDED list reads. Generous enough that no current dataset truncates,
 * so adopting it is behaviour-preserving today.
 */
export const LIST_READ_CAP = 200;

/**
 * A bounded, ordered read of one collection, plus an honest truncation flag.
 *
 * DELIBERATELY A SEPARATE FUNCTION RATHER THAN A CAP ON listCollection(), and this is the
 * whole point of the change. Every unbounded fetcher here has TWO kinds of consumer:
 *
 *   list surfaces  -- Warehouses, Suppliers, Transfers: a page of rows is an honest page
 *   the Operations dashboard -- which NETS these into availableStock, reconciliation
 *                               positions and consumption totals
 *
 * Capping the shared factory would have bounded both, and a total computed over a
 * truncated input is not "partial" -- it is WRONG, presented as complete. That is a worse
 * outcome than the unbounded read it replaces, because an unbounded read is slow and
 * honest while a silently-netted-over-a-page total is fast and false.
 *
 * So the bound lives at the CALL SITE. List surfaces adopt this; the dashboard keeps the
 * unbounded fetcher and stays recorded as blocked on an authoritative aggregate.
 */
export async function listCollectionPage<T>(
  name: string,
  { cap = LIST_READ_CAP, orderByField = "name" }: { cap?: number; orderByField?: string } = {},
): Promise<{ items: T[]; truncated: boolean }> {
  // cap + 1: the extra row is the truncation probe, matching the convention the trusted
  // read callables and the metadata list runtime already use.
  const snap = await getDocs(query(collection(db, name), orderBy(orderByField), limit(cap + 1)));
  const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T);
  const truncated = docs.length > cap;
  return { items: truncated ? docs.slice(0, cap) : docs, truncated };
}

/** Bounded variants for LIST surfaces. The unbounded originals remain for aggregate consumers. */
export const fetchWarehousesPage = (opts?: { cap?: number }) =>
  listCollectionPage<RawWarehouse>(WAREHOUSES_COLLECTION, { ...opts, orderByField: "name" });

export const fetchSuppliersPage = (opts?: { cap?: number }) =>
  listCollectionPage<RawSupplier>(SUPPLIERS_COLLECTION, { ...opts, orderByField: "name" });

// EI-P1c-2: a dedicated transfer-order read that preserves the authoritative Firestore
// document id SEPARATELY from the stored data, so the transfer-order adapter can compare
// them and fail closed on a stored-id conflict (never merge/override). This is the ONLY
// read that keeps id out of data; the generic listCollection above is unchanged.
export interface TransferOrderDoc {
  docId: string;
  data: Record<string, unknown>;
}
export const fetchTransferOrderDocs = async (): Promise<TransferOrderDoc[]> => {
  const snap = await getDocs(collection(db, TRANSFER_ORDERS_COLLECTION));
  return snap.docs.map((d) => ({ docId: d.id, data: d.data() as Record<string, unknown> }));
};

// X-TRANSFER-ORDERS-UNBOUNDED-READ remediation: a bounded, ordered read of transfer_orders in
// the SAME { docId, data } shape as fetchTransferOrderDocs above (docId kept separate from the
// stored data so the transfer-order adapter can still fail closed on a stored-id conflict),
// plus an honest truncation flag. Ordered by documentId() -- transfer orders have no natural
// display-name field the way warehouses/suppliers do, so the authoritative id is the only
// stable ordering available.
//
// DELIBERATELY A SEPARATE FUNCTION FROM fetchTransferOrderDocs, for the identical reason
// listCollectionPage exists as a sibling of listCollection above: fetchTransferOrderDocs also
// feeds the Operations dashboard's WarehousePanel Transfer Orders table (modules/operations/
// Operations.jsx), which this remediation deliberately does not touch. The bound lives at the
// LIST-SURFACE call site (Inventory > Transfers, hooks/useTransferOrders.js), never the shared
// unbounded fetcher, matching the fetchWarehouses/fetchWarehousesPage and
// fetchSuppliers/fetchSuppliersPage precedent above.
export const fetchTransferOrderDocsPage = async (
  { cap = LIST_READ_CAP }: { cap?: number } = {},
): Promise<{ items: TransferOrderDoc[]; truncated: boolean }> => {
  const snap = await getDocs(
    query(collection(db, TRANSFER_ORDERS_COLLECTION), orderBy(documentId()), limit(cap + 1)),
  );
  const docs = snap.docs.map((d) => ({ docId: d.id, data: d.data() as Record<string, unknown> }));
  const truncated = docs.length > cap;
  return { items: truncated ? docs.slice(0, cap) : docs, truncated };
};

export const fetchInventoryTransactions = () => listCollection<RawInventoryTransaction>(INVENTORY_TRANSACTIONS_COLLECTION);
export const fetchWarehouses = () => listCollection<RawWarehouse>(WAREHOUSES_COLLECTION);
export const fetchTransferOrders = () => listCollection<RawTransferOrder>(TRANSFER_ORDERS_COLLECTION);
export const fetchSuppliers = () => listCollection<RawSupplier>(SUPPLIERS_COLLECTION);
export const fetchSupplierCatalog = () => listCollection<RawSupplierCatalogItem>(SUPPLIER_CATALOG_COLLECTION);
export const fetchPurchaseOrders = () => listCollection<RawPurchaseOrder>(PURCHASE_ORDERS_COLLECTION);

// INV-CONVERGENCE-E Stage A completion -- one-shot read-only lists of the reorder
// workflow collections for the shadow-parity diagnostic. These two collections ARE
// client-writable elsewhere (the reorder lifecycle), but this file only READS them
// (getDocs, no subscription, no filter/index/query-shape change). The PO list is the
// LIVE `reorder_purchase_orders`, NOT the dormant Epic-5 `purchase_orders` above.
const REORDER_REQUESTS_COLLECTION = "reorder_requests";
const REORDER_PURCHASE_ORDERS_COLLECTION = "reorder_purchase_orders";

export interface RawReorderRequest { id: string; partId: string; status: string; }
export interface RawReorderPurchaseOrder { id: string; partId: string; status: string; }

export const fetchReorderRequests = () => listCollection<RawReorderRequest>(REORDER_REQUESTS_COLLECTION);
export const fetchReorderPurchaseOrders = () => listCollection<RawReorderPurchaseOrder>(REORDER_PURCHASE_ORDERS_COLLECTION);

// site-work r4 item A: the Operations dashboard's Procurement panel was reading the
// dormant Epic-5 `purchase_orders` collection above (fetchPurchaseOrders) -- its only
// writer is a demo seed script, no deployed callable writes it, so the panel was
// permanently empty/stale. The LIVE purchase orders (written by
// domain/reorderPurchaseOrders.js's recordPurchaseOrder()/voidPurchaseOrder()) live in
// `reorder_purchase_orders`, keyed 1:1 by reorderRequestId, exactly as Purchasing >
// Purchase Orders (modules/purchasing/PurchaseOrders.jsx) already reads them.
//
// This reuses that same read shape and the SAME pure field-mapping domain module
// (domain/purchaseOrdersView.js's buildPurchaseOrdersView/buildPurchaseOrderRow --
// already unit-tested in test/purchaseOrdersView.test.mjs) instead of inventing a
// second mapping -- only the read mechanics differ: PurchaseOrders.jsx subscribes live
// via a live onSnapshot subscription (hooks/useReorderRequestsByStatuses.js, hooks/usePurchaseOrdersByIds.js),
// this is a one-shot getDocs read, matching every other fetch* in this file (module
// header comment above: "one-shot reads only").
const PROCUREMENT_PO_REQUEST_STATUSES = [
  REORDER_REQUEST_STATUS.ORDERED,
  REORDER_REQUEST_STATUS.RECEIVED,
  REORDER_REQUEST_STATUS.VOIDED,
];

function chunkIds(ids: string[], size: number): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

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
  const requestsSnap = await getDocs(
    query(collection(db, LIVE_REORDER_REQUESTS_COLLECTION), where("status", "in", PROCUREMENT_PO_REQUEST_STATUSES))
  );
  const requests = requestsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Record<string, unknown> & { id: string });

  const ids = requests.map((r) => r.id);
  const purchaseOrdersById: Record<string, Record<string, unknown>> = {};
  for (const idChunk of chunkIds(ids, 10)) {
    if (idChunk.length === 0) continue;
    const snap = await getDocs(
      query(collection(db, LIVE_REORDER_PURCHASE_ORDERS_COLLECTION), where(documentId(), "in", idChunk))
    );
    snap.forEach((d) => {
      purchaseOrdersById[d.id] = { id: d.id, ...d.data() };
    });
  }

  const view = buildPurchaseOrdersView({
    requestsRead: { data: requests, loading: false, error: null },
    purchaseOrdersRead: { purchaseOrdersById, loading: false, error: null },
  });
  return view.rows as ProcurementPurchaseOrderRow[];
};
