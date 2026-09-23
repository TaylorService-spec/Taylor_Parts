// THE MANUFACTURER AUTHORITY -- target schema, capability split, and migration tooling.
//
// Measured before any of this was built: the source collection holds ZERO documents, while 48
// equipment_models carry a manufacturerId and 288 equipment records carry a free-text manufacturer
// name. So the tooling proves its own mechanics here rather than against live data.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const authority = require("../lib/eosOps/manufacturerAuthority.js");
const mig = require("../lib/eosOps/migration/manufacturerMigration.js");

const sha = (s) => createHash("sha256").update(s).digest("hex");
const T = "t-mfg";
const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}
const snap = (records) => mig.buildSnapshot({
  sourceProject: "eos-platform-sandbox", sourceCollection: "manufacturers",
  records, now: "2026-09-23T00:00:00Z", hash: sha,
});

// ════════════════════ tooling, with no database ════════════════════

test("the checksum is deterministic, order-independent, and field-scoped", () => {
  const a = [{ id: "m2", name: "Icetro", status: "ACTIVE" }, { id: "m1", name: "Taylor", status: "ACTIVE" }];
  const b = [{ id: "m1", name: "Taylor", status: "ACTIVE" }, { id: "m2", name: "Icetro", status: "ACTIVE" }];
  assert.equal(mig.snapshotChecksum(a, sha), mig.snapshotChecksum(b, sha), "listing order is not a promise");
  // A field the copy does not write must not read as drift.
  const c = [{ id: "m1", name: "Taylor", status: "ACTIVE", somethingElse: 1 },
    { id: "m2", name: "Icetro", status: "ACTIVE" }];
  assert.equal(mig.snapshotChecksum(b, sha), mig.snapshotChecksum(c, sha));
  // A field it DOES write must.
  const d = [{ id: "m1", name: "Taylor Company", status: "ACTIVE" }, { id: "m2", name: "Icetro", status: "ACTIVE" }];
  assert.notEqual(mig.snapshotChecksum(b, sha), mig.snapshotChecksum(d, sha));
});

test("every source record is classified, and a bad one is BLOCKED not guessed at", () => {
  const s = snap([
    { id: "m1", name: "Taylor", status: "ACTIVE" },
    { id: "m2", name: "  ", status: "ACTIVE" },
    { id: "m3", name: "Icetro", status: "RETIRED" },
    { id: "", name: "Nameless", status: "ACTIVE" },
  ]);
  const report = mig.runDryRun(s, []);
  const by = Object.fromEntries(report.rows.map((r) => [r.id, r]));
  assert.equal(by.m1.disposition, "COPYABLE");
  assert.deepEqual(by.m2.blockers, ["NAME_MISSING"]);
  assert.deepEqual(by.m3.blockers, ["STATUS_UNKNOWN"]);
  assert.deepEqual(by[""].blockers, ["ID_MISSING"]);
  assert.equal(report.blocked, 3);
  assert.equal(report.applyable, false, "a blocked record stops the whole run");
});

test("duplicates are REPORTED, never merged", () => {
  const s = snap([
    { id: "m1", name: "Taylor", status: "ACTIVE" },
    { id: "m2", name: "Taylor", status: "ACTIVE" },
    { id: "m3", name: "taylor  company", status: "ACTIVE" },
    { id: "m4", name: "Taylor Company", status: "ACTIVE" },
  ]);
  const report = mig.runDryRun(s, []);
  assert.deepEqual(report.duplicateNameGroups, [["m1", "m2"]], "exact duplicates are named");
  assert.deepEqual(report.caseOnlyDuplicateGroups, [["m3", "m4"]], "case/whitespace-only ones separately");
  // Both are still COPYABLE: two companies may share a name, and merging would destroy a real distinction.
  assert.equal(report.copyable, 4);
  assert.equal(report.applyable, true);
});

