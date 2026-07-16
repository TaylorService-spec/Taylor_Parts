// Issue #325 unit F3 -- pure categorizer for the report result AREA's state matrix (Spec §12).
//
// The builder shell must be able to render EVERY result state honestly, even though the trusted
// Function that would produce them live is undeployed (the run seam returns `unavailable`). This
// maps a run OUTCOME (reportExecutionSeam.js) -- or a fixture of one -- to a safe display
// descriptor: { kind, tone, role, title, message, notes[] }. It NEVER emits a raw Firebase code,
// path, document id, collection name, or the name of a field the runner may not know exists
// (Spec §12). Callers render it with the shared state primitives (EmptyState/FailureState/etc.).
//
// tone drives styling; role drives assistive-tech semantics ("alert" only for real problems, not
// for an empty result or a normal loading region).

const KINDS = new Set([
  "idle", "loading", "empty", "permission-denied", "partially-authorized",
  "unsupported", "truncated-widened", "failure", "unavailable", "results",
]);

export function describeRunOutcome(outcome) {
  const kind = outcome && KINDS.has(outcome.kind) ? outcome.kind : "failure";
  switch (kind) {
    case "idle":
      return d("idle", "info", "status", "No report run yet",
        "Choose an object and fields, then run the report.");
    case "loading":
      return d("loading", "info", "status", null, "Running the report…");
    case "empty":
      // Not an error -- a valid report with no matching rows.
      return d("empty", "info", "status", "No matching records",
        "This report ran successfully but no records matched.");
    case "permission-denied":
      // Whole-object denial. Reads as access, never a field enumeration (Spec §12).
      return d("permission-denied", "error", "alert", "You don't have access to this report",
        "Your role doesn't allow viewing this data. Ask an administrator if you need access.");
    case "partially-authorized": {
      // Columns the RUNNER selected may be named back to them; dropped PREDICATES are surfaced
      // as a count only -- a shared report's hidden filter may reference a field the runner may
      // not know exists, so it is never named (Spec §6 / §12).
      const notes = [];
      const cols = safeLabels(outcome.droppedColumnLabels);
      if (cols.length > 0) notes.push(`Columns you can't view were left out: ${cols.join(", ")}.`);
      const preds = Number.isInteger(outcome.droppedPredicateCount) ? outcome.droppedPredicateCount : 0;
      if (preds > 0) {
        notes.push(`${preds} filter${preds === 1 ? "" : "s"} you can't view ${preds === 1 ? "was" : "were"} not applied, so this result is wider than the saved report.`);
      }
      if (notes.length === 0) notes.push("Some parts of this report weren't available to you and were left out.");
      return d("partially-authorized", "warning", "status", "Showing what you can view", null, notes);
    }
    case "unsupported":
      // A selected field/operator is no longer valid against the catalog (e.g. de-activated).
      return d("unsupported", "warning", "status", "Part of this report is no longer available",
        "A field or option in this report isn't available anymore. Remove it and run again.");
    case "truncated-widened": {
      const notes = [];
      if (outcome.widened) notes.push("Some filters weren't applied, so this result is wider than the saved report.");
      if (outcome.truncated) {
        const cap = Number.isInteger(outcome.rowCap) ? outcome.rowCap : null;
        notes.push(cap
          ? `Showing the first ${cap.toLocaleString()} rows — this result was cut off and isn't complete.`
          : "This result was cut off and isn't complete.");
      }
      if (notes.length === 0) notes.push("This result was adjusted to stay within limits.");
      return d("truncated-widened", "warning", "status", "Partial result", null, notes);
    }
    case "failure":
      // Generic, safe failure. No raw code/path ever (Spec §12).
      return d("failure", "error", "alert", "This report couldn't run",
        "Something went wrong running this report. Try again in a moment.");
    case "unavailable":
      // The inert seam: the trusted engine isn't deployed yet.
      return d("unavailable", "info", "status", "Reports aren't available yet",
        outcome.message || "Running reports isn't available yet. Nothing was read or changed.");
    case "results":
      return d("results", "info", "status", null, null);
    default:
      return d("failure", "error", "alert", "This report couldn't run",
        "Something went wrong running this report. Try again in a moment.");
  }
}

function d(kind, tone, role, title, message, notes = []) {
  return Object.freeze({ kind, tone, role, title, message, notes: Object.freeze([...notes]) });
}

// Only render string labels; drop anything non-string so a malformed outcome can't inject a
// raw object/id into the copy.
function safeLabels(labels) {
  if (!Array.isArray(labels)) return [];
  return labels.filter((l) => typeof l === "string" && l.trim() !== "");
}
