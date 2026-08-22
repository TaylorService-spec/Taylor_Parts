// THE ONE DEFINITION OF A SEARCHABLE NAME.
//
// ============================ WHY A DERIVED FIELD EXISTS AT ALL ============================
//
// Firestore has no case-insensitive comparison. A range query is a literal UTF-16 code-unit
// comparison, so `name >= "mesquite"` never matches "Mesquite Soda Works" -- every uppercase letter
// sorts before every lowercase one. Typing "mesquite" returned "No customer names start with
// 'mesquite'" while Mesquite Soda Works sat six rows below it on the same screen.
//
// The only honest fix is to store a normalized copy of the name and query THAT. There is no client
// trick that produces case-insensitivity from a case-sensitive index -- issuing one query per
// capitalization guess would look like search and work only by coincidence.
//
// ============================ WHY IT LIVES HERE ============================
//
// A derived field is a promise that it is maintained EVERYWHERE the source field is written. The
// moment two call sites normalize differently -- one trims, one does not; one lowercases with a
// locale, one without -- records become silently unfindable, and the failure looks like "search is
// flaky" rather than like a bug with a cause.
//
// So there is exactly one function, in the domain layer, and both the browser write paths and the
// Node-side seeder/backfill tools import THIS module rather than reimplementing two characters of
// string handling. It is deliberately dependency-free so Node can load it directly.
//
// ============================ WHAT NORMALIZATION MEANS HERE ============================
//
// Lowercase and trim. Nothing else, and the restraint is deliberate:
//
//   * `toLowerCase()`, NOT `toLocaleLowerCase()`. A locale-aware fold is not deterministic across
//     runtimes -- Turkish maps "I" to a dotless lowercase -- and a value written by the browser must
//     byte-match one written by a Node backfill or the record becomes unfindable. Determinism
//     outranks linguistic correctness for a key that two different runtimes must agree on.
//
//   * No accent folding, no punctuation stripping, no collapsing of internal whitespace. Each would
//     widen what "starts with" means, and the search contract is a PREFIX RANGE -- the UI says
//     "starts with" and must not quietly start meaning something broader. Those are real features;
//     they are not this one, and adding them here would change search semantics as a side effect of
//     a casing fix.
//
// Leading/trailing whitespace IS removed, because it is never meaningful and a stray leading space
// would push a record out of every prefix range it should match.

/**
 * The searchable form of a customer name.
 *
 * Returns "" for absent/blank/non-string input rather than null or undefined: the value is written
 * to a Firestore field that queries ORDER BY, and Firestore silently excludes documents missing the
 * ordered field. Returning a sentinel that callers might skip writing would reintroduce exactly the
 * invisibility this field exists to fix -- an empty string is present, sorts first, and is honest
 * about there being no name to match.
 */
export function normalizeNameForSearch(name) {
  if (typeof name !== "string") return "";
  return name.trim().toLowerCase();
}

/** Field name of the derived value, so no call site spells it as a bare string literal. */
export const SEARCH_NAME_FIELD = "nameLower";

/**
 * The stored shape for a record whose `name` is searchable.
 *
 * Call sites spread this rather than assigning the two fields by hand, so a writer cannot set the
 * name and forget the derived copy -- the pairing is what the structural writer test enforces.
 */
export function withSearchableName(name) {
  return { name, [SEARCH_NAME_FIELD]: normalizeNameForSearch(name) };
}
