// Migration 008 — the proofs that need a real database: the installed serialized custody
// relationship, and the two location namespaces staying apart under actual rows.
//
// ════════════════════ THIS SUITE DOES NOT RESET THE SCHEMA ════════════════════
//
// adminPolicyPostgres.test.mjs and its two siblings each DROP and re-migrate `eos_policy` and
// `eos_ops`, which is why they must be serialized in one registered command. This file deliberately
// does not: it migrates FORWARD (idempotent), seeds its own tenant, and deletes the rows it wrote.
// The claims below are about a schema at head, and none of them needs a bare database to be true.
//
// IT MUST STILL BE SERIALIZED WITH THE RESETTERS -- a suite that drops the schema mid-run would
// break this one just as surely as the race that command was written to stop. Registering it in
// `test:adminPolicyPostgres` requires editing functions/package.json, which this lane may not touch;
// the registration is recorded in docs/handoff/w1-c7-registrations.md instead.
//
// Same skip contract as every other Postgres suite: set POLICY_TEST_DATABASE_URL to run.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import pg from "pg";

import {
  EquipmentCustodyError,
  customerLocation,
  installSerializedUnitAsEquipment,
  readEquipment,
  readEquipmentAtCustomerLocation,
  readInstalledUnit,
  recordEquipmentModel,
} from "../lib/eosOps/equipmentCustody.js";

const URL = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

const TENANT = "tenant-w1c7";
const OTHER_TENANT = "tenant-w1c7-other";
// OPAQUE. Nothing in this schema or these proofs may depend on which operating companies a
// deployment happens to have -- migration 007's rule, and the reason `taylor`/`ventana` appear
// nowhere in this file.
const COMPANY = "oc-alpha";
const OTHER_COMPANY = "oc-beta";

// A CRM customer site id, taken from the live census (§12.7) rather than invented, alongside the
// warehouse id the same census measured on the other side of the name collision.
const CUSTOMER_SITE = "cw-acct-0003-loc-00";
const ORIGIN_WAREHOUSE = "wh-main";

let pool = null;
const repoPool = () => (pool ??= new pg.Pool({ connectionString: URL, max: 4 }));

function migrateUp() {
  execFileSync(process.execPath, [
    "node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations",
  ], { env: { ...process.env, DATABASE_URL: URL }, encoding: "utf8", stdio: "pipe" });
}

function migrate(args) {
  return execFileSync(process.execPath, [
    "node_modules/node-pg-migrate/bin/node-pg-migrate.js", ...args, "--migrations-dir", "migrations",
  ], { env: { ...process.env, DATABASE_URL: URL }, encoding: "utf8", stdio: "pipe" });
}

const query = (text, values = []) => repoPool().query(text, values);

/** Remove only what this file wrote. Custody first: it references equipment. */
async function clean() {
  await query("DELETE FROM eos_ops.serialized_custody WHERE tenant_id = ANY($1)", [[TENANT, OTHER_TENANT]]);
  await query("DELETE FROM eos_ops.equipment WHERE tenant_id = ANY($1)", [[TENANT, OTHER_TENANT]]);
  await query("DELETE FROM eos_ops.equipment_models WHERE tenant_id = ANY($1)", [[TENANT, OTHER_TENANT]]);
}

async function setup() {
  migrateUp();
  for (const id of [TENANT, OTHER_TENANT]) {
    await query("INSERT INTO eos_policy.tenants (id, key, name) VALUES ($1, $1, $1) ON CONFLICT DO NOTHING", [id]);
  }
  await clean();
}

const insertCustody = (id, status, locationType, locationId, opts = {}) => query(
  `INSERT INTO eos_ops.serialized_custody
     (id, tenant_id, operating_company_key, part_id, serial_number, status, location_type, location_id, updated_by)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'u')`,
  [id, opts.tenantId ?? TENANT, opts.company ?? COMPANY, opts.partId ?? "part-ice-machine",
    opts.serial ?? id, status, locationType, locationId],
);

const insertEquipment = (id, opts = {}) => query(
  `INSERT INTO eos_ops.equipment
     (id, tenant_id, operating_company_key, account_id, customer_location_id, name, status,
      created_by, updated_by)
   VALUES ($1, $2, $3, 'cw-acct-0003', $4, 'Ice machine', 'ACTIVE', 'u', 'u')`,
  [id, opts.tenantId ?? TENANT, opts.company ?? COMPANY, opts.customerLocationId ?? CUSTOMER_SITE],
);

