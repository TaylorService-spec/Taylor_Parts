// EOS Metadata — ListViewDefinition (Entity List Metadata v1).
//
// GOVERNANCE: docs/governance/metadata-architecture-ip-boundary.md,
// docs/specifications/metadata-architecture.md §6, DECISIONS #102.
//
// Declares HOW A COLLECTION IS SHAPED AND DISPLAYED, and nothing else. It is a
// separate layer from EntityDefinition (what exists) and from the future
// PageDefinition (how a record is composed) — boundary §7 names collapsing those
// into one page schema as the failure mode.
//
// A definition is DATA. It never queries, never renders, never authorizes. A
// runtime consumes it; validators check it; nothing here executes.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE THREE PROPERTIES THIS EXISTS TO ENFORCE
//
// 1. A DECLARED FILTER IS A PROMISE THE BACKEND MUST KEEP (§9, Owner ruling on
//    index governance). Every filter+sort combination a definition permits needs a
//    Firestore composite index. Metadata that offers a filter the query layer
//    cannot serve is metadata that lies, and it fails at runtime for the user
//    rather than at build time for us. `requiredIndexes()` derives exactly what a
//    definition demands so CI can compare it against firestore.indexes.json.
//
// 2. SORT ORDER MUST BE TOTAL. Firestore pages by cursor; if the sort key ties,
//    rows duplicate or vanish across page boundaries. Every definition therefore
//    carries a tiebreaker, and the validator rejects one that does not. This is
//    the single most common way a paginated list silently corrupts itself, and
//    useInstalledEquipmentPage.js already avoids it by ordering on documentId().
//
// 3. NO CLIENT-SIDE DATASET OWNERSHIP (§9). A definition cannot express "read the
//    collection and filter locally". Page size is bounded, pagination is cursor-
//    based, and there is deliberately no offset/page-number concept: offset paging
//    bills for every skipped document and invites "jump to page 40" on a 250k-row
//    collection.
// ─────────────────────────────────────────────────────────────────────────────

import { FIELD_OPERATOR, findField } from "./entityDefinition.js";

/** Sort direction. */
export const SORT_DIRECTION = Object.freeze(["ASC", "DESC"]);

/**
 * How a list surface presents itself. The SAME definition serves both — a related
 * section is a lighter configuration of one runtime, not a second implementation.
 *
 *   INDEX    full surface: paging controls, filter bar, saved views
 *   RELATED  embedded in a record: few columns, capped rows, no paging controls,
 *            a "view all" that hands off to the INDEX pre-filtered by parent
 */
export const LIST_SURFACE = Object.freeze(["INDEX", "RELATED"]);

/** Page-size ceiling. Not a preference — the §9 rule expressed as a number. */
export const MAX_PAGE_SIZE = 200;
export const MAX_RELATED_ROWS = 25;

/** A column: a field reference plus how it is displayed. Never a renderer function. */
export function makeColumn(input = {}) {
  return Object.freeze({
    fieldId: input.fieldId,
    label: input.label ?? null, // null = inherit the FieldDefinition's label
    renderer: input.renderer ?? null, // REGISTERED renderer id
    sortable: input.sortable ?? false,
    width: input.width ?? null,
  });
}

/** A declared, indexed filter. `operators` must be a subset of the field's own. */
export function makeFilter(input = {}) {
  return Object.freeze({
    fieldId: input.fieldId,
    operators: Object.freeze([...(input.operators ?? [])]),
    required: input.required ?? false,
  });
}

/** One sort clause. */
export function makeSort(input = {}) {
  return Object.freeze({ fieldId: input.fieldId, direction: input.direction ?? "ASC" });
}

/**
 * A named saved view. `RECENTLY_VIEWED` is the landing view for INDEX surfaces:
 * at enterprise volume an unfiltered first page of 250,000 records answers nobody's
 * question, so the default state of a list is not "everything".
 */
export function makeSavedView(input = {}) {
  return Object.freeze({
    id: input.id,
    label: input.label,
    kind: input.kind ?? "STATIC", // STATIC | RECENTLY_VIEWED | MINE
    filters: Object.freeze([...(input.filters ?? [])]),
    sort: Object.freeze([...(input.sort ?? [])]),
    isDefault: input.isDefault ?? false,
  });
}

export const SAVED_VIEW_KIND = Object.freeze(["STATIC", "RECENTLY_VIEWED", "MINE"]);

