// CERT-FIN-02 -- the inventory COST ENGINE. Given governed acquisition facts, a physical relief
// quantity and an effective policy profile, what is the cost relieved and what is left behind?
//
// PURE and DETERMINISTIC. No Firestore, no clock, no I/O, integer minor units only. The same inputs
// always produce the same answer, which is what makes a financial number defensible.
//
// ============================ WHY THERE IS NO COST-POOL COLLECTION ============================
//
// A weighted-average pool sounds like a stored running balance, and building one was the obvious
// move. It is not needed, and adding it would have been the expensive kind of wrong.
//
// The acquisition-cost facts ARE the layers. Each one already records a quantity, a unit price, a
// currency, an operating company and its full receipt lineage, and each is immutable. A FIFO layer
// set is those facts in receipt order; a weighted average is an aggregate over the same set. Both are
// therefore DERIVABLE from evidence that already exists, and a derived number that can be recomputed
// from immutable facts cannot drift from them -- which a separate stored pool absolutely can.
//
// The only thing that is genuinely new state is RELIEF: which quantity has already been costed out.
// And relief is written by a recognition event, which does not exist yet, because the
// recognition point is an open accounting decision. So this module takes prior reliefs as an INPUT.
// When a recognition event is built it will supply them; until then the engine is exercised by tests
// with explicit relief history, and no half-built pool sits in the database waiting to go stale.
//
// If a future measurement shows the derivation is too slow to run live, the answer is a CACHE of a
// derivable value, which is a different and much safer object than an authoritative pool.
//
// ============================ UNKNOWN IS A RESULT, NOT A FAILURE ============================
//
// A lot with no governed cost does not make the engine throw and does not contribute zero. It makes
// the ANSWER unknown, and the answer says so, and it says which lots caused it. A caller that wants
// a number gets `state: "UNKNOWN"` and no number at all -- there is nothing here to accidentally read
// as a dollar value.

import {
  type FinancialPolicyProfile,
  type InventoryCostMethod,
  type SerializedCostMethod,
} from "./financialPolicyProfile.js";

/**
 * One governed acquisition fact, reduced to what costing needs.
 *
 * `unitPriceMinor === null` is an UNPRICED lot -- physically real stock whose cost EOS does not know.
 * It is never zero. `serialNo` is present only for individually identifiable units.
 */
export interface CostLot {
  readonly lotId: string;
  readonly operatingCompanyId: string;
  readonly partId: string;
  readonly quantity: number;
  readonly unitPriceMinor: number | null;
  readonly currency: string | null;
  /** Governed receipt time. The ordering key for FIFO -- never a write clock. */
  readonly receivedAtMillis: number;
  readonly serialNo?: string;
}

/** A quantity already costed out of the pool by a prior governed recognition event. */
export interface CostRelief {
  readonly quantity: number;
  readonly serialNo?: string;
}

export type CostFigureState = "KNOWN" | "UNKNOWN";

/**
 * A money answer that can honestly be "I don't know".
 *
 * There is no `amountMinor` on the UNKNOWN branch, deliberately: a nullable number invites
 * `?? 0` at the call site, and that single character is how UNKNOWN becomes zero.
 */
export type CostFigure =
  | { readonly state: "KNOWN"; readonly amountMinor: number; readonly currency: string }
  | { readonly state: "UNKNOWN"; readonly reason: string; readonly unpricedLotIds: readonly string[] };

export interface CostReliefResult {
  /**
   * Cost relieved from the pool by this relief.
   *
   * Deliberately NOT named for cost-of-goods-sold. This is an arithmetic result: the value that left
   * the pool. WHETHER that relief is recognized as cost against revenue is the recognition decision
   * carried by the policy profile, and it is still open -- so naming the number after the recognition
   * would assert a conclusion nobody has reached. A recognition event, when one is built, is what
   * turns this into COGS.
   */
  readonly relievedCost: CostFigure;
  /** Value of what remains in the pool afterwards. */
  readonly remainingValue: CostFigure;
  readonly remainingQuantity: number;
  /** The method that produced this answer. Echoed so a stored result can never be misread later. */
  readonly method: InventoryCostMethod | SerializedCostMethod;
}

export type CostEngineFailureCode =
  | "LOT_MALFORMED"
  | "RELIEF_MALFORMED"
  | "COMPANY_MIXED"
  | "CURRENCY_MIXED"
  | "PART_MIXED"
  | "INSUFFICIENT_QUANTITY"
  | "SERIAL_REQUIRED"
  | "SERIAL_NOT_FOUND"
  | "SERIAL_AMBIGUOUS";

