// THE SERVICE ACTIVATION AUTHORITY DELTA (Owner DECISIONS 1 and 2, 2026-09-30), applied to a BASELINE-EQUAL tenant
// through the governed Administration API exactly as the activation window will, then exercised through the Work Order
// transport by principals holding the canonical Security Roles.
//
//   DECISION 1  nine grants: dispatcher + fieldManager x {ready, schedule, close, planParts}; technician x recordExecution
//   DECISION 2  DQ-016: technician workOrder.record.read conditioned to Employee + RECORD_ASSIGNMENT
//
// The fixture is the authority baseline's own rebuild pipeline (phases A-E, as administrationControlPlanePostgres
// uses), so "baseline-equal" means the committed nonprod grant baseline -- not a hand-typed capability set.
//
// Real PostgreSQL. Set POLICY_TEST_DATABASE_URL; without it the database half SKIPS.
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
const delta = require("../lib/adminPolicy/serviceActivationAuthorityDelta.js");
const { executeWorkOrderOperation } = require("../lib/eosOps/eosOpsHttp.js");
const { executeCommercialOperation } = require("../lib/eosCommercial/commercialHttp.js");

// ════════════════════ OFFLINE: the packet itself ════════════════════

test("DECISION 1: exactly nine grants on the canonical roles; the Technician gets recordExecution and nothing else", () => {
  assert.equal(delta.SERVICE_ACTIVATION_GRANTS.length, 9);
  assert.deepEqual([...new Set(delta.SERVICE_ACTIVATION_GRANTS.map((g) => g.roleKey))].sort(), ["dispatcher", "fieldManager", "technician"]);
  const tech = delta.SERVICE_ACTIVATION_GRANTS.filter((g) => g.roleKey === "technician").map((g) => g.capabilityKey);
  assert.deepEqual(tech, ["workOrder.execution.record"]);
  for (const k of delta.TECHNICIAN_NEVER) assert.equal(tech.includes(k), false, k);
  for (const role of ["dispatcher", "fieldManager"]) {
    assert.deepEqual(delta.SERVICE_ACTIVATION_GRANTS.filter((g) => g.roleKey === role).map((g) => g.capabilityKey).sort(),
      ["workOrder.lifecycle.close", "workOrder.lifecycle.ready", "workOrder.lifecycle.schedule", "workOrder.parts.plan"]);
  }
  // Every grant is an Administration command with a stated reason -- never a migration or a seed.
  for (const op of delta.serviceActivationOperations()) assert.match(op.input.reason, /COMPLETION PASS 2026-09-30|SERVICE ACTIVATION AUTHORIZATION 2026-09-30/);
  // D: labor correction to the Service Manager ONLY; E: Inbound Work by least authority.
  assert.deepEqual(delta.LABOR_CORRECTION_GRANTS.map((g) => [g.roleKey, g.capabilityKey]), [["fieldManager", "workOrder.labor.correctEntry"]]);
  const inbound = (role) => delta.INBOUND_WORK_GRANTS.filter((g) => g.roleKey === role).map((g) => g.capabilityKey).sort();
  assert.deepEqual(inbound("fieldManager"), ["inboundWork.intake.manage", "inboundWork.request.accept", "inboundWork.request.attach", "inboundWork.request.decline", "inboundWork.request.read"]);
  assert.deepEqual(inbound("dispatcher"), ["inboundWork.request.accept", "inboundWork.request.attach", "inboundWork.request.decline", "inboundWork.request.read"]);
  assert.deepEqual(inbound("officeManager"), ["inboundWork.request.read"]);
  for (const role of ["technician", "salesperson", "partsAssociate", "partsManager"]) assert.deepEqual(inbound(role), [], role);
});

