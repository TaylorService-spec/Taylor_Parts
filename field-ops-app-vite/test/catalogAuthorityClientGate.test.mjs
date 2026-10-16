// The client's Catalog-authority statement must be the server's -- it gates what the Data Import screen
// offers and executes, and a client that believed the Firestore catalog were still current would offer
// a PARTS import the deployed (pre-freeze) runtime would write into the retired `parts` collection.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CATALOG_AUTHORITY_POSTGRES_ACTIVE,
  CATALOG_BOUND_IMPORT_ENTITY_TYPES,
  CATALOG_IMPORT_REFUSAL_MESSAGE,
  importRefusedByCatalogAuthority,
  EQUIPMENT_FIRESTORE_WRITER_OPEN,
  importRefusedByEquipmentAuthority,
} from "../src/config/catalogAuthority.js";

test("the client Equipment-register constant mirrors the committed server EQUIPMENT_WRITER_AUTHORITY", () => {
  const src = readFileSync(new URL("../../functions/src/eosOps/equipmentWriterState.ts", import.meta.url), "utf8");
  const m = src.match(/export const EQUIPMENT_WRITER_AUTHORITY[^=]*=\s*Object\.freeze\(\{\s*firestore:\s*"(\w+)",\s*postgres:\s*"(\w+)"\s*\}\)/);
  assert.ok(m, "EQUIPMENT_WRITER_AUTHORITY could not be read from equipmentWriterState.ts -- re-pin this test");
  assert.equal(EQUIPMENT_FIRESTORE_WRITER_OPEN, m[1] === "OPEN",
    `server firestore=${m[1]} but the client says firestoreOpen=${EQUIPMENT_FIRESTORE_WRITER_OPEN}`);
});

test("only EQUIPMENT is refused by the Equipment register, and only while the Firestore writer is not OPEN", () => {
  assert.equal(importRefusedByEquipmentAuthority("EQUIPMENT"), !EQUIPMENT_FIRESTORE_WRITER_OPEN);
  assert.equal(importRefusedByEquipmentAuthority("EQUIPMENT", false), true);
  assert.equal(importRefusedByEquipmentAuthority("EQUIPMENT", true), false);
  for (const t of ["PARTS", "CUSTOMERS", "INVENTORY", "SERVICE_HISTORY"]) assert.equal(importRefusedByEquipmentAuthority(t, false), false, t);
});

test("the client constant mirrors the committed server CATALOG_WRITER_AUTHORITY", () => {
  const src = readFileSync(new URL("../../functions/src/catalogMaster/catalogWriterState.ts", import.meta.url), "utf8");
  const m = src.match(/export const CATALOG_WRITER_AUTHORITY[^=]*=\s*Object\.freeze\(\{\s*firestore:\s*"(\w+)",\s*postgres:\s*"(\w+)"\s*\}\)/);
  assert.ok(m, "CATALOG_WRITER_AUTHORITY could not be read from catalogWriterState.ts -- re-pin this test");
  assert.equal(CATALOG_AUTHORITY_POSTGRES_ACTIVE, m[2] === "ACTIVE",
    `server postgres=${m[2]} but the client says postgresActive=${CATALOG_AUTHORITY_POSTGRES_ACTIVE}`);
});

test("PARTS and INVENTORY are the catalog-bound imports, and each is refused with its own sentence", () => {
  assert.deepEqual([...CATALOG_BOUND_IMPORT_ENTITY_TYPES].sort(), ["INVENTORY", "PARTS"]);
  // ACTIVE is INJECTED: the refusal is proven regardless of the committed constant.
  for (const t of CATALOG_BOUND_IMPORT_ENTITY_TYPES) {
    assert.equal(importRefusedByCatalogAuthority(t, true), true, t);
    assert.match(CATALOG_IMPORT_REFUSAL_MESSAGE[t], /PostgreSQL/);
  }
  for (const t of ["CUSTOMERS", "EQUIPMENT", "SERVICE_HISTORY"]) {
    assert.equal(importRefusedByCatalogAuthority(t, true), false, t);
    assert.equal(importRefusedByCatalogAuthority(t), false, t);
  }
});

test("fails closed on an unknown or missing entity type, active or not", () => {
  for (const t of [undefined, null, "", "SOMETHING_NEW", 7]) {
    assert.equal(importRefusedByCatalogAuthority(t), true, String(t));
    assert.equal(importRefusedByCatalogAuthority(t, true), true, String(t));
    assert.equal(importRefusedByCatalogAuthority(t, false), true, String(t));
  }
  // Injected INACTIVE (the rollback window), the catalog-bound imports would be offered again.
  assert.equal(importRefusedByCatalogAuthority("PARTS", false), false);
});

test("the refusal keys off the committed constant: it follows CATALOG_AUTHORITY_POSTGRES_ACTIVE by default", () => {
  // Dormant while the committed Catalog authority is INACTIVE; on with the activation flip. Never a runtime setting.
  for (const t of CATALOG_BOUND_IMPORT_ENTITY_TYPES) {
    assert.equal(importRefusedByCatalogAuthority(t), CATALOG_AUTHORITY_POSTGRES_ACTIVE, t);
  }
});
