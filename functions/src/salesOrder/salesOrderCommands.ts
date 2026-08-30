// Sales Order — PURE governed write core (framework-independent; unit-tested). Builds the field maps the
// callable persists; enforces the ratified invariants. No Firestore/firebase-functions imports.
//
// INVARIANTS: product-level lines only (a serialized-asset reference is FORBIDDEN — assigned at fulfillment);
// quantity model orderedQty >= allocatedQty >= fulfilledQty >= 0; canonical refs reused (accountId,
// ownerEmployeeId, salesChannel, locationId?, sourceOpportunityId?); `unitPrice` is an OPTIONAL passive
// pricing SNAPSHOT — this command invents no pricing/discount/tax authority. Created CONFIRMED.

import { resolveCreationOwner, type CreationOwnerResolution } from "../ownership/creationOwnerResolution";
import { resolveCommercialCompanyScope } from "../ownership/commercialCompanyScope";
import type { OwnerDerivation } from "../ownership/typedOwner";
import {
  SALES_ORDER_LINE_KINDS,
  isSalesChannel,
  isSalesOrderState,
  checkTransition,
  allLinesFulfilled,
  type SalesChannel,
  type SalesOrderLineKind,
  type SalesOrderState,
  type SalesOrderTransition,
} from "./salesOrderLifecycle";

export type SalesOrderErrorCode =
  | "INVALID"
  | "ACCOUNT_REQUIRED"
  | "OWNER_REQUIRED"
  | "CHANNEL_INVALID"
  | "NO_LINES"
  | "LINE_INVALID"
  | "SERIALIZED_LINE_FORBIDDEN"
  // A confirmed Sales Order with a line nobody priced. Distinct from LINE_INVALID because the line
  // is well formed -- the commercial decision is what is missing, and the caller needs to be sent
  // to a person, not to a validator.
  | "UNPRICED_LINE"
  | "QTY_INVALID"
  | "TERMINAL"
  | "ILLEGAL_TRANSITION"
  | "NOT_FULFILLABLE";

export class SalesOrderCommandError extends Error {
  code: SalesOrderErrorCode;
  constructor(code: SalesOrderErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "SalesOrderCommandError";
  }
}

export interface SalesOrderLineInput {
  kind: SalesOrderLineKind;
  ref: string; // model number / partId / service code — PRODUCT-level, never a serial
  orderedQty: number;
  // COMMITTED UNIT PRICE, integer minor units. REQUIRED, because creation goes straight to
  // CONFIRMED -- see requireCompletePricing below. Still not COMPUTED here: this command records
  // the price it is given, it does not price anything.
  unitPrice?: number;
}

export interface CreateSalesOrderInput {
  accountId: string;
  // EOS Ownership Model v1, ruling D-4 (2026-08-30): relaxed from required to OPTIONAL, additively.
  // "Opportunity owner is the default owner for NEW downstream commercial records" -- a caller that
  // omits this inherits from `inheritedOwner` below. A caller that supplies it is unaffected.
  ownerEmployeeId?: string;
  // The governed upstream owner, derived by the CALLER from the Opportunity it already read inside
  // its own transaction. Passed in rather than read here so this builder stays pure.
  inheritedOwner?: OwnerDerivation | null;
  // Ruling R-14: explicit, else COPIED from the upstream Opportunity/Agreement. Copied, not
  // followed -- a later correction upstream must never rewrite an order already placed.
  operatingCompanyId?: string;
  inheritedOperatingCompanyId?: string | null;
  salesChannel: SalesChannel;
  locationId?: string;
  sourceOpportunityId?: string;
  customerPO?: string;
  notes?: string;
  lines?: SalesOrderLineInput[];
}

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const finiteNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const posInt = (v: unknown): v is number => finiteNum(v) && v > 0 && Number.isInteger(v);
/** Integer minor units, non-negative. Zero is a real committed price; negative is not a price. */
const minorUnits = (v: unknown): v is number => finiteNum(v) && Number.isInteger(v) && v >= 0;

interface BuiltLine {
  lineId: string;
  kind: SalesOrderLineKind;
  ref: string;
  orderedQty: number;
  allocatedQty: number;
  fulfilledQty: number;
  billedQty: number;
  unitPrice?: number;
}

