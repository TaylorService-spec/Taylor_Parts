// THE GENERIC GOVERNED IDENTITY RE-BIND OPERATOR, proved against a real postgres:16.
//
// ════════════════════ WHAT THIS SUITE EXISTS TO CLOSE ════════════════════
//
// `rebindPrincipalIdentity` (src/adminPolicy/policyCommands.ts) is a GENERAL governed command and is
// absent from ADMIN_MUTATION_OPERATIONS, so an operator script is its ONLY entry point. Until now the
// only committed entry point was scripts/bindOwnerPersonaIdentity.js, hard-coded to the Owner persona
// -- no --principalId, target found by the `owner` Role. Re-binding any OTHER Principal therefore
// required an uncommitted one-off driver, which is the definition of an ungoverned act.
//
// scripts/rebindPrincipalIdentity.js is that entry point for any Principal. This suite proves each
// of its guards BITES, on its own disposable database, migrated by the normal runner and dropped
// afterwards.
//
// ════════════════════ WHAT ONLY A REAL DATABASE CAN PROVE ════════════════════
//
//   1. THE ADMINISTERING AUTHORITY IS DERIVED, NOT ASSERTED. The Roles come from active rows in
//      eos_policy.user_role_assignments mapped through the tenant's Role catalog. A `heldRoleKeys`
//      or `capabilities` argument cannot help, and the raw assignment rows are shown to carry
//      roleId and NOT roleKey -- so the mapping is load-bearing rather than cosmetic.
//   2. A RE-BIND MOVES A LOGIN AND NOT AN AUTHORITY. Principal id, tenant membership, Employee link,
//      Security Role assignments, Work Eligibility, Operational Scope and direct capability grants
//      are byte-identical before and after. A mock cannot show that, because what is being proved is
//      that nothing ELSE in the schema moved.
//   3. EXACTLY ONE AUDIT EVENT, carrying BOTH bindings, as rows.
//   4. A re-run reports NO_CHANGE, writes no row, bumps no version and appends NO second event.
//   5. The dry run is a read: the row counts, the access version and the audit trail are untouched.
//
// NOTHING HERE CONTACTS AN IDENTITY PROVIDER, and the tool has no code that could: the new external
// subject is an identifier the operator already holds, and no credential is created, rotated,
// fetched or printed anywhere in this lane.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";
import { stripComments } from "./support/firestoreCollectionFence.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FUNCTIONS_DIR = resolve(HERE, "..");
const REPO_ROOT = resolve(FUNCTIONS_DIR, "..");
const require = createRequire(import.meta.url);

const TOOL = "scripts/rebindPrincipalIdentity.js";
const tool = require(`../${TOOL}`);

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

// ════════════════════════════════════════════════════════════════════════════════════════════
// PART 1. THE FENCES, BY SUBPROCESS.
//
// The property is not "the function throws" -- it is "the process refused BEFORE it was capable of
// touching a database". That is a claim about a whole process's history, so it is tested by running
// the real CLI as a real child with a preload that turns RESOLVING `pg` (or firebase-admin, or
// google-auth-library) into a visible failure. A tool that moved its guard below its requires would
// fail here with its refusal text and exit code unchanged. This is the precedent
// test/operatorScriptEnvironmentFence.test.mjs established; it is repeated here rather than weakened,
// so the new tool's fences travel with the suite that proves the rest of its behaviour.
// ════════════════════════════════════════════════════════════════════════════════════════════

const SENTINEL = "FENCE_VIOLATION_CLIENT_LIBRARY_LOADED";
const PRELOAD = `
const Module = require("node:module");
const BANNED = [/^pg(\\/|$)/, /^firebase-admin(\\/|$)/, /^google-auth-library(\\/|$)/, /^@google-cloud\\//];
const original = Module._load;
Module._load = function (request) {
  if (BANNED.some((re) => re.test(request))) {
    process.stderr.write("${SENTINEL}:" + request + "\\n");
  }
  return original.apply(this, arguments);
};
`;
const preloadPath = (() => {
  const dir = mkdtempSync(join(tmpdir(), "eos-rebind-fence-"));
  const p = join(dir, "banClientLibraries.cjs");
  writeFileSync(p, PRELOAD, "utf8");
  return p;
})();

/** Run the CLI with the environment deliberately STACKED to look production-capable. */
function runCli(args, extraEnv = {}) {
  return spawnSync(process.execPath, ["--require", preloadPath, TOOL, ...args], {
    cwd: FUNCTIONS_DIR,
    encoding: "utf8",
    env: {
      ...process.env,
      GOOGLE_CLOUD_PROJECT: "taylor-parts",
      GCLOUD_PROJECT: "taylor-parts",
      CLOUDSDK_CORE_PROJECT: "taylor-parts",
      ...extraEnv,
    },
  });
}

function assertRefusedBeforeAnySdk(res, label) {
  const output = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  assert.notEqual(res.status, 0, `${label}: expected a non-zero exit (a refusal), got ${res.status}`);
  assert.doesNotMatch(output, new RegExp(SENTINEL),
    `${label}: a client library was LOADED before the refusal -- the guard runs below a require.\n${output}`);
  assert.ok(output.trim().length > 0, `${label}: refused silently -- say why`);
  return output;
}

