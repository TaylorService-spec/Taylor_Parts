// DWO-company (DECISIONS #DWO-company) against a real postgres:16 -- the OPERATING-COMPANY BOUNDARY on Work Orders: Dispatch, the Service Office, the technician's
// field views, search, coordinated operations and every command.
//
//   capability  ->  record relation (own assignment, where conditioned)  ->  COMPANY AUTHORITY.
//
// A Work Order of a company the caller does not reach is NONEXISTENT to it: the SAME code, category and words as a missing id, at every id-taking entry point,
// and a refusal leaves no trace anywhere in the database (a hash of every row of every Work Order table, the Commercial, Finance and Rental tables and the audit log).
// Lists, the board, search, assigned work and coordinated operations contain only the reachable companies. The governed service-provider authorization is unchanged.
// The protected Administrator's reach is UNCHANGED (company-blind where it was tenant-wide, bounded by its own authority where it already was); the protected Owner follows
// its own governed company reach.
//
// Real PostgreSQL. Set POLICY_TEST_DATABASE_URL; without it this SKIPS (the offline half is workOrderCompanyAuthority.test.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { endPoolAndDrain } from "./support/poolTeardown.mjs";
import { grantSyntheticCompanyAuthority, ROUND_THE_CLOCK } from "./support/syntheticAvailability.mjs";
import { certifyInventoryBaselineFixture } from "./support/inventoryBaselineCertified.mjs";
import { seedProtectedOwnerRows } from "./support/protectedOwnerFixture.mjs";
import { WORK_ORDER_ROUTE_ENTRY_POINTS } from "./support/workOrderCompanyEntryPoints.mjs";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const ops = require("../lib/eosOps/workOrderOperations.js");
const equipmentOps = require("../lib/eosOps/equipmentOperations.js");
const inboundOps = require("../lib/eosOps/inboundWorkOperations.js");
const coordinated = require("../lib/eosOps/coordinatedVisitPostgresRead.js");
const myWork = require("../lib/eosExperience/myWork.js");
const assignedWork = require("../lib/eosWorkforce/reads/assignedWorkReads.js");
const ctx = require("../lib/eosOps/contextualAuthorization.js");
const model = require("../lib/eosOps/conditionalEntitlement.js");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const T = "t-wodwo";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

const OFFICE = ["workOrder.record.read", "workOrder.lifecycle.ready", "workOrder.lifecycle.schedule", "workOrder.lifecycle.dispatch", "workOrder.lifecycle.cancel",
  "workOrder.lifecycle.close", "workOrder.parts.plan", "workOrder.create", "workOrder.labor.correctEntry", "workOrder.selfScheduling.issue", "equipment.record.read",
  "employee.record.read", "inboundWork.request.attach", "inboundWork.request.read", "fulfillment.coordinatedVisit.read"];
const TECH = ["workOrder.record.read", "workOrder.transition", "workOrder.lifecycle.complete", "workOrder.execution.record", "equipment.install"];

