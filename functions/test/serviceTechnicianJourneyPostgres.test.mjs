// THE SERVICE OFFICE + TECHNICIAN JOURNEY, END TO END, WITH ITS NEGATIVES (Owner WORK ORDER CUTOVER COMPLETION PASS,
// 2026-09-30, "LOCAL SERVICE JOURNEY ACCEPTANCE" and "NEGATIVE ACCEPTANCE").
//
// LIVE-EQUIVALENT: a BASELINE-EQUAL tenant (the authority baseline's own rebuild pipeline, phases A-E), the recorded
// nonprod decision D-A replayed, then the Service activation authority packet (DECISIONS 1-2, DQ-016) applied through
// the Administration API -- the state the activation window produces. Every call below goes through the REAL transport
// (handleOperationsRequest) with the Work Order authority ACTIVE, as signed-in principals holding canonical Security
// Roles. Synthetic availability is configured explicitly (DECISION 5).
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
const http = require("../lib/eosOps/eosOpsHttp.js");
const lifecycle = require("../lib/eosOps/workOrderLifecycle.js");
const { executeCommercialOperation } = require("../lib/eosCommercial/commercialHttp.js");

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

const TENANT = "t-service-journey";
const OPERATOR = "operator-service-journey";
const ADMIN_SUBJECT = "uid-sj-admin";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ROUND_THE_CLOCK = Object.fromEntries(["0", "1", "2", "3", "4", "5", "6"].map((d) => [d, [{ start: "00:00", end: "24:00" }]]));
const NINE_TO_FIVE = Object.fromEntries(["0", "1", "2", "3", "4", "5", "6"].map((d) => [d, [{ start: "09:00", end: "17:00" }]]));

