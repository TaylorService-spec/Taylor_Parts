// LIST STATE — filters, sort and position, as something that survives opening a record.
//
// ============================ WHY THIS IS IN THE URL ============================
//
// A dispatcher filters to In Progress, sorts by scheduled date, scrolls, opens a job, comes back —
// and finds an unfiltered list. That is the defect this exists to prevent, and browser history alone
// cannot fix it: history restores a PAGE, not the state a component happened to hold.
//
// So the state is serialized into the URL. That makes it survivable, shareable and bookmarkable, and
// it means "back to the list" is just a URL rather than a framework.
//
// ============================ WHAT THE QUERY LAYER MAY BE ASKED ============================
//
// `toQueryPlan` translates user-facing state into what the data layer can actually execute, and
// SPLITS what it cannot. A filter on a field the metadata says is unqueryable does not silently
// become a client-side scan of the collection — it is returned as `unsupported`, and the caller must
// deal with it honestly.
//
// PURE. No router, no fetching.
import { OPERATOR } from "./fieldMetadata.js";

/** One filter, in the user's terms: field → operator → value. */
export function makeFilter({ fieldId, operator, value = null, valueLabel = null } = {}) {
  if (!fieldId || !operator) return null;
  return Object.freeze({ fieldId, operator, value, valueLabel });
}

export const emptyListState = Object.freeze({
  filters: Object.freeze([]),
  sort: null,
  cursor: null,
  search: "",
  view: null,
});

/**
 * Serialize to URL search params.
 *
 * Compact on purpose — a URL a person might paste into a message should not be three lines of JSON.
 * `f` is a repeated key so multiple filters survive without an encoding scheme of their own.
 */
export function toSearchParams(state, existing = null) {
  const params = new URLSearchParams(existing ?? "");
  params.delete("f");
  params.delete("sort");
  params.delete("q");
  params.delete("view");

  for (const filter of state.filters ?? []) {
    // field:operator:value — the value is encoded last so a colon inside it cannot split the record.
    const value = filter.value === null || filter.value === undefined ? "" : String(filter.value);
    params.append("f", `${filter.fieldId}:${filter.operator}:${encodeURIComponent(value)}`);
  }
  if (state.sort) params.set("sort", `${state.sort.fieldId}:${state.sort.direction}`);
  if (state.search) params.set("q", state.search);
  if (state.view) params.set("view", state.view);
  return params;
}

/**
 * Read state back out of a URL.
 *
 * Unknown or malformed entries are DROPPED rather than thrown on: a URL is user-editable and may be
 * from an older build, and a stale filter should degrade to an unfiltered list rather than a broken
 * screen. Fields are validated against the metadata, so a removed field cannot resurrect itself.
 */
export function fromSearchParams(params, fields = []) {
  const search = new URLSearchParams(params ?? "");
  const byId = new Map(fields.map((f) => [f.id, f]));

  const filters = search.getAll("f").map((raw) => {
    const first = raw.indexOf(":");
    const second = raw.indexOf(":", first + 1);
    if (first < 0 || second < 0) return null;
    const fieldId = raw.slice(0, first);
    const operator = raw.slice(first + 1, second);
    const value = decodeURIComponent(raw.slice(second + 1));
    const field = byId.get(fieldId);
    // A filter naming a field this build no longer offers, or an operator that field never allowed,
    // is not honoured -- otherwise a stale URL could ask for something the query layer cannot mean.
    if (!field || !field.filterable || !field.operators.includes(operator)) return null;
    return makeFilter({ fieldId, operator, value: value === "" ? null : value });
  }).filter(Boolean);

  let sort = null;
  const rawSort = search.get("sort");
  if (rawSort) {
    const [fieldId, direction] = rawSort.split(":");
    const field = byId.get(fieldId);
    if (field?.sortable && (direction === "asc" || direction === "desc")) sort = { fieldId, direction };
  }

  return Object.freeze({
    filters: Object.freeze(filters),
    sort,
    cursor: null,
    search: search.get("q") ?? "",
    view: search.get("view") ?? null,
  });
}

/** Add a filter. Replacing the same field+operator rather than stacking a contradiction. */
export function addFilter(state, filter) {
  const kept = (state.filters ?? []).filter((f) => !(f.fieldId === filter.fieldId && f.operator === filter.operator));
  return Object.freeze({
    ...state,
    filters: Object.freeze([...kept, filter]),
    // ANY change to the criteria invalidates the page position. Keeping a cursor across a filter
    // change would page into a result set that no longer exists.
    cursor: null,
  });
}

export function removeFilter(state, fieldId, operator = null) {
  return Object.freeze({
    ...state,
    filters: Object.freeze((state.filters ?? []).filter(
      (f) => !(f.fieldId === fieldId && (operator === null || f.operator === operator)),
    )),
    cursor: null,
  });
}

export function clearFilters(state) {
  return Object.freeze({ ...state, filters: Object.freeze([]), cursor: null });
}

export function setSort(state, fieldId, direction) {
  return Object.freeze({ ...state, sort: fieldId ? { fieldId, direction } : null, cursor: null });
}

