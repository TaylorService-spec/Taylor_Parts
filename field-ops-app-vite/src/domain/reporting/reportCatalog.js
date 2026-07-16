// Issue #325 unit F1 -- the governed report catalogs (object / field / relationship),
// implementing docs/specifications/governed-object-based-report-creator.md §3-5 under
// ADR-007, and sequenced by docs/implementation-plans/governed-object-based-report-creator.md.
//
// PURE and dependency-free -- no firebase, no permission engine, no read path. This is the
// static, version-controlled metadata catalog the Specification calls the single source of
// truth; it is DATA, not an engine. Nothing here reads a collection, resolves a permission,
// or executes a report. Per the Implementation Plan (F1), this ships INERT: the trusted
// projection service (D-FN), the #226 field-level read capability extension (D-226), and
// activation (the wave PRs) are all separate, later, Inventory-or-later-Customer units.
//
// The `readCapability` ids below are DECLARED here as catalog data -- the shape the #226
// field-level read extension must provide. They are NOT registered in permissionCatalog.ts
// (that is Inventory's lane) and nothing here grants or resolves them.
//
// Stable identifiers only (Spec §2): objectId `<object>`, fieldId `<object>.<field>`. Never
// a page/component name or a raw arbitrary Firestore path.

// -- enumerations (Spec §3.2 / §5 legend) -------------------------------------

export const REPORT_DATA_TYPES = Object.freeze([
  "string", "number", "boolean", "date", "enum", "reference", "list",
]);

export const REPORT_OPERATORS = Object.freeze(["filter", "sort", "group", "aggregate"]);

// Spec §5 sensitivity legend. Order is documentation, not precedence.
export const REPORT_SENSITIVITY_CLASSES = Object.freeze([
  "standard", "commercial", "governed", "security-text", "financial", "employee", "audit",
]);

// Which operators a data type may legally support (Spec §3.2). A field declares a SUBSET of
// these; a free-text field (notes/accessNotes) declares the empty set. Only `number` may
// aggregate. `reference`/`enum`/`boolean`/`list` are filter/group discretes; strings and
// dates order but do not sum.
export const LEGAL_OPERATORS_BY_TYPE = Object.freeze({
  string: Object.freeze(["filter", "sort", "group"]),
  number: Object.freeze(["filter", "sort", "group", "aggregate"]),
  boolean: Object.freeze(["filter", "group"]),
  date: Object.freeze(["filter", "sort", "group"]),
  enum: Object.freeze(["filter", "group"]),
  reference: Object.freeze(["filter", "group"]),
  list: Object.freeze(["filter", "group"]),
});

// -- object catalog (Spec §4; all existing objects) ---------------------------
//
// `activationWave` is metadata (which reviewed wave activates it), NOT a runtime "on" flag:
// F1 activates nothing. `fieldsPopulated` is true only for wave-1 objects, whose field
// catalogs are authored in full here; later-wave objects are present as object-level STUBS
// (fieldsPopulated:false, no fields) per the Plan, so their fields are authored and their
// sensitivity fixed at each wave's own activation review before ever being reportable.

export const REPORT_OBJECTS = Object.freeze([
  obj("customer", "Customer", "accounts", 1, true),
  obj("contact", "Contact", "contacts", 1, true),
  obj("location", "Location", "locations", 1, true),
  obj("equipment", "Equipment", "equipment", 1, true),
  obj("job", "Job", "fieldops_jobs", 2, false),
  obj("workOrder", "Work Order", "fieldops_wos", 2, false),
  obj("technician", "Technician", "fieldops_technicians", 2, false),
  // Derived, read-only (Spec §4): no own collection; synthesized from Work Orders.
  obj("serviceHistory", "Service History", null, 2, false, { derivedFrom: "fieldops_wos" }),
  obj("reorderRequest", "Reorder Request", "reorder_requests", 3, false),
  obj("purchaseOrder", "Purchase Order", "reorder_purchase_orders", 3, false),
  obj("inventoryAction", "Inventory Action", "inventory_actions", 3, false),
  obj("employee", "Employee", "employees", 4, false),
  // Invoice is deliberately ABSENT (Spec §4): no domain model/collection exists; deferred to
  // wave 6. Inventory Part (partsCatalog.ts) is a static non-authoritative source, not a
  // live governed object, so it is not catalogued here either.
]);

