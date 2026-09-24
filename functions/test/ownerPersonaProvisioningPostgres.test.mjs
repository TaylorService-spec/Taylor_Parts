// THE GOVERNED NONPROD OWNER PERSONA against a real postgres:16 -- provisioned through the governed
// commands into a world stood up by the real tenant bootstrap, then re-run for idempotence.
//
// Its OWN database, migrated by the normal runner and dropped afterwards, so nothing here depends on
// or disturbs another suite's schema.
//
// ════════════════════ WHAT ONLY A REAL DATABASE CAN PROVE ════════════════════
//
//   1. The `owner` Role EXISTS in a freshly bootstrapped tenant, so assigning it invents nothing.
//   2. The run is idempotent for real: a second invocation reports NO_CHANGE for both steps and
//      writes no row and NO AUDIT EVENT -- which a mock of the commands could not show, because the
//      early return that produces it is inside them.
//   3. The per-step reasons reach `eos_policy.audit_events.reason` as two DIFFERENT strings. That is
//      the Owner ruling's actual subject, and it is a property of the rows, not of the source.
//   4. `eos_policy.principal_capabilities` stays at 0 across the whole run.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

const HERE = dirname(fileURLToPath(import.meta.url));
const FUNCTIONS_DIR = resolve(HERE, "..");
const require = createRequire(import.meta.url);
const {
  OWNER_EXTERNAL_SUBJECT, OWNER_ROLE_KEY, SYNTHETIC_IDENTITY_PROVIDER,
  PRINCIPAL_STEP_REASON, ROLE_STEP_REASON,
} = require("../scripts/provisionOwnerPersona.js");

