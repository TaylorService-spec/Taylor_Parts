// WORK ORDER SERVICE PERSONA MATRIX -- the governed PostgreSQL Work Order authority, driven by the
// COMMITTED Role -> capability baseline rather than by capability sets typed into the test.
//
// Every persona's capability set is read from src/adminPolicy/seed/roleCapabilityAuthorityBaseline.json
// (the measured nonprod authority), so this suite answers "what can each service persona actually do
// with the grants the estate holds", not "what can a hand-picked capability do". A baseline change that
// widens or narrows Work Order authority for any service persona moves a row here.
//
// The matrix, per the service invariants:
//   * Employee identity governs assignment; a Principal/uid is never the assignee.
//   * Completion is RECORD_ASSIGNMENT: the assigned technician completes, another technician does not,
//     an unlinked principal does not, and nobody without the capability does -- with zero record reads.
//   * Reassignment moves FUTURE access and keeps historical ownership.
//   * The tenant boundary cannot be named across.
//
// Real PostgreSQL. Set POLICY_TEST_DATABASE_URL; without it the database half SKIPS.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const lifecycle = require("../lib/eosOps/workOrderLifecycle.js");
const assignment = require("../lib/eosOps/workOrderAssignmentAuthority.js");
const ctx = require("../lib/eosOps/contextualAuthorization.js");
const model = require("../lib/eosOps/conditionalEntitlement.js");
const woRead = require("../lib/eosOps/workOrderRecordRead.js");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

const BASELINE = JSON.parse(readFileSync(resolve(FUNCTIONS_DIR, "src/adminPolicy/seed/roleCapabilityAuthorityBaseline.json"), "utf8"));
/** The capability keys a Role holds in the committed baseline. */
const capsOf = (...roleKeys) => new Set(BASELINE.grants.filter((g) => roleKeys.includes(g.roleKey)).map((g) => g.capabilityKey));

// ════════════════════ OFFLINE: THE BASELINE'S WORK ORDER SHAPE ════════════════════

test("baseline: only the dispatch bucket (admin, dispatcher, fieldManager) may ASSIGN; only technician may COMPLETE", () => {
  const holders = (key) => [...new Set(BASELINE.grants.filter((g) => g.capabilityKey === key).map((g) => g.roleKey))].sort();
  assert.deepEqual(holders(assignment.WORK_ORDER_ASSIGN), ["admin", "dispatcher", "fieldManager"]);
  assert.deepEqual(holders(lifecycle.WORK_ORDER_LIFECYCLE_COMPLETE), ["technician"],
    "completion asserts the work was done, and the ruling binds it to the assigned Employee");
  assert.deepEqual(holders(lifecycle.WORK_ORDER_LIFECYCLE_CANCEL), ["admin", "dispatcher", "fieldManager"]);
  // The service manager (fieldManager, S6) schedules and cancels but never completes.
  assert.equal(capsOf("fieldManager").has(lifecycle.WORK_ORDER_LIFECYCLE_COMPLETE), false);
  // officeManager creates Work Orders and holds no lifecycle authority at all.
  for (const k of [assignment.WORK_ORDER_ASSIGN, lifecycle.WORK_ORDER_LIFECYCLE_COMPLETE, lifecycle.WORK_ORDER_LIFECYCLE_CANCEL]) {
    assert.equal(capsOf("officeManager").has(k), false, `officeManager must not hold ${k}`);
  }
});

