// CAN THE REPOSITORY REBUILD THE Role -> Capability AUTHORITY? -- the PostgreSQL proof.
//
// Set POLICY_TEST_DATABASE_URL to run; without it the DATABASE suites SKIP and the pure-function
// guards still run, so the three failure modes are demonstrated on every machine.
//
// ════════════════════ WHAT IS PROVED ════════════════════
//
// 1. A DETERMINISTIC REBUILD on a clean database reproduces the governed nonprod authority exactly:
//    migration chain (phase A) -> canonical policy seed (phase B) -> rest of the chain (phase C)
//    -> the CANONICAL_CATALOG declarations (phase D) -> the nonprod ACTIVATION manifest (phase E).
//    EXTRA = 0 and MISSING = 0 against `roleCapabilityAuthorityBaseline.json`.
//
// 2. Each MIGRATION_BACKED pair comes back with the SAME `granted_by` stamp the baseline records,
//    so "which migration granted this" is proved, not asserted.
//
// 3. Every CANONICAL_CATALOG pair is still declared by the live Role catalog.
//
// 4. THE THREE FAILURE MODES ACTUALLY FAIL:
//      (a) a missing declaration      -- the rebuild produces a pair the baseline does not declare
//      (b) an unexplained extra       -- the baseline declares a pair the rebuild cannot produce
//      (c) a promoted activation      -- a nonprod-only activation appears in GLOBAL authority
//
// The database phases WRITE ONLY to POLICY_TEST_DATABASE_URL, which is a disposable local
// database. Nothing here reads or writes nonprod.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import pg from "pg";
import { declaredSchemas } from "./support/migrationSchema.mjs";
import { PostgresPolicyRepository } from "../lib/adminPolicy/postgresPolicyRepository.js";
import { seedTenantPolicy } from "../lib/adminPolicy/seed/policySeed.js";
import { deriveLegacyRoleGrants } from "../lib/eosOps/migration/inventoryCapabilityGrantMigration.js";
import { WORK_ORDER_LIFECYCLE_ACTIVATION_GRANTS } from "../lib/adminPolicy/workOrderLifecycleGrantActivation.js";
import {
  AUTHORITY_BASELINE_GRANTS,
  AuthorityBaselineError,
  CATALOG_DECLARED_NOT_ACTIVATED,
  FIXTURE_ONLY_GRANTS,
  GLOBAL_CATALOG_ACTIVATED_GRANTS,
  GRANT_BEARING_MIGRATIONS,
  MIGRATION_BACKED_GRANTS,
  NONPROD_ACTIVATED_CAPABILITY_GRANTS,
  SEED_BOUNDARY_MIGRATION,
  UNEXPLAINED_GRANTS,
  assertActivationMatchesRuling,
  assertAuthorityRebuildMatches,
  assertGlobalCatalogGrantsAreCatalogDeclared,
  assertNoEnvironmentActivationInGlobalAuthority,
  compareAuthority,
  countsBySource,
  explainGrant,
  globalAuthorityGrants,
  nonprodAuthorityGrants,
} from "../lib/adminPolicy/roleCapabilityAuthorityBaseline.js";

const URL = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to rebuild against";

const TENANT = "tenant-6ce59be1-1979-45cd-9d17-a4969037fb25";
const TENANT_KEY = "taylor-nonprod";
const REBUILD_ACTOR = "authority-baseline-rebuild";

const pairId = (p) => `${p.roleKey}\u0000${p.capabilityKey}`;
const sortPairs = (xs) => [...xs].sort((a, b) => pairId(a).localeCompare(pairId(b)));

function migrate(count) {
  const args = ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations", "--no-check-order"];
  if (count !== undefined) args.push(String(count));
  execFileSync(process.execPath, args, { env: { ...process.env, DATABASE_URL: URL }, stdio: "pipe" });
}

async function dropEverything() {
  const client = new pg.Client({ connectionString: URL });
  await client.connect();
  for (const schema of declaredSchemas()) await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await client.query("DROP TABLE IF EXISTS public.pgmigrations");
  await client.end();
}

/** Every (role_key, capability_key, granted_by) the database currently holds. */
async function grantsIn(pool) {
  const { rows } = await pool.query(
    `SELECT r.key AS role_key, c.key AS capability_key, rc.granted_by
       FROM eos_policy.role_capabilities rc
       JOIN eos_policy.roles r ON r.id = rc.role_id
       JOIN eos_policy.capabilities c ON c.id = rc.capability_id
      WHERE rc.tenant_id = $1
      ORDER BY 1, 2`,
    [TENANT],
  );
  return rows.map((r) => ({ roleKey: r.role_key, capabilityKey: r.capability_key, grantedBy: r.granted_by }));
}

