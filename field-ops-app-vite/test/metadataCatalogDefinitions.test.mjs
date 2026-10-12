// SupplierCatalogItem + PartAlias entity definitions — A-ENTITY-CATALOG-DEFINITIONS (continues
// A-ENTITY-MASS-DEFINITION).
//
// SupplierCatalogItem is Part Supplier Terms in PostgreSQL (realigned by SUP-1: the governed field groups it carries
// protect that table's fields); `part_aliases` has NO read path of any kind (readVia UNKNOWN, deny-all in Rules with
// no callable) and is additionally still unpopulated end to end.

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
// SupplierCatalogItem -- realigned (SUP-1 governed field groups) to Part Supplier Terms in PostgreSQL
// (eos_ops.supplier_catalog_items), the record the inventory.catalog.cost.* capabilities on this Object protect.
// ---------------------------------------------------------------------------

test("the SupplierCatalogItem entity is valid against the contract", () => {
  assert.deepEqual(validateEntityDefinition(supplierCatalogItemEntity), []);
});

test("the SupplierCatalogItem entity resolves against the registry (supplier and part are real targets)", () => {
  assert.deepEqual(validateEntityRegistry([supplierCatalogItemEntity, supplierEntity, partEntity, manufacturerEntity, equipmentModelEntity]), []);
});

test("entity id is \"supplierCatalogItem\", the record is the PostgreSQL supplier_catalog_items table, read through the EOS API", () => {
  assert.equal(supplierCatalogItemEntity.id, "supplierCatalogItem");
  assert.equal(supplierCatalogItemEntity.collection, "supplier_catalog_items");
  assert.equal(supplierCatalogItemEntity.readVia, "EOS_API");
  assert.equal(supplierCatalogItemEntity.readCapability, "inventory.supplierTerms.read");
});

test("the field list is exactly the table's governed columns", () => {
  assert.deepEqual(supplierCatalogItemEntity.fields.map((f) => f.id), [
    "supplierId", "partId", "supplierSku", "cost", "currency", "leadTimeDays", "minOrderQty", "orderMultiple", "purchaseUnit",
    "conversionToStockingUnit", "contractStart", "contractEnd", "availability", "preferred", "status", "lastVerifiedAt",
  ]);
  assert.equal(findField(supplierCatalogItemEntity, "unitPrice"), null, "the retired Firestore listing field is gone");
  assert.equal(findField(supplierCatalogItemEntity, "available"), null);
});

test("the COMMERCIAL field group (cost, currency, contract window) is CONFIDENTIAL; nothing else is classified", () => {
  const classified = supplierCatalogItemEntity.fields.filter((f) => f.sensitivity !== null).map((f) => [f.id, f.sensitivity]);
  assert.deepEqual(classified, [["cost", "CONFIDENTIAL"], ["currency", "CONFIDENTIAL"], ["contractStart", "CONFIDENTIAL"], ["contractEnd", "CONFIDENTIAL"]]);
});

test("every CONFIDENTIAL field of SupplierCatalogItem is non-reportable and non-exportable (DECISIONS #230)", () => {
  const confidential = supplierCatalogItemEntity.fields.filter((f) => f.sensitivity === "CONFIDENTIAL");
  assert.equal(confidential.length, 4);
  for (const f of confidential) {
    assert.equal(f.reportable, false, `${f.id} is not reportable`);
    assert.equal(f.exportable, false, `${f.id} is not exportable`);
  }
  // Everything else stays reportable: only the restricted values are kept out of reporting.
  for (const f of supplierCatalogItemEntity.fields.filter((x) => x.sensitivity !== "CONFIDENTIAL")) assert.equal(f.reportable, true, f.id);
});

test("identity is SYSTEM_ONLY -- (part, supplier) is a composed key, never a name", () => {
  assert.equal(supplierCatalogItemEntity.identity.mode, "SYSTEM_ONLY");
  assert.equal(resolveIdentityMode(supplierCatalogItemEntity.identity), "SYSTEM_ONLY");
  assert.equal(findField(supplierCatalogItemEntity, "supplierId").referenceTo, "supplier");
  assert.equal(findField(supplierCatalogItemEntity, "partId").referenceTo, "part");
});

test("an unknown sensitivity is refused by the contract", () => {
  const bad = { ...supplierCatalogItemEntity, fields: [{ ...supplierCatalogItemEntity.fields[3], sensitivity: "SECRET" }] };
  assert.ok(validateEntityDefinition(bad).some((p) => /not a known FIELD_SENSITIVITY/.test(p)));
});

test("no relationships[] entries -- the two edges are the REFERENCE fields above", () => {
  assert.deepEqual([...supplierCatalogItemEntity.relationships], []);
});

test("SupplierCatalogItem has no exported index list -- the only read is one Part's terms", async () => {
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
