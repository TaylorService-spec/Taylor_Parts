// TEST FIXTURE ONLY: a private, migrated PostgreSQL database with two tenants whose principals cover every shape the
// grant-impact preview must get right (arch/grant-impact-preview.md §6.1, census-postuat personas):
//
//   admin       the bootstrap Administrator (protected Administrator standing)
//   owner       a protected Owner (seeded as tenant bootstrap seeds the first Administrator)
//   gm          generalManager + admin.roleAssignment.write, WITHOUT admin.principalAccess.read (counts-only previews)
//   pp          partsManager AND purchasingManager (two Roles granting overlapping keys)
//   sales       salesManager at salesChannel=RETAIL (a SCOPED holder: opportunity.read evaluable, one key inert)
//   tech        technician whose workOrder.record.read is CONDITIONED (RECORD_ASSIGNMENT)
//   dx          dispatcher + a DIRECT exception on a key the Role also grants (overlap) + an expiring direct exception
//   inel        dispatcher, linked to a TERMINATED Employee (DQ-007: resolution refuses; authority is latent)
//   stale       a dispatcher assignment granted ABOVE the current access version (excluded as stale)
//   plain       a member with nothing
//
// Initial grants are written as SYSTEM DEFAULT fixture rows (an administrator may not widen a Role it holds), exactly
// as the other Administration PostgreSQL suites do. Nothing here is a product path.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { seedProtectedOwner } from "./protectedOwnerFixture.mjs";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const { PostgresPolicyRepository } = require("../../lib/adminPolicy/postgresPolicyRepository.js");
const { bootstrapTenant, bootstrapAdministrator, ensureTenantPrincipal } = require("../../lib/adminPolicy/tenantBootstrap.js");
const { executeAdminOperation } = require("../../lib/adminPolicy/adminPolicyApi.js");
const { createAuthorityChangePreview } = require("../../lib/eosOps/authorityChangePreview.js");
const { PART_SUPPLIER_TERMS_FIELD_GROUPS } = require("../../lib/eosOps/partSupplierTerms.js");

