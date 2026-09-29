// THE FIRST-OWNER BOOTSTRAP, against a real PostgreSQL (Controller/Owner ruling 2026-09-27, option A).
//
// Ordinary role administration can never appoint the protected Owner (protectedOwnerInvariantPostgres). A tenant's
// FIRST Owner is therefore established by one bootstrap-only primitive, bootstrapFirstOwner -- the Owner analogue of
// bootstrapAdministrator. It is NOT Owner lifecycle: it succeeds only while the tenant has ZERO active protected
// Owners, never adds a second, never replaces or transfers one, and is reachable from no Administration surface.
//
// Numbers in the test names are the ruling's required proofs.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");
const {
  bootstrapTenant, bootstrapAdministrator, ensureTenantPrincipal, bootstrapFirstOwner,
  FIRST_OWNER_BOOTSTRAP_ACTION, FIRST_OWNER_BOOTSTRAP_SOURCE,
} = require("../lib/adminPolicy/tenantBootstrap.js");
const { executeAdminOperation, ADMIN_READ_OPERATIONS, ADMIN_MUTATION_OPERATIONS } = require("../lib/adminPolicy/adminPolicyApi.js");

const OP = "operator-fob";
const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

test("the first-Owner bootstrap is not an Administration operation", () => {
  for (const list of [ADMIN_READ_OPERATIONS, ADMIN_MUTATION_OPERATIONS]) {
    assert.equal([...list].some((op) => /owner/i.test(op) && /bootstrap/i.test(op)), false, "no Administration operation bootstraps an Owner");
  }
  assert.equal(FIRST_OWNER_BOOTSTRAP_ACTION, "tenant.bootstrapFirstOwner");
  assert.equal(FIRST_OWNER_BOOTSTRAP_SOURCE, "bootstrap:first-owner");
});

