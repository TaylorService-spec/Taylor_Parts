// DQ-033 -- the "Operational Configuration Administrator" Security Role, built ENTIRELY through existing
// Administration, against PostgreSQL through the real /admin/policy dispatcher.
//
// The ruled chain, proven end to end with no migration grant, no direct grant, no Firebase:
//   1. the Administrator creates an ordinary, narrow Security Role;
//   2. the Administrator grants it exactly ownership.handoff.correct (L1, migration 1763683200000 -- applied here from a
//      THROWAWAY fixture copy only) and inventory.location.scopeBinding.manage (L3, migration 1764118800000) --
//      allowed, because the Administrator does not hold that Role;
//   3. the OWNER assigns it, through the governed role-assignment mechanism, to a DIFFERENT synthetic principal;
//   4. that principal holds both capabilities and NOTHING else, and uses the scope-binding one;
//   5. SELF_ADMINISTRATION still refuses where it should: the Administrator granting to a Role it holds, anyone
//      assigning a Role to themselves, the holder granting to its own Role, the Owner self-assigning;
//   6. the Owner removes the assignment, and the authority goes with it.
//
// Writes ONLY to a database it creates under POLICY_TEST_DATABASE_URL and drops at the end.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import pg from "pg";
import { seedProtectedOwner } from "./support/protectedOwnerFixture.mjs";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");
const { bootstrapTenant, bootstrapAdministrator, ensureTenantPrincipal } = require("../lib/adminPolicy/tenantBootstrap.js");
const { executeAdminOperation } = require("../lib/adminPolicy/adminPolicyApi.js");
const { createMobileLocationScopeBindingAdministration } = require("../lib/eosOps/mobileLocationScopeBindingAdministration.js");
const { explainEffectiveAccess } = require("../lib/eosOps/effectiveAccessExplanation.js");

const OP = "operator-dq033";
const SCOPE = "inventory.location.scopeBinding.manage";
const HANDOFF = "ownership.handoff.correct";
const ROLE_KEY = "operationalConfigurationAdministrator";
const ROLE_NAME = "Operational Configuration Administrator";
const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

