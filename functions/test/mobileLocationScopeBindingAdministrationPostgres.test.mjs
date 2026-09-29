// DQ-029 -- truck location -> warehouse scope binding ADMINISTRATION, through the real /admin/policy dispatcher.
//
// Proves, against PostgreSQL (migration 1764118800000 registers the capability; 1764115200000 is the table):
//   * inventory.location.scopeBinding.manage is registered as ADMIN_ACTION on mobileLocation, held by NO Role after
//     bootstrap -- not admin, not dispatcher, not technician, not any parts/warehouse Role -- and every operation
//     refuses FORBIDDEN without it, including for a holder of every inventory/transfer/cycle-count capability;
//   * the Administrator cannot grant it to the admin Role it holds (SELF_ADMINISTRATION); through a dedicated Role
//     (createRole + grantObjectActionToRole + assignRole to ANOTHER principal) the holder can
//     create, change and remove, each audited once with actor, time, location, previous + new warehouse and reason;
//   * unknown truck, inactive truck, unknown / foreign-tenant / inactive warehouse, ungoverned company and a
//     cross-company warehouse are refused; a reason is required;
//   * history is never rewritten; after remove resolveScopeLocation fails closed until a new binding exists;
//   * Effective Access explains the capability through the existing machinery.
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

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");
const { bootstrapTenant, bootstrapAdministrator, ensureTenantPrincipal } = require("../lib/adminPolicy/tenantBootstrap.js");
const { executeAdminOperation } = require("../lib/adminPolicy/adminPolicyApi.js");
const { MOBILE_LOCATION_SCOPE_BINDING_CAPABILITY, ADMIN_CONFIGURATION_OPERATIONS } = require("../lib/adminPolicy/configurationOperations.js");
const { createMobileLocationScopeBindingAdministration } = require("../lib/eosOps/mobileLocationScopeBindingAdministration.js");
const { resolveScopeLocation } = require("../lib/eosOps/inventoryScopeAuthority.js");
const { explainEffectiveAccess } = require("../lib/eosOps/effectiveAccessExplanation.js");

const OP = "operator-dq029";
const CAP = "inventory.location.scopeBinding.manage";
const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

test("the capability is one closed constant, and stays out of both PERMISSION_CATALOGs", () => {
  assert.equal(MOBILE_LOCATION_SCOPE_BINDING_CAPABILITY, CAP);
  for (const op of Object.values(ADMIN_CONFIGURATION_OPERATIONS)) assert.equal(op.capability, CAP);
  for (const p of ["src/access/permissionCatalog.ts", "../field-ops-app-vite/src/access/permissionCatalog.ts"]) {
    assert.equal(readFileSync(resolve(FUNCTIONS_DIR, p), "utf8").includes(CAP), false, `${p} must not carry ${CAP}: admin composes the whole catalog`);
  }
  const sql = readFileSync(resolve(FUNCTIONS_DIR, "migrations/1764118800000_mobile-location-scope-binding-capability.sql"), "utf8").split("-- Down Migration")[0];
  assert.doesNotMatch(sql, /INSERT INTO (role_capabilities|principal_capabilities|eos_policy\.role_capabilities|eos_policy\.principal_capabilities)/, "the migration grants nothing");
});

