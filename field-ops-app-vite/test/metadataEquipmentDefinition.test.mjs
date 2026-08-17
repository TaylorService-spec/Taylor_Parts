// Equipment (installed-asset register) entity + equipment.index — S-INV-EQUIPMENT-DEFINITION.
//
// Pins the intended behavior for a record whose metadata is honest about several gaps
// rather than papering over them: an identity with no reference field, a provenance pair
// stored as raw numbers with no actors, and a computed lifecycle that is deliberately NOT
// a declared field. A definition that idealized any of those would be the lie this program
// exists to prevent.

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateEntityDefinition, findField } from "../src/metadata/entityDefinition.js";
import { validateListViewDefinition, requiredIndexes } from "../src/metadata/listViewDefinition.js";
import { equipmentEntity, equipmentIndexList } from "../src/metadata/definitions/equipment.js";
import { EQUIPMENT_STATUS_LABEL, EQUIPMENT_STATUS_VALUES, equipmentStatusLabel } from "../src/domain/equipmentStatus.js";
import { EQUIPMENT_STATUS } from "../src/domain/constants.js";

test("the Equipment entity is valid against the contract", () => {
  assert.deepEqual(validateEntityDefinition(equipmentEntity), []);
});

test("the Equipment index list is valid against the entity", () => {
  assert.deepEqual(validateListViewDefinition(equipmentIndexList, equipmentEntity), []);
});

test("identity is a nameField, with NO referenceField", () => {
  // serialNumber and assetTag both look like business references, but both are OPTIONAL
  // (string | null) and neither is enforced unique -- promoting either to a
  // referenceField would license a fallback to the document id whenever it is absent,
  // which is precisely the gap DECISIONS #106 forbids reintroducing.
  assert.equal(equipmentEntity.identity.nameField, "name");
  assert.equal(equipmentEntity.identity.referenceField, null);
  assert.ok(findField(equipmentEntity, "name"));
});

test("serialNumber and assetTag are declared, but not as identity", () => {
  const serial = findField(equipmentEntity, "serialNumber");
  const tag = findField(equipmentEntity, "assetTag");
  assert.equal(serial.type, "STRING");
  assert.equal(tag.type, "STRING");
  assert.notEqual(equipmentEntity.identity.referenceField, "serialNumber");
  assert.notEqual(equipmentEntity.identity.referenceField, "assetTag");
});

test("no capability gates this collection -- Rules admit by ROLE, not by capability", () => {
  assert.equal(equipmentEntity.readCapability, null);
});

test("X-EQUIPMENT-PROVENANCE-GAP: createdAt/updatedAt are declared NUMBER, and no actor fields exist", () => {
  // firestore.rules asserts `data.createdAt is number` / `request.resource.data.updatedAt
  // is number` -- epoch milliseconds, never a Firestore Timestamp. Declaring TIMESTAMP
  // here to match the "standard" provenance shape would assert storage semantics this
  // record does not have.
  const createdAt = findField(equipmentEntity, "createdAt");
  const updatedAt = findField(equipmentEntity, "updatedAt");
  assert.equal(createdAt.type, "NUMBER");
  assert.equal(updatedAt.type, "NUMBER");
  assert.notEqual(createdAt.type, "TIMESTAMP");
  assert.notEqual(updatedAt.type, "TIMESTAMP");
  // equipmentWritableKeys() in firestore.rules names neither actor field. Declaring one
  // would assert data absent from every document in the collection.
  for (const name of ["createdBy", "updatedBy"]) {
    assert.equal(findField(equipmentEntity, name), null, name);
  }
});

test("the computed inventory-control lifecycle is NOT declared as a stored field", () => {
  // CONTROLLED / EXITED / NOT_STARTED / UNKNOWN is computed client-side by
  // domain/equipmentInventoryControlAdapter.js from serializedAssetId plus a sale-close
  // signal this surface does not have. It is not a column on the document, so it must
  // not appear as a FieldDefinition here.
  for (const name of ["inventoryControl", "inventoryControlLabel", "linkedToSerializedAsset"]) {
    assert.equal(findField(equipmentEntity, name), null, name);
  }
});