export function makeListViewDefinition(input = {}) {
  return Object.freeze({
    id: input.id,
    entityId: input.entityId,
    label: input.label,
    surface: input.surface ?? "INDEX",
    columns: Object.freeze([...(input.columns ?? [])]),
    filters: Object.freeze([...(input.filters ?? [])]),
    defaultSort: Object.freeze([...(input.defaultSort ?? [])]),
    // The total-order guarantee. Appended after defaultSort so the composite key can
    // never tie. Defaults to documentId(), the one field every document has.
    tiebreaker: input.tiebreaker ?? "__name__",
    pageSize: input.pageSize ?? 50,
    savedViews: Object.freeze([...(input.savedViews ?? [])]),
    // RELATED only: the relationship whose viaField scopes rows to the parent record.
    parentRelationshipId: input.parentRelationshipId ?? null,
    // RELATED only: where "view all" hands off, pre-filtered by parent.
    viewAllListId: input.viewAllListId ?? null,
    rowNavigationTo: input.rowNavigationTo ?? null, // route template, e.g. /customers/:id
    rowActions: Object.freeze([...(input.rowActions ?? [])]), // REGISTERED action ids
    capabilityRequirement: input.capabilityRequirement ?? null,
  });
}

/**
 * Validate a definition against the entity it lists.
 *
 * The entity is REQUIRED, not optional: a list of columns that reference fields
 * nobody checked exist is precisely the metadata-that-lies problem, and validating a
 * definition in isolation would give false confidence.
 */
export function validateListViewDefinition(def, entity) {
  const problems = [];
  const at = def?.id ? `list ${def.id}` : "list (no id)";

  if (!def?.id || typeof def.id !== "string") problems.push(`${at}: id is required`);
  if (!def?.label) problems.push(`${at}: label is required`);
  if (def?.id && def.id === def.label) problems.push(`${at}: id and label must be distinct concepts`);
  if (!LIST_SURFACE.includes(def?.surface)) problems.push(`${at}: surface "${def?.surface}" is not a known LIST_SURFACE`);

  if (!entity?.id) {
    problems.push(`${at}: an entity is required to validate against — a list cannot be checked in isolation`);
    return problems;
  }
  if (def.entityId !== entity.id) problems.push(`${at}: entityId "${def.entityId}" does not match entity "${entity.id}"`);

  // Columns
  if (!def.columns?.length) problems.push(`${at}: at least one column is required`);
  const seenCols = new Set();
  for (const col of def.columns ?? []) {
    if (!col?.fieldId) { problems.push(`${at}: a column is missing fieldId`); continue; }
    if (seenCols.has(col.fieldId)) problems.push(`${at}: duplicate column "${col.fieldId}"`);
    seenCols.add(col.fieldId);
    const field = findField(entity, col.fieldId);
    if (!field) { problems.push(`${at}: column "${col.fieldId}" is not a field on ${entity.id}`); continue; }
    if (col.sortable && !field.sortable) {
      problems.push(`${at}: column "${col.fieldId}" is sortable but the field is not — sorting needs an indexed field`);
    }
    if (typeof col.renderer === "function") {
      problems.push(`${at}: column "${col.fieldId}" renderer must be a registered id, never a function (boundary §8)`);
    }
  }

  // Filters — the promise-keeping check.
  for (const f of def.filters ?? []) {
    const field = findField(entity, f?.fieldId);
    if (!field) { problems.push(`${at}: filter "${f?.fieldId}" is not a field on ${entity.id}`); continue; }
    if (!field.filterable) {
      problems.push(
        `${at}: filter "${f.fieldId}" targets a field not declared filterable — a list must not offer a filter ` +
          `the query layer cannot serve`
      );
    }
    if (!f.operators?.length) problems.push(`${at}: filter "${f.fieldId}" declares no operators`);
    for (const op of f.operators ?? []) {
      if (!FIELD_OPERATOR.includes(op)) { problems.push(`${at}: filter "${f.fieldId}" operator "${op}" is unknown`); continue; }
      if (!field.operators.includes(op)) {
        problems.push(
          `${at}: filter "${f.fieldId}" offers operator "${op}" which the field does not support — ` +
            `a list may narrow a field's operators, never widen them`
        );
      }
    }
  }

  // Sorting and the total-order guarantee.
  for (const s of def.defaultSort ?? []) {
    const field = findField(entity, s?.fieldId);
    if (!field) { problems.push(`${at}: sort "${s?.fieldId}" is not a field on ${entity.id}`); continue; }
    if (!field.sortable) problems.push(`${at}: sort "${s.fieldId}" targets a field not declared sortable`);
    if (!SORT_DIRECTION.includes(s.direction)) problems.push(`${at}: sort "${s.fieldId}" direction "${s.direction}" is unknown`);
  }
  if (!def.tiebreaker) {
    problems.push(
      `${at}: a tiebreaker is required — without a total order, cursor pagination duplicates or drops rows ` +
        `wherever the sort key ties`
    );
  }
  if (def.tiebreaker && def.tiebreaker !== "__name__" && !findField(entity, def.tiebreaker)) {
    problems.push(`${at}: tiebreaker "${def.tiebreaker}" is not a field on ${entity.id}`);
  }
  if ((def.defaultSort ?? []).some((s) => s.fieldId === def.tiebreaker)) {
    problems.push(`${at}: tiebreaker "${def.tiebreaker}" also appears in defaultSort — it cannot break its own tie`);
  }

  if ((def?.filters ?? []).length > MAX_DECLARED_FILTERS) {
    // Exponential in the optional filters: five already means dozens of composites, which
    // nobody reviews and Firestore charges for. A list needing that many filters wants a
    // search index, not a bigger pile of composites.
    problems.push(
      `${at}: declares ${def.filters.length} filters; more than ${MAX_DECLARED_FILTERS} makes the required index set unreviewable`
    );
  }

  // Bounded reads.
  if (!Number.isInteger(def.pageSize) || def.pageSize <= 0) {
    problems.push(`${at}: pageSize must be a positive integer`);
  } else if (def.pageSize > MAX_PAGE_SIZE) {
    problems.push(`${at}: pageSize ${def.pageSize} exceeds MAX_PAGE_SIZE ${MAX_PAGE_SIZE} (boundary §9)`);
  }

  // Surface-specific rules.
  if (def.surface === "RELATED") {
    if (!def.parentRelationshipId) {
      problems.push(
        `${at}: a RELATED list requires parentRelationshipId — without it the section has no parent key and ` +
          `would render every record of the target entity`
      );
    } else if (!(entity.relationships ?? []).some((r) => r.id === def.parentRelationshipId)) {
      problems.push(`${at}: parentRelationshipId "${def.parentRelationshipId}" is not a relationship on ${entity.id}`);
    }
    if (!def.viewAllListId) {
      problems.push(`${at}: a RELATED list requires viewAllListId — a capped section must be able to hand off to the full list`);
    }
    if (def.pageSize > MAX_RELATED_ROWS) {
      problems.push(`${at}: a RELATED section shows at most ${MAX_RELATED_ROWS} rows; use viewAllListId for the rest`);
    }
    if (def.savedViews?.length) problems.push(`${at}: saved views belong to INDEX surfaces, not embedded sections`);
  }

  if (def.surface === "INDEX") {
    if (def.parentRelationshipId) problems.push(`${at}: parentRelationshipId is meaningful only on a RELATED list`);
    const defaults = (def.savedViews ?? []).filter((v) => v.isDefault);
    if (defaults.length > 1) problems.push(`${at}: more than one saved view is marked default`);
    for (const v of def.savedViews ?? []) {
      if (!SAVED_VIEW_KIND.includes(v?.kind)) problems.push(`${at}: saved view "${v?.id}" kind "${v?.kind}" is unknown`);
    }
  }

  return problems;
}

