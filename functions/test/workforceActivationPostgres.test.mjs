// THE WORKFORCE ACTIVATION MEASUREMENT against a real postgres:16 — every count, the output schema, the
// zeros, and the absence of any mutation.
//
// The measurement counts GLOBALLY (a nonprod database is measured whole), so this suite does not share the
// policy test database with the suites that run before it: it creates its OWN database, migrates it with
// the normal runner, and drops it afterwards. Exact counts are then facts about fixtures this file wrote.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

const HERE = dirname(fileURLToPath(import.meta.url));
const FUNCTIONS_DIR = resolve(HERE, "..");
const SCRIPT_PATH = join(FUNCTIONS_DIR, "scripts/measureWorkforceActivation.js");
const require = createRequire(import.meta.url);
const { measureWorkforceActivation } = require(SCRIPT_PATH);

const DB_NAME = `wf_measure_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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

const zeros = { ACTIVE: 0, ON_LEAVE: 0, INACTIVE: 0, TERMINATED: 0, RETIRED: 0, CONTRACTOR: 0 };
const statuses = (partial) => ({ ...zeros, ...partial });

function runCli(extraEnv = {}) {
  return spawnSync(
    process.execPath,
    [SCRIPT_PATH, "--environment", "platform-sandbox", "--databaseUrlEnv", "WF_MEASURE_DB"],
    { cwd: FUNCTIONS_DIR, encoding: "utf8", env: { ...process.env, WF_MEASURE_DB: dbUrl(), EOS_ENVIRONMENT: "nonprod", ...extraEnv } },
  );
}

/** A fingerprint of every row in every relation the tool reads. Equal before and after = nothing mutated. */
const MEASURED_RELATIONS = [
  "eos_policy.tenants",
  "eos_workforce.employees",
  "eos_policy.principals",
  "eos_policy.tenant_memberships",
  "eos_policy.employee_principal_links",
  "eos_policy.roles",
  "eos_policy.user_role_assignments",
  "eos_commercial.opportunities",
  "eos_commercial.sales_agreements",
  "eos_commercial.sales_orders",
];
async function fingerprint() {
  const out = {};
  for (const rel of MEASURED_RELATIONS) {
    const { rows } = await q(`SELECT count(*)::int AS n, md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS h FROM ${rel} t`);
    out[rel] = rows[0];
  }
  return out;
}

async function seed() {
  const actor = "wf-measure-proof";
  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t1','t1','T1'), ('t2','t2','T2')`);
  // C. Five Employees. Lifecycle is a stated fact; nothing here implies eligibility.
  await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id) VALUES
    ('e-active','t1','ACTIVE','taylor'), ('e-leave','t1','ON_LEAVE','taylor'), ('e-term','t1','TERMINATED','taylor'),
    ('e-contr','t1','CONTRACTOR','other_co'), ('e-t2','t2','ACTIVE','taylor')`);
  // D. Six Principals (p3 disabled), every one a t1 member. The member FK on links and assignments means a
  // missing or non-member principal is unrepresentable; those counters are proved to read 0, not exercised.
  for (const [id, status] of [["p1", "active"], ["p2", "active"], ["p3", "disabled"], ["p4", "active"], ["p5", "active"], ["p6", "active"]]) {
    await q(`INSERT INTO eos_policy.principals (id, external_subject, identity_provider, status) VALUES ($1, $1, 'proof', $2)`, [id, status]);
    await q(`INSERT INTO eos_policy.tenant_memberships (id, tenant_id, principal_id) VALUES ($1, 't1', $2)`, [`m-${id}`, id]);
  }
  const link = (id, principal, employee, company, source, status = "active") =>
    q(
      `INSERT INTO eos_policy.employee_principal_links
         (id, tenant_id, principal_id, employee_id, operating_company_id, link_source, status, asserted_by, assertion_reason)
       VALUES ($1, 't1', $2, $3, $4, $5, $6, $7, $8)`,
      [id, principal, employee, company, source, status, source === "OPERATOR_ASSERTED" ? actor : null, source === "OPERATOR_ASSERTED" ? "proof" : null],
    );
  // p1 is also a t2 member, so an assignment in t2 can legally reference it (the member FK requires it).
  await q(`INSERT INTO eos_policy.tenant_memberships (id, tenant_id, principal_id) VALUES ('m-p1-t2', 't2', 'p1')`);
  await link("L1", "p1", "e-active", "taylor", "RECIPROCAL_FIREBASE_UID_LINK");
  await link("L2", "p2", "e-leave", "wrong_co", "OPERATOR_ASSERTED"); // operating-company mismatch
  await link("L3", "p3", "e-contr", "other_co", "RECIPROCAL_FIREBASE_UID_LINK"); // principal disabled
  await link("L4", "p5", "e-t2", "taylor", "RECIPROCAL_FIREBASE_UID_LINK"); // Employee exists only in t2
  await link("L5", "p4", "e-term", "taylor", "RECIPROCAL_FIREBASE_UID_LINK", "revoked");
  await link("L6", "p6", "e-ghost", "taylor", "RECIPROCAL_FIREBASE_UID_LINK"); // Employee resolves nowhere
  // H. Four roles; t2/viewer has no occupant.
  for (const [id, tenant, key, origin] of [["r-admin", "t1", "admin", "SYSTEM"], ["r-retail", "t1", "retail_sales", "CUSTOM"], ["r-national", "t1", "national_accounts_sales", "CUSTOM"], ["r-viewer", "t2", "viewer", "SYSTEM"]]) {
    await q(`INSERT INTO eos_policy.roles (id, tenant_id, key, name, origin, created_by, updated_by) VALUES ($1,$2,$3,$3,$4,$5,$5)`, [id, tenant, key, origin, actor]);
  }
  const assign = (id, tenant, principal, role, status = "active") =>
    q(
      `INSERT INTO eos_policy.user_role_assignments (id, tenant_id, principal_id, role_id, status, granted_by, access_version_at_grant, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,0,$6,$6)`,
      [id, tenant, principal, role, status, actor],
    );
  await assign("A1", "t1", "p1", "r-admin");
  await assign("A2", "t1", "p1", "r-retail");
  await assign("A3", "t1", "p2", "r-national", "disabled");
  await assign("A4", "t1", "p4", "r-retail"); // only a revoked link
  await assign("A6", "t1", "p6", "r-admin"); // linked Employee resolves nowhere
  await assign("A7", "t2", "p1", "r-national"); // role belongs to t1; no t2 Employee link
  await assign("A8", "t1", "p3", "r-admin"); // principal disabled
  // G. Owner is NOT NULL in this store; accountable is nullable. Commercial rows name a PostgreSQL Account (migration 022).
  await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, created_by, updated_by) VALUES ('a1','t1','Proof account','ACTIVE',$1,$1)`, [actor]);
  await q(`INSERT INTO eos_commercial.opportunities (id, tenant_id, opportunity_number, account_id, owner_employee_id, accountable_employee_id, created_by, updated_by) VALUES
    ('o1','t1','OPP-1','a1','e-active','e-active',$1,$1), ('o2','t1','OPP-2','a1','e-active','e-leave',$1,$1), ('o3','t1','OPP-3','a1','e-leave',NULL,$1,$1)`, [actor]);
  await q(`INSERT INTO eos_commercial.sales_orders (id, tenant_id, sales_order_number, account_id, owner_employee_id, accountable_employee_id, operating_company_key, created_by, updated_by) VALUES
    ('so1','t1','SO-1','a1','e-term','e-contr','taylor',$1,$1)`, [actor]);
}