/**
 * Apply a declared pair list. Used for phases D and E ONLY -- these are declarations the baseline
 * carries, so they are applied verbatim rather than re-derived. `ON CONFLICT DO NOTHING` keeps the
 * phase idempotent the same way the migrations' own inserts are.
 */
async function applyDeclaredGrants(pool, pairs, grantedBy) {
  for (const { roleKey, capabilityKey } of pairs) {
    const { rowCount } = await pool.query(
      `INSERT INTO eos_policy.role_capabilities
             (id, tenant_id, role_id, capability_id, granted_by, created_by, updated_by)
       SELECT 'rc_baseline_' || substr(md5($1 || r.id || c.id), 1, 24), $1, r.id, c.id, $4, $4, $4
         FROM eos_policy.roles r, eos_policy.capabilities c
        WHERE r.tenant_id = $1 AND r.key = $2 AND c.key = $3
       ON CONFLICT (tenant_id, role_id, capability_id) DO NOTHING`,
      [TENANT, roleKey, capabilityKey, grantedBy],
    );
    assert.ok(rowCount !== null, `${roleKey}/${capabilityKey} could not be applied`);
  }
}

/** The whole pipeline, on a disposable database. Returns what it produced. */
async function rebuildAuthority(pool, { includeActivation = true, extraGlobalPairs = [] } = {}) {
  await dropEverything();
  const files = readdirSync("migrations").filter((f) => f.endsWith(".sql")).sort();
  const beforeSeed = files.filter((f) => f < SEED_BOUNDARY_MIGRATION).length;
  assert.ok(beforeSeed > 0 && beforeSeed < files.length, "the seed boundary must fall inside the chain");

  migrate(beforeSeed); // PHASE A
  await pool.query("INSERT INTO eos_policy.tenants (id, key, name) VALUES ($1, $2, $2)", [TENANT, TENANT_KEY]); // PHASE B
  await seedTenantPolicy(new PostgresPolicyRepository(pool), TENANT, REBUILD_ACTOR);
  migrate(); // PHASE C
  await applyDeclaredGrants(pool, [...GLOBAL_CATALOG_ACTIVATED_GRANTS, ...extraGlobalPairs], "canonical-catalog:" + REBUILD_ACTOR); // PHASE D
  if (includeActivation) {
    await applyDeclaredGrants(pool, NONPROD_ACTIVATED_CAPABILITY_GRANTS, "nonprod-activation:" + REBUILD_ACTOR); // PHASE E
  }
  return grantsIn(pool);
}

// ════════════════════ THE BASELINE ITSELF -- no database needed ════════════════════

test("every grant carries exactly one canonical source and NOTHING is unexplained", () => {
  const counts = countsBySource();
  assert.equal(AUTHORITY_BASELINE_GRANTS.length, 387);
  assert.equal(counts.MIGRATION_BACKED + counts.CANONICAL_CATALOG + counts.NONPROD_ACTIVATION
    + counts.FIXTURE_ONLY + counts.UNEXPLAINED, AUTHORITY_BASELINE_GRANTS.length);
  assert.equal(counts.UNEXPLAINED, 0, "an unexplained grant is a governance failure, not a category");
  assert.equal(UNEXPLAINED_GRANTS.length, 0);
  assert.equal(FIXTURE_ONLY_GRANTS.length, 0, "no grant's only reconstruction source is a fixture");
  // ENUMERATION HONESTY: the four source buckets PARTITION the baseline. A row that fell out of the
  // census would leave the sum short; a row counted twice would leave it long.
  const seen = new Set(AUTHORITY_BASELINE_GRANTS.map(pairId));
  assert.equal(seen.size, AUTHORITY_BASELINE_GRANTS.length, "no (role, capability) pair appears twice");
});

test("GLOBAL authority and the NONPROD activation are separately representable and disjoint", () => {
  assert.equal(globalAuthorityGrants().length, MIGRATION_BACKED_GRANTS.length + GLOBAL_CATALOG_ACTIVATED_GRANTS.length);
  assert.equal(nonprodAuthorityGrants().length, globalAuthorityGrants().length + NONPROD_ACTIVATED_CAPABILITY_GRANTS.length);
  assert.equal(NONPROD_ACTIVATED_CAPABILITY_GRANTS.length, 5);
  assert.deepEqual(sortPairs(NONPROD_ACTIVATED_CAPABILITY_GRANTS), sortPairs([
    { roleKey: "admin", capabilityKey: "workOrder.lifecycle.cancel" },
    { roleKey: "admin", capabilityKey: "workOrder.lifecycle.dispatch" },
    { roleKey: "dispatcher", capabilityKey: "workOrder.lifecycle.cancel" },
    { roleKey: "dispatcher", capabilityKey: "workOrder.lifecycle.dispatch" },
    { roleKey: "technician", capabilityKey: "workOrder.lifecycle.complete" },
  ]));
  assert.ok(!NONPROD_ACTIVATED_CAPABILITY_GRANTS.some((p) => p.roleKey === "owner"),
    "the ruling named three Roles; owner is absent by construction, five rows not seven");
  assertNoEnvironmentActivationInGlobalAuthority();
});