test.after(async () => {
  if (pool) {
    await clean();
    await pool.end();
  }
});

// ============================ the shape of the register ============================

test("equipment carries a CUSTOMER location, and no inventory location at all", { skip: SKIP }, async () => {
  await setup();
  const columns = await query(
    `SELECT column_name, data_type, udt_name, is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'eos_ops' AND table_name = 'equipment'
      ORDER BY column_name`,
  );
  const names = columns.rows.map((r) => r.column_name);

  // The census hazard, proved against the live catalog rather than the file: a `location_id` here
  // would be a customer site sitting in a column every other table means an inventory location by.
  assert.ok(!names.includes("location_id"), "there is no bare location_id on equipment");
  assert.ok(!names.includes("location_type"), "a customer site has no physical inventory type");
  assert.ok(names.includes("customer_location_id"));

  const site = columns.rows.find((r) => r.column_name === "customer_location_id");
  assert.equal(site.data_type, "text", "a CRM site id is opaque text, not an inventory location enum");
  assert.equal(site.is_nullable, "NO");

  // The ONLY inventory-typed column is the origin, and it is the PHYSICAL vocabulary.
  const typed = columns.rows
    .filter((r) => r.udt_name === "ops_location_type" || r.udt_name === "ops_custody_location_type")
    .map((r) => [r.column_name, r.udt_name]);
  assert.deepEqual(typed, [["installed_from_location_type", "ops_location_type"]]);
});

test("the physical movement vocabulary is still exactly three labels", { skip: SKIP }, async () => {
  await setup();
  const labels = await query(
    `SELECT e.enumlabel FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'eos_ops' AND t.typname = 'ops_location_type'
      ORDER BY e.enumsortorder`,
  );
  assert.deepEqual(labels.rows.map((r) => r.enumlabel), ["WAREHOUSE", "BIN", "MOBILE"],
    "EQUIPMENT is a custody location type and was not added to the physical one");
});

test("operating company is mandatory on equipment, with no default", { skip: SKIP }, async () => {
  await setup();
  const column = await query(
    `SELECT is_nullable, column_default FROM information_schema.columns
      WHERE table_schema = 'eos_ops' AND table_name = 'equipment' AND column_name = 'operating_company_key'`,
  );
  assert.equal(column.rows[0].is_nullable, "NO");
  assert.equal(column.rows[0].column_default, null);
  await assert.rejects(
    () => query(
      `INSERT INTO eos_ops.equipment (id, tenant_id, account_id, customer_location_id, name, status, created_by, updated_by)
       VALUES ('eq-nocompany', $1, 'a', $2, 'n', 'ACTIVE', 'u', 'u')`,
      [TENANT, CUSTOMER_SITE],
    ),
    /operating_company_key/,
  );
});

// ============================ the installed custody relationship ============================

test("an EQUIPMENT custody row must name an Equipment record that exists", { skip: SKIP }, async () => {
  await setup();
  await assert.rejects(
    () => insertCustody("sc-dangling", "INSTALLED", "EQUIPMENT", "eq-that-was-never-created"),
    /serialized_custody_equipment_exists/,
    "migration 007 said INSTALLED means EQUIPMENT; 008 says WHICH one, and proves it is there",
  );
});

test("a unit cannot be installed into another tenant's Equipment", { skip: SKIP }, async () => {
  await setup();
  await insertEquipment("eq-other-tenant", { tenantId: OTHER_TENANT });
  await assert.rejects(
    () => insertCustody("sc-cross-tenant", "INSTALLED", "EQUIPMENT", "eq-other-tenant"),
    /serialized_custody_equipment_exists/,
  );
});

test("a physical custody row carries no equipment link at all", { skip: SKIP }, async () => {
  await setup();
  await insertCustody("sc-shelf", "AVAILABLE", "WAREHOUSE", ORIGIN_WAREHOUSE);
  const row = await query("SELECT equipment_id FROM eos_ops.serialized_custody WHERE id = 'sc-shelf'");
  assert.equal(row.rows[0].equipment_id, null,
    "the reference applies to EQUIPMENT custody and to nothing else");
});

