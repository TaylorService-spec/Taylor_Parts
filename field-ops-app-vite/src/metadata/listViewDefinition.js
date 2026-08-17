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
 * The composite indexes a definition demands.
 *
 * Firestore needs one per equality-filter set + ordered fields. This derives them so
 * CI can prove firestore.indexes.json actually covers what the metadata promises,
 * rather than discovering the gap as a failed query in front of a user.
 *
 * Range/inequality operators are reported alongside so the caller can apply
 * Firestore's own constraint (an inequality must be the first ordered field).
 */
export function requiredIndexes(def, entity) {
  if (!def || !entity) return [];
  const collection = entity.collection;
  if (!collection) return []; // CALLABLE-read entities are the server's problem, not an index's

  const equalityFields = [];
  const rangeFields = [];
  for (const f of def.filters ?? []) {
    const ops = f.operators ?? [];
    const isRange = ops.some((o) => ["GREATER_THAN", "GREATER_OR_EQUAL", "LESS_THAN", "LESS_OR_EQUAL"].includes(o));
    (isRange ? rangeFields : equalityFields).push(f.fieldId);
  }

  const ordered = [
    ...(def.defaultSort ?? []).map((s) => ({ fieldPath: s.fieldId, order: s.direction })),
    { fieldPath: def.tiebreaker === "__name__" ? "__name__" : def.tiebreaker, order: "ASC" },
  ];

  // A single-field equality with no explicit ordering needs no composite index —
  // Firestore's automatic single-field indexes cover it. Reporting one anyway would
  // train people to ignore the output.
  if (equalityFields.length === 0 && rangeFields.length === 0 && (def.defaultSort ?? []).length === 0) return [];

  return [
    Object.freeze({
      collectionGroup: collection,
      queryScope: "COLLECTION",
      fields: Object.freeze([
        ...equalityFields.map((fieldPath) => ({ fieldPath, order: "ASC" })),
        ...rangeFields.map((fieldPath) => ({ fieldPath, order: "ASC" })),
        ...ordered,
      ]),
      requiredBy: def.id,
    }),
  ];
}

/** Stable key for comparing a required index against a declared one. */
export function indexKey(index) {
  const fields = (index.fields ?? [])
    .filter((f) => f.fieldPath !== "__name__") // Firestore appends this implicitly
    .map((f) => `${f.fieldPath}:${f.order ?? f.arrayConfig ?? "ASC"}`)
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
