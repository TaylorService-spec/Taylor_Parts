// Migration 008 — the STATIC proofs: the two location namespaces stay apart, the physical movement
// vocabulary is untouched, and every vocabulary this schema states already existed somewhere else.
//
// ════════════════════ WHY THE NAMESPACE PROOFS ARE STATIC ════════════════════
//
// The hazard this lane is shaped around is a NEGATIVE: `equipment.locationId` is a CRM customer
// site id and must never enter the inventory location namespace. A negative about a migration is
// not observable by inserting rows -- a schema that wrongly typed the column would accept every row
// a correct one accepts. It is observable in the DDL, so it is checked there, the same way
// eosOpsNoFirebase.test.mjs proves an import is absent rather than proving a call was not made.
//
// This file resets nothing and touches no database.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  INSTALLABLE_CUSTODY_STATUSES,
  OPS_EQUIPMENT_MODEL_STATUSES,
  OPS_EQUIPMENT_STATUSES,
  EquipmentCustodyError,
  customerLocation,
  installSerializedUnitAsEquipment,
  readEquipmentAtCustomerLocation,
} from "../lib/eosOps/equipmentCustody.js";
import { OPS_LOCATION_TYPES, OPS_SERIAL_STATUSES } from "../lib/eosOps/operatingCompanyCustody.js";
import { INSTALLABLE_STATES } from "../lib/equipmentInstall/installSerializedAssetCommand.js";
import { MODEL_STATUSES } from "../lib/equipmentCompatibility/domain/equipmentModel.js";

const MIGRATION_FILE = "1758585600000_equipment-and-installed-custody.sql";
const MIGRATION = readFileSync(join("migrations", MIGRATION_FILE), "utf8");
const MODULE_SOURCE = readFileSync(join("src", "eosOps", "equipmentCustody.ts"), "utf8");

/**
 * The migration with its `--` commentary removed.
 *
 * Every NEGATIVE claim below is checked against THIS, not the raw file. The header discusses the
 * things it refuses to do -- "no ALTER TYPE, no ADD VALUE", "there is no DEFAULT 'WAREHOUSE'" -- and
 * a test that searched the raw text would fail on the sentence promising the very thing it wants.
 */
const SQL_ONLY = MIGRATION.split("\n").map((line) => line.replace(/--.*$/, "")).join("\n");

/** The `CREATE TABLE equipment (...)` body, isolated so a claim about it is about IT. */
function equipmentTableBody() {
  const start = MIGRATION.indexOf("CREATE TABLE equipment (");
  assert.ok(start >= 0, "the migration creates the equipment table");
  const end = MIGRATION.indexOf("\n);", start);
  assert.ok(end > start, "the equipment table definition terminates");
  return MIGRATION.slice(start, end);
}

// ============================ the namespace separation ============================

test("the equipment table has NO column named location_id", () => {
  // The single biggest hazard in this lane, stated as a test rather than as a comment. The P1B
  // census (docs/architecture/inventory-reference-authority-p1b-census.md §12.7) measured
  // equipment.locationId at 290/290 resolving into the CRM `locations` collection and 0/290 into
  // any inventory registry. A column of that name in a schema whose every other `location_id` means
  // an inventory location is how the two namespaces get unioned.
  const body = equipmentTableBody();
  assert.ok(!/^\s*location_id\b/m.test(body), "equipment must not carry a bare `location_id`");
  assert.match(body, /^\s*customer_location_id\s+TEXT\s+NOT NULL/m,
    "the CRM site is named customer_location_id, which is the discriminator the source data lacks");
});

test("the equipment table declares no location TYPE for the customer site", () => {
  const body = equipmentTableBody();
  // A customer site has no physical inventory type. Giving it one -- WAREHOUSE, say -- IS the merge.
  assert.ok(!/^\s*location_type\b/m.test(body), "equipment has no location_type column");
  assert.ok(!/customer_location_id\s+ops_(custody_)?location_type/.test(body),
    "the customer site is never typed with either inventory location enum");
});

test("the only inventory-typed columns on equipment are the install ORIGIN, and it is the PHYSICAL enum", () => {
  const body = equipmentTableBody();
  const typed = [...body.matchAll(/^\s*(\w+)\s+(ops_(?:custody_)?location_type)\b/gm)]
    .map((m) => [m[1], m[2]]);
  assert.deepEqual(typed, [["installed_from_location_type", "ops_location_type"]],
    "where a unit came from is physical; where the Equipment IS, is not an inventory location at all");
});

