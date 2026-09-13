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

import { CLIENT_RECOGNIZED_KINDS } from "./reportRunOutcome.js";

// ===================== THE KIND VOCABULARY, CLASSIFIED =====================
//
// RPT-COMPAT. This used to be a hand-written literal set that repeated the six wire
// kinds a second time, so the render layer could fall behind the mapper without
// anything failing. It is now DERIVED: the wire half comes from
// reportRunOutcome.js's CLIENT_RECOGNIZED_KINDS (which carries the Owner's SUBSET
// contract and the compatibility declaration), and the client half is declared
// below with a reason per entry.
//
// Every kind this categorizer accepts is therefore in exactly one of two declared
// classes, and test/reportOutcomeContractRatchet.test.mjs asserts the union is
// complete, the two classes are DISJOINT, and the counts add up -- so an
// unclassified kind cannot appear in either layer.
//
// CLIENT-ORIGIN states are produced by the CLIENT and are NEVER accepted off the
// wire (mapServiceOutcome() rejects them, which is deliberate: a server must not be
// able to claim "unavailable" or "idle"). They are NOT compatibility entries --
// that is a different class, for a WIRE kind the current server can no longer emit,
// declared in reportRunOutcome.js's SERVER_KIND_COMPATIBILITY.
export const CLIENT_ORIGIN_KINDS = Object.freeze({
  "idle": { reason: "the builder before any run has been requested; no server call has happened" },
  "loading": { reason: "a run is in flight; the client owns this state, the server never reports it" },
  "unsupported": { reason: "produced from the callable's invalid-argument/failed-precondition refusals" },
  "failure": { reason: "the generic safe fallback for an incoherent or hand-built descriptor" },
  "unavailable": { reason: "the engine is undeployed/unreachable (Spec sec12) -- no server payload exists" },
  "incomplete-scan": {
    reason: "produced from the callable's resource-exhausted scan-bound refusal; NOT a server kind " +
      "and must never be added to CLIENT_RECOGNIZED_KINDS",
  },
  "unrecognized-outcome": {
    reason: "RPT-COMPAT / Owner ruling -- the truthful generic blocking refusal for a server kind " +
      "this build does not recognise (version skew) or an uninterpretable payload",
  },
});

const KINDS = new Set([...CLIENT_RECOGNIZED_KINDS, ...Object.keys(CLIENT_ORIGIN_KINDS)]);

/** Every kind describeRunOutcome() accepts as INPUT. EXPORTED for the guard. */
export const RENDERABLE_KINDS = Object.freeze([...KINDS]);

// NOTE the asymmetry, which is deliberate. "empty-unproven" is an OUTPUT-ONLY
// display state -- the `empty` branch returns it when the completeness axis says the
// absence was never proven -- and it is NOT in KINDS, because no OUTCOME ever has
// that kind. KINDS is the set of INPUT kinds this categorizer accepts; adding an
// output-only state to it would accept a value no producer can make and then drop it
// through to `default:` anyway.

// ---------------------------------------------------------------------------
// The ORTHOGONAL COMPLETENESS AXIS (reportExecutionService.ts's ScanCompleteness),
// read here instead of being inferred from the winning kind.
//
// The server publishes `completeness` and `scanTruncated` on EVERY outcome
// precisely so no consumer has to read the population verdict out of `kind` -- the
// kind ladder is single-winner and has already collapsed once. So this file reads
// the axis directly, and it does NOT turn the axis into a kind of its own on the
// outcome: the only thing it selects is which DISPLAY descriptor to return.
//
// `null`/absent completeness means "the server did not say" (see
// reportRunOutcome.js). It is resolved CONSERVATIVELY from the truncation flags,
// never upward to "complete".
// ---------------------------------------------------------------------------

