// Issue #325 unit F3 -- the gated execution SEAM for the report builder.
//
// The builder renders and validates a definition entirely client-side (F1 catalog + F2
// validator), but a RUN requires the trusted, field-projecting Function (D-FN) that reads a
// governed collection with elevated privilege, projects to authorized fields, and applies the
// predicate-drop rule (ADR-007 §2.4/§2.5). That Function is a separate lane and is not deployed
// or verified (blocked on Issue #15). Until it is, running a report is UNAVAILABLE -- never a
// client-direct read, never a simulated/mock result, never an optimistic success. This is the
// single shape a run returns now, so the builder can render a clear reason and keep the result
// area honest (the same contract shape as domain/equipment.js `trustedActionUnavailable`).
//
// The call signature is fixed here so callers do not change when the Function ships: the run
// entry point takes a validated definition and (later) a runner/options, and returns a Promise
// of a run OUTCOME. Today it always resolves to the unavailable outcome.

export const REPORT_RUN_UNAVAILABLE_REASON = "report-engine-unavailable";

// The frozen, safe outcome a run resolves to while the trusted Function is undeployed. Names no
// provider, code, collection, path, or credential (Spec §12 safe-copy rule).
export function reportRunUnavailable() {
  return Object.freeze({
    ok: false,
    unavailable: true,
    kind: "unavailable",
    reason: REPORT_RUN_UNAVAILABLE_REASON,
    rows: null,
    message: "Running reports isn't available yet. Nothing was read or changed.",
  });
}

// The fixed run entry point. Async so the signature already matches the future
// httpsCallable(...) invocation; callers `await runReport(definition, options)` today and
// unchanged later. It NEVER reads data and NEVER throws -- it resolves to the unavailable
// outcome. Params are documented as a comment (not declared) while the seam is inert, matching
// domain/equipment.js's trusted-writer seams, so there are no unused-parameter warnings.
export async function runReport(/* definition, options */) {
  return reportRunUnavailable();
}