// Validate + normalize one line. The ONE identity mistake that corrupts commercial↔physical separation is a
// serialized-asset reference on a line — reject it. Quantities initialize allocated/fulfilled to 0.
function validateLine(line: unknown, index: number): BuiltLine {
  if (!line || typeof line !== "object") throw new SalesOrderCommandError("LINE_INVALID", `Line ${index} is not an object`);
  const l = line as Record<string, unknown>;
  if (!(SALES_ORDER_LINE_KINDS as readonly string[]).includes(l.kind as string)) {
    throw new SalesOrderCommandError("LINE_INVALID", `Line ${index} has an invalid kind`);
  }
  if ("serial" in l || "serialNumber" in l || "serializedAssetId" in l || "equipmentId" in l) {
    throw new SalesOrderCommandError(
      "SERIALIZED_LINE_FORBIDDEN",
      `Line ${index} references a serialized asset; Sales Order lines are product-level (serialized assets are assigned at fulfillment)`
    );
  }
  if (!nonEmpty(l.ref)) throw new SalesOrderCommandError("LINE_INVALID", `Line ${index} is missing a product reference`);
  if (!posInt(l.orderedQty)) throw new SalesOrderCommandError("QTY_INVALID", `Line ${index} orderedQty must be a positive integer`);
  // INTEGER MINOR UNITS, and non-negative. The invoice engine snapshots this exact value as
  // `unitPriceMinor` and refuses any invoice price that disagrees with it, so a float here is not a
  // rounding inconvenience -- it is a price no downstream consumer can honour. A fractional value
  // was previously accepted and then silently treated as ABSENT by the read projection, which
  // produced an order that looked priced and billed as unpriced.
  if (l.unitPrice !== undefined && !minorUnits(l.unitPrice)) {
    throw new SalesOrderCommandError(
      "LINE_INVALID",
      `Line ${index} unitPrice must be a non-negative integer in minor units`
    );
  }
  const out: BuiltLine = {
    lineId: `line-${index + 1}`,
    kind: l.kind as SalesOrderLineKind,
    ref: (l.ref as string).trim(),
    orderedQty: l.orderedQty as number,
    allocatedQty: 0,
    fulfilledQty: 0,
    billedQty: 0,
  };
  if (l.unitPrice !== undefined) out.unitPrice = l.unitPrice as number;
  return out;
}

/**
 * A COMMERCIALLY CONFIRMED SALES ORDER CARRIES A PRICE ON EVERY BILLABLE LINE.
 *
 * ════════════════════ THE CONTRADICTION THIS CLOSES ════════════════════
 *
 * `unitPrice` was optional and creation goes straight to CONFIRMED, while invoiceCommands REFUSES
 * to bill a line that has none (UNPRICED). So the system let somebody commit to an order it would
 * later decline to invoice, and nothing said so until billing. Seven of fourteen sandbox orders are
 * in exactly that state.
 *
 * EVERY LINE IS BILLABLE. `billingEligibleQty` discriminates by QUANTITY -- min(ordered, fulfilled)
 * -- and never by kind, so EQUIPMENT_MODEL, PART and SERVICE are equally billable and there is no
 * subset to exempt.
 *
 * ════════════════════ WHAT THIS IS NOT ════════════════════
 *
 * NOT a pricing engine. It computes nothing, looks nothing up, and defaults nothing. It requires
 * that a price was DECIDED somewhere with the authority to decide it, and refuses the order
 * otherwise.
 *
 * NOT a zero default. Zero is a real committed price -- a no-charge line is a legitimate commercial
 * act -- and defaulting an ABSENT price to zero would turn "nobody priced this" into "this is free",
 * which is the single most expensive mistake available here.
 *
 * ════════════════════ IT REPORTS EVERY UNPRICED LINE, NOT THE FIRST ════════════════════
 *
 * Failing on line 1 of a six-line order makes pricing an order a six-round trip. The error names
 * them all.
 *
 * The existing seven records are NOT touched. They are invalid fixtures; inventing prices for them
 * would be the same failure in the opposite direction.
 */
function requireCompletePricing(lines: BuiltLine[]): void {
  const unpriced = lines
    .map((l, i) => ({ index: i, lineId: l.lineId, ref: l.ref, priced: typeof l.unitPrice === "number" }))
    .filter((l) => !l.priced);
  if (unpriced.length === 0) return;
  throw new SalesOrderCommandError(
    "UNPRICED_LINE",
    `A confirmed Sales Order requires a committed unit price on every line. Unpriced: ` +
      unpriced.map((l) => `${l.lineId} (${l.ref})`).join(", ")
  );
}