test("the equipment link is GENERATED -- a writer cannot set it independently", { skip: SKIP }, async () => {
  await setup();
  await insertEquipment("eq-generated");
  await assert.rejects(
    () => query(
      `INSERT INTO eos_ops.serialized_custody
         (id, tenant_id, operating_company_key, part_id, serial_number, status, location_type, location_id, equipment_id, updated_by)
       VALUES ('sc-x', $1, $2, 'p', 's', 'INSTALLED', 'EQUIPMENT', 'eq-generated', 'eq-generated', 'u')`,
      [TENANT, COMPANY],
    ),
    /non-DEFAULT value into column "equipment_id"/,
    "there is one writable fact -- location_id -- so the two can never disagree",
  );
});

test("one Equipment record holds at most one installed unit (ADR-010 §3)", { skip: SKIP }, async () => {
  await setup();
  await insertEquipment("eq-one-unit");
  await insertCustody("sc-first", "INSTALLED", "EQUIPMENT", "eq-one-unit", { serial: "SN-1" });
  await assert.rejects(
    () => insertCustody("sc-second", "INSTALLED", "EQUIPMENT", "eq-one-unit", { serial: "SN-2" }),
    /serialized_custody_one_unit_per_equipment/,
    "the Firestore command guards the asset side only; this is the half nothing was watching",
  );
});

test("migration 007's biconditional still holds, now with a referent behind it", { skip: SKIP }, async () => {
  await setup();
  await insertEquipment("eq-bicond");
  await assert.rejects(
    () => insertCustody("sc-bad-a", "AVAILABLE", "EQUIPMENT", "eq-bicond"),
    /serialized_custody_installed_is_equipment/,
  );
  await assert.rejects(
    () => insertCustody("sc-bad-b", "INSTALLED", "WAREHOUSE", ORIGIN_WAREHOUSE),
    /serialized_custody_installed_is_equipment/,
  );
});

// ============================ the install command ============================

test("installing mints the Equipment, links the unit, and records the TYPED origin", { skip: SKIP }, async () => {
  await setup();
  await insertCustody("sc-install", "AVAILABLE", "WAREHOUSE", ORIGIN_WAREHOUSE,
    { partId: "part-ice-machine", serial: "SN-INSTALL" });

  const result = await installSerializedUnitAsEquipment(repoPool(), {
    tenantId: TENANT, actorId: "u-installer", operatingCompanyKey: COMPANY,
    partId: "part-ice-machine", serialNumber: "SN-INSTALL",
    equipmentId: "eq_install_1", accountId: "cw-acct-0003",
    customerLocation: customerLocation(CUSTOMER_SITE),
    equipment: { name: "Lobby ice machine", installedOn: "2026-09-11" },
  });

  assert.equal(result.equipment.status, "ACTIVE");
  assert.deepEqual(result.equipment.customerLocation, { namespace: "CRM_LOCATION", id: CUSTOMER_SITE });
  assert.equal(result.equipment.serialNumber, "SN-INSTALL", "the register takes the serial from the unit");
  // THE POINT OF THE WHOLE ORIGIN PAIR. The origin came off the custody row's real enum column, so
  // the type is KNOWN -- not the `?? \"WAREHOUSE\"` guess the Firestore readers make over an untyped
  // scalar (inventoryAnalyticsCallables.ts:91-95).
  assert.deepEqual(result.equipment.installedFrom,
    { namespace: "OPS_LOCATION", type: "WAREHOUSE", id: ORIGIN_WAREHOUSE });

  assert.equal(result.unit.status, "INSTALLED");
  assert.equal(result.unit.locationType, "EQUIPMENT");
  assert.equal(result.unit.equipmentId, "eq_install_1");

  // The relationship reads in both directions, from ONE stored fact.
  const linked = await readInstalledUnit(repoPool(), TENANT, "eq_install_1");
  assert.equal(linked.serialNumber, "SN-INSTALL");
  const equipment = await readEquipment(repoPool(), TENANT, "eq_install_1");
  assert.equal(equipment.name, "Lobby ice machine");

  // And the CRM-side relationship: every machine at one customer site.
  const atSite = await readEquipmentAtCustomerLocation(repoPool(), TENANT, customerLocation(CUSTOMER_SITE));
  assert.deepEqual(atSite.map((e) => e.id), ["eq_install_1"]);
});