/**
 * "complete" | "bounded" | "not-attempted" -- a DISPLAY verdict, not a wire value.
 *
 * RESIDUAL, stated rather than hidden: an outcome that carries NO completeness and
 * NO truncation flag at all still resolves to "complete". The live server states
 * completeness on every outcome it builds (the ratchet asserts that), so such a
 * payload can now only be a fixture or a hand-built object -- and reading a
 * fixture that asserts nothing as a proven absence preserves the pre-existing
 * behaviour of this branch rather than silently reclassifying every existing
 * fixture. It is the one case left where absence is inferred rather than read.
 */
function populationVerdict(outcome) {
  const c = outcome?.completeness;
  if (c === "not-attempted") return "not-attempted";
  if (c === "bounded-page") return "bounded";
  if (c === "proven-complete") return "complete";
  // Not stated. Only SCAN truncation cuts the population, but a client fixture may
  // carry only the coarse `truncated` OR-of-three-bounds; the server's own
  // reasoning is that neither of the other two bounds can coexist with a zero-row
  // result, so treating `truncated` as a population cut here can only be
  // conservative, never over-claiming.
  if (outcome?.scanTruncated === true || outcome?.truncated === true) return "bounded";
  return "complete";
}

/** True when the population this outcome was drawn from was cut short. */
function populationWasCut(outcome) {
  return populationVerdict(outcome) === "bounded";
}

