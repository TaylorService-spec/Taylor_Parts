// THE GOVERNABLE OBJECT REGISTRY — its proofs.
//
// This union exists because two lists each claimed to be "the business objects" and neither was
// complete: the CRUD matrix had 24 rows, the metadata registry 29 entities, and THIRTEEN entities
// carrying 166 fields were in the matrix's blind spot — Supplier, Warehouse, Truck, Reorder
// Request, Sales Agreement and eight more. They reached no Administration screen and no policy seed.
//
// The tests that matter most here are the ones that keep the fix from becoming its own defect: the
// gap table may only use capabilities the matrix does not claim, and nothing may be dropped.
import test from "node:test";
import assert from "node:assert/strict";
import { ENTITY_REGISTRY } from "../src/metadata/entityRegistry.js";
import { OBJECT_PERMISSIONS } from "../src/access/objectPermissionMap.js";
import {
  ENTITY_BY_MATRIX_OBJECT,
  GOVERNABLE_OBJECTS,
  MATRIX_GAP_CAPABILITIES,
  findGovernableObject,
  governableObjectCounts,
  governedVerbs,
  matrixObjectKey,
} from "../src/access/policyObjectRegistry.js";

const VERBS = ["C", "R", "E", "D"];

// ============================ coverage ============================

test("the union covers every matrix row AND every registry entity", () => {
  const keys = new Set(GOVERNABLE_OBJECTS.map((o) => o.key));
  for (const entry of OBJECT_PERMISSIONS) {
    assert.ok(keys.has(matrixObjectKey(entry.object)), `matrix row "${entry.object}" is missing`);
  }
  for (const entity of ENTITY_REGISTRY) {
    assert.ok(keys.has(entity.id), `entity "${entity.id}" is missing`);
  }
});

test("the counts reconcile: 25 matrix rows + 29 entities, overlapping on 17, is 37 objects", () => {
  // 24 rows and 16 overlaps before the Owner ruling gave Reorder Request its own row. The TOTAL is
  // unchanged at 37 -- the object simply moved from registry-only to being in both lists, which is
  // what "it now has data authority of its own" looks like in these counts.
  const counts = governableObjectCounts();
  assert.equal(counts.objects, 37);
  assert.equal(counts.fromMatrixAndRegistry, 17, "in both lists");
  assert.equal(counts.matrixOnly, 8, "a matrix row with no EntityDefinition");
  assert.equal(counts.registryOnly, 12, "an entity the matrix never had a row for");
  assert.equal(counts.fromMatrixAndRegistry + counts.matrixOnly, OBJECT_PERMISSIONS.length);
  assert.equal(counts.fromMatrixAndRegistry + counts.registryOnly, ENTITY_REGISTRY.length);
  assert.equal(counts.fields, 394, "every declared field reaches the union");
});

test("no object key is claimed twice", () => {
  const keys = GOVERNABLE_OBJECTS.map((o) => o.key);
  assert.equal(new Set(keys).size, keys.length);
});

test("every field of every entity reaches its object", () => {
  for (const entity of ENTITY_REGISTRY) {
    const object = findGovernableObject(entity.id);
    assert.ok(object, `${entity.id} has an object`);
    assert.deepEqual(
      object.fields.map((f) => f.id),
      entity.fields.map((f) => f.id),
      `${entity.id}: the same fields, in the same order`,
    );
  }
});

// ============================ the gap table's one rule ============================

test("THE GAP TABLE MAY ONLY USE CAPABILITIES THE MATRIX DOES NOT CLAIM", () => {
  // Without this rule the table would be a second opinion about who governs what, and one
  // capability would answer to two objects. With it, the two are disjoint by construction.
  const claimedByMatrix = new Set();
  for (const entry of OBJECT_PERMISSIONS) {
    for (const verb of VERBS) for (const id of entry[verb] ?? []) claimedByMatrix.add(id);
  }

  for (const [objectKey, byVerb] of Object.entries(MATRIX_GAP_CAPABILITIES)) {
    for (const verb of VERBS) {
      for (const id of byVerb[verb] ?? []) {
        assert.equal(
          claimedByMatrix.has(id), false,
          `${objectKey}.${verb} maps "${id}", which the CRUD matrix already attributes to another object`,
        );
      }
    }
  }
});

test("the gap table only names objects the matrix has no row for", () => {
  const matrixKeys = new Set(OBJECT_PERMISSIONS.map((e) => matrixObjectKey(e.object)));
  for (const key of Object.keys(MATRIX_GAP_CAPABILITIES)) {
    assert.equal(matrixKeys.has(key), false, `"${key}" has a matrix row; extend that, not the gap table`);
    assert.ok(findGovernableObject(key), `"${key}" must be a real object`);
  }
});

