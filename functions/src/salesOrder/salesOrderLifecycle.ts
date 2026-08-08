// Sales Order — PURE lifecycle authority (framework-independent; unit-tested). The committed commercial order
// that follows a WON Opportunity. No Firestore/firebase-functions imports.
//
// Cardinality invariant (the core one): a line is PRODUCT-LEVEL with a quantity — `C713 × 5` is ONE line with
// orderedQty 5, NOT five lines and NOT five serialized assets. Serialized `equipment` assets are assigned
// downstream at FULFILLMENT, never here. Each line tracks ordered/allocated/fulfilled so partial fulfillment
// is first-class: orderedQty >= allocatedQty >= fulfilledQty >= 0, and remainingQty = orderedQty - fulfilledQty.

export const SALES_ORDER_STATES = ["CONFIRMED", "IN_FULFILLMENT", "FULFILLED", "CLOSED", "CANCELLED"] as const;
export type SalesOrderState = (typeof SALES_ORDER_STATES)[number];

export const SALES_ORDER_LINE_KINDS = ["EQUIPMENT_MODEL", "PART", "SERVICE"] as const;
export type SalesOrderLineKind = (typeof SALES_ORDER_LINE_KINDS)[number];

export const SALES_CHANNELS = ["NATIONAL_ACCOUNTS", "RETAIL"] as const;
export type SalesChannel = (typeof SALES_CHANNELS)[number];

export function isSalesOrderState(v: unknown): v is SalesOrderState {
  return typeof v === "string" && (SALES_ORDER_STATES as readonly string[]).includes(v);
}
export function isSalesChannel(v: unknown): v is SalesChannel {
  return typeof v === "string" && (SALES_CHANNELS as readonly string[]).includes(v);
}

// Minimal, defensible transition graph. A Sales Order is created CONFIRMED (commercial commitment from WON).
// Fulfillment progresses CONFIRMED → IN_FULFILLMENT → FULFILLED → CLOSED. CANCEL is allowed only before the
// order is FULFILLED (a fulfilled/closed order is not cancellable — that is a return/credit, a later domain).
const FORWARD: Record<SalesOrderState, SalesOrderState | null> = {
  CONFIRMED: "IN_FULFILLMENT",
  IN_FULFILLMENT: "FULFILLED",
  FULFILLED: "CLOSED",
  CLOSED: null,
  CANCELLED: null,
};

export type SalesOrderTransition = "ADVANCE" | "CANCEL";

export type TransitionCheck =
  | { ok: true; to: SalesOrderState }
  | { ok: false; code: "TERMINAL" | "ILLEGAL_TRANSITION" | "NOT_FULFILLABLE" | "INVALID" };

// Pure legality check. `allLinesFulfilled` gates the IN_FULFILLMENT → FULFILLED advance so an order cannot be
// marked FULFILLED while quantity remains (honest partial-fulfillment). Never throws.
export function checkTransition(
  state: SalesOrderState,
  transition: SalesOrderTransition,
  ctx: { allLinesFulfilled?: boolean } = {}
): TransitionCheck {
  if (!isSalesOrderState(state)) return { ok: false, code: "INVALID" };
  if (state === "CLOSED" || state === "CANCELLED") return { ok: false, code: "TERMINAL" };
  if (transition === "CANCEL") {
    if (state === "FULFILLED") return { ok: false, code: "ILLEGAL_TRANSITION" }; // return/credit, not cancel
    return { ok: true, to: "CANCELLED" };
  }
  // ADVANCE
  const to = FORWARD[state];
  if (to === null) return { ok: false, code: "ILLEGAL_TRANSITION" };
  if (state === "IN_FULFILLMENT" && ctx.allLinesFulfilled !== true) return { ok: false, code: "NOT_FULFILLABLE" };
  return { ok: true, to };
}

// The remaining (un-fulfilled) quantity for a line. Pure helper reused by the command + projections.
export function remainingQty(line: { orderedQty: number; fulfilledQty?: number }): number {
  const fulfilled = typeof line.fulfilledQty === "number" && Number.isFinite(line.fulfilledQty) ? line.fulfilledQty : 0;
  return Math.max(0, line.orderedQty - fulfilled);
}

// True when every line is fully fulfilled (fulfilledQty == orderedQty) — the gate for FULFILLED.
export function allLinesFulfilled(lines: Array<{ orderedQty: number; fulfilledQty?: number }>): boolean {
  return lines.length > 0 && lines.every((l) => remainingQty(l) === 0);
}
