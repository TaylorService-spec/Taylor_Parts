// Relationship CLOSURE + validation for the fixture set. PURE (no I/O).
//
// A fixture set is { [collection]: record[] }. Every REQUIRED outgoing reference (fixtureSpec COLLECTIONS
// .refs with required:true) must resolve to a record actually present in the target collection's fixtures.
// The validator returns the dangling-required references; for a valid v1 fixture set this MUST be empty.
import { COLLECTIONS } from "./fixtureSpec.mjs";

// The set of identities present in a target collection's fixtures. Target collections we reference
// (parts/manufacturers/warehouses/equipment_models) are all docIdIsId, so identity == idField value.
function presentIds(collection, records) {
  const spec = COLLECTIONS[collection];
  const ids = new Set();
  for (const r of records ?? []) {
    const id = spec?.idField ? r[spec.idField] : undefined;
    if (id != null) ids.add(String(id));
  }
  return ids;
}

// Validate that every REQUIRED reference resolves. Returns { danglingRequired[], ok }.
export function validateClosure(fixtureSet) {
  const present = {};
  for (const c of Object.keys(fixtureSet)) present[c] = presentIds(c, fixtureSet[c]);

  const danglingRequired = [];
  for (const [collection, records] of Object.entries(fixtureSet)) {
    const refs = (COLLECTIONS[collection]?.refs ?? []).filter((r) => r.required);
    if (refs.length === 0) continue;
    for (const rec of records ?? []) {
      for (const ref of refs) {
        const value = rec[ref.field];
        if (value == null) continue; // an absent optional value on a required-typed ref is a data gap, not a dangling ref
        const targetIds = present[ref.to] ?? new Set();
        if (!targetIds.has(String(value))) {
          danglingRequired.push({ from: collection, field: ref.field, value: String(value), to: ref.to });
        }
      }
    }
  }
  return { danglingRequired, ok: danglingRequired.length === 0 };
}

// The set of ids that MUST be pulled into each target collection to satisfy required refs from the current
// selection (the extractor uses this to close the graph before finishing). Pure.
export function requiredReferencedIds(fixtureSet) {
  const need = {};
  for (const [collection, records] of Object.entries(fixtureSet)) {
    for (const ref of (COLLECTIONS[collection]?.refs ?? []).filter((r) => r.required)) {
      for (const rec of records ?? []) {
        const value = rec[ref.field];
        if (value == null) continue;
        (need[ref.to] ??= new Set()).add(String(value));
      }
    }
  }
  return need;
}
