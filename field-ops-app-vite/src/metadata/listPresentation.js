// EOS Metadata — list presentation model.
//
// GOVERNANCE: docs/governance/metadata-architecture-ip-boundary.md §4, §5, §6, §8.
//
// Turns a ListViewDefinition plus a fetched page into a RENDER MODEL: resolved column
// headers, cell descriptors, the surface's state, and what to say when there is nothing
// to show. It renders nothing itself — the React component that consumes this is a thin
// mapping from this model to EOS markup.
//
// Third module in the same pattern (query core, composition planner, this), for the same
// reason each time: the decisions worth asserting exhaustively are the ones about what a
// user is shown, and those are only assertable offline while they stay pure.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY A SEPARATE STATE FOR EVERY WAY A LIST CAN BE EMPTY
//
// A list showing nothing has at least four distinct causes, and collapsing them is a
// habit this codebase has already been bitten by:
//
//   EMPTY       there genuinely are no records
//   FILTERED    records exist, the current filters exclude them
//   DENIED      the caller may not read this
//   UNAVAILABLE the read failed
//
// "No customers found" in front of someone who simply lacks a capability is a lie, and
// it is the specific lie that sends people to look for missing data instead of missing
// access. The AR panel showed "Unavailable" for months where it meant "ready"; the
// account list still says "No customers match the current filters" whether or not any
// filter is set. So the model carries the cause, and the component cannot accidentally
// render one as another because it is never given the chance to guess.
// ─────────────────────────────────────────────────────────────────────────────

import { findField } from "./entityDefinition.js";
import { componentRegistry } from "./registry.js";
import { formatTimestamp } from "../domain/displayTimestamp.js";

export const LIST_STATE = Object.freeze(["LOADING", "READY", "EMPTY", "FILTERED", "DENIED", "UNAVAILABLE"]);

/**
 * Resolve the columns a definition declares against the entity.
 *
 * A column whose renderer is not registered keeps its column and loses its renderer,
 * rather than being dropped: dropping it would silently narrow the table and the reader
 * would never know a field was missing. Falling back to the raw value is the honest
 * degradation — the data is still true, only its formatting is gone.
 */
export function resolveColumns(def, entity) {
  return Object.freeze(
    (def?.columns ?? []).map((col) => {
      const field = findField(entity, col.fieldId);
      return Object.freeze({
        fieldId: col.fieldId,
        // The column's own label wins; otherwise the field's. Never the fieldId — a
        // header reading "expectedCloseAt" is a schema leaking into a UI.
        label: col.label ?? field?.label ?? col.fieldId,
        type: field?.type ?? "STRING",
        sortable: !!col.sortable && !!field?.sortable,
        renderer: col.renderer && componentRegistry.has(col.renderer) ? col.renderer : null,
        rendererMissing: !!col.renderer && !componentRegistry.has(col.renderer),
        enumLabels: field?.enumLabels ?? null,
      });
    })
  );
}

/**
 * The display value for one cell.
 *
 * ENUMS RESOLVE THROUGH THEIR LABEL MAP. A cell showing "ACTIVE" is a machine value
 * reaching a user — the same conflation that produced "0 Active" beside a table of
 * ACTIVE rows (#1093). An unmapped value is shown verbatim rather than blanked, because
 * an unrecognized status is a data question and hiding it answers nothing.
 *
 * TIMESTAMP/DATE RESOLVE THROUGH THE SHARED DISPLAY FORMATTER (domain/displayTimestamp.js),
 * the same one already used everywhere else in this codebase a stored time reaches a
 * screen, rather than a second date vocabulary invented here. Stored shapes are NOT
 * uniform across entities — some store a Firestore Timestamp, some store an epoch-
 * millisecond NUMBER (equipment, employee), and Opportunity stores `expectedCloseAt` as
 * epoch millis while its own `createdAt` is a Firestore Timestamp — so this defers the
 * shape-sniffing entirely to `formatTimestamp`'s own `toMillis` coercion rather than
 * assuming one shape. A value that coercion cannot interpret must not fall back to the
 * raw stored value (an epoch number is a machine value, exactly the class of defect enum
 * resolution exists to prevent): `unknown: null` renders nothing rather than a formatted
 * "Unknown" placeholder or a number.
 */
