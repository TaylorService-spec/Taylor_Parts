// Inventory Transaction entity — A-ENTITY-INVENTORY-MOVEMENT-DEFINITIONS,
// A-HELD-DEFINITIONS-IDENTITY.
//
// Pins the intended behavior for the LIVE `inventory_transactions` ledger (two disjoint
// stored shapes, both live). Honest about what the collection actually is rather than
// idealizing it — see the definition file's header for the full grounding.
//
// ════════════════════ STOCK LOCATION IS GONE FROM THIS SUITE ════════════════════
//
// This file also covered `stockLocationEntity` and `stockLocationIndexList`. OWNER RULING,
// 2026-09-12: `stock_locations` IS RETIRED AS AN OPERATIONAL AUTHORITY, so the entity, its index
// list and its definition file are removed and there is nothing left here to pin. The retirement
// itself is guarded by test/stockLocationSurfaceRetired.test.jsx, which holds the surface DELETED
// rather than emptied — including, now, the metadata registration.
//
// Inventory Transaction was originally held because an earlier version nominated the shared
// `type` enum as nameField — the Owner's ruling (A-IDENTITY-MODES,
// X-INVENTORY-TRANSACTION-NO-IDENTITY) rejected that as the exact "nominate a category field"
// anti-pattern and requires identityMode SYSTEM_ONLY, explicitly declared, instead.

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateEntityDefinition, validateEntityRegistry, findField, resolveIdentityMode } from "../src/metadata/entityDefinition.js";
import { validateListViewDefinition, requiredIndexes } from "../src/metadata/listViewDefinition.js";
import { inventoryTransactionEntity } from "../src/metadata/definitions/inventoryTransaction.js";
import { partEntity } from "../src/metadata/definitions/part.js";
import { warehouseEntity } from "../src/metadata/definitions/warehouse.js";
import { equipmentModelEntity } from "../src/metadata/definitions/equipmentModel.js";
import { manufacturerEntity } from "../src/metadata/definitions/manufacturer.js";

// ---------------------------------------------------------------------------------------------
// Contract validity
// ---------------------------------------------------------------------------------------------

test("the Inventory Transaction entity is valid against the contract", () => {
  assert.deepEqual(validateEntityDefinition(inventoryTransactionEntity), []);
});

test("REFERENCE fields resolve against the real registered part/warehouse entities", () => {
  // equipmentModelEntity is included because part.js's own equipmentModelId field is now a real
  // REFERENCE to it (#1253, upgraded on main after this test was first authored) — omitting it
  // would report a false "references unknown entity" problem that belongs to part.js, not to
  // either entity this suite actually covers. manufacturerEntity closes the same chain one hop
  // further: equipmentModel.js's own manufacturerId is a REFERENCE to it.
  const registry = [inventoryTransactionEntity, partEntity, warehouseEntity, equipmentModelEntity, manufacturerEntity];
  assert.deepEqual(validateEntityRegistry(registry), []);
});

// ---------------------------------------------------------------------------------------------
// Identity — DECISIONS #106
// ---------------------------------------------------------------------------------------------

test("Inventory Transaction identity is SYSTEM_ONLY, explicitly declared -- per the Owner's ruling, `type` is NOT nominated as nameField", () => {
  assert.equal(inventoryTransactionEntity.identity.nameField, null);
  assert.equal(inventoryTransactionEntity.identity.referenceField, null);
  assert.equal(inventoryTransactionEntity.identity.mode, "SYSTEM_ONLY");
  assert.equal(resolveIdentityMode(inventoryTransactionEntity.identity), "SYSTEM_ONLY");
  assert.ok(findField(inventoryTransactionEntity, "type"));
});

test("Inventory Transaction read is CLIENT_DIRECT with no capability -- a matching catalog id exists but nothing evaluates it on this read path", () => {
  assert.equal(inventoryTransactionEntity.readVia, "CLIENT_DIRECT");
  assert.equal(inventoryTransactionEntity.readCapability, null);
});

test("fields shared by both stored shapes are declared: transactionId, partId, type, quantity", () => {
  for (const id of ["transactionId", "partId", "type", "quantity"]) {
    assert.ok(findField(inventoryTransactionEntity, id), id);
  }
});

test("legacy-only fields are declared: workOrderId, timestamp", () => {
  assert.ok(findField(inventoryTransactionEntity, "workOrderId"));
  assert.equal(findField(inventoryTransactionEntity, "timestamp").type, "TIMESTAMP");
});

test("operational-only fields are declared: schemaVersion, direction, trackingMode, idempotencyKey, occurredAt, recordedAt, fingerprint", () => {
  for (const id of ["schemaVersion", "direction", "trackingMode", "idempotencyKey", "occurredAt", "recordedAt", "fingerprint"]) {
    assert.ok(findField(inventoryTransactionEntity, id), id);
  }
});

test("conditional-tracking-mode fields are declared: serialNo (SERIAL-only), lotId (LOT-only, no live writer populates it)", () => {
  assert.ok(findField(inventoryTransactionEntity, "serialNo"));
  assert.ok(findField(inventoryTransactionEntity, "lotId"));
});

test("embedded-object fields (location, sourceObject, actor, counterpartyLocation) are deliberately NOT declared -- no v1 STRUCT FIELD_TYPE", () => {
  for (const id of ["location", "sourceObject", "actor", "counterpartyLocation"]) {
    assert.equal(findField(inventoryTransactionEntity, id), null, id);
  }
});

test("partId is a REFERENCE to the registered `part` entity", () => {
  const partId = findField(inventoryTransactionEntity, "partId");
  assert.equal(partId.type, "REFERENCE");
  assert.equal(partId.referenceTo, "part");
});

test("type is the seven-value STORED union, not the wider nine/ten-value design taxonomy -- COUNTED/RETURNED/SCRAPPED are absent", () => {
  const type = findField(inventoryTransactionEntity, "type");
  assert.deepEqual(
    [...type.enumValues].sort(),
    ["ADJUSTED", "CONSUMED", "RECEIVED", "RELEASED", "RESERVED", "TRANSFER_IN", "TRANSFER_OUT"]
  );
  for (const bogus of ["COUNTED", "RETURNED", "SCRAPPED"]) {
    assert.ok(!type.enumValues.includes(bogus), bogus);
  }
  for (const v of type.enumValues) {
    assert.notEqual(type.enumLabels[v], v, v); // the #1093 lesson
  }
});

test("neither type nor partId is declared filterable -- no real query narrows by either", () => {
  assert.equal(findField(inventoryTransactionEntity, "type").filterable, false);
  assert.equal(findField(inventoryTransactionEntity, "partId").filterable, false);
});

test("no relationships are declared on Inventory Transaction", () => {
  assert.equal(inventoryTransactionEntity.relationships.length, 0);
});

test("no index list view is authored for Inventory Transaction -- no field is sortable across both stored shapes", () => {
  // Deliberate omission, not an oversight -- see the file header. Confirmed here structurally:
  // the legacy era's only temporal field (timestamp) is absent from every operational document
  // and vice versa (recordedAt), so no single defaultSort could ever order every stored row.
  assert.equal(findField(inventoryTransactionEntity, "timestamp").sortable, false);
  assert.equal(findField(inventoryTransactionEntity, "recordedAt").sortable, false);
});
