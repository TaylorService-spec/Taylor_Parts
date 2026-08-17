// Part entity + part.index — the first definition whose document id and business
// identity are the same thing, and the first whose provenance invariant actually holds.
//
// These pin INTENDED behavior, not merely what happens to be true today: the
// storage-name divergence is described rather than silently renamed, the
// deliberately-absent stock/cost fields stay undeclared, readCapability reflects that
// nothing gates this collection by capability, the enum vocabulary comes from a domain
// module rather than a copy inside the definition, and identity is honest about partId
// being the document id.

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateEntityDefinition, findField } from "../src/metadata/entityDefinition.js";
import { validateListViewDefinition, requiredIndexes } from "../src/metadata/listViewDefinition.js";
import { partEntity, partIndexList } from "../src/metadata/definitions/part.js";
import {
  PART_STATUSES, PART_STATUS_LABEL,
  STOCKING_CLASSES, STOCKING_CLASS_LABEL,
  OEM_STATUSES, OEM_STATUS_LABEL,
} from "../src/domain/partVocabulary.js";

test("the Part entity is valid against the contract", () => {
  assert.deepEqual(validateEntityDefinition(partEntity), []);
});

test("the Parts index is valid against the entity", () => {
  assert.deepEqual(validateListViewDefinition(partIndexList, partEntity), []);
});

test("identity is honest about partId being the document id, not a fallback", () => {
  // partId is declared as its own field (type ID) because partFromFirestore enforces
  // data.partId === docId — but identity itself points at name and internalPartNumber,
  // the two things a human actually reads, never at partId.
  const partIdField = findField(partEntity, "partId");
  assert.ok(partIdField, "partId must be declared as a field");
  assert.equal(partIdField.type, "ID");
  assert.notEqual(partEntity.identity.nameField, "partId");
  assert.notEqual(partEntity.identity.referenceField, "partId");
});

test("Part is the first entity with BOTH identity fields genuinely present", () => {
  // Every other entity in this program has exactly one — a name (Account, Contact) or a
  // reference (Work Order, Opportunity, Sales Order). Both are non-optional on Part's
  // domain type, so both are declared.
  assert.equal(partEntity.identity.nameField, "name");
  assert.equal(partEntity.identity.referenceField, "internalPartNumber");
  assert.ok(findField(partEntity, "name"));
  assert.ok(findField(partEntity, "internalPartNumber"));
});

test("the manufacturer field names what is STORED, and describes the divergence from the domain type", () => {
  // functions/src/partMaster/types.ts calls it manufacturerId; partToFirestore /
  // partFromFirestore read and write primaryManufacturerId. The definition must track
  // storage, and the gap must be recorded rather than silently renamed away.
  assert.equal(findField(partEntity, "manufacturerId"), null);
  const field = findField(partEntity, "primaryManufacturerId");
  assert.ok(field, "primaryManufacturerId must be declared under its STORED name");
  assert.match(field.description, /primaryManufacturerId/);
  assert.match(field.description, /manufacturerId/);
});

test("primaryManufacturerId and equipmentModelId stay plain strings, not REFERENCE fields", () => {
  // No manufacturer or equipmentModel entity is registered anywhere in this program yet.
  // A REFERENCE field naming one would point at an entity nothing defines.
  for (const id of ["primaryManufacturerId", "equipmentModelId"]) {
    const field = findField(partEntity, id);
    assert.equal(field.type, "STRING", id);
    assert.equal(field.referenceTo, null, id);
  }
  // And no relationships[] entries stand in for them either, for the identical reason.
  assert.equal(partEntity.relationships.length, 0);
});

test("the deliberately-absent stock, cost and supplier fields are NOT declared", () => {
  // ADR-008: Part carries descriptive identity only. onHand/reserved/available live in
  // the ledger; supplierCost/purchasePrice/leadTime/reorderRecommendation live in
  // part_supplier_items and analytics. Declaring any of them would assert an authority
  // this collection does not hold.
  for (const name of [
    "onHand", "reserved", "available",
    "supplierCost", "purchasePrice", "leadTime", "reorderRecommendation",
    "aliases", "suppliers",
  ]) {
    assert.equal(findField(partEntity, name), null, name);
  }
});

