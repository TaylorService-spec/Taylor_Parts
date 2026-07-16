// Issue #325 unit F1 -- pure tests for the report catalogs + integrity validators.
// Pure: no firebase, no emulator, no browser -- runs under plain node.
//
// Run: node test/reportCatalog.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import {
  REPORT_OBJECTS, REPORT_FIELDS, REPORT_RELATIONSHIPS,
  REPORT_SENSITIVITY_CLASSES, LEGAL_OPERATORS_BY_TYPE,
  getReportObject, fieldsForObject, getReportField, relationshipsFrom, objectsWithPopulatedFields,
} from "../src/domain/reporting/reportCatalog.js";
import { validateReportCatalog } from "../src/domain/reporting/reportCatalogValidation.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

// ---- the shipped catalog is internally consistent --------------------------
ok("the shipped catalog passes every integrity check", () => {
  assert.deepEqual(validateReportCatalog(), [], "catalog must be valid");
});

ok("every existing object from the Spec is catalogued, Invoice/Part deliberately absent", () => {
  const ids = REPORT_OBJECTS.map((o) => o.objectId).sort();
  assert.deepEqual(ids, [
    "contact", "customer", "employee", "equipment", "inventoryAction", "job",
    "location", "purchaseOrder", "reorderRequest", "serviceHistory", "technician", "workOrder",
  ]);
  assert.equal(REPORT_OBJECTS.some((o) => o.objectId === "invoice"), false, "Invoice has no domain -- deferred");
  assert.equal(REPORT_OBJECTS.some((o) => o.objectId === "inventoryPart"), false, "Part is a static catalog, not a live object");
});

ok("wave-1 objects are populated in full; later-wave objects are empty stubs", () => {
  const populated = objectsWithPopulatedFields().map((o) => o.objectId).sort();
  assert.deepEqual(populated, ["contact", "customer", "equipment", "location"]);
  for (const o of REPORT_OBJECTS) {
    const own = fieldsForObject(o.objectId);
    if (o.activationWave === 1) assert.ok(own.length > 0, `${o.objectId} (wave 1) must have fields`);
    else assert.equal(own.length, 0, `${o.objectId} (wave ${o.activationWave}) must be a stub with no fields yet`);
  }
});

ok("F1 activates nothing -- there is no read path or runtime 'active' flag", () => {
  // fieldsPopulated is metadata about whether the field list is authored, not a runtime
  // activation switch. The catalog module exports no reader, resolver, or executor.
  for (const o of REPORT_OBJECTS) {
    assert.equal("active" in o, false, `${o.objectId} must not carry a runtime 'active' flag at F1`);
  }
});

// ---- object-level correctness ----------------------------------------------
ok("object read capabilities follow report.<object>.read", () => {
  for (const o of REPORT_OBJECTS) assert.equal(o.objectReadCapability, `report.${o.objectId}.read`);
});

ok("serviceHistory is derived (no own collection); every other object has one", () => {
  const sh = getReportObject("serviceHistory");
  assert.equal(sh.collection, null);
  assert.equal(sh.derivedFrom, "fieldops_wos");
  for (const o of REPORT_OBJECTS) {
    if (o.objectId !== "serviceHistory") assert.ok(o.collection, `${o.objectId} must have a collection`);
  }
});

ok("object->collection mappings match the platform's real collections", () => {
  const expect = {
    customer: "accounts", contact: "contacts", location: "locations", equipment: "equipment",
    job: "fieldops_jobs", workOrder: "fieldops_wos", technician: "fieldops_technicians",
    reorderRequest: "reorder_requests", purchaseOrder: "reorder_purchase_orders",
    inventoryAction: "inventory_actions", employee: "employees",
  };
  for (const [objectId, collection] of Object.entries(expect)) {
    assert.equal(getReportObject(objectId).collection, collection, `${objectId} -> ${collection}`);
  }
});

// ---- field-level correctness ------------------------------------------------
ok("every field declares a readCapability and a known sensitivity class", () => {
  for (const x of REPORT_FIELDS) {
    assert.ok(x.readCapability && x.readCapability.startsWith("report."), `${x.fieldId} needs a report.* capability`);
    assert.ok(REPORT_SENSITIVITY_CLASSES.includes(x.sensitivity), `${x.fieldId} sensitivity`);
  }
});

