import { validateSystemName, isProtectedSystemName } from "./identity.js";
import { validateNumericSemantics, NUMERIC_KIND } from "./numeric.js";
import { validateFormula, formulaDependencies, formulaResultType } from "./formula.js";

// FieldDefinition v2 — the durable enterprise field contract.
//
// ADDITIVE. v1 remains the current read/query/render contract and every merged definition
// stays valid; `fromV1()` at the bottom maps one into this shape without a flag day. v2
// becomes the contract when compatibility is proven, not when this file merges.
//
// The distinctions below are the ones that get expensive to add later, which is why they
// are here before broad entity mass-definition rather than after.

export const FIELD_CLASS = Object.freeze(["STANDARD", "SYSTEM", "CUSTOM", "DERIVED"]);

/**
 * DERIVED subtypes, kept apart.
 *
 * They differ in where the value comes from, what it costs to read, when it may be stale,
 * and whose authority it needs. One generic "calculated" class would hide all four — and
 * the first casualty would be that a ROLLUP is an aggregate, a confusion this program has
 * already had to correct twice.
 */
export const DERIVATION_TYPE = Object.freeze(["FORMULA", "LOOKUP", "ROLLUP", "PROJECTION"]);

export const ROLLUP_OPERATOR = Object.freeze(["COUNT", "SUM", "MIN", "MAX", "AVG", "DISTINCT_COUNT"]);

/** How a value relates to a related record over time. Mutability decides which is safe. */
export const DENORMALIZATION_KIND = Object.freeze(["LOOKUP", "SNAPSHOT", "MATERIALIZED"]);

/**
 * Queryability. DISPLAYABLE IS NOT QUERYABLE.
 *
 * A derived value is right there on the row once it has been computed for fifty of them,
 * which is exactly why the temptation to offer a filter is strongest here and why the
 * distinction is declared rather than inferred.
 */
export const QUERYABILITY = Object.freeze(["VIRTUAL", "MATERIALIZED", "AGGREGATE"]);

export const FIELD_TYPE_V2 = Object.freeze([
  "STRING", "TEXT", "BOOLEAN", "DATE", "TIMESTAMP", "REFERENCE", "ID", "ENUM", "ENUM_SET",
  ...NUMERIC_KIND,
  // v1's minor-unit integer currency remains valid where it is the authoritative storage.
  "CURRENCY_MINOR",
  // A structured postal address, carried forward from v1 unchanged. Kept in step deliberately:
  // this list and v1's FIELD_TYPE are two vocabularies for the same fields, and a type v1 accepts
  // that v2 does not makes every v1 field of that type unmigratable -- which is exactly what
  // fieldArchitectureV2Compatibility caught the moment ADDRESS was added to only one of them.
  "ADDRESS",
]);

const NUMERIC_TYPES = Object.freeze([...NUMERIC_KIND, "CURRENCY_MINOR"]);

/** Migration states for meaning v1 did not record. Explicit gaps, never invented values. */
export const MIGRATION_UNKNOWN = Object.freeze({
  MUTABILITY: "UNKNOWN_MUTABILITY",
  WRITE_CAPABILITY: "UNKNOWN_WRITE_CAPABILITY",
  ROUNDING: "UNKNOWN_ROUNDING_POLICY",
});

