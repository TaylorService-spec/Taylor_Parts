// WORK ORDER JOURNEY ACCEPTANCE -- the Service Office -> Dispatcher -> Technician journey end to end through the
// REAL transport (handleOperationsRequest on /operations/work-orders), real PostgreSQL, real Role grants resolved by
// resolveOperationalContext. Nothing is called below the HTTP seam, so what passes here is what the deployed API
// answers once the Work Order authority is activated.
//
// THE GRANTS ARE STATED. Personas hold what their governed Role holds in the committed baseline, PLUS -- clearly
// separated -- the pending Administration decisions this package asks for (PROPOSED_*). Refusals below prove the
// baseline alone does not reach them.
//
// Real PostgreSQL. Set POLICY_TEST_DATABASE_URL; without it the database half SKIPS.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { handleOperationsRequest, WORK_ORDER_ROUTE } = require("../lib/eosOps/eosOpsHttp.js");
const { WORK_ORDER_WRITER_AUTHORITY } = require("../lib/eosOps/workOrderWriterState.js");
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const BASELINE = JSON.parse(readFileSync(resolve(FUNCTIONS_DIR, "src/adminPolicy/seed/roleCapabilityAuthorityBaseline.json"), "utf8"));
const WO_KEYS = (roleKey) => BASELINE.grants.filter((g) => g.roleKey === roleKey && /^workOrder\./.test(g.capabilityKey)).map((g) => g.capabilityKey);

/** Pending Administration decisions (Decision Queue). */
const PROPOSED_OFFICE = ["workOrder.lifecycle.ready", "workOrder.lifecycle.schedule", "workOrder.lifecycle.close", "workOrder.parts.plan"];
const PROPOSED_TECHNICIAN = ["workOrder.execution.record"];

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}
const T = "t-wojourney";
const FIXTURE_ACTOR = "fixture";

