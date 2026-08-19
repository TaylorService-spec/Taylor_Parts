// Truck + EquipmentModel entities and their index lists — A-ENTITY-FLEET-CATALOG-DEFINITIONS.
//
// Pins the intended behavior for the LIVE `trucks` collection (EI-P1d-2-2b Truck Registry,
// ADR-010) and the pre-deployment `equipment_models` collection (D4 Part-Equipment
// Compatibility) — honest about what is genuinely undeployed (the Truck Registry commands, the
// equipment_models Rules/callable) rather than idealizing either as though it were live.

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateEntityDefinition, validateEntityRegistry, findField } from "../src/metadata/entityDefinition.js";
import { validateListViewDefinition, requiredIndexes } from "../src/metadata/listViewDefinition.js";
import { truckEntity, truckIndexList } from "../src/metadata/definitions/truck.js";
import * as equipmentModelModule from "../src/metadata/definitions/equipmentModel.js";
const { equipmentModelEntity } = equipmentModelModule;
import { mobileLocationEntity } from "../src/metadata/definitions/mobileLocation.js";
import { warehouseEntity } from "../src/metadata/definitions/warehouse.js";
import { employeeEntity } from "../src/metadata/definitions/employee.js";
import { manufacturerEntity } from "../src/metadata/definitions/manufacturer.js";
import { TRUCK_STATUS_OPTIONS } from "../src/domain/truckManagement.js";
import { MODEL_STATUSES } from "../src/domain/equipmentModel.js";

// ---------------------------------------------------------------------------
// Truck
// ---------------------------------------------------------------------------

test("the Truck entity is valid against the contract", () => {
  assert.deepEqual(validateEntityDefinition(truckEntity), []);
});

test("the Truck index list is valid against the entity", () => {
  assert.deepEqual(validateListViewDefinition(truckIndexList, truckEntity), []);
});

test("the entity id is exactly \"truck\", collection is the live `trucks` collection", () => {
  assert.equal(truckEntity.id, "truck");
  assert.equal(truckEntity.collection, "trucks");
});

test("read is CLIENT_DIRECT with no capability -- Rules gate by role (admin/dispatcher), not by capability", () => {
  assert.equal(truckEntity.readVia, "CLIENT_DIRECT");
  assert.equal(truckEntity.readCapability, null);
});

test("identity is a nameField only -- displayLabel, deliberately NOT vehicleNumber", () => {
  assert.equal(truckEntity.identity.nameField, "displayLabel");
  assert.equal(truckEntity.identity.referenceField, null);
  assert.ok(findField(truckEntity, "displayLabel"));
});

test("vehicleNumber is declared but NOT promoted to referenceField -- no enforced uniqueness exists", () => {
  const vehicleNumber = findField(truckEntity, "vehicleNumber");
  assert.ok(vehicleNumber);
  assert.equal(vehicleNumber.type, "STRING");
  assert.notEqual(truckEntity.identity.referenceField, "vehicleNumber");
  assert.notEqual(truckEntity.identity.nameField, "vehicleNumber");
});

test("truckId is declared as its own ID field, not promoted into identity", () => {
  const truckId = findField(truckEntity, "truckId");
  assert.equal(truckId.type, "ID");
  assert.notEqual(truckEntity.identity.nameField, "truckId");
  assert.notEqual(truckEntity.identity.referenceField, "truckId");
});

test("locationId is now a REFERENCE to the registered mobileLocation entity (A-DEFERRED-REFERENCE-UPGRADES)", () => {
  const locationId = findField(truckEntity, "locationId");
  assert.equal(locationId.type, "REFERENCE");
  assert.equal(locationId.referenceTo, "mobileLocation");
});

test("homeWarehouseId is a REFERENCE to the registered warehouse entity", () => {
  const homeWarehouseId = findField(truckEntity, "homeWarehouseId");
  assert.equal(homeWarehouseId.type, "REFERENCE");
  assert.equal(homeWarehouseId.referenceTo, "warehouse");
});

test("assignedDriverEmployeeId is a nullable REFERENCE to the registered employee entity", () => {
  const driver = findField(truckEntity, "assignedDriverEmployeeId");
  assert.equal(driver.type, "REFERENCE");
  assert.equal(driver.referenceTo, "employee");
});

test("status carries the full governed TRUCK_STATUS_OPTIONS enum with differing labels", () => {
  const status = findField(truckEntity, "status");
  assert.equal(status.type, "ENUM");
  assert.deepEqual([...status.enumValues], [...TRUCK_STATUS_OPTIONS]);
  for (const v of TRUCK_STATUS_OPTIONS) {
    assert.ok(status.enumLabels[v]);
    assert.notEqual(status.enumLabels[v], v);
  }
});

test("active is declared separately from status -- a structural fact, not a duplicate", () => {
  const active = findField(truckEntity, "active");
  assert.equal(active.type, "BOOLEAN");
});

test("provenance is fully declared -- version + createdAt/createdBy/updatedAt/updatedBy, a mutable record", () => {
  for (const name of ["version", "createdAt", "createdBy", "updatedAt", "updatedBy"]) {
    assert.ok(findField(truckEntity, name), name);
  }
});

test("no relationships are declared -- mobile_locations has no registered owning entity", () => {
  assert.equal(truckEntity.relationships.length, 0);
});

test("the Truck index declares exactly two filters: status and homeWarehouseId", () => {
  assert.equal(truckIndexList.filters.length, 2);
  assert.deepEqual(
    truckIndexList.filters.map((f) => f.fieldId).sort(),
    ["homeWarehouseId", "status"]
  );
});