test("DQ-029: truck scope binding Administration", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `dq029_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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

  const T = {};
  for (const key of ["a", "b"]) {
    const { tenant } = await bootstrapTenant(repo, { key: `dq029-${key}`, name: key, actorUid: OP });
    T[key] = tenant.id;
    await bootstrapAdministrator(repo, { tenantId: tenant.id, externalSubject: `admin-${key}`, performedBy: OP, reason: "boot" });
    for (const cap of ["admin.securityPolicy.read", "admin.principalAccess.read", "audit.event.read"]) {
      await q(`INSERT INTO eos_policy.role_capabilities (id,tenant_id,role_id,capability_id,granted_by,created_by,updated_by)
               SELECT 'rc-fx-' || md5($1 || c.id), $1, r.id, c.id, 'fixture','fixture','fixture'
                 FROM eos_policy.roles r, eos_policy.capabilities c WHERE r.tenant_id=$1 AND r.key='admin' AND c.key=$2
               ON CONFLICT DO NOTHING`, [tenant.id, cap]);
    }
  }
  // World: two governed companies in tenant a, one in b; warehouses and truck locations authored per company.
  const company = async (tenant, co, key, status = "ACTIVE") => {
    await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id, operating_company_id, status, source, established_by, updated_by)
             VALUES ($1, $2, $3, 't', $4, $4)`, [tenant, co, status, OP]);
    await q(`INSERT INTO eos_policy.tenant_operating_company_keys (tenant_id, operating_company_id, operating_company_key, status, provenance, source, established_by, updated_by)
             VALUES ($1, $2, $3, 'ACTIVE', 'NATIVE', 't', $4, $4)`, [tenant, co, key, OP]);
  };
  await company(T.a, "co-a", "key-a");
  await company(T.a, "co-x", "key-x");
  await company(T.b, "co-b", "key-b");
  const warehouse = (tenant, id, key, status = "ACTIVE") => q(
    `INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by)
     VALUES ($1, $2, $3, $1, 's', $4, 'NATIVE', $5, $5)`, [id, tenant, key, status, OP]);
  await warehouse(T.a, "WH-A1", "key-a");
  await warehouse(T.a, "WH-A2", "key-a");
  await warehouse(T.a, "WH-A-OFF", "key-a", "INACTIVE");
  await warehouse(T.a, "WH-X", "key-x");
  await warehouse(T.a, "WH-UNGOV", "key-nobody");
  await warehouse(T.b, "WH-B", "key-b");
  const truck = (tenant, id, key, active = true) => q(
    `INSERT INTO eos_ops.mobile_locations (tenant_id, location_type, location_id, operating_company_key, display_label, active, created_by, updated_by)
     VALUES ($1, 'MOBILE', $2, $3, $2, $4, $5, $5)`, [tenant, id, key, active, OP]);
  await truck(T.a, "truck-1", "key-a");
  await truck(T.a, "truck-off", "key-a", false);
  await truck(T.a, "truck-ungov", "key-nobody");
  await truck(T.b, "truck-b", "key-b");

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
  const roleId = async (tenant, key) => (await repo.getRoleByKey(tenant, key))?.id ?? null;
  const person = async (tenant, subject, roleKeys, adminSubject) => {
    const made = await ensureTenantPrincipal(repo, { tenantId: tenant, externalSubject: subject, actorUid: OP, actorRoleKeys: ["admin"] });
    const principalId = made.principal?.id ?? made.id ?? made.principalId;
    for (const key of roleKeys) ok(await call(adminSubject, "assignRole", { principalId, roleId: await roleId(tenant, key), reason: "fixture staffing" }));
    return principalId;
  };
  const holders = async () => (await q(
    `SELECT r.key FROM eos_policy.role_capabilities rc JOIN eos_policy.roles r ON r.id = rc.role_id
       JOIN eos_policy.capabilities c ON c.id = rc.capability_id WHERE c.key = $1
     UNION ALL SELECT 'principal:' || pc.principal_id FROM eos_policy.principal_capabilities pc
       JOIN eos_policy.capabilities c ON c.id = pc.capability_id WHERE c.key = $1`, [CAP])).rows.map((r) => r.key);
  const bindingAudits = async (tenant) => (await q(
    `SELECT action, actor_uid, target_id, before, after, reason, occurred_at FROM eos_policy.audit_events
      WHERE tenant_id = $1 AND target_kind = 'mobileLocationScopeBinding' ORDER BY occurred_at, id`, [tenant])).rows;

  // Operational personas: every inventory / dispatch / technician Role the bootstrap knows, when present.
  const operationalRoleKeys = [];
  for (const key of ["dispatcher", "technician", "partsManager", "partsAssociate", "warehouseManager", "warehouseAssociate",
    "inventoryTransferOperator", "inventoryCycleCountCounter", "inventoryCycleCountReconciler", "inventoryReceivingClerk",
    "inventoryPutAwayOperator", "inventoryStockRelocationOperator", "inventoryBinAdministrator"]) {
    if (await roleId(T.a, key)) operationalRoleKeys.push(key);
  }
  const operational = await person(T.a, "ops-a", operationalRoleKeys, "admin-a");
  const adminA = (await repo.getPrincipalBySubject("firebase", "admin-a")).id;

  await t.test("registered once as ADMIN_ACTION on mobileLocation, and held by NOBODY after bootstrap", async () => {
    const { rows } = await q(`SELECT object_key, action_key, action_kind, display_label FROM eos_policy.capabilities WHERE key = $1`, [CAP]);
    assert.deepEqual(rows, [{ object_key: "mobileLocation", action_key: "manageScopeBinding", action_kind: "ADMIN_ACTION", display_label: "Manage Truck Location Warehouse Scope" }]);
    assert.deepEqual(await holders(), [], "no default holder -- not admin, not any operational Role");
    assert.ok(operationalRoleKeys.includes("dispatcher") && operationalRoleKeys.includes("technician"), JSON.stringify(operationalRoleKeys));
  });

  await t.test("without the capability every configuration operation is FORBIDDEN -- Administrator and operational Roles alike", async () => {
    for (const subject of ["admin-a", "ops-a"]) {
      refused(await call(subject, "listMobileLocationScopeBindings"), "FORBIDDEN", /inventory\.location\.scopeBinding\.manage/);
      refused(await call(subject, "readMobileLocationScopeBinding", { locationId: "truck-1" }), "FORBIDDEN");
      refused(await call(subject, "setMobileLocationScopeBinding", { locationId: "truck-1", warehouseId: "WH-A1", reason: "x" }), "FORBIDDEN");
      refused(await call(subject, "removeMobileLocationScopeBinding", { locationId: "truck-1", reason: "x" }), "FORBIDDEN");
    }
    assert.equal(Number((await q("SELECT count(*)::int n FROM eos_ops.mobile_location_scope_bindings")).rows[0].n), 0);
  });

  // THE PACKET, AS EXECUTABLE. Administration forbids self-elevation: a principal may not grant a capability to a Role
  // it holds, so the Administrator cannot grant this to the `admin` Role it holds (pinned below). The route that IS
  // executable by the Administrator alone: a dedicated Security Role, the capability granted to it, and that Role
  // assigned to the configuring principal -- who may not be the Administrator itself (self-assignment is refused too).
  let config = null;
  await t.test("the DQ-029 packet: the Administrator cannot self-grant; a dedicated Role granted and assigned works", async () => {
    refused(await call("admin-a", "grantObjectActionToRole", { objectKey: "mobileLocation", actionKey: "manageScopeBinding", roleKey: "admin", reason: "DQ-029 packet" }),
      "FORBIDDEN", /SELF_ADMINISTRATION/);
    assert.deepEqual(await holders(), []);
    ok(await call("admin-a", "createRole", { key: "truckScopeAdministrator", name: "Truck Scope Administrator", reason: "DQ-029 packet" }));
    ok(await call("admin-a", "grantObjectActionToRole", { objectKey: "mobileLocation", actionKey: "manageScopeBinding", roleKey: "truckScopeAdministrator", reason: "DQ-029 packet" }));
    config = await person(T.a, "config-a", ["truckScopeAdministrator"], "admin-a");
    const explained = ok(await call("admin-a", "explainEffectiveAccess", { principalId: config }));
    assert.equal(explained.capabilities.includes(CAP), true, "Effective Access lists it for the holder");
    assert.deepEqual(explained.capabilities.filter((c) => c.startsWith("inventory.") || c.startsWith("admin.")), [CAP],
      "the Role confers the configuration authority and nothing else");
    const ops = ok(await call("admin-a", "explainEffectiveAccess", { principalId: operational }));
    assert.equal(ops.capabilities.includes(CAP), false, "and not for the operational Roles");
    const adm = ok(await call("admin-a", "explainEffectiveAccess", { principalId: adminA }));
    assert.equal(adm.capabilities.includes(CAP), false, "nor for the Administrator, who did not assign it to itself");
    assert.deepEqual(await holders(), ["truckScopeAdministrator"]);
    refused(await call("ops-a", "listMobileLocationScopeBindings"), "FORBIDDEN");
    refused(await call("admin-a", "listMobileLocationScopeBindings"), "FORBIDDEN");
    refused(await call("admin-b", "listMobileLocationScopeBindings"), "FORBIDDEN", /inventory\.location\.scopeBinding\.manage/);
    refused(await call("admin-a", "assignRole", { principalId: adminA, roleId: await roleId(T.a, "truckScopeAdministrator"), reason: "self" }),
      "FORBIDDEN", /SELF_ADMINISTRATION/);
  });

  await t.test("READ before any binding: NO_BINDING, truck acts fail closed", async () => {
    const list = ok(await call("config-a", "listMobileLocationScopeBindings"));
    assert.deepEqual(list.locations.map((l) => [l.locationId, l.state]),
      [["truck-1", "NO_BINDING"], ["truck-off", "NO_BINDING"], ["truck-ungov", "NO_BINDING"]], "tenant a only");
    const one = ok(await call("config-a", "readMobileLocationScopeBinding", { locationId: "truck-1" }));
    assert.equal(one.state, "NO_BINDING");
    assert.match(one.explanation, /fails closed/);
    await assert.rejects(resolveScopeLocation(pool, T.a, { type: "MOBILE", locationId: "truck-1" }), (e) => e.code === "MOBILE_SCOPE_BINDING_MISSING");
  });

  await t.test("refusals: reason, unknown/inactive truck, unknown/foreign/inactive warehouse, ungoverned and cross company", async () => {
    const set = (input) => call("config-a", "setMobileLocationScopeBinding", input);
    refused(await set({ locationId: "truck-1", warehouseId: "WH-A1" }), "INVALID_INPUT", /reason/);
    refused(await set({ locationId: "truck-1", warehouseId: "WH-A1", reason: "   " }), "INVALID_INPUT", /reason/);
    refused(await set({ warehouseId: "WH-A1", reason: "r" }), "INVALID_INPUT");
    refused(await set({ locationId: "nope", warehouseId: "WH-A1", reason: "r" }), "NOT_FOUND");
    refused(await set({ locationId: "truck-b", warehouseId: "WH-B", reason: "r" }), "NOT_FOUND", /not a governed truck/);
    refused(await set({ locationId: "truck-off", warehouseId: "WH-A1", reason: "r" }), "CONFLICT", /inactive/);
    refused(await set({ locationId: "truck-1", warehouseId: "WH-NOPE", reason: "r" }), "NOT_FOUND");
    refused(await set({ locationId: "truck-1", warehouseId: "WH-B", reason: "r" }), "NOT_FOUND", /not a governed warehouse/);
    refused(await set({ locationId: "truck-1", warehouseId: "WH-A-OFF", reason: "r" }), "CONFLICT", /not ACTIVE/);
    refused(await set({ locationId: "truck-1", warehouseId: "WH-UNGOV", reason: "r" }), "CONFLICT", /WAREHOUSE|warehouse's operating company is not governed/);
    refused(await set({ locationId: "truck-ungov", warehouseId: "WH-A1", reason: "r" }), "CONFLICT", /truck_location's operating company is not governed/);
    refused(await set({ locationId: "truck-1", warehouseId: "WH-X", reason: "r" }), "CONFLICT", /own company/);
    refused(await call("config-a", "removeMobileLocationScopeBinding", { locationId: "truck-1", reason: "r" }), "NOT_FOUND");
    assert.equal(Number((await q("SELECT count(*)::int n FROM eos_ops.mobile_location_scope_bindings")).rows[0].n), 0);
    assert.deepEqual(await bindingAudits(T.a), [], "a refusal writes no audit");
  });

  await t.test("CREATE, CHANGE, NO_CHANGE, REMOVE: audited with actor, time, location, previous/new warehouse, reason; history kept", async () => {
    const created = ok(await call("config-a", "setMobileLocationScopeBinding", { locationId: "truck-1", warehouseId: "WH-A1", reason: "based at A1" }));
    assert.equal(created.outcome, "CREATED");
    assert.equal(created.previousWarehouseId, null);
    assert.equal((await resolveScopeLocation(pool, T.a, { type: "MOBILE", locationId: "truck-1" })).scopeWarehouseId, "WH-A1");

    const same = ok(await call("config-a", "setMobileLocationScopeBinding", { locationId: "truck-1", warehouseId: "WH-A1", reason: "again" }));
    assert.equal(same.outcome, "NO_CHANGE");
    assert.equal(same.auditEventId, null);

    const changed = ok(await call("config-a", "setMobileLocationScopeBinding", { locationId: "truck-1", warehouseId: "WH-A2", reason: "moved to A2" }));
    assert.deepEqual([changed.outcome, changed.previousWarehouseId, changed.warehouseId], ["CHANGED", "WH-A1", "WH-A2"]);
    assert.equal((await resolveScopeLocation(pool, T.a, { type: "MOBILE", locationId: "truck-1" })).scopeWarehouseId, "WH-A2");

    const removed = ok(await call("config-a", "removeMobileLocationScopeBinding", { locationId: "truck-1", reason: "truck retired from A2" }));
    assert.deepEqual([removed.outcome, removed.previousWarehouseId, removed.warehouseId], ["REMOVED", "WH-A2", null]);
    await assert.rejects(resolveScopeLocation(pool, T.a, { type: "MOBILE", locationId: "truck-1" }), (e) => e.code === "MOBILE_SCOPE_BINDING_MISSING",
      "after remove, truck operations refuse until a new valid binding exists");

    const audits = await bindingAudits(T.a);
    assert.deepEqual(audits.map((a) => [a.action, a.actor_uid, a.target_id, a.before?.warehouseId ?? null, a.after?.warehouseId ?? null]), [
      ["mobileLocationScopeBinding.created", config, "truck-1", null, "WH-A1"],
      ["mobileLocationScopeBinding.changed", config, "truck-1", "WH-A1", "WH-A2"],
      ["mobileLocationScopeBinding.removed", config, "truck-1", "WH-A2", null],
    ]);
    assert.ok(audits.every((a) => a.occurred_at instanceof Date));
    assert.deepEqual(audits.map((a) => a.reason.replace(/ \[request .*\]$/, "")), ["based at A1", "moved to A2", "truck retired from A2"]);

    // History is never rewritten: three rows, each ended by the act that superseded it, none deleted.
    const history = ok(await call("config-a", "readMobileLocationScopeBinding", { locationId: "truck-1" }));
    assert.equal(history.state, "NO_BINDING");
    assert.deepEqual(history.history.map((b) => [b.warehouseId, b.effectiveTo !== null, b.endReason?.replace(/ \[request .*\]$/, "") ?? null]).reverse(),
      [["WH-A1", true, "moved to A2"], ["WH-A2", true, "truck retired from A2"]]);

    // A new valid binding restores truck operations.
    ok(await call("config-a", "setMobileLocationScopeBinding", { locationId: "truck-1", warehouseId: "WH-A1", reason: "back at A1" }));
    assert.equal((await resolveScopeLocation(pool, T.a, { type: "MOBILE", locationId: "truck-1" })).scopeWarehouseId, "WH-A1");
  });

  await t.test("revoking the grant takes effect: the configurator is FORBIDDEN again", async () => {
    ok(await call("admin-a", "revokeObjectActionFromRole", { objectKey: "mobileLocation", actionKey: "manageScopeBinding", roleKey: "truckScopeAdministrator", reason: "fixture revoke" }));
    refused(await call("config-a", "listMobileLocationScopeBindings"), "FORBIDDEN");
  });

  await t.test("the down migration refuses while a Role grant or an Administration decision names the capability", async () => {
    const down = readFileSync(resolve(FUNCTIONS_DIR, "migrations/1764118800000_mobile-location-scope-binding-capability.sql"), "utf8").split("-- Down Migration")[1];
    await assert.rejects(q(down), /MOBILE_LOCATION_SCOPE_BINDING_AUTHORITY: refuses to reverse/);
  });
});