test("the install origin is both-or-neither, never a half-known location", () => {
  assert.match(MIGRATION, /CHECK \(\s*\(installed_from_location_type IS NULL\) = \(installed_from_location_id IS NULL\)\s*\)/);
});

test("nothing in this migration defaults a location type", () => {
  // functions/src/inventoryAnalyticsCallables.ts:91-95 reads an untyped currentLocationId and
  // assumes WAREHOUSE. That defect must not be reproduced as a column default.
  assert.ok(!/DEFAULT\s+'(WAREHOUSE|BIN|MOBILE|EQUIPMENT)'/i.test(SQL_ONLY));
});

test("the eos_ops module addresses a customer site through its own ref type, never a location id", () => {
  assert.ok(!/\blocation_id\b(?![\s\S]{0,40}serialized_custody)/.test(
    MODULE_SOURCE.split("serialized_custody")[0] ?? ""),
    "no customer-site read or write is expressed as a location_id");
  assert.match(MODULE_SOURCE, /namespace: "CRM_LOCATION"/);
  assert.match(MODULE_SOURCE, /namespace: "OPS_LOCATION"/);
});

test("a customer location ref cannot be substituted by an inventory location ref at runtime", async () => {
  const inventoryRef = { type: "WAREHOUSE", id: "wh-main" };
  await assert.rejects(
    () => readEquipmentAtCustomerLocation({}, "t", inventoryRef),
    (error) => error instanceof EquipmentCustodyError && error.code === "REQUEST_INVALID",
  );
  await assert.rejects(
    () => installSerializedUnitAsEquipment({}, {
      tenantId: "t", actorId: "u", operatingCompanyKey: "oc", partId: "p", serialNumber: "s",
      equipmentId: "eq", accountId: "a", customerLocation: inventoryRef,
      equipment: { name: "unit" },
    }),
    (error) => error instanceof EquipmentCustodyError && error.code === "REQUEST_INVALID",
  );
  assert.deepEqual(customerLocation("cw-acct-0003-loc-00"),
    { namespace: "CRM_LOCATION", id: "cw-acct-0003-loc-00" });
});

// ============================ EQUIPMENT stays out of the physical vocabulary ============================

test("migration 008 does not touch ops_location_type", () => {
  // Migration 007's ruling, re-proved against THIS migration: a movement row pointing at an
  // Equipment id would enter a customer-owned machine into a balance that sums company stock.
  assert.ok(!/ALTER TYPE\s+ops_location_type/i.test(SQL_ONLY));
  assert.ok(!/ADD VALUE/i.test(SQL_ONLY), "no enum gains a label here");
  assert.deepEqual([...OPS_LOCATION_TYPES], ["WAREHOUSE", "BIN", "MOBILE"]);
});

test("the EQUIPMENT custody label gains a referent, not a physical meaning", () => {
  assert.match(MIGRATION,
    /ADD COLUMN equipment_id TEXT\s*\n?\s*GENERATED ALWAYS AS \(CASE WHEN location_type = 'EQUIPMENT' THEN location_id END\) STORED/);
  assert.match(MIGRATION,
    /FOREIGN KEY \(tenant_id, equipment_id\) REFERENCES equipment \(tenant_id, id\)/,
    "tenant-scoped: a unit can never be installed into another tenant's Equipment");
});

test("the link is DERIVED, so there is no second writable copy of it to disagree", () => {
  // A plain `equipment_id` column a writer sets would be a second statement of the same fact --
  // migration 007's objection to copying the company key onto every cycle count line.
  assert.ok(!/ADD COLUMN equipment_id TEXT(?!\s*\n?\s*GENERATED)/.test(SQL_ONLY));
});

test("ADR-010's 'exactly one Serialized Asset' is enforced from the side nothing watched", () => {
  assert.match(MIGRATION,
    /CREATE UNIQUE INDEX serialized_custody_one_unit_per_equipment\s+ON serialized_custody \(tenant_id, equipment_id\)\s+WHERE equipment_id IS NOT NULL/);
});

// ============================ refuse, never manufacture ============================