test("the Truck index required indexes match its declared filters (requiredIndexes() output)", () => {
  const required = requiredIndexes(truckIndexList, truckEntity);
  assert.equal(required.length, 3); // status only, homeWarehouseId only, both (the unfiltered single-field-sort case needs no composite)
  for (const idx of required) {
    assert.equal(idx.collectionGroup, "trucks");
    assert.ok(idx.fields.at(-1).fieldPath === "__name__" || idx.fields.at(-2)?.fieldPath === "displayLabel");
  }
});

test("Truck default sort is displayLabel ASC, tiebroken by __name__", () => {
  assert.deepEqual(
    truckIndexList.defaultSort.map((s) => [s.fieldId, s.direction]),
    [["displayLabel", "ASC"]]
  );
  assert.equal(truckIndexList.tiebreaker, "__name__");
});

// ---------------------------------------------------------------------------
// EquipmentModel
// ---------------------------------------------------------------------------

test("the EquipmentModel entity is valid against the contract", () => {
  assert.deepEqual(validateEntityDefinition(equipmentModelEntity), []);
});


test("the entity id is exactly \"equipmentModel\", collection is `equipment_models`", () => {
  assert.equal(equipmentModelEntity.id, "equipmentModel");
  assert.equal(equipmentModelEntity.collection, "equipment_models");
});

test("read is CALLABLE via the real (undeployed) equipmentCompatibilityReadCallable, gated by an inactive capability", () => {
  assert.equal(equipmentModelEntity.readVia, "CALLABLE");
  assert.equal(equipmentModelEntity.readCallable, "equipmentCompatibilityReadCallable");
  assert.equal(equipmentModelEntity.readCapability, "equipment.compatibility.view");
});

test("identity is a nameField only -- displayName, no independently-unique reference exists", () => {
  assert.equal(equipmentModelEntity.identity.nameField, "displayName");
  assert.equal(equipmentModelEntity.identity.referenceField, null);
  assert.ok(findField(equipmentModelEntity, "displayName"));
});

test("modelNumber is declared but NOT promoted to referenceField -- unique only in combination with manufacturerId", () => {
  const modelNumber = findField(equipmentModelEntity, "modelNumber");
  assert.ok(modelNumber);
  assert.equal(modelNumber.type, "STRING");
  assert.notEqual(equipmentModelEntity.identity.referenceField, "modelNumber");
});

test("equipmentModelId is declared as its own ID field, not promoted into identity", () => {
  const equipmentModelId = findField(equipmentModelEntity, "equipmentModelId");
  assert.equal(equipmentModelId.type, "ID");
  assert.notEqual(equipmentModelEntity.identity.nameField, "equipmentModelId");
  assert.notEqual(equipmentModelEntity.identity.referenceField, "equipmentModelId");
});

test("manufacturerId is a REFERENCE to the registered manufacturer entity; manufacturerName stays a plain denormalized string", () => {
  const manufacturerId = findField(equipmentModelEntity, "manufacturerId");
  assert.equal(manufacturerId.type, "REFERENCE");
  assert.equal(manufacturerId.referenceTo, "manufacturer");
  const manufacturerName = findField(equipmentModelEntity, "manufacturerName");
  assert.equal(manufacturerName.type, "STRING");
});

test("status carries the full governed MODEL_STATUSES enum with differing labels", () => {
  const status = findField(equipmentModelEntity, "status");
  assert.equal(status.type, "ENUM");
  assert.deepEqual([...status.enumValues], [...MODEL_STATUSES]);
  for (const v of MODEL_STATUSES) {
    assert.ok(status.enumLabels[v]);
    assert.notEqual(status.enumLabels[v], v);
  }
});

test("family/subtype/revision are declared as optional, non-filterable, non-sortable strings", () => {
  for (const name of ["family", "subtype", "revision"]) {
    const field = findField(equipmentModelEntity, name);
    assert.equal(field.type, "STRING", name);
    assert.equal(field.filterable, false, name);
    assert.equal(field.sortable, false, name);
  }
});

test("provenance is fully declared -- version + createdAt/createdBy/updatedAt/updatedBy, a mutable record", () => {
  for (const name of ["version", "createdAt", "createdBy", "updatedAt", "updatedBy"]) {
    assert.ok(findField(equipmentModelEntity, name), name);
  }
});

test("no relationships are declared -- equipment_model_aliases/equipment_part_compatibility have no registered owning entity", () => {
  assert.equal(equipmentModelEntity.relationships.length, 0);
});




// ---------------------------------------------------------------------------
// Registry cross-validation (A-DEFERRED-REFERENCE-UPGRADES)
// ---------------------------------------------------------------------------

test("truck.locationId's REFERENCE resolves against the real registered set -- no unknown-entity problem", () => {
  const registered = [truckEntity, mobileLocationEntity, warehouseEntity, employeeEntity, equipmentModelEntity, manufacturerEntity];
  const problems = validateEntityRegistry(registered);
  assert.deepEqual(problems, []);
});

test("equipmentModel declares NO index list view -- equipment_models is D4-governed", () => {
  // Not an omission: functions/src/equipmentCompatibility/repository.ts declares
  // EQUIPMENT_MODELS_COLLECTION, and D4 defers compound query shapes to D5. An earlier revision
  // declared an INDEX list whose filters derived three equipment_models composites, breaching
  // that boundary. Asserted here so re-adding one fails in the metadata program's own suite,
  // not only in D4's registry guard -- a boundary is worth checking from both sides.
  assert.equal(equipmentModelModule.equipmentModelIndexList, undefined);
  const lists = Object.values(equipmentModelModule).filter((v) => v && Array.isArray(v.columns));
  assert.deepEqual(lists, [], "equipmentModel must export no ListViewDefinition");
});
