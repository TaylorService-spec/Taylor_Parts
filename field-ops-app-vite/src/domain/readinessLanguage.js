// Readiness — the SHARED Enterprise Operations OS platform vocabulary (not a parts-specific badge).
//
// One coherent readiness language so "ready / needs attention / unknown" mean the SAME thing everywhere
// they appear (Scheduling, Control Tower, Work Orders, Technician Current Job, Inventory, Purchasing).
// This is a pure vocabulary + rollup helper — NOT a persisted "readiness model". Readiness is always a
// PROJECTION derived over canonical authorities; nothing here stores or invents state.
//
// Design intent (Owner product principle E): keep the set small and consistent. A dimension (parts,
// equipment, technician, procurement, …) resolves to one READINESS_STATE; a container rolls its
// dimensions up by worst-actionable-first. Honest "can't tell" is a first-class state (UNKNOWN), and a
// capability that isn't enabled degrades to UNAVAILABLE rather than a fake pass or a broken control.

// The canonical states. `severity` orders the rollup (higher wins). `tone` is a semantic token the UI maps
// to a status pill — deliberately NOT a raw color, so Gate-3 owns the palette.
export const READINESS = {
  // Everything this dimension needs is demonstrably available from a KNOWN authority.
  READY: { key: "READY", label: "Ready", tone: "positive", severity: 0 },
  // A KNOWN, actionable gap: something is short, pending procurement, missing, or awaiting a decision.
  ATTENTION: { key: "ATTENTION", label: "Attention", tone: "attention", severity: 3 },
  // Genuinely cannot be determined because a required source is unavailable/unknown. NOT a failure, NOT a
  // pass — the honest middle. (e.g. on-truck stock isn't persisted yet.)
  UNKNOWN: { key: "UNKNOWN", label: "Unknown", tone: "unknown", severity: 2 },
  // The capability that would answer this isn't enabled for this tenant/deployment. Honest modular
  // degradation, never a broken button or fabricated state.
  UNAVAILABLE: { key: "UNAVAILABLE", label: "Unavailable", tone: "muted", severity: 1 },
};

export const READINESS_KEYS = Object.keys(READINESS);

// Is this a real readiness state key?
export function isReadinessKey(key) {
  return Object.prototype.hasOwnProperty.call(READINESS, key);
}

// Roll a set of dimension states up to one container state: worst-actionable-first
// (ATTENTION > UNKNOWN > UNAVAILABLE > READY). An empty set is READY by convention (nothing to be un-ready
// about) — callers that want "no data" to read differently should special-case emptiness before rolling.
export function rollUpReadiness(states = []) {
  const known = states.filter((s) => s && isReadinessKey(s.key ?? s));
  if (known.length === 0) return READINESS.READY;
  let worst = READINESS.READY;
  for (const s of known) {
    const state = typeof s === "string" ? READINESS[s] : s;
    if (state.severity > worst.severity) worst = state;
  }
  return worst;
}