test("DECISION 2: DQ-016 is ONE condition on the technician's workOrder/read cell, applied FIRST", () => {
  const ops = delta.serviceActivationOperations();
  assert.equal(ops[0].operation, "setGrantCondition");
  assert.deepEqual(ops[0].input.condition, { paths: [[{ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" }]], recordKind: "workOrder" });
  assert.deepEqual([ops[0].input.roleKey, ops[0].input.objectKey, ops[0].input.actionKey], ["technician", "workOrder", "read"]);
  assert.equal(ops.length, 21); // 1 condition + 9 (DECISION 1) + 1 (D) + 10 (E)
});

// ════════════════════ AGAINST REAL POSTGRESQL ════════════════════

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

const TENANT = "t-service-activation";
const OPERATOR = "operator-service-activation";
const ADMIN_SUBJECT = "uid-sa-admin";
const HOUR = 3_600_000;

test("the Service activation authority delta, applied through Administration and exercised through the Work Order route",
  { skip: SKIP, concurrency: 1 }, async (t) => {
    const name = `sa_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    let pool;
    await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
    t.after(async () => {
      await pool?.end();
      await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
    });
    const url = dbUrlFor(name);
    const files = readdirSync(join(FUNCTIONS_DIR, "migrations")).filter((f) => f.endsWith(".sql")).sort();
    migrate(url, files.filter((f) => f < baseline.SEED_BOUNDARY_MIGRATION).length);
    pool = new pg.Pool({ connectionString: url, max: 8 });
    const q = (sql, v = []) => pool.query(sql, v);
    const repo = new PostgresPolicyRepository(pool);
    await q(`INSERT INTO eos_policy.tenants (id,key,name) VALUES ($1,$1,$1)`, [TENANT]);
    await seedTenantPolicy(repo, TENANT, OPERATOR);
    migrate(url);
    const applyDeclared = async (pairs, grantedBy) => {
      for (const { roleKey, capabilityKey } of pairs) {
        await q(`INSERT INTO eos_policy.role_capabilities (id,tenant_id,role_id,capability_id,granted_by,created_by,updated_by)
                 SELECT 'rc_sa_' || substr(md5($1 || r.id || c.id), 1, 24), $1, r.id, c.id, $4, $4, $4
                   FROM eos_policy.roles r, eos_policy.capabilities c WHERE r.tenant_id = $1 AND r.key = $2 AND c.key = $3
                 ON CONFLICT (tenant_id, role_id, capability_id) DO NOTHING`, [TENANT, roleKey, capabilityKey, grantedBy]);
      }
    };
    await applyDeclared(baseline.GLOBAL_CATALOG_ACTIVATED_GRANTS, "canonical-catalog:sa");
    await applyDeclared(baseline.NONPROD_ACTIVATED_CAPABILITY_GRANTS, "nonprod-activation:sa");
    for (const [company, key] of [["taylor", "taylor"], ["ventana", "ventana"]]) {
      await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id,operating_company_id,status,source,established_by,updated_by)
               VALUES ($1,$2,'ACTIVE','fixture','fixture','fixture')`, [TENANT, company]);
      await q(`INSERT INTO eos_policy.tenant_operating_company_keys (tenant_id,operating_company_id,operating_company_key,status,provenance,source,established_by,updated_by)
               VALUES ($1,$2,$3,'ACTIVE','NATIVE','fixture','fixture','fixture')`, [TENANT, company, key]);
    }

    const grantCount = async () => Number((await q(`SELECT count(*)::int n FROM eos_policy.role_capabilities WHERE tenant_id=$1`, [TENANT])).rows[0].n);
    const conditionCount = async () => Number((await q(`SELECT count(*)::int n FROM eos_policy.capability_grant_conditions WHERE tenant_id=$1 AND status='ACTIVE'`, [TENANT])).rows[0].n);

    await bootstrapAdministrator(repo, { tenantId: TENANT, externalSubject: ADMIN_SUBJECT, performedBy: OPERATOR, reason: "initial administrator" });
    const admin = (operation, input) => executeAdminOperation({ repo },
      { caller: { externalSubject: ADMIN_SUBJECT, identityProvider: "firebase" }, operation, input, requestId: `r-${operation}-${randomUUID()}` });
    const roleId = async (key) => (await repo.getRoleByKey(TENANT, key)).id;
    const person = async (subject, roleKeys, employee = null) => {
      const made = await ensureTenantPrincipal(repo, { tenantId: TENANT, externalSubject: subject, actorUid: OPERATOR, actorRoleKeys: ["admin"] });
      const principalId = made.principal?.id ?? made.id ?? made.principalId;
      for (const key of roleKeys) {
        const res = await admin("assignRole", { principalId, roleId: await roleId(key), reason: "fixture staffing" });
        assert.equal(res.ok, true, `assignRole ${key}: ${JSON.stringify(res)}`);
      }
      if (employee) {
        await q(`INSERT INTO eos_workforce.employees (id,tenant_id,employment_status,operating_company_id,display_name) VALUES ($1,$2,'ACTIVE',$3,$1)`,
          [employee.id, TENANT, employee.company ?? "taylor"]);
        if (employee.linked !== false) {
          await q(`INSERT INTO eos_policy.employee_principal_links (id,tenant_id,principal_id,employee_id,operating_company_id,link_source,status,asserted_by,assertion_reason)
                   VALUES ($1,$2,$3,$4,$5,'OPERATOR_ASSERTED','active','fixture','service activation fixture')`,
            [`lnk-${employee.id}`, TENANT, principalId, employee.id, employee.company ?? "taylor"]);
        }
        if (employee.qualified !== false) {
          await q(`INSERT INTO eos_workforce.employee_work_eligibility (id,tenant_id,employee_id,qualification_code,effective_from,assigned_by,reason)
                   VALUES ($1,$2,$3,'SERVICE_TECHNICIAN',now(),'fixture','fixture')`, [`we-${employee.id}`, TENANT, employee.id]);
        }
      }
      return { subject, principalId };
    };
    const dispatcher = await person("uid-sa-dispatcher", ["dispatcher"]);
    const serviceManager = await person("uid-sa-fieldmgr", ["fieldManager"]);
    const techA = await person("uid-sa-tech-a", ["technician"], { id: "emp-sa-a" });
    const techB = await person("uid-sa-tech-b", ["technician"], { id: "emp-sa-b" });
    const techVentana = await person("uid-sa-tech-v", ["technician"], { id: "emp-sa-v", company: "ventana" });
    const techUnlinked = await person("uid-sa-tech-u", ["technician"]);
    const sales = await person("uid-sa-sales", ["salesperson"]);
    const parts = await person("uid-sa-parts", ["partsAssociate", "inventoryReceivingClerk"]);
    await q(`INSERT INTO eos_workforce.employees (id,tenant_id,employment_status,operating_company_id) VALUES ('emp-sa-unqualified',$1,'ACTIVE','taylor')`, [TENANT]);

    // THE LIVE NONPROD DECISION THIS PACKET SITS ON: D-A (ruling O3) revoked the dispatcher's six selling grants through
    // Administration. Replayed here the same way, so "baseline-equal" means baseline + the recorded nonprod decisions.
    for (const [objectKey, actionKey] of [["opportunity", "edit"], ["opportunity", "createSalesOrder"], ["salesAgreement", "create"],
      ["salesAgreement", "edit"], ["salesAgreement", "accept"], ["salesOrder", "edit"]]) {
      const res = await admin("revokeObjectActionFromRole", { roleKey: "dispatcher", objectKey, actionKey, reason: "D-A 2026-09-30 (O3): replayed nonprod decision" });
      assert.equal(res.ok, true, JSON.stringify(res));
    }

    const wo = (subject, operation, input = {}) => executeWorkOrderOperation({ reader: repo, pool, workOrderPostgresState: "ACTIVE" },
      { caller: { externalSubject: subject, identityProvider: "firebase", requestedTenantId: null }, operation, input });
    const ok = (r, what) => { assert.equal(r.status, 200, `${what}: ${JSON.stringify(r.body)}`); return r.body.result; };
    const refused = (r, status, code, what) => assert.deepEqual([r.status, r.body.code], [status, code], `${what}: ${JSON.stringify(r.body)}`);

    // Work Orders (created by the governed command, as the Service Office would).
    const mkWo = async (company = "taylor") => ok(await wo(dispatcher.subject, "createWorkOrder",
      { operatingCompanyId: company, customerId: "acct-sa", locationId: "loc-sa", workOrderType: "SERVICE_CALL", priority: 2 }), "create").workOrderId;

    await t.test("BEFORE: the baseline Service Office cannot schedule, and the technician reads EVERY Work Order (the DQ-016 defect)", async () => {
      const id = await mkWo();
      refused(await wo(dispatcher.subject, "markWorkOrderReady", { workOrderId: id }), 403, "CAPABILITY_MISSING", "ready before");
      assert.equal((await wo(techB.subject, "readWorkOrder", { workOrderId: id })).status, 200, "flat grant = every Work Order");
    });

    const grantsBefore = await grantCount();
    await t.test("APPLY the packet through the Administration API: +20 grants, +1 condition, every command audited", async () => {
      const auditBefore = Number((await q(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE tenant_id=$1`, [TENANT])).rows[0].n);
      for (const { operation, input } of delta.serviceActivationOperations()) {
        const res = await admin(operation, input);
        assert.equal(res.ok, true, `${operation} ${JSON.stringify(input)}: ${JSON.stringify(res)}`);
      }
      assert.equal(await grantCount() - grantsBefore, 20);
      assert.equal(await conditionCount(), 1);
      const auditAfter = Number((await q(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE tenant_id=$1`, [TENANT])).rows[0].n);
      assert.ok(auditAfter - auditBefore >= 10, "each Administration command is audited");
      // Idempotent: re-applying adds nothing.
      for (const { operation, input } of delta.serviceActivationOperations()) assert.equal((await admin(operation, input)).ok, true);
      assert.equal(await grantCount() - grantsBefore, 20);
    });

    let own; let other; let ventanaWo;
    const start = Date.now() + 2 * 24 * HOUR;
    await t.test("SERVICE OFFICE (both canonical roles) now plans and schedules; assignment is to an eligible Employee", async () => {
      // DECISION 5: synthetic acceptance availability, configured explicitly through the governed route.
      const ROUND_THE_CLOCK = Object.fromEntries(["0", "1", "2", "3", "4", "5", "6"].map((d) => [d, [{ start: "00:00", end: "24:00" }]]));
      for (const employeeId of ["emp-sa-a", "emp-sa-b", "emp-sa-v"]) {
        ok(await wo(dispatcher.subject, "setTechnicianWorkingHours", { employeeId, timeZone: "UTC", weeklyHours: ROUND_THE_CLOCK, reason: "synthetic acceptance availability" }), "hours");
      }
      own = await mkWo();
      other = await mkWo();
      for (const [who, id, emp, offset] of [[dispatcher, own, "emp-sa-a", 0], [serviceManager, other, "emp-sa-b", 3 * HOUR]]) {
        ok(await wo(who.subject, "markWorkOrderReady", { workOrderId: id }), "ready");
        ok(await wo(who.subject, "setWorkOrderPartsPlan", { workOrderId: id, plan: [] }), "plan parts");
        ok(await wo(who.subject, "scheduleWorkOrder", { workOrderId: id, employeeId: emp, scheduledStart: start + offset, scheduledEnd: start + offset + HOUR }), "schedule");
      }
      ventanaWo = await mkWo("ventana");
      ok(await wo(dispatcher.subject, "markWorkOrderReady", { workOrderId: ventanaWo }), "ready ventana");
      ok(await wo(dispatcher.subject, "scheduleWorkOrder", { workOrderId: ventanaWo, employeeId: "emp-sa-v", scheduledStart: start + 6 * HOUR, scheduledEnd: start + 7 * HOUR }), "schedule ventana");
    });

    await t.test("DQ-016: assigned ALLOW; unassigned, different and wrong-company technicians REFUSE; no tenant queue", async () => {
      assert.equal(ok(await wo(techA.subject, "readWorkOrder", { workOrderId: own }), "own").workOrderId, own);
      refused(await wo(techA.subject, "readWorkOrder", { workOrderId: other }), 403, "NOT_ASSIGNED", "different technician");
      refused(await wo(techVentana.subject, "readWorkOrder", { workOrderId: own }), 403, "NOT_ASSIGNED", "wrong-company technician");
      refused(await wo(techUnlinked.subject, "readWorkOrder", { workOrderId: own }), 403, "EMPLOYEE_LINK_REQUIRED", "unlinked (no Employee identity)");
      const unassignedWo = await mkWo();
      refused(await wo(techA.subject, "readWorkOrder", { workOrderId: unassignedWo }), 403, "NOT_ASSIGNED", "unassigned Work Order");
      refused(await wo(techA.subject, "listWorkOrders", {}), 403, "CAPABILITY_MISSING", "no tenant-wide queue for a conditioned holder");
      const mine = ok(await wo(techA.subject, "listMyAssignedWorkOrders"), "my list");
      assert.deepEqual(mine.items.map((w) => w.workOrderId), [own]);
      assert.equal(ok(await wo(techVentana.subject, "listMyAssignedWorkOrders"), "ventana list").items[0].workOrderId, ventanaWo,
        "the Ventana technician sees their own Ventana job and nothing of Taylor's");
    });

    await t.test("ASSIGNEE IDENTITY: a Principal id, an unlinked, an unqualified and a wrong-company Employee are refused", async () => {
      const id = await mkWo();
      ok(await wo(dispatcher.subject, "markWorkOrderReady", { workOrderId: id }), "ready");
      const at = { scheduledStart: start + 10 * HOUR, scheduledEnd: start + 11 * HOUR };
      for (const [employeeId, code] of [[techA.principalId, "EMPLOYEE_NOT_FOUND"], ["emp-sa-unqualified", "EMPLOYEE_NOT_ASSIGNABLE"],
        ["emp-sa-v", "EMPLOYEE_NOT_ELIGIBLE_FOR_OPERATING_COMPANY"]]) {
        const r = await wo(dispatcher.subject, "scheduleWorkOrder", { workOrderId: id, employeeId, ...at });
        assert.equal(r.body.code, code, `${employeeId}: ${JSON.stringify(r.body)}`);
      }
      refused(await wo(dispatcher.subject, "createWorkOrder", { operatingCompanyId: "acme", customerId: "c", locationId: "l", workOrderType: "PM", priority: 2 }),
        503, "OPERATING_COMPANY_KEY_NOT_BOUND", "a caller-supplied company that is not governed");
    });

    await t.test("TECHNICIAN never plans, schedules, dispatches, closes or controls the queue", async () => {
      for (const [operation, input] of [["setWorkOrderPartsPlan", { workOrderId: own, plan: [] }], ["markWorkOrderReady", { workOrderId: own }],
        ["dispatchWorkOrder", { workOrderId: own }], ["closeWorkOrder", { workOrderId: own }], ["cancelWorkOrder", { workOrderId: own, expectedStatus: "SCHEDULED" }],
        ["createWorkOrder", { operatingCompanyId: "taylor", customerId: "c", locationId: "l", workOrderType: "PM", priority: 2 }],
        ["listWorkOrderTechnicians", { workOrderId: own }], ["setWorkOrderEstimatedDuration", { workOrderId: own, estimatedDurationMinutes: 30 }]]) {
        refused(await wo(techA.subject, operation, input), 403, "CAPABILITY_MISSING", `technician ${operation}`);
      }
    });

    await t.test("PERSONA NEGATIVES: Sales cannot write Service, Parts cannot move the lifecycle, the Dispatcher still cannot sell", async () => {
      refused(await wo(sales.subject, "createWorkOrder", { operatingCompanyId: "taylor", customerId: "c", locationId: "l", workOrderType: "PM", priority: 2 }),
        403, "CAPABILITY_MISSING", "sales create");
      refused(await wo(sales.subject, "markWorkOrderReady", { workOrderId: own }), 403, "CAPABILITY_MISSING", "sales ready");
      for (const [operation, input] of [["markWorkOrderReady", { workOrderId: own }], ["scheduleWorkOrder", { workOrderId: own, employeeId: "emp-sa-a", scheduledStart: start, scheduledEnd: start + HOUR }],
        ["dispatchWorkOrder", { workOrderId: own }], ["closeWorkOrder", { workOrderId: own }]]) {
        refused(await wo(parts.subject, operation, input), 403, "CAPABILITY_MISSING", `parts ${operation}`);
      }
      // partsAssociate still holds workOrder.transition; the technician runtime edges are OWN-ASSIGNMENT per edge.
      ok(await wo(dispatcher.subject, "dispatchWorkOrder", { workOrderId: own }), "dispatch");
      refused(await wo(parts.subject, "acceptWorkOrder", { workOrderId: own }), 403, "EMPLOYEE_LINK_REQUIRED", "parts accept");
      // The dispatcher's commercial SELLING stays refused (D-A, O3): this packet grants nothing Commercial.
      const sell = await executeCommercialOperation({ reader: repo, pool },
        { caller: { externalSubject: dispatcher.subject, identityProvider: "firebase", requestedTenantId: null }, operation: "createSalesAgreement",
          input: { idempotencyKey: `k-${randomUUID()}`, opportunityId: "opp-missing" } });
      assert.deepEqual([sell.ok, sell.status, sell.code], [false, 403, "CAPABILITY_REQUIRED"], `the dispatcher does not sell: ${JSON.stringify(sell)}`);
      assert.equal(delta.SERVICE_ACTIVATION_GRANTS.some((g) => !g.capabilityKey.startsWith("workOrder.")), false);
    });

    await t.test("the TECHNICIAN records execution on their own job, and only there", async () => {
      ok(await wo(techA.subject, "acceptWorkOrder", { workOrderId: own }), "accept");
      for (const op of ["startWorkOrderTravel", "arriveAtWorkOrder", "startWorkOrderWork"]) ok(await wo(techA.subject, op, { workOrderId: own }), op);
      ok(await wo(techA.subject, "recordWorkOrderExecution", { workOrderId: own, idempotencyKey: "sa-1", note: "on site" }), "record");
      refused(await wo(techB.subject, "recordWorkOrderExecution", { workOrderId: own, idempotencyKey: "sa-2", note: "x" }), 403, "NOT_ASSIGNED", "other technician");
      assert.equal(ok(await wo(techA.subject, "completeWorkOrder", { workOrderId: own }), "complete").transition.toStatus, "COMPLETED");
      assert.equal(ok(await wo(serviceManager.subject, "closeWorkOrder", { workOrderId: own }), "close").toStatus, "CLOSED");
    });
  });
