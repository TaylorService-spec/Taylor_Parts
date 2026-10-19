// B4 REPORT / PERFORMANCE-GOAL GRANT PARITY -- against a real postgres:16 (Firebase exit B4, DECISIONS #B4, OD-B4-1; migration 1764650000000).
//
// Owner authorization 2026-10-18, nonprod only. Two tenants exist when the migration runs (it is a data migration: it grants only in tenants that already exist), seeded
// at the baseline boundary exactly as serviceBaselineTenant does, then every migration BEFORE this one is applied; tenant B carries two current Administration
// ADMIN_REVOKED decisions; then this migration runs.
//   GRANTS    tenant A holds exactly the 122 Firebase-mirrored pairs, every one stamped 'migration:1764650000000'; no direct (Principal) grant, no other source.
//   REVOKE    tenant B holds 120: an ADMIN_REVOKED decision is honoured (never re-granted); the decisions are untouched.
//   PERSONAS  the capability sets are read from the grants the migration wrote (not stated by hand), and drive the real report and goal operations:
//             a restricted persona is refused; a reportViewer runs a customer report but cannot read a finance field nor create a definition;
//             reportViewer + reportFinanceViewer reads the finance field; reportAuthor creates / renames / duplicates but never deletes; the goal roles read goals.
import { endPoolAndDrain } from "./support/poolTeardown.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

const HERE = dirname(fileURLToPath(import.meta.url));
const FUNCTIONS_DIR = resolve(HERE, "..");
const require = createRequire(import.meta.url);
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");
const { seedTenantPolicy } = require("../lib/adminPolicy/seed/policySeed.js");
const baseline = require("../lib/adminPolicy/roleCapabilityAuthorityBaseline.js");
const { capabilitiesForRoleKeys } = require("../lib/eosOps/capabilityAuthority.js");
const reports = require("../lib/eosOps/reportOperations.js");
const goals = require("../lib/eosOps/performanceGoalReads.js");

const A = "t-b4a";
const B = "t-b4b";
const STAMP = "migration:1764650000000";
const PARITY = JSON.parse(readFileSync(join(FUNCTIONS_DIR, "..", "docs", "architecture", "b4-report-goal-grant-parity.json"), "utf8"));
const EXPECTED = Object.entries(PARITY.holdersByKey).flatMap(([key, holders]) => holders.map((r) => `${r}|${key}`)).sort();
const REVOKED_IN_B = ["reportAuthor|report.definition.rename", "reportViewer|report.customer.read"];

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

