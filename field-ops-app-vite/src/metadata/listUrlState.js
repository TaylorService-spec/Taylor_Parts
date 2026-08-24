// LIST CRITERIA IN THE URL — and what happens when a URL asks for something this build cannot do.
//
// GOVERNANCE: docs/architecture/ADR-013-object-list-metadata-authority.md.
// Converged from the retired `domain/listQueryState.js` pilot (PR #1442).
//
// ============================ WHY THE URL ============================
//
// A list without URL state loses a person's work at the worst moment. They narrow 250,000 accounts
// to the eleven they care about, open one, come back — and the list is unfiltered again. They cannot
// send the narrowed view to a colleague, cannot bookmark it, cannot get back to it tomorrow. The
// criteria existed only inside a component that has since unmounted.
//
// The metadata runtime had no URL state at all before this: no `useSearchParams` anywhere under
// src/metadata/. That is the single largest thing the pilot architecture had that this one did not,
// and it is why it is the first thing converged.
//
// ============================ DROPPED CRITERIA ARE REPORTED ============================
//
// A URL is user-editable, outlives deploys, and gets pasted into chat. So it will eventually ask for
// a field that has been removed, an operator that has been narrowed, or a filter whose index was
// withdrawn. The list must still render — refusing to load because a bookmark is six months old is
// its own failure.
//
// But degrading SAFELY and degrading QUIETLY are different things, and the quiet version is the one
// that misleads. Dropping `name contains valve` in silence renders the WHOLE collection with no
// chip and no explanation, and the person who followed that link reads it as the filtered subset.
// The narrowing they asked for silently became no narrowing at all — the failure runs in the
// direction of showing MORE than was requested, which is exactly the direction nobody checks.
//
// So every rejected entry comes back in `dropped`, carrying the reason the metadata gave, and the
// list says it is broader than the link asked for.
//
// ============================ THIS DECIDES NOTHING ============================
//
// §6 holds: nothing here evaluates a capability. `hasCapability` is asked, never computed, and a
// resolver that throws denies — an exception must not become access. And a criterion that survives
// this module is still re-checked by `buildQueryDescriptor`, which remains the only thing that
// decides what a query may contain. This is a PARSER, and a strict one, not a second gate.

import { findField } from "./entityDefinition.js";
import { UNSUPPORTED_TEXT } from "./unsupportedReason.js";

/** Why a criterion in the URL could not be applied. */
export const DROP_REASON = Object.freeze({
  /** The entity has no such field. A link from an older build, or a hand-edited address. */
  UNKNOWN_FIELD: "UNKNOWN_FIELD",
  /** The field exists; this list does not offer a filter on it. */
  NOT_OFFERED: "NOT_OFFERED",
  /** The field is filterable, but not by this operator. */
  OPERATOR_NOT_ALLOWED: "OPERATOR_NOT_ALLOWED",
  /** The field cannot be filtered or sorted at all — carries the field's own UNSUPPORTED_REASON. */
  UNSUPPORTED: "UNSUPPORTED",
  /** Reading the field requires a capability this viewer does not hold. */
  NOT_AUTHORIZED: "NOT_AUTHORIZED",
  /** The record could not be parsed, or its value is unusable. */
  MALFORMED: "MALFORMED",
});

/** What each drop says to a person. No field ids, no operator tokens, no state names. */
export const DROP_TEXT = Object.freeze({
  [DROP_REASON.UNKNOWN_FIELD]: "is no longer available",
  [DROP_REASON.NOT_OFFERED]: "cannot be filtered on this list",
  [DROP_REASON.OPERATOR_NOT_ALLOWED]: "cannot be compared that way",
  [DROP_REASON.UNSUPPORTED]: "cannot be searched or sorted here",
  // Says nothing about the value, deliberately — the point is that this viewer is not entitled to it.
  [DROP_REASON.NOT_AUTHORIZED]: "is not available to your role",
  [DROP_REASON.MALFORMED]: "could not be read from the link",
});

const PARAM = Object.freeze({ FILTER: "f", SORT: "sort", SEARCH: "q", VIEW: "view" });

