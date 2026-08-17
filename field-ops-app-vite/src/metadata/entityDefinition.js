// EOS Metadata — Entity / Field / Relationship definition contracts (v1).
//
// GOVERNANCE: docs/governance/metadata-architecture-ip-boundary.md, DECISIONS #102.
// Read §1, §6, §7 and §8 before changing anything here.
//
// PROVENANCE (§1, §10). These are derived from an EOS requirement and an existing
// EOS implementation, not from any vendor's shape. The repository already models
// business objects, fields and relationships as validated pure data in
// `domain/reporting/reportCatalog.js` — objects with a collection and a read
// capability, fields with a data type, an operator set and a capability id PER
// FIELD, and predefined one-hop relationships with a traversal capability. That
// catalog exists because governed reporting needed field-level authorization; this
// generalizes the same three concepts so page and list definitions can consume
// them too. The decision trace is EOS requirement → EOS abstraction, and the prior
// art is in this repo, not in someone else's product.
//
// WHAT THIS IS NOT:
//
//   §6 — METADATA NEVER GRANTS AUTHORITY. A definition may DECLARE the capability
//   a read or an action requires. It never evaluates one, never resolves one, and
//   never carries a decision. Authorization stays with the governed trusted-command
//   and capability architecture. Nothing in this module imports an access module,
//   and nothing in it should ever return a boolean that means "allowed".
//
//   §8 — NO EXECUTABLE METADATA. Definitions are plain data. No functions, no
//   expressions, no template strings evaluated later. Renderers and validators are
//   referenced by registered id, never inlined as code. `validateEntityDefinition`
//   rejects a function-valued property anywhere in a definition for this reason.
//
//   §7 — LAYERS STAY SEPARATE. Entity, field and relationship metadata live here.
//   Page composition, list shape and action exposure are SEPARATE contracts that
//   reference these by id. Do not grow this file into one universal page schema.
//
// MACHINE VALUES ARE NOT DISPLAY LABELS. Every definition carries `id` (stable,
// machine, never rendered) and `label` (rendered, never compared or persisted).
// This is not stylistic: conflating the two put "0 Active" on the customers list
// beside a table of ACTIVE rows (#1093). The validator enforces the separation.

/** Field data types v1. Deliberately small — add one only when a real EOS field needs it. */
export const FIELD_TYPE = Object.freeze([
  "STRING",
  "TEXT",
  "NUMBER",
  "CURRENCY_MINOR", // integer minor units + a currency field; never a float
  "BOOLEAN",
  "DATE",
  "TIMESTAMP",
  "ENUM",
  // A multi-valued enum: the STORED value is an array of enum members. Modelled
  // separately from ENUM because an account that is both a customer and a vendor is not
  // an account with a single status, and typing it as ENUM would let a scalar equality
  // filter be declared on a field no scalar query can match.
  "ENUM_SET",
  "REFERENCE", // points at another entity; requires referenceTo
  "ID", // a machine identifier; see IDENTITY BELOW
]);

/**
 * Filter operators v1.
 *
 * An operator on a FieldDefinition is a CLAIM about what the backend query
 * contract can actually serve, not a description of what a UI control could
 * express. DECISIONS #102 §9 and the Owner ruling on index governance both turn
 * on this: metadata must not promise filter combinations Firestore cannot answer
 * without a composite index that exists. A ListViewDefinition validator will
 * cross-check declared filters against declared indexes; this vocabulary is what
 * it checks against.
 */
export const FIELD_OPERATOR = Object.freeze([
  "EQUALS",
  "NOT_EQUALS",
  "IN",
  "GREATER_THAN",
  "GREATER_OR_EQUAL",
  "LESS_THAN",
  "LESS_OR_EQUAL",
  "ARRAY_CONTAINS",
  "ARRAY_CONTAINS_ANY",
]);

/** Relationship cardinality. v1 models the shapes EOS actually has today. */
export const CARDINALITY = Object.freeze(["ONE_TO_MANY", "MANY_TO_ONE", "ONE_TO_ONE"]);

