"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveDefinitionField = resolveDefinitionField;
exports.validateReportDefinition = validateReportDefinition;
// Issue #325 / ADR-007 D-FN -- server-side TypeScript PORT of
// field-ops-app-vite/src/domain/reporting/reportQueryValidation.js
// (unit F2), REUSED by the trusted execution service
// (reportExecutionService.ts) exactly as ADR-007 sec2.3/Spec sec7
// require ("the SAME validator is meant to be reused by the trusted
// execution Function so client and server agree on what a well-formed,
// in-catalog definition is"). See reportCatalog.ts's header for the
// parity-test convention this port follows.
//
// This validator answers only "is this definition structurally valid
// and in-catalog?" -- it does NOT resolve the runner's field-level READ
// access or apply the predicate-drop rule; that is
// reportExecutionService.ts's run-time job (Spec sec6), which re-
// evaluates live access and DROPS unreadable columns/predicates rather
// than refusing. Fail-closed everywhere: unknown/extra keys, unknown
// objects/fields, illegal operators, and mis-typed filter values are
// ERRORS, never silently ignored.
const reportCatalog_1 = require("./reportCatalog");
const reportQueryModel_1 = require("./reportQueryModel");
function isPlainObject(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
}
function isNonEmptyString(v) {
    return typeof v === "string" && v.trim() !== "";
}
function unknownKeys(obj, allowed) {
    return Object.keys(obj).filter((k) => !allowed.includes(k));
}
// Resolve a fieldId used in a definition against a base object: valid
// iff the field exists AND is either owned by the base object OR
// reachable by ONE catalogued hop=1 relationship from the base object
// (Spec sec7 relationship rule; no arbitrary paths).
function resolveDefinitionField(baseObjectId, fieldId) {
    const field = (0, reportCatalog_1.getReportField)(fieldId);
    if (!field)
        return null;
    if (field.objectId === baseObjectId)
        return { field, relationship: null };
    const rel = (0, reportCatalog_1.relationshipsFrom)(baseObjectId).find((r) => r.toObjectId === field.objectId && r.hop === 1);
    if (!rel)
        return null;
    return { field, relationship: rel };
}
function validateReportDefinition(def, options = {}) {
    const activatedObjectIds = options.activatedObjectIds ?? (0, reportCatalog_1.objectsWithPopulatedFields)().map((o) => o.objectId);
    const isActivated = (objectId) => activatedObjectIds.includes(objectId);
    const errors = [];
    if (!isPlainObject(def)) {
        return ["definition must be a plain object"];
    }
    const extra = unknownKeys(def, reportQueryModel_1.DEFINITION_KEYS);
    if (extra.length > 0)
        errors.push(`definition has unknown keys: ${extra.join(", ")}`);
    const baseId = def.objectId;
    const baseObject = isNonEmptyString(baseId) ? (0, reportCatalog_1.getReportObject)(baseId) : null;
    if (!isNonEmptyString(baseId)) {
        errors.push("definition.objectId is required");
    }
    else if (!baseObject) {
        errors.push(`unknown objectId: ${baseId}`);
    }
    else if (!isActivated(baseId)) {
        errors.push(`objectId ${baseId} is not activated`);
    }
    const resolveFor = (fieldId, where) => {
        if (!isNonEmptyString(fieldId)) {
            errors.push(`${where}: fieldId is required`);
            return null;
        }
        if (!baseObject)
            return null;
        const resolved = resolveDefinitionField(baseId, fieldId);
        if (!resolved) {
            errors.push(`${where}: ${fieldId} is not a field of ${baseId} or a one-hop relationship`);
            return null;
        }
        if (!isActivated(resolved.field.objectId)) {
            errors.push(`${where}: object ${resolved.field.objectId} of ${fieldId} is not activated`);
            return null;
        }
        return resolved;
    };
    if (def.fields !== undefined) {
        if (!Array.isArray(def.fields)) {
            errors.push("definition.fields must be an array");
        }
        else {
            const seen = new Set();
            for (const fieldId of def.fields) {
                if (seen.has(fieldId))
                    errors.push(`fields: duplicate ${String(fieldId)}`);
                seen.add(fieldId);
                resolveFor(fieldId, "fields");
            }
        }
    }
    if (def.filters !== undefined) {
        if (!Array.isArray(def.filters)) {
            errors.push("definition.filters must be an array");
        }
        else {
            def.filters.forEach((flt, i) => {
                const where = `filters[${i}]`;
                if (!isPlainObject(flt)) {
                    errors.push(`${where} must be an object`);
                    return;
                }
                const xk = unknownKeys(flt, reportQueryModel_1.FILTER_KEYS);
                if (xk.length > 0)
                    errors.push(`${where} has unknown keys: ${xk.join(", ")}`);
                const resolved = resolveFor(flt.fieldId, where);
                if (!resolved)
                    return;
                const { field } = resolved;
                if (!field.operators.includes("filter")) {
                    errors.push(`${where}: field ${field.fieldId} does not support filter`);
                    return;
                }
                const legal = reportQueryModel_1.FILTER_COMPARATORS_BY_TYPE[field.dataType] ?? [];
                if (!isNonEmptyString(flt.op) || !legal.includes(flt.op)) {
                    errors.push(`${where}: operator ${JSON.stringify(flt.op)} is not legal for ${field.dataType}`);
                    return;
                }
                const valueError = checkFilterValue(field.dataType, flt.op, flt.value);
                if (valueError)
                    errors.push(`${where}: ${valueError}`);
            });
        }
    }
    if (def.groupBy !== undefined) {
        if (!Array.isArray(def.groupBy)) {
            errors.push("definition.groupBy must be an array");
        }
        else {
            const seen = new Set();
            def.groupBy.forEach((fieldId) => {
                if (seen.has(fieldId))
                    errors.push(`groupBy: duplicate ${String(fieldId)}`);
                seen.add(fieldId);
                const resolved = resolveFor(fieldId, "groupBy");
                if (resolved && !resolved.field.operators.includes("group")) {
                    errors.push(`groupBy: field ${String(fieldId)} does not support group`);
                }
            });
        }
    }
    if (def.sort !== undefined) {
        if (!Array.isArray(def.sort)) {
            errors.push("definition.sort must be an array");
        }
        else {
            def.sort.forEach((s, i) => {
                const where = `sort[${i}]`;
                if (!isPlainObject(s)) {
                    errors.push(`${where} must be an object`);
                    return;
                }
                const xk = unknownKeys(s, reportQueryModel_1.SORT_KEYS);
                if (xk.length > 0)
                    errors.push(`${where} has unknown keys: ${xk.join(", ")}`);
                const resolved = resolveFor(s.fieldId, where);
                if (resolved && !resolved.field.operators.includes("sort")) {
                    errors.push(`${where}: field ${String(s.fieldId)} does not support sort`);
                }
                if (!reportQueryModel_1.SORT_DIRECTIONS.includes(s.direction)) {
                    errors.push(`${where}: direction must be one of ${reportQueryModel_1.SORT_DIRECTIONS.join("|")}`);
                }
            });
        }
    }
    if (def.aggregates !== undefined) {
        if (!Array.isArray(def.aggregates)) {
            errors.push("definition.aggregates must be an array");
        }
        else {
            def.aggregates.forEach((a, i) => {
                const where = `aggregates[${i}]`;
                if (!isPlainObject(a)) {
                    errors.push(`${where} must be an object`);
                    return;
                }
                const xk = unknownKeys(a, reportQueryModel_1.AGGREGATE_KEYS);
                if (xk.length > 0)
                    errors.push(`${where} has unknown keys: ${xk.join(", ")}`);
                if ((0, reportQueryModel_1.isFieldlessAggregate)(a.fn)) {
                    if (a.fieldId !== undefined)
                        errors.push(`${where}: ${String(a.fn)} takes no fieldId`);
                }
                else if (typeof a.fn === "string" && reportQueryModel_1.FIELD_AGGREGATE_FUNCTIONS.includes(a.fn)) {
                    const resolved = resolveFor(a.fieldId, where);
                    if (resolved && !resolved.field.operators.includes("aggregate")) {
                        errors.push(`${where}: field ${String(a.fieldId)} does not support aggregate`);
                    }
                }
                else {
                    errors.push(`${where}: fn must be one of ${reportQueryModel_1.AGGREGATE_FUNCTIONS.join("|")}`);
                }
            });
        }
    }
    if (baseObject) {
        const hasFields = Array.isArray(def.fields) && def.fields.length > 0;
        const hasAggs = Array.isArray(def.aggregates) && def.aggregates.length > 0;
        if (!hasFields && !hasAggs)
            errors.push("definition selects no fields and no aggregates");
        if ((hasAggs || (Array.isArray(def.groupBy) && def.groupBy.length > 0)) && Array.isArray(def.fields)) {
            const grouped = new Set(Array.isArray(def.groupBy) ? def.groupBy : []);
            for (const fieldId of def.fields) {
                if (!grouped.has(fieldId)) {
                    errors.push(`fields: ${String(fieldId)} must be grouped (added to groupBy) when the report groups or aggregates`);
                }
            }
        }
    }
    if (def.presentation !== undefined && !isPlainObject(def.presentation)) {
        errors.push("definition.presentation must be an object");
    }
    return errors;
}
function checkFilterValue(dataType, op, value) {
    const wantsArray = reportQueryModel_1.ARRAY_VALUE_COMPARATORS.includes(op);
    if (wantsArray) {
        if (!Array.isArray(value) || value.length === 0)
            return `${op} requires a non-empty array value`;
        if (op === "between" && value.length !== 2)
            return "between requires exactly two values";
        for (const v of value) {
            const e = checkScalar(dataType, v);
            if (e)
                return `array value ${e}`;
        }
        return null;
    }
    if (Array.isArray(value))
        return `${op} requires a single value, not an array`;
    return checkScalar(dataType, value);
}
function checkScalar(dataType, value) {
    switch (dataType) {
        case "number":
            return typeof value === "number" && Number.isFinite(value) ? null : "must be a finite number";
        case "boolean":
            return typeof value === "boolean" ? null : "must be a boolean";
        case "date":
            if (typeof value === "number" && Number.isFinite(value))
                return null;
            if (typeof value === "string" && !Number.isNaN(Date.parse(value)))
                return null;
            return "must be an ISO-8601 date string or epoch-ms number";
        case "string":
        case "enum":
        case "reference":
        case "list":
            return typeof value === "string" ? null : "must be a string";
        default:
            return `unsupported data type ${dataType}`;
    }
}
//# sourceMappingURL=reportQueryValidation.js.map