/** Empty criteria. Frozen and shared — a list with no criteria is always the same thing. */
export const EMPTY_CRITERIA = Object.freeze({
  filters: Object.freeze([]),
  sort: Object.freeze([]),
  search: "",
  view: null,
  dropped: Object.freeze([]),
});

/** One filter criterion. */
export function makeCriterion({ fieldId, operator, value = null, valueLabel = null } = {}) {
  return Object.freeze({ fieldId, operator, value, valueLabel });
}

/**
 * Write criteria into URL search params.
 *
 * @param existing the current query string, so unrelated params (a tab, a scroll anchor) survive.
 *
 * The value is encoded LAST in each record and percent-encoded, so a colon inside a value — which
 * customer names and part numbers both contain — cannot split the record it lives in.
 *
 * The CURSOR IS NEVER WRITTEN. A bookmarked page-3 cursor is meaningless once the underlying data
 * moves, and restoring it would show a stranger somebody else's arbitrary window into the list.
 * Criteria are shareable; a position within a paged read is not.
 */
export function toSearchParams(criteria, existing = null) {
  const params = new URLSearchParams(existing ?? "");
  for (const key of Object.values(PARAM)) params.delete(key);

  for (const c of criteria?.filters ?? []) {
    const value = c.value === null || c.value === undefined ? "" : String(c.value);
    params.append(PARAM.FILTER, `${c.fieldId}:${c.operator}:${encodeURIComponent(value)}`);
  }
  for (const s of criteria?.sort ?? []) {
    params.append(PARAM.SORT, `${s.fieldId}:${s.direction === "DESC" ? "DESC" : "ASC"}`);
  }
  if (criteria?.search) params.set(PARAM.SEARCH, criteria.search);
  if (criteria?.view) params.set(PARAM.VIEW, criteria.view);
  return params;
}

/**
 * Read criteria back out of a URL, against what this build actually offers.
 *
 * @param def            ListViewDefinition — what this LIST offers.
 * @param entity         EntityDefinition — what the OBJECT has.
 * @param hasCapability  optional (capabilityId) => boolean. Asked, never computed; a throw denies.
 *
 * Returns `{ filters, sort, search, view, dropped }`. Never throws: a malformed URL is a thing that
 * happens, not an error condition.
 */
