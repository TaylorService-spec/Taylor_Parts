// SalesTerritory + MobileLocation entity definitions — A-ENTITY-TERRITORY-MOBILE-DEFINITIONS.
//
// Pins the intended behavior for two very differently-reachable collections: `mobile_locations`
// (the EI Truck Registry's MOBILE Inventory Location, ADR-010/Decision #60) is CLIENT_DIRECT,
// role-gated exactly like `trucks` — a real, if undeployed-write-path, entity truck.js's own
// header already named as a REGISTRATION_PENDING gap before this file existed. `sales_territories`
// (Commercial Coverage & Territory, capability #15) is deny-all in Rules AND has no real read
// callable that ever returns a territory record — readVia is honestly UNKNOWN, the same shape
// payment.js already established, and (matching payment.js) no list view is declared for it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateEntityDefinition, findField } from "../src/metadata/entityDefinition.js";
import { validateListViewDefinition, requiredIndexes } from "../src/metadata/listViewDefinition.js";
import { salesTerritoryEntity } from "../src/metadata/definitions/salesTerritory.js";
import { mobileLocationEntity, mobileLocationIndexList } from "../src/metadata/definitions/mobileLocation.js";

// ---------------------------------------------------------------------------
// SalesTerritory
// ---------------------------------------------------------------------------

test("the SalesTerritory entity is valid against the contract", () => {
  assert.deepEqual(validateEntityDefinition(salesTerritoryEntity), []);
});

test("SalesTerritory collection is sales_territories, deny-all in Rules, and readVia is honestly UNKNOWN", () => {
  assert.equal(salesTerritoryEntity.id, "salesTerritory");
  assert.equal(salesTerritoryEntity.collection, "sales_territories");
  assert.equal(salesTerritoryEntity.readVia, "UNKNOWN");
  assert.equal(salesTerritoryEntity.readCallable, null);
  assert.equal(salesTerritoryEntity.readCapability, null);
});

test("no list view is declared for SalesTerritory -- there is no read path to back one", async () => {
  // Only the entity is exported from salesTerritory.js; no salesTerritoryIndexList-style export exists.
  const moduleKeys = Object.keys(await import("../src/metadata/definitions/salesTerritory.js"));
  assert.deepEqual(moduleKeys, ["salesTerritoryEntity"]);
});

test("identity is a nameField only -- name, a real required operator-supplied string; no server-allocated reference exists", () => {
  assert.equal(salesTerritoryEntity.identity.nameField, "name");
  assert.equal(salesTerritoryEntity.identity.referenceField, null);
  assert.ok(findField(salesTerritoryEntity, "name"));
});

test("kind carries the full closed TERRITORY_KINDS-mirrored enum with differing labels", () => {
  const kind = findField(salesTerritoryEntity, "kind");
  assert.equal(kind.type, "ENUM");
  assert.deepEqual([...kind.enumValues], ["STATE", "STATE_GROUP", "ZIP_GROUP", "GEOSPATIAL"]);
  for (const v of kind.enumValues) {
    assert.ok(kind.enumLabels[v]);
    assert.notEqual(kind.enumLabels[v], v);
  }
});

test("status is a real two-value governed enum, not filterable -- no read path exists to back a query", () => {
  const status = findField(salesTerritoryEntity, "status");
  assert.equal(status.type, "ENUM");
  assert.deepEqual([...status.enumValues], ["ACTIVE", "INACTIVE"]);
  assert.equal(status.filterable, false);
  assert.equal(status.operators.length, 0);
});

test("geo is deliberately NOT declared -- a discriminated-union shape the v1 field vocabulary cannot express", () => {
  assert.equal(findField(salesTerritoryEntity, "geo"), null);
});

test("provenance: createdAtMillis + createdAt + createdBy are all declared; no updatedAt/updatedBy -- append-only, no update callable exists", () => {
  assert.ok(findField(salesTerritoryEntity, "createdAtMillis"));
  const createdAt = findField(salesTerritoryEntity, "createdAt");
  assert.equal(createdAt.type, "TIMESTAMP");
  assert.ok(findField(salesTerritoryEntity, "createdBy"));
  assert.equal(findField(salesTerritoryEntity, "updatedAt"), null);
  assert.equal(findField(salesTerritoryEntity, "updatedBy"), null);
});