test("DWO-company: the operating-company boundary on Work Orders, in PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `wodwo_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await endPoolAndDrain(pool);
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations", "--no-check-order"],
    { maxBuffer: 256 * 1024 * 1024, cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe" });
  pool = new pg.Pool({ connectionString: dbUrlFor(name), max: 8 });
  const q = (sql, v = []) => pool.query(sql, v);
  const one = async (sql, v = []) => (await q(sql, v)).rows[0];

  // ── the world: Taylor and Ventana, people, one customer and site ──
  await q(`INSERT INTO eos_policy.tenants (id,key,name) VALUES ($1,$1,$1)`, [T]);
  for (const company of ["taylor", "ventana"]) {
    await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id,operating_company_id,status,source,established_by,updated_by) VALUES ($1,$2,'ACTIVE','fixture','fixture','fixture')`, [T, company]);
    await q(`INSERT INTO eos_policy.tenant_operating_company_keys (tenant_id,operating_company_id,operating_company_key,status,provenance,source,established_by,updated_by)
             VALUES ($1,$2,$2,'ACTIVE','NATIVE','fixture','fixture','fixture')`, [T, company]);
  }
  const principal = async (pid, employee = null) => {
    await q(`INSERT INTO eos_policy.principals (id,external_subject,identity_provider,status) VALUES ($1,$2,'eos','active')`, [pid, `sub-${pid}`]);
    await q(`INSERT INTO eos_policy.tenant_memberships (id,tenant_id,principal_id,status) VALUES ($1,$2,$3,'active')`, [`mem-${pid}`, T, pid]);
    if (employee) {
      await q(`INSERT INTO eos_workforce.employees (id,tenant_id,employment_status,operating_company_id,employee_number,display_name) VALUES ($1,$2,'ACTIVE',$3,$1,$4)`,
        [employee.id, T, employee.company ?? "taylor", employee.name ?? employee.id]);
      await q(`INSERT INTO eos_policy.employee_principal_links (id,tenant_id,principal_id,employee_id,operating_company_id,link_source,status,asserted_by,assertion_reason)
               VALUES ($1,$2,$3,$4,$5,'OPERATOR_ASSERTED','active','fixture','dwo fixture')`, [`lnk-${pid}`, T, pid, employee.id, employee.company ?? "taylor"]);
      if (employee.technician) {
        await q(`INSERT INTO eos_workforce.employee_work_eligibility (id,tenant_id,employee_id,qualification_code,effective_from,assigned_by,reason)
                 VALUES ($1,$2,$3,'SERVICE_TECHNICIAN',now(),'fixture','dwo fixture')`, [`elig-${employee.id}`, T, employee.id]);
      }
    }
    return pid;
  };
  const dspT = await principal("prn-dspt", { id: "emp-dspt" });
  const dspV = await principal("prn-dspv", { id: "emp-dspv", company: "ventana" });
  const both = await principal("prn-both");                                         // Taylor home + explicit Ventana reach (below)
  const techT = await principal("prn-techt", { id: "emp-techt", technician: true });
  const techV = await principal("prn-techv", { id: "emp-techv", company: "ventana", technician: true });
  const admin = await principal("prn-admin", { id: "emp-admin" });                  // the protected Administrator, with a usable Taylor Employee link
  const owner = await principal("prn-owner");                                       // the protected Owner, a Taylor Employee (seeded below)
  const nobody = await principal("prn-nobody");                                     // a member with no Employee link: no company authority at all
  await grantSyntheticCompanyAuthority(pool, T, both, ["taylor", "ventana"]);
  await q(`INSERT INTO eos_policy.roles (id,tenant_id,key,name,origin,protected,created_by,updated_by) VALUES ('role-admin',$1,'admin','Administrator','SYSTEM',true,'fixture','fixture')`, [T]);
  await q(`INSERT INTO eos_policy.user_role_assignments (id,tenant_id,principal_id,role_id,scope_type,scope_value,status,granted_by,access_version_at_grant,created_by,updated_by)
           VALUES ('a-admin',$1,$2,'role-admin','global',NULL,'active','fixture',0,'fixture','fixture')`, [T, admin]);
  await seedProtectedOwnerRows(q, { tenantId: T, principalId: owner, employeeId: "emp-owner", company: "taylor" });
  await q(`INSERT INTO eos_crm.accounts (id,tenant_id,name,status,created_by,updated_by) VALUES ('acct-1',$1,'Harbor Diner','ACTIVE','f','f')`, [T]);
  await q(`INSERT INTO eos_crm.account_locations (id,tenant_id,account_id,name,address_street,address_city,created_by,updated_by) VALUES ('loc-1',$1,'acct-1','Harbor Diner Main','1 Pier Rd','Portsmouth','f','f')`, [T]);

  // ── callers: explicit capability sets (nothing here depends on a seeded Role grant) ──
  const entitle = (caps, conditions) => model.entitlementsFrom([...caps].map((capabilityKey) => ({ grantor: { kind: "ROLE", roleKey: "persona" }, capabilityKey })), conditions);
  const DQ016 = model.grantConditionCatalog([{ grantor: { kind: "ROLE", roleKey: "persona" }, capabilityKey: "workOrder.record.read",
    condition: { paths: [[{ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" }]], recordKind: "workOrder" } }]);
  const callerOf = (principalId, caps, conditions = model.SHIPPED_GRANT_CONDITIONS) => {
    const ent = entitle(caps, conditions);
    const unconditioned = new Set(ent.filter((e) => e.condition === null).map((e) => e.capabilityKey));
    return Object.freeze({
      principalId,
      actor: { tenantId: T, principalId, capabilities: unconditioned },
      operational: { tenantId: T, principalId, capabilities: unconditioned,
        conditionallyHeld: new Set(ent.filter((e) => e.condition !== null).map((e) => e.capabilityKey)), entitlements: () => ent },
    });
  };
  const office = (principalId) => callerOf(principalId, OFFICE);
  const technician = (principalId) => callerOf(principalId, TECH, DQ016);
  const deps = { pool, reader: ctx.postgresContextualReader(pool), postgresState: "ACTIVE", equipmentPostgresState: "ACTIVE" };
  /** Run one operation of a closed table; the outcome is either a result or the governed refusal's words. */
  const run = async (table, op, who, input) => {
    try { return { ok: true, result: await table[op](deps, who, input) }; } catch (e) {
      if (typeof e?.code !== "string" || typeof e?.category !== "string") throw e;
      return { ok: false, code: e.code, category: e.category, message: e.message };
    }
  };
  const call = (op, who, input) => run(ops.EOS_WORK_ORDER_OPERATIONS, op, who, input);

  // ── Work Orders by SQL (the states the commands are checked from) ──
  let seq = 0;
  const wo = async (company, status = "CREATED", over = {}) => {
    const id = over.id ?? `wo-${company}-${++seq}`;
    const start = status === "SCHEDULED" ? new Date(Date.now() + 3 * DAY) : null;
    await q(`INSERT INTO eos_ops.work_orders
               (id, tenant_id, operating_company_key, work_order_number, status, work_order_type, priority, customer_id, location_id, sales_order_id, complaint,
                scheduled_start, scheduled_end, completed_at, closed_at, provenance, created_by_principal_id, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5::eos_ops.ops_work_order_status,$6::eos_ops.ops_work_order_type,2,'acct-1','loc-1',$7,$8,$9,$10,
                     CASE WHEN $12::text IN ('COMPLETED','CLOSED') THEN now() END, CASE WHEN $12::text = 'CLOSED' THEN now() END,'NATIVE',$11,now(),now())`,
      [id, T, company, `WO-2031-${String(++seq).padStart(6, "0")}`, status, over.type ?? "SERVICE_CALL", over.salesOrderId ?? null, over.complaint ?? null,
        start, start ? new Date(start.getTime() + 2 * HOUR) : null, dspT, status]);
    return id;
  };
  const assign = (workOrderId, employeeId) => q(
    `INSERT INTO eos_ops.work_order_assignments (id,tenant_id,work_order_id,assignee_employee_id,source,effective_from,assigned_by_principal_id,provenance)
     VALUES ($1,$2,$3,$4,'SCHEDULE',now(),$5,'NATIVE')`, [`woa-${randomUUID()}`, T, workOrderId, employeeId, dspT]);

  // ── the zero-trace state hash: every row of every Work Order, Commercial, Finance, Rental and audit table ──
  const tables = (await q(`SELECT table_schema AS s, table_name AS n FROM information_schema.tables
                            WHERE table_type = 'BASE TABLE' AND table_schema IN ('eos_ops','eos_commercial','eos_finance','eos_rental') ORDER BY 1, 2`)).rows
    .map((r) => `${r.s}.${r.n}`).concat(["eos_policy.audit_events"]);
  const stateHash = async () => {
    const parts = [];
    for (const table of tables) parts.push(`${table}=${(await one(`SELECT md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM ${table} x`)).h}`);
    return createHash("sha256").update(parts.join(";")).digest("hex");
  };

  // ── normalisation: two refusals are "the same" when only the ids and company words they echo differ ──
  const norm = (o, ...ids) => {
    let s = JSON.stringify(o);
    for (const id of ids) s = s.split(id).join("<id>");
    return s.replace(/"(wot|woa|wosh)_[0-9a-f-]+"/g, '"<gen>"').replace(/\d{4}-\d{2}-\d{2}T[0-9:.]+Z/g, "<ts>").replace(/WO-2031-\d{6}/g, "<no>")
      .replace(/"(taylor|ventana)"/g, '"<co>"').replace(/"(token|linkPath|sessionId)":"[^"]*"/g, '"$1":"<x>"');
  };
  const words = (o, ...ids) => norm({ code: o.code, category: o.category, message: o.message }, ...ids);

  await t.test("the world is what the proofs assume: companies, people, the protected identities", async () => {
    const authority = require("../lib/eosOps/workOrderCompanyAuthority.js");
    const keys = async (p, options) => (await authority.resolveWorkOrderCompanyReach(pool, T, p, options));
    assert.deepEqual([...(await keys(dspT)).companyKeys], ["taylor"]);
    assert.deepEqual([...(await keys(dspV)).companyKeys], ["ventana"]);
    assert.deepEqual([...(await keys(both)).companyKeys].sort(), ["taylor", "ventana"], "an explicit company-access reach is reach");
    assert.deepEqual([...(await keys(owner)).companyKeys], ["taylor"], "the protected Owner follows its OWN governed company reach");
    const a = await keys(admin);
    assert.deepEqual([a.unrestricted, a.hasAuthority], [true, true], "the protected Administrator keeps every company where it was tenant-wide");
    const aOwn = await keys(admin, { administrator: "OWN" });
    assert.deepEqual([aOwn.unrestricted, [...aOwn.companyKeys]], [false, ["taylor"]], "...and its own authority where it was already bounded");
    const n = await keys(nobody);
    assert.deepEqual([n.hasAuthority, n.unrestricted], [false, false]);
  });

  // ════════════════════ (1) EVERY ID-TAKING ENTRY POINT: foreign == missing, with zero trace ════════════════════
  const future = (days) => ({ scheduledStart: Date.now() + days * DAY, scheduledEnd: Date.now() + days * DAY + HOUR });
  // [operation, the state the Work Order is in, the input]. INSTALL / own-assignment operations are in the relation table (2).
  const ID_OPS = [
    ["readWorkOrder", "CREATED", (id) => ({ workOrderId: id })],
    ["readWorkOrderFieldContext", "CREATED", (id) => ({ workOrderId: id })],
    ["readWorkOrderReadiness", "CREATED", (id) => ({ workOrderId: id })],
    ["readWorkOrderLabor", "CREATED", (id) => ({ workOrderId: id })],
    ["markWorkOrderReady", "CREATED", (id) => ({ workOrderId: id })],
    ["cancelWorkOrder", "CREATED", (id) => ({ workOrderId: id, expectedStatus: "CREATED" })],
    ["closeWorkOrder", "COMPLETED", (id) => ({ workOrderId: id })],
    ["unscheduleWorkOrder", "SCHEDULED", (id) => ({ workOrderId: id, reason: "dwo" })],
    ["setWorkOrderPartsPlan", "CREATED", (id) => ({ workOrderId: id, plan: [] })],
    ["setWorkOrderEstimatedDuration", "CREATED", (id) => ({ workOrderId: id, estimatedDurationMinutes: 30 })],
    ["recordWorkOrderLabor", "WORK_IN_PROGRESS", (id) => ({ workOrderId: id, correctsLaborEntryId: "le-none", idempotencyKey: `k-${id}`, laborType: "ONSITE",
      entryKind: "DURATION", durationMinutes: 30, workDate: "2026-10-01" })],
    ["issueSelfSchedulingLink", "READY_TO_DISPATCH", (id) => ({ workOrderId: id })],
    // already bounded by the caller's own company authority before this lane (D-248-1, G-9): unchanged
    ["scheduleWorkOrder", "READY_TO_DISPATCH", (id) => ({ workOrderId: id, employeeId: "emp-techt", ...future(5) })],
    ["rescheduleWorkOrder", "SCHEDULED", (id) => ({ workOrderId: id, expectedScheduledStart: new Date(Date.now() + 3 * DAY).toISOString(), ...future(6), reason: "dwo" })],
    ["dispatchWorkOrder", "SCHEDULED", (id) => ({ workOrderId: id })],
    ["suggestWorkOrderPlacement", "READY_TO_DISPATCH", (id) => ({ workOrderId: id })],
    ["listWorkOrderTechnicians", "READY_TO_DISPATCH", (id) => ({ workOrderId: id })],
  ];
  // The MUTATIONS that were already bounded by the caller's own authority (D-248-1): the Administrator stays bounded here. The READS (the picker and the placement suggestion) are tenant-wide for it (DWO-2).
  const OWN_MODE = new Set(["scheduleWorkOrder", "rescheduleWorkOrder", "dispatchWorkOrder"]);
  const ADMIN_READS = new Set(["suggestWorkOrderPlacement", "listWorkOrderTechnicians"]);

  await t.test("(R10,R11) (1) a foreign Work Order is refused exactly like a missing one at every id-taking entry point, and a refusal leaves no trace; the same-company control is not refused by company", async () => {
    const covered = new Set(ID_OPS.map(([op]) => op));
    // The relation-gated and observation-only operations are proven in (2) and (3); the rest of the ID kinds are in this table.
    const elsewhere = new Set(["acceptWorkOrder", "startWorkOrderTravel", "arriveAtWorkOrder", "startWorkOrderWork", "recordWorkOrderExecution", "completeWorkOrder",
      "listInstallableEquipmentForWorkOrder", "recordWorkOrderEquipmentInstall", "revokeSelfSchedulingLink", "readSelfSchedulingSessions"]);
    for (const [op, kind] of Object.entries(WORK_ORDER_ROUTE_ENTRY_POINTS)) {
      if (kind === "ID" || kind === "ID_OWN" || kind === "ID_RELATION") assert.ok(covered.has(op) || elsewhere.has(op), `${op}: an id-taking entry point must be in the table`);
    }
    const dsp = office(dspT);
    for (const [op, state, input] of ID_OPS) {
      const foreign = await wo("ventana", state);
      const twin = await wo("taylor", state);
      const missing = "wo-missing-" + op;
      const before = await stateHash();
      const outsideOutcome = await call(op, dsp, input(foreign));
      const missingOutcome = await call(op, dsp, input(missing));
      assert.equal(outsideOutcome.ok, false, `${op}: a foreign Work Order is refused`);
      assert.equal(await stateHash(), before, `${op}: the refusals left NO trace anywhere`);
      assert.deepEqual(words(outsideOutcome, foreign), words(missingOutcome, missing), `${op}: foreign == missing (code, category, message)`);
      assert.match(outsideOutcome.code, /^WORK_ORDER_NOT_FOUND$/, `${op}: the plain miss, never "forbidden"`);
      assert.equal(outsideOutcome.category, "NOT_FOUND", op);
      // The control: the same call on a same-company Work Order is NOT stopped by the company boundary (it succeeds, or stops for its own business reason).
      const control = await call(op, dsp, input(twin));
      assert.ok(control.ok || (control.code !== "WORK_ORDER_NOT_FOUND" && control.code !== "COMPANY_AUTHORITY_REQUIRED" && control.code !== "CAPABILITY_MISSING"),
        `${op}: the same-company control must reach its own logic, got ${control.code}`);
      // An explicit cross-company reach DOES reach the foreign Work Order (the boundary is authority, not a wall).
      const reaching = await call(op, office(both), input(foreign));
      assert.ok(reaching.ok || (reaching.code !== "WORK_ORDER_NOT_FOUND" && reaching.code !== "COMPANY_AUTHORITY_REQUIRED"), `${op}: a caller that reaches both companies reaches it, got ${reaching.code}`);
    }
  });

  await t.test("(1b) capability FIRST: a caller without the capability is told so, whatever company the id is in; no authority at all is COMPANY_AUTHORITY_REQUIRED, uniformly", async () => {
    const foreign = await wo("ventana", "CREATED");
    const keyless = callerOf(dspT, []);
    for (const [op, , input] of ID_OPS) {
      const a = await call(op, keyless, input(foreign));
      const b = await call(op, keyless, input("wo-missing-x"));
      assert.equal(a.code, b.code, `${op}: without the capability the answer is the same for a foreign and a missing id`);
    }
    const none = office(nobody);
    for (const [op, , input] of ID_OPS) {
      const a = await call(op, none, input(foreign));
      const b = await call(op, none, input("wo-missing-x"));
      assert.deepEqual([a.code, a.category], ["COMPANY_AUTHORITY_REQUIRED", "FORBIDDEN"], `${op}: no company authority`);
      assert.deepEqual([a.code, a.category, a.message], [b.code, b.category, b.message], `${op}: uniform for every id`);
    }
  });

  // ════════════════════ (2) THE RELATION-GATED OPERATIONS: capability, relation, company ════════════════════
  const TECH_OPS = [
    ["acceptWorkOrder", "DISPATCHED", (id) => ({ workOrderId: id })],
    ["startWorkOrderTravel", "ACCEPTED", (id) => ({ workOrderId: id })],
    ["arriveAtWorkOrder", "EN_ROUTE", (id) => ({ workOrderId: id })],
    ["startWorkOrderWork", "ARRIVED", (id) => ({ workOrderId: id })],
    ["completeWorkOrder", "WORK_IN_PROGRESS", (id) => ({ workOrderId: id })],
    ["recordWorkOrderExecution", "WORK_IN_PROGRESS", (id) => ({ workOrderId: id, idempotencyKey: `k-${id}`, note: "dwo" })],
    ["recordWorkOrderLabor", "WORK_IN_PROGRESS", (id) => ({ workOrderId: id, idempotencyKey: `kl-${id}`, laborType: "ONSITE", entryKind: "DURATION", durationMinutes: 30, workDate: "2026-10-01" })],
    ["listInstallableEquipmentForWorkOrder", "WORK_IN_PROGRESS", (id) => ({ workOrderId: id }), { type: "INSTALL" }],
    ["recordWorkOrderEquipmentInstall", "WORK_IN_PROGRESS", (id) => ({ workOrderId: id, partId: "part-x", serialNumber: "SN-1", idempotencyKey: `ki-${id}`, equipmentName: "Unit" }), { type: "INSTALL" }],
    ["readWorkOrder", "WORK_IN_PROGRESS", (id) => ({ workOrderId: id })],
    ["readWorkOrderFieldContext", "WORK_IN_PROGRESS", (id) => ({ workOrderId: id })],
  ];

  await t.test("(2a) a technician NOT assigned to a foreign Work Order gets the relation's refusal, identical to a missing id (the company layer is never reached, so nothing is learned)", async () => {
    const tech = technician(techT);
    for (const [op, state, input, over] of TECH_OPS) {
      const foreign = await wo("ventana", state, over);
      await assign(foreign, "emp-techv");              // assigned to the Ventana technician, not to this one
      const before = await stateHash();
      const a = await call(op, tech, input(foreign));
      const b = await call(op, tech, input("wo-missing-t"));
      assert.equal(a.ok, false, op);
      assert.deepEqual(words(a, foreign), words(b, "wo-missing-t"), `${op}: unassigned foreign == missing`);
      assert.equal(await stateHash(), before, `${op}: no trace`);
    }
  });

  await t.test("(R3) (2b) a technician ASSIGNED to a Work Order keeps seeing and working it even where the company is not one it otherwise reaches (a legacy / migrated assignment): no legitimate technician access is lost", async () => {
    const tech = technician(techT);
    for (const [op, state, input, over] of TECH_OPS) {
      const assignedElsewhere = await wo("ventana", state, over);
      await assign(assignedElsewhere, "emp-techt");             // forced by SQL: a new assignment requires the Work Order's company; a legacy one may not
      const a = await call(op, tech, input(assignedElsewhere));
      const worked = (o, where) => {
        if (op === "recordWorkOrderEquipmentInstall" || op === "listInstallableEquipmentForWorkOrder") assert.ok(o.ok || (o.code !== "WORK_ORDER_NOT_FOUND" && o.code !== "COMPANY_AUTHORITY_REQUIRED"), `${op} ${where}: got ${o.code}`);
        else assert.equal(o.ok, true, `${op} ${where}: ${JSON.stringify(o).slice(0, 300)}`);
      };
      worked(a, "assigned in another company");
      const own = await wo("taylor", state, over);
      await assign(own, "emp-techt");
      worked(await call(op, tech, input(own)), "own company");
    }
    // ...but the assignment reaches ONLY the Work Order it is on: another company's unassigned Work Order stays nonexistent to the same technician.
    const other = await wo("ventana", "WORK_IN_PROGRESS");
    const before = await stateHash();
    const refused = await call("readWorkOrder", tech, { workOrderId: other });
    assert.equal(refused.ok, false);
    assert.equal(await stateHash(), before);
  });

  // ════════════════════ (3) OBSERVATION-ONLY ENTRY POINTS (an id with no session reads as an empty answer) ════════════════════
  await t.test("(3) self-scheduling sessions of a foreign Work Order are not listed and not revoked; an id with no session reads the same", async () => {
    await q(`INSERT INTO eos_ops.self_scheduling_policies (tenant_id,id,earliest_offset_minutes,horizon_days,session_ttl_minutes,time_zone,updated_by_principal_id)
             VALUES ($1,'pol-1',60,14,1440,'UTC',$2)`, [T, dspT]);
    const foreign = await wo("ventana", "READY_TO_DISPATCH");
    const own = await wo("taylor", "READY_TO_DISPATCH");
    for (const id of [foreign, own]) {
      await q(`INSERT INTO eos_ops.self_scheduling_sessions (tenant_id,id,token_sha256,work_order_id,issued_by_principal_id,issued_at,expires_at,policy_id,policy_version)
               VALUES ($1,$2,$3,$4,$5,now(),now() + interval '1 day','pol-1',1)`, [T, `ssn-${id}`, createHash("sha256").update(id).digest("hex"), id, dspT]);
    }
    const dsp = office(dspT);
    const before = await stateHash();
    const seenForeign = await call("readSelfSchedulingSessions", dsp, { workOrderId: foreign });
    const seenMissing = await call("readSelfSchedulingSessions", dsp, { workOrderId: "wo-no-sessions" });
    assert.deepEqual(norm(seenForeign.result, foreign), norm(seenMissing.result, "wo-no-sessions"), "a foreign Work Order's session history reads as empty, like an id with none");
    assert.deepEqual(seenForeign.result.sessions, []);
    assert.equal((await call("readSelfSchedulingSessions", dsp, { workOrderId: own })).result.sessions.length, 1, "the same-company control lists its session");
    assert.equal((await call("readSelfSchedulingSessions", office(dspV), { workOrderId: foreign })).result.sessions.length, 1, "and the Ventana dispatcher lists its own");
    const revokedForeign = await call("revokeSelfSchedulingLink", dsp, { workOrderId: foreign, reason: "dwo" });
    const revokedMissing = await call("revokeSelfSchedulingLink", dsp, { workOrderId: "wo-no-sessions", reason: "dwo" });
    assert.deepEqual(norm(revokedForeign.result, foreign), norm(revokedMissing.result, "wo-no-sessions"));
    assert.deepEqual(revokedForeign.result.revoked, []);
    assert.equal((await one(`SELECT status FROM eos_ops.self_scheduling_sessions WHERE id = $1`, [`ssn-${foreign}`])).status, "ACTIVE", "the foreign session was NOT revoked");
    assert.equal(await stateHash(), before, "...and the read and the refused revoke wrote nothing at all");
    assert.equal((await call("revokeSelfSchedulingLink", dsp, { workOrderId: own, reason: "dwo" })).result.revoked.length, 1, "the control revokes its own");
  });

  await t.test("(3b) the Equipment of a Work Order (equipment route) and attaching an inbound request (inbound route) answer a foreign Work Order as a missing one", async () => {
    const foreign = await wo("ventana", "CREATED");
    const own = await wo("taylor", "CREATED");
    const dsp = office(dspT);
    const eqForeign = await run(equipmentOps.EOS_EQUIPMENT_OPERATIONS, "readWorkOrderEquipment", dsp, { workOrderId: foreign });
    const eqMissing = await run(equipmentOps.EOS_EQUIPMENT_OPERATIONS, "readWorkOrderEquipment", dsp, { workOrderId: "wo-missing-eq" });
    assert.deepEqual([eqForeign.ok, eqForeign.code, eqForeign.category], [false, "WORK_ORDER_NOT_FOUND", "NOT_FOUND"]);
    assert.deepEqual(words(eqForeign, foreign), words(eqMissing, "wo-missing-eq"));
    assert.equal((await run(equipmentOps.EOS_EQUIPMENT_OPERATIONS, "readWorkOrderEquipment", dsp, { workOrderId: own })).ok, true, "the control reads its own");
    // An inbound intake awaiting a decision: attaching it to a foreign Work Order is the plain miss, and the request stays undecided.
    await q(`INSERT INTO eos_ops.inbound_work_requests (tenant_id,id,source_provider,source_mailbox_id,source_message_id,content_key,original_body_content_type,status,ingested_by_principal_id)
             VALUES ($1,'inb-1','GOOGLE_WORKSPACE','mb-1','m-1','ck-1','text/plain','NEEDS_REVIEW',$2)`, [T, dspT]);
    const attachBefore = await stateHash();
    const aForeign = await run(inboundOps.EOS_INBOUND_WORK_OPERATIONS, "attachInboundWork", dsp, { requestId: "inb-1", workOrderId: foreign });
    const aMissing = await run(inboundOps.EOS_INBOUND_WORK_OPERATIONS, "attachInboundWork", dsp, { requestId: "inb-1", workOrderId: "wo-missing-in" });
    assert.deepEqual([aForeign.ok, aForeign.code, aForeign.category], [false, "WORK_ORDER_NOT_FOUND", "NOT_FOUND"]);
    assert.deepEqual(words(aForeign, foreign), words(aMissing, "wo-missing-in"));
    assert.equal(await stateHash(), attachBefore, "a refused attach leaves no trace");
    assert.equal((await run(inboundOps.EOS_INBOUND_WORK_OPERATIONS, "attachInboundWork", dsp, { requestId: "inb-1", workOrderId: own })).ok, true, "the control attaches to its own");
    assert.equal(await one(`SELECT status FROM eos_ops.inbound_work_requests WHERE id = 'inb-1'`).then((r) => r.status), "ATTACHED");
  });

  // ════════════════════ (4) LISTS, THE BOARD, SEARCH, ASSIGNED WORK AND COORDINATED OPERATIONS ════════════════════
  await t.test("(4) lists, the board, search, assigned work, coordinated operations and the aggregates contain only the reachable companies", async () => {
    const tag = `dwo-find-${randomUUID().slice(0, 8)}`;
    const tA = await wo("taylor", "READY_TO_DISPATCH", { complaint: tag, salesOrderId: "so-anchor-t" });
    const tB = await wo("taylor", "SCHEDULED", { complaint: tag, salesOrderId: "so-anchor-t" });
    const vA = await wo("ventana", "READY_TO_DISPATCH", { complaint: tag, salesOrderId: "so-anchor-v" });
    const vB = await wo("ventana", "SCHEDULED", { complaint: tag, salesOrderId: "so-anchor-v" });
    await assign(tA, "emp-techt"); await assign(vA, "emp-techt");   // the technician is assigned to one of each (the Ventana one forced by SQL)
    const mine = new Set([tA, tB]), theirs = new Set([vA, vB]);
    const ids = (items) => new Set(items.map((i) => i.workOrderId ?? i.id));
    const only = (got, want, label) => { for (const id of want) assert.ok(got.has(id), `${label}: lacks ${id}`); for (const id of (want === mine ? theirs : mine)) assert.ok(!got.has(id), `${label}: must not contain ${id}`); };
    // the office list -- the board's Work Order source (the governed-query form is proven by workOrderListQuerySuite)
    for (const [who, label, want] of [[dspT, "Taylor dispatcher", mine], [dspV, "Ventana dispatcher", theirs]]) {
      const listed = await call("listWorkOrders", office(who), { limit: 200 });
      only(ids(listed.result.items), want, `${label} list`);
    }
    const bothList = ids((await call("listWorkOrders", office(both), { limit: 200 })).result.items);
    for (const id of [...mine, ...theirs]) assert.ok(bothList.has(id), "the caller that reaches both lists both");
    // search (the site-wide search, Work Order kind): the foreign complaint text is never matched
    const searched = async (who) => new Set((await myWork.searchEos({ pool, postgresState: "ACTIVE" }, office(who), { query: tag })).results.filter((r) => r.kind === "workOrder").map((r) => r.id));
    only(await searched(dspT), mine, "Taylor search"); only(await searched(dspV), theirs, "Ventana search");
    // the technician's own work (My Work / field list): the Ventana assignment is not listed
    const assigned = (await call("listMyAssignedWorkOrders", technician(techT), {})).result.items;
    assert.ok(assigned.some((i) => i.workOrderId === tA), "the Taylor assignment is listed");
    assert.ok(assigned.some((i) => i.workOrderId === vA), "a Work Order the technician is ASSIGNED to stays visible to it (no legitimate technician access is lost)");
    assert.ok(!assigned.some((i) => i.workOrderId === vB), "...but not another company's unassigned Work Order");
    // assigned work on the Employee record (Workforce)
    const workforce = async (who) => assignedWork.listAssignedWorkForEmployee({ pool }, { ...callerOf(who, ["employee.record.read", "workOrder.record.read"]).operational },
      { employeeId: "emp-techt", family: "WORK_ORDER", limit: 200 });
    const wT = (await workforce(dspT)).items, wA = (await workforce(admin)).items;
    assert.ok(wT.some((i) => i.recordId === tA) && !wT.some((i) => i.recordId === vA) && wT.every((i) => i.operatingCompanyId === "taylor"));
    assert.ok(wA.some((i) => i.recordId === tA) && wA.some((i) => i.recordId === vA), "the protected Administrator keeps every company here");
    // coordinated operations: a foreign Work Order is dropped ENTIRELY (and never counted in `skipped` / `truncated`)
    const coordinatedFor = async (who) => coordinated.readCoordinatedOperations({ pool }, { tenantId: T, principalId: who, capabilities: new Set(["fulfillment.coordinatedVisit.read"]) });
    const cT = await coordinatedFor(dspT), cV = await coordinatedFor(dspV), cB = await coordinatedFor(both), cA = await coordinatedFor(admin);
    only(ids(cT.workOrders), mine, "coordinated Taylor"); only(ids(cV.workOrders), theirs, "coordinated Ventana");
    for (const id of [...mine, ...theirs]) assert.ok(ids(cB.workOrders).has(id) && ids(cA.workOrders).has(id), "reaching both / the Administrator: all");
    assert.equal(JSON.stringify(cT).includes(vA), false, "nothing of a foreign Work Order appears in the page");
    assert.equal(JSON.stringify(cT).includes("so-anchor-v"), false, "...nor its anchoring Sales Order id");
    // aggregates: the figures count only the reachable Work Orders (the expected values are computed from the rows)
    const byCompany = (await q(`SELECT w.operating_company_key AS k, w.status::text AS status, (w.completed_at IS NOT NULL) AS done
        FROM eos_ops.work_orders w JOIN eos_ops.work_order_assignments a ON a.tenant_id = w.tenant_id AND a.work_order_id = w.id AND a.effective_to IS NULL
       WHERE a.assignee_employee_id = 'emp-techt'`)).rows;
    const expected = (keys) => ({ activeCount: byCompany.filter((r) => keys.includes(r.k) && !r.done).length, completedCount: byCompany.filter((r) => keys.includes(r.k) && r.done).length });
    const volume = async (who) => (await call("readTechnicianVolumeBreakdown", office(who), {})).result.items.find((i) => i.employeeId === "emp-techt");
    for (const [who, keys, label] of [[dspT, ["taylor"], "Taylor"], [dspV, ["ventana"], "Ventana"], [both, ["taylor", "ventana"], "both"], [admin, ["taylor", "ventana"], "the Administrator"]]) {
      const v = await volume(who);
      assert.deepEqual({ activeCount: v.activeCount, completedCount: v.completedCount }, expected(keys), `${label}: the volume counts only the reachable Work Orders`);
    }
    assert.notEqual(expected(["taylor"]).activeCount, expected(["taylor", "ventana"]).activeCount, "the world makes the two answers differ");
    const statusMap = (keys) => byCompany.filter((r) => keys.includes(r.k)).reduce((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {});
    const stats = await call("readTechnicianExecutionStats", office(dspT), { employeeId: "emp-techt" });
    assert.deepEqual(stats.result.workOrderVolumeByStatus, statusMap(["taylor"]), "the stats population is the reachable Work Orders only");
  });

  // ════════════════════ (5) THE PROTECTED ADMINISTRATOR AND THE PROTECTED OWNER ════════════════════
  const IDENTICAL_FOR_ADMIN = ID_OPS.filter(([op]) => !OWN_MODE.has(op) && !ADMIN_READS.has(op));
  await t.test("(R12) (5a) the protected Administrator's MUTATION reach is UNCHANGED: a Ventana Work Order behaves exactly like a Taylor twin (it was company-blind before), at every entry point it was tenant-wide", async () => {
    const adm = office(admin);
    for (const [op, state, input] of IDENTICAL_FOR_ADMIN) {
      const taylorTwin = await wo("taylor", state);
      const ventanaTwin = await wo("ventana", state);
      const a = await call(op, adm, input(taylorTwin));
      const b = await call(op, adm, input(ventanaTwin));
      assert.equal(a.ok, b.ok, `${op}: ${JSON.stringify(a).slice(0, 160)} vs ${JSON.stringify(b).slice(0, 160)}`);
      assert.equal(norm(a.ok ? a.result : words(a, taylorTwin), taylorTwin), norm(b.ok ? b.result : words(b, ventanaTwin), ventanaTwin), `${op}: byte-identical modulo ids and company words`);
      assert.ok(a.ok || a.code !== "WORK_ORDER_NOT_FOUND", `${op}: never the plain miss for the Administrator`);
    }
    // The transitions it applies leave exactly one governed record each (the Work Order transition), for either company.
    for (const company of ["taylor", "ventana"]) {
      const id = await wo(company, "CREATED");
      const n0 = Number((await one(`SELECT count(*) n FROM eos_ops.work_order_transitions WHERE work_order_id = $1`, [id])).n);
      assert.equal((await call("markWorkOrderReady", adm, { workOrderId: id })).ok, true);
      assert.equal(Number((await one(`SELECT count(*) n FROM eos_ops.work_order_transitions WHERE work_order_id = $1`, [id])).n), n0 + 1);
    }
    // Where it was ALREADY bounded by its own authority (Schedule / Reschedule / Dispatch, the office list), it stays bounded: Taylor only.
    for (const [op, state, input] of ID_OPS.filter(([name]) => OWN_MODE.has(name))) {
      const foreign = await wo("ventana", state);
      const a = await call(op, adm, input(foreign));
      assert.deepEqual([a.ok, a.code], [false, "WORK_ORDER_NOT_FOUND"], `${op}: unchanged -- the Administrator is bounded by its own company authority here`);
    }
    // DWO-2: the Administrator's READ visibility is tenant-wide and consistent (the picker and the placement suggestion included), even for a Ventana Work Order.
    for (const [op, state, input] of ID_OPS.filter(([name]) => ADMIN_READS.has(name))) {
      const ventana = await wo("ventana", state);
      const a = await call(op, adm, input(ventana));
      assert.ok(a.ok || a.code !== "WORK_ORDER_NOT_FOUND", `${op}: the Administrator reads a Ventana Work Order, got ${a.code}`);
    }
    const adminList = (await call("listWorkOrders", adm, { limit: 200 })).result.items;
    assert.ok(adminList.some((i) => i.operatingCompanyKey === "taylor") && adminList.some((i) => i.operatingCompanyKey === "ventana"), "the office list covers both companies for the Administrator");
  });

  await t.test("(R13) (5b) the protected Owner follows its OWN governed company reach, like everyone else; an explicit company-access reach opens the second company", async () => {
    const own = office(owner);
    const ventana = await wo("ventana", "CREATED");
    const taylor = await wo("taylor", "CREATED");
    assert.equal((await call("readWorkOrder", own, { workOrderId: taylor })).ok, true);
    const refused = await call("readWorkOrder", own, { workOrderId: ventana });
    const missing = await call("readWorkOrder", own, { workOrderId: "wo-missing-o" });
    assert.deepEqual([refused.code, refused.category], ["WORK_ORDER_NOT_FOUND", "NOT_FOUND"]);
    assert.deepEqual(words(refused, ventana), words(missing, "wo-missing-o"));
    await grantSyntheticCompanyAuthority(pool, T, owner, ["taylor", "ventana"]);
    assert.equal((await call("readWorkOrder", own, { workOrderId: ventana })).ok, true, "governed company access is how the Owner holds the second company");
  });

  // ════════════════════ (6) THE SERVICE-PROVIDER AUTHORIZATION IS UNCHANGED ════════════════════
  await t.test("(6) a provider company serves another company's Sales Order only under the seller's ACTIVE authorization (positive and negative), and the authorization widens no Work Order read", async () => {
    await q(`INSERT INTO eos_policy.tenant_sales_channels (tenant_id, sales_channel, status, source, established_by, updated_by) VALUES ($1,'RETAIL','ACTIVE','fixture','fixture','fixture') ON CONFLICT DO NOTHING`, [T]);
    await q(`INSERT INTO eos_workforce.employees (id,tenant_id,employment_status,operating_company_id,employee_number,display_name) VALUES ('e-seller',$1,'ACTIVE','ventana','e-seller','Seller')`, [T]);
    await q(`INSERT INTO eos_commercial.sales_orders (id, tenant_id, sales_order_number, account_id, owner_employee_id, operating_company_key, state, sales_channel,
               currency, credited_salesperson_employee_id, accountable_employee_id, location_id, created_by, updated_by)
             VALUES ('so-ventana',$1,'SO-2026-V00001','acct-1','e-seller','ventana','IN_FULFILLMENT','RETAIL','USD','e-seller','e-seller','loc-1','f','f')`, [T]);
    await q(`INSERT INTO eos_commercial.sales_order_lines (tenant_id, sales_order_id, line_number, kind, ref, business_unit, ordered_qty, unit_price_minor)
             VALUES ($1,'so-ventana',1,'SERVICE','SVC-INSTALL','INSTALLATION',1,90000)`, [T]);
    const create = (type) => call("createWorkOrder", office(dspT), { operatingCompanyId: "taylor", customerId: "acct-1", locationId: "loc-1", workOrderType: type, priority: 2,
      salesOrderId: "so-ventana", salesOrderLines: [1] });
    const refusedWords = (o) => [o.ok, o.code, o.category];
    const missingOrder = await call("createWorkOrder", office(dspT), { operatingCompanyId: "taylor", customerId: "acct-1", locationId: "loc-1", workOrderType: "SERVICE_CALL", priority: 2,
      salesOrderId: "so-missing", salesOrderLines: [1] });
    const noAuth = await create("SERVICE_CALL");
    assert.deepEqual(refusedWords(noAuth), [false, "SALES_ORDER_NOT_FOUND", "NOT_FOUND"], "no arbitrary cross-company Work Order: the Ventana order is nonexistent to a Taylor-only dispatcher");
    assert.deepEqual(words(noAuth, "so-ventana"), words(missingOrder, "so-missing"));
    await q(`INSERT INTO eos_commercial.sales_order_service_providers (tenant_id, sales_order_id, service_operating_company_key, scopes, status, reason, authorized_by)
             VALUES ($1,'so-ventana','taylor',ARRAY['SERVICE'],'ACTIVE','Taylor Service performs Ventana''s service','f')`, [T]);
    assert.deepEqual(refusedWords(await create("INSTALL")), [false, "SALES_ORDER_NOT_FOUND", "NOT_FOUND"], "the authorization covers SERVICE only");
    const made = await create("SERVICE_CALL");
    assert.equal(made.ok, true, JSON.stringify(made));
    assert.equal((await one(`SELECT operating_company_key k FROM eos_ops.work_orders WHERE id = $1`, [made.result.workOrderId])).k, "taylor", "the Work Order is the service-performing company's");
    // The authorization is a Sales Order <-> Work Order link rule: it opens no Work Order read to the seller's company.
    assert.equal((await call("readWorkOrder", office(dspT), { workOrderId: made.result.workOrderId })).ok, true);
    const sellerRead = await call("readWorkOrder", office(dspV), { workOrderId: made.result.workOrderId });
    assert.deepEqual([sellerRead.ok, sellerRead.code], [false, "WORK_ORDER_NOT_FOUND"], "the seller's company does not reach the provider's Work Order");
    await q(`UPDATE eos_commercial.sales_order_service_providers SET status = 'REVOKED', revoked_by = 'f', revoked_at = now(), revoke_reason = 'done' WHERE tenant_id = $1 AND sales_order_id = 'so-ventana'`, [T]);
    assert.deepEqual(refusedWords(await create("SERVICE_CALL")), [false, "SALES_ORDER_NOT_FOUND", "NOT_FOUND"], "revoked");
  });

  await t.test("(7) the boundary is the SAME predicate everywhere: a Work Order moved to another company changes every answer at once", async () => {
    const id = await wo("taylor", "CREATED", { complaint: "dwo-move" });
    const dsp = office(dspT);
    for (const op of ["readWorkOrder", "readWorkOrderFieldContext", "readWorkOrderLabor", "setWorkOrderPartsPlan"]) {
      assert.equal((await call(op, dsp, op === "setWorkOrderPartsPlan" ? { workOrderId: id, plan: [] } : { workOrderId: id })).ok, true, `${op}: before`);
    }
    await q(`UPDATE eos_ops.work_orders SET operating_company_key = 'ventana' WHERE id = $1`, [id]);
    for (const op of ["readWorkOrder", "readWorkOrderFieldContext", "readWorkOrderLabor", "setWorkOrderPartsPlan"]) {
      const o = await call(op, dsp, op === "setWorkOrderPartsPlan" ? { workOrderId: id, plan: [] } : { workOrderId: id });
      assert.deepEqual([o.ok, o.code], [false, "WORK_ORDER_NOT_FOUND"], `${op}: after`);
    }
    const found = (await myWork.searchEos({ pool, postgresState: "ACTIVE" }, dsp, { query: "dwo-move" })).results.filter((r) => r.kind === "workOrder");
    assert.deepEqual(found, [], "search follows");
  });

  // ════════════════════ REGRESSION PROOF: every legitimate capability still works, end to end ════════════════════
  const ok = (o, what) => { assert.equal(o.ok, true, `${what}: ${JSON.stringify(o).slice(0, 400)}`); return o.result; };
  const catalogPart = (id, { control = "STANDARD", whole = false } = {}) => q(
    `INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status, stocking_unit, control_type, stocking_class,
       expiry_tracked, consumable, returnable_core, whole_unit, version, updated_by)
     VALUES ($1, $2, 'seed', $3, 'proof part', 'ACTIVE', 'EACH', $4, 'STOCKED', false, false, false, $5, 1, 'seed')`, [id, T, `IPN-${id}`, control, whole]);
  const techJ = await principal("prn-techj", { id: "emp-techj", technician: true });
  const hours = async () => ok(await call("setTechnicianWorkingHours", office(dspT),
    { employeeId: "emp-techj", timeZone: "UTC", weeklyHours: ROUND_THE_CLOCK, reason: "dwo journey" }), "working hours");
  /** create -> ready -> plan -> schedule -> dispatch, by the Taylor dispatcher; returns the id. */
  let jDay = 11;
  const dispatched = async (extra = {}, type = "SERVICE_CALL") => {
    const dsp = office(dspT);
    const id = ok(await call("createWorkOrder", dsp, { operatingCompanyId: "taylor", customerId: "acct-1", locationId: "loc-1", workOrderType: type, priority: 2, ...extra }), "create").workOrderId;
    ok(await call("markWorkOrderReady", dsp, { workOrderId: id }), "ready");
    ok(await call("setWorkOrderPartsPlan", dsp, { workOrderId: id, plan: [] }), "plan");
    ok(await call("scheduleWorkOrder", dsp, { workOrderId: id, employeeId: "emp-techj", ...future(++jDay) }), "schedule");
    ok(await call("dispatchWorkOrder", dsp, { workOrderId: id }), "dispatch");
    return id;
  };

  await t.test("(R1 same-company lifecycle, R3 technician assignment and visibility, R4 scheduling and dispatch, R5 labor and parts, R7 status changes and completion, R9 history and search) the same-company lifecycle is unchanged: create, plan, schedule, dispatch, accept, travel, arrive, work, parts, labor, complete, close; history and search", async () => {
    await catalogPart("part-j");
    await hours();
    const tag = `journey-${randomUUID().slice(0, 8)}`;
    const dsp = office(dspT), tech = technician(techJ);
    const created = ok(await call("createWorkOrder", dsp, { operatingCompanyId: "taylor", customerId: "acct-1", locationId: "loc-1", workOrderType: "SERVICE_CALL", priority: 2, complaint: tag }), "create");
    const id = created.workOrderId;
    ok(await call("markWorkOrderReady", dsp, { workOrderId: id }), "ready");
    ok(await call("setWorkOrderPartsPlan", dsp, { workOrderId: id, plan: [{ partId: "part-j", qtyPlanned: 2 }] }), "plan");
    const s = future(8);
    ok(await call("scheduleWorkOrder", dsp, { workOrderId: id, employeeId: "emp-techj", ...s }), "schedule");
    ok(await call("setWorkOrderEstimatedDuration", dsp, { workOrderId: id, estimatedDurationMinutes: 90 }), "estimate");
    ok(await call("rescheduleWorkOrder", dsp, { workOrderId: id, expectedScheduledStart: new Date(s.scheduledStart).toISOString(), ...future(9), reason: "customer asked" }), "reschedule");
    ok(await call("dispatchWorkOrder", dsp, { workOrderId: id }), "dispatch");
    // technician assignment and visibility: the assigned technician sees it, the other company's technician does not
    assert.ok((await call("listMyAssignedWorkOrders", tech, {})).result.items.some((i) => i.workOrderId === id), "the assigned technician sees it on My Work");
    assert.equal((await call("readWorkOrder", tech, { workOrderId: id })).ok, true, "and can read it");
    assert.equal((await call("readWorkOrder", technician(techV), { workOrderId: id })).ok, false, "the other company's technician cannot");
    for (const op of ["acceptWorkOrder", "startWorkOrderTravel", "arriveAtWorkOrder", "startWorkOrderWork"]) ok(await call(op, tech, { workOrderId: id }), op);
    const used = ok(await call("recordWorkOrderExecution", tech, { workOrderId: id, idempotencyKey: `jk-${id}`, partUsage: [{ partId: "part-j", qtyDelta: 1 }], note: "replaced the filter" }), "execution");
    assert.equal(used.usage[0].appliedDelta, 1);
    ok(await call("recordWorkOrderLabor", tech, { workOrderId: id, idempotencyKey: `jl-${id}`, laborType: "ONSITE", entryKind: "DURATION", durationMinutes: 45, workDate: "2026-10-21" }), "labor");
    assert.equal(ok(await call("readWorkOrderLabor", dsp, { workOrderId: id }), "read labor").totals.totalMinutes, 45);
    const done = ok(await call("completeWorkOrder", tech, { workOrderId: id }), "complete");
    assert.equal(done.transition.toStatus, "COMPLETED");
    ok(await call("closeWorkOrder", dsp, { workOrderId: id }), "close");
    // history and search
    const detail = ok(await call("readWorkOrder", dsp, { workOrderId: id }), "detail");
    assert.deepEqual(detail.transitions.map((x) => x.toStatus), ["CREATED", "READY_TO_DISPATCH", "SCHEDULED", "DISPATCHED", "ACCEPTED", "EN_ROUTE", "ARRIVED", "WORK_IN_PROGRESS", "COMPLETED", "CLOSED"]);
    assert.deepEqual(detail.execution.parts, [{ partId: "part-j", qtyPlanned: 2, qtyUsed: 1 }]);
    assert.equal(detail.status, "CLOSED");
    const hit = async (who) => (await myWork.searchEos({ pool, postgresState: "ACTIVE" }, office(who), { query: tag })).results.filter((r) => r.kind === "workOrder").map((r) => r.id);
    assert.deepEqual(await hit(dspT), [id], "search finds it for its own company");
    assert.deepEqual(await hit(dspV), [], "and not for the other");
    assert.equal((await call("readWorkOrder", office(dspV), { workOrderId: id })).ok, false);
  });

  await t.test("(R6 inventory custody) inventory custody: the assigned technician installs a company-held whole unit on its INSTALL Work Order; the ledger and custody move once; a replay installs nothing", async () => {
    await certifyInventoryBaselineFixture(q, T);
    await catalogPart("part-unit", { control: "SERIALIZED", whole: true });
    await q(`INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by)
             VALUES ('wh-j',$1,'taylor','wh-j','Site','ACTIVE','NATIVE','fixture','fixture')`, [T]);
    await q(`INSERT INTO eos_ops.serialized_custody (id, tenant_id, part_id, serial_number, operating_company_key, status, location_type, location_id, updated_by)
             VALUES ('cust-j',$1,'part-unit','SN-J1','taylor','AVAILABLE','WAREHOUSE','wh-j','seed')`, [T]);
    await q(`INSERT INTO eos_ops.inventory_movements (id, tenant_id, operating_company_key, part_id, tracking_mode, location_type, location_id,
               movement_type, quantity_delta, serial_number, source_kind, source_id, created_by)
             VALUES ('mov-j',$1,'taylor','part-unit','SERIAL','WAREHOUSE','wh-j','RECEIVED',1,'SN-J1','FIXTURE','seed','seed')`, [T]);
    const id = await wo("taylor", "WORK_IN_PROGRESS", { type: "INSTALL" });
    await assign(id, "emp-techt");
    const tech = technician(techT);
    const input = { workOrderId: id, partId: "part-unit", serialNumber: "SN-J1", idempotencyKey: "ik-j1", equipmentName: "Journey unit" };
    const listed = ok(await call("listInstallableEquipmentForWorkOrder", tech, { workOrderId: id }), "list");
    assert.ok(listed.units.some((u) => u.serialNumber === "SN-J1"), "the company-held unit is offered");
    const installed = ok(await call("recordWorkOrderEquipmentInstall", tech, input), "install");
    assert.equal(installed.outcome, "installed");
    assert.equal(Number((await one(`SELECT count(*) n FROM eos_ops.inventory_movements WHERE source_id = $1 AND quantity_delta = -1`, [id])).n), 1, "one ledger movement out of stock");
    assert.equal(ok(await call("recordWorkOrderEquipmentInstall", tech, input), "replay").outcome, "replayed");
    assert.equal(Number((await one(`SELECT count(*) n FROM eos_ops.inventory_movements WHERE source_id = $1 AND quantity_delta = -1`, [id])).n), 1, "a replay installs nothing");
  });

  await t.test("(R2 authorized cross-company servicing, R8 billing handoff) authorized cross-company servicing: Taylor performs a Ventana sale's service under the seller's authorization; the fulfillment is recorded against the seller's order", async () => {
    await hours();
    await q(`INSERT INTO eos_commercial.sales_orders (id, tenant_id, sales_order_number, account_id, owner_employee_id, operating_company_key, state, sales_channel,
               currency, credited_salesperson_employee_id, accountable_employee_id, location_id, created_by, updated_by)
             VALUES ('so-ventana-2',$1,'SO-2026-V00002','acct-1','e-seller','ventana','IN_FULFILLMENT','RETAIL','USD','e-seller','e-seller','loc-1','f','f')`, [T]);
    await q(`INSERT INTO eos_commercial.sales_order_lines (tenant_id, sales_order_id, line_number, kind, ref, business_unit, ordered_qty, unit_price_minor)
             VALUES ($1,'so-ventana-2',1,'SERVICE','SVC-INSTALL','INSTALLATION',1,90000)`, [T]);
    await q(`INSERT INTO eos_commercial.sales_order_service_providers (tenant_id, sales_order_id, service_operating_company_key, scopes, status, reason, authorized_by)
             VALUES ($1,'so-ventana-2','taylor',ARRAY['SERVICE'],'ACTIVE','Taylor Service performs the service','f')`, [T]);
    const id = await dispatched({ salesOrderId: "so-ventana-2", salesOrderLines: [1] });
    const tech = technician(techJ);
    assert.ok((await call("listMyAssignedWorkOrders", tech, {})).result.items.some((i) => i.workOrderId === id), "the provider's technician sees the job");
    for (const op of ["acceptWorkOrder", "startWorkOrderTravel", "arriveAtWorkOrder", "startWorkOrderWork"]) ok(await call(op, tech, { workOrderId: id }), op);
    const done = ok(await call("completeWorkOrder", tech, { workOrderId: id }), "complete");
    assert.equal(done.fulfillment.status, "RECORDED", "the Sales Order fulfillment is recorded by the completion");
    assert.ok(done.billingPackage, "the billing handoff: the completion prepared the Operational Billing Package");
    assert.deepEqual([done.billingPackage.outcome, ["READY", "HELD"].includes(done.billingPackage.status), typeof done.billingPackage.packageId], ["recorded", true, "string"]);
    assert.equal(Number((await one(`SELECT count(*) n FROM eos_finance.billing_packages WHERE id = $1`, [done.billingPackage.packageId])).n), 1, "...and it is a stored package");
    const f = await one(`SELECT operating_company_key, service_operating_company_key FROM eos_commercial.sales_order_fulfillments WHERE source_work_order_id = $1`, [id]);
    assert.deepEqual([f.operating_company_key, f.service_operating_company_key], ["ventana", "taylor"], "seller = Ventana; service provider = Taylor");
    assert.equal((await one(`SELECT operating_company_key k FROM eos_commercial.sales_orders WHERE id = 'so-ventana-2'`)).k, "ventana", "the seller is never rewritten");
    assert.equal((await call("readWorkOrder", office(dspV), { workOrderId: id })).ok, false, "the Work Order stays the provider's");
  });
  // ════════════════════ DWO-1: the SELLER's narrow, read-only view of a Service Work Order another company performs ════════════════════
  await t.test("(DWO-1) the selling company sees only the permitted projection of the linked cross-company Service Work Order; it cannot operate it; unrelated callers and Work Orders are nothing", async () => {
    await hours();
    const mkOrder = async (id, number, withProvider) => {
      await q(`INSERT INTO eos_commercial.sales_orders (id, tenant_id, sales_order_number, account_id, owner_employee_id, operating_company_key, state, sales_channel,
                 currency, credited_salesperson_employee_id, accountable_employee_id, location_id, created_by, updated_by)
               VALUES ($1,$2,$3,'acct-1','e-seller','ventana','IN_FULFILLMENT','RETAIL','USD','e-seller','e-seller','loc-1','f','f')`, [id, T, number]);
      await q(`INSERT INTO eos_commercial.sales_order_lines (tenant_id, sales_order_id, line_number, kind, ref, business_unit, ordered_qty, unit_price_minor)
               VALUES ($1,$2,1,'SERVICE','SVC-INSTALL','INSTALLATION',1,90000)`, [T, id]);
      if (withProvider) {
        await q(`INSERT INTO eos_commercial.sales_order_service_providers (tenant_id, sales_order_id, service_operating_company_key, scopes, status, reason, authorized_by)
                 VALUES ($1,$2,'taylor',ARRAY['SERVICE'],'ACTIVE','Taylor Service performs the service','f')`, [T, id]);
      }
    };
    await mkOrder("so-ventana-3", "SO-2026-V00003", true);
    await mkOrder("so-ventana-4", "SO-2026-V00004", false);
    const SELLER_CAPS = [...OFFICE, "salesOrder.read"];
    const seller = callerOf(dspV, SELLER_CAPS);
    const id = await dispatched({ salesOrderId: "so-ventana-3", salesOrderLines: [1], complaint: "INTERNAL-COMPLAINT-TEXT" });
    const tech = technician(techJ);
    for (const op of ["acceptWorkOrder", "startWorkOrderTravel", "arriveAtWorkOrder", "startWorkOrderWork"]) ok(await call(op, tech, { workOrderId: id }), op);
    ok(await call("recordWorkOrderExecution", tech, { workOrderId: id, idempotencyKey: `sk-${id}`, note: "SECRET-TECH-NOTE" }), "note");
    ok(await call("recordWorkOrderLabor", tech, { workOrderId: id, idempotencyKey: `sl-${id}`, laborType: "ONSITE", entryKind: "DURATION", durationMinutes: 77, workDate: "2026-10-21" }), "labor");
    const project = async (who, soId) => call("readSalesOrderServiceWorkOrders", who, { salesOrderId: soId });

    // (1) the seller views the permitted projection while the job is in progress
    const live = ok(await project(seller, "so-ventana-3"), "projection");
    assert.deepEqual([live.salesOrderNumber, live.sellingCompanyKey, live.items.length], ["SO-2026-V00003", "ventana", 1]);
    const item = live.items[0];
    assert.deepEqual([item.workOrderId, item.salesOrderNumber, item.servicingCompanyKey, item.serviceType, item.serviceScope, item.status, item.completed, item.outcome],
      [id, "SO-2026-V00003", "taylor", "SERVICE_CALL", "SERVICE", "WORK_IN_PROGRESS", false, null]);
    assert.ok(item.scheduledStart && item.scheduledEnd, "the scheduled service window");
    assert.ok(item.progress.dispatchedAt && item.progress.workStartedAt && item.progress.completedAt === null, "progress");
    ok(await call("completeWorkOrder", tech, { workOrderId: id }), "complete");
    await q(`UPDATE eos_ops.work_orders SET resolution = 'Replaced the compressor', diagnosis = 'INTERNAL-DIAGNOSIS' WHERE id = $1`, [id]);
    const done = ok(await project(seller, "so-ventana-3"), "projection after completion").items[0];
    assert.deepEqual([done.status, done.completed, done.outcome], ["COMPLETED", true, "Replaced the compressor"], "the customer-facing outcome appears once completed");

    // (4) restricted notes, costs, labor, attachments, technician identity and internal text are absent: not one extra field, not one forbidden value
    const exact = ["workOrderId", "workOrderNumber", "salesOrderId", "salesOrderNumber", "servicingCompanyKey", "serviceType", "serviceScope", "status", "scheduledStart", "scheduledEnd", "progress", "completed", "outcome"];
    assert.deepEqual(Object.keys(done).sort(), [...exact].sort());
    // F1: the coordinated-visit read shows the seller the SAME projection, exactly its key set, never the Work Order's own row; ordinary detail still refuses
    const visits = async (principalId) => coordinated.readCoordinatedOperations({ pool }, { tenantId: T, principalId, capabilities: new Set(["fulfillment.coordinatedVisit.read"]) });
    const sellerRow = (await visits(dspV)).workOrders.find((w) => (w.workOrderId ?? w.id) === id);
    assert.ok(sellerRow, "the seller sees the visit");
    assert.deepEqual(Object.keys(sellerRow).sort(), [...exact].sort(), "...as exactly the approved projection, no customer, site, line refs or Work Order row");
    assert.deepEqual([sellerRow.servicingCompanyKey, sellerRow.salesOrderId, sellerRow.salesOrderNumber], ["taylor", "so-ventana-3", "SO-2026-V00003"], "the anchor is shown to the seller");
    assert.equal((await call("readWorkOrder", seller, { workOrderId: id })).ok, false, "...while ordinary detail still refuses");
    const ownRow = (await visits(dspT)).workOrders.find((w) => (w.workOrderId ?? w.id) === id);
    assert.ok(ownRow && ownRow.id === id && "customerId" in ownRow, "the servicing company's own row keeps its shape");
    const wire = JSON.stringify(await project(seller, "so-ventana-3"));
    for (const forbidden of ["SECRET-TECH-NOTE", "INTERNAL-DIAGNOSIS", "INTERNAL-COMPLAINT-TEXT", "emp-techj", "prn-techj", "Replaced the filter"]) assert.equal(wire.includes(forbidden), false, forbidden);
    assert.doesNotMatch(wire, /\b(labor|laborType|durationMinutes|rate|cost|price|attachment|assignee|diagnosis|complaint|equipment|notes?)\b/i);

    // (2) the seller cannot operate it: every Work Order command AND ordinary detail answer the plain miss, with no trace
    const before = await stateHash();
    for (const [op, , input] of ID_OPS) {
      const refused = await call(op, seller, input(id));
      assert.deepEqual([refused.ok, refused.code, refused.category], [false, "WORK_ORDER_NOT_FOUND", "NOT_FOUND"], `${op}: the seller does not reach the servicing company's Work Order`);
    }
    assert.equal(await stateHash(), before, "the seller's attempts changed nothing");
    // and the seller's own technician-side access is no side door either
    assert.equal((await call("readWorkOrder", technician(techV), { workOrderId: id })).ok, false);

    // (3) the seller cannot see unrelated Work Orders: one with no authorization on this order, one of another sale
    const unrelatedSameOrder = await wo("taylor", "READY_TO_DISPATCH", { salesOrderId: "so-ventana-4" });   // a Taylor Work Order naming an order with NO authorization
    const unrelatedNoOrder = await wo("taylor", "READY_TO_DISPATCH");
    const other = ok(await project(seller, "so-ventana-4"), "unauthorized order");
    assert.deepEqual(other.items, [], "a Work Order that merely names the order is not listed without the seller's authorization");
    assert.equal(JSON.stringify(await project(seller, "so-ventana-3")).includes(unrelatedNoOrder), false);
    assert.equal(JSON.stringify(other).includes(unrelatedSameOrder), false);

    assert.equal((await visits(dspV)).workOrders.some((w) => [unrelatedSameOrder, unrelatedNoOrder].includes(w.workOrderId ?? w.id)), false, "unrelated Work Orders are not in the seller's visits");
    // a REVOKED authorization ends the live visit (the coordinated read needs an ACTIVE one); the recorded projection stays
    await q(`UPDATE eos_commercial.sales_order_service_providers SET status = 'REVOKED', revoked_by = 'f', revoked_at = now(), revoke_reason = 'fixture' WHERE sales_order_id = 'so-ventana-3'`);
    assert.equal((await visits(dspV)).workOrders.some((w) => (w.workOrderId ?? w.id) === id), false, "a revoked authorization removes the live visit from the seller");
    assert.equal((await project(seller, "so-ventana-3")).result.items.length, 1, "the recorded projection remains");
    await q(`UPDATE eos_commercial.sales_order_service_providers SET status = 'ACTIVE', revoked_by = NULL, revoked_at = NULL, revoke_reason = NULL WHERE sales_order_id = 'so-ventana-3'`);
    // (8) foreign == missing for an unrelated caller: a Sales Order it does not reach reads exactly as a missing one, and without the capability it is the capability
    const taylorSeller = callerOf(dspT, SELLER_CAPS);
    const foreignSo = await project(taylorSeller, "so-ventana-3");
    const missingSo = await project(taylorSeller, "so-missing");
    assert.equal(foreignSo.ok, false);
    assert.deepEqual(words(foreignSo, "so-ventana-3"), words(missingSo, "so-missing"));
    assert.equal(foreignSo.code, "SALES_ORDER_NOT_FOUND");
    const keyless = callerOf(dspV, OFFICE);
    assert.equal((await project(keyless, "so-ventana-3")).code, "CAPABILITY_MISSING");
    assert.equal((await project(keyless, "so-missing")).code, "CAPABILITY_MISSING");

    // (5) legitimate cross-company servicing still works: the provider's people see and operate it as before
    assert.equal((await call("readWorkOrder", office(dspT), { workOrderId: id })).ok, true);
    assert.equal((await call("closeWorkOrder", office(dspT), { workOrderId: id })).ok, true);
    assert.equal((await project(seller, "so-ventana-3")).result.items[0].status, "CLOSED", "the seller sees the close");
    // the Administrator reads the projection too (it reaches every Sales Order)
    assert.equal((await project(callerOf(admin, SELLER_CAPS), "so-ventana-3")).ok, true);
  });

  // ════════════════════ DWO-2: the protected Administrator's READ visibility is tenant-wide and consistent; its MUTATIONS are unchanged ════════════════════
  await t.test("(DWO-2) the Administrator reads Taylor and Ventana consistently at every read entry point, with or without an Employee link; read visibility authorizes no mutation", async () => {
    await q(`INSERT INTO eos_policy.principals (id,external_subject,identity_provider,status) VALUES ('prn-admin2','sub-prn-admin2','eos','active')`);
    await q(`INSERT INTO eos_policy.tenant_memberships (id,tenant_id,principal_id,status) VALUES ('mem-prn-admin2',$1,'prn-admin2','active')`, [T]);
    await q(`INSERT INTO eos_policy.user_role_assignments (id,tenant_id,principal_id,role_id,scope_type,scope_value,status,granted_by,access_version_at_grant,created_by,updated_by)
             VALUES ('a-admin2',$1,'prn-admin2','role-admin','global',NULL,'active','fixture',0,'fixture','fixture')`, [T]);
    const tag = `admin-read-${randomUUID().slice(0, 8)}`;
    const tW = await wo("taylor", "READY_TO_DISPATCH", { complaint: tag });
    const vW = await wo("ventana", "READY_TO_DISPATCH", { complaint: tag });
    for (const principalId of [admin, "prn-admin2"]) {
      const adm = office(principalId);
      const label = principalId === admin ? "linked" : "unlinked";
      // every Work Order read entry point
      const listed = new Set((await call("listWorkOrders", adm, { limit: 200 })).result.items.map((i) => i.workOrderId));
      assert.ok(listed.has(tW) && listed.has(vW), `${label}: the office list covers both companies`);
      assert.equal((await call("describeWorkOrderListQuery", adm, {})).ok, true, `${label}: list query description`);
      for (const op of ["readWorkOrder", "readWorkOrderFieldContext", "readWorkOrderReadiness", "readWorkOrderLabor", "suggestWorkOrderPlacement", "listWorkOrderTechnicians"]) {
        for (const w of [tW, vW]) {
          const r = await call(op, adm, { workOrderId: w });
          assert.ok(r.ok || r.code !== "WORK_ORDER_NOT_FOUND", `${label} ${op}: reads ${w}, got ${r.code}`);
        }
      }
      const pickers = (await call("listWorkOrderTechnicians", adm, {})).result.items.map((i) => i.employeeId);
      assert.ok(pickers.includes("emp-techt") && pickers.includes("emp-techv"), `${label}: the technician picker covers both companies`);
      const board = (await call("readTechnicianAvailability", adm, { start: Date.now() + DAY, end: Date.now() + 2 * DAY, employeeIds: ["emp-techt", "emp-techv"] })).result;
      assert.deepEqual(board.notFoundEmployeeIds, [], `${label}: the schedule board reads both companies' technicians`);
      assert.equal((await call("readEmployeeWorkSchedule", adm, { employeeId: "emp-techv" })).ok, true, `${label}: a Ventana Employee's schedule`);
      const names = new Set((await myWork.searchEos({ pool, postgresState: "ACTIVE" }, adm, { query: tag })).results.filter((r) => r.kind === "workOrder").map((r) => r.id));
      assert.ok(names.has(tW) && names.has(vW), `${label}: search covers both`);
      assert.equal((await call("readTechnicianVolumeBreakdown", adm, {})).ok, true);
      const assignedToAdmin = await wo("ventana", "READY_TO_DISPATCH");
      if (principalId === admin) await assign(assignedToAdmin, "emp-admin");
      const mineAdm = (await call("listMyAssignedWorkOrders", adm, {})).result.items;
      assert.equal(mineAdm.some((i) => i.workOrderId === assignedToAdmin), principalId === admin, `${label}: My Work lists exactly the Work Orders the Administrator's Employee is assigned to`);
      assert.equal((await call("readWorkOrderConsumptionSnapshot", adm, {})).ok, true);
      const cv = await coordinated.readCoordinatedOperations({ pool }, { tenantId: T, principalId, capabilities: new Set(["fulfillment.coordinatedVisit.read"]) });
      assert.ok(cv.status === "ready", `${label}: coordinated operations`);
    }

    // read visibility is not capability: an Administrator holding no capability reads nothing and operates nothing
    const bare = callerOf(admin, []);
    for (const [op, input] of [["readWorkOrder", { workOrderId: vW }], ["markWorkOrderReady", { workOrderId: vW }],
      ["scheduleWorkOrder", { workOrderId: vW, employeeId: "emp-techt", ...future(3) }], ["listWorkOrders", {}]]) {
      const r = await call(op, bare, input);
      assert.equal(r.code, "CAPABILITY_MISSING", `${op}: capability first, whoever the caller is`);
    }
    // and every MUTATION keeps exactly the reach it had: Schedule / Reschedule / Dispatch stay bounded by the Administrator's own companies
    const adm = office(admin);
    for (const [op, state, input] of ID_OPS.filter(([name]) => OWN_MODE.has(name))) {
      const foreign = await wo("ventana", state);
      const refused = await call(op, adm, input(foreign));
      assert.deepEqual([refused.ok, refused.code], [false, "WORK_ORDER_NOT_FOUND"], `${op}: unchanged`);
    }
    // creating for a company it does not hold is refused as before; working hours of a Ventana Employee likewise
    const create = await call("createWorkOrder", adm, { operatingCompanyId: "ventana", customerId: "acct-1", locationId: "loc-1", workOrderType: "SERVICE_CALL", priority: 2 });
    assert.equal(create.ok, false, "create for a company the Administrator does not hold is unchanged");
    const hoursV = await call("setTechnicianWorkingHours", adm, { employeeId: "emp-techv", timeZone: "UTC", weeklyHours: ROUND_THE_CLOCK, reason: "dwo" });
    assert.equal(hoursV.ok, false, "a schedule MUTATION of a Ventana Employee is unchanged");
    // ...while every tenant-wide mutation it had it still has, under its own capability
    const ready = await call("markWorkOrderReady", adm, { workOrderId: await wo("ventana", "CREATED") });
    assert.equal(ready.ok, true, "tenant-wide mutations are unchanged");
  });

  // ════════════════════ F2 / Owner guidance: an OPEN assignment alone is authority over ITS Work Order -- and nothing more ════════════════════
  await t.test("(R3,F2) a technician whose ONLY reach is its assignment (home company inactive) accepts, travels, arrives, works, records parts and labor, installs, completes, reads detail and field context", async () => {
    await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id,operating_company_id,status,source,established_by,updated_by) VALUES ($1,'dormant','INACTIVE','fixture','fixture','fixture')`, [T]);
    const techD = await principal("prn-techd", { id: "emp-techd", company: "dormant", technician: true });
    const authorityModule = require("../lib/eosOps/workOrderCompanyAuthority.js");
    const reach = await authorityModule.resolveWorkOrderCompanyReach(pool, T, techD);
    assert.deepEqual([reach.hasAuthority, [...reach.companyKeys], [...reach.employeeIds]], [true, [], ["emp-techd"]], "no company at all; one Employee whose assignments count");
    const tech = technician(techD);
    for (const [op, state, input, over] of TECH_OPS) {
      const id = await wo("taylor", state, over);
      await assign(id, "emp-techd");
      const r = await call(op, tech, input(id));
      if (op === "recordWorkOrderEquipmentInstall") assert.ok(r.ok || (r.code !== "WORK_ORDER_NOT_FOUND" && r.code !== "COMPANY_AUTHORITY_REQUIRED"), `${op}: got ${r.code}`);
      else assert.equal(r.ok, true, `${op}: ${JSON.stringify(r).slice(0, 300)}`);
    }
    // ...and nothing beyond its assignment: an unassigned Work Order of ANY company is nonexistent to it
    const unassigned = await wo("taylor", "WORK_IN_PROGRESS");
    assert.equal((await call("readWorkOrder", tech, { workOrderId: unassigned })).ok, false);
    const mine = (await call("listMyAssignedWorkOrders", tech, {})).result.items;
    assert.ok(mine.length > 0 && !mine.some((i) => i.workOrderId === unassigned));
  });

  await t.test("(R11,F2) the assignment-only path does NOT bypass Employee status, session validity, an ended or reassigned assignment, capabilities or lifecycle rules", async () => {
    const tech = technician("prn-techd");
    const fresh = async (state) => { const id = await wo("taylor", state); await assign(id, "emp-techd"); return id; };
    const refusedWithNoTrace = async (what, op, who, input) => {
      const before = await stateHash();
      const r = await call(op, who, input);
      assert.equal(r.ok, false, `${what}: ${op} must be refused, got ${JSON.stringify(r).slice(0, 200)}`);
      assert.equal(await stateHash(), before, `${what}: ${op} left a trace`);
      return r;
    };
    // an ineligible Employee (ON_LEAVE; terminated is the same rule) is refused
    const a = await fresh("DISPATCHED");
    await q(`UPDATE eos_workforce.employees SET employment_status = 'ON_LEAVE' WHERE id = 'emp-techd'`);
    await refusedWithNoTrace("ineligible Employee", "acceptWorkOrder", tech, { workOrderId: a });
    await refusedWithNoTrace("ineligible Employee", "readWorkOrder", tech, { workOrderId: a });
    await q(`UPDATE eos_workforce.employees SET employment_status = 'ACTIVE' WHERE id = 'emp-techd'`);
    // a disabled Principal (session validity) is refused
    await q(`UPDATE eos_policy.principals SET status = 'disabled' WHERE id = 'prn-techd'`);
    await refusedWithNoTrace("disabled Principal", "acceptWorkOrder", tech, { workOrderId: a });
    await refusedWithNoTrace("disabled Principal", "readWorkOrder", tech, { workOrderId: a });
    await q(`UPDATE eos_policy.principals SET status = 'active' WHERE id = 'prn-techd'`);
    // an ended assignment and a reassigned one are not OPEN
    const ended = await fresh("DISPATCHED");
    await q(`UPDATE eos_ops.work_order_assignments SET effective_to = now(), end_source = 'UNSCHEDULE', end_reason = 'fixture', ended_by_principal_id = $2 WHERE work_order_id = $1`, [ended, dspT]);
    await refusedWithNoTrace("ended assignment", "acceptWorkOrder", tech, { workOrderId: ended });
    await refusedWithNoTrace("ended assignment", "readWorkOrder", tech, { workOrderId: ended });
    const moved = await fresh("DISPATCHED");
    await q(`UPDATE eos_ops.work_order_assignments SET effective_to = now(), end_source = 'RESCHEDULE', end_reason = 'fixture', ended_by_principal_id = $2 WHERE work_order_id = $1`, [moved, dspT]);
    await assign(moved, "emp-techt");
    await refusedWithNoTrace("reassigned", "acceptWorkOrder", tech, { workOrderId: moved });
    await refusedWithNoTrace("reassigned", "readWorkOrder", tech, { workOrderId: moved });
    // the capability is still required
    const noCap = callerOf("prn-techd", ["workOrder.record.read"], DQ016);
    const capRefused = await refusedWithNoTrace("no capability", "acceptWorkOrder", noCap, { workOrderId: a });
    assert.equal(capRefused.code, "CAPABILITY_MISSING");
    // the governed lifecycle still applies: accept is an edge from DISPATCHED only
    const wrongState = await fresh("COMPLETED");
    const stale = await refusedWithNoTrace("lifecycle", "acceptWorkOrder", tech, { workOrderId: wrongState });
    assert.ok(["STALE_WORK_ORDER_STATE", "TRANSITION_NOT_ALLOWED"].includes(stale.code) || stale.category === "CONFLICT" || stale.category === "PRECONDITION_FAILED", stale.code);
    // control: with every condition restored the same technician is served
    assert.equal((await call("acceptWorkOrder", tech, { workOrderId: a })).ok, true);
  });

  await t.test("(R10,R11,F4) an assignment is not office authority: a technician ASSIGNED to a foreign Work Order, holding every office capability, still cannot schedule, reschedule, dispatch, unschedule, cancel, ready, close, plan, estimate or issue a link; it is not in the office lists", async () => {
    const both = callerOf(techT, [...OFFICE, ...TECH]);             // office AND field capabilities, record.read unconditioned
    const vReady = await wo("ventana", "READY_TO_DISPATCH");
    const vSched = await wo("ventana", "SCHEDULED");
    const vCreated = await wo("ventana", "CREATED");
    const vDone = await wo("ventana", "COMPLETED");
    for (const id of [vReady, vSched, vCreated, vDone]) await assign(id, "emp-techt");
    const before = await stateHash();
    const attempts = [
      ["scheduleWorkOrder", { workOrderId: vReady, employeeId: "emp-techt", ...future(20) }], ["rescheduleWorkOrder", { workOrderId: vSched, expectedScheduledStart: new Date(Date.now() + 3 * DAY).toISOString(), ...future(21), reason: "x" }],
      ["dispatchWorkOrder", { workOrderId: vSched }], ["unscheduleWorkOrder", { workOrderId: vSched, reason: "x" }], ["cancelWorkOrder", { workOrderId: vCreated, expectedStatus: "CREATED" }],
      ["markWorkOrderReady", { workOrderId: vCreated }], ["closeWorkOrder", { workOrderId: vDone }], ["setWorkOrderPartsPlan", { workOrderId: vCreated, plan: [] }],
      ["setWorkOrderEstimatedDuration", { workOrderId: vCreated, estimatedDurationMinutes: 30 }], ["issueSelfSchedulingLink", { workOrderId: vReady }],
      ["listWorkOrderTechnicians", { workOrderId: vReady }], ["suggestWorkOrderPlacement", { workOrderId: vReady }],
    ];
    for (const [op, input] of attempts) {
      const r = await call(op, both, input);
      assert.deepEqual([r.ok, r.code], [false, "WORK_ORDER_NOT_FOUND"], `${op}: an assignment is not office authority`);
    }
    assert.equal(await stateHash(), before, "none of it left a trace (billing hand-off: the close that precedes billing is refused with the rest)");
    // ...while the field side of the same Work Order is its own
    assert.equal((await call("readWorkOrder", both, { workOrderId: vReady })).ok, true, "the assigned technician still reads its job");
    // it is not in the office list, search or coordinated visits
    const listed = new Set((await call("listWorkOrders", both, { limit: 200 })).result.items.map((i) => i.workOrderId));
    for (const id of [vReady, vSched, vCreated, vDone]) assert.equal(listed.has(id), false, "not in the office list");
    const found = (await myWork.searchEos({ pool, postgresState: "ACTIVE" }, both, { query: "WO-2031" })).results.filter((r) => r.kind === "workOrder").map((r) => r.id);
    for (const id of [vReady, vSched, vCreated, vDone]) assert.equal(found.includes(id), false, "not in search");
    const cv = await coordinated.readCoordinatedOperations({ pool }, { tenantId: T, principalId: techT, capabilities: new Set(["fulfillment.coordinatedVisit.read"]) });
    for (const id of [vReady, vSched, vCreated, vDone]) assert.equal(cv.workOrders.some((w) => (w.id ?? w.workOrderId) === id), false, "not in coordinated visits");
  });

  await t.test("(R10) a foreign id costs the same number of queries as a missing id (no timing or work oracle)", async () => {
    const foreign = await wo("ventana", "CREATED");
    const dsp = office(dspT);
    const countFor = async (op, input) => {
      const n = { count: 0 };
      const counting = new Proxy(pool, { get(target, key) {
        if (key === "query") return (...args) => { n.count += 1; return target.query(...args); };
        const v = target[key];
        return typeof v === "function" ? v.bind(target) : v;
      } });
      try { await ops.EOS_WORK_ORDER_OPERATIONS[op]({ ...deps, pool: counting }, dsp, input); } catch (e) { if (typeof e?.code !== "string") throw e; }
      return n.count;
    };
    for (const op of ["readWorkOrder", "readWorkOrderFieldContext", "readWorkOrderLabor", "readWorkOrderReadiness"]) {
      const a = await countFor(op, { workOrderId: foreign });
      const b = await countFor(op, { workOrderId: "wo-missing-count" });
      assert.ok(a > 0 && a === b, `${op}: ${a} queries for a foreign id, ${b} for a missing one`);
    }
  });

  // ════════════════════ F5: the inbound queue never names, numbers or describes a Work Order the caller does not reach ════════════════════
  await t.test("(F5) inbound: a linked Work Order the caller does not reach is not named in the queue or the detail, an Accept replay is the plain miss, and a carried Work Order discloses nothing", async () => {
    const reviewer = callerOf(dspT, [...OFFICE, "inboundWork.request.accept", "inboundWork.request.read"]);
    const inboundCall = (op, input) => run(inboundOps.EOS_INBOUND_WORK_OPERATIONS, op, reviewer, input);
    const mkRequest = (id, over) => {
      const cols = { tenant_id: T, id, source_provider: "GOOGLE_WORKSPACE", source_mailbox_id: "mb-f5", source_message_id: `m-${id}`, content_key: `ck-${id}`,
        original_body_content_type: "text/plain", ingested_by_principal_id: dspT, ...over };
      const keys = Object.keys(cols);
      return q(`INSERT INTO eos_ops.inbound_work_requests (${keys.join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")})`, keys.map((k) => cols[k]));
    };
    const foreign = await wo("ventana", "CREATED");
    const own = await wo("taylor", "CREATED");
    const decided = { decision_by_principal_id: dspT, decision_at: new Date() };
    await mkRequest("inb-f5-fa", { status: "ATTACHED", decision: "ATTACHED", work_order_id: foreign, ...decided });
    await mkRequest("inb-f5-oa", { status: "ATTACHED", decision: "ATTACHED", work_order_id: own, ...decided });
    // the queue and the detail
    const queue = (await inboundCall("listInboundWork", { statuses: ["ATTACHED"], limit: 300 })).result.rows;
    const rowOf = (id) => queue.find((r) => r.id === id);
    assert.deepEqual([rowOf("inb-f5-fa").workItemId, rowOf("inb-f5-fa").workOrderId], [null, null], "the queue does not name a Work Order the caller does not reach");
    assert.deepEqual([rowOf("inb-f5-oa").workItemId, rowOf("inb-f5-oa").workOrderId], [own, own], "the same-company link is shown");
    const detailForeign = (await inboundCall("readInboundWorkRequest", { requestId: "inb-f5-fa" })).result;
    assert.deepEqual([detailForeign.workItemId, detailForeign.workOrderId, detailForeign.workOrderNumber ?? null], [null, null, null]);
    assert.equal((await inboundCall("readInboundWorkRequest", { requestId: "inb-f5-oa" })).result.workItemId, own);
    // an Accept replay of an intake whose Work Order is not reachable is the plain miss; a reachable one replays
    await mkRequest("inb-f5-fx", { status: "ACCEPTED", decision: "ACCEPTED", work_order_id: foreign, operating_company_id: "ventana", ...decided });
    await mkRequest("inb-f5-ox", { status: "ACCEPTED", decision: "ACCEPTED", work_order_id: own, operating_company_id: "taylor", ...decided });
    const accept = (requestId) => inboundCall("acceptInboundWork", { requestId, operatingCompanyId: "taylor", customerId: "acct-1", locationId: "loc-1" });
    const replayForeign = await accept("inb-f5-fx");
    assert.deepEqual([replayForeign.ok, replayForeign.code, replayForeign.category, replayForeign.message], [false, "WORK_ORDER_NOT_FOUND", "NOT_FOUND", "that Work Order does not exist"]);
    const replayOwn = await accept("inb-f5-ox");
    assert.deepEqual([replayOwn.ok, replayOwn.result.replayed, replayOwn.result.workOrderId], [true, true, own]);
    // a carried Work Order (an interrupted Accept) that the caller does not reach reads exactly as one that no longer exists
    const carriedRequest = (id, pending) => mkRequest(id, { status: "ACCEPTING", accept_claimed_by_principal_id: dspT, accept_claim_prior_status: "NEEDS_REVIEW", accept_claimed_at: new Date(), accept_pending_work_order_id: pending });
    await carriedRequest("inb-f5-cf", foreign);
    await carriedRequest("inb-f5-cg", "wo-gone-forever");
    const before = await stateHash();
    const cf = await accept("inb-f5-cf");
    const cg = await accept("inb-f5-cg");
    assert.deepEqual([cf.ok, cf.code], [false, "RECOVERED_WORK_ORDER_CONTEXT_MISMATCH"]);
    assert.deepEqual([cf.code, cf.category, cf.message], [cg.code, cg.category, cg.message], "a carried Work Order of another company == one that does not exist");
    assert.doesNotMatch(cf.message, /differs|type|customer|site|operating company|CLOSED|CANCELLED|quarantined/);
    assert.equal(await stateHash(), before, "no trace");
  });

});
