// Canonical output shapes for every Control Tower scoring module.
// dispatchScoring.js, jobRiskScoring.js, and workOrderScoring.js all wrap
// their final, panel-facing results in this shape so Control Tower and
// its panels can render any signal the same way, without knowing which
// domain module produced it or re-deriving score/severity themselves.
//
//   Signal: { id, score, severity, label, metadata }
//
// - id: stable identifier of the thing being scored (job id, work order
//   id, technician id)
// - score: normalized 0-100 number, higher = more attention-worthy
// - severity: one of SEVERITY, derived from score via severityFromScore()
//   unless a module has a domain-specific reason to set it directly
//   (e.g. workOrderScoring maps discrete WORK_ORDER_STATE values, which
//   have no continuous magnitude to score against)
// - label: short human-readable string for display
// - metadata: everything else a panel might want to show (breakdowns,
//   reasons, raw counts). Panels may read metadata for display, but must
//   not recompute score/severity from it.
//
// WorkOrderSignal, DispatchRecommendation, and RiskSignal are all this
// same shape -- the names exist for readability at call sites, not
// because the shape differs per family.

export const SEVERITY = {
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  CRITICAL: "CRITICAL",
};

const SEVERITY_ORDER = [SEVERITY.LOW, SEVERITY.MEDIUM, SEVERITY.HIGH, SEVERITY.CRITICAL];

// Coerces arbitrary input into a known SEVERITY value, defaulting to LOW
// rather than letting an invalid value leak into severity-keyed UI
// styling (e.g. a CSS class like `risk-${severity.toLowerCase()}`).
export function normalizeSeverity(value) {
  return SEVERITY_ORDER.includes(value) ? value : SEVERITY.LOW;
}

// Highest severity first. For sorting panels ("severity, then score").
export function compareBySeverity(a, b) {
  return SEVERITY_ORDER.indexOf(b) - SEVERITY_ORDER.indexOf(a);
}

// Maps a normalized 0-100 score onto a severity tier. Shared by every
// scoring module so "HIGH" means the same threshold everywhere in
// Control Tower.
export function severityFromScore(score) {
  if (score >= 75) return SEVERITY.CRITICAL;
  if (score >= 50) return SEVERITY.HIGH;
  if (score >= 25) return SEVERITY.MEDIUM;
  return SEVERITY.LOW;
}

// Throws if `signal` doesn't conform to the shared shape. Intended as a
// cheap dev-time guard at panel boundaries, not for use in hot loops.
export function assertValidSignal(signal) {
  if (
    !signal ||
    typeof signal.id === "undefined" ||
    typeof signal.score !== "number" ||
    !SEVERITY_ORDER.includes(signal.severity) ||
    typeof signal.label !== "string"
  ) {
    throw new Error(`Invalid signal shape: ${JSON.stringify(signal)}`);
  }
}

// Builds a canonical signal. severity defaults to severityFromScore(score)
// when not explicitly provided.
export function createSignal({ id, score, severity, label, metadata = {} }) {
  return {
    id,
    score,
    severity: normalizeSeverity(severity ?? severityFromScore(score)),
    label,
    metadata,
  };
}

// Named aliases -- same shape as createSignal, kept distinct for
// readability/documentation at call sites in each scoring module.
export const makeWorkOrderSignal = createSignal;
export const makeDispatchRecommendation = createSignal;
export const makeRiskSignal = createSignal;