test("no relationships are declared -- commercial_coverage_assignments has no registered owning entity", () => {
  assert.equal(salesTerritoryEntity.relationships.length, 0);
});

// ---------------------------------------------------------------------------
// MobileLocation
// ---------------------------------------------------------------------------

test("the MobileLocation entity is valid against the contract", () => {
  assert.deepEqual(validateEntityDefinition(mobileLocationEntity), []);
});

test("the MobileLocation index list is valid against the entity", () => {
  assert.deepEqual(validateListViewDefinition(mobileLocationIndexList, mobileLocationEntity), []);
});

test("the entity id is exactly \"mobileLocation\", collection is the live `mobile_locations` collection", () => {
  assert.equal(mobileLocationEntity.id, "mobileLocation");
  assert.equal(mobileLocationEntity.collection, "mobile_locations");
});

test("read is CLIENT_DIRECT with no capability -- Rules gate by role (admin/dispatcher), same shape as trucks", () => {
  assert.equal(mobileLocationEntity.readVia, "CLIENT_DIRECT");
  assert.equal(mobileLocationEntity.readCapability, null);
});

test("identity is a nameField only -- displayLabel, the same choice truck.js makes for its own linked record", () => {
  assert.equal(mobileLocationEntity.identity.nameField, "displayLabel");
  assert.equal(mobileLocationEntity.identity.referenceField, null);
  assert.ok(findField(mobileLocationEntity, "displayLabel"));
});

test("locationId is declared as its own ID field, not promoted into identity -- same treatment as truck.js's truckId", () => {
  const locationId = findField(mobileLocationEntity, "locationId");
  assert.equal(locationId.type, "ID");
  assert.notEqual(mobileLocationEntity.identity.nameField, "locationId");
  assert.notEqual(mobileLocationEntity.identity.referenceField, "locationId");
});

test("type is a single-value governed discriminant, declared as a non-filterable, non-sortable STRING, not an ENUM", () => {
  const type = findField(mobileLocationEntity, "type");
  assert.equal(type.type, "STRING");
  assert.equal(type.filterable, false);
  assert.equal(type.sortable, false);
});

test("active is declared as a filterable boolean, the same structural-fact shape truck.js's own active field takes", () => {
  const active = findField(mobileLocationEntity, "active");
  assert.equal(active.type, "BOOLEAN");
  assert.equal(active.filterable, true);
  assert.deepEqual([...active.operators], ["EQUALS"]);
});

test("provenance is fully declared -- version + createdAt/createdBy/updatedAt/updatedBy, a mutable record", () => {
  for (const name of ["version", "createdAt", "createdBy", "updatedAt", "updatedBy"]) {
    assert.ok(findField(mobileLocationEntity, name), name);
  }
});

test("no relationships are declared -- the 1:1 link to Truck is owned by trucks/{truckId}.locationId, out of this lane's scope", () => {
  assert.equal(mobileLocationEntity.relationships.length, 0);
});

test("the MobileLocation index declares exactly one filter: active", () => {
  assert.equal(mobileLocationIndexList.filters.length, 1);
  assert.equal(mobileLocationIndexList.filters[0].fieldId, "active");
});

test("the MobileLocation index required indexes match its declared filter (requiredIndexes() output)", () => {
  const required = requiredIndexes(mobileLocationIndexList, mobileLocationEntity);
  // One optional equality filter: the unfiltered (sort-only, single field, no composite needed)
  // case is excluded by requiredIndexes() itself, leaving exactly one composite -- active + the
  // displayLabel sort + the __name__ tiebreaker.
  assert.equal(required.length, 1);
  for (const idx of required) {
    assert.equal(idx.collectionGroup, "mobile_locations");
  }
});

test("MobileLocation default sort is displayLabel ASC, tiebroken by __name__", () => {
  assert.deepEqual(
    mobileLocationIndexList.defaultSort.map((s) => [s.fieldId, s.direction]),
    [["displayLabel", "ASC"]]
  );
  assert.equal(mobileLocationIndexList.tiebreaker, "__name__");
});
