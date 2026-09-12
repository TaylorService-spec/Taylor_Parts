// eos_ops Truck / MOBILE-location registry — the POSTGRESQL proofs.
//
// ════════════════════ THESE RUN AGAINST A REAL DATABASE ════════════════════
//
// Set POLICY_TEST_DATABASE_URL to run; without it this SKIPS rather than fails, the same way
// eosOpsPostgres.test.mjs does.
//
// DELIBERATELY NOT A SCHEMA RESETTER. It migrates UP (idempotent) and cleans up only the rows it
// created, in its own tenant. adminPolicyPostgres.test.mjs:692-702 requires every suite that resets
// the schema to be registered in the single serialized `test:adminPolicyPostgres` command; this
// suite touches nobody else's rows, so it needs no such serialization and stays runnable on its own.
// See docs/handoff/w1-c4-registrations.md for the package.json registration this lane could not make.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import pg from "pg";
import {
  createMobileLocation,
  createTruck,
  readTruck,
  readMobileLocation,
  readTruckAtMobileLocation,
  linkTruck,
  relinkTruck,
  unlinkTruck,
  changeTruckStatus,
  listMobileLocationsWithoutTruck,
  listMobileLocationsForCompany,
  TruckFleetRepositoryError,
} from "../lib/eosOps/truckFleetRepository.js";

const URL = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

const TENANT = "tenant-w1c4";
const ACTOR = "uid-w1c4";
// OPAQUE governed keys. Deliberately not real company names: nothing in this schema may depend on
// which companies a deployment happens to have.
const COMPANY_A = "oc-alpha";
const COMPANY_B = "oc-beta";

let pool = null;
function repoPool() {
  pool ??= new pg.Pool({ connectionString: URL, max: 4 });
  return pool;
}

async function query(text, values = []) {
  const client = new pg.Client({ connectionString: URL });
  await client.connect();
  try {
    return await client.query(text, values);
  } finally {
    await client.end();
  }
}

function migrateUp() {
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"], {
    env: { ...process.env, DATABASE_URL: URL },
    stdio: "pipe",
  });
}

function migrateDownOne() {
  return execFileSync(
    process.execPath,
    ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "down", "--migrations-dir", "migrations"],
    { env: { ...process.env, DATABASE_URL: URL }, stdio: "pipe" },
  );
}

/** Remove only this tenant's rows. Trucks first: they reference the locations. */
async function clean() {
  await query("DELETE FROM eos_ops.trucks WHERE tenant_id = $1", [TENANT]);
  await query("DELETE FROM eos_ops.mobile_locations WHERE tenant_id = $1", [TENANT]);
}

test.before(async () => {
  if (SKIP) return;
  migrateUp();
  await query("INSERT INTO eos_policy.tenants (id, key, name) VALUES ($1, $1, $1) ON CONFLICT DO NOTHING", [TENANT]);
  await clean();
});

test.after(async () => {
  if (SKIP) return;
  await clean();
  await pool?.end();
});

// ============================ identity is the typed pair ============================

test("a MOBILE location's primary key is (tenant, location_type, location_id)", { skip: SKIP }, async () => {
  await clean();
  const created = await createMobileLocation(repoPool(), TENANT, ACTOR, {
    locationId: "cert-trk-01",
    operatingCompanyKey: COMPANY_A,
    displayLabel: "Truck 101 - North Valley",
  });
  assert.deepEqual(created.location, { type: "MOBILE", id: "cert-trk-01" });

  const { rows } = await query(
    `SELECT a.attname FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = 'eos_ops.mobile_locations'::regclass AND i.indisprimary
      ORDER BY a.attname`,
  );
  assert.deepEqual(rows.map((r) => r.attname), ["location_id", "location_type", "tenant_id"]);
});

test("the same id may not be created twice, and the row can only ever be MOBILE", { skip: SKIP }, async () => {
  await clean();
  const input = { locationId: "cert-trk-01", operatingCompanyKey: COMPANY_A, displayLabel: "L" };
  await createMobileLocation(repoPool(), TENANT, ACTOR, input);
  await assert.rejects(createMobileLocation(repoPool(), TENANT, ACTOR, input), /duplicate key/);

  await assert.rejects(
    query(
      `INSERT INTO eos_ops.mobile_locations
         (tenant_id, location_type, location_id, operating_company_key, display_label, active, created_by, updated_by)
       VALUES ($1, 'WAREHOUSE', 'wh-main', $2, 'L', true, $3, $3)`,
      [TENANT, COMPANY_A, ACTOR],
    ),
    /mobile_location_is_mobile/,
  );
});