test("workforce activation measurement, in PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${DB_NAME}`));
  t.after(() => withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`)));
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"], {
    cwd: FUNCTIONS_DIR,
    env: { ...process.env, DATABASE_URL: dbUrl() },
    stdio: "pipe",
  });

  await t.test("an EMPTY migrated database: every section MEASURED and every count a printed 0", async () => {
    const r = runCli();
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.deepEqual(out.unmeasured, []);
    const c = out.sections.employeePopulation;
    assert.equal(c.measured, true);
    assert.equal(c.total, 0);
    assert.deepEqual(c.byLifecycleStatus, zeros);
    assert.deepEqual(out.sections.employeePrincipalLinkage.employees, { total: 0, withActivePrincipalLink: 0, withoutActivePrincipalLink: 0, withActiveLinkByLifecycleStatus: zeros });
    assert.equal(out.sections.securityRoleOccupancy.roles.defined, 0);
    for (const f of out.sections.ownerVersusAccountable.families) assert.equal(f.total, 0);
  });

  await seed();
  const before = await fingerprint();

  await t.test("the CLI output is deterministic JSON with the exact expected counts", async () => {
    const r = runCli();
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, runCli().stdout, "two runs over the same data differ -- the output is not deterministic");
    const printed = r.stdout + r.stderr;
    assert.ok(!printed.includes(dbUrl()) && !printed.includes(URL_BASE), "the connection string was printed");
    const password = new URL(URL_BASE).password;
    if (password) assert.ok(!printed.includes(`:${password}@`), "a credential was printed");
    const out = JSON.parse(r.stdout);

    assert.deepEqual(
      { environment: out.environment, runtimeLabel: out.runtimeLabel, tool: out.tool, readOnly: out.readOnly, mutations: out.mutations, unmeasured: out.unmeasured },
      { environment: "platform-sandbox", runtimeLabel: "nonprod", tool: "measureWorkforceActivation", readOnly: true, mutations: 0, unmeasured: [] },
    );

    // C
    assert.deepEqual(out.sections.employeePopulation, {
      id: "C",
      measured: true,
      total: 5,
      byLifecycleStatus: statuses({ ACTIVE: 2, ON_LEAVE: 1, TERMINATED: 1, CONTRACTOR: 1 }),
      byTenantAndOperatingCompany: [
        { tenantId: "t1", operatingCompanyId: "other_co", count: 1 },
        { tenantId: "t1", operatingCompanyId: "taylor", count: 3 },
        { tenantId: "t2", operatingCompanyId: "taylor", count: 1 },
      ],
      authorityQuality: {
        malformedIdNotResolvableByPort: 0,
        malformedOperatingCompany: 0,
        tenantNotDeclared: 0,
        duplicateEmployeeIds: 0,
        lifecycleVocabularyMatchesGoverned: true,
        databaseLifecycleVocabulary: ["ACTIVE", "ON_LEAVE", "INACTIVE", "TERMINATED", "RETIRED", "CONTRACTOR"],
      },
      notMeasuredHere: out.sections.employeePopulation.notMeasuredHere,
    });

    // D
    assert.deepEqual(out.sections.employeePrincipalLinkage, {
      id: "D",
      measured: true,
      employees: { total: 5, withActivePrincipalLink: 3, withoutActivePrincipalLink: 2, withActiveLinkByLifecycleStatus: statuses({ ACTIVE: 1, ON_LEAVE: 1, CONTRACTOR: 1 }) },
      principals: { total: 6, active: 5, withActiveEmployeeLink: 5, withoutActiveEmployeeLink: 1, tenantMemberships: 7 },
      links: { total: 6, active: 5, revoked: 1, activeBySource: { RECIPROCAL_FIREBASE_UID_LINK: 4, OPERATOR_ASSERTED: 1 } },
      anomalies: {
        activeLinkEmployeeUnresolved: 1,
        activeLinkEmployeeCrossTenant: 1,
        activeLinkPrincipalMissing: 0,
        activeLinkPrincipalNotActive: 1,
        activeLinkMembershipNotActive: 0,
        activeLinkOperatingCompanyMismatch: 1,
        employeesWithMultipleActiveLinks: 0,
        principalsWithMultipleActiveLinks: 0,
      },
    });

    // G -- a family with no rows is still reported, with zeros.
    const family = (name) => out.sections.ownerVersusAccountable.families.find((f) => f.family === name);
    const g = (total, partial) => ({
      total,
      counts: { bothAbsent: 0, ownerPresentAccountableMissing: 0, accountablePresentOwnerMissing: 0, samePerson: 0, differentPerson: 0, ...partial },
      assigneeColumns: [],
      accountabilityColumns: ["accountable_employee_id"],
    });
    const pick = (f) => ({ total: f.total, counts: f.counts, assigneeColumns: f.assigneeColumns, accountabilityColumns: f.accountabilityColumns });
    assert.deepEqual(out.sections.ownerVersusAccountable.families.map((f) => f.family), ["opportunity", "salesAgreement", "salesOrder"]);
    assert.deepEqual(pick(family("opportunity")), g(3, { samePerson: 1, differentPerson: 1, ownerPresentAccountableMissing: 1 }));
    assert.deepEqual(pick(family("salesAgreement")), g(0, {}));
    assert.deepEqual(pick(family("salesOrder")), g(1, { differentPerson: 1 }));

    // H
    assert.deepEqual(out.sections.securityRoleOccupancy, {
      id: "H",
      measured: true,
      roles: {
        defined: 4,
        bySystemOrigin: 2,
        byCustomOrigin: 2,
        withZeroActiveOccupants: 1,
        occupancy: [
          { tenantId: "t1", roleKey: "admin", origin: "SYSTEM", activeAssignments: 3, inactiveAssignments: 0, activePrincipals: 3 },
          { tenantId: "t1", roleKey: "national_accounts_sales", origin: "CUSTOM", activeAssignments: 1, inactiveAssignments: 1, activePrincipals: 1 },
          { tenantId: "t1", roleKey: "retail_sales", origin: "CUSTOM", activeAssignments: 2, inactiveAssignments: 0, activePrincipals: 2 },
          { tenantId: "t2", roleKey: "viewer", origin: "SYSTEM", activeAssignments: 0, inactiveAssignments: 0, activePrincipals: 0 },
        ],
      },
      assignments: { total: 7, active: 6, inactive: 1 },
      employees: {
        uniqueWithActiveSecurityRole: 2,
        withActiveSecurityRoleByLifecycleStatus: statuses({ ACTIVE: 1, CONTRACTOR: 1 }),
        withoutActiveSecurityRoleByLifecycleStatus: statuses({ ACTIVE: 1, ON_LEAVE: 1, TERMINATED: 1 }),
      },
      anomalies: {
        activeAssignmentRoleTenantMismatch: 1,
        activeAssignmentPrincipalMissing: 0,
        activeAssignmentPrincipalNotActive: 1,
        activeAssignmentPrincipalNotTenantMember: 0,
        activeAssignmentPrincipalWithoutEmployeeLink: 2,
        activeAssignmentLinkedEmployeeMissing: 1,
      },
    });
  });

  await t.test("every statement issued against the real database is a read, inside a READ ONLY transaction", async () => {
    await withClient(dbUrl(), async (client) => {
      const issued = [];
      const recording = { query: (sql, params) => (issued.push(sql), client.query(sql, params)) };
      await client.query("BEGIN");
      await client.query("SET TRANSACTION READ ONLY");
      const report = await measureWorkforceActivation(recording);
      await client.query("COMMIT");
      assert.deepEqual(report.unmeasured, []);
      assert.ok(issued.length >= 10);
      for (const sql of issued) assert.match(sql.trim(), /^(SELECT|WITH)\b/i);
    });
  });

  await t.test("NOTHING was mutated: every measured relation is byte-identical after the runs", async () => {
    assert.deepEqual(await fingerprint(), before);
  });

  await t.test("a database missing the Employee authority reports C, D and H NOT MEASURED -- never zero", async () => {
    await withClient(dbUrl(), async (client) => {
      await client.query("BEGIN");
      await client.query("ALTER TABLE eos_workforce.employees RENAME TO employees_hidden_for_proof");
      try {
        const report = await measureWorkforceActivation(client);
        assert.deepEqual(report.unmeasured, ["C", "D", "H"]);
        for (const name of ["employeePopulation", "employeePrincipalLinkage", "securityRoleOccupancy"]) {
          assert.equal(report.sections[name].measured, false);
          assert.equal(report.sections[name].total, undefined, "an unmeasured section carried a count");
          assert.match(report.sections[name].error, /eos_workforce\.employees -- a FAILURE TO MEASURE/);
        }
      } finally {
        await client.query("ROLLBACK");
      }
    });
    assert.equal(runCli().status, 0, "the rollback did not restore the relation");
  });

  await t.test("the fence refuses this same database when the process has not declared nonprod", async () => {
    const r = runCli({ EOS_ENVIRONMENT: "local" });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /EOS_ENVIRONMENT must read exactly 'nonprod'/);
    assert.equal(r.stdout, "");
  });
});
