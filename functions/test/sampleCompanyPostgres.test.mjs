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
const { verifySampleCompany } = require("../scripts/verifySampleCompany.js");
const { activateSampleCompanyLogins, transitionEmployeeLink } = require("../scripts/sampleCompany/loginActivation.js");
const linkRepository = require("../lib/employeeIdentity/employeePrincipalLinkRepository.js");

/**
 * An in-memory stand-in for the sandbox Auth directory.
 *
 * The real adapter is firebase-admin/auth and needs a project, credentials and a network. The PHASE it feeds
 * is pure governed PostgreSQL work, so it takes the directory as a parameter and these tests hand it a
 * double -- which is what lets the whole login transition be proved offline, in this process, with no
 * Firebase anywhere. `hasPassword` is FALSE on a freshly created account, exactly as a passwordless account
 * behaves until the existing activate-missing tool runs.
 */
function fakeAuthDirectory(initial = []) {
  const accounts = new Map(initial.map((a) => [a.email, { disabled: false, hasPassword: false, ...a }]));
  let created = 0;
  return {
    projectId: "eos-platform-sandbox",
    accounts,
    get createdCount() { return created; },
    async findByEmail(email) { return accounts.get(email) ?? null; },
    /** READ ONLY, by uid -- how the reused real Administrator is proved without touching its credential. */
    async findByUid(uid) {
      for (const account of accounts.values()) if (account.uid === uid) return account;
      return null;
    },
    async createPasswordless({ email, displayName }) {
      if (accounts.has(email)) throw new Error("createPasswordless called for an account that already exists");
      created += 1;
      const account = { uid: `sbxuid-${created}-${email.split("@")[0]}`, email, displayName, disabled: false, hasPassword: false };
      accounts.set(email, account);
      return account;
    },
    /** What the EXISTING scripts/activateSandboxPersonas.js --activate-missing tool would do. */
    activateMissingPasswords(emailAllowlist) {
      const allowlist = emailAllowlist ? new Set(emailAllowlist) : null;
      let activated = 0;
      for (const account of accounts.values()) {
        if (allowlist && !allowlist.has(account.email)) continue;
        if (!account.hasPassword) { account.hasPassword = true; activated += 1; }
      }
      return activated;
    },
  };
}

const INTERACTIVE = MANIFEST.principals.filter((p) => !p.existingAdministrator);
const activationOptions = (apply) => ({ tenantKey: TENANT_KEY, performedBy: "sample-company-proof", existingAdminPrincipalId: adminPrincipalId, apply });

async function withPool(fn) {
  const pool = new pg.Pool({ connectionString: dbUrl(), max: 2 });
  try { return await fn(pool); } finally { await pool.end(); }
}

/**
 * Run the verifier IN PROCESS so the Auth probe can be injected. The CLI path is exercised separately with
 * --skipAuthProbe, which is the explicitly database-only report.
 */
async function verifyWith(authProbe, uidProbe = (uid) => authDirectory.findByUid(uid)) {
  const client = new pg.Client({ connectionString: dbUrl() });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET TRANSACTION READ ONLY");
    const report = await verifySampleCompany(
      client,
      { environmentId: "platform-sandbox", tenantKey: TENANT_KEY, existingAdminPrincipalId: adminPrincipalId },
      MANIFEST,
      authProbe,
      uidProbe,
    );
    await client.query("COMMIT");
    return report;
  } finally {
    await client.end();
  }
}

/**
 * The migration set this suite is written against, pinned BY NAME and by count -- never "latest".
 *
 * A bare `up` would run whatever happens to be in the directory, so a migration added later would silently
 * change what these assertions ran against. The name below is asserted to be the last file, and the runner is
 * then given that exact COUNT, so adding a migration fails here as a deliberate review rather than quietly
 * altering the world under the test. (`up <name>` is NOT used: node-pg-migrate reorders under it, which puts
 * migration 027 ahead of the 026 it depends on.)
 */
// Moved deliberately for 1759924800000 (CRM Account ownership handoffs + import receipt operation): an EMPTY append-only
// table and a widened command_receipts operation vocabulary. The seed writes neither; nothing asserted here changes.
// Moved deliberately for 1759968000000 (EMP-RT-W2 tenant <-> operating company authority): an EMPTY eos_policy table with
// no seed rows. The Sample Company seed writes nothing to it; nothing asserted here changes.
// Moved deliberately for 1760011200000 (EMP-RT-08 Job Role authority): an EMPTY catalog and assignment history plus one
// capability vocabulary row. The Sample Company seed writes neither; nothing asserted here changes.
const PINNED_LAST_MIGRATION = "1760011200000_employee-job-role-authority";
const PINNED_MIGRATION_COUNT = 31;

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
/** Module scope, because the module-scope `verifyWith` closes over it. */
let authDirectory;

