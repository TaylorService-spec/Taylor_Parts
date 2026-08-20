// Canonical purchase-order RECEIVING PROGRESS — trusted read.
//
// WHY THIS HAS TO BE A CALLABLE. `purchase_orders` is client-readable (firestore.rules:1272,
// isAdminOrDispatcher), so a browser could list the ordered lines itself. What it cannot do is derive
// what REMAINS: that is the sum of committed receipts, and `receiving_orders` is deny-all to every
// client by design. Without a trusted read the scanning surface could show what was ordered and never
// what is still outstanding — which is the one number the whole reconciliation is about.
//
// NO NEW CAPABILITY, AND NO NEW AUTHORITY. Gated on `inventory.stock.receive`, the capability that
// already governs receiving: the people who may take a receipt are exactly the people who need to see
// what is outstanding on it. Derivation reuses the same pure normalizer and receipt fold the command
// uses (purchasing/purchaseOrderNormalization.ts), so the number this read shows and the number the
// command enforces cannot disagree.
//
// READ-ONLY. No transaction, no write, no counter, no lifecycle change. A read does not need the
// concurrency anchor the command uses, because it decides nothing — the command re-derives inside its
// own transaction and is the authority. What this returns is a true statement about committed state
// at read time, which is exactly what a scanning operator needs and no more than it can promise.

import type { Firestore } from "firebase-admin/firestore";
import {
  normalizeCanonicalPurchaseOrder,
  deriveReceiptState,
  PurchaseOrderNormalizationError,
  type CommittedReceipt,
} from "../purchasing/purchaseOrderNormalization.js";
import { RECEIVING_ORDERS_COLLECTION } from "./receivingTypes.js";
import { CANONICAL_PURCHASE_ORDERS_COLLECTION, RECEIVABLE_CANONICAL_STATUSES, normalizePoVersion } from "./receivingSourceResolver.js";

/** One line, as the scanning surface needs it. */
export interface PurchaseOrderProgressLine {
  readonly lineId: string;
  readonly partId: string;
  /** From the Part authority — the scan queue needs it to decide serial handling. */
  readonly trackingMode: string;
  readonly orderedQuantity: number;
  readonly receivedQuantity: number;
  readonly remainingQuantity: number;
  readonly state: string;
}

export interface PurchaseOrderProgress {
  readonly purchaseOrderId: string;
  readonly supplierId: string | null;
  readonly supplierName: string | null;
  /** STORED procurement lifecycle. A different concept from `derivedState`. */
  readonly storedStatus: string | null;
  /** DERIVED receipt progress, computed from committed receipts. */
  readonly derivedState: string;
  /** True when a receipt may be taken against this order right now. */
  readonly receivable: boolean;
  /** Concurrency token, for an optimistic `expectedVersion` on submit. */
  readonly version: number;
  readonly lines: readonly PurchaseOrderProgressLine[];
}

export class PurchaseOrderProgressNotFoundError extends Error {}
export class PurchaseOrderProgressInvalidError extends Error {}

/** Resolves a Part's tracking mode. Injected so this stays testable and takes no second authority. */
export type ResolveTrackingMode = (partId: string) => Promise<string | null>;

/**
 * Read one canonical purchase order and its committed receipt progress.
 *
 * The receipts query is a single-field equality (`source.purchaseOrderId`) with no ordering, exactly
 * as the command's derivation is — so it needs no composite index, and adding one remains a boundary
 * this slice does not cross.
 */
