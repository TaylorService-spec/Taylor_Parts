// THE GOVERNED PRINCIPAL PROVISIONING OPERATOR, against a real postgres:16.
//
// ════════════════════ THE VERDICT THIS SUITE ENCODES ════════════════════
//
// A governed Principal creation command ALREADY EXISTS -- `ensureTenantPrincipal`
// (src/adminPolicy/tenantBootstrap.ts) -- and it is REUSED, not forked: PART 0 below proves by
// reading the operator's source that it contains no Principal INSERT, no membership INSERT and no
// transaction of its own, so there is exactly ONE writable Principal creation path in this
// repository. What was missing was the GUARDS, and those are what the rest of this file proves.
//
// ════════════════════ WHAT ONLY A REAL DATABASE CAN PROVE ════════════════════
//
//   1. THE AUTHORITY IS RESOLVED LIVE, from `eos_policy.role_capabilities` through
//      `capabilitiesForRoleKeys` UNIONED with `eos_policy.principal_capabilities` through
//      `principalCapabilityGrants`. Both halves are proved LOAD-BEARING: the SAME administering
//      Principal is refused and then authorized by nothing but the presence of a grant row, once for
//      each half. A Role-key gate would have answered differently for the direct-grant half, which is
//      precisely the defect the standing Owner ruling names.
//   2. EXACTLY ONE audit event, carrying the specific reason, and a re-run appends NONE -- the early
//      return that produces that is inside the governed command, so no mock could show it.
//   3. NOTHING ELSE MOVED: no Security Role assignment, no Employee, no employee_principal_link, no
//      direct capability grant, `eos_policy.capabilities` still 79 and `role_capabilities` unchanged.
//   4. The refusals are refusals of the DATABASE STATE, not of an argument: a duplicate external
//      subject, a duplicate canonical Principal, a retired membership and a cross-tenant
//      administrator are each read out of PostgreSQL before anything is written.
//
// Its OWN database, migrated by the normal runner and dropped afterwards.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

const HERE = dirname(fileURLToPath(import.meta.url));
const FUNCTIONS_DIR = resolve(HERE, "..");
const require = createRequire(import.meta.url);
const tool = require("../scripts/provisionGovernedPrincipal.js");

const TOOL_PATH = join(FUNCTIONS_DIR, "scripts", "provisionGovernedPrincipal.js");
const COMMAND_PATH = join(FUNCTIONS_DIR, "src", "adminPolicy", "tenantBootstrap.ts");

// ════════════════════════════════════════════════════════════════════════════════════════════
// PART 0. THE COMMAND IS REUSED, NOT FORKED. No database needed, and it is the first claim the
// task's verdict rests on: a second writable Principal creation path is the defect class, so its
// absence is proved structurally rather than asserted in a comment.
// ════════════════════════════════════════════════════════════════════════════════════════════