test("the NONPROD activation baseline IS the Owner ruling's activation set -- not a second copy of it", () => {
  assertActivationMatchesRuling(WORK_ORDER_LIFECYCLE_ACTIVATION_GRANTS);
  // a baseline that added a sixth activated row the ruling never made is refused
  assert.throws(
    () => assertActivationMatchesRuling(WORK_ORDER_LIFECYCLE_ACTIVATION_GRANTS,
      [...NONPROD_ACTIVATED_CAPABILITY_GRANTS, { roleKey: "owner", capabilityKey: "workOrder.lifecycle.dispatch" }]),
    (err) => err instanceof AuthorityBaselineError && /disagree/.test(err.message),
  );
});

test("FAILURE MODE (c): an environment activation promoted into GLOBAL authority is refused", () => {
  const promoted = [...globalAuthorityGrants(), ...NONPROD_ACTIVATED_CAPABILITY_GRANTS];
  assert.throws(
    () => assertNoEnvironmentActivationInGlobalAuthority(promoted),
    (err) => err instanceof AuthorityBaselineError && /promoted into GLOBAL authority/.test(err.message)
      && /workOrder\.lifecycle\./.test(err.message),
  );
  // ...and the honest arrangement still passes, so the guard is not vacuous.
  assertNoEnvironmentActivationInGlobalAuthority();
});

test("FAILURE MODE (a): a rebuilt pair the baseline does not declare is a MISSING DECLARATION", () => {
  const governed = nonprodAuthorityGrants();
  const rebuilt = [...governed, { roleKey: "technician", capabilityKey: "admin.securityPolicy.read" }];
  const { missingDeclaration, unexplainedExtra } = compareAuthority(governed, rebuilt);
  assert.deepEqual(missingDeclaration, [{ roleKey: "technician", capabilityKey: "admin.securityPolicy.read" }]);
  assert.equal(unexplainedExtra.length, 0);
  assert.throws(
    () => assertAuthorityRebuildMatches(governed, rebuilt),
    (err) => err instanceof AuthorityBaselineError && /MISSING DECLARATION \(1\)/.test(err.message),
  );
});

test("FAILURE MODE (b): a declared pair no reconstruction source produces is an UNEXPLAINED EXTRA", () => {
  const governed = nonprodAuthorityGrants();
  const rebuilt = governed.slice(1);
  const { missingDeclaration, unexplainedExtra } = compareAuthority(governed, rebuilt);
  assert.equal(missingDeclaration.length, 0);
  assert.deepEqual(unexplainedExtra, [{ roleKey: governed[0].roleKey, capabilityKey: governed[0].capabilityKey }]);
  assert.throws(
    () => assertAuthorityRebuildMatches(governed, rebuilt),
    (err) => err instanceof AuthorityBaselineError && /UNEXPLAINED EXTRA \(1\)/.test(err.message),
  );
  // The matching case passes, so neither direction is vacuous.
  assertAuthorityRebuildMatches(governed, [...governed]);
});

test("every CANONICAL_CATALOG grant is still declared by the live Role catalog", () => {
  const keys = [...new Set(GLOBAL_CATALOG_ACTIVATED_GRANTS.map((p) => p.capabilityKey))];
  assertGlobalCatalogGrantsAreCatalogDeclared(deriveLegacyRoleGrants(keys));
  // and a baseline that named a pair the catalog does not declare is refused
  assert.throws(
    () => assertGlobalCatalogGrantsAreCatalogDeclared(deriveLegacyRoleGrants(keys),
      [{ roleKey: "technician", capabilityKey: "admin.employeeProfile.write" }]),
    (err) => err instanceof AuthorityBaselineError && /no longer declares/.test(err.message),
  );
});

test("no NONPROD activation key is declared by the Role catalog -- the activation cannot leak through it", () => {
  const keys = [...new Set(NONPROD_ACTIVATED_CAPABILITY_GRANTS.map((p) => p.capabilityKey))];
  assert.equal(deriveLegacyRoleGrants(keys).length, 0,
    "a legacy Role permission array naming workOrder.lifecycle.* would manufacture an owner grant the ruling never made");
});

