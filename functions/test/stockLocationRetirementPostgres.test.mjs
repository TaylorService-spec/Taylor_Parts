// RETIRING THE stockLocation ADMINISTRATION OBJECT -- stale policy metadata only.
//
// The row exists in databases seeded before the Owner retired stock_locations as an operational
// authority on 2026-09-12. What must be proved is not only that it goes, but that NOTHING ELSE does:
// the Object's field rows are named binCode / partId / warehouseId, and a careless cleanup that
// followed those names into eos_ops would delete real inventory data.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const MIGRATION = "1761868800000_retire-stock-location-policy-object";
const ALL = readdirSync(resolve(FUNCTIONS_DIR, "migrations")).filter((f) => f.endsWith(".sql")).length;

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}
const migrate = (dbUrl, args) => execFileSync(process.execPath,
  ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", ...args, "--migrations-dir", "migrations", "--no-check-order"],
  { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrl }, stdio: "pipe" });

test("the retirement targets exactly one Object and nothing else", () => {
  // Comments STRIPPED: the migration's own header explains why it is not a set rule, quoting the
  // shape it refuses. A probe that fires on that teaches people to delete the explanation.
  const sql = require("node:fs").readFileSync(
    resolve(FUNCTIONS_DIR, `migrations/${MIGRATION}.sql`), "utf8")
    .split("-- Down Migration")[0].replace(/^\s*--.*$/gm, "");
  // NEVER a rule. A "delete every Object the snapshot lacks" would destroy real configuration the
  // moment a snapshot lagged a database.
  assert.equal(/NOT\s+IN\s*\(/i.test(sql), false, "the retirement must not be expressed as a set rule");
  for (const forbidden of ["eos_ops.", "eos_workforce.", "eos_crm.", "eos_commercial.", "eos_finance."]) {
    assert.equal(sql.includes(forbidden), false, `the retirement reaches into ${forbidden}`);
  }
  for (const untouched of ["capabilities", "role_capabilities", "principal_capabilities"]) {
    assert.equal(new RegExp(`DELETE\\s+FROM\\s+${untouched}\\b`, "i").test(sql), false,
      `the retirement deletes from ${untouched}`);
  }
  assert.equal((sql.match(/'stockLocation'/g) || []).length > 5, true, "it names the one key explicitly");
});

test("stockLocation retirement, in PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `slret_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  const dbUrl = dbUrlFor(name);
  // Stop one short, then reconstruct the exact shape nonprod carried, then apply the retirement.
  migrate(dbUrl, ["up", String(ALL - 1)]);
  pool = new pg.Pool({ connectionString: dbUrl, max: 4 });
  const q = (sql, v = []) => pool.query(sql, v);

  const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");
  const { bootstrapTenant } = require("../lib/adminPolicy/tenantBootstrap.js");
  const repo = new PostgresPolicyRepository(pool);
  const { tenant } = await bootstrapTenant(repo, { key: "t-slret", name: "Retire", actorUid: "fixture" });

  // The census, reconstructed: 1 object, 6 fields, 4 READ-only CRED rows, 0 overrides.
  await q(`INSERT INTO eos_policy.objects (id,tenant_id,key,label,description,origin,lifecycle,supports_delete,created_by,updated_by)
           VALUES ('obj-sl',$1,'stockLocation','Stock Location',null,'SYSTEM','ACTIVE',false,'owner','owner')`, [tenant.id]);
  for (const [k, l] of [["binCode", "Bin"], ["id", "Stock Location ID"], ["partId", "Part"],
    ["quantity", "Quantity"], ["updatedAt", "Updated"], ["warehouseId", "Warehouse"]]) {
    await q(`INSERT INTO eos_policy.object_fields (id,tenant_id,object_id,key,label,data_type,origin,created_by,updated_by)
             VALUES ($1,$2,'obj-sl',$3,$4,'TEXT','SYSTEM','owner','owner')`, [`fld-sl-${k}`, tenant.id, k, l]);
  }
  for (const roleKey of ["admin", "dispatcher", "operationsManager", "owner"]) {
    const { rows } = await q(`SELECT id FROM eos_policy.roles WHERE tenant_id=$1 AND key=$2`, [tenant.id, roleKey]);
    await q(`INSERT INTO eos_policy.role_object_permissions
               (id,tenant_id,role_id,object_id,can_create,can_read,can_edit,can_delete,created_by,updated_by)
             VALUES ($1,$2,$3,'obj-sl',false,true,false,false,'owner','owner')`,
    [`rop-sl-${roleKey}`, tenant.id, rows[0].id]);
  }

  const counts = async () => Object.fromEntries((await q(`
    SELECT 'objects' k, count(*)::int n FROM eos_policy.objects UNION ALL
    SELECT 'object_fields', count(*)::int FROM eos_policy.object_fields UNION ALL
    SELECT 'role_object_permissions', count(*)::int FROM eos_policy.role_object_permissions UNION ALL
    SELECT 'field_overrides', count(*)::int FROM eos_policy.role_field_permission_overrides UNION ALL
    SELECT 'capabilities', count(*)::int FROM eos_policy.capabilities UNION ALL
    SELECT 'role_capabilities', count(*)::int FROM eos_policy.role_capabilities UNION ALL
    SELECT 'warehouses', count(*)::int FROM eos_ops.warehouses UNION ALL
    SELECT 'bins', count(*)::int FROM eos_ops.bins UNION ALL
    SELECT 'operational_scopes', count(*)::int FROM eos_workforce.employee_operational_scopes`)).rows.map((r) => [r.k, Number(r.n)]));

  const before = await counts();

  await t.test("the migration refuses when the census does not match", async () => {
    // One extra field makes this a different database from the one that was reviewed.
    await q(`INSERT INTO eos_policy.object_fields (id,tenant_id,object_id,key,label,data_type,origin,created_by,updated_by)
             VALUES ('fld-sl-extra',$1,'obj-sl','unexpected','Unexpected','TEXT','SYSTEM','owner','owner')`, [tenant.id]);
    assert.throws(() => migrate(dbUrl, ["up", "1"]), /subordinate metadata|7 fields/);
    const still = await q(`SELECT count(*)::int n FROM eos_policy.objects WHERE key='stockLocation'`);
    assert.equal(still.rows[0].n, 1, "a refused migration changes nothing");
    await q(`DELETE FROM eos_policy.object_fields WHERE id='fld-sl-extra'`);
  });

  await t.test("it removes exactly the reviewed policy rows", async () => {
    migrate(dbUrl, ["up", "1"]);
    const after = await counts();
    assert.equal(after.objects, before.objects - 1, "one Object");
    assert.equal(after.object_fields, before.object_fields - 6, "six field rows");
    assert.equal(after.role_object_permissions, before.role_object_permissions - 4, "four CRED rows");
    assert.equal(after.field_overrides, before.field_overrides, "no overrides existed");
    const gone = await q(`SELECT count(*)::int n FROM eos_policy.objects WHERE key='stockLocation'`);
    assert.equal(gone.rows[0].n, 0);
  });

  await t.test("no capability, no grant and NO BUSINESS DATA moved", async () => {
    const after = await counts();
    for (const k of ["capabilities", "role_capabilities", "warehouses", "bins", "operational_scopes"]) {
      assert.equal(after[k], before[k], `${k} must be untouched`);
    }
  });

  await t.test("the down migration does not recreate the retired Object", () => {
    // FORWARD_CORRECTION_REQUIRED as a NO-OP, not a refusal: this migration has no DDL, so there is
    // nothing to restore, and an unconditional refusal would make the whole set irreversible for
    // databases where the up never had a row to remove.
    migrate(dbUrl, ["down", "1"]);
    return q(`SELECT count(*)::int n FROM eos_policy.objects WHERE key='stockLocation'`)
      .then((r) => assert.equal(r.rows[0].n, 0, "the retired Object stays retired"));
  });
});