ok("declared operators are always legal for the field's data type", () => {
  for (const x of REPORT_FIELDS) {
    const legal = LEGAL_OPERATORS_BY_TYPE[x.dataType] ?? [];
    for (const op of x.operators) assert.ok(legal.includes(op), `${x.fieldId}: ${op} illegal for ${x.dataType}`);
  }
  // Only numbers aggregate; the wave-1 catalog has no numeric fields, so nothing aggregates yet.
  assert.equal(REPORT_FIELDS.some((x) => x.operators.includes("aggregate")), false,
    "no wave-1 field aggregates (there are no numeric fields yet)");
});

ok("free-text security-text fields expose NO operators (can't filter/sort/group a notes body)", () => {
  for (const id of ["customer.notes", "location.accessNotes"]) {
    const field = getReportField(id);
    assert.equal(field.sensitivity, "security-text", `${id} is security-text`);
    assert.deepEqual(field.operators, [], `${id} exposes no operators`);
  }
});

ok("the sensitive/governed fields are classified exactly as the Spec fixed them", () => {
  assert.equal(getReportField("customer.paymentTerms").sensitivity, "governed");
  assert.equal(getReportField("customer.taxStatus").sensitivity, "governed");
  assert.equal(getReportField("customer.defaultCurrency").sensitivity, "commercial");
  assert.equal(getReportField("customer.purchaseOrderRequired").sensitivity, "commercial");
  assert.equal(getReportField("customer.invoiceDeliveryMethod").sensitivity, "commercial");
  // The one employee-sensitive field sitting in a wave-1 table -- must NOT read as standard.
  assert.equal(getReportField("customer.accountOwner").sensitivity, "employee");
});

ok("fields grouped under one capability share it; distinct groups differ (Owner decision 1)", () => {
  const addr = ["street", "city", "state", "zip"].map((p) => getReportField(`customer.billingAddress.${p}`));
  assert.ok(addr.every((x) => x.readCapability === "report.customer.field.billingAddress.read"));
  const ext = ["customerNumber", "erpId", "accountingId", "legacyId"].map((p) => getReportField(`customer.${p}`));
  assert.ok(ext.every((x) => x.readCapability === "report.customer.field.externalIds.read"));
  assert.notEqual(addr[0].readCapability, ext[0].readCapability);
});

// ---- relationships ----------------------------------------------------------
ok("every reference field has a matching one-hop relationship; no arbitrary joins", () => {
  for (const x of REPORT_FIELDS) {
    if (x.dataType === "reference") {
      const r = REPORT_RELATIONSHIPS.find((rr) => rr.viaField === x.fieldId && rr.toObjectId === x.referenceTo);
      assert.ok(r, `${x.fieldId} -> ${x.referenceTo} needs a relationship entry`);
      assert.equal(r.hop, 1, "hop=1 at first activation");
      assert.equal(r.traversalCapability, x.readCapability, "traversal gated by the reference field's capability");
    }
  }
  assert.deepEqual(relationshipsFrom("equipment").map((r) => r.toObjectId).sort(), ["customer", "location"]);
});

// ---- the validator is load-bearing (mutation-sensitive) --------------------
// A validator only tested against a valid catalog proves nothing about what it REJECTS.
// validateReportCatalog takes the catalog as parameters, so here we feed it deliberately-
// corrupted catalogs and assert each class of defect is actually caught. The shipped
// (frozen) exports are never touched -- these are hand-built bad inputs.

// A minimal VALID catalog the mutations start from, so each test corrupts exactly one thing.
const okObjects = [
  { objectId: "customer", label: "Customer", collection: "accounts", activationWave: 1, objectReadCapability: "report.customer.read", fieldsPopulated: true },
  { objectId: "contact", label: "Contact", collection: "contacts", activationWave: 2, objectReadCapability: "report.contact.read", fieldsPopulated: false },
];
const okFields = [
  { fieldId: "customer.name", objectId: "customer", label: "Name", dataType: "string", sensitivity: "standard", operators: ["filter", "sort"], readCapability: "report.customer.field.name.read" },
  { fieldId: "customer.owner", objectId: "customer", label: "Owner", dataType: "reference", referenceTo: "contact", sensitivity: "standard", operators: ["filter"], readCapability: "report.customer.field.owner.read" },
];
const okRels = [
  { relationshipId: "customer->contact", fromObjectId: "customer", toObjectId: "contact", viaField: "customer.owner", cardinality: "one", traversalCapability: "report.customer.field.owner.read", hop: 1 },
];
const clone = (v) => JSON.parse(JSON.stringify(v));