/**
 * How a record identifies itself to a human.
 *
 * Recorded as first-class metadata because "the Firestore document id is the
 * label" is a defect this codebase has in at least six places today — Sales Order
 * detail titles itself with its own doc id, opportunities render as
 * 95kFz8WWgiSn2nU2O3Ml, and warehouse/supplier views fall back to `.id` when a
 * name is missing. A record page or list built from metadata must be able to ask
 * "what do I call this record" and get a real answer or an honest absence, rather
 * than silently degrading to a database key.
 *
 *   nameField      — the human name a person types or reads (may be null)
 *   referenceField — the stable business reference (WO-2026-000008, OPP-000123)
 *
 * At least one must be present. `documentId` is deliberately NOT an accepted
 * value: if an entity has neither, that is a data-model gap to record, not a
 * fallback to normalize.
 */
export function makeIdentity({ nameField = null, referenceField = null } = {}) {
  return Object.freeze({ nameField, referenceField });
}

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Recursively detect a function anywhere in a definition (§8). */
function findExecutable(value, path = "") {
  if (typeof value === "function") return path || "(root)";
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const hit = findExecutable(value[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (isPlainObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      const hit = findExecutable(v, path ? `${path}.${k}` : k);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * FieldDefinition. `id` is entity-scoped and stable; `label` is the only human text.
 *
 * `readCapability` DECLARES what reading this field requires. It is a string id and
 * nothing here resolves it — see §6 above.
 */
export function makeFieldDefinition(input = {}) {
  return Object.freeze({
    id: input.id,
    entityId: input.entityId,
    label: input.label,
    type: input.type,
    readCapability: input.readCapability ?? null,
    filterable: input.filterable ?? false,
    sortable: input.sortable ?? false,
    operators: Object.freeze([...(input.operators ?? [])]),
    enumValues: input.enumValues ? Object.freeze([...input.enumValues]) : null,
    enumLabels: input.enumLabels ? Object.freeze({ ...input.enumLabels }) : null,
    referenceTo: input.referenceTo ?? null,
    renderer: input.renderer ?? null, // a REGISTERED renderer id, never a function
    description: input.description ?? null,
  });
}

/** RelationshipDefinition. One hop, predefined, capability-declaring. */
export function makeRelationshipDefinition(input = {}) {
  return Object.freeze({
    id: input.id,
    label: input.label,
    fromEntityId: input.fromEntityId,
    toEntityId: input.toEntityId,
    viaField: input.viaField, // field on the TO entity pointing back at the FROM entity
    cardinality: input.cardinality,
    traversalCapability: input.traversalCapability ?? null,
  });
}

/** EntityDefinition. The business object; owns its fields and outbound relationships. */
export function makeEntityDefinition(input = {}) {
  return Object.freeze({
    id: input.id,
    label: input.label,
    labelPlural: input.labelPlural ?? null,
    collection: input.collection ?? null,
    readCapability: input.readCapability ?? null,
    // How this entity is read. CLIENT_DIRECT means Firestore rules are the gate;
    // CALLABLE means the collection is deny-all and a trusted read owns it. The
    // Phase 0 audit found both patterns in production use, and a list runtime must
    // know which it is dealing with rather than assuming client-direct.
    readVia: input.readVia ?? "UNKNOWN",
    readCallable: input.readCallable ?? null,
    identity: input.identity ?? makeIdentity(),
    fields: Object.freeze([...(input.fields ?? [])]),
    relationships: Object.freeze([...(input.relationships ?? [])]),
    description: input.description ?? null,
  });
}

export const READ_VIA = Object.freeze(["CLIENT_DIRECT", "CALLABLE", "UNKNOWN"]);

/**
 * Validate one EntityDefinition and everything it owns.
 * Returns an array of problem strings; empty means valid.
 */
export function validateEntityDefinition(entity) {
  const problems = [];
  const at = entity?.id ? `entity ${entity.id}` : "entity (no id)";

  if (!entity?.id || typeof entity.id !== "string") problems.push(`${at}: id is required and must be a string`);
  if (!entity?.label || typeof entity.label !== "string") problems.push(`${at}: label is required`);
  if (entity?.id && entity.id === entity.label) {
    problems.push(`${at}: id and label must be distinct concepts — a machine id is not a display label`);
  }
  if (!READ_VIA.includes(entity?.readVia)) problems.push(`${at}: readVia "${entity?.readVia}" is not a known READ_VIA`);
  if (entity?.readVia === "CALLABLE" && !entity.readCallable) {
    problems.push(`${at}: readVia CALLABLE requires readCallable — otherwise a runtime cannot read it at all`);
  }
  if (entity?.readVia === "CLIENT_DIRECT" && !entity.collection) {
    problems.push(`${at}: readVia CLIENT_DIRECT requires a collection`);
  }

  // Identity: a record must be able to name itself without exposing a database key.
  const identity = entity?.identity;
  if (!identity?.nameField && !identity?.referenceField) {
    problems.push(
      `${at}: identity requires a nameField or a referenceField — an entity with neither cannot be labelled ` +
        `without exposing its document id, which is a data-model gap to record, not a fallback to normalize`
    );
  }

  const exec = findExecutable(entity);
  if (exec) problems.push(`${at}: executable value at "${exec}" — definitions are data, never code (boundary §8)`);

  const fieldIds = new Set();
  for (const field of entity?.fields ?? []) {
    problems.push(...validateFieldDefinition(field, entity));
    if (field?.id) {
      if (fieldIds.has(field.id)) problems.push(`${at}: duplicate field id "${field.id}"`);
      fieldIds.add(field.id);
    }
  }

  // Identity fields must actually exist on the entity, or a renderer will ask for
  // a field that isn't there and silently fall back to the id.
  for (const [key, ref] of [["nameField", identity?.nameField], ["referenceField", identity?.referenceField]]) {
    if (ref && !fieldIds.has(ref)) problems.push(`${at}: identity.${key} "${ref}" is not a field on this entity`);
  }

  const relIds = new Set();
  for (const rel of entity?.relationships ?? []) {
    problems.push(...validateRelationshipDefinition(rel, entity));
    if (rel?.id) {
      if (relIds.has(rel.id)) problems.push(`${at}: duplicate relationship id "${rel.id}"`);
      relIds.add(rel.id);
    }
  }

  return problems;
}

export function validateFieldDefinition(field, entity = null) {
  const problems = [];
  const at = field?.id ? `field ${field.id}` : "field (no id)";

  if (!field?.id || typeof field.id !== "string") problems.push(`${at}: id is required and must be a string`);
  if (!field?.label || typeof field.label !== "string") problems.push(`${at}: label is required`);
  if (field?.id && field.id === field.label) {
    problems.push(`${at}: id and label must be distinct concepts`);
  }
  if (!FIELD_TYPE.includes(field?.type)) problems.push(`${at}: type "${field?.type}" is not a known FIELD_TYPE`);
  if (entity?.id && field?.entityId && field.entityId !== entity.id) {
    problems.push(`${at}: entityId "${field.entityId}" does not match its owning entity "${entity.id}"`);
  }

  for (const op of field?.operators ?? []) {
    if (!FIELD_OPERATOR.includes(op)) problems.push(`${at}: operator "${op}" is not a known FIELD_OPERATOR`);
  }

  // An operator set is a promise the backend must be able to keep. Declaring
  // operators on a field nothing can filter by is how metadata starts lying.
  if (!field?.filterable && (field?.operators?.length ?? 0) > 0) {
    problems.push(`${at}: declares operators but is not filterable — an operator set is a claim about a real query`);
  }
  if (field?.filterable && (field?.operators?.length ?? 0) === 0) {
    problems.push(`${at}: filterable but declares no operators — filterable by what?`);
  }

  if (field?.type === "ENUM" || field?.type === "ENUM_SET") {
    if (!field.enumValues?.length) problems.push(`${at}: ${field.type} requires enumValues`);
    // The #1093 lesson as a build failure: stored value and rendered label are
    // separate, and a label map whose entries equal their keys has re-merged them.
    for (const v of field.enumValues ?? []) {
      if (field.enumLabels && field.enumLabels[v] === v) {
        problems.push(`${at}: enum label for "${v}" equals its machine value — label and stored value must differ`);
      }
    }
    for (const k of Object.keys(field.enumLabels ?? {})) {
      if (!(field.enumValues ?? []).includes(k)) problems.push(`${at}: enumLabels has "${k}" which is not an enumValue`);
    }
  } else if (field?.enumValues) {
    problems.push(`${at}: enumValues is only meaningful on an ENUM or ENUM_SET field`);
  }

  if (field?.type === "REFERENCE" && !field.referenceTo) {
    problems.push(`${at}: REFERENCE requires referenceTo naming the entity it points at`);
  }
  if (field?.type !== "REFERENCE" && field?.referenceTo) {
    problems.push(`${at}: referenceTo is only meaningful on a REFERENCE field`);
  }

  if (typeof field?.renderer === "function") {
    problems.push(`${at}: renderer must be a registered renderer id, never a function (boundary §8)`);
  }

  return problems;
}

export function validateRelationshipDefinition(rel, entity = null) {
  const problems = [];
  const at = rel?.id ? `relationship ${rel.id}` : "relationship (no id)";

  if (!rel?.id || typeof rel.id !== "string") problems.push(`${at}: id is required and must be a string`);
  if (!rel?.label || typeof rel.label !== "string") problems.push(`${at}: label is required`);
  if (!rel?.fromEntityId) problems.push(`${at}: fromEntityId is required`);
  if (!rel?.toEntityId) problems.push(`${at}: toEntityId is required`);
  if (!CARDINALITY.includes(rel?.cardinality)) problems.push(`${at}: cardinality "${rel?.cardinality}" is not known`);

  // viaField is what makes a related list SCOPED. Without it a section over this
  // relationship has no parent key to filter by and would render every record of
  // the target entity — the exact defect where an account's opportunity rows all
  // navigated into the unscoped all-opportunities index.
  if (!rel?.viaField) {
    problems.push(`${at}: viaField is required — it is the parent key a related list scopes by`);
  }
  if (entity?.id && rel?.fromEntityId && rel.fromEntityId !== entity.id) {
    problems.push(`${at}: fromEntityId "${rel.fromEntityId}" does not match its owning entity "${entity.id}"`);
  }
  return problems;
}

/**
 * Validate a whole registry of entities together — the checks that only make
 * sense across entities, such as references and relationships pointing at
 * entities that actually exist.
 */
export function validateEntityRegistry(entities = []) {
  const problems = [];
  const ids = new Set();
  for (const e of entities) {
    if (e?.id) {
      if (ids.has(e.id)) problems.push(`duplicate entity id "${e.id}"`);
      ids.add(e.id);
    }
  }
  for (const e of entities) {
    problems.push(...validateEntityDefinition(e));
    for (const f of e?.fields ?? []) {
      if (f?.referenceTo && !ids.has(f.referenceTo)) {
        problems.push(`entity ${e.id}: field ${f.id} references unknown entity "${f.referenceTo}"`);
      }
    }
    for (const r of e?.relationships ?? []) {
      if (r?.toEntityId && !ids.has(r.toEntityId)) {
        problems.push(`entity ${e.id}: relationship ${r.id} targets unknown entity "${r.toEntityId}"`);
      }
    }
  }
  return problems;
}

/** Lookup helpers. Pure, no I/O, no authorization. */
export const findEntity = (entities, entityId) => (entities ?? []).find((e) => e.id === entityId) ?? null;
export const findField = (entity, fieldId) => (entity?.fields ?? []).find((f) => f.id === fieldId) ?? null;
export const filterableFields = (entity) => (entity?.fields ?? []).filter((f) => f.filterable);
export const sortableFields = (entity) => (entity?.fields ?? []).filter((f) => f.sortable);

/**
 * The capability ids a definition DECLARES — entity read, field reads, relationship
 * traversals. Returned so a caller can hand them to the real capability resolver.
 * This function decides nothing; §6 means the answer lives elsewhere.
 */
export function declaredCapabilities(entity) {
  const out = new Set();
  if (entity?.readCapability) out.add(entity.readCapability);
  for (const f of entity?.fields ?? []) if (f.readCapability) out.add(f.readCapability);
  for (const r of entity?.relationships ?? []) if (r.traversalCapability) out.add(r.traversalCapability);
  return [...out].sort();
}
