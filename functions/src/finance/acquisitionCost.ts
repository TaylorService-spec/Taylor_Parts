// Finance — GOVERNED ACQUISITION COST (FIN-BLOCK-003A). PURE: no I/O, no clock, no Firestore.
//
// This is the FIRST governed cost supply in EOS. Before it, the FIN-BLOCK-003 reconciliation measured
// CASE D — no governed cost fact existed anywhere, and every margin, valuation and turns question was
// truthfully UNKNOWN for want of one.
//
// ============================ WHAT THIS FACT IS, AND IS NOT ============================
//
// It is ONE thing: what a purchased physical good actually cost to acquire, per the price the business
// committed to a vendor, evidenced at the moment the goods were received. It is operational cost
// EVIDENCE.
//
// It is NOT book inventory value, NOT GAAP valuation, NOT tax basis, NOT COGS, NOT landed cost and NOT
// replacement cost. Each of those needs a policy this fact deliberately does not contain — which cost a
// unit on hand carries, when cost leaves inventory, what overhead attaches. Those remain open, and this
// module must not be extended to answer them without a ruling.
//
// ============================ WHY NOT GovernedCostFact ============================
//
// The obvious question, and it was measured before writing a line: `costMargin.ts` already defines a
// `GovernedCostFact`, and the standing instruction is not to build a parallel model when a governed
// shape already fits.
//
// It does not fit, and the reason is load-bearing rather than cosmetic. `GovernedCostFact.lineRef` binds
// a cost to a REVENUE LINE. That is the margin question — "which cost belongs to this sale" — and at
// receipt time there is no sale, no revenue line, and no answer. Binding one would BE the COGS
// cost-flow decision (which receipt's cost attaches to which sale), which this package is expressly
// forbidden from making. A nullable revenue ref would be worse: it would invite exactly that binding to
// be filled in later by whoever needed a number.
//
// So the two are different facts at different times, and the seam between them is named rather than
// blurred: an ACQUISITION fact is the historical evidence from which a future COGS authority, once a
// cost-flow policy exists, would CONSTRUCT `GovernedCostFact`s. Until then nothing converts one into
// the other, and `deriveGrossMargin` keeps returning UNKNOWN — correctly.
//
// ============================ IMMUTABLE, AND WHY THAT COSTS NOTHING HERE ============================
//
// A cost fact is an event: it records what was true at a receipt. It is never updated in place. That is
// not a rule bolted on — it falls out of the identity below being derived from (receivingId, lineId),
// so the same receipt cannot produce a second fact and a retry cannot produce a different one.
//
// Correction authority is OPEN (no governed correction mechanism exists for any financial event of this
// kind yet). A future correction must be ADDITIVE — a reversing or superseding fact — never a mutation.

export const ACQUISITION_COST_COLLECTION = "inventory_acquisition_costs";

/**
 * The ONLY v1 basis. One member deliberately.
 *
 * The basis says WHAT THE FACT IS — the price on the purchase-order line the business committed to the
 * vendor. It does not choose a valuation policy, and a reader must be able to tell those apart.
 *
 * WEIGHTED_AVERAGE / FIFO / LIFO / STANDARD_COST / REPLACEMENT_COST / LABOR_BURDEN are deliberately
 * ABSENT. Pre-registering them would suggest a costing method had been chosen; none has. Adding one is
 * an Owner accounting ruling, not a code change.
 */
export const ACQUISITION_COST_BASES = Object.freeze(["PURCHASE_ORDER_LINE_PRICE"] as const);
export type AcquisitionCostBasis = (typeof ACQUISITION_COST_BASES)[number];
export const PURCHASE_ORDER_LINE_PRICE: AcquisitionCostBasis = "PURCHASE_ORDER_LINE_PRICE";

/** Repo convention (partSupplierItems.ts:52): ISO-4217 style, 3 uppercase letters. */
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export type AcquisitionCostFailureCode =
  | "PRICE_INVALID"
  | "CURRENCY_INVALID"
  | "PRICE_INCOMPLETE"
  | "COMPANY_REQUIRED"
  | "LINEAGE_REQUIRED"
  | "QUANTITY_INVALID"
  | "COST_OVERFLOW";

export class AcquisitionCostError extends Error {
  readonly code: AcquisitionCostFailureCode;
  constructor(code: AcquisitionCostFailureCode, message: string) {
    super(message);
    this.code = code;
    this.name = new.target.name;
  }
}

/**
 * A governed price committed to a vendor on one purchase-order line.
 *
 * Integer minor units and an explicit currency, together or not at all — see `governedPurchasePrice`.
 */
export interface GovernedPurchasePrice {
  readonly unitPriceMinor: number;
  readonly currency: string;
}

