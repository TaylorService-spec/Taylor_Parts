// Issue #325 / ADR-007 W-SAVE-UI foundation -- revalidate + RECONCILE a saved report when it is
// opened (Spec §7 "validated again on every run, the catalog can change between them" / §8
// "definitions tolerate catalog change: a field removed/re-classified/de-activated is dropped ...
// with the omission surfaced; the definition is not invalidated").
//
// Two failure modes, kept distinct:
//   - UNOPENABLE (fail-closed): the saved report is structurally unusable -- malformed, unknown
//     top-level keys, or a base object that is unknown or no longer activated. Nothing is restored;
//     a safe reason is surfaced and there is no definition to load.
//   - RECONCILED (drop + surface): the base object is fine, but individual fields / filters /
//     grouping / sort / aggregates now reference something the catalog no longer offers (a removed
//     or de-activated field, a dropped relationship, an operator no longer legal for the field's
//     type, or a corrupt clause). Those are DROPPED and surfaced -- never silently restored -- and
//     the surviving definition is returned to load.
//
// PURE: reads the catalog + reuses the F2 primitives; no firebase, no engine, no run. It decides
// nothing about the runner's field-level READ access (that is D-FN at run time, Spec §6); this is
// purely catalog-drift reconciliation for the saved metadata.
import { getReportObject, objectsWithPopulatedFields } from "./reportCatalog.js";
import { resolveDefinitionField, validateReportDefinition } from "./reportQueryValidation.js";
import {
  DEFINITION_KEYS, FILTER_KEYS, SORT_KEYS, AGGREGATE_KEYS,
  SORT_DIRECTIONS, FILTER_COMPARATORS_BY_TYPE, FIELD_AGGREGATE_FUNCTIONS, isFieldlessAggregate,
} from "./reportQueryModel.js";

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function unknownKeys(obj, allowed) {
  return Object.keys(obj).filter((k) => !allowed.includes(k));
}

function unopenable(reason) {
  return Object.freeze({
    openable: false,
    reason,
    definition: null,
    dropped: Object.freeze({ fields: [], filters: 0, groupBy: [], sort: [], aggregates: 0 }),
    residualErrors: [],
    changed: false,
  });
}

