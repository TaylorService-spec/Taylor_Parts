// Bounded Work Order REFERENCE search — pure query-shape + read-interpretation.
//
// GOVERNANCE: docs/governance/metadata-architecture-ip-boundary.md §9.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS EXISTS: LIST PAGE ≠ SEARCH CORPUS
//
// The Work Orders screen used to hold an unfiltered `onSnapshot` over the entire
// collection, and handed that array to GlobalSearch's `workOrders` provider, which is a
// client-side filter over whatever the caller already loaded. So search worked, and it
// worked for exactly one reason: the screen had downloaded every Work Order in the
// business.
//
// Moving the list onto bounded paging removes that array. Leaving the old provider in
// place would leave a search box filtering the FIFTY ROWS on the current page and saying
// "no results" for a Work Order that plainly exists — which is worse than no search box,
// because it answers confidently. Accounts hit this exact wall first and solved it with a
// real bounded query (domain/accountSearch.js); this is the same solution for a record
// whose identity is a reference number rather than a name.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT KIND OF SEARCH THIS IS
//
// A PREFIX range over `woNumber`, and nothing more.
//
//   - Work Order numbers are machine-generated in ONE format: `WO-YYYY-######`
//     (functions/src/woNumbering.ts, six-digit zero-padded, allocated inside the same
//     transaction that writes the document). The format is closed, which is what makes a
//     prefix range honest here — the field has no free text in it to miss.
//   - Because that format is uppercase by construction, the term is folded UP rather than
//     down. Accounts needed a stored `nameLower` because customer names are typed by
//     people; a Work Order number is not, so there is nothing to denormalize and no
//     writer to keep in step. Folding the term is enough, and it means `wo-2026` finds
//     `WO-2026-000001` the way anyone would expect.
//   - It matches numbers that START WITH the typed text. `000123` finds nothing; the full
//     `WO-2026-000123` finds one. Every user-facing string below says "starts with".
//
// NO COMPOSITE INDEX. A single range filter on the same field the results are ordered by,
// served by the automatic single-field index Firestore maintains for every indexed field.
// Nothing to declare, and therefore nothing that can be missing at read time.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT THIS DOES NOT DO — recorded, not glossed
//
// It searches the NUMBER. It does not search customer name, type, or complaint text
// across the collection, and it does not pretend to: WORK_ORDER_TEXT_SEARCH_GAP on the
// entity says so with the reason. Customer name is the same wall
// CUSTOMER_NAME_NOT_SORTABLE_ON_RELATED_LISTS already describes — no operational document
// carries a customer name, so there is no field to range over. Substring and full-text
// need a text index this repo does not have.

/** Cap for a single search read. See ACCOUNT_SEARCH_CAP for why a search cap is small. */
export const WORK_ORDER_SEARCH_CAP = 25;

/**
 * How a Work Order search turned out. Same distinct states as the Account search, for the
 * same reason: "found nothing" and "never ran" are different facts about the business.
 */
export const WORK_ORDER_SEARCH_STATE = Object.freeze([
  "IDLE", "LOADING", "READY", "TRUNCATED", "EMPTY", "DENIED", "UNAVAILABLE",
]);

/**
 * Fold a typed term to the stored Work Order number convention.
 *
 * Uppercase and whitespace-trimmed. Exported because the interpreter and the query shape
 * must agree about what folding means — the one way this design fails silently is if the
 * two sides normalize differently.
 */
export function normalizeWorkOrderTerm(term) {
  return (term ?? "").trim().toUpperCase();
}

/**
 * The Firestore-independent shape of a Work Order number-prefix search.
 *
 * A descriptor rather than an executed query, so the bound and the prefix logic are
 * assertable offline. Returns null for a blank term: an unfiltered read of the whole
 * collection is not a search, it is the thing this module exists to stop.
 */
export function workOrderSearchQueryShape({ term, collection, cap = WORK_ORDER_SEARCH_CAP } = {}) {
  const normalized = normalizeWorkOrderTerm(term);
  if (!normalized) return null;
  if (!collection) throw new Error("workOrderSearchQueryShape requires the collection to read");
  return Object.freeze({
    collection,
    fieldPath: "woNumber",
    start: normalized,
    // The standard Firestore prefix upper bound: any string starting with `normalized`
    // sorts at or below it plus the highest code point.
    end: `${normalized}`,
    orderBy: Object.freeze([{ fieldPath: "woNumber", direction: "ASC" }]),
    // cap + 1 is the truncation PROBE, not a bigger page: it is how truncation is
    // detected rather than assumed.
    limit: cap + 1,
    cap,
    term: normalized,
  });
}

/**
 * Interpret a fetched Work Order search read.
 *
 * `docs` is the raw result of a cap+1 read, or null when nothing was fetched — which is
 * deliberately NOT the same as an empty array, so a failed read can never be reported
 * downstream as a search that ran and found nothing.
 */
export function interpretWorkOrderSearchRead({ term, docs = null, loading = false, error = null, cap = WORK_ORDER_SEARCH_CAP } = {}) {
  const normalized = normalizeWorkOrderTerm(term);

  if (!normalized) return Object.freeze({ state: "IDLE", results: Object.freeze([]), truncated: false, message: null });
  if (loading) return Object.freeze({ state: "LOADING", results: Object.freeze([]), truncated: false, message: null });

  if (error) {
    // A technician can only read Work Orders assigned to them, so denial is an ordinary
    // outcome here rather than an exceptional one — and it must never read as "no match".
    const denied = error?.code === "permission-denied";
    return Object.freeze({
      state: denied ? "DENIED" : "UNAVAILABLE",
      results: Object.freeze([]),
      truncated: false,
      message: denied
        ? "You don't have access to search work orders."
        : "Work order search could not be completed. Try again.",
    });
  }
  if (!Array.isArray(docs)) {
    return Object.freeze({
      state: "UNAVAILABLE",
      results: Object.freeze([]),
      truncated: false,
      message: "Work order search could not be completed. Try again.",
    });
  }

  const truncated = docs.length > cap;
  const results = truncated ? docs.slice(0, cap) : docs;

  if (results.length === 0) {
    return Object.freeze({
      state: "EMPTY",
      results: Object.freeze([]),
      truncated: false,
      message: `No work order numbers start with "${normalized}".`,
    });
  }
  if (truncated) {
    return Object.freeze({
      state: "TRUNCATED",
      results: Object.freeze(results),
      truncated: true,
      message: `Showing the first ${cap} work order numbers starting with "${normalized}". Type more to narrow it further.`,
    });
  }
  return Object.freeze({ state: "READY", results: Object.freeze(results), truncated: false, message: null });
}
