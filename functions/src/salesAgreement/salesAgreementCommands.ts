import {
  FULFILLMENT_INTENTS,
  SALES_AGREEMENT_LINE_KINDS,
  AGREEMENT_LINE_CONDITIONS,
  checkAgreementTransition,
  type FulfillmentIntent,
  type SalesAgreementLineKind,
  type SalesAgreementState,
} from "./salesAgreementLifecycle.js";

// THE COMMERCIAL COMMITMENT — build and accept.
//
// PURE. No Firestore, no clock, no id generation: the caller supplies `nowMillis` and the actor, so
// every rule here is assertable offline. Same shape as salesOrderCommands, for the same reason.
//
// ════════════════════ WHAT IS COMPUTED AND WHAT IS SUPPLIED ════════════════════
//
// COMPUTED: subtotal, total, balance. These are arithmetic over values somebody already decided —
// summing line extensions and adding the charges — and computing them is how the document stops
// disagreeing with itself. A client-supplied total that does not match its own lines is a paper
// error the system would inherit.
//
// SUPPLIED: every unit price, the shipping and install charges, the tax, the down payment, the
// trade-in. NONE of those is derived here. This is not a pricing engine, not a tax engine, and not
// a discount engine — it records commercial decisions and refuses to invent them. Tax in particular
// is an INJECTED determination, exactly as invoiceCommands already treats it.
//
// ════════════════════ MONEY ════════════════════
//
// Integer minor units everywhere, non-negative. The same representation the invoice engine snapshots
// as `unitPriceMinor` and refuses to contradict, so a price committed here survives to billing
// without a conversion that could round.
//
// ZERO IS A REAL COMMITTED PRICE. A no-charge line, a waived install, a zero trade-in are all
// legitimate. ABSENT is what is refused, and only at acceptance.

export type SalesAgreementErrorCode =
  | "INVALID"
  | "ACCOUNT_REQUIRED"
  | "OWNER_REQUIRED"
  | "NO_LINES"
  | "LINE_INVALID"
  | "SERIALIZED_LINE_FORBIDDEN"
  | "QTY_INVALID"
  | "MONEY_INVALID"
  | "INTENT_INVALID"
  /** Acceptance attempted while a billable line still has no committed price. */
  | "UNPRICED_LINE"
  | "ILLEGAL_TRANSITION";

export class SalesAgreementCommandError extends Error {
  code: SalesAgreementErrorCode;
  constructor(code: SalesAgreementErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "SalesAgreementCommandError";
  }
}

export interface SalesAgreementLineInput {
  kind: SalesAgreementLineKind;
  /** Model number / partId / service code — PRODUCT level, never a serial. */
  ref: string;
  quantity: number;
  /** Integer minor units. Optional in DRAFT; REQUIRED to accept. */
  unitPrice?: number;
  condition?: string;
  /** Free text as the paper form carries it. ARTIFACT_DETAIL_PENDING: whether this is a term, a date, or a product reference. */
  warranty?: string;
  /** Epoch millis. Transactional, not a catalogue fact: what THIS customer was told. */
  estimatedArrivalMillis?: number;
}

export interface CreateSalesAgreementInput {
  accountId: string;
  ownerEmployeeId: string;
  locationId?: string;
  sourceOpportunityId?: string;
  customerPO?: string;
  isLease?: boolean;
  fulfillmentIntent?: FulfillmentIntent;
  shippingInstructions?: string;
  shipVia?: string;
  specialInstructions?: string;
  lines?: SalesAgreementLineInput[];
  /** Injected charges, integer minor units. Never computed here. */
  shippingMinor?: number;
  installChargeMinor?: number;
  taxMinor?: number;
  downPaymentMinor?: number;
  tradeInMinor?: number;
}

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const finiteNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const posInt = (v: unknown): v is number => finiteNum(v) && v > 0 && Number.isInteger(v);
/** Integer minor units, non-negative. Zero is a real amount; negative is not one of these. */
const minorUnits = (v: unknown): v is number => finiteNum(v) && Number.isInteger(v) && v >= 0;
const trimmed = (v: unknown): string | null => (nonEmpty(v) ? (v as string).trim() : null);