test("DQ-016: no module outside the Work Order authority reads a Work Order's history or plan UNGOVERNED", async () => {
  // The raw readers are the commands' trusted internals; a transport must use workOrderRecordRead's governed
  // readers, which decide workOrder.record.read + RECORD_ASSIGNMENT first. Comments are stripped so a
  // mention is not an import.
  const { readdirSync, statSync } = await import("node:fs");
  const walk = (d) => readdirSync(d).flatMap((f) => { const p = resolve(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const ALLOWED = new Set(["eosOps/workOrderLifecycle.ts", "eosOps/workOrderPartsPlanAuthority.ts", "eosOps/workOrderRecordRead.ts"]);
  const offenders = walk(resolve(FUNCTIONS_DIR, "src")).filter((f) => f.endsWith(".ts"))
    .map((f) => [f.slice(resolve(FUNCTIONS_DIR, "src").length + 1), strip(readFileSync(f, "utf8"))])
    .filter(([rel, code]) => !ALLOWED.has(rel) && /\b(readTransitionHistory|readPartsPlan)\b/.test(code))
    .map(([rel]) => rel);
  assert.deepEqual(offenders, []);
});

// ════════════════════ AGAINST REAL POSTGRESQL ════════════════════

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

const T = "t-svc";
const T2 = "t-svc-other";

test("the service persona matrix over the governed Work Order authority", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `wosvc_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up",
    "--migrations-dir", "migrations", "--no-check-order"],
  { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe" });
  pool = new pg.Pool({ connectionString: dbUrlFor(name), max: 6 });
  const q = (sql, v = []) => pool.query(sql, v);

  // ── fixtures: two tenants, principals, Employees, links, eligibility ──
  await q(`INSERT INTO eos_policy.tenants (id,key,name) VALUES ($1,$1,$1), ($2,$2,$2)`, [T, T2]);
  // Governed company <-> key bindings (DQ-013): Taylor Work Orders carry key `taylor`; Ventana is a second
  // ACTIVE company with its own key.
  for (const [company, key] of [["taylor", "taylor"], ["ventana", "ventana"]]) {
    await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id,operating_company_id,status,source,established_by,updated_by)
             VALUES ($1,$2,'ACTIVE','fixture','fixture','fixture')`, [T, company]);
    await q(`INSERT INTO eos_policy.tenant_operating_company_keys
               (tenant_id,operating_company_id,operating_company_key,status,provenance,source,established_by,updated_by)
             VALUES ($1,$2,$3,'ACTIVE','MIGRATED','fixture','fixture','fixture')`, [T, company, key]);
  }
  const principal = async (pid, tenant = T) => {
    await q(`INSERT INTO eos_policy.principals (id,external_subject,identity_provider,status) VALUES ($1,$2,'firebase','active')`,
      [pid, `uid-${pid}`]);
    await q(`INSERT INTO eos_policy.tenant_memberships (id,tenant_id,principal_id,status) VALUES ($1,$2,$3,'active')`,
      [`mem-${pid}`, tenant, pid]);
  };
  const employee = async (eid, status = "ACTIVE", tenant = T, company = "taylor") => {
    await q(`INSERT INTO eos_workforce.employees (id,tenant_id,employment_status,operating_company_id,employee_number)
             VALUES ($1,$2,$3,$4,$1)`, [eid, tenant, status, company]);
    await q(`INSERT INTO eos_workforce.employee_work_eligibility
               (id,tenant_id,employee_id,qualification_code,effective_from,assigned_by,reason)
             VALUES ($1,$2,$3,'SERVICE_TECHNICIAN',now(),'fixture','service matrix fixture')`, [`elig-${eid}`, tenant, eid]);
  };
  const link = (pid, eid, tenant = T) => q(
    `INSERT INTO eos_policy.employee_principal_links
       (id,tenant_id,principal_id,employee_id,operating_company_id,link_source,status,asserted_by,assertion_reason)
     VALUES ($1,$2,$3,$4,'taylor','OPERATOR_ASSERTED','active','fixture','service matrix fixture')`,
    [`lnk-${pid}`, tenant, pid, eid]);

  // Personas. Principal ids are deliberately NOT Employee ids, so an accidental id comparison fails.
  for (const p of ["prn-dispatcher", "prn-svcmgr", "prn-office", "prn-parts", "prn-tech-a", "prn-tech-b",
    "prn-tech-unlinked", "prn-tech-leave", "prn-tech-contract"]) await principal(p);
  await principal("prn-tech-foreign", T2);
  await employee("emp-tech-a"); await link("prn-tech-a", "emp-tech-a");
  await employee("emp-tech-b"); await link("prn-tech-b", "emp-tech-b");
  await employee("emp-tech-leave"); await link("prn-tech-leave", "emp-tech-leave");
  await employee("emp-tech-contract", "CONTRACTOR"); await link("prn-tech-contract", "emp-tech-contract");
  await employee("emp-tech-foreign", "ACTIVE", T2); await link("prn-tech-foreign", "emp-tech-foreign", T2);
  await principal("prn-tech-ventana");
  await employee("emp-tech-ventana", "ACTIVE", T, "ventana"); await link("prn-tech-ventana", "emp-tech-ventana");
  // prn-tech-unlinked holds the technician Role's capabilities and has NO Employee link at all.

  await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, created_by, updated_by)
           VALUES ('acct-1',$1,'Cust','ACTIVE','f','f')`, [T]);
  const workOrder = (id, status) => q(
    `INSERT INTO eos_ops.work_orders
       (id, tenant_id, operating_company_key, status, work_order_type, priority, customer_id,
        location_id, provenance, created_by_principal_id, created_at, updated_at)
     VALUES ($1, $2, 'taylor', $3, 'SERVICE_CALL', 2, 'acct-1', 'loc-1', 'NATIVE', 'prn-dispatcher', now(), now())`,
    [id, T, status]);
  await workOrder("wo-a", "READY_TO_DISPATCH");

  const PERSONA = Object.freeze({
    dispatcher:     { principalId: "prn-dispatcher",    caps: capsOf("dispatcher") },
    serviceManager: { principalId: "prn-svcmgr",        caps: capsOf("fieldManager") },
    officeManager:  { principalId: "prn-office",        caps: capsOf("officeManager") },
    partsAssociate: { principalId: "prn-parts",         caps: capsOf("partsAssociate") },
    techAssigned:   { principalId: "prn-tech-a",        caps: capsOf("technician") },
    techOther:      { principalId: "prn-tech-b",        caps: capsOf("technician") },
    techUnlinked:   { principalId: "prn-tech-unlinked", caps: capsOf("technician") },
  });
  const actor = (p, tenant = T) => ({ tenantId: tenant, principalId: p.principalId, capabilities: p.caps });
  const reader = ctx.postgresContextualReader(pool);

  // ── ASSIGN: who may give work, and to whom ──
  await t.test("ASSIGN matrix: only the dispatch bucket assigns; technicians, office and parts cannot", async () => {
    for (const [who, expectAllowed] of [["techAssigned", false], ["techOther", false], ["officeManager", false],
      ["partsAssociate", false], ["techUnlinked", false]]) {
      await assert.rejects(
        assignment.assignWorkOrderToEmployee({ pool }, actor(PERSONA[who]),
          { workOrderId: "wo-a", employeeId: "emp-tech-a", source: "SCHEDULE" }),
        (e) => { assert.equal(e.code, "CAPABILITY_REQUIRED", who); return true; }, `${who} expectAllowed=${expectAllowed}`);
    }
    const r = await assignment.assignWorkOrderToEmployee({ pool }, actor(PERSONA.serviceManager),
      { workOrderId: "wo-a", employeeId: "emp-tech-a", source: "SCHEDULE" });
    assert.equal(r.outcome, "ASSIGNED", "the service manager (fieldManager, S6) schedules work");
  });

  await t.test("ASSIGN matrix: the assignee must be an ACTIVE, linked, qualified Employee of THIS tenant", async () => {
    const dispatch = (employeeId) => assignment.assignWorkOrderToEmployee({ pool }, actor(PERSONA.dispatcher),
      { workOrderId: "wo-a", employeeId, source: "DISPATCH_REASSIGN", reason: "matrix" });
    // A Principal id or a uid is not an Employee id.
    await assert.rejects(dispatch("prn-tech-b"), /does not exist in this tenant/);
    await assert.rejects(dispatch("uid-prn-tech-b"), /does not exist in this tenant/);
    // A foreign-tenant Employee cannot be named across the boundary.
    await assert.rejects(dispatch("emp-tech-foreign"), /does not exist in this tenant/);
    // A Ventana Employee is not eligible for a Taylor Work Order (DQ-013).
    await assert.rejects(dispatch("emp-tech-ventana"), (e) => e.code === "EMPLOYEE_NOT_ELIGIBLE_FOR_OPERATING_COMPANY");
    const { rows } = await q(`SELECT assignee_employee_id FROM eos_ops.work_order_assignments
                               WHERE work_order_id='wo-a' AND effective_to IS NULL`);
    assert.deepEqual(rows.map((r) => r.assignee_employee_id), ["emp-tech-a"], "no refused attempt moved the assignment");
  });

  await t.test("DQ-012: a CONTRACTOR technician is assigned, and completes their own job like any assignee", async () => {
    await workOrder("wo-contract", "READY_TO_DISPATCH");
    const r = await assignment.assignWorkOrderToEmployee({ pool }, actor(PERSONA.dispatcher),
      { workOrderId: "wo-contract", employeeId: "emp-tech-contract", source: "SCHEDULE" });
    assert.equal(r.outcome, "ASSIGNED");
    const contractor = { principalId: "prn-tech-contract", caps: capsOf("technician") };
    const d = await lifecycle.authorizeLifecycleEdge(reader, actor(contractor),
      { workOrderId: "wo-contract", expectedStatus: "WORK_IN_PROGRESS", toStatus: "COMPLETED" });
    assert.equal(d.reason, "ALLOWED");
  });

  // ── COMPLETE: RECORD_ASSIGNMENT, Employee against Employee ──
  const complete = { workOrderId: "wo-a", expectedStatus: "WORK_IN_PROGRESS", toStatus: "COMPLETED" };
  const decide = (p, input = complete, tenant = T) => lifecycle.authorizeLifecycleEdge(reader, actor(p, tenant), input);

  await t.test("COMPLETE matrix: assigned technician ALLOWED; every nearby persona refused with its own reason", async () => {
    const expected = {
      techAssigned: "ALLOWED",
      techOther: "NOT_ASSIGNED",
      techUnlinked: "EMPLOYEE_LINK_REQUIRED",
      dispatcher: "CAPABILITY_MISSING",
      serviceManager: "CAPABILITY_MISSING",
      officeManager: "CAPABILITY_MISSING",
      partsAssociate: "CAPABILITY_MISSING",
    };
    const actual = {};
    for (const who of Object.keys(expected)) actual[who] = (await decide(PERSONA[who])).reason;
    assert.deepEqual(actual, expected);
  });

  await t.test("COMPLETE: a technician of ANOTHER tenant holding the same Role cannot reach this Work Order", async () => {
    const foreign = { principalId: "prn-tech-foreign", caps: capsOf("technician") };
    // Stated as their own tenant: no assignment of theirs exists there.
    assert.equal((await decide(foreign, complete, T2)).reason, "NOT_ASSIGNED");
    // Stated as THIS tenant: they have no link here, so they resolve to no Employee at all.
    assert.equal((await decide(foreign, complete, T)).reason, "EMPLOYEE_LINK_REQUIRED");
  });

  // ── REASSIGNMENT: future access moves, history stays ──
  await t.test("REASSIGNMENT moves FUTURE access and keeps historical ownership", async () => {
    const r = await assignment.assignWorkOrderToEmployee({ pool }, actor(PERSONA.dispatcher),
      { workOrderId: "wo-a", employeeId: "emp-tech-b", source: "DISPATCH_REASSIGN", reason: "tech A called out" });
    assert.equal(r.outcome, "REASSIGNED");
    assert.equal((await decide(PERSONA.techAssigned)).reason, "NOT_ASSIGNED", "A lost the job going forward");
    assert.equal((await decide(PERSONA.techOther)).reason, "ALLOWED", "B gained it");
    const { rows } = await q(`SELECT assignee_employee_id, effective_to IS NULL AS current, assigned_by_principal_id, end_reason
                                FROM eos_ops.work_order_assignments WHERE work_order_id='wo-a' ORDER BY effective_from, id`);
    assert.deepEqual(rows.map((x) => [x.assignee_employee_id, x.current]), [["emp-tech-a", false], ["emp-tech-b", true]],
      "A's interval is ENDED, not deleted and not re-pointed");
    assert.equal(rows[0].assigned_by_principal_id, "prn-svcmgr", "who originally assigned it is still recorded");
    assert.equal(rows[0].end_reason, "tech A called out");
    // The ORIGINAL own-assignment predicate agrees with the evaluator.
    assert.equal(await assignment.isCallerTheAssignedEmployee(pool, T, "prn-tech-a", "wo-a"), false);
    assert.equal(await assignment.isCallerTheAssignedEmployee(pool, T, "prn-tech-b", "wo-a"), true);
  });

  await t.test("the capability is checked before ANY record read, for every refused persona", async () => {
    for (const who of ["dispatcher", "serviceManager", "officeManager", "partsAssociate"]) {
      let reads = 0;
      const counting = Object.fromEntries(Object.entries(reader).map(([k, fn]) => [k, (...a) => { reads += 1; return fn(...a); }]));
      const d = await lifecycle.authorizeLifecycleEdge(counting, actor(PERSONA[who]), complete);
      assert.equal(d.reason, "CAPABILITY_MISSING", who);
      assert.equal(reads, 0, `${who} caused a record read before being refused`);
    }
  });

  // ── ON LEAVE: characterised, not endorsed ──
  await t.test("CHARACTERISATION (XLF-001, L5 owns the central fix; re-pin when it lands): an assigned technician placed ON_LEAVE is still ALLOWED to complete", async () => {
    // New assignments already refuse a non-ACTIVE Employee (assignWorkOrderToEmployee). But neither the
    // RECORD_ASSIGNMENT evaluator nor principal-context resolution consults PostgreSQL employment status,
    // so an EXISTING assignment keeps working after the Employee goes on leave. Whether that is refused
    // belongs to the access-eligibility authority (workforce ruling 2), a shared foundation this lane does
    // not own -- recorded as an XLF. When that authority lands, this case must be REWRITTEN to expect the
    // refusal, not deleted.
    await workOrder("wo-leave", "READY_TO_DISPATCH");
    await assignment.assignWorkOrderToEmployee({ pool }, actor(PERSONA.dispatcher),
      { workOrderId: "wo-leave", employeeId: "emp-tech-leave", source: "SCHEDULE" });
    await q(`UPDATE eos_workforce.employees SET employment_status='ON_LEAVE' WHERE tenant_id=$1 AND id='emp-tech-leave'`, [T]);
    const onLeave = { principalId: "prn-tech-leave", caps: capsOf("technician") };
    const d = await decide(onLeave, { ...complete, workOrderId: "wo-leave" });
    assert.equal(d.reason, "ALLOWED");
    // ...and a NEW assignment to the same Employee is refused, so the two paths currently disagree.
    await workOrder("wo-leave-2", "READY_TO_DISPATCH");
    await assert.rejects(assignment.assignWorkOrderToEmployee({ pool }, actor(PERSONA.dispatcher),
      { workOrderId: "wo-leave-2", employeeId: "emp-tech-leave", source: "SCHEDULE" }), /only an ACTIVE or CONTRACTOR Employee/);
  });

  // ── DQ-010: the dispatcher-bucket edges have their OWN capabilities, held by nobody by default ──
  await t.test("DQ-010: CLOSE and MARK READY need workOrder.lifecycle.close / .ready -- no baseline persona holds them", async () => {
    // Before DQ-010 these edges were gated by the broad workOrder.transition, so an UNASSIGNED technician
    // could close anybody's job. The ruling registers distinct BUSINESS_ACTION capabilities with NO grants:
    // every baseline persona is now refused until Administration grants them.
    await workOrder("wo-done", "WORK_IN_PROGRESS");
    await q(`UPDATE eos_ops.work_orders SET status='COMPLETED', completed_at=now() WHERE id='wo-done'`);
    await workOrder("wo-new", "CREATED");
    for (const who of Object.keys(PERSONA)) {
      await assert.rejects(lifecycle.transitionWorkOrder({ pool }, actor(PERSONA[who]),
        { workOrderId: "wo-done", expectedStatus: "COMPLETED", toStatus: "CLOSED" }),
      (e) => { assert.equal(e.code, "CAPABILITY_MISSING", who); assert.match(e.message, /workOrder\.lifecycle\.close/); return true; }, who);
      await assert.rejects(lifecycle.transitionWorkOrder({ pool }, actor(PERSONA[who]),
        { workOrderId: "wo-new", expectedStatus: "CREATED", toStatus: "READY_TO_DISPATCH" }),
      (e) => { assert.equal(e.code, "CAPABILITY_MISSING", who); assert.match(e.message, /workOrder\.lifecycle\.ready/); return true; }, who);
    }
    // Whoever Administration grants them to can perform exactly that edge -- and nothing else.
    const closer = { tenantId: T, principalId: "prn-dispatcher", capabilities: new Set(["workOrder.lifecycle.close"]) };
    assert.equal((await lifecycle.transitionWorkOrder({ pool }, closer,
      { workOrderId: "wo-done", expectedStatus: "COMPLETED", toStatus: "CLOSED" })).toStatus, "CLOSED");
    await assert.rejects(lifecycle.transitionWorkOrder({ pool }, closer,
      { workOrderId: "wo-new", expectedStatus: "CREATED", toStatus: "READY_TO_DISPATCH" }),
    (e) => { assert.equal(e.code, "CAPABILITY_MISSING"); return true; }, "close does not imply ready");
    // And the four new keys are REGISTERED, with no Role grant anywhere.
    const { rows } = await q(`SELECT c.key, count(rc.id)::int AS grants FROM eos_policy.capabilities c
                                LEFT JOIN eos_policy.role_capabilities rc ON rc.capability_id = c.id
                               WHERE c.key IN ('workOrder.lifecycle.ready','workOrder.lifecycle.schedule','workOrder.lifecycle.close','workOrder.parts.plan')
                               GROUP BY c.key ORDER BY c.key`);
    assert.deepEqual(rows.map((r) => [r.key, r.grants]), [
      ["workOrder.lifecycle.close", 0], ["workOrder.lifecycle.ready", 0],
      ["workOrder.lifecycle.schedule", 0], ["workOrder.parts.plan", 0],
    ]);
  });

  // ── DQ-016: technician read = workOrder.record.read + RECORD_ASSIGNMENT, no tenant-wide fallback ──
  await t.test("DQ-016: the governed WO read -- conditioned technician reads own only; dispatcher reads any; no record = no read", async () => {
    // The technician grant as Administration conditions it (setGrantCondition, CASE D), composed by the
    // SAME entitlement model the runtime uses. The dispatcher grant is unconditioned.
    const conditions = model.grantConditionCatalog([{ grantor: { kind: "ROLE", roleKey: "technician" },
      capabilityKey: "workOrder.record.read",
      condition: { paths: [[{ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" }]], recordKind: "workOrder" } }]);
    const opActor = (principalId, roleKey) => {
      const ent = model.entitlementsFrom(
        [...capsOf(roleKey)].map((capabilityKey) => ({ grantor: { kind: "ROLE", roleKey }, capabilityKey })), conditions);
      const flat = new Set(ent.filter((e) => e.condition === null).map((e) => e.capabilityKey));
      const cond = new Set(ent.filter((e) => e.condition !== null).map((e) => e.capabilityKey));
      return { tenantId: T, principalId, capabilities: flat, conditionallyHeld: cond, entitlements: () => ent };
    };
    const techB = opActor("prn-tech-b", "technician");     // currently assigned wo-a (reassigned above)
    const techA = opActor("prn-tech-a", "technician");     // assigned to nothing
    const unlinked = opActor("prn-tech-unlinked", "technician");
    const dispatcher = opActor("prn-dispatcher", "dispatcher");
    const office = opActor("prn-office", "officeManager");
    const decide = (a, id) => woRead.authorizeWorkOrderRecordRead(reader, a, id);

    assert.deepEqual([(await decide(techB, "wo-a")).allowed, (await decide(techB, "wo-a")).viaCondition], [true, true]);
    assert.equal((await decide(techA, "wo-a")).outcome, "NOT_ASSIGNED", "another technician does NOT gain access");
    assert.equal((await decide(unlinked, "wo-a")).allowed, false);
    assert.equal((await decide(techB, "wo-does-not-exist")).outcome, (await decide(techA, "wo-a")).outcome,
      "a guessed id and another's real id refuse identically");
    assert.deepEqual([(await decide(dispatcher, "wo-a")).allowed, (await decide(dispatcher, "wo-a")).viaCondition], [true, false]);
    assert.equal((await decide(office, "wo-a")).outcome, "CAPABILITY_MISSING");
    // NO TENANT-WIDE FALLBACK: no record id is refused before the evaluator, and a flat-only actor
    // (no entitlements) is refused rather than decided by capabilities.has().
    for (const bad of [undefined, "", "a/b"]) {
      await assert.rejects(decide(techB, bad), (e) => e.code === "WORK_ORDER_ID_REQUIRED");
    }
    await assert.rejects(decide({ tenantId: T, principalId: "prn-tech-b", capabilities: new Set(["workOrder.record.read"]) }, "wo-a"),
      (e) => e.code === "ACTOR_CONTEXT_REQUIRED");
    // The governed readers enforce the same decision before returning data.
    const deps = { db: pool, reader };
    assert.ok((await woRead.readWorkOrderTransitionHistoryGoverned(deps, dispatcher, "wo-a")).length >= 0);
    await assert.rejects(woRead.readWorkOrderTransitionHistoryGoverned(deps, techA, "wo-a"), (e) => e.code === "NOT_ASSIGNED");
    await assert.rejects(woRead.readWorkOrderPartsPlanGoverned(deps, techA, "wo-a"), (e) => e.code === "NOT_ASSIGNED");
    assert.deepEqual(await woRead.readWorkOrderPartsPlanGoverned(deps, techB, "wo-a"), []);
  });

  // ── the PostgreSQL edges that exist today ──
  await t.test("LIFECYCLE: no persona can reach an effect-bearing or deferred edge through PostgreSQL today", async () => {
    await q(`UPDATE eos_ops.work_orders SET status='WORK_IN_PROGRESS' WHERE id='wo-a'`);
    // Even the ALLOWED-by-authorization assigned technician is refused UNAVAILABLE: completion's
    // consume/finalize effect is not composed, and the status alone would misreport what happened.
    await assert.rejects(lifecycle.transitionWorkOrder({ pool }, actor(PERSONA.techOther), complete),
      (e) => { assert.equal(e.code, "TRANSITION_AUTHORITY_UNAVAILABLE"); return true; });
    await assert.rejects(lifecycle.transitionWorkOrder({ pool }, actor(PERSONA.techAssigned), complete),
      (e) => { assert.equal(e.code, "NOT_ASSIGNED"); return true; }, "authorization answers before availability");
    const { rows } = await q(`SELECT status::text AS s FROM eos_ops.work_orders WHERE id='wo-a'`);
    assert.equal(rows[0].s, "WORK_IN_PROGRESS");
  });
});
