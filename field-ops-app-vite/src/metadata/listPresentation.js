import { normalizeReferenceResult } from "./referenceResolution.js";
import { ABSENCE, ABSENCE_TEXT } from "./absence.js";
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
import { formatDateOnly } from "../domain/displayTimestamp.js";
import { formatMinor } from "../domain/accountArView.js";

export const LIST_STATE = Object.freeze(["LOADING", "READY", "EMPTY", "FILTERED", "DENIED", "UNAVAILABLE"]);

/**
 * Resolve the columns a definition declares against the entity.
 *
 * X-LIST-COLUMN-RENDERER-UNCONSUMED: this used to also resolve a `renderer` id
 * against `componentRegistry` here, on every call — and nothing ever read the
 * resolved value back out of the column it built. `makeColumn`/`validateListViewDefinition`
 * (listViewDefinition.js) no longer accept or permit a `renderer` at all, so there is
 * nothing left to resolve here. See `makeColumn`'s doc comment for the evidence this
 * was decided on.
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
 *
 * CURRENCY_MINOR RESOLVES THROUGH THE SAME MINOR-UNIT FORMATTER ALREADY USED ELSEWHERE THIS
 * APP RENDERS MINOR-UNIT MONEY (domain/accountArView.js's `formatMinor`, the function already
 * rendering this exact shape for `outstandingMinor` on the Account AR panel) rather than a
 * second, invented display formatter. A CURRENCY_MINOR field travels with its own sibling
 * `currency` field by contract (invoice.js/payment.js both declare one beside their
 * CURRENCY_MINOR amounts) — read from the ROW, never hardcoded, so a field never claims a
 * currency symbol its own record does not carry. Zero is a real amount and renders as "0.00"
 * (or "<CUR> 0.00"), not blank — the top-of-function absent/null/"" check runs first and only
 * catches a genuinely missing value, never a stored zero.
 *
 * REFERENCE RESOLVES THROUGH AN INJECTED RESOLVER, NEVER THROUGH THE STORED ID (DECISIONS
 * #106 — "a missing business reference is not permission to display a record id"). Every
 * REFERENCE field declared across this program's ten entity definitions carries the SAME
 * comment: "Display resolution belongs to the [target] entity, not to this field" (account.js's
 * billingContactId, contact.js's accountId, equipment.js's accountId/locationId, invoice.js's
 * accountId/salesOrderId, location.js's accountId, opportunity.js's accountId/ownerEmployeeId/
 * salesOrderId, purchaseOrder.js's partId, salesOrder.js's accountId/ownerEmployeeId/
 * sourceOpportunityId, truck.js's homeWarehouseId/assignedDriverEmployeeId, workOrder.js's
 * customerId/assignedTechId — every one of them). That is not incidental phrasing repeated ten
 * times; it is this program's own, already-settled position that a REFERENCE's display value
 * does NOT live denormalized on the source record (contrast equipmentModel.js's
 * manufacturerName, a genuine denormalized-sibling field, which exists precisely because that
 * entity's read projection chose to carry one — no such sibling exists, or is invited to exist,
 * for any of these ten). So `cellValue` cannot invent a display value from the row alone: it
 * accepts an optional `resolveReference(fieldId, id, row)` from the caller — the party actually
 * positioned to have fetched or joined the referenced entity, per every one of those comments —
 * and calls it. A present id with no resolver supplied, or a resolver that does not know this
 * particular id, is the SAME fact from a reader's standpoint ("this reference could not be shown
 * honestly") and renders the SAME explicit `UNRESOLVED_REFERENCE_LABEL` — never blank (blank
 * would be indistinguishable from the field genuinely being unset, which the absent/null/""
 * check above already renders as `null`) and never the raw stored id (the exact defect this
 * closes: a document id is a routing key, not content — see buildRowHref below, and the "id is
 * the row KEY and never a cell" test this file's suite already enforces for every OTHER column
 * type). A resolver that DOES recognize the id returns the real display string, which passes
 * through unchanged.
 */
// The label, and the states around it, now live in referenceResolution.js -- a reference can fail
// for reasons the system usually KNOWS (missing / denied / still loading / errored), and collapsing
// them into one string tells an operator their data is broken when the truth may be that their role
// is narrow. Re-exported so existing importers are unaffected.
export { UNRESOLVED_REFERENCE_LABEL, REFERENCE_STATE } from "./referenceResolution.js";

