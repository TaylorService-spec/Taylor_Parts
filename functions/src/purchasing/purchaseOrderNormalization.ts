// Multi-line purchase order — PURE normalization + receipt derivation. Phase B.
//
// INERT BY CONSTRUCTION. Nothing here is exported from functions/src/index.ts, no callable reaches
// it, no command calls it, and it performs no I/O. It is the proposed compatibility contract for
// Phase C, written and tested now so the design is verifiable before any live contract moves.
//
// ============================ WHY THIS SHAPE ============================
//
// `reorder_purchase_orders` cannot become multi-line. The constraint is document IDENTITY, not
// field shape: the document id IS the reorder request id (firestore.rules:1049,1073), the field set
// is pinned by keys().hasOnly (firestore.rules:1068), and the document is immutable
// (firestore.rules:1092, `allow update, delete: if false`). A multi-line PO spanning three parts has
// no single reorder request to be named after.
//
// So a legacy PO is NORMALIZED into the canonical shape for reading and receiving, and is never
// rewritten. The normalizer is total over both shapes, which is what makes mixed coexistence
// permanent and unremarkable rather than a migration window.
//
// ============================ DERIVED, NOT STORED ============================
//
// Cumulative received quantity is the SUM OF COMMITTED RECEIPTS, never a counter mutated on the PO.
// `receiving_orders` is already identified by rcv_<sha256(idempotencyKey)> -- receipt identity, not
// PO identity -- so a PO can already carry many receipts. Deriving instead of storing means:
// concurrent receipts cannot lose an update, an immutable document stays immutable, and every
// quantity traces to a receipt with an actor, a ledger event and an audit id. It is also the
// precedent this codebase already set with `reorder_purchase_order_voids`: facts about an immutable
// PO live in a separate append-only record.
//
// ============================ WHAT IS NOT SETTLED ============================
//
// The line/PO STATE VOCABULARY is an open Owner decision (Phase B package §4.1). `PurchaseOrderStatus`
// has no value for "partially received" and `REORDER_REQUEST_STATUS` has none either. The states
// below are the PROPOSED derived-only set -- they add no stored vocabulary, cannot drift from the
// receipts, and need no migration. They are a proposal under test, not a ratified authority, and
// Phase C must not proceed on them until §4.1 is answered.

import { governedPurchasePrice, AcquisitionCostError } from "../finance/acquisitionCost.js";

/** A line on the canonical purchase order. `quantity` matches types/procurement.ts's PurchaseOrderLineItem. */
export interface CanonicalPoLine {
  readonly lineId: string;
  readonly partId: string;
  readonly quantity: number;
  /**
   * FIN-BLOCK-003A -- the GOVERNED committed price for this line, or null.
   *
   * Null for every line that carries no governed price, which today is every canonical line and every
   * legacy line recorded before this authority existed. Null means UNKNOWN, never zero, and receiving
   * writes no cost fact for a null-priced line.
   *
   * Both fields move together by construction below, so a line can never carry an amount whose
   * currency is unknown.
   */
  readonly unitPriceMinor: number | null;
  readonly currency: string | null;
}

export interface CanonicalPurchaseOrder {
  readonly purchaseOrderId: string;
  /**
   * Null for every legacy document, and honestly so: a legacy PO carries `supplierName` (a string),
   * not a Supplier Master id. A name is not an id, and inventing a resolution here would either be
   * a per-read lookup (an N+1) or a guess. The existing supplier migration can populate ids later;
   * receiving never reads the supplier.
   */
  readonly supplierId: string | null;
  readonly supplierName: string | null;
  readonly status: string | null;
  readonly lines: readonly CanonicalPoLine[];
  /**
   * FIN-BLOCK-003A -- the governed operating company that owns this purchase, or null.
   *
   * Present on the LIVE reorder purchase order, which inherits it from its reorder request and refuses
   * a client-supplied value. Null on the canonical `purchase_orders`, which has no company field at
   * all -- and a null here is why a canonical receipt can produce no cost fact even if it somehow
   * carried a price: an acquisition cost that cannot say whether it is Taylor's or Ventana's is not
   * evidence. Never inferred from warehouse, vendor, SKU, user or customer.
   */
  readonly operatingCompanyId: string | null;
  /** Which shape this came from. Stated rather than inferred by the caller. */
  readonly origin: "LEGACY_REORDER" | "CANONICAL";
}

