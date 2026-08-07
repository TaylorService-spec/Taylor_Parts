// Readiness — the SHARED Enterprise Operations OS platform vocabulary (not a parts-specific badge).
//
// TWO DELIBERATELY SEPARATE vocabularies (Owner semantic correction, PR #638):
//
//   READINESS      — the AGGREGATE operational answer for a part or a job: READY | ATTENTION | UNKNOWN.
//                    This is what a user reads to decide "is this ready / does it need me / can't we tell".
//
//   AVAILABILITY   — a SOURCE or CAPABILITY status: KNOWN | UNKNOWN | UNAVAILABLE.
//                    This describes whether a data source or a connected capability could answer at all.
//
// The distinction matters: **UNAVAILABLE is NOT a readiness severity.** A capability being unavailable
// (e.g. truck inventory isn't enabled) must never make a Work Order's or job's readiness "unavailable".
// If an unavailable source is NEEDED to determine a part, that part's READINESS is UNKNOWN, and the
// projection's degraded[] explains the capability. `NO_PLAN` is an explicit projection outcome handled
// OUTSIDE the readiness rollup — never reinterpreted as READY.
//
// This is a pure vocabulary + rollup helper — NOT a persisted readiness model. Readiness is always a
// PROJECTION derived over canonical authorities; nothing here stores or invents state. `tone` is a
// semantic token the UI maps to a status pill (Gate-3 owns the palette), never a raw color.

// AGGREGATE readiness — exactly three states. `severity` orders the rollup: ATTENTION > UNKNOWN > READY.
export const READINESS = {
  // Everything this part/job needs is demonstrably available from a KNOWN authority.
  READY: { key: "READY", label: "Ready", tone: "positive", severity: 0 },
  // Cannot be determined because a required source is unavailable/unknown. The honest middle — not a pass,
  // not a failure. (e.g. on-truck stock isn't persisted yet.)
  UNKNOWN: { key: "UNKNOWN", label: "Unknown", tone: "unknown", severity: 1 },
  // A KNOWN, actionable gap: short, procurement pending, missing, or awaiting a decision.
  ATTENTION: { key: "ATTENTION", label: "Attention", tone: "attention", severity: 2 },
};
export const READINESS_KEYS = Object.keys(READINESS);

// SOURCE / CAPABILITY availability — a separate axis. NOT part of the readiness severity rollup.
export const AVAILABILITY = {
  // The source answered with a value.
  KNOWN: { key: "KNOWN", label: "Known", tone: "neutral" },
  // The source is enabled but this datum couldn't be determined.
  UNKNOWN: { key: "UNKNOWN", label: "Unknown", tone: "unknown" },
  // The capability/source isn't enabled for this tenant/deployment — honest modular degradation, never a
  // broken control or a fabricated value.
  UNAVAILABLE: { key: "UNAVAILABLE", label: "Unavailable", tone: "muted" },
};
export const AVAILABILITY_KEYS = Object.keys(AVAILABILITY);

export function isReadinessKey(key) {
  return Object.prototype.hasOwnProperty.call(READINESS, key);
}
export function isAvailabilityKey(key) {
  return Object.prototype.hasOwnProperty.call(AVAILABILITY, key);
}

// Roll a set of part readiness states up to one job state — worst-actionable-first (ATTENTION > UNKNOWN >
// READY). ONLY the three aggregate readiness states participate; anything else (notably a
// source-availability UNAVAILABLE, or a stray key) is IGNORED and can never become the aggregate result.
// Empty → READY by convention; callers handle the "no parts planned" case (NO_PLAN) explicitly BEFORE
// rolling up, so an empty rollup is never the path that produces a job-level answer here.
export function rollUpReadiness(states = []) {
  let worst = READINESS.READY;
  for (const s of states) {
    const key = typeof s === "string" ? s : s?.key;
    if (!isReadinessKey(key)) continue; // ignore non-readiness inputs, incl. UNAVAILABLE
    const state = READINESS[key];
    if (state.severity > worst.severity) worst = state;
  }
  return worst;
}