export interface BuiltAgreementLine {
  lineId: string;
  kind: SalesAgreementLineKind;
  ref: string;
  quantity: number;
  unitPrice: number | null;
  condition: string | null;
  warranty: string | null;
  estimatedArrivalMillis: number | null;
  /** quantity x unitPrice, minor units. Null while unpriced — never a partial stand-in. */
  extendedMinor: number | null;
}

function validateLine(line: unknown, index: number): BuiltAgreementLine {
  if (!line || typeof line !== "object") {
    throw new SalesAgreementCommandError("LINE_INVALID", `Line ${index} is not an object`);
  }
  const l = line as Record<string, unknown>;
  if (!(SALES_AGREEMENT_LINE_KINDS as readonly string[]).includes(l.kind as string)) {
    throw new SalesAgreementCommandError("LINE_INVALID", `Line ${index} has an invalid kind`);
  }
  // The same identity boundary the Sales Order holds: commitment is product-level. A serial is
  // assigned from physical inventory at fulfillment, and selling "this exact machine" before one has
  // been picked is a promise the warehouse never made.
  if ("serial" in l || "serialNumber" in l || "serializedAssetId" in l || "equipmentId" in l) {
    throw new SalesAgreementCommandError(
      "SERIALIZED_LINE_FORBIDDEN",
      `Line ${index} references a serialized asset; agreement lines are product-level (serials are assigned at fulfillment)`
    );
  }
  if (!nonEmpty(l.ref)) throw new SalesAgreementCommandError("LINE_INVALID", `Line ${index} is missing a product reference`);
  if (!posInt(l.quantity)) throw new SalesAgreementCommandError("QTY_INVALID", `Line ${index} quantity must be a positive integer`);
  if (l.unitPrice !== undefined && l.unitPrice !== null && !minorUnits(l.unitPrice)) {
    throw new SalesAgreementCommandError(
      "MONEY_INVALID",
      `Line ${index} unitPrice must be a non-negative integer in minor units`
    );
  }
  if (l.condition !== undefined && l.condition !== null && !(AGREEMENT_LINE_CONDITIONS as readonly string[]).includes(l.condition as string)) {
    throw new SalesAgreementCommandError("LINE_INVALID", `Line ${index} condition is not a recognised value`);
  }
  if (l.estimatedArrivalMillis !== undefined && l.estimatedArrivalMillis !== null && !finiteNum(l.estimatedArrivalMillis)) {
    throw new SalesAgreementCommandError("LINE_INVALID", `Line ${index} estimatedArrivalMillis must be a number`);
  }

  const unitPrice = minorUnits(l.unitPrice) ? (l.unitPrice as number) : null;
  return {
    lineId: `line-${index + 1}`,
    kind: l.kind as SalesAgreementLineKind,
    ref: (l.ref as string).trim(),
    quantity: l.quantity as number,
    unitPrice,
    condition: trimmed(l.condition),
    warranty: trimmed(l.warranty),
    estimatedArrivalMillis: finiteNum(l.estimatedArrivalMillis) ? (l.estimatedArrivalMillis as number) : null,
    // Null, never 0, while unpriced: an unpriced line has no extension, and zero would say it is free.
    extendedMinor: unitPrice === null ? null : (l.quantity as number) * unitPrice,
  };
}

export interface AgreementTotals {
  subtotalMinor: number | null;
  shippingMinor: number;
  installChargeMinor: number;
  taxMinor: number;
  totalMinor: number | null;
  downPaymentMinor: number;
  tradeInMinor: number;
  balanceMinor: number | null;
}

/**
 * The document's own arithmetic.
 *
 * NULL PROPAGATES. If any line is unpriced there is no subtotal, therefore no total, therefore no
 * balance — a partial sum presented as a total is a real number that is not what the customer is
 * committing to, and it is worse than nothing because somebody would sign it.
 */
