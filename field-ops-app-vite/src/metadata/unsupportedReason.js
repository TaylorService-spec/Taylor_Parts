// WHY A FIELD CANNOT BE FILTERED OR SORTED — the canonical reason vocabulary.
//
// GOVERNANCE: docs/architecture/ADR-013-object-list-metadata-authority.md.
// Converged from the retired `domain/fieldMetadata.js` pilot (PRs #1442/#1443/#1444).
//
// ============================ THE GAP THIS CLOSES ============================
//
// `makeFieldDefinition` already distinguishes filterable/sortable from not, and §9's rule that a
// declared operator is a PROMISE is enforced against real indexes in CI. What it could not express
// was the other half: a field that is visible and cannot be queried says nothing about why.
//
// That silence is not neutral. "Sort by this" being absent means at least five different things:
//
//   NOT_PROJECTED       the value is not on this document. Fix = a projection.
//   DERIVED_AT_READ     computed when read; there is nothing stored to order by.
//   NO_CANONICAL_ORDER  a classification, not a sequence. Alphabetical would be a coincidence.
//   NEEDS_INDEX         Firestore could serve it, given an index nobody has declared.
//   NO_AUTHORITY        the platform does not hold this fact at all.
//
// A person reading a list cannot tell "not built yet" from "cannot be built", and neither can the
// next engineer. NOT_PROJECTED is a week of work; NO_AUTHORITY is a business decision. Collapsing
// them into a disabled control loses exactly the distinction that decides what to do next.
//
// ============================ NOT A SECOND AUTHORITY ============================
//
// This vocabulary EXPLAINS a `filterable: false`. It never creates one, never overrides one, and
// nothing here is consulted when building a query descriptor — `listRuntime.buildQueryDescriptor`
// still refuses anything the definition did not declare, exactly as before. A reason is presentation
// and governance data, not a gate.

/** Why a declared field cannot be filtered or sorted. */
export const UNSUPPORTED_REASON = Object.freeze({
  /** Stored somewhere, but not on this document. The fix is a projection, not a decision. */
  NOT_PROJECTED: "NOT_PROJECTED",
  /** Computed at read time. There is no stored value to order or compare against. */
  DERIVED_AT_READ: "DERIVED_AT_READ",
  /** A classification rather than a sequence — ordering it would invent meaning. */
  NO_CANONICAL_ORDER: "NO_CANONICAL_ORDER",
  /** Firestore could serve this, given a composite index the repository has not declared. */
  NEEDS_INDEX: "NEEDS_INDEX",
  /** The platform does not hold this fact. Not missing data — a missing field. */
  NO_AUTHORITY: "NO_AUTHORITY",
  /** Reading it requires a capability this viewer does not hold. */
  NOT_AUTHORIZED: "NOT_AUTHORIZED",
});

/**
 * What each reason says to a person.
 *
 * Business words. Nobody outside this file should ever read `NO_CANONICAL_ORDER` on a screen, and
 * nobody should have to guess what it meant.
 */
export const UNSUPPORTED_TEXT = Object.freeze({
  [UNSUPPORTED_REASON.NOT_PROJECTED]:
    "This value lives on another record, so it can be shown but not searched or ordered here.",
  [UNSUPPORTED_REASON.DERIVED_AT_READ]:
    "This is calculated when the record is opened, so there is nothing stored to sort or filter by.",
  [UNSUPPORTED_REASON.NO_CANONICAL_ORDER]:
    "These are different kinds of thing rather than steps in a sequence, so there is no order to sort by.",
  [UNSUPPORTED_REASON.NEEDS_INDEX]:
    "Searching this needs an index that has not been set up yet.",
  [UNSUPPORTED_REASON.NO_AUTHORITY]:
    "The system does not record this yet, so there is nothing to search or sort.",
  [UNSUPPORTED_REASON.NOT_AUTHORIZED]:
    "Not available to your role.",
});

const REASONS = Object.freeze(Object.values(UNSUPPORTED_REASON));

/** True when `reason` is one this vocabulary knows. */
export function isUnsupportedReason(reason) {
  return REASONS.includes(reason);
}

/**
 * Explain why a field cannot do something.
 *
 * @param field FieldDefinition
 * @param kind  "filter" | "sort"
 * @returns a sentence, or null when the field CAN do it (so a caller renders nothing).
 *
 * An unexplained refusal returns the honest fallback rather than an empty string — a blank
 * explanation reads as "no reason", which is a stronger claim than "nobody recorded one".
 */
export function unsupportedExplanation(field, kind = "filter") {
  if (!field) return null;
  if (kind === "filter" && field.filterable) return null;
  if (kind === "sort" && field.sortable) return null;
  const reason = kind === "sort" ? field.unsupportedSortReason : field.unsupportedFilterReason;
  return UNSUPPORTED_TEXT[reason] ?? "This cannot be used here yet, and no reason has been recorded.";
}
