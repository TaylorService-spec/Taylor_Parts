// SAMPLE COMPANY V2 against a real postgres:16.
//
// The offline suite proves what the manifest SAYS. This one proves what actually happens to a database: the
// plan writes nothing, the apply seeds through the governed writers, the second plan is a no-op, drift is
// refused rather than overwritten, and the verifier's access section resolves capabilities through the whole
// identity chain -- including the failure mode that matters most, a Role that is assigned but whose
// capabilities were never granted.
//
// Its OWN database, migrated by the normal runner (migrations pinned BY NAME, never "latest") and dropped
// afterwards.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

const HERE = dirname(fileURLToPath(import.meta.url));
const FUNCTIONS_DIR = resolve(HERE, "..");
const require = createRequire(import.meta.url);
const { MANIFEST } = require("../scripts/seedSampleCompany.js");

/**
 * The migration set this suite is written against, pinned BY NAME and by count -- never "latest".
 *
 * A bare `up` would run whatever happens to be in the directory, so a migration added later would silently
 * change what these assertions ran against. The name below is asserted to be the last file, and the runner is
 * then given that exact COUNT, so adding a migration fails here as a deliberate review rather than quietly
 * altering the world under the test. (`up <name>` is NOT used: node-pg-migrate reorders under it, which puts
 * migration 027 ahead of the 026 it depends on.)
 */
const PINNED_LAST_MIGRATION = "1759881600000_catalog-master-descriptive-authority";
const PINNED_MIGRATION_COUNT = 28;