function corrupt(mutate) {
  const o = clone(okObjects), f = clone(okFields), r = clone(okRels);
  mutate(o, f, r);
  return validateReportCatalog(o, f, r);
}

ok("the validator ACCEPTS a hand-built valid catalog (baseline for the mutations)", () => {
  assert.deepEqual(validateReportCatalog(clone(okObjects), clone(okFields), clone(okRels)), []);
});

ok("the validator CATCHES each class of corruption (feeding it broken catalogs)", () => {
  const caught = (mutate, needle) => {
    const errs = corrupt(mutate);
    assert.ok(errs.some((e) => e.includes(needle)), `expected an error containing "${needle}", got: ${JSON.stringify(errs)}`);
  };
  caught((o) => { o[0].objectReadCapability = "report.WRONG.read"; }, "objectReadCapability must be");
  caught((o) => { o.push(clone(o[0])); }, "duplicate objectId");
  caught((o) => { o[0].activationWave = 9; }, "activationWave must be an integer 1-6");
  caught((o) => { o[0].collection = ""; }, "missing collection");
  caught((o) => { o[1].fieldsPopulated = true; }, "fieldsPopulated but has no fields"); // contact stub flipped populated
  caught((o, f) => { f[0].objectId = "contact"; f[0].fieldId = "contact.name"; }, "fields present but fieldsPopulated is false"); // a field lands on the contact stub
  caught((o, f) => { f[0].dataType = "money"; }, "unknown dataType");
  caught((o, f) => { f[0].sensitivity = "made-up"; }, "unknown sensitivity");
  caught((o, f) => { f[0].readCapability = ""; }, "must declare a readCapability");
  caught((o, f) => { f[0].operators = ["aggregate"]; }, "not legal for type string"); // strings can't aggregate
  caught((o, f) => { f[0].operators = ["bogus"]; }, "unknown operator");
  caught((o, f) => { f[1].referenceTo = "ghost"; }, "referenceTo unknown object");
  caught((o, f) => { delete f[1].referenceTo; }, "must declare referenceTo");
  caught((o, f) => { f.push(clone(f[0])); }, "duplicate fieldId");
  caught((o, f, r) => { r[0].hop = 2; }, "only hop=1 relationships");
  caught((o, f, r) => { r[0].toObjectId = "ghost"; }, "unknown toObjectId");
  caught((o, f, r) => { r[0].traversalCapability = "report.other.read"; }, "traversalCapability must equal");
  caught((o, f, r) => { r.length = 0; }, "no matching relationship catalog entry"); // orphan reference field
  // review-round findings:
  caught((o, f) => { f[0].readCapability = "report.contact.field.name.read"; }, "readCapability must be report.customer.field."); // field gated by WRONG object's capability (Finding 1)
  caught((o, f) => { f[0].readCapability = "report.customer.field.name.write"; }, "readCapability must be report.customer.field."); // not a .read capability
  caught((o, f, r) => {
    // a relationship whose viaField lives on a different object than fromObjectId (Finding 2)
    f.push({ fieldId: "contact.acct", objectId: "contact", label: "Acct", dataType: "reference", referenceTo: "customer", sensitivity: "standard", operators: ["filter"], readCapability: "report.contact.field.acct.read" });
    r.push({ relationshipId: "customer->customer", fromObjectId: "customer", toObjectId: "customer", viaField: "contact.acct", cardinality: "one", traversalCapability: "report.contact.field.acct.read", hop: 1 });
  }, "belongs to contact, not fromObjectId customer");
  caught((o) => { o[1].label = "Customer"; }, "duplicate object label"); // Finding 3 (objects)
  caught((o, f) => {
    f.push({ fieldId: "customer.name2", objectId: "customer", label: "Name", dataType: "string", sensitivity: "standard", operators: ["filter"], readCapability: "report.customer.field.name2.read" });
  }, 'duplicate field label "Name"'); // Finding 3 (fields, per-object)
});

ok("labels repeating ACROSS objects are fine -- 'Name' on four objects is not a duplicate", () => {
  // Guard against over-zealous label uniqueness: the shipped catalog has four 'Name' fields
  // on different objects and must stay valid.
  const names = REPORT_FIELDS.filter((x) => x.label === "Name").map((x) => x.objectId).sort();
  assert.deepEqual(names, ["contact", "customer", "equipment", "location"]);
  assert.deepEqual(validateReportCatalog(), []);
});

console.log(`\n${passed} passed, 0 failed`);