/**
 * Sort direction in Firestore's own vocabulary.
 *
 * A sort clause says ASC/DESC because that is the metadata vocabulary. A required index
 * is something a human PASTES INTO firestore.indexes.json, where Firestore accepts only
 * ASCENDING/DESCENDING -- so emitting the metadata spelling produced a demand that read
 * correctly, compared unequal against every existing declaration, and would have been
 * rejected by the deploy if anyone had pasted it. Translating at this boundary keeps one
 * vocabulary on each side of it.
 */
export function firestoreOrder(direction) {
  if (direction === "DESC" || direction === "DESCENDING") return "DESCENDING";
  return "ASCENDING";
}

/** More than this many optional filters and the index set stops being reviewable. */
export const MAX_DECLARED_FILTERS = 4;

const RANGE_OPERATORS = ["GREATER_THAN", "GREATER_OR_EQUAL", "LESS_THAN", "LESS_OR_EQUAL"];
const ARRAY_OPERATORS = ["ARRAY_CONTAINS", "ARRAY_CONTAINS_ANY"];

const classify = (filter) => {
  const ops = filter.operators ?? [];
  if (ops.some((o) => ARRAY_OPERATORS.includes(o))) return "ARRAY";
  if (ops.some((o) => RANGE_OPERATORS.includes(o))) return "RANGE";
  return "EQUALITY";
};

/** Every subset of a list, declaration order preserved. */
function subsets(items) {
  return items.reduce((acc, item) => [...acc, ...acc.map((set) => [...set, item])], [[]]);
}

