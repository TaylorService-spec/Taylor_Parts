// SEC-ROSTER-01 (2026-11-15): a colleague's personal fields and the Administration roster columns are not readable through
// employee.record.read alone, against a real postgres:16.
//
// employee.record.read is granted to nearly every Role (grid approval a-20261023235337: 23 Roles, General Employee among them).
// It stays the DIRECTORY read. This suite proves, on the governed reads themselves:
//   * readEmployee withholds mobile phone, home address, hire and separation dates (null + personalFieldsWithheld) from a
//     directory-only holder, and returns them to a holder of admin.employeeProfile.write (positive control);
//   * listEmployeeChangeHistory drops those same keys from a profile change's before / after for the directory-only holder;
//   * listWorkforceRoster withholds Work Eligibility, Operational Scope and Application user (and refuses the Operational
//     Scope filter) unless the caller holds a people-administration key, while names stay readable for pickers;
//   * the Administration -> Users door is earned by exactly the people-administration keys, not employee.record.read.
// Actors are built as the HTTP boundary hands them to the reads (an already-resolved capability Set), so the test decides
// the authority under test exactly. Mutation guard: removing any of the gates fails a named assertion below.
import { endPoolAndDrain } from "./support/poolTeardown.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { readEmployee } = require("../lib/eosWorkforce/reads/employeeDirectoryReads.js");
const { listEmployeeChangeHistory } = require("../lib/eosWorkforce/reads/employeeChangeHistoryRead.js");
const { listWorkforceRoster, PEOPLE_ADMINISTRATION_KEYS } = require("../lib/eosAdministration/workforceRoster.js");
const { EXPERIENCE_SURFACES } = require("../lib/eosOps/experienceAuthority.js");
const { listEmployeeWorkEligibility, listEmployeeWorkEligibilityHistory } = require("../lib/eosWorkforce/reads/workEligibilityReads.js");
const { listEmployeeOperationalScopes, listEmployeeOperationalScopeHistory } = require("../lib/eosWorkforce/reads/operationalScopeReads.js");
const companies = require("../lib/eosWorkforce/migration/tenantOperatingCompanies.js");
const entitlement = require("../lib/eosOps/conditionalEntitlement.js");

const dbUrlFor = (name) => { const u = new URL(URL_BASE); u.pathname = `/${name}`; return u.toString(); };
async function withClient(url, fn) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}

const TENANT = "t-sec01";
const DIRECTORY_ONLY = new Set(["employee.record.read"]);
// A RESOLVED actor, as resolveOperationalContext produces it: the flat set plus unconditional entitlements.
const actor = (caps) => ({ tenantId: TENANT, principalId: "p-caller", capabilities: new Set(caps),
  entitlements: async () => entitlement.entitlementsFrom([...caps].map((capabilityKey) => ({ grantor: { kind: "ROLE", roleKey: "fixture" }, capabilityKey }))) });

test("static: the Administration -> Users door is earned by admin.principalAccess.read only, never the directory read", () => {
  const users = EXPERIENCE_SURFACES.find((s) => s.key === "administration.users");
  assert.ok(users, "administration.users is declared");
  assert.deepEqual(users.grants.map((g) => g.capabilityKey), ["admin.principalAccess.read"]);
});

