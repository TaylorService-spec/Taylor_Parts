// BINDING THE NONPROD OWNER PERSONA TO A REAL LOGIN, against a real postgres:16.
//
// Its OWN database, migrated by the normal runner and dropped afterwards, so nothing here depends on
// or disturbs another suite's schema.
//
// ════════════════════ WHAT ONLY A REAL DATABASE CAN PROVE ════════════════════
//
//   1. THE IDENTITY MODEL IS ONE EXTERNAL IDENTITY PER PRINCIPAL. `principals` has a UNIQUE
//      (identity_provider, external_subject) and no table anywhere binds a second subject to a
//      Principal. That is the premise the whole design rests on, so it is measured from
//      information_schema rather than assumed from a comment.
//   2. RE-BINDING MOVES A LOGIN AND NOT AN AUTHORITY. The Principal id, the `owner` assignment id,
//      the membership and the full set of held Roles are byte-identical before and after -- which a
//      mock could not show, because the thing being proved is that nothing ELSE in the schema moved.
//   3. The audit event carries BOTH bindings and the per-step reason, as ROWS.
//   4. A re-run reports NO_CHANGE and writes no row and NO audit event.
//   5. `principal_capabilities` stays 0 and `role_capabilities` is unchanged across the whole run.
//
// THE IDENTITY PROVIDER IS NEVER CONTACTED HERE. `post` is injected, so this suite proves the
// database behaviour of the binding without creating an account in anybody's project.
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
const { OWNER_EXTERNAL_SUBJECT, OWNER_ROLE_KEY, SYNTHETIC_IDENTITY_PROVIDER } =
  require("../scripts/provisionOwnerPersona.js");
const {
  bindOwnerPersonaIdentity, boundDisplayName, assertDistinctStepReasons,
  AUTH_STEP_REASON, BINDING_STEP_REASON, FIREBASE_IDENTITY_PROVIDER,
} = require("../scripts/bindOwnerPersonaIdentity.js");

