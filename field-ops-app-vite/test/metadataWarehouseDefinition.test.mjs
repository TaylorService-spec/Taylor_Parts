// Warehouse entity + warehouse.index — S-INV-WAREHOUSE-SUPPLIER-DEFINITIONS.
//
// Pins the intended behavior for the LIVE `warehouses` collection (Epic 4 Warehouse +
// Fulfillment). Honest about what is genuinely inert — the full §3A governed writer/validator
// pipeline (createWarehouse/setWarehouseStatus, the receiving eligibility resolver) has no live
// caller anywhere in this repository — rather than idealizing it as though it were.

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateEntityDefinition, findField } from "../src/metadata/entityDefinition.js";
import { validateListViewDefinition, requiredIndexes } from "../src/metadata/listViewDefinition.js";
import { warehouseEntity, warehouseIndexList } from "../src/metadata/definitions/warehouse.js";
import { WAREHOUSE_STATUSES } from "../src/domain/warehousesView.js";

test("the Warehouse entity is valid against the contract", () => {
  assert.deepEqual(validateEntityDefinition(warehouseEntity), []);
});

test("the Warehouse index list is valid against the entity", () => {
  assert.deepEqual(validateListViewDefinition(warehouseIndexList, warehouseEntity), []);
});

test("the entity id is exactly \"warehouse\", collection is the live `warehouses` collection", () => {
  assert.equal(warehouseEntity.id, "warehouse");
  assert.equal(warehouseEntity.collection, "warehouses");
});

test("read is CLIENT_DIRECT with no capability -- Rules gate by role/relationship, not by capability", () => {
  assert.equal(warehouseEntity.readVia, "CLIENT_DIRECT");
  assert.equal(warehouseEntity.readCapability, null);
});

test("identity is a nameField only -- no reference number exists anywhere in this schema", () => {
  assert.equal(warehouseEntity.identity.nameField, "name");
  assert.equal(warehouseEntity.identity.referenceField, null);
  assert.ok(findField(warehouseEntity, "name"));
});

test("warehouseId is declared as its own ID field, not promoted into identity", () => {
  const warehouseId = findField(warehouseEntity, "warehouseId");
  assert.equal(warehouseId.type, "ID");
  assert.notEqual(warehouseEntity.identity.nameField, "warehouseId");
  assert.notEqual(warehouseEntity.identity.referenceField, "warehouseId");
});

test("location is a plain STRING, not a REFERENCE to the Customer-site `location` entity", () => {
  const location = findField(warehouseEntity, "location");
  assert.equal(location.type, "STRING");
  assert.notEqual(location.type, "REFERENCE");
});

test("status is the only field sourced from the §3A governed vocabulary, mirrored from domain/warehousesView.js", () => {
  const status = findField(warehouseEntity, "status");
  assert.equal(status.type, "ENUM");
  assert.deepEqual([...status.enumValues], [...WAREHOUSE_STATUSES]);
  for (const v of WAREHOUSE_STATUSES) {
    assert.ok(status.enumLabels[v]);
    // The #1093 lesson: label must differ from the stored machine value.
    assert.notEqual(status.enumLabels[v], v);
  }
});

test("the seven other §3A governed fields are deliberately NOT declared -- no live writer produces them", () => {
  // version/provenance/createdAt/createdBy/updatedAt/updatedBy/governanceInitializedAt/
  // governanceInitializedBy all exist on the GovernedWarehouse TypeScript type, but both real
  // producers of that shape (warehouseStatusWriter.ts, receivingLocationOptionsService.ts) are
  // production-inert with no caller anywhere in this repository. Declaring them here would assert
  // a governed shape the live collection has never actually been written in.
  for (const name of [
    "version",
    "provenance",
    "createdAt",
    "createdBy",
    "updatedAt",
    "updatedBy",
    "governanceInitializedAt",
    "governanceInitializedBy",
  ]) {
    assert.equal(findField(warehouseEntity, name), null, name);
  }
});

test("no outbound relationships are declared -- stock_locations/transfer_orders/mobile_locations have no registered owning entity", () => {
  assert.equal(warehouseEntity.relationships.length, 0);
});

test("the index list declares exactly one filter (status), matching the client-side WAREHOUSE_FILTERS split", () => {
  assert.equal(warehouseIndexList.filters.length, 1);
  assert.equal(warehouseIndexList.filters[0].fieldId, "status");
});

test("the index list demands exactly one net-new composite index: status + name + __name__", () => {
  const required = requiredIndexes(warehouseIndexList, warehouseEntity);
  assert.equal(required.length, 1);
  assert.deepEqual(
    required[0].fields.map((f) => f.fieldPath),
    ["status", "name", "__name__"]
  );
  assert.equal(required[0].collectionGroup, "warehouses");
});

test("default sort is name ASC -- matching fetchWarehousesPage's own orderByField", () => {
  assert.deepEqual(
    warehouseIndexList.defaultSort.map((s) => [s.fieldId, s.direction]),
    [["name", "ASC"]]
  );
  assert.equal(warehouseIndexList.tiebreaker, "__name__");
});
