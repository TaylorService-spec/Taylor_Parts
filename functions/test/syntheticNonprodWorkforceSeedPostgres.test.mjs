// THE GOVERNED SYNTHETIC NONPROD SEED against a real postgres:16 -- seeded through the governed writers into a
// world stood up by the real tenant bootstrap, re-run for idempotence, and then MEASURED by the three
// measurement CLIs the nonprod operator runs. The acceptance characteristics asserted here are the Owner's.
//
// Its OWN database (the measurements count globally), migrated by the normal runner and dropped afterwards.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
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
const { MANIFEST } = require("../scripts/seedSyntheticNonprodWorkforce.js");

const DB_NAME = `synthetic_seed_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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

// A preload that fails the process if anything resolves a Firebase module.
const SENTINEL = "SYNTHETIC_SEED_LOADED_FIREBASE";
const preloadPath = join(mkdtempSync(join(tmpdir(), "synthetic-seed-")), "preload.cjs");
writeFileSync(
  preloadPath,
  `const Module = require("module"); const load = Module._load;
   Module._load = function (request, ...rest) {
     if (/firebase/i.test(request)) { process.stderr.write("${SENTINEL}:" + request + "\\n"); process.exit(97); }
     return load.call(this, request, ...rest);
   };`,
);

const TENANT_KEY = "taylor-nonprod";
const env = { ...process.env, SEED_DB: dbUrl(), EOS_ENVIRONMENT: "nonprod" };
const cli = (script, args) =>
  spawnSync(process.execPath, ["--require", preloadPath, `scripts/${script}`, "--environment", "platform-sandbox", "--databaseUrlEnv", "SEED_DB", ...args], {
    cwd: FUNCTIONS_DIR,
    encoding: "utf8",
    env,
  });

let adminPrincipalId;
const seed = () => cli("seedSyntheticNonprodWorkforce.js", ["--tenantKey", TENANT_KEY, "--existingAdminPrincipalId", adminPrincipalId, "--performedBy", "synthetic-seed-proof"]);

const SEEDED_RELATIONS = [
  "eos_workforce.employees",
  "eos_policy.principals",
  "eos_policy.tenant_memberships",
  "eos_policy.employee_principal_links",
  "eos_policy.user_role_assignments",
  "eos_crm.accounts",
  "eos_crm.contacts",
  "eos_crm.account_locations",
  "eos_commercial.opportunities",
  "eos_commercial.sales_agreements",
  "eos_commercial.sales_orders",
];
async function rowCounts() {
  const out = {};
  for (const rel of SEEDED_RELATIONS) out[rel] = (await q(`SELECT count(*)::int AS n FROM ${rel}`)).rows[0].n;
  return out;
}

test("governed synthetic nonprod seed, in PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${DB_NAME}`));
  t.after(() => withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`)));
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"], {
    cwd: FUNCTIONS_DIR,
    env: { ...process.env, DATABASE_URL: dbUrl() },
    stdio: "pipe",
  });

  // The world the nonprod operator already has: a bootstrapped tenant with its seeded Roles and ONE real
  // administrator Principal (a firebase subject). Stood up by the real bootstrap, not by hand.
  const pool = new pg.Pool({ connectionString: dbUrl(), max: 2 });
  try {
    const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");
    const { bootstrapTenant, bootstrapAdministrator } = require("../lib/adminPolicy/tenantBootstrap.js");
    const repo = new PostgresPolicyRepository(pool);
    const { tenant } = await bootstrapTenant(repo, { key: TENANT_KEY, name: "Synthetic proof tenant", actorUid: "proof" });
    const admin = await bootstrapAdministrator(repo, { tenantId: tenant.id, externalSubject: "real-login-subject", performedBy: "proof" });
    adminPrincipalId = admin.principal.id;
  } finally {
    await pool.end();
  }

  await t.test("the fence refuses this same database without the nonprod runtime marker, before writing", async () => {
    const before = await rowCounts();
    const r = spawnSync(process.execPath, ["scripts/seedSyntheticNonprodWorkforce.js", "--environment", "platform-sandbox", "--databaseUrlEnv", "SEED_DB",
      "--tenantKey", TENANT_KEY, "--existingAdminPrincipalId", adminPrincipalId, "--performedBy", "x"], { cwd: FUNCTIONS_DIR, encoding: "utf8", env: { ...env, EOS_ENVIRONMENT: "local" } });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /EOS_ENVIRONMENT must read exactly 'nonprod'/);
    assert.deepEqual(await rowCounts(), before);
  });

  await t.test("a Principal that cannot administer is refused -- the seed asserts no authority of its own", async () => {
    const r = cli("seedSyntheticNonprodWorkforce.js", ["--tenantKey", TENANT_KEY, "--existingAdminPrincipalId", "no-such-principal", "--performedBy", "x"]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /ADMINISTRATOR_INVALID/);
    assert.equal((await q("SELECT count(*)::int AS n FROM eos_workforce.employees")).rows[0].n, 0);
  });

  let first;
  await t.test("the first run seeds through the governed writers, loading no Firebase module", async () => {
    const r = seed();
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stderr, new RegExp(SENTINEL));
    first = JSON.parse(r.stdout);
    assert.deepEqual(first.summary, {
      employees: { created: 16, existing: 0 },
      principals: { created: 7, existing: 0 },
      links: { created: 8, existing: 0 },
      // The real administrator already holds admin from the bootstrap: reused, not re-granted.
      roleAssignments: { created: 7, existing: 1 },
      accounts: { created: 2, existing: 0 },
      contacts: { created: 2, existing: 0 },
      locations: { created: 2, existing: 0 },
      commercial: { created: 8, existing: 0 },
      accountablePersons: { persisted: 8, existing: 0 },
    });
    assert.equal(first.eligibilityPolicyId, "COMMERCIAL_ACCOUNTABILITY_ELIGIBILITY_V1");
    assert.match(first.jobRoleAuthority, /Job Role authority is NOT YET IMPLEMENTED in PostgreSQL/);
    assert.ok(!r.stdout.includes(dbUrl()), "the connection string was printed");
  });

  await t.test("(2) a deterministic rerun creates NOTHING and duplicates NOTHING", async () => {
    const before = await rowCounts();
    const r = seed();
    assert.equal(r.status, 0, r.stderr);
    const again = JSON.parse(r.stdout);
    for (const [bucket, counts] of Object.entries(again.summary)) {
      const created = counts.created ?? counts.persisted;
      assert.equal(created, 0, `${bucket} created ${created} on a rerun`);
    }
    assert.deepEqual(await rowCounts(), before);
  });

  await t.test("(6) Principal != Employee, and an Employee does not need a Principal to exist", async () => {
    const principals = (await q("SELECT id, identity_provider FROM eos_policy.principals")).rows;
    const employees = (await q("SELECT id FROM eos_workforce.employees")).rows.map((r) => r.id);
    for (const p of principals) assert.ok(!employees.includes(p.id));
    assert.deepEqual(
      principals.map((p) => p.identity_provider).sort(),
      ["eos-synthetic-nonprod", "eos-synthetic-nonprod", "eos-synthetic-nonprod", "eos-synthetic-nonprod", "eos-synthetic-nonprod", "eos-synthetic-nonprod", "eos-synthetic-nonprod", "firebase"],
    );
    const unlinked = (await q(`SELECT count(*)::int AS n FROM eos_workforce.employees e WHERE NOT EXISTS
      (SELECT 1 FROM eos_policy.employee_principal_links l WHERE l.employee_id = e.id AND l.status = 'active')`)).rows[0].n;
    assert.equal(unlinked, 8);
    const adminLink = (await q("SELECT employee_id FROM eos_policy.employee_principal_links WHERE principal_id = $1 AND status = 'active'", [adminPrincipalId])).rows;
    assert.deepEqual(adminLink, [{ employee_id: "synthetic-np-emp-owner-executive" }], "the real administrator was not reused for Owner / Executive");
    const employeeColumns = (await q(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'eos_workforce' AND table_name = 'employees' ORDER BY 1`)).rows.map((r) => r.column_name);
    // The later Employee profile migration (Owner ruling C) adds typed profile facts; none is a Job Role or identity column.
    for (const c of ["created_at", "employment_status", "id", "operating_company_id", "tenant_id", "updated_at"]) assert.ok(employeeColumns.includes(c), c);
    assert.deepEqual(employeeColumns.filter((c) => /role|uid|firebase|principal|subject|provider|operational|technician/.test(c)), [], "(5) a Job Role or identity column reached the Employee table");
  });

  await t.test("C/D/G/H: the workforce measurement meets the acceptance characteristics", async () => {
    const r = cli("measureWorkforceActivation.js", []);
    assert.equal(r.status, 0, r.stderr);
    const { sections, unmeasured } = JSON.parse(r.stdout);
    assert.deepEqual(unmeasured, []);

    const c = sections.employeePopulation;
    assert.equal(c.total, 16);
    assert.deepEqual(c.byLifecycleStatus, { ACTIVE: 14, ON_LEAVE: 1, INACTIVE: 0, TERMINATED: 0, RETIRED: 0, CONTRACTOR: 1 });
    assert.equal(c.authorityQuality.lifecycleVocabularyMatchesGoverned, true, "(3)");
    for (const k of ["malformedIdNotResolvableByPort", "malformedOperatingCompany", "tenantNotDeclared", "duplicateEmployeeIds"]) assert.equal(c.authorityQuality[k], 0, k);

    const d = sections.employeePrincipalLinkage;
    assert.equal(d.links.active, 8);
    assert.equal(d.employees.withActivePrincipalLink, 8);
    assert.equal(d.employees.withoutActivePrincipalLink, 8);
    assert.equal(d.principals.total, 8);
    for (const [k, v] of Object.entries(d.anomalies)) assert.equal(v, 0, `(9) link anomaly ${k}`);

    const g = sections.ownerVersusAccountable;
    const total = (key) => g.families.reduce((a, f) => a + f.counts[key], 0);
    assert.equal(g.families.reduce((a, f) => a + f.total, 0), 8);
    assert.ok(total("samePerson") > 0, "(13)");
    assert.ok(total("differentPerson") > 0, "(14)");
    assert.equal(total("ownerPresentAccountableMissing") + total("bothAbsent") + total("accountablePresentOwnerMissing"), 0);
    for (const f of g.families) assert.deepEqual(f.assigneeColumns, [], "assignment is outside the commercial persistence proof");

    const h = sections.securityRoleOccupancy;
    assert.equal(h.employees.uniqueWithActiveSecurityRole, 8);
    for (const [k, v] of Object.entries(h.anomalies)) assert.equal(v, 0, `(8) assignment anomaly ${k}`);
    const occupied = h.roles.occupancy.filter((role) => role.activeAssignments > 0).map((role) => role.roleKey).sort();
    assert.deepEqual(occupied, ["admin", "dispatcher", "generalManager", "partsManager", "salesperson", "technician", "warehouseManager"]);
    assert.equal(h.roles.occupancy.find((role) => role.roleKey === "salesperson").activePrincipals, 2, "Retail and National Accounts share one Security Role");
    assert.ok(h.roles.withZeroActiveOccupants > 0, "zero-occupancy Roles remain, as permitted");
  });

  await t.test("E (7): every seeded Employee reference resolves in its own tenant", async () => {
    const r = cli("measureEmployeeReferenceIntegrity.js", ["--json"]);
    assert.equal(r.status, 0, r.stderr);
    const report = JSON.parse(r.stdout);
    assert.equal(report.unmeasured, 0);
    assert.ok(report.totals.resolved > 0, "the reference census is still vacuous");
    assert.deepEqual([report.totals.unresolved, report.totals.crossTenant, report.totals.malformed], [0, 0, 0]);
  });

  await t.test("F (10, 11, 12): commercial accountability is clean and non-vacuous under V1", async () => {
    const r = cli("measureCommercialAccountability.js", ["--policyId", "COMMERCIAL_ACCOUNTABILITY_ELIGIBILITY_V1", "--eligibleStatus", "ACTIVE,CONTRACTOR"]);
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    const total = r.stdout.slice(r.stdout.indexOf("TOTAL scanned"));
    const bucket = (name) => Number(total.match(new RegExp(`${name}\\s+(\\d+)`))[1]);
    assert.match(total, /^TOTAL scanned 8/);
    assert.equal(bucket("presentValidEligible"), 8);
    for (const name of ["presentValidNotEligible", "presentInvalid", "presentCrossTenant", "missingOwnerDerivable", "missingOwnerInvalid", "missingOwnerNotEligible"]) {
      assert.equal(bucket(name), 0, name);
    }
  });

  await t.test("GOVERNED/SEED: every persisted accountable person equals what the governed rule establishes", async () => {
    const byKey = new Map(MANIFEST.employees.map((e) => [e.key, e.id]));
    for (const r of MANIFEST.commercial) {
      const table = { OPPORTUNITY: ["opportunities", "opportunity_number"], SALES_AGREEMENT: ["sales_agreements", "sales_agreement_number"], SALES_ORDER: ["sales_orders", "sales_order_number"] }[r.kind];
      const row = (await q(`SELECT owner_employee_id, accountable_employee_id FROM eos_commercial.${table[0]} WHERE ${table[1]} = $1`, [r.number])).rows[0];
      assert.equal(row.owner_employee_id, byKey.get(r.owner));
      assert.equal(row.accountable_employee_id, r.accountable === "DERIVE_FROM_OWNER" ? byKey.get(r.owner) : byKey.get(r.accountable), r.number);
    }
  });

  await t.test("(16) the deferred Employee foreign key was not activated", async () => {
    const applied = (await q("SELECT name FROM public.pgmigrations")).rows.map((r) => r.name);
    assert.ok(!applied.some((n) => n.includes("employee-principal-link-employee-fk")));
    // The governed reporting relation (Owner ruling D), the Job Role assignment history (EMP-RT-08), the Work
    // Eligibility qualification history (decomposition step A), the Operational Scope history (step B) and the
    // Reorder assignment identity (the Employee IS the business assignee, so the reference is the point) key onto
    // employees BY DESIGN; no EXISTING person-reference column does.
    const fks = (await q(`SELECT count(*)::int AS n FROM pg_constraint WHERE contype = 'f' AND confrelid = 'eos_workforce.employees'::regclass
                            AND conrelid NOT IN ('eos_workforce.employee_reporting_relationships'::regclass, 'eos_workforce.employee_job_role_assignments'::regclass,
                                                 'eos_workforce.employee_work_eligibility'::regclass,
                                                 'eos_workforce.employee_operational_scopes'::regclass,
                                                 'eos_ops.reorder_request_assignments'::regclass)`)).rows[0].n;
    assert.equal(fks, 0);
  });
});