export function computeAgreementTotals(
  lines: BuiltAgreementLine[],
  charges: { shippingMinor?: number; installChargeMinor?: number; taxMinor?: number; downPaymentMinor?: number; tradeInMinor?: number }
): AgreementTotals {
  for (const [field, v] of Object.entries(charges)) {
    if (v !== undefined && v !== null && !minorUnits(v)) {
      throw new SalesAgreementCommandError("MONEY_INVALID", `${field} must be a non-negative integer in minor units`);
    }
  }
  const shippingMinor = minorUnits(charges.shippingMinor) ? charges.shippingMinor : 0;
  const installChargeMinor = minorUnits(charges.installChargeMinor) ? charges.installChargeMinor : 0;
  const taxMinor = minorUnits(charges.taxMinor) ? charges.taxMinor : 0;
  const downPaymentMinor = minorUnits(charges.downPaymentMinor) ? charges.downPaymentMinor : 0;
  const tradeInMinor = minorUnits(charges.tradeInMinor) ? charges.tradeInMinor : 0;

  const fullyPriced = lines.length > 0 && lines.every((l) => l.extendedMinor !== null);
  const subtotalMinor = fullyPriced ? lines.reduce((n, l) => n + (l.extendedMinor as number), 0) : null;
  const totalMinor = subtotalMinor === null ? null : subtotalMinor + shippingMinor + installChargeMinor + taxMinor;
  const balanceMinor = totalMinor === null ? null : totalMinor - downPaymentMinor - tradeInMinor;

  return { subtotalMinor, shippingMinor, installChargeMinor, taxMinor, totalMinor, downPaymentMinor, tradeInMinor, balanceMinor };
}

export interface BuiltSalesAgreement {
  accountId: string;
  ownerEmployeeId: string;
  locationId: string | null;
  sourceOpportunityId: string | null;
  customerPO: string | null;
  isLease: boolean;
  fulfillmentIntent: FulfillmentIntent | null;
  shippingInstructions: string | null;
  shipVia: string | null;
  specialInstructions: string | null;
  currency: string;
  state: SalesAgreementState;
  lines: BuiltAgreementLine[];
  totals: AgreementTotals;
  createdByUid: string;
  createdAtMillis: number;
  updatedAtMillis: number;
}

/** Build a DRAFT. Pricing MAY be incomplete here — it is still being decided. */
export function buildCreateSalesAgreement(
  input: CreateSalesAgreementInput,
  ctx: { actorUid: string; nowMillis: number }
): BuiltSalesAgreement {
  if (!nonEmpty(input?.accountId)) throw new SalesAgreementCommandError("ACCOUNT_REQUIRED", "accountId is required");
  if (!nonEmpty(input?.ownerEmployeeId)) throw new SalesAgreementCommandError("OWNER_REQUIRED", "ownerEmployeeId is required");
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new SalesAgreementCommandError("NO_LINES", "An agreement requires at least one line");
  }
  if (input.fulfillmentIntent !== undefined && !(FULFILLMENT_INTENTS as readonly string[]).includes(input.fulfillmentIntent)) {
    throw new SalesAgreementCommandError("INTENT_INVALID", "fulfillmentIntent must be DELIVER, INSTALL or BOTH");
  }

  const lines = input.lines.map((l, i) => validateLine(l, i));
  // Only the CHARGE fields. Handing the whole input in made every string on it -- accountId
  // included -- run through the money validator.
  const totals = computeAgreementTotals(lines, {
    shippingMinor: input.shippingMinor,
    installChargeMinor: input.installChargeMinor,
    taxMinor: input.taxMinor,
    downPaymentMinor: input.downPaymentMinor,
    tradeInMinor: input.tradeInMinor,
  });

  return {
    accountId: input.accountId.trim(),
    ownerEmployeeId: input.ownerEmployeeId.trim(),
    locationId: trimmed(input.locationId),
    sourceOpportunityId: trimmed(input.sourceOpportunityId),
    customerPO: trimmed(input.customerPO),
    isLease: input.isLease === true,
    fulfillmentIntent: (input.fulfillmentIntent as FulfillmentIntent) ?? null,
    shippingInstructions: trimmed(input.shippingInstructions),
    shipVia: trimmed(input.shipVia),
    specialInstructions: trimmed(input.specialInstructions),
    // Single-currency, server-set, matching the Sales Order header so a committed price survives
    // into billing without a conversion nobody authorised.
    currency: "USD",
    state: "DRAFT",
    lines,
    totals,
    createdByUid: ctx.actorUid,
    createdAtMillis: ctx.nowMillis,
    updatedAtMillis: ctx.nowMillis,
  };
}

