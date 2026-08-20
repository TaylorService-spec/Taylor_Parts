// Receiving SOURCE AUTHORITY resolution — which purchase-order authority a receipt addresses, and
// everything derived from it that validation needs.
//
// ============================ NO FALLBACK GUESSING ============================
//
// The request STATES its authority (`source.type`, a closed set). This module reads that ONE
// collection and fails closed if the document is absent. It never tries the other collection, never
// picks an authority because a lookup returned nothing, and never infers one from the shape of an id.
//
// That rule is load-bearing rather than tidy. Legacy PO ids are reorder-request ids and canonical PO
// ids are Firestore auto-ids; nothing structurally prevents a value from being plausible in both. If
// resolution fell back, a caller could aim a receipt at one authority and have it silently land on
// the other — against different stock, with different quantity rules.
//
// ============================ THE CONCURRENCY ANCHOR ============================
//
// For a canonical PO this module's `poRef` is read inside the caller's transaction and MUST be
// written by it (the version increment). That pairing is what serializes concurrent receipts —
// Firestore aborts a commit whose read document changed, and a query over prior receipts provides no
// such guarantee on its own. See docs/specifications/multi-line-receiving-transaction-order.md §1.
//
// Legacy needs no such anchor: it is full-quantity one-shot and is already serialized by the
// reorder_requests transition the command performs.

import type { Firestore, Transaction, DocumentReference } from "firebase-admin/firestore";
import {
  normalizeLegacyPurchaseOrder,
  normalizeCanonicalPurchaseOrder,
  deriveReceiptState,
  PurchaseOrderNormalizationError,
  type CanonicalPurchaseOrder,
  type DerivedPurchaseOrder,
  type CommittedReceipt,
} from "../purchasing/purchaseOrderNormalization.js";
import { RECEIVING_ORDERS_COLLECTION, LEGACY_SOURCE_TYPE, CANONICAL_SOURCE_TYPE } from "./receivingTypes.js";
import { SourceNotFoundError, SourceNotReceivableError } from "./receiveInventoryStockCommand.js";

const REORDER_PURCHASE_ORDERS_COLLECTION = "reorder_purchase_orders";
export const CANONICAL_PURCHASE_ORDERS_COLLECTION = "purchase_orders";

/** Canonical PO lifecycle states a receipt may be taken against. */
export const RECEIVABLE_CANONICAL_STATUSES = ["APPROVED", "SENT"] as const;
const LEGACY_RECEIVABLE_STATUS = "ORDERED";

export interface ResolvedReceivingSource {
  readonly sourceType: string;
  readonly purchaseOrderId: string;
  /** Legacy only; absent for canonical. */
  readonly reorderRequestId?: string;
  readonly canonical: CanonicalPurchaseOrder;
  readonly derived: DerivedPurchaseOrder;
  /** The PO document. Written (version) for canonical; NEVER written for legacy. */
  readonly poRef: DocumentReference;
  readonly storedStatus: string | null;
  /**
   * The concurrency version read from the canonical PO. CONCURRENCY CONTROL ONLY — it never
   * represents quantity received, quantity remaining, receipt count, or business progress. A document
   * without one normalizes to 0 (§6), which is safe: the first receipt writes 1, and any concurrent
   * transaction that also read 0 aborts.
   */
  readonly version: number;
  readonly isCanonical: boolean;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim().length > 0 ? v : null);

/**
 * A non-negative integer concurrency version, or 0 when absent.
 *
 * Absent → 0 is the documented normalization (§6). A NEGATIVE or FRACTIONAL stored version is
 * rejected rather than coerced: it cannot have been written by this command, so treating it as a
 * number would be normalizing corruption into validity — and this value is the only thing standing
 * between two concurrent receipts and an over-receipt.
 */
export function normalizePoVersion(raw: unknown): number {
  if (raw === undefined || raw === null) return 0;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) {
    throw new SourceNotReceivableError("purchase order version invalid");
  }
  return raw;
}

/**
 * Read every committed receipt for one purchase order.
 *
 * SINGLE-FIELD EQUALITY, NO ORDERING — deliberately, so this needs no composite index (adding one is
 * a protected boundary). Firestore indexes single fields automatically.
 *
 * This query is NOT what makes concurrency safe. It cannot be: a transaction query takes no predicate
 * lock, so it will not see a concurrent uncommitted receipt. Safety comes from the PO document read
 * and write around it.
 */
async function readCommittedReceipts(
  txn: Transaction,
  db: Firestore,
  purchaseOrderId: string,
): Promise<CommittedReceipt[]> {
  const snap = await txn.get(
    db.collection(RECEIVING_ORDERS_COLLECTION).where("source.purchaseOrderId", "==", purchaseOrderId),
  );
  return snap.docs.map((d) => {
    const data = d.data() ?? {};
    const lines = Array.isArray(data.lines) ? data.lines : [];
    return {
      receivingId: d.id,
      lines: lines.map((l: Record<string, unknown>) => ({
        lineId: String(l?.lineId ?? ""),
        receivedQuantity: typeof l?.receivedQuantity === "number" ? l.receivedQuantity : 0,
        ...(Array.isArray(l?.serialNumbers) ? { serialNumbers: l.serialNumbers as string[] } : {}),
      })),
    };
  });
}