/**
 * The line id every legacy purchase order normalizes to.
 *
 * Fixed rather than hashed. A legacy PO has exactly one line BY CONSTRUCTION -- the document id is a
 * single-part reorder request's id -- so a hash would add no uniqueness and cost legibility. Being a
 * constant makes it deterministic across every read, every receipt, and every replay, which is what
 * a receipt referencing `(purchaseOrderId, lineId)` needs in order to mean the same thing forever.
 */
export const LEGACY_LINE_ID = "L1";

export class PurchaseOrderNormalizationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = new.target.name;
  }
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim().length > 0 ? v : null);
const posInt = (v: unknown): boolean => typeof v === "number" && Number.isFinite(v) && v > 0;

// The DERIVED line shape receiving reads its cost from. Kept next to the derivation rather than
// re-looked-up, so the price a receipt prices against is the price on the line it validated against.
export interface DerivedLinePrice {
  readonly unitPriceMinor: number | null;
  readonly currency: string | null;
}

/**
 * A legacy `reorder_purchase_orders` document → the canonical shape.
 *
 * PURE: returns a new value and never touches the input. Nothing is written back, so a read can
 * never silently repair or restamp a legacy document.
 */
export function normalizeLegacyPurchaseOrder(
  purchaseOrderId: string,
  data: Record<string, unknown> | undefined
): CanonicalPurchaseOrder {
  if (!str(purchaseOrderId)) {
    throw new PurchaseOrderNormalizationError("PO_ID_INVALID", "purchaseOrderId is required");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new PurchaseOrderNormalizationError("PO_MALFORMED", "purchase order document is malformed");
  }
  const partId = str(data.partId);
  if (!partId) {
    throw new PurchaseOrderNormalizationError("PO_PART_INVALID", "legacy purchase order partId invalid");
  }
  if (!posInt(data.orderedQuantity)) {
    throw new PurchaseOrderNormalizationError("PO_QUANTITY_INVALID", "legacy purchase order orderedQuantity invalid");
  }
  // FIN-BLOCK-003A -- the governed committed price, where this purchase order carries one.
  //
  // Validated through the finance authority rather than copied. A stored document is untrusted input
  // to a reader: these fields were written by the current command, but a document from any other
  // origin -- an import, a fixture, a hand-edit, a future writer -- must not be able to put a float or
  // a currency-less amount into the cost path just because it reached Firestore. A malformed price is
  // refused rather than dropped, because silently reading it as "unpriced" would turn a corrupt
  // purchase order into a free one.
  let price: { unitPriceMinor: number; currency: string } | null;
  try {
    price = governedPurchasePrice({ unitPriceMinor: data.unitPriceMinor, currency: data.currency });
  } catch (err) {
    if (err instanceof AcquisitionCostError) {
      throw new PurchaseOrderNormalizationError("PO_PRICE_INVALID", `legacy purchase order price invalid: ${err.code}`);
    }
    throw err;
  }
  return Object.freeze({
    purchaseOrderId,
    // See CanonicalPurchaseOrder.supplierId -- a legacy PO has a name, not an id.
    supplierId: null,
    supplierName: str(data.supplierName),
    status: str(data.status),
    lines: Object.freeze([
      Object.freeze({
        lineId: LEGACY_LINE_ID,
        partId,
        quantity: data.orderedQuantity as number,
        unitPriceMinor: price === null ? null : price.unitPriceMinor,
        currency: price === null ? null : price.currency,
      }),
    ]),
    // The one path that HAS a governed company: the live PO inherits it from its reorder request.
    operatingCompanyId: str(data.operatingCompanyId),
    origin: "LEGACY_REORDER" as const,
  });
}

/**
 * A canonical `purchase_orders` document → the canonical shape.
 *
 * Duplicate line ids are REJECTED rather than de-duplicated. A receipt addresses a line by id, so
 * two lines sharing one id would make "receive 3 against L2" ambiguous — and silently collapsing
 * them would pick an answer nobody asked for.
 */