/**
 * The composite indexes a definition demands.
 *
 * ONE INDEX PER FILTER COMBINATION, NOT ONE PER DEFINITION. This used to emit a single
 * index containing every declared filter plus the sort, which reads as thorough and is
 * wrong: Firestore will not serve a query filtering on a SUBSET from that index. A list
 * declaring status and relationshipTypes, both optional, can be queried four ways —
 * neither, either, both — and three of those need their own index. The old derivation
 * therefore let CI pass while two of the three real queries would fail in front of a
 * user, which is the exact failure the coverage gate exists to prevent.
 *
 * A filter marked `required` is in every query, so it is in every index rather than
 * doubling the set.
 *
 * ARRAY FILTERS USE arrayConfig, NOT order. `array-contains` is not an ascending scan,
 * and an index declaring it as one is rejected by the deploy. Firestore permits at most
 * one array filter per query, so each array filter produces its own family rather than
 * combining with the others.
 *
 * The count is exponential in the number of optional filters, which is why
 * MAX_DECLARED_FILTERS exists: past four, nobody can review the index list, and a
 * definition that needs that many filters wants a search index rather than composites.
 */
export function requiredIndexes(def, entity) {
  if (!def || !entity) return [];
  const collection = entity.collection;
  if (!collection) return []; // CALLABLE-read entities are the server's problem, not an index's

  const filters = def.filters ?? [];
  const equality = filters.filter((f) => classify(f) === "EQUALITY");
  const ranges = filters.filter((f) => classify(f) === "RANGE");
  const arrays = filters.filter((f) => classify(f) === "ARRAY");

  const ordered = [
    ...(def.defaultSort ?? []).map((s) => ({ fieldPath: s.fieldId, order: firestoreOrder(s.direction) })),
    { fieldPath: def.tiebreaker === "__name__" ? "__name__" : def.tiebreaker, order: firestoreOrder("ASC") },
  ];

  // Nothing filtered and nothing ordered needs no composite — Firestore's automatic
  // single-field indexes cover it, and reporting one anyway trains people to ignore the
  // output.
  if (filters.length === 0 && (def.defaultSort ?? []).length === 0) return [];

  const alwaysEquality = equality.filter((f) => f.required);
  const optionalEquality = equality.filter((f) => !f.required);
  const alwaysRange = ranges.filter((f) => f.required);
  const optionalRange = ranges.filter((f) => !f.required);

  // An array filter is optional unless declared required; `null` is the no-array case.
  const arrayChoices = arrays.some((f) => f.required) ? arrays : [null, ...arrays];

  const indexes = [];
  const seen = new Set();
  for (const eqSubset of subsets(optionalEquality)) {
    for (const rangeSubset of subsets(optionalRange)) {
      for (const arrayFilter of arrayChoices) {
        const eqFields = [...alwaysEquality, ...eqSubset];
        const rangeFields = [...alwaysRange, ...rangeSubset];
        // The unfiltered query is served by the sort alone; it still needs its index when
        // the sort is composite, and `ordered` always carries the tiebreaker.
        const fields = [
          ...eqFields.map((f) => ({ fieldPath: f.fieldId, order: firestoreOrder("ASC") })),
          // Firestore's own ordering constraint: equality, then the array filter, then
          // inequalities, then the ordered fields.
          ...(arrayFilter ? [{ fieldPath: arrayFilter.fieldId, arrayConfig: "CONTAINS" }] : []),
          ...rangeFields.map((f) => ({ fieldPath: f.fieldId, order: firestoreOrder("ASC") })),
          ...ordered,
        ];
        const candidate = Object.freeze({
          collectionGroup: collection,
          queryScope: "COLLECTION",
          fields: Object.freeze(fields),
          requiredBy: def.id,
        });
        // The unfiltered, single-field-ordered query is served by Firestore's AUTOMATIC
        // single-field index — the documentId tiebreaker is implicit there. Demanding a
        // composite for it would force a redundant declaration and, worse, train people
        // to ignore a gate that reports indexes nobody needs.
        const realSortFields = (def.defaultSort ?? []).length;
        if (eqFields.length === 0 && rangeFields.length === 0 && !arrayFilter && realSortFields <= 1) continue;

        const key = indexKey(candidate);
        if (seen.has(key)) continue;
        seen.add(key);
        indexes.push(candidate);
      }
    }
  }
  return indexes;
}

/** Stable key for comparing a required index against a declared one. */
export function indexKey(index) {
  const fields = (index.fields ?? [])
    .filter((f) => f.fieldPath !== "__name__") // Firestore appends this implicitly
    // Normalized, so a declaration written ASCENDING and a demand written ASC are one
    // index rather than two -- the difference is spelling, not identity.
    .map((f) => `${f.fieldPath}:${f.arrayConfig ?? firestoreOrder(f.order)}`)
    .join(",");
  return `${index.collectionGroup}|${index.queryScope ?? "COLLECTION"}|${fields}`;
}

/**
 * Compare what the metadata demands against what the repository declares.
 * Returns the demands with no declared index — the set CI must fail on.
 */
export function missingIndexes(required, declared) {
  const have = new Set((declared ?? []).map(indexKey));
  return (required ?? []).filter((r) => !have.has(indexKey(r)));
}
