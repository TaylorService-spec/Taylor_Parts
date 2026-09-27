// SECURITY ROLE ASSIGNMENT SCOPE -- the runtime, end to end, against PostgreSQL (lane SC).
//
// Effective authority = Principal -> Security Role assignment -> capability -> ASSIGNMENT SCOPE -> record business
// context -> record relationship -> domain preconditions. A scoped assignment NEVER behaves as global.
//
// Acceptance:
//   E  a Company-scoped Role cannot read an Employee outside its operating company (single read, list, managed list)
//   F  a Business-Unit scope cannot be configured (no PostgreSQL consumer) and, written behind Administration's back,
//      grants nothing anywhere -- so nothing outside (or inside) a business unit is reachable through it
//   G  a GLOBAL Role keeps global reach, byte-identical, and a principal holding the key BOTH ways keeps global reach
//   H  missing business context, an unsupported scope type, a missing value and a read that does not decide scope
//      all FAIL CLOSED
// plus: Administration refuses every configuration the runtime would ignore; governed values are TENANT-scoped;
// concurrency of scope change (assign/revoke vs evaluate; the record's company changing vs a read); no scope-to-global
// widening (flat set, capability read, admin holders); explainEffectiveAccess shows the scope and is the runtime's answer.
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
const { bootstrapTenant, bootstrapAdministrator, ensureTenantPrincipal } = require("../lib/adminPolicy/tenantBootstrap.js");
const { executeAdminOperation } = require("../lib/adminPolicy/adminPolicyApi.js");
const capabilityAuthority = require("../lib/eosOps/capabilityAuthority.js");
const composition = require("../lib/eosOps/entitledActionAuthority.js");
const evaluator = require("../lib/eosOps/contextualAuthorization.js");
const { explainEffectiveAccess } = require("../lib/eosOps/effectiveAccessExplanation.js");
const workforce = require("../lib/eosWorkforce/workforceHttp.js");

const OP = "operator-scope";
const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

