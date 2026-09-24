// WORK ORDER LIFECYCLE ACTIVATION -- Owner ruling B (NONPROD, 2026-09-23), proved twice:
//
//   1. THE GRANT SET IS EXACTLY FIVE, and it is five for structural reasons, not because somebody
//      counted carefully once. "Do not grant lifecycle capabilities to any additional Roles" only
//      stays true if a sixth entry fails a test.
//   2. COMPLETION IS BOUND TO THE ASSIGNMENT, and the capability is checked BEFORE the assignment is
//      looked up. The second half is not a comment here: a COUNTING reader proves an unauthorized
//      caller causes ZERO record reads, because "that Work Order is not yours" told to somebody with
//      no Work Order authority at all is a disclosure, not a refusal.
//
// Real PostgreSQL, never an emulator: the grant's uniqueness, the open assignment interval and the
// employee_principal_links join are properties of the database, and a double would prove none of them.
// Set POLICY_TEST_DATABASE_URL to run the database half; without it that half SKIPS.
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

const activation = require("../lib/adminPolicy/workOrderLifecycleGrantActivation.js");
const lifecycle = require("../lib/eosOps/workOrderLifecycle.js");
const ctx = require("../lib/eosOps/contextualAuthorization.js");
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");
const { assignWorkOrderToEmployee } = require("../lib/eosOps/workOrderAssignmentAuthority.js");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

// ════════════════════ THE RULING, TRANSCRIBED ONCE, IN THE TEST TOO ════════════════════
//
// Written out here independently of the module under test. A test that imported the module's own
// list and compared it to itself would pass for any list at all.
const RULING = [
  ["workOrder", "dispatch", "admin"],
  ["workOrder", "dispatch", "dispatcher"],
  ["workOrder", "cancel", "admin"],
  ["workOrder", "cancel", "dispatcher"],
  ["workOrder", "complete", "technician"],
];

const asTriples = (grants) => grants.map((g) => [g.objectKey, g.actionKey, g.roleKey]);

// ════════════════════════════════ THE SET ════════════════════════════════

test("the activation set is EXACTLY the five grants the Owner authorized", () => {
  assert.deepEqual(
    asTriples(activation.WORK_ORDER_LIFECYCLE_ACTIVATION_GRANTS).slice().sort(),
    RULING.slice().sort(),
  );
  assert.equal(activation.WORK_ORDER_LIFECYCLE_ACTIVATION_GRANTS.length, 5);
});

test("no Role outside admin/dispatcher/technician appears, and no Object outside workOrder", () => {
  const roleKeys = new Set(activation.WORK_ORDER_LIFECYCLE_ACTIVATION_GRANTS.map((g) => g.roleKey));
  assert.deepEqual([...roleKeys].sort(), ["admin", "dispatcher", "technician"]);
  // `owner` in particular: OWNER_PERMISSIONS spreads ADMIN_ROLE.permissions, so any route through the
  // Role catalog would have handed it these three by composition. This route does not.
  assert.equal(roleKeys.has("owner"), false, "owner is an ADDITIONAL Role and the ruling excluded it");
  const objectKeys = new Set(activation.WORK_ORDER_LIFECYCLE_ACTIVATION_GRANTS.map((g) => g.objectKey));
  assert.deepEqual([...objectKeys], ["workOrder"]);
});

test("COMPLETE is technician only -- never admin, never dispatcher", () => {
  const completers = activation.WORK_ORDER_LIFECYCLE_ACTIVATION_GRANTS
    .filter((g) => g.actionKey === "complete").map((g) => g.roleKey);
  assert.deepEqual(completers, ["technician"],
    "completion asserts the work was done; the ruling binds that assertion to the assigned Employee");
});

test("DISPATCH and CANCEL are admin + dispatcher, and the two sets are identical", () => {
  const forAction = (a) => activation.WORK_ORDER_LIFECYCLE_ACTIVATION_GRANTS
    .filter((g) => g.actionKey === a).map((g) => g.roleKey).sort();
  assert.deepEqual(forAction("dispatch"), ["admin", "dispatcher"]);
  assert.deepEqual(forAction("cancel"), ["admin", "dispatcher"]);
});