const FENCE_ENV = { EOS_ENVIRONMENT: "nonprod", REBIND_FENCE_DB: "postgres://fence:fence@127.0.0.1:1/never" };
const FENCE_REASON =
  "REBIND: Principal p-target lost its live Firebase login when the sandbox auth project was reset; "
  + "re-pointing the EOS binding at the uid the verifier now produces";
const BASE_ARGS = Object.freeze([
  "--environment", "platform-sandbox",
  "--databaseUrlEnv", "REBIND_FENCE_DB",
  "--tenantKey", "taylor-nonprod",
  "--adminPrincipalId", "p-admin",
  "--principalId", "p-target",
  "--newExternalSubject", "uid-new",
  "--reason", FENCE_REASON,
  "--apply",
]);
/** Drop a flag AND its value, which is what "the operator forgot this flag" actually looks like. */
function without(args, flag) {
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === `--${flag}`) { if (args[i + 1] && !args[i + 1].startsWith("--")) i += 1; continue; }
    out.push(args[i]);
  }
  return out;
}
const swap = (args, from, to) => args.map((a) => (a === from ? to : a));

for (const [label, args, env, pattern] of [
  ["no environment named", without(BASE_ARGS, "environment"), FENCE_ENV, /--environment is required/],
  // PRODUCTION, refused twice over: by declared role and by the customer project id.
  ["the production environment", swap(BASE_ARGS, "platform-sandbox", "taylor-parts-production"), FENCE_ENV, /production/],
  ["an environment id that is not declared", swap(BASE_ARGS, "platform-sandbox", "platform-sandbox-2"), FENCE_ENV, /byte-identical to an environment id/],
  ["EOS_ENVIRONMENT not nonprod", BASE_ARGS, { ...FENCE_ENV, EOS_ENVIRONMENT: "production" }, /EOS_ENVIRONMENT must read exactly 'nonprod'/],
  ["EOS_ENVIRONMENT unset", BASE_ARGS, { ...FENCE_ENV, EOS_ENVIRONMENT: "" }, /EOS_ENVIRONMENT must read exactly 'nonprod'/],
  ["the frozen Certification world", swap(BASE_ARGS, "platform-sandbox", "platform-certification"), FENCE_ENV, /Certification world, which is frozen/],
  ["no databaseUrlEnv", without(BASE_ARGS, "databaseUrlEnv"), FENCE_ENV, /--databaseUrlEnv <VAR> is required/],
  ["a databaseUrlEnv naming an unset variable", BASE_ARGS, { ...FENCE_ENV, REBIND_FENCE_DB: "" }, /empty or unset/],
  ["no tenant key", without(BASE_ARGS, "tenantKey"), FENCE_ENV, /--tenantKey is required/],
  ["no administering Principal", without(BASE_ARGS, "adminPrincipalId"), FENCE_ENV, /--adminPrincipalId is required/],
  ["no target Principal", without(BASE_ARGS, "principalId"), FENCE_ENV, /--principalId is required/],
  ["no new external subject", without(BASE_ARGS, "newExternalSubject"), FENCE_ENV, /--newExternalSubject is required/],
  ["no reason", without(BASE_ARGS, "reason"), FENCE_ENV, /--reason is required/],
  ["a reason too short to be one", swap(BASE_ARGS, FENCE_REASON, "uid drift"), FENCE_ENV, /REASON_NOT_SPECIFIC/],
  ["a reason that names no Principal", swap(BASE_ARGS, FENCE_REASON,
    "the login stopped working after the sandbox authentication project was reset, so this repairs it"),
  FENCE_ENV, /must NAME THE TARGET PRINCIPAL ID/],
  ["the administering Principal as its own target", swap(BASE_ARGS, "p-admin", "p-target"), FENCE_ENV, /ADMIN_PRINCIPAL_SELF_REBIND_REFUSED/],
  // THE AUTHORITY-SHAPED ARGUMENTS. Unrepresentable, not merely unused.
  ["an asserted heldRoleKeys argument", [...BASE_ARGS, "--heldRoleKeys", "owner"], FENCE_ENV, /AUTHORITY_ARGUMENT_REFUSED/],
  ["an asserted capabilities argument", [...BASE_ARGS, "--capabilities", "admin.principal.write"], FENCE_ENV, /AUTHORITY_ARGUMENT_REFUSED/],
  ["an asserted roles argument", [...BASE_ARGS, "--roles", "admin"], FENCE_ENV, /AUTHORITY_ARGUMENT_REFUSED/],
  // A CREDENTIAL ON A COMMAND LINE.
  ["a password flag", [...BASE_ARGS, "--password", "anything"], FENCE_ENV, /CREDENTIAL_ARGUMENT_REFUSED/],
  ["a connection string flag", [...BASE_ARGS, "--databaseUrl", "postgres://x"], FENCE_ENV, /CREDENTIAL_ARGUMENT_REFUSED/],
  // A MISSPELLED FENCE IS A MISSING FENCE.
  ["an unknown flag", [...BASE_ARGS, "--force"], FENCE_ENV, /UNKNOWN_FLAG_REFUSED/],
  ["a misspelled expectedOldSubject", [...BASE_ARGS, "--expectedOldSubjects", "x"], FENCE_ENV, /UNKNOWN_FLAG_REFUSED/],
  ["a valueless expectedOldSubject", [...BASE_ARGS, "--expectedOldSubject"], FENCE_ENV, /compare-and-swap guard, so an empty one/],
  ["a malformed identity provider", [...BASE_ARGS, "--identityProvider", "Firebase Auth"], FENCE_ENV, /IDENTITY_PROVIDER_MALFORMED/],
]) {
  test(`identity re-bind operator: refuses (${label}) before pg is even resolved`, () => {
    const res = runCli(args, env);
    const out = assertRefusedBeforeAnySdk(res, `identity re-bind, ${label}`);
    assert.match(out, pattern);
  });
}

