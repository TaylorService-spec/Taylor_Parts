// Issue #325 unit F2 -- the pure, server-shaped report-definition VALIDATOR (Spec §7).
//
// Validates an inert report definition (reportQueryModel.js) against the governed catalog
// (reportCatalog.js). PURE: no firebase, no engine, no read path. The SAME validator is meant
// to be reused by the trusted execution Function (D-FN) so client and server agree on what a
// well-formed, in-catalog definition is (Spec §7). It answers only "is this definition
// structurally valid and in-catalog for save?" -- it does NOT resolve the runner's field-level
// READ access or apply the predicate-drop rule; that is the Function's run-time job (§6), which
// re-evaluates live access and DROPS unreadable columns/predicates rather than refusing. The
// difference: this validator is "never valid" (refuse on save); §6 is "no longer fully
// authorized" (run with parts dropped). See Spec §7 final bullet.
//
// Fail-closed everywhere: unknown/extra keys, unknown objects/fields, illegal operators, and
// mis-typed filter values are ERRORS, never silently ignored.

import {
  getReportObject, getReportField, relationshipsFrom, objectsWithPopulatedFields,
} from "./reportCatalog.js";
import {
  DEFINITION_KEYS, FILTER_KEYS, SORT_KEYS, AGGREGATE_KEYS,
  SORT_DIRECTIONS, AGGREGATE_FUNCTIONS, FILTER_COMPARATORS_BY_TYPE, ARRAY_VALUE_COMPARATORS,
} from "./reportQueryModel.js";

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function isNonEmptyString(v) {
  return typeof v === "string" && v.trim() !== "";
}
function unknownKeys(obj, allowed) {
  return Object.keys(obj).filter((k) => !allowed.includes(k));
}

// Resolve a fieldId used in a definition against a base object: it is valid iff the field
// exists AND is either owned by the base object OR reachable by ONE catalogued hop=1
// relationship from the base object (Spec §7 relationship rule; no arbitrary paths). Returns
// { field, relationship } (relationship null for a base-owned field) or null if unresolvable.
export function resolveDefinitionField(baseObjectId, fieldId) {
  const field = getReportField(fieldId);
  if (!field) return null;
  if (field.objectId === baseObjectId) return { field, relationship: null };
  const rel = relationshipsFrom(baseObjectId).find((r) => r.toObjectId === field.objectId && r.hop === 1);
  if (!rel) return null; // arbitrary/multi-hop or unrelated object -> not reportable from here
  return { field, relationship: rel };
}

