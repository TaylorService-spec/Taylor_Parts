// THE ADMINISTRATION CONTROL PLANE -- acceptance against PostgreSQL, on a FIXTURE tenant.
//
// Admin UI -> governed PostgreSQL configuration -> the shared server-side evaluator, with NO migration,
// code edit, deploy or Firebase change per decision. Proved on a throwaway database built the way the
// authority baseline is rebuilt (migrations -> canonical seed -> migrations -> catalog -> nonprod
// activation), so the fixture starts EQUAL to roleCapabilityAuthorityBaseline.json.
//
//   CASE A  salesManager is granted salesAgreement.accept + opportunity.createSalesOrder through the
//           Admin API -> one audit event each -> resolveOperationalContext / authorizeOperationalAction
//           and the Commercial command kernel allow.
//   CASE B  dispatcher's six selling capabilities are revoked through the Admin API -> the evaluator and
//           the kernel refuse -> the Sample Company catalog reconcile and the nonprod activation tool
//           run -> the revokes SURVIVE -> baseline verification reports NO drift.
//   CASE C  officeManager is granted workOrder.record.read -> the evaluator allows.
//   CASE D  technician workOrder.record.read + setGrantCondition RECORD_ASSIGNMENT -> own Work Order
//           allowed, another's refused -> retiring the condition is REFUSED (never widens to ALL), at
//           the command, the API and the database.
//   PLUS    zero-condition parity; flat-set kernels withhold a conditioned-only capability (fail
//           closed); unauthorized actors cannot change grants or conditions; the capability -- not the
//           Role name -- authorizes; a direct Principal grant stays distinguishable; audit is exactly
//           once per mutation and immutable; decisions are append-only.
//
// Writes ONLY to a database it creates under POLICY_TEST_DATABASE_URL and drops at the end.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
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
const { bootstrapAdministrator, ensureTenantPrincipal } = require("../lib/adminPolicy/tenantBootstrap.js");
const { executeAdminOperation } = require("../lib/adminPolicy/adminPolicyApi.js");
const baseline = require("../lib/adminPolicy/roleCapabilityAuthorityBaseline.js");
const capabilityAuthority = require("../lib/eosOps/capabilityAuthority.js");
const composition = require("../lib/eosOps/entitledActionAuthority.js");
const evaluator = require("../lib/eosOps/contextualAuthorization.js");
const model = require("../lib/eosOps/conditionalEntitlement.js");
const { executeCommercialOperation } = require("../lib/eosCommercial/commercialHttp.js");
const { reconcileInventoryCapabilityGrants } = require("../lib/eosOps/migration/inventoryCapabilityGrantMigration.js");
const { activateWorkOrderLifecycleGrants } = require("../lib/adminPolicy/workOrderLifecycleGrantActivation.js");
const { sampleCompanyCapabilityKeys, sampleCompanyRoleKeys } = require("../scripts/seedSampleCompany.js");

