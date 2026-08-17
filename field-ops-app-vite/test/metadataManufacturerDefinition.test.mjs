// Manufacturer entity + manufacturer.index — S-INV-TRANSFER-MANUFACTURER-DEFINITIONS.
//
// Pins the intended behavior for the LIVE `manufacturers` collection (ADR-008 / Decision #40):
// read is a trusted, capability-gated CALLABLE returning a narrower projection than what is
// actually stored (no normalizedName/createdAt/createdBy/updatedAt/updatedBy today, though every
// one of those is genuinely persisted) — a stated read-wiring gap, not an idealized shape.

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateEntityDefinition, findField } from "../src/metadata/entityDefinition.js";
import { validateListViewDefinition, requiredIndexes } from "../src/metadata/listViewDefinition.js";
import { manufacturerEntity, manufacturerIndexList } from "../src/metadata/definitions/manufacturer.js";
import { MANUFACTURER_STATUSES, MANUFACTURER_STATUS_META } from "../src/domain/manufacturerVocabulary.js";

test("the Manufacturer entity is valid against the contract", () => {
  assert.deepEqual(validateEntityDefinition(manufacturerEntity), []);
});

test("the Manufacturer index list is valid against the entity", () => {
  assert.deepEqual(validateListViewDefinition(manufacturerIndexList, manufacturerEntity), []);
});

test("the entity id is exactly \"manufacturer\", collection is the live `manufacturers` collection", () => {
  assert.equal(manufacturerEntity.id, "manufacturer");
  assert.equal(manufacturerEntity.collection, "manufacturers");
});

test("read is a governed CALLABLE, deny-all in Rules, gated by a registered-but-inactive capability", () => {
  assert.equal(manufacturerEntity.readVia, "CALLABLE");
  assert.equal(manufacturerEntity.readCallable, "getManufacturerCatalog");
  assert.equal(manufacturerEntity.readCapability, "inventory.catalog.read");
});

test("identity is a nameField only -- no reference number exists anywhere in this schema", () => {
  assert.equal(manufacturerEntity.identity.nameField, "name");
  assert.equal(manufacturerEntity.identity.referenceField, null);
  assert.ok(findField(manufacturerEntity, "name"));
});

test("manufacturerId is declared as its own ID field, not promoted into identity, and enforced equal to the doc id", () => {
  const manufacturerId = findField(manufacturerEntity, "manufacturerId");
  assert.equal(manufacturerId.type, "ID");
  assert.notEqual(manufacturerEntity.identity.nameField, "manufacturerId");
  assert.notEqual(manufacturerEntity.identity.referenceField, "manufacturerId");
});

test("normalizedName is rendered, not filtered, and is never a display value", () => {
  const normalizedName = findField(manufacturerEntity, "normalizedName");
  assert.equal(normalizedName.type, "STRING");
  assert.equal(normalizedName.filterable, false);
  assert.equal(normalizedName.sortable, false);
  // A normalized key is a derived write-time artifact, not what a person reads.
  assert.match(normalizedName.description, /not.*display value/i);
});

test("status vocabulary comes from domain/manufacturerVocabulary.js, not a copy inside the definition", () => {
  const status = findField(manufacturerEntity, "status");
  assert.equal(status.type, "ENUM");
  assert.deepEqual([...status.enumValues], [...MANUFACTURER_STATUSES]);
  for (const v of MANUFACTURER_STATUSES) {
    assert.equal(status.enumLabels[v], MANUFACTURER_STATUS_META[v].label);
    // The #1093 lesson: label must differ from the stored machine value.
    assert.notEqual(status.enumLabels[v], v);
  }
});

test("version is declared -- the one provenance-adjacent field the read projection actually returns", () => {
  const version = findField(manufacturerEntity, "version");
  assert.equal(version.type, "NUMBER");
  assert.equal(version.filterable, false);
  assert.equal(version.sortable, false);
});

test("createdAt/updatedAt are TIMESTAMP (real Firestore Timestamps), never a reinterpreted epoch number", () => {
  for (const name of ["createdAt", "updatedAt"]) {
    const field = findField(manufacturerEntity, name);
    assert.equal(field.type, "TIMESTAMP");
  }
  for (const name of ["createdBy", "updatedBy"]) {
    const field = findField(manufacturerEntity, name);
    assert.equal(field.type, "STRING");
  }
});

test("provenance fields are declared as STORED even though the current read projection does not return them", () => {
  // manufacturerFromFirestore/readMeta require all four on every record (repository-enforced),
  // but ManufacturerProjection (getManufacturerCatalog's actual return shape) carries only
  // { manufacturerId, name, status, version } -- a stated read-wiring gap, not an omission to
  // paper over by leaving the fields out entirely.
  for (const name of ["createdAt", "createdBy", "updatedAt", "updatedBy"]) {
    const field = findField(manufacturerEntity, name);
    assert.ok(field, name);
    assert.match(field.description, /not returned by the current read projection/i);
  }
});

test("no field declares its own readCapability -- inventory.catalog.read gates the whole projection", () => {
  for (const field of manufacturerEntity.fields) {
    assert.equal(field.readCapability, null, field.id);
  }
});

test("no relationships are declared -- the real Part -> Manufacturer edge belongs on part.js, out of this lane's writeScope", () => {
  assert.equal(manufacturerEntity.relationships.length, 0);
});

test("the index list declares exactly one filter (status), forward-looking over an unbounded, unfiltered callable read", () => {
  assert.equal(manufacturerIndexList.filters.length, 1);
  assert.equal(manufacturerIndexList.filters[0].fieldId, "status");
  assert.equal(manufacturerIndexList.capabilityRequirement, "inventory.catalog.read");
});

test("the index list demands exactly one net-new composite index: status + name + __name__", () => {
  const required = requiredIndexes(manufacturerIndexList, manufacturerEntity);
  assert.equal(required.length, 1);
  assert.deepEqual(
    required[0].fields.map((f) => f.fieldPath),
    ["status", "name", "__name__"]
  );
  assert.equal(required[0].collectionGroup, "manufacturers");
});

test("default sort is name ASC -- matching toManufacturerListView's own in-memory sort", () => {
  assert.deepEqual(
    manufacturerIndexList.defaultSort.map((s) => [s.fieldId, s.direction]),
    [["name", "ASC"]]
  );
  assert.equal(manufacturerIndexList.tiebreaker, "__name__");
});
