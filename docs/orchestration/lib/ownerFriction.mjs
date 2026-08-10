// Owner Friction — a first-class measure (Owner requirement), extending ownerRelayedCount.
//
// Primary question for every event: "Did EOS require the Owner to remember, transfer, interpret
// or babysit something the system already had enough information to handle?" If yes → AVOIDABLE
// friction to drive toward zero. Real business judgment and protected authorization are
// NECESSARY and must NOT be hidden to make the number look good.
//
// Pure: category model + a projection from durable evidence. No I/O, no clock.

// Avoidable — orchestration/context defects to reduce toward zero.
export const AVOIDABLE_FRICTION = Object.freeze([
  "MANUAL_CONTEXT_RELAY",     // Owner copied information between sessions/systems
  "MANUAL_HANDOFF",           // Owner had to tell a workstream another workstream completed
  "OWNER_MEMORY_DEPENDENCY",  // system relied on the Owner remembering an operational instruction
  "UNNECESSARY_DECISION",     // a question reached the Owner that standing authority could resolve
  "DUPLICATE_NOTIFICATION",   // multiple machine events represented one actual condition
  "MANUAL_RECOVERY",          // Owner had to repair a process EOS could reasonably have managed
]);
// Necessary — genuine Owner responsibilities. Preserved, never suppressed.
export const NECESSARY_FRICTION = Object.freeze([
  "NECESSARY_OWNER_DECISION",       // genuine business/product judgment
  "NECESSARY_OWNER_AUTHORIZATION",  // protected execution boundary
]);
export const OWNER_FRICTION_CATEGORIES = Object.freeze([...AVOIDABLE_FRICTION, ...NECESSARY_FRICTION]);
const AVOIDABLE = new Set(AVOIDABLE_FRICTION);

export function createFrictionEvent(input = {}) {
  return Object.freeze({ category: null, evidenceRef: null, note: null, ...input });
}

export function validateFrictionEvent(e) {
  const errors = [];
  if (!OWNER_FRICTION_CATEGORIES.includes(e.category)) errors.push(`category must be one of ${OWNER_FRICTION_CATEGORIES.join("/")}`);
  if (!e.evidenceRef) errors.push("evidenceRef is required — friction is measured from durable evidence, not asserted");
  return errors;
}

export const isAvoidable = (category) => AVOIDABLE.has(category);

/**
 * Project the Owner-friction measure from durable evidence.
 *   - explicit friction events (a *.friction.json ledger), and
 *   - derived MANUAL_CONTEXT_RELAY: each ownerRelayed AI exchange IS a manual context relay
 *     (the Owner acted as the Claude↔ChatGPT conduit). Derived from real evidence, not invented.
 * Goal: reduce avoidableTotal → 0 while preserving necessaryTotal (never suppressed).
 */
export function projectOwnerFriction(events = [], { aiExchanges = [] } = {}) {
  const byCategory = {};
  for (const c of OWNER_FRICTION_CATEGORIES) byCategory[c] = 0;
  for (const e of events || []) {
    if (byCategory[e.category] != null) byCategory[e.category]++;
  }
  // Derive MANUAL_CONTEXT_RELAY from ownerRelayed exchanges (honest, evidence-backed).
  const relayed = (aiExchanges || []).filter((x) => x && x.ownerRelayed).length;
  byCategory.MANUAL_CONTEXT_RELAY += relayed;

  const avoidableTotal = AVOIDABLE_FRICTION.reduce((n, c) => n + byCategory[c], 0);
  const necessaryTotal = NECESSARY_FRICTION.reduce((n, c) => n + byCategory[c], 0);
  return {
    byCategory, avoidableTotal, necessaryTotal,
    derivedManualContextRelay: relayed,
    goal: "reduce avoidable friction → 0; preserve necessary Owner decision/authorization (never suppressed)",
  };
}