test("a second install of the same unit is refused", { skip: SKIP }, async () => {
  await setup();
  await insertCustody("sc-twice", "AVAILABLE", "WAREHOUSE", ORIGIN_WAREHOUSE, { serial: "SN-TWICE" });
  const request = {
    tenantId: TENANT, actorId: "u", operatingCompanyKey: COMPANY,
    partId: "part-ice-machine", serialNumber: "SN-TWICE", accountId: "cw-acct-0003",
    customerLocation: customerLocation(CUSTOMER_SITE), equipment: { name: "Unit" },
  };
  await installSerializedUnitAsEquipment(repoPool(), { ...request, equipmentId: "eq_twice_a" });
  await assert.rejects(
    () => installSerializedUnitAsEquipment(repoPool(), { ...request, equipmentId: "eq_twice_b" }),
    (error) => error instanceof EquipmentCustodyError && error.code === "ALREADY_INSTALLED",
  );
  const orphan = await readEquipment(repoPool(), TENANT, "eq_twice_b");
  assert.equal(orphan, null, "the refused install left no Equipment record behind");
});

test("the operating company is verified against the unit, never adopted from it", { skip: SKIP }, async () => {
  await setup();
  await insertCustody("sc-company", "AVAILABLE", "WAREHOUSE", ORIGIN_WAREHOUSE,
    { serial: "SN-CO", company: COMPANY });
  await assert.rejects(
    () => installSerializedUnitAsEquipment(repoPool(), {
      tenantId: TENANT, actorId: "u", operatingCompanyKey: OTHER_COMPANY,
      partId: "part-ice-machine", serialNumber: "SN-CO", equipmentId: "eq_company",
      accountId: "cw-acct-0003", customerLocation: customerLocation(CUSTOMER_SITE),
      equipment: { name: "Unit" },
    }),
    (error) => error instanceof EquipmentCustodyError && error.code === "OPERATING_COMPANY_MISMATCH",
  );
});

test("a status this schema cannot represent as installable is refused, not remapped", { skip: SKIP }, async () => {
  await setup();
  await insertCustody("sc-scrapped", "SCRAPPED", "WAREHOUSE", ORIGIN_WAREHOUSE, { serial: "SN-SCRAP" });
  await assert.rejects(
    () => installSerializedUnitAsEquipment(repoPool(), {
      tenantId: TENANT, actorId: "u", operatingCompanyKey: COMPANY,
      partId: "part-ice-machine", serialNumber: "SN-SCRAP", equipmentId: "eq_scrap",
      accountId: "cw-acct-0003", customerLocation: customerLocation(CUSTOMER_SITE),
      equipment: { name: "Unit" },
    }),
    (error) => error instanceof EquipmentCustodyError && error.code === "STATUS_NOT_INSTALLABLE",
  );
});

test("an unknown unit is a refusal, not an install with nothing behind it", { skip: SKIP }, async () => {
  await setup();
  await assert.rejects(
    () => installSerializedUnitAsEquipment(repoPool(), {
      tenantId: TENANT, actorId: "u", operatingCompanyKey: COMPANY,
      partId: "part-ice-machine", serialNumber: "SN-NOBODY", equipmentId: "eq_nobody",
      accountId: "cw-acct-0003", customerLocation: customerLocation(CUSTOMER_SITE),
      equipment: { name: "Unit" },
    }),
    (error) => error instanceof EquipmentCustodyError && error.code === "UNIT_NOT_FOUND",
  );
});

// ============================ the model catalog ============================

test("the catalog accepts a canonical model id and refuses a non-canonical one", { skip: SKIP }, async () => {
  await setup();
  const model = {
    id: "TAYLOR--C-713", manufacturerId: "TAYLOR", manufacturerName: "Taylor",
    modelNumber: "C/713", displayName: "Taylor C/713", status: "ACTIVE",
    sourceAuthority: "manual", version: 1,
  };
  const stored = await recordEquipmentModel(repoPool(), TENANT, "u", model);
  assert.equal(stored.id, "TAYLOR--C-713");
  // The model NUMBER keeps its real spelling; only the ID segment is dash-folded. The schema does
  // not re-derive the folding (NFKC is not expressible in SQL) -- it holds the manufacturer halves
  // in agreement and leaves the derivation to the domain authority.
  assert.equal(stored.modelNumber, "C/713");

  // Shape only: the manufacturer half still agrees, so this is refused by the charset rule and
  // not by the agreement rule -- the two constraints are separately load-bearing.
  await assert.rejects(
    () => recordEquipmentModel(repoPool(), TENANT, "u", { ...model, id: "TAYLOR--C_713" }),
    /equipment_model_id_canonical_shape/,
  );
  await assert.rejects(
    () => recordEquipmentModel(repoPool(), TENANT, "u", { ...model, id: "taylor--c713" }),
    /equipment_model_(id_canonical_shape|id_agrees_with_manufacturer)/,
    "a lowercase id is not canonical under any reading",
  );
  await assert.rejects(
    () => recordEquipmentModel(repoPool(), TENANT, "u", { ...model, id: "RHEEM--C-713" }),
    /equipment_model_id_agrees_with_manufacturer/,
    "the manufacturer half of the id IS the manufacturer_id column",
  );
});