test("the up migration counts EQUIPMENT custody rows and refuses rather than dangling them", () => {
  assert.match(MIGRATION, /RAISE EXCEPTION\s*\n?\s*'migration 008 refuses to add the Equipment reference/);
  assert.match(MIGRATION, /FROM eos_ops\.serialized_custody WHERE location_type = 'EQUIPMENT'/);
});

test("the down migration refuses to delete customer Equipment as a schema side effect", () => {
  const down = MIGRATION.slice(MIGRATION.indexOf("-- Down Migration"));
  assert.match(down, /RAISE EXCEPTION\s*\n?\s*'migration 008 cannot be reversed/);
  assert.match(down, /FROM eos_ops\.equipment\b/);
  assert.match(down, /FROM eos_ops\.equipment_models/);
});

test("there is no data migration and no backfill", () => {
  assert.ok(!/\bINSERT INTO\b/i.test(SQL_ONLY), "008 imports nothing, exactly like 005 and 007");
  assert.ok(!/\bUPDATE\s+\w+\s+SET\b/i.test(SQL_ONLY));
});

// ============================ vocabularies restate, never invent ============================

test("ops_equipment_status IS the client's EQUIPMENT_STATUS, unchanged", () => {
  // field-ops-app-vite/src/domain/constants.js's EQUIPMENT_STATUS, read as source rather than
  // imported: the client is not on this package's module graph.
  const constants = readFileSync(
    join("..", "field-ops-app-vite", "src", "domain", "constants.js"), "utf8");
  const block = constants.slice(constants.indexOf("export const EQUIPMENT_STATUS = {"));
  const values = [...block.slice(0, block.indexOf("};")).matchAll(/:\s*"([A-Z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...OPS_EQUIPMENT_STATUSES], values);
  assert.ok(MIGRATION.includes(
    `CREATE TYPE ops_equipment_status AS ENUM ('${values.join("', '")}')`));
});

test("ops_equipment_model_status IS the D1 MODEL_STATUSES, unchanged", () => {
  assert.deepEqual([...OPS_EQUIPMENT_MODEL_STATUSES], [...MODEL_STATUSES]);
  assert.ok(MIGRATION.includes(
    `CREATE TYPE ops_equipment_model_status AS ENUM ('${[...MODEL_STATUSES].join("', '")}')`));
});

test("the installable set is the HONEST intersection of the two serial vocabularies", () => {
  // The Firestore command may install from four states; ops_serial_status can represent two of
  // them. STAGED / DELIVERED / LOADED / IN_TRANSIT / RECEIVED have no operational status at all,
  // so a unit in one of them is not describable by this schema, never mind installable. Nothing
  // maps DELIVERED onto AVAILABLE to make an install go through.
  const intersection = INSTALLABLE_STATES.filter((s) => OPS_SERIAL_STATUSES.includes(s));
  assert.deepEqual([...INSTALLABLE_CUSTODY_STATUSES], intersection);
  assert.deepEqual(INSTALLABLE_STATES.filter((s) => !OPS_SERIAL_STATUSES.includes(s)),
    ["STAGED", "DELIVERED"], "the two installable states this schema cannot yet represent");
});

test("the canonical equipment model id is the row identity, not a surrogate beside it", () => {
  assert.match(MIGRATION, /CONSTRAINT equipment_models_pkey PRIMARY KEY \(tenant_id, id\)/);
  assert.match(MIGRATION, /split_part\(id, '--', 1\) = manufacturer_id/);
  // The model half is deliberately NOT re-derived: normalizeModelNumber applies NFKC, which
  // standard PostgreSQL cannot express, and a near-miss restatement would refuse canonical records.
  assert.ok(!/regexp_replace\(\s*upper\(model_number\)/.test(SQL_ONLY));
});

test("the register carries ONE model reference, not a second free-text spelling of it", () => {
  const body = equipmentTableBody();
  assert.match(body, /^\s*equipment_model_id\s+TEXT,/m);
  assert.ok(!/^\s*manufacturer\s+TEXT/m.test(body), "no free-text manufacturer column");
  assert.ok(!/^\s*model\s+TEXT/m.test(body), "no free-text model column");
});

test("operating company is mandatory on equipment, with no default to infer it from", () => {
  const body = equipmentTableBody();
  assert.match(body, /^\s*operating_company_key\s+TEXT\s+NOT NULL,?$/m);
  assert.ok(!/operating_company_key[^,]*DEFAULT/i.test(body));
});

test("equipment records an actor -- the write-path half of X-EQUIPMENT-PROVENANCE-GAP", () => {
  const body = equipmentTableBody();
  assert.match(body, /^\s*created_by\s+TEXT\s+NOT NULL/m);
  assert.match(body, /^\s*updated_by\s+TEXT\s+NOT NULL/m);
});

test("the migration id is the one allocated to this lane", () => {
  assert.ok(MIGRATION_FILE.startsWith("1758585600000_"));
});