/**
 * ACCEPTANCE IS THE PRICING GATE.
 *
 * A DRAFT may be incomplete — that is what a draft is. An ACCEPTED agreement is what the customer
 * committed to and what a Sales Order will be created from, so every billable line must carry a
 * committed price by the time it gets there. Every line kind is billable, exactly as on the Sales
 * Order: `billingEligibleQty` discriminates by quantity and never by kind.
 *
 * This is the same invariant the Sales Order enforces, moved to the place where the commercial
 * decision is actually made. Enforcing it only at the order would put the refusal in front of
 * somebody who cannot fix it.
 */
export function buildAcceptSalesAgreement(
  current: { state: SalesAgreementState; lines: BuiltAgreementLine[] },
  ctx: { actorUid: string; nowMillis: number }
): { state: SalesAgreementState; acceptedAtMillis: number; acceptedByUid: string; updatedAtMillis: number } {
  const check = checkAgreementTransition(current.state, "ACCEPTED");
  if (!check.ok) throw new SalesAgreementCommandError("ILLEGAL_TRANSITION", check.reason ?? "Illegal transition");

  const unpriced = (current.lines ?? []).filter((l) => l.unitPrice === null || l.unitPrice === undefined);
  if (unpriced.length > 0) {
    // Names every one, not the first: pricing an agreement should not be a round trip per line.
    throw new SalesAgreementCommandError(
      "UNPRICED_LINE",
      "An accepted agreement requires a committed unit price on every line. Unpriced: " +
        unpriced.map((l) => `${l.lineId} (${l.ref})`).join(", ")
    );
  }

  return {
    state: "ACCEPTED",
    acceptedAtMillis: ctx.nowMillis,
    acceptedByUid: ctx.actorUid,
    updatedAtMillis: ctx.nowMillis,
  };
}

/**
 * The Sales Order lines an accepted Agreement produces.
 *
 * THIS IS THE REPLACEMENT FOR THE UNPRICED SHORTCUT. `deriveSalesOrderLines` mapped Opportunity
 * `{ kind, ref, qty }` straight through with no price, because an Opportunity has none — which is
 * how unpriced CONFIRMED orders came to exist. Prices come from the Agreement now, because that is
 * where they were committed.
 *
 * It refuses on a non-accepted agreement rather than reading a draft's provisional prices: a price
 * nobody accepted is not a commitment.
 */
export function deriveSalesOrderLinesFromAgreement(
  agreement: { state: SalesAgreementState; lines: BuiltAgreementLine[] }
): { kind: SalesAgreementLineKind; ref: string; orderedQty: number; unitPrice: number }[] {
  if (agreement.state !== "ACCEPTED") {
    throw new SalesAgreementCommandError(
      "ILLEGAL_TRANSITION",
      "A Sales Order can only be created from an ACCEPTED agreement; a draft's prices are not a commitment."
    );
  }
  return (agreement.lines ?? []).map((l) => {
    if (l.unitPrice === null || l.unitPrice === undefined) {
      // Unreachable through acceptance, and asserted anyway: this function is what hands prices to
      // the Sales Order, and it must never be the place a null slips through.
      throw new SalesAgreementCommandError("UNPRICED_LINE", `Accepted agreement line ${l.lineId} has no committed price.`);
    }
    return { kind: l.kind, ref: l.ref, orderedQty: l.quantity, unitPrice: l.unitPrice };
  });
}