test("status vocabulary comes from the domain module, not a copy here", () => {
  const status = findField(equipmentEntity, "status");
  assert.deepEqual([...status.enumValues], [...EQUIPMENT_STATUS_VALUES]);
  assert.deepEqual({ ...status.enumLabels }, { ...EQUIPMENT_STATUS_LABEL });
  // The three real machine values, exactly -- no fourth "invented" state.
  assert.deepEqual(new Set(status.enumValues), new Set(Object.values(EQUIPMENT_STATUS)));
});

test("equipmentStatusLabel renders the same words the two prior private copies used", () => {
  // modules/equipment/EquipmentDetail.jsx and modules/equipment/EquipmentRegister.jsx
  // each carried a byte-identical private STATUS_LABEL before this module existed.
  assert.equal(equipmentStatusLabel(EQUIPMENT_STATUS.ACTIVE), "Active");
  assert.equal(equipmentStatusLabel(EQUIPMENT_STATUS.INACTIVE), "Inactive");
  assert.equal(equipmentStatusLabel(EQUIPMENT_STATUS.RETIRED), "Retired");
  // Unrecognized values pass through verbatim rather than silently defaulting.
  assert.equal(equipmentStatusLabel("SOMETHING_ELSE"), "SOMETHING_ELSE");
});

test("accountId is a REFERENCE to account; locationId is a REFERENCE to location", () => {
  // `location` is now a registered entity (definitions/location.js), so locationId is a
  // real REFERENCE -- Rules-enforced by equipmentLocationBelongsToAccount, not merely a
  // display convenience. The same upgrade applies to salesOrder.js's own locationId.
  const accountId = findField(equipmentEntity, "accountId");
  const locationId = findField(equipmentEntity, "locationId");
  assert.equal(accountId.type, "REFERENCE");
  assert.equal(accountId.referenceTo, "account");
  assert.equal(locationId.type, "REFERENCE");
  assert.equal(locationId.referenceTo, "location");
});

test("locationId is neither filterable nor sortable -- the reference upgrade added no operator or index demand", () => {
  // A REFERENCE field is still just a stored id string on the wire; nothing about the
  // type change makes it queryable. Pinning this here is what would catch a future edit
  // accidentally turning a display reference into a filterable/sortable one, which would
  // change requiredIndexes() without anyone noticing.
  const locationId = findField(equipmentEntity, "locationId");
  assert.equal(locationId.filterable, false);
  assert.equal(locationId.sortable, false);
  assert.deepEqual(locationId.operators, []);
});

test("no outbound relationships are declared -- an owning-side edge belongs on Account", () => {
  assert.equal(equipmentEntity.relationships.length, 0);
});

test("the index list declares real backend filters, and the index count reflects two optional equality filters", () => {
  // accountId and status are both optional equality filters: neither, either, or both
  // means four combinations, three of which need their own composite (the fourth is the
  // unfiltered sort, served without one).
  assert.ok(equipmentIndexList.filters.some((f) => f.fieldId === "accountId"));
  assert.ok(equipmentIndexList.filters.some((f) => f.fieldId === "status"));
  assert.equal(requiredIndexes(equipmentIndexList, equipmentEntity).length, 3);
});

test("locationId's STRING -> REFERENCE upgrade left every composite index untouched -- no fieldPath names locationId", () => {
  // requiredIndexes() is driven entirely by filters/defaultSort, never by a field's
  // declared type -- this pins that fact for locationId specifically, the field this
  // program just upgraded, so a future edit that also makes it filterable/sortable
  // trips a visible assertion instead of silently growing the index set.
  const indexes = requiredIndexes(equipmentIndexList, equipmentEntity);
  for (const idx of indexes) {
    assert.ok(!idx.fields.some((f) => f.fieldPath === "locationId"), "no index should reference locationId");
  }
});