export function normalizeCanonicalPurchaseOrder(
  purchaseOrderId: string,
  data: Record<string, unknown> | undefined
): CanonicalPurchaseOrder {
  if (!str(purchaseOrderId)) {
    throw new PurchaseOrderNormalizationError("PO_ID_INVALID", "purchaseOrderId is required");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new PurchaseOrderNormalizationError("PO_MALFORMED", "purchase order document is malformed");
  }
  const rawItems = Array.isArray(data.items) ? data.items : null;
  if (!rawItems || rawItems.length === 0) {
    throw new PurchaseOrderNormalizationError("PO_NO_LINES", "purchase order has no lines");
  }
  const seen = new Set<string>();
  const lines = rawItems.map((raw, i) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    // A canonical line without its own id falls back to an ordinal. Deterministic for a given
    // document, and it means an existing procurementService document -- whose items carry no
    // lineId -- normalizes without needing to be rewritten first.
    const lineId = str(item.lineId) ?? `L${i + 1}`;
    if (seen.has(lineId)) {
      throw new PurchaseOrderNormalizationError("PO_LINE_DUPLICATE", `duplicate lineId ${lineId}`);
    }
    seen.add(lineId);
    const partId = str(item.partId);
    if (!partId) {
      throw new PurchaseOrderNormalizationError("PO_PART_INVALID", `line ${lineId} partId invalid`);
    }
    if (!posInt(item.quantity)) {
      throw new PurchaseOrderNormalizationError("PO_QUANTITY_INVALID", `line ${lineId} quantity invalid`);
    }
    // FIN-BLOCK-003A -- THE EPIC-5 PRICE IS DELIBERATELY NOT READ. `PurchaseOrderLineItem.unitPrice`
    // exists on this shape, and mapping it here is the single most tempting way to give EOS a cost
    // supply "for free". It is refused, for three measured reasons, any one of which is sufficient:
    //
    //   1. It is a FLOAT. Money in this repository is integer minor units; adopting it would introduce
    //      floating-point money on the one path whose purpose is exact cost.
    //   2. It carries NO CURRENCY. There is no field, so the only way to use the number is to assume
    //      one -- the implicit-USD assumption every governed money path here refuses.
    //   3. Its purchase order carries NO operatingCompanyId, so the resulting cost could not be
    //      attributed to Taylor or Ventana.
    //
    // The Owner ruling is explicit that this path must not become the cost authority and that its
    // defects must not be migrated into the live one. So a canonical line is UNPRICED here -- not
    // because no number is present, but because no GOVERNED price is. A canonical receipt therefore
    // produces no cost fact, and its cost is UNKNOWN. Whether this layer is retired or converted is
    // Owner decision 2; converting it is a data decision, not a normalization detail.
    return Object.freeze({ lineId, partId, quantity: item.quantity as number, unitPriceMinor: null, currency: null });
  });
  return Object.freeze({
    purchaseOrderId,
    supplierId: str(data.supplierId),
    supplierName: str(data.supplierName),
    status: str(data.status),
    lines: Object.freeze(lines),
    // No company field exists on this shape. Null is the true statement; inferring one would be the
    // inference ruling 7 forbids.
    operatingCompanyId: null,
    origin: "CANONICAL" as const,
  });
}

// ---------------------------------------------------------------- receipt derivation

/** One committed receipt line, as `receiving_orders` already stores it. */
export interface CommittedReceiptLine {
  readonly lineId: string;
  readonly receivedQuantity: number;
  readonly serialNumbers?: readonly string[];
}

export interface CommittedReceipt {
  readonly receivingId: string;
  readonly lines: readonly CommittedReceiptLine[];
}

/**
 * PROPOSED derived line/PO states — pending Owner decision (Phase B package §4.1).
 *
 * Derived, never stored: they cannot drift from the receipts they are computed from, and they add
 * no vocabulary to any document, so adopting them needs no migration.
 */
export const PO_LINE_STATE = Object.freeze({
  NOT_RECEIVED: "NOT_RECEIVED",
  PARTIALLY_RECEIVED: "PARTIALLY_RECEIVED",
  RECEIVED: "RECEIVED",
});

export interface DerivedLine {
  readonly lineId: string;
  readonly partId: string;
  readonly orderedQuantity: number;
  readonly receivedQuantity: number;
  readonly remainingQuantity: number;
  readonly state: string;
  /**
   * FIN-BLOCK-003A -- the governed price carried through from the PO line, unchanged.
   *
   * Carried rather than re-read so that the price a receipt is COSTED at is the same price it was
   * VALIDATED against, from one read of one document inside one transaction. A second lookup could
   * observe a different value and produce a cost fact for a price the receipt never checked.
   */
  readonly unitPriceMinor: number | null;
  readonly currency: string | null;
}

export interface DerivedPurchaseOrder {
  readonly purchaseOrderId: string;
  readonly lines: readonly DerivedLine[];
  readonly state: string;
  /** True when every line is satisfied — the ONLY condition under which the source may close. */
  readonly fullyReceived: boolean;
}

/**
 * Fold committed receipts over a canonical PO.
 *
 * Receipts naming a line the PO does not have are IGNORED here rather than throwing: this is a
 * read-side derivation over history, and a stored receipt is a fact that already happened. Rejecting
 * an unknown line is the WRITE path's job (Phase C validates before committing), where refusing it
 * still prevents something. Throwing here would make an unrelated PO unreadable because of one bad
 * historical record.
 */
