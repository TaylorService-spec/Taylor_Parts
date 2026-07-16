// Issue #325 unit F1 -- pure integrity validators for the report catalogs
// (reportCatalog.js). No firebase, no engine, no read path.
//
// These prove the STATIC catalog is self-consistent: every field is well-formed, every
// operator is legal for its type, every reference/relationship resolves, sensitivity is a
// known class, and identifiers are stable and unique. A catalog that fails these is a
// programming error caught at build/test time -- never a runtime authorization decision
// (that is D-226/D-FN's job, server-side, and is not implemented here). Fail-closed: any
// malformed entry is an error, never silently ignored.

import {
  REPORT_OBJECTS, REPORT_FIELDS, REPORT_RELATIONSHIPS,
  REPORT_DATA_TYPES, REPORT_OPERATORS, REPORT_SENSITIVITY_CLASSES,
  LEGAL_OPERATORS_BY_TYPE,
} from "./reportCatalog.js";

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim() !== "";
}

// Returns a flat list of error strings. Empty list == the catalog is internally consistent.
// The strings are for developers/tests; they never reach a user (F1 has no UI path).
//
// Takes the catalog as parameters (defaulting to the shipped one) so the rules can be
// exercised against deliberately-corrupted inputs -- a validator only tested against a valid
// catalog proves nothing about what it REJECTS.
export function validateReportCatalog(
  objects = REPORT_OBJECTS,
  fields = REPORT_FIELDS,
  relationships = REPORT_RELATIONSHIPS,
) {
  const errors = [];
  const seenObjectIds = new Set();
  const seenObjectLabels = new Set();
  const seenFieldIds = new Set();
  const seenFieldLabelsByObject = new Map(); // objectId -> Set<label>; labels repeat across objects, unique within one
  const OBJECT_IDS = new Set(objects.map((o) => o.objectId));
  const FIELD_IDS = new Set(fields.map((x) => x.fieldId));

  // -- objects --
  for (const o of objects) {
    const id = o.objectId;
    if (!isNonEmptyString(id)) { errors.push(`object with missing objectId: ${JSON.stringify(o)}`); continue; }
    if (seenObjectIds.has(id)) errors.push(`duplicate objectId: ${id}`);
    seenObjectIds.add(id);
    if (!isNonEmptyString(o.label)) errors.push(`${id}: missing label`);
    else if (seenObjectLabels.has(o.label)) errors.push(`duplicate object label: ${o.label}`);
    else seenObjectLabels.add(o.label);
    if (!Number.isInteger(o.activationWave) || o.activationWave < 1 || o.activationWave > 6) {
      errors.push(`${id}: activationWave must be an integer 1-6, got ${JSON.stringify(o.activationWave)}`);
    }
    if (o.objectReadCapability !== `report.${id}.read`) {
      errors.push(`${id}: objectReadCapability must be report.${id}.read, got ${o.objectReadCapability}`);
    }
    // A collection is required UNLESS the object is derived (serviceHistory).
    if (!o.derivedFrom && !isNonEmptyString(o.collection)) errors.push(`${id}: missing collection`);
    if (o.derivedFrom && o.collection !== null) errors.push(`${id}: a derived object must have collection === null`);
    if (typeof o.fieldsPopulated !== "boolean") errors.push(`${id}: fieldsPopulated must be a boolean`);

    // Wave-1 objects must have a populated field catalog; later-wave objects must be stubs
    // (no fields yet), so a field's sensitivity is fixed by its own wave's review before it
    // can ever be reportable.
    const own = fields.filter((x) => x.objectId === id);
    if (o.fieldsPopulated && own.length === 0) errors.push(`${id}: fieldsPopulated but has no fields`);
    if (!o.fieldsPopulated && own.length > 0) {
      errors.push(`${id}: fields present but fieldsPopulated is false (later-wave stub must be empty)`);
    }
    if (o.fieldsPopulated && o.activationWave !== 1) {
      errors.push(`${id}: only wave-1 objects are populated at F1, but wave ${o.activationWave} is populated`);
    }
  }

  // -- fields --
  for (const x of fields) {
    const id = x.fieldId;
    if (!isNonEmptyString(id)) { errors.push(`field with missing fieldId: ${JSON.stringify(x)}`); continue; }
    if (seenFieldIds.has(id)) errors.push(`duplicate fieldId: ${id}`);
    seenFieldIds.add(id);
    if (!OBJECT_IDS.has(x.objectId)) errors.push(`${id}: unknown objectId ${x.objectId}`);
    // fieldId must be `<objectId>.<non-empty field>` (stable identifier, Spec §2).
    if (!id.startsWith(`${x.objectId}.`) || id.length <= x.objectId.length + 1) {
      errors.push(`${id}: fieldId must be <objectId>.<field> and match objectId ${x.objectId}`);
    }
    if (!isNonEmptyString(x.label)) {
      errors.push(`${id}: missing label`);
    } else {
      // Labels repeat across objects ("Name" on customer/contact/location/equipment) but
      // must be unique WITHIN an object so the builder never shows two identical column names.
      const labels = seenFieldLabelsByObject.get(x.objectId) ?? new Set();
      if (labels.has(x.label)) errors.push(`${x.objectId}: duplicate field label "${x.label}"`);
      labels.add(x.label);
      seenFieldLabelsByObject.set(x.objectId, labels);
    }
    if (!REPORT_DATA_TYPES.includes(x.dataType)) errors.push(`${id}: unknown dataType ${x.dataType}`);
    if (!REPORT_SENSITIVITY_CLASSES.includes(x.sensitivity)) errors.push(`${id}: unknown sensitivity ${x.sensitivity}`);
    // A field's read capability must belong to the field's OWN object. Without this, a
    // hand-authored later-wave field could be gated by another object's capability
    // (e.g. a `job` field gated on `report.customer.field.x.read`), so a runner holding
    // the wrong object's capability could read it -- exactly the mis-binding this catalog
    // exists to prevent. The object-level capability already gets a strict check above;
    // the field level must be equally strict, because the field lists are the surface
    // authored by hand behind this validator (Spec §5.5).
    if (!isNonEmptyString(x.readCapability)) {
      errors.push(`${id}: a field must declare a readCapability (Spec §3.2)`);
    } else if (!x.readCapability.startsWith(`report.${x.objectId}.field.`) || !x.readCapability.endsWith(".read")) {
      errors.push(`${id}: readCapability must be report.${x.objectId}.field.<group>.read, got ${x.readCapability}`);
    }

    // Operators must be known, unique, and LEGAL for the field's type.
    if (!Array.isArray(x.operators)) {
      errors.push(`${id}: operators must be an array`);
    } else {
      const legal = LEGAL_OPERATORS_BY_TYPE[x.dataType] ?? [];
      const seenOp = new Set();
      for (const op of x.operators) {
        if (!REPORT_OPERATORS.includes(op)) errors.push(`${id}: unknown operator ${op}`);
        else if (!legal.includes(op)) errors.push(`${id}: operator ${op} is not legal for type ${x.dataType}`);
        if (seenOp.has(op)) errors.push(`${id}: duplicate operator ${op}`);
        seenOp.add(op);
      }
    }

    // A reference must point at a known object.
    if (x.dataType === "reference") {
      if (!isNonEmptyString(x.referenceTo)) errors.push(`${id}: a reference field must declare referenceTo`);
      else if (!OBJECT_IDS.has(x.referenceTo)) errors.push(`${id}: referenceTo unknown object ${x.referenceTo}`);
    } else if (x.referenceTo !== undefined) {
      errors.push(`${id}: only reference fields may declare referenceTo`);
    }
  }

  // -- relationships --
  const seenRelIds = new Set();
  for (const r of relationships) {
    const id = r.relationshipId;
    if (!isNonEmptyString(id)) { errors.push(`relationship with missing id: ${JSON.stringify(r)}`); continue; }
    if (seenRelIds.has(id)) errors.push(`duplicate relationshipId: ${id}`);
    seenRelIds.add(id);
    if (!OBJECT_IDS.has(r.fromObjectId)) errors.push(`${id}: unknown fromObjectId ${r.fromObjectId}`);
    if (!OBJECT_IDS.has(r.toObjectId)) errors.push(`${id}: unknown toObjectId ${r.toObjectId}`);
    if (r.hop !== 1) errors.push(`${id}: only hop=1 relationships exist at first activation (ADR-007 §2.5), got ${r.hop}`);
    if (r.cardinality !== "one" && r.cardinality !== "many") errors.push(`${id}: cardinality must be one|many`);
    // The traversal is reached through a reference field that must exist and point where the
    // relationship says, and its capability is the traversal gate.
    if (!FIELD_IDS.has(r.viaField)) {
      errors.push(`${id}: viaField ${r.viaField} is not a catalogued field`);
    } else {
      const via = fields.find((x) => x.fieldId === r.viaField);
      // The traversal field must live on the relationship's FROM object -- otherwise the
      // relationship claims to originate from an object that does not own the field, and
      // relationshipsFrom() would surface a traversal gated by the wrong object's field.
      if (via.objectId !== r.fromObjectId) {
        errors.push(`${id}: viaField ${r.viaField} belongs to ${via.objectId}, not fromObjectId ${r.fromObjectId}`);
      }
      if (via.dataType !== "reference") errors.push(`${id}: viaField ${r.viaField} must be a reference field`);
      else if (via.referenceTo !== r.toObjectId) {
        errors.push(`${id}: viaField ${r.viaField} references ${via.referenceTo}, not ${r.toObjectId}`);
      }
      if (r.traversalCapability !== via.readCapability) {
        errors.push(`${id}: traversalCapability must equal the viaField's readCapability`);
      }
    }
  }

  // Every reference field should have a corresponding relationship (so a reference is always
  // a governed, catalogued traversal, never an implicit join).
  for (const x of fields) {
    if (x.dataType === "reference") {
      const has = relationships.some((r) => r.viaField === x.fieldId && r.toObjectId === x.referenceTo);
      if (!has) errors.push(`${x.fieldId}: reference field has no matching relationship catalog entry`);
    }
  }

  return errors;
}

// Convenience for a build/test assertion: throws with all errors if the catalog is invalid.
export function assertReportCatalogValid() {
  const errors = validateReportCatalog();
  if (errors.length > 0) {
    throw new Error(`report catalog is invalid:\n  - ${errors.join("\n  - ")}`);
  }
}