export function cellValue(column, row) {
  const raw = row?.[column.fieldId];
  if (raw === null || raw === undefined || raw === "") return null;
  if (column.type === "ENUM" && column.enumLabels) return column.enumLabels[raw] ?? raw;
  // A multi-valued enum resolves EVERY member. Rendering the array as-is would print
  // "CUSTOMERVENDOR" — machine values, concatenated, in front of a user.
  if (column.type === "ENUM_SET" && Array.isArray(raw)) {
    if (raw.length === 0) return null;
    return raw.map((v) => column.enumLabels?.[v] ?? v).join(", ");
  }
  if (column.type === "TIMESTAMP" || column.type === "DATE") return formatTimestamp(raw, { unknown: null });
  // BOOLEAN renders as text, using the app's established "Yes"/"No" vocabulary. Without
  // this, React renders neither `true` nor `false` as a child, so a declared boolean
  // column came out BLANK on every row -- indistinguishable from a missing value, and
  // silent in exactly the way an unrendered enum was. A section that wants a more specific
  // vocabulary ("Primary" rather than "Yes") can still map the value before it gets here;
  // this is the honest default, not a replacement for one.
  if (column.type === "BOOLEAN") return raw ? "Yes" : "No";
  return raw;
}

/**
 * Build the render model.
 *
 * @param {object} args { def, entity, page, loading, errorStatus, filtersActive }
 */
export function buildListPresentation({ def, entity, page = null, loading = false, errorStatus = null, filtersActive = false } = {}) {
  const columns = resolveColumns(def, entity);

  const state = (() => {
    if (loading) return "LOADING";
    if (errorStatus === "denied") return "DENIED";
    if (errorStatus) return "UNAVAILABLE";
    if (!page) return "UNAVAILABLE";
    if (page.rows.length > 0) return "READY";
    // The distinction that matters: nothing to show BECAUSE of a filter is not the same
    // fact as nothing to show at all, and only one of them has an action attached.
    return filtersActive ? "FILTERED" : "EMPTY";
  })();

  const rows = state === "READY"
    ? page.rows.map((row) => Object.freeze({
        // The routing key. Deliberately separate from anything displayed, so a document
        // id can be used to navigate without ever becoming a label.
        key: row.id,
        cells: Object.freeze(columns.map((c) => Object.freeze({ fieldId: c.fieldId, value: cellValue(c, row) }))),
      }))
    : [];

  return Object.freeze({
    listId: def?.id ?? null,
    surface: def?.surface ?? "INDEX",
    state,
    columns,
    rows: Object.freeze(rows),
    // Paging affordances belong to an INDEX. A RELATED section caps its rows and hands
    // off instead, so offering "load more" there would quietly turn an embedded section
    // into a second, unbounded list.
    hasMore: def?.surface === "INDEX" ? !!page?.hasMore : false,
    viewAllListId: def?.surface === "RELATED" ? def?.viewAllListId ?? null : null,
    truncated: def?.surface === "RELATED" ? !!page?.hasMore : false,
    emptyMessage: emptyMessageFor(state, def),
  });
}

/**
 * Copy for a non-READY state.
 *
 * Each says what is true and, where there is one, what the reader can do. DENIED
 * deliberately does not say "no records" and UNAVAILABLE deliberately does not say
 * "none" — both would send someone hunting for missing data instead of missing access
 * or a failed read.
 */
export function emptyMessageFor(state, def = null) {
  const label = def?.label ?? "records";
  switch (state) {
    case "EMPTY": return `No ${label.toLowerCase()} yet.`;
    case "FILTERED": return `No ${label.toLowerCase()} match the current filters.`;
    case "DENIED": return `You do not have access to ${label.toLowerCase()}.`;
    case "UNAVAILABLE": return `${label} could not be loaded. Try again.`;
    default: return null;
  }
}

/**
 * Builds a row's destination from a list definition's `rowNavigationTo` template.
 * Lives here rather than in MetadataRecordPage.jsx because it is pure presentation
 * logic with no component of its own -- exporting it from a component module broke
 * fast refresh for every component in that file.
 */
export function buildRowHref(template, key) {
  if (!template || key === null || key === undefined) return null;
  return template.replace(/:[^/]+/, encodeURIComponent(String(key)));
}