test("Work Order journey acceptance through /operations/work-orders", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `wojrn_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations", "--no-check-order"],
    { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe" });
  pool = new pg.Pool({ connectionString: dbUrlFor(name), max: 8 });
  const q = (sql, v = []) => pool.query(sql, v);
  const repo = new PostgresPolicyRepository(pool);
  const fixtureActor = { tenantId: T, uid: FIXTURE_ACTOR };

  await q(`INSERT INTO eos_policy.tenants (id,key,name) VALUES ($1,$1,$1)`, [T]);
  for (const [company, key] of [["taylor", "taylor"], ["ventana", "ventana"]]) {
    await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id,operating_company_id,status,source,established_by,updated_by)
             VALUES ($1,$2,'ACTIVE','fixture','fixture','fixture')`, [T, company]);
    await q(`INSERT INTO eos_policy.tenant_operating_company_keys
               (tenant_id,operating_company_id,operating_company_key,status,provenance,source,established_by,updated_by)
             VALUES ($1,$2,$3,'ACTIVE','NATIVE','fixture','fixture','fixture')`, [T, company, key]);
  }
  await q(`INSERT INTO eos_crm.accounts (id,tenant_id,name,status,created_by,updated_by) VALUES ('acct-j',$1,'Journey Bistro','ACTIVE','f','f')`, [T]);
  await q(`INSERT INTO eos_crm.account_locations (id,tenant_id,account_id,name,address_street,created_by,updated_by)
           VALUES ('loc-j',$1,'acct-j','Journey Bistro Kitchen','9 Harbor Way','f','f')`, [T]);

  let roleN = 0;
  /** A signed-in persona: a Principal, ONE custom Role holding exactly `capabilities`, and optionally an Employee. */
  const persona = async ({ subject, capabilities, employee = null }) => {
    const principalId = await repo.transact(fixtureActor, async (tx) => {
      const p = await tx.createPrincipal({ externalSubject: subject, identityProvider: "eos" });
      await tx.createTenantMembership(p.id);
      return p.id;
    });
    roleN += 1;
    const role = await repo.transact(fixtureActor, (tx) =>
      tx.createRole({ key: `woJourney${roleN}`, name: `WO journey ${roleN}`, description: null, origin: "CUSTOM", protected: false }));
    for (const key of new Set(capabilities)) {
      const { rowCount } = await q(
        `INSERT INTO eos_policy.role_capabilities (id, tenant_id, role_id, capability_id, granted_by, created_by, updated_by)
         SELECT $1, $2, $3, c.id, $4, $4, $4 FROM eos_policy.capabilities c WHERE c.key = $5`,
        [`rc_${role.id}_${key}`, T, role.id, FIXTURE_ACTOR, key]);
      assert.equal(rowCount, 1, `no capability named "${key}"`);
    }
    await repo.transact(fixtureActor, async (tx) => {
      const av = await tx.bumpAccessVersion(principalId);
      return tx.createAssignment({ principalId, roleId: role.id, scopeType: "global", scopeValue: null, status: "active",
        grantedBy: FIXTURE_ACTOR, grantedAt: new Date().toISOString(), accessVersionAtGrant: av });
    });
    if (employee) {
      await q(`INSERT INTO eos_workforce.employees (id,tenant_id,employment_status,operating_company_id,display_name) VALUES ($1,$2,$3,$4,$5)`,
        [employee.id, T, employee.status ?? "ACTIVE", employee.company ?? "taylor", employee.name]);
      await q(`INSERT INTO eos_policy.employee_principal_links
                 (id,tenant_id,principal_id,employee_id,operating_company_id,link_source,status,asserted_by,assertion_reason)
               VALUES ($1,$2,$3,$4,$5,'OPERATOR_ASSERTED','active','fixture','journey fixture')`,
        [`lnk-${subject}`, T, principalId, employee.id, employee.company ?? "taylor"]);
      await q(`INSERT INTO eos_workforce.employee_work_eligibility (id,tenant_id,employee_id,qualification_code,effective_from,assigned_by)
               VALUES ($1,$2,$3,'SERVICE_TECHNICIAN',now(),'fixture')`, [`we-${subject}`, T, employee.id]);
    }
    return subject;
  };

  const SVC_MGR = await persona({ subject: "svcmgr", capabilities: [...WO_KEYS("fieldManager"), ...PROPOSED_OFFICE] });
  const SVC_MGR_BASELINE = await persona({ subject: "svcmgr-baseline", capabilities: WO_KEYS("fieldManager") });
  const DISPATCHER = await persona({ subject: "dispatcher", capabilities: [...WO_KEYS("dispatcher"), ...PROPOSED_OFFICE] });
  const TECH_A = await persona({ subject: "tech-a", capabilities: [...WO_KEYS("technician"), ...PROPOSED_TECHNICIAN],
    employee: { id: "emp-j-a", name: "Avery Tech" } });
  const TECH_B = await persona({ subject: "tech-b", capabilities: [...WO_KEYS("technician"), ...PROPOSED_TECHNICIAN],
    employee: { id: "emp-j-b", name: "Blake Tech" } });
  await persona({ subject: "tech-v", capabilities: WO_KEYS("technician"), employee: { id: "emp-j-v", name: "Val Ventana", company: "ventana" } });
  const NOBODY = await persona({ subject: "office-nobody", capabilities: [] });

  const call = async (subject, operation, input = {}, state = "ACTIVE") => {
    const res = await handleOperationsRequest({
      reader: repo, pool, ...(state === null ? {} : { workOrderPostgresState: state }),
      verifyToken: async (token) => ({ externalSubject: token, identityProvider: "eos" }),
    }, {
      method: "POST", url: WORK_ORDER_ROUTE,
      headers: { authorization: `Bearer ${subject}`, "content-type": "application/json" },
      body: JSON.stringify({ operation, input }),
    });
    return { status: res.status, body: JSON.parse(res.body) };
  };
  const ok = (r) => { assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.result; };
  const refused = (r, status, code) => { assert.equal(r.status, status, JSON.stringify(r.body)); assert.equal(r.body.code, code, JSON.stringify(r.body)); };
  const woCount = async () => (await q(`SELECT count(*)::int n FROM eos_ops.work_orders`)).rows[0].n;

  await t.test("DQ-S4: fail-closed while INACTIVE; the DEPLOYED default is now ACTIVE -- every operation but the probe refuses, and nothing is written", async () => {
    // UPDATED DELIBERATELY by the activation (Controller, 2026-09-30, step G): the DEPLOYED authority is PostgreSQL ACTIVE
    // with the Firestore writers FROZEN. The fail-closed behaviour is still proven, with INACTIVE stated explicitly.
    assert.deepEqual({ ...WORK_ORDER_WRITER_AUTHORITY }, { firestore: "FROZEN", postgres: "ACTIVE" });
    assert.deepEqual(ok(await call(SVC_MGR, "readWorkOrderAuthorityStatus", {}, null)), { postgres: "ACTIVE", readiness: "ACTIVE" });
    assert.deepEqual(ok(await call(SVC_MGR, "readWorkOrderAuthorityStatus", {}, "INACTIVE")), { postgres: "INACTIVE", readiness: "NOT_YET_ACTIVATED" });
    refused(await call(SVC_MGR, "createWorkOrder", { operatingCompanyId: "taylor", customerId: "acct-j", locationId: "loc-j", workOrderType: "SERVICE_CALL", priority: 2 }, "INACTIVE"), 503, "NOT_ACTIVATED");
    refused(await call(SVC_MGR, "listWorkOrders", {}, "INACTIVE"), 503, "NOT_ACTIVATED");
    assert.equal(await woCount(), 0);
  });

  await t.test("the transport refuses an unknown operation and an unauthenticated caller", async () => {
    const res = await handleOperationsRequest({ reader: repo, pool, workOrderPostgresState: "ACTIVE", verifyToken: async () => { throw new Error("bad"); } },
      { method: "POST", url: WORK_ORDER_ROUTE, headers: { authorization: "Bearer x" }, body: JSON.stringify({ operation: "listWorkOrders" }) });
    assert.equal(res.status, 401);
    refused(await call(SVC_MGR, "setWorkOrderStatus", {}), 404, "UNKNOWN_OPERATION");
    refused(await call(SVC_MGR, "recordWorkOrderEquipmentInstall", {}), 404, "UNKNOWN_OPERATION");
  });

  await t.test("SERVICE OFFICE: the company picker is governed -- ACTIVE and keyed only; create is idempotent by key", async () => {
    await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id,operating_company_id,status,source,established_by,updated_by)
             VALUES ($1,'unkeyed-co','ACTIVE','fixture','fixture','fixture')`, [T]);
    const companies = ok(await call(SVC_MGR, "listWorkOrderOperatingCompanies"));
    assert.deepEqual(companies.items.map((c) => c.operatingCompanyId), ["taylor", "ventana"], "an ACTIVE but unkeyed company is not offered");
    refused(await call(NOBODY, "listWorkOrderOperatingCompanies"), 403, "CAPABILITY_MISSING");
    const req = { operatingCompanyId: "taylor", customerId: "acct-j", locationId: "loc-j", workOrderType: "INSPECTION", priority: 4, idempotencyKey: "wiz-1" };
    const before = await woCount();
    const first = ok(await call(SVC_MGR, "createWorkOrder", req));
    const again = ok(await call(SVC_MGR, "createWorkOrder", req));
    assert.equal(first.replayed, false);
    assert.deepEqual([again.replayed, again.workOrderId, again.workOrderNumber], [true, first.workOrderId, first.workOrderNumber]);
    assert.equal(await woCount(), before + 1, "a retried create mints no duplicate and burns no number");
    refused(await call(SVC_MGR, "createWorkOrder", { ...req, priority: 1 }), 409, "IDEMPOTENCY_KEY_REUSED");
    ok(await call(SVC_MGR, "cancelWorkOrder", { workOrderId: first.workOrderId, expectedStatus: "CREATED", note: "idempotency fixture" }));
  });

  let woId;
  await t.test("SERVICE OFFICE: create (company stated, never inferred) -> ready -> plan parts", async () => {
    refused(await call(NOBODY, "createWorkOrder", { operatingCompanyId: "taylor", customerId: "acct-j", locationId: "loc-j", workOrderType: "SERVICE_CALL", priority: 2 }), 403, "CAPABILITY_MISSING");
    refused(await call(SVC_MGR, "createWorkOrder", { customerId: "acct-j", locationId: "loc-j", workOrderType: "SERVICE_CALL", priority: 2 }), 400, "OPERATING_COMPANY_REQUIRED");
    const created = ok(await call(SVC_MGR, "createWorkOrder",
      { operatingCompanyId: "taylor", customerId: "acct-j", locationId: "loc-j", workOrderType: "SERVICE_CALL", priority: 1, complaint: "walk-in cooler warm" }));
    woId = created.workOrderId;
    assert.match(created.workOrderNumber, /^WO-\d{4}-\d{6}$/);
    refused(await call(SVC_MGR_BASELINE, "markWorkOrderReady", { workOrderId: woId }), 403, "CAPABILITY_MISSING");
    assert.equal(ok(await call(SVC_MGR, "markWorkOrderReady", { workOrderId: woId })).toStatus, "READY_TO_DISPATCH");
    await q(`INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status, stocking_unit, control_type, stocking_class,
               expiry_tracked, consumable, returnable_core, whole_unit, version, updated_by)
             VALUES ('part-comp', $1, 'seed', 'COMP-1', 'Compressor relay', 'ACTIVE', 'EACH', 'STANDARD', 'STOCKED', false, false, false, false, 1, 'seed')`, [T]);
    ok(await call(SVC_MGR, "setWorkOrderPartsPlan", { workOrderId: woId, plan: [{ partId: "part-comp", qtyPlanned: 2 }] }));
  });

  await t.test("DISPATCHER: the picker offers only eligible technicians of the Work Order's company; schedule; dispatch", async () => {
    const techs = ok(await call(DISPATCHER, "listWorkOrderTechnicians", { workOrderId: woId }));
    assert.deepEqual(techs.items.map((e) => e.employeeId).sort(), ["emp-j-a", "emp-j-b"], "the Ventana technician is not offered (DQ-013)");
    // DECISION 5 (Owner, 2026-09-30): without configured working hours the schedule below REFUSES
    // AVAILABILITY_NOT_CONFIGURED -- proven first, then EXPLICIT synthetic acceptance hours are configured by the
    // dispatcher through the governed operation on this same route.
    const start = Date.now() + 2 * 86_400_000;
    refused(await call(DISPATCHER, "scheduleWorkOrder", { workOrderId: woId, employeeId: "emp-j-a", scheduledStart: start, scheduledEnd: start + 7_200_000 }),
      412, "AVAILABILITY_NOT_CONFIGURED");
    const allWeek = Object.fromEntries(["0", "1", "2", "3", "4", "5", "6"].map((d) => [d, [{ start: "00:00", end: "24:00" }]]));
    ok(await call(DISPATCHER, "setTechnicianWorkingHours",
      { employeeId: "emp-j-a", timeZone: "UTC", weeklyHours: allWeek, reason: "synthetic acceptance availability" }));
    const sched = ok(await call(DISPATCHER, "scheduleWorkOrder", { workOrderId: woId, employeeId: "emp-j-a", scheduledStart: start, scheduledEnd: start + 7_200_000 }));
    assert.equal(sched.transition.toStatus, "SCHEDULED");
    // DECISION 5: the calendar was consulted; a placement inside it carries no warning (AVAILABILITY_NOT_MODELED is gone).
    assert.deepEqual(sched.warnings.map((w) => w.code), []);
    refused(await call(DISPATCHER, "scheduleWorkOrder", { workOrderId: woId, employeeId: "emp-j-v", scheduledStart: start, scheduledEnd: start + 3_600_000 }), 409, "STALE_WORK_ORDER_STATE");
    const d = ok(await call(DISPATCHER, "dispatchWorkOrder", { workOrderId: woId }));
    assert.equal(d.transition.toStatus, "DISPATCHED");
    assert.match(d.inventoryBoundary, /^RESERVE_NOT_APPLIED/);
  });

  await t.test("TECHNICIAN: sees only their own work (DQ-016 by the governed assignment); another technician is refused", async () => {
    const mine = ok(await call(TECH_A, "listMyAssignedWorkOrders"));
    assert.equal(mine.employeeId, "emp-j-a");
    assert.deepEqual(mine.items.map((w) => w.workOrderId), [woId]);
    assert.equal(mine.items[0].customerName, "Journey Bistro");
    assert.deepEqual(ok(await call(TECH_B, "listMyAssignedWorkOrders")).items, []);
    refused(await call(TECH_B, "acceptWorkOrder", { workOrderId: woId }), 403, "NOT_ASSIGNED");
    refused(await call(TECH_B, "recordWorkOrderExecution", { workOrderId: woId, idempotencyKey: "b1", note: "x" }), 403, "NOT_ASSIGNED");
  });

  await t.test("TECHNICIAN: accept -> travel -> arrive -> start -> record actuals -> complete", async () => {
    for (const op of ["acceptWorkOrder", "startWorkOrderTravel", "arriveAtWorkOrder", "startWorkOrderWork"]) ok(await call(TECH_A, op, { workOrderId: woId }));
    const ex = ok(await call(TECH_A, "recordWorkOrderExecution",
      { workOrderId: woId, idempotencyKey: "a1", partUsage: [{ partId: "part-comp", qtyDelta: 1 }], note: "relay replaced; cooler at 38F" }));
    assert.deepEqual([ex.usage[0].qtyUsed, ex.inventoryBoundary], [1, "NO_STOCK_MOVEMENT"]);
    const done = ok(await call(TECH_A, "completeWorkOrder", { workOrderId: woId, note: "complete" }));
    assert.equal(done.transition.toStatus, "COMPLETED");
    assert.match(done.inventoryBoundary, /^CONSUME_NOT_APPLIED/);
    refused(await call(TECH_A, "completeWorkOrder", { workOrderId: woId }), 409, "STALE_WORK_ORDER_STATE");
  });

  await t.test("SERVICE OFFICE: the detail shows the whole job; close", async () => {
    const d = ok(await call(SVC_MGR, "readWorkOrder", { workOrderId: woId }));
    assert.equal(d.status, "COMPLETED");
    assert.equal(d.assigneeDisplayName, "Avery Tech");
    assert.deepEqual(d.execution.parts, [{ partId: "part-comp", qtyPlanned: 2, qtyUsed: 1 }]);
    assert.deepEqual(d.execution.notes.map((n) => n.note), ["relay replaced; cooler at 38F"]);
    assert.deepEqual(d.transitions.map((x) => x.action),
      ["create", "markReadyToDispatch", "schedule", "dispatch", "accept", "startTravel", "arrive", "startWork", "complete"]);
    for (const k of ["dispatchedAt", "acceptedAt", "enRouteAt", "arrivedAt", "workStartedAt", "completedAt"]) assert.ok(d.timestamps[k], k);
    assert.equal(ok(await call(SVC_MGR, "closeWorkOrder", { workOrderId: woId })).toStatus, "CLOSED");
    refused(await call(NOBODY, "readWorkOrder", { workOrderId: woId }), 403, "CAPABILITY_MISSING");
  });

  await t.test("OFFICE queue and cancel: the list filters; cancel states its expected status and its release boundary", async () => {
    const other = ok(await call(SVC_MGR, "createWorkOrder", { operatingCompanyId: "taylor", customerId: "acct-j", locationId: "loc-j", workOrderType: "PM", priority: 3 }));
    const list = ok(await call(DISPATCHER, "listWorkOrders", { search: "Journey", statuses: ["CREATED", "CLOSED"] }));
    assert.deepEqual(list.items.map((w) => w.workOrderId).sort(), [woId, other.workOrderId].sort());
    refused(await call(SVC_MGR, "cancelWorkOrder", { workOrderId: other.workOrderId, expectedStatus: "SCHEDULED" }), 409, "STALE_WORK_ORDER_STATE");
    const c = ok(await call(SVC_MGR, "cancelWorkOrder", { workOrderId: other.workOrderId, expectedStatus: "CREATED", note: "duplicate" }));
    assert.match(c.inventoryBoundary, /^RELEASE_NOT_APPLIED/);
    // DQ-016 IS AN ADMINISTRATION ACT STILL PENDING: the technician's workOrder.record.read grant is UNCONDITIONED in
    // the baseline, so today the technician can read the office queue. Once Administration conditions that grant to
    // Employee + RECORD_ASSIGNMENT (setGrantCondition), this becomes CAPABILITY_MISSING -- proven in
    // workOrderDomainCutoverPostgres.test.mjs. Pinned here so the pending decision is visible, not assumed.
    assert.equal((await call(TECH_A, "listWorkOrders", {})).status, 200);
  });
});