function obj(objectId, label, collection, activationWave, fieldsPopulated, extra = {}) {
  return Object.freeze({
    objectId,
    label,
    collection,
    activationWave,
    objectReadCapability: `report.${objectId}.read`,
    fieldsPopulated,
    ...extra,
  });
}

// -- field catalog (Spec §5.1-5.4; wave-1 objects in full) --------------------

function f(objectId, field, label, dataType, operators, sensitivity, capabilityGroup, extra = {}) {
  return Object.freeze({
    fieldId: `${objectId}.${field}`,
    objectId,
    label,
    dataType,
    sensitivity,
    operators: Object.freeze([...operators]),
    // One capability per field (Owner decision 1). Fields grouped under one capability
    // (e.g. the four billingAddress parts) share a capabilityGroup id, exactly as Spec §5.
    readCapability: `report.${objectId}.field.${capabilityGroup}.read`,
    ...extra,
  });
}

const CUSTOMER_FIELDS = [
  f("customer", "name", "Name", "string", ["filter", "sort", "group"], "standard", "name"),
  f("customer", "status", "Status", "enum", ["filter", "group"], "standard", "status"),
  f("customer", "relationshipTypes", "Relationship types", "list", ["filter", "group"], "standard", "relationshipTypes"),
  f("customer", "billingAddress.street", "Billing street", "string", ["filter", "sort"], "standard", "billingAddress"),
  f("customer", "billingAddress.city", "Billing city", "string", ["filter", "sort", "group"], "standard", "billingAddress"),
  f("customer", "billingAddress.state", "Billing state", "string", ["filter", "sort", "group"], "standard", "billingAddress"),
  f("customer", "billingAddress.zip", "Billing ZIP", "string", ["filter", "sort", "group"], "standard", "billingAddress"),
  f("customer", "tags", "Tags", "list", ["filter", "group"], "standard", "tags"),
  f("customer", "customerNumber", "Customer #", "string", ["filter", "sort"], "standard", "externalIds"),
  f("customer", "erpId", "ERP ID", "string", ["filter"], "standard", "externalIds"),
  f("customer", "accountingId", "Accounting ID", "string", ["filter"], "standard", "externalIds"),
  f("customer", "legacyId", "Legacy ID", "string", ["filter"], "standard", "externalIds"),
  f("customer", "notes", "Notes", "string", [], "security-text", "notes"),
  f("customer", "createdAt", "Created", "date", ["filter", "sort", "group"], "standard", "createdAt"),
  f("customer", "paymentTerms", "Payment terms", "enum", ["filter", "group"], "governed", "paymentTerms"),
  f("customer", "taxStatus", "Tax status", "enum", ["filter", "group"], "governed", "taxStatus"),
  f("customer", "defaultCurrency", "Default currency", "string", ["filter", "group"], "commercial", "commercialProfile"),
  f("customer", "purchaseOrderRequired", "PO required", "boolean", ["filter", "group"], "commercial", "commercialProfile"),
  f("customer", "invoiceDeliveryMethod", "Invoice delivery", "enum", ["filter", "group"], "commercial", "commercialProfile"),
  f("customer", "billingContact", "Billing contact", "reference", ["filter"], "standard", "billingContact", { referenceTo: "contact" }),
  f("customer", "accountOwner", "Account owner", "reference", ["filter", "group"], "employee", "accountOwner", { referenceTo: "employee" }),
];

const CONTACT_FIELDS = [
  f("contact", "name", "Name", "string", ["filter", "sort", "group"], "standard", "name"),
  f("contact", "email", "Email", "string", ["filter", "sort"], "standard", "email"),
  f("contact", "phone", "Phone", "string", ["filter"], "standard", "phone"),
  f("contact", "role", "Role", "string", ["filter", "group"], "standard", "role"),
  f("contact", "accountId", "Customer", "reference", ["filter", "group"], "standard", "customer", { referenceTo: "customer" }),
];