test("flags is an embedded object with no FIELD_TYPE that fits it, so it is undeclared", () => {
  assert.equal(findField(partEntity, "flags"), null);
  assert.equal(findField(partEntity, "expiryTracked"), null);
  assert.equal(findField(partEntity, "consumable"), null);
  assert.equal(findField(partEntity, "returnableCore"), null);
});

test("no capability gates this collection — Rules admit by role, not by capability", () => {
  // firestore.rules allows read for admin/dispatcher OR the active operational roles
  // PARTS_MANAGER / WAREHOUSE_MANAGER — a raw role check, not a capability id. Declaring
  // one here would be inventing an authority nothing enforces, the same finding
  // contact.js already made.
  assert.equal(partEntity.readCapability, null);
  assert.equal(partEntity.readVia, "CLIENT_DIRECT");
});

test("provenance is declared, unlike Contact — Part's one write path satisfies the invariant", () => {
  // Contact's three write paths disagree, so contact.js leaves createdAt/createdBy/
  // updatedAt/updatedBy all undeclared. Part has exactly one write path
  // (partMasterCommands.ts through the repository) and readMeta rejects a stored record
  // missing any of version/createdAt/createdBy/updatedAt/updatedBy — the invariant
  // actually holds here.
  for (const name of ["version", "createdAt", "createdBy", "updatedAt", "updatedBy"]) {
    assert.ok(findField(partEntity, name), name);
  }
});

test("status and stockingClass vocabulary come from domain/partVocabulary.js, not a copy here", () => {
  const status = findField(partEntity, "status");
  assert.deepEqual([...status.enumValues], [...PART_STATUSES]);
  assert.deepEqual({ ...status.enumLabels }, { ...PART_STATUS_LABEL });

  const stockingClass = findField(partEntity, "stockingClass");
  assert.deepEqual([...stockingClass.enumValues], [...STOCKING_CLASSES]);
  assert.deepEqual({ ...stockingClass.enumLabels }, { ...STOCKING_CLASS_LABEL });
});

test("oemStatus has a fresh label map — no client copy of the values existed before this", () => {
  const oemStatus = findField(partEntity, "oemStatus");
  assert.deepEqual([...oemStatus.enumValues], [...OEM_STATUSES]);
  assert.deepEqual({ ...oemStatus.enumLabels }, { ...OEM_STATUS_LABEL });
  // #1093's check, exercised directly: no label equals its own machine value.
  for (const v of oemStatus.enumValues) {
    assert.notEqual(oemStatus.enumLabels[v], v);
  }
});

test("wholeUnit is declared BOOLEAN and its sparse-storage rule is described in prose", () => {
  const field = findField(partEntity, "wholeUnit");
  assert.equal(field.type, "BOOLEAN");
  assert.match(field.description, /ONLY when true/);
});

test("stockingUnit renders but claims no filter — index cost, the same restraint workOrder.js applies to priority", () => {
  const unit = findField(partEntity, "stockingUnit");
  assert.equal(unit.filterable, false);
  assert.deepEqual(unit.operators, []);
  assert.ok(partIndexList.columns.some((c) => c.fieldId === "stockingUnit"));
  assert.ok(!partIndexList.filters.some((f) => f.fieldId === "stockingUnit"));
});

test("status and stockingClass are the two declared filters, and the index count is why", () => {
  const filterIds = partIndexList.filters.map((f) => f.fieldId).sort();
  assert.deepEqual(filterIds, ["status", "stockingClass"]);
  // Two optional equality filters -> three composites (neither is skipped because the
  // single-field default sort is served by Firestore's automatic index).
  assert.equal(requiredIndexes(partIndexList, partEntity).length, 3);
});

test("every demanded index is expressed in Firestore's vocabulary, over the parts collection", () => {
  for (const idx of requiredIndexes(partIndexList, partEntity)) {
    assert.equal(idx.collectionGroup, "parts");
    for (const field of idx.fields) {
      assert.ok(field.arrayConfig === "CONTAINS" || ["ASCENDING", "DESCENDING"].includes(field.order));
    }
  }
});