export function deriveReceiptState(
  po: CanonicalPurchaseOrder,
  receipts: readonly CommittedReceipt[]
): DerivedPurchaseOrder {
  const receivedByLine = new Map<string, number>();
  for (const receipt of receipts ?? []) {
    for (const line of receipt?.lines ?? []) {
      if (!posInt(line?.receivedQuantity)) continue;
      const id = str(line.lineId);
      if (!id) continue;
      receivedByLine.set(id, (receivedByLine.get(id) ?? 0) + line.receivedQuantity);
    }
  }

  const lines = po.lines.map((l) => {
    const received = receivedByLine.get(l.lineId) ?? 0;
    // Clamped at zero. Over-receipt is rejected before any write, so a negative remainder can only
    // come from historical data that predates the rule -- and a negative "remaining" would be read
    // as an amount still owed, which is the opposite of what it means.
    const remaining = Math.max(0, l.quantity - received);
    const state =
      received === 0
        ? PO_LINE_STATE.NOT_RECEIVED
        : received >= l.quantity
          ? PO_LINE_STATE.RECEIVED
          : PO_LINE_STATE.PARTIALLY_RECEIVED;
    return Object.freeze({
      lineId: l.lineId,
      partId: l.partId,
      orderedQuantity: l.quantity,
      receivedQuantity: received,
      remainingQuantity: remaining,
      state,
      unitPriceMinor: l.unitPriceMinor,
      currency: l.currency,
    });
  });

  const every = (s: string) => lines.every((l) => l.state === s);
  const state = lines.length === 0
    ? PO_LINE_STATE.NOT_RECEIVED
    : every(PO_LINE_STATE.RECEIVED)
      ? PO_LINE_STATE.RECEIVED
      : every(PO_LINE_STATE.NOT_RECEIVED)
        ? PO_LINE_STATE.NOT_RECEIVED
        : PO_LINE_STATE.PARTIALLY_RECEIVED;

  return Object.freeze({
    purchaseOrderId: po.purchaseOrderId,
    lines: Object.freeze(lines),
    state,
    fullyReceived: lines.length > 0 && every(PO_LINE_STATE.RECEIVED),
  });
}

/**
 * Validate one proposed receipt against what remains — the check Phase C's command will perform
 * BEFORE any write.
 *
 * Over-receipt is rejected by default. Partial receipt is permitted. A line the PO does not carry,
 * or the same line twice in one receipt, is rejected: both make the intended quantity ambiguous.
 *
 * A SERIAL observation must carry exactly `receivedQuantity` distinct serials — one physical unit,
 * one serial, one serialized asset — which is the invariant receivingValidation.ts:107 already
 * enforces for the single-line case.
 */
export function validateProposedReceipt(
  derived: DerivedPurchaseOrder,
  proposed: readonly CommittedReceiptLine[]
): { readonly valid: true } | { readonly valid: false; readonly code: string; readonly lineId: string | null } {
  if (!Array.isArray(proposed) || proposed.length === 0) {
    return { valid: false, code: "RECEIPT_NO_LINES", lineId: null };
  }
  const byLine = new Map(derived.lines.map((l) => [l.lineId, l]));
  const seen = new Set<string>();
  for (const line of proposed) {
    const lineId = str(line?.lineId);
    if (!lineId) return { valid: false, code: "RECEIPT_LINE_INVALID", lineId: null };
    if (seen.has(lineId)) return { valid: false, code: "RECEIPT_LINE_DUPLICATE", lineId };
    seen.add(lineId);
    const target = byLine.get(lineId);
    if (!target) return { valid: false, code: "RECEIPT_LINE_UNKNOWN", lineId };
    if (!posInt(line.receivedQuantity)) return { valid: false, code: "RECEIPT_QUANTITY_INVALID", lineId };
    if (line.receivedQuantity > target.remainingQuantity) {
      return { valid: false, code: "RECEIPT_OVER_RECEIPT", lineId };
    }
    if (line.serialNumbers !== undefined) {
      const serials = line.serialNumbers;
      if (!Array.isArray(serials)) return { valid: false, code: "RECEIPT_SERIALS_INVALID", lineId };
      if (serials.length !== line.receivedQuantity) {
        return { valid: false, code: "RECEIPT_SERIAL_COUNT_MISMATCH", lineId };
      }
      if (new Set(serials).size !== serials.length) {
        return { valid: false, code: "RECEIPT_SERIAL_DUPLICATE", lineId };
      }
    }
  }
  return { valid: true };
}