test("identity re-bind operator: the dry run is the DEFAULT -- --apply is the only way to write", () => {
  // No --apply, and everything else complete: the refusal it reaches is the DATABASE one, which is
  // proof that `apply` has no ambient source. (It cannot connect: the fence URL points nowhere.)
  const src = readFileSync(resolve(FUNCTIONS_DIR, TOOL), "utf8");
  assert.match(src, /apply: args\.apply === "true"/, "apply is not read from argv alone");
  assert.equal(/process\.env\.\w*APPLY/i.test(src), false, "an environment variable can turn writing on");
  assert.equal(/apply\s*=\s*true/.test(src), false, "apply defaults to true somewhere");
});

// ════════════════════ THE SOURCE CENSUS: what this tool may not contain ════════════════════

test("identity re-bind operator: no credential flag, no asserted authority, NO RAW SQL MUTATION", () => {
  // Judged on the CODE, with comments stripped: this file's header discusses the manual UPDATE it
  // exists to replace, and a census that cannot tell prose from a statement is a census that has to
  // be worded around.
  const src = stripComments(readFileSync(resolve(FUNCTIONS_DIR, TOOL), "utf8"));

  // 1. NEVER an authority or a credential from argv.
  for (const forbidden of [
    /args\.heldRoleKeys\b/, /args\.capabilities\b/, /args\.roles\b/, /args\.role\b/,
    /args\.password\b/, /args\.token\b/, /args\.secret\b/, /args\.credential\b/,
  ]) {
    assert.equal(forbidden.test(src), false, `${TOOL} reads ${forbidden} from argv`);
  }
  // The derivation, present and pointed at PostgreSQL.
  assert.match(src, /listAssignmentsForPrincipal/);
  assert.match(src, /hasAdministrationAuthority\(heldRoleKeys, "assignRole"\)/);

  // 2. NO RAW SQL MUTATION. Every statement in this file is a SELECT; the only write is the command.
  const statements = [...src.matchAll(/\b(INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|ALTER\s+TABLE|DROP\s+\w|TRUNCATE|CREATE\s+TABLE)\b/gi)]
    .map((m) => m[0]);
  assert.deepEqual(statements, [], `${TOOL} contains a raw SQL mutation: ${statements.join(", ")}`);
  assert.match(src, /rebindPrincipalIdentity: require\("\.\.\/lib\/adminPolicy\/policyCommands\.js"\)\.rebindPrincipalIdentity/);

  // 3. NO FIREBASE OF ANY KIND -- no Firestore client, no Admin SDK, no identity-provider call.
  for (const forbidden of [/require\(\s*["']firebase/, /from\s+["']firebase/, /getFirestore/, /identitytoolkit/i, /\bfetch\(/]) {
    assert.equal(forbidden.test(src), false, `${TOOL} reaches Firebase or an identity provider via ${forbidden}`);
  }
  // 4. It never mints, rotates or prints a credential.
  for (const forbidden of [/signUp/, /signInWithPassword/, /createCustomToken/, /passwordReset/i, /setCustomUserClaims/]) {
    assert.equal(forbidden.test(src), false, `${TOOL} touches a credential via ${forbidden}`);
  }
});

const walk = (dir, exts) => {
  const out = [];
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".git" || entry === "lib" || entry === "dist") continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) { out.push(...walk(p, exts)); continue; }
    if (exts.some((e) => entry.endsWith(e))) out.push(p);
  }
  return out;
};

