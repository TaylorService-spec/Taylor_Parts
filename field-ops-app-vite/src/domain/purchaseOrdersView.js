// Purchasing > Purchase Orders (item C) -- pure, dependency-free view-model for
// the cross-request Reorder Purchase Order surface. No firebase import, so this
// is node-importable and unit-tested directly (test/purchaseOrdersView.test.mjs),
// same discipline as partsCatalogView.js / partDetailView.js.
//
// SCOPE NOTE (deliberate): this composes the ALREADY-EXISTING, client-direct
// `reorder_requests` + `reorder_purchase_orders` reads. It is the read side ONLY.
// It writes nothing, calls no Cloud Function, and never touches `receiving_orders`
// (that collection is backend-only deny-all). The sole writers of
// reorder_purchase_orders remain domain/reorderPurchaseOrders.js's
// recordPurchaseOrder()/voidPurchaseOrder() -- this module adds NO write path.
//
// "Two purchase-order concepts" guard: this file is exclusively about
// `reorder_purchase_orders` (the 1:1-with-a-Reorder-Request execution record,
// doc id == reorderRequestId). It has nothing to do with the reserved Epic-5
// `purchase_orders` collection (operationsQueries.ts) -- do not wire that here.

import { REORDER_REQUEST_STATUS, PURCHASE_ORDER_STATUS } from "./constants.js";

// A Reorder Purchase Order exists (status ORDERED) exactly while its linked
// Reorder Request is at status ORDERED -- recordPurchaseOrder() creates the two
// together atomically, and the only exits from ORDERED are RECEIVED (legacy
// closeout) or VOIDED. So the authoritative "these are the open POs" set is the
// ORDERED reorder_requests; VOIDED/RECEIVED requests are terminal history.
export const PURCHASE_ORDER_VIEW_STATUS = {
  OPEN: "OPEN", // request ORDERED + a live ORDERED PO -> a governed receipt candidate
  RECEIVED: "RECEIVED", // request closed out via legacy receiveReorderRequest()
  VOIDED: "VOIDED", // PO voided (append-only void record; request VOIDED)
  ORPHAN: "ORPHAN", // request says ORDERED but no PO doc could be read -- surfaced, never silently dropped
};

// Fail-closed load states, mirroring the ladder partsCatalogView.js uses. A read
// failure is NEVER reported as an empty-but-successful list.
export const PURCHASE_ORDERS_STATUS = {
  READY: "READY",
  LOADING: "LOADING",
  BLOCKED_PERMISSION: "BLOCKED_PERMISSION",
  BLOCKED_UNAVAILABLE: "BLOCKED_UNAVAILABLE",
};

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// The exact receipt "source" descriptor the live receiveInventoryStock callable
// expects for a reorder-PO receipt. purchaseOrderId === reorderRequestId by the
// doc-id invariant. This is INFORMATIONAL surfacing only -- the UI displays it so
// an authorized operator can run the (separately-authorized) first receipt; this
// module never calls the callable.
export function buildReceiptSourceDescriptor(reorderRequestId) {
  if (typeof reorderRequestId !== "string" || reorderRequestId.length === 0) {
    return null;
  }
  return {
    type: "REORDER_PURCHASE_ORDER",
    reorderRequestId,
    purchaseOrderId: reorderRequestId,
  };
}

