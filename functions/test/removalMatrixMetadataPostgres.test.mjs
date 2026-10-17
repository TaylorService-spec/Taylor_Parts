// THE REMOVAL-MATRIX GATE, PROVED AGAINST POSTGRESQL (field permissions PR 1 -- tests only).
//
// removalMatrixGate.test.mjs is offline: Role grants from roleCapabilityAuthorityBaseline.json and the recorded delta
// modules, and protected Administrator standing from CAPABILITY_METADATA (support/removalMatrix.mjs). This suite closes
// the two premises that file cannot check by itself, on a disposable database built the way the authority baseline is rebuilt
// (phases A-E: migrate to the seed boundary, seed, migrate the rest, CANONICAL_CATALOG, NONPROD_ACTIVATION):
//   1. every EXISTING spec key is registered with exactly the pinned object_key / action_key / action_kind (the
//      action_key is how a delta operation names it), and every PROPOSED key is still unregistered (a deliberate re-pin);
//   2. the Roles holding each spec key in eos_policy.role_capabilities are exactly the pin's baseline + baseline
//      activation Roles (the delta modules are applied through the Administration API, which this rebuild does not do).
// Set POLICY_TEST_DATABASE_URL (a base URL; the suite creates and drops its own database); without it the suite SKIPS.
import { endPoolAndDrain } from "./support/poolTeardown.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { CAPABILITY_METADATA, PIN_PATH, specKeys } from "./support/removalMatrix.mjs";

const require = createRequire(import.meta.url);
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");
const { seedTenantPolicy } = require("../lib/adminPolicy/seed/policySeed.js");
const baseline = require("../lib/adminPolicy/roleCapabilityAuthorityBaseline.js");

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const TENANT = "t-removal-matrix";

async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

test("the removal-matrix pin agrees with a rebuilt PostgreSQL authority", { skip: SKIP, concurrency: false }, async (t) => {
  const name = `rmxmeta_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const url = (() => { const u = new URL(URL_BASE); u.pathname = `/${name}`; return u.toString(); })();
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  let pool;
  t.after(async () => {
    await endPoolAndDrain(pool);
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  const migrate = (count) => execFileSync(process.execPath, [
    "node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations", "--no-check-order",
    ...(count === undefined ? [] : [String(count)]),
  ], { maxBuffer: 256 * 1024 * 1024, cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });

  const files = readdirSync(resolve(FUNCTIONS_DIR, "migrations")).filter((f) => f.endsWith(".sql")).sort();
  migrate(files.filter((f) => f < baseline.SEED_BOUNDARY_MIGRATION).length);
  pool = new pg.Pool({ connectionString: url, max: 4 });
  const q = (sql, v = []) => pool.query(sql, v);
  await q(`INSERT INTO eos_policy.tenants (id,key,name) VALUES ($1,$1,$1)`, [TENANT]);
  await seedTenantPolicy(new PostgresPolicyRepository(pool), TENANT, "removal-matrix-rebuild");
  migrate();
  for (const pairs of [baseline.GLOBAL_CATALOG_ACTIVATED_GRANTS, baseline.NONPROD_ACTIVATED_CAPABILITY_GRANTS]) {
    for (const { roleKey, capabilityKey } of pairs) {
      await q(`INSERT INTO eos_policy.role_capabilities (id,tenant_id,role_id,capability_id,granted_by,created_by,updated_by)
               SELECT 'rc_' || substr(md5($1 || r.id || c.id), 1, 24), $1, r.id, c.id, 'rebuild', 'rebuild', 'rebuild'
                 FROM eos_policy.roles r, eos_policy.capabilities c WHERE r.tenant_id = $1 AND r.key = $2 AND c.key = $3
               ON CONFLICT (tenant_id, role_id, capability_id) DO NOTHING`, [TENANT, roleKey, capabilityKey]);
    }
  }

  const { existing, proposed } = specKeys();
  const registered = (await q(`SELECT key, object_key, action_key, action_kind FROM eos_policy.capabilities WHERE key = ANY($1::text[]) ORDER BY key`,
    [[...existing, ...proposed]])).rows;
  assert.deepEqual(
    registered.map((r) => [r.key, { objectKey: r.object_key, actionKey: r.action_key, actionKind: r.action_kind }]),
    existing.map((k) => [k, { ...CAPABILITY_METADATA[k] }]),
    "every existing spec key is registered exactly as pinned, and no proposed key is registered yet");

  const pin = JSON.parse(readFileSync(PIN_PATH, "utf8"));
  const held = (await q(`SELECT c.key, r.key AS role_key FROM eos_policy.role_capabilities rc
                           JOIN eos_policy.roles r ON r.id = rc.role_id JOIN eos_policy.capabilities c ON c.id = rc.capability_id
                          WHERE rc.tenant_id = $1 AND c.key = ANY($2::text[]) ORDER BY c.key, r.key`, [TENANT, existing])).rows;
  for (const key of existing) {
    const expected = [...new Set([...pin.keys[key].baselineRoles, ...pin.keys[key].baselineNonprodActivationRoles])].sort();
    assert.deepEqual(held.filter((h) => h.key === key).map((h) => h.role_key), expected, `${key}: Role holders in PostgreSQL == the pin`);
  }
});