export const FIELD_GROUPS = Object.freeze([PART_SUPPLIER_TERMS_FIELD_GROUPS]);
export const ASSIGNED_ONLY = Object.freeze({ paths: [[{ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" }]], recordKind: "workOrder" });
export const PARTS_ELIGIBLE = Object.freeze({ paths: [[{ kind: "WORK_ELIGIBILITY", qualificationCode: "PARTS_OPERATIONS" }]] });

async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

/** Create + migrate a private database. Returns { url, drop }. */
export async function privateDatabase(baseUrl, prefix) {
  const name = `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  await withClient(baseUrl, (c) => c.query(`CREATE DATABASE ${name}`));
  const u = new URL(baseUrl);
  u.pathname = `/${name}`;
  const url = u.toString();
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations", "--no-check-order"],
    { maxBuffer: 256 * 1024 * 1024, cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  return { url, name, drop: () => withClient(baseUrl, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)) };
}

/** Byte-level fingerprint of EVERY table in the policy and workforce schemas (audit, decisions, access versions...). */
export async function tableHashes(q) {
  const { rows: tables } = await q(`SELECT table_schema, table_name FROM information_schema.tables
     WHERE table_schema IN ('eos_policy', 'eos_workforce') AND table_type = 'BASE TABLE' ORDER BY 1, 2`);
  const out = {};
  for (const t of tables) {
    const { rows } = await q(`SELECT count(*)::int n, md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) h
                                FROM ${t.table_schema}.${t.table_name} x`);
    out[`${t.table_schema}.${t.table_name}`] = `${rows[0].n}:${rows[0].h}`;
  }
  return out;
}

const FIXTURE_GRANT = `INSERT INTO eos_policy.role_capabilities (id,tenant_id,role_id,capability_id,granted_by,created_by,updated_by)
  SELECT 'rc-fx-' || md5($1 || r.id || c.id), $1, r.id, c.id, 'fixture','fixture','fixture'
    FROM eos_policy.roles r, eos_policy.capabilities c WHERE r.tenant_id=$1 AND r.key=$2 AND c.key=$3
  ON CONFLICT DO NOTHING`;

/** Build the two-tenant world. `previewOptions` are passed to createAuthorityChangePreview. */
export async function buildPreviewWorld(url, previewOptions = {}) {
  const pool = new pg.Pool({ connectionString: url, max: 16, idleTimeoutMillis: 0 });
  const q = (s, v = []) => pool.query(s, v);
  const repo = new PostgresPolicyRepository(pool);
  const statements = [];
  const simulator = createAuthorityChangePreview({
    pool, fieldGroups: FIELD_GROUPS, ...previewOptions,
    onStatements: (log) => { statements.push(log); previewOptions.onStatements?.(log); },
  });
  const deps = { repo, previewAuthorityChange: simulator };
  const call = (subject, operation, input = {}) => executeAdminOperation(deps,
    { caller: { externalSubject: subject, identityProvider: "firebase" }, operation, input, requestId: `gip-${operation}` });
  const grant = (tenantId, roleKey, capabilityKey) => q(FIXTURE_GRANT, [tenantId, roleKey, capabilityKey]);
  const roleId = async (tenantId, key) => (await repo.getRoleByKey(tenantId, key)).id;
  const member = async (tenantId, subject) => {
    const made = await ensureTenantPrincipal(repo, { tenantId, externalSubject: subject, actorUid: "fixture", actorRoleKeys: ["admin"] });
    return made.principal?.id ?? made.id ?? made.principalId;
  };
  const assign = async (tenantId, principalId, roleKey, { scopeType = "global", scopeValue = null, future = false } = {}) => {
    const role = await repo.getRoleByKey(tenantId, roleKey);
    return repo.transact({ tenantId, uid: "fixture" }, async (tx) => {
      const v = await tx.bumpAccessVersion(principalId);
      return tx.createAssignment({ principalId, roleId: role.id, scopeType, scopeValue, status: "active", grantedBy: "fixture",
        grantedAt: new Date(Date.now() - 60_000).toISOString(), accessVersionAtGrant: future ? v + 1 : v });
    });
  };

  const T = {};
  const P = { a: {}, b: {} };
  for (const key of ["a", "b"]) {
    const { tenant } = await bootstrapTenant(repo, { key: `gip-${key}`, name: `gip ${key}`, actorUid: "fixture" });
    T[key] = tenant.id;
    await bootstrapAdministrator(repo, { tenantId: tenant.id, externalSubject: `gip-admin-${key}`, performedBy: "fixture", reason: "boot" });
    P[key].admin = (await repo.getPrincipalBySubject("firebase", `gip-admin-${key}`)).id;
    for (const cap of ["admin.securityPolicy.read", "admin.principalAccess.read", "audit.event.read"]) await grant(tenant.id, "admin", cap);
    P[key].owner = await member(tenant.id, `gip-owner-${key}`);
    P[key].ownerAssignment = (await seedProtectedOwner(repo, { tenantId: tenant.id, principalId: P[key].owner })).id;
    P[key].disp = await member(tenant.id, `gip-disp-${key}`);
    await grant(tenant.id, "dispatcher", "workOrder.lifecycle.dispatch");
    await grant(tenant.id, "dispatcher", "workOrder.record.read");
    await assign(tenant.id, P[key].disp, "dispatcher");
    // The Owner also holds an ordinary Role, so Owner ruling A at the PRINCIPAL is reachable through it.
    await assign(tenant.id, P[key].owner, "dispatcher");
  }
  const A = T.a;
  await q(`INSERT INTO eos_policy.tenant_sales_channels (tenant_id, sales_channel, status, source, established_by, updated_by)
           VALUES ($1, 'RETAIL', 'ACTIVE', 'fixture', 'fixture', 'fixture')`, [A]);
  // gm: assignment authority WITHOUT the principal-access read (counts-only previews).
  P.a.gm = await member(A, "gip-gm-a");
  await grant(A, "generalManager", "admin.roleAssignment.write");
  await assign(A, P.a.gm, "generalManager");
  // pp: two Roles, overlapping keys.
  P.a.pp = await member(A, "gip-pp-a");
  await grant(A, "partsManager", "inventory.catalog.read");
  await grant(A, "purchasingManager", "inventory.catalog.read");
  await grant(A, "purchasingManager", "reorder.purchaseOrder.read");
  await grant(A, "purchasingManager", "inventory.catalog.cost.read");
  await assign(A, P.a.pp, "partsManager");
  await assign(A, P.a.pp, "purchasingManager");
  // sales: a SCOPED holder.
  P.a.sales = await member(A, "gip-sales-a");
  await grant(A, "salesManager", "opportunity.read");
  await grant(A, "salesManager", "workOrder.record.read");
  await assign(A, P.a.sales, "salesManager", { scopeType: "salesChannel", scopeValue: "RETAIL" });
  // tech: a CONDITIONED grant.
  P.a.tech = await member(A, "gip-tech-a");
  await grant(A, "technician", "workOrder.record.read");
  await q(`INSERT INTO eos_policy.capability_grant_conditions (id, tenant_id, grant_scope, grantor_key, capability_key, condition, status, established_by, updated_by)
           VALUES ('gc-fx-tech', $1, 'ROLE', 'technician', 'workOrder.record.read', $2::jsonb, 'ACTIVE', 'fixture', 'fixture')`, [A, JSON.stringify(ASSIGNED_ONLY)]);
  await assign(A, P.a.tech, "technician");
  // dx: Role + overlapping DIRECT exception + an expiring direct exception.
  P.a.dx = await member(A, "gip-dx-a");
  await assign(A, P.a.dx, "dispatcher");
  for (const [capKey, expires] of [["workOrder.record.read", null], ["opportunity.read", new Date(Date.now() + 86_400_000).toISOString()]]) {
    await q(`INSERT INTO eos_policy.principal_capabilities (id, tenant_id, principal_id, capability_id, granted_by, created_by, updated_by, exception_reason, expires_at)
             SELECT 'pc-fx-' || md5($2 || c.id), $1, $2, c.id, 'fixture', 'fixture', 'fixture', 'fixture exception', $4 FROM eos_policy.capabilities c WHERE c.key = $3`,
    [A, P.a.dx, capKey, expires]);
  }
  // inel: linked to a TERMINATED Employee.
  P.a.inel = await member(A, "gip-inel-a");
  await assign(A, P.a.inel, "dispatcher");
  await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id, updated_at)
           VALUES ('emp-gip-inel', $1, 'TERMINATED', 'taylor', '2020-01-01T00:00:00Z')`, [A]);
  await q(`INSERT INTO eos_policy.employee_principal_links (id, tenant_id, principal_id, employee_id, operating_company_id, link_source, asserted_by, assertion_reason)
           VALUES ('epl-gip-inel', $1, $2, 'emp-gip-inel', 'taylor', 'OPERATOR_ASSERTED', 'fixture', 'preview fixture')`, [A, P.a.inel]);
  // stale: an assignment from the future (excluded as STALE until the access version passes it).
  P.a.stale = await member(A, "gip-stale-a");
  P.a.staleAssignment = (await assign(A, P.a.stale, "dispatcher", { future: true })).id;
  // An ACTIVE workflow with a SECURITY_ROLE binding (dispatcher -> Dispatch), created and published through
  // Administration, so Security Role changes move workflow responsibilities.
  const draft = await call("gip-admin-a", "createWorkflowDraft", { key: "gipDispatch", name: "Preview dispatch", objectKey: "workOrder",
    reason: "preview fixture", definition: {
      steps: [{ key: "OPEN", label: "Open", initial: true }, { key: "DISPATCHED", label: "Dispatched", terminal: true }],
      actions: [{ key: "Dispatch", label: "Dispatch", from: "OPEN", to: "DISPATCHED", capabilityKey: "workOrder.lifecycle.dispatch", roleKeys: ["dispatcher"] }],
    } });
  if (!draft.ok) throw new Error(`fixture workflow draft: ${JSON.stringify(draft)}`);
  const published = await call("gip-admin-a", "publishWorkflowVersion", { versionId: draft.data.version.id, reason: "preview fixture" });
  if (!published.ok) throw new Error(`fixture workflow publish: ${JSON.stringify(published)}`);
  P.a.plain = await member(A, "gip-plain-a");
  P.a.plain2 = await member(A, "gip-plain2-a");
  return { pool, q, repo, deps, call, simulator, statements, T, P, grant, assign, roleId, member };
}
