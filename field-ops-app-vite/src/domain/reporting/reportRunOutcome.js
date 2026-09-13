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

// The server's CLOSED RunReportOutcomeKind set, mirrored here.
//
// RPT-CLIENT. At 8521cd88 this set had five values and the server had six: ENG-E
// added "company-unresolved" (a TENANCY refusal, deliberately DISTINCT from
// "permission-denied" so an operator cannot mistake it for a missing grant and go
// and grant a Role, which would not fix a valueless binding and may over-grant
// while trying to). An unrecognised kind falls through to reportRunFailure()
// below, so at baseline a tenancy refusal rendered as a generic failure and the
// explanation was lost.
//
// Mirroring a closed set by hand is exactly the drift this lane's defect class is
// made of, so it is no longer only a comment: test/
// reportOutcomeContractRatchet.test.mjs PARSES
// functions/src/reporting/reportExecutionService.ts's RunReportOutcomeKind union
// and fails when this array and that union disagree in either direction.
//
// EXPORTED for that ratchet. Ordered as the server's union is.
export const SERVICE_KINDS = Object.freeze([
  "permission-denied",
  "company-unresolved",
  "empty",
  "partially-authorized",
  "truncated-widened",
  "results",
]);
const SERVICE_KIND_SET = new Set(SERVICE_KINDS);

// A server kind that carries NO rows because the run was refused before/without
// producing an answer. `ok` is false for these; every other kind returned a row
// set (possibly an empty or partial one).
const REFUSAL_KINDS = new Set(["permission-denied", "company-unresolved"]);

// The server's ScanCompleteness union (reportExecutionService.ts), mirrored and
// ratcheted the same way. This is an ORTHOGONAL AXIS, present on every outcome,
// and it is deliberately NOT a kind -- the client ladder is single-winner and has
// already produced one documented collapse defect, so completeness must never be
// put back into that ranking contest. The ratchet asserts these two vocabularies
// stay disjoint.
//
//   proven-complete -- the scan reached the end of the bounded population.
//   bounded-page    -- the scan hit its cap; rows returned are real, ABSENCE IS NOT
//                      ESTABLISHED.
//   not-attempted   -- no scan was issued (a refusal). Completeness is
//                      INAPPLICABLE, not true: this value exists so a refused run
//                      cannot be mistaken for a complete one.
export const SCAN_COMPLETENESS_VALUES = Object.freeze(["proven-complete", "bounded-page", "not-attempted"]);
const SCAN_COMPLETENESS_SET = new Set(SCAN_COMPLETENESS_VALUES);

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

// RPT-CLIENT defect 2. The server's SCAN-BOUND REFUSAL, which at 8521cd88 had no
// client branch at all.
//
// runReportDefinitionCallable.ts maps BOTH refusals to HttpsError
// "resource-exhausted": IncompleteAggregateScanError (an aggregate computed from a
// cut population would understate the truth -- FIN-004) and UnprovenAbsenceError
// (a zero-row result out of a truncated scan is not a proven "no results"). The
// client cannot tell the two apart -- same code, and the server's message is prose
// we must not print -- so ONE outcome covers both, and its copy has to be true of
// both.
//
// What it must NOT say is the baseline copy it used to get, verbatim: "Running
// reports isn't available yet. Nothing was read or changed." The engine was
// reachable, it ran, and DOCUMENTS WERE READ -- that is precisely why the answer
// could not be proven. A tool that misreports whether data was read is worse than
// one that errors, because the reader acts on it.
//
// "Nothing was changed" is kept, and is true: a report run is read-only.
export function reportRunIncompleteScan() {
  return Object.freeze({
    ok: false, kind: "incomplete-scan", rows: null, aggregates: null,
    message:
      "This report read records but there were too many to finish checking, so the result " +
      "couldn't be proven complete and isn't shown. Narrow the report — add a filter or a " +
      "shorter date range — and run it again. Nothing was changed.",
  });
}

