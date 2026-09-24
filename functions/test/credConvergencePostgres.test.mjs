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
  SECURITY_POLICY_BLOCKERS, SCOPE_MODEL_BLOCKERS, DATA_AUTHORITY_MIGRATION_BLOCKERS,
  WITHHELD_PENDING_ELIGIBILITY_EVIDENCE, WORKFORCE_ELIGIBILITY_DATA_MIGRATION_BLOCKER,
} = require("../lib/adminPolicy/migration/credEquivalence.js");

const MIGRATION = "1761523200000_cred-capability-vocabulary-and-grant-preservation";
const MIGRATION_2 = "1761609600000_finance-administration-reorder-vocabulary";
const MIGRATION_3 = "1761696000000_parts-associate-eligibility-and-reorder-queue-scope.sql";
const MIGRATION_4 = "1761782400000_manufacturer-catalog-authority.sql";
// HOW FAR DOWN, COUNTED FROM THE MIGRATION UNDER TEST rather than pinned to a number. A literal
// step count silently means a different set of migrations the moment a new one lands.
const MIGRATIONS = require("node:fs")
  .readdirSync(resolve(FUNCTIONS_DIR, "migrations")).filter((f) => f.endsWith(".sql")).sort();
const STEPS_TO_MIGRATION = MIGRATIONS.length - MIGRATIONS.findIndex((f) => f.startsWith(MIGRATION));

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
  migrate(dbUrl, ["down", String(STEPS_TO_MIGRATION)]);
  pool = new pg.Pool({ connectionString: dbUrl, max: 6 });
  const repo = new PostgresPolicyRepository(pool);
  const { tenant } = await bootstrapTenant(repo, { key: "taylor-cred", name: "Taylor", actorUid: "operator" });

  const before = (await pool.query("SELECT count(*)::int n FROM eos_policy.role_capabilities")).rows[0].n;
  const credRows = (await pool.query("SELECT count(*)::int n FROM eos_policy.role_object_permissions")).rows[0].n;
  assert.ok(credRows > 0, "the seed wrote stored CRED to preserve");
  migrate(dbUrl, ["up", String(STEPS_TO_MIGRATION)]);
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
    assert.equal(total, 76,
      "49 + 8 + 13 + 3 + 1 + 1 (the re-homed coordinated-visit read) + 1 (admin.securityPolicy.read, " +
      "the Administration read authority -- rolesPermissions had two ADMIN_ACTION writes and no read)");
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

  await t.test("the deferred decisions stay deferred, and the one released key is pinned exactly", async () => {
    // THE HOLD MOVED BY EXACTLY ONE KEY, AND THIS ASSERTION MOVED WITH IT -- it was not loosened.
    //
    // This test used to say "all nine are ungranted", which was the whole truth until migration
    // 1762128000000 applied the Owner's ruling releasing `workflowDefinition.read` to admin and
    // owner and NOTHING else. Rewriting it as "at most one of them may have holders" would be a
    // weakening: the next key released by accident would pass. So the expectation is restated as
    // TWO exact facts instead of one, and the eight that are still held are held exactly as
    // strictly as before:
    //
    //   * the EIGHT still-deferred keys (three workOrder.lifecycle.* plus the five
    //     workflowDefinition mutations) must have ZERO grants -- unchanged;
    //   * `workflowDefinition.read` must have EXACTLY the two grants the ruling names, admin and
    //     owner, named by Role key rather than counted. A third holder fails here, and so does a
    //     silent re-grant to a role the ruling did not name.
    //
    // migrationChainSafety.test.mjs proves the same population from the migration SOURCE; this
    // proves it from the migrated DATABASE.
    const RELEASED = "workflowDefinition.read";
    const { rows } = await pool.query(`
      SELECT c.key, count(rc.role_id)::int AS grants
        FROM eos_policy.capabilities c
        LEFT JOIN eos_policy.role_capabilities rc ON rc.capability_id = c.id
       WHERE c.key LIKE 'workOrder.lifecycle.%' OR c.key LIKE 'workflowDefinition.%'
       GROUP BY c.key ORDER BY c.key`);
    assert.equal(rows.length, 9, "three lifecycle + six workflow");
    for (const r of rows) {
      if (r.key === RELEASED) continue;
      assert.equal(r.grants, 0, `${r.key} must remain ungranted -- no Owner ruling has released it`);
    }
    assert.ok(rows.some((r) => r.key === RELEASED),
      `${RELEASED} must still be a registered capability -- the released key cannot go missing`);

    const holders = await pool.query(
      `SELECT r.key FROM eos_policy.role_capabilities rc
         JOIN eos_policy.capabilities c ON c.id = rc.capability_id
         JOIN eos_policy.roles r        ON r.id = rc.role_id
        WHERE c.key = $1 ORDER BY r.key`, [RELEASED]);
    assert.deepEqual(holders.rows.map((r) => r.key), ["admin", "owner"],
      `${RELEASED} is released to exactly admin and owner by migration 1762128000000, and to nobody else`);

    // And no direct Principal grant was minted alongside it: the released key is a ROLE grant only.
    const direct = await pool.query(
      `SELECT count(*)::int n FROM eos_policy.principal_capabilities pc
         JOIN eos_policy.capabilities c ON c.id = pc.capability_id
        WHERE c.object_key = 'workflowDefinition'`);
    assert.equal(direct.rows[0].n, 0, "no direct Principal grant exists on any workflowDefinition capability");
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


  await t.test("Finance: one capability names one Object, and named acts stay named", async () => {
    const { rows } = await pool.query(
      `SELECT key, object_key, action_key, action_kind FROM eos_policy.capabilities
        WHERE key LIKE 'finance.%' ORDER BY key`);
    const byKey = new Map(rows.map((r) => [r.key, r]));
    assert.equal(byKey.get("finance.invoice.read").object_key, "invoice");
    assert.equal(byKey.get("finance.payment.read").object_key, "payment");
    assert.equal(byKey.has("finance.read"), false, "the two-Object key is not registered");
    // The four named acts are BUSINESS ACTIONS. An Invoice is issued and adjusted, never
    // "created" and "edited" -- minting CRUD for them would give one act two names.
    for (const k of ["finance.invoice.issue", "finance.adjustment.record", "finance.payment.apply", "finance.refund.record"]) {
      assert.equal(byKey.get(k).action_kind, "BUSINESS_ACTION", `${k} must not be generic CRUD`);
    }
    for (const forbidden of ["invoice.create", "invoice.edit", "payment.create", "payment.edit"]) {
      assert.equal(rows.some((r) => `${r.object_key}.${r.action_key}` === forbidden), false);
    }
    // Both split reads go to exactly the Roles that held finance.read -- nobody gains or loses.
    const counts = await pool.query(
      `SELECT c.key, count(*)::int n FROM eos_policy.role_capabilities rc
         JOIN eos_policy.capabilities c ON c.id = rc.capability_id
        WHERE c.key IN ('finance.invoice.read','finance.payment.read') GROUP BY c.key`);
    assert.equal(counts.rows.length, 2);
    assert.equal(counts.rows[0].n, counts.rows[1].n, "the split is symmetric");
  });

  await t.test("the superseded scoped key is ungranted and mechanically blocked", async () => {
    const { rows } = await pool.query(
      `SELECT c.description, count(rc.role_id)::int AS grants
         FROM eos_policy.capabilities c
         LEFT JOIN eos_policy.role_capabilities rc ON rc.capability_id = c.id
        WHERE c.key = 'reorder.request.read.queue' GROUP BY c.description`);
    assert.equal(rows.length, 1, "the capability ROW survives as migration evidence");
    assert.equal(rows[0].grants, 0, "and carries no grant");
    assert.match(rows[0].description, /SUPERSEDED/);
    // No later migration may grant it again.
    const fs = require("node:fs");
    const dir = resolve(FUNCTIONS_DIR, "migrations");
    const offenders = fs.readdirSync(dir).filter((f) => f.endsWith(".sql") && f > MIGRATION_3)
      .filter((f) => {
        const up = fs.readFileSync(resolve(dir, f), "utf8").split("-- Down Migration")[0].replace(/^\s*--.*$/gm, "");
        return up.split(";").filter((st) => /INSERT\s+INTO\s+role_capabilities/i.test(st))
          .some((st) => st.includes("reorder.request.read.queue"));
      });
    assert.deepEqual(offenders, [], "the superseded scoped key must never be granted again");
  });

  await t.test("Reorder: scope left the capability key", async () => {
    const { rows } = await pool.query(
      "SELECT key FROM eos_policy.capabilities WHERE key LIKE 'reorder.%' ORDER BY key");
    const keys = rows.map((r) => r.key);
    assert.deepEqual(keys, [
      "reorder.purchaseOrder.create", "reorder.purchaseOrder.read", "reorder.request.assign",
      "reorder.request.create.manual", "reorder.request.create.system",
      "reorder.request.read", "reorder.request.read.queue",
    ]);
    // `reorder.request.read.own` is NOT a capability and never becomes one: OWN is a record
    // relationship, answered by an assignment, not by a second key meaning "the same read, smaller".
    assert.equal(keys.includes("reorder.request.read.own"), false,
      "OWN is context, not a capability");
    // And the canonical read carries no scope in its own metadata.
    const canonical = await pool.query(
      `SELECT object_key, action_key, action_kind FROM eos_policy.capabilities WHERE key = 'reorder.request.read'`);
    assert.deepEqual(canonical.rows[0], { object_key: "reorderRequest", action_key: "read", action_kind: "READ" });
  });

  await t.test("Administration trusted writers are named acts, not a giant Edit", async () => {
    const { rows } = await pool.query(
      `SELECT key, object_key, action_key, action_kind FROM eos_policy.capabilities
        WHERE key IN ('admin.userStatus.write','admin.credentialReset.initiate','admin.roleAssignment.write','admin.accessRequest.decide')
        ORDER BY key`);
    assert.equal(rows.length, 4);
    for (const r of rows) assert.equal(r.action_kind, "ADMIN_ACTION", `${r.key} is an administration act`);
    assert.deepEqual(rows.filter((r) => r.object_key === "employee").map((r) => r.action_key).sort(),
      ["resetCredential", "setStatus"]);
    assert.deepEqual(rows.filter((r) => r.object_key === "rolesPermissions").map((r) => r.action_key).sort(),
      ["assignRole", "decideAccessRequest"]);
    const generic = await pool.query(
      `SELECT key FROM eos_policy.capabilities
        WHERE object_key IN ('employee','rolesPermissions') AND action_key = 'edit' AND action_kind = 'EDIT'`);
    assert.equal(generic.rows.filter((r) => r.key !== "admin.employeeProfile.write").length, 0,
      "no new generic Edit was introduced where commands already exist");
  });

  await t.test("every exact grant matches the governed Role catalog, not a boolean", async () => {
    const { deriveLegacyRoleGrants } = require("../lib/eosOps/migration/inventoryCapabilityGrantMigration.js");
    const { rows } = await pool.query(`
      SELECT c.key AS capability_key, r.key AS role_key
        FROM eos_policy.role_capabilities rc
        JOIN eos_policy.capabilities c ON c.id = rc.capability_id
        JOIN eos_policy.roles r ON r.id = rc.role_id
       WHERE rc.granted_by = 'migration:1761609600000'`);
    // The five conflict capabilities are declared in the catalog under their own keys; the thirteen
    // new ones were derived from the legacy key they replace. Check the five that are directly
    // checkable -- a mismatch means the migration invented a grant.
    for (const key of ["customer.record.update", "inventory.catalog.manage", "salesOrder.write",
      "salesAgreement.updateDraft", "inventory.transaction.read"]) {
      const fromCatalog = deriveLegacyRoleGrants([key]).map((g) => g.roleKey).sort();
      const written = rows.filter((r) => r.capability_key === key).map((r) => r.role_key).sort();
      assert.deepEqual(written, fromCatalog, `${key} must match the Role catalog exactly`);
    }
  });

  await t.test("the three blocker categories are separate and named", () => {
    assert.deepEqual(Object.keys(SECURITY_POLICY_BLOCKERS), [], "Finance was ruled; none remain");
    // CLOSED by migration 1761696000000: whole-queue visibility became an Operational Scope and
    // PARTS_ASSOCIATE became a Work Eligibility, so scope stopped needing to live in a capability.
    assert.deepEqual(Object.keys(SCOPE_MODEL_BLOCKERS), [], "the scope model can represent both rulings");
    assert.deepEqual(Object.keys(WITHHELD_PENDING_ELIGIBILITY_EVIDENCE).sort(),
      ["purchaseOrder.C", "purchaseOrder.R"], "what remains is an evidence gap, not a model gap");
    // manufacturer.R left this list when its target authority and tooling were built. The model is
    // no longer the blocker; the DATA is, and that is reported separately rather than here.
    // EMPTY, and not because tables appeared. dispatchSchedule and notifications were RETIRED
    // (migration 1761955200000): each governed a record that does not exist, so the cells stopped
    // being cells. The one capability that governed something real was re-homed onto the Sales
    // Order as a BUSINESS_ACTION, which is deliberately NOT a CRED verb.
    assert.deepEqual(Object.keys(DATA_AUTHORITY_MIGRATION_BLOCKERS).sort(), []);
    // The workforce gap is kept as its own named blocker, so closing the scope model is never
    // mistaken for closing it.
    assert.equal(WORKFORCE_ELIGIBILITY_DATA_MIGRATION_BLOCKER.legacyHolders, 5);
    assert.equal(WORKFORCE_ELIGIBILITY_DATA_MIGRATION_BLOCKER.targetAssignments, 0);
    for (const [cell, why] of Object.entries(CRED_POLICY_DECISION_CELLS)) {
      assert.ok(why.length > 20, `${cell} needs a real reason, not a label`);
    }
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