// Validate a definition against the catalog. `activatedObjectIds` is the set of object ids that
// are activated for this validation; it is INJECTED so the pure module has no runtime "on"
// flag -- F1/F2 default it to the objects whose field catalogs are populated (wave-1), and the
// Function passes its real activated set. Returns string[] (empty == valid). Messages are for
// developers/tests and safe copy; a field the runner may not read is NOT this layer's concern.
export function validateReportDefinition(def, options = {}) {
  const activatedObjectIds = options.activatedObjectIds
    ?? objectsWithPopulatedFields().map((o) => o.objectId);
  const isActivated = (objectId) => activatedObjectIds.includes(objectId);
  const errors = [];

  if (!isPlainObject(def)) {
    return ["definition must be a plain object"];
  }
  const extra = unknownKeys(def, DEFINITION_KEYS);
  if (extra.length > 0) errors.push(`definition has unknown keys: ${extra.join(", ")}`);

  // -- base object --
  const baseId = def.objectId;
  const baseObject = isNonEmptyString(baseId) ? getReportObject(baseId) : null;
  if (!isNonEmptyString(baseId)) {
    errors.push("definition.objectId is required");
  } else if (!baseObject) {
    errors.push(`unknown objectId: ${baseId}`);
  } else if (!isActivated(baseId)) {
    errors.push(`objectId ${baseId} is not activated`);
  }

  // Helper: resolve + activation-gate a fieldId used anywhere in the definition. Pushes an
  // error and returns null when unresolvable/unactivated, so each clause can bail cleanly.
  const resolveFor = (fieldId, where) => {
    if (!isNonEmptyString(fieldId)) { errors.push(`${where}: fieldId is required`); return null; }
    if (!baseObject) return null; // base already errored; don't cascade misleading messages
    const resolved = resolveDefinitionField(baseId, fieldId);
    if (!resolved) { errors.push(`${where}: ${fieldId} is not a field of ${baseId} or a one-hop relationship`); return null; }
    if (!isActivated(resolved.field.objectId)) { errors.push(`${where}: object ${resolved.field.objectId} of ${fieldId} is not activated`); return null; }
    return resolved;
  };

  // -- fields (selected columns) --
  if (def.fields !== undefined) {
    if (!Array.isArray(def.fields)) {
      errors.push("definition.fields must be an array");
    } else {
      const seen = new Set();
      for (const fieldId of def.fields) {
        if (seen.has(fieldId)) errors.push(`fields: duplicate ${fieldId}`);
        seen.add(fieldId);
        resolveFor(fieldId, "fields");
      }
    }
  }

  // -- filters -- each { fieldId, op, value }; op well-typed for the field's dataType, and the
  // field must declare the `filter` operator (a free-text notes field declares none).
  if (def.filters !== undefined) {
    if (!Array.isArray(def.filters)) {
      errors.push("definition.filters must be an array");
    } else {
      def.filters.forEach((flt, i) => {
        const where = `filters[${i}]`;
        if (!isPlainObject(flt)) { errors.push(`${where} must be an object`); return; }
        const xk = unknownKeys(flt, FILTER_KEYS);
        if (xk.length > 0) errors.push(`${where} has unknown keys: ${xk.join(", ")}`);
        const resolved = resolveFor(flt.fieldId, where);
        if (!resolved) return;
        const { field } = resolved;
        if (!field.operators.includes("filter")) {
          errors.push(`${where}: field ${field.fieldId} does not support filter`);
          return;
        }
        const legal = FILTER_COMPARATORS_BY_TYPE[field.dataType] ?? [];
        if (!isNonEmptyString(flt.op) || !legal.includes(flt.op)) {
          errors.push(`${where}: operator ${JSON.stringify(flt.op)} is not legal for ${field.dataType}`);
          return;
        }
        const valueError = checkFilterValue(field.dataType, flt.op, flt.value);
        if (valueError) errors.push(`${where}: ${valueError}`);
      });
    }
  }

  // -- groupBy -- field must support `group`.
  if (def.groupBy !== undefined) {
    if (!Array.isArray(def.groupBy)) {
      errors.push("definition.groupBy must be an array");
    } else {
      const seen = new Set();
      def.groupBy.forEach((fieldId) => {
        if (seen.has(fieldId)) errors.push(`groupBy: duplicate ${fieldId}`);
        seen.add(fieldId);
        const resolved = resolveFor(fieldId, "groupBy");
        if (resolved && !resolved.field.operators.includes("group")) {
          errors.push(`groupBy: field ${fieldId} does not support group`);
        }
      });
    }
  }

  // -- sort -- each { fieldId, direction }; field must support `sort`.
  if (def.sort !== undefined) {
    if (!Array.isArray(def.sort)) {
      errors.push("definition.sort must be an array");
    } else {
      def.sort.forEach((s, i) => {
        const where = `sort[${i}]`;
        if (!isPlainObject(s)) { errors.push(`${where} must be an object`); return; }
        const xk = unknownKeys(s, SORT_KEYS);
        if (xk.length > 0) errors.push(`${where} has unknown keys: ${xk.join(", ")}`);
        const resolved = resolveFor(s.fieldId, where);
        if (resolved && !resolved.field.operators.includes("sort")) {
          errors.push(`${where}: field ${s.fieldId} does not support sort`);
        }
        if (!SORT_DIRECTIONS.includes(s.direction)) {
          errors.push(`${where}: direction must be one of ${SORT_DIRECTIONS.join("|")}`);
        }
      });
    }
  }

  // -- aggregates -- each { fieldId, fn }; field must support `aggregate` (number-only by the
  // catalog's construction), fn must be a known aggregate function.
  if (def.aggregates !== undefined) {
    if (!Array.isArray(def.aggregates)) {
      errors.push("definition.aggregates must be an array");
    } else {
      def.aggregates.forEach((a, i) => {
        const where = `aggregates[${i}]`;
        if (!isPlainObject(a)) { errors.push(`${where} must be an object`); return; }
        const xk = unknownKeys(a, AGGREGATE_KEYS);
        if (xk.length > 0) errors.push(`${where} has unknown keys: ${xk.join(", ")}`);
        const resolved = resolveFor(a.fieldId, where);
        if (resolved && !resolved.field.operators.includes("aggregate")) {
          errors.push(`${where}: field ${a.fieldId} does not support aggregate`);
        }
        if (!AGGREGATE_FUNCTIONS.includes(a.fn)) {
          errors.push(`${where}: fn must be one of ${AGGREGATE_FUNCTIONS.join("|")}`);
        }
      });
    }
  }

  // A definition must project SOMETHING: at least one field or one aggregate (an object with no
  // columns and no aggregates is not a report). Only enforced once the base object is valid.
  if (baseObject) {
    const hasFields = Array.isArray(def.fields) && def.fields.length > 0;
    const hasAggs = Array.isArray(def.aggregates) && def.aggregates.length > 0;
    if (!hasFields && !hasAggs) errors.push("definition selects no fields and no aggregates");
  }

  // -- presentation -- inert display metadata; must be an object if present, not validated for
  // authorization (it can never widen access).
  if (def.presentation !== undefined && !isPlainObject(def.presentation)) {
    errors.push("definition.presentation must be an object");
  }

  return errors;
}

// Returns an error string if `value` is not well-typed for (dataType, op), else null.
function checkFilterValue(dataType, op, value) {
  const wantsArray = ARRAY_VALUE_COMPARATORS.includes(op);
  if (wantsArray) {
    if (!Array.isArray(value) || value.length === 0) return `${op} requires a non-empty array value`;
    if (op === "between" && value.length !== 2) return "between requires exactly two values";
    for (const v of value) {
      const e = checkScalar(dataType, v);
      if (e) return `array value ${e}`;
    }
    return null;
  }
  if (Array.isArray(value)) return `${op} requires a single value, not an array`;
  return checkScalar(dataType, value);
}

// Well-typedness of a single scalar against a data type. References and enums compare by string
// id/value; dates accept an ISO-8601 string or an epoch-ms number.
function checkScalar(dataType, value) {
  switch (dataType) {
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? null : "must be a finite number";
    case "boolean":
      return typeof value === "boolean" ? null : "must be a boolean";
    case "date":
      if (typeof value === "number" && Number.isFinite(value)) return null;
      if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return null;
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
