// PASS 3 DEMAND SCENARIOS — G09, G10 and G11.
//
// Kept beside demandPlan.mjs rather than inside it: the original seven scenarios exist to make the
// six DEMAND CLASSES real, and these three exist for different reasons entirely. Mixing them in one
// list would suggest they answer the same question.

/**
 * G09 — INBOUND EXISTS, AND IS NOT ENOUGH.
 *
 * The gap Pass 2A recorded and refused to manufacture. G05 shows a shortage covered by an
 * outstanding order, where the right answer is "wait". This is the same shape with the opposite
 * answer, and the two are indistinguishable to anyone who checks only whether a purchase order
 * EXISTS.
 *
 * The quantity is derived, not chosen. CW-P-0304 holds 8 in the warehouse against 18 genuinely
 * inbound on a SENT order, so anything above 26 is still short after every unit on order arrives.
 * 34 leaves a residual shortage of 8 -- large enough to be unmistakable, small enough that the
 * scenario reads as an ordinary busy month rather than a contrivance.
 *
 * NOT a retrofit of G05: its own work order, its own customer, its own part.
 */
export const G09_INBOUND_INSUFFICIENT = Object.freeze({
  key: "INBOUND_INSUFFICIENT",
  accountIndex: 55,
  complaint: "Multiple units down at one site; large parts requirement.",
  plan: [{ partId: "CW-P-0304", qtyPlanned: 34 }],
});

/**
 * G10 — THE SAME MACHINE, AGAIN.
 *
 * Three work orders against ONE equipment unit, with related complaints and overlapping parts. No
 * record anywhere carries a `repeatFailure` flag, and that is the point: the conclusion has to be
 * reachable from the history, because in a real business nobody labels the third visit as the third
 * visit. A system that can only report what was labelled cannot notice a pattern.
 *
 * All three share equipmentOffset 0, so they land on the same physical unit.
 */
export const G10_REPEAT_FAILURE = Object.freeze([
  Object.freeze({
    key: "REPEAT_FAILURE_1", accountIndex: 7, equipmentOffset: 0,
    complaint: "Unit not holding temperature overnight; compressor cycling.",
    plan: [{ partId: "CW-P-0103", qtyPlanned: 1 }],
  }),
  Object.freeze({
    key: "REPEAT_FAILURE_2", accountIndex: 7, equipmentOffset: 0,
    complaint: "Same unit again -- not holding temperature after last visit.",
    plan: [{ partId: "CW-P-0103", qtyPlanned: 1 }],
  }),
  Object.freeze({
    key: "REPEAT_FAILURE_3", accountIndex: 7, equipmentOffset: 0,
    complaint: "Third call on this machine for the same symptom; customer escalating.",
    plan: [{ partId: "CW-P-0103", qtyPlanned: 2 }, { partId: "CW-P-0104", qtyPlanned: 1 }],
  }),
]);

/**
 * G11 — A CUSTOMER WITH REAL DEPTH.
 *
 * cw-acct-0003 already carries 12 locations, 18 equipment units and 72 contacts; what it lacked was
 * service activity. Three work orders across three DIFFERENT units give it the shape a dense account
 * actually has -- several machines in service at once, at more than one site.
 *
 * The distinction from G10 is carried entirely by equipmentOffset: same customer, different units.
 * A screen that renders these identically has lost the difference between "this customer is busy"
 * and "this machine is broken".
 */
export const G11_DENSE_CUSTOMER = Object.freeze([
  Object.freeze({
    key: "DENSE_CUSTOMER_1", accountIndex: 3, equipmentOffset: 0,
    complaint: "Routine service; unit running warm.",
    plan: [{ partId: "CW-P-0105", qtyPlanned: 2 }],
  }),
  Object.freeze({
    key: "DENSE_CUSTOMER_2", accountIndex: 3, equipmentOffset: 1,
    complaint: "Second machine at this account; draw valve leaking.",
    plan: [{ partId: "CW-P-0200", qtyPlanned: 3 }],
  }),
  Object.freeze({
    key: "DENSE_CUSTOMER_3", accountIndex: 3, equipmentOffset: 2,
    complaint: "Third machine; scheduled preventative maintenance.",
    plan: [{ partId: "CW-P-0104", qtyPlanned: 2 }],
  }),
]);

export const PASS3_SCENARIOS = Object.freeze([
  G09_INBOUND_INSUFFICIENT,
  ...G10_REPEAT_FAILURE,
  ...G11_DENSE_CUSTOMER,
]);