export class CostEngineError extends Error {
  readonly code: CostEngineFailureCode;
  constructor(code: CostEngineFailureCode, message: string) {
    super(message);
    this.code = code;
    this.name = new.target.name;
  }
}

const isQty = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
const isMinor = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

function unknown(reason: string, unpricedLotIds: readonly string[]): CostFigure {
  return { state: "UNKNOWN", reason, unpricedLotIds: Object.freeze([...unpricedLotIds]) };
}
function known(amountMinor: number, currency: string): CostFigure {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new CostEngineError("LOT_MALFORMED", "computed cost exceeds the exact integer range and cannot be stated truthfully");
  }
  return { state: "KNOWN", amountMinor, currency };
}

/**
 * Validate the lot set and establish its single company / part / currency.
 *
 * A pool that mixes operating companies is refused outright rather than summed -- that is the company
 * partition invariant, enforced here instead of trusted to the caller's query. Mixed currency is
 * likewise refused: adding 100 USD to 100 CAD produces a number with no meaning.
 */
function poolIdentity(lots: readonly CostLot[]): {
  readonly currency: string | null;
  readonly unpricedLotIds: readonly string[];
} {
  let company: string | null = null;
  let part: string | null = null;
  let currency: string | null = null;
  const unpricedLotIds: string[] = [];

  for (const lot of lots) {
    if (typeof lot?.lotId !== "string" || lot.lotId.trim() === "") {
      throw new CostEngineError("LOT_MALFORMED", "every cost lot needs an id");
    }
    if (!isQty(lot.quantity)) {
      throw new CostEngineError("LOT_MALFORMED", `lot ${lot.lotId}: quantity must be a positive finite number`);
    }
    if (typeof lot.receivedAtMillis !== "number" || !Number.isFinite(lot.receivedAtMillis)) {
      throw new CostEngineError("LOT_MALFORMED", `lot ${lot.lotId}: receivedAtMillis must be a finite number`);
    }
    if (company === null) company = lot.operatingCompanyId;
    else if (company !== lot.operatingCompanyId) {
      throw new CostEngineError(
        "COMPANY_MIXED",
        "a cost pool never spans operating companies -- cost does not cross that boundary",
      );
    }
    if (part === null) part = lot.partId;
    else if (part !== lot.partId) {
      throw new CostEngineError("PART_MIXED", "a cost pool is one part; pooling different parts would average unrelated things");
    }

    const priced = lot.unitPriceMinor !== null && lot.unitPriceMinor !== undefined;
    if (!priced) {
      unpricedLotIds.push(lot.lotId);
      continue;
    }
    if (!isMinor(lot.unitPriceMinor)) {
      throw new CostEngineError(
        "LOT_MALFORMED",
        `lot ${lot.lotId}: unitPriceMinor must be a non-negative integer in minor units -- floating-point money is refused, not rounded`,
      );
    }
    const lotCurrency = typeof lot.currency === "string" ? lot.currency : null;
    if (lotCurrency === null) {
      throw new CostEngineError("LOT_MALFORMED", `lot ${lot.lotId}: a priced lot requires an explicit currency`);
    }
    if (currency === null) currency = lotCurrency;
    else if (currency !== lotCurrency) {
      throw new CostEngineError("CURRENCY_MIXED", "a cost pool is one currency; summing different currencies produces a meaningless number");
    }
  }
  return { currency, unpricedLotIds: Object.freeze(unpricedLotIds) };
}

/** Receipt order, then lotId, so FIFO is deterministic even when two receipts share a millisecond. */
function inReceiptOrder(lots: readonly CostLot[]): CostLot[] {
  return [...lots].sort((a, b) =>
    a.receivedAtMillis !== b.receivedAtMillis
      ? a.receivedAtMillis - b.receivedAtMillis
      : a.lotId.localeCompare(b.lotId),
  );
}

function totalQuantity(lots: readonly CostLot[]): number {
  return lots.reduce((sum, l) => sum + l.quantity, 0);
}

/**
 * WEIGHTED AVERAGE.
 *
 * ROUNDING IS DONE ONCE, ON THE RELIEVED TOTAL -- never per unit. Rounding a unit cost first and
 * multiplying scatters the error across every unit and leaves a residue that never reconciles;
 * computing `poolValue * relieved / poolQuantity` and rounding that single result keeps the pool and
 * the relief exactly complementary. Half-up on the exact integer product, so the result never depends
 * on binary floating-point representation.
 */
