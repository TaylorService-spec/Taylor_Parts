// The ONE vocabulary for Sales Order state.
//
// Same problem workOrderStatus.js was written to solve, one entity over. A stored state is an
// uppercase machine value -- CONFIRMED, IN_FULFILLMENT, FULFILLED, CLOSED, CANCELLED -- and
// until now nothing turned it into words: domain/salesOrderView.js's STATE_TONE maps a state to
// a semantic tone (info/attention/positive/muted/critical) for badge coloring, but there was no
// human label map beside it, so every surface that showed a state rendered the raw machine
// string verbatim. This is that map, sourced by the Sales Order metadata definition rather than
// copied a second time inside it -- the metadata layer must not become the next surface that
// disagrees with itself, which is the exact #1093 lesson workOrderStatus.js already names.
//
// NOT A REPLACEMENT for STATE_TONE in salesOrderView.js. Tone and label answer different
// questions -- "what color" versus "what word" -- and folding them into one map here would make
// this module respond to a rendering concern beside the display concern it actually owns.
//
// Server authority: functions/src/salesOrder/salesOrderLifecycle.ts SALES_ORDER_STATES. This
// module adds no state the server does not already enumerate, and lists them in the same order.
//
// The machine values stay uppercase and are never compared against these labels.

/** The canonical machine values, in lifecycle order. */
export const SALES_ORDER_STATE_VALUES = Object.freeze([
  "CONFIRMED",
  "IN_FULFILLMENT",
  "FULFILLED",
  "CLOSED",
  "CANCELLED",
]);

/** Stored value -> the words a user reads. */
export const SALES_ORDER_STATE_LABEL = Object.freeze({
  CONFIRMED: "Confirmed",
  IN_FULFILLMENT: "In Fulfillment",
  FULFILLED: "Fulfilled",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
});

/**
 * Display text for a stored state.
 *
 * An unrecognised value is returned VERBATIM rather than mapped to a default. A state the
 * vocabulary does not know about is a data question, and silently relabelling it would hide
 * exactly the kind of mismatch #1093 was -- the same rule workOrderStatusLabel follows.
 */
export function salesOrderStateLabel(state) {
  return SALES_ORDER_STATE_LABEL[state] ?? state ?? "";
}
