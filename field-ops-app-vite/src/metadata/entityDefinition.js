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
 * IDENTITY MODES v1 (DECISIONS #106).
 *
 * Every entity resolves to exactly one of these. There is no fourth, implicit
 * mode where "neither field is set" quietly means something — that ambiguity is
 * exactly how a document id ends up as a label.
 *
 *   HUMAN_NAME         — the entity has a meaningful human-facing `nameField`.
 *   BUSINESS_REFERENCE — the entity has a durable human-facing `referenceField`
 *                         (WO-2026-000008, OPP-000123, SO-2026-000004).
 *   SYSTEM_ONLY         — the entity is an internal/ledger/transactional record
 *                         whose `recordId` is machine identity only. It has NO
 *                         human-facing identity, and does not get one by
 *                         declaring `recordId` as a display fallback.
 */
export const IDENTITY_MODE = Object.freeze(["HUMAN_NAME", "BUSINESS_REFERENCE", "SYSTEM_ONLY"]);

/**
 * How a record identifies itself to a human.
 *
 * Recorded as first-class metadata because "the Firestore document id is the
 * label" is a defect this codebase has found and fixed FOUR separate times as a
 * live `?? x.id` display fallback — Sales Order detail titled itself with its own
 * doc id, opportunities rendered as 95kFz8WWgiSn2nU2O3Ml, and warehouse/supplier
 * views fell back to `.id` when a name was missing. A record page or list built
 * from metadata must be able to ask "what do I call this record" and get a real
 * answer or an honest absence, rather than silently degrading to a database key.
 *
 *   nameField      — the human name a person types or reads (may be null)
 *   referenceField — the stable business reference (WO-2026-000008, OPP-000123)
 *   mode           — the declared IDENTITY_MODE (optional — see resolveIdentityMode)
 *
 * `documentId` / `recordId` is deliberately NOT an accepted value for nameField or
 * referenceField: an entity that names itself only by its own machine id has a
 * data-model gap to record, not a fallback to normalize. SYSTEM_ONLY is the
 * explicit, deliberate way to say "this entity genuinely has none" — it is not
 * what happens automatically when a definition forgets to name one.
 */
export function makeIdentity({ nameField = null, referenceField = null, mode = null } = {}) {
  return Object.freeze({ nameField, referenceField, mode });
}

/**
 * Resolve the effective IDENTITY_MODE for an identity, or `null` if it cannot be
 * resolved at all (an omission — see the "no implicit mode" note below).
 *
 * DESIGN: mode is explicit-first, derived as a fallback, and SYSTEM_ONLY is NEVER
 * derived — only ever reached by an author writing `mode: "SYSTEM_ONLY"` on
 * purpose.
 *
 *   1. An explicitly declared `mode` always wins (including an invalid one —
 *      `validateEntityDefinition` reports that separately so the error names the
 *      actual mistake instead of masking it behind a derived guess).
 *   2. Otherwise, if `nameField` is set, the mode is HUMAN_NAME. `nameField` wins
 *      over `referenceField` when both are set, matching the same display-order
 *      precedent used elsewhere for record identity (name, then reference) —
 *      this keeps every pre-existing definition that supplies both fields (e.g.
 *      Part) valid without having to retrofit an explicit `mode` everywhere.
 *   3. Otherwise, if `referenceField` is set, the mode is BUSINESS_REFERENCE.
 *   4. Otherwise the mode is UNRESOLVED (`null`) — this is the "genuinely forgot
 *      to declare identity" case, and it must fail validation, not silently
 *      resolve to SYSTEM_ONLY. That silent slide is the exact failure this
 *      contract exists to prevent: it would let a real omission pass review
 *      dressed up as a deliberate decision.
 */
export function resolveIdentityMode(identity) {
  if (identity?.mode != null) return identity.mode;
  if (identity?.nameField) return "HUMAN_NAME";
  if (identity?.referenceField) return "BUSINESS_REFERENCE";
  return null;
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

  // Identity: a record must be able to name itself without exposing a database key,
  // and it must resolve to exactly one IDENTITY_MODE — no ambiguous implicit mode.
  const identity = entity?.identity;
  const identityMode = resolveIdentityMode(identity);

  if (identity?.mode != null && !IDENTITY_MODE.includes(identity.mode)) {
    problems.push(`${at}: identity.mode "${identity.mode}" is not a known IDENTITY_MODE`);
  }

  if (identityMode === null) {
    problems.push(
      `${at}: identity requires a nameField or a referenceField — an entity with neither cannot be labelled ` +
        `without exposing its document id, which is a data-model gap to record, not a fallback to normalize. ` +
        `If this entity genuinely has no human-facing identity, declare identity.mode "SYSTEM_ONLY" explicitly`
    );
  } else if (identityMode === "HUMAN_NAME" && !identity?.nameField) {
    problems.push(`${at}: identity.mode "HUMAN_NAME" requires a nameField`);
  } else if (identityMode === "BUSINESS_REFERENCE" && !identity?.referenceField) {
    problems.push(`${at}: identity.mode "BUSINESS_REFERENCE" requires a referenceField`);
  } else if (identityMode === "SYSTEM_ONLY" && (identity?.nameField || identity?.referenceField)) {
    problems.push(
      `${at}: identity.mode "SYSTEM_ONLY" requires neither a nameField nor a referenceField — a SYSTEM_ONLY ` +
        `entity has no human-facing identity at all, and a name/reference field here would just be recordId ` +
        `wearing a disguise`
    );
  }

  const exec = findExecutable(entity);
  if (exec) problems.push(`${at}: executable value at "${exec}" — definitions are data, never code (boundary §8)`);

  const fieldIds = new Set();
  const fieldsById = new Map();
  for (const field of entity?.fields ?? []) {
    problems.push(...validateFieldDefinition(field, entity));
    if (field?.id) {
      if (fieldIds.has(field.id)) problems.push(`${at}: duplicate field id "${field.id}"`);
      fieldIds.add(field.id);
      fieldsById.set(field.id, field);
    }
  }

  // Identity fields must actually exist on the entity, or a renderer will ask for
  // a field that isn't there and silently fall back to the id. They must also not
  // point at an ID-typed (machine identifier) field — that is the exact escape
  // hatch that would let `recordId` re-enter as a disguised nameField/referenceField
  // and become the display fallback DECISIONS #106 forbids, in ANY identity mode.
  for (const [key, ref] of [["nameField", identity?.nameField], ["referenceField", identity?.referenceField]]) {
    if (!ref) continue;
    if (!fieldIds.has(ref)) {
      problems.push(`${at}: identity.${key} "${ref}" is not a field on this entity`);
    } else if (fieldsById.get(ref)?.type === "ID") {
      problems.push(
        `${at}: identity.${key} "${ref}" is an ID-typed field — a machine identifier is never valid human ` +
          `display identity, in any IDENTITY_MODE (recordId must never become the display fallback)`
      );
    }
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
    // Compared as STRINGS on both sides. An object key is always a string, so a numeric
    // enum value — Work Order priority is stored as 1..4 — could never match its own
    // label entry, and every numeric enum would have been reported as mislabelled. The
    // machine value stays numeric in the definition; only the lookup is normalized.
    for (const v of field.enumValues ?? []) {
      if (field.enumLabels && field.enumLabels[v] === String(v)) {
        problems.push(`${at}: enum label for "${v}" equals its machine value — label and stored value must differ`);
      }
    }
    const declared = new Set((field.enumValues ?? []).map((v) => String(v)));
    for (const k of Object.keys(field.enumLabels ?? {})) {
      if (!declared.has(k)) problems.push(`${at}: enumLabels has "${k}" which is not an enumValue`);
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