function weightedAverage(lots: readonly CostLot[], relieved: number, currency: string): { relievedMinor: number; remainingMinor: number } {
  const poolQuantity = totalQuantity(lots);
  // Exact integer pool value: every lot is (integer minor) x (quantity), summed.
  const poolValueMinor = lots.reduce((sum, l) => sum + (l.unitPriceMinor as number) * l.quantity, 0);
  if (!Number.isSafeInteger(poolValueMinor)) {
    throw new CostEngineError("LOT_MALFORMED", "pool value exceeds the exact integer range");
  }
  const relievedMinor = roundHalfUpDiv(poolValueMinor * relieved, poolQuantity);
  // The remainder is the complement, not a second rounding -- the two always sum to the pool exactly.
  const remainingMinor = poolValueMinor - relievedMinor;
  void currency;
  return { relievedMinor, remainingMinor };
}

/**
 * Round `numerator / denominator` half-up, on exact integers. Both are non-negative here (quantities
 * and minor-unit money), so no negative-half tie-break is needed and none is invented.
 */
function roundHalfUpDiv(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator)) {
    throw new CostEngineError("LOT_MALFORMED", "intermediate cost product exceeds the exact integer range");
  }
  const whole = Math.floor(numerator / denominator);
  const remainder = numerator - whole * denominator;
  return remainder * 2 >= denominator ? whole + 1 : whole;
}

/**
 * FIFO. Consume oldest receipts first; what is left is the newest layers, at their own prices.
 *
 * A partially consumed layer contributes `unitPrice x consumedFromThatLayer` exactly -- integer
 * arithmetic throughout, no averaging, so no rounding is required at all.
 */
function fifo(lots: readonly CostLot[], relieved: number): { relievedMinor: number; remainingMinor: number } {
  let left = relieved;
  let relievedMinor = 0;
  let remainingMinor = 0;
  for (const lot of inReceiptOrder(lots)) {
    const price = lot.unitPriceMinor as number;
    const consumed = Math.min(lot.quantity, left);
    if (consumed > 0) {
      relievedMinor += price * consumed;
      left -= consumed;
    }
    const kept = lot.quantity - consumed;
    if (kept > 0) remainingMinor += price * kept;
  }
  if (!Number.isSafeInteger(relievedMinor) || !Number.isSafeInteger(remainingMinor)) {
    throw new CostEngineError("LOT_MALFORMED", "FIFO cost exceeds the exact integer range");
  }
  return { relievedMinor, remainingMinor };
}

/**
 * SPECIFIC IDENTIFICATION. The unit's own cost, from the lot that actually supplied it.
 *
 * Requires the relief to name a serial. Exactly one lot must match: zero is SERIAL_NOT_FOUND and more
 * than one is SERIAL_AMBIGUOUS -- both refused rather than resolved by picking the cheapest, the
 * oldest, or any other rule nobody approved. Guessing which receipt line supplied a serial is exactly
 * the invented financial lineage this engine exists to refuse.
 */
function specificIdentification(
  lots: readonly CostLot[],
  reliefs: readonly CostRelief[],
): { relievedMinor: number; remainingMinor: number; relievedQuantity: number; unpricedLotIds: readonly string[] } {
  let relievedMinor = 0;
  const relievedSerials = new Set<string>();
  const unpriced: string[] = [];

  for (const relief of reliefs) {
    const serial = relief.serialNo;
    if (typeof serial !== "string" || serial.trim() === "") {
      throw new CostEngineError(
        "SERIAL_REQUIRED",
        "specific identification relieves a NAMED unit; a bare quantity does not identify which unit left",
      );
    }
    const matches = lots.filter((l) => l.serialNo === serial);
    if (matches.length === 0) {
      throw new CostEngineError("SERIAL_NOT_FOUND", `no cost lot carries serial ${serial}`);
    }
    if (matches.length > 1) {
      throw new CostEngineError(
        "SERIAL_AMBIGUOUS",
        `serial ${serial} maps to ${matches.length} cost lots; EOS will not guess which receipt line supplied it`,
      );
    }
    const lot = matches[0];
    if (lot.unitPriceMinor === null || lot.unitPriceMinor === undefined) {
      unpriced.push(lot.lotId);
      continue;
    }
    relievedMinor += lot.unitPriceMinor * lot.quantity;
    relievedSerials.add(serial);
  }

  let remainingMinor = 0;
  for (const lot of lots) {
    if (lot.serialNo !== undefined && relievedSerials.has(lot.serialNo)) continue;
    if (lot.unitPriceMinor === null || lot.unitPriceMinor === undefined) {
      if (!unpriced.includes(lot.lotId)) unpriced.push(lot.lotId);
      continue;
    }
    remainingMinor += lot.unitPriceMinor * lot.quantity;
  }

  const relievedQuantity = reliefs.reduce((sum, r) => {
    const lot = lots.find((l) => l.serialNo === r.serialNo);
    return sum + (lot?.quantity ?? 0);
  }, 0);

  return { relievedMinor, remainingMinor, relievedQuantity, unpricedLotIds: Object.freeze(unpriced) };
}

