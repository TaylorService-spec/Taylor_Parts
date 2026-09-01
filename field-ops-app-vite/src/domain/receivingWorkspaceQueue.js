// Receiving North Star P1 — frame 1a. Pure view-model for the ONE "Awaiting receipt" queue
// (docs/north-star/receiving/DESIGN-HANDOFF-RECEIVING-P1.md, decision RCV-D1): the union of the two
// governed candidate reads the app already performs, with an explicit Journey column, replacing the
// chip toggle as the workspace's overview. No firebase import — node-importable and unit-tested
// directly (test/receivingWorkspaceQueue.test.mjs), the purchaseOrdersView.js discipline.
//
// COMPOSITION ONLY. This module unions two EXISTING reads and decides nothing:
//
//   SUPPLIER — services/receivingCallableClient.fetchReceivablePurchaseOrders(), the governed
//              callable list of canonical purchase_orders awaiting receipt
//              ({purchaseOrderId, supplierId, storedStatus, lineCount}).
//   REORDER  — domain/purchaseOrdersView.buildPurchaseOrdersView() rows filtered to
//              isReceiptCandidate (ORDERED reorder request + live ORDERED reorder PO).
//
// It writes nothing, calls nothing, and introduces NO new receiving state machine: a row is in the
// queue exactly because one of those two authorities already says it may be received, and every
// word it renders is either a governed fact from those reads or presentation vocabulary mapped 1:1
// from one. Where the authority is silent, the queue is silent too:
//
//   RCV-G5 — canonical purchase_orders carry NO business order number anywhere in the repository
//            (procurementService.ts creates them at auto-generated doc ids; no poNumber field
//            exists). The doc id is an opaque storage key and is NEVER promoted to a label —
//            supplier rows state the absence instead. When a governed PO reference ships, only
//            buildSupplierQueueRow changes.
//   RCV-G6 — the list read carries NO per-row receipt progress (progress exists only per order,
//            via fetchPurchaseOrderProgress, and is shown when a row is OPENED). The queue renders
//            no progress column rather than fabricating "Not started" for orders it has not read.
//
// Reorder rows render externalPoNumber (the entity's governed nameField) and never fall back to
// reorderRequestId; RR-numbering is declared but UNWIRED (RCV-G4, metadata/definitions/
// reorderRequest.js), so no synthesized RR-#### reference may appear here either.

import { PURCHASE_ORDERS_STATUS } from "./purchaseOrdersView.js";
import { RECEIVING_OUTCOME } from "./receivingTransport.js";

export const RECEIVING_JOURNEY = Object.freeze({ REORDER: "REORDER", SUPPLIER: "SUPPLIER" });

// Operator vocabulary for the Journey column — the distinction the business already makes and the
// operator has to know they are holding (one immutable full-quantity part vs several lines received
// partially over time). Presentation words only; the journey values above are the contract.
export const JOURNEY_WORDS = Object.freeze({
  [RECEIVING_JOURNEY.REORDER]: "Reorder PO · full quantity",
  [RECEIVING_JOURNEY.SUPPLIER]: "Supplier PO · multi-scan",
});

// Per-source load states, and the combined queue ladder. EMPTY is a claim ("both reads succeeded
// and nothing awaits receipt") and is therefore only reachable when BOTH sources are READY.
export const QUEUE_SOURCE_STATE = Object.freeze({
  LOADING: "LOADING",
  READY: "READY",
  DENIED: "DENIED",
  UNAVAILABLE: "UNAVAILABLE", // receiving transport built but not switched on (existing vocabulary)
  FAILED: "FAILED",
});

export const QUEUE_STATE = Object.freeze({
  LOADING: "LOADING",
  READY: "READY",
  READY_PARTIAL: "READY_PARTIAL", // one source read, the other could not be — disclosed, never hidden
  EMPTY: "EMPTY",
  DENIED: "DENIED",
  UNAVAILABLE: "UNAVAILABLE",
  FAILED: "FAILED",
});

// Canonical purchase-order stored statuses, in words (RECEIVABLE_CANONICAL_STATUSES is
// ["APPROVED","SENT"]). An unrecognized stored value passes through VERBATIM: the truthful move for
// a value this module does not know is to show what is stored, not to guess a nicer word for it.
const CANONICAL_PO_STATUS_WORDS = Object.freeze({
  APPROVED: "Approved",
  SENT: "Sent to supplier",
});