test("DQ-033: Operational Configuration Administrator through existing Administration", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `dq033_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  const url = dbUrlFor(name);
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations", "--no-check-order"],
    { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  pool = new pg.Pool({ connectionString: url, max: 8 });
  const q = (s, v = []) => pool.query(s, v);
  const repo = new PostgresPolicyRepository(pool);

  // L1's registration, from the throwaway fixture -- only when the chain does not already carry it.
  if ((await q("SELECT 1 FROM eos_policy.capabilities WHERE key = $1", [HANDOFF])).rowCount === 0) {
    await q(readFileSync(resolve(FUNCTIONS_DIR, "test/fixtures/l1OwnershipHandoffCorrectCapability.fixture.sql"), "utf8"));
  }

  const { tenant } = await bootstrapTenant(repo, { key: "dq033", name: "dq033", actorUid: OP });
  const T = tenant.id;
  await bootstrapAdministrator(repo, { tenantId: T, externalSubject: "admin", performedBy: OP, reason: "boot" });
  for (const cap of ["admin.securityPolicy.read", "admin.principalAccess.read", "audit.event.read"]) {
    await q(`INSERT INTO eos_policy.role_capabilities (id,tenant_id,role_id,capability_id,granted_by,created_by,updated_by)
             SELECT 'rc-fx-' || md5($1 || c.id), $1, r.id, c.id, 'fixture','fixture','fixture'
               FROM eos_policy.roles r, eos_policy.capabilities c WHERE r.tenant_id=$1 AND r.key='admin' AND c.key=$2
             ON CONFLICT DO NOTHING`, [T, cap]);
  }
  await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id, operating_company_id, status, source, established_by, updated_by)
           VALUES ($1, 'co', 'ACTIVE', 't', $2, $2)`, [T, OP]);
  await q(`INSERT INTO eos_policy.tenant_operating_company_keys (tenant_id, operating_company_id, operating_company_key, status, provenance, source, established_by, updated_by)
           VALUES ($1, 'co', 'key', 'ACTIVE', 'NATIVE', 't', $2, $2)`, [T, OP]);
  await q(`INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by)
           VALUES ('WH-1', $1, 'key', 'WH-1', 's', 'ACTIVE', 'NATIVE', $2, $2)`, [T, OP]);
  await q(`INSERT INTO eos_ops.mobile_locations (tenant_id, location_type, location_id, operating_company_key, display_label, active, created_by, updated_by)
           VALUES ($1, 'MOBILE', 'truck-1', 'key', 'truck-1', true, $2, $2)`, [T, OP]);

  const deps = {
    repo,
    explainEffectiveAccess: (tenantId, principalId) => explainEffectiveAccess(repo, pool, { tenantId, principalId }),
    configuration: createMobileLocationScopeBindingAdministration(pool),
  };
  const call = (subject, operation, input = {}) => executeAdminOperation(deps,
    { caller: { externalSubject: subject, identityProvider: "firebase" }, operation, input, requestId: `r-${operation}` });
  const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.data; };
  const refused = (r, code, pattern) => {
    assert.deepEqual([r.ok, r.code], [false, code], JSON.stringify(r));
    if (pattern) assert.match(r.message, pattern);
  };
  const roleId = async (key) => (await repo.getRoleByKey(T, key))?.id ?? null;
  const principal = async (subject) => {
    const made = await ensureTenantPrincipal(repo, { tenantId: T, externalSubject: subject, actorUid: OP, actorRoleKeys: ["admin"] });
    return made.principal?.id ?? made.id ?? made.principalId;
  };
  const effective = async (principalId) => ok(await call("admin", "explainEffectiveAccess", { principalId })).capabilities;

  const adminId = (await repo.getPrincipalBySubject("firebase", "admin")).id;
  const ownerId = await principal("owner");
  await seedProtectedOwner(repo, { tenantId: T, principalId: ownerId });
  const configId = await principal("config-admin"); // the SEPARATE synthetic administrative principal
  let assignmentId = null;

  await t.test("premise: both capabilities registered, held by nobody; the Owner holds role assignment, not policy write", async () => {
    const { rows } = await q(`SELECT key FROM eos_policy.capabilities WHERE key = ANY($1) ORDER BY key`, [[HANDOFF, SCOPE]]);
    assert.deepEqual(rows.map((r) => r.key), [SCOPE, HANDOFF].sort());
    const held = await q(`SELECT count(*)::int n FROM eos_policy.role_capabilities rc JOIN eos_policy.capabilities c ON c.id = rc.capability_id WHERE c.key = ANY($1)`, [[HANDOFF, SCOPE]]);
    assert.equal(held.rows[0].n, 0);
    const owner = await effective(ownerId);
    assert.equal(owner.includes("admin.roleAssignment.write"), true);
    assert.equal(owner.includes("admin.securityPolicy.write"), false);
    assert.deepEqual(await effective(configId), [], "the separate principal starts with nothing");
  });

  await t.test("1+2: the Administrator creates the Role and grants it exactly the two capabilities", async () => {
    ok(await call("admin", "createRole", { key: ROLE_KEY, name: ROLE_NAME,
      description: "Narrow operational configuration authority (DQ-033). Not a security administrator.", reason: "DQ-033" }));
    ok(await call("admin", "grantObjectActionToRole", { objectKey: "account", actionKey: "correctOwnershipHandoff", roleKey: ROLE_KEY, reason: "DQ-033" }));
    ok(await call("admin", "grantObjectActionToRole", { objectKey: "mobileLocation", actionKey: "manageScopeBinding", roleKey: ROLE_KEY, reason: "DQ-033" }));
    const role = ok(await call("admin", "getRoleSecurity", { roleKey: ROLE_KEY }));
    const keys = JSON.stringify(role);
    // getRoleSecurity projects UNDER THE OBJECT: (objectKey, actionKey), never a capability key.
    assert.ok(keys.includes("correctOwnershipHandoff") && keys.includes("manageScopeBinding"), keys.slice(0, 400));
    const { rows } = await q(`SELECT c.key FROM eos_policy.role_capabilities rc JOIN eos_policy.capabilities c ON c.id = rc.capability_id
                               JOIN eos_policy.roles r ON r.id = rc.role_id WHERE r.tenant_id = $1 AND r.key = $2 ORDER BY c.key`, [T, ROLE_KEY]);
    assert.deepEqual(rows.map((r) => r.key), [HANDOFF, SCOPE].sort(), "exactly the two -- nothing else rides along");
    // Granting to a Role gives the grantor nothing: the business act (ownership handoff correction) stays with the Role.
    // The configuration key the Administrator holds anyway, by protected-Administrator STANDING (DECISIONS #223).
    assert.equal((await effective(adminId)).includes(HANDOFF), false, "granting to a Role gives the grantor nothing");
    assert.equal((await effective(adminId)).includes(SCOPE), true, "configuration authority by standing, not by this grant");
  });

  await t.test("3: the OWNER assigns it to the separate principal through the governed assignment mechanism", async () => {
    const a = ok(await call("owner", "assignRole", { principalId: configId, roleId: await roleId(ROLE_KEY), reason: "DQ-033: operational configuration administrator" }));
    assignmentId = a.id;
    const audit = await q(`SELECT action, actor_uid FROM eos_policy.audit_events WHERE tenant_id = $1 AND action = 'assignRole' AND target_id = $2`, [T, a.id]);
    assert.deepEqual(audit.rows, [{ action: "assignRole", actor_uid: ownerId }]);
  });

  await t.test("4: the principal holds both capabilities and NOTHING else, and uses them", async () => {
    assert.deepEqual([...(await effective(configId))].sort(), [HANDOFF, SCOPE].sort());
    const list = ok(await call("config-admin", "listMobileLocationScopeBindings"));
    assert.deepEqual(list.locations.map((l) => l.state), ["NO_BINDING"]);
    ok(await call("config-admin", "setMobileLocationScopeBinding", { locationId: "truck-1", warehouseId: "WH-1", reason: "DQ-033 proof" }));
    // Nothing else: no Administration read, no policy write, no role management, no assignment.
    refused(await call("config-admin", "listRoles"), "FORBIDDEN");
    refused(await call("config-admin", "explainEffectiveAccess", { principalId: configId }), "FORBIDDEN");
    refused(await call("config-admin", "createRole", { key: "x", name: "x", reason: "x" }), "FORBIDDEN");
    refused(await call("config-admin", "grantObjectActionToRole", { objectKey: "mobileLocation", actionKey: "manageScopeBinding", roleKey: "dispatcher", reason: "x" }), "FORBIDDEN");
    refused(await call("config-admin", "assignRole", { principalId: adminId, roleId: await roleId(ROLE_KEY), reason: "x" }), "FORBIDDEN");
  });

  await t.test("5: SELF_ADMINISTRATION still refuses where it should", async () => {
    // The Administrator may not grant to a Role it holds.
    refused(await call("admin", "grantObjectActionToRole", { objectKey: "mobileLocation", actionKey: "manageScopeBinding", roleKey: "admin", reason: "x" }),
      "FORBIDDEN", /SELF_ADMINISTRATION/);
    // Nobody assigns a Role to themselves -- not the Administrator, not the Owner.
    refused(await call("admin", "assignRole", { principalId: adminId, roleId: await roleId(ROLE_KEY), reason: "x" }), "FORBIDDEN", /SELF_ADMINISTRATION/);
    refused(await call("owner", "assignRole", { principalId: ownerId, roleId: await roleId(ROLE_KEY), reason: "x" }), "FORBIDDEN", /SELF_ADMINISTRATION/);
    // The Owner cannot widen the Role: it holds no policy write.
    refused(await call("owner", "grantObjectActionToRole", { objectKey: "rolesPermissions", actionKey: "assignRole", roleKey: ROLE_KEY, reason: "x" }), "FORBIDDEN");
    assert.deepEqual([...(await effective(configId))].sort(), [HANDOFF, SCOPE].sort(), "still exactly the two");
  });

  await t.test("6: the Owner removes the assignment and the authority goes with it; the binding history stays", async () => {
    ok(await call("owner", "revokeRole", { assignmentId, reason: "DQ-033: removal proof" }));
    assert.deepEqual(await effective(configId), []);
    refused(await call("config-admin", "listMobileLocationScopeBindings"), "FORBIDDEN");
    assert.equal((await q("SELECT count(*)::int n FROM eos_ops.mobile_location_scope_bindings")).rows[0].n, 1, "future operations only -- nothing rewritten");
  });
});