/**
 * ONE immutable historical acquisition-cost fact: what this quantity of this part actually cost, on
 * this receipt, against this committed purchase-order line, for this operating company.
 *
 * Every field is lineage or money. There is deliberately no status, no valuation, no allocation and no
 * revenue reference — a fact that could be re-derived differently later is not evidence.
 */
export interface AcquisitionCostFact {
  readonly costBasis: AcquisitionCostBasis;
  /** Taylor vs Ventana. Inherited from the governed purchase transaction; never inferred (ruling 7). */
  readonly operatingCompanyId: string;
  readonly purchaseOrderId: string;
  readonly purchaseOrderLineId: string;
  readonly purchaseOrderSourceType: string;
  /**
   * Concurrency version of the source PO at the moment of receipt, where the source HAS one. Null for
   * the legacy reorder purchase order, which is immutable by Rules and therefore has no revisions —
   * null is the true statement, and 0 would imply a version that does not exist.
   */
  readonly purchaseOrderVersion: number | null;
  /** A legacy PO carries a supplier NAME, not a Supplier Master id. Both nullable, neither invented. */
  readonly supplierId: string | null;
  readonly supplierName: string | null;
  readonly partId: string;
  readonly receivedQuantity: number;
  readonly unitPriceMinor: number;
  /** unitPriceMinor × receivedQuantity, in integer minor units. Never a float product. */
  readonly extendedCostMinor: number;
  readonly currency: string;
  readonly receivingId: string;
  readonly receivingLineId: string;
  /** The governed business event time of the receipt (G-05 ruling 14 — never createdAt/updatedAt). */
  readonly receivedAtMillis: number;
  readonly receivingLocationType: string;
  readonly receivingLocationId: string;
}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim().length > 0 ? v.trim() : null);

/**
 * Normalize and validate a purchase-order line price at VENDOR COMMITMENT.
 *
 * Returns `null` when NEITHER field is present — an unpriced line, which is a legitimate state: the
 * live purchasing workflow predates this authority and legacy purchase orders carry no money at all.
 * An unpriced line yields no cost fact and the cost of that receipt is UNKNOWN. It is never zero.
 *
 * A PARTIAL price is REFUSED rather than normalized. An amount with no currency is not a smaller fact
 * than a full one — it is an amount whose meaning is unknown, and defaulting it to USD would be exactly
 * the implicit-currency assumption every other governed money path in this repo refuses.
 *
 * FLOATS ARE REFUSED, not rounded. `19.99` is not 1999 minor units by any rule this module gets to
 * choose; accepting it would silently introduce floating-point money on the one path that exists to
 * keep money exact. The dormant Epic-5 `purchase_orders.unitPrice` is a float field, and this is the
 * check that stops it becoming the cost authority by accident.
 */
export function governedPurchasePrice(input: {
  readonly unitPriceMinor?: unknown;
  readonly currency?: unknown;
}): GovernedPurchasePrice | null {
  const hasPrice = input?.unitPriceMinor !== undefined && input.unitPriceMinor !== null;
  const hasCurrency = input?.currency !== undefined && input.currency !== null;
  if (!hasPrice && !hasCurrency) return null;
  if (hasPrice !== hasCurrency) {
    throw new AcquisitionCostError(
      "PRICE_INCOMPLETE",
      "a purchase line price requires BOTH unitPriceMinor and currency — an amount with no currency has no governed meaning",
    );
  }
  const unitPriceMinor = input.unitPriceMinor;
  if (!isInt(unitPriceMinor)) {
    throw new AcquisitionCostError(
      "PRICE_INVALID",
      "unitPriceMinor must be an integer in minor units — fractional and floating-point money is refused, not rounded",
    );
  }
  if (unitPriceMinor < 0) {
    // Negative money is carried by TYPE, never by sign, everywhere else in this repo (CREDIT_MEMO /
    // DEBIT_CHARGE / WRITE_OFF all validate positive). A vendor rebate or return credit therefore needs
    // its own governed type, which is an open decision — not a minus sign smuggled in here.
    throw new AcquisitionCostError("PRICE_INVALID", "unitPriceMinor must not be negative — credits require their own governed type");
  }
  const currency = str(input.currency);
  if (currency === null || !CURRENCY_PATTERN.test(currency)) {
    throw new AcquisitionCostError("CURRENCY_INVALID", "currency must be 3 uppercase letters (ISO-4217 style)");
  }
  return Object.freeze({ unitPriceMinor, currency });
}

/**
 * Build ONE acquisition-cost fact for the quantity actually received on one line.
 *
 * PARTIAL RECEIPTS FALL OUT OF THIS RATHER THAN NEEDING A RULE (ruling 9). The fact is built from the
 * quantity received NOW, so receiving 4 of 10 records evidence for 4. A later receipt for the remaining
 * 6 builds its own fact from the price governing THAT receipt. Nothing recomputes the first one,
 * because nothing can: it is a separate immutable document keyed by its own receipt.
 */