const cli = (script, args, extraEnv = {}) =>
  spawnSync(process.execPath, ["--require", preloadPath, `scripts/${script}`,
    "--environment", "platform-sandbox", "--databaseUrlEnv", "SAMPLE_DB", ...args],
  { cwd: FUNCTIONS_DIR, encoding: "utf8", env: { ...env(), ...extraEnv }, maxBuffer: 64 * 1024 * 1024 });

const IDENTITY = () => ["--tenantKey", TENANT_KEY, "--existingAdminPrincipalId", adminPrincipalId, "--performedBy", "sample-company-proof"];
const plan = (extra = []) => cli("seedSampleCompany.js", [...IDENTITY(), ...extra]);
const apply = () => cli("seedSampleCompany.js", [...IDENTITY(), "--mode", "apply", "--apply"]);
const verify = () => cli("verifySampleCompany.js", [...IDENTITY(), "--skipAuthProbe"]);

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
    assert.deepEqual(planned.capabilityGrants.roleScope, [...new Set(MANIFEST.principals.flatMap((p) => p.securityRoles))].sort());
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

  await t.test("apply granted capabilities ONLY to Roles a manifest Principal names", async () => {
    const scope = new Set(MANIFEST.principals.flatMap((p) => p.securityRoles));
    const granted = (await q(`SELECT DISTINCT r.key FROM eos_policy.role_capabilities rc
      JOIN eos_policy.roles r ON r.id = rc.role_id WHERE rc.granted_by LIKE 'sample-company-v2:%'`)).rows.map((r) => r.key);
    assert.ok(granted.length > 0, "the apply granted nothing, so the scope proves nothing");
    assert.deepEqual(granted.filter((k) => !scope.has(k)), [], "a Role outside the manifest was granted a capability");
    for (const key of ["owner", "salesManager", "financeManager"]) {
      const n = (await q(`SELECT count(*)::int AS n FROM eos_policy.role_capabilities rc
        JOIN eos_policy.roles r ON r.id = rc.role_id WHERE r.key = $1`, [key])).rows[0].n;
      assert.equal(n, 0, `${key} is not a Sample Company Role and must hold no grant from its apply`);
    }
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

  // ════════════════ login activation: the phase that makes a persona real ════════════════

  await t.test("activate-logins DRY RUN creates no Auth account and writes nothing", async () => {
    const before = await rowCounts();
    authDirectory = fakeAuthDirectory([{ uid: "real-login-subject", email: "administrator@example.test", hasPassword: true }]);
    const report = await withPool((pool) => activateSampleCompanyLogins(pool, activationOptions(false), MANIFEST, authDirectory));
    assert.equal(report.applied, false);
    assert.equal(report.pass, true);
    assert.equal(authDirectory.createdCount, 0, "a dry run created a credential");
    assert.equal(authDirectory.accounts.size, 1, "only the pre-existing administrator account");
    assert.equal(report.summary.authAccountsCreated, INTERACTIVE.length, "the plan must say what it would create");
    assert.deepEqual(await rowCounts(), before);
  });

  await t.test("activate-logins builds the real chain: sandbox account -> firebase Principal -> link -> Employee", async () => {
    // The reused real Administrator already has its own Auth account; it is NEVER created, renamed or
    // re-credentialed here, only read. Its subject is the one the bootstrap gave it.
    authDirectory = fakeAuthDirectory([{ uid: "real-login-subject", email: "administrator@example.test", hasPassword: true }]);
    const report = await withPool((pool) => activateSampleCompanyLogins(pool, activationOptions(true), MANIFEST, authDirectory));
    assert.equal(report.pass, true, JSON.stringify(report.drift));
    assert.equal(report.identityProvider, "firebase");
    assert.equal(report.summary.authAccountsCreated, INTERACTIVE.length);
    assert.equal(report.summary.loginPrincipalsCreated, INTERACTIVE.length);
    assert.equal(report.summary.linksTransitioned, INTERACTIVE.length);
    assert.equal(report.summary.fixturePrincipalsRetired, INTERACTIVE.length);

    // THE PROVIDER THE RUNTIME RESOLVES. Every interactive persona now has a `firebase` Principal whose
    // subject is its Auth uid -- which is what a signed-in browser actually presents.
    for (const p of INTERACTIVE) {
      const employee = MANIFEST.employees.find((e) => e.key === p.employee);
      const account = authDirectory.accounts.get(p.loginPrincipal.credentialEmail);
      assert.ok(account, `${p.employee} has no sandbox account`);
      const rows = (await q(`SELECT pr.identity_provider, pr.external_subject, l.status
           FROM eos_policy.employee_principal_links l
           JOIN eos_policy.principals pr ON pr.id = l.principal_id
          WHERE l.employee_id = $1 AND l.status = 'active'`, [employee.id])).rows;
      assert.equal(rows.length, 1, `${p.employee} must have exactly one active link`);
      assert.equal(rows[0].identity_provider, "firebase");
      assert.equal(rows[0].external_subject, account.uid);
      // A uid is a credential subject, never a business identity.
      assert.notEqual(account.uid, employee.id);
    }
  });

  await t.test("the superseded fixture link is REVOKED, not deleted, and its Principal is retired", async () => {
    for (const p of INTERACTIVE) {
      const employee = MANIFEST.employees.find((e) => e.key === p.employee);
      const history = (await q(
        `SELECT l.status, pr.identity_provider FROM eos_policy.employee_principal_links l
           JOIN eos_policy.principals pr ON pr.id = l.principal_id
          WHERE l.employee_id = $1 ORDER BY l.created_at`, [employee.id])).rows;
      assert.equal(history.length, 2, `${p.employee} should carry both the fixture link and the login link`);
      assert.deepEqual(history.map((r) => r.status), ["revoked", "active"], "history was rewritten instead of preserved");
      assert.equal(history[0].identity_provider, "eos-synthetic-nonprod");
      assert.equal(history[1].identity_provider, "firebase");

      // The obsolete synthetic Principal no longer presents as an active user-access persona.
      const membership = (await q(
        `SELECT m.status FROM eos_policy.principals pr
           JOIN eos_policy.tenant_memberships m ON m.principal_id = pr.id
          WHERE pr.identity_provider = $1 AND pr.external_subject = $2`,
        ["eos-synthetic-nonprod", p.fixturePrincipal.externalSubject])).rows;
      assert.equal(membership.length, 1, "the Principal row itself must survive as history");
      assert.equal(membership[0].status, "disabled");
    }
    const audits = (await q(`SELECT count(*)::int AS n FROM eos_policy.audit_events WHERE action = 'sampleCompany.fixturePrincipal.retire'`)).rows[0].n;
    assert.equal(audits, INTERACTIVE.length, "every retirement writes an audit event");
  });

  await t.test("(10) the Security Roles moved to the AUTHENTICATING Principal", async () => {
    for (const p of INTERACTIVE) {
      const account = authDirectory.accounts.get(p.loginPrincipal.credentialEmail);
      const held = (await q(
        `SELECT r.key FROM eos_policy.user_role_assignments a
           JOIN eos_policy.principals pr ON pr.id = a.principal_id
           JOIN eos_policy.roles r ON r.id = a.role_id
          WHERE pr.identity_provider = 'firebase' AND pr.external_subject = $1 AND a.status = 'active'
          ORDER BY r.key`, [account.uid])).rows.map((r) => r.key);
      assert.deepEqual(held, [...p.securityRoles].sort(), `${p.employee} Security Roles on the login Principal`);
    }
  });

  await t.test("activate-logins is idempotent and REUSES an existing Auth account", async () => {
    const before = await rowCounts();
    const createdBefore = authDirectory.createdCount;
    const report = await withPool((pool) => activateSampleCompanyLogins(pool, activationOptions(true), MANIFEST, authDirectory));
    assert.equal(report.pass, true);
    assert.equal(authDirectory.createdCount, createdBefore, "a rerun created a second Auth account");
    assert.equal(report.summary.authAccountsReused, INTERACTIVE.length);
    assert.equal(report.summary.authAccountsCreated, 0);
    assert.equal(report.summary.linksTransitioned, 0);
    // +1 for the reused real administrator, whose link is already correct and is never transitioned.
    assert.equal(report.summary.linksAlreadyCorrect, INTERACTIVE.length + 1);
    assert.equal(report.summary.fixturePrincipalsAlreadyRetired, INTERACTIVE.length);
    assert.equal(report.summary.credentialsTouched, 0, "the Sample Company touched a credential");
    assert.deepEqual(await rowCounts(), before);
  });

  await t.test("a BUSINESS apply after login activation does not resurrect the retired fixture Principals", async () => {
    // The apply phase seeds fixture Principals. Once they have been superseded it must leave them retired,
    // or every activation would be undone by the next ordinary reseed.
    const r = apply();
    assert.equal(r.status, 0, r.stderr);
    const report = JSON.parse(r.stdout);
    assert.equal(report.pass, true);
    const stillDisabled = (await q(
      `SELECT count(*)::int AS n FROM eos_policy.principals pr
         JOIN eos_policy.tenant_memberships m ON m.principal_id = pr.id
        WHERE pr.identity_provider = 'eos-synthetic-nonprod' AND m.status = 'disabled'`)).rows[0].n;
    assert.equal(stillDisabled, INTERACTIVE.length, "an ordinary business apply re-activated a retired fixture Principal");
    for (const p of INTERACTIVE) {
      const employee = MANIFEST.employees.find((e) => e.key === p.employee);
      const active = (await q(
        `SELECT pr.identity_provider FROM eos_policy.employee_principal_links l
           JOIN eos_policy.principals pr ON pr.id = l.principal_id
          WHERE l.employee_id = $1 AND l.status = 'active'`, [employee.id])).rows;
      assert.equal(active.length, 1);
      assert.equal(active[0].identity_provider, "firebase", "the business apply moved the link back to the fixture Principal");
    }
  });

  await t.test("(8) no-access Employees got no Auth account, no Principal and no link", async () => {
    for (const key of Object.keys(MANIFEST.expectedAccess.noAccessPersonas)) {
      const employee = MANIFEST.employees.find((e) => e.key === key);
      assert.ok(!authDirectory.accounts.has(employee.workEmail), `${key} was given a credential merely because the Employee exists`);
      const links = (await q(`SELECT count(*)::int AS n FROM eos_policy.employee_principal_links WHERE employee_id = $1`, [employee.id])).rows[0].n;
      assert.equal(links, 0, `${key} has a Principal link`);
    }
  });

  await t.test("(9) a FAILED link transition rolls back and leaves the Employee's prior link ACTIVE", async () => {
    // THE FAILURE THIS TRANSACTION EXISTS TO PREVENT. Revoke and establish are two writes to one fact --
    // which Principal this Employee currently IS. Run as separate commits, a failure between them leaves the
    // Employee with no active Principal at all: unable to log in, and invisible to every read that resolves
    // through the link. Here the establish step is forced to fail at exactly that moment.
    const employee = MANIFEST.employees.find((e) => e.key === "dispatcher");
    const before = (await q(
      `SELECT id, principal_id, status FROM eos_policy.employee_principal_links
        WHERE employee_id = $1 ORDER BY created_at`, [employee.id])).rows;
    const activeBefore = before.filter((r) => r.status === "active");
    assert.equal(activeBefore.length, 1);

    // A different Principal to move to -- the Owner/Executive's is already linked elsewhere, so use a
    // freshly created one that is a legitimate transition target.
    const target = await withPool(async (pool) => {
      const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");
      const { ensureTenantPrincipal } = require("../lib/adminPolicy/tenantBootstrap.js");
      const repo = new PostgresPolicyRepository(pool);
      const roles = await repo.listRoles(tenantId);
      const keyById = new Map(roles.map((r) => [r.id, r.key]));
      const adminRoleKeys = (await repo.listAssignmentsForPrincipal(tenantId, adminPrincipalId))
        .filter((a) => a.status === "active").map((a) => keyById.get(a.roleId)).filter(Boolean);
      return ensureTenantPrincipal(repo, {
        tenantId, externalSubject: "rollback-proof-subject", identityProvider: "firebase",
        displayName: "SAMPLE COMPANY V2 rollback proof", actorUid: "proof", actorRoleKeys: adminRoleKeys,
      });
    });

    const boom = new Error("forced failure between revoke and establish");
    await assert.rejects(
      () => withPool((pool) => transitionEmployeeLink(pool, linkRepository, {
        tenantId, employeeId: employee.id, toPrincipalId: target.id,
        operatingCompanyId: MANIFEST.company.operatingCompanyId, assertedBy: "proof",
      }, { failBeforeEstablish: async () => { throw boom; } })),
      (err) => err === boom,
    );

    // ROLLED BACK: the prior link is still ACTIVE, there is still exactly one, and no new row was written.
    const after = (await q(
      `SELECT id, principal_id, status FROM eos_policy.employee_principal_links
        WHERE employee_id = $1 ORDER BY created_at`, [employee.id])).rows;
    assert.deepEqual(after, before, "the failed transition left a trace");
    assert.equal(after.filter((r) => r.status === "active").length, 1, "the Employee was left with no active Principal");
    assert.equal(after.filter((r) => r.status === "active")[0].principal_id, activeBefore[0].principal_id);
    assert.ok(!after.some((r) => r.principal_id === target.id), "a link to the failed target survived");
  });

  await t.test("(10) a SUCCESSFUL transition leaves exactly one active link and retains the revoked history", async () => {
    const employee = MANIFEST.employees.find((e) => e.key === "dispatcher");
    const originalPrincipal = (await q(
      `SELECT principal_id FROM eos_policy.employee_principal_links WHERE employee_id = $1 AND status = 'active'`,
      [employee.id])).rows[0].principal_id;
    const target = (await q(`SELECT id FROM eos_policy.principals WHERE external_subject = $1`, ["rollback-proof-subject"])).rows[0];

    const outcome = await withPool((pool) => transitionEmployeeLink(pool, linkRepository, {
      tenantId, employeeId: employee.id, toPrincipalId: target.id,
      operatingCompanyId: MANIFEST.company.operatingCompanyId, assertedBy: "proof",
    }));
    assert.equal(outcome, "TRANSITIONED");

    const rows = (await q(
      `SELECT principal_id, status FROM eos_policy.employee_principal_links WHERE employee_id = $1 ORDER BY created_at`,
      [employee.id])).rows;
    assert.equal(rows.filter((r) => r.status === "active").length, 1, "exactly one active link");
    assert.equal(rows.find((r) => r.status === "active").principal_id, target.id);
    // HISTORY IS RETAINED, not deleted: the previous link is still there, marked revoked.
    assert.ok(rows.some((r) => r.principal_id === originalPrincipal && r.status === "revoked"),
      "the superseded link was deleted instead of revoked");
    assert.ok(rows.length >= 3, "each transition appends rather than replaces");

    // A repeat is a no-op rather than a second transition.
    assert.equal(await withPool((pool) => transitionEmployeeLink(pool, linkRepository, {
      tenantId, employeeId: employee.id, toPrincipalId: target.id,
      operatingCompanyId: MANIFEST.company.operatingCompanyId, assertedBy: "proof",
    })), "ALREADY_ACTIVE");

    // Put the world back: the dispatcher belongs to its own login Principal.
    await withPool((pool) => transitionEmployeeLink(pool, linkRepository, {
      tenantId, employeeId: employee.id, toPrincipalId: originalPrincipal,
      operatingCompanyId: MANIFEST.company.operatingCompanyId, assertedBy: "proof",
    }));
    assert.equal((await q(
      `SELECT principal_id FROM eos_policy.employee_principal_links WHERE employee_id = $1 AND status = 'active'`,
      [employee.id])).rows[0].principal_id, originalPrincipal);
  });

  // ════════════════ the verifier ════════════════

  let report;
  await t.test("the verifier passes only once every interactive persona is LOGIN READY", async () => {
    // Accounts exist but are still PASSWORDLESS -- exactly the state activate-logins leaves them in. The
    // governed half is complete; the credential half is not, and the verifier must not round that up.
    const passwordless = await verifyWith((email) => authDirectory.findByEmail(email));
    assert.equal(passwordless.pass, false, "a persona with no sign-in credential was reported usable");
    assert.ok(passwordless.drift.some((d) => d.domain === "access.sandboxAuthAccount"));
    assert.ok(passwordless.personas.every((p) => !p.interactiveLogin || p.authorizationReady),
      "the governed half should already be complete");
    // Exactly ONE persona is login-ready at this point: the reused real administrator, whose credential is
    // real, pre-existing and deliberately untouched. The fourteen sandbox personas have accounts but no way
    // to sign in yet, and the report says so rather than averaging it away.
    assert.equal(passwordless.loginReadiness.interactivePersonas, INTERACTIVE.length + 1);
    assert.equal(passwordless.loginReadiness.loginReady, 1);
    assert.equal(passwordless.loginReadiness.authorizationReady, passwordless.loginReadiness.interactivePersonas);
    assert.equal(passwordless.personas.find((p) => p.employeeKey === "owner-executive").loginReady, true);

    // Now the EXISTING activate-missing tool's effect: a password only where there was none.
    assert.equal(authDirectory.activateMissingPasswords(INTERACTIVE.map((p) => p.loginPrincipal.credentialEmail)), INTERACTIVE.length);
    report = await verifyWith((email) => authDirectory.findByEmail(email));
    assert.equal(report.pass, true, JSON.stringify(report.drift));
    assert.equal(report.sampleCompanyVersion, 2);
    assert.equal(report.mode, "verify");
    for (const key of ["domains", "personas", "scenarios", "relationships", "access", "drift", "blockers", "loginReadiness"]) {
      assert.ok(key in report, `the report is missing ${key}`);
    }
    assert.equal(report.loginReadiness.identityProvider, "firebase");
    assert.equal(report.loginReadiness.authProbe, "PERFORMED");
    assert.equal(report.loginReadiness.loginReady, report.loginReadiness.interactivePersonas);
    assert.equal(report.personas.length, MANIFEST.employees.length);
    assert.equal(report.relationships.verified, MANIFEST.relationshipAssertions.length,
      JSON.stringify(report.relationships.assertions.filter((a) => a.status !== "VERIFIED")));
  });

  await t.test("every persona result carries the full contract shape, and no report echoes a subject", async () => {
    for (const persona of report.personas) {
      for (const field of ["interactiveLogin", "loginReady", "authorizationReady", "employeeLink", "securityRoles",
        "requiredCapabilities", "missingCapabilities", "forbiddenCapabilityViolations", "accessModelGap"]) {
        assert.ok(field in persona, `${persona.employeeKey} is missing ${field}`);
      }
      if (persona.subjectFingerprint) assert.match(persona.subjectFingerprint, /^subject:[0-9a-f]{12}$/);
    }
    const serialized = JSON.stringify(report);
    for (const account of authDirectory.accounts.values()) {
      assert.ok(!serialized.includes(account.uid), "the report echoed a raw credential subject");
    }
    assert.ok(!serialized.includes("real-login-subject"), "the report echoed the administrator's subject");
    assert.ok(!serialized.includes(":password@"));
  });

  await t.test("(11)(12) the reused Administrator is LOGIN_READY only when a real read-only Auth probe proves it", async () => {
    const administrator = report.personas.find((p) => p.employeeKey === "owner-executive");
    assert.equal(administrator.interactiveLogin, true);
    assert.equal(administrator.authAccount, "REUSED_EXISTING_ADMINISTRATOR");
    assert.equal(administrator.loginReady, true);
    assert.match(administrator.subjectFingerprint, /^subject:[0-9a-f]{12}$/);

    // (11) WITHOUT the probe it must NOT claim readiness, even though every governed fact is unchanged.
    const unprobed = await verifyWith((e) => authDirectory.findByEmail(e), null);
    const unprobedAdmin = unprobed.personas.find((p) => p.employeeKey === "owner-executive");
    assert.equal(unprobedAdmin.authorizationReady, true, "the governed half is unaffected");
    assert.equal(unprobedAdmin.authAccount, "AUTH_NOT_PROBED");
    assert.equal(unprobedAdmin.loginReady, false);
    assert.equal(unprobed.pass, false);
    assert.equal(unprobed.loginReadiness.administratorUidProbe, "NOT_PERFORMED");

    // (12) a MISSING Administrator Auth account cannot report LOGIN_READY.
    const account = authDirectory.accounts.get("administrator@example.test");
    authDirectory.accounts.delete("administrator@example.test");
    try {
      const missing = await verifyWith((e) => authDirectory.findByEmail(e));
      const missingAdmin = missing.personas.find((p) => p.employeeKey === "owner-executive");
      assert.equal(missingAdmin.authAccount, "MISSING");
      assert.equal(missingAdmin.loginReady, false);
      assert.equal(missing.pass, false);
    } finally {
      authDirectory.accounts.set("administrator@example.test", account);
    }

    // ...and neither can a DISABLED one.
    account.disabled = true;
    try {
      const disabled = await verifyWith((e) => authDirectory.findByEmail(e));
      const disabledAdmin = disabled.personas.find((p) => p.employeeKey === "owner-executive");
      assert.equal(disabledAdmin.authAccount, "DISABLED");
      assert.equal(disabledAdmin.loginReady, false);
      assert.equal(disabled.pass, false);
    } finally {
      account.disabled = false;
    }

    // ...nor one with no sign-in credential.
    account.hasPassword = false;
    try {
      const noCredential = await verifyWith((e) => authDirectory.findByEmail(e));
      assert.equal(noCredential.personas.find((p) => p.employeeKey === "owner-executive").authAccount, "NO_SIGN_IN_CREDENTIAL");
      assert.equal(noCredential.pass, false);
    } finally {
      account.hasPassword = true;
    }

    // The Administrator's credential was only ever READ: the probe has no write path at all.
    assert.equal(authDirectory.createdCount, INTERACTIVE.length, "the Administrator account was created or recreated");
    assert.equal((await verifyWith((e) => authDirectory.findByEmail(e))).pass, true);
  });

  await t.test("(16) the verifier FAILS when a persona is interactive but not login-ready", async () => {
    // Nothing about the database changes -- only the credential half. The governed chain is still perfect,
    // and the verification must still not pass, because nobody can actually sign in as this persona.
    const email = INTERACTIVE[0].loginPrincipal.credentialEmail;
    const account = authDirectory.accounts.get(email);
    const restore = { ...account };
    account.hasPassword = false;
    try {
      const broken = await verifyWith((e) => authDirectory.findByEmail(e));
      assert.equal(broken.pass, false);
      const persona = broken.personas.find((p) => p.credentialEmail === email);
      assert.equal(persona.authorizationReady, true, "the governed half should be unaffected");
      assert.equal(persona.loginReady, false);
      assert.equal(persona.authAccount, "NO_SIGN_IN_CREDENTIAL");
      assert.ok(broken.drift.some((d) => d.domain === "access.loginReady"));
    } finally {
      Object.assign(account, restore);
    }
    assert.equal((await verifyWith((e) => authDirectory.findByEmail(e))).pass, true);
  });

  await t.test("(18) the verifier FAILS on a MISSING sandbox Auth account", async () => {
    const email = INTERACTIVE[1].loginPrincipal.credentialEmail;
    const account = authDirectory.accounts.get(email);
    authDirectory.accounts.delete(email);
    try {
      const broken = await verifyWith((e) => authDirectory.findByEmail(e));
      assert.equal(broken.pass, false);
      const persona = broken.personas.find((p) => p.credentialEmail === email);
      assert.equal(persona.authAccount, "MISSING");
      assert.equal(persona.loginReady, false);
    } finally {
      authDirectory.accounts.set(email, account);
    }
    assert.equal((await verifyWith((e) => authDirectory.findByEmail(e))).pass, true);
  });

  await t.test("(19) the verifier FAILS on a DISABLED sandbox Auth account", async () => {
    const email = INTERACTIVE[2].loginPrincipal.credentialEmail;
    const account = authDirectory.accounts.get(email);
    account.disabled = true;
    try {
      const broken = await verifyWith((e) => authDirectory.findByEmail(e));
      assert.equal(broken.pass, false);
      const persona = broken.personas.find((p) => p.credentialEmail === email);
      assert.equal(persona.authAccount, "DISABLED");
      assert.equal(persona.loginReady, false);
    } finally {
      account.disabled = false;
    }
    assert.equal((await verifyWith((e) => authDirectory.findByEmail(e))).pass, true);
  });

  await t.test("(17) the verifier FAILS when the Principal carries the wrong provider or the wrong subject", async () => {
    const persona = INTERACTIVE[3];
    const employee = MANIFEST.employees.find((e) => e.key === persona.employeeKey ?? persona.employee);
    const account = authDirectory.accounts.get(persona.loginPrincipal.credentialEmail);

    // WRONG SUBJECT: the Auth account's uid moves, so the token a browser presents would resolve to nothing.
    const originalUid = account.uid;
    account.uid = `${originalUid}-rotated`;
    let broken = await verifyWith((e) => authDirectory.findByEmail(e));
    assert.equal(broken.pass, false, "a Principal whose subject no longer matches the Auth account passed");
    assert.ok(broken.drift.some((d) => d.domain === "access.resolution" || d.domain === "identity.employeePrincipalLinks"));
    account.uid = originalUid;
    assert.equal((await verifyWith((e) => authDirectory.findByEmail(e))).pass, true);

    // WRONG PROVIDER: the Principal is moved to the non-authenticating provider. Nothing else changes --
    // the link, the Roles and the grants are all still there -- and it must still fail, because no verifier
    // recognizes that provider and the persona could never sign in.
    const moved = (await q(
      `UPDATE eos_policy.principals SET identity_provider = 'eos-synthetic-nonprod'
        WHERE identity_provider = 'firebase' AND external_subject = $1 RETURNING id`, [account.uid])).rows;
    assert.equal(moved.length, 1);
    try {
      broken = await verifyWith((e) => authDirectory.findByEmail(e));
      assert.equal(broken.pass, false, "a persona routed through a non-authenticating provider passed");
    } finally {
      await q(`UPDATE eos_policy.principals SET identity_provider = 'firebase' WHERE id = $1`, [moved[0].id]);
    }
    assert.equal((await verifyWith((e) => authDirectory.findByEmail(e))).pass, true);
    void employee;
  });

  await t.test("the CLI --skipAuthProbe report is explicitly database-only and does NOT pass", async () => {
    const r = verify();
    assert.equal(r.status, 1, "a database-only report must not claim the personas are usable");
    const dbOnly = JSON.parse(r.stdout);
    assert.equal(dbOnly.loginReadiness.authProbe, "NOT_PERFORMED");
    assert.equal(dbOnly.loginReadiness.loginReady, 0);
    assert.equal(dbOnly.pass, false);
    // The governed half is still fully reported, which is what makes the mode useful.
    assert.equal(dbOnly.domains["identity.loginPrincipals"].status, "COMPLETE");
    assert.equal(dbOnly.domains["identity.retiredFixturePrincipals"].status, "COMPLETE");
    assert.ok(dbOnly.drift.every((d) => d.domain === "access.loginReady"),
      `a database-only run found non-credential drift: ${JSON.stringify(dbOnly.drift)}`);
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
      // The ASSIGNMENT row is untouched -- which is exactly why an assignment row proves nothing.
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
    let broken = await verifyWith((e) => authDirectory.findByEmail(e));
    assert.equal(broken.pass, false);
    assert.ok(broken.drift.some((d) => d.domain === "workforce.reportingRelationships"));
    await reassign(dispatcher, serviceManager);

    const account = MANIFEST.accounts[1];
    const rightOwner = MANIFEST.employees.find((e) => e.key === account.owner).id;
    await q(`UPDATE eos_crm.accounts SET owner_employee_id = $2 WHERE id = $1`, [account.id, owner]);
    broken = await verifyWith((e) => authDirectory.findByEmail(e));
    assert.equal(broken.pass, false);
    assert.ok(broken.drift.some((d) => d.domain === "relationships"));
    await q(`UPDATE eos_crm.accounts SET owner_employee_id = $2 WHERE id = $1`, [account.id, rightOwner]);

    const link = (await q(`UPDATE eos_policy.employee_principal_links SET status = 'revoked' WHERE employee_id = $1 AND status = 'active' RETURNING id`, [dispatcher])).rows;
    assert.equal(link.length, 1);
    broken = await verifyWith((e) => authDirectory.findByEmail(e));
    assert.equal(broken.pass, false);
    assert.ok(broken.drift.some((d) => d.domain === "identity.employeePrincipalLinks"));
    await q(`UPDATE eos_policy.employee_principal_links SET status = 'active' WHERE id = $1`, [link[0].id]);

    assert.equal((await verifyWith((e) => authDirectory.findByEmail(e))).pass, true, "the world was not restored");
  });

  await t.test("the verifier fails on a DANGLING reference rather than reading it as absent", async () => {
    const contact = MANIFEST.contacts[0];
    const row = (await q(`SELECT * FROM eos_crm.contacts WHERE id = $1`, [contact.id])).rows[0];
    await q(`DELETE FROM eos_crm.contacts WHERE id = $1`, [contact.id]);
    try {
      const broken = await verifyWith((e) => authDirectory.findByEmail(e));
      assert.equal(broken.pass, false);
      assert.ok(broken.relationships.assertions.some((a) => a.status === "DANGLING"));
      assert.equal(broken.domains["crm.contacts"].status, "PARTIAL");
    } finally {
      const columns = Object.keys(row);
      await q(`INSERT INTO eos_crm.contacts (${columns.map((c) => `"${c}"`).join(", ")})
               VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")})`, columns.map((c) => row[c]));
    }
    assert.equal((await verifyWith((e) => authDirectory.findByEmail(e))).pass, true);
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
    assert.equal((await verifyWith((e) => authDirectory.findByEmail(e))).pass, true);
    verify();
    assert.deepEqual(await rowCounts(), before);
  });
});