test("the activation module mints no direct PRINCIPAL grant -- it cannot even reach the command", () => {
  const source = readFileSync(resolve(FUNCTIONS_DIR, "src/adminPolicy/workOrderLifecycleGrantActivation.ts"), "utf8");
  const imports = source.slice(source.indexOf("import {"), source.indexOf("export const WORK_ORDER_OBJECT_KEY"));
  assert.equal(imports.includes("grantObjectActionToPrincipal"), false,
    "a direct Principal grant mints authority outside any Role; the ruling authorized Roles");
  assert.equal(/\bgrantPrincipalCapability\b/.test(source), false);
  // NO RAW SQL FOR ANY MUTATION: this module holds no query and no driver import.
  assert.equal(/\bfrom "pg"\b|require\("pg"\)/.test(source), false, "no postgres driver in this module");
  assert.equal(/INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM/i.test(source), false, "no SQL in this module");
});

// ════════════════════ THE RECORD CONTEXT EACH CAPABILITY DECLARES ════════════════════

test("COMPLETE declares RECORD_ASSIGNMENT, and exactly that one predicate", () => {
  const p = lifecycle.lifecycleContextPredicates(lifecycle.WORK_ORDER_LIFECYCLE_COMPLETE);
  assert.deepEqual(p, [{ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" }]);
});

test("DISPATCH and CANCEL declare NO context predicate -- they do not inherit the technician's", () => {
  assert.deepEqual(lifecycle.lifecycleContextPredicates(lifecycle.WORK_ORDER_LIFECYCLE_DISPATCH), []);
  assert.deepEqual(lifecycle.lifecycleContextPredicates(lifecycle.WORK_ORDER_LIFECYCLE_CANCEL), []);
  assert.deepEqual(lifecycle.lifecycleContextPredicates(lifecycle.WORK_ORDER_TRANSITION), []);
});

test("completion's relation is ASSIGNMENT -- not owner, not requester, not Role, not Scope", () => {
  const kinds = Object.values(lifecycle.LIFECYCLE_CONTEXT_PREDICATES).flat().map((p) => p.kind);
  assert.deepEqual([...new Set(kinds)], ["RECORD_ASSIGNMENT"]);
  assert.equal(kinds.includes("OPERATIONAL_SCOPE"), false,
    "'may work in this territory' is not 'is assigned this job'");
  assert.equal(kinds.includes("WORK_ELIGIBILITY"), false,
    "eligibility is what work an Employee MAY be given; it is not which job is theirs");
});

// ════════════════════════════ AGAINST REAL POSTGRESQL ════════════════════════════

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

const T = "t-wo-lifecycle";
const OPERATOR = "prn-operator";
const caps = (...k) => new Set(k);

test("the five grants, and the assignment they gate", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `wolife_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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
  const repo = new PostgresPolicyRepository(pool);

  // ── fixtures. Roles and the Object go in through the governed repository, never by hand-written SQL ──
  await q(`INSERT INTO eos_policy.tenants (id,key,name) VALUES ($1,$1,$1)`, [T]);
  const roleIdByKey = new Map();
  await repo.transact({ tenantId: T, uid: OPERATOR }, async (tx) => {
    await tx.createObject({
      key: "workOrder", label: "Work Order", labelPlural: "Work Orders", description: null,
      origin: "SYSTEM", lifecycle: "ACTIVE", supportsDelete: false,
    });
    // `owner` is created too, precisely so its ABSENCE from the grant table afterwards is measured
    // rather than merely unmentioned.
    for (const key of ["admin", "dispatcher", "technician", "owner"]) {
      const r = await tx.createRole({ key, name: key, description: null, origin: "SYSTEM", protected: key === "admin" || key === "owner" });
      roleIdByKey.set(key, r.id);
    }
  });

  const adminActor = { tenantId: T, uid: OPERATOR, heldRoleKeys: ["admin"] };

  await t.test("DRY RUN proposes five and writes nothing", async () => {
    const before = (await repo.listRoleCapabilities(T)).length;
    const report = await activation.activateWorkOrderLifecycleGrants(repo, adminActor, { reason: "dry run" });
    assert.equal(report.apply, false);
    assert.equal(report.proposedAdditions, 5);
    assert.equal(report.appliedAdditions, 0);
    assert.deepEqual(report.rows.map((r) => r.status), Array(5).fill("PROPOSED"));
    assert.equal((await repo.listRoleCapabilities(T)).length, before, "a dry run wrote a row");
  });

  await t.test("APPLY writes exactly five rows, and the count moves by exactly five", async () => {
    const before = (await repo.listRoleCapabilities(T)).length;
    const report = await activation.activateWorkOrderLifecycleGrants(repo, adminActor,
      { apply: true, reason: "Owner ruling B" });
    assert.equal(report.appliedAdditions, 5);
    assert.equal(report.beforeCount, before);
    assert.equal(report.afterCount, before + 5);
    assert.deepEqual(report.rows.map((r) => r.status), Array(5).fill("APPLIED"));

    const { rows } = await q(
      `SELECT r.key AS role_key, c.key AS capability_key
         FROM eos_policy.role_capabilities rc
         JOIN eos_policy.roles r ON r.id = rc.role_id
         JOIN eos_policy.capabilities c ON c.id = rc.capability_id
        WHERE rc.tenant_id = $1 AND c.key LIKE 'workOrder.lifecycle.%'
        ORDER BY c.key, r.key`, [T]);
    assert.deepEqual(rows.map((r) => `${r.role_key}|${r.capability_key}`), [
      "admin|workOrder.lifecycle.cancel",
      "dispatcher|workOrder.lifecycle.cancel",
      "technician|workOrder.lifecycle.complete",
      "admin|workOrder.lifecycle.dispatch",
      "dispatcher|workOrder.lifecycle.dispatch",
    ]);
    assert.equal(rows.some((r) => r.role_key === "owner"), false, "owner gained nothing");
    assert.equal(rows.some((r) => r.role_key === "admin" && r.capability_key.endsWith("complete")), false);
    assert.equal(rows.some((r) => r.role_key === "technician" && r.capability_key.endsWith("dispatch")), false);
  });

  await t.test("each applied grant left one audit event naming the Object, action and grantee", async () => {
    const { rows } = await q(
      `SELECT action, after FROM eos_policy.audit_events
        WHERE tenant_id = $1 AND action = 'grantObjectActionToRole' ORDER BY id`, [T]);
    assert.equal(rows.length, 5, "a capability grant that left no audit trail is not governed");
    for (const r of rows) {
      assert.equal(r.after.objectKey, "workOrder");
      assert.equal(r.after.granteeType, "ROLE");
    }
  });

  await t.test("a second APPLY is a no-op: five ALREADY_GRANTED, zero additions", async () => {
    const report = await activation.activateWorkOrderLifecycleGrants(repo, adminActor,
      { apply: true, reason: "rerun" });
    assert.equal(report.appliedAdditions, 0);
    assert.deepEqual(report.rows.map((r) => r.status), Array(5).fill("ALREADY_GRANTED"));
    assert.equal(report.afterCount, report.beforeCount);
  });

  await t.test("a non-admin actor is refused -- 'what a Role may do' is admin-only", async () => {
    await assert.rejects(
      () => activation.activateWorkOrderLifecycleGrants(repo,
        { tenantId: T, uid: "prn-gm", heldRoleKeys: ["generalManager", "dispatcher"] },
        { apply: true, reason: "should not happen" }),
      /not authorized to perform "editRoleDefinition"/);
  });

  // ── the Work Order, two technicians, and ONE governed assignment ──
  const mkPrincipal = async (pid, sub) => {
    await q(`INSERT INTO eos_policy.principals (id,external_subject,identity_provider,status)
             VALUES ($1,$2,'firebase','active')`, [pid, sub]);
    await q(`INSERT INTO eos_policy.tenant_memberships (id,tenant_id,principal_id,status)
             VALUES ($1,$2,$3,'active')`, [`mem-${pid}`, T, pid]);
  };
  await mkPrincipal("prn-tech-a", "uid-tech-a");
  await mkPrincipal("prn-tech-b", "uid-tech-b");
  await mkPrincipal("prn-dispatcher", "uid-dispatcher");
  await mkPrincipal("prn-office", "uid-office");
  for (const [eid, num] of [["emp-tech-a", "T1"], ["emp-tech-b", "T2"]]) {
    await q(`INSERT INTO eos_workforce.employees (id,tenant_id,employment_status,operating_company_id,employee_number)
             VALUES ($1,$2,'ACTIVE','taylor',$3)`, [eid, T, num]);
    await q(`INSERT INTO eos_workforce.employee_work_eligibility
               (id,tenant_id,employee_id,qualification_code,effective_from,assigned_by,reason)
             VALUES ($1,$2,$3,'SERVICE_TECHNICIAN',now(),'fixture','lane T fixture')`,
    [`elig-${eid}`, T, eid]);
  }
  await q(`INSERT INTO eos_policy.employee_principal_links
             (id,tenant_id,principal_id,employee_id,operating_company_id,link_source,status,asserted_by,assertion_reason)
           VALUES ('lnk-a',$1,'prn-tech-a','emp-tech-a','taylor','OPERATOR_ASSERTED','active','fixture','lane T fixture'),
                  ('lnk-b',$1,'prn-tech-b','emp-tech-b','taylor','OPERATOR_ASSERTED','active','fixture','lane T fixture')`, [T]);
  await q(`INSERT INTO eos_ops.work_orders
             (id,tenant_id,operating_company_key,work_order_number,status,work_order_type,priority,
              customer_id,location_id,provenance,created_at,updated_at,
              created_by_principal_id,updated_by_principal_id)
           VALUES ('wo-fixture',$1,'taylor','WO-2099-000001','SCHEDULED','SERVICE_CALL',3,
                   'cust-1','loc-1','NATIVE',now(),now(),'prn-dispatcher','prn-dispatcher')`, [T]);

  await t.test("the assignment is made by the DISPATCH capability, through the governed command", async () => {
    const result = await assignWorkOrderToEmployee({ pool },
      { tenantId: T, principalId: "prn-dispatcher", capabilities: caps("workOrder.lifecycle.dispatch") },
      { workOrderId: "wo-fixture", employeeId: "emp-tech-a", source: "SCHEDULE" });
    assert.equal(result.outcome, "ASSIGNED");
    assert.equal(result.assigneeEmployeeId, "emp-tech-a");

    // And a caller WITHOUT the freshly activated capability still cannot assign.
    await assert.rejects(
      () => assignWorkOrderToEmployee({ pool },
        { tenantId: T, principalId: "prn-office", capabilities: caps() },
        { workOrderId: "wo-fixture", employeeId: "emp-tech-b", source: "SCHEDULE" }),
      /requires workOrder.lifecycle.dispatch/);
  });

  // ── the three proofs ──
  const reader = ctx.postgresContextualReader(pool);
  const edge = { workOrderId: "wo-fixture", expectedStatus: "WORK_IN_PROGRESS", toStatus: "COMPLETED" };
  const actor = (principalId, ...capKeys) => ({ tenantId: T, principalId, capabilities: caps(...capKeys) });

  await t.test("ASSIGNED technician + complete capability -> ALLOWED", async () => {
    const d = await lifecycle.authorizeLifecycleEdge(reader,
      actor("prn-tech-a", "workOrder.lifecycle.complete"), edge);
    assert.equal(d.allowed, true);
    assert.equal(d.reason, "ALLOWED");
  });

  await t.test("UNASSIGNED technician, SAME capability -> NOT_ASSIGNED", async () => {
    const d = await lifecycle.authorizeLifecycleEdge(reader,
      actor("prn-tech-b", "workOrder.lifecycle.complete"), edge);
    assert.equal(d.allowed, false);
    assert.equal(d.reason, "NOT_ASSIGNED");
    assert.equal(d.predicate, "RECORD_ASSIGNMENT",
      "the capability was held; the RECORD relation is what refused, and the audit must say so");
  });

  await t.test("no capability -> CAPABILITY_MISSING, with ZERO record reads", async () => {
    // A COUNTING reader. Order is an authorization property, so it is measured, not asserted.
    const counts = { linkedEmployeeId: 0, isAssignedEmployee: 0, hasWorkEligibility: 0, hasOperationalScope: 0 };
    const counting = {
      linkedEmployeeId: (...a) => { counts.linkedEmployeeId += 1; return reader.linkedEmployeeId(...a); },
      isAssignedEmployee: (...a) => { counts.isAssignedEmployee += 1; return reader.isAssignedEmployee(...a); },
      hasWorkEligibility: (...a) => { counts.hasWorkEligibility += 1; return reader.hasWorkEligibility(...a); },
      hasOperationalScope: (...a) => { counts.hasOperationalScope += 1; return reader.hasOperationalScope(...a); },
    };

    const d = await lifecycle.authorizeLifecycleEdge(counting, actor("prn-office"), edge);
    assert.equal(d.allowed, false);
    assert.equal(d.reason, "CAPABILITY_MISSING");
    assert.equal(d.predicate, undefined, "no predicate ran, so none can leak");
    assert.deepEqual(counts, { linkedEmployeeId: 0, isAssignedEmployee: 0, hasWorkEligibility: 0, hasOperationalScope: 0 },
      "an unauthorized caller must not cause a single record read");

    // The SAME reader, the SAME record, with the capability held: now the lookups happen. Which is
    // what makes the zero above meaningful rather than an accident of the reader never being used.
    await lifecycle.authorizeLifecycleEdge(counting, actor("prn-tech-b", "workOrder.lifecycle.complete"), edge);
    assert.equal(counts.linkedEmployeeId, 1);
    assert.equal(counts.isAssignedEmployee, 1);
  });

  await t.test("an unassigned caller learns NOTHING about a Work Order that does not exist either", async () => {
    const real = await lifecycle.authorizeLifecycleEdge(reader,
      actor("prn-tech-b", "workOrder.lifecycle.complete"), edge);
    const imaginary = await lifecycle.authorizeLifecycleEdge(reader,
      actor("prn-tech-b", "workOrder.lifecycle.complete"), { ...edge, workOrderId: "wo-does-not-exist" });
    assert.equal(real.reason, imaginary.reason, "a real id and a guessed one must answer identically");
  });

  await t.test("DISPATCH and CANCEL do not inherit the assignment requirement", async () => {
    // prn-dispatcher has no Employee link at all, let alone an assignment -- and still dispatches.
    const dispatch = await lifecycle.authorizeLifecycleEdge(reader,
      actor("prn-dispatcher", "workOrder.lifecycle.dispatch"),
      { workOrderId: "wo-fixture", expectedStatus: "SCHEDULED", toStatus: "DISPATCHED" });
    assert.equal(dispatch.allowed, true, "a dispatcher dispatches work that is not theirs; that IS dispatching");

    const cancel = await lifecycle.authorizeLifecycleEdge(reader,
      actor("prn-dispatcher", "workOrder.lifecycle.cancel"),
      { workOrderId: "wo-fixture", expectedStatus: "SCHEDULED", toStatus: "CANCELLED" });
    assert.equal(cancel.allowed, true);

    // ...and the technician's complete capability does NOT reach dispatch.
    const wrongKey = await lifecycle.authorizeLifecycleEdge(reader,
      actor("prn-tech-a", "workOrder.lifecycle.complete"),
      { workOrderId: "wo-fixture", expectedStatus: "SCHEDULED", toStatus: "DISPATCHED" });
    assert.equal(wrongKey.reason, "CAPABILITY_MISSING");
  });

  await t.test("the COMMAND enforces the same decision -- there is no second authorization path", async () => {
    // UNASSIGNED: refused by the record relation, and the refusal CODE names which authority refused.
    await assert.rejects(
      () => lifecycle.transitionWorkOrder({ pool },
        actor("prn-tech-b", "workOrder.lifecycle.complete"),
        { workOrderId: "wo-fixture", expectedStatus: "WORK_IN_PROGRESS", toStatus: "COMPLETED" }),
      (err) => err.code === "NOT_ASSIGNED" && err.category === "FORBIDDEN");

    // NO CAPABILITY: refused earlier, and differently.
    await assert.rejects(
      () => lifecycle.transitionWorkOrder({ pool }, actor("prn-office"),
        { workOrderId: "wo-fixture", expectedStatus: "WORK_IN_PROGRESS", toStatus: "COMPLETED" }),
      (err) => err.code === "CAPABILITY_MISSING" && err.category === "FORBIDDEN");

    // ASSIGNED: authorization PASSES, and what stops the command is the lifecycle dependency the
    // transition matrix names -- consumeParts + finalizeInventoryTransaction -- not permission.
    // Reaching THIS refusal is the proof that the assigned technician got through the gate.
    await assert.rejects(
      () => lifecycle.transitionWorkOrder({ pool },
        actor("prn-tech-a", "workOrder.lifecycle.complete"),
        { workOrderId: "wo-fixture", expectedStatus: "WORK_IN_PROGRESS", toStatus: "COMPLETED" }),
      (err) => err.code === "TRANSITION_AUTHORITY_UNAVAILABLE" && err.category === "UNAVAILABLE");
  });

  await t.test("an ENDED assignment is not a current one", async () => {
    await q(`UPDATE eos_ops.work_order_assignments SET effective_to = now(), end_source = 'REASSIGN_SCHEDULED',
               end_reason = 'handed over', ended_by_principal_id = 'prn-dispatcher'
              WHERE tenant_id = $1 AND work_order_id = 'wo-fixture' AND effective_to IS NULL`, [T]);
    const d = await lifecycle.authorizeLifecycleEdge(reader,
      actor("prn-tech-a", "workOrder.lifecycle.complete"), edge);
    assert.equal(d.reason, "NOT_ASSIGNED", "somebody who handed the job over stops being able to close it");
  });
});
