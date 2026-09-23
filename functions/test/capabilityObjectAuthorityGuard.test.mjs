// EVERY CANONICAL CAPABILITY OBJECT KEY MUST RESOLVE TO A GOVERNED OBJECT.
//
// ════════════════════ WHY THIS EXISTS ════════════════════
//
// A nonprod activation was stopped by exactly this defect. Objects are TENANT-SCOPED ROWS written
// by the seed; capabilities are GLOBAL rows written by migrations. Nothing connected the two, so a
// migration could register `someObject.read` while no tenant had ever been given `someObject` --
// and it did: thirteen capabilities carrying eleven LIVE grants pointed at four Objects nonprod
// had never been seeded (cycleCount, dataImport, principal, workflowDefinition).
//
// Administration answers "who may do this to a Work Order" by reading eos_policy.objects. A
// capability naming an Object that is not there is invisible in the Object view and makes
// getObjectSecurityMatrix return NOT_FOUND -- so the grant exists and cannot be administered.
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
const { readFileSync: read } = require("node:fs");

const SNAPSHOT = JSON.parse(read(resolve(FUNCTIONS_DIR, "src/adminPolicy/seed/policySeedSnapshot.json"), "utf8"));
const SEED_OBJECT_KEYS = new Set(SNAPSHOT.objects.map((o) => o.key));

/**
 * Objects a real database may carry that the governed seed no longer declares.
 *
 * ONE entry, and it is Owner-retired: `stock_locations` was retired as an operational authority on
 * 2026-09-12 and its entity left the registry, but the ROW survives in databases seeded before
 * that. Removing it is a separate, evidenced metadata cleanup -- RETIRED_OBJECT_PENDING_METADATA_
 * CLEANUP -- not something an additive security activation may do, and NOT something the seed may
 * infer: a seed that deleted every Object missing from its snapshot would delete real configuration.
 */
// EMPTY as of migration 1761868800000, which retired the one entry. Kept as a named, empty list
// rather than deleted: the next Object the Owner retires will sit here while its cleanup is
// reviewed, and a database seeded before that retirement is not a defect.
const TOLERATED_STALE_DATABASE_OBJECTS = Object.freeze([]);

// ════════════════════ 1. SOURCE LEVEL ════════════════════

test("every capability a migration registers names an Object the governed catalog declares", () => {
  // Read from the MIGRATIONS, because that is where a capability is born. A future migration
  // introducing `newObject.someCapability` without registering `newObject` fails here, before it
  // can reach a database.
  const ACTION_KINDS = new Set(["CREATE", "READ", "EDIT", "DELETE", "BUSINESS_ACTION", "ADMIN_ACTION"]);
  const dir = resolve(FUNCTIONS_DIR, "migrations");
  const declared = new Map(); // object_key -> [capability keys]
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
    const up = read(resolve(dir, file), "utf8").split("-- Down Migration")[0].replace(/^\s*--.*$/gm, "");
    // ANCHORED ON THE ACTION KIND, which is a closed set of six literals. Both shapes the
    // migrations use put (object_key, action_key, action_kind) adjacent, and neither an object key
    // nor an action key contains a space or a quote -- so this cannot drift across row boundaries
    // the way a capability-key-first pattern did.
    for (const m of up.matchAll(/'([A-Za-z][A-Za-z0-9]*)',\s*'([A-Za-z][A-Za-z0-9]*)',\s*'(CREATE|READ|EDIT|DELETE|BUSINESS_ACTION|ADMIN_ACTION)'/g)) {
      const [, objectKey, actionKey] = m;
      // The action_kind CHECK constraint lists the six literals adjacently -- ('CREATE', 'READ',
      // 'EDIT', ...) -- which matches the same shape. A KIND is never an Object key, so skip it.
      if (ACTION_KINDS.has(objectKey)) continue;
      if (!declared.has(objectKey)) declared.set(objectKey, []);
      declared.get(objectKey).push(`${file}:${actionKey}`);
    }
  }
  assert.ok(declared.size >= 20, `the scan found only ${declared.size} Objects -- it has stopped matching`);
  const unregistered = [...declared.keys()].filter((k) => !SEED_OBJECT_KEYS.has(k)).sort();
  assert.deepEqual(unregistered, [],
    `a migration registers a capability on an Object the governed catalog does not declare: ${
      unregistered.map((k) => `${k} (${declared.get(k).join(", ")})`).join("; ")}`);
});

// ════════════════════ 2. DATABASE LEVEL ════════════════════

test("capability Object keys resolve through the real Administration repository", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `capobj_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
  const withClient = async (url, fn) => {
    const c = new pg.Client({ connectionString: url });
    await c.connect();
    try { return await fn(c); } finally { await c.end(); }
  };
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

  const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");
  const { bootstrapTenant } = require("../lib/adminPolicy/tenantBootstrap.js");
  const repo = new PostgresPolicyRepository(pool);
  const { tenant } = await bootstrapTenant(repo, { key: "t-capobj", name: "Guard", actorUid: "guard" });

  // THE ACTUAL READ MODEL, not two static arrays: this is the same call Administration makes.
  const objects = await repo.listObjects(tenant.id);
  const capabilities = await repo.listCapabilities();
  const objectKeys = new Set(objects.map((o) => o.key));

  await t.test("no capability is stranded", () => {
    const stranded = capabilities.filter((c) => !objectKeys.has(c.objectKey));
    assert.deepEqual(stranded.map((c) => `${c.key} -> ${c.objectKey}`).sort(), [],
      "a capability names an Object this tenant's Administration cannot project");
  });

  await t.test("every governed seed Object exists in the database", () => {
    const missing = [...SEED_OBJECT_KEYS].filter((k) => !objectKeys.has(k)).sort();
    assert.deepEqual(missing, [], "the seed declares an Object the database does not have");
  });

  await t.test("extra database Objects are reported, and only the tolerated stale one is allowed", () => {
    // Set equality is NOT required: a database seeded before an Object was retired keeps the row.
    const extra = [...objectKeys].filter((k) => !SEED_OBJECT_KEYS.has(k)).sort();
    for (const e of extra) {
      assert.ok(TOLERATED_STALE_DATABASE_OBJECTS.includes(e),
        `unexplained database Object "${e}" -- it is neither in the governed seed nor a known retired row`);
    }
    // A freshly seeded database has none at all; a real one may have stockLocation.
    assert.deepEqual(extra, [], "a fresh seed produces no extras");
  });

  await t.test("any tolerated stale Object stays unused by the capability model", () => {
    // Vacuous today, and deliberately kept: the tolerance is only ever legitimate for an Object the
    // governed seed has dropped AND no capability names.
    for (const stale of TOLERATED_STALE_DATABASE_OBJECTS) {
      assert.equal(SEED_OBJECT_KEYS.has(stale), false, `${stale} must stay out of the governed seed`);
      assert.deepEqual(capabilities.filter((c) => c.objectKey === stale), [],
        `${stale} still carries a canonical capability and cannot be treated as retired metadata`);
    }
    assert.equal(SEED_OBJECT_KEYS.has("stockLocation"), false,
      "stockLocation is retired and must never return to the governed seed");
  });
});