test("STRUCTURAL: no runtime module composes the operator tool, and no workflow runs it", () => {
  // The tool is run by a PERSON, deliberately, once. Anything that could call it on a schedule or
  // from a request handler would make a governed operator act an ambient one.
  const offenders = [];
  for (const root of ["functions/src", "field-ops-app-vite/src", "integrations"]) {
    for (const file of walk(join(REPO_ROOT, root), [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"])) {
      const text = readFileSync(file, "utf8");
      if (/scripts\/rebindPrincipalIdentity/.test(text)) offenders.push(relative(REPO_ROOT, file).split(sep).join("/"));
    }
  }
  assert.deepEqual(offenders, [], "a runtime source names the operator script");

  const pkg = JSON.parse(readFileSync(join(FUNCTIONS_DIR, "package.json"), "utf8"));
  assert.doesNotMatch(
    JSON.stringify({ main: pkg.main, exports: pkg.exports ?? null, bin: pkg.bin ?? null, scripts: pkg.scripts }),
    /scripts\/rebindPrincipalIdentity/,
    "the operator tool is an npm entry point",
  );
  const wfDir = join(REPO_ROOT, ".github", "workflows");
  for (const wf of readdirSync(wfDir)) {
    const text = readFileSync(join(wfDir, wf), "utf8");
    for (const line of text.split("\n").filter((l) => /scripts\/rebindPrincipalIdentity/.test(l))) {
      assert.match(line.trim(), /^- "functions\/scripts\/rebindPrincipalIdentity\.js"$/,
        `${wf} may name the tool only as a path filter: ${line}`);
    }
  }
});

test("REGISTRATION: the suite is in test:adminPolicyPostgres and both workflow path filters", () => {
  const pkg = JSON.parse(readFileSync(join(FUNCTIONS_DIR, "package.json"), "utf8"));
  assert.match(pkg.scripts["test:adminPolicyPostgres"], /test\/principalIdentityRebindPostgres\.test\.mjs/);
  const wf = readFileSync(join(REPO_ROOT, ".github", "workflows", "eos-admin-policy-tests.yml"), "utf8");
  for (const named of ["functions/scripts/rebindPrincipalIdentity.js", "functions/test/principalIdentityRebindPostgres.test.mjs"]) {
    assert.equal(
      [...wf.matchAll(new RegExp(`- "${named.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`, "g"))].length, 2,
      `${named} must be named by BOTH the pull_request and the push path filter`,
    );
  }
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// PART 2. THE BEHAVIOUR, AGAINST A REAL DATABASE.
// ════════════════════════════════════════════════════════════════════════════════════════════

const DB_NAME = `principal_rebind_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const dbUrl = () => { const u = new URL(URL_BASE); u.pathname = `/${DB_NAME}`; return u.toString(); };
async function withClient(url, fn) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}

const TENANT_KEY = "taylor-nonprod";
const OLD_SUBJECT = "old-dispatcher-uid-0000001";
const NEW_SUBJECT = "new-dispatcher-uid-0000002";
const ADMIN_SUBJECT = "administering-principal-uid";

const COUNTED = [
  "eos_policy.principals", "eos_policy.tenant_memberships", "eos_policy.user_role_assignments",
  "eos_policy.principal_capabilities", "eos_policy.role_capabilities", "eos_policy.roles",
  "eos_policy.audit_events", "eos_policy.principal_access_versions",
  "eos_workforce.employees", "eos_policy.employee_principal_links",
  "eos_workforce.employee_work_eligibility", "eos_workforce.employee_operational_scopes",
];

test("the generic governed identity re-bind operator, in PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${DB_NAME}`));
  let pool;
  t.after(async () => {
    if (pool) await pool.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`));
  });
  execFileSync(process.execPath,
    ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations", "--no-check-order"],
    { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrl() }, stdio: "pipe" });

  const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");
  const { rebindPrincipalIdentity } = require("../lib/adminPolicy/policyCommands.js");
  const { hasAdministrationAuthority } = require("../lib/adminPolicy/administrationAuthority.js");
  const { bootstrapTenant, bootstrapAdministrator } = require("../lib/adminPolicy/tenantBootstrap.js");

  pool = new pg.Pool({ connectionString: dbUrl(), max: 6 });
  const q = (text, values = []) => pool.query(text, values);
  const repo = new PostgresPolicyRepository(pool);
  const deps = { PostgresPolicyRepository, rebindPrincipalIdentity, hasAdministrationAuthority };

  const { tenant } = await bootstrapTenant(repo, {
    key: TENANT_KEY, name: "Identity re-bind proof tenant", actorUid: "rebind-proof",
  });
  const tenantId = tenant.id;
  const admin = await bootstrapAdministrator(repo, {
    tenantId, externalSubject: ADMIN_SUBJECT, performedBy: "rebind-proof",
  });
  const adminPrincipalId = admin.principal.id;

  /** A Principal holding one SEEDED catalog Role, created through the repository, never by hand. */
  async function makePrincipal(subject, roleKey) {
    const role = await repo.getRoleByKey(tenantId, roleKey);
    assert.ok(role, `the seed defines the ${roleKey} Role`);
    const actor = { tenantId, uid: "rebind-proof-fixture" };
    const principalId = await repo.transact(actor, async (tx) => {
      const p = await tx.createPrincipal({ externalSubject: subject, identityProvider: "firebase" });
      await tx.createTenantMembership(p.id);
      return p.id;
    });
    await repo.transact(actor, async (tx) => {
      const accessVersion = await tx.bumpAccessVersion(principalId);
      return tx.createAssignment({
        principalId, roleId: role.id, scopeType: "global", scopeValue: null, status: "active",
        grantedBy: "rebind-proof-fixture", grantedAt: new Date().toISOString(), accessVersionAtGrant: accessVersion,
      });
    });
    return principalId;
  }

  // THE TARGET: a `dispatcher` Principal -- the persona whose live uid actually drifted, and NOT an
  // administering Role, so nothing here is proved on an Owner-shaped special case.
  const targetId = await makePrincipal(OLD_SUBJECT, "dispatcher");
  // An unauthorized would-be administrator: a real Principal, active, a member, holding a Role that
  // may not assign Roles.
  const technicianId = await makePrincipal("technician-principal-uid", "technician");

  // The target's FULL authority footprint, so "preserved" has something to preserve.
  await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id, updated_at)
           VALUES ('emp-dispatch', $1, 'ACTIVE', 'taylor', '2020-01-01T00:00:00Z')`, [tenantId]);
  await q(`INSERT INTO eos_policy.employee_principal_links
             (id, tenant_id, principal_id, employee_id, operating_company_id, link_source, asserted_by, assertion_reason)
           VALUES ('epl-dispatch', $1, $2, 'emp-dispatch', 'taylor', 'OPERATOR_ASSERTED', 'rebind-proof', 'proof fixture')`,
  [tenantId, targetId]);
  await q(`INSERT INTO eos_ops.warehouses
             (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by)
           VALUES ('wh-proof', $1, 'taylor', 'Proof Warehouse', 'Somewhere, AZ', 'ACTIVE', 'NATIVE', 'rebind-proof', 'rebind-proof')`,
  [tenantId]);
  await q(`INSERT INTO eos_workforce.employee_work_eligibility
             (id, tenant_id, employee_id, qualification_code, effective_from, assigned_by)
           VALUES ('we-proof', $1, 'emp-dispatch', 'WAREHOUSE_OPERATIONS', '2020-01-01T00:00:00Z', 'rebind-proof')`, [tenantId]);
  await q(`INSERT INTO eos_workforce.employee_operational_scopes
             (id, tenant_id, employee_id, scope_type, scope_id, effective_from, assigned_by)
           VALUES ('os-proof', $1, 'emp-dispatch', 'WAREHOUSE', 'wh-proof', '2020-01-01T00:00:00Z', 'rebind-proof')`, [tenantId]);
  // ONE direct Principal grant, so "direct grant count unchanged" is a comparison against a non-zero
  // number. A check that only ever compares 0 to 0 cannot fail.
  const someCapability = (await q("SELECT id, key FROM eos_policy.capabilities ORDER BY id LIMIT 1")).rows[0];
  await q(`INSERT INTO eos_policy.principal_capabilities
             (id, tenant_id, principal_id, capability_id, granted_by, created_by, updated_by)
           VALUES ('pc-proof', $1, $2, $3, 'rebind-proof', 'rebind-proof', 'rebind-proof')`,
  [tenantId, targetId, someCapability.id]);

  const REASON =
    `REBIND: Principal ${targetId} (dispatcher persona) lost its live Firebase login when the sandbox `
    + "authentication project was reset; re-pointing the EOS binding at the uid the verifier now produces";
  const options = Object.freeze({
    environmentId: "platform-sandbox",
    connectionString: "never-read-by-the-run-function",
    tenantKey: TENANT_KEY,
    adminPrincipalId,
    principalId: targetId,
    identityProvider: "firebase",
    newExternalSubject: NEW_SUBJECT,
    expectedOldSubject: undefined,
    displayName: undefined,
    reason: REASON,
    apply: false,
  });
  const run = (over = {}) => tool.rebindPrincipalIdentityRun(pool, { ...options, ...over }, deps);

  async function rowCounts() {
    const out = {};
    for (const rel of COUNTED) out[rel] = (await q(`SELECT count(*)::int AS n FROM ${rel}`)).rows[0].n;
    return out;
  }
  const rebindAudits = async () => (await q(
    `SELECT action, target_kind, target_id, actor_uid, before, after, reason FROM eos_policy.audit_events
      WHERE action = 'rebindPrincipalIdentity' ORDER BY occurred_at, id`)).rows;
  const accessVersion = async () => (await q(
    "SELECT access_version FROM eos_policy.principal_access_versions WHERE tenant_id = $1 AND principal_id = $2",
    [tenantId, targetId])).rows[0]?.access_version ?? null;

  const before = await tool.readAuthorityDimensions(pool, tenantId, targetId);

  await t.test("THE AUTHORITY IS DERIVED FROM POSTGRESQL, and the raw rows carry roleId not roleKey", async () => {
    const rows = await repo.listAssignmentsForPrincipal(tenantId, adminPrincipalId);
    assert.ok(rows.length >= 1);
    for (const row of rows) {
      assert.equal(typeof row.roleId, "string");
      assert.equal(Object.prototype.hasOwnProperty.call(row, "roleKey"), false,
        "listAssignmentsForPrincipal now returns roleKey -- the catalog mapping in the tool is what makes the gate work");
    }
    // The tool's report prints the DERIVED keys and names where it read them.
    const report = await run();
    assert.deepEqual(report.adminHeldRoleKeys, ["admin"]);
    assert.equal(report.adminAuthoritySource, "postgresql:eos_policy.user_role_assignments");
  });

  await t.test("DERIVED, NOT ASSERTED: extra authority fields on the input change nothing", async () => {
    // The unauthorized Principal, handed every argument an attacker would want. The run function has
    // no field for any of them, so the gate still reads the database and still refuses.
    await assert.rejects(
      () => run({
        adminPrincipalId: technicianId,
        heldRoleKeys: ["owner", "admin"], capabilities: ["*"], roles: ["admin"], apply: true,
      }),
      /ADMINISTRATOR_UNAUTHORIZED/,
    );
    assert.deepEqual(await tool.readAuthorityDimensions(pool, tenantId, targetId), before);
  });

  await t.test("DRY RUN BY DEFAULT: it plans, and writes nothing -- not a row, a version or an event", async () => {
    const counts = await rowCounts();
    const version = await accessVersion();
    const report = await run();
    assert.equal(report.apply, false);
    assert.equal(report.outcome, "PLANNED");
    assert.equal(report.externalSubjectBefore, OLD_SUBJECT);
    assert.equal(report.externalSubjectAfter, OLD_SUBJECT, "a dry run moved the binding");
    assert.equal(report.auditEvents.appended, 0);
    assert.deepEqual(tool.violations(report), []);
    assert.deepEqual(await rowCounts(), counts, "a dry run wrote something");
    assert.equal(await accessVersion(), version, "a dry run bumped the access version");
    assert.deepEqual(await rebindAudits(), []);
  });

  await t.test("REFUSED: a wrong --expectedOldSubject is a compare-and-swap failure, and writes nothing", async () => {
    const counts = await rowCounts();
    await assert.rejects(() => run({ expectedOldSubject: "a-subject-this-principal-does-not-hold", apply: true }),
      /EXPECTED_SUBJECT_MISMATCH/);
    assert.deepEqual(await rowCounts(), counts);
    assert.equal((await tool.readAuthorityDimensions(pool, tenantId, targetId)).externalSubject, OLD_SUBJECT);
  });

  await t.test("REFUSED: a subject another active Principal already holds", async () => {
    const counts = await rowCounts();
    await assert.rejects(() => run({ newExternalSubject: ADMIN_SUBJECT, apply: true }), /IDENTITY_ALREADY_HELD/);
    assert.deepEqual(await rowCounts(), counts);
  });

  await t.test("REFUSED: a target that does not exist, and one whose membership is not active", async () => {
    await assert.rejects(() => run({ principalId: `missing-${randomUUID()}`, apply: true }),
      /TARGET_PRINCIPAL_NOT_FOUND/);

    await q("UPDATE eos_policy.tenant_memberships SET status = 'disabled' WHERE principal_id = $1", [targetId]);
    await assert.rejects(() => run({ apply: true }), /TARGET_MEMBERSHIP_INACTIVE/);
    await q("UPDATE eos_policy.tenant_memberships SET status = 'active' WHERE principal_id = $1", [targetId]);
  });

  await t.test("REFUSED: an administering Principal with no Role that may assign Roles", async () => {
    await assert.rejects(() => run({ adminPrincipalId: technicianId, apply: true }), /ADMINISTRATOR_UNAUTHORIZED/);
    // ...and one that is not a member at all, or not active.
    await q("UPDATE eos_policy.principals SET status = 'disabled' WHERE id = $1", [technicianId]);
    await assert.rejects(() => run({ adminPrincipalId: technicianId, apply: true }), /ADMINISTRATOR_INVALID/);
    await q("UPDATE eos_policy.principals SET status = 'active' WHERE id = $1", [technicianId]);
    await assert.rejects(() => run({ adminPrincipalId: `missing-${randomUUID()}`, apply: true }), /ADMINISTRATOR_INVALID/);
  });

  await t.test("REFUSED: the administering Principal may never be its own target", async () => {
    await assert.rejects(() => run({ principalId: adminPrincipalId, apply: true }),
      /ADMIN_PRINCIPAL_SELF_REBIND_REFUSED/);
  });

  let applied;
  await t.test("--apply RE-BINDS the same Principal, and appends EXACTLY ONE audit event", async () => {
    const counts = await rowCounts();
    const version = await accessVersion();
    applied = await run({ apply: true, expectedOldSubject: OLD_SUBJECT });
    assert.equal(applied.outcome, "REBOUND");
    assert.equal(applied.expectedOldSubjectAsserted, true);
    assert.equal(applied.externalSubjectBefore, OLD_SUBJECT);
    assert.equal(applied.externalSubjectAfter, NEW_SUBJECT);
    assert.equal(applied.auditEvents.appended, 1);
    assert.deepEqual(tool.violations(applied), []);

    const after = await rowCounts();
    // NOT ONE NEW ROW ANYWHERE except the audit event.
    for (const rel of COUNTED.filter((r) => r !== "eos_policy.audit_events")) {
      assert.equal(after[rel], counts[rel], `${rel} changed row count during a re-bind`);
    }
    assert.equal(after["eos_policy.audit_events"], counts["eos_policy.audit_events"] + 1);
    // The access version moves exactly as the governed command already moves it: by one, upward.
    assert.equal(applied.accessVersionAfter, applied.accessVersionBefore + 1);
    assert.equal(await accessVersion(), version + 1);
  });

  await t.test("PRESERVED: id, membership, Employee link, Security Roles, Eligibility, Scope, direct grants", async () => {
    const after = await tool.readAuthorityDimensions(pool, tenantId, targetId);
    for (const key of tool.PRESERVED_KEYS) {
      assert.deepEqual(after[key], before[key], `${key} moved during a re-bind`);
      assert.equal(applied.preserved[key], true);
    }
    // Spelled out, because each of these is a separate authority the legacy model conflated.
    assert.equal(after.principalId, targetId);
    assert.equal(after.status, "active");
    assert.deepEqual(after.securityRoles.map((r) => r.role_key), ["dispatcher"]);
    assert.deepEqual(after.memberships.map((m) => m.status), ["active"]);
    assert.deepEqual(after.employeeLinks.map((l) => l.employee_id), ["emp-dispatch"]);
    assert.deepEqual(after.workEligibility.map((w) => w.qualification_code), ["WAREHOUSE_OPERATIONS"]);
    assert.deepEqual(after.operationalScope.map((s) => [s.scope_type, s.scope_id]), [["WAREHOUSE", "wh-proof"]]);
    assert.deepEqual(after.directGrants, [someCapability.key]);
    assert.equal(after.directGrantCount, 1);
    // ...and the ONLY thing that moved is the binding.
    assert.equal(after.externalSubject, NEW_SUBJECT);
    assert.equal(after.identityProvider, "firebase");
    assert.equal(after.displayName, before.displayName, "an omitted --displayName changed the display name");
  });

  await t.test("the token now resolves to the SAME Principal, and the old subject resolves to nothing", async () => {
    assert.equal((await repo.getPrincipalBySubject("firebase", NEW_SUBJECT)).id, targetId);
    assert.equal(await repo.getPrincipalBySubject("firebase", OLD_SUBJECT), null);
  });

  await t.test("EXACTLY ONE AUDIT EVENT, carrying BOTH bindings and the specific reason", async () => {
    const rows = await rebindAudits();
    assert.equal(rows.length, 1);
    const [e] = rows;
    assert.equal(e.target_kind, "principal");
    assert.equal(e.target_id, targetId);
    // The actor recorded is the administering Principal whose authority was READ, not a free-text label.
    assert.equal(e.actor_uid, adminPrincipalId);
    assert.equal(e.reason, REASON);
    assert.ok(e.reason.includes(targetId), "the stored reason does not name its own target");
    assert.equal(e.before.identityProvider, "firebase");
    assert.equal(e.before.externalSubject, OLD_SUBJECT);
    assert.equal(e.after.externalSubject, NEW_SUBJECT);
    assert.equal(e.before.displayName, e.after.displayName);
  });

  await t.test("IDEMPOTENT: an identical re-run reports NO_CHANGE and appends NO second event", async () => {
    const counts = await rowCounts();
    const version = await accessVersion();
    const second = await run({ apply: true, expectedOldSubject: NEW_SUBJECT });
    assert.equal(second.outcome, "NO_CHANGE");
    assert.equal(second.auditEvents.appended, 0);
    assert.equal(second.auditEvents.rebindEventsAfter, 1);
    assert.deepEqual(tool.violations(second), []);
    assert.deepEqual(await rowCounts(), counts, "a re-run wrote something, including an audit event");
    assert.equal(await accessVersion(), version, "a re-run bumped the access version");
    assert.equal((await rebindAudits()).length, 1);
    // And a THIRD run, the dry-run way round: it reports the reconciled state rather than a plan.
    const third = await run();
    assert.equal(third.outcome, "NO_CHANGE");
    assert.equal(third.auditEvents.appended, 0);
  });

  // ════════════════════ THE DOCUMENTED INVOCATION, AS A REAL PROCESS ════════════════════
  //
  // Everything above drives the exported run function. This drives the COMMAND LINE the header
  // documents, as a child process, against this same disposable database: the flag names, the
  // dry-run default, the exit codes and the JSON receipt. A require path or a flag name that only
  // main() touches is invisible to every other test in this file.
  await t.test("THE REAL CLI: the documented command line, its exit codes and its JSON receipt", async () => {
    const FINAL_SUBJECT = "final-dispatcher-uid-0000003";
    const cliEnv = { ...process.env, EOS_ENVIRONMENT: "nonprod", REBIND_PROOF_DB: dbUrl() };
    const cli = (extra) => spawnSync(process.execPath, [TOOL,
      "--environment", "platform-sandbox",
      "--databaseUrlEnv", "REBIND_PROOF_DB",
      "--tenantKey", TENANT_KEY,
      "--adminPrincipalId", adminPrincipalId,
      "--principalId", targetId,
      "--reason", REASON,
      ...extra,
    ], { cwd: FUNCTIONS_DIR, encoding: "utf8", env: cliEnv });

    // 1. THE DRY RUN IS THE DEFAULT. No --apply, a complete invocation, and the state is reconciled.
    const counts = await rowCounts();
    const dry = cli(["--newExternalSubject", FINAL_SUBJECT, "--expectedOldSubject", NEW_SUBJECT]);
    assert.equal(dry.status, 0, `${dry.stdout}${dry.stderr}`);
    const dryReport = JSON.parse(dry.stdout);
    assert.equal(dryReport.apply, false);
    assert.equal(dryReport.outcome, "PLANNED");
    assert.equal(dryReport.externalSubjectAfter, NEW_SUBJECT, "the CLI dry run moved the binding");
    assert.deepEqual(await rowCounts(), counts, "the CLI dry run wrote something");

    // 2. A FAILED COMPARE-AND-SWAP IS EXIT 2, and says so without a stack trace.
    const cas = cli(["--newExternalSubject", FINAL_SUBJECT, "--expectedOldSubject", OLD_SUBJECT]);
    assert.equal(cas.status, 2);
    assert.match(`${cas.stdout}${cas.stderr}`, /EXPECTED_SUBJECT_MISMATCH/);
    assert.deepEqual(await rowCounts(), counts);

    // 3. --apply WRITES, once, through the governed command, with --displayName honoured.
    const applyRes = cli([
      "--newExternalSubject", FINAL_SUBJECT, "--expectedOldSubject", NEW_SUBJECT,
      "--displayName", "SYNTHETIC NONPROD Dispatcher (fixture)", "--apply",
    ]);
    assert.equal(applyRes.status, 0, `${applyRes.stdout}${applyRes.stderr}`);
    const report = JSON.parse(applyRes.stdout);
    assert.equal(report.outcome, "REBOUND");
    assert.equal(report.auditEvents.appended, 1);
    assert.equal(report.externalSubjectAfter, FINAL_SUBJECT);
    assert.equal(report.displayNameAfter, "SYNTHETIC NONPROD Dispatcher (fixture)");
    assert.deepEqual(Object.values(report.preserved), Object.values(report.preserved).map(() => true));
    assert.equal((await rebindAudits()).length, 2);

    // 4. AND IT IS IDEMPOTENT THROUGH THE CLI TOO: rerun, NO_CHANGE, no second event, exit 0.
    const after = await rowCounts();
    const again = cli(["--newExternalSubject", FINAL_SUBJECT, "--displayName", "SYNTHETIC NONPROD Dispatcher (fixture)", "--apply"]);
    assert.equal(again.status, 0, `${again.stdout}${again.stderr}`);
    assert.equal(JSON.parse(again.stdout).outcome, "NO_CHANGE");
    assert.equal(JSON.parse(again.stdout).auditEvents.appended, 0);
    assert.deepEqual(await rowCounts(), after, "a CLI re-run wrote something");
    assert.equal((await rebindAudits()).length, 2);

    // 5. NO CONNECTION STRING, AND NOTHING SECRET, IS EVER PRINTED.
    for (const out of [dry.stdout, dry.stderr, applyRes.stdout, applyRes.stderr, again.stdout, cas.stderr]) {
      assert.equal((out ?? "").includes("REBIND_PROOF_DB"), false);
      assert.equal(/postgres(ql)?:\/\//.test(out ?? ""), false, "a connection string reached the output");
    }
  });

  await t.test("the violations() check BITES: a moved dimension is a non-zero exit, not a field", () => {
    const tampered = {
      ...applied,
      preserved: { ...applied.preserved, securityRoles: false },
      auditEvents: { ...applied.auditEvents, appended: 2 },
    };
    const broke = tool.violations(tampered);
    assert.ok(broke.some((v) => /securityRoles/.test(v)));
    assert.ok(broke.some((v) => /appended 2 audit event/.test(v)));
    assert.deepEqual(tool.violations({ ...applied, apply: false, auditEvents: { ...applied.auditEvents, appended: 1 } })
      .filter((v) => /dry run/.test(v)).length > 0, true);
  });

  await t.test("FIREBASE SUPPLIED NO BUSINESS AUTHORITY: the whole run granted nothing new", async () => {
    assert.equal((await q("SELECT count(*)::int AS n FROM eos_policy.principal_capabilities")).rows[0].n, 1,
      "the one fixture grant, unchanged -- no grant was created or removed");
    assert.deepEqual(
      (await q(`SELECT r.key FROM eos_policy.user_role_assignments a JOIN eos_policy.roles r ON r.id = a.role_id
                 WHERE a.principal_id = $1 AND a.status = 'active' ORDER BY r.key`, [targetId])).rows.map((r) => r.key),
      ["dispatcher"],
    );
    // No audit action other than the one re-bind touched this Principal in the applied phase.
    const actions = (await q(
      "SELECT DISTINCT action FROM eos_policy.audit_events WHERE target_id = $1 ORDER BY action", [targetId],
    )).rows.map((r) => r.action);
    assert.deepEqual(actions, ["rebindPrincipalIdentity"]);
  });
});
