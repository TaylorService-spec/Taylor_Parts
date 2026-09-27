// explainEffectiveAccess -- PARITY with the runtime, for EVERY persona fixture, against PostgreSQL.
//
// The explanation must be the runtime's answer, not a second opinion. For each of the 21 personas in
// scripts/fixtures/personaAuthorityDimensions.v1.json (Security Roles, Employee link, Work Eligibility,
// Operational Scope), on a fixture tenant rebuilt exactly as the authority baseline is:
//
//   explain.capabilities            ==  resolveOperationalContext(...).capabilities
//   explain.securityRoleKeys        ==  resolveOperationalContext(...).principalContext.heldRoleKeys
//   explain.{employeeId, workEligibility, operationalScopes, surfaces}
//                                   ==  resolveExperienceContext(...)
//   every ALLOWED / DENIED row      ==  authorizeOperationalAction over the runtime context
//
// ...then again AFTER a condition, a direct exception, a stale and a scoped assignment are introduced, so
// CONDITIONAL, DIRECT_EXCEPTION (enforced since lane DX) and the excluded-assignment report are proved and parity still holds.
// Also: the Admin read gate (admin.principalAccess.read), tenant confinement, and expired direct grants.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");
const { seedTenantPolicy } = require("../lib/adminPolicy/seed/policySeed.js");
const { bootstrapAdministrator } = require("../lib/adminPolicy/tenantBootstrap.js");
const { executeAdminOperation } = require("../lib/adminPolicy/adminPolicyApi.js");
const baseline = require("../lib/adminPolicy/roleCapabilityAuthorityBaseline.js");
const capabilityAuthority = require("../lib/eosOps/capabilityAuthority.js");
const composition = require("../lib/eosOps/entitledActionAuthority.js");
const evaluator = require("../lib/eosOps/contextualAuthorization.js");
const { resolveExperienceContext } = require("../lib/eosOps/experienceAuthority.js");
const { explainEffectiveAccess } = require("../lib/eosOps/effectiveAccessExplanation.js");

const MANIFEST = JSON.parse(readFileSync(join(FUNCTIONS_DIR, "scripts", "fixtures", "personaAuthorityDimensions.v1.json"), "utf8"));
const PERSONAS = MANIFEST.personas;
const TENANT = "t-explain";
const COMPANY = "sample-co-synthetic";
const empOf = (k) => `emp-${k}`;
const prnOf = (k) => `prn-${k}`;
const subjectOf = (k) => `uid-${k}`;

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}
const migrate = (url, count) => execFileSync(process.execPath, [
  "node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations", "--no-check-order",
  ...(count === undefined ? [] : [String(count)]),
], { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });

