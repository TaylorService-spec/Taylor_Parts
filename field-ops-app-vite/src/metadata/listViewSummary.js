// WHAT A LIST IS CURRENTLY SHOWING, IN WORDS.
//
// Pure, so the wording is assertable without rendering anything — the same reason listUrlState.js
// and listRuntime.js are pure. ListViewHeader.jsx renders what this returns and decides nothing.
//
// ════════════════════ DIRECTION IS DESCRIBED IN THE FIELD'S OWN TERMS ════════════════════
//
// "Descending" is accurate and tells a reader nothing. What somebody wants to know about a date
// column is whether the newest or the oldest is on top, and about money whether the biggest is.
// The word therefore comes from the field TYPE, not from the direction token.
//
// ENUM is the one that has to be careful. Firestore orders an enum by its STORED value, so the
// result is alphabetical by machine value — which usefully groups every ACTIVE together, and is
// NOT the lifecycle order the labels imply. Calling it "A to Z" would promise the alphabet of the
// labels; calling it "first to last" would promise the lifecycle. Neither is what happens, so it
// says "grouped", which is what the reader actually gets.

/** Human phrase for a sort, or null when nothing is sorted. */
export function describeSort(entity, sort) {
  const first = sort?.[0];
  if (!first) return null;
  const field = entity?.fields?.find((f) => f.id === first.fieldId);
  const label = field?.label ?? first.fieldId;
  const desc = first.direction === "DESC";
  switch (field?.type) {
    case "TIMESTAMP":
    case "DATE":
      return `${label} (${desc ? "newest first" : "oldest first"})`;
    case "NUMBER":
    case "CURRENCY_MINOR":
      return `${label} (${desc ? "highest first" : "lowest first"})`;
    case "ENUM":
      return `${label} (grouped)`;
    default:
      return `${label} (${desc ? "Z to A" : "A to Z"})`;
  }
}

/**
 * The FIELD NAMES currently narrowing a list, de-duplicated, or null when nothing is.
 *
 * Names, not values: the chips below the header already render the values through
 * describeCriterion, and repeating them turns a summary into an echo. A criterion whose field this
 * build no longer declares falls back to its id rather than being dropped — a filter that is in
 * effect must never be missing from the summary of what is in effect.
 */
export function describeFilteredBy(entity, filters) {
  const applied = filters ?? [];
  if (applied.length === 0) return null;
  const names = applied.map((c) => entity?.fields?.find((f) => f.id === c.fieldId)?.label ?? c.fieldId);
  return [...new Set(names)].join(", ");
}

/**
 * The one-line summary: "31 items · Sorted by Created (newest first) · Filtered by Status".
 *
 * `total` is a claim about the WHOLE filtered set and must come from a real aggregate read. A count
 * derived from loaded rows would be wrong in the reassuring direction — it would read as the total
 * while being one screenful — so null means "not counted" and renders nothing at all. NOT zero:
 * "0 items" is a statement about the business, silence is a statement about the read, and they are
 * not interchangeable.
 */
export function summarizeListView({ entity, criteria, defaultSort = null, total = null } = {}) {
  const sort = criteria?.sort?.length ? criteria.sort : defaultSort;
  const parts = [
    total === null || total === undefined ? null : `${total} ${total === 1 ? "item" : "items"}`,
    describeSort(entity, sort) ? `Sorted by ${describeSort(entity, sort)}` : null,
    describeFilteredBy(entity, criteria?.filters) ? `Filtered by ${describeFilteredBy(entity, criteria?.filters)}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/**
 * The saved views a person may actually pick.
 *
 * RECENTLY_VIEWED is EXCLUDED. It needs a per-user history this platform does not keep, so
 * offering it would put a control in the menu that silently behaves like "everything" — a control
 * that lies is worse than one that is absent.
 */
export function selectableSavedViews(def) {
  return (def?.savedViews ?? []).filter((v) => v.kind !== "RECENTLY_VIEWED");
}