export async function readPurchaseOrderProgress(
  db: Firestore,
  purchaseOrderId: string,
  resolveTrackingMode: ResolveTrackingMode,
): Promise<PurchaseOrderProgress> {
  if (typeof purchaseOrderId !== "string" || purchaseOrderId.trim() === "") {
    throw new PurchaseOrderProgressInvalidError("purchaseOrderId is required");
  }
  const snap = await db.collection(CANONICAL_PURCHASE_ORDERS_COLLECTION).doc(purchaseOrderId).get();
  // FAIL CLOSED, and no fallback to the legacy collection -- the same rule the command's resolver
  // follows. A caller addressing the canonical authority gets the canonical answer or nothing.
  if (!snap.exists) throw new PurchaseOrderProgressNotFoundError("purchase order not found");
  const data = snap.data() ?? {};

  let canonical;
  try {
    canonical = normalizeCanonicalPurchaseOrder(purchaseOrderId, data);
  } catch (err) {
    if (err instanceof PurchaseOrderNormalizationError) {
      throw new PurchaseOrderProgressInvalidError(`purchase order invalid: ${err.code}`);
    }
    throw err;
  }

  const receiptsSnap = await db
    .collection(RECEIVING_ORDERS_COLLECTION)
    .where("source.purchaseOrderId", "==", purchaseOrderId)
    .get();
  const receipts: CommittedReceipt[] = receiptsSnap.docs.map((d) => {
    const r = d.data() ?? {};
    const lines = Array.isArray(r.lines) ? r.lines : [];
    return {
      receivingId: d.id,
      lines: lines.map((l: Record<string, unknown>) => ({
        lineId: String(l?.lineId ?? ""),
        receivedQuantity: typeof l?.receivedQuantity === "number" ? l.receivedQuantity : 0,
      })),
    };
  });

  const derived = deriveReceiptState(canonical, receipts);

  // Tracking mode per DISTINCT part -- one question, one answer, however many lines reference it.
  const modes = new Map<string, string>();
  for (const partId of new Set(canonical.lines.map((l) => l.partId))) {
    const mode = await resolveTrackingMode(partId);
    // A part the authority cannot resolve is reported as UNKNOWN rather than defaulted to NONE.
    // Defaulting would tell a scanning operator a serialized part needs no serial, and the receipt
    // would then be refused at submission for a reason the screen had actively contradicted.
    modes.set(partId, mode ?? "UNKNOWN");
  }

  const storedStatus = typeof data.status === "string" ? data.status : null;
  return {
    purchaseOrderId,
    supplierId: canonical.supplierId,
    supplierName: canonical.supplierName,
    storedStatus,
    derivedState: derived.state,
    receivable: storedStatus !== null && (RECEIVABLE_CANONICAL_STATUSES as readonly string[]).includes(storedStatus),
    version: normalizePoVersion(data.version),
    lines: derived.lines.map((l) => ({
      lineId: l.lineId,
      partId: l.partId,
      trackingMode: modes.get(l.partId) ?? "UNKNOWN",
      orderedQuantity: l.orderedQuantity,
      receivedQuantity: l.receivedQuantity,
      remainingQuantity: l.remainingQuantity,
      state: l.state,
    })),
  };
}

/**
 * List canonical purchase orders that can currently be received.
 *
 * BOUNDED, and by a single-field equality on `status` so it needs no composite index. A `SENT` or
 * `APPROVED` order may still be fully received by committed receipts, so the caller filters on the
 * DERIVED state for what is genuinely outstanding — the stored status alone cannot answer that, which
 * is the whole reason derived and stored are separate concepts.
 */
export const RECEIVABLE_LIST_LIMIT = 100;

export async function listReceivablePurchaseOrders(db: Firestore): Promise<readonly { purchaseOrderId: string; supplierId: string | null; storedStatus: string; lineCount: number }[]> {
  const out: { purchaseOrderId: string; supplierId: string | null; storedStatus: string; lineCount: number }[] = [];
  for (const status of RECEIVABLE_CANONICAL_STATUSES) {
    const snap = await db
      .collection(CANONICAL_PURCHASE_ORDERS_COLLECTION)
      .where("status", "==", status)
      .limit(RECEIVABLE_LIST_LIMIT)
      .get();
    for (const d of snap.docs) {
      const data = d.data() ?? {};
      out.push({
        purchaseOrderId: d.id,
        supplierId: typeof data.supplierId === "string" ? data.supplierId : null,
        storedStatus: status,
        lineCount: Array.isArray(data.items) ? data.items.length : 0,
      });
    }
  }
  return out.slice(0, RECEIVABLE_LIST_LIMIT);
}
