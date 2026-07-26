// INV-CONVERGENCE-E Stage A -- pure, sanitized diagnostics view mapper. Maps a
// { status, evidence } parity result into a render-ready view model that exposes
// ONLY counts, hashes, timestamps and divergence summaries -- never credentials,
// tokens, UIDs, emails, or full production records. No Firebase, no network.
import { PARITY_STATES } from "./partsShadowParity.js";

/** Diagnostics access is admin/dispatcher only, matching the current `parts` Rules. */
export function isDiagnosticsAuthorized(role) {
  return role === "admin" || role === "dispatcher";
}

const TONE = {
  PASS: { label: "PASS", background: "#e6f4ea", color: "#137333" },
  FAIL_PARITY: { label: "FAIL_PARITY", background: "#fce8e6", color: "#c5221f" },
  BLOCKED_PERMISSION: { label: "BLOCKED_PERMISSION", background: "#fef7e0", color: "#b06000" },
  BLOCKED_UNAVAILABLE: { label: "BLOCKED_UNAVAILABLE", background: "#fef7e0", color: "#b06000" },
  BLOCKED_INCOMPLETE_INPUT: { label: "BLOCKED_INCOMPLETE_INPUT", background: "#fef7e0", color: "#b06000" },
};

const num = (v) => (typeof v === "number" ? v : null);

/** Map a parity result to a sanitized diagnostics view model. Never throws. */
export function toDiagnosticsView(result) {
  if (!result || !PARITY_STATES.includes(result.status)) {
    return { invalid: true, reason: "unrecognized parity result" };
  }
  const e = result.evidence && typeof result.evidence === "object" ? result.evidence : {};
  const status = result.status;
  return {
    invalid: false,
    status,
    tone: TONE[status] ?? TONE.BLOCKED_INCOMPLETE_INPUT,
    isPass: status === "PASS",
    isBlocked: status.startsWith("BLOCKED_"),
    reason: typeof e.reason === "string" ? e.reason : null,
    meta: {
      runId: e.runId ?? null,
      adapterCommit: e.adapterCommit ?? null,
      staticCatalogHash: e.staticCatalogHash ?? null,
      capturedAtStart: e.capturedAtStart ?? null,
      capturedAtEnd: e.capturedAtEnd ?? null,
      sourceCounts: e.sourceCounts ?? null,
    },
    counts: {
      canonicalMatch: num(e.canonicalMatchCount),
      staticOnlyExcluded: num(e.staticOnlyExcludedCount),
      // current-vs-shadow model comparison (primary parity signal)
      rowMissing: num(e.rowMissingCount),
      fieldDivergence: num(e.fieldDivergenceCount),
      availabilityDivergence: num(e.availabilityDivergenceCount),
      workflowDivergence: num(e.workflowDivergenceCount),
      // adapter self-validation (additional evidence)
      unexpectedUnmatched: num(e.unexpectedUnmatchedCount),
      nameDivergence: num(e.nameDivergenceCount),
      normalizedUnitDivergence: num(e.normalizedUnitDivergenceCount),
      structuralIssue: num(e.structuralIssueCount),
    },
    // divergence summaries are { key, kind } only -- never record values
    divergenceSummary: Array.isArray(e.divergences)
      ? e.divergences.map((d) => ({ key: d?.key ?? null, kind: d?.kind ?? null }))
      : [],
  };
}