const DB_NAME = `owner_persona_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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

const TENANT_KEY = "taylor-nonprod";
const env = { ...process.env, OWNER_DB: dbUrl(), EOS_ENVIRONMENT: "nonprod" };

let adminPrincipalId;
const run = (extra = [], overrideEnv = env) =>
  spawnSync(process.execPath, [
    "scripts/provisionOwnerPersona.js",
    "--environment", "platform-sandbox", "--databaseUrlEnv", "OWNER_DB",
    "--tenantKey", TENANT_KEY, "--performedBy", "owner-persona-proof",
    "--adminPrincipalId", adminPrincipalId, ...extra,
  ], { cwd: FUNCTIONS_DIR, encoding: "utf8", env: overrideEnv });

const COUNTED = [
  "eos_policy.principals",
  "eos_policy.tenant_memberships",
  "eos_policy.user_role_assignments",
  "eos_policy.principal_capabilities",
  "eos_policy.role_capabilities",
  "eos_policy.audit_events",
  "eos_workforce.employees",
  "eos_policy.employee_principal_links",
];
async function rowCounts() {
  const out = {};
  for (const rel of COUNTED) out[rel] = (await q(`SELECT count(*)::int AS n FROM ${rel}`)).rows[0].n;
  return out;
}

test("the governed nonprod Owner persona, in PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${DB_NAME}`));
  t.after(() => withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`)));
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"], {
    cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrl() }, stdio: "pipe",
  });

  const pool = new pg.Pool({ connectionString: dbUrl(), max: 2 });
  try {
    const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");
    const { bootstrapTenant, bootstrapAdministrator } = require("../lib/adminPolicy/tenantBootstrap.js");
    const repo = new PostgresPolicyRepository(pool);
    const { tenant } = await bootstrapTenant(repo, { key: TENANT_KEY, name: "Owner persona proof tenant", actorUid: "proof" });
    const admin = await bootstrapAdministrator(repo, { tenantId: tenant.id, externalSubject: "real-login-subject", performedBy: "proof" });
    adminPrincipalId = admin.principal.id;
  } finally {
    await pool.end();
  }

  await t.test("the starting state is the one the ruling describes: owner exists and nobody holds it", async () => {
    const role = (await q("SELECT id FROM eos_policy.roles WHERE key = $1", [OWNER_ROLE_KEY])).rows;
    assert.equal(role.length, 1, "owner is not a seeded Role in a freshly bootstrapped tenant");
    const held = (await q(`SELECT count(*)::int AS n FROM eos_policy.user_role_assignments a
      JOIN eos_policy.roles r ON r.id = a.role_id WHERE r.key = $1 AND a.status = 'active'`, [OWNER_ROLE_KEY])).rows[0].n;
    assert.equal(held, 0, "owner already has a holder -- this proof's premise is gone");
  });

  await t.test("the fence refuses this same database without the nonprod runtime marker, writing nothing", async () => {
    const before = await rowCounts();
    const r = run(["--apply"], { ...env, EOS_ENVIRONMENT: "local" });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /EOS_ENVIRONMENT must read exactly 'nonprod'/);
    assert.deepEqual(await rowCounts(), before);
  });

  await t.test("DRY RUN BY DEFAULT: it plans both steps and writes nothing", async () => {
    const before = await rowCounts();
    const r = run();
    assert.equal(r.status, 0, r.stderr);
    const report = JSON.parse(r.stdout);
    assert.equal(report.apply, false);
    assert.deepEqual(report.steps.map((s) => [s.step, s.outcome]), [
      ["principal", "PLANNED"], ["roleAssignment", "PLANNED"],
    ]);
    assert.deepEqual(await rowCounts(), before, "the dry run wrote something");
  });

  let first;
  await t.test("--apply provisions the persona through the governed commands", async () => {
    const before = await rowCounts();
    const r = run(["--apply"]);
    assert.equal(r.status, 0, r.stderr);
    first = JSON.parse(r.stdout);
    assert.deepEqual(first.steps.map((s) => [s.step, s.outcome]), [
      ["principal", "CREATED"], ["roleAssignment", "CREATED"],
    ]);

    const after = await rowCounts();
    // EXACTLY three rows: one Principal, one membership, one role assignment. Plus audit events.
    assert.equal(after["eos_policy.principals"], before["eos_policy.principals"] + 1);
    assert.equal(after["eos_policy.tenant_memberships"], before["eos_policy.tenant_memberships"] + 1);
    assert.equal(after["eos_policy.user_role_assignments"], before["eos_policy.user_role_assignments"] + 1);
    // AND NOTHING ELSE. No Employee, no link, no direct grant, no Role widening.
    assert.equal(after["eos_workforce.employees"], before["eos_workforce.employees"]);
    assert.equal(after["eos_policy.employee_principal_links"], before["eos_policy.employee_principal_links"]);
    assert.equal(after["eos_policy.principal_capabilities"], 0, "a direct Principal capability grant was made");
    assert.equal(after["eos_policy.role_capabilities"], before["eos_policy.role_capabilities"], "a Role was widened");

    assert.equal(first.employeeLinked, false);
    assert.equal(first.invariants.principalCapabilities, 0);
    assert.equal(first.invariants.adminPrincipalReused, false);
  });

  await t.test("the persona is a NON-AUTHENTICATING Principal that is not the administrator", async () => {
    const p = (await q("SELECT id, identity_provider, display_name, status FROM eos_policy.principals WHERE external_subject = $1",
      [OWNER_EXTERNAL_SUBJECT])).rows;
    assert.equal(p.length, 1);
    assert.equal(p[0].identity_provider, SYNTHETIC_IDENTITY_PROVIDER);
    assert.equal(p[0].identity_provider === "firebase", false, "the persona can authenticate");
    assert.equal(p[0].status, "active");
    assert.match(p[0].display_name, /cannot sign in/);
    assert.notEqual(p[0].id, adminPrincipalId);

    // THE PROHIBITION, MEASURED: owner is held by exactly one Principal, and it is not the admin.
    const holders = (await q(`SELECT p.id, p.external_subject FROM eos_policy.user_role_assignments a
       JOIN eos_policy.roles r ON r.id = a.role_id
       JOIN eos_policy.principals p ON p.id = a.principal_id
      WHERE r.key = $1 AND a.status = 'active'`, [OWNER_ROLE_KEY])).rows;
    assert.equal(holders.length, 1);
    assert.equal(holders[0].external_subject, OWNER_EXTERNAL_SUBJECT);
    assert.notEqual(holders[0].id, adminPrincipalId);

    // ...and the administrator still holds exactly what the bootstrap gave it.
    const adminRoles = (await q(`SELECT r.key FROM eos_policy.user_role_assignments a
       JOIN eos_policy.roles r ON r.id = a.role_id
      WHERE a.principal_id = $1 AND a.status = 'active' ORDER BY r.key`, [adminPrincipalId])).rows.map((x) => x.key);
    assert.deepEqual(adminRoles, ["admin"]);

    // The persona holds `owner` and NOTHING else -- global scope, one assignment.
    const personaRoles = (await q(`SELECT r.key, a.scope_type FROM eos_policy.user_role_assignments a
       JOIN eos_policy.roles r ON r.id = a.role_id
      WHERE a.principal_id = $1 AND a.status = 'active'`, [p[0].id])).rows;
    assert.deepEqual(personaRoles, [{ key: OWNER_ROLE_KEY, scope_type: "global" }]);
  });

  await t.test("PER-STEP REASONS reached the audit trail as two DIFFERENT strings", async () => {
    const rows = (await q(`SELECT action, reason FROM eos_policy.audit_events
       WHERE reason LIKE 'OWNER PERSONA:%' ORDER BY action`)).rows;
    assert.equal(rows.length, 2, "the two persona mutations did not each write their own reason");
    assert.deepEqual(rows.map((r) => r.action), ["assignRole", "tenant.addPrincipal"]);

    const byAction = Object.fromEntries(rows.map((r) => [r.action, r.reason]));
    assert.equal(byAction["tenant.addPrincipal"], PRINCIPAL_STEP_REASON);
    assert.equal(byAction.assignRole, ROLE_STEP_REASON);

    // THE RULING'S ACTUAL SUBJECT: not that a reason exists, but that it is SPECIFIC to its step.
    assert.notEqual(byAction["tenant.addPrincipal"], byAction.assignRole,
      "both steps recorded the same sentence -- that is a run-level reason");
    assert.match(byAction["tenant.addPrincipal"], /TENANT_MEMBERSHIP/);
    assert.match(byAction.assignRole, new RegExp(`SECURITY_ROLE ${OWNER_ROLE_KEY}`));
    for (const reason of Object.values(byAction)) {
      assert.match(reason, new RegExp(OWNER_EXTERNAL_SUBJECT));
      assert.ok(reason.length <= 500, "the reason exceeds the audit column");
    }

    // Admitting a Principal used to be written with reason null. Nothing in this run did that.
    const nullReasoned = (await q(`SELECT count(*)::int AS n FROM eos_policy.audit_events
      WHERE action = 'tenant.addPrincipal' AND reason IS NULL`)).rows[0].n;
    assert.equal(nullReasoned, 0, "a persona mutation was recorded with no reason at all");
  });

  await t.test("A DETERMINISTIC RE-RUN reports NO_CHANGE for both steps and writes nothing at all", async () => {
    const before = await rowCounts();
    const r = run(["--apply"]);
    assert.equal(r.status, 0, r.stderr);
    const second = JSON.parse(r.stdout);
    assert.deepEqual(second.steps.map((s) => [s.step, s.outcome]), [
      ["principal", "NO_CHANGE"], ["roleAssignment", "NO_CHANGE"],
    ]);
    assert.equal(second.principalId, first.principalId, "a second Principal was created");

    // NOT ONE ROW, INCLUDING NOT ONE AUDIT EVENT. Both governed commands return before opening a
    // transaction when the state already matches, and that is what makes the re-run free rather than
    // merely harmless -- a re-run that appended audit rows would grow the trail on every operator run.
    assert.deepEqual(await rowCounts(), before);

    // A third run, for the same reason, because "idempotent" that was only ever tried twice is a
    // claim about the second run.
    const third = run(["--apply"]);
    assert.equal(third.status, 0, third.stderr);
    assert.deepEqual(JSON.parse(third.stdout).steps.map((s) => s.outcome), ["NO_CHANGE", "NO_CHANGE"]);
    assert.deepEqual(await rowCounts(), before);
  });

  await t.test("the connection string never appears in the output", async () => {
    const r = run(["--apply"]);
    assert.equal(r.stdout.includes(dbUrl()), false, "the connection string was printed");
    assert.equal(r.stderr.includes(dbUrl()), false);
  });
});
