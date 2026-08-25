import { formatMinor } from "./accountArView.js";

// WHAT A SALES ORDER'S DOLLARS CELL SAYS, AND WHY.
//
// ════════════════════ A BLANK IS NOT AN ANSWER ════════════════════
//
// A Sales Order is the entry point of a sale, so a Dollars cell that is simply empty tells a
// reader nothing: they cannot tell whether the order is worth nothing, whether the figure failed
// to load, or whether the page is broken. An em dash is only marginally better — it says "no
// value" without saying why there isn't one.
//
// The server already knows why. `pricingState` is returned beside `totalMinor` precisely so the
// reason survives the trip, and this turns it into words:
//
//   PRICED             every line carries a committed price  ->  the amount
//   PARTIALLY_PRICED   some lines do, some do not            ->  "Partly priced"
//   UNPRICED           no line carries one                   ->  "Not priced"
//   NO_LINES           nothing to price yet                  ->  "No lines"
//
// ════════════════════ WHAT IS STILL REFUSED ════════════════════
//
// A partly-priced order shows NO NUMBER. Summing the priced lines would produce a real figure that
// is not the sale's total, and somebody would commit to it — which is worse than showing nothing,
// because it is credible. NULL IS NOT ZERO, and "Partly priced" is not "$0.00".
//
// This is display only. It invents no total, changes no pricing, and writes nothing.

/** The four states, and what a reader is told when there is no amount. */
export const PRICING_STATE_TEXT = Object.freeze({
  PARTIALLY_PRICED: "Partly priced",
  UNPRICED: "Not priced",
  NO_LINES: "No lines",
});

/**
 * The Dollars cell for one Sales Order.
 *
 * Returns { text, isAmount, title }. `isAmount` lets a caller right-align and tabular-align a real
 * figure without doing so to an explanatory phrase. `title` carries the longer reason where one
 * adds something a three-word label cannot.
 */
export function salesOrderDollars(view) {
  if (typeof view?.totalMinor === "number") {
    return { text: formatMinor(view.totalMinor, view.currency ?? null), isAmount: true, title: null };
  }

  const state = view?.pricingState ?? null;
  const label = PRICING_STATE_TEXT[state] ?? null;

  // An unrecognised or absent state is NOT reported as "Not priced" — that would state a fact
  // about the order when what actually happened is that the read said nothing. The em dash stays
  // for the genuinely unknown case, which is the honest floor.
  if (!label) return { text: "—", isAmount: false, title: null };

  const unpriced = view?.unpricedLineCount;
  const title = state === "PARTIALLY_PRICED" && typeof unpriced === "number" && unpriced > 0
    ? `${unpriced} ${unpriced === 1 ? "line has" : "lines have"} no committed price, so this order has no total yet.`
    : state === "UNPRICED"
      ? "No line on this order carries a committed price, so it has no total and cannot be invoiced yet."
      : null;

  return { text: label, isAmount: false, title };
}
