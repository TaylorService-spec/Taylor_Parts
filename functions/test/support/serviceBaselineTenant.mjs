// A BASELINE-EQUAL SERVICE TENANT for the Service Experience suites (Controller SERVICE EXPERIENCE COMPLETION,
// 2026-09-30): the authority baseline's own rebuild (phases A-E), the recorded nonprod decision D-A replayed, then the
// ACCEPTED live Service authority -- DQ-016, the nine Service grants, labor correction and the ten Inbound Work grants
// (serviceActivationAuthorityDelta.serviceActivationOperations) -- applied through the Administration API. That is the
// live nonprod authority state; each suite then applies only the grants its increment proposes, through the same API.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const { PostgresPolicyRepository } = require("../../lib/adminPolicy/postgresPolicyRepository.js");
const { seedTenantPolicy } = require("../../lib/adminPolicy/seed/policySeed.js");
const { bootstrapAdministrator, ensureTenantPrincipal } = require("../../lib/adminPolicy/tenantBootstrap.js");
const { executeAdminOperation } = require("../../lib/adminPolicy/adminPolicyApi.js");
const baseline = require("../../lib/adminPolicy/roleCapabilityAuthorityBaseline.js");
const delta = require("../../lib/adminPolicy/serviceActivationAuthorityDelta.js");
const http = require("../../lib/eosOps/eosOpsHttp.js");

async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

/** Build the tenant. `t` is the node:test context (its `after` drops the database). */
export async function serviceBaselineTenant(t, { urlBase, tenant, prefix }) {
  const dbUrlFor = (n) => { const u = new URL(urlBase); u.pathname = `/${n}`; return u.toString(); };
  const migrate = (url, count) => execFileSync(process.execPath, [
    "node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations", "--no-check-order",
    ...(count === undefined ? [] : [String(count)]),
  ], { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  const name = `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(urlBase, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
    await withClient(urlBase, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  const url = dbUrlFor(name);
  const files = readdirSync(join(FUNCTIONS_DIR, "migrations")).filter((f) => f.endsWith(".sql")).sort();
  migrate(url, files.filter((f) => f < baseline.SEED_BOUNDARY_MIGRATION).length);
  pool = new pg.Pool({ connectionString: url, max: 12 });
  const q = (sql, v = []) => pool.query(sql, v);
  const repo = new PostgresPolicyRepository(pool);
  const OPERATOR = `operator-${prefix}`;
  const ADMIN_SUBJECT = `uid-${prefix}-admin`;
  await q(`INSERT INTO eos_policy.tenants (id,key,name) VALUES ($1,$1,$1)`, [tenant]);
  await seedTenantPolicy(repo, tenant, OPERATOR);
  migrate(url);
  for (const [pairs, by] of [[baseline.GLOBAL_CATALOG_ACTIVATED_GRANTS, `canonical-catalog:${prefix}`], [baseline.NONPROD_ACTIVATED_CAPABILITY_GRANTS, `nonprod-activation:${prefix}`]]) {
    for (const { roleKey, capabilityKey } of pairs) {
      await q(`INSERT INTO eos_policy.role_capabilities (id,tenant_id,role_id,capability_id,granted_by,created_by,updated_by)
               SELECT 'rc_' || substr(md5($1 || r.id || c.id), 1, 24), $1, r.id, c.id, $4, $4, $4
                 FROM eos_policy.roles r, eos_policy.capabilities c WHERE r.tenant_id = $1 AND r.key = $2 AND c.key = $3
               ON CONFLICT (tenant_id, role_id, capability_id) DO NOTHING`, [tenant, roleKey, capabilityKey, by]);
    }
  }
  for (const company of ["taylor", "ventana"]) {
    await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id,operating_company_id,status,source,established_by,updated_by)
             VALUES ($1,$2,'ACTIVE','fixture','fixture','fixture')`, [tenant, company]);
    await q(`INSERT INTO eos_policy.tenant_operating_company_keys (tenant_id,operating_company_id,operating_company_key,status,provenance,source,established_by,updated_by)
             VALUES ($1,$2,$2,'ACTIVE','NATIVE','fixture','fixture','fixture')`, [tenant, company]);
  }
  await bootstrapAdministrator(repo, { tenantId: tenant, externalSubject: ADMIN_SUBJECT, performedBy: OPERATOR, reason: "initial administrator" });
  const admin = (operation, input) => executeAdminOperation({ repo },
    { caller: { externalSubject: ADMIN_SUBJECT, identityProvider: "firebase" }, operation, input, requestId: `r-${randomUUID()}` });
  for (const [objectKey, actionKey] of [["opportunity", "edit"], ["opportunity", "createSalesOrder"], ["salesAgreement", "create"],
    ["salesAgreement", "edit"], ["salesAgreement", "accept"], ["salesOrder", "edit"]]) {
    assert.equal((await admin("revokeObjectActionFromRole", { roleKey: "dispatcher", objectKey, actionKey, reason: "D-A replayed" })).ok, true);
  }
  for (const { operation, input } of delta.serviceActivationOperations()) assert.equal((await admin(operation, input)).ok, true, `${operation} ${JSON.stringify(input)}`);

  const roleId = async (key) => (await repo.getRoleByKey(tenant, key)).id;
  /** A signed-in person holding canonical Security Roles, optionally an Employee (linked, SERVICE_TECHNICIAN-eligible by default). */
  const person = async (subject, roleKeys, employee = null) => {
    const made = await ensureTenantPrincipal(repo, { tenantId: tenant, externalSubject: subject, actorUid: OPERATOR, actorRoleKeys: ["admin"] });
    const principalId = made.principal?.id ?? made.id ?? made.principalId;
    for (const key of roleKeys) assert.equal((await admin("assignRole", { principalId, roleId: await roleId(key), reason: "staffing" })).ok, true, key);
    if (employee) {
      await q(`INSERT INTO eos_workforce.employees (id,tenant_id,employment_status,operating_company_id,display_name) VALUES ($1,$2,$3,$4,$5)`,
        [employee.id, tenant, employee.status ?? "ACTIVE", employee.company ?? "taylor", employee.name ?? employee.id]);
      if (employee.linked !== false) {
        await q(`INSERT INTO eos_policy.employee_principal_links (id,tenant_id,principal_id,employee_id,operating_company_id,link_source,status,asserted_by,assertion_reason)
                 VALUES ($1,$2,$3,$4,$5,'OPERATOR_ASSERTED','active','fixture','fixture')`, [`lnk-${employee.id}`, tenant, principalId, employee.id, employee.company ?? "taylor"]);
      }
      if (employee.technician) {
        await q(`INSERT INTO eos_workforce.employee_work_eligibility (id,tenant_id,employee_id,qualification_code,effective_from,assigned_by,reason)
                 VALUES ($1,$2,$3,'SERVICE_TECHNICIAN',now(),'fixture','fixture')`, [`we-${employee.id}`, tenant, employee.id]);
      }
    }
    return { subject, principalId };
  };
  const call = async (who, route, operation, input = {}) => {
    const res = await http.handleOperationsRequest({ reader: repo, pool, workOrderPostgresState: "ACTIVE",
      verifyToken: async (token) => ({ externalSubject: token, identityProvider: "firebase" }) },
    { method: "POST", url: route, headers: { authorization: `Bearer ${who.subject}` }, body: JSON.stringify({ operation, input }) });
    return { status: res.status, body: JSON.parse(res.body) };
  };
  return { pool, q, repo, admin, person, call, http };
}
