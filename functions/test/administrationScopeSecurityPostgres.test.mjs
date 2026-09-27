// PASS 9 SECURITY REGRESSIONS -- Functional Role (lane FR) x assignment scope, against PostgreSQL.
//
// Source: round4-analysis/pass9-security-review.md. Every PROVED probe owned by the Functional Role lane is a subtest
// here, asserting the FIXED behaviour; each failed at 99398cec (verified red-at-base) and passes after the fix.
//
//   S4  a Principal may not be linked to ITSELF onto an Employee that holds a Functional Role
//   S5  a scoped Role satisfies a workflow binding only for a record inside its scope
//   S6  the Functional Role tables refuse TRUNCATE and a backdated end
//
// S1/S2/S3/S7 test the layer-4 assignment scope runtime and live in assignmentScopeHardeningPostgres.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");
const { bootstrapTenant, bootstrapAdministrator, ensureTenantPrincipal } = require("../lib/adminPolicy/tenantBootstrap.js");
const { executeAdminOperation } = require("../lib/adminPolicy/adminPolicyApi.js");
const capabilityAuthority = require("../lib/eosOps/capabilityAuthority.js");
const composition = require("../lib/eosOps/entitledActionAuthority.js");
const workforce = require("../lib/eosWorkforce/workforceHttp.js");
const { postgresWorkflowFunctionalRoleFacts } = require("../lib/eosOps/functionalRoleFacts.js");
const { postgresContextualReader } = require("../lib/eosOps/contextualAuthorization.js");
const { operationalWorkflowAuthority } = require("../lib/adminPolicy/workflowAuthority.js");
const { createWorkflowDraft } = require("../lib/adminPolicy/workflowCommands.js");
const { publishWorkflowVersion } = require("../lib/adminPolicy/workflowLifecycle.js");
const { startWorkflowInstance, transitionWorkflowInstance } = require("../lib/adminPolicy/workflowInstances.js");

const OP = "operator-pass9";
const R = "a governed reason for the pass 9 regression";
const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) { const c = new pg.Client({ connectionString: url }); await c.connect(); try { return await fn(c); } finally { await c.end(); } }
const refusal = async (fn) => { try { await fn(); return null; } catch (err) { return err.message; } };

