// Operations reads -- one-shot, read-only, and NO LONGER A DIRECT-FIRESTORE ESCAPE HATCH.
//
// ════════════════════ WHAT THIS FILE USED TO BE ════════════════════
//
// A generic listCollection(name) over eight collections, with firestore.rules deciding who saw
// what from users/{uid}.role. Anything could be added to it by passing another string, which is
// exactly the property that makes a helper like this outlive the decision that authorized it.
//
// Every read now names an EOS SOURCE ID -- never a collection, a field, an operator, an orderBy
// or a raw cursor -- and the server resolves that source's own capability. EACH RESOURCE KEEPS
// ITS OWN AUTHORITY: warehouse.record.read, supplier.record.read, supplier.catalog.read,
// warehouse.transferOrder.read, inventory.transaction.read, reorder.request.read.queue,
// reorder.purchaseOrder.read and supplier.purchaseOrder.read. There is deliberately no single
// operations-wide read capability: one capability spanning eight resources would grant the
// Suppliers workspace to anyone who could see a warehouse.
//
// ════════════════════ BOUNDED LIST vs COMPLETE AGGREGATE ════════════════════
//
// The distinction this file already drew is PRESERVED, and it is why two kinds of fetcher still
// stand side by side:
//
//   list surfaces     Warehouses, Suppliers, Transfers -- one bounded page plus an honest
//                     truncated flag. A page is a truthful answer to a list.
//   netting consumers available stock, reconciliation positions, consumption totals, the
//                     operational overview -- the COMPLETE population, paged to exhaustion.
//
// Capping the shared reader would have bounded both, and a total computed over a truncated input
// is not partial: it is wrong, presented as complete, which is worse than a slow honest read.
// readAllGoverned FAILS rather than truncating, so a complete-population read cannot quietly
// degrade into a partial one.
import { governedCollectionClient, READ_RESULT } from "../access/governedCollectionClient";
import { REORDER_REQUEST_STATUS } from "../domain/constants";
import { buildPurchaseOrdersView } from "../domain/purchaseOrdersView.js";

// EOS source ids, not collection names. The server owns the mapping from these to storage, and
// the pairs below differ only in ordering: the *_PAGE sources carry the display ordering a list
// surface wants, the complete-population sources are ordered by document id because orderBy
// silently excludes documents missing the ordered field -- which is invisible in a page and
// catastrophic in a total.
const SOURCE_INVENTORY_TRANSACTIONS = "inventoryTransactionLedger";
const SOURCE_WAREHOUSES_COMPLETE = "warehouseDirectory";
const SOURCE_WAREHOUSES_PAGE = "metadataWarehouses";
const SOURCE_TRANSFER_ORDERS_COMPLETE = "transferOrderDirectory";
const SOURCE_TRANSFER_ORDERS_PAGE = "metadataTransferOrders";
const SOURCE_SUPPLIERS_COMPLETE = "supplierDirectory";
const SOURCE_SUPPLIERS_PAGE = "metadataSuppliers";
const SOURCE_SUPPLIER_CATALOG = "supplierCatalogDirectory";
const SOURCE_LEGACY_PURCHASE_ORDERS = "legacyPurchaseOrders";
const SOURCE_REORDER_REQUESTS = "reorderRequestsQueue";
const SOURCE_REORDER_PURCHASE_ORDERS = "purchaseOrdersByIds";
const SOURCE_REORDER_PURCHASE_ORDERS_ALL = "purchaseOrderDirectory";

/**
 * A refused or failed governed read THROWS, exactly as the Firestore read it replaces did.
 *
 * Returning an empty array on a denial would hand a netting consumer a total of zero and a list
 * surface the words no suppliers -- both of which are claims about the business manufactured out
 * of a permission decision.
 */
function failRead(result: string): never {
  throw new Error(
    result === READ_RESULT.DENIED
      ? "You do not have access to this operations data."
      : "Operations data could not be loaded.",
  );
}

async function readComplete<T>(sourceId: string, filters?: Record<string, unknown>): Promise<T[]> {
  const res = await governedCollectionClient.readAllGoverned({ sourceId, filters });
  if (!res.ok) failRead(res.result);
  return res.items as T[];
}

export interface RawInventoryTransaction {
  id: string;
  workOrderId: string;
  partId: string;
  type: "RESERVED" | "RELEASED" | "CONSUMED";
  quantity: number;
  // Arrives over a governed callable, where a Firestore Timestamp is JSON rather than an object
  // carrying methods. The normaliser this feeds (normalizeLedgerTransaction) already routes it
  // through domain/timestampMillis.js's toMillis(), which reads every shape.
  timestamp: unknown;
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
  sourceId: string,
  { cap = LIST_READ_CAP }: { cap?: number } = {},
): Promise<{ items: T[]; truncated: boolean }> {
  // `truncated` is OBSERVED, from the server's own one-more-than-the-page probe, rather than
  // inferred by comparing a returned count to the limit -- which cannot tell a full final page
  // from a cut-off one. There is no orderByField parameter any more: the ordering belongs to the
  // registered source, because a client that could choose it could choose what falls off the end.
  const res = await governedCollectionClient.readGovernedList({ sourceId, pageSize: cap });
  if (!res.ok) failRead(res.result);
  return { items: res.items as T[], truncated: res.hasMore };
}

/** Bounded variants for LIST surfaces. The complete-population reads remain for the aggregates. */
export const fetchWarehousesPage = (opts?: { cap?: number }) =>
  listCollectionPage<RawWarehouse>(SOURCE_WAREHOUSES_PAGE, opts);