test("COPY refuses drift, refuses conflicts, and is replay-safe", () => {
  const s = snap([{ id: "m1", name: "Taylor", status: "ACTIVE" }]);
  assert.throws(() => mig.buildCopyPlan(s, [], "a-stale-checksum"), /SOURCE_CHECKSUM_DRIFT/);
  // A target row that DIFFERS is never overwritten.
  assert.throws(() => mig.buildCopyPlan(s, [{ id: "m1", name: "Taylor Co", status: "ACTIVE" }], s.checksum),
    /TARGET_CONFLICT/);
  // An identical target row is simply not re-inserted: running COPY twice writes nothing the second time.
  const replay = mig.buildCopyPlan(s, [{ id: "m1", name: "Taylor", status: "ACTIVE" }], s.checksum);
  assert.deepEqual(replay.inserts, []);
  const first = mig.buildCopyPlan(s, [], s.checksum);
  assert.deepEqual(first.inserts.map((i) => i.id), ["m1"]);
});

test("VERIFY compares and repairs nothing", () => {
  const s = snap([{ id: "m1", name: "Taylor", status: "ACTIVE" }, { id: "m2", name: "Icetro", status: "ACTIVE" }]);
  assert.equal(mig.verifyCopy(s, [{ id: "m1", name: "Taylor", status: "ACTIVE" },
    { id: "m2", name: "Icetro", status: "ACTIVE" }]).pass, true);
  const missing = mig.verifyCopy(s, [{ id: "m1", name: "Taylor", status: "ACTIVE" }]);
  assert.deepEqual(missing.missingInTarget, ["m2"]);
  assert.equal(missing.pass, false);
  const differing = mig.verifyCopy(s, [{ id: "m1", name: "Taylor", status: "INACTIVE" },
    { id: "m2", name: "Icetro", status: "ACTIVE" }]);
  assert.deepEqual(differing.differing, ["m1"]);
  const extra = mig.verifyCopy(s, [{ id: "m1", name: "Taylor", status: "ACTIVE" },
    { id: "m2", name: "Icetro", status: "ACTIVE" }, { id: "m9", name: "Ghost", status: "ACTIVE" }]);
  assert.deepEqual(extra.extraInTarget, ["m9"]);
  // A WRITE, not any word that resembles one. `\.set\(` alone matches Map.prototype.set, which this
  // module uses for grouping -- a probe that fires on it teaches people to avoid Maps.
  const src = require("node:fs").readFileSync(
    resolve(FUNCTIONS_DIR, "src/eosOps/migration/manufacturerMigration.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const write of [/\bINSERT\s+INTO\b/i, /\bUPDATE\s+\w+\s+SET\b/i, /\bDELETE\s+FROM\b/i,
    /\.doc\([^)]*\)\.set\(/, /\bbatch\(/, /FieldValue\./, /\bquery\(/]) {
    assert.equal(write.test(src), false, `the tooling core must not ${write}`);
  }
  // Non-vacuity: the module must still be substantial enough for that to mean something.
  assert.ok(src.length > 2000, "the probe is scanning an empty file and would pass for the wrong reason");
});

test("neither Manufacturer module touches Firebase or the legacy catalog", () => {
  const fs = require("node:fs");
  for (const f of ["src/eosOps/manufacturerAuthority.ts", "src/eosOps/migration/manufacturerMigration.ts"]) {
    const src = fs.readFileSync(resolve(FUNCTIONS_DIR, f), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const forbidden of ["firebase", "firestore", "permissionCatalog", "operationalRoles",
      "caller.role", "request.auth", "jobRole"]) {
      assert.equal(src.toLowerCase().includes(forbidden.toLowerCase()), false, `${f} reaches for ${forbidden}`);
    }
  }
});

// ════════════════════ against the real database ════════════════════

test("Manufacturer authority, in PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `mfg_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up",
    "--migrations-dir", "migrations", "--no-check-order"],
  { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe" });
  pool = new pg.Pool({ connectionString: dbUrlFor(name), max: 4 });
  const q = (sql, v = []) => pool.query(sql, v);
  await q(`INSERT INTO eos_policy.tenants (id,key,name) VALUES ($1,$1,$1)`, [T]);

  await t.test("the capability is a SPLIT of the catalog read, to exactly the same 19 Roles", async () => {
    const cap = await q(
      `SELECT object_key, action_key, action_kind FROM eos_policy.capabilities WHERE key = 'inventory.manufacturer.read'`);
    assert.deepEqual(cap.rows[0], { object_key: "manufacturer", action_key: "read", action_kind: "READ" });
    const { deriveLegacyRoleGrants } = require("../lib/eosOps/migration/inventoryCapabilityGrantMigration.js");
    const expected = deriveLegacyRoleGrants(["inventory.catalog.read"]).map((g) => g.roleKey).sort();
    assert.equal(expected.length, 19);
    const sql = require("node:fs").readFileSync(
      resolve(FUNCTIONS_DIR, "migrations/1761782400000_manufacturer-catalog-authority.sql"), "utf8");
    const granted = [...sql.matchAll(/\('([a-zA-Z]+)'\)/g)].map((m) => m[1]).sort();
    assert.deepEqual(granted, expected, "the grant list must equal the catalog-read holders exactly");
    // No write capability was invented.
    const writes = await q(
      `SELECT key FROM eos_policy.capabilities WHERE object_key = 'manufacturer' AND action_kind <> 'READ'`);
    assert.deepEqual(writes.rows, [], "this slice preserves the measured READ authority only");
  });

  await t.test("reads require the capability, whatever else the caller holds", async () => {
    await assert.rejects(() => authority.listManufacturers(pool,
      { tenantId: T, capabilities: new Set(["inventory.catalog.read"]) }), /CAPABILITY_MISSING/);
    await assert.rejects(() => authority.getManufacturer(pool,
      { tenantId: T, capabilities: new Set() }, "m1"), /CAPABILITY_MISSING/);
  });

  await t.test("list and get read the governed table, INACTIVE included", async () => {
    await q(`INSERT INTO eos_ops.manufacturers (id,tenant_id,name,normalized_name,status,provenance,created_by,updated_by)
             VALUES ('m-taylor',$1,'Taylor','TAYLOR','ACTIVE','MIGRATED','fixture','fixture'),
                    ('m-icetro',$1,'Icetro','ICETRO','INACTIVE','MIGRATED','fixture','fixture')`, [T]);
    const reader = { tenantId: T, capabilities: new Set(["inventory.manufacturer.read"]) };
    const all = await authority.listManufacturers(pool, reader);
    // Ordered by normalized name; the INACTIVE one is present because equipment already names it.
    assert.deepEqual(all.map((m) => m.id), ["m-icetro", "m-taylor"]);
    assert.equal(all.find((m) => m.id === "m-icetro").status, "INACTIVE");
    assert.equal((await authority.getManufacturer(pool, reader, "m-taylor")).name, "Taylor");
    assert.equal(await authority.getManufacturer(pool, reader, "no-such"), null, "a dangling reference is not an error");
  });

  await t.test("another tenant sees nothing of this one's reference data", async () => {
    await q(`INSERT INTO eos_policy.tenants (id,key,name) VALUES ('t-other','t-other','t-other')`);
    const other = await authority.listManufacturers(pool,
      { tenantId: "t-other", capabilities: new Set(["inventory.manufacturer.read"]) });
    assert.deepEqual(other, []);
  });

  await t.test("the table refuses a record the source model forbids", async () => {
    for (const [sql, pattern] of [
      [`INSERT INTO eos_ops.manufacturers (id,tenant_id,name,normalized_name,status,provenance,created_by,updated_by)
        VALUES ('bad',$1,'X','X','RETIRED','MIGRATED','f','f')`, /manufacturers_status_known/],
      [`INSERT INTO eos_ops.manufacturers (id,tenant_id,name,normalized_name,status,provenance,created_by,updated_by)
        VALUES ('bad',$1,'  ','X','ACTIVE','MIGRATED','f','f')`, /manufacturers_name_stated/],
      [`INSERT INTO eos_ops.manufacturers (id,tenant_id,name,normalized_name,status,provenance,created_by,updated_by)
        VALUES ('bad',$1,'X','X','ACTIVE','INVENTED','f','f')`, /manufacturers_provenance_known/],
    ]) await assert.rejects(q(sql, [T]), pattern);
    // No DELETE capability exists anywhere in the catalog: a manufacturer is deactivated.
    const del = await q(`SELECT key FROM eos_policy.capabilities WHERE action_kind = 'DELETE'`);
    assert.deepEqual(del.rows, [], "the platform still registers no DELETE capability at all");
  });
});
