// Supplier entity + supplier.index — S-INV-WAREHOUSE-SUPPLIER-DEFINITIONS.
//
// Pins the intended behavior for the `suppliers` collection under Supplier Master governance.
// Honest that this collection holds two kinds of document -- a fully governed record and a legacy
// Epic-5 demo record predating governance -- and that the governed write path, though exported
// from functions/src/index.ts, is explicitly not deployed to production.

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateEntityDefinition, findField } from "../src/metadata/entityDefinition.js";
import { validateListViewDefinition, requiredIndexes } from "../src/metadata/listViewDefinition.js";
import { supplierEntity, supplierIndexList } from "../src/metadata/definitions/supplier.js";
import { SUPPLIER_STATUSES } from "../src/domain/suppliersView.js";

test("the Supplier entity is valid against the contract", () => {
  assert.deepEqual(validateEntityDefinition(supplierEntity), []);
});

test("the Supplier index list is valid against the entity", () => {
  assert.deepEqual(validateListViewDefinition(supplierIndexList, supplierEntity), []);
});

test("the entity id is exactly \"supplier\", collection is the live `suppliers` collection", () => {
  assert.equal(supplierEntity.id, "supplier");
  assert.equal(supplierEntity.collection, "suppliers");
});

test("read is CLIENT_DIRECT with no capability -- Rules gate by role, not by capability", () => {
  assert.equal(supplierEntity.readVia, "CLIENT_DIRECT");
  assert.equal(supplierEntity.readCapability, null);
});

test("identity is a nameField only -- vendorNumber is optional/unenforced and is not promoted (DECISIONS #106)", () => {
  assert.equal(supplierEntity.identity.nameField, "name");
  assert.equal(supplierEntity.identity.referenceField, null);
  assert.ok(findField(supplierEntity, "name"));
  const vendorNumber = findField(supplierEntity, "vendorNumber");
  assert.ok(vendorNumber);
  assert.notEqual(supplierEntity.identity.referenceField, "vendorNumber");
});

test("supplierId is declared as its own ID field, not promoted into identity", () => {
  const supplierId = findField(supplierEntity, "supplierId");
  assert.equal(supplierId.type, "ID");
  assert.notEqual(supplierEntity.identity.nameField, "supplierId");
  assert.notEqual(supplierEntity.identity.referenceField, "supplierId");
});

test("normalizedKey is declared, rendered but never filterable -- dedup DETECTION only, never a query key", () => {
  const normalizedKey = findField(supplierEntity, "normalizedKey");
  assert.equal(normalizedKey.type, "STRING");
  assert.equal(normalizedKey.filterable, false);
});

test("status is sourced from the Supplier Master vocabulary, mirrored from domain/suppliersView.js", () => {
  const status = findField(supplierEntity, "status");
  assert.equal(status.type, "ENUM");
  assert.deepEqual([...status.enumValues], [...SUPPLIER_STATUSES]);
  for (const v of SUPPLIER_STATUSES) {
    assert.ok(status.enumLabels[v]);
    assert.notEqual(status.enumLabels[v], v);
  }
});

test("the governed provenance pack (version/createdAt/createdBy/updatedAt/updatedBy) is declared, using real Timestamps", () => {
  const version = findField(supplierEntity, "version");
  const createdAt = findField(supplierEntity, "createdAt");
  const createdBy = findField(supplierEntity, "createdBy");
  const updatedAt = findField(supplierEntity, "updatedAt");
  const updatedBy = findField(supplierEntity, "updatedBy");
  assert.equal(version.type, "NUMBER");
  assert.equal(createdAt.type, "TIMESTAMP");
  assert.equal(updatedAt.type, "TIMESTAMP");
  assert.equal(createdBy.type, "STRING");
  assert.equal(updatedBy.type, "STRING");
  // Unlike warehouse.js/employee.js/equipment.js/location.js's epoch-millisecond provenance, a
  // governed Supplier's createdAt/updatedAt are real Firestore server Timestamps
  // (Timestamp.fromDate in supplierMasterCommands.ts) -- never NUMBER.
  assert.notEqual(createdAt.type, "NUMBER");
  assert.notEqual(updatedAt.type, "NUMBER");
});

test("legacy Epic-5-only fields (contactEmail, leadTimeDays) are not declared -- no equivalent in the governed shape", () => {
  for (const name of ["contactEmail", "leadTimeDays"]) {
    assert.equal(findField(supplierEntity, name), null, name);
  }
});

test("optional business fields are declared as plain strings, matching SUPPLIER_OPTIONAL_STRING_FIELDS", () => {
  for (const name of ["contactName", "phone", "email", "address", "paymentTermsRef"]) {
    const field = findField(supplierEntity, name);
    assert.equal(field.type, "STRING", name);
  }
  assert.equal(findField(supplierEntity, "notes").type, "TEXT");
});

test("no outbound relationships are declared -- part_supplier_items has no registered owning entity", () => {
  assert.equal(supplierEntity.relationships.length, 0);
});

test("the index list declares exactly one filter (status), matching the client-side SUPPLIER_FILTERS split", () => {
  assert.equal(supplierIndexList.filters.length, 1);
  assert.equal(supplierIndexList.filters[0].fieldId, "status");
});

test("the index list demands exactly one net-new composite index: status + name + __name__", () => {
  const required = requiredIndexes(supplierIndexList, supplierEntity);
  assert.equal(required.length, 1);
  assert.deepEqual(
    required[0].fields.map((f) => f.fieldPath),
    ["status", "name", "__name__"]
  );
  assert.equal(required[0].collectionGroup, "suppliers");
});

test("default sort is name ASC -- matching fetchSuppliersPage's own orderByField", () => {
  assert.deepEqual(
    supplierIndexList.defaultSort.map((s) => [s.fieldId, s.direction]),
    [["name", "ASC"]]
  );
  assert.equal(supplierIndexList.tiebreaker, "__name__");
});
