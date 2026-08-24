// STRUCTURED ABSENCE — the several different things an empty cell can mean.
//
// GOVERNANCE: docs/architecture/ADR-013-object-list-metadata-authority.md.
// Converged from the retired `domain/structuredFields.js` ABSENCE model (PRs #1439/#1443).
//
// ============================ THE RULE ============================
//
//     UNKNOWN IS NOT ZERO.   ZERO IS NOT ABSENCE.   AN ID IS NEVER A FALLBACK.
//
// A dash in a cell collapses at least five distinct facts, and a person acts differently on each:
//
//   NOT_RECORDED         nobody entered it. It could be entered.
//   NOT_AVAILABLE_TO_USER  it exists; this viewer may not see it. Not a data gap.
//   UNRESOLVED           a lookup did not answer. Nothing is known to be wrong.
//   UNKNOWN              the platform cannot currently determine it.
//   authoritative ZERO   we know, and the answer is none. NOT an absence at all.
//
// The two that cost money are the last two. `$0.00` says an order is worth nothing; a missing total
// says we do not know what it is worth. "0 available" sends a technician to an empty shelf certain;
// "not counted" sends them to look. A falsy check turns the second of each pair into the first, and
// the screen looks identical either way.
//
// ============================ WHY THIS IS NOT REFERENCE_STATE ============================
//
// `referenceResolution.js` models how a REFERENCE resolved — FOUND / NOT_FOUND / DENIED / LOADING /
// ERROR — and it is the right model for a pointer at another document. This is about a VALUE: a
// quantity, an amount, a date, a name typed into a field. A reference that resolved to nothing and a
// quantity nobody counted are different questions, and one enum wide enough for both would give
// neither surface the right words.
//
// They meet in exactly one place: `NOT_AVAILABLE_TO_USER` and `REFERENCE_STATE.DENIED` share the
// rule that the label must not leak what is being withheld.

/** Why a value is not shown. */
export const ABSENCE = Object.freeze({
  /** Nobody has recorded it. */
  NOT_RECORDED: "NOT_RECORDED",
  /** It exists, and this viewer may not read it. The label must not leak the value. */
  NOT_AVAILABLE_TO_USER: "NOT_AVAILABLE_TO_USER",
  /** A lookup ran and produced no answer. */
  UNRESOLVED: "UNRESOLVED",
  /** The platform cannot determine it — distinct from nobody having entered it. */
  UNKNOWN: "UNKNOWN",
});

/** What each absence says to a person. Plain words; no state names, no ids, no dashes. */
export const ABSENCE_TEXT = Object.freeze({
  [ABSENCE.NOT_RECORDED]: "Not recorded",
  [ABSENCE.NOT_AVAILABLE_TO_USER]: "Not available to your role",
  [ABSENCE.UNRESOLVED]: "Unavailable",
  [ABSENCE.UNKNOWN]: "Not known",
});

const isBlank = (v) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

/**
 * Is this a real, showable number?
 *
 * The whole point is the two exclusions. `0` IS present — the falsy check that treats it as missing
 * is the oldest bug in this codebase's list rendering. A numeric STRING is not: "1000" formats
 * identically to 1000 and sorts before "9", so accepting one lets a money column look right and
 * order wrongly.
 */
export function isPresentNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Resolve a value to either a present value or a named absence.
 *
 * @param value    the raw stored value.
 * @param absence  which ABSENCE applies when it is not present. Chosen by the CALLER, because only
 *                 the caller knows whether a missing figure was never entered, withheld, or
 *                 genuinely unknowable — and defaulting that choice is how everything becomes
 *                 NOT_RECORDED.
 * @param numeric  true for quantities and money: zero counts as present, a numeric string does not.
 */
export function resolveValue(value, { absence = ABSENCE.NOT_RECORDED, numeric = false } = {}) {
  const present = numeric ? isPresentNumber(value) : !isBlank(value);
  return Object.freeze({
    present,
    value: present ? value : null,
    absence: present ? null : absence,
    text: present ? null : ABSENCE_TEXT[absence] ?? ABSENCE_TEXT[ABSENCE.NOT_RECORDED],
  });
}

/**
 * What a cell renders for a value that may be absent.
 *
 * @param format applied ONLY to a present value, so a formatter can never turn null into "0" or
 *               "$0.00" — which is the failure this whole module exists to prevent, and which a
 *               formatter reached before the presence check will produce every time.
 */
export function displayValue(value, { absence = ABSENCE.NOT_RECORDED, numeric = false, format = null } = {}) {
  const resolved = resolveValue(value, { absence, numeric });
  if (!resolved.present) return resolved.text;
  return typeof format === "function" ? format(resolved.value) : String(resolved.value);
}