// Derive one display row from an ORDERED reorder_request and its (maybe-missing)
// PO doc. `po` is null when the PO doc wasn't read (permission/absent) -- the row
// is still emitted as an ORPHAN so nothing is silently hidden. A row is a receipt
// candidate ONLY when the request is ORDERED AND a live ORDERED PO backs it.
export function buildPurchaseOrderRow(request, po) {
  if (!isPlainObject(request) || typeof request.id !== "string" || request.id.length === 0) {
    return null;
  }
  const reorderRequestId = request.id;
  const requestOrdered = request.status === REORDER_REQUEST_STATUS.ORDERED;
  const poOrdered = isPlainObject(po) && po.status === PURCHASE_ORDER_STATUS.ORDERED;

  let viewStatus;
  if (request.status === REORDER_REQUEST_STATUS.VOIDED) {
    viewStatus = PURCHASE_ORDER_VIEW_STATUS.VOIDED;
  } else if (request.status === REORDER_REQUEST_STATUS.RECEIVED) {
    viewStatus = PURCHASE_ORDER_VIEW_STATUS.RECEIVED;
  } else if (requestOrdered && poOrdered) {
    viewStatus = PURCHASE_ORDER_VIEW_STATUS.OPEN;
  } else {
    // ORDERED request with no readable/ORDERED PO doc -- an integrity exception,
    // surfaced explicitly rather than dropped.
    viewStatus = PURCHASE_ORDER_VIEW_STATUS.ORPHAN;
  }

  const isReceiptCandidate = viewStatus === PURCHASE_ORDER_VIEW_STATUS.OPEN;

  return {
    reorderRequestId,
    purchaseOrderId: isPlainObject(po) ? reorderRequestId : null,
    partId: (isPlainObject(po) && typeof po.partId === "string" && po.partId) || request.partId || null,
    supplierName: (isPlainObject(po) && po.supplierName) || null,
    externalPoNumber: (isPlainObject(po) && po.externalPoNumber) || null,
    orderedQuantity: isPlainObject(po) && Number.isFinite(po.orderedQuantity) ? po.orderedQuantity : null,
    orderedDate: (isPlainObject(po) && po.orderedDate) || null,
    expectedArrivalDate: (isPlainObject(po) && po.expectedArrivalDate) || null,
    orderedByUserId: request.orderedBy || (isPlainObject(po) && po.createdBy) || null,
    orderedAt: request.orderedAt ?? (isPlainObject(po) ? po.createdAt : null) ?? null,
    viewStatus,
    isReceiptCandidate,
    // Only OPEN rows carry a usable receipt descriptor; VOIDED/RECEIVED/ORPHAN => null.
    receiptSource: isReceiptCandidate ? buildReceiptSourceDescriptor(reorderRequestId) : null,
  };
}

function isPermissionCode(code) {
  const c = String(code ?? "");
  return c === "permission-denied" || c === "firestore/permission-denied";
}

// Compose the full surface view-model from the reorder-request read and the
// purchase-order read. BOTH are {data|purchaseOrdersById, loading, error} shaped
// (the app's hook convention). Fail-closed on EITHER read: a denied/unavailable
// purchase-order read is a genuine failure and must never be downgraded to
// "these rows need attention" -- it BLOCKS the whole surface, never an empty
// success and never spurious ORPHAN rows. ORPHAN is reserved for the honest case
// where BOTH reads succeeded but a specific PO doc is simply absent.
export function buildPurchaseOrdersView({ requestsRead, purchaseOrdersRead }) {
  const safeRequests = isPlainObject(requestsRead) ? requestsRead : {};
  const safePos = isPlainObject(purchaseOrdersRead) ? purchaseOrdersRead : {};
  const reqError = safeRequests.error;
  const poError = safePos.error;

  // Fail closed on either error; permission takes precedence over unavailable.
  if (reqError || poError) {
    const status =
      isPermissionCode(reqError) || isPermissionCode(poError)
        ? PURCHASE_ORDERS_STATUS.BLOCKED_PERMISSION
        : PURCHASE_ORDERS_STATUS.BLOCKED_UNAVAILABLE;
    return { status, rows: [], summary: emptySummary() };
  }
  // Either read still in flight -> LOADING, so rows never flash as ORPHAN while
  // their PO docs are still being fetched.
  if (safeRequests.loading || safePos.loading) {
    return { status: PURCHASE_ORDERS_STATUS.LOADING, rows: [], summary: emptySummary() };
  }

  const requests = Array.isArray(safeRequests.data) ? safeRequests.data : [];
  const map = isPlainObject(safePos.purchaseOrdersById) ? safePos.purchaseOrdersById : {};

  const rows = requests
    .map((req) => buildPurchaseOrderRow(req, isPlainObject(req) ? map[req.id] ?? null : null))
    .filter(Boolean)
    // Most-recent order first; rows with no orderedAt sink to the bottom deterministically.
    .sort((a, b) => (b.orderedAt ?? -Infinity) - (a.orderedAt ?? -Infinity) || a.reorderRequestId.localeCompare(b.reorderRequestId));

  return { status: PURCHASE_ORDERS_STATUS.READY, rows, summary: summarize(rows) };
}

function emptySummary() {
  return { total: 0, open: 0, received: 0, voided: 0, orphan: 0, receiptCandidates: 0 };
}

export function summarize(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return {
    total: list.length,
    open: list.filter((r) => r.viewStatus === PURCHASE_ORDER_VIEW_STATUS.OPEN).length,
    received: list.filter((r) => r.viewStatus === PURCHASE_ORDER_VIEW_STATUS.RECEIVED).length,
    voided: list.filter((r) => r.viewStatus === PURCHASE_ORDER_VIEW_STATUS.VOIDED).length,
    orphan: list.filter((r) => r.viewStatus === PURCHASE_ORDER_VIEW_STATUS.ORPHAN).length,
    receiptCandidates: list.filter((r) => r.isReceiptCandidate).length,
  };
}