test("B4 report / goal grant parity on PostgreSQL: stamped grants, an honoured revoke, and what real personas can and cannot do", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `b4gp_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await endPoolAndDrain(pool);
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  const url = dbUrlFor(name);
  const migrate = (count) => execFileSync(process.execPath, [
    "node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations", "--no-check-order",
    ...(count === undefined ? [] : [String(count)]),
  ], { maxBuffer: 256 * 1024 * 1024, cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  const files = readdirSync(join(FUNCTIONS_DIR, "migrations")).filter((f) => f.endsWith(".sql")).sort();
  // The grant migration is no longer the NEWEST (P-1, 1764660000000, was appended after it): this proof runs every migration BEFORE it, then it alone, and leaves the later ones unapplied.
  const grantIndex = files.findIndex((f) => f.startsWith("1764650000000_"));
  assert.ok(grantIndex > 0, "the B4 grant migration is present");
  const boundary = files.filter((f) => f < baseline.SEED_BOUNDARY_MIGRATION).length;

  migrate(boundary);
  pool = new pg.Pool({ connectionString: url, max: 8 });
  const q = (sql, v = []) => pool.query(sql, v);
  const repo = new PostgresPolicyRepository(pool);
  for (const tenant of [A, B]) {
    await q(`INSERT INTO eos_policy.tenants (id,key,name) VALUES ($1,$1,$1)`, [tenant]);
    await seedTenantPolicy(repo, tenant, "operator-b4gp");
  }
  migrate(grantIndex - boundary); // every migration BEFORE the grant migration

  // Before the grant migration: the keys are registered (1764640000000) and held by nobody.
  assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.role_capabilities rc JOIN eos_policy.capabilities c ON c.id = rc.capability_id
                          WHERE c.key LIKE 'report.%' OR c.key = 'performance.goal.read'`)).rows[0].n, 0, "registered, held by nobody, until the grant migration");

  // Tenant B: two current Administration ADMIN_REVOKED decisions on cells the migration would otherwise write.
  const auditId = "ae-b4gp-revoke";
  await q(`INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, occurred_at, reason)
           VALUES ($1, $2, 'revokeCapabilityFromRole', 'fixture', 'decision', 'd', now(), 'fixture revoke')`, [auditId, B]);
  for (const [i, pair] of REVOKED_IN_B.entries()) {
    const [roleKey, capabilityKey] = pair.split("|");
    await q(`INSERT INTO eos_policy.role_capability_decisions (id, tenant_id, role_key, capability_key, decision, requires_condition, reason, actor_principal_id, audit_event_id)
             VALUES ($1, $2, $3, $4, 'ADMIN_REVOKED', false, 'fixture: an Administration revoke the migration must honour', 'fixture', $5)`, [`dec-b4gp-${i}`, B, roleKey, capabilityKey, auditId]);
  }

  migrate(1); // THE MIGRATION UNDER TEST

  const grantsOf = async (tenant) => (await q(
    `SELECT r.key AS role, c.key AS cap, rc.granted_by AS by FROM eos_policy.role_capabilities rc
       JOIN eos_policy.roles r ON r.id = rc.role_id AND r.tenant_id = rc.tenant_id
       JOIN eos_policy.capabilities c ON c.id = rc.capability_id
      WHERE rc.tenant_id = $1 AND (c.key LIKE 'report.%' OR c.key = 'performance.goal.read')`, [tenant])).rows;

  await t.test("GRANTS: tenant A holds exactly the 122 Firebase-mirrored pairs, all stamped by the migration, and nothing else holds a B4 key", async () => {
    const rows = await grantsOf(A);
    assert.equal(rows.length, 122);
    assert.deepEqual(rows.map((r) => `${r.role}|${r.cap}`).sort(), EXPECTED);
    assert.deepEqual([...new Set(rows.map((r) => r.by))], [STAMP]);
    assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.role_capabilities WHERE tenant_id = $1 AND granted_by = $2`, [A, STAMP])).rows[0].n, 122, "the migration wrote nothing outside the 39 keys");
    assert.equal(new Set(rows.map((r) => r.role)).size, 15);
    assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.principal_capabilities pc JOIN eos_policy.capabilities c ON c.id = pc.capability_id
                            WHERE c.key LIKE 'report.%' OR c.key = 'performance.goal.read'`)).rows[0].n, 0, "no direct (Principal) grant");
    // Every one of the 39 keys is held; the report.definition.read twin (reportDefinition.read) is untouched by this migration.
    assert.equal(new Set(rows.map((r) => r.cap)).size, 39);
    assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.role_capabilities rc JOIN eos_policy.capabilities c ON c.id = rc.capability_id
                            WHERE rc.tenant_id = $1 AND c.key = 'reportDefinition.read' AND rc.granted_by = $2`, [A, STAMP])).rows[0].n, 0);
  });

  await t.test("REVOKE: an Administration ADMIN_REVOKED decision is honoured -- the revoked pairs are not granted in tenant B, the other 120 are, and the decisions stand", async () => {
    const rows = await grantsOf(B);
    assert.deepEqual(rows.map((r) => `${r.role}|${r.cap}`).sort(), EXPECTED.filter((p) => !REVOKED_IN_B.includes(p)));
    assert.equal(rows.length, 120);
    const decisions = (await q(`SELECT role_key, capability_key, decision, superseded_at FROM eos_policy.role_capability_decisions WHERE tenant_id = $1 ORDER BY 1, 2`, [B])).rows;
    assert.deepEqual(decisions.map((d) => [`${d.role_key}|${d.capability_key}`, d.decision, d.superseded_at]).sort(),
      REVOKED_IN_B.map((p) => [p, "ADMIN_REVOKED", null]).sort());
  });

  // ── personas: capability sets are READ FROM THE GRANTS the migration wrote ──
  await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id, operating_company_id, status, source, established_by, updated_by)
           VALUES ($1,'taylor','ACTIVE','fixture','f','f')`, [A]);
  await q(`INSERT INTO eos_policy.tenant_operating_company_keys (tenant_id, operating_company_id, operating_company_key, status, provenance, source, established_by, updated_by)
           VALUES ($1,'taylor','sample-co','ACTIVE','NATIVE','fixture','f','f')`, [A]);
  const people = {};
  for (const [key, roles] of Object.entries({
    restricted: ["generalEmployee"], viewer: ["reportViewer"], viewerFinance: ["reportViewer", "reportFinanceViewer"], author: ["reportAuthor"],
    sales: ["salesperson"], noRoles: [], dispatcher: ["dispatcher"],
  })) {
    const principalId = await repo.transact({ tenantId: A, uid: "uid-fixture" }, async (tx) => {
      const p = await tx.createPrincipal({ externalSubject: `uid-b4gp-${key}`, identityProvider: "firebase" });
      await tx.createTenantMembership(p.id);
      return p.id;
    });
    await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id, updated_at) VALUES ($1,$2,'ACTIVE','taylor','2020-01-01T00:00:00Z')`, [`e-${key}`, A]);
    await q(`INSERT INTO eos_policy.employee_principal_links (id, tenant_id, principal_id, employee_id, operating_company_id, link_source, asserted_by, assertion_reason, status)
             VALUES ($1,$2,$3,$4,'taylor','OPERATOR_ASSERTED','f','test','active')`, [`l-${key}`, A, principalId, `e-${key}`]);
    const capabilities = new Set(await capabilitiesForRoleKeys(pool, A, roles));
    people[key] = { tenantId: A, principalId, capabilities, roles };
  }
  await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, customer_number, notes, created_by, updated_by) VALUES
             ('acct-acme',$1,'Acme Co','ACTIVE','C-100','private note','f','f'), ('acct-beta',$1,'Beta LLC','PROSPECT','C-200',NULL,'f','f')`, [A]);
  const refusal = async (fn) => { try { await fn(); } catch (err) { return err; } return assert.fail("expected a refusal"); };
  const run = (who, definition) => reports.runReportDefinition({ pool }, people[who], { definition });
  const saved = (fn, who, input) => reports[fn]({ pool }, people[who], input);
  const CUSTOMERS = { objectId: "customer", fields: ["customer.name", "customer.status"] };

  await t.test("the persona capability sets are the migration's grants, resolved through the same join every runtime gate uses", () => {
    const held = (who, keys) => keys.filter((k) => people[who].capabilities.has(k));
    const b4Of = (who) => [...people[who].capabilities].filter((k) => (k.startsWith("report.") && !k.startsWith("reportDefinition")) || k === "performance.goal.read").sort();
    assert.equal(b4Of("viewer").length, 26);
    assert.equal(b4Of("viewerFinance").length, 31);
    assert.equal(b4Of("author").length, 3);
    assert.deepEqual(b4Of("sales"), ["performance.goal.read"]);
    assert.deepEqual(b4Of("restricted"), []);
    assert.deepEqual(b4Of("dispatcher"), [], "a Role outside the 15 holds no B4 key");
    assert.deepEqual(held("viewer", ["report.customer.read", "report.customer.field.paymentTerms.read", "report.definition.create"]), ["report.customer.read"]);
  });

  await t.test("RESTRICTED persona (holds none of the keys): the run is refused (permission-denied, audited), a saved-definition create and the goal reads are CAPABILITY_REQUIRED", async () => {
    const denied = await run("restricted", CUSTOMERS);
    assert.deepEqual([denied.kind, denied.rows, denied.completeness], ["permission-denied", null, "not-attempted"]);
    assert.equal((await run("noRoles", CUSTOMERS)).kind, "permission-denied");
    assert.equal((await run("dispatcher", CUSTOMERS)).kind, "permission-denied");
    const create = await refusal(() => saved("createSavedReportDefinition", "restricted", { name: "Nope", definition: CUSTOMERS }));
    assert.equal(create.code, "CAPABILITY_REQUIRED");
    const FIRM = { metricId: "service.workOrder.pastDue.count", targetScopeType: "FIRM", targetScopeId: null };
    assert.equal((await refusal(() => goals.listCurrentPerformanceGoals({ pool }, people.restricted, { targets: [FIRM], onDate: "2026-10-18" }))).code, "CAPABILITY_REQUIRED");
    assert.equal((await refusal(() => goals.listPerformanceGoalVersions({ pool }, people.restricted, { target: FIRM }))).code, "CAPABILITY_REQUIRED");
    assert.equal((await refusal(() => goals.listGoalSubjects({ pool }, people.restricted, {}))).code, "CAPABILITY_REQUIRED");
    assert.equal((await refusal(() => goals.listGoalSubjects({ pool }, people.dispatcher, {}))).code, "CAPABILITY_REQUIRED");
  });

  await t.test("a goal reader (salesperson holds performance.goal.read) passes the capability gate that refused the restricted persona", async () => {
    const subjects = await goals.listGoalSubjects({ pool }, people.sales, {});
    assert.ok(Array.isArray(subjects.employeeIds));
    const none = await goals.listCurrentPerformanceGoals({ pool }, people.sales, { targets: [], onDate: "2026-10-18" });
    assert.deepEqual(none.results, []);
  });

  await t.test("reportViewer runs a customer report, but cannot read a finance field nor create a definition", async () => {
    const ok = await run("viewer", CUSTOMERS);
    assert.deepEqual([ok.kind, ok.rowCount], ["results", 2]);
    // paymentTerms is a finance field only reportFinanceViewer holds: it is DROPPED for the viewer (absent from the payload, never blanked).
    const finance = await run("viewer", { objectId: "customer", fields: ["customer.name", "customer.paymentTerms"] });
    assert.deepEqual([finance.kind, finance.droppedFieldIds], ["partially-authorized", ["customer.paymentTerms"]]);
    assert.ok(finance.rows.every((r) => !("customer.paymentTerms" in r)));
    assert.equal((await refusal(() => saved("createSavedReportDefinition", "viewer", { name: "Mine", definition: CUSTOMERS }))).code, "CAPABILITY_REQUIRED");
    // The same persona with the finance Role in addition reads the field: the grants, not the Role name, decide.
    const both = await run("viewerFinance", { objectId: "customer", fields: ["customer.name", "customer.paymentTerms"] });
    assert.deepEqual([both.kind, both.droppedFieldIds], ["results", []]);
  });

  await t.test("reportAuthor creates, renames and duplicates a definition but cannot delete one", async () => {
    const mine = await saved("createSavedReportDefinition", "author", { name: "Customers", definition: CUSTOMERS });
    assert.equal(mine.name, "Customers");
    assert.equal((await saved("renameSavedReportDefinition", "author", { definitionId: mine.id, name: "Renamed" })).name, "Renamed");
    const copy = await saved("duplicateSavedReportDefinition", "author", { definitionId: mine.id });
    assert.equal(copy.name, "Renamed (copy)");
    assert.equal((await refusal(() => saved("deleteSavedReportDefinition", "author", { definitionId: mine.id }))).code, "CAPABILITY_REQUIRED");
    // Nothing was deleted, and an author with no object read still cannot RUN a report (a definition confers no data access).
    assert.equal((await q(`SELECT count(*)::int n FROM eos_ops.report_definitions WHERE tenant_id = $1 AND owner_principal_id = $2`, [A, people.author.principalId])).rows[0].n, 2);
    assert.equal((await run("author", CUSTOMERS)).kind, "permission-denied");
  });
});
