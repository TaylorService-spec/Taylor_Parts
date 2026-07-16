// Issue #325 unit F3 -- pure model for the report BUILDER (object-first authoring).
//
// Derivations (which objects/fields are offerable) and non-mutating reducers (edit a definition)
// the ReportBuilder.jsx view drives off. PURE: reads the F1 catalog, validates with the F2
// validator, has no firebase/engine/read path. The view stays thin; all authoring logic and its
// tests live here.
//
// Everything is operator-driven off the catalog: a field offers exactly the clause controls its
// `operators` permit (a free-text notes field offers none; only a number offers aggregate), so
// the builder can never author a clause the F2 validator would reject.

import {
  REPORT_OBJECTS, getReportObject, fieldsForObject, relationshipsFrom, objectsWithPopulatedFields,
} from "./reportCatalog.js";
import { createReportDefinition, FILTER_COMPARATORS_BY_TYPE, SORT_DIRECTIONS } from "./reportQueryModel.js";
import { validateReportDefinition } from "./reportQueryValidation.js";

// Objects offered by the object picker. Populated (wave-1) objects are selectable; later-wave
// objects are shown as `comingSoon` (disabled) rather than hidden -- honest about what exists.
export function availableObjects() {
  const populated = new Set(objectsWithPopulatedFields().map((o) => o.objectId));
  return REPORT_OBJECTS.map((o) => Object.freeze({
    objectId: o.objectId,
    label: o.label,
    comingSoon: !populated.has(o.objectId),
  }));
}

// Selectable fields for a base object, grouped: the object's own fields first, then each
// activated one-hop related object's fields (a related object that is not yet populated -- e.g.
// employee from customer -- is omitted, since it has no catalogued fields to offer). Each field
// carries its `operators` so the view renders only the clause controls the catalog permits.
export function availableFieldGroups(objectId) {
  const base = getReportObject(objectId);
  if (!base || !base.fieldsPopulated) return [];
  const populated = new Set(objectsWithPopulatedFields().map((o) => o.objectId));
  const groups = [group(base.label, objectId, null, fieldsForObject(objectId))];
  for (const rel of relationshipsFrom(objectId)) {
    if (!populated.has(rel.toObjectId)) continue; // related object not activated -> nothing to offer
    const related = getReportObject(rel.toObjectId);
    groups.push(group(`${related.label} (via ${base.label})`, rel.toObjectId, rel.relationshipId, fieldsForObject(rel.toObjectId)));
  }
  return groups;
}

function group(label, objectId, relationshipId, fields) {
  return Object.freeze({
    label, objectId, relationshipId,
    fields: Object.freeze(fields.map((f) => Object.freeze({
      fieldId: f.fieldId, label: f.label, dataType: f.dataType,
      operators: Object.freeze([...f.operators]), sensitivity: f.sensitivity,
    }))),
  });
}

// The default (first legal) comparator for a data type -- what a freshly-added filter uses.
export function defaultComparator(dataType) {
  return (FILTER_COMPARATORS_BY_TYPE[dataType] ?? [])[0] ?? null;
}

// -- non-mutating reducers (each returns a NEW definition) --------------------

// Changing the base object resets every field-referencing clause: field ids are object-scoped,
// so they cannot carry over. Presentation is preserved (it is object-agnostic display metadata).
export function setObject(def, objectId) {
  const fresh = createReportDefinition(objectId);
  fresh.presentation = { ...(def.presentation ?? {}) };
  return fresh;
}

export function toggleField(def, fieldId) {
  const has = def.fields.includes(fieldId);
  return { ...def, fields: has ? def.fields.filter((f) => f !== fieldId) : [...def.fields, fieldId] };
}

export function toggleGroupBy(def, fieldId) {
  const has = def.groupBy.includes(fieldId);
  return { ...def, groupBy: has ? def.groupBy.filter((f) => f !== fieldId) : [...def.groupBy, fieldId] };
}

export function addFilter(def, filter) {
  return { ...def, filters: [...def.filters, { ...filter }] };
}

export function updateFilter(def, index, patch) {
  return { ...def, filters: def.filters.map((flt, i) => (i === index ? { ...flt, ...patch } : flt)) };
}

export function removeFilter(def, index) {
  return { ...def, filters: def.filters.filter((_, i) => i !== index) };
}

// Sort is a small ordered list; the view offers add / change-direction / remove.
export function addSort(def, fieldId, direction = SORT_DIRECTIONS[0]) {
  if (def.sort.some((s) => s.fieldId === fieldId)) return def; // one sort entry per field
  return { ...def, sort: [...def.sort, { fieldId, direction }] };
}

export function updateSort(def, index, patch) {
  return { ...def, sort: def.sort.map((s, i) => (i === index ? { ...s, ...patch } : s)) };
}

export function removeSort(def, index) {
  return { ...def, sort: def.sort.filter((_, i) => i !== index) };
}

// Live validation for the current definition (reuses the F2 validator). Empty array == valid.
export function builderErrors(def) {
  return validateReportDefinition(def);
}

// A coarse builder status the view uses to decide whether Run is enabled and what to show before
// any run: "empty" (no object yet), "invalid" (has errors), or "ready" (valid, runnable).
export function builderStatus(def) {
  if (!def || !def.objectId) return "empty";
  return builderErrors(def).length === 0 ? "ready" : "invalid";
}
