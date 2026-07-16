// Issue #325 unit F2 -- the pure report QUERY-DEFINITION model (Spec §2 / §7).
//
// A "report definition" is INERT saved metadata: a base object, selected field ids, filters,
// grouping, sort, aggregates, and inert presentation. It carries NO data, NO results, and NO
// author privileges (ADR-007 §2.4). This module defines its shape and the legal comparator /
// aggregate / direction vocabularies -- it is DATA + pure helpers, no firebase, no engine, no
// read path. Validation lives in reportQueryValidation.js; the projection/predicate-drop/limit
// behavior of a RUN is the trusted Function's lane (D-FN), not here.
//
// The comparator and aggregate vocabularies below are the field-type-legal set the validator
// enforces. The catalog's per-field `operators` ({filter,sort,group,aggregate}) say WHICH
// categories a field supports; these say, once a field supports `filter`, which concrete
// comparators are well-typed for its `dataType`, and once it supports `aggregate`, which
// aggregate functions are legal.

// -- allowed keys (fail-closed: anything else is rejected, Spec §7) ------------

export const DEFINITION_KEYS = Object.freeze([
  "objectId", "fields", "filters", "groupBy", "sort", "aggregates", "presentation",
]);
export const FILTER_KEYS = Object.freeze(["fieldId", "op", "value"]);
export const SORT_KEYS = Object.freeze(["fieldId", "direction"]);
export const AGGREGATE_KEYS = Object.freeze(["fieldId", "fn"]);

export const SORT_DIRECTIONS = Object.freeze(["asc", "desc"]);

// Aggregate functions. Two shapes (Spec §7):
//  - FIELD-bound: applied to a field that supports the `aggregate` operator (number-only by the
//    catalog's LEGAL_OPERATORS_BY_TYPE construction -- "no aggregating a string"). Shape { fieldId, fn }.
//  - FIELDLESS: `countRows` counts the rows the run produced. It references NO field, so it needs
//    no field readCapability; it is bounded by the object gate and the runner's authorized row
//    set (§6), so it can only ever count rows the runner may already see. Shape { fn }.
export const FIELD_AGGREGATE_FUNCTIONS = Object.freeze(["count", "sum", "avg", "min", "max"]);
export const FIELDLESS_AGGREGATE_FUNCTIONS = Object.freeze(["countRows"]);
export const AGGREGATE_FUNCTIONS = Object.freeze([...FIELD_AGGREGATE_FUNCTIONS, ...FIELDLESS_AGGREGATE_FUNCTIONS]);

export function isFieldlessAggregate(fn) {
  return FIELDLESS_AGGREGATE_FUNCTIONS.includes(fn);
}

// Concrete filter comparators that are WELL-TYPED per data type (Spec §7: "Filters must be
// well-typed against the field dataType"). A field must ALSO declare the `filter` operator in
// its catalog entry before any of these apply; a free-text field (notes/accessNotes) declares
// no operators and is therefore never filterable. The value shape each comparator expects is
// enforced by the validator (single scalar vs. array for `in`/`between`).
export const FILTER_COMPARATORS_BY_TYPE = Object.freeze({
  string: Object.freeze(["eq", "ne", "contains", "startsWith", "in"]),
  number: Object.freeze(["eq", "ne", "gt", "gte", "lt", "lte", "in"]),
  boolean: Object.freeze(["eq", "ne"]),
  date: Object.freeze(["eq", "ne", "before", "after", "between"]),
  enum: Object.freeze(["eq", "ne", "in"]),
  reference: Object.freeze(["eq", "ne", "in"]),
  list: Object.freeze(["contains", "containsAny"]),
});

// Comparators whose value is an ARRAY rather than a single scalar.
export const ARRAY_VALUE_COMPARATORS = Object.freeze(["in", "between", "containsAny"]);

// A pure factory for an empty definition -- the builder UI (F3) starts from this. No side
// effects; returns a fresh, mutable plain object (NOT frozen, since the UI edits it).
export function createReportDefinition(objectId = null) {
  return {
    objectId,
    fields: [],
    filters: [],
    groupBy: [],
    sort: [],
    aggregates: [],
    presentation: {},
  };
}