test("the Service Office + Technician journey through the EOS API", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `sj_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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
  for (const [pairs, by] of [[baseline.GLOBAL_CATALOG_ACTIVATED_GRANTS, "canonical-catalog:sj"], [baseline.NONPROD_ACTIVATED_CAPABILITY_GRANTS, "nonprod-activation:sj"]]) {
    for (const { roleKey, capabilityKey } of pairs) {
      await q(`INSERT INTO eos_policy.role_capabilities (id,tenant_id,role_id,capability_id,granted_by,created_by,updated_by)
               SELECT 'rc_sj_' || substr(md5($1 || r.id || c.id), 1, 24), $1, r.id, c.id, $4, $4, $4
                 FROM eos_policy.roles r, eos_policy.capabilities c WHERE r.tenant_id = $1 AND r.key = $2 AND c.key = $3
               ON CONFLICT (tenant_id, role_id, capability_id) DO NOTHING`, [TENANT, roleKey, capabilityKey, by]);
    }
  }
  for (const [company, key] of [["taylor", "taylor"], ["ventana", "ventana"]]) {
    await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id,operating_company_id,status,source,established_by,updated_by)
             VALUES ($1,$2,'ACTIVE','fixture','fixture','fixture')`, [TENANT, company]);
    await q(`INSERT INTO eos_policy.tenant_operating_company_keys (tenant_id,operating_company_id,operating_company_key,status,provenance,source,established_by,updated_by)
             VALUES ($1,$2,$3,'ACTIVE','NATIVE','fixture','fixture','fixture')`, [TENANT, company, key]);
  }
  // The CRM customer and site (PostgreSQL CRM is ACTIVE), and a Catalog Part (PostgreSQL Catalog is ACTIVE).
  await q(`INSERT INTO eos_crm.accounts (id,tenant_id,name,status,created_by,updated_by) VALUES ('acct-sj',$1,'Summit Grill','ACTIVE','f','f')`, [TENANT]);
  await q(`INSERT INTO eos_crm.account_locations (id,tenant_id,account_id,name,address_street,address_city,created_by,updated_by)
           VALUES ('loc-sj',$1,'acct-sj','Summit Grill Kitchen','4 Ridge Rd','Concord','f','f')`, [TENANT]);
  await q(`INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status, stocking_unit, control_type, stocking_class,
             expiry_tracked, consumable, returnable_core, whole_unit, version, updated_by)
           VALUES ('part-sj', $1, 'seed', 'EVAP-9', 'Evaporator fan motor', 'ACTIVE', 'EACH', 'STANDARD', 'STOCKED', false, false, false, false, 1, 'seed')`, [TENANT]);

  await bootstrapAdministrator(repo, { tenantId: TENANT, externalSubject: ADMIN_SUBJECT, performedBy: OPERATOR, reason: "initial administrator" });
  const admin = (operation, input) => executeAdminOperation({ repo },
    { caller: { externalSubject: ADMIN_SUBJECT, identityProvider: "firebase" }, operation, input, requestId: `r-${randomUUID()}` });
  for (const [objectKey, actionKey] of [["opportunity", "edit"], ["opportunity", "createSalesOrder"], ["salesAgreement", "create"],
    ["salesAgreement", "edit"], ["salesAgreement", "accept"], ["salesOrder", "edit"]]) {
    assert.equal((await admin("revokeObjectActionFromRole", { roleKey: "dispatcher", objectKey, actionKey, reason: "D-A replayed" })).ok, true);
  }
  for (const { operation, input } of delta.serviceActivationOperations()) assert.equal((await admin(operation, input)).ok, true, operation);

  const roleId = async (key) => (await repo.getRoleByKey(TENANT, key)).id;
  const person = async (subject, roleKeys, employee = null) => {
    const made = await ensureTenantPrincipal(repo, { tenantId: TENANT, externalSubject: subject, actorUid: OPERATOR, actorRoleKeys: ["admin"] });
    const principalId = made.principal?.id ?? made.id ?? made.principalId;
    for (const key of roleKeys) assert.equal((await admin("assignRole", { principalId, roleId: await roleId(key), reason: "staffing" })).ok, true, key);
    if (employee) {
      await q(`INSERT INTO eos_workforce.employees (id,tenant_id,employment_status,operating_company_id,display_name) VALUES ($1,$2,'ACTIVE',$3,$4)`,
        [employee.id, TENANT, employee.company ?? "taylor", employee.name ?? employee.id]);
      if (employee.linked !== false) {
        await q(`INSERT INTO eos_policy.employee_principal_links (id,tenant_id,principal_id,employee_id,operating_company_id,link_source,status,asserted_by,assertion_reason)
                 VALUES ($1,$2,$3,$4,$5,'OPERATOR_ASSERTED','active','fixture','journey')`, [`lnk-${employee.id}`, TENANT, principalId, employee.id, employee.company ?? "taylor"]);
      }
      if (employee.qualified !== false) {
        await q(`INSERT INTO eos_workforce.employee_work_eligibility (id,tenant_id,employee_id,qualification_code,effective_from,assigned_by,reason)
                 VALUES ($1,$2,$3,'SERVICE_TECHNICIAN',now(),'fixture','journey')`, [`we-${employee.id}`, TENANT, employee.id]);
      }
    }
    return { subject, principalId };
  };
  const office = await person("uid-sj-fieldmgr", ["fieldManager"]);
  const dispatcher = await person("uid-sj-dispatcher", ["dispatcher"]);
  const techA = await person("uid-sj-tech-a", ["technician"], { id: "emp-sj-a", name: "Alex Field" });
  const techB = await person("uid-sj-tech-b", ["technician"], { id: "emp-sj-b", name: "Bo Field" });
  const techV = await person("uid-sj-tech-v", ["technician"], { id: "emp-sj-v", company: "ventana" });
  await person("uid-sj-tech-n", ["technician"], { id: "emp-sj-nine" });
  const sales = await person("uid-sj-sales", ["salesperson"]);
  const parts = await person("uid-sj-parts", ["partsAssociate", "inventoryReceivingClerk"]);
  await q(`INSERT INTO eos_workforce.employees (id,tenant_id,employment_status,operating_company_id) VALUES ('emp-sj-unqualified',$1,'ACTIVE','taylor'),('emp-sj-unlinked',$1,'ACTIVE','taylor')`, [TENANT]);
  await q(`INSERT INTO eos_workforce.employee_work_eligibility (id,tenant_id,employee_id,qualification_code,effective_from,assigned_by,reason)
           VALUES ('we-unlinked',$1,'emp-sj-unlinked','SERVICE_TECHNICIAN',now(),'f','f')`, [TENANT]);

  const call = async (who, route, operation, input = {}, stateOverride = { workOrderPostgresState: "ACTIVE" }) => {
    const res = await http.handleOperationsRequest({ reader: repo, pool, ...stateOverride,
      verifyToken: async (token) => ({ externalSubject: token, identityProvider: "firebase" }) },
    { method: "POST", url: route, headers: { authorization: `Bearer ${who.subject}` }, body: JSON.stringify({ operation, input }) });
    return { status: res.status, body: JSON.parse(res.body) };
  };
  const wo = (who, operation, input) => call(who, http.WORK_ORDER_ROUTE, operation, input);
  const ok = (r, what) => { assert.equal(r.status, 200, `${what}: ${JSON.stringify(r.body)}`); return r.body.result; };
  const refused = (r, status, code, what) => assert.deepEqual([r.status, r.body.code], [status, code], `${what}: ${JSON.stringify(r.body)}`);
  const invCount = async () => Number((await q(`SELECT count(*)::int n FROM eos_ops.inventory_commitments`)).rows[0].n);

  const day0 = new Date(Date.now() + 3 * DAY); day0.setUTCHours(0, 0, 0, 0);
  const at = (dayOffset, hour, hours = 2) => ({ scheduledStart: day0.getTime() + dayOffset * DAY + hour * HOUR, scheduledEnd: day0.getTime() + dayOffset * DAY + (hour + hours) * HOUR });
  const created = (r) => ok(r, "create").workOrderId;
  const CREATE = { operatingCompanyId: "taylor", customerId: "acct-sj", locationId: "loc-sj", workOrderType: "SERVICE_CALL", priority: 1, complaint: "walk-in freezer icing" };

  let woId;
  await t.test("SERVICE OFFICE: availability, customer/site, create (idempotent), readiness, parts plan", async () => {
    for (const employeeId of ["emp-sj-a", "emp-sj-b", "emp-sj-v"]) {
      ok(await wo(office, "setTechnicianWorkingHours", { employeeId, timeZone: "UTC", weeklyHours: ROUND_THE_CLOCK, reason: "synthetic acceptance availability" }), "hours");
    }
    ok(await wo(office, "setTechnicianWorkingHours", { employeeId: "emp-sj-nine", timeZone: "UTC", weeklyHours: NINE_TO_FIVE, reason: "synthetic day shift" }), "9-5");
    ok(await wo(office, "recordTechnicianUnavailability", { employeeId: "emp-sj-b", kind: "PTO", start: day0.getTime() + 5 * DAY, end: day0.getTime() + 6 * DAY, reason: "vacation" }), "PTO");
    assert.deepEqual(ok(await wo(office, "listWorkOrderOperatingCompanies"), "companies").items.map((c) => c.operatingCompanyId), ["taylor", "ventana"]);
    const first = ok(await wo(office, "createWorkOrder", { ...CREATE, idempotencyKey: "sj-create-1" }), "create");
    const again = ok(await wo(office, "createWorkOrder", { ...CREATE, idempotencyKey: "sj-create-1" }), "replay");
    assert.deepEqual([again.replayed, again.workOrderId], [true, first.workOrderId], "a duplicate create replays; no second Work Order");
    woId = first.workOrderId;
    const readiness = ok(await wo(office, "readWorkOrderReadiness", { workOrderId: woId }), "readiness");
    assert.equal(readiness.inventory.state, "NOT_YET_ACTIVATED", "the inventory boundary says so, and invents no balance");
    ok(await wo(office, "markWorkOrderReady", { workOrderId: woId }), "ready");
    ok(await wo(office, "setWorkOrderPartsPlan", { workOrderId: woId, plan: [{ partId: "part-sj", qtyPlanned: 2 }] }), "plan");
    ok(await wo(office, "setWorkOrderEstimatedDuration", { workOrderId: woId, estimatedDurationMinutes: 120 }), "estimate");
  });

  await t.test("SERVICE OFFICE: schedule -> reschedule -> unschedule -> schedule -> dispatch; the queue shows it", async () => {
    const techs = ok(await wo(dispatcher, "listWorkOrderTechnicians", { workOrderId: woId }), "picker").items.map((e) => e.employeeId);
    assert.equal(techs.includes("emp-sj-v"), false, "no wrong-company technician is offered");
    const slots = ok(await wo(dispatcher, "findAvailableTechnicianSlots", { operatingCompanyId: "taylor", durationMinutes: 120,
      earliestDate: new Date(day0.getTime() + DAY).toISOString().slice(0, 10), timeZone: "UTC", horizonDays: 3 }), "slots");
    assert.ok(slots.slots.length > 0);
    const s1 = at(1, 10);
    ok(await wo(dispatcher, "scheduleWorkOrder", { workOrderId: woId, employeeId: "emp-sj-a", ...s1 }), "schedule");
    const s2 = at(2, 10);
    ok(await wo(dispatcher, "rescheduleWorkOrder", { workOrderId: woId, expectedScheduledStart: s1.scheduledStart, ...s2, reason: "customer asked for Thursday" }), "reschedule");
    ok(await wo(dispatcher, "unscheduleWorkOrder", { workOrderId: woId, reason: "parts not in yet" }), "unschedule");
    ok(await wo(dispatcher, "scheduleWorkOrder", { workOrderId: woId, employeeId: "emp-sj-a", ...s2 }), "schedule again");
    const d = ok(await wo(dispatcher, "dispatchWorkOrder", { workOrderId: woId }), "dispatch");
    assert.match(d.inventoryBoundary, /^RESERVE_NOT_APPLIED/);
    const queue = ok(await wo(office, "listWorkOrders", { statuses: ["DISPATCHED"] }), "queue");
    assert.deepEqual(queue.items.map((w) => w.workOrderId), [woId]);
  });

  await t.test("TECHNICIAN: own list -> field context -> accept/travel/arrive/start -> labor -> actuals + notes -> complete", async () => {
    const mine = ok(await wo(techA, "listMyAssignedWorkOrders"), "mine");
    assert.deepEqual(mine.items.map((w) => w.workOrderId), [woId]);
    const ctx = ok(await wo(techA, "readWorkOrderFieldContext", { workOrderId: woId }), "field context");
    assert.equal(ctx.customer.displayName, "Summit Grill");
    assert.equal(ctx.inventory.state, "NOT_YET_ACTIVATED");
    assert.equal(ctx.parts.lines[0].name, "Evaporator fan motor");
    for (const op of ["acceptWorkOrder", "startWorkOrderTravel", "arriveAtWorkOrder", "startWorkOrderWork"]) ok(await wo(techA, op, { workOrderId: woId }), op);
    const labor = ok(await wo(techA, "recordWorkOrderLabor", { workOrderId: woId, idempotencyKey: "sj-labor-1", laborType: "ONSITE", entryKind: "DURATION",
      durationMinutes: 95, workDate: new Date().toISOString().slice(0, 10) }), "labor");
    assert.equal(labor.employeeId, "emp-sj-a", "Employee is the subject of the labor");
    const before = await invCount();
    const ex = ok(await wo(techA, "recordWorkOrderExecution", { workOrderId: woId, idempotencyKey: "sj-ex-1", partUsage: [{ partId: "part-sj", qtyDelta: 1 }],
      note: "replaced evaporator fan motor; defrost cycle normal" }), "execution");
    assert.equal(ex.inventoryBoundary, "NO_STOCK_MOVEMENT");
    const done = ok(await wo(techA, "completeWorkOrder", { workOrderId: woId, note: "done" }), "complete");
    assert.match(done.inventoryBoundary, /^CONSUME_NOT_APPLIED/);
    assert.equal(await invCount(), before, "no stock moved: Inventory authority is not active");
    refused(await wo(techA, "completeWorkOrder", { workOrderId: woId }), 409, "STALE_WORK_ORDER_STATE", "duplicate completion");
  });

  await t.test("SERVICE OFFICE: the job, its labor and the KPIs; close", async () => {
    const d = ok(await wo(office, "readWorkOrder", { workOrderId: woId }), "detail");
    assert.deepEqual(d.execution.parts, [{ partId: "part-sj", qtyPlanned: 2, qtyUsed: 1 }]);
    assert.equal(d.estimatedDurationMinutes, 120);
    const labor = ok(await wo(office, "readWorkOrderLabor", { workOrderId: woId }), "labor read");
    assert.equal(labor.totals.totalMinutes, 95);
    const volume = ok(await wo(office, "readTechnicianVolumeBreakdown"), "volume");
    assert.ok(JSON.stringify(volume).includes("emp-sj-a"));
    const consumption = ok(await wo(office, "readWorkOrderConsumptionSnapshot"), "consumption");
    assert.ok(JSON.stringify(consumption).includes("part-sj"));
    assert.equal(ok(await wo(office, "closeWorkOrder", { workOrderId: woId }), "close").toStatus, "CLOSED");
  });

  await t.test("CANCELLATION PATH: a dispatched job is cancelled from the status the office saw; nothing is released because nothing was reserved", async () => {
    const id = created(await wo(office, "createWorkOrder", { ...CREATE, workOrderType: "PM", priority: 3 }));
    ok(await wo(office, "markWorkOrderReady", { workOrderId: id }), "ready");
    ok(await wo(dispatcher, "scheduleWorkOrder", { workOrderId: id, employeeId: "emp-sj-a", ...at(3, 12) }), "schedule");
    ok(await wo(dispatcher, "dispatchWorkOrder", { workOrderId: id }), "dispatch");
    refused(await wo(dispatcher, "cancelWorkOrder", { workOrderId: id, expectedStatus: "SCHEDULED" }), 409, "STALE_WORK_ORDER_STATE", "stale version");
    const c = ok(await wo(dispatcher, "cancelWorkOrder", { workOrderId: id, expectedStatus: "DISPATCHED", note: "customer cancelled" }), "cancel");
    assert.match(c.inventoryBoundary, /^RELEASE_NOT_APPLIED/);
  });

  await t.test("NEGATIVES: technicians, identities, personas, company, transitions", async () => {
    const id = created(await wo(office, "createWorkOrder", CREATE));
    ok(await wo(office, "markWorkOrderReady", { workOrderId: id }), "ready");
    ok(await wo(dispatcher, "scheduleWorkOrder", { workOrderId: id, employeeId: "emp-sj-a", ...at(4, 10) }), "schedule");
    const unassigned = created(await wo(office, "createWorkOrder", CREATE));
    refused(await wo(techB, "readWorkOrder", { workOrderId: unassigned }), 403, "NOT_ASSIGNED", "unassigned technician");
    refused(await wo(techB, "readWorkOrder", { workOrderId: id }), 403, "NOT_ASSIGNED", "different technician");
    refused(await wo(techV, "readWorkOrder", { workOrderId: id }), 403, "NOT_ASSIGNED", "wrong-company technician");
    ok(await wo(office, "markWorkOrderReady", { workOrderId: unassigned }), "ready 2");
    const w = at(6, 10);
    for (const [employeeId, code, what] of [["emp-sj-unqualified", "EMPLOYEE_NOT_ASSIGNABLE", "ineligible Employee"],
      ["emp-sj-unlinked", "EMPLOYEE_NOT_ASSIGNABLE", "unlinked Employee"], [techA.principalId, "EMPLOYEE_NOT_FOUND", "Principal id as Employee"]]) {
      assert.equal((await wo(dispatcher, "scheduleWorkOrder", { workOrderId: unassigned, employeeId, ...w })).body.code, code, what);
    }
    refused(await wo(sales, "createWorkOrder", CREATE), 403, "CAPABILITY_MISSING", "Sales persona Service write");
    refused(await wo(parts, "dispatchWorkOrder", { workOrderId: id }), 403, "CAPABILITY_MISSING", "Parts persona lifecycle write");
    const sell = await executeCommercialOperation({ reader: repo, pool }, { caller: { externalSubject: dispatcher.subject, identityProvider: "firebase", requestedTenantId: null },
      operation: "createSalesAgreement", input: { idempotencyKey: `k-${randomUUID()}`, opportunityId: "opp-x" } });
    assert.deepEqual([sell.status, sell.code], [403, "CAPABILITY_REQUIRED"], "the Dispatcher's commercial selling stays refused");
    refused(await wo(office, "createWorkOrder", { ...CREATE, operatingCompanyId: "acme" }), 503, "OPERATING_COMPANY_KEY_NOT_BOUND", "a caller-supplied company that is not governed");
    refused(await wo(office, "createWorkOrder", { ...CREATE, operatingCompanyKey: "taylor" }), 400, "SERVER_AUTHORED_FIELD_REJECTED", "a forged company key");
    await assert.rejects(lifecycle.transitionWorkOrder({ pool }, { tenantId: TENANT, principalId: office.principalId, capabilities: new Set(["workOrder.lifecycle.close"]) },
      { workOrderId: unassigned, expectedStatus: "READY_TO_DISPATCH", toStatus: "COMPLETED" }), (e) => e.code === "TRANSITION_NOT_ALLOWED", "illegal transition");
  });

  await t.test("NEGATIVES: availability -- blocked, outside working hours, overlapping Work Order", async () => {
    const mk = async () => { const id = created(await wo(office, "createWorkOrder", CREATE)); ok(await wo(office, "markWorkOrderReady", { workOrderId: id }), "ready"); return id; };
    const blocked = await mk();
    refused(await wo(dispatcher, "scheduleWorkOrder", { workOrderId: blocked, employeeId: "emp-sj-b", ...at(5, 10) }), 412, "TECHNICIAN_UNAVAILABLE", "blocked technician");
    refused(await wo(dispatcher, "scheduleWorkOrder", { workOrderId: blocked, employeeId: "emp-sj-nine", ...at(5, 20) }), 412, "OUTSIDE_WORKING_HOURS", "outside working hours");
    const overlap = await mk();
    refused(await wo(dispatcher, "scheduleWorkOrder", { workOrderId: overlap, employeeId: "emp-sj-a", ...at(4, 11) }), 412, "SCHEDULE_CONFLICT", "overlapping Work Order");
  });

  await t.test("DQ-015: an unlinked Work Order completes exactly once; a Sales-Order-linked one refuses ATOMICALLY", async () => {
    const linked = created(await wo(office, "createWorkOrder", { ...CREATE, salesOrderId: "so-sj-1" }));
    ok(await wo(office, "markWorkOrderReady", { workOrderId: linked }), "ready");
    ok(await wo(dispatcher, "scheduleWorkOrder", { workOrderId: linked, employeeId: "emp-sj-a", ...at(7, 10) }), "schedule");
    ok(await wo(dispatcher, "dispatchWorkOrder", { workOrderId: linked }), "dispatch");
    for (const op of ["acceptWorkOrder", "startWorkOrderTravel", "arriveAtWorkOrder", "startWorkOrderWork"]) ok(await wo(techA, op, { workOrderId: linked }), op);
    const snap = async () => (await q(`SELECT status::text s, completed_at, (SELECT count(*)::int FROM eos_ops.work_order_transitions t WHERE t.work_order_id=w.id) n
                                         FROM eos_ops.work_orders w WHERE id=$1`, [linked])).rows[0];
    const before = await snap();
    const commercialBefore = (await q(`SELECT count(*)::int n FROM eos_commercial.sales_order_lines`)).rows[0].n;
    for (let i = 0; i < 2; i += 1) {
      refused(await wo(techA, "completeWorkOrder", { workOrderId: linked }), 503, "SALES_ORDER_FULFILLMENT_AUTHORITY_UNAVAILABLE", `attempt ${i}`);
    }
    assert.deepEqual(await snap(), before, "no partial Work Order completion, no transition, no replay side effect");
    assert.equal((await q(`SELECT count(*)::int n FROM eos_commercial.sales_order_lines`)).rows[0].n, commercialBefore, "no Commercial mutation");
  });

  await t.test("HELD BOUNDARIES: inventory mutation and serialized install answer NOT_ACTIVATED; no Firebase fallback exists", async () => {
    const reloc = await call(parts, http.RELOCATION_ROUTE, "relocateStock", {}, {});
    refused(reloc, 503, "NOT_ACTIVATED", "stock relocation while Inventory authority is inactive");
    const transfer = await call(parts, http.TRANSFER_ROUTE, "createTransfer", {}, {});
    refused(transfer, 503, "NOT_ACTIVATED", "transfer while Inventory authority is inactive");
    const acquire = await call(parts, http.SERIALIZED_ASSET_ROUTE, "acquireSerializedAsset", {}, {});
    refused(acquire, 503, "NOT_ACTIVATED", "serialized custody while Inventory authority is inactive");
    refused(await wo(techA, "recordWorkOrderEquipmentInstall", { workOrderId: woId }), 404, "UNKNOWN_OPERATION", "no serialized install on the Work Order route");
  });

  await t.test("QUARANTINE: a pinned Work Order is in no queue, search or technician list, and refuses every operation", async () => {
    const id = created(await wo(office, "createWorkOrder", CREATE));
    ok(await wo(office, "markWorkOrderReady", { workOrderId: id }), "ready");
    ok(await wo(dispatcher, "scheduleWorkOrder", { workOrderId: id, employeeId: "emp-sj-b", ...at(8, 10) }), "schedule");
    // The pinned-set CHECK names only the thirteen nonprod rows; it is relaxed HERE ONLY so a synthetic row can be pinned
    // with its own real fingerprint (the pin trigger stays on).
    await q(`ALTER TABLE eos_ops.work_order_quarantine DROP CONSTRAINT wo_quarantine_exact_pinned_set`);
    await q(`INSERT INTO eos_ops.work_order_quarantine (tenant_id,work_order_id,work_order_number,fingerprint,classification,reason,provenance,quarantined_by)
             SELECT tenant_id, id, work_order_number, eos_ops.work_order_pin_fingerprint(w), 'OBSOLETE/BAD_COPY', 'journey', 'journey', 'test'
               FROM eos_ops.work_orders w WHERE id = $1`, [id]);
    assert.equal(ok(await wo(office, "listWorkOrders", {}), "queue").items.some((x) => x.workOrderId === id), false);
    assert.equal(ok(await wo(techB, "listMyAssignedWorkOrders"), "tech list").items.some((x) => x.workOrderId === id), false);
    for (const [who, op, input] of [[office, "readWorkOrder", { workOrderId: id }], [dispatcher, "dispatchWorkOrder", { workOrderId: id }],
      [office, "setWorkOrderPartsPlan", { workOrderId: id, plan: [] }], [techB, "readWorkOrderFieldContext", { workOrderId: id }]]) {
      refused(await wo(who, op, input), 412, "WORK_ORDER_QUARANTINED", op);
    }
  });
});