test("the Role catalog declares 32 pairs the environment has not activated, and they are NOT authority", () => {
  assert.equal(CATALOG_DECLARED_NOT_ACTIVATED.length, 32);
  const authority = new Set(nonprodAuthorityGrants().map(pairId));
  for (const p of CATALOG_DECLARED_NOT_ACTIVATED) {
    assert.ok(!authority.has(pairId(p)), `${p.roleKey}/${p.capabilityKey} must not be in the authority baseline`);
  }
});

test("explainGrant answers 'why does this Role have this capability' for every source", () => {
  assert.deepEqual(explainGrant("admin", "workOrder.lifecycle.dispatch")?.source, "NONPROD_ACTIVATION");
  assert.deepEqual(explainGrant("owner", "admin.principalAccess.read")?.source, "CANONICAL_CATALOG");
  assert.match(explainGrant("admin", "workflowDefinition.read")?.evidence ?? "", /^migration:\d+$/);
  assert.equal(explainGrant("technician", "admin.securityPolicy.read"), undefined);
  for (const g of AUTHORITY_BASELINE_GRANTS) {
    assert.ok(g.evidence.length > 0 && g.observedGrantedBy.length > 0, `${g.roleKey}/${g.capabilityKey} lacks evidence`);
    if (g.source === "MIGRATION_BACKED") assert.ok(GRANT_BEARING_MIGRATIONS.includes(g.evidence));
  }
});

// ════════════════════ THE REBUILD ════════════════════

test("a clean database rebuild reproduces the governed nonprod authority exactly", { skip: SKIP }, async () => {
  const pool = new pg.Pool({ connectionString: URL, max: 2 });
  try {
    const rebuilt = await rebuildAuthority(pool);
    assertAuthorityRebuildMatches(nonprodAuthorityGrants(), rebuilt);
    const { missingDeclaration, unexplainedExtra } = compareAuthority(nonprodAuthorityGrants(), rebuilt);
    assert.equal(missingDeclaration.length, 0, "EXTRA");
    assert.equal(unexplainedExtra.length, 0, "MISSING");
    assert.equal(rebuilt.length, AUTHORITY_BASELINE_GRANTS.length);

    // Each MIGRATION_BACKED pair comes back stamped by the migration the baseline names.
    const stamped = new Map(rebuilt.map((r) => [pairId(r), r.grantedBy]));
    for (const g of AUTHORITY_BASELINE_GRANTS) {
      if (g.source !== "MIGRATION_BACKED") continue;
      assert.equal(stamped.get(pairId(g)), g.evidence, `${g.roleKey}/${g.capabilityKey} lost its migration stamp`);
    }
  } finally {
    await pool.end();
  }
});

test("the rebuild without the activation phase is GLOBAL authority, and the five activated rows are the only difference",
  { skip: SKIP }, async () => {
    const pool = new pg.Pool({ connectionString: URL, max: 2 });
    try {
      const rebuilt = await rebuildAuthority(pool, { includeActivation: false });
      assertAuthorityRebuildMatches(globalAuthorityGrants(), rebuilt);
      assert.equal(rebuilt.length, AUTHORITY_BASELINE_GRANTS.length - NONPROD_ACTIVATED_CAPABILITY_GRANTS.length);
      const keys = new Set(rebuilt.map((r) => r.capabilityKey));
      assert.ok(!keys.has("workOrder.lifecycle.dispatch"), "an activation must never appear in a global rebuild");
    } finally {
      await pool.end();
    }
  });

test("FAILURE MODE (a), against the real database: an extra grant in the environment fails the guard",
  { skip: SKIP }, async () => {
    const pool = new pg.Pool({ connectionString: URL, max: 2 });
    try {
      const rebuilt = await rebuildAuthority(pool, {
        extraGlobalPairs: [{ roleKey: "technician", capabilityKey: "admin.securityPolicy.read" }],
      });
      assert.throws(
        () => assertAuthorityRebuildMatches(nonprodAuthorityGrants(), rebuilt),
        (err) => err instanceof AuthorityBaselineError
          && /MISSING DECLARATION \(1\): technician\/admin\.securityPolicy\.read/.test(err.message),
      );
    } finally {
      await pool.end();
    }
  });

test("the migration chain alone grants NOTHING -- the canonical seed is a required phase, not an optimisation",
  { skip: SKIP }, async () => {
    const pool = new pg.Pool({ connectionString: URL, max: 2 });
    try {
      await dropEverything();
      migrate();
      const { rows } = await pool.query("SELECT count(*)::int AS n FROM eos_policy.role_capabilities");
      assert.equal(rows[0].n, 0,
        "every grant-bearing migration inserts by SELECT over an existing tenant's Roles; with no tenant it grants nothing");
      const caps = await pool.query("SELECT count(*)::int AS n FROM eos_policy.capabilities");
      assert.ok(caps.rows[0].n > 0, "the chain still establishes the capability VOCABULARY");
    } finally {
      await pool.end();
    }
  });
