// SupplierCatalogItem + PartAlias entity definitions — A-ENTITY-CATALOG-DEFINITIONS (continues
// A-ENTITY-MASS-DEFINITION).
//
// Pins the intended behavior for two collections that turned out to be honest opposites of each
// other: `supplier_catalog` is READ-live (Operations.jsx's ProcurementPanel genuinely queries it,
// CLIENT_DIRECT) but WRITE-dormant (no governed writer anywhere, only a one-off local admin seed
// script); `part_aliases` has NO read path of any kind (readVia UNKNOWN, deny-all in Rules with
// no callable) and is additionally still unpopulated end to end. Neither collection is idealized
// as though it were fully live.

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateEntityDefinition, validateEntityRegistry, findField, resolveIdentityMode } from "../src/metadata/entityDefinition.js";
import { validateListViewDefinition, requiredIndexes } from "../src/metadata/listViewDefinition.js";
import { supplierCatalogItemEntity } from "../src/metadata/definitions/supplierCatalogItem.js";
import { partAliasEntity } from "../src/metadata/definitions/partAlias.js";
import { supplierEntity } from "../src/metadata/definitions/supplier.js";
import { partEntity } from "../src/metadata/definitions/part.js";
import { manufacturerEntity } from "../src/metadata/definitions/manufacturer.js";
import { equipmentModelEntity } from "../src/metadata/definitions/equipmentModel.js";

// ---------------------------------------------------------------------------
// SupplierCatalogItem
// ---------------------------------------------------------------------------

test("the SupplierCatalogItem entity is valid against the contract", () => {
  assert.deepEqual(validateEntityDefinition(supplierCatalogItemEntity), []);
});

test("the SupplierCatalogItem entity resolves against the registry (supplier is a real target)", () => {
  assert.deepEqual(validateEntityRegistry([supplierCatalogItemEntity, supplierEntity]), []);
});

test("entity id is \"supplierCatalogItem\", collection is the real `supplier_catalog` collection", () => {
  assert.equal(supplierCatalogItemEntity.id, "supplierCatalogItem");
  assert.equal(supplierCatalogItemEntity.collection, "supplier_catalog");
});

test("read is CLIENT_DIRECT with no capability -- Rules gate by role (admin/dispatcher), not by capability", () => {
  assert.equal(supplierCatalogItemEntity.readVia, "CLIENT_DIRECT");
  assert.equal(supplierCatalogItemEntity.readCapability, null);
});

test("identity is SYSTEM_ONLY, explicitly declared -- neither foreign key is a name or a reference", () => {
  assert.equal(supplierCatalogItemEntity.identity.mode, "SYSTEM_ONLY");
  assert.equal(supplierCatalogItemEntity.identity.nameField, null);
  assert.equal(supplierCatalogItemEntity.identity.referenceField, null);
  assert.equal(resolveIdentityMode(supplierCatalogItemEntity.identity), "SYSTEM_ONLY");
});

test("catalogItemId is declared as its own ID field, not promoted into identity", () => {
  const catalogItemId = findField(supplierCatalogItemEntity, "catalogItemId");
  assert.equal(catalogItemId.type, "ID");
  assert.notEqual(supplierCatalogItemEntity.identity.nameField, "catalogItemId");
  assert.notEqual(supplierCatalogItemEntity.identity.referenceField, "catalogItemId");
});

test("supplierId is a real REFERENCE to the registered supplier entity", () => {
  const supplierId = findField(supplierCatalogItemEntity, "supplierId");
  assert.equal(supplierId.type, "REFERENCE");
  assert.equal(supplierId.referenceTo, "supplier");
  assert.equal(supplierId.filterable, true);
});

test("partId stays a plain STRING -- not verified against Part Master's canonical identity space", () => {
  const partId = findField(supplierCatalogItemEntity, "partId");
  assert.equal(partId.type, "STRING");
  assert.notEqual(partId.type, "REFERENCE");
});

test("unitPrice is a plain NUMBER, not CURRENCY_MINOR -- no currency field or minor-unit encoding exists", () => {
  const unitPrice = findField(supplierCatalogItemEntity, "unitPrice");
  assert.equal(unitPrice.type, "NUMBER");
  assert.notEqual(unitPrice.type, "CURRENCY_MINOR");
});

test("available is a filterable BOOLEAN -- the one real predicate findBestSupplierForPart actually runs", () => {
  const available = findField(supplierCatalogItemEntity, "available");
  assert.equal(available.type, "BOOLEAN");
  assert.equal(available.filterable, true);
});

test("no provenance fields are declared -- the stored type carries none", () => {
  for (const id of ["version", "createdAt", "createdBy", "updatedAt", "updatedBy"]) {
    assert.equal(findField(supplierCatalogItemEntity, id), null, `unexpected provenance field "${id}"`);
  }
});

test("no relationships[] entries -- the supplierId edge is already the REFERENCE field above", () => {
  assert.deepEqual([...supplierCatalogItemEntity.relationships], []);
});