export function cellValue(column, row, { resolveReference, resolveMoneyCell } = {}) {
  const raw = row?.[column.fieldId];

  // A MONEY CELL IS DECIDED BEFORE THE ABSENT CHECK, and that ordering is the point.
  //
  // `raw === null` on a CURRENCY_MINOR field is not "no value to show" -- it is a FACT the reader
  // needs, and the owning entity is the only party that knows which fact. A Sales Order with no
  // total has four different reasons for it (not priced / partly priced / no lines / genuinely
  // unknown), and the record page has said so since the Dollars work while the LIST rendered a
  // blank cell for all four. A blank is indistinguishable from a failed load, which is the exact
  // ambiguity that work existed to remove -- removed on one surface and not the other.
  //
  // So an owning surface may supply the WHOLE cell. It is not a generic escape hatch: it applies
  // only to CURRENCY_MINOR, and a resolver that returns null falls straight through to the default
  // below, so every list that injects nothing is unchanged.
  if (column.type === "CURRENCY_MINOR" && resolveMoneyCell) {
    const supplied = resolveMoneyCell(row, column);
    if (supplied !== null && supplied !== undefined) return supplied;
  }

  if (raw === null || raw === undefined || raw === "") return null;
  // A CURRENCY_MINOR field travels with its own sibling `currency` by contract, and that stays the
  // default for every entity that has one.
  if (column.type === "CURRENCY_MINOR") return formatMinor(raw, row?.currency ?? null);
  // AN ENUM THIS BUILD CANNOT NAME IS "NOT KNOWN", NEVER ITS MACHINE VALUE.
  //
  // This returned `?? raw`, and the ENUM_SET branch below did the same. The reasoning recorded at
  // the time was that "a value the enum does not know is a data question; hiding it answers
  // nothing" — right about not hiding it, wrong about the remedy. Printing the stored value is the
  // exact defect R04 exists to prevent: the reader is shown WORK_IN_PROGRESS / SERVICE_CALL /
  // REPAIR and has no way to tell a real business term from a database constant, and a legacy
  // record carrying a value this build has never heard of looks identical to a governed one.
  //
  // ABSENCE.UNKNOWN already says this in the vocabulary this codebase settled on — "the platform
  // cannot determine it", rendered "Not known". The field is still there and still says something
  // is stored; what it stops doing is dressing an implementation detail up as a business fact.
  // The stored value remains recoverable where it belongs: in the record, in audit, and to anyone
  // reading the document — not on the screen of someone who cannot act on it.
  const unnamed = ABSENCE_TEXT[ABSENCE.UNKNOWN];
  if (column.type === "ENUM" && column.enumLabels) return column.enumLabels[raw] ?? unnamed;
  // A multi-valued enum resolves EVERY member. Rendering the array as-is would print
  // "CUSTOMERVENDOR" — machine values, concatenated, in front of a user.
  if (column.type === "ENUM_SET" && Array.isArray(raw)) {
    if (raw.length === 0) return null;
    return raw.map((v) => column.enumLabels?.[v] ?? unnamed).join(", ");
  }
  // A DATE, not a full timestamp. A list answers "when, roughly"; the record answers "exactly
  // when". "8/12/2025, 5:00:00 AM" spends a whole line of a phone card on seconds nobody reads.
  if (column.type === "TIMESTAMP" || column.type === "DATE") return formatDateOnly(raw, { unknown: null });
  // BOOLEAN renders as text, using the app's established "Yes"/"No" vocabulary. Without
  // this, React renders neither `true` nor `false` as a child, so a declared boolean
  // column came out BLANK on every row -- indistinguishable from a missing value, and
  // silent in exactly the way an unrendered enum was. A section that wants a more specific
  // vocabulary ("Primary" rather than "Yes") can still map the value before it gets here;
  // this is the honest default, not a replacement for one.
  if (column.type === "BOOLEAN") return raw ? "Yes" : "No";
  // REFERENCE — see the doc comment above. `raw` here is a real, present document id (the
  // absent/null/"" case already returned above), and it must never reach this return value.
  if (column.type === "REFERENCE") {
    // A resolver may return a plain string (the original contract, still honoured) or a
    // `{ state, label }` telling us WHY it could not resolve. Either way the raw id never reaches
    // the caller: normalizeReferenceResult always yields a showable label.
    const resolved = typeof resolveReference === "function" ? resolveReference(column.fieldId, raw, row) : undefined;
    return normalizeReferenceResult(resolved).label;
  }
  // ═══════════ AN OBJECT IS NOT A VALUE, AND ITS SERIALIZATION IS NOT A DISPLAY ═══════════
  //
  // Every branch above turns a known shape into words. This is what is left, and it used to return
  // whatever it was handed. For a primitive that is right — a STRING is its own display, and so is
  // a NUMBER. For an OBJECT it is catastrophic, and the Equipment record showed exactly how:
  //
  //     Created   Timestamp(seconds=1786163702, nanoseconds=367000000)
  //     Updated   Timestamp(seconds=1786163702, nanoseconds=367000000)
  //
  // `equipment.js` declares createdAt/updatedAt as NUMBER, deliberately and with its reasoning
  // recorded: firestore.rules asserts `data.createdAt is number`, so the GOVERNED write path stores
  // epoch milliseconds, and declaring TIMESTAMP would claim storage semantics the collection does
  // not have. That declaration is right about the contract. A sandbox document held a Timestamp
  // anyway — written by a path that did not go through those Rules — so a shape the field's own
  // contract forbids reached a renderer that stringified it.
  //
  // The fix is not to re-type the field on the strength of one non-conforming document, and it is
  // not to guess that any object carrying `seconds` is a date. It is to REFUSE: a value whose shape
  // contradicts its declared type cannot be turned into words without guessing at what it means,
  // and the honest answer is to say so rather than print the database's own serialization at a
  // person who cannot act on it. The value stays recoverable where it belongs — in the document,
  // and in audit.
  //
  // ADDRESS is the precedent one type over: MetadataRecordPage already special-cases it because
  // `String({street: …})` renders "[object Object]". That caught the defect for one type; this
  // closes the class, in the layer BOTH the lists and the record pages read through. On a list it
  // also stops React being handed an object as a cell child.
  if (raw !== null && typeof raw === "object") return ABSENCE_TEXT[ABSENCE.UNREADABLE];
  return raw;
}