export function reconcileSavedReport(saved, options = {}) {
  const activated = new Set(
    options.activatedObjectIds ?? objectsWithPopulatedFields().map((o) => o.objectId),
  );
  const isActivated = (objectId) => activated.has(objectId);

  // -- structural gate (fail-closed) --
  if (!isPlainObject(saved) || !isPlainObject(saved.definition)) {
    return unopenable("This report can't be opened.");
  }
  const def = saved.definition;
  if (unknownKeys(def, DEFINITION_KEYS).length > 0) {
    return unopenable("This report can't be opened.");
  }
  const baseId = def.objectId;
  const baseObject = typeof baseId === "string" ? getReportObject(baseId) : null;
  if (!baseObject || !isActivated(baseId)) {
    // The object the report is built on is gone or no longer available. Never guess a substitute.
    return unopenable("The data this report is built on is no longer available.");
  }

  // A field id is still usable iff it resolves against the base (own or one-hop) AND its owning
  // object is activated. This drops removed fields and dropped relationships alike.
  const resolveUsable = (fieldId) => {
    if (typeof fieldId !== "string") return null;
    const resolved = resolveDefinitionField(baseId, fieldId);
    if (!resolved || !isActivated(resolved.field.objectId)) return null;
    return resolved.field;
  };

  const asArray = (v) => (Array.isArray(v) ? v : []);
  const dropped = { fields: [], filters: 0, groupBy: [], sort: [], aggregates: 0 };

  // -- fields --
  const fields = asArray(def.fields).filter((fid) => {
    if (resolveUsable(fid)) return true;
    dropped.fields.push(fid);
    return false;
  });

  // -- filters -- keep only well-formed clauses whose field still supports a still-legal filter op.
  const filters = asArray(def.filters).filter((flt) => {
    if (!isPlainObject(flt) || unknownKeys(flt, FILTER_KEYS).length > 0) { dropped.filters += 1; return false; }
    const field = resolveUsable(flt.fieldId);
    if (!field || !field.operators.includes("filter")) { dropped.filters += 1; return false; }
    const legal = FILTER_COMPARATORS_BY_TYPE[field.dataType] ?? [];
    if (!legal.includes(flt.op)) { dropped.filters += 1; return false; } // operator no longer offered
    return true;
  });

  // -- groupBy -- field must still support group.
  const groupBy = asArray(def.groupBy).filter((fid) => {
    const field = resolveUsable(fid);
    if (field && field.operators.includes("group")) return true;
    dropped.groupBy.push(fid);
    return false;
  });

  // -- sort -- well-formed, field still supports sort, direction still legal.
  const sort = asArray(def.sort).filter((s) => {
    if (!isPlainObject(s) || unknownKeys(s, SORT_KEYS).length > 0) { dropped.sort.push(s?.fieldId ?? "?"); return false; }
    const field = resolveUsable(s.fieldId);
    if (!field || !field.operators.includes("sort") || !SORT_DIRECTIONS.includes(s.direction)) {
      dropped.sort.push(s.fieldId);
      return false;
    }
    return true;
  });

  // -- aggregates -- fieldless countRows always survives (needs no field); a field-bound aggregate
  // survives only if its field still supports aggregate and the fn is still known.
  const aggregates = asArray(def.aggregates).filter((a) => {
    if (!isPlainObject(a) || unknownKeys(a, AGGREGATE_KEYS).length > 0) { dropped.aggregates += 1; return false; }
    if (isFieldlessAggregate(a.fn)) {
      if (a.fieldId !== undefined) { dropped.aggregates += 1; return false; } // corrupt: countRows takes no field
      return true;
    }
    if (!FIELD_AGGREGATE_FUNCTIONS.includes(a.fn)) { dropped.aggregates += 1; return false; }
    const field = resolveUsable(a.fieldId);
    if (!field || !field.operators.includes("aggregate")) { dropped.aggregates += 1; return false; }
    return true;
  });

  const reconciled = {
    objectId: baseId,
    fields,
    filters,
    groupBy,
    sort,
    aggregates,
    presentation: isPlainObject(def.presentation) ? def.presentation : {},
  };

  const changed =
    dropped.fields.length > 0 || dropped.filters > 0 || dropped.groupBy.length > 0 ||
    dropped.sort.length > 0 || dropped.aggregates > 0;

  // Residual validity of the RECONCILED definition against the same catalog. Drops can leave the
  // definition still needing the user's attention (e.g. a projected column whose group was dropped
  // now violates grouping consistency, or every projection was dropped so it selects nothing). We
  // SURFACE those via the single F2 validator -- we never re-add anything to satisfy them.
  const residualErrors = validateReportDefinition(reconciled, options);

  return Object.freeze({
    openable: true,
    reason: null,
    definition: Object.freeze(reconciled),
    dropped: Object.freeze({
      fields: Object.freeze([...dropped.fields]),
      filters: dropped.filters,
      groupBy: Object.freeze([...dropped.groupBy]),
      sort: Object.freeze([...dropped.sort]),
      aggregates: dropped.aggregates,
    }),
    residualErrors: Object.freeze([...residualErrors]),
    changed,
  });
}

// Convenience for the UI: a short, safe, human sentence for what catalog drift removed. Returns
// null when nothing was dropped. Never names a field the user didn't already put in their report
// (these are all fields/clauses the OWNER authored, so naming their ids back is safe).
export function describeReconciliation(result) {
  if (!result || !result.changed) return null;
  const d = result.dropped;
  const parts = [];
  if (d.fields.length) parts.push(`${d.fields.length} column${d.fields.length === 1 ? "" : "s"}`);
  if (d.filters) parts.push(`${d.filters} filter${d.filters === 1 ? "" : "s"}`);
  if (d.groupBy.length) parts.push(`${d.groupBy.length} grouping${d.groupBy.length === 1 ? "" : "s"}`);
  if (d.sort.length) parts.push(`${d.sort.length} sort${d.sort.length === 1 ? "" : "s"}`);
  if (d.aggregates) parts.push(`${d.aggregates} summar${d.aggregates === 1 ? "y" : "ies"}`);
  if (parts.length === 0) return null;
  return `Some parts of this report are no longer available and were removed: ${parts.join(", ")}.`;
}
