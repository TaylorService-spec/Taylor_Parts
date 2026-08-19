// Stock Location definition contract.
//
// Authored alongside an Inventory Transaction definition that was NOT merged: that entity has
// neither a human name nor a server-allocated reference, and entityDefinition.js says plainly that
// such an entity is "a data-model gap to record, not a fallback to normalize". See
// X-INVENTORY-TRANSACTION-NO-IDENTITY in the metadata program ledger.
//
// Pins the intended behavior for the `stock_locations` collection: seeded, dead-code-backed,
// with no live writer anywhere in this repository. Honest about what the collection actually
// is rather than idealizing it — see the definition file's header for the full grounding.

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateEntityDefinition, validateEntityRegistry, findField } from "../src/metadata/entityDefinition.js";
import { validateListViewDefinition, requiredIndexes } from "../src/metadata/listViewDefinition.js";
import { stockLocationEntity, stockLocationIndexList } from "../src/metadata/definitions/stockLocation.js";
import { partEntity } from "../src/metadata/definitions/part.js";
import { warehouseEntity } from "../src/metadata/definitions/warehouse.js";

// ---------------------------------------------------------------------------------------------
// Contract validity
// ---------------------------------------------------------------------------------------------

test("the Stock Location entity is valid against the contract", () => {
  assert.deepEqual(validateEntityDefinition(stockLocationEntity), []);
});

test("the Stock Location index list is valid against the entity", () => {
  assert.deepEqual(validateListViewDefinition(stockLocationIndexList, stockLocationEntity), []);
});

test("Stock Location identity is a nameField only (binCode) -- caller-supplied, not server-allocated, so never referenceField", () => {
  assert.equal(stockLocationEntity.identity.nameField, "binCode");
  assert.equal(stockLocationEntity.identity.referenceField, null);
});

// ---------------------------------------------------------------------------------------------
// readVia / readCapability -- role-gated in Rules, a matching capability exists but is unconsumed
// ---------------------------------------------------------------------------------------------

test("Stock Location fields match the seeded/TypeScript shape exactly: id, warehouseId, partId, binCode, quantity, updatedAt", () => {
  for (const id of ["id", "warehouseId", "partId", "binCode", "quantity", "updatedAt"]) {
    assert.ok(findField(stockLocationEntity, id), id);
  }
  assert.equal(stockLocationEntity.fields.length, 6);
});

test("warehouseId and partId are REFERENCE fields to the registered warehouse/part entities", () => {
  const warehouseId = findField(stockLocationEntity, "warehouseId");
  assert.equal(warehouseId.type, "REFERENCE");
  assert.equal(warehouseId.referenceTo, "warehouse");
  const partId = findField(stockLocationEntity, "partId");
  assert.equal(partId.type, "REFERENCE");
  assert.equal(partId.referenceTo, "part");
});

test("no createdAt/createdBy/updatedBy exist -- updatedAt is the only provenance-shaped field in this schema", () => {
  for (const id of ["createdAt", "createdBy", "updatedBy"]) {
    assert.equal(findField(stockLocationEntity, id), null, id);
  }
  assert.equal(findField(stockLocationEntity, "updatedAt").type, "TIMESTAMP");
});

test("no relationships are declared on Stock Location -- the Warehouse -> Stock Locations edge belongs on warehouse.js", () => {
  assert.equal(stockLocationEntity.relationships.length, 0);
});

test("the Stock Location index declares exactly one filter (warehouseId), matching the one real (dead) query this collection was built to serve", () => {
  assert.equal(stockLocationIndexList.filters.length, 1);
  assert.equal(stockLocationIndexList.filters[0].fieldId, "warehouseId");
});

test("default sort is binCode ASC, catalog order -- matching part.index's own idiom", () => {
  assert.deepEqual(
    stockLocationIndexList.defaultSort.map((s) => [s.fieldId, s.direction]),
    [["binCode", "ASC"]]
  );
  assert.equal(stockLocationIndexList.tiebreaker, "__name__");
});

test("the Stock Location index demands exactly one net-new composite index: warehouseId + binCode + __name__", () => {
  const required = requiredIndexes(stockLocationIndexList, stockLocationEntity);
  assert.equal(required.length, 1);
  assert.deepEqual(
    required[0].fields.map((f) => f.fieldPath),
    ["warehouseId", "binCode", "__name__"]
  );
  assert.equal(required[0].collectionGroup, "stock_locations");
});