export function makeFieldV2(input = {}) {
  return Object.freeze({
    // --- identity: three separate concerns ---
    label: input.label,
    systemName: input.systemName,
    // Storage stays SEPARATE even when it matches. If systemName were the storage path,
    // every future migration, projection and legacy mapping would make a Firestore detail
    // part of the platform contract, and the contract could only change when the database
    // did.
    storagePath: input.storagePath ?? input.systemName ?? null,

    entitySystemName: input.entitySystemName,
    fieldClass: input.fieldClass ?? "STANDARD",
    type: input.type,

    // --- derived ---
    derivationType: input.derivationType ?? null,
    formula: input.formula ?? null,
    relationship: input.relationship ?? null,
    sourceField: input.sourceField ?? null,
    rollupOperator: input.rollupOperator ?? null,
    denormalization: input.denormalization ?? null,
    queryability: input.queryability ?? (input.derivationType ? "VIRTUAL" : "MATERIALIZED"),

    // --- numeric ---
    numeric: input.numeric ?? null,

    // --- enum ---
    enumValues: input.enumValues ? Object.freeze([...input.enumValues]) : null,
    enumLabels: input.enumLabels ? Object.freeze({ ...input.enumLabels }) : null,
    referenceTo: input.referenceTo ?? null,

    // --- behavior ---
    required: input.required ?? false,
    nullable: input.nullable ?? true,
    defaultValue: input.defaultValue ?? null,
    mutable: input.mutable ?? true,
    createable: input.createable ?? true,
    updateable: input.updateable ?? true,

    // DECLARED, never resolved. Rules and trusted commands remain the only things that
    // decide whether a caller holds these (§6).
    readCapability: input.readCapability ?? null,
    writeCapability: input.writeCapability ?? null,
    // For LOOKUP/ROLLUP: the authority of the UNDERLYING data, which a derived value can
    // never launder away.
    sourceAuthority: Object.freeze([...(input.sourceAuthority ?? [])]),

    unique: input.unique ?? false,
    // Uniqueness is a data property; being an approved integration key is a governance
    // decision. A field can be unique without anyone having approved matching on it.
    alternateKey: input.alternateKey ?? false,

    sensitive: input.sensitive ?? false,
    auditable: input.auditable ?? false,
    deprecated: input.deprecated ?? false,
    filterable: input.filterable ?? false,
    sortable: input.sortable ?? false,
    operators: Object.freeze([...(input.operators ?? [])]),

    migrationGaps: Object.freeze([...(input.migrationGaps ?? [])]),
    description: input.description ?? null,
  });
}

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** §8, recursively: no function may appear anywhere in a definition. */
function findFunction(value, path = "") {
  if (typeof value === "function") return path || "(root)";
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const hit = findFunction(value[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (isPlainObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      const hit = findFunction(v, path ? `${path}.${k}` : k);
      if (hit) return hit;
    }
  }
  return null;
}

export function validateFieldV2(f, { at } = {}) {
  const where = at ?? `field ${f?.systemName ?? "(unnamed)"}`;
  const problems = [];

  const executable = findFunction(f);
  if (executable) problems.push(`${where}: contains a function at "${executable}" — metadata is never executable`);

  if (!f?.label) problems.push(`${where}: a label is required`);
  problems.push(...validateSystemName(f?.systemName, { at: where }));

  if (f?.fieldClass === "CUSTOM" && isProtectedSystemName(f?.systemName)) {
    // A CUSTOM `status` would make every formula, automation and report referencing
    // `status` ambiguous, resolved by load order.
    problems.push(`${where}: a CUSTOM field may not shadow the protected systemName "${f.systemName}"`);
  }
  if (!FIELD_CLASS.includes(f?.fieldClass)) problems.push(`${where}: fieldClass "${f?.fieldClass}" is not a known FIELD_CLASS`);
  if (!FIELD_TYPE_V2.includes(f?.type)) problems.push(`${where}: type "${f?.type}" is not a known FIELD_TYPE`);
  if (!QUERYABILITY.includes(f?.queryability)) problems.push(`${where}: queryability "${f?.queryability}" is not known`);

  if (NUMERIC_TYPES.includes(f?.type) && f?.type !== "CURRENCY_MINOR") {
    problems.push(...validateNumericSemantics(f?.numeric, { at: `${where} numeric` }));
  }

  // --- derived ---
  if (f?.fieldClass === "DERIVED") {
    if (!DERIVATION_TYPE.includes(f?.derivationType)) {
      problems.push(`${where}: a DERIVED field must declare one of ${DERIVATION_TYPE.join("/")}`);
    }
    if (f?.derivationType === "FORMULA") {
      problems.push(...validateFormula(f.formula, { at: `${where} formula` }));
      const declared = formulaResultType(f.formula);
      if (declared && declared === "STRING" && NUMERIC_TYPES.includes(f.type)) {
        problems.push(`${where}: formula produces STRING but the field is typed ${f.type}`);
      }
    }
    if (f?.derivationType === "LOOKUP") {
      if (!f.relationship) problems.push(`${where}: a LOOKUP must name the relationship it traverses`);
      if (!f.sourceField) problems.push(`${where}: a LOOKUP must name the source field it reads`);
      if (!f.sourceAuthority.length) {
        // The bypass this prevents: a viewer who may read the Work Order but not the
        // Account's financials must not receive creditLimit merely because the Work Order
        // is readable. Same disclosure, one extra step.
        problems.push(`${where}: a LOOKUP must declare sourceAuthority — a derived value cannot launder the authority of the data it reads`);
      }
    }
    if (f?.derivationType === "ROLLUP") {
      if (!ROLLUP_OPERATOR.includes(f?.rollupOperator)) {
        problems.push(`${where}: a ROLLUP must declare an operator (${ROLLUP_OPERATOR.join("/")})`);
      }
      if (!f.relationship) problems.push(`${where}: a ROLLUP must name the relationship it aggregates`);
      if (f.queryability !== "AGGREGATE") {
        // A rollup is a complete measure over a related set. Calling it VIRTUAL would
        // invite computing it over whatever rows happened to be loaded.
        problems.push(`${where}: a ROLLUP is an AGGREGATE — its correctness must not depend on pagination`);
      }
      if (!f.sourceAuthority.length) {
        problems.push(`${where}: a ROLLUP must declare sourceAuthority for the records it aggregates`);
      }
    }
  } else if (f?.derivationType) {
    problems.push(`${where}: derivationType is only meaningful on a DERIVED field`);
  }

  // --- queryability vs declared operators ---
  if (f?.queryability === "VIRTUAL" && (f?.filterable || f?.sortable)) {
    problems.push(`${where}: a VIRTUAL field is displayable but not queryable — it cannot declare filterable/sortable`);
  }
  if (f?.filterable && f?.operators.length === 0) {
    problems.push(`${where}: filterable but declares no operators — filterable by what?`);
  }

  // --- keys ---
  if (f?.alternateKey && !f?.unique) {
    // Matching on a non-unique key produces ">1 match" on ordinary data, which the import
    // contract must reject — so approving it as a key is approving a guaranteed failure.
    problems.push(`${where}: an alternateKey must also be unique — matching on a non-unique field cannot be deterministic`);
  }

  // --- immutability coherence ---
  if (f?.mutable === false && f?.updateable === true) {
    problems.push(`${where}: an immutable field cannot be updateable`);
  }
  if (f?.required && f?.nullable) {
    problems.push(`${where}: a required field cannot be nullable`);
  }

  if (f?.type === "REFERENCE" && !f?.referenceTo) {
    problems.push(`${where}: REFERENCE requires referenceTo naming the entity it points at`);
  }
  if ((f?.type === "ENUM" || f?.type === "ENUM_SET") && !f?.enumValues?.length) {
    problems.push(`${where}: ${f.type} requires enumValues`);
  }
  return problems;
}

/** Reject duplicate systemNames within one entity before anything can reference them. */
export function validateFieldSet(fields, { at = "entity" } = {}) {
  const problems = [];
  const seen = new Set();
  for (const f of fields ?? []) {
    if (seen.has(f?.systemName)) problems.push(`${at}: duplicate systemName "${f.systemName}"`);
    seen.add(f?.systemName);
    problems.push(...validateFieldV2(f));
  }
  return problems;
}

/**
 * Dependency graph over derived fields.
 *
 * Cycles are rejected at DEFINITION time, not at evaluation time. A cycle discovered
 * while rendering is an infinite loop or a stack overflow in front of a user; a cycle
 * discovered here is a validation message naming the fields involved.
 */
export function buildDependencyGraph(fields) {
  const graph = new Map();
  for (const f of fields ?? []) {
    if (f.derivationType === "FORMULA" && f.formula) graph.set(f.systemName, formulaDependencies(f.formula));
    else if (f.derivationType === "LOOKUP" || f.derivationType === "ROLLUP") graph.set(f.systemName, []);
    else graph.set(f.systemName, []);
  }
  return graph;
}

export function findDependencyCycles(fields) {
  const graph = buildDependencyGraph(fields);
  const cycles = [];
  const state = new Map(); // undefined = unvisited, 1 = in progress, 2 = done

  const walk = (node, stack) => {
    if (state.get(node) === 2) return;
    if (state.get(node) === 1) {
      // Report from the point the cycle closes, so the message names only the fields
      // actually in it rather than the whole path that reached it.
      cycles.push([...stack.slice(stack.indexOf(node)), node]);
      return;
    }
    state.set(node, 1);
    for (const dep of graph.get(node) ?? []) {
      if (graph.has(dep)) walk(dep, [...stack, node]);
    }
    state.set(node, 2);
  };

  for (const node of graph.keys()) walk(node, []);
  return cycles;
}

export function validateEntityFields(fields, { at = "entity" } = {}) {
  const problems = validateFieldSet(fields, { at });
  for (const cycle of findDependencyCycles(fields)) {
    problems.push(`${at}: circular derived dependency ${cycle.join(" -> ")}`);
  }
  return problems;
}

/**
 * Map a v1 FieldDefinition into the v2 shape.
 *
 * Compatibility, not a flag day. Where v1 recorded the meaning unambiguously it carries
 * over; where it did not, the gap is RECORDED rather than filled with a plausible
 * default. Inventing "mutable: true" because most fields are mutable would turn a missing
 * decision into a stated one, and nobody would ever revisit it.
 */
export function fromV1(v1, { entitySystemName } = {}) {
  const gaps = [];
  const isNumeric = ["NUMBER", "CURRENCY_MINOR"].includes(v1?.type);
  if (isNumeric && v1?.type !== "CURRENCY_MINOR") gaps.push(MIGRATION_UNKNOWN.ROUNDING);
  if (v1?.mutable === undefined) gaps.push(MIGRATION_UNKNOWN.MUTABILITY);
  if (!v1?.writeCapability) gaps.push(MIGRATION_UNKNOWN.WRITE_CAPABILITY);

  return makeFieldV2({
    label: v1?.label,
    // v1's `id` was already a stable machine identity in everything but name.
    systemName: v1?.id,
    storagePath: v1?.id,
    entitySystemName: entitySystemName ?? v1?.entityId,
    fieldClass: "STANDARD",
    type: v1?.type === "NUMBER" ? "DECIMAL" : v1?.type,
    enumValues: v1?.enumValues ?? null,
    enumLabels: v1?.enumLabels ?? null,
    referenceTo: v1?.referenceTo ?? null,
    readCapability: v1?.readCapability ?? null,
    filterable: v1?.filterable ?? false,
    sortable: v1?.sortable ?? false,
    operators: v1?.operators ?? [],
    queryability: "MATERIALIZED",
    description: v1?.description ?? null,
    migrationGaps: gaps,
  });
}