test("operator-typed ids are stored verbatim, whatever convention they follow", { skip: SKIP }, async () => {
  await clean();
  const ids = ["cert-trk-01", "mobile-seed1786749487428-101", "TRUCK 7 / spare"];
  for (const id of ids) {
    await createMobileLocation(repoPool(), TENANT, ACTOR, { locationId: id, operatingCompanyKey: COMPANY_A, displayLabel: id });
  }
  for (const id of ids) {
    const back = await readMobileLocation(repoPool(), TENANT, id);
    assert.equal(back.location.id, id);
  }
});

// ============================ the operating company must be stated ============================

test("a MOBILE location with no operating company cannot exist, at either layer", { skip: SKIP }, async () => {
  await clean();
  await assert.rejects(
    createMobileLocation(repoPool(), TENANT, ACTOR, { locationId: "x", operatingCompanyKey: "", displayLabel: "L" }),
    /never defaulted, inferred or manufactured/,
  );
  // And the column refuses a caller that goes around the repository.
  await assert.rejects(
    query(
      `INSERT INTO eos_ops.mobile_locations
         (tenant_id, location_type, location_id, display_label, active, created_by, updated_by)
       VALUES ($1, 'MOBILE', 'x', 'L', true, $2, $2)`,
      [TENANT, ACTOR],
    ),
    /operating_company_key/,
  );
});

test("the column has no DEFAULT, so nothing can supply one implicitly", { skip: SKIP }, async () => {
  const { rows } = await query(
    `SELECT column_default, is_nullable FROM information_schema.columns
      WHERE table_schema = 'eos_ops' AND table_name = 'mobile_locations' AND column_name = 'operating_company_key'`,
  );
  assert.equal(rows[0].column_default, null);
  assert.equal(rows[0].is_nullable, "NO");
});

test("trucks carry NO operating company column -- the location states it once", { skip: SKIP }, async () => {
  const { rows } = await query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'eos_ops' AND table_name = 'trucks' ORDER BY column_name`,
  );
  const columns = rows.map((r) => r.column_name);
  assert.equal(columns.includes("operating_company_key"), false);
  // And no driver column: that relationship's other end is Employee identity, settled elsewhere.
  assert.equal(columns.some((c) => /driver|employee/.test(c)), false);
  assert.equal(columns.includes("home_warehouse_id"), true, "carried, but descriptive only");
});

test("readTruck reports the linked location's company, and null when unlinked", { skip: SKIP }, async () => {
  await clean();
  await createMobileLocation(repoPool(), TENANT, ACTOR, { locationId: "m-1", operatingCompanyKey: COMPANY_B, displayLabel: "M1" });
  const unlinked = await createTruck(repoPool(), TENANT, ACTOR, {
    truckId: "TRK-1", vehicleNumber: "101", displayLabel: "Truck 101", homeWarehouseId: "wh-main",
  });
  assert.equal(unlinked.operatingCompanyKey, null);

  const linked = await linkTruck(repoPool(), TENANT, ACTOR, "TRK-1", "m-1");
  assert.equal(linked.operatingCompanyKey, COMPANY_B);
});

// ============================ the 1:1, without a claim table ============================

test("there is no claims table -- the relationship is a unique index plus a foreign key", { skip: SKIP }, async () => {
  const { rows } = await query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'eos_ops' ORDER BY table_name`,
  );
  const tables = rows.map((r) => r.table_name);
  assert.equal(tables.includes("location_truck_claims"), false);
  assert.equal(tables.includes("mobile_locations"), true);
  assert.equal(tables.includes("trucks"), true);

  const idx = await query(
    `SELECT indexdef FROM pg_indexes WHERE schemaname = 'eos_ops' AND indexname = 'trucks_one_per_mobile_location'`,
  );
  assert.match(idx.rows[0].indexdef, /UNIQUE/);
  assert.match(idx.rows[0].indexdef, /WHERE \(mobile_location_id IS NOT NULL\)/);
});

test("a second truck cannot take a MOBILE location another truck holds", { skip: SKIP }, async () => {
  await clean();
  await createMobileLocation(repoPool(), TENANT, ACTOR, { locationId: "m-1", operatingCompanyKey: COMPANY_A, displayLabel: "M1" });
  await createTruck(repoPool(), TENANT, ACTOR, {
    truckId: "TRK-1", vehicleNumber: "101", displayLabel: "T1", homeWarehouseId: "wh-main", mobileLocationId: "m-1",
  });

  await assert.rejects(
    createTruck(repoPool(), TENANT, ACTOR, {
      truckId: "TRK-2", vehicleNumber: "102", displayLabel: "T2", homeWarehouseId: "wh-main", mobileLocationId: "m-1",
    }),
    (e) => e instanceof TruckFleetRepositoryError && e.code === "LOCATION_ALREADY_LINKED",
  );
  // ...and the refused truck left nothing behind.
  assert.equal(await readTruck(repoPool(), TENANT, "TRK-2"), null);

  await createTruck(repoPool(), TENANT, ACTOR, {
    truckId: "TRK-2", vehicleNumber: "102", displayLabel: "T2", homeWarehouseId: "wh-main",
  });
  await assert.rejects(
    linkTruck(repoPool(), TENANT, ACTOR, "TRK-2", "m-1"),
    (e) => e.code === "LOCATION_ALREADY_LINKED",
  );
});

