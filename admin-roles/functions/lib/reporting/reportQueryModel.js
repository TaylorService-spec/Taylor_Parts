"use strict";
// Issue #325 / ADR-007 D-FN -- server-side TypeScript PORT of
// field-ops-app-vite/src/domain/reporting/reportQueryModel.js (unit F2).
// See reportCatalog.ts's header for the parity-test convention this
// port follows. PURE data -- no firebase-admin import.
Object.defineProperty(exports, "__esModule", { value: true });
exports.ARRAY_VALUE_COMPARATORS = exports.FILTER_COMPARATORS_BY_TYPE = exports.AGGREGATE_FUNCTIONS = exports.FIELDLESS_AGGREGATE_FUNCTIONS = exports.FIELD_AGGREGATE_FUNCTIONS = exports.SORT_DIRECTIONS = exports.AGGREGATE_KEYS = exports.SORT_KEYS = exports.FILTER_KEYS = exports.DEFINITION_KEYS = void 0;
exports.isFieldlessAggregate = isFieldlessAggregate;
exports.DEFINITION_KEYS = Object.freeze([
    "objectId", "fields", "filters", "groupBy", "sort", "aggregates", "presentation",
]);
exports.FILTER_KEYS = Object.freeze(["fieldId", "op", "value"]);
exports.SORT_KEYS = Object.freeze(["fieldId", "direction"]);
exports.AGGREGATE_KEYS = Object.freeze(["fieldId", "fn"]);
exports.SORT_DIRECTIONS = Object.freeze(["asc", "desc"]);
exports.FIELD_AGGREGATE_FUNCTIONS = Object.freeze(["count", "sum", "avg", "min", "max"]);
exports.FIELDLESS_AGGREGATE_FUNCTIONS = Object.freeze(["countRows"]);
exports.AGGREGATE_FUNCTIONS = Object.freeze([
    ...exports.FIELD_AGGREGATE_FUNCTIONS,
    ...exports.FIELDLESS_AGGREGATE_FUNCTIONS,
]);
function isFieldlessAggregate(fn) {
    return typeof fn === "string" && exports.FIELDLESS_AGGREGATE_FUNCTIONS.includes(fn);
}
exports.FILTER_COMPARATORS_BY_TYPE = Object.freeze({
    string: Object.freeze(["eq", "ne", "contains", "startsWith", "in"]),
    number: Object.freeze(["eq", "ne", "gt", "gte", "lt", "lte", "in"]),
    boolean: Object.freeze(["eq", "ne"]),
    date: Object.freeze(["eq", "ne", "before", "after", "between"]),
    enum: Object.freeze(["eq", "ne", "in"]),
    reference: Object.freeze(["eq", "ne", "in"]),
    list: Object.freeze(["contains", "containsAny"]),
});
exports.ARRAY_VALUE_COMPARATORS = Object.freeze(["in", "between", "containsAny"]);
//# sourceMappingURL=reportQueryModel.js.map