const DB_NAME = `owner_identity_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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
const PERSONA_EMAIL = "eos-owner@sandbox.invalid";
const FIREBASE_UID = "PROOFuid0000000000000000000x";
/** Long enough for the script's own floor; this value never reaches the database or a log. */
const PASSWORD = "proof-only-password-not-a-secret";

/** An injected Identity Toolkit. Records what was asked; returns what the case under test needs. */
function fakeProvider(behaviour) {
  const calls = [];
  return {
    calls,
    post: async (method, apiKey, body) => {
      calls.push({ method, apiKey, email: body.email });
      return behaviour(method);
    },
  };
}
const created = () => fakeProvider((m) => (m === "signUp"
  ? { ok: true, body: { localId: FIREBASE_UID, idToken: "not-a-real-token" } }
  : { ok: false, body: { error: { message: "UNEXPECTED" } } }));
const alreadyExists = () => fakeProvider((m) => (m === "signUp"
  ? { ok: false, body: { error: { message: "EMAIL_EXISTS" } } }
  : { ok: true, body: { localId: FIREBASE_UID, idToken: "not-a-real-token" } }));
const existsWrongPassword = () => fakeProvider((m) => (m === "signUp"
  ? { ok: false, body: { error: { message: "EMAIL_EXISTS" } } }
  : { ok: false, body: { error: { message: "INVALID_LOGIN_CREDENTIALS" } } }));

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

test("binding the nonprod Owner persona to a real login, in PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${DB_NAME}`));
  // ONE teardown, in this order. DROP ... WITH (FORCE) terminates the pool's own connections, and a
  // pool closed afterwards reports that termination as an unhandled failure of the whole suite.
  let pool;
  t.after(async () => {
    if (pool) await pool.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`));
  });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"], {
    cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrl() }, stdio: "pipe",
  });

  const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");
  const { bootstrapTenant, bootstrapAdministrator } = require("../lib/adminPolicy/tenantBootstrap.js");
  const { rebindPrincipalIdentity } = require("../lib/adminPolicy/policyCommands.js");
  const { hasAdministrationAuthority } = require("../lib/adminPolicy/administrationAuthority.js");

  pool = new pg.Pool({ connectionString: dbUrl(), max: 4 });
  const repo = new PostgresPolicyRepository(pool);
  const { tenant } = await bootstrapTenant(repo, { key: TENANT_KEY, name: "Owner identity proof tenant", actorUid: "proof" });
  const admin = await bootstrapAdministrator(repo, { tenantId: tenant.id, externalSubject: "real-admin-subject", performedBy: "proof" });
  const adminPrincipalId = admin.principal.id;

  // The persona is provisioned by ITS OWN governed script, not by this file, so what is bound here
  // is the same Principal the Wave 9 ruling created rather than a fixture shaped to suit the proof.
  const provision = spawnSync(process.execPath, [
    "scripts/provisionOwnerPersona.js",
    "--environment", "platform-sandbox", "--databaseUrlEnv", "OWNER_DB",
    "--tenantKey", TENANT_KEY, "--performedBy", "owner-identity-proof",
    "--adminPrincipalId", adminPrincipalId, "--apply",
  ], { cwd: FUNCTIONS_DIR, encoding: "utf8", env: { ...process.env, OWNER_DB: dbUrl(), EOS_ENVIRONMENT: "nonprod" } });
  assert.equal(provision.status, 0, provision.stderr);
  const ownerPrincipalId = JSON.parse(provision.stdout).principalId;

  const options = {
    environmentId: "platform-sandbox",
    projectId: "eos-platform-sandbox",
    apiKey: "public-web-api-key-not-a-credential",
    tenantKey: TENANT_KEY,
    performedBy: "owner-identity-proof",
    adminPrincipalId,
    authIdentityEmail: PERSONA_EMAIL,
    authPassword: PASSWORD,
    apply: false,
  };
  const deps = (provider) => ({
    PostgresPolicyRepository, rebindPrincipalIdentity, hasAdministrationAuthority, post: provider.post,
  });

  const heldRoleKeys = async (principalId) => (await q(
    `SELECT r.key FROM eos_policy.user_role_assignments a
       JOIN eos_policy.roles r ON r.id = a.role_id
      WHERE a.principal_id = $1 AND a.status = 'active' ORDER BY r.key, a.scope_type`, [principalId],
  )).rows.map((x) => x.key);

  await t.test("THE IDENTITY MODEL: one external identity per Principal, and no binding table", async () => {
    const cols = (await q(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'eos_policy' AND table_name = 'principals' ORDER BY column_name`,
    )).rows.map((r) => r.column_name);
    assert.deepEqual(cols, [
      "created_at", "display_name", "external_subject", "id", "identity_provider", "status", "updated_at",
    ]);

    // ONE unique constraint over the pair -- so a Principal cannot hold two subjects, and two
    // Principals cannot hold one.
    const unique = (await q(
      `SELECT c.conname FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'eos_policy' AND t.relname = 'principals' AND c.contype = 'u'`,
    )).rows.map((r) => r.conname);
    assert.deepEqual(unique, ["principals_provider_subject_unique"]);

    // NO SEPARATE IDENTITY-BINDING TABLE. Anything that referenced a Principal AND carried an
    // external subject would be one; nothing does.
    const subjectCarriers = (await q(
      `SELECT table_name FROM information_schema.columns
        WHERE table_schema = 'eos_policy' AND column_name = 'external_subject' ORDER BY table_name`,
    )).rows.map((r) => r.table_name);
    assert.deepEqual(subjectCarriers, ["principals"]);
  });

  const before = {};
  await t.test("the starting state is the ruling's: the Owner Principal cannot authenticate", async () => {
    const p = (await q("SELECT * FROM eos_policy.principals WHERE id = $1", [ownerPrincipalId])).rows;
    assert.equal(p.length, 1);
    assert.equal(p[0].identity_provider, SYNTHETIC_IDENTITY_PROVIDER);
    assert.equal(p[0].external_subject, OWNER_EXTERNAL_SUBJECT);
    before.roles = await heldRoleKeys(ownerPrincipalId);
    assert.deepEqual(before.roles, [OWNER_ROLE_KEY]);
    before.assignment = (await q(
      `SELECT a.id FROM eos_policy.user_role_assignments a
         JOIN eos_policy.roles r ON r.id = a.role_id
        WHERE a.principal_id = $1 AND r.key = $2 AND a.status = 'active'`, [ownerPrincipalId, OWNER_ROLE_KEY],
    )).rows[0].id;
    before.membership = (await q(
      "SELECT id, status FROM eos_policy.tenant_memberships WHERE principal_id = $1", [ownerPrincipalId],
    )).rows[0];
  });

  await t.test("the two per-step reasons are distinct and each names its own step", () => {
    assertDistinctStepReasons();
    assert.notEqual(AUTH_STEP_REASON, BINDING_STEP_REASON);
    assert.match(AUTH_STEP_REASON, /AUTHENTICATION_ACCOUNT/);
    assert.match(BINDING_STEP_REASON, /EXTERNAL_BINDING/);
    for (const reason of [AUTH_STEP_REASON, BINDING_STEP_REASON]) {
      assert.match(reason, new RegExp(OWNER_EXTERNAL_SUBJECT));
      assert.ok(reason.length <= 500);
    }
  });

  await t.test("DRY RUN BY DEFAULT: it plans both steps, contacts nothing and writes nothing", async () => {
    const counts = await rowCounts();
    const provider = created();
    const report = await bindOwnerPersonaIdentity(pool, options, deps(provider));
    assert.equal(report.apply, false);
    assert.deepEqual(report.steps.map((s) => [s.step, s.outcome]), [
      ["authenticationIdentity", "PLANNED"], ["principalIdentityBinding", "PLANNED"],
    ]);
    assert.deepEqual(provider.calls, [], "a dry run contacted the identity provider");
    assert.deepEqual(await rowCounts(), counts, "a dry run wrote something");
  });

  let applied;
  await t.test("--apply mints the login and RE-BINDS the same Principal", async () => {
    const counts = await rowCounts();
    const provider = created();
    applied = await bindOwnerPersonaIdentity(pool, { ...options, apply: true }, deps(provider));
    assert.deepEqual(applied.steps.map((s) => [s.step, s.outcome]), [
      ["authenticationIdentity", "CREATED"], ["principalIdentityBinding", "REBOUND"],
    ]);
    assert.deepEqual(provider.calls.map((c) => c.method), ["signUp"]);
    assert.equal(provider.calls[0].email, PERSONA_EMAIL);

    const after = await rowCounts();
    // NOT ONE NEW ROW ANYWHERE except the audit event. That is the difference between re-binding an
    // identity and creating a second Principal to hold the Role.
    assert.equal(after["eos_policy.principals"], counts["eos_policy.principals"]);
    assert.equal(after["eos_policy.tenant_memberships"], counts["eos_policy.tenant_memberships"]);
    assert.equal(after["eos_policy.user_role_assignments"], counts["eos_policy.user_role_assignments"]);
    assert.equal(after["eos_policy.principal_capabilities"], 0);
    assert.equal(after["eos_policy.role_capabilities"], counts["eos_policy.role_capabilities"]);
    assert.equal(after["eos_workforce.employees"], counts["eos_workforce.employees"]);
    assert.equal(after["eos_policy.employee_principal_links"], counts["eos_policy.employee_principal_links"]);
    assert.equal(after["eos_policy.audit_events"], counts["eos_policy.audit_events"] + 1);
  });

  await t.test("the login moved and the AUTHORITY did not", async () => {
    const p = (await q("SELECT * FROM eos_policy.principals WHERE id = $1", [ownerPrincipalId])).rows[0];
    assert.equal(p.identity_provider, FIREBASE_IDENTITY_PROVIDER);
    assert.equal(p.external_subject, FIREBASE_UID);
    assert.equal(p.display_name, boundDisplayName(PERSONA_EMAIL));
    assert.equal(p.status, "active", "the binding changed a status");

    // The synthetic subject is GONE as a subject -- there is no second Principal still carrying it.
    assert.equal((await q(
      "SELECT count(*)::int AS n FROM eos_policy.principals WHERE external_subject = $1", [OWNER_EXTERNAL_SUBJECT],
    )).rows[0].n, 0);

    // THE POINT OF THE SHAPE: same Principal id, same assignment id, same membership, same Roles.
    assert.equal(applied.ownerPrincipalId, ownerPrincipalId);
    assert.equal(applied.invariants.ownerPrincipalIdUnchanged, true);
    assert.equal(applied.invariants.ownerAssignmentIdUnchanged, true);
    assert.equal(applied.invariants.adminPrincipalReused, false);
    assert.deepEqual(await heldRoleKeys(ownerPrincipalId), before.roles);
    assert.deepEqual(
      (await q("SELECT id, status FROM eos_policy.tenant_memberships WHERE principal_id = $1", [ownerPrincipalId])).rows[0],
      before.membership,
    );
    assert.equal((await q(
      `SELECT a.id FROM eos_policy.user_role_assignments a
         JOIN eos_policy.roles r ON r.id = a.role_id
        WHERE a.principal_id = $1 AND r.key = $2 AND a.status = 'active'`, [ownerPrincipalId, OWNER_ROLE_KEY],
    )).rows[0].id, before.assignment);

    // The administrator still holds exactly what the bootstrap gave it.
    assert.deepEqual(await heldRoleKeys(adminPrincipalId), ["admin"]);
  });

  await t.test("the token now resolves to the Owner Principal by the pair a verifier can produce", async () => {
    const resolved = await repo.getPrincipalBySubject(FIREBASE_IDENTITY_PROVIDER, FIREBASE_UID);
    assert.equal(resolved.id, ownerPrincipalId);
    // ...and the provider no verifier recognizes resolves to nothing at all.
    assert.equal(await repo.getPrincipalBySubject(SYNTHETIC_IDENTITY_PROVIDER, OWNER_EXTERNAL_SUBJECT), null);
  });

  await t.test("the audit event carries BOTH bindings and the per-step reason", async () => {
    const rows = (await q(
      `SELECT action, target_kind, target_id, before, after, reason
         FROM eos_policy.audit_events WHERE action = 'rebindPrincipalIdentity'`,
    )).rows;
    assert.equal(rows.length, 1);
    const [e] = rows;
    assert.equal(e.target_kind, "principal");
    assert.equal(e.target_id, ownerPrincipalId);
    assert.equal(e.reason, BINDING_STEP_REASON);
    assert.equal(e.before.identityProvider, SYNTHETIC_IDENTITY_PROVIDER);
    assert.equal(e.before.externalSubject, OWNER_EXTERNAL_SUBJECT);
    assert.equal(e.after.identityProvider, FIREBASE_IDENTITY_PROVIDER);
    assert.equal(e.after.externalSubject, FIREBASE_UID);
    // NO CREDENTIAL REACHED THE AUDIT TRAIL, which is the one place a password would survive.
    assert.equal(JSON.stringify(e).includes(PASSWORD), false);
  });

  await t.test("A DETERMINISTIC RE-RUN reports NO_CHANGE and writes nothing at all", async () => {
    const counts = await rowCounts();
    const provider = alreadyExists();
    const second = await bindOwnerPersonaIdentity(pool, { ...options, apply: true }, deps(provider));
    assert.deepEqual(second.steps.map((s) => [s.step, s.outcome]), [
      ["authenticationIdentity", "NO_CHANGE"], ["principalIdentityBinding", "NO_CHANGE"],
    ]);
    // It RECONCILED rather than assumed: it signed in to confirm the same account is still there.
    assert.deepEqual(provider.calls.map((c) => c.method), ["signUp", "signInWithPassword"]);
    assert.equal(second.ownerPrincipalId, ownerPrincipalId);
    assert.deepEqual(await rowCounts(), counts, "a re-run wrote something, including an audit event");
  });

  await t.test("an existing account whose password does not sign in is REFUSED, never rotated", async () => {
    const counts = await rowCounts();
    await assert.rejects(
      () => bindOwnerPersonaIdentity(pool, { ...options, apply: true }, deps(existsWrongPassword())),
      /CREDENTIAL_ACCESS_FAILED/,
    );
    assert.deepEqual(await rowCounts(), counts);
  });

  await t.test("it refuses to re-bind the administering Principal, and refuses a contested identity", async () => {
    // The prohibition, reached the only way it can be: make the administrator the owner holder.
    const ownerRoleId = (await q("SELECT id FROM eos_policy.roles WHERE key = $1", [OWNER_ROLE_KEY])).rows[0].id;
    await q(`UPDATE eos_policy.user_role_assignments SET principal_id = $1
              WHERE principal_id = $2 AND role_id = $3`, [adminPrincipalId, ownerPrincipalId, ownerRoleId]);
    await assert.rejects(
      () => bindOwnerPersonaIdentity(pool, { ...options, apply: true }, deps(created())),
      /ADMIN_PRINCIPAL_REUSE_REFUSED/,
    );
    await q(`UPDATE eos_policy.user_role_assignments SET principal_id = $1
              WHERE principal_id = $2 AND role_id = $3`, [ownerPrincipalId, adminPrincipalId, ownerRoleId]);

    // A subject another Principal already holds would split one human's Roles across two.
    const contested = fakeProvider(() => ({ ok: true, body: { localId: "real-admin-subject", idToken: "x" } }));
    await assert.rejects(
      () => bindOwnerPersonaIdentity(pool, { ...options, apply: true }, deps(contested)),
      /another principal already holds that identity/,
    );
    assert.equal((await q("SELECT external_subject FROM eos_policy.principals WHERE id = $1", [ownerPrincipalId]))
      .rows[0].external_subject, FIREBASE_UID, "a refused run still moved the binding");
  });

  await t.test("FIREBASE SUPPLIES NO BUSINESS AUTHORITY: the whole run granted nothing", async () => {
    assert.equal((await q("SELECT count(*)::int AS n FROM eos_policy.principal_capabilities")).rows[0].n, 0);
    assert.deepEqual(await heldRoleKeys(ownerPrincipalId), [OWNER_ROLE_KEY]);
    // Nothing in this subsystem stores a claim, a Firestore role or an operational role -- so there
    // is no column a token could have written to even if the verifier read one.
    const claimish = (await q(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'eos_policy'
          AND (column_name ILIKE '%claim%' OR column_name ILIKE '%operational_role%' OR column_name ILIKE '%firebase%')`,
    )).rows;
    assert.deepEqual(claimish, []);
  });
});
