// CRED VOCABULARY AND DETERMINISTIC GRANT PRESERVATION, against a real postgres:16.
//
// The migration under test preserves an EXISTING authorization decision; it does not make a new one.
// So the test runs it the way it will actually run: migrate, SEED (which is what writes the stored
// CRED rows), then apply the preservation migration on top and check that what came across is
// exactly what the CRED rows said -- no more.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");
const { bootstrapTenant } = require("../lib/adminPolicy/tenantBootstrap.js");
const {
  measureCredEquivalence, CRED_POLICY_DECISION_CELLS, SEMANTIC_REPLACEMENTS, COMPARABLE_CRED_KINDS,
} = require("../lib/adminPolicy/migration/credEquivalence.js");

const MIGRATION = "1761523200000_cred-capability-vocabulary-and-grant-preservation";
const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}
const migrate = (dbUrl, args) => execFileSync(process.execPath,
  ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", ...args, "--migrations-dir", "migrations", "--no-check-order"],
  { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrl }, stdio: "pipe" });

test("the comparator compares CRED, and only CRED", () => {
  assert.deepEqual([...COMPARABLE_CRED_KINDS].sort(), ["CREATE", "DELETE", "EDIT", "READ"]);
  for (const notCred of ["BUSINESS_ACTION", "ADMIN_ACTION"]) {
    assert.equal(COMPARABLE_CRED_KINDS.has(notCred), false,
      `${notCred} must never satisfy a CRED verb`);
  }
  // The two the Owner named explicitly.
  assert.ok(SEMANTIC_REPLACEMENTS["workOrder.E"], "workOrder.E is a governed transition, not a generic edit");
  assert.equal("workOrder.D" in SEMANTIC_REPLACEMENTS, false, "no Work Order delete exists to replace");
});

test("no fake DELETE capability is introduced", () => {
  const sql = require("node:fs").readFileSync(resolve(FUNCTIONS_DIR, `migrations/${MIGRATION}.sql`), "utf8");
  const up = sql.split("-- Down Migration")[0].replace(/^\s*--.*$/gm, "");
  assert.equal(/'DELETE'/.test(up), false, "the migration registers no DELETE capability");
  // And nothing generic-edit for a command-governed record.
  for (const f of ["'workOrder', 'edit'", "'invoice', 'edit'", "'transferOrder', 'edit'"]) {
    assert.equal(up.includes(f), false, `${f} would bypass the governed action`);
  }
});

