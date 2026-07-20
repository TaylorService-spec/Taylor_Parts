// Issue #325 / ADR-007 W-SAVE-UI foundation -- the pure, inert SAVED-REPORT model.
//
// A saved report is inert metadata: a private owner, a name, and an embedded report definition
// (reportQueryModel.js). It carries NO data, NO results, and NO author privileges (ADR-007 §2.4 /
// Spec §8). This slice is CLIENT-ONLY and IN-MEMORY: no Firestore collection, no Rules, no
// persistence, no sharing, no scheduling -- those are W-SAVE / D-RULES, a separate later lane.
// Private by owner: a saved report belongs to exactly one `ownerUid` (Spec §9 "Private by
// default"); there is deliberately no shared-with / schedule field here.
//
// Validation is fail-closed and reuses the F2 validator for the embedded definition, so client and
// (future) server agree on what a well-formed saved report is.
import { validateReportDefinition } from "./reportQueryValidation.js";

// Allowed top-level keys (fail-closed: anything else is rejected -- a stray key may signal
// corruption or an out-of-scope feature like sharing/scheduling sneaking in).
export const SAVED_REPORT_KEYS = Object.freeze([
  "id", "name", "ownerUid", "definition", "createdAt", "updatedAt",
]);

export const SAVED_REPORT_NAME_MAX = 120;

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function isNonEmptyString(v) {
  return typeof v === "string" && v.trim() !== "";
}
function unknownKeys(obj, allowed) {
  return Object.keys(obj).filter((k) => !allowed.includes(k));
}

// A pure factory. Ids and timestamps are INJECTED (never generated here) so the model stays pure
// and deterministic under test; the UI passes crypto.randomUUID() + Date.now(). Returns a frozen,
// inert saved report. `definition` is stored as given (a plain report-definition object).
export function createSavedReport({ id, name, ownerUid, definition, now }) {
  return Object.freeze({
    id,
    name,
    ownerUid,
    definition,
    createdAt: now,
    updatedAt: now,
  });
}

// "Copy of X", clamped to the name limit -- used by the store's duplicate.
export function duplicateName(name) {
  const base = `Copy of ${isNonEmptyString(name) ? name.trim() : "report"}`;
  return base.slice(0, SAVED_REPORT_NAME_MAX);
}

// Validate a saved report against its shape and (via F2) its embedded definition. Returns
// string[] (empty == valid). Fail-closed on every defect; messages are developer/test-facing.
// `options` is forwarded to validateReportDefinition (e.g. activatedObjectIds) so the caller can
// validate against a specific catalog activation set.
export function validateSavedReport(saved, options = {}) {
  if (!isPlainObject(saved)) return ["saved report must be a plain object"];
  const errors = [];

  const extra = unknownKeys(saved, SAVED_REPORT_KEYS);
  if (extra.length > 0) errors.push(`saved report has unknown keys: ${extra.join(", ")}`);

  if (!isNonEmptyString(saved.id)) errors.push("saved report id is required");
  if (!isNonEmptyString(saved.ownerUid)) errors.push("saved report ownerUid is required");

  if (!isNonEmptyString(saved.name)) {
    errors.push("saved report name is required");
  } else if (saved.name.length > SAVED_REPORT_NAME_MAX) {
    errors.push(`saved report name exceeds ${SAVED_REPORT_NAME_MAX} characters`);
  }

  if (!Number.isFinite(saved.createdAt)) errors.push("saved report createdAt must be a number");
  if (!Number.isFinite(saved.updatedAt)) errors.push("saved report updatedAt must be a number");

  // The embedded definition is validated by the single F2 validator -- fail-closed on unknown
  // objects/fields/relationships/operators, unknown keys, and malformed definitions.
  if (saved.definition === undefined) {
    errors.push("saved report definition is required");
  } else {
    for (const e of validateReportDefinition(saved.definition, options)) {
      errors.push(`definition: ${e}`);
    }
  }

  return errors;
}