const DB_NAME = `sample_company_v2_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const dbUrl = () => {
  const u = new URL(URL_BASE);
  u.pathname = `/${DB_NAME}`;
  return u.toString();
};
async function withClient(url, fn) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
const q = (text, values = []) => withClient(dbUrl(), (c) => c.query(text, values));

// A preload that fails the process if anything resolves a Firebase module. The sample company seed is a
// PostgreSQL tool; loading firebase-admin at all would be the regression.
const SENTINEL = "SAMPLE_COMPANY_LOADED_FIREBASE";
const preloadPath = join(mkdtempSync(join(tmpdir(), "sample-company-")), "preload.cjs");
writeFileSync(
  preloadPath,
  `const Module = require("module"); const load = Module._load;
   Module._load = function (request, ...rest) {
     if (/firebase/i.test(request)) { process.stderr.write("${SENTINEL}:" + request + "\\n"); process.exit(97); }
     return load.call(this, request, ...rest);
   };`,
);

const TENANT_KEY = "taylor-nonprod";
const env = () => ({ ...process.env, SAMPLE_DB: dbUrl(), EOS_ENVIRONMENT: "nonprod" });
let adminPrincipalId;
let tenantId;

const cli = (script, args, extraEnv = {}) =>
  spawnSync(process.execPath, ["--require", preloadPath, `scripts/${script}`,
    "--environment", "platform-sandbox", "--databaseUrlEnv", "SAMPLE_DB", ...args],
  { cwd: FUNCTIONS_DIR, encoding: "utf8", env: { ...env(), ...extraEnv }, maxBuffer: 64 * 1024 * 1024 });

const IDENTITY = () => ["--tenantKey", TENANT_KEY, "--existingAdminPrincipalId", adminPrincipalId, "--performedBy", "sample-company-proof"];
const plan = (extra = []) => cli("seedSampleCompany.js", [...IDENTITY(), ...extra]);
const apply = () => cli("seedSampleCompany.js", [...IDENTITY(), "--mode", "apply", "--apply"]);
const verify = () => cli("verifySampleCompany.js", [...IDENTITY()]);

/** Everything this seed can touch. A "writes nothing" claim is only as good as the relations it counts. */
const SEEDED_RELATIONS = [
  "eos_workforce.employees", "eos_workforce.employee_reporting_relationships",
  "eos_policy.principals", "eos_policy.tenant_memberships", "eos_policy.employee_principal_links",
  "eos_policy.user_role_assignments", "eos_policy.role_capabilities",
  "eos_crm.accounts", "eos_crm.contacts", "eos_crm.account_locations",
  "eos_commercial.opportunities", "eos_commercial.sales_agreements", "eos_commercial.sales_orders",
  "eos_ops.equipment_models", "eos_ops.equipment", "eos_ops.parts", "eos_ops.suppliers",
  "eos_ops.supplier_catalog_items", "eos_ops.warehouses", "eos_ops.bins", "eos_ops.mobile_locations",
  "eos_ops.trucks", "eos_ops.reorder_requests", "eos_ops.purchase_orders", "eos_ops.purchase_order_voids",
  "eos_ops.receiving_orders", "eos_ops.receiving_order_lines", "eos_ops.cycle_count_sheets",
  "eos_ops.cycle_count_lines", "eos_ops.inventory_movements",
];
async function rowCounts() {
  const out = {};
  for (const rel of SEEDED_RELATIONS) out[rel] = (await q(`SELECT count(*)::int AS n FROM ${rel}`)).rows[0].n;
  return out;
}

test("Sample Company v2, in PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${DB_NAME}`));
  t.after(() => withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`)));

  const migrations = readdirSync(resolve(FUNCTIONS_DIR, "migrations")).filter((f) => f.endsWith(".sql")).sort();
  assert.equal(migrations.length, PINNED_MIGRATION_COUNT,
    "a migration was added or removed after this suite was written -- review the assertions, then move the pin deliberately");
  assert.equal(migrations[migrations.length - 1], `${PINNED_LAST_MIGRATION}.sql`,
    "the last migration is not the one this suite was written against");
  execFileSync(process.execPath,
    ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", String(PINNED_MIGRATION_COUNT), "--migrations-dir", "migrations"],
    { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrl() }, stdio: "pipe" });

  // The world the nonprod operator already has: a bootstrapped tenant with its seeded Roles and ONE real
  // administrator Principal. Stood up by the real bootstrap, never by hand.
  const pool = new pg.Pool({ connectionString: dbUrl(), max: 2 });
  try {
    const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");
    const { bootstrapTenant, bootstrapAdministrator } = require("../lib/adminPolicy/tenantBootstrap.js");
    const repo = new PostgresPolicyRepository(pool);
    const { tenant } = await bootstrapTenant(repo, { key: TENANT_KEY, name: "Sample Company v2 proof tenant", actorUid: "proof" });
    const admin = await bootstrapAdministrator(repo, { tenantId: tenant.id, externalSubject: "real-login-subject", performedBy: "proof" });
    adminPrincipalId = admin.principal.id;
    tenantId = tenant.id;
  } finally {
    await pool.end();
  }

  // ════════════════ refusals, against this very database ════════════════

  await t.test("the fence refuses this same database without the nonprod runtime marker, before writing", async () => {
    const before = await rowCounts();
    const res = cli("seedSampleCompany.js", [...IDENTITY()], { EOS_ENVIRONMENT: "local" });
    assert.equal(res.status, 2);
    assert.match(res.stderr, /EOS_ENVIRONMENT must read exactly 'nonprod'/);
    assert.deepEqual(await rowCounts(), before);
  });

  await t.test("production and Certification are refused against this database too", async () => {
    const before = await rowCounts();
    for (const [environment, pattern] of [["taylor-parts-production", /production/], ["platform-certification", /Certification world, which is frozen/]]) {
      const r = spawnSync(process.execPath, ["--require", preloadPath, "scripts/seedSampleCompany.js",
        "--environment", environment, "--databaseUrlEnv", "SAMPLE_DB", ...IDENTITY(), "--mode", "apply", "--apply"],
      { cwd: FUNCTIONS_DIR, encoding: "utf8", env: env() });
      assert.equal(r.status, 2, `${environment} was not refused`);
      assert.match(r.stderr, pattern);
    }
    assert.deepEqual(await rowCounts(), before);
  });

  await t.test("a Principal that cannot administer is refused -- the seed asserts no authority of its own", async () => {
    const r = cli("seedSampleCompany.js", ["--tenantKey", TENANT_KEY, "--existingAdminPrincipalId", "no-such-principal", "--performedBy", "x"]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /ADMINISTRATOR_INVALID/);
    assert.equal((await q("SELECT count(*)::int AS n FROM eos_workforce.employees")).rows[0].n, 0);
  });

  // ════════════════ plan ════════════════

  let planned;
  await t.test("the DEFAULT mode is plan, and it writes NOTHING", async () => {
    const before = await rowCounts();
    const r = plan();
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stderr, new RegExp(SENTINEL), "a Firebase module was loaded");
    planned = JSON.parse(r.stdout);
    assert.equal(planned.mode, "plan");
    assert.equal(planned.applied, false);
    assert.equal(planned.pass, true);
    assert.ok(planned.totals.CREATE > 0, "a plan against an empty world must propose creations");
    assert.equal(planned.totals.FIXTURE_DRIFT, 0);
    assert.ok(planned.totals.BLOCKED > 0, "the blocked domains must be counted, not omitted");
    assert.equal(planned.capabilityGrants.appliedAdditions, 0);
    assert.deepEqual(await rowCounts(), before, "the plan changed the database");
  });

  // ════════════════ apply ════════════════

  let applied;
  await t.test("apply seeds the whole sample company through the governed writers", async () => {
    const r = apply();
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stderr, new RegExp(SENTINEL));
    applied = JSON.parse(r.stdout);
    assert.equal(applied.applied, true);
    assert.equal(applied.pass, true);
    assert.equal(applied.totals.FIXTURE_DRIFT, 0);
    assert.ok(!r.stdout.includes(dbUrl()), "the connection string was printed");
    assert.ok(!r.stdout.includes(":password@"), "a password-shaped string was printed");

    const counts = await rowCounts();
    assert.equal(counts["eos_workforce.employees"], MANIFEST.employees.length);
    assert.equal(counts["eos_workforce.employee_reporting_relationships"], MANIFEST.reportingRelationships.edges.length);
    assert.equal(counts["eos_policy.employee_principal_links"], MANIFEST.principals.length);
    assert.equal(counts["eos_crm.accounts"], MANIFEST.accounts.length);
    assert.equal(counts["eos_crm.contacts"], MANIFEST.contacts.length);
    assert.equal(counts["eos_crm.account_locations"], MANIFEST.locations.length);
    assert.equal(counts["eos_commercial.opportunities"], MANIFEST.commercial.filter((c) => c.kind === "OPPORTUNITY").length);
    assert.equal(counts["eos_commercial.sales_agreements"], MANIFEST.commercial.filter((c) => c.kind === "SALES_AGREEMENT").length);
    assert.equal(counts["eos_commercial.sales_orders"], MANIFEST.commercial.filter((c) => c.kind === "SALES_ORDER").length);
    assert.equal(counts["eos_ops.equipment_models"], MANIFEST.equipmentModels.length);
    assert.equal(counts["eos_ops.parts"], 0, "eos_ops.parts is BLOCKED -- its governed writer is INACTIVE");
    assert.equal(counts["eos_ops.warehouses"], MANIFEST.warehouses.length);
    assert.equal(counts["eos_ops.bins"], MANIFEST.bins.length);
    assert.equal(counts["eos_ops.trucks"], MANIFEST.trucks.records.length);
    assert.equal(counts["eos_ops.reorder_requests"], MANIFEST.purchasing.length);
    assert.equal(counts["eos_ops.purchase_orders"], MANIFEST.purchasing.length);
    assert.equal(counts["eos_ops.receiving_orders"], MANIFEST.purchasing.filter((p) => p.progressTo === "RECEIVED").length);
    assert.equal(counts["eos_ops.purchase_order_voids"], MANIFEST.purchasing.filter((p) => p.progressTo === "VOIDED").length);
    assert.equal(counts["eos_ops.cycle_count_sheets"], MANIFEST.cycleCounts.length);

    // BLOCKED means BLOCKED: nothing was written for a domain with no governed authority.
    assert.equal(counts["eos_ops.equipment"], 0, "installed Equipment is BLOCKED and must stay empty");
  });

  await t.test("the only inventory movements are the governed cycle-count adjustments", async () => {
    const movements = (await q(`SELECT source_kind, part_id, quantity_delta FROM eos_ops.inventory_movements ORDER BY part_id`)).rows;
    const expected = MANIFEST.cycleCounts.flatMap((c) => c.lines).filter((l) => l.expectMovement);
    assert.equal(movements.length, expected.length);
    for (const m of movements) assert.equal(m.source_kind, "CYCLE_COUNT_LINE", "no movement may come from anywhere else");
    // The receipt did NOT post a movement -- that is INVENTORY_RECEIPT_MOVEMENT_BLOCKED, proved rather than claimed.
    assert.equal(movements.filter((m) => m.source_kind === "RECEIPT").length, 0);
  });

  await t.test("separation of duties was really exercised: the counter did not approve their own variance", async () => {
    const lines = (await q(`SELECT submitted_by, reconciled_by, variance FROM eos_ops.cycle_count_lines WHERE reconciled_by IS NOT NULL`)).rows;
    assert.ok(lines.length > 0);
    for (const l of lines) {
      if (Number(l.variance ?? 0) !== 0) assert.notEqual(l.submitted_by, l.reconciled_by, "a non-zero variance was self-approved");
    }
  });

  // ════════════════ idempotence ════════════════

  await t.test("a plan AFTER apply is a complete no-op -- nothing left to create, nothing drifted", async () => {
    const before = await rowCounts();
    const r = plan();
    assert.equal(r.status, 0, r.stderr);
    const again = JSON.parse(r.stdout);
    assert.equal(again.totals.CREATE, 0, `a second plan still wants to create ${JSON.stringify(again.domains)}`);
    assert.equal(again.totals.FIXTURE_DRIFT, 0);
    assert.deepEqual(await rowCounts(), before);
  });

  await t.test("a second APPLY creates nothing and duplicates nothing", async () => {
    const before = await rowCounts();
    const r = apply();
    assert.equal(r.status, 0, r.stderr);
    const again = JSON.parse(r.stdout);
    assert.equal(again.totals.CREATE, 0);
    assert.equal(again.capabilityGrants.appliedAdditions, 0);
    assert.deepEqual(await rowCounts(), before);
  });

  // ════════════════ identity, written as three separate things ════════════════

  await t.test("Employee != Principal, and no Firebase uid ever became an Employee id", async () => {
    const principals = (await q("SELECT id, identity_provider, external_subject FROM eos_policy.principals")).rows;
    const employees = (await q("SELECT id FROM eos_workforce.employees")).rows.map((r) => r.id);
    for (const p of principals) {
      assert.ok(!employees.includes(p.id), `Principal id ${p.id} is also an Employee id`);
      assert.ok(!employees.includes(p.external_subject), `subject ${p.external_subject} is also an Employee id`);
    }
    // Exactly one real (firebase) Principal -- the reused administrator. Everything else cannot sign in.
    assert.equal(principals.filter((p) => p.identity_provider === "firebase").length, 1);
    assert.equal(principals.filter((p) => p.identity_provider === "eos-synthetic-nonprod").length,
      MANIFEST.principals.filter((p) => !p.existingAdministrator).length);
  });

  await t.test("Employee != User Access: the no-access personas have no Principal at all", async () => {
    for (const key of Object.keys(MANIFEST.expectedAccess.noAccessPersonas)) {
      const id = MANIFEST.employees.find((e) => e.key === key).id;
      const employee = (await q("SELECT employment_status::text AS s, display_name FROM eos_workforce.employees WHERE id = $1", [id])).rows;
      assert.equal(employee.length, 1, `${key} must exist as an Employee`);
      assert.ok(employee[0].display_name, `${key} must have a full profile`);
      const links = (await q("SELECT count(*)::int AS n FROM eos_policy.employee_principal_links WHERE employee_id = $1 AND status = 'active'", [id])).rows[0].n;
      assert.equal(links, 0, `${key} declares userAccess NONE but has ${links} active link(s)`);
    }
  });

  await t.test("Job Role never reached a PostgreSQL column", async () => {
    const columns = (await q(`SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'eos_workforce' AND table_name = 'employees' ORDER BY 1`)).rows.map((r) => r.column_name);
    assert.deepEqual(columns.filter((c) => /role|uid|firebase|principal|subject|provider|technician/.test(c)), [],
      "a Job Role or identity column reached the Employee table");
    for (const jobRole of MANIFEST.jobRoles.map((r) => r.key)) {
      const hits = (await q(`SELECT count(*)::int AS n FROM eos_workforce.employees WHERE job_title = $1`, [jobRole])).rows[0].n;
      assert.equal(hits, 0, `${jobRole} was written into job_title, which is a free-text job TITLE, not the Job Role`);
    }
  });

  await t.test("the org chart was written by the governed command, with history and an audit event", async () => {
    const rows = (await q(`SELECT employee_id, manager_employee_id, source FROM eos_workforce.employee_reporting_relationships WHERE effective_to IS NULL`)).rows;
    const byEmployee = new Map(rows.map((r) => [r.employee_id, r.manager_employee_id]));
    for (const edge of MANIFEST.reportingRelationships.edges) {
      const e = MANIFEST.employees.find((x) => x.key === edge.employee).id;
      const m = MANIFEST.employees.find((x) => x.key === edge.manager).id;
      assert.equal(byEmployee.get(e), m, `${edge.employee} should report to ${edge.manager}`);
    }
    for (const r of rows) assert.equal(r.source, "GOVERNED_COMMAND", "a reporting row must come from the governed writer");
    const audits = (await q(`SELECT count(*)::int AS n FROM eos_policy.audit_events WHERE action = 'employee.reportingRelationship.establish'`)).rows[0].n;
    assert.equal(audits, MANIFEST.reportingRelationships.edges.length);
  });

  await t.test("owner, accountable person and assignee stay three separate facts", async () => {
    for (const kind of [["OPPORTUNITY", "opportunities", "opportunity_number"], ["SALES_AGREEMENT", "sales_agreements", "sales_agreement_number"], ["SALES_ORDER", "sales_orders", "sales_order_number"]]) {
      const [k, table, numberColumn] = kind;
      for (const r of MANIFEST.commercial.filter((c) => c.kind === k)) {
        const row = (await q(`SELECT owner_employee_id, accountable_employee_id FROM eos_commercial.${table} WHERE ${numberColumn} = $1`, [r.number])).rows[0];
        const ownerId = MANIFEST.employees.find((e) => e.key === r.owner).id;
        assert.equal(row.owner_employee_id, ownerId, `${r.number} owner`);
        const expectedAccountable = r.accountable === "DERIVE_FROM_OWNER" ? ownerId : MANIFEST.employees.find((e) => e.key === r.accountable).id;
        assert.equal(row.accountable_employee_id, expectedAccountable, `${r.number} accountable person`);
      }
      // No assignment column was invented on any commercial table.
      const columns = (await q(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'eos_commercial' AND table_name = $1`, [table])).rows.map((r) => r.column_name);
      assert.deepEqual(columns.filter((c) => /assign/.test(c)), [], `${table} grew an assignment column`);
    }
    const split = MANIFEST.commercial.filter((r) => r.accountable !== "DERIVE_FROM_OWNER" && r.accountable !== r.owner);
    assert.ok(split.length > 0);
  });

  // ════════════════ drift is refused, never overwritten ════════════════

  await t.test("a drifted Employee is FIXTURE_DRIFT and the run refuses rather than overwriting", async () => {
    const victim = MANIFEST.employees.find((e) => e.key === "dispatcher").id;
    const originalTitle = MANIFEST.employees.find((e) => e.key === "dispatcher").jobTitle;
    await q(`UPDATE eos_workforce.employees SET job_title = 'DRIFTED BY THE TEST' WHERE id = $1`, [victim]);
    try {
      const r = apply();
      assert.equal(r.status, 1, "an apply over drift must not report success");
      const report = JSON.parse(r.stdout);
      assert.equal(report.pass, false);
      assert.ok(report.drift.some((d) => d.id === victim), JSON.stringify(report.drift));
      const after = (await q(`SELECT job_title FROM eos_workforce.employees WHERE id = $1`, [victim])).rows[0].job_title;
      assert.equal(after, "DRIFTED BY THE TEST", "the seed OVERWROTE a drifted value");
    } finally {
      await q(`UPDATE eos_workforce.employees SET job_title = $2 WHERE id = $1`, [victim, originalTitle]);
    }
  });

  await t.test("a drifted Account owner is FIXTURE_DRIFT and the owner is left alone", async () => {
    const account = MANIFEST.accounts[0];
    const wrongOwner = MANIFEST.employees.find((e) => e.key === "office-manager").id;
    const rightOwner = MANIFEST.employees.find((e) => e.key === account.owner).id;
    await q(`UPDATE eos_crm.accounts SET owner_employee_id = $2 WHERE id = $1`, [account.id, wrongOwner]);
    try {
      const r = apply();
      assert.equal(r.status, 1);
      const report = JSON.parse(r.stdout);
      assert.ok(report.drift.some((d) => d.id === account.id));
      assert.equal((await q(`SELECT owner_employee_id FROM eos_crm.accounts WHERE id = $1`, [account.id])).rows[0].owner_employee_id, wrongOwner);
    } finally {
      await q(`UPDATE eos_crm.accounts SET owner_employee_id = $2 WHERE id = $1`, [account.id, rightOwner]);
    }
  });

  // ════════════════ the verifier ════════════════

  let report;
  await t.test("the verifier passes and reports every section the contract requires", async () => {
    const r = verify();
    assert.equal(r.status, 0, r.stderr || r.stdout);
    report = JSON.parse(r.stdout);
    assert.equal(report.sampleCompanyVersion, 2);
    assert.equal(report.environment, "platform-sandbox");
    assert.equal(report.tenant.key, TENANT_KEY);
    assert.equal(report.mode, "verify");
    for (const key of ["domains", "personas", "scenarios", "relationships", "access", "drift", "blockers"]) {
      assert.ok(key in report, `the report is missing ${key}`);
    }
    assert.deepEqual(report.drift, []);
    assert.equal(report.pass, true);
    assert.equal(report.personas.length, MANIFEST.employees.length, "every Employee appears as a persona, access or not");
    assert.equal(report.relationships.expected, MANIFEST.relationshipAssertions.length);
    assert.equal(report.relationships.verified, MANIFEST.relationshipAssertions.length, JSON.stringify(report.relationships.assertions.filter((a) => a.status !== "VERIFIED")));
    assert.equal(report.relationships.blocked, MANIFEST.blockedRelationships.length);
    assert.ok(!r.stdout.includes(dbUrl()));
    assert.ok(!r.stdout.includes(":password@"));
    assert.ok(!r.stdout.includes("real-login-subject"), "the real administrator's credential subject was printed");
  });

  await t.test("the access section proves EFFECTIVE capability resolution, and proves the denials", async () => {
    const coverage = report.access.requiredCapabilityCoverage;
    assert.ok(coverage.expected > 0);
    assert.equal(coverage.held, coverage.expected, "a required capability did not resolve through the identity chain");
    assert.ok(report.access.forbiddenCapabilityCoverage.checked > 0);
    assert.equal(report.access.forbiddenCapabilityCoverage.violations, 0);
    assert.equal(report.access.missingGrants, 0);
    assert.ok(report.access.grants.length > 0);
    for (const g of report.access.grants) assert.ok("role" in g && "expectedCapability" in g && "liveGrant" in g && "status" in g);

    const technician = report.personas.find((p) => p.employeeKey === "service-technician-a");
    assert.equal(technician.resolved, true);
    assert.ok(technician.heldRoleKeys.includes("technician"));
    assert.ok(technician.forbiddenCapabilities.find((c) => c.capability === "admin.employeeProfile.write").held === false);
    const associate = report.personas.find((p) => p.employeeKey === "warehouse-associate");
    assert.ok(associate.forbiddenCapabilities.find((c) => c.capability === "inventory.cycleCount.reconcile").held === false);
    assert.ok(associate.requiredCapabilities.find((c) => c.capability === "inventory.cycleCount.submit").held === true);
    const salesperson = report.personas.find((p) => p.employeeKey === "retail-sales-a");
    assert.ok(salesperson.forbiddenCapabilities.find((c) => c.capability === "inventory.transfer.create").held === false);
    assert.ok(salesperson.forbiddenCapabilities.find((c) => c.capability === "inventory.stock.receive").held === false);
    assert.ok(salesperson.requiredCapabilities.find((c) => c.capability === "opportunity.write").held === true);
    // A technician resolves to an EMPTY effective set in this vocabulary -- reported as a gap, not glossed.
    assert.deepEqual(technician.requiredCapabilities, []);
    assert.equal(technician.accessModelGap, "TECHNICIAN_HOLDS_NO_POSTGRES_VOCABULARY_CAPABILITY");
    // ACCESS_MODEL_GAP findings are reported, not hidden.
    assert.ok(report.access.accessModelGaps.some((g) => g.persona === "national-accounts-sales"));
    assert.ok(report.access.capabilityVocabularyGap.count > 0, "the Role-catalog / PostgreSQL vocabulary gap must be reported");
    assert.equal(report.access.capabilityVocabularyGap.code, "CAPABILITY_VOCABULARY_PARTIAL");
  });

  await t.test("an ASSIGNED Role whose capabilities were never granted FAILS the verifier", async () => {
    // This is the failure the whole access section exists for: the assignment row is untouched, only the
    // grant is removed, so anything that checked "is the Role assigned" would still pass.
    const removed = (await q(
      `DELETE FROM eos_policy.role_capabilities rc USING eos_policy.roles r, eos_policy.capabilities c
        WHERE rc.role_id = r.id AND rc.capability_id = c.id AND r.key = 'salesperson' AND c.key = 'opportunity.write'
        RETURNING rc.id, rc.tenant_id, rc.role_id, rc.capability_id, rc.granted_by, rc.created_by, rc.updated_by`)).rows;
    assert.equal(removed.length, 1, "the fixture for this test did not exist");
    try {
      const r = verify();
      assert.equal(r.status, 1, "the verifier passed with a missing live grant");
      const broken = JSON.parse(r.stdout);
      assert.equal(broken.pass, false);
      assert.ok(broken.access.missingGrants > 0);
      assert.ok(broken.drift.some((d) => d.domain === "access.requiredCapability" && d.id.includes("opportunity.write")));
      // The assignment row is still there, which is exactly why the row alone proves nothing.
      const assignments = (await q(`SELECT count(*)::int AS n FROM eos_policy.user_role_assignments a
        JOIN eos_policy.roles r ON r.id = a.role_id WHERE r.key = 'salesperson' AND a.status = 'active'`)).rows[0].n;
      assert.ok(assignments > 0);
    } finally {
      const g = removed[0];
      await q(`INSERT INTO eos_policy.role_capabilities (id, tenant_id, role_id, capability_id, granted_by, created_by, updated_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`, [g.id, g.tenant_id, g.role_id, g.capability_id, g.granted_by, g.created_by, g.updated_by]);
    }
  });

  await t.test("the verifier fails on a WRONG MANAGER, a WRONG OWNER and a MISSING EMPLOYEE LINK", async () => {
    const dispatcher = MANIFEST.employees.find((e) => e.key === "dispatcher").id;
    const serviceManager = MANIFEST.employees.find((e) => e.key === "service-manager").id;
    const owner = MANIFEST.employees.find((e) => e.key === "owner-executive").id;

    // The reporting table REFUSES an in-place manager change (`employee_reporting_relationships keeps
    // history`), so the wrong manager is established the only way one can be -- through the governed
    // command -- and then put back the same way. That the trigger forces this is itself the point.
    const reassign = async (employeeId, managerEmployeeId) => {
      const pool2 = new pg.Pool({ connectionString: dbUrl(), max: 2 });
      try {
        const { establishReportingRelationship } = require("../lib/eosWorkforce/commands/reportingRelationshipCommands.js");
        await establishReportingRelationship({ pool: pool2 },
          { tenantId, principalId: adminPrincipalId, capabilities: new Set(["admin.employeeProfile.write"]) },
          { employeeId, managerEmployeeId, reason: "SAMPLE COMPANY V2 verifier proof" });
      } finally {
        await pool2.end();
      }
    };
    await reassign(dispatcher, owner);
    let r = verify();
    assert.equal(r.status, 1);
    assert.ok(JSON.parse(r.stdout).drift.some((d) => d.domain === "workforce.reportingRelationships"));
    await reassign(dispatcher, serviceManager);

    const account = MANIFEST.accounts[1];
    const rightOwner = MANIFEST.employees.find((e) => e.key === account.owner).id;
    await q(`UPDATE eos_crm.accounts SET owner_employee_id = $2 WHERE id = $1`, [account.id, owner]);
    r = verify();
    assert.equal(r.status, 1);
    assert.ok(JSON.parse(r.stdout).drift.some((d) => d.domain === "relationships"));
    await q(`UPDATE eos_crm.accounts SET owner_employee_id = $2 WHERE id = $1`, [account.id, rightOwner]);

    const link = (await q(`UPDATE eos_policy.employee_principal_links SET status = 'revoked' WHERE employee_id = $1 AND status = 'active' RETURNING id`, [dispatcher])).rows;
    assert.equal(link.length, 1);
    r = verify();
    assert.equal(r.status, 1);
    assert.ok(JSON.parse(r.stdout).drift.some((d) => d.domain === "identity.employeePrincipalLinks"));
    await q(`UPDATE eos_policy.employee_principal_links SET status = 'active' WHERE id = $1`, [link[0].id]);

    assert.equal(verify().status, 0, "the world was not restored");
  });

  await t.test("the verifier fails on a DANGLING reference rather than reading it as absent", async () => {
    const contact = MANIFEST.contacts[0];
    const row = (await q(`SELECT * FROM eos_crm.contacts WHERE id = $1`, [contact.id])).rows[0];
    await q(`DELETE FROM eos_crm.contacts WHERE id = $1`, [contact.id]);
    try {
      const r = verify();
      assert.equal(r.status, 1);
      const broken = JSON.parse(r.stdout);
      assert.ok(broken.relationships.assertions.some((a) => a.status === "DANGLING"));
      assert.equal(broken.domains["crm.contacts"].status, "PARTIAL");
    } finally {
      const columns = Object.keys(row);
      await q(`INSERT INTO eos_crm.contacts (${columns.map((c) => `"${c}"`).join(", ")})
               VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")})`, columns.map((c) => row[c]));
    }
    assert.equal(verify().status, 0);
  });

  await t.test("the verifier reports blockers as BLOCKED, never as verified", async () => {
    assert.equal(report.blockers.length, MANIFEST.blockedRelationships.length);
    for (const b of report.blockers) {
      assert.ok(b.code && b.desired && b.missingAuthority);
    }
    for (const code of ["WORK_ORDER_POSTGRES_AUTHORITY_ABSENT", "EMPLOYEE_ASSIGNEE_PROJECTION", "EMPLOYEE_TECHNICIAN_LINK_BLOCKED",
      "INVENTORY_RECEIPT_MOVEMENT_BLOCKED", "PARTS_POSTGRES_WRITER_INACTIVE", "FINANCIAL_SAMPLE_COVERAGE"]) {
      assert.ok(report.blockers.some((b) => b.code === code), `${code} must be reported`);
    }
    assert.equal(report.scenarios.find((s) => s.id === "D").verified, "BLOCKED");
    assert.equal(report.scenarios.find((s) => s.id === "A").verified, "VERIFIED");
    assert.equal(report.scenarios.find((s) => s.id === "H").verified, "VERIFIED");
  });

  await t.test("the verifier is READ ONLY -- it changed nothing", async () => {
    const before = await rowCounts();
    assert.equal(verify().status, 0);
    assert.deepEqual(await rowCounts(), before);
  });
});
