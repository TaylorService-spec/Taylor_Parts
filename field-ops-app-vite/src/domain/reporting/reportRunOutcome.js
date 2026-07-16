// Issue #325 / ADR-007 W1 -- PURE mappers between the trusted Function (D-FN) and the client's
// run-outcome shape. No firebase import here, so this stays node-testable; the thin firebase-
// calling wrapper lives in reportExecutionSeam.js and delegates to these.
//
// The D-FN RunReportOutcome (functions/src/reporting/reportExecutionService.ts) already uses the
// client's own field names (kind / rows / aggregates / rowCount / rowCap / truncated / widened /
// droppedColumnLabels / droppedPredicateCount), and its `kind`s are a subset of the ones
// reportResultState.js renders -- so mapping is mostly shape-validation + fail-closed defaults.
// A malformed response or an unexpected error NEVER throws and NEVER surfaces a raw code/path.

export const REPORT_RUN_UNAVAILABLE_REASON = "report-engine-unavailable";

const SERVICE_KINDS = new Set(["permission-denied", "empty", "partially-authorized", "truncated-widened", "results"]);

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function safeStringArray(v) {
  return Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim() !== "") : [];
}

// The frozen, safe outcome for "the engine isn't reachable" -- the not-deployed case (Spec §12).
export function reportRunUnavailable() {
  return Object.freeze({
    ok: false, unavailable: true, kind: "unavailable", reason: REPORT_RUN_UNAVAILABLE_REASON,
    rows: null, aggregates: null,
    message: "Running reports isn't available yet. Nothing was read or changed.",
  });
}
export function reportRunPermissionDenied() {
  return Object.freeze({ ok: false, kind: "permission-denied", rows: null, aggregates: null });
}
export function reportRunUnsupported() {
  return Object.freeze({ ok: false, kind: "unsupported", rows: null, aggregates: null });
}
export function reportRunFailure() {
  return Object.freeze({ ok: false, kind: "failure", rows: null, aggregates: null });
}

// Map a successful callable payload (D-FN RunReportOutcome) to the client outcome. A response of
// an unknown/absent kind fails closed to a safe failure state rather than rendering garbage.
export function mapServiceOutcome(data) {
  if (!isPlainObject(data) || !SERVICE_KINDS.has(data.kind)) return reportRunFailure();
  return Object.freeze({
    ok: data.kind !== "permission-denied",
    kind: data.kind,
    rows: Array.isArray(data.rows) ? data.rows : null,
    aggregates: Array.isArray(data.aggregates) ? data.aggregates : null,
    rowCount: Number.isFinite(data.rowCount) ? data.rowCount : (Array.isArray(data.rows) ? data.rows.length : 0),
    rowCap: Number.isFinite(data.rowCap) ? data.rowCap : null,
    truncated: data.truncated === true,
    widened: data.widened === true,
    // UI-safe labels only; never the audit-facing raw field ids (droppedFieldIds/-PredicateFieldIds).
    droppedColumnLabels: safeStringArray(data.droppedColumnLabels),
    droppedPredicateCount: Number.isInteger(data.droppedPredicateCount) ? data.droppedPredicateCount : 0,
  });
}

// Map a thrown callable error (a Firebase FunctionsError, code optionally prefixed "functions/")
// to a safe client outcome. "Not deployed" is unavailable-safe REGARDLESS of how it surfaces:
// a missing production endpoint throws `not-found`, but an unreachable/undeployed engine (no
// Functions emulator, CORS, a network failure) surfaces as `internal`/`unknown` with no reliable
// way to tell it apart from a deployed engine's own internal error. Since the two are
// indistinguishable at the code level and the not-deployed case is the one W1 must handle
// gracefully, any UNEXPECTED error maps to `unavailable` (the reassuring "not available yet,
// nothing read" state). Only the two codes that carry real, actionable meaning are special-cased:
// an authorization denial and a rejected/invalid definition. Every path is safe -- no data, safe
// copy, never a raw code in user-facing text.
export function mapCallableError(err) {
  const code = String(err?.code ?? "").replace(/^functions\//, "");
  switch (code) {
    case "unauthenticated":
    case "permission-denied":
      return reportRunPermissionDenied();
    case "invalid-argument":
    case "failed-precondition":
      return reportRunUnsupported();
    default:
      // not-found / unavailable / internal / unknown / a network transport failure, etc. ->
      // the engine isn't reachable: unavailable-safe.
      return reportRunUnavailable();
  }
}