test("CRED convergence, in PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `credconv_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  const dbUrl = dbUrlFor(name);
  migrate(dbUrl, ["up"]);

  // REVERSE the preservation migration, seed, then re-apply it. The seed is what writes the stored
  // CRED rows, and it runs after migrations in every real environment -- so applying the migration
  // to an empty table would prove nothing about preservation.
  migrate(dbUrl, ["down", "1"]);
  pool = new pg.Pool({ connectionString: dbUrl, max: 6 });
  const repo = new PostgresPolicyRepository(pool);
  const { tenant } = await bootstrapTenant(repo, { key: "taylor-cred", name: "Taylor", actorUid: "operator" });

  const before = (await pool.query("SELECT count(*)::int n FROM eos_policy.role_capabilities")).rows[0].n;
  const credRows = (await pool.query("SELECT count(*)::int n FROM eos_policy.role_object_permissions")).rows[0].n;
  assert.ok(credRows > 0, "the seed wrote stored CRED to preserve");
  migrate(dbUrl, ["up", "1"]);
  const after = (await pool.query("SELECT count(*)::int n FROM eos_policy.role_capabilities")).rows[0].n;

  await t.test("the vocabulary gains exactly the eight measured CRED reads", async () => {
    const { rows } = await pool.query(
      `SELECT key, object_key, action_key, action_kind, display_label FROM eos_policy.capabilities
        WHERE id LIKE 'cap_%' AND action_kind = 'READ' ORDER BY key`);
    for (const k of ["inventory.catalog.read", "inventory.transaction.read", "inventory.action.read",
      "inventory.serializedAsset.read", "warehouse.transferOrder.read", "warehouse.record.read",
      "equipment.compatibility.view", "audit.event.read"]) {
      const row = rows.find((r) => r.key === k);
      assert.ok(row, `${k} must be registered`);
      assert.ok(row.object_key && row.action_key && row.display_label, `${k} needs full metadata`);
      assert.equal(row.action_kind, "READ");
      assert.notEqual(row.display_label, row.key, "a friendly label, not the key");
    }
    const total = (await pool.query("SELECT count(*)::int n FROM eos_policy.capabilities")).rows[0].n;
    assert.equal(total, 57, "49 + 8");
  });

  await t.test("every preserved grant is backed by an actual stored CRED row", async () => {
    assert.ok(after > before, `preservation wrote grants (${before} -> ${after})`);
    // EXACTNESS, in the direction that matters: every row this migration wrote must correspond to a
    // stored CRED row for the SAME Role, on the SAME Object, for the SAME verb. A grant that cannot
    // be traced back to the authority it claims to preserve is an invention.
    const { rows } = await pool.query(`
      SELECT c.key, r.key AS role_key
        FROM eos_policy.role_capabilities rc
        JOIN eos_policy.capabilities c ON c.id = rc.capability_id
        JOIN eos_policy.roles r ON r.id = rc.role_id
       WHERE rc.granted_by = 'migration:1761523200000'
         AND NOT EXISTS (
           SELECT 1 FROM eos_policy.role_object_permissions rop
             JOIN eos_policy.objects o ON o.id = rop.object_id
            WHERE rop.role_id = rc.role_id AND o.key = c.object_key
              AND CASE c.action_kind WHEN 'CREATE' THEN rop.can_create
                                     WHEN 'READ'   THEN rop.can_read
                                     WHEN 'EDIT'   THEN rop.can_edit ELSE FALSE END)`);
    assert.deepEqual(rows, [], "every preserved grant traces to its CRED evidence");
  });

  await t.test("no business or admin action was granted from generic CRED", async () => {
    const { rows } = await pool.query(`
      SELECT c.key FROM eos_policy.role_capabilities rc
        JOIN eos_policy.capabilities c ON c.id = rc.capability_id
       WHERE rc.granted_by = 'migration:1761523200000'
         AND c.action_kind NOT IN ('CREATE', 'READ', 'EDIT', 'DELETE')`);
    assert.deepEqual(rows, [], "CRED evidence may only produce CRED grants");
  });

  await t.test("the deferred decisions stay deferred", async () => {
    const { rows } = await pool.query(`
      SELECT c.key, count(rc.role_id)::int AS grants
        FROM eos_policy.capabilities c
        LEFT JOIN eos_policy.role_capabilities rc ON rc.capability_id = c.id
       WHERE c.key LIKE 'workOrder.lifecycle.%' OR c.key LIKE 'workflowDefinition.%'
       GROUP BY c.key ORDER BY c.key`);
    assert.equal(rows.length, 9, "three lifecycle + six workflow");
    for (const r of rows) assert.equal(r.grants, 0, `${r.key} must remain ungranted`);
  });

  await t.test("no direct Principal grant was manufactured", async () => {
    const { rows } = await pool.query("SELECT count(*)::int n FROM eos_policy.principal_capabilities");
    assert.equal(rows[0].n, 0, "there were none to migrate and none were invented");
  });

  await t.test("the field doorway is untouched", async () => {
    const { rows } = await pool.query(
      `SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='eos_policy'
        AND table_name IN ('role_object_permissions','role_field_permission_overrides')`);
    assert.equal(rows[0].n, 2, "both CRED tables survive -- role_object_permissions stays ACTIVE");
    const src = require("node:fs").readFileSync(resolve(FUNCTIONS_DIR, "src/adminPolicy/effectiveObjectAccess.ts"), "utf8");
    assert.ok(/A field grant NEVER opens an object the Role cannot read/i.test(src));
  });

  await t.test("equivalence is re-measured with CRED-only semantics", async () => {
    const [objects, capabilities, roles, roleCaps, principalCaps] = await Promise.all([
      repo.listObjects(tenant.id), repo.listCapabilities(), repo.listRoles(tenant.id),
      repo.listRoleCapabilities(tenant.id), repo.listPrincipalCapabilities(tenant.id),
    ]);
    const objectPermissions = await repo.listObjectPermissions(tenant.id, roles.map((r) => r.id));
    const byRole = new Map();
    for (const p of objectPermissions) {
      if (!byRole.has(p.roleId)) byRole.set(p.roleId, []);
      byRole.get(p.roleId).push(p);
    }
    // One synthetic principal per Role: the comparison is about what a ROLE conveys, and pairing
    // each Role with a holder measures every stored CRED row exactly once.
    const principals = roles.map((r) => ({ principalId: `synthetic:${r.key}`, roleIds: [r.id] }));
    // The legacy matrix's own opinion, read from each Object's capabilitiesByVerb.
    const snapshot = JSON.parse(require("node:fs").readFileSync(
      resolve(FUNCTIONS_DIR, "src/adminPolicy/seed/policySeedSnapshot.json"), "utf8"));
    const legacyGovernedVerbs = new Map(snapshot.objects.map((o) => [o.key,
      new Set(["C", "R", "E", "D"].filter((v) => (o.capabilitiesByVerb?.[v] ?? []).length > 0))]));
    const report = measureCredEquivalence({
      principals, legacyGovernedVerbs,
      objectKeyById: new Map(objects.map((o) => [o.id, o.key])),
      objectPermissions: objectPermissions.map((p) => ({ roleId: p.roleId, objectId: p.objectId, cred: p.cred })),
      capabilities,
      roleCapabilities: roleCaps.map((g) => ({ roleId: g.roleId, capabilityId: g.capabilityId })),
      principalCapabilities: principalCaps.map((g) => ({ principalId: g.principalId, capabilityId: g.capabilityId })),
    }, new Set(Object.keys(CRED_POLICY_DECISION_CELLS)));

    console.log(`    AFTER: comparable=${report.totalComparableCells} equivalent=${report.equivalent} `
      + `missing=${report.missingInTarget} extra=${report.extraInTarget} ungoverned=${report.ungovernedInTarget} `
      + `semanticReplacement=${report.semanticReplacement} policyDecisionRequired=${report.policyDecisionRequired} `
      + `cutoverSafe=${report.cutoverSafe}`);
    const worst = {};
    for (const r of report.rows) {
      if (r.verdict === "equivalent" || r.verdict === "semanticReplacement") continue;
      worst[`${r.objectKey}.${r.verb}:${r.verdict}`] = (worst[`${r.objectKey}.${r.verb}:${r.verdict}`] ?? 0) + 1;
    }
    for (const [k, v] of Object.entries(worst).sort((a, b) => b[1] - a[1]).slice(0, 14)) {
      console.log(`      ${k} ${v}`);
    }
    assert.equal(report.conflict, report.missingInTarget + report.extraInTarget);
    // The gate is honest about its own answer: cutoverSafe is a MEASUREMENT, never an assertion.
    assert.equal(typeof report.cutoverSafe, "boolean");
    assert.equal(report.semanticReplacement > 0, true, "governed replacements are reported, not scored");
  });
});