export interface BuiltSalesOrder {
  accountId: string;
  ownerEmployeeId: string;
  salesChannel: SalesChannel;
  // Committed pricing currency (integer minor units per money.js). Persisted on
  // the Sales Order so downstream finance (issueInvoice's verifySalesOrderMatch)
  // can require input.currency === so.currency. Single-currency default "USD"
  // matches the money model; a multi-currency source (account/company) is a
  // separate future seam.
  currency: string;
  /** Ruling R-14. Copied from upstream at creation, then historical. null until supplied. */
  operatingCompanyId: string | null;
  locationId: string | null;
  sourceOpportunityId: string | null;
  customerPO: string | null;
  notes: string | null;
  state: SalesOrderState;
  lines: BuiltLine[];
  createdByUid: string;
  createdAtMillis: number;
  updatedAtMillis: number;
}

// Build a NEW Sales Order (CONFIRMED = the commercial commitment following a WON Opportunity). Reuses
// canonical refs; never assigns serialized assets. `actorUid`/`nowMillis` come from the callable.
export function buildCreateSalesOrder(input: CreateSalesOrderInput, ctx: { actorUid: string; nowMillis: number }): BuiltSalesOrder {
  if (!input || typeof input !== "object") throw new SalesOrderCommandError("INVALID", "Missing input");
  if (!nonEmpty(input.accountId)) throw new SalesOrderCommandError("ACCOUNT_REQUIRED", "accountId is required");
  // Ruling D-4. OWNER_REQUIRED is preserved as the refusal code, so a caller that supplies nothing
  // and has nothing to inherit fails exactly as it did before -- only the message gained the reason.
  let resolvedOwner: CreationOwnerResolution;
  try {
    resolvedOwner = resolveCreationOwner(input.ownerEmployeeId, input.inheritedOwner, "the Opportunity");
  } catch (e) {
    throw new SalesOrderCommandError("OWNER_REQUIRED", (e as Error).message);
  }
  if (!isSalesChannel(input.salesChannel)) throw new SalesOrderCommandError("CHANNEL_INVALID", "salesChannel is invalid");
  if (!Array.isArray(input.lines) || input.lines.length === 0) throw new SalesOrderCommandError("NO_LINES", "A Sales Order requires at least one line");
  const lines = input.lines.map((l, i) => validateLine(l, i));
  requireCompletePricing(lines);
  return {
    accountId: input.accountId.trim(),
    ownerEmployeeId: resolvedOwner.ownerEmployeeId,
    salesChannel: input.salesChannel,
    operatingCompanyId: resolveCommercialCompanyScope(input.operatingCompanyId, input.inheritedOperatingCompanyId),
    currency: "USD",
    locationId: nonEmpty(input.locationId) ? input.locationId.trim() : null,
    sourceOpportunityId: nonEmpty(input.sourceOpportunityId) ? input.sourceOpportunityId.trim() : null,
    customerPO: nonEmpty(input.customerPO) ? input.customerPO.trim() : null,
    notes: nonEmpty(input.notes) ? input.notes.trim() : null,
    state: "CONFIRMED",
    lines,
    createdByUid: ctx.actorUid,
    createdAtMillis: ctx.nowMillis,
    updatedAtMillis: ctx.nowMillis,
  };
}

export interface SalesOrderDocState {
  state: SalesOrderState;
  lines?: Array<{ orderedQty: number; fulfilledQty?: number }>;
}

export interface SalesOrderTransitionPatch {
  state: SalesOrderState;
  updatedByUid: string;
  updatedAtMillis: number;
}

// Build the field patch for a lifecycle transition, after validating legality (FULFILLED requires every line
// fully fulfilled). Throws fail-closed on any illegal transition; the callable maps the code to an HttpsError.
export function buildTransitionPatch(
  current: SalesOrderDocState,
  transition: SalesOrderTransition,
  ctx: { actorUid: string; nowMillis: number }
): SalesOrderTransitionPatch {
  if (!current || !isSalesOrderState(current.state)) throw new SalesOrderCommandError("INVALID", "Invalid current state");
  const fulfilledAll = allLinesFulfilled(Array.isArray(current.lines) ? current.lines : []);
  const check = checkTransition(current.state, transition, { allLinesFulfilled: fulfilledAll });
  if (!check.ok) {
    const msg =
      check.code === "TERMINAL"
        ? "Sales Order is closed or cancelled"
        : check.code === "NOT_FULFILLABLE"
          ? "Cannot mark FULFILLED while quantity remains unfulfilled"
          : check.code === "ILLEGAL_TRANSITION"
            ? "Illegal Sales Order transition"
            : "Invalid transition";
    throw new SalesOrderCommandError(check.code, msg);
  }
  return { state: check.to, updatedByUid: ctx.actorUid, updatedAtMillis: ctx.nowMillis };
}