// Exported so the supplier journey (MultiScanReceiving) and the queue speak the same words for the
// same stored fact. null in → null out (a stored status is checked-but-optional on the progress
// read; its absence is stated by the caller, not papered over here).
export function canonicalPoStatusWords(storedStatus) {
  if (typeof storedStatus !== "string" || storedStatus.length === 0) return null;
  return CANONICAL_PO_STATUS_WORDS[storedStatus] ?? storedStatus;
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// ─────────────────────────────────────────────── per-source states

// The supplier list result ({pending} before the fetch settles, then the callable's
// {status: RECEIVING_OUTCOME.*}). UNAUTHENTICATED folds into DENIED — for this queue both mean
// "this session may not read the list", and the component's copy covers both honestly.
export function supplierSourceState(supplierList) {
  if (!isPlainObject(supplierList) || supplierList.pending) return QUEUE_SOURCE_STATE.LOADING;
  const s = supplierList.status;
  if (s === RECEIVING_OUTCOME.READY) return QUEUE_SOURCE_STATE.READY;
  if (s === RECEIVING_OUTCOME.DENIED || s === RECEIVING_OUTCOME.UNAUTHENTICATED) return QUEUE_SOURCE_STATE.DENIED;
  if (s === RECEIVING_OUTCOME.UNAVAILABLE) return QUEUE_SOURCE_STATE.UNAVAILABLE;
  return QUEUE_SOURCE_STATE.FAILED;
}

export function reorderSourceState(reorderView) {
  const s = isPlainObject(reorderView) ? reorderView.status : null;
  if (s === PURCHASE_ORDERS_STATUS.READY) return QUEUE_SOURCE_STATE.READY;
  if (s === PURCHASE_ORDERS_STATUS.BLOCKED_PERMISSION) return QUEUE_SOURCE_STATE.DENIED;
  if (s === PURCHASE_ORDERS_STATUS.BLOCKED_UNAVAILABLE) return QUEUE_SOURCE_STATE.FAILED;
  return QUEUE_SOURCE_STATE.LOADING;
}

// ─────────────────────────────────────────────── row builders

// One canonical supplier PO row. `supplierNamesById` resolves supplierId → name through the
// existing suppliers read; an unresolved name is null and the component states that — the raw
// supplierId never renders.
export function buildSupplierQueueRow(po, supplierNamesById = {}) {
  if (!isPlainObject(po) || typeof po.purchaseOrderId !== "string" || po.purchaseOrderId.length === 0) return null;
  const name = supplierNamesById[po.supplierId];
  return {
    key: `SUPPLIER:${po.purchaseOrderId}`,
    journey: RECEIVING_JOURNEY.SUPPLIER,
    journeyWords: JOURNEY_WORDS[RECEIVING_JOURNEY.SUPPLIER],
    // RCV-G5 — no governed business reference exists for canonical POs. null means "state the
    // absence"; the doc id is carried ONLY inside `open` as the opaque navigation argument.
    orderReference: null,
    // The two journeys' absences are DIFFERENT facts and carry different words (frame 1e): here no
    // order-number authority exists at all; a reorder row's external PO number is a real governed
    // field that happens to be absent on that record. Each surface says its own truth, and the
    // queue row says the same thing the opened journey will.
    orderReferenceAbsence: "No order number recorded",
    partId: null,
    orderedQuantity: null,
    lineCount: Number.isFinite(po.lineCount) ? po.lineCount : null,
    supplierName: typeof name === "string" && name.length > 0 ? name : null,
    statusWords: canonicalPoStatusWords(po.storedStatus),
    open: { journey: RECEIVING_JOURNEY.SUPPLIER, purchaseOrderId: po.purchaseOrderId },
  };
}

// One reorder-PO receipt candidate, from a buildPurchaseOrdersView row. Only isReceiptCandidate
// rows belong in an "awaiting receipt" queue; anything else returns null rather than being
// silently reclassified.
export function buildReorderQueueRow(row) {
  if (!isPlainObject(row) || row.isReceiptCandidate !== true) return null;
  if (typeof row.reorderRequestId !== "string" || row.reorderRequestId.length === 0) return null;
  return {
    key: `REORDER:${row.reorderRequestId}`,
    journey: RECEIVING_JOURNEY.REORDER,
    journeyWords: JOURNEY_WORDS[RECEIVING_JOURNEY.REORDER],
    // The governed nameField, or a stated absence — NEVER reorderRequestId, and never a
    // synthesized RR-number (the RR lane is unwired; see the module header).
    orderReference: typeof row.externalPoNumber === "string" && row.externalPoNumber.length > 0 ? row.externalPoNumber : null,
    // Matches frame 1d's wording for the SAME fact: the external PO number field, absent here.
    orderReferenceAbsence: "No PO number recorded",
    partId: typeof row.partId === "string" && row.partId.length > 0 ? row.partId : null,
    orderedQuantity: Number.isFinite(row.orderedQuantity) ? row.orderedQuantity : null,
    lineCount: 1,
    supplierName: typeof row.supplierName === "string" && row.supplierName.length > 0 ? row.supplierName : null,
    // A receipt candidate is by definition at ORDERED on both linked documents.
    statusWords: "Ordered",
    open: { journey: RECEIVING_JOURNEY.REORDER, reorderRequestId: row.reorderRequestId },
  };
}

// ─────────────────────────────────────────────── the combined queue

// Sentences for a source that could not be read, used by the PARTIAL notice and the combined
// failure states. Deliberately three DIFFERENT claims (denied / not switched on / failed), because
// collapsing them is the generic-error defect the brief names.
export function describeSourceBlock(journey, state) {
  const what = journey === RECEIVING_JOURNEY.SUPPLIER ? "Supplier purchase orders" : "Reorder purchase orders";
  if (state === QUEUE_SOURCE_STATE.DENIED) {
    return `${what} awaiting receipt cannot be shown — you are not authorized to read them.`;
  }
  if (state === QUEUE_SOURCE_STATE.UNAVAILABLE) {
    return `${what} awaiting receipt cannot be read — receiving is built but not switched on in this environment. This is not an empty list; it is an unread one.`;
  }
  return `${what} awaiting receipt could not be loaded.`;
}

// The whole-queue view-model. Inputs are the app's existing read results, verbatim:
//   reorderView       — buildPurchaseOrdersView() output
//   supplierList      — {pending:true} | fetchReceivablePurchaseOrders() result
//   supplierNamesById — optional {supplierId: name} from the existing suppliers read; resolution
//                       is enrichment only and its absence never blocks or reclassifies the queue.
export function buildReceivingWorkspaceQueue({ reorderView, supplierList, supplierNamesById = {} } = {}) {
  const reorder = reorderSourceState(reorderView);
  const supplier = supplierSourceState(supplierList);
  const sources = Object.freeze({ reorder, supplier });

  // Any source still loading → the queue is loading. Rows never flash in before both answers are
  // known — a half-read queue that later grows looks exactly like new arrivals, which is a lie.
  if (reorder === QUEUE_SOURCE_STATE.LOADING || supplier === QUEUE_SOURCE_STATE.LOADING) {
    return { state: QUEUE_STATE.LOADING, rows: [], notices: [], sources };
  }

  const supplierRows =
    supplier === QUEUE_SOURCE_STATE.READY
      ? (Array.isArray(supplierList.purchaseOrders) ? supplierList.purchaseOrders : [])
          .map((po) => buildSupplierQueueRow(po, supplierNamesById))
          .filter(Boolean)
      : [];
  const reorderRows =
    reorder === QUEUE_SOURCE_STATE.READY
      ? (Array.isArray(reorderView.rows) ? reorderView.rows : []).map(buildReorderQueueRow).filter(Boolean)
      : [];
  // Supplier sessions first (several lines, the longer job), then reorder candidates in the view's
  // own most-recent-first order. Deterministic composition, not a priority claim.
  const rows = [...supplierRows, ...reorderRows];

  const bothReady = reorder === QUEUE_SOURCE_STATE.READY && supplier === QUEUE_SOURCE_STATE.READY;
  if (bothReady) {
    return { state: rows.length === 0 ? QUEUE_STATE.EMPTY : QUEUE_STATE.READY, rows, notices: [], sources };
  }

  const oneReady = reorder === QUEUE_SOURCE_STATE.READY || supplier === QUEUE_SOURCE_STATE.READY;
  if (oneReady) {
    const blockedJourney = reorder === QUEUE_SOURCE_STATE.READY ? RECEIVING_JOURNEY.SUPPLIER : RECEIVING_JOURNEY.REORDER;
    const blockedState = reorder === QUEUE_SOURCE_STATE.READY ? supplier : reorder;
    return {
      state: QUEUE_STATE.READY_PARTIAL,
      rows,
      notices: [{ journey: blockedJourney, sourceState: blockedState, message: describeSourceBlock(blockedJourney, blockedState) }],
      sources,
    };
  }

  // Neither source could be read. DENIED and UNAVAILABLE stay whole-queue states only when they
  // describe BOTH sources; a mixed failure is FAILED with each source's specific sentence attached.
  const state =
    reorder === QUEUE_SOURCE_STATE.DENIED && supplier === QUEUE_SOURCE_STATE.DENIED
      ? QUEUE_STATE.DENIED
      : reorder === QUEUE_SOURCE_STATE.UNAVAILABLE && supplier === QUEUE_SOURCE_STATE.UNAVAILABLE
        ? QUEUE_STATE.UNAVAILABLE
        : QUEUE_STATE.FAILED;
  return {
    state,
    rows: [],
    notices: [
      { journey: RECEIVING_JOURNEY.SUPPLIER, sourceState: supplier, message: describeSourceBlock(RECEIVING_JOURNEY.SUPPLIER, supplier) },
      { journey: RECEIVING_JOURNEY.REORDER, sourceState: reorder, message: describeSourceBlock(RECEIVING_JOURNEY.REORDER, reorder) },
    ],
    sources,
  };
}