export function describeRunOutcome(outcome) {
  const kind = outcome && KINDS.has(outcome.kind) ? outcome.kind : "failure";
  switch (kind) {
    case "idle":
      return d("idle", "info", "status", "No report run yet",
        "Choose an object and fields, then run the report.");
    case "loading":
      return d("loading", "info", "status", null, "Running the report…");
    case "empty": {
      // RPT-CLIENT defect 3. At 8521cd88 this branch read NO completeness flag and
      // said "This report ran successfully but no records matched." for every
      // `empty` outcome -- a PROVEN-ABSENCE claim. Its own partially-authorized
      // sibling below already reads outcome.truncated for exactly this reason.
      //
      // A LIVE run can no longer reach a false `empty` (the server refuses with
      // UnprovenAbsenceError), but this branch is also FIXTURE-driven (Spec §12),
      // so a fixture can still assert an absence that was never proven.
      const verdict = populationVerdict(outcome);
      if (verdict === "not-attempted") {
        // No scan was issued at all, so there is no absence to report -- proven or
        // otherwise. An outcome that claims `empty` while stating that nothing was
        // read is incoherent, and this file's standing convention for an incoherent
        // outcome is to fail closed to the generic failure state. Deliberately NOT
        // rendered as an absence of any kind.
        return d("failure", "error", "alert", "This report couldn't run",
          "No records were read, so this report can't say whether any match. Try running it again.");
      }
      if (verdict === "bounded") {
        // Visually distinct (a warning tone and a notes list, so ReportBuilder's
        // ResultArea cannot route it down the plain EmptyState path) and textually
        // distinct: it states that records WERE read, withholds the absence claim,
        // and says what the reader can do about it.
        return d("empty-unproven", "warning", "status", "No matches in the records we could read", null, [
          "This report read records but couldn't check all of them, so \u201Cno matching records\u201D isn't proven — matches may exist outside what was read.",
          "Narrow the report — add a filter or a shorter date range — and run it again for a complete answer.",
        ]);
      }
      // A PROVEN absence: the one case where this sentence is true.
      return d("empty", "info", "status", "No matching records",
        "This report ran successfully but no records matched.");
    }
    case "permission-denied":
      // Whole-object denial. Reads as access, never a field enumeration (Spec §12).
      return d("permission-denied", "error", "alert", "You don't have access to this report",
        "Your role doesn't allow viewing this data. Ask an administrator if you need access.");
    case "company-unresolved":
      // RPT-CLIENT defect 1, at the render layer. A TENANCY refusal, NOT a missing
      // permission -- ENG-E made it a distinct kind for exactly that reason: an
      // operator who reads "no access" goes and grants a Role, which does not fix a
      // valueless binding and may over-grant while trying to. So this copy must
      // never borrow permission-denied's wording above.
      //
      // The target collection was NEVER READ on this path, so saying so is true.
      // outcome.companyBoundRefusal is server prose (it names Firestore internals)
      // and is not carried to the client at all -- see reportRunOutcome.js.
      return d("company-unresolved", "error", "alert", "We couldn't establish which operating company this report is for",
        "Your access doesn't resolve to an operating company for this data, so the report wasn't run and nothing was read. " +
        "Ask an administrator to confirm which operating company your access applies to.");
    case "incomplete-scan":
      // RPT-CLIENT defect 2, at the render layer. The server's scan-bound refusal.
      //
      // The copy is FIXED here and outcome.message is deliberately NOT consulted
      // (unlike "unavailable" below, which has always echoed it). This state has to
      // carry three things every time -- records WERE read, the result is not proven
      // complete, and the one action that fixes it -- and an outcome.message that a
      // fixture supplied, or that a future payload shortened, could silently drop
      // any of them. ReportBuilder renders an error tone through FailureState, which
      // shows only the title and message and discards notes, so the action cannot be
      // demoted to a note either.
      return d("incomplete-scan", "error", "alert", "This report couldn't be completed",
        "This report read records but there were too many to finish checking, so the result " +
        "couldn't be proven complete and isn't shown. Narrow the report — add a filter or a " +
        "shorter date range — and run it again. Nothing was changed.");
    case "unrecognized-outcome": {
      // RPT-COMPAT, the Owner ruling's render half: a TRUTHFUL GENERIC BLOCKING
      // REFUSAL for a kind this build does not recognise.
      //
      // The hard constraint is what this copy MAY NOT ASSERT. The client received an
      // answer it cannot parse, so it does not know whether the population was read,
      // partially read, or never touched -- therefore the copy makes NO claim about
      // what was or wasn't found, in EITHER direction. It must not say "no records
      // matched" (that is the proven-absence claim), and it must not say "nothing was
      // read" (the unavailable/failure copy) -- both would be inventions.
      //
      // Error tone so ReportBuilder's ResultArea routes it to FailureState: blocking,
      // no rows table, and no EmptyState path. FailureState renders title+message and
      // DISCARDS notes, so everything load-bearing is in the message.
      //
      // The unrecognised kind string never reaches here (mapServiceOutcome drops it),
      // so there is nothing to leak.
      return d("unrecognized-outcome", "error", "alert", "This report's result couldn't be shown",
        "EOS received a result it doesn't recognise, so it isn't shown. This report can't tell you " +
        "what was or wasn't found. The app may be out of date with the reporting service — reload " +
        "and run it again, and tell an administrator if it keeps happening. Nothing was changed.");
    }
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
      // A run's outcome.kind picks ONE headline reason (Spec §12 -- the
      // service resolves "partially-authorized" ahead of "truncated-
      // widened" when both are true), but truncated/rowCap/widened
      // travel through on every outcome regardless of kind, so this
      // branch must read them too -- otherwise a run that is BOTH
      // partially-authorized AND truncated silently drops the
      // truncation signal (the reader would believe every row of the
      // narrowed result set is present, when it was also cut off).
      if (outcome.widened && !(preds > 0)) {
        notes.push("Some filters weren't applied, so this result is wider than the saved report.");
      }
      // RPT-CLIENT: the ORTHOGONAL axis, not only the coarse `truncated` OR. A
      // fixture (or a future payload) that states completeness "bounded-page" while
      // leaving `truncated` unset would otherwise lose the population cut entirely.
      if (outcome.truncated || populationWasCut(outcome)) {
        const cap = Number.isInteger(outcome.rowCap) ? outcome.rowCap : null;
        notes.push(cap
          ? `Showing the first ${cap.toLocaleString()} rows — this result was cut off and isn't complete.`
          : "This result was cut off and isn't complete.");
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
      if (outcome.truncated || populationWasCut(outcome)) {
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