test("explainEffectiveAccess is the runtime's answer, for every persona", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `explain_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  const url = dbUrlFor(name);

  // ── the authority baseline's own rebuild: the real persona capability sets ──
  const files = readdirSync(join(FUNCTIONS_DIR, "migrations")).filter((f) => f.endsWith(".sql")).sort();
  migrate(url, files.filter((f) => f < baseline.SEED_BOUNDARY_MIGRATION).length);
  pool = new pg.Pool({ connectionString: url, max: 8 });
  const q = (sql, v = []) => pool.query(sql, v);
  const repo = new PostgresPolicyRepository(pool);
  await q(`INSERT INTO eos_policy.tenants (id,key,name) VALUES ($1,$1,$1)`, [TENANT]);
  await seedTenantPolicy(repo, TENANT, "explain-fixture");
  migrate(url);
  for (const { roleKey, capabilityKey } of [...baseline.GLOBAL_CATALOG_ACTIVATED_GRANTS, ...baseline.NONPROD_ACTIVATED_CAPABILITY_GRANTS]) {
    await q(`INSERT INTO eos_policy.role_capabilities (id,tenant_id,role_id,capability_id,granted_by,created_by,updated_by)
             SELECT 'rc_x_' || substr(md5($1 || r.id || c.id), 1, 24), $1, r.id, c.id, 'fixture', 'fixture', 'fixture'
               FROM eos_policy.roles r, eos_policy.capabilities c WHERE r.tenant_id = $1 AND r.key = $2 AND c.key = $3
             ON CONFLICT (tenant_id, role_id, capability_id) DO NOTHING`, [TENANT, roleKey, capabilityKey]);
  }
  await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id,operating_company_id,status,source,established_by,updated_by)
           VALUES ($1,$2,'ACTIVE','explain','fixture','fixture')`, [TENANT, COMPANY]);
  await q(`INSERT INTO eos_policy.tenant_operating_company_keys
             (tenant_id,operating_company_id,operating_company_key,status,provenance,source,established_by,updated_by)
           VALUES ($1,$2,$2,'ACTIVE','MIGRATED','explain','fixture','fixture')`, [TENANT, COMPANY]);
  for (const wh of ["SC-WH-MAIN", "SC-WH-SERVICE"]) {
    await q(`INSERT INTO eos_ops.warehouses (id,tenant_id,operating_company_key,name,site_label,status,provenance,created_by,updated_by)
             VALUES ($1,$2,$3,$1,$1,'ACTIVE','NATIVE','fixture','fixture')`, [wh, TENANT, COMPANY]);
  }

  // ── every persona: Principal, membership, Employee + link, its Security Roles ──
  const roleId = async (key) => {
    const existing = await repo.getRoleByKey(TENANT, key);
    if (existing) return existing.id;
    await q(`INSERT INTO eos_policy.roles (id,tenant_id,key,name,origin,created_by,updated_by)
             VALUES ($1,$2,$3,$3,'SYSTEM','fixture','fixture')`, [`role-${key}`, TENANT, key]);
    return `role-${key}`;
  };
  const assign = async (principalId, roleKey, { scopeType = "global", scopeValue = null, stale = false } = {}) => {
    const rid = await roleId(roleKey);
    await repo.transact({ tenantId: TENANT, uid: "fixture" }, async (tx) => {
      const version = await tx.bumpAccessVersion(principalId);
      return tx.createAssignment({ principalId, roleId: rid, scopeType, scopeValue, status: "active", grantedBy: "fixture",
        grantedAt: new Date().toISOString(), accessVersionAtGrant: stale ? version + 1000 : version });
    });
  };
  for (const [key, persona] of Object.entries(PERSONAS)) {
    await q(`INSERT INTO eos_policy.principals (id,external_subject,identity_provider,status) VALUES ($1,$2,'firebase','active')`, [prnOf(key), subjectOf(key)]);
    await q(`INSERT INTO eos_policy.tenant_memberships (id,tenant_id,principal_id,status) VALUES ($1,$2,$3,'active')`, [`mem-${key}`.slice(0, 60), TENANT, prnOf(key)]);
    if (persona.employee) {
      await q(`INSERT INTO eos_workforce.employees (id,tenant_id,employment_status,operating_company_id,employee_number)
               VALUES ($1,$2,'ACTIVE',$3,$4)`, [empOf(key), TENANT, COMPANY, `E-${key}`.slice(0, 32)]);
      await q(`INSERT INTO eos_policy.employee_principal_links
                 (id,tenant_id,principal_id,employee_id,operating_company_id,link_source,status,asserted_by,assertion_reason)
               VALUES ($1,$2,$3,$4,$5,'OPERATOR_ASSERTED','active','fixture','persona manifest')`,
      [`lnk-${key}`.slice(0, 60), TENANT, prnOf(key), empOf(key), COMPANY]);
    }
    for (const roleKey of persona.securityRoles ?? []) await assign(prnOf(key), roleKey);
  }
  for (const row of MANIFEST.workEligibility) {
    await q(`INSERT INTO eos_workforce.employee_work_eligibility (id,tenant_id,employee_id,qualification_code,effective_from,assigned_by)
             VALUES ($1,$2,$3,$4,now(),'fixture')`, [`we-${row.employee}-${row.qualificationCode}`.slice(0, 60), TENANT, empOf(row.employee), row.qualificationCode]);
  }
  for (const row of MANIFEST.operationalScopes) {
    await q(`INSERT INTO eos_workforce.employee_operational_scopes (id,tenant_id,employee_id,scope_type,scope_id,effective_from,assigned_by)
             VALUES ($1,$2,$3,$4,$5,now(),'fixture')`, [`os-${row.employee}-${row.scopeType}-${row.scopeId}`.slice(0, 60), TENANT, empOf(row.employee), row.scopeType, row.scopeId]);
  }

  const provider = composition.postgresGrantConditionProvider(pool);
  const inputOf = (key) => ({ identityProvider: "firebase", externalSubject: subjectOf(key), requestedTenantId: null });
  const assertParity = async (key) => {
    const explained = await explainEffectiveAccess(repo, pool, { tenantId: TENANT, principalId: prnOf(key) });
    const runtime = await capabilityAuthority.resolveOperationalContext(repo, pool, inputOf(key), provider);
    const experience = await resolveExperienceContext(repo, pool, inputOf(key));
    assert.deepEqual(explained.capabilities, [...runtime.capabilities].sort(), `${key}: capabilities`);
    assert.deepEqual(explained.conditionallyHeld, [...runtime.conditionallyHeld].sort(), `${key}: conditionally held`);
    assert.deepEqual(explained.securityRoleKeys, [...runtime.principalContext.heldRoleKeys], `${key}: Roles`);
    assert.deepEqual([explained.employeeId, explained.workEligibility, explained.operationalScopes, explained.surfaces],
      [experience.employeeId, [...experience.workEligibility], experience.operationalScopes.map((s) => ({ ...s })), [...experience.surfaces]],
      `${key}: experience context`);
    // Every row's result is the runtime evaluator's own decision over the runtime context.
    const actor = { tenantId: TENANT, principalId: prnOf(key), capabilities: runtime.capabilities,
      conditionallyHeld: runtime.conditionallyHeld, scopedHeld: runtime.scopedHeld, entitlements: runtime.entitlements };
    const snapshot = evaluator.snapshotContextualReader({
      employeeId: experience.employeeId, workEligibility: experience.workEligibility, operationalScopes: experience.operationalScopes });
    for (const row of explained.actions) {
      const d = await composition.authorizeOperationalAction(snapshot, actor, { capabilityKey: row.capabilityKey });
      if (d.allowed) assert.equal(row.result, "ALLOWED", `${key} ${row.capabilityKey}`);
      else if (row.result === "CONDITIONAL") assert.ok(d.denials.some((x) => x.detail === "no record supplied"));
      else if (row.result === "SCOPED") assert.equal(d.outcome, "SCOPE_CONTEXT_REQUIRED", `${key} ${row.capabilityKey}`);
      else assert.deepEqual([row.result, row.reasonCode], ["DENIED", d.outcome], `${key} ${row.capabilityKey}`);
      // Lane SC: every scoped source is the runtime's decision for a record INSIDE that scope.
      for (const src of row.scopedSources) {
        const inside = await composition.authorizeOperationalAction(snapshot, actor, { capabilityKey: row.capabilityKey,
          businessContext: { operatingCompanyId: src.scopeValue } });
        assert.equal(inside.allowed, src.result === "ALLOWED", `${key} ${row.capabilityKey} @ ${src.scopeValue}`);
      }
      assert.deepEqual(row.scopedSources.map((x) => x.roleKey), runtime.scopedHeld.filter((h) => h.capabilityKey === row.capabilityKey).map((h) => h.sourceRole));
      const held = runtime.capabilities.has(row.capabilityKey) || runtime.conditionallyHeld.has(row.capabilityKey);
      // Held <=> a Security Role OR a direct exception grants it globally (lane DX: both are capability sources).
      assert.equal(held, row.sourceRoles.length > 0 || row.directGrant !== null, `${key} ${row.capabilityKey}: sources`);
    }
    return explained;
  };

  await t.test("PARITY: all 21 personas, zero conditions", async () => {
    assert.equal(Object.keys(PERSONAS).length, 21);
    for (const key of Object.keys(PERSONAS)) await assertParity(key);
    const admin = await explainEffectiveAccess(repo, pool, { tenantId: TENANT, principalId: prnOf("administrator") });
    assert.ok(admin.actions.length >= 80, "every catalogued Object action is explained");
    assert.equal(admin.actions.find((a) => a.capabilityKey === "admin.securityPolicy.write").result, "ALLOWED");
    const restricted = await explainEffectiveAccess(repo, pool, { tenantId: TENANT, principalId: prnOf("records-clerk") });
    assert.deepEqual(restricted.capabilities, []);
    assert.ok(restricted.actions.every((a) => a.result === "DENIED" && a.reasonCode === "CAPABILITY_MISSING"));
  });

  await t.test("CONDITIONAL, DIRECT_EXCEPTION and excluded assignments -- and parity still holds", async () => {
    // A condition on technician workOrder.record.read (RECORD_ASSIGNMENT).
    await q(`INSERT INTO eos_policy.capability_grant_conditions (id,tenant_id,grant_scope,grantor_key,capability_key,condition,status,established_by,updated_by)
             VALUES ('gc-x',$1,'ROLE','technician','workOrder.record.read',$2::jsonb,'ACTIVE','fixture','fixture')`,
    [TENANT, JSON.stringify({ paths: [[{ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" }]], recordKind: "workOrder" })]);
    // A direct exception (with reason) and an EXPIRED one, a stale assignment and a scoped assignment.
    await q(`INSERT INTO eos_policy.principal_capabilities (id,tenant_id,principal_id,capability_id,granted_by,created_by,updated_by,exception_reason)
             SELECT 'pc-x',$1,$2,c.id,'fixture','fixture','fixture','covering the parts desk this week' FROM eos_policy.capabilities c WHERE c.key='workOrder.lifecycle.dispatch'`,
    [TENANT, prnOf("service-technician-a")]);
    await q(`INSERT INTO eos_policy.principal_capabilities (id,tenant_id,principal_id,capability_id,granted_by,created_by,updated_by,exception_reason,expires_at)
             SELECT 'pc-expired',$1,$2,c.id,'fixture','fixture','fixture','lapsed cover',now() - interval '1 day' FROM eos_policy.capabilities c WHERE c.key='opportunity.write'`,
    [TENANT, prnOf("service-technician-a")]);
    await assign(prnOf("service-technician-a"), "dispatcher", { stale: true });
    await assign(prnOf("service-technician-a"), "warehouseManager", { scopeType: "WAREHOUSE", scopeValue: "SC-WH-MAIN" });
    // Lane SC: a SUPPORTED scoped assignment -- generalManager @ operatingCompany -- becomes scope-qualified holdings.
    await assign(prnOf("service-technician-a"), "generalManager", { scopeType: "operatingCompany", scopeValue: COMPANY });

    for (const key of Object.keys(PERSONAS)) await assertParity(key);
    const tech = await assertParity("service-technician-a");
    const woRead = tech.actions.find((a) => a.capabilityKey === "workOrder.record.read");
    assert.deepEqual([woRead.result, woRead.reasonCode, woRead.withheldFromFlatSetKernels], ["CONDITIONAL", "RECORD_ASSIGNMENT_REQUIRED", true]);
    assert.deepEqual(woRead.sourceRoles.map((r) => [r.roleKey, r.condition?.recordKind]), [["technician", "workOrder"]]);
    const dispatch = tech.actions.find((a) => a.capabilityKey === "workOrder.lifecycle.dispatch");
    // Lane DX: a direct exception is ENFORCED by the runtime -- the evaluator ALLOWS through the PRINCIPAL grantor.
    assert.deepEqual([dispatch.result, dispatch.reasonCode], ["ALLOWED", "ALLOWED"], "a direct grant is enforced on the runtime");
    assert.deepEqual(dispatch.sourceRoles, [], "no Security Role grants it");
    const { grantedAt, ...directGrant } = dispatch.directGrant;
    assert.ok(typeof grantedAt === "string" && grantedAt.length > 0);
    assert.deepEqual(directGrant, { label: "DIRECT_EXCEPTION", source: "DIRECT_EXCEPTION", exceptionReason: "covering the parts desk this week",
      expiresAt: null, grantedBy: "fixture", condition: null, enforced: true });
    assert.ok(tech.capabilities.includes("workOrder.lifecycle.dispatch"), "an unconditioned direct exception is in the flat set");
    assert.equal(tech.actions.find((a) => a.capabilityKey === "opportunity.write").directGrant, null, "an EXPIRED exception is not shown as held");
    assert.deepEqual(tech.assignments.excluded.map((e) => [e.roleKey, e.reason]).sort(),
      [["dispatcher", "STALE"], ["warehouseManager", "SCOPE_UNSUPPORTED"]]);
    assert.equal(tech.securityRoleKeys.includes("warehouseManager"), false, "a scoped assignment grants nothing unscoped");
    assert.equal(tech.securityRoleKeys.includes("generalManager"), false, "a supported scope is still not a global Role");
    assert.deepEqual(tech.assignments.scoped.map((a) => [a.roleKey, a.scopeType, a.scopeValue, a.capabilities]),
      [["generalManager", "operatingCompany", COMPANY, ["employee.record.read"]]]);
    assert.ok(tech.assignments.scoped[0].inertCapabilities.includes("salesAgreement.accept"), "the rest of the Role is inert at a scope");
    const employeeRead = tech.actions.find((a) => a.capabilityKey === "employee.record.read");
    assert.deepEqual([employeeRead.result, employeeRead.reasonCode, employeeRead.scopedSources.map((x) => [x.roleKey, x.scopeValue, x.result])],
      ["SCOPED", "SCOPE_CONTEXT_REQUIRED", [["generalManager", COMPANY, "ALLOWED"]]]);
    assert.equal(tech.capabilities.includes("employee.record.read"), false, "never in the flat set");
    // Unconditioned holders are unaffected.
    assert.equal((await assertParity("dispatcher")).actions.find((a) => a.capabilityKey === "workOrder.record.read").result, "ALLOWED");
  });

  await t.test("the Admin read: gated by admin.principalAccess.read, tenant-confined, composed evaluator only", async () => {
    const boot = await bootstrapAdministrator(repo, { tenantId: TENANT, externalSubject: "uid-explain-admin", performedBy: "fixture" });
    await q(`INSERT INTO eos_policy.role_capabilities (id,tenant_id,role_id,capability_id,granted_by,created_by,updated_by)
             SELECT 'rc-par', $1, r.id, c.id, 'fixture','fixture','fixture' FROM eos_policy.roles r, eos_policy.capabilities c
              WHERE r.tenant_id=$1 AND r.key='admin' AND c.key='admin.principalAccess.read' ON CONFLICT DO NOTHING`, [TENANT]);
    const deps = { repo, explainEffectiveAccess: (tenantId, principalId) => explainEffectiveAccess(repo, pool, { tenantId, principalId }) };
    const call = (subject, input, d = deps) => executeAdminOperation(d, { caller: { externalSubject: subject }, operation: "explainEffectiveAccess", input });
    const ok = await call("uid-explain-admin", { principalId: prnOf("dispatcher") });
    assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.deepEqual(ok.data.capabilities, (await explainEffectiveAccess(repo, pool, { tenantId: TENANT, principalId: prnOf("dispatcher") })).capabilities);
    const refused = await call(subjectOf("dispatcher"), { principalId: prnOf("administrator") });
    assert.deepEqual([refused.ok, refused.code], [false, "FORBIDDEN"], "no admin.principalAccess.read -> refused before any evaluation");
    const unknown = await call("uid-explain-admin", { principalId: "prn-not-in-this-tenant" });
    assert.deepEqual([unknown.ok, unknown.code], [false, "NOT_FOUND"]);
    const notComposed = await call("uid-explain-admin", { principalId: prnOf("dispatcher") }, { repo });
    assert.deepEqual([notComposed.ok, notComposed.code], [false, "INTERNAL"], "no repository-only fallback evaluator");
    assert.ok(boot.principal.id);
  });
});