test("the three fillable gaps are filled, and they are the only ones", () => {
  assert.deepEqual(Object.keys(MATRIX_GAP_CAPABILITIES).sort(), ["salesAgreement", "stockLocation", "warehouse"]);
  assert.deepEqual(governedVerbs(findGovernableObject("warehouse")), { C: false, R: true, E: false, D: false });
  assert.deepEqual(governedVerbs(findGovernableObject("salesAgreement")), { C: true, R: true, E: true, D: false });
});

test("REORDER REQUEST owns its own data authority — the Owner decision, CLOSED", () => {
  // WAS: every verb ungrantable, because its twelve capabilities were attributed to the matrix's
  // "Purchase Orders" row and choosing an owner was a business decision.
  //
  // NOW: Reorder Request and Purchase Order are separate canonical Objects. Create and Read are its
  // own; Edit stays empty because every edit-shaped reorder capability is a Parts / Purchasing
  // WORKFLOW ACTION, and a workflow action is never a CRED checkbox.
  const reorder = findGovernableObject("reorderRequest");
  assert.ok(reorder);
  assert.deepEqual(governedVerbs(reorder), { C: true, R: true, E: false, D: false });
  assert.equal(reorder.fields.length, 37, "with all its fields");
  assert.equal(reorder.source, "MATRIX_AND_REGISTRY", "it has a row of its own now");

  // And the purchase order kept only its own authority.
  const purchaseOrder = findGovernableObject("purchaseOrder");
  assert.deepEqual(governedVerbs(purchaseOrder), { C: true, R: true, E: false, D: false });
  const poIds = ["C", "R", "E", "D"].flatMap((v) => purchaseOrder.capabilitiesByVerb[v] ?? []);
  assert.equal(
    poIds.some((id) => id.startsWith("reorder.request.")), false,
    "no reorder request capability survives on the purchase order",
  );
});

// ============================ honesty about what is not known ============================

test("an object no capability governs is present with every verb ungrantable", () => {
  for (const key of ["supplier", "truck", "mobileLocation", "partAlias", "manufacturer"]) {
    const object = findGovernableObject(key);
    assert.ok(object, `${key} is present`);
    const governed = governedVerbs(object);
    // manufacturer declares its own readCapability; the others declare nothing.
    if (key === "manufacturer") assert.equal(governed.R, true, "its entity declares a read capability");
    else assert.equal(governed.R, false, `${key} has no governing read capability`);
    assert.equal(governed.C, false);
    assert.equal(governed.E, false);
    assert.equal(governed.D, false);
  }
});

test("a registry-only object states no business domain rather than guessing one", () => {
  for (const object of GOVERNABLE_OBJECTS.filter((o) => o.source === "REGISTRY_ONLY")) {
    assert.equal(object.domain, null, `${object.key}: the matrix carries domain, an entity does not`);
  }
  for (const object of GOVERNABLE_OBJECTS.filter((o) => o.source !== "REGISTRY_ONLY")) {
    assert.ok(object.domain, `${object.key}: a matrix row always has one`);
  }
});

test("supportsDelete is true only where a capability governs Delete", () => {
  // Measured: nothing in this platform hard-deletes a business record -- they are archived,
  // cancelled, voided or deactivated -- so today no object supports it. Asserted as a property
  // rather than as the number zero, so adding a real delete capability does not fail this.
  for (const object of GOVERNABLE_OBJECTS) {
    assert.equal(
      object.supportsDelete,
      (object.capabilitiesByVerb.D ?? []).length > 0,
      `${object.key}: supportsDelete must follow the capability, not a guess`,
    );
  }
});

test("the matrix-object mapping is complete for every row that has an entity", () => {
  // A row whose key resolves to no entity is MATRIX_ONLY and must genuinely have no entity -- not
  // an entity whose id the mapping forgot.
  for (const object of GOVERNABLE_OBJECTS.filter((o) => o.source === "MATRIX_ONLY")) {
    assert.equal(
      ENTITY_REGISTRY.some((e) => e.id === object.key), false,
      `"${object.label}" is marked matrix-only but entity "${object.key}" exists -- add it to ENTITY_BY_MATRIX_OBJECT`,
    );
  }
  for (const [name, entityId] of Object.entries(ENTITY_BY_MATRIX_OBJECT)) {
    assert.ok(ENTITY_REGISTRY.some((e) => e.id === entityId), `"${name}" maps to unknown entity "${entityId}"`);
    assert.ok(OBJECT_PERMISSIONS.some((e) => e.object === name), `"${name}" is not a matrix row`);
  }
});

test("matrixObjectKey produces a stable, usable key for an unmapped row", () => {
  assert.equal(matrixObjectKey("Invoices / AR"), "invoice", "mapped rows use the entity id");
  assert.equal(matrixObjectKey("Marketing Initiatives"), "marketingInitiatives");
  assert.equal(matrixObjectKey("Technician Time / Non-work"), "technicianTimeNonWork");
  assert.equal(matrixObjectKey("Roles / Permissions"), "rolesPermissions");
});