export const hasActiveCriteria = (state) =>
  (state?.filters?.length ?? 0) > 0 || !!state?.search;

/** How many things a person has narrowed by — the number a mobile Filters button shows. */
export const activeFilterCount = (state) => (state?.filters?.length ?? 0);

// ============================ THE QUERY PLAN ============================

/** How a filter must be executed, once the metadata has had its say. */
export const EXECUTION = Object.freeze({
  /** The datastore can do it. */
  SERVER: "SERVER",
  /**
   * Refines an already-bounded page in memory. Legitimate ONLY on a result set the server has
   * already limited — never as a way to filter a collection by fetching all of it.
   */
  BOUNDED_LOCAL: "BOUNDED_LOCAL",
  /** Cannot be honoured. Surfaced to the caller; never silently dropped or faked. */
  UNSUPPORTED: "UNSUPPORTED",
});

/**
 * Translate list state into an executable plan.
 *
 * The guard against the failure §36 names: a filter never becomes an unbounded client-side scan just
 * because the metadata offered it. A field the metadata declares unqueryable comes back UNSUPPORTED
 * with its reason, and the screen says so.
 */
export function toQueryPlan(state, fields, { pageSize = 50 } = {}) {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const server = [];
  const unsupported = [];

  for (const filter of state.filters ?? []) {
    const field = byId.get(filter.fieldId);
    if (!field) {
      unsupported.push({ filter, reason: "UNKNOWN_FIELD" });
      continue;
    }
    if (!field.filterable) {
      unsupported.push({ filter, field, reason: field.unsupportedFilterReason });
      continue;
    }
    server.push({ filter, field, execution: EXECUTION.SERVER });
  }

  let sort = null;
  if (state.sort) {
    const field = byId.get(state.sort.fieldId);
    if (field?.sortable) sort = { ...state.sort, field, execution: EXECUTION.SERVER };
    else if (field) unsupported.push({ sort: state.sort, field, reason: field.unsupportedSortReason });
  }

  return Object.freeze({
    server: Object.freeze(server),
    sort,
    // A page size is ALWAYS applied. An unbounded list query is the thing that works on a demo
    // dataset and takes a real customer's browser down.
    pageSize,
    cursor: state.cursor ?? null,
    unsupported: Object.freeze(unsupported),
    executable: unsupported.length === 0,
  });
}

/**
 * Relative date ranges, resolved to real bounds.
 *
 * Stored as a keyword rather than a computed range so a bookmarked "this week" still means this week
 * next month. Resolution happens at query time, against an injected clock.
 */
export const RELATIVE_RANGE = Object.freeze({
  TODAY: "TODAY",
  THIS_WEEK: "THIS_WEEK",
  LAST_7_DAYS: "LAST_7_DAYS",
  LAST_30_DAYS: "LAST_30_DAYS",
  THIS_MONTH: "THIS_MONTH",
});

export const RELATIVE_RANGE_LABEL = Object.freeze({
  [RELATIVE_RANGE.TODAY]: "Today",
  [RELATIVE_RANGE.THIS_WEEK]: "This week",
  [RELATIVE_RANGE.LAST_7_DAYS]: "Last 7 days",
  [RELATIVE_RANGE.LAST_30_DAYS]: "Last 30 days",
  [RELATIVE_RANGE.THIS_MONTH]: "This month",
});

export function resolveRelativeRange(range, now = Date.now()) {
  const day = 24 * 60 * 60 * 1000;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const startOfToday = start.getTime();
  switch (range) {
    case RELATIVE_RANGE.TODAY: return { from: startOfToday, to: startOfToday + day };
    case RELATIVE_RANGE.THIS_WEEK: {
      // Week starts Monday: a service week is a working week, not a calendar convenience.
      const dow = (new Date(startOfToday).getDay() + 6) % 7;
      return { from: startOfToday - dow * day, to: startOfToday - dow * day + 7 * day };
    }
    case RELATIVE_RANGE.LAST_7_DAYS: return { from: startOfToday - 6 * day, to: startOfToday + day };
    case RELATIVE_RANGE.LAST_30_DAYS: return { from: startOfToday - 29 * day, to: startOfToday + day };
    case RELATIVE_RANGE.THIS_MONTH: {
      const d = new Date(startOfToday);
      const from = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
      const to = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
      return { from, to };
    }
    default: return null;
  }
}

/** What an active filter chip reads as. Values are HUMAN labels, never ids. */
export function describeFilter(filter, fields) {
  const field = fields.find((f) => f.id === filter.fieldId);
  const label = field?.label ?? filter.fieldId;
  if (filter.operator === OPERATOR.RELATIVE) {
    return `${label}: ${RELATIVE_RANGE_LABEL[filter.value] ?? filter.value}`;
  }
  // valueLabel is the resolved human identity. Its absence falls back to the value, which for an
  // enum IS human -- but a reference filter must always carry a label, and its picker supplies one.
  return `${label}: ${filter.valueLabel ?? filter.value ?? ""}`;
}