/**
 * Build the render model.
 *
 * @param {object} args { def, entity, page, loading, errorStatus, filtersActive, resolveReference }
 *
 * `resolveReference`, if supplied, is threaded straight through to every cell's `cellValue`
 * call — see that function's own doc comment for why the resolver lives with the caller and
 * not here. Omitting it is a legitimate, honest choice (a caller with no live resolver wired
 * yet): every REFERENCE cell then renders `UNRESOLVED_REFERENCE_LABEL`, never the stored id.
 */
export function buildListPresentation({ def, entity, page = null, loading = false, errorStatus = null, filtersActive = false, resolveReference = null, resolveMoneyCell = null } = {}) {
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
        cells: Object.freeze(columns.map((c) => Object.freeze({ fieldId: c.fieldId, value: cellValue(c, row, { resolveReference, resolveMoneyCell }) }))),
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
    emptyGuidance: emptyGuidanceFor(state, def),
  });
}

/**
 * WHY this collection exists, for a FIRST-RUN empty only.
 *
 * emptyMessage says a list is empty. It cannot say what the screen is for, and on a
 * first run that is the only question the reader actually has. This carries the answer
 * from the list DEFINITION, which is the one place that knows what the entity means --
 * rather than from each surface, which is how the same explanation ends up written
 * several times and drifting.
 *
 * EMPTY ONLY, and the restriction is the point. FILTERED means the reader already has
 * records and merely over-filtered; explaining what a work order is at that moment is
 * noise, and it would reappear on every filter change. DENIED and UNAVAILABLE are not
 * empties at all -- describing the collection there would imply the read succeeded and
 * found nothing, which is the specific wrong conclusion those states exist to prevent.
 *
 * Optional everywhere: a definition without `emptyGuidance` renders exactly as before.
 */
export function emptyGuidanceFor(state, def = null) {
  return state === "EMPTY" ? def?.emptyGuidance ?? null : null;
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