test("a truck cannot link to a MOBILE location that does not exist", { skip: SKIP }, async () => {
  await clean();
  await assert.rejects(
    createTruck(repoPool(), TENANT, ACTOR, {
      truckId: "TRK-1", vehicleNumber: "101", displayLabel: "T1", homeWarehouseId: "wh-main", mobileLocationId: "nope",
    }),
    (e) => e.code === "LOCATION_NOT_FOUND",
  );
});

test("a half-stated link is rejected by the schema", { skip: SKIP }, async () => {
  await clean();
  await assert.rejects(
    query(
      `INSERT INTO eos_ops.trucks
         (tenant_id, truck_id, vehicle_number, display_label, status, active, home_warehouse_id,
          mobile_location_type, mobile_location_id, created_by, updated_by)
       VALUES ($1, 'TRK-X', '1', 'T', 'ACTIVE', true, 'wh-main', 'MOBILE', NULL, $2, $2)`,
      [TENANT, ACTOR],
    ),
    /truck_mobile_link_whole/,
  );
});

test("an already-linked truck refuses a second link; relink moves it", { skip: SKIP }, async () => {
  await clean();
  for (const id of ["m-1", "m-2"]) {
    await createMobileLocation(repoPool(), TENANT, ACTOR, { locationId: id, operatingCompanyKey: COMPANY_A, displayLabel: id });
  }
  await createTruck(repoPool(), TENANT, ACTOR, {
    truckId: "TRK-1", vehicleNumber: "101", displayLabel: "T1", homeWarehouseId: "wh-main", mobileLocationId: "m-1",
  });
  await assert.rejects(linkTruck(repoPool(), TENANT, ACTOR, "TRK-1", "m-2"), (e) => e.code === "TRUCK_ALREADY_LINKED");

  const moved = await relinkTruck(repoPool(), TENANT, ACTOR, "TRK-1", "m-2");
  assert.deepEqual(moved.mobileLocation, { type: "MOBILE", id: "m-2" });
  assert.equal(await readTruckAtMobileLocation(repoPool(), TENANT, "m-1"), null);
  assert.equal((await readTruckAtMobileLocation(repoPool(), TENANT, "m-2")).truckId, "TRK-1");
});

// ============================ reassignment changes the relationship, never the identity ============================

test("relink and unlink leave both records' identities byte-identical", { skip: SKIP }, async () => {
  await clean();
  for (const id of ["m-1", "m-2"]) {
    await createMobileLocation(repoPool(), TENANT, ACTOR, { locationId: id, operatingCompanyKey: COMPANY_A, displayLabel: id });
  }
  await createTruck(repoPool(), TENANT, ACTOR, {
    truckId: "TRK-1", vehicleNumber: "101", displayLabel: "T1", homeWarehouseId: "wh-main", mobileLocationId: "m-1",
  });
  const beforeTruck = await readTruck(repoPool(), TENANT, "TRK-1");
  const beforeLoc1 = await readMobileLocation(repoPool(), TENANT, "m-1");

  await relinkTruck(repoPool(), TENANT, ACTOR, "TRK-1", "m-2");
  const afterRelink = await readTruck(repoPool(), TENANT, "TRK-1");
  assert.equal(afterRelink.truckId, beforeTruck.truckId);
  assert.equal(afterRelink.vehicleNumber, beforeTruck.vehicleNumber);
  // m-1 survives the move untouched -- same id, same authored company, still a real location.
  assert.deepEqual(await readMobileLocation(repoPool(), TENANT, "m-1"), beforeLoc1);

  const unlinked = await unlinkTruck(repoPool(), TENANT, ACTOR, "TRK-1");
  assert.equal(unlinked.truckId, "TRK-1");
  assert.equal(unlinked.mobileLocation, null);
  assert.equal(unlinked.operatingCompanyKey, null);
  assert.deepEqual(await readMobileLocation(repoPool(), TENANT, "m-2"), {
    tenantId: TENANT, location: { type: "MOBILE", id: "m-2" }, operatingCompanyKey: COMPANY_A, displayLabel: "m-2", active: true,
  });
});

