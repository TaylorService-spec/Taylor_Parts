// Bounded Account NAME search — pure query-shape + read-interpretation.
//
// GOVERNANCE: docs/governance/metadata-architecture-ip-boundary.md §9. Same
// bound-and-disclose shape as src/domain/pickerSource.js, which solved this problem for
// the picker read; this module deliberately does not touch that one — a picker narrows a
// dropdown, this is the /customers list's own search box, and distorting pickerSource's
// contract to serve both would have coupled two things that only look similar.
//
// WHY THIS EXISTS. /customers used to carry a GlobalSearch box (src/shared/search/
// searchProviders.js `accounts` provider) that filtered an in-memory array the caller
// supplied from a whole-collection subscription. AccountsList.jsx's migration onto the
// bounded metadata list runtime removed that subscription — correctly, per §9 — which
// would have left the search box filtering only whatever fifty rows happened to be on the
// current page. A search box that silently searches a subset and calls it "no results" is
// worse than no search box, so it was removed rather than left to lie (see
// AccountsList.jsx's "GLOBAL SEARCH REMOVED, DELIBERATELY" comment history). This is the
// governed replacement: a real, bounded Firestore query, not a client-side filter over
// whatever happens to already be loaded.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT KIND OF SEARCH THIS IS — DECIDED DELIBERATELY, NOT BY ACCIDENT
//
// Firestore has no substring or full-text index. The only honest primitive available on
// an indexed string field is a PREFIX range: `name >= term AND name <= term + ''`.
// That is what this module builds, and nothing more:
//
//   - It matches names that START WITH the typed text, not names that CONTAIN it. "corp"
//     will not find "Anchor Corp". Every user-facing string this module produces says
//     "starts with", never "search" or "contains" unqualified, so the UI cannot present a
//     prefix match as something broader than it is.
//   - It is CASE-SENSITIVE. Firestore's range comparison is a literal UTF-16 code-unit
//     comparison, not a locale-aware or case-folded one. "acme" will not match "Acme Corp"
//     stored with a capital A. Faking case-insensitivity would need a normalized/lower-
//     cased search field on the Account document — a schema and backfill change to the
//     WRITE path, not this read, and out of this lane's scope — or a real full-text index,
//     which is backend infrastructure this repo does not have. Neither is built here;
//     both are named so the gap is recorded rather than silently worked around with a
//     client trick (e.g. issuing one query per capitalization guess) that would look like
//     search but only work by coincidence.
//
// This needs NO composite index. It is a single range filter on the same field the
// results are ordered by (`name`), which Firestore serves from the automatic single-field
// index every indexed field already has — nothing to declare in firestore.indexes.json.
//
// ─────────────────────────────────────────────────────────────────────────────
// BOUNDED, LIKE EVERY OTHER LIST READ IN THIS PROGRAM
//
// `cap + 1` is read so truncation is DETECTED, not assumed — the same convention as
// pickerSource.js and the metadata list runtime (listRuntime.js). A capped result set says
// so and tells the reader to narrow further, rather than presenting the first N matches as
// though they were all of them.

/**
 * Cap for a single search read.
 *
 * Smaller than PICKER_READ_CAP (200) on purpose: a picker narrows toward "pick one" and
 * tolerates a generous cap because it still has to cover browsing. A name-prefix search is
 * already narrowing — by definition every result shares the typed prefix — so a result set
 * this large means the search needs more characters, not a bigger page.
 */
export const ACCOUNT_SEARCH_CAP = 25;

/**
 * How an Account search turned out. Distinct states, never collapsed into "empty":
 *   IDLE        — no term typed yet; this module issued no query.
 *   LOADING     — a query is in flight.
 *   READY       — every match is present.
 *   TRUNCATED   — more matches exist than the cap; the cap was hit, not the truth.
 *   EMPTY       — the query ran and genuinely found nothing.
 *   DENIED      — the read was rejected by Rules. Not "no matches" — the search never ran.
 *   UNAVAILABLE — the read failed for a reason other than denial (offline, backend error).
 */