export const fetchSuppliersPage = (opts?: { cap?: number }) =>
  listCollectionPage<RawSupplier>(SOURCE_SUPPLIERS_PAGE, opts);

// EI-P1c-2: a dedicated transfer-order read that preserves the authoritative Firestore
// document id SEPARATELY from the stored data, so the transfer-order adapter can compare
// them and fail closed on a stored-id conflict (never merge/override). This is the ONLY
// read that keeps id out of data; the generic listCollection above is unchanged.
export interface TransferOrderDoc {
  docId: string;
  data: Record<string, unknown>;
}
/**
 * THE STORAGE ID STAYS OUT OF THE DATA, and that contract is load-bearing rather than tidy.
 *
 * The transfer-order adapter compares docId against any id stored INSIDE the document and fails
 * closed on a conflict. Merging the two -- letting a stored data.id win, or spreading the
 * document over the id -- would destroy the very evidence that comparison depends on, which is
 * why the governed items are split back apart here rather than passed through as records.
 *
 * The governed seam returns `{ ...data, id }` with the storage id last, so `id` IS the document
 * id; the rest of the document is handed on unchanged, including any stored id field, so the
 * adapter still sees the conflict it is there to catch.
 */
export const fetchTransferOrderDocs = async (): Promise<TransferOrderDoc[]> => {
  const rows = await readComplete<Record<string, unknown>>(SOURCE_TRANSFER_ORDERS_COMPLETE);
  return rows.map((row) => splitStorageId(row));
};

function splitStorageId(row: Record<string, unknown>): TransferOrderDoc {
  const { id: _storageId, ...rest } = row;
  return { docId: String(row.id), data: rest as Record<string, unknown> };
}

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
  const page = await listCollectionPage<Record<string, unknown>>(SOURCE_TRANSFER_ORDERS_PAGE, { cap });
  return { items: page.items.map(splitStorageId), truncated: page.truncated };
};

// The COMPLETE-population reads. Each is paged to exhaustion by readComplete and fails rather
// than truncating, because every one of them feeds a total.
export const fetchInventoryTransactions = () =>
  readComplete<RawInventoryTransaction>(SOURCE_INVENTORY_TRANSACTIONS);
export const fetchWarehouses = () => readComplete<RawWarehouse>(SOURCE_WAREHOUSES_COMPLETE);
export const fetchTransferOrders = () => readComplete<RawTransferOrder>(SOURCE_TRANSFER_ORDERS_COMPLETE);
export const fetchSuppliers = () => readComplete<RawSupplier>(SOURCE_SUPPLIERS_COMPLETE);
export const fetchSupplierCatalog = () => readComplete<RawSupplierCatalogItem>(SOURCE_SUPPLIER_CATALOG);

// ════════════════════ A DORMANT COLLECTION, MIGRATED AS DORMANT ════════════════════
//
// The Epic-5 `purchase_orders` collection. Its only writer is a demo seed script -- no deployed
// callable writes it -- and the LIVE purchase orders are `reorder_purchase_orders`, which
// fetchProcurementPurchaseOrders below already reads. The Operations overview's
// openProcurementCount still counts THIS one, and that fact is preserved rather than quietly
// corrected: repointing a metric at a different collection is a correctness change with an owner
// and a visible number attached, not a side effect of moving a read off Firestore.
//
// PRODUCT DEBT, recorded in docs/governance/firebase-removal-closure-ledger.md.
export const fetchPurchaseOrders = () => readComplete<RawPurchaseOrder>(SOURCE_LEGACY_PURCHASE_ORDERS);

// INV-CONVERGENCE-E Stage A completion -- one-shot read-only lists of the reorder
// workflow collections for the shadow-parity diagnostic. These two collections ARE
// client-writable elsewhere (the reorder lifecycle), but this file only READS them
// (getDocs, no subscription, no filter/index/query-shape change). The PO list is the
// LIVE `reorder_purchase_orders`, NOT the dormant Epic-5 `purchase_orders` above.
export interface RawReorderRequest { id: string; partId: string; status: string; }
export interface RawReorderPurchaseOrder { id: string; partId: string; status: string; }

export const fetchReorderRequests = () => readComplete<RawReorderRequest>(SOURCE_REORDER_REQUESTS);
export const fetchReorderPurchaseOrders = () =>
  readComplete<RawReorderPurchaseOrder>(SOURCE_REORDER_PURCHASE_ORDERS_ALL);

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
  const requests = await readComplete<Record<string, unknown> & { id: string }>(SOURCE_REORDER_REQUESTS, {
    statuses: PROCUREMENT_PO_REQUEST_STATUSES,
  });

  const ids = requests.map((r) => r.id);
  const purchaseOrdersById: Record<string, Record<string, unknown>> = {};
  // Chunked at ten because the underlying predicate is an `in`, which Firestore bounds. The
  // chunking is preserved rather than widened: the registered source declares the same bound
  // server-side, so a larger chunk would be refused, not silently accepted.
  for (const idChunk of chunkIds(ids, 10)) {
    if (idChunk.length === 0) continue;
    // eslint-disable-next-line no-await-in-loop -- one round trip per chunk, as before.
    const rows = await readComplete<Record<string, unknown> & { id: string }>(
      SOURCE_REORDER_PURCHASE_ORDERS,
      { ids: idChunk },
    );
    for (const row of rows) purchaseOrdersById[row.id] = row;
  }

  const view = buildPurchaseOrdersView({
    requestsRead: { data: requests, loading: false, error: null },
    purchaseOrdersRead: { purchaseOrdersById, loading: false, error: null },
  });
  return view.rows as ProcurementPurchaseOrderRow[];
};