export function fromSearchParams(search, def, entity, { hasCapability = null } = {}) {
  const params = new URLSearchParams(search ?? "");
  const dropped = [];
  const declared = new Map((def?.filters ?? []).map((f) => [f.fieldId, f]));

  const holds = (capability) => {
    if (!capability) return true;
    // A resolver that throws DENIES. An exception must never widen access, and "we could not tell"
    // is not the same claim as "allowed".
    try {
      return typeof hasCapability === "function" && hasCapability(capability) === true;
    } catch {
      return false;
    }
  };

  // `reason` is always a DROP_REASON — what went wrong at the URL. `detail` is the field's own
  // UNSUPPORTED_REASON when it has one, which is what turns "cannot be searched here" into "lives on
  // another record" or "needs an index". Two levels, because the reader needs both: what happened,
  // and what would fix it.
  const drop = (kind, fieldId, field, reason, detail = null) => {
    dropped.push(Object.freeze({
      kind, fieldId, reason, detail,
      // The LABEL is what a person sees. Falling back to the field id is the honest last resort for
      // a field this build no longer knows — there is nothing else to call it.
      label: field?.label ?? fieldId,
    }));
  };

  const filters = [];
  for (const raw of params.getAll(PARAM.FILTER)) {
    const first = raw.indexOf(":");
    const second = raw.indexOf(":", first + 1);
    if (first < 0 || second < 0) {
      drop("filter", raw.slice(0, 40), null, DROP_REASON.MALFORMED);
      continue;
    }
    const fieldId = raw.slice(0, first);
    const operator = raw.slice(first + 1, second);
    let value;
    try {
      value = decodeURIComponent(raw.slice(second + 1));
    } catch {
      drop("filter", fieldId, findField(entity, fieldId), DROP_REASON.MALFORMED);
      continue;
    }

    const field = findField(entity, fieldId);
    if (!field) { drop("filter", fieldId, null, DROP_REASON.UNKNOWN_FIELD); continue; }
    if (!holds(field.readCapability)) { drop("filter", fieldId, field, DROP_REASON.NOT_AUTHORIZED); continue; }
    if (!field.filterable) {
      drop("filter", fieldId, field, DROP_REASON.UNSUPPORTED, field.unsupportedFilterReason);
      continue;
    }
    const offered = declared.get(fieldId);
    if (!offered) { drop("filter", fieldId, field, DROP_REASON.NOT_OFFERED); continue; }
    if (!offered.operators.includes(operator)) {
      drop("filter", fieldId, field, DROP_REASON.OPERATOR_NOT_ALLOWED);
      continue;
    }
    filters.push(makeCriterion({ fieldId, operator, value: value === "" ? null : value }));
  }

  const sort = [];
  for (const raw of params.getAll(PARAM.SORT)) {
    const [fieldId, direction] = String(raw).split(":");
    if (direction !== "ASC" && direction !== "DESC") {
      drop("sort", fieldId, findField(entity, fieldId), DROP_REASON.MALFORMED);
      continue;
    }
    const field = findField(entity, fieldId);
    if (!field) { drop("sort", fieldId, null, DROP_REASON.UNKNOWN_FIELD); continue; }
    if (!holds(field.readCapability)) { drop("sort", fieldId, field, DROP_REASON.NOT_AUTHORIZED); continue; }
    if (!field.sortable) {
      drop("sort", fieldId, field, DROP_REASON.UNSUPPORTED, field.unsupportedSortReason);
      continue;
    }
    sort.push(Object.freeze({ fieldId, direction }));
  }

  return Object.freeze({
    filters: Object.freeze(filters),
    sort: Object.freeze(sort),
    search: params.get(PARAM.SEARCH) ?? "",
    view: params.get(PARAM.VIEW) ?? null,
    dropped: Object.freeze(dropped),
  });
}

// ── criteria transitions ──────────────────────────────────────────────────────────────────────
//
// Every one returns NEW criteria and clears nothing else. There is no cursor to reset because the
// cursor never lived here — `useMetadataList` owns paging and already resets it when criteria
// change, which is the one place that knowledge belongs.

/** Add a filter, REPLACING any existing one on the same field+operator rather than stacking it. */
export function addFilter(criteria, criterion) {
  const rest = (criteria?.filters ?? []).filter(
    (f) => !(f.fieldId === criterion.fieldId && f.operator === criterion.operator),
  );
  return Object.freeze({ ...criteria, filters: Object.freeze([...rest, criterion]) });
}

export function removeFilter(criteria, fieldId, operator = null) {
  return Object.freeze({
    ...criteria,
    filters: Object.freeze((criteria?.filters ?? []).filter(
      (f) => !(f.fieldId === fieldId && (operator === null || f.operator === operator)),
    )),
  });
}

export function clearFilters(criteria) {
  return Object.freeze({ ...criteria, filters: Object.freeze([]), search: "" });
}

/** Set the sort. A single clause: the runtime appends its own tiebreaker, and always has. */
export function setSort(criteria, fieldId, direction) {
  if (!fieldId) return Object.freeze({ ...criteria, sort: Object.freeze([]) });
  return Object.freeze({
    ...criteria,
    sort: Object.freeze([{ fieldId, direction: direction === "DESC" ? "DESC" : "ASC" }]),
  });
}

export function setSearch(criteria, search) {
  return Object.freeze({ ...criteria, search: search ?? "" });
}

/** How many criteria are narrowing the list right now. */
export function activeCriteriaCount(criteria) {
  return (criteria?.filters?.length ?? 0) + (criteria?.search ? 1 : 0);
}

/** True when the list a person is looking at is narrowed. Drives "no matches" vs "nothing here". */
export function hasActiveCriteria(criteria) {
  return activeCriteriaCount(criteria) > 0;
}

