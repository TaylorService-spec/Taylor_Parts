// Issue #325 / ADR-007 D-FN -- server-side TypeScript PORT of
// field-ops-app-vite/src/domain/reporting/reportQueryModel.js (unit F2).
// See reportCatalog.ts's header for the parity-test convention this
// port follows. PURE data -- no firebase-admin import.

export const DEFINITION_KEYS = Object.freeze([
  "objectId", "fields", "filters", "groupBy", "sort", "aggregates", "presentation",
]) as readonly string[];
export const FILTER_KEYS = Object.freeze(["fieldId", "op", "value"]) as readonly string[];
export const SORT_KEYS = Object.freeze(["fieldId", "direction"]) as readonly string[];
export const AGGREGATE_KEYS = Object.freeze(["fieldId", "fn"]) as readonly string[];

export const SORT_DIRECTIONS = Object.freeze(["asc", "desc"]) as readonly string[];

export const FIELD_AGGREGATE_FUNCTIONS = Object.freeze(["count", "sum", "avg", "min", "max"]) as readonly string[];
export const FIELDLESS_AGGREGATE_FUNCTIONS = Object.freeze(["countRows"]) as readonly string[];
export const AGGREGATE_FUNCTIONS = Object.freeze([
  ...FIELD_AGGREGATE_FUNCTIONS,
  ...FIELDLESS_AGGREGATE_FUNCTIONS,
]) as readonly string[];

export function isFieldlessAggregate(fn: unknown): boolean {
  return typeof fn === "string" && FIELDLESS_AGGREGATE_FUNCTIONS.includes(fn);
}

export const FILTER_COMPARATORS_BY_TYPE: Readonly<Record<string, readonly string[]>> = Object.freeze({
  string: Object.freeze(["eq", "ne", "contains", "startsWith", "in"]),
  number: Object.freeze(["eq", "ne", "gt", "gte", "lt", "lte", "in"]),
  boolean: Object.freeze(["eq", "ne"]),
  date: Object.freeze(["eq", "ne", "before", "after", "between"]),
  enum: Object.freeze(["eq", "ne", "in"]),
  reference: Object.freeze(["eq", "ne", "in"]),
  list: Object.freeze(["contains", "containsAny"]),
});

export const ARRAY_VALUE_COMPARATORS = Object.freeze(["in", "between", "containsAny"]) as readonly string[];