/**
 * Relieve cost from a pool under an effective policy.
 *
 * `serialized` selects which of the profile's two method fields governs -- the same engine, the same
 * facts, a different configured method. Nothing here branches on a customer.
 */
export function relieveInventoryCost(input: {
  readonly profile: FinancialPolicyProfile;
  readonly lots: readonly CostLot[];
  readonly reliefs: readonly CostRelief[];
  readonly serialized?: boolean;
}): CostReliefResult {
  const { profile, lots, reliefs } = input;
  if (!Array.isArray(lots) || !Array.isArray(reliefs)) {
    throw new CostEngineError("LOT_MALFORMED", "lots and reliefs must both be arrays");
  }
  const method: InventoryCostMethod | SerializedCostMethod = input.serialized
    ? profile.serializedInventoryCostMethod
    : profile.inventoryCostMethod;

  const { currency, unpricedLotIds } = poolIdentity(lots);
  const poolQuantity = totalQuantity(lots);

  if (method === "SPECIFIC_IDENTIFICATION") {
    const r = specificIdentification(lots, reliefs);
    const remainingQuantity = poolQuantity - r.relievedQuantity;
    if (r.unpricedLotIds.length > 0 || currency === null) {
      const reason =
        currency === null
          ? "no lot in this pool carries a governed cost"
          : "one or more identified units have no governed acquisition cost";
      return {
        relievedCost: unknown(reason, r.unpricedLotIds),
        remainingValue: unknown(reason, r.unpricedLotIds),
        remainingQuantity,
        method,
      };
    }
    return {
      relievedCost: known(r.relievedMinor, currency),
      remainingValue: known(r.remainingMinor, currency),
      remainingQuantity,
      method,
    };
  }

  // --- pooled methods: a bare quantity, no serial required ---
  let relieved = 0;
  for (const relief of reliefs) {
    if (!isQty(relief?.quantity)) {
      throw new CostEngineError("RELIEF_MALFORMED", "a relief quantity must be a positive finite number");
    }
    relieved += relief.quantity;
  }
  if (relieved > poolQuantity) {
    throw new CostEngineError(
      "INSUFFICIENT_QUANTITY",
      `cannot relieve ${relieved} from a pool of ${poolQuantity} -- EOS does not invent cost to make the arithmetic close`,
    );
  }
  const remainingQuantity = poolQuantity - relieved;

  // ANY unpriced lot poisons a POOLED answer, and it must. An average or a layer walk over a set
  // where some costs are missing is not a smaller truth -- it is a confident number computed from
  // incomplete evidence, which is worse than no number.
  if (unpricedLotIds.length > 0 || currency === null) {
    const reason =
      currency === null
        ? "no lot in this pool carries a governed cost"
        : "this pool contains stock with no governed acquisition cost, so its value cannot be stated";
    return {
      relievedCost: unknown(reason, unpricedLotIds),
      remainingValue: unknown(reason, unpricedLotIds),
      remainingQuantity,
      method,
    };
  }

  const { relievedMinor, remainingMinor } =
    method === "FIFO" ? fifo(lots, relieved) : weightedAverage(lots, relieved, currency);

  return {
    relievedCost: known(relievedMinor, currency),
    remainingValue: known(remainingMinor, currency),
    remainingQuantity,
    method,
  };
}

/**
 * Value a pool with nothing relieved -- inventory valuation at a point in time.
 *
 * Deliberately the same code path as a zero relief, so valuation and cost relief can never disagree
 * about what a pool is worth.
 */
export function valueInventoryPool(input: {
  readonly profile: FinancialPolicyProfile;
  readonly lots: readonly CostLot[];
  readonly serialized?: boolean;
}): CostFigure {
  return relieveInventoryCost({ ...input, reliefs: [] }).remainingValue;
}