/**
 * What an active filter chip reads as.
 *
 * @param valueOptions optional { fieldId: [{value, label}] } — the picker's own options.
 *
 * A URL carries no `valueLabel`: `f` encodes field, operator and value and nothing else. So a chip
 * built from a captured pick was human, and the same chip after a reload said `Status: ACTIVE` — a
 * storage token, shown only to the people who bookmarked or shared their view. Re-resolving from the
 * picker's option list fixes it at the source of truth for labels rather than by widening the URL.
 */
export function describeCriterion(criterion, entity, valueOptions = null) {
  const field = findField(entity, criterion?.fieldId);
  const label = field?.label ?? criterion?.fieldId;
  const fromOptions = (valueOptions?.[criterion?.fieldId] ?? [])
    .find((o) => String(o.value) === String(criterion?.value))?.label;
  const fromEnum = field?.enumLabels?.[criterion?.value];
  // Order of preference: the label captured when it was picked, the picker's current label, the
  // enum's own label, then the raw value — which for a free-text filter IS what the person typed.
  return `${label}: ${criterion?.valueLabel ?? fromOptions ?? fromEnum ?? criterion?.value ?? ""}`;
}

/**
 * One sentence naming everything the link asked for that is not in effect.
 *
 * Ends by saying the list is BROADER than requested, which is the part that matters. Naming the
 * dropped fields without saying what that does to the result leaves the reader to work out the
 * consequence, and the consequence is the whole reason this message exists.
 */
export function describeDropped(dropped) {
  if (!dropped?.length) return null;
  const parts = dropped.map((d) => {
    const what = DROP_TEXT[d.reason] ?? "cannot be applied here";
    // The field's own reason, when it has one, turns "cannot be searched here" into something
    // actionable — "lives on another record", "needs an index that has not been set up".
    const why = d.detail ? ` (${UNSUPPORTED_TEXT[d.detail] ?? d.detail})` : "";
    return `${d.label} ${what}${why}`;
  });
  return `Some of what this link asked for is not applied: ${parts.join("; ")}. `
    + "This list is broader than requested.";
}

/**
 * What a request the query layer REFUSED OUTRIGHT reads as.
 *
 * Deliberately different wording from `describeDropped`, and the difference is the point. Dropped
 * criteria leave a list that still renders and is BROADER than asked for. A refused request runs no
 * query at all, so the list shows NOTHING — and telling somebody looking at an empty screen that it
 * is "broader than requested" describes the opposite of what is in front of them.
 *
 * The message therefore says what happened, why, and what to do — because unlike a dropped stale
 * criterion, this one is entirely within the reader's power to fix.
 *
 * @param label what the list calls its records, so the sentence reads in the reader's own terms.
 */
export function describeRefusal(errors, label = "records") {
  if (!errors?.length) return null;
  const reasons = errors.map((e) => REFUSAL_TEXT[e.kind] ?? fallbackReason(e)).join(" ");
  return `These criteria cannot be applied together, so no ${label} are shown. ${reasons} `
    + "Remove one of them to see results.";
}

/**
 * The refusal, in business language.
 *
 * `buildQueryDescriptor`'s own messages are written for whoever is debugging a definition —
 * "Firestore allows one array filter per query; this asks for 2 (lineOfBusiness,
 * relationshipTypes)". Every word of that is true and none of it belongs in front of a person
 * choosing customers: it names the database, the field ids and an index concept, which is the same
 * storage vocabulary this platform refuses to show anywhere else.
 *
 * Unknown kinds fall through to the technical message rather than to silence — an unexplained
 * refusal is worse than an awkwardly worded one, and the fallback is what makes a new REQUEST_ERROR
 * visible instead of invisible.
 */
const REFUSAL_TEXT = Object.freeze({
  MULTIPLE_ARRAY_FILTERS:
    "Only one of these can be used at a time, because each matches a list of values rather than a "
    + "single one.",
});

function fallbackReason(error) {
  // Normalized to end in exactly one full stop; the raw messages vary and produced "…combination..".
  return String(error?.message ?? "").trim().replace(/\.*$/, ".");
}