export const ACCOUNT_SEARCH_STATE = Object.freeze([
  "IDLE",
  "LOADING",
  "READY",
  "TRUNCATED",
  "EMPTY",
  "DENIED",
  "UNAVAILABLE",
]);

/**
 * The Firestore-independent shape of an Account name-prefix search.
 *
 * Returned as a descriptor rather than executed here, so the bound and the prefix logic
 * are assertable offline — the same reason pickerSource.js and listRuntime.js are pure.
 * Returns null for a blank/whitespace-only term: an unfiltered name-ordered read of the
 * whole collection is not a "search", it is the picker or list read this module
 * deliberately does not duplicate, so no query is built for one.
 */
export function accountSearchQueryShape({ term, collection = "accounts", cap = ACCOUNT_SEARCH_CAP } = {}) {
  const normalized = (term ?? "").trim();
  if (!normalized) return null;
  return Object.freeze({
    collection,
    fieldPath: "name",
    // The high-codepoint sentinel is the standard Firestore prefix-range upper bound: any
    // string starting with `normalized` sorts at or below `normalized + ''`.
    start: normalized,
    end: `${normalized}`,
    orderBy: Object.freeze([{ fieldPath: "name", direction: "ASC" }]),
    // cap + 1: the extra row is the truncation probe, mirroring pickerQueryShape and the
    // metadata list runtime's own +1 convention.
    limit: cap + 1,
    cap,
    term: normalized,
  });
}

/**
 * Interpret a fetched Account search read.
 *
 * `docs` is the raw result of a cap+1 read (or null/undefined if nothing has been fetched
 * yet, or the read failed). Mirrors interpretPickerRead's shape and reasoning, with two
 * differences a search box needs that a picker does not: an IDLE state for "nothing typed
 * yet" (a picker always has something to show; a search box before any input has nothing
 * to say), and DENIED kept distinct from UNAVAILABLE (permission-denied means the search
 * will never succeed no matter how many times it retries; every other failure might).
 */
export function interpretAccountSearchRead({ term, docs = null, loading = false, error = null, cap = ACCOUNT_SEARCH_CAP } = {}) {
  const normalized = (term ?? "").trim();

  if (!normalized) {
    return Object.freeze({ state: "IDLE", results: Object.freeze([]), truncated: false, message: null });
  }
  if (loading) {
    return Object.freeze({ state: "LOADING", results: Object.freeze([]), truncated: false, message: null });
  }
  if (error) {
    const denied = error?.code === "permission-denied";
    return Object.freeze({
      state: denied ? "DENIED" : "UNAVAILABLE",
      results: Object.freeze([]),
      truncated: false,
      message: denied
        ? "You don't have access to search customers."
        : "Customer search could not be completed. Try again.",
    });
  }
  if (!Array.isArray(docs)) {
    return Object.freeze({
      state: "UNAVAILABLE",
      results: Object.freeze([]),
      truncated: false,
      // Not "no matches". Nothing having been fetched is a different fact from a search
      // that ran and found nothing — only one of them means the customer doesn't exist.
      message: "Customer search could not be completed. Try again.",
    });
  }

  const truncated = docs.length > cap;
  const results = truncated ? docs.slice(0, cap) : docs;

  if (results.length === 0) {
    return Object.freeze({
      state: "EMPTY",
      results: Object.freeze([]),
      truncated: false,
      message: `No customer names start with "${normalized}".`,
    });
  }
  if (truncated) {
    return Object.freeze({
      state: "TRUNCATED",
      results: Object.freeze(results),
      truncated: true,
      // Says what is true (a bound was hit) AND what to do (type more), same as
      // pickerSource.js's truncation message.
      message: `Showing the first ${cap} customer names starting with "${normalized}". Type more to narrow it further.`,
    });
  }
  return Object.freeze({ state: "READY", results: Object.freeze(results), truncated: false, message: null });
}