// Map a successful callable payload (D-FN RunReportOutcome) to the client outcome. A response of
// an unknown/absent kind fails closed to a safe failure state rather than rendering garbage.
export function mapServiceOutcome(data) {
  if (!isPlainObject(data) || !SERVICE_KIND_SET.has(data.kind)) return reportRunFailure();
  return Object.freeze({
    ok: !REFUSAL_KINDS.has(data.kind),
    kind: data.kind,
    rows: Array.isArray(data.rows) ? data.rows : null,
    aggregates: Array.isArray(data.aggregates) ? data.aggregates : null,
    rowCount: Number.isFinite(data.rowCount) ? data.rowCount : (Array.isArray(data.rows) ? data.rows.length : 0),
    rowCap: Number.isFinite(data.rowCap) ? data.rowCap : null,
    truncated: data.truncated === true,
    // The ORTHOGONAL COMPLETENESS AXIS, carried through rather than inferred. A
    // mapper that drops these makes them unreadable by any renderer, which is the
    // single-winner collapse by another route.
    //
    // An absent or unrecognised value becomes `null` -- "the server did not say" --
    // and NEVER "proven-complete". Defaulting to complete would assert a
    // completeness we were never told, which is the sin this lane exists to remove;
    // the renderer resolves null conservatively from the truncation flags instead.
    completeness: SCAN_COMPLETENESS_SET.has(data.completeness) ? data.completeness : null,
    scanTruncated: data.scanTruncated === true,
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
// nothing read" state). Every code that carries real, actionable meaning is branched on
// EXPLICITLY in the table below -- an authorization denial, a rejected/invalid definition, and
// (RPT-CLIENT) the scan-bound refusal, which the `default:` branch used to swallow into a
// statement that was factually false. Every path is safe -- no data, safe copy, never a raw code
// in user-facing text.
// The DECLARED code -> outcome-factory table.
//
// RPT-CLIENT: this used to be an inline `switch`, which no test could enumerate --
// so "the server can throw a code the client never branches on" was undetectable
// by anything but reading both files. As a table it is introspectable, and
// test/reportOutcomeContractRatchet.test.mjs parses every
// `new HttpsError("...")` out of functions/src/reporting/
// runReportDefinitionCallable.ts and fails when one has no entry here.
//
// EXPORTED for that ratchet.
export const CALLABLE_ERROR_OUTCOMES = Object.freeze({
  // Authorization. Note this is the callable's OWN unauthenticated guard; a
  // per-object denial comes back as a successful payload of kind
  // "permission-denied", not as a thrown code.
  "unauthenticated": reportRunPermissionDenied,
  "permission-denied": reportRunPermissionDenied,
  // A rejected or no-longer-valid definition.
  "invalid-argument": reportRunUnsupported,
  "failed-precondition": reportRunUnsupported,
  // The scan-bound refusals -- see reportRunIncompleteScan().
  "resource-exhausted": reportRunIncompleteScan,
  // The service's own internal failure. Indistinguishable at the code level from
  // an undeployed/unreachable engine (see the note below), so it shares that
  // outcome -- listed EXPLICITLY rather than left to the fallback, so the ratchet
  // can see that it was considered.
  "internal": reportRunUnavailable,
});

export function mapCallableError(err) {
  const code = String(err?.code ?? "").replace(/^functions\//, "");
  const factory = Object.prototype.hasOwnProperty.call(CALLABLE_ERROR_OUTCOMES, code)
    ? CALLABLE_ERROR_OUTCOMES[code]
    : null;
  if (factory) return factory();
  // not-found / unavailable / deadline-exceeded / cancelled / unknown / a network
  // transport failure / no code at all -> the engine isn't reachable:
  // unavailable-safe. Nothing was read on any of these paths, so that copy is
  // true here even though it was false for "resource-exhausted" above.
  return reportRunUnavailable();
}