test("Pass 9 security regressions: Functional Role x assignment scope (S4/S5/S6)", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `p9sec_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => { await pool?.end(); await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)); });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations", "--no-check-order"],
    { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe" });
  pool = new pg.Pool({ connectionString: dbUrlFor(name), max: 16 });
  const q = (s, v = []) => pool.query(s, v);
  const repo = new PostgresPolicyRepository(pool);
  const { tenant } = await bootstrapTenant(repo, { key: "p9-a", name: "a", actorUid: OP });
  const T = tenant.id;
  await bootstrapAdministrator(repo, { tenantId: T, externalSubject: "admin-a", performedBy: OP, reason: "boot" });
  await q(`INSERT INTO eos_policy.role_capabilities (id,tenant_id,role_id,capability_id,granted_by,created_by,updated_by)
           SELECT 'rc-fx-' || md5($1 || c.id), $1, r.id, c.id, 'fixture','fixture','fixture'
             FROM eos_policy.roles r, eos_policy.capabilities c WHERE r.tenant_id=$1 AND r.key='admin'
              AND c.key IN ('admin.principalAccess.read','audit.event.read')
           ON CONFLICT DO NOTHING`, [T]);
  for (const company of ["taylor", "ventana"]) {
    await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id,operating_company_id,status,source,established_by,updated_by)
             VALUES ($1,$2,'ACTIVE','fixture','fixture','fixture')`, [T, company]);
  }
  const call = (subject, operation, input = {}) => executeAdminOperation({ repo },
    { caller: { externalSubject: subject, identityProvider: "firebase" }, operation, input, requestId: `r-${operation}` });
  const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.data; };
  const roleIdOf = async (key) => (await repo.getRoleByKey(T, key)).id;
  const wf = (subject, operation, input = {}) => workforce.executeWorkforceOperation({ reader: repo, pool },
    { caller: { externalSubject: subject, identityProvider: "firebase", requestedTenantId: null }, operation, input });
  const person = async (subject) => {
    const made = await ensureTenantPrincipal(repo, { tenantId: T, externalSubject: subject, actorUid: OP, actorRoleKeys: ["admin"] });
    return made.principal?.id ?? made.id ?? made.principalId;
  };
  const defineRole = async (key, grants, admin = "admin-a") => {
    ok(await call(admin, "createRole", { key, name: key, reason: R }));
    for (const [objectKey, actionKey] of grants) ok(await call(admin, "grantObjectActionToRole", { objectKey, actionKey, roleKey: key, reason: R }));
  };
  const assign = (subject, principalId, roleId, scopeType, scopeValue) => call(subject, "assignRole",
    { principalId, roleId, reason: R, ...(scopeType ? { scopeType } : {}), ...(scopeValue !== undefined ? { scopeValue } : {}) });
  const context = (subject) => capabilityAuthority.resolveOperationalContext(repo, pool,
    { identityProvider: "firebase", externalSubject: subject, requestedTenantId: null }, composition.postgresGrantConditionProvider(pool));

  for (const [id, company] of [["e-t1", "taylor"], ["e-v1", "ventana"], ["e-hr", "taylor"], ["e-hr2", "taylor"]]) {
    await q(`INSERT INTO eos_workforce.employees (id,tenant_id,employment_status,operating_company_id,employee_number) VALUES ($1,$2,'ACTIVE',$3,$1)`, [id, T, company]);
  }
  const admin2 = await person("admin2-a");
  ok(await assign("admin-a", admin2, await roleIdOf("admin")));

  // ════════════════════ S4 ════════════════════
  await defineRole("hrLead", [["employee", "read"], ["employee", "setFunctionalRole"], ["employee", "edit"]]);
  const hr = await person("hr-a");
  ok(await assign("admin-a", hr, await roleIdOf("hrLead")));
  await t.test("S4: unlink -> assign -> relink-to-self cannot make the actor the holder of a Functional Role", async () => {
    const fr = await wf("hr-a", "createFunctionalRole", { key: "warranty-approver", name: "Warranty approver", reason: R });
    assert.equal(fr.ok, true, JSON.stringify(fr));
    const frId = fr.result.functionalRole.functionalRoleId;
    assert.equal((await wf("hr-a", "linkEmployeePrincipal", { employeeId: "e-hr", linkedPrincipalId: hr, reason: R })).ok, true);
    assert.equal((await wf("hr-a", "assignEmployeeFunctionalRole", { employeeId: "e-hr", functionalRoleId: frId, reason: R })).code, "FUNCTIONAL_ROLE_SELF_ASSIGNMENT");
    assert.equal((await wf("hr-a", "unlinkEmployeePrincipal", { employeeId: "e-hr", expectedCurrentPrincipalId: hr, reason: R })).ok, true);
    assert.equal((await wf("hr-a", "assignEmployeeFunctionalRole", { employeeId: "e-hr", functionalRoleId: frId, reason: R })).ok, true);
    const relink = await wf("hr-a", "linkEmployeePrincipal", { employeeId: "e-hr", linkedPrincipalId: hr, reason: R });
    assert.deepEqual([relink.ok, relink.code], [false, "FUNCTIONAL_ROLE_SELF_LINK"]);
    const facts = await postgresWorkflowFunctionalRoleFacts(pool, T, hr).currentFunctionalRoles();
    assert.equal(facts.functionalRoleIds.includes(frId), false);
    // The same through relink: e-hr2 linked to someone else, given the role, then moved onto the actor.
    const other = await person("other-a");
    assert.equal((await wf("hr-a", "linkEmployeePrincipal", { employeeId: "e-hr2", linkedPrincipalId: other, reason: R })).ok, true);
    assert.equal((await wf("hr-a", "assignEmployeeFunctionalRole", { employeeId: "e-hr2", functionalRoleId: frId, reason: R })).ok, true);
    const move = await wf("hr-a", "relinkEmployeePrincipal", { employeeId: "e-hr2", expectedCurrentPrincipalId: other, newPrincipalId: hr, reason: R });
    assert.deepEqual([move.ok, move.code], [false, "FUNCTIONAL_ROLE_SELF_LINK"]);
    // Another administrator may make that link: the rule is "not yourself".
    const ok2 = await wf("admin2-a", "linkEmployeePrincipal", { employeeId: "e-hr", linkedPrincipalId: hr, reason: R });
    assert.ok(ok2.ok || ok2.code === "CAPABILITY_REQUIRED", JSON.stringify(ok2));
  });

  // ════════════════════ S5 ════════════════════
  await t.test("S5: a scoped Role satisfies a workflow binding ONLY for a record inside its scope", async () => {
    await defineRole("wfAdministrator", [["workflowDefinition", "create"], ["workflowDefinition", "publish"], ["workflowDefinition", "read"]]);
    const wfa = await person("wfadmin-a");
    ok(await assign("admin-a", wfa, await roleIdOf("wfAdministrator")));
    const wfActor = { tenantId: T, uid: wfa, heldRoleKeys: ["wfAdministrator"] };
    await defineRole("globalReader", [["employee", "read"]]);
    await defineRole("companyLead", [["employee", "read"]]);
    const p = await person("wf-a");
    ok(await assign("admin-a", p, await roleIdOf("globalReader")));
    ok(await assign("admin-a", p, await roleIdOf("companyLead"), "operatingCompany", "taylor"));
    if (!(await repo.getObjectByKey(T, "employee"))) {
      await repo.transact({ tenantId: T, uid: OP }, (tx) => tx.createObject({ key: "employee", label: "Employee", labelPlural: null, description: null, origin: "SYSTEM", lifecycle: "ACTIVE", supportsDelete: false }));
    }
    const draft = await createWorkflowDraft(repo, wfActor, { key: "leadReview", name: "Lead review", objectKey: "employee", reason: R, definition: {
      steps: [{ key: "s1", label: "S1", initial: true }, { key: "s2", label: "S2", terminal: true }],
      actions: [{ key: "go", label: "Go", from: "s1", to: "s2", capabilityKey: "employee.record.read", roleKeys: ["companyLead"] }],
    } });
    await publishWorkflowVersion(repo, wfActor, { versionId: draft.version.id, reason: R });
    for (const recordId of ["e-v1", "e-t1"]) await startWorkflowInstance(repo, wfActor, { workflowKey: "leadReview", recordId, reason: R });
    const ctx = await context("wf-a");
    const actor = { tenantId: T, principalId: p, heldRoleKeys: ctx.principalContext.heldRoleKeys,
      scopedRoles: ctx.scopedHeld.map((h) => ({ roleKey: h.sourceRole, scopeType: h.scopeType, scopeValue: h.scopeValue })) };
    const authority = operationalWorkflowAuthority(postgresContextualReader(pool), { tenantId: T, principalId: p, capabilities: ctx.capabilities,
      conditionallyHeld: ctx.conditionallyHeld, scopedHeld: ctx.scopedHeld, entitlements: ctx.entitlements }, "employee");
    const run = (recordId, businessContext) => refusal(() => transitionWorkflowInstance(repo, actor,
      { objectKey: "employee", recordId, actionKey: "go", reason: R }, authority, undefined, businessContext));
    // The capability is held GLOBALLY (globalReader, unbound); the bound Role is taylor-scoped. A ventana record: refused.
    assert.match(await run("e-v1", { operatingCompanyId: "ventana" }) ?? "ALLOWED", /notBoundToRole/);
    // A taylor record: the scoped binding counts.
    assert.equal(await run("e-t1", { operatingCompanyId: "taylor" }), null);
  });

  // ════════════════════ S6 ════════════════════
  await t.test("S6: the Functional Role tables refuse TRUNCATE", async () => {
    for (const table of ["eos_workforce.employee_functional_role_assignments", "eos_workforce.functional_roles"]) {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        const msg = await refusal(() => c.query(`TRUNCATE ${table} CASCADE`));
        await c.query("ROLLBACK");
        assert.match(msg ?? "TRUNCATE ACCEPTED", /FUNCTIONAL_ROLE_HISTORY_IMMUTABLE/, table);
      } finally { c.release(); }
    }
  });

  await t.test("S6: the end may not backdate ended_at nor effective_to; cancelling a future period still works", async () => {
    const frId = (await q(`SELECT id FROM eos_workforce.functional_roles WHERE tenant_id=$1 LIMIT 1`, [T])).rows[0].id;
    // A period that started long ago: its end may be recorded only as of now.
    await q(`INSERT INTO eos_workforce.employee_functional_role_assignments (id,tenant_id,employee_id,functional_role_id,effective_from,assigned_by,reason)
             VALUES ('efr-old',$1,'e-v1',$2,'2026-01-01T00:00:00Z','fx','fixture')`, [T, frId]);
    const row = { id: "efr-old" };
    assert.match(await refusal(() => q(`UPDATE eos_workforce.employee_functional_role_assignments
      SET effective_to = now(), ended_by='x', ended_at = now() - interval '10 years', end_reason='x' WHERE id=$1`, [row.id])) ?? "ACCEPTED", /FUNCTIONAL_ROLE_END_BACKDATED/);
    assert.match(await refusal(() => q(`UPDATE eos_workforce.employee_functional_role_assignments
      SET effective_to = effective_from, ended_by='x', ended_at = now(), end_reason='x' WHERE id=$1`, [row.id])) ?? "ACCEPTED", /FUNCTIONAL_ROLE_END_BACKDATED/);
    await q(`INSERT INTO eos_workforce.employee_functional_role_assignments (id,tenant_id,employee_id,functional_role_id,effective_from,assigned_by,reason)
             VALUES ('efr-future',$1,'e-t1',$2, now() + interval '3 days','fx','fixture')`, [T, frId]);
    await q(`UPDATE eos_workforce.employee_functional_role_assignments SET effective_to = effective_from, ended_by='x', ended_at=now(), end_reason='cancel' WHERE id='efr-future'`);
  });
});