test("Security Role assignment scope: governed runtime, fail closed, never global", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `scope_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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
  const q = (s, v = []) => pool.query(s, v);
  const repo = new PostgresPolicyRepository(pool);

  // ── two tenants; each bootstrapped; tenant A operates taylor + ventana (+ an INACTIVE company), B operates northco ──
  const T = {};
  const COMPANIES = { a: [["taylor", "ACTIVE"], ["ventana", "ACTIVE"], ["oldco", "INACTIVE"]], b: [["northco", "ACTIVE"]] };
  for (const key of ["a", "b"]) {
    const { tenant } = await bootstrapTenant(repo, { key: `scope-${key}`, name: key, actorUid: OP });
    T[key] = tenant.id;
    await bootstrapAdministrator(repo, { tenantId: tenant.id, externalSubject: `admin-${key}`, performedBy: OP, reason: "boot" });
    for (const cap of ["admin.securityPolicy.read", "admin.principalAccess.read", "audit.event.read"]) {
      await q(`INSERT INTO eos_policy.role_capabilities (id,tenant_id,role_id,capability_id,granted_by,created_by,updated_by)
               SELECT 'rc-fx-' || md5($1 || c.id), $1, r.id, c.id, 'fixture','fixture','fixture'
                 FROM eos_policy.roles r, eos_policy.capabilities c WHERE r.tenant_id=$1 AND r.key='admin' AND c.key=$2
               ON CONFLICT DO NOTHING`, [tenant.id, cap]);
    }
    for (const [company, status] of COMPANIES[key]) {
      await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id,operating_company_id,status,source,established_by,updated_by)
               VALUES ($1,$2,$3,'fixture','fixture','fixture')`, [tenant.id, company, status]);
    }
  }
  const call = (subject, operation, input) => executeAdminOperation({ repo },
    { caller: { externalSubject: subject, identityProvider: "firebase" }, operation, input, requestId: `r-${operation}` });
  const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.data; };
  const roleIdOf = async (tenant, key) => (await repo.getRoleByKey(tenant, key)).id;
  const inputOf = (subject) => ({ identityProvider: "firebase", externalSubject: subject, requestedTenantId: null });
  const context = (subject) => capabilityAuthority.resolveOperationalContext(repo, pool, inputOf(subject), composition.postgresGrantConditionProvider(pool));
  const wf = (subject, operation, input = {}) => workforce.executeWorkforceOperation({ reader: repo, pool },
    { caller: { externalSubject: subject, identityProvider: "firebase", requestedTenantId: null }, operation, input });
  const person = async (tenant, subject) => {
    const made = await ensureTenantPrincipal(repo, { tenantId: tenant, externalSubject: subject, actorUid: OP, actorRoleKeys: ["admin"] });
    return made.principal?.id ?? made.id ?? made.principalId;
  };

  // ── Security Roles, configured through the governed Administration commands (no raw grants) ──
  const defineRole = async (tenantKey, key, grants) => {
    const admin = `admin-${tenantKey}`;
    ok(await call(admin, "createRole", { key, name: key, reason: "scope fixture" }));
    for (const [objectKey, actionKey] of grants) {
      ok(await call(admin, "grantObjectActionToRole", { objectKey, actionKey, roleKey: key, reason: "scope fixture" }));
    }
  };
  await defineRole("a", "companyStaffReader", [["employee", "read"], ["account", "read"]]);  // account read is INERT at a scope
  await defineRole("a", "staffReader", [["employee", "read"]]);
  await defineRole("a", "customerOnly", [["account", "read"]]);
  await defineRole("b", "companyStaffReader", [["employee", "read"]]);

  // ── Employees: A has two taylor and two ventana; B one northco; reporting lines across companies ──
  const employees = [["e-t1", "a", "taylor"], ["e-t2", "a", "taylor"], ["e-v1", "a", "ventana"], ["e-v2", "a", "ventana"], ["e-n1", "b", "northco"]];
  for (const [id, tk, company] of employees) {
    await q(`INSERT INTO eos_workforce.employees (id,tenant_id,employment_status,operating_company_id,employee_number) VALUES ($1,$2,'ACTIVE',$3,$1)`, [id, T[tk], company]);
  }
  for (const [employee, manager] of [["e-t2", "e-t1"], ["e-v1", "e-t1"], ["e-v2", "e-v1"]]) {
    await q(`INSERT INTO eos_workforce.employee_reporting_relationships (id,tenant_id,employee_id,manager_employee_id,effective_from,established_by,source)
             VALUES ($1,$2,$3,$4,now(),'fixture','GOVERNED_COMMAND')`, [`rr-${employee}`, T.a, employee, manager]);
  }

  const scoped = await person(T.a, "scoped-a");      // companyStaffReader @ operatingCompany=taylor
  const global = await person(T.a, "global-a");      // staffReader, global
  const both = await person(T.a, "both-a");          // staffReader global AND companyStaffReader @ taylor
  const bystander = await person(T.a, "bystander-a");
  const scopedB = await person(T.b, "scoped-b");

  const assign = (subject, principalId, roleId, scopeType, scopeValue) => call(subject, "assignRole",
    { principalId, roleId, reason: "scope staffing", ...(scopeType ? { scopeType } : {}), ...(scopeValue !== undefined ? { scopeValue } : {}) });

  // ════════════════════ ADMIN WRITES: no configuration the runtime ignores ════════════════════
  await t.test("assignRole: a supported scope with a governed value is stored and audited; everything the runtime would ignore is refused", async () => {
    const reader = await roleIdOf(T.a, "companyStaffReader");
    const assigned = ok(await assign("admin-a", scoped, reader, "operatingCompany", "taylor"));
    assert.deepEqual([assigned.scopeType, assigned.scopeValue, assigned.status], ["operatingCompany", "taylor", "active"]);
    const audit = (await q(`SELECT after FROM eos_policy.audit_events WHERE tenant_id=$1 AND action='assignRole' AND target_id=$2`, [T.a, assigned.id])).rows;
    assert.equal(audit.length, 1);
    assert.deepEqual([audit[0].after.scopeType, audit[0].after.scopeValue], ["operatingCompany", "taylor"]);
    // Idempotent: the same Role at the same scope is the same assignment (no second row, no second audit event).
    assert.equal(ok(await assign("admin-a", scoped, reader, "operatingCompany", "taylor")).id, assigned.id);

    ok(await assign("admin-a", global, await roleIdOf(T.a, "staffReader")));
    ok(await assign("admin-a", both, await roleIdOf(T.a, "staffReader")));
    ok(await assign("admin-a", both, reader, "operatingCompany", "taylor"));

    const refused = async (input, code) => {
      const r = await call("admin-a", "assignRole", { principalId: bystander, reason: "should refuse", ...input });
      assert.deepEqual([r.ok, r.code], [false, "INVALID_INPUT"], JSON.stringify(r));
      assert.match(r.message, new RegExp(code));
    };
    // (H) unsupported / unconsumed / unknown scope types
    for (const scopeType of ["businessUnit", "location", "domain", "tenant", "ownAssignment", "salesChannel", "WAREHOUSE"]) {
      await refused({ roleId: reader, scopeType, scopeValue: "SERVICE" }, "SCOPE_TYPE_UNSUPPORTED");
    }
    // missing / malformed value; a global assignment carrying a value
    await refused({ roleId: reader, scopeType: "operatingCompany" }, "SCOPE_VALUE_INVALID");
    await refused({ roleId: reader, scopeType: "operatingCompany", scopeValue: "Taylor" }, "SCOPE_VALUE_INVALID");
    await refused({ roleId: reader, scopeType: "global", scopeValue: "taylor" }, "SCOPE_VALUE_INVALID");
    // tenant isolation of scope VALUES: B's company, an INACTIVE company, an unknown company
    await refused({ roleId: reader, scopeType: "operatingCompany", scopeValue: "northco" }, "SCOPE_VALUE_INVALID");
    await refused({ roleId: reader, scopeType: "operatingCompany", scopeValue: "oldco" }, "SCOPE_VALUE_INVALID");
    await refused({ roleId: reader, scopeType: "operatingCompany", scopeValue: "nobody" }, "SCOPE_VALUE_INVALID");
    // a Role with nothing evaluable at the scope would be a grant of nothing
    await refused({ roleId: await roleIdOf(T.a, "customerOnly"), scopeType: "operatingCompany", scopeValue: "taylor" }, "SCOPE_NOT_EVALUABLE_FOR_ROLE");
    // Administration authority is tenant-wide: a Role carrying admin.* can never be scoped
    for (const key of ["admin", "owner"]) {
      await refused({ roleId: await roleIdOf(T.a, key), scopeType: "operatingCompany", scopeValue: "taylor" }, "SCOPE_AMBIGUOUS_ADMINISTRATION");
    }
    const rows = (await q(`SELECT count(*)::int n FROM eos_policy.user_role_assignments WHERE tenant_id=$1 AND principal_id=$2`, [T.a, bystander])).rows[0].n;
    assert.equal(rows, 0, "a refused scoped assignment left a row");
    // B's administrator assigns B's company; A's value is not B's.
    ok(await assign("admin-b", scopedB, await roleIdOf(T.b, "companyStaffReader"), "operatingCompany", "northco"));
    const cross = await assign("admin-b", scopedB, await roleIdOf(T.b, "companyStaffReader"), "operatingCompany", "taylor");
    assert.deepEqual([cross.ok, cross.code], [false, "INVALID_INPUT"]);
  });

  await t.test("listSupportedAssignmentScopes: the enforced vocabulary, this tenant's values, per-Role assignability", async () => {
    const data = ok(await call("admin-a", "listSupportedAssignmentScopes", {}));
    const byType = Object.fromEntries(data.scopeTypes.map((s) => [s.scopeType, s]));
    assert.deepEqual(byType.operatingCompany.values.map((v) => v.value), ["taylor", "ventana"], "ACTIVE, this tenant only");
    assert.deepEqual([byType.operatingCompany.supported, byType.operatingCompany.label, byType.operatingCompany.contextKey],
      [true, "Company", "operatingCompanyId"]);
    assert.deepEqual(byType.operatingCompany.capabilities.map((c) => c.capabilityKey), ["employee.record.read"]);
    for (const type of ["businessUnit", "location", "domain", "tenant", "ownAssignment"]) {
      assert.equal(byType[type].supported, false, type);
      assert.ok(byType[type].reason, `${type} is listed WITH its reason`);
      assert.deepEqual(byType[type].values, []);
    }
    const role = (key) => data.roles.find((r) => r.roleKey === key).assignableScopes.find((s) => s.scopeType === "operatingCompany");
    assert.deepEqual([role("companyStaffReader").assignable, role("companyStaffReader").scopedCapabilities, role("companyStaffReader").inertCapabilities],
      [true, ["employee.record.read"], ["customer.record.read"]]);
    assert.deepEqual([role("customerOnly").assignable, role("customerOnly").refusal], [false, "SCOPE_NOT_EVALUABLE_FOR_ROLE"]);
    assert.deepEqual([role("admin").assignable, role("admin").refusal], [false, "SCOPE_AMBIGUOUS_ADMINISTRATION"]);
    const one = ok(await call("admin-a", "listSupportedAssignmentScopes", { roleKey: "staffReader" }));
    assert.deepEqual(one.roles.map((r) => r.roleKey), ["staffReader"]);
    const b = ok(await call("admin-b", "listSupportedAssignmentScopes", {}));
    assert.deepEqual(b.scopeTypes.find((s) => s.scopeType === "operatingCompany").values.map((v) => v.value), ["northco"]);
    // Gate: admin.principalAccess.read.
    assert.equal((await call("scoped-a", "listSupportedAssignmentScopes", {})).code, "FORBIDDEN");
  });

  // ════════════════════ THE RUNTIME ════════════════════
  await t.test("no scope-to-global widening: the scoped key is never in the flat set; it is a scope-qualified holding", async () => {
    const ctx = await context("scoped-a");
    assert.deepEqual(ctx.principalContext.heldRoleKeys, [], "a scoped Role is not a held (global) Role");
    assert.equal(ctx.capabilities.has("employee.record.read"), false);
    assert.equal(ctx.conditionallyHeld.has("employee.record.read"), false);
    assert.deepEqual(ctx.scopedHeld.map((h) => [h.capabilityKey, h.scopeType, h.scopeValue, h.sourceRole, h.condition]),
      [["employee.record.read", "operatingCompany", "taylor", "companyStaffReader", null]]);
    assert.deepEqual(ctx.inertScoped.map((i) => [i.capabilityKey, i.reason]), [["customer.record.read", "SCOPE_NOT_EVALUABLE_FOR_CAPABILITY"]]);
    // The capability read (flat) does not list it; the scoped Role's inert capability grants nothing anywhere.
    const mine = await workforce.executeWorkforceOperation({ reader: repo, pool },
      { caller: { externalSubject: "scoped-a", identityProvider: "firebase", requestedTenantId: null }, operation: "readMyWorkforceCapabilities", input: {} });
    assert.equal(mine.ok, true);
    assert.equal(mine.result.capabilities.includes("employee.record.read"), false);
    const actor = { tenantId: T.a, principalId: scoped, capabilities: ctx.capabilities, conditionallyHeld: ctx.conditionallyHeld,
      scopedHeld: ctx.scopedHeld, entitlements: ctx.entitlements };
    const snap = evaluator.snapshotContextualReader({ employeeId: null, workEligibility: [], operationalScopes: [] });
    const d = (capabilityKey, businessContext) => composition.authorizeOperationalAction(snap, actor, { capabilityKey, businessContext });
    assert.deepEqual([(await d("employee.record.read")).outcome], ["SCOPE_CONTEXT_REQUIRED"], "(H) no context -> refused");
    assert.deepEqual([(await d("employee.record.read", { operatingCompanyId: "ventana" })).outcome], ["OUTSIDE_ASSIGNMENT_SCOPE"]);
    assert.deepEqual([(await d("employee.record.read", { businessUnit: "SERVICE" })).outcome], ["SCOPE_CONTEXT_REQUIRED"], "(H) wrong context kind");
    const inScope = await d("employee.record.read", { operatingCompanyId: "taylor" });
    assert.deepEqual([inScope.allowed, inScope.viaGrantor, inScope.viaScope], [true, { kind: "ROLE", roleKey: "companyStaffReader" },
      { scopeType: "operatingCompany", scopeValue: "taylor" }]);
    assert.equal((await d("customer.record.read", { operatingCompanyId: "taylor" })).outcome, "CAPABILITY_MISSING", "inert at a scope");
    // Anti-lockout counts GLOBAL holders only: scoped assignments never count, and cannot exist for admin Roles.
    const holders = await repo.transact({ tenantId: T.a, uid: OP }, (tx) => tx.administrationHolderCount("admin.securityPolicy.write", {}));
    assert.equal(holders, 1);
  });

  await t.test("E: a Company-scoped Role cannot read outside its operating company", async () => {
    const one = await wf("scoped-a", "readEmployee", { employeeId: "e-t1" });
    assert.equal(one.ok, true, JSON.stringify(one));
    assert.equal(one.result.operatingCompanyId, "taylor");
    const outside = await wf("scoped-a", "readEmployee", { employeeId: "e-v1" });
    // Pass 9 S7: refused EXACTLY like a missing id -- no cross-company existence oracle.
    assert.deepEqual([outside.ok, outside.code, outside.status], [false, "EMPLOYEE_NOT_FOUND", 404]);
    const missing = await wf("scoped-a", "readEmployee", { employeeId: "e-does-not-exist" });
    assert.deepEqual([missing.code, missing.status, missing.message], [outside.code, outside.status, outside.message]);
    const list = await wf("scoped-a", "listEmployees", {});
    assert.equal(list.ok, true, JSON.stringify(list));
    assert.deepEqual(list.result.items.map((i) => i.employeeId), ["e-t1", "e-t2"], "the list is filtered to taylor");
    // Paging inside the scope never leaves it, whatever cursor is carried.
    const page1 = await wf("scoped-a", "listEmployees", { limit: 1 });
    const page2 = await wf("scoped-a", "listEmployees", { limit: 1, cursor: page1.result.nextCursor });
    assert.deepEqual([page1.result.items.map((i) => i.employeeId), page2.result.items.map((i) => i.employeeId), page2.result.nextCursor],
      [["e-t1"], ["e-t2"], null]);
    const managed = await wf("scoped-a", "listManagedEmployees", { managerEmployeeId: "e-t1" });
    assert.deepEqual(managed.result.items.map((i) => i.employeeId), ["e-t2"], "the ventana report is not visible");
    const foreignManager = await wf("scoped-a", "listManagedEmployees", { managerEmployeeId: "e-v1" });
    assert.deepEqual([foreignManager.ok, foreignManager.code], [false, "EMPLOYEE_NOT_FOUND"]);
    // Another tenant's Employee is simply not there.
    assert.equal((await wf("scoped-a", "readEmployee", { employeeId: "e-n1" })).code, "EMPLOYEE_NOT_FOUND");
    // B's scoped reader sees B's company only.
    assert.deepEqual((await wf("scoped-b", "listEmployees", {})).result.items.map((i) => i.employeeId), ["e-n1"]);
  });

  await t.test("H: every read that does not decide scope refuses a scoped-only holder exactly as before", async () => {
    for (const [operation, input] of [["listEmployeeWorkEligibility", { employeeId: "e-t1" }], ["listEmployeeChangeHistory", { employeeId: "e-t1" }],
      ["listJobRoles", {}], ["listEmployeeOperationalScopes", { employeeId: "e-t1" }]]) {
      const r = await wf("scoped-a", operation, input);
      assert.deepEqual([r.ok, r.code], [false, "CAPABILITY_REQUIRED"], `${operation}: ${JSON.stringify(r)}`);
    }
    // A scoped assignment of an unconsumed type written BEHIND Administration's back grants nothing.
    const raw = await person(T.a, "raw-a");
    for (const [scopeType, scopeValue] of [["domain", "inventory"], ["location", "SC-WH-MAIN"], ["tenant", T.a], ["operatingCompany", null]]) {
      await repo.transact({ tenantId: T.a, uid: OP }, async (tx) => {
        const v = await tx.bumpAccessVersion(raw);
        return tx.createAssignment({ principalId: raw, roleId: await roleIdOf(T.a, "staffReader"), scopeType, scopeValue, status: "active",
          grantedBy: "raw", grantedAt: new Date().toISOString(), accessVersionAtGrant: v });
      });
    }
    const ctx = await context("raw-a");
    assert.deepEqual([ctx.capabilities.size, ctx.scopedHeld.length], [0, 0]);
    assert.ok(ctx.inertScoped.every((i) => i.reason === "SCOPE_TYPE_UNSUPPORTED"));
    assert.equal((await wf("raw-a", "readEmployee", { employeeId: "e-t1" })).code, "CAPABILITY_REQUIRED");
    assert.equal((await wf("raw-a", "listEmployees", {})).code, "CAPABILITY_REQUIRED");
    const explained = await explainEffectiveAccess(repo, pool, { tenantId: T.a, principalId: raw });
    assert.deepEqual(explained.assignments.scoped, []);
    assert.deepEqual(explained.assignments.excluded.map((e) => [e.roleKey, e.reason, e.scopeType]).sort(),
      [["staffReader", "SCOPE_UNSUPPORTED", "domain"], ["staffReader", "SCOPE_UNSUPPORTED", "location"],
        ["staffReader", "SCOPE_UNSUPPORTED", "operatingCompany"], ["staffReader", "SCOPE_UNSUPPORTED", "tenant"]]);
  });

  await t.test("F: a Business-Unit scope has no runtime consumer -- refused by Administration, inert if forced", async () => {
    const rawBu = await person(T.a, "bu-a");
    const refusedBu = await assign("admin-a", rawBu, await roleIdOf(T.a, "companyStaffReader"), "businessUnit", "SERVICE");
    assert.deepEqual([refusedBu.ok, refusedBu.code], [false, "INVALID_INPUT"]);
    assert.match(refusedBu.message, /SCOPE_TYPE_UNSUPPORTED/);
    await repo.transact({ tenantId: T.a, uid: OP }, async (tx) => {
      const v = await tx.bumpAccessVersion(rawBu);
      return tx.createAssignment({ principalId: rawBu, roleId: await roleIdOf(T.a, "companyStaffReader"), scopeType: "businessUnit",
        scopeValue: "SERVICE", status: "active", grantedBy: "raw", grantedAt: new Date().toISOString(), accessVersionAtGrant: v });
    });
    const ctx = await context("bu-a");
    assert.deepEqual([ctx.capabilities.size, ctx.scopedHeld.length], [0, 0], "no holding: nothing is reachable in ANY business unit");
    const actor = { tenantId: T.a, principalId: rawBu, capabilities: ctx.capabilities, scopedHeld: ctx.scopedHeld, entitlements: ctx.entitlements };
    const snap = evaluator.snapshotContextualReader({ employeeId: null, workEligibility: [], operationalScopes: [] });
    for (const businessUnit of ["SERVICE", "PARTS"]) {
      assert.equal((await composition.authorizeOperationalAction(snap, actor, { capabilityKey: "employee.record.read", businessContext: { businessUnit } })).outcome,
        "CAPABILITY_MISSING");
    }
    assert.equal((await wf("bu-a", "readEmployee", { employeeId: "e-t1" })).code, "CAPABILITY_REQUIRED");
  });

  await t.test("G: a GLOBAL Role keeps global reach; holding the key both ways never narrows it", async () => {
    const ctx = await context("global-a");
    assert.deepEqual([ctx.scopedHeld.length, ctx.capabilities.has("employee.record.read")], [0, true]);
    assert.deepEqual((await wf("global-a", "listEmployees", {})).result.items.map((i) => i.employeeId), ["e-t1", "e-t2", "e-v1", "e-v2"]);
    for (const employeeId of ["e-t1", "e-v1"]) assert.equal((await wf("global-a", "readEmployee", { employeeId })).ok, true);
    assert.deepEqual((await wf("global-a", "listManagedEmployees", { managerEmployeeId: "e-t1" })).result.items.map((i) => i.employeeId), ["e-t2", "e-v1"]);
    // BOTH: global + scoped for the same key -> global reach, the scope adds nothing and removes nothing.
    assert.deepEqual((await wf("both-a", "listEmployees", {})).result.items.map((i) => i.employeeId), ["e-t1", "e-t2", "e-v1", "e-v2"]);
    assert.equal((await wf("both-a", "readEmployee", { employeeId: "e-v2" })).ok, true);
    // Global behaviour unchanged: the global decision is taken before any scope and supplying context changes nothing.
    const g = await context("global-a");
    const actor = { tenantId: T.a, principalId: global, capabilities: g.capabilities, conditionallyHeld: g.conditionallyHeld, scopedHeld: g.scopedHeld, entitlements: g.entitlements };
    const snap = evaluator.snapshotContextualReader({ employeeId: null, workEligibility: [], operationalScopes: [] });
    for (const businessContext of [undefined, { operatingCompanyId: "ventana" }, { operatingCompanyId: "nowhere" }]) {
      const d = await composition.authorizeOperationalAction(snap, actor, { capabilityKey: "employee.record.read", businessContext });
      assert.deepEqual([d.allowed, d.outcome, d.contextEvaluated, "viaScope" in d], [true, "ALLOWED", false, false]);
    }
  });

  await t.test("explainEffectiveAccess: Granted by <Role>, Capability, Scope, Condition -- and it is the runtime's answer", async () => {
    const explained = await explainEffectiveAccess(repo, pool, { tenantId: T.a, principalId: scoped });
    const ctx = await context("scoped-a");
    assert.deepEqual(explained.capabilities, [...ctx.capabilities].sort());
    assert.deepEqual(explained.scopedHeld, [{ capabilityKey: "employee.record.read", scopeType: "operatingCompany", scopeValue: "taylor",
      sourceRole: "companyStaffReader", conditioned: false }]);
    assert.deepEqual(explained.assignments.excluded, [], "a supported scoped assignment is no longer an exclusion");
    assert.deepEqual(explained.assignments.scoped.map((a) => [a.roleKey, a.scopeType, a.scopeValue, a.capabilities, a.inertCapabilities]),
      [["companyStaffReader", "operatingCompany", "taylor", ["employee.record.read"], ["customer.record.read"]]]);
    const row = explained.actions.find((a) => a.capabilityKey === "employee.record.read");
    assert.deepEqual([row.result, row.reasonCode, row.sourceRoles], ["SCOPED", "SCOPE_CONTEXT_REQUIRED", []]);
    assert.deepEqual(row.scopedSources, [{ roleKey: "companyStaffReader", scopeType: "operatingCompany", scopeValue: "taylor",
      condition: null, result: "ALLOWED", reasonCode: "ALLOWED" }]);
    const inert = explained.actions.find((a) => a.capabilityKey === "customer.record.read");
    assert.deepEqual([inert.result, inert.reasonCode, inert.scopedSources], ["DENIED", "CAPABILITY_MISSING", []]);
    // Parity: every row equals the runtime evaluator's decision over the runtime context; each scoped source equals the
    // runtime's decision for a record inside that scope.
    const actor = { tenantId: T.a, principalId: scoped, capabilities: ctx.capabilities, conditionallyHeld: ctx.conditionallyHeld,
      scopedHeld: ctx.scopedHeld, entitlements: ctx.entitlements };
    const snap = evaluator.snapshotContextualReader({ employeeId: null, workEligibility: [], operationalScopes: [] });
    for (const a of explained.actions) {
      const d = await composition.authorizeOperationalAction(snap, actor, { capabilityKey: a.capabilityKey });
      if (a.result === "SCOPED") assert.equal(d.outcome, "SCOPE_CONTEXT_REQUIRED");
      else if (a.result === "ALLOWED") assert.equal(d.allowed, true);
      else assert.equal(a.reasonCode, d.outcome, a.capabilityKey);
      for (const s of a.scopedSources) {
        const inside = await composition.authorizeOperationalAction(snap, actor, { capabilityKey: a.capabilityKey, businessContext: { operatingCompanyId: s.scopeValue } });
        assert.equal(inside.allowed, s.result === "ALLOWED");
      }
    }
    // The Admin read serves the same payload.
    const deps = { repo, explainEffectiveAccess: (tenantId, principalId) => explainEffectiveAccess(repo, pool, { tenantId, principalId }) };
    const served = await executeAdminOperation(deps, { caller: { externalSubject: "admin-a" }, operation: "explainEffectiveAccess", input: { principalId: scoped } });
    assert.equal(served.ok, true);
    assert.deepEqual(served.data.scopedHeld, explained.scopedHeld);
    // A global principal's explanation carries no scope at all.
    const g = await explainEffectiveAccess(repo, pool, { tenantId: T.a, principalId: global });
    assert.deepEqual([g.scopedHeld, g.assignments.scoped], [[], []]);
    assert.ok(g.actions.every((a) => a.scopedSources.length === 0));
  });

  // ════════════════════ CONCURRENCY ════════════════════
  await t.test("concurrency: revoke / re-assign a scoped assignment while reads evaluate -- every answer is one side or the other", async () => {
    const reader = await roleIdOf(T.a, "companyStaffReader");
    for (let round = 0; round < 8; round += 1) {
      const current = (await repo.listAssignmentsForPrincipal(T.a, scoped)).find((a) => a.status === "active" && a.roleId === reader);
      assert.ok(current, `round ${round}: an active scoped assignment`);
      const results = await Promise.all([
        call("admin-a", "revokeRole", { assignmentId: current.id, reason: "race" }),
        wf("scoped-a", "readEmployee", { employeeId: "e-t1" }),
        wf("scoped-a", "listEmployees", {}),
        wf("scoped-a", "readEmployee", { employeeId: "e-v1" }),
      ]);
      assert.equal(results[0].ok, true, JSON.stringify(results[0]));
      // Before the revoke: allowed (in scope). After: refused CAPABILITY_REQUIRED. Never anything else, never wider.
      assert.ok(results[1].ok || results[1].code === "CAPABILITY_REQUIRED", JSON.stringify(results[1]));
      if (results[2].ok) assert.deepEqual(results[2].result.items.map((i) => i.employeeId), ["e-t1", "e-t2"]);
      else assert.equal(results[2].code, "CAPABILITY_REQUIRED");
      assert.ok(["EMPLOYEE_NOT_FOUND", "CAPABILITY_REQUIRED"].includes(results[3].code), JSON.stringify(results[3]));
      // After the revoke has committed, nothing is reachable.
      assert.equal((await wf("scoped-a", "readEmployee", { employeeId: "e-t1" })).code, "CAPABILITY_REQUIRED");
      // Two concurrent identical scoped assignments: exactly one active row.
      const [x, y] = await Promise.all([assign("admin-a", scoped, reader, "operatingCompany", "taylor"), assign("admin-a", scoped, reader, "operatingCompany", "taylor")]);
      assert.equal(ok(x).id, ok(y).id);
      const active = (await repo.listAssignmentsForPrincipal(T.a, scoped)).filter((a) => a.status === "active" && a.roleId === reader);
      assert.equal(active.length, 1);
    }
  });

  await t.test("concurrency: the record's operating company changing under a read never leaks an out-of-scope row", async () => {
    let flips = 0;
    const flipper = (async () => {
      for (let i = 0; i < 30; i += 1) {
        await q(`UPDATE eos_workforce.employees SET operating_company_id = CASE operating_company_id WHEN 'taylor' THEN 'ventana' ELSE 'taylor' END
                  WHERE tenant_id=$1 AND id='e-t2'`, [T.a]);
        flips += 1;
      }
    })();
    const reads = [];
    for (let i = 0; i < 30; i += 1) reads.push(wf("scoped-a", "readEmployee", { employeeId: "e-t2" }), wf("scoped-a", "listEmployees", {}));
    const results = await Promise.all(reads);
    await flipper;
    assert.equal(flips, 30);
    for (const r of results) {
      if (!r.ok) { assert.equal(r.code, "EMPLOYEE_NOT_FOUND", JSON.stringify(r)); continue; }
      const items = Array.isArray(r.result.items) ? r.result.items : [r.result];
      for (const item of items) {
        assert.equal(item.operatingCompanyId, "taylor", `an out-of-scope row leaked: ${JSON.stringify(item)}`);
      }
    }
    await q(`UPDATE eos_workforce.employees SET operating_company_id='taylor' WHERE tenant_id=$1 AND id='e-t2'`, [T.a]);
  });
});
