// Bounded picker reads — pure semantics.
//
// GOVERNANCE: docs/governance/metadata-architecture-ip-boundary.md §9.
//
// A PICKER IS NOT A LIST, and treating it as one is what produced the defect this
// fixes. Three surfaces — the Work Order wizard, the Opportunity form, and Equipment
// Register — load the ENTIRE accounts collection to populate a dropdown. At Taylor's
// current two accounts that is invisible. At 250k it is a quarter of a million document
// reads to let someone choose one.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS BOUNDS AND DISCLOSES RATHER THAN REDESIGNING
//
// The eventual correct answer at enterprise volume is a search-first picker: you type,
// it queries, you choose. That is a real UX change — it removes the ability to browse
// every account — and a governance rule about read shape does not authorize a product
// decision about how people select things.
//
// So this does the part that is unambiguously mandated and behaviour-preserving at
// current scale: cap the read, and TELL THE TRUTH when the cap is hit. Below the cap
// every consumer behaves exactly as before. Above it, the picker says so instead of
// silently offering a subset the user would read as "all".
//
// The silent-subset failure is the one worth naming: a dropdown that quietly shows the
// first N of 250k looks identical to a dropdown showing everything, so a user searching
// for a customer that exists concludes it does not. Bounding without disclosing would
// convert a performance defect into a correctness one.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cap for picker reads.
 *
 * Generous on purpose: high enough that no realistic current dataset is truncated, so
 * this change is behaviour-preserving today; low enough that it is a bound rather than
 * a gesture. It is not a page size — a picker does not page, it narrows.
 */
export const PICKER_READ_CAP = 200;

/** How a picker read turned out. Distinct states, never collapsed into "empty". */
export const PICKER_STATE = Object.freeze(["LOADING", "READY", "TRUNCATED", "EMPTY", "UNAVAILABLE"]);

/**
 * Interpret a picker read.
 *
 * `docs` is the raw result of a cap+1 read. The extra row is the probe: its presence
 * means more exist, and it is dropped rather than offered — an off-by-one in a picker
 * shows a choice the caller never intended to include.
 */
export function interpretPickerRead({ docs = null, loading = false, error = null, cap = PICKER_READ_CAP } = {}) {
  if (loading) return Object.freeze({ state: "LOADING", options: Object.freeze([]), truncated: false, message: null });
  if (error) {
    return Object.freeze({
      state: "UNAVAILABLE",
      options: Object.freeze([]),
      truncated: false,
      // Not "no accounts". A failed read and an empty collection are different facts,
      // and only one of them means the user should stop looking.
      message: "Customers could not be loaded. Try again.",
    });
  }
  if (!Array.isArray(docs)) {
    return Object.freeze({ state: "UNAVAILABLE", options: Object.freeze([]), truncated: false, message: "Customers could not be loaded. Try again." });
  }

  const truncated = docs.length > cap;
  const options = truncated ? docs.slice(0, cap) : docs;

  if (options.length === 0) {
    return Object.freeze({ state: "EMPTY", options: Object.freeze([]), truncated: false, message: "No customers yet." });
  }
  if (truncated) {
    return Object.freeze({
      state: "TRUNCATED",
      options: Object.freeze(options),
      truncated: true,
      // Says what is true AND what to do. A truncation notice with no next step just
      // tells someone their tool is inadequate.
      message: `Showing the first ${cap} customers. Search to narrow the list.`,
    });
  }
  return Object.freeze({ state: "READY", options: Object.freeze(options), truncated: false, message: null });
}

/**
 * The read shape a picker should issue.
 *
 * Returned as a descriptor rather than executed here, so the bound is assertable
 * offline — the same reason the metadata list runtime is a pure module. cap+1 mirrors
 * the truncation-probe convention already used by the trusted callables, so client and
 * server disclose "there is more" the same way.
 */
export function pickerQueryShape({ collection, orderByField = "name", cap = PICKER_READ_CAP } = {}) {
  return Object.freeze({
    collection,
    orderBy: Object.freeze([{ fieldPath: orderByField, direction: "ASC" }]),
    limit: cap + 1,
    cap,
  });
}