test("two tenants may each catalog the same manufacturer's model", { skip: SKIP }, async () => {
  await setup();
  const model = {
    id: "TAYLOR--C-602", manufacturerId: "TAYLOR", manufacturerName: "Taylor",
    modelNumber: "C602", displayName: "Taylor C602", status: "ACTIVE",
    sourceAuthority: "manual", version: 1,
  };
  await recordEquipmentModel(repoPool(), TENANT, "u", model);
  await recordEquipmentModel(repoPool(), OTHER_TENANT, "u", model);
  // A canonical model id is unique WITHIN a catalog; it is not a global identifier.
  assert.ok(true);
});

test("equipment may reference a model, and only its own tenant's", { skip: SKIP }, async () => {
  await setup();
  await recordEquipmentModel(repoPool(), OTHER_TENANT, "u", {
    id: "TAYLOR--C-723", manufacturerId: "TAYLOR", manufacturerName: "Taylor",
    modelNumber: "C723", displayName: "Taylor C723", status: "ACTIVE",
    sourceAuthority: "manual", version: 1,
  });
  await insertCustody("sc-model", "AVAILABLE", "WAREHOUSE", ORIGIN_WAREHOUSE, { serial: "SN-MODEL" });
  const request = {
    tenantId: TENANT, actorId: "u", operatingCompanyKey: COMPANY,
    partId: "part-ice-machine", serialNumber: "SN-MODEL", equipmentId: "eq_model",
    accountId: "cw-acct-0003", customerLocation: customerLocation(CUSTOMER_SITE),
    equipment: { name: "Unit", equipmentModelId: "TAYLOR--C-723" },
  };
  await assert.rejects(
    () => installSerializedUnitAsEquipment(repoPool(), request),
    (error) => error instanceof EquipmentCustodyError && error.code === "MODEL_NOT_FOUND",
  );

  await recordEquipmentModel(repoPool(), TENANT, "u", {
    id: "TAYLOR--C-723", manufacturerId: "TAYLOR", manufacturerName: "Taylor",
    modelNumber: "C723", displayName: "Taylor C723", status: "ACTIVE",
    sourceAuthority: "manual", version: 1,
  });
  const result = await installSerializedUnitAsEquipment(repoPool(), request);
  assert.equal(result.equipment.equipmentModelId, "TAYLOR--C-723");
});

test("an unresolved model is NULL, never a second free-text spelling", { skip: SKIP }, async () => {
  await setup();
  await insertEquipment("eq-no-model");
  const equipment = await readEquipment(repoPool(), TENANT, "eq-no-model");
  assert.equal(equipment.equipmentModelId, null);
  const columns = await query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'eos_ops' AND table_name = 'equipment'
        AND column_name IN ('manufacturer', 'model')`,
  );
  assert.deepEqual(columns.rows, [], "the free-text pair is import input, not a model authority here");
});

// ============================ reversal ============================

test("the down migration refuses while customer Equipment exists, and reverses when it does not",
  { skip: SKIP }, async () => {
    await setup();
    await insertEquipment("eq-blocks-down");
    assert.throws(() => migrate(["down", "1"]), (error) => {
      const text = `${error.stdout ?? ""}${error.stderr ?? ""}${error.message}`;
      assert.match(text, /migration 008 cannot be reversed/);
      assert.match(text, /equipment \(1 rows\)/, "it names the table and the count");
      return true;
    });

    // And with the records resolved, it reverses cleanly and re-applies.
    await clean();
    migrate(["down", "1"]);
    const gone = await query(
      `SELECT to_regclass('eos_ops.equipment') AS equipment,
              to_regclass('eos_ops.equipment_models') AS models`,
    );
    assert.equal(gone.rows[0].equipment, null);
    assert.equal(gone.rows[0].models, null);
    const custody = await query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'eos_ops' AND table_name = 'serialized_custody' AND column_name = 'equipment_id'`,
    );
    assert.deepEqual(custody.rows, [], "the generated link goes with the table it referenced");

    migrateUp();
    const back = await query("SELECT to_regclass('eos_ops.equipment') AS equipment");
    assert.ok(back.rows[0].equipment, "and 008 re-applies");
  });