test("personal fields and Administration columns over PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `sec01_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await endPoolAndDrain(pool);
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"], {
    maxBuffer: 256 * 1024 * 1024, cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe",
  });
  pool = new pg.Pool({ connectionString: dbUrlFor(name), max: 4 });
  const q = (text, values = []) => pool.query(text, values);
  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ($1,$1,'SEC01')`, [TENANT]);
  await q(`INSERT INTO eos_policy.principals (id, external_subject, identity_provider, status) VALUES ('p-caller','p-caller','proof','active')`);
  await q(`INSERT INTO eos_policy.tenant_memberships (id, tenant_id, principal_id) VALUES ('m-caller',$1,'p-caller')`, [TENANT]);
  await companies.reconcileTenantOperatingCompanies(pool, { tenantId: TENANT, companyIds: ["taylor"], source: "test-evidence", actor: "tenant-operating-companies:test", apply: true });
  await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id, employee_number, first_name, last_name,
             job_title, work_email, work_phone, mobile_phone, address_street, address_unit, address_city, address_state, address_postal_code, hire_date)
           VALUES ('e-colleague', $1, 'ACTIVE', 'taylor', 'E-100', 'Casey', 'Colleague', 'Technician', 'casey@example.test', '555-0100',
                   '555-0199', '1 Home St', 'Apt 2', 'Phoenix', 'AZ', '85001', '2020-01-15')`, [TENANT]);
  const profileChange = { mobilePhone: "555-0198", "address.street": "9 Old Rd", jobTitle: "Apprentice" };
  const profileAfter = { mobilePhone: "555-0199", "address.street": "1 Home St", jobTitle: "Technician" };
  await q(`INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, reason)
           VALUES ('ae-1', $1, 'employee.profile.update', 'p-admin', 'employee', 'e-colleague', $2::jsonb, $3::jsonb, 'new mobile 555-0199')`,
    [TENANT, JSON.stringify(profileChange), JSON.stringify(profileAfter)]);
  const deps = { pool };

  await t.test("readEmployee: a directory-only holder gets the colleague record WITHOUT personal fields, and is told why", async () => {
    const r = await readEmployee(deps, actor(DIRECTORY_ONLY), { employeeId: "e-colleague" });
    assert.equal(r.displayName, "Casey Colleague");
    assert.equal(r.jobTitle, "Technician");
    assert.equal(r.contact.workEmail, "casey@example.test", "work contact stays: it is how colleagues reach each other");
    assert.equal(r.contact.workPhone, "555-0100");
    assert.equal(r.contact.mobilePhone, null, "mobile phone withheld");
    assert.deepEqual(r.address, { street: null, unit: null, city: null, state: null, postalCode: null }, "home address withheld");
    assert.equal(r.hireDate, null, "hire date withheld");
    assert.equal(r.separationDate, null);
    assert.match(r.personalFieldsWithheld, /admin\.employeeProfile\.write/);
  });

  await t.test("readEmployee: a holder of admin.employeeProfile.write gets the personal fields (positive control)", async () => {
    const r = await readEmployee(deps, actor(["employee.record.read", "admin.employeeProfile.write"]), { employeeId: "e-colleague" });
    assert.equal(r.contact.mobilePhone, "555-0199");
    assert.equal(r.address.street, "1 Home St");
    assert.equal(r.address.postalCode, "85001");
    assert.equal(r.hireDate, "2020-01-15");
    assert.equal(r.personalFieldsWithheld, null);
  });

  await t.test("readEmployee: another people-administration key (work eligibility) does NOT reveal personal fields", async () => {
    const r = await readEmployee(deps, actor(["employee.record.read", "admin.employeeWorkEligibility.write"]), { employeeId: "e-colleague" });
    assert.equal(r.contact.mobilePhone, null);
    assert.equal(r.address.street, null);
  });

  await t.test("readEmployee: without employee.record.read the read is refused", async () => {
    await assert.rejects(readEmployee(deps, actor([]), { employeeId: "e-colleague" }), (e) => e.code === "CAPABILITY_REQUIRED");
  });

  await t.test("change history: personal keys are dropped from before / after for a directory-only holder", async () => {
    const page = await listEmployeeChangeHistory(deps, actor(DIRECTORY_ONLY), { employeeId: "e-colleague" });
    const item = page.items.find((i) => i.eventId === "ae-1");
    assert.ok(item, "the change is still listed");
    assert.deepEqual(item.before, { jobTitle: "Apprentice" }, "no personal key before");
    assert.deepEqual(item.after, { jobTitle: "Technician" }, "no personal key after");
    assert.equal(item.reason, null, "a profile change's free-text reason is withheld with its values");
    assert.match(page.personalFieldsWithheld, /admin\.employeeProfile\.write/);
    const full = await listEmployeeChangeHistory(deps, actor(["employee.record.read", "admin.employeeProfile.write"]), { employeeId: "e-colleague" });
    const fullItem = full.items.find((i) => i.eventId === "ae-1");
    assert.equal(fullItem.before.mobilePhone, "555-0198", "positive control: the profile maintainer sees the change");
    assert.equal(fullItem.after["address.street"], "1 Home St");
    assert.equal(fullItem.reason, "new mobile 555-0199");
    assert.equal(full.personalFieldsWithheld, null);
  });

  await t.test("roster: names stay readable; Administration columns are withheld and their filter refused", async () => {
    const r = await listWorkforceRoster(deps, actor(DIRECTORY_ONLY), {});
    const row = r.items.find((i) => i.employeeId === "e-colleague");
    assert.equal(row.displayName, "Casey Colleague", "the picker still finds people by name");
    assert.deepEqual(row.workEligibility, []);
    assert.deepEqual(row.operationalScopes, []);
    assert.equal(row.applicationUser, "UNLINKED", "Owner ruling B: User Access linkage is an Employee-facing fact");
    assert.equal(row.principalId, null);
    assert.equal(row.securityRoles, null);
    assert.match(r.administrationColumnsWithheld, /admin\.employeeWorkEligibility\.write/);
    await assert.rejects(listWorkforceRoster(deps, actor(DIRECTORY_ONLY), { scopeType: "MOBILE" }), (e) => e.code === "CAPABILITY_REQUIRED");
  });

  await t.test("roster: each people-administration key returns the Administration columns (positive control)", async () => {
    for (const key of PEOPLE_ADMINISTRATION_KEYS) {
      const r = await listWorkforceRoster(deps, actor(["employee.record.read", key]), {});
      const row = r.items.find((i) => i.employeeId === "e-colleague");
      assert.ok(Array.isArray(row.workEligibility), `${key}: eligibility column present`);
      assert.equal(r.administrationColumnsWithheld, null, `${key}: nothing withheld`);
      await listWorkforceRoster(deps, actor(["employee.record.read", key]), { scopeType: "MOBILE" });
    }
  });

  await t.test("dedicated Work Eligibility and Operational Scope reads need a people-administration key", async () => {
    const reads = { listEmployeeWorkEligibility, listEmployeeWorkEligibilityHistory, listEmployeeOperationalScopes, listEmployeeOperationalScopeHistory };
    for (const [name, read] of Object.entries(reads)) {
      await assert.rejects(read(deps, actor(DIRECTORY_ONLY), { employeeId: "e-colleague" }), (e) => e.code === "CAPABILITY_REQUIRED", `${name}: directory-only refused`);
      for (const key of PEOPLE_ADMINISTRATION_KEYS) {
        const r = await read(deps, actor(["employee.record.read", key]), { employeeId: "e-colleague" });
        assert.equal(r.employeeId, "e-colleague", `${name} with ${key}`);
      }
    }
  });
});
