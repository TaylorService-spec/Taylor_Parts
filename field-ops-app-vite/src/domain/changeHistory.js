// CHANGE HISTORY -- the shared, record-agnostic history model.
//
// ════════════════════ WHAT IT IS, AND WHAT IT REFUSES TO BE ════════════════════
//
// Every EOS record detail page eventually needs the same section: what changed on this record,
// when, from what, to what, and who did it. Users is the first one to get it. Customers,
// Equipment, Parts, Work Orders, Purchase Orders and the Financials records get the SAME component
// reading the SAME normalized row shape -- which is why none of the vocabulary below mentions an
// employee.
//
// THE ROWS ARE AUTHORITATIVE OR THEY DO NOT EXIST. Every row corresponds to one stored Audit Event
// returned by the trusted listRecordChangeHistory callable. Nothing here diffs a currently-loaded
// object against a previous React state to manufacture history: that produces entries for changes
// nobody made, misses changes made by somebody else, and disappears on refresh. A history that is
// wrong is worse than a history that is empty, and an empty one at least says so.
//
// PURE. No React, no Firebase, no I/O -- so the filter/sort semantics the table's accessibility
// depends on are unit-testable without a DOM.

/** The columns a Change History table sorts by. `field` sorts by the rendered field/event label. */
export const HISTORY_SORT_KEY = Object.freeze({
  OCCURRED_AT: "occurredAt",
  FIELD: "field",
  PREVIOUS: "previousValue",
  NEW: "newValue",
  CHANGED_BY: "changedBy",
});

export const SORT_DIRECTION = Object.freeze({ ASC: "asc", DESC: "desc" });

/**
 * The default sort, and it is not "the first column ascending".
 *
 * Newest first, always, because a record's history is read backwards from now: the question is
 * "what happened recently", never "what happened first". Section 12's ascending-on-first-click
 * rule applies to a column the user CHOOSES; the initial state is this.
 */
export const DEFAULT_SORT = Object.freeze({
  key: HISTORY_SORT_KEY.OCCURRED_AT,
  direction: SORT_DIRECTION.DESC,
});

/** The Field filter's "everything" option. Not a field key, so it can never collide with one. */
export const ALL_FIELDS = "__ALL__";

/**
 * An event that changed no single field -- an account enable/disable, a password reset, a denial.
 *
 * It still belongs in the history and still needs a Field/Event filter option, so it gets one
 * derived from its event type rather than being dropped or bucketed as "other".
 */
export const NO_FIELD = "__EVENT__";

const isBlank = (v) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

/**
 * Normalize one trusted-callable row into the display model.
 *
 * `labels` maps a machine field key to the words a person reads ("jobTitle" -> "Job Title") and is
 * supplied BY THE RECORD SURFACE, not by this module -- a shared component that carried a global
 * employee field map would stop being shared the moment Equipment used it. An unmapped key falls
 * through verbatim rather than to a placeholder: a new field renders as its own token the day it
 * is added, and somebody can name it properly later without the screen having lied meanwhile.
 */
export function normalizeHistoryRow(raw, { fieldLabels = {}, eventLabels = {} } = {}) {
  if (!raw || typeof raw !== "object") return null;
  const fieldKey = isBlank(raw.fieldKey) ? null : String(raw.fieldKey);
  const eventType = isBlank(raw.eventType) ? "" : String(raw.eventType);
  return Object.freeze({
    id: String(raw.id ?? ""),
    occurredAt: typeof raw.occurredAt === "number" ? raw.occurredAt : null,
    fieldKey,
    // The Field/Event column. A field change reads as its field; anything else reads as its event.
    fieldLabel: fieldKey
      ? (fieldLabels[fieldKey] ?? fieldKey)
      : (eventLabels[eventType] ?? eventType),
    // What the FIELD filter groups by -- the field key for a field change, the event type
    // otherwise. Derived, never hard-coded, so the options are always exactly what the data holds.
    filterKey: fieldKey ?? (eventType ? `${NO_FIELD}:${eventType}` : NO_FIELD),
    eventType,
    outcome: isBlank(raw.outcome) ? "" : String(raw.outcome),
    previousValue: isBlank(raw.previousValue) ? null : String(raw.previousValue),
    newValue: isBlank(raw.newValue) ? null : String(raw.newValue),
    changedById: isBlank(raw.changedById) ? "" : String(raw.changedById),
    // NEVER the uid. An unresolved actor renders as an honest unknown, not as an identifier a
    // person is expected to recognize (DECISIONS #106).
    changedByLabel: isBlank(raw.changedByLabel) ? null : String(raw.changedByLabel),
    summary: isBlank(raw.summary) ? "" : String(raw.summary),
  });
}

export function normalizeHistoryRows(rows, options) {
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => normalizeHistoryRow(r, options)).filter(Boolean);
}

/**
 * The Field filter's options, DERIVED FROM THE ROWS.
 *
 * Section 11's requirement, and the reason it is a requirement: a hard-coded list of employee
 * fields inside a shared component offers filters that match nothing on an Equipment record, and
 * silently omits any field the list was not updated for. Offering a filter that can only ever
 * return zero rows is worse than not offering it.
 *
 * Sorted by label so the menu is scannable; "All changes" is prepended by the renderer.
 */