/**
 * Resolve the addressed authority and everything derived from it.
 *
 * READS ONLY. Every read here happens before the caller's first write, and the caller owns the
 * writes. The returned `poRef`/`version` are what the caller uses to perform the canonical version
 * increment that serializes concurrent receipts.
 */
export async function resolveReceivingSource(
  txn: Transaction,
  db: Firestore,
  source: unknown,
): Promise<ResolvedReceivingSource> {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new SourceNotReceivableError("source is not an object");
  }
  const s = source as Record<string, unknown>;
  const sourceType = str(s.type);

  // ---------------------------------------------------------------- canonical
  if (sourceType === CANONICAL_SOURCE_TYPE) {
    // CONTRADICTORY FIELDS ARE REJECTED, not ignored (§5). A canonical source carrying a
    // reorderRequestId is a request that disagrees with itself about which authority it addresses,
    // and silently dropping the extra field would resolve that disagreement by guessing.
    if (s.reorderRequestId !== undefined) {
      throw new SourceNotReceivableError("canonical source must not carry a reorderRequestId");
    }
    const purchaseOrderId = str(s.purchaseOrderId);
    if (!purchaseOrderId) throw new SourceNotReceivableError("purchaseOrderId missing");

    const poRef = db.collection(CANONICAL_PURCHASE_ORDERS_COLLECTION).doc(purchaseOrderId);
    const poSnap = await txn.get(poRef);
    // FAIL CLOSED. No fallback to the legacy collection -- see this module's header.
    if (!poSnap.exists) throw new SourceNotFoundError("purchase order not found");
    const data = poSnap.data() ?? {};

    let canonical: CanonicalPurchaseOrder;
    try {
      canonical = normalizeCanonicalPurchaseOrder(purchaseOrderId, data);
    } catch (err) {
      if (err instanceof PurchaseOrderNormalizationError) {
        throw new SourceNotReceivableError(`purchase order invalid: ${err.code}`);
      }
      throw err;
    }

    const storedStatus = str(data.status);
    if (!storedStatus || !(RECEIVABLE_CANONICAL_STATUSES as readonly string[]).includes(storedStatus)) {
      throw new SourceNotReceivableError("purchase order is not in a receivable state");
    }

    const receipts = await readCommittedReceipts(txn, db, purchaseOrderId);
    return {
      sourceType,
      purchaseOrderId,
      canonical,
      derived: deriveReceiptState(canonical, receipts),
      poRef,
      storedStatus,
      version: normalizePoVersion(data.version),
      isCanonical: true,
    };
  }

  // ------------------------------------------------------------------- legacy
  if (sourceType === LEGACY_SOURCE_TYPE) {
    const reorderRequestId = str(s.reorderRequestId);
    if (!reorderRequestId) throw new SourceNotReceivableError("source reorderRequestId missing");
    const purchaseOrderId = str(s.purchaseOrderId);
    if (!purchaseOrderId) throw new SourceNotReceivableError("purchaseOrderId missing");
    // The legacy identity invariant, unchanged: the PO's id IS its reorder request's id.
    if (purchaseOrderId !== reorderRequestId) throw new SourceNotReceivableError("source identity mismatch");

    const poRef = db.collection(REORDER_PURCHASE_ORDERS_COLLECTION).doc(reorderRequestId);
    const poSnap = await txn.get(poRef);
    if (!poSnap.exists) throw new SourceNotFoundError("purchase order not found");
    const data = poSnap.data() ?? {};
    if (data.status !== LEGACY_RECEIVABLE_STATUS) {
      throw new SourceNotReceivableError("purchase order is not ORDERED");
    }
    if (data.reorderRequestId !== reorderRequestId) {
      throw new SourceNotReceivableError("purchase order identity incoherent");
    }

    let canonical: CanonicalPurchaseOrder;
    try {
      canonical = normalizeLegacyPurchaseOrder(reorderRequestId, data);
    } catch (err) {
      if (err instanceof PurchaseOrderNormalizationError) {
        throw new SourceNotReceivableError(`purchase order invalid: ${err.code}`);
      }
      throw err;
    }

    // Legacy receipts are one-shot and full-quantity, so there is nothing cumulative to derive and no
    // prior-receipt query to run. Deriving over an empty receipt set gives remaining == ordered, which
    // is exactly the quantity a legacy receipt must present -- so the shared validation path produces
    // the legacy rule without a second implementation of it.
    return {
      sourceType,
      purchaseOrderId,
      reorderRequestId,
      canonical,
      derived: deriveReceiptState(canonical, []),
      poRef,
      storedStatus: str(data.status),
      version: 0, // never read and never written for legacy: the document is immutable by contract
      isCanonical: false,
    };
  }

  throw new SourceNotReceivableError("source type is not a supported receiving authority");
}