const LOCATION_FIELDS = [
  f("location", "name", "Name", "string", ["filter", "sort", "group"], "standard", "name"),
  f("location", "address.street", "Street", "string", ["filter", "sort", "group"], "standard", "address"),
  f("location", "address.city", "City", "string", ["filter", "sort", "group"], "standard", "address"),
  f("location", "address.state", "State", "string", ["filter", "sort", "group"], "standard", "address"),
  f("location", "address.zip", "ZIP", "string", ["filter", "sort", "group"], "standard", "address"),
  f("location", "accessNotes", "Access notes", "string", [], "security-text", "accessNotes"),
  f("location", "accountId", "Customer", "reference", ["filter", "group"], "standard", "customer", { referenceTo: "customer" }),
];

const EQUIPMENT_FIELDS = [
  f("equipment", "name", "Name", "string", ["filter", "sort", "group"], "standard", "name"),
  f("equipment", "status", "Status", "enum", ["filter", "group"], "standard", "status"),
  f("equipment", "manufacturer", "Manufacturer", "string", ["filter", "sort", "group"], "standard", "identity"),
  f("equipment", "model", "Model", "string", ["filter", "sort", "group"], "standard", "identity"),
  f("equipment", "serialNumber", "Serial number", "string", ["filter", "sort", "group"], "standard", "identity"),
  f("equipment", "assetTag", "Asset tag", "string", ["filter", "sort", "group"], "standard", "identity"),
  f("equipment", "installedDate", "Installed", "date", ["filter", "sort", "group"], "standard", "dates"),
  f("equipment", "warrantyExpiresDate", "Warranty expires", "date", ["filter", "sort", "group"], "standard", "dates"),
  f("equipment", "notes", "Notes", "string", [], "standard", "notes"),
  f("equipment", "accountId", "Customer", "reference", ["filter", "group"], "standard", "customer", { referenceTo: "customer" }),
  f("equipment", "locationId", "Location", "reference", ["filter", "group"], "standard", "location", { referenceTo: "location" }),
  f("equipment", "createdAt", "Created", "date", ["filter", "sort", "group"], "standard", "createdAt"),
];

export const REPORT_FIELDS = Object.freeze([
  ...CUSTOMER_FIELDS, ...CONTACT_FIELDS, ...LOCATION_FIELDS, ...EQUIPMENT_FIELDS,
]);

// -- relationship catalog (Spec §3.3 / §2.5; predefined, governed, one-hop) ---
//
// Every traversal is reached through a reference FIELD, so the reference field's own
// readCapability is the traversal gate (one capability per field, Owner decision 1). No
// arbitrary joins: only the entries below exist, all hop=1 at first activation.

function rel(fromObjectId, toObjectId, viaField, cardinality) {
  return Object.freeze({
    relationshipId: `${fromObjectId}->${toObjectId}`,
    fromObjectId,
    toObjectId,
    viaField: `${fromObjectId}.${viaField}`,
    cardinality,
    traversalCapability: REPORT_FIELDS.find((x) => x.fieldId === `${fromObjectId}.${viaField}`)?.readCapability ?? null,
    hop: 1,
  });
}

export const REPORT_RELATIONSHIPS = Object.freeze([
  rel("equipment", "location", "locationId", "one"),
  rel("equipment", "customer", "accountId", "one"),
  rel("contact", "customer", "accountId", "one"),
  rel("location", "customer", "accountId", "one"),
  rel("customer", "contact", "billingContact", "one"),
  // customer -> employee via accountOwner: hop=1, but the accountOwner field is `employee`-
  // classified, so the traversal is only reachable when Employee activates (wave 4).
  rel("customer", "employee", "accountOwner", "one"),
]);

// -- accessors ----------------------------------------------------------------

export function getReportObject(objectId) {
  return REPORT_OBJECTS.find((o) => o.objectId === objectId) ?? null;
}

export function fieldsForObject(objectId) {
  return REPORT_FIELDS.filter((x) => x.objectId === objectId);
}

export function getReportField(fieldId) {
  return REPORT_FIELDS.find((x) => x.fieldId === fieldId) ?? null;
}

export function relationshipsFrom(objectId) {
  return REPORT_RELATIONSHIPS.filter((r) => r.fromObjectId === objectId);
}

// Objects whose fields are authored (wave-1). F1 activates nothing at RUNTIME; this only
// answers "does this object have a populated field catalog yet", which the builder UI (F3)
// uses to show later-wave objects as coming-soon rather than empty.
export function objectsWithPopulatedFields() {
  return REPORT_OBJECTS.filter((o) => o.fieldsPopulated);
}
