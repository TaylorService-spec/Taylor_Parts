// Evidence-driven process-improvement register (§24).
//
// EOS development itself may evolve — but improvement must ORIGINATE FROM EVIDENCE/NEED, never
// from idle capacity ("do not perform autonomous architecture gardening merely because product
// READY work is empty"). And the hard invariant: EOS may improve capability WITHIN existing
// authority; it may NOT expand its own authority in order to improve itself. Capability growth
// != authority growth.
//
// Pure model + validation. No I/O, no clock.

export const IMPROVEMENT_STATES = Object.freeze([
  "OBSERVED_FRICTION", "CLASSIFIED", "PROPOSED_IMPROVEMENT", "PROVEN", "ADOPTED", "MEASURED",
]);
const STATE_INDEX = Object.freeze(Object.fromEntries(IMPROVEMENT_STATES.map((s, i) => [s, i])));

// Valid evidence sources (§24). An improvement with no evidence source is not admissible.
export const FRICTION_SOURCES = Object.freeze([
  "repeated-manual-work", "missed-continuation", "unnecessary-owner-interruption",
  "duplicate-agent-spend", "recurring-defect", "governance-ambiguity", "quality-failure",
  "resource-waste", "explicit-owner-objective",
]);

const DEFAULTS = Object.freeze({ state: "OBSERVED_FRICTION", expandsAuthority: false, evidence: [] });

export function createImprovement(input = {}) {
  const it = { ...DEFAULTS, ...input };
  it.evidence = [...(it.evidence || [])];
  return Object.freeze(it);
}

export function validateImprovement(it) {
  const errors = [];
  const need = (c, m) => { if (!c) errors.push(m); };
  need(!!it.id, "id is required");
  need(IMPROVEMENT_STATES.includes(it.state), "state must be a known IMPROVEMENT_STATE");
  need(FRICTION_SOURCES.includes(it.source), `source must be a known FRICTION_SOURCE (evidence origin) — got ${JSON.stringify(it.source)}`);
  need(Array.isArray(it.evidence) && it.evidence.length > 0, "evidence is required — improvement must originate from evidence, not idle capacity");
  // THE INVARIANT: an improvement may not widen authority. If it would, it is not an
  // improvement item — it is an authority change that must be routed to the Owner instead.
  need(it.expandsAuthority === false, "an improvement MUST NOT expand authority (capability growth != authority growth); route authority changes to the Owner");
  return errors;
}

// Legal forward progression (one hop). Improvements do not skip PROVEN before ADOPTED.
export function advanceImprovement(it, toState) {
  const from = STATE_INDEX[it.state];
  const to = STATE_INDEX[toState];
  if (to == null) throw new Error(`advanceImprovement: unknown state ${JSON.stringify(toState)}`);
  if (to !== from + 1) throw new Error(`advanceImprovement: illegal ${it.state} -> ${toState} (one forward hop only)`);
  return Object.freeze({ ...it, state: toState });
}

// Admissible only if it carries evidence AND does not widen authority.
export function isAdmissible(it) {
  return validateImprovement(it).length === 0;
}
