// Review source freshness / provenance (Owner-approved, from the LIVE PROCESS TEST finding).
//
// A review/execution result is only valid if the reviewer can PROVE what source state it
// actually reviewed. "A local checkout exists" and "the branch is main" are NOT proof of
// currency — the LIVE TEST produced a false REJECT precisely because an agent read a local
// checkout that was behind origin/main. So where source state is material, capture provenance
// and let it gate whether the result is authoritative.
//
// Pure: schema + a freshness derivation + authority/disposition helpers + an Owner-facing label.
// Nothing is fabricated — an unknown observation yields UNKNOWN, never a guessed CURRENT.

export const SOURCE_FRESHNESS = Object.freeze(["CURRENT", "BEHIND_REMOTE", "DIRTY", "DIVERGED", "UNKNOWN"]);

// Suggested dispositions for a result produced from non-CURRENT source (where currency matters).
export const STALE_REVIEW_DISPOSITIONS = Object.freeze(["CONTAMINATED", "STALE", "NEEDS_RERUN"]);

const DEFAULTS = Object.freeze({
  repository: null, requestedBaseRef: null, requestedCommit: null, actualCommit: null,
  originMainCommit: null, workingTreeState: null, sourceLocation: null,
  sourceFreshnessState: "UNKNOWN", provenanceCapturedAt: null,
});

/**
 * Derive the freshness state from observations. Precedence: nothing observed → UNKNOWN;
 * a dirty tree → DIRTY; caller-flagged divergence → DIVERGED; actual behind the target
 * commit → BEHIND_REMOTE; actual matches the target → CURRENT.
 *
 * @param {object} o
 * @param {string|null} o.actualCommit      commit actually reviewed (required for anything but UNKNOWN)
 * @param {string|null} [o.targetCommit]     the commit currency is judged against (requestedCommit ?? originMainCommit)
 * @param {string|null} [o.workingTreeState] "CLEAN" | "DIRTY" | null
 * @param {boolean} [o.diverged]             caller observed the branch diverged from the target
 */
export function deriveSourceFreshness({ actualCommit = null, targetCommit = null, workingTreeState = null, diverged = false } = {}) {
  if (!actualCommit) return "UNKNOWN";
  if (workingTreeState === "DIRTY") return "DIRTY";
  if (diverged) return "DIVERGED";
  if (targetCommit == null) return "UNKNOWN";       // can't judge currency without a target
  return actualCommit === targetCommit ? "CURRENT" : "BEHIND_REMOTE";
}

export function createReviewProvenance(input = {}) {
  const p = { ...DEFAULTS, ...input };
  if (!p.sourceFreshnessState || p.sourceFreshnessState === "UNKNOWN") {
    p.sourceFreshnessState = deriveSourceFreshness({
      actualCommit: p.actualCommit,
      targetCommit: p.requestedCommit ?? p.originMainCommit,
      workingTreeState: p.workingTreeState,
      diverged: p.diverged === true,
    });
  }
  return Object.freeze(p);
}

export function validateReviewProvenance(p) {
  const errors = [];
  if (!SOURCE_FRESHNESS.includes(p.sourceFreshnessState)) errors.push(`sourceFreshnessState must be one of ${SOURCE_FRESHNESS.join("/")}`);
  return errors;
}

// A result is authoritative (where source currency matters) ONLY when the source was CURRENT.
// BEHIND_REMOTE / DIRTY / DIVERGED / UNKNOWN must NOT be treated as authoritative automatically.
export function isAuthoritativeSource(freshnessState) {
  return freshnessState === "CURRENT";
}

// Suggested disposition for a completed review produced from non-CURRENT source.
//   DIRTY   → CONTAMINATED (reviewed uncommitted/ambiguous state)
//   BEHIND_REMOTE / DIVERGED / UNKNOWN → NEEDS_RERUN (re-run against a fresh, known source)
// The caller may still record CONTAMINATED for a verdict that was demonstrably wrong (as the
// LIVE TEST's false REJECT was), or STALE for a still-plausible-but-old result.
export function suggestedStaleDisposition(freshnessState) {
  if (freshnessState === "CURRENT") return null;
  if (freshnessState === "DIRTY") return "CONTAMINATED";
  return "NEEDS_RERUN";
}

// Owner-facing label so the Control Center distinguishes review currency without Git internals.
export function reviewProvenanceLabel(freshnessState) {
  switch (freshnessState) {
    case "CURRENT": return "REVIEW CURRENT";
    case "DIRTY": return "REVIEW CONTAMINATED";
    case "BEHIND_REMOTE":
    case "DIVERGED": return "REVIEW STALE";
    default: return "REVIEW UNKNOWN";
  }
}
