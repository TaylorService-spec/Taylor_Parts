// OWNER RULING A UNDER THE GOVERNANCE LOCK (finding F-1), against a real PostgreSQL.
//
// The Owner-exclusion check (a principal holding the protected Owner Role may never reach an
// OWNER_EXCLUDED_CAPABILITIES key, by any path) used to be decided only BEFORE the governance-locked
// transaction in assignRole and grantObjectActionToRole. Two concurrent commands could then each pass
// it against a state the other was about to change:
//
//   T1 assignRole(owner principal -> Role R)            pre-check: R carries no excluded key  -> passes
//   T2 grantObjectActionToRole(R, excluded key)        pre-check: no Owner holds R           -> passes
//   both commit, serially, under the lock              -> the Owner holds the excluded key.
//
// This suite makes that interleaving deterministic: a separate session holds the tenant governance lock
// while both commands run their pre-lock checks and queue on it, in a chosen order; then it releases.
// The authoritative check is now re-decided INSIDE the lock, so exactly one command commits and the
// other is refused with the same SYSTEM_INVARIANT / Owner ruling A refusal as before -- in BOTH orders.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { seedProtectedOwner } from "./support/protectedOwnerFixture.mjs";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");
const { bootstrapTenant, bootstrapAdministrator, ensureTenantPrincipal } = require("../lib/adminPolicy/tenantBootstrap.js");
const commands = require("../lib/adminPolicy/policyCommands.js");
const { OWNER_EXCLUDED_CAPABILITIES } = require("../lib/adminPolicy/roleCapabilityAdministration.js");

const OP = "operator-oxl";
const EXCLUDED = "equipment.install";
const OWNER_A = /SYSTEM_INVARIANT: a principal holding the owner Role may never hold equipment\.install \(Owner ruling A\)/;
const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

test("the fixture capability is one Owner ruling A excludes", () => {
  assert.equal(OWNER_EXCLUDED_CAPABILITIES.includes(EXCLUDED), true);
});

test("OWNER RULING A is decided under the governance lock (F-1), in PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `oxlock_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  const url = dbUrlFor(name);
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations", "--no-check-order"],
    { maxBuffer: 256 * 1024 * 1024, cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  pool = new pg.Pool({ connectionString: url, max: 16 });
  const q = (s, v = []) => pool.query(s, v);
  const repo = new PostgresPolicyRepository(pool);

  const capability = (await repo.listCapabilities()).find((c) => c.key === EXCLUDED);
  assert.ok(capability, `${EXCLUDED} is in the capability catalog`);

  // The Owner's effective capability keys by ANY path (Role grants, conditioned or not, and direct grants).
  const ownerHolds = async (tenantId, principalId, key) => Number((await q(
    `SELECT count(*)::int n FROM (
       SELECT c.key FROM eos_policy.user_role_assignments a
         JOIN eos_policy.role_capabilities rc ON rc.tenant_id = a.tenant_id AND rc.role_id = a.role_id
         JOIN eos_policy.capabilities c ON c.id = rc.capability_id
        WHERE a.tenant_id = $1 AND a.principal_id = $2 AND a.status = 'active'
       UNION ALL
       SELECT c.key FROM eos_policy.principal_capabilities pc JOIN eos_policy.capabilities c ON c.id = pc.capability_id
        WHERE pc.tenant_id = $1 AND pc.principal_id = $2) k
      WHERE k.key = $3`, [tenantId, principalId, key])).rows[0].n) > 0;
  const waitersOnAdvisoryLock = async () => Number((await q(
    `SELECT count(*)::int n FROM pg_locks l JOIN pg_stat_activity s ON s.pid = l.pid
      WHERE l.locktype = 'advisory' AND NOT l.granted AND s.datname = current_database()`)).rows[0].n);
  // A condition, not a timer: return as soon as `n` sessions queue on the advisory lock (bounded, fails loudly).
  const untilWaiters = async (n) => {
    const deadline = Date.now() + 15_000;
    while ((await waitersOnAdvisoryLock()) < n) {
      if (Date.now() > deadline) throw new Error(`expected ${n} session(s) waiting on the governance lock`);
      await new Promise((r) => setImmediate(r));
    }
  };

  // One fresh tenant per ordering: an Owner holder, the bootstrap Administrator (the actor), and an empty custom Role.
  const setup = async (key) => {
    const { tenant } = await bootstrapTenant(repo, { key: `oxl-${key}`, name: key, actorUid: OP });
    const boot = await bootstrapAdministrator(repo, { tenantId: tenant.id, externalSubject: `admin-${key}`, performedBy: OP, reason: "boot" });
    const adminId = (await repo.getPrincipalBySubject("firebase", `admin-${key}`)).id;
    const made = await ensureTenantPrincipal(repo, { tenantId: tenant.id, externalSubject: `owner-${key}`, actorUid: OP, actorRoleKeys: ["admin"] });
    const ownerId = made.principal?.id ?? made.id ?? made.principalId;
    await seedProtectedOwner(repo, { tenantId: tenant.id, principalId: ownerId });
    const actor = { tenantId: tenant.id, uid: adminId, heldRoleKeys: ["admin"] };
    const role = await commands.createRole(repo, actor, { key: "fieldCrew", name: "Field crew", reason: "fixture" });
    assert.ok(boot);
    return { tenantId: tenant.id, actor, ownerId, role };
  };

  const race = async (first) => {
    const { tenantId, actor, ownerId, role } = await setup(first);
    assert.equal(await ownerHolds(tenantId, ownerId, EXCLUDED), false, "premise: the Owner does not hold the excluded key");
    const assign = () => commands.assignRole(repo, actor, { principalId: ownerId, roleId: role.id, reason: "race: staff the Owner" });
    const grant = () => commands.grantObjectActionToRole(repo, actor,
      { objectKey: capability.objectKey, actionKey: capability.actionKey, roleKey: role.key, reason: "race: widen the Role" });

    // Hold the tenant governance lock from a separate session, so both commands finish their pre-lock checks
    // against the SAME state and queue on the lock in a known order.
    const holder = await pool.connect();
    let settled;
    try {
      await holder.query("BEGIN");
      await holder.query(`SELECT pg_advisory_xact_lock(hashtextextended('admin-governance|' || $1, 0))`, [tenantId]);
      const [a, b] = first === "assign" ? [assign, grant] : [grant, assign];
      const pa = a().then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }));
      await untilWaiters(1);
      const pb = b().then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }));
      await untilWaiters(2);
      await holder.query("COMMIT");
      settled = { first: await pa, second: await pb };
    } finally {
      holder.release();
    }
    return { tenantId, ownerId, settled };
  };

  for (const first of ["assign", "grant"]) {
    await t.test(`${first} first, then the other: exactly one commits, the second is refused (Owner ruling A)`, async () => {
      const { tenantId, ownerId, settled } = await race(first);
      assert.equal(settled.first.ok, true, `the first command commits: ${settled.first.e?.message ?? ""}`);
      assert.equal(await ownerHolds(tenantId, ownerId, EXCLUDED), false, "the Owner never holds an excluded capability");
      assert.equal(settled.second.ok, false, "the second command must be refused under the lock");
      assert.match(settled.second.e.message, OWNER_A);
      assert.equal(settled.second.e.code, "SYSTEM_INVARIANT");
    });
  }
});