test("PART 0 -- the operator creates nothing itself: ONE writable Principal path exists", () => {
  const src = readFileSync(TOOL_PATH, "utf8");
  // Comments stripped, because this file's own prose names every one of these tables.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  for (const forbidden of [
    /INSERT\s+INTO/i, /\bUPDATE\s+eos_policy/i, /\bDELETE\s+FROM/i, /\bALTER\s+TABLE/i,
    /repo\.transact\s*\(/, /createPrincipal\s*\(/, /createTenantMembership\s*\(/,
    /setTenantMembershipStatus\s*\(/, /appendAudit\s*\(/, /createAssignment\s*\(/,
    /bumpAccessVersion\s*\(/, /assignRole\s*\(/, /bootstrapAdministrator\s*\(/,
  ]) {
    assert.doesNotMatch(code, forbidden,
      `the operator reaches for ${forbidden} -- it must write only through ensureTenantPrincipal`);
  }
  // And it does call the one governed command.
  assert.match(code, /ensureTenantPrincipal\s*\(\s*repo\s*,/,
    "the operator does not call the governed command at all");

  // No Firebase business authorization, anywhere. `securityRole` is deliberately NOT on this list:
  // it appears in the operator as the NAME OF A FLAG IT REFUSES, which is the opposite offence.
  for (const forbidden of [
    "firebase-admin", "firebase/firestore", "getFirestore", "customClaims", "decodedToken",
    "operationalRoles", "users/", "PLACEHOLDER_DEFAULT_ROLES",
  ]) {
    assert.equal(code.includes(forbidden), false, `the operator reaches for "${forbidden}"`);
  }

  // THE COMMAND STILL OWNS THE WRITE. If a later edit moved the Principal INSERT out of
  // tenantBootstrap.ts, this suite would be proving a contract about the wrong file.
  const command = readFileSync(COMMAND_PATH, "utf8");
  assert.match(command, /export async function ensureTenantPrincipal/);
  const body = command.slice(command.indexOf("export async function ensureTenantPrincipal"));
  assert.match(body, /tx\.createPrincipal/, "ensureTenantPrincipal no longer creates the Principal");
  assert.match(body, /tx\.createTenantMembership/, "ensureTenantPrincipal no longer creates the membership");
  assert.match(body, /tx\.appendAudit/, "ensureTenantPrincipal no longer audits");
  // NOT a Role, NOT an Employee -- the contract's two negative requirements, read off the command.
  assert.doesNotMatch(body, /createAssignment|employee_principal_links|createEmployee/,
    "ensureTenantPrincipal grew a Role assignment or an Employee write");
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// PART 1. THE FENCE AND THE ARGUMENT REFUSALS. Pure functions, no database, no driver loaded.
// ════════════════════════════════════════════════════════════════════════════════════════════

const NONPROD_ENV = Object.freeze({ EOS_ENVIRONMENT: "nonprod", PROBE_DB: "postgresql://x/y" });
const VALID_SUBJECT = "synthetic-np-principal-acceptance-a";
const VALID_ARGS = Object.freeze({
  environment: "platform-sandbox",
  databaseUrlEnv: "PROBE_DB",
  tenantKey: "taylor-nonprod",
  adminPrincipalId: "admin-principal-1",
  performedBy: "operator-proof",
  identityProvider: "eos-synthetic-nonprod",
  externalSubject: VALID_SUBJECT,
  displayName: "SYNTHETIC NONPROD Acceptance A (fixture, cannot sign in)",
  reason:
    `ACCEPTANCE PRINCIPAL: admitting ${VALID_SUBJECT} to taylor-nonprod so the acceptance lane has a `
    + "governed identity of its own",
});
const invoke = (over = {}, env = NONPROD_ENV) => tool.assertInvocation({ ...VALID_ARGS, ...over }, env);
const refusalCode = (fn) => {
  try {
    fn();
  } catch (err) {
    return err.code ?? err.message;
  }
  return "NO_REFUSAL";
};

test("PART 1 -- a caller that SUPPLIES authority is refused, not ignored", () => {
  // The contract's own words: `--heldRoleKeys` / `--capabilities` must be REFUSED, as
  // rebindPrincipalIdentity.js already does.
  for (const flag of ["heldRoleKeys", "capabilities", "roleKeys", "roles", "grants", "permissions",
    "entitlements", "actorRoleKeys", "securityRole"]) {
    assert.equal(refusalCode(() => invoke({ [flag]: "owner" })), "AUTHORITY_ARGUMENT_REFUSED",
      `--${flag} was not refused as authority-bearing`);
  }
  // Every named flag is genuinely unknown to the tool, so the refusal is not merely decorative.
  for (const flag of tool.AUTHORITY_BEARING_FLAGS) {
    assert.equal(tool.KNOWN_FLAGS.includes(flag), false, `--${flag} is BOTH known and authority-bearing`);
    assert.equal(refusalCode(() => invoke({ [flag]: "x" })), "AUTHORITY_ARGUMENT_REFUSED");
  }
});

test("PART 1 -- a credential on argv, and an unknown flag, are refused", () => {
  for (const flag of tool.CREDENTIAL_BEARING_FLAGS) {
    assert.equal(refusalCode(() => invoke({ [flag]: "x" })), "CREDENTIAL_ARGUMENT_REFUSED");
  }
  assert.equal(refusalCode(() => invoke({ tenantKeyy: "typo" })), "UNKNOWN_FLAG_REFUSED");
  // A misspelled fence is a missing fence: --aply would have silently dry-run forever.
  assert.equal(refusalCode(() => invoke({ aply: "true" })), "UNKNOWN_FLAG_REFUSED");
});

test("PART 1 -- the environment fence, and the reason contract", () => {
  assert.match(refusalCode(() => invoke({}, { EOS_ENVIRONMENT: "local", PROBE_DB: "x" })),
    /EOS_ENVIRONMENT must read exactly 'nonprod'/);
  assert.match(refusalCode(() => invoke({ environment: "platform-production" })), /production|refus/i);
  assert.equal(refusalCode(() => invoke({ environment: "platform-certification" })), "ENVIRONMENT_FROZEN");

  // Every argument is required and has no default -- including the identity provider, so a creation
  // can never guess whether the new Principal can authenticate.
  for (const flag of ["tenantKey", "adminPrincipalId", "performedBy", "identityProvider",
    "externalSubject", "displayName", "reason"]) {
    assert.equal(refusalCode(() => invoke({ [flag]: undefined })), "ARGUMENT_REQUIRED", `--${flag} has a default`);
    assert.equal(refusalCode(() => invoke({ [flag]: "true" })), "ARGUMENT_REQUIRED");
  }

  assert.equal(refusalCode(() => invoke({ reason: "fix" })), "REASON_NOT_SPECIFIC");
  assert.equal(refusalCode(() => invoke({
    reason: "a reason of entirely sufficient length that never once names its own target identity",
  })), "REASON_NOT_SPECIFIC");
  assert.equal(refusalCode(() => invoke({ reason: `${VALID_SUBJECT} ${"x".repeat(600)}` })), "REASON_TOO_LONG");
  assert.ok(tool.MIN_REASON_LENGTH >= 40);

  // A subject is an identifier, never generated and never a token.
  assert.equal(refusalCode(() => invoke({ externalSubject: "has a space" })), "SUBJECT_MALFORMED");
  assert.equal(refusalCode(() => invoke({ externalSubject: "x".repeat(256) })), "SUBJECT_MALFORMED");
  assert.equal(refusalCode(() => invoke({ identityProvider: "Firebase" })), "IDENTITY_PROVIDER_MALFORMED");

  // The happy path, and DRY RUN BY DEFAULT.
  assert.equal(invoke().apply, false);
  assert.equal(invoke({ apply: "true" }).apply, true);
  assert.equal(invoke().identityProvider, "eos-synthetic-nonprod");
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// PART 2. THE BEHAVIOUR, AGAINST A REAL DATABASE.
// ════════════════════════════════════════════════════════════════════════════════════════════

const DB_NAME = `bu_gov_principal_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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

const TENANT_A_KEY = "taylor-nonprod";
const TENANT_B_KEY = "other-nonprod";
const SYNTHETIC_PROVIDER = "eos-synthetic-nonprod";
const TARGET_SUBJECT = "synthetic-np-principal-acceptance-a";
const TARGET_DISPLAY_NAME = "SYNTHETIC NONPROD Acceptance A (fixture, cannot sign in)";
const REASON =
  `ACCEPTANCE PRINCIPAL: admitting ${TARGET_SUBJECT} to ${TENANT_A_KEY} as a non-authenticating governed `
  + "identity so the acceptance lane holds authority of its own rather than the administrator's";

/** Every relation a run of this tool must be able to account for. */
const COUNTED = [
  "eos_policy.principals", "eos_policy.tenant_memberships", "eos_policy.user_role_assignments",
  "eos_policy.principal_capabilities", "eos_policy.role_capabilities", "eos_policy.capabilities",
  "eos_policy.roles", "eos_policy.audit_events", "eos_policy.principal_access_versions",
  "eos_workforce.employees", "eos_policy.employee_principal_links",
];

test("the governed Principal provisioning operator, in PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
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
  const { ensureTenantPrincipal, bootstrapTenant, bootstrapAdministrator } =
    require("../lib/adminPolicy/tenantBootstrap.js");
  const capabilityAuthority = require("../lib/eosOps/capabilityAuthority.js");
  const deps = {
    PostgresPolicyRepository,
    ensureTenantPrincipal,
    capabilitiesForRoleKeys: capabilityAuthority.capabilitiesForRoleKeys,
    principalCapabilityGrants: capabilityAuthority.principalCapabilityGrants,
  };

  pool = new pg.Pool({ connectionString: dbUrl(), max: 6 });
  const q = (text, values = []) => pool.query(text, values);
  const repo = new PostgresPolicyRepository(pool);

  // ---- TWO tenants, both through the real bootstrap, so "tenant scoped" has a second tenant to be
  // scoped away from.
  const { tenant: tenantA } = await bootstrapTenant(repo, {
    key: TENANT_A_KEY, name: "Governed principal proof tenant A", actorUid: "bu-proof",
  });
  const { tenant: tenantB } = await bootstrapTenant(repo, {
    key: TENANT_B_KEY, name: "Governed principal proof tenant B", actorUid: "bu-proof",
  });
  const bootstrappedA = await bootstrapAdministrator(repo, {
    tenantId: tenantA.id, externalSubject: "administering-principal-uid-a", performedBy: "bu-proof",
  });

  /** A Principal holding one SEEDED catalog Role, created through the repository, never by hand. */
  async function makePrincipal(tenantId, subject, roleKey, displayName = null) {
    const role = await repo.getRoleByKey(tenantId, roleKey);
    assert.ok(role, `the seed defines the ${roleKey} Role`);
    const actor = { tenantId, uid: "bu-proof-fixture" };
    const principalId = await repo.transact(actor, async (tx) => {
      const p = await tx.createPrincipal({
        externalSubject: subject, identityProvider: "firebase", displayName,
      });
      await tx.createTenantMembership(p.id);
      return p.id;
    });
    await repo.transact(actor, async (tx) => {
      const accessVersion = await tx.bumpAccessVersion(principalId);
      return tx.createAssignment({
        principalId, roleId: role.id, scopeType: "global", scopeValue: null, status: "active",
        grantedBy: "bu-proof-fixture", grantedAt: new Date().toISOString(), accessVersionAtGrant: accessVersion,
      });
    });
    return principalId;
  }

  // THREE would-be administrators in tenant A, all real, active, members, and differing ONLY in how
  // (or whether) PostgreSQL says they hold admin.roleAssignment.write.
  const roleGrantedAdminId = bootstrappedA.principal.id;          // `admin` Role
  const directGrantedAdminId = await makePrincipal(tenantA.id, "direct-granted-admin-uid", "admin");
  const technicianId = await makePrincipal(tenantA.id, "technician-principal-uid", "technician");
  // An administrator of the OTHER tenant, authorized there and nowhere else.
  const adminOfBId = await makePrincipal(tenantB.id, "administering-principal-uid-b", "admin");

  const REQUIRED_CAP_ID = "cap_admin_roleAssignment_write";

  const grantRoleCapability = (tenantId, roleKey) => q(
    `INSERT INTO eos_policy.role_capabilities
       (id, tenant_id, role_id, capability_id, granted_by, granted_at, created_by, updated_by)
     SELECT 'rc_bu_' || substr(md5(r.tenant_id || r.id || $3), 1, 26), r.tenant_id, r.id, $3,
            'bu-proof-fixture', now(), 'bu-proof-fixture', 'bu-proof-fixture'
       FROM eos_policy.roles r WHERE r.tenant_id = $1 AND r.key = $2
     ON CONFLICT DO NOTHING`,
    [tenantId, roleKey, REQUIRED_CAP_ID]);

  const options = Object.freeze({
    environmentId: "platform-sandbox",
    connectionString: "never-read-by-the-run-function",
    tenantKey: TENANT_A_KEY,
    adminPrincipalId: roleGrantedAdminId,
    performedBy: "bu-governed-principal-proof",
    identityProvider: SYNTHETIC_PROVIDER,
    externalSubject: TARGET_SUBJECT,
    displayName: TARGET_DISPLAY_NAME,
    reason: REASON,
    apply: false,
  });
  const run = (over = {}) => tool.provisionGovernedPrincipalRun(pool, { ...options, ...over }, deps);
  const code = async (over = {}) => {
    try {
      await run(over);
    } catch (err) {
      return err.code ?? err.message;
    }
    return "NO_REFUSAL";
  };

  async function rowCounts() {
    const out = {};
    for (const rel of COUNTED) out[rel] = (await q(`SELECT count(*)::int AS n FROM ${rel}`)).rows[0].n;
    return out;
  }
  const admissionAudits = async () => (await q(
    `SELECT tenant_id, actor_uid, target_kind, target_id, reason, after FROM eos_policy.audit_events
      WHERE action = $1 ORDER BY occurred_at, id`, [tool.AUDIT_ACTION])).rows;

  await t.test("the premise: the catalog carries 79 capabilities and NO tenant grants them yet", async () => {
    const counts = await rowCounts();
    assert.equal(counts["eos_policy.capabilities"], 79,
      "the capability catalog is not the measured 79 -- this lane registers none, so this must hold");
    assert.equal(counts["eos_policy.role_capabilities"], 0,
      "a freshly bootstrapped tenant already grants capabilities -- the two-half authority proof below needs it not to");
    assert.equal(counts["eos_policy.principal_capabilities"], 0);
    assert.equal(tool.REQUIRED_CAPABILITY, "admin.roleAssignment.write");
    const cap = (await q("SELECT id, object_key, action_key FROM eos_policy.capabilities WHERE key = $1",
      [tool.REQUIRED_CAPABILITY])).rows;
    assert.equal(cap.length, 1, "the gate names a capability the catalog does not declare");
    assert.equal(cap[0].id, REQUIRED_CAP_ID);
    // The gate is the capability-model expression of the `assignRole` administration action the
    // governed command already gates on -- not a new authority.
    assert.equal(cap[0].action_key, "assignRole");
  });

  // ──────────────── THE AUTHORITY, RESOLVED LIVE, IN TWO HALVES ────────────────

  await t.test("UNAUTHORIZED: every administrator is refused while NO grant row exists anywhere", async () => {
    const before = await rowCounts();
    for (const adminPrincipalId of [roleGrantedAdminId, directGrantedAdminId, technicianId]) {
      assert.equal(await code({ adminPrincipalId, apply: true }), "ADMINISTRATOR_UNAUTHORIZED",
        "a Principal with no capability row was authorized");
    }
    assert.deepEqual(await rowCounts(), before, "a refused run wrote something");
  });

  await t.test("HALF ONE -- eos_policy.principal_capabilities: a DIRECT grant authorizes, and nothing else does", async () => {
    await q(`INSERT INTO eos_policy.principal_capabilities
               (id, tenant_id, principal_id, capability_id, granted_by, created_by, updated_by)
             VALUES ('pc-bu-direct', $1, $2, $3, 'bu-proof-fixture', 'bu-proof-fixture', 'bu-proof-fixture')`,
    [tenantA.id, directGrantedAdminId, REQUIRED_CAP_ID]);

    // THE VACUITY CHECK, and the whole point of the ruling: role_capabilities is still EMPTY, so a
    // gate that read only Roles would refuse this run. It does not.
    assert.equal((await q("SELECT count(*)::int AS n FROM eos_policy.role_capabilities")).rows[0].n, 0);
    const report = await run({ adminPrincipalId: directGrantedAdminId });
    assert.equal(report.outcome, "PLANNED");
    assert.deepEqual(report.adminDirectCapabilityGrants, [tool.REQUIRED_CAPABILITY]);
    assert.equal(report.adminRoleDerivedCapabilityCount, 0,
      "the Role half contributed something -- the direct-grant proof would be vacuous");
    assert.match(report.adminAuthoritySource, /principal_capabilities/);

    // ...and the OTHER administrator, holding the SAME `admin` Role and no direct grant, is STILL
    // refused. The grant row is what authorized the run, not the Role key.
    assert.equal(await code({ adminPrincipalId: roleGrantedAdminId }), "ADMINISTRATOR_UNAUTHORIZED");
  });

  await t.test("HALF TWO -- eos_policy.role_capabilities: the Role grant authorizes through capabilitiesForRoleKeys", async () => {
    assert.equal(await code({ adminPrincipalId: roleGrantedAdminId }), "ADMINISTRATOR_UNAUTHORIZED");
    await grantRoleCapability(tenantA.id, "admin");
    // Reproduces the measured nonprod pairing (admin, owner hold admin.roleAssignment.write) in this
    // throwaway database. The catalog is untouched: this is a GRANT row, not a capability.
    assert.equal((await q("SELECT count(*)::int AS n FROM eos_policy.capabilities")).rows[0].n, 79);

    const resolved = await tool.resolveAdministrationAuthority(pool, repo, tenantA.id, roleGrantedAdminId, deps);
    assert.deepEqual(resolved.heldRoleKeys, ["admin"]);
    assert.deepEqual(resolved.roleCapabilities, [tool.REQUIRED_CAPABILITY]);
    assert.deepEqual(resolved.directCapabilities, [], "this administrator holds no direct grant");

    // The resolver is the SAME function the runtime resolves through, over the same rows.
    const live = await capabilityAuthority.capabilitiesForRoleKeys(pool, tenantA.id, ["admin"]);
    assert.ok(live.has(tool.REQUIRED_CAPABILITY),
      "capabilitiesForRoleKeys does not return the grant -- the gate is not reading what it claims to");

    const report = await run();
    assert.equal(report.outcome, "PLANNED");
    assert.deepEqual(report.adminHeldRoleKeys, ["admin"]);
  });

  await t.test("UNAUTHORIZED CALLER: a technician is refused, and the denial is the point", async () => {
    // The `technician` Role holds no admin.roleAssignment.write row, and no direct grant is made to
    // this Principal to make the test pass. It is active, a member, and refused.
    const membership = await repo.getMembership(tenantA.id, technicianId);
    assert.equal(membership.status, "active", "the refusal must be about authority, not about membership");
    const before = await rowCounts();
    assert.equal(await code({ adminPrincipalId: technicianId, apply: true }), "ADMINISTRATOR_UNAUTHORIZED");
    assert.deepEqual(await rowCounts(), before);
  });

  await t.test("CROSS-TENANT: an administrator of tenant B may not admit a Principal to tenant A", async () => {
    await grantRoleCapability(tenantB.id, "admin");
    // Authorized IN B -- proved, so the refusal below is about the tenant boundary and nothing else.
    const inB = await tool.resolveAdministrationAuthority(pool, repo, tenantB.id, adminOfBId, deps);
    assert.deepEqual(inB.roleCapabilities, [tool.REQUIRED_CAPABILITY]);

    const before = await rowCounts();
    assert.equal(await code({ adminPrincipalId: adminOfBId, apply: true }), "ADMINISTRATOR_INVALID",
      "authority was borrowed across a tenant boundary");
    assert.deepEqual(await rowCounts(), before);
  });

  await t.test("FAIL CLOSED on a missing or inactive membership", async () => {
    const before = await rowCounts();
    // No such Principal at all.
    assert.equal(await code({ adminPrincipalId: "no-such-principal", apply: true }), "ADMINISTRATOR_INVALID");
    // A real, authorized Principal whose MEMBERSHIP has been disabled.
    await q("UPDATE eos_policy.tenant_memberships SET status = 'disabled' WHERE tenant_id = $1 AND principal_id = $2",
      [tenantA.id, roleGrantedAdminId]);
    assert.equal(await code({ apply: true }), "ADMINISTRATOR_INVALID",
      "a disabled membership still administered");
    // A real, authorized Principal whose PRINCIPAL has been disabled.
    await q("UPDATE eos_policy.tenant_memberships SET status = 'active' WHERE tenant_id = $1 AND principal_id = $2",
      [tenantA.id, roleGrantedAdminId]);
    await q("UPDATE eos_policy.principals SET status = 'disabled' WHERE id = $1", [roleGrantedAdminId]);
    assert.equal(await code({ apply: true }), "ADMINISTRATOR_INVALID", "a disabled Principal still administered");
    await q("UPDATE eos_policy.principals SET status = 'active' WHERE id = $1", [roleGrantedAdminId]);
    assert.deepEqual(await rowCounts(), before, "a fail-closed refusal wrote something");
    // And an unknown tenant is refused rather than created.
    assert.equal(await code({ tenantKey: "no-such-tenant", apply: true }), "TENANT_NOT_FOUND");
    assert.deepEqual(await rowCounts(), before);
  });

  // ──────────────── THE WRITE ────────────────

  await t.test("DRY RUN BY DEFAULT: it plans and writes nothing at all", async () => {
    const before = await rowCounts();
    const report = await run();
    assert.equal(report.apply, false);
    assert.equal(report.outcome, "PLANNED");
    assert.equal(report.principalId, null);
    assert.deepEqual(tool.violations(report), []);
    assert.deepEqual(await rowCounts(), before, "the dry run wrote something");
  });

  let provisioned;
  await t.test("--apply admits the Principal through the governed command, and NOTHING ELSE MOVES", async () => {
    const before = await rowCounts();
    provisioned = await run({ apply: true });
    assert.equal(provisioned.outcome, "PROVISIONED");
    assert.deepEqual(tool.violations(provisioned), []);

    const after = await rowCounts();
    // EXACTLY two rows plus one audit event: a Principal, a membership, the admission.
    assert.equal(after["eos_policy.principals"], before["eos_policy.principals"] + 1);
    assert.equal(after["eos_policy.tenant_memberships"], before["eos_policy.tenant_memberships"] + 1);
    assert.equal(after["eos_policy.audit_events"], before["eos_policy.audit_events"] + 1);

    // NO SECURITY ROLE. NO EMPLOYEE. NO DIRECT GRANT. NO CATALOG CHANGE. NO ROLE WIDENING.
    assert.equal(after["eos_policy.user_role_assignments"], before["eos_policy.user_role_assignments"],
      "a Security Role was assigned as a side effect");
    assert.equal(after["eos_workforce.employees"], before["eos_workforce.employees"],
      "an Employee was created as a side effect");
    assert.equal(after["eos_policy.employee_principal_links"], before["eos_policy.employee_principal_links"],
      "an Employee link was created as a side effect");
    assert.equal(after["eos_policy.principal_capabilities"], before["eos_policy.principal_capabilities"],
      "a direct Principal capability grant was made");
    assert.equal(after["eos_policy.capabilities"], 79, "the capability catalog changed");
    assert.equal(after["eos_policy.role_capabilities"], before["eos_policy.role_capabilities"], "a Role was widened");
    assert.equal(after["eos_policy.roles"], before["eos_policy.roles"], "a Role was created");
    // The command bumps no access version for a bare admission either.
    assert.equal(after["eos_policy.principal_access_versions"], before["eos_policy.principal_access_versions"]);

    // ...and, read off the rows rather than off the report: the Principal, its binding, its tenant.
    const row = (await q(
      `SELECT id, identity_provider, external_subject, display_name, status FROM eos_policy.principals
        WHERE identity_provider = $1 AND external_subject = $2`, [SYNTHETIC_PROVIDER, TARGET_SUBJECT])).rows;
    assert.equal(row.length, 1);
    assert.equal(row[0].id, provisioned.principalId);
    assert.equal(row[0].status, "active");
    assert.equal(row[0].display_name, TARGET_DISPLAY_NAME);
    // A non-authenticating provider: no verifier in this platform produces it, by design.
    assert.equal(row[0].identity_provider, SYNTHETIC_PROVIDER);
    assert.notEqual(row[0].identity_provider, "firebase");

    const memberships = (await q(
      "SELECT tenant_id, status FROM eos_policy.tenant_memberships WHERE principal_id = $1", [row[0].id])).rows;
    assert.deepEqual(memberships, [{ tenant_id: tenantA.id, status: "active" }],
      "the admission is not scoped to exactly one tenant with an ACTIVE membership");

    // The new Principal holds NOTHING. This is what "authenticated but authorized for nothing" is.
    const held = (await q(
      "SELECT count(*)::int AS n FROM eos_policy.user_role_assignments WHERE principal_id = $1", [row[0].id])).rows[0].n;
    assert.equal(held, 0);
    assert.equal(provisioned.securityRolesAssigned, 0);
    assert.equal(provisioned.employeeCreated, false);
  });

  await t.test("AUDITED EXACTLY ONCE, append-only, with the SPECIFIC reason", async () => {
    const rows = await admissionAudits();
    assert.equal(rows.length, 1, "the admission was not audited exactly once");
    const [event] = rows;
    assert.equal(event.tenant_id, tenantA.id);
    assert.equal(event.target_kind, "principal");
    assert.equal(event.target_id, provisioned.principalId);
    assert.equal(event.actor_uid, options.performedBy);
    assert.equal(event.reason, REASON);
    assert.ok(event.reason.includes(TARGET_SUBJECT), "the reason does not name its own subject");
    assert.ok(event.reason.length >= tool.MIN_REASON_LENGTH);
    assert.ok(event.reason.length <= 500, "the reason exceeds the audit column");
    assert.equal(event.after.status, "active");
    assert.equal(event.after.externalSubject, TARGET_SUBJECT);
    assert.equal(event.after.identityProvider, SYNTHETIC_PROVIDER);
    assert.equal(provisioned.auditEvents.appended, 1);

    // Admitting a Principal used to be recorded with reason null. Nothing in this run did that.
    const nullReasoned = (await q(
      "SELECT count(*)::int AS n FROM eos_policy.audit_events WHERE action = $1 AND reason IS NULL",
      [tool.AUDIT_ACTION])).rows[0].n;
    assert.equal(nullReasoned, 0, "an admission was recorded with no reason at all");
  });

  await t.test("IDEMPOTENT: a re-run reports NO_CHANGE and appends NO SECOND AUDIT EVENT", async () => {
    const before = await rowCounts();
    const second = await run({ apply: true });
    assert.equal(second.outcome, "NO_CHANGE");
    assert.equal(second.principalId, provisioned.principalId, "a second Principal was created");
    assert.equal(second.auditEvents.appended, 0);
    assert.deepEqual(tool.violations(second), []);
    assert.deepEqual(await rowCounts(), before, "the re-run wrote a row");
    assert.equal((await admissionAudits()).length, 1, "the re-run appended a second audit event");

    // A third run, because "idempotent" that was only ever tried twice is a claim about run two.
    const third = await run({ apply: true });
    assert.equal(third.outcome, "NO_CHANGE");
    assert.deepEqual(await rowCounts(), before);
    assert.equal((await admissionAudits()).length, 1);
  });

  // ──────────────── THE COLLISION REFUSALS, READ OUT OF THE DATABASE ────────────────

  await t.test("DUPLICATE EXTERNAL SUBJECT REFUSED -- even for the OTHER tenant", async () => {
    const before = await rowCounts();
    // The same (provider, subject) now exists. A different canonical name makes this unambiguously a
    // creation attempt rather than the idempotent path.
    assert.equal(await code({
      apply: true, displayName: "SYNTHETIC NONPROD Acceptance A SECOND (fixture, cannot sign in)",
    }), "SUBJECT_ALREADY_HELD");
    // And admitting that same login to tenant B is refused too: one subject, one Principal, and this
    // tool never adopts an existing one.
    await grantRoleCapability(tenantB.id, "admin");
    assert.equal(await code({
      apply: true, tenantKey: TENANT_B_KEY, adminPrincipalId: adminOfBId,
    }), "SUBJECT_ALREADY_HELD");
    assert.deepEqual(await rowCounts(), before);
    assert.equal((await admissionAudits()).length, 1);
  });

  await t.test("DUPLICATE CANONICAL PRINCIPAL REFUSED -- a second row for one canonical identity", async () => {
    const before = await rowCounts();
    // A DIFFERENT authentication subject, the SAME canonical name. This is the split-authority
    // defect: one identity, two Principals, each holding half of its Roles.
    const secondSubject = "synthetic-np-principal-acceptance-a-2";
    assert.equal(await code({
      apply: true,
      externalSubject: secondSubject,
      reason: `ACCEPTANCE PRINCIPAL: admitting ${secondSubject} to ${TENANT_A_KEY} as a duplicate canonical identity`,
    }), "CANONICAL_PRINCIPAL_EXISTS");
    assert.deepEqual(await rowCounts(), before);

    // The SAME canonical name in the OTHER tenant is NOT a collision: the guard is tenant scoped.
    const bSubject = "synthetic-np-principal-acceptance-a-tenant-b";
    const inB = await run({
      apply: true, tenantKey: TENANT_B_KEY, adminPrincipalId: adminOfBId, externalSubject: bSubject,
      reason: `ACCEPTANCE PRINCIPAL: admitting ${bSubject} to ${TENANT_B_KEY} as its own governed identity`,
    });
    assert.equal(inB.outcome, "PROVISIONED");
    assert.deepEqual(tool.violations(inB), []);
    assert.notEqual(inB.principalId, provisioned.principalId);
  });

  await t.test("A RETIRED MEMBERSHIP IS NOT SILENTLY RE-ACTIVATED", async () => {
    // `ensureTenantPrincipal` WOULD re-activate it -- that is its documented idempotence. A creation
    // command must refuse, because restoring a retired membership is a re-instatement decision.
    await q("UPDATE eos_policy.tenant_memberships SET status = 'disabled' WHERE tenant_id = $1 AND principal_id = $2",
      [tenantA.id, provisioned.principalId]);
    const before = await rowCounts();
    assert.equal(await code({ apply: true }), "MEMBERSHIP_RETIRED_REFUSED");
    assert.deepEqual(await rowCounts(), before);
    const status = (await q(
      "SELECT status FROM eos_policy.tenant_memberships WHERE tenant_id = $1 AND principal_id = $2",
      [tenantA.id, provisioned.principalId])).rows[0].status;
    assert.equal(status, "disabled", "the refused run re-activated the membership anyway");

    // THE GUARD IS NOT VACUOUS: the governed command, called directly with the same inputs, DOES
    // re-activate. That is exactly the behaviour this operator sits in front of.
    await ensureTenantPrincipal(repo, {
      tenantId: tenantA.id, externalSubject: TARGET_SUBJECT, identityProvider: SYNTHETIC_PROVIDER,
      displayName: TARGET_DISPLAY_NAME, actorUid: "bu-proof-vacuity",
      actorRoleKeys: ["admin"], reason: `VACUITY CHECK: the command re-activates ${TARGET_SUBJECT}`,
    });
    const restored = (await q(
      "SELECT status FROM eos_policy.tenant_memberships WHERE tenant_id = $1 AND principal_id = $2",
      [tenantA.id, provisioned.principalId])).rows[0].status;
    assert.equal(restored, "active",
      "the governed command no longer re-activates -- the operator's refusal guards nothing");
  });

  await t.test("the run's own terms are reported, not buried: violations() would actually fire", async () => {
    // A validator that runs on nothing is worse than none.
    const clean = await run({ apply: true });
    assert.deepEqual(tool.violations(clean), []);
    const tampered = (patch) => tool.violations({ ...clean, ...patch });
    assert.deepEqual(tampered({ securityRolesAssigned: 1 }).length, 1);
    assert.deepEqual(tampered({ apply: false, auditEvents: { ...clean.auditEvents, appended: 1 } }).length, 1);
    assert.ok(tampered({ outcome: "PROVISIONED", auditEvents: { ...clean.auditEvents, appended: 2 } })
      .some((v) => /exactly one is the contract/.test(v)),
    "two audit events on a PROVISIONED run were not reported");
    assert.ok(tampered({ outcome: "PROVISIONED", membershipStatus: "disabled" })
      .some((v) => /ACTIVE membership/.test(v)),
    "a Principal admitted without an ACTIVE membership was not reported");
    assert.ok(tampered({
      invariants: { before: clean.invariants.before, after: { ...clean.invariants.after, employeeLinks: 1 } },
    }).length >= 1);
    assert.ok(tampered({
      invariants: { before: clean.invariants.before, after: { ...clean.invariants.after, capabilityCatalogRows: 80 } },
    }).some((v) => /capability catalog/.test(v)));
  });

  await t.test("the connection string never appears in the CLI output, and the CLI fence holds", async () => {
    const env = { ...process.env, BU_DB: dbUrl(), EOS_ENVIRONMENT: "nonprod" };
    const cli = (extra = [], overrideEnv = env) => spawnSync(process.execPath, [
      "scripts/provisionGovernedPrincipal.js",
      "--environment", "platform-sandbox", "--databaseUrlEnv", "BU_DB",
      "--tenantKey", TENANT_A_KEY, "--adminPrincipalId", roleGrantedAdminId,
      "--performedBy", "bu-governed-principal-proof",
      "--identityProvider", SYNTHETIC_PROVIDER, "--externalSubject", TARGET_SUBJECT,
      "--displayName", TARGET_DISPLAY_NAME, "--reason", REASON, ...extra,
    ], { cwd: FUNCTIONS_DIR, encoding: "utf8", env: overrideEnv });

    const before = await rowCounts();
    const fenced = cli(["--apply"], { ...env, EOS_ENVIRONMENT: "local" });
    assert.equal(fenced.status, 2);
    assert.match(fenced.stderr, /EOS_ENVIRONMENT must read exactly 'nonprod'/);
    assert.deepEqual(await rowCounts(), before, "the fenced CLI run wrote something");

    const argued = cli(["--heldRoleKeys", "owner"]);
    assert.equal(argued.status, 2);
    assert.match(argued.stderr, /AUTHORITY_ARGUMENT_REFUSED/);

    const ok = cli();
    assert.equal(ok.status, 0, ok.stderr);
    const report = JSON.parse(ok.stdout);
    assert.equal(report.outcome, "NO_CHANGE");
    assert.equal(ok.stdout.includes(dbUrl()), false, "the connection string was printed");
    assert.equal(ok.stderr.includes(dbUrl()), false);
    assert.deepEqual(await rowCounts(), before);
  });
});