export function historyFieldOptions(rows) {
  const byKey = new Map();
  for (const row of rows) {
    if (!byKey.has(row.filterKey)) byKey.set(row.filterKey, row.fieldLabel);
  }
  return [...byKey.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** The Changed By filter's options, derived the same way and for the same reason. */
export function historyActorOptions(rows) {
  const byId = new Map();
  for (const row of rows) {
    if (!row.changedById) continue;
    if (!byId.has(row.changedById)) byId.set(row.changedById, row.changedByLabel);
  }
  return [...byId.entries()]
    .map(([value, label]) => ({ value, label: label ?? "Unknown user" }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Apply the filters.
 *
 * `from`/`to` are calendar-day strings (YYYY-MM-DD) as an <input type="date"> produces them, and
 * they are INCLUSIVE of both days -- a range "from the 3rd to the 3rd" that excluded the 3rd is
 * the bug every date filter ships with once.
 *
 * A row with no timestamp (a server timestamp that has not materialized) survives an unset date
 * range and is excluded by a set one. It cannot be proven inside the range, and a history that
 * quietly includes unprovable rows in a filtered view is making a claim it cannot support.
 */
export function filterHistory(rows, { field = ALL_FIELDS, actor = ALL_FIELDS, from = null, to = null } = {}) {
  const fromMs = dayStartMillis(from);
  const toMs = dayEndMillis(to);
  return rows.filter((row) => {
    if (field !== ALL_FIELDS && row.filterKey !== field) return false;
    if (actor !== ALL_FIELDS && row.changedById !== actor) return false;
    if (fromMs === null && toMs === null) return true;
    if (row.occurredAt === null) return false;
    if (fromMs !== null && row.occurredAt < fromMs) return false;
    if (toMs !== null && row.occurredAt > toMs) return false;
    return true;
  });
}

function dayStartMillis(day) {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const ms = Date.parse(`${day}T00:00:00`);
  return Number.isNaN(ms) ? null : ms;
}

function dayEndMillis(day) {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const ms = Date.parse(`${day}T23:59:59.999`);
  return Number.isNaN(ms) ? null : ms;
}

const byText = (a, b) => a.localeCompare(b, undefined, { sensitivity: "base" });

const SORT_VALUE = Object.freeze({
  [HISTORY_SORT_KEY.OCCURRED_AT]: (r) => r.occurredAt,
  [HISTORY_SORT_KEY.FIELD]: (r) => r.fieldLabel || null,
  [HISTORY_SORT_KEY.PREVIOUS]: (r) => r.previousValue,
  [HISTORY_SORT_KEY.NEW]: (r) => r.newValue,
  [HISTORY_SORT_KEY.CHANGED_BY]: (r) => r.changedByLabel,
});

/**
 * Sort, stably, by one column.
 *
 * A MISSING VALUE SORTS LAST IN BOTH DIRECTIONS, and the absence check runs BEFORE the direction
 * is applied. Folding it into the comparator instead would drag the absent rows to the top of a
 * descending sort, which is the opposite of what "sort by previous value" means to somebody
 * scanning for one -- "not recorded" does not belong at either end of a ranking of real values.
 */
export function sortHistory(rows, { key = DEFAULT_SORT.key, direction = DEFAULT_SORT.direction } = {}) {
  const read = SORT_VALUE[key] ?? SORT_VALUE[DEFAULT_SORT.key];
  const sign = direction === SORT_DIRECTION.ASC ? 1 : -1;
  const compare = key === HISTORY_SORT_KEY.OCCURRED_AT ? (x, y) => x - y : byText;
  // A stable tiebreak, so two rows holding the same value never swap places between renders.
  const tiebreak = (left, right) => left.id.localeCompare(right.id);
  return [...rows].sort((left, right) => {
    const a = read(left);
    const b = read(right);
    if (a === null || a === undefined) {
      return b === null || b === undefined ? tiebreak(left, right) : 1;
    }
    if (b === null || b === undefined) return -1;
    const ordered = compare(a, b);
    return ordered === 0 ? tiebreak(left, right) : ordered * sign;
  });
}

/**
 * The next sort state for a header click.
 *
 * First click on a column: ASCENDING. Second: descending. After that it toggles. Section 12,
 * except for the one exception it names -- the initial state is Date/Time DESC, which is why
 * clicking Date/Time for the first time gives ascending like every other column rather than
 * "toggling" from the default.
 */
export function nextSort(current, key) {
  if (current.key !== key) return { key, direction: SORT_DIRECTION.ASC };
  return {
    key,
    direction: current.direction === SORT_DIRECTION.ASC ? SORT_DIRECTION.DESC : SORT_DIRECTION.ASC,
  };
}

/** The `aria-sort` value for a header, so assistive tech is told the same thing the arrow says. */
export function ariaSortFor(current, key) {
  if (current.key !== key) return "none";
  return current.direction === SORT_DIRECTION.ASC ? "ascending" : "descending";
}

/**
 * Filter and sort together, in that order.
 *
 * One entry point so the composition cannot be got wrong at a call site: sorting a superset and
 * then filtering produces the same rows, but any surface that paginated the sorted list first
 * would silently filter only the current page.
 */
export function presentHistory(rows, { filters = {}, sort = DEFAULT_SORT } = {}) {
  return sortHistory(filterHistory(rows, filters), sort);
}