test("SupplierCatalogItem has no exported index list -- no filter set this collection actually serves is asserted", async () => {
  const mod = await import("../src/metadata/definitions/supplierCatalogItem.js");
  assert.equal(mod.supplierCatalogItemIndexList, undefined);
});

test("requiredIndexes on a bare entity (no list view) demands nothing", () => {
  assert.deepEqual(requiredIndexes(undefined, supplierCatalogItemEntity), []);
});

// ---------------------------------------------------------------------------
// PartAlias
// ---------------------------------------------------------------------------

test("the PartAlias entity is valid against the contract", () => {
  assert.deepEqual(validateEntityDefinition(partAliasEntity), []);
});

test("the PartAlias entity resolves against the registry (part + manufacturer are real targets)", () => {
  // part.js's own equipmentModelId REFERENCE also needs equipmentModel registered -- included here
  // only so this cross-entity check exercises the real registry shape, not a partAlias-specific
  // requirement.
  assert.deepEqual(validateEntityRegistry([partAliasEntity, partEntity, manufacturerEntity, equipmentModelEntity]), []);
});

test("entity id is \"partAlias\", collection is the real `part_aliases` collection", () => {
  assert.equal(partAliasEntity.id, "partAlias");
  assert.equal(partAliasEntity.collection, "part_aliases");
});

test("read is honestly UNKNOWN -- deny-all in Rules with no callable of any kind", () => {
  assert.equal(partAliasEntity.readVia, "UNKNOWN");
  assert.equal(partAliasEntity.readCallable, null);
  assert.equal(partAliasEntity.readCapability, null);
});

test("identity is a referenceField -- originalValue, the alias's own genuinely-unique identifier text", () => {
  assert.equal(partAliasEntity.identity.referenceField, "originalValue");
  assert.equal(partAliasEntity.identity.nameField, null);
  assert.equal(resolveIdentityMode(partAliasEntity.identity), "BUSINESS_REFERENCE");
  assert.ok(findField(partAliasEntity, "originalValue"));
});

test("no aliasId (document id) field is declared -- the doc id is a derived, percent-encoded storage artifact, not a readable token", () => {
  assert.equal(findField(partAliasEntity, "aliasId"), null);
});

test("originalValue respects the single normalization authority's 120-character limit, described not re-derived", () => {
  const originalValue = findField(partAliasEntity, "originalValue");
  assert.match(originalValue.description, /120 characters/);
});

test("partId and manufacturerId are real REFERENCE fields into registered entities", () => {
  const partId = findField(partAliasEntity, "partId");
  assert.equal(partId.type, "REFERENCE");
  assert.equal(partId.referenceTo, "part");

  const manufacturerId = findField(partAliasEntity, "manufacturerId");
  assert.equal(manufacturerId.type, "REFERENCE");
  assert.equal(manufacturerId.referenceTo, "manufacturer");
});

test("aliasType carries all ten accepted values, each with a distinct label (the #1093 lesson)", () => {
  const aliasType = findField(partAliasEntity, "aliasType");
  assert.deepEqual(
    [...aliasType.enumValues],
    ["INTERNAL_PN", "MANUFACTURER_PN", "SUPPLIER_SKU", "UPC", "EAN", "GTIN", "LEGACY", "CUSTOMER_REF", "VENDOR_REF", "BARCODE_OTHER"]
  );
  for (const v of aliasType.enumValues) {
    assert.notEqual(aliasType.enumLabels[v], v);
  }
});

test("status is the two-value ACTIVE/INACTIVE lifecycle enum", () => {
  const status = findField(partAliasEntity, "status");
  assert.deepEqual([...status.enumValues], ["ACTIVE", "INACTIVE"]);
});

test("effectiveFrom/effectiveTo are plain STRING, never DATE/TIMESTAMP -- StoredPartAlias types both as string", () => {
  assert.equal(findField(partAliasEntity, "effectiveFrom").type, "STRING");
  assert.equal(findField(partAliasEntity, "effectiveTo").type, "STRING");
});

test("provenance is fully declared and required -- version/createdAt/createdBy/updatedAt/updatedBy all present", () => {
  for (const id of ["version", "createdAt", "createdBy", "updatedAt", "updatedBy"]) {
    assert.ok(findField(partAliasEntity, id), `expected provenance field "${id}"`);
  }
});

test("createdAt/updatedAt are TIMESTAMP, never a number -- real Firestore server Timestamps", () => {
  assert.equal(findField(partAliasEntity, "createdAt").type, "TIMESTAMP");
  assert.equal(findField(partAliasEntity, "updatedAt").type, "TIMESTAMP");
});

test("no relationships[] entries -- the partId/manufacturerId edges are already the REFERENCE fields above", () => {
  assert.deepEqual([...partAliasEntity.relationships], []);
});

test("PartAlias has no exported index list -- readVia UNKNOWN and the collection is unpopulated", async () => {
  const mod = await import("../src/metadata/definitions/partAlias.js");
  assert.equal(mod.partAliasIndexList, undefined);
});