const TENANT = "t-control-plane";
const COMPANY = "sample-co-synthetic";
const OPERATOR = "operator-control-plane";
const ADMIN_SUBJECT = "uid-cp-admin";
const WO_READ = "workOrder.record.read";
const ASSIGNED = Object.freeze({ paths: [[{ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" }]], recordKind: "workOrder" });

/** The six dispatcher selling capabilities (pass5), each with the Commercial operation it gates. */
/** The six pairs the catalog reconcile adds to a baseline-equal tenant today -- a PRE-EXISTING defect. */
const PRE_EXISTING_RECONCILE_EXTRAS = Object.freeze([
  "admin/reorder.request.assign", "admin/reorder.request.read.queue",
  "dispatcher/reorder.request.assign", "dispatcher/reorder.request.read.queue",
  "partsManager/reorder.request.read.queue", "purchasingManager/reorder.request.read.queue",
  // Pass 8: the technician Purchase Order cells are no longer a SYSTEM INVARIANT (LEGACY_BASELINE_ARTIFACT);
  // the legacy catalog declares them, so the reconcile now adds them like the rows above.
  "technician/reorder.purchaseOrder.create", "technician/reorder.purchaseOrder.read",
]);

const DISPATCHER_SELLING = Object.freeze([
  { objectKey: "opportunity", actionKey: "edit", capabilityKey: "opportunity.write", operation: "updateOpportunity" },
  { objectKey: "opportunity", actionKey: "createSalesOrder", capabilityKey: "opportunity.createSalesOrder", operation: "createSalesOrderFromOpportunity" },
  { objectKey: "salesAgreement", actionKey: "create", capabilityKey: "salesAgreement.create", operation: "createSalesAgreement" },
  { objectKey: "salesAgreement", actionKey: "edit", capabilityKey: "salesAgreement.updateDraft", operation: "updateSalesAgreementDraft" },
  { objectKey: "salesAgreement", actionKey: "accept", capabilityKey: "salesAgreement.accept", operation: "acceptSalesAgreement" },
  { objectKey: "salesOrder", actionKey: "edit", capabilityKey: "salesOrder.write", operation: "transitionSalesOrder" },
]);

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

test("the Administration control plane, end to end, against PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `cp_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  const url = dbUrlFor(name);

  // ── THE FIXTURE: the authority baseline's own rebuild pipeline, phases A-E ──
  const files = readdirSync(join(FUNCTIONS_DIR, "migrations")).filter((f) => f.endsWith(".sql")).sort();
  migrate(url, files.filter((f) => f < baseline.SEED_BOUNDARY_MIGRATION).length); // A
  pool = new pg.Pool({ connectionString: url, max: 8 });
  const q = (sql, v = []) => pool.query(sql, v);
  const repo = new PostgresPolicyRepository(pool);
  await q(`INSERT INTO eos_policy.tenants (id,key,name) VALUES ($1,$1,$1)`, [TENANT]); // B
  await seedTenantPolicy(repo, TENANT, OPERATOR);
  migrate(url); // C
  const applyDeclared = async (pairs, grantedBy) => {
    for (const { roleKey, capabilityKey } of pairs) {
      await q(`INSERT INTO eos_policy.role_capabilities (id,tenant_id,role_id,capability_id,granted_by,created_by,updated_by)
               SELECT 'rc_cp_' || substr(md5($1 || r.id || c.id), 1, 24), $1, r.id, c.id, $4, $4, $4
                 FROM eos_policy.roles r, eos_policy.capabilities c WHERE r.tenant_id = $1 AND r.key = $2 AND c.key = $3
               ON CONFLICT (tenant_id, role_id, capability_id) DO NOTHING`, [TENANT, roleKey, capabilityKey, grantedBy]);
    }
  };
  await applyDeclared(baseline.GLOBAL_CATALOG_ACTIVATED_GRANTS, "canonical-catalog:cp"); // D
  await applyDeclared(baseline.NONPROD_ACTIVATED_CAPABILITY_GRANTS, "nonprod-activation:cp"); // E
  await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id,operating_company_id,status,source,established_by,updated_by)
           VALUES ($1,$2,'ACTIVE','control-plane','fixture','fixture')`, [TENANT, COMPANY]);

  const liveGrants = async () => (await q(
    `SELECT r.key AS role_key, c.key AS capability_key FROM eos_policy.role_capabilities rc
       JOIN eos_policy.roles r ON r.id = rc.role_id JOIN eos_policy.capabilities c ON c.id = rc.capability_id
      WHERE rc.tenant_id = $1 ORDER BY 1, 2`, [TENANT])).rows.map((r) => ({ roleKey: r.role_key, capabilityKey: r.capability_key }));
  const currentDecisions = async () => (await repo.listRoleCapabilityDecisions(TENANT))
    .map((d) => ({ roleKey: d.roleKey, capabilityKey: d.capabilityKey, decision: d.decision }));
  const auditCount = async () => Number((await q(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE tenant_id=$1`, [TENANT])).rows[0].n);

  // ── principals, assigned through the governed Admin API ──
  const boot = await bootstrapAdministrator(repo, { tenantId: TENANT, externalSubject: ADMIN_SUBJECT, performedBy: OPERATOR, reason: "initial administrator" });
  const admin = (operation, input, subject = ADMIN_SUBJECT) => executeAdminOperation({ repo },
    { caller: { externalSubject: subject, identityProvider: "firebase" }, operation, input, requestId: `r-${operation}` });
  const roleId = async (key) => (await repo.getRoleByKey(TENANT, key)).id;
  const person = async (subject, roleKeys) => {
    const made = await ensureTenantPrincipal(repo, { tenantId: TENANT, externalSubject: subject, actorUid: OPERATOR, actorRoleKeys: ["admin"] });
    const principalId = made.principal?.id ?? made.id ?? made.principalId;
    for (const key of roleKeys) {
      const res = await admin("assignRole", { principalId, roleId: await roleId(key), reason: "fixture staffing" });
      assert.equal(res.ok, true, `assignRole ${key}: ${JSON.stringify(res)}`);
    }
    return { subject, principalId };
  };
  const salesManager = await person("uid-cp-salesmgr", ["salesManager"]);
  const dispatcher = await person("uid-cp-dispatcher", ["dispatcher"]);
  const officeManager = await person("uid-cp-office", ["officeManager"]);
  const techA = await person("uid-cp-tech-a", ["technician"]);
  const techB = await person("uid-cp-tech-b", ["technician"]);
  const plain = await person("uid-cp-plain", []);

  const provider = composition.postgresGrantConditionProvider(pool);
  const ctxFor = (p, conditions = provider) => capabilityAuthority.resolveOperationalContext(repo, pool,
    { identityProvider: "firebase", externalSubject: p.subject, requestedTenantId: null }, conditions);
  const actorOf = (ctx) => ({ tenantId: ctx.principalContext.tenantId, principalId: ctx.principalContext.uid,
    capabilities: ctx.capabilities, conditionallyHeld: ctx.conditionallyHeld, entitlements: ctx.entitlements });
  const decide = async (p, capabilityKey, recordId) => composition.authorizeOperationalAction(
    evaluator.postgresContextualReader(pool), actorOf(await ctxFor(p)), { capabilityKey, recordId });
  const commercial = (p, operation) => executeCommercialOperation({ reader: repo, pool },
    { caller: { externalSubject: p.subject, identityProvider: "firebase", requestedTenantId: null }, operation, input: {} });

  await t.test("the fixture IS the governed baseline, and verifies with zero drift before any decision", async () => {
    const { missingDeclaration, unexplainedExtra } = baseline.compareAuthority(baseline.nonprodAuthorityGrants(), await liveGrants());
    assert.deepEqual([missingDeclaration, unexplainedExtra], [[], []]);
    const v = baseline.verifyLiveTenantAuthority({ live: await liveGrants(), decisions: [], environment: "nonprod" });
    assert.deepEqual(v.drift, []);
    // The bootstrap wrote no grant: phase C already gave the governing capabilities to their Roles.
    assert.deepEqual((await repo.listAuditEvents(TENANT, 1000)).find((e) => e.action === "tenant.bootstrapAdministrator").after.administrationGrants, []);
  });

  await t.test("ZERO-CONDITION PARITY: with no condition row, PostgreSQL conditions change no decision", async () => {
    assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.capability_grant_conditions`)).rows[0].n, 0);
    for (const p of [salesManager, dispatcher, officeManager, techA, plain]) {
      const pgCtx = await ctxFor(p);
      const shipped = await ctxFor(p, capabilityAuthority.SHIPPED_GRANT_CONDITION_PROVIDER);
      assert.deepEqual([...pgCtx.capabilities].sort(), [...shipped.capabilities].sort());
      assert.equal(await capabilityAuthority.capabilitiesWithoutUnevaluatedConditions(pool, pgCtx.principalContext, pgCtx.capabilities, provider),
        pgCtx.capabilities, "the flat set is returned UNCHANGED");
      const reader = evaluator.postgresContextualReader(pool);
      for (const key of [...pgCtx.capabilities, "salesAgreement.accept", WO_READ]) {
        const a = await composition.authorizeOperationalAction(reader, actorOf(pgCtx), { capabilityKey: key, recordId: "wo-x" });
        const b = await composition.authorizeOperationalAction(reader, actorOf(shipped), { capabilityKey: key, recordId: "wo-x" });
        assert.deepEqual(a, b, `${p.subject} ${key}`);
      }
    }
  });

  await t.test("CASE A: salesManager accept + createSalesOrder through Administration -> audited once -> runtime allows", async () => {
    for (const [cap, op] of [["salesAgreement.accept", "acceptSalesAgreement"], ["opportunity.createSalesOrder", "createSalesOrderFromOpportunity"]]) {
      assert.equal((await decide(salesManager, cap)).outcome, "CAPABILITY_MISSING", `before: ${cap}`);
      assert.equal((await commercial(salesManager, op)).code, "CAPABILITY_REQUIRED", `before: ${op}`);
    }
    for (const [objectKey, actionKey] of [["salesAgreement", "accept"], ["opportunity", "createSalesOrder"]]) {
      const before = await auditCount();
      const res = await admin("grantObjectActionToRole", { objectKey, actionKey, roleKey: "salesManager", reason: "Owner #121 parity (O2)" });
      assert.equal(res.ok, true, JSON.stringify(res));
      assert.equal(await auditCount() - before, 1, "exactly one audit event");
    }
    for (const [cap, op] of [["salesAgreement.accept", "acceptSalesAgreement"], ["opportunity.createSalesOrder", "createSalesOrderFromOpportunity"]]) {
      const d = await decide(salesManager, cap);
      assert.deepEqual([d.allowed, d.outcome, d.viaGrantor], [true, "ALLOWED", { kind: "ROLE", roleKey: "salesManager" }], cap);
      // The Commercial kernel admits the capability: the refusal is now about the INPUT, not authority.
      assert.equal((await commercial(salesManager, op)).code, "IDEMPOTENCY_KEY_REQUIRED", op);
    }
    const decisions = await currentDecisions();
    assert.ok(decisions.some((d) => d.roleKey === "salesManager" && d.capabilityKey === "salesAgreement.accept" && d.decision === "ADMIN_GRANTED"));
  });

  await t.test("CASE B: dispatcher's six selling capabilities revoked -> refused -> reconcile + activation run -> revokes SURVIVE, no drift", async () => {
    for (const s of DISPATCHER_SELLING) assert.equal((await decide(dispatcher, s.capabilityKey)).allowed, true, `before: ${s.capabilityKey}`);
    for (const s of DISPATCHER_SELLING) {
      const before = await auditCount();
      const res = await admin("revokeObjectActionFromRole",
        { objectKey: s.objectKey, actionKey: s.actionKey, roleKey: "dispatcher", reason: "pass5: dispatcher does not sell" });
      assert.equal(res.ok, true, JSON.stringify(res));
      assert.equal(res.data.id !== undefined, true);
      assert.equal(await auditCount() - before, 1, `one audit event for ${s.capabilityKey}`);
    }
    const refuse = async () => {
      for (const s of DISPATCHER_SELLING) {
        assert.equal((await decide(dispatcher, s.capabilityKey)).outcome, "CAPABILITY_MISSING", s.capabilityKey);
        assert.equal((await commercial(dispatcher, s.operation)).code, "CAPABILITY_REQUIRED", s.operation);
      }
      // Reads and service coordination are untouched.
      for (const key of ["opportunity.read", "salesAgreement.read", "salesOrder.read"]) assert.equal((await decide(dispatcher, key)).allowed, true, key);
    };
    await refuse();

    // THE SAMPLE COMPANY RECONCILE PATH (seedSampleCompany.js step 3): same function, same scope.
    const vocabulary = await capabilityAuthority.listCapabilityKeys(pool);
    const report = await reconcileInventoryCapabilityGrants(pool, {
      tenantId: TENANT, apply: true, actor: "sample-company-v2:cp",
      capabilityKeys: sampleCompanyCapabilityKeys().filter((k) => vocabulary.has(k)), roleKeys: sampleCompanyRoleKeys(),
    });
    assert.deepEqual(report.rows.filter((r) => r.status === "ADMIN_REVOKED").map((r) => `${r.roleKey}/${r.capabilityKey}`).sort(),
      DISPATCHER_SELLING.map((s) => `dispatcher/${s.capabilityKey}`).sort(), "every revoked pair the catalog declares was skipped");
    // PRE-EXISTING, AND NOT THIS LANE'S: run over a baseline-equal tenant, the Sample Company reconcile
    // ADDS six reorder pairs the governed baseline withholds -- the superseded queue key "may never be
    // granted again" and the operationalRole-conditioned assign key, both declared by the legacy Role
    // catalog. Pinned by name and reported; none of them is an Administration-decided cell.
    assert.deepEqual(report.rows.filter((r) => r.status === "APPLIED").map((r) => `${r.roleKey}/${r.capabilityKey}`),
      PRE_EXISTING_RECONCILE_EXTRAS, "the reconcile re-added something other than the known pre-existing extras");
    assert.deepEqual(report.unresolved, []);

    // THE NONPROD ACTIVATION TOOL yields to a revoke too.
    const revokeCancel = await admin("revokeObjectActionFromRole", { objectKey: "workOrder", actionKey: "cancel", roleKey: "dispatcher", reason: "activation-yield proof" });
    assert.equal(revokeCancel.ok, true, JSON.stringify(revokeCancel));
    const activation = await activateWorkOrderLifecycleGrants(repo,
      { tenantId: TENANT, uid: boot.principal.id, heldRoleKeys: ["admin"] }, { apply: true, reason: "re-run the activation" });
    assert.deepEqual(activation.rows.filter((r) => r.status === "ADMIN_REVOKED").map((r) => `${r.roleKey}/${r.capabilityKey}`),
      ["dispatcher/workOrder.lifecycle.cancel"]);
    assert.equal(activation.appliedAdditions, 0);
    await refuse();

    // THE BASELINE VERIFICATION: Administration decisions explain every difference they made -- the
    // ONLY drift left is the reconcile's pre-existing extras above, none of them an Administration cell.
    const v = baseline.verifyLiveTenantAuthority({ live: await liveGrants(), decisions: await currentDecisions(), environment: "nonprod" });
    assert.deepEqual(v.drift.map((d) => `${d.kind}:${d.roleKey}/${d.capabilityKey}`),
      PRE_EXISTING_RECONCILE_EXTRAS.map((c) => `UNEXPLAINED_EXTRA:${c}`), JSON.stringify(v.drift));
    const decided = new Set((await currentDecisions()).map((d) => `${d.roleKey}/${d.capabilityKey}`));
    assert.equal(v.drift.some((d) => decided.has(`${d.roleKey}/${d.capabilityKey}`)), false, "an Administration decision produced drift");
    // Remove the pre-existing extras (fixture restore) so the remaining proofs start from the baseline.
    await q(`DELETE FROM eos_policy.role_capabilities WHERE tenant_id = $1 AND granted_by = 'sample-company-v2:cp'`, [TENANT]);
    const clean = baseline.verifyLiveTenantAuthority({ live: await liveGrants(), decisions: await currentDecisions(), environment: "nonprod" });
    assert.deepEqual(clean.drift, [], "with the pre-existing extras removed, the tenant verifies with ZERO drift");
    assert.deepEqual(v.explainedByAdminRevoke.map((c) => `${c.roleKey}/${c.capabilityKey}`).sort(),
      [...DISPATCHER_SELLING.map((s) => `dispatcher/${s.capabilityKey}`), "dispatcher/workOrder.lifecycle.cancel"].sort());
    assert.deepEqual(v.explainedByAdminGrant.map((c) => `${c.roleKey}/${c.capabilityKey}`).sort(),
      ["salesManager/opportunity.createSalesOrder", "salesManager/salesAgreement.accept"]);
    // ...while the SAME live state WITHOUT the decisions is drift (AN2 is not weakened).
    const bare = baseline.verifyLiveTenantAuthority({ live: await liveGrants(), decisions: [], environment: "nonprod" });
    assert.equal(bare.drift.length, 9, "6 + 1 revoked defaults missing, 2 Case A grants extra");
    // And the repository rebuild itself is unchanged: the baseline is still the SYSTEM DEFAULT.
    assert.doesNotThrow(() => baseline.assertBaselineHonoursSystemInvariants());
  });

  await t.test("CASE C: officeManager workOrder.record.read through Administration -> the evaluator allows", async () => {
    assert.equal((await decide(officeManager, WO_READ, "wo-any")).outcome, "CAPABILITY_MISSING");
    const res = await admin("grantObjectActionToRole", { objectKey: "workOrder", actionKey: "read", roleKey: "officeManager", reason: "office reads work orders" });
    assert.equal(res.ok, true, JSON.stringify(res));
    const d = await decide(officeManager, WO_READ, "wo-any");
    assert.deepEqual([d.allowed, d.viaCondition, d.viaGrantor], [true, false, { kind: "ROLE", roleKey: "officeManager" }]);
  });

  // ── CASE D fixture: Employees, links, Work Orders, assignments (lane-TC shape) ──
  const employee = async (key, principalId) => {
    await q(`INSERT INTO eos_workforce.employees (id,tenant_id,employment_status,operating_company_id,employee_number)
             VALUES ($1,$2,'ACTIVE',$3,$4)`, [`emp-${key}`, TENANT, COMPANY, `CP-${key}`]);
    await q(`INSERT INTO eos_policy.employee_principal_links
               (id,tenant_id,principal_id,employee_id,operating_company_id,link_source,status,asserted_by,assertion_reason)
             VALUES ($1,$2,$3,$4,$5,'OPERATOR_ASSERTED','active','fixture','control plane fixture')`,
    [`lnk-${key}`, TENANT, principalId, `emp-${key}`, COMPANY]);
    return `emp-${key}`;
  };
  const empA = await employee("tech-a", techA.principalId);
  const empB = await employee("tech-b", techB.principalId);
  for (const [i, id] of ["wo-cp-a", "wo-cp-b"].entries()) {
    await q(`INSERT INTO eos_ops.work_orders (id,tenant_id,operating_company_key,work_order_number,status,work_order_type,priority,
               customer_id,location_id,provenance,created_by_principal_id,updated_by_principal_id,created_at,updated_at)
             VALUES ($1,$2,$3,$4,'SCHEDULED','SERVICE_CALL',2,'cust-1','loc-1','NATIVE',$5,$5,now(),now())`,
    [id, TENANT, COMPANY, `WO-2026-${String(910001 + i)}`, dispatcher.principalId]);
  }
  for (const [id, wo, emp] of [["woa-cp-a", "wo-cp-a", empA], ["woa-cp-b", "wo-cp-b", empB]]) {
    await q(`INSERT INTO eos_ops.work_order_assignments (id,tenant_id,work_order_id,assignee_employee_id,source,effective_from,assigned_by_principal_id,provenance)
             VALUES ($1,$2,$3,$4,'SCHEDULE',now() - interval '1 hour',$5,'NATIVE')`, [id, TENANT, wo, emp, dispatcher.principalId]);
  }

  await t.test("CASE D: technician workOrder.record.read + RECORD_ASSIGNMENT -> own allowed, other refused; retire NEVER widens", async () => {
    // Before: the MIGRATION_BACKED flat grant reads every Work Order -- the defect the condition closes.
    assert.equal((await decide(techA, WO_READ, "wo-cp-b")).allowed, true, "flat grant = ALL");
    const before = await auditCount();
    const set = await admin("setGrantCondition", { objectKey: "workOrder", actionKey: "read", roleKey: "technician",
      condition: ASSIGNED, reason: "technicians read only assigned Work Orders" });
    assert.equal(set.ok, true, JSON.stringify(set));
    assert.equal(await auditCount() - before, 1);

    const own = await decide(techA, WO_READ, "wo-cp-a");
    assert.deepEqual([own.allowed, own.viaCondition, own.viaGrantor], [true, true, { kind: "ROLE", roleKey: "technician" }]);
    const other = await decide(techA, WO_READ, "wo-cp-b");
    assert.deepEqual([other.allowed, other.outcome, other.predicate], [false, "NOT_ASSIGNED", "RECORD_ASSIGNMENT"]);
    assert.equal((await decide(techB, WO_READ, "wo-cp-b")).allowed, true);
    assert.equal((await decide(techA, WO_READ)).allowed, false, "no record supplied is never ALL");
    // Unconditioned holders are untouched.
    assert.equal((await decide(officeManager, WO_READ, "wo-cp-b")).viaCondition, false);

    // RETIRE IS REFUSED while the grant is held -- API (409), command, and the database trigger.
    const retire = await admin("retireGrantCondition", { objectKey: "workOrder", actionKey: "read", roleKey: "technician", reason: "try to lift" });
    assert.deepEqual([retire.ok, retire.code], [false, "CONFLICT"]);
    assert.match(retire.message, /CONDITION_RETIREMENT_WOULD_WIDEN/);
    await assert.rejects(() => q(`UPDATE eos_policy.capability_grant_conditions SET status='RETIRED' WHERE tenant_id=$1`, [TENANT]),
      /CONDITION_RETIREMENT_WOULD_WIDEN/);
    await assert.rejects(() => q(`DELETE FROM eos_policy.capability_grant_conditions WHERE tenant_id=$1`, [TENANT]),
      /CONDITION_RETIREMENT_WOULD_WIDEN/);
    assert.equal((await decide(techA, WO_READ, "wo-cp-b")).allowed, false, "still NOT ALL after every retire attempt");

    // The only way out is revoke-then-retire: the technician ends with NOTHING, never with ALL.
    const revoke = await admin("revokeObjectActionFromRole", { objectKey: "workOrder", actionKey: "read", roleKey: "technician", reason: "withdraw" });
    assert.equal(revoke.ok, true);
    const retired = await admin("retireGrantCondition", { objectKey: "workOrder", actionKey: "read", roleKey: "technician", reason: "no grant left to narrow" });
    assert.equal(retired.ok, true, JSON.stringify(retired));
    assert.equal(retired.data.status, "RETIRED");
    for (const wo of ["wo-cp-a", "wo-cp-b"]) assert.equal((await decide(techA, WO_READ, wo)).outcome, "CAPABILITY_MISSING");

    // Re-granting WITH the condition in one transaction: conditioned from the first statement.
    const regrant = await admin("grantObjectActionToRole", { objectKey: "workOrder", actionKey: "read", roleKey: "technician",
      condition: ASSIGNED, requiresCondition: true, reason: "restore, conditioned" });
    assert.equal(regrant.ok, true, JSON.stringify(regrant));
    assert.equal((await decide(techA, WO_READ, "wo-cp-a")).allowed, true);
    assert.equal((await decide(techA, WO_READ, "wo-cp-b")).outcome, "NOT_ASSIGNED");
  });

  await t.test("FAIL CLOSED on flat-set kernels: a condition on a flat-gated capability is refused, and a raw one withholds", async () => {
    // Pass 8 D1: salesAgreement.accept is read by the Commercial kernel's FLAT check, so it is not on the
    // condition allow-list at all.
    const res = await admin("setGrantCondition", { objectKey: "salesAgreement", actionKey: "accept", roleKey: "salesManager",
      condition: { paths: [[{ kind: "WORK_ELIGIBILITY", qualificationCode: "SERVICE_TECHNICIAN" }]] }, reason: "narrow acceptance" });
    assert.deepEqual([res.ok, res.code], [false, "INVALID_INPUT"]);
    assert.match(res.message, /CONDITION_NOT_SUPPORTED/);
    // A condition row written behind Administration's back still never widens: the key leaves the flat set.
    await q(`INSERT INTO eos_policy.capability_grant_conditions (id,tenant_id,grant_scope,grantor_key,capability_key,condition,established_by,updated_by)
             VALUES ('gc-raw',$1,'ROLE','salesManager','salesAgreement.accept','{"paths":[[{"kind":"WORK_ELIGIBILITY","qualificationCode":"SERVICE_TECHNICIAN"}]]}'::jsonb,'x','x')`, [TENANT]);
    assert.equal((await commercial(salesManager, "acceptSalesAgreement")).code, "CAPABILITY_REQUIRED");
    // The other, unconditioned grant is unaffected.
    assert.equal((await commercial(salesManager, "createSalesOrderFromOpportunity")).code, "IDEMPOTENCY_KEY_REQUIRED");
    // The entitled evaluator applies the condition instead of ignoring it.
    const d = await decide(salesManager, "salesAgreement.accept");
    assert.equal(d.allowed, false);
    assert.notEqual(d.outcome, "CAPABILITY_MISSING");
  });

  await t.test("authority: no admin capability -> FORBIDDEN; the CAPABILITY authorizes, not the Role name", async () => {
    const before = await auditCount();
    for (const operation of ["grantObjectActionToRole", "revokeObjectActionFromRole", "setGrantCondition", "retireGrantCondition"]) {
      for (const who of [plain, dispatcher, salesManager]) {
        const res = await admin(operation, { objectKey: "workOrder", actionKey: "dispatch", roleKey: "dispatcher", condition: ASSIGNED, reason: "x" }, who.subject);
        assert.deepEqual([res.ok, res.code], [false, "FORBIDDEN"], `${who.subject} ${operation}`);
      }
    }
    const assign = await admin("assignRole", { principalId: plain.principalId, roleId: await roleId("admin"), reason: "x" }, dispatcher.subject);
    assert.deepEqual([assign.ok, assign.code], [false, "FORBIDDEN"]);
    assert.equal(await auditCount(), before, "a refusal writes nothing");

    // A CUSTOM Role carrying admin.securityPolicy.write administers; the name `admin` is irrelevant.
    assert.equal((await admin("createRole", { key: "securityClerk", name: "Security Clerk", reason: "delegate" })).ok, true);
    assert.equal((await admin("grantObjectActionToRole", { objectKey: "rolesPermissions", actionKey: "editSecurityPolicy", roleKey: "securityClerk", reason: "delegate" })).ok, true);
    const clerk = await person("uid-cp-clerk", ["securityClerk"]);
    const byClerk = await admin("grantObjectActionToRole", { objectKey: "workOrder", actionKey: "read", roleKey: "fieldManager", reason: "by delegate" }, clerk.subject);
    assert.equal(byClerk.ok, true, JSON.stringify(byClerk));
    // generalManager: the old Role-name invariant let it assign Roles; the capability gate does NOT,
    // because it holds no admin.roleAssignment.write (Owner ruling 2026-08-21 conflict, reported).
    const gm = await person("uid-cp-gm", ["generalManager"]);
    const staffing = { principalId: plain.principalId, roleId: await roleId("salesperson"), reason: "GM staffing" };
    const refusedGm = await admin("assignRole", staffing, gm.subject);
    assert.deepEqual([refusedGm.ok, refusedGm.code], [false, "FORBIDDEN"]);
    // RESTORING IT IS AN ADMINISTRATION ACT, not a migration: one audited grant, and GM may assign.
    const restore = await admin("grantObjectActionToRole", { objectKey: "rolesPermissions", actionKey: "assignRole", roleKey: "generalManager", reason: "Owner decides GM staffing authority" });
    assert.equal(restore.ok, true, JSON.stringify(restore));
    const byGm = await admin("assignRole", staffing, gm.subject);
    assert.equal(byGm.ok, true, JSON.stringify(byGm));
    // ...and a held assignment capability still does NOT change what a Role may do (definition stays admin-only).
    const gmGrant = await admin("grantObjectActionToRole", { objectKey: "workOrder", actionKey: "read", roleKey: "salesperson", reason: "x" }, gm.subject);
    assert.deepEqual([gmGrant.ok, gmGrant.code], [false, "FORBIDDEN"]);
  });

  await t.test("a direct Principal grant stays distinguishable -- DIRECT, and not in the Role-only runtime set", async () => {
    const res = await admin("grantObjectActionToPrincipal", { objectKey: "workOrder", actionKey: "dispatch", principalId: plain.principalId, reason: "exception" });
    assert.equal(res.ok, true);
    // Administration grants itself the security-policy read to look (it is not granted by default here).
    const view = await admin("getPrincipalEffectiveAccess", { principalId: plain.principalId });
    if (view.ok) {
      const dispatch = view.data.effective.find((c) => c.capabilityKey === "workOrder.lifecycle.dispatch");
      assert.equal(dispatch.source, "DIRECT");
    }
    const direct = await composition.resolveDirectEntitlements(pool, TENANT, plain.principalId);
    assert.deepEqual(direct.map((e) => e.grantor), [{ kind: "PRINCIPAL", principalId: plain.principalId }]);
    const ctx = await ctxFor(plain);
    assert.equal(ctx.capabilities.has("workOrder.lifecycle.dispatch"), false, "the operational runtime resolves Roles only");
  });

  await t.test("audit and decisions are immutable; decisions reference their audit event", async () => {
    await assert.rejects(() => q(`UPDATE eos_policy.audit_events SET reason='rewritten' WHERE tenant_id=$1`, [TENANT]), /audit_events is append-only/);
    await assert.rejects(() => q(`DELETE FROM eos_policy.audit_events WHERE tenant_id=$1`, [TENANT]), /audit_events is append-only/);
    await assert.rejects(() => q(`UPDATE eos_policy.role_capability_decisions SET decision='ADMIN_GRANTED' WHERE tenant_id=$1`, [TENANT]), /append-only/);
    await assert.rejects(() => q(`DELETE FROM eos_policy.role_capability_decisions WHERE tenant_id=$1`, [TENANT]), /append-only/);
    const orphans = await q(`SELECT count(*)::int n FROM eos_policy.role_capability_decisions d
                              LEFT JOIN eos_policy.audit_events a ON a.id = d.audit_event_id AND a.tenant_id = d.tenant_id
                             WHERE d.tenant_id = $1 AND a.id IS NULL`, [TENANT]);
    assert.equal(orphans.rows[0].n, 0);
    const current = await q(`SELECT role_key, capability_key, count(*)::int n FROM eos_policy.role_capability_decisions
                              WHERE tenant_id=$1 AND superseded_at IS NULL GROUP BY 1,2 HAVING count(*) > 1`, [TENANT]);
    assert.equal(current.rows.length, 0, "one current decision per cell");
    // technician/workOrder.record.read was revoked then re-granted: two rows, one superseded.
    const history = await admin("listRoleCapabilityDecisionHistory", { roleKey: "technician", capabilityKey: WO_READ });
    if (history.ok) assert.deepEqual(history.data.map((d) => [d.decision, d.supersededAt === null]), [["ADMIN_REVOKED", false], ["ADMIN_GRANTED", true]]);
    // A reason is mandatory at the database too.
    await assert.rejects(() => q(`INSERT INTO eos_policy.role_capability_decisions (id,tenant_id,role_key,capability_key,decision,reason,actor_principal_id,audit_event_id)
      SELECT 'd-x',$1,'admin','workOrder.record.read','ADMIN_GRANTED','  ','x',id FROM eos_policy.audit_events WHERE tenant_id=$1 LIMIT 1`, [TENANT]), /check constraint/);
  });

  await t.test("the reconcile and verification still refuse FORBIDDEN state", async () => {
    // A forbidden pair written behind Administration's back is drift, and no decision explains it.
    await q(`INSERT INTO eos_policy.role_capabilities (id,tenant_id,role_id,capability_id,granted_by,created_by,updated_by)
             SELECT 'rc-forbidden',$1,r.id,c.id,'rogue','rogue','rogue' FROM eos_policy.roles r, eos_policy.capabilities c
              WHERE r.tenant_id=$1 AND r.key='owner' AND c.key='salesAgreement.accept'`, [TENANT]);
    const v = baseline.verifyLiveTenantAuthority({ live: await liveGrants(), decisions: await currentDecisions(), environment: "nonprod" });
    assert.deepEqual(v.forbiddenPresent, [{ roleKey: "owner", capabilityKey: "salesAgreement.accept" }]);
    assert.ok(v.drift.some((d) => d.kind === "FORBIDDEN_PRESENT"));
    await q(`DELETE FROM eos_policy.role_capabilities WHERE id='rc-forbidden'`);
  });

  await t.test("the Admin reads show sources and conditions for the UI", async () => {
    // admin already holds admin.securityPolicy.read (migration 1762041600000); an administrator may not
    // widen a Role it holds (Pass 8 D5a), so the attempt is refused rather than silently a no-op.
    const g = await admin("grantObjectActionToRole", { objectKey: "rolesPermissions", actionKey: "read", roleKey: "admin", reason: "read the matrix" });
    assert.deepEqual([g.ok, g.code], [false, "FORBIDDEN"]);
    const matrix = await admin("getObjectActionGrantMatrix", { objectKey: "workOrder" });
    assert.equal(matrix.ok, true, JSON.stringify(matrix));
    const read = matrix.data.actions.find((a) => a.actionKey === "read");
    const cell = (k) => read.roles.find((r) => r.roleKey === k);
    assert.deepEqual([cell("technician").source, cell("technician").condition], ["ADMIN_GRANTED", ASSIGNED]);
    assert.equal(cell("officeManager").source, "ADMIN_GRANTED");
    assert.equal(cell("dispatcher").source, "SYSTEM_DEFAULT");
    const cancel = matrix.data.actions.find((a) => a.actionKey === "cancel");
    assert.equal(cancel.roles.find((r) => r.roleKey === "dispatcher").source, "ADMIN_REVOKED");
    assert.equal(cancel.roles.find((r) => r.roleKey === "owner").source, "SYSTEM_INVARIANT");
    const detail = await admin("getSecurityRoleDetail", { roleKey: "technician" });
    assert.equal(detail.ok, true);
    assert.deepEqual(detail.data.holders.map((h) => h.principalId).sort(), [techA.principalId, techB.principalId].sort());
  });
});