test("FIRST-OWNER BOOTSTRAP (ruling 2026-09-27, option A), in PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `fob_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  const url = dbUrlFor(name);
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations", "--no-check-order"],
    { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  pool = new pg.Pool({ connectionString: url, max: 16 });
  // Teardown drops this database WITH (FORCE); an idle client left over from case 8's six-way race is then terminated
  // ("terminating connection due to administrator command"). That is expected at teardown, not a finding -- without a
  // listener pg re-throws it as an uncaughtException and node:test fails the suite after every assertion passed.
  pool.on("error", () => undefined);
  const q = (s, v = []) => pool.query(s, v);
  const repo = new PostgresPolicyRepository(pool);

  const T = {};
  for (const key of ["a", "b", "c", "d", "e"]) {
    const { tenant } = await bootstrapTenant(repo, { key: `fob-${key}`, name: key, actorUid: OP });
    T[key] = tenant.id;
    await bootstrapAdministrator(repo, { tenantId: tenant.id, externalSubject: `admin-${key}`, performedBy: OP, reason: "boot" });
  }
  const member = async (tenant, subject) => {
    const made = await ensureTenantPrincipal(repo, { tenantId: tenant, externalSubject: subject, actorUid: OP, actorRoleKeys: ["admin"] });
    return made.principal?.id ?? made.id ?? made.principalId;
  };
  const owners = async (tenant) => (await q(
    `SELECT a.* FROM eos_policy.user_role_assignments a JOIN eos_policy.roles r ON r.id=a.role_id
      WHERE a.tenant_id=$1 AND r.key='owner' AND a.status='active'`, [tenant])).rows;
  const auditCount = async (tenant) => Number((await q(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE tenant_id=$1`, [tenant])).rows[0].n);
  const boot = (tenantId, principalId, reason = "first owner") => bootstrapFirstOwner(repo, { tenantId, principalId, performedBy: OP, reason });
  const call = (subject, operation, input = {}) => executeAdminOperation({ repo },
    { caller: { externalSubject: subject, identityProvider: "firebase" }, operation, input, requestId: `fob-${operation}` });

  const ownerA = await member(T.a, "owner-a");
  const otherA = await member(T.a, "other-a");
  let established;

  await t.test("1 + 2 + 16: a zero-Owner tenant bootstraps EXACTLY one protected Owner, with bootstrap provenance and one audit event", async () => {
    assert.equal((await owners(T.a)).length, 0);
    const before = await auditCount(T.a);
    established = await boot(T.a, ownerA, "FIRST OWNER: fob proof");
    const rows = await owners(T.a);
    assert.equal(rows.length, 1);
    const [a] = rows;
    const ownerRole = await repo.getRoleByKey(T.a, "owner");
    assert.deepEqual([a.id, a.principal_id, a.role_id, a.scope_type, a.scope_value, a.status],
      [established.assignmentId, ownerA, ownerRole.id, "global", null, "active"]);
    assert.equal(ownerRole.protected, true);
    assert.equal(a.granted_by, `${FIRST_OWNER_BOOTSTRAP_SOURCE}:${OP}`, "the assignment names the bootstrap, not an Administrator");
    assert.equal(await auditCount(T.a), before + 1, "exactly one audit event");
    const ev = (await q(`SELECT * FROM eos_policy.audit_events WHERE tenant_id=$1 ORDER BY occurred_at DESC LIMIT 1`, [T.a])).rows[0];
    assert.deepEqual([ev.action, ev.actor_uid, ev.target_kind, ev.target_id, ev.before, ev.reason],
      [FIRST_OWNER_BOOTSTRAP_ACTION, OP, "roleAssignment", established.assignmentId, null, "FIRST OWNER: fob proof"]);
    assert.deepEqual(
      [ev.after.source, ev.after.tenantId, ev.after.principalId, ev.after.roleKey, ev.after.roleId, ev.after.assignmentId, ev.after.scopeType, ev.after.performedBy],
      ["FIRST_OWNER_BOOTSTRAP", T.a, ownerA, "owner", ownerRole.id, established.assignmentId, "global", OP]);
    assert.ok(ev.after.grantedAt && Number.isInteger(ev.after.accessVersion));
    const v = (await q(`SELECT access_version FROM eos_policy.principal_access_versions WHERE tenant_id=$1 AND principal_id=$2`, [T.a, ownerA])).rows[0];
    assert.equal(v.access_version, established.accessVersion, "the access version was bumped and stamped");
  });

  await t.test("6: a SECOND bootstrap of the same principal is refused -- never a replay write", async () => {
    const before = await auditCount(T.a);
    await assert.rejects(() => boot(T.a, ownerA), /FIRST_OWNER_ALREADY_ESTABLISHED/);
    assert.equal(await auditCount(T.a), before);
    assert.equal((await owners(T.a)).length, 1);
  });

  await t.test("7: a DIFFERENT principal cannot be bootstrapped once an Owner exists", async () => {
    await assert.rejects(() => boot(T.a, otherA), /FIRST_OWNER_ALREADY_ESTABLISHED/);
    assert.deepEqual((await owners(T.a)).map((r) => r.principal_id), [ownerA]);
  });

  await t.test("3: the target must be an existing principal with an ACTIVE membership of the tenant", async () => {
    await assert.rejects(() => boot(T.b, "00000000-0000-4000-8000-00000000dead"), /FIRST_OWNER_PRINCIPAL_MISSING/);
    const disabledMember = await member(T.b, "disabled-b");
    await q(`UPDATE eos_policy.tenant_memberships SET status='disabled' WHERE tenant_id=$1 AND principal_id=$2`, [T.b, disabledMember]);
    await assert.rejects(() => boot(T.b, disabledMember), /FIRST_OWNER_NOT_A_MEMBER/);
    assert.equal((await owners(T.b)).length, 0);
  });

  await t.test("4: a principal of ANOTHER tenant is refused", async () => {
    await assert.rejects(() => boot(T.b, ownerA), /FIRST_OWNER_NOT_A_MEMBER/);
    await assert.rejects(() => boot(T.b, otherA), /FIRST_OWNER_NOT_A_MEMBER/);
    assert.equal((await owners(T.b)).length, 0);
  });

  await t.test("5: a missing, non-canonical or unprotected owner Role is refused", async () => {
    const pc = await member(T.c, "owner-c");
    await q(`UPDATE eos_policy.roles SET protected=false WHERE tenant_id=$1 AND key='owner'`, [T.c]);
    await assert.rejects(() => boot(T.c, pc), /FIRST_OWNER_ROLE_NOT_PROTECTED/);
    const pd = await member(T.d, "owner-d");
    await q(`UPDATE eos_policy.roles SET key='owner_renamed' WHERE tenant_id=$1 AND key='owner'`, [T.d]);
    await assert.rejects(() => boot(T.d, pd), /FIRST_OWNER_ROLE_MISSING/);
    await assert.rejects(() => bootstrapFirstOwner(repo, { tenantId: "tenant-does-not-exist", principalId: pd, performedBy: OP, reason: "x" }),
      /FIRST_OWNER_TENANT_MISSING/);
    assert.equal((await owners(T.c)).length + (await owners(T.d)).length, 0);
  });

  await t.test("operator context: performedBy and a reason are required", async () => {
    const pb = await member(T.b, "owner-b");
    await assert.rejects(() => bootstrapFirstOwner(repo, { tenantId: T.b, principalId: pb, performedBy: "", reason: "x" }), /performedBy/);
    await assert.rejects(() => bootstrapFirstOwner(repo, { tenantId: T.b, principalId: pb, performedBy: OP, reason: "" }), /reason/);
    assert.equal((await owners(T.b)).length, 0);
  });

  await t.test("Owner ruling A: a principal holding an owner-excluded capability cannot be bootstrapped", async () => {
    const holder = await member(T.b, "excluded-b");
    const r = await call("admin-b", "grantObjectActionToPrincipal", { objectKey: "reorderRequest", actionKey: "assign", principalId: holder, reason: "fixture" });
    assert.equal(r.ok, true, JSON.stringify(r));
    await assert.rejects(() => boot(T.b, holder), /FIRST_OWNER_RULING_A/);
    assert.equal((await owners(T.b)).length, 0);
  });

  await t.test("8: CONCURRENT first-Owner bootstraps cannot produce two Owners", async () => {
    const candidates = [];
    for (let i = 0; i < 6; i += 1) candidates.push(await member(T.e, `race-${i}`));
    const results = await Promise.allSettled(candidates.map((p) => boot(T.e, p, "race")));
    const won = results.filter((r) => r.status === "fulfilled");
    const lost = results.filter((r) => r.status === "rejected");
    assert.equal(won.length, 1, JSON.stringify(results.map((r) => r.status)));
    for (const l of lost) assert.match(String(l.reason?.message), /FIRST_OWNER_ALREADY_ESTABLISHED/);
    assert.equal((await owners(T.e)).length, 1, "exactly one Owner");
    const audits = Number((await q(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE tenant_id=$1 AND action=$2`,
      [T.e, FIRST_OWNER_BOOTSTRAP_ACTION])).rows[0].n);
    assert.equal(audits, 1, "exactly one bootstrap audit event");
  });

  await t.test("9-12: the bootstrapped Owner is still out of reach of ordinary Administration", async () => {
    const ownerRoleA = (await repo.getRoleByKey(T.a, "owner")).id;
    for (const actor of ["admin-a", "owner-a"]) {
      const assign = await call(actor, "assignRole", { principalId: otherA, roleId: ownerRoleA, reason: "appoint" });
      assert.deepEqual([assign.ok, assign.code], [false, "FORBIDDEN"], JSON.stringify(assign));
      assert.match(assign.message, /PROTECTED_OWNER_MEMBERSHIP/);
      const revoke = await call(actor, "revokeRole", { assignmentId: established.assignmentId, reason: "remove" });
      assert.deepEqual([revoke.ok, revoke.code], [false, "CONFLICT"], JSON.stringify(revoke));
      assert.match(revoke.message, /LAST_PROTECTED_OWNER/);
    }
    assert.deepEqual((await owners(T.a)).map((r) => r.id), [established.assignmentId]);
  });
});