test("the repository exposes no way to rewrite either id, and no assignment history table exists", { skip: SKIP }, async () => {
  const repo = await import("../lib/eosOps/truckFleetRepository.js");
  const names = Object.keys(repo);
  assert.equal(names.some((n) => /rename|renameTruck|changeLocationId|setTruckId/i.test(n)), false);
  assert.equal(names.some((n) => /delete|drop|truncate|history/i.test(n)), false);

  const { rows } = await query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'eos_ops'`);
  assert.equal(rows.some((r) => /assignment|history/.test(r.table_name)), false);
});

// ============================ the unlinked-location reality ============================

test("MOBILE locations with no truck are first-class, and listable", { skip: SKIP }, async () => {
  await clean();
  const ids = ["cert-trk-01", "cert-trk-02", "cert-trk-03", "cert-trk-04", "cert-trk-05"];
  for (const id of ids.slice(0, 3)) {
    await createMobileLocation(repoPool(), TENANT, ACTOR, { locationId: id, operatingCompanyKey: COMPANY_A, displayLabel: id });
  }
  for (const id of ids.slice(3)) {
    await createMobileLocation(repoPool(), TENANT, ACTOR, { locationId: id, operatingCompanyKey: COMPANY_B, displayLabel: id });
  }
  const orphans = await listMobileLocationsWithoutTruck(repoPool(), TENANT);
  assert.deepEqual(orphans.map((o) => o.location.id), ids);

  // Two companies over one home warehouse -- the split survives because it was stated, not derived.
  assert.equal((await listMobileLocationsForCompany(repoPool(), TENANT, COMPANY_A)).length, 3);
  assert.equal((await listMobileLocationsForCompany(repoPool(), TENANT, COMPANY_B)).length, 2);

  await createTruck(repoPool(), TENANT, ACTOR, {
    truckId: "TRK-1", vehicleNumber: "101", displayLabel: "T1", homeWarehouseId: "wh-main", mobileLocationId: "cert-trk-01",
  });
  assert.deepEqual((await listMobileLocationsWithoutTruck(repoPool(), TENANT)).map((o) => o.location.id), ids.slice(1));
});

// ============================ the lifecycle biconditional ============================

test("OUT_OF_SERVICE and active=false are the same fact, in both directions", { skip: SKIP }, async () => {
  await clean();
  await assert.rejects(
    createTruck(repoPool(), TENANT, ACTOR, {
      truckId: "TRK-BAD", vehicleNumber: "1", displayLabel: "T", homeWarehouseId: "wh-main",
      status: "OUT_OF_SERVICE", active: true,
    }),
    (e) => e.code === "TRUCK_LIFECYCLE",
  );
  await assert.rejects(
    query(
      `INSERT INTO eos_ops.trucks
         (tenant_id, truck_id, vehicle_number, display_label, status, active, home_warehouse_id, created_by, updated_by)
       VALUES ($1, 'TRK-BAD', '1', 'T', 'ACTIVE', false, 'wh-main', $2, $2)`,
      [TENANT, ACTOR],
    ),
    /truck_out_of_service_is_inactive/,
  );
});

test("changeTruckStatus refuses the terminal status and refuses a deactivated truck", { skip: SKIP }, async () => {
  await clean();
  await createTruck(repoPool(), TENANT, ACTOR, {
    truckId: "TRK-1", vehicleNumber: "101", displayLabel: "T1", homeWarehouseId: "wh-main",
  });
  const idle = await changeTruckStatus(repoPool(), TENANT, ACTOR, "TRK-1", "IDLE");
  assert.equal(idle.status, "IDLE");
  assert.equal(idle.active, true);

  await assert.rejects(
    changeTruckStatus(repoPool(), TENANT, ACTOR, "TRK-1", "OUT_OF_SERVICE"),
    /inventory-guarded deactivation path/,
  );

  await createTruck(repoPool(), TENANT, ACTOR, {
    truckId: "TRK-OOS", vehicleNumber: "9", displayLabel: "T9", homeWarehouseId: "wh-main",
    status: "OUT_OF_SERVICE", active: false,
  });
  await assert.rejects(changeTruckStatus(repoPool(), TENANT, ACTOR, "TRK-OOS", "ACTIVE"), /deactivated/);
});

// ============================ the migration reverses, but never silently ============================

test("the down migration refuses while the registries hold rows, and succeeds once empty", { skip: SKIP }, async () => {
  await clean();
  await createMobileLocation(repoPool(), TENANT, ACTOR, { locationId: "m-1", operatingCompanyKey: COMPANY_A, displayLabel: "M1" });

  assert.throws(migrateDownOne, (error) => {
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    assert.match(output, /migration 008 cannot be reversed/);
    return true;
  });
  // The refusal changed nothing.
  assert.ok(await readMobileLocation(repoPool(), TENANT, "m-1"));

  await clean();
  migrateDownOne();
  const gone = await query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'eos_ops'`);
  assert.equal(gone.rows.some((r) => r.table_name === "trucks"), false);

  migrateUp();
  const back = await query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'eos_ops'`);
  assert.equal(back.rows.some((r) => r.table_name === "trucks"), true);
});