export function buildAcquisitionCostFact(input: {
  readonly price: GovernedPurchasePrice;
  readonly operatingCompanyId: unknown;
  readonly purchaseOrderId: unknown;
  readonly purchaseOrderLineId: unknown;
  readonly purchaseOrderSourceType: unknown;
  readonly purchaseOrderVersion: number | null;
  readonly supplierId: string | null;
  readonly supplierName: string | null;
  readonly partId: unknown;
  readonly receivedQuantity: unknown;
  readonly receivingId: unknown;
  readonly receivingLineId: unknown;
  readonly receivedAtMillis: unknown;
  readonly receivingLocationType: unknown;
  readonly receivingLocationId: unknown;
}): AcquisitionCostFact {
  // COMPANY FIRST, and fail-closed. A cost with no operating company cannot be told apart from the
  // other company's cost, so a Taylor-vs-Ventana figure built from it would be a guess wearing a total.
  const operatingCompanyId = str(input.operatingCompanyId);
  if (operatingCompanyId === null) {
    throw new AcquisitionCostError(
      "COMPANY_REQUIRED",
      "operatingCompanyId is required on every acquisition cost fact and comes from the governed purchase transaction — never from location, vendor, SKU, user or customer",
    );
  }

  const lineage: Array<[string, string | null]> = [
    ["purchaseOrderId", str(input.purchaseOrderId)],
    ["purchaseOrderLineId", str(input.purchaseOrderLineId)],
    ["purchaseOrderSourceType", str(input.purchaseOrderSourceType)],
    ["partId", str(input.partId)],
    ["receivingId", str(input.receivingId)],
    ["receivingLineId", str(input.receivingLineId)],
    ["receivingLocationType", str(input.receivingLocationType)],
    ["receivingLocationId", str(input.receivingLocationId)],
  ];
  for (const [field, value] of lineage) {
    if (value === null) {
      throw new AcquisitionCostError("LINEAGE_REQUIRED", `${field} is required — a cost with no traceable source is not evidence`);
    }
  }
  const [poId, poLineId, poSourceType, partId, receivingId, receivingLineId, locType, locId] = lineage.map((l) => l[1] as string);

  const receivedQuantity = input.receivedQuantity;
  if (!isInt(receivedQuantity) || receivedQuantity <= 0) {
    throw new AcquisitionCostError("QUANTITY_INVALID", "receivedQuantity must be a positive integer");
  }
  if (!isInt(input.receivedAtMillis)) {
    throw new AcquisitionCostError("LINEAGE_REQUIRED", "receivedAtMillis must be the governed receipt event time in epoch millis");
  }
  if (input.purchaseOrderVersion !== null && (!isInt(input.purchaseOrderVersion) || input.purchaseOrderVersion < 0)) {
    throw new AcquisitionCostError("LINEAGE_REQUIRED", "purchaseOrderVersion must be a non-negative integer or null");
  }

  // Integer × integer. Checked rather than assumed: a product outside the safe range would be silently
  // wrong money, and there is no rounding decision available to rescue it.
  const extendedCostMinor = input.price.unitPriceMinor * receivedQuantity;
  if (!isInt(extendedCostMinor)) {
    throw new AcquisitionCostError("COST_OVERFLOW", "extended cost exceeds the exact integer range — the value cannot be represented truthfully");
  }

  return Object.freeze({
    costBasis: PURCHASE_ORDER_LINE_PRICE,
    operatingCompanyId,
    purchaseOrderId: poId,
    purchaseOrderLineId: poLineId,
    purchaseOrderSourceType: poSourceType,
    purchaseOrderVersion: input.purchaseOrderVersion,
    supplierId: input.supplierId ?? null,
    supplierName: input.supplierName ?? null,
    partId,
    receivedQuantity,
    unitPriceMinor: input.price.unitPriceMinor,
    extendedCostMinor,
    currency: input.price.currency,
    receivingId,
    receivingLineId,
    receivedAtMillis: input.receivedAtMillis,
    receivingLocationType: locType,
    receivingLocationId: locId,
  });
}

/**
 * The document id for one acquisition-cost fact.
 *
 * Derived from (receivingId, receiptLineId), which is what makes idempotency structural rather than
 * defended: a receipt retry addresses the same id, and the write is a `create`, so a duplicate cost
 * event cannot be produced by replay, by retry, or by two callers racing. A duplicate cost event is a
 * financial defect, so the safest place to prevent it is identity rather than a check someone can
 * forget to run.
 *
 * Plain rather than hashed: both components are already governed, collision-free ids, and a legible id
 * is worth more than uniformity when someone is tracing a number back to the receipt that made it.
 */
export function acquisitionCostDocId(receivingId: string, receiptLineId: string): string {
  return `${receivingId}__${receiptLineId}`;
}
