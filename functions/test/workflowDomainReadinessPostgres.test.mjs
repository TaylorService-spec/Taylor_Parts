// WORKFLOW DOMAIN READINESS -- the control plane, consumed end to end by a SYNTHETIC domain, against PostgreSQL.
//
// TEST-ONLY. No domain command is wired: the "domain" here is a fixture Work Order (eos_ops.work_orders rows plus
// their governed assignments) and a fixture Employee record, driven only through the seams a domain will call --
// startWorkflowInstance (create) and transitionWorkflowInstance (transition) -- with every actor resolved by
// resolveOperationalContext from PostgreSQL and every decision made by the ONE runtime evaluator. No capability is
// invented: workOrder.lifecycle.dispatch / workOrder.transition / workOrder.lifecycle.complete / employee.record.read.
//
// The fixture tenant is the authority baseline's own rebuild (phases A-E, as workflowControlPlanePostgres), and the
// workflow authority, Security Roles, scoped assignment and Functional Role authority all arrive through governed
// Administration commands.
//
//   1  a PUBLISHED + ACTIVE version is selected for new records (a DRAFT never is)
//   2  a new record pins that version
//   3  an action resolves its step/transition from the PINNED version
//   4  the actor needs the binding: Security Role, and a FUNCTIONAL_ROLE narrowing
//   5  the actor needs the capability through the same evaluator: global, and a SCOPED assignment decided with the
//      business context read from the stored record
//   6  the RECORD_ASSIGNMENT condition: assigned vs unassigned technician
//   7  scope: in scope allowed, OUTSIDE_ASSIGNMENT_SCOPE, SCOPE_CONTEXT_REQUIRED
//   8  an allowed transition moves the instance and writes exactly one instance event (and no policy audit event)
//   9  a NEW version: old instances keep their pinned version, new ones use the new version, MIGRATE is explicit + audited
//  10  negative controls
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
const { postgresWorkflowFunctionalRoleFacts } = require("../lib/eosOps/functionalRoleFacts.js");
const { transitionWorkflowInstance } = require("../lib/adminPolicy/workflowInstances.js");
const { operationalWorkflowAuthority } = require("../lib/adminPolicy/workflowAuthority.js");
const frCommands = require("../lib/eosWorkforce/commands/employeeFunctionalRoleCommands.js");
const frVocab = require("../lib/eosWorkforce/functionalRoleVocabulary.js");

const TENANT = "t-wf-domain-ready";
const OPERATOR = "operator-dr";
const ADMIN_SUBJECT = "uid-dr-admin";
const WF_SUBJECT = "uid-dr-workflow-admin";
const FR_SUBJECT = "uid-dr-fr-admin";
const REASON = "workflow domain readiness proof";
const WORKFLOW = "woDomainReady";
const EMP_WORKFLOW = "employeeDomainReady";
const FR_KEY = "completion-verifier";

const DISPATCH = "workOrder.lifecycle.dispatch";
const TRANSITION = "workOrder.transition";
const COMPLETE = "workOrder.lifecycle.complete";
const EMP_READ = "employee.record.read";

/** v1 of the synthetic domain workflow. */
const V1 = {
  steps: [
    { key: "OPEN", label: "Open", initial: true },
    { key: "ASSIGNED", label: "Assigned" },
    { key: "IN_PROGRESS", label: "In progress" },
    { key: "DONE", label: "Done", terminal: true },
  ],
  actions: [
    { key: "assign", label: "Assign", from: "OPEN", to: "ASSIGNED", capabilityKey: DISPATCH, roleKeys: ["dispatcher"] },
    { key: "start", label: "Start", from: "ASSIGNED", to: "IN_PROGRESS", capabilityKey: TRANSITION, roleKeys: ["technician"], guardKind: "RECORD_ASSIGNMENT" },
    { key: "complete", label: "Complete", from: "IN_PROGRESS", to: "DONE", capabilityKey: COMPLETE, roleKeys: ["technician"],
      guardKind: "RECORD_ASSIGNMENT", functionalRoleKeys: [FR_KEY] },
  ],
};
/** v2: the assign BINDING moves dispatcher -> fieldManager; IN_PROGRESS is renamed WORKING (a changed transition). */
const V2 = {
  steps: [
    { key: "OPEN", label: "Open", initial: true },
    { key: "ASSIGNED", label: "Assigned" },
    { key: "WORKING", label: "Working" },
    { key: "DONE", label: "Done", terminal: true },
  ],
  actions: [
    { key: "assign", label: "Assign", from: "OPEN", to: "ASSIGNED", capabilityKey: DISPATCH, roleKeys: ["fieldManager"] },
    { key: "start", label: "Start", from: "ASSIGNED", to: "WORKING", capabilityKey: TRANSITION, roleKeys: ["technician", "apprentice"], guardKind: "RECORD_ASSIGNMENT" },
    { key: "complete", label: "Complete", from: "WORKING", to: "DONE", capabilityKey: COMPLETE, roleKeys: ["technician"],
      guardKind: "RECORD_ASSIGNMENT", functionalRoleKeys: [FR_KEY] },
  ],
};

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
const refused = async (fn) => { try { await fn(); return null; } catch (err) { return err; } };

test("workflow domain readiness: a synthetic domain consumes the control plane end to end", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `wfdr_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  const url = dbUrlFor(name);

  // ── the governed baseline rebuild, phases A-E ──
  const files = readdirSync(join(FUNCTIONS_DIR, "migrations")).filter((f) => f.endsWith(".sql")).sort();
  migrate(url, files.filter((f) => f < baseline.SEED_BOUNDARY_MIGRATION).length); // A
  pool = new pg.Pool({ connectionString: url, max: 8 });
  const q = (sql, v = []) => pool.query(sql, v);
  const repo = new PostgresPolicyRepository(pool);
  await q(`INSERT INTO eos_policy.tenants (id,key,name) VALUES ($1,$1,$1)`, [TENANT]); // B
  await seedTenantPolicy(repo, TENANT, OPERATOR);
  migrate(url); // C
  for (const [pairs, grantedBy] of [[baseline.GLOBAL_CATALOG_ACTIVATED_GRANTS, "canonical-catalog:dr"], [baseline.NONPROD_ACTIVATED_CAPABILITY_GRANTS, "nonprod-activation:dr"]]) {
    for (const { roleKey, capabilityKey } of pairs) { // D, E
      await q(`INSERT INTO eos_policy.role_capabilities (id,tenant_id,role_id,capability_id,granted_by,created_by,updated_by)
               SELECT 'rc_dr_' || substr(md5($1 || r.id || c.id), 1, 24), $1, r.id, c.id, $4, $4, $4
                 FROM eos_policy.roles r, eos_policy.capabilities c WHERE r.tenant_id = $1 AND r.key = $2 AND c.key = $3
               ON CONFLICT (tenant_id, role_id, capability_id) DO NOTHING`, [TENANT, roleKey, capabilityKey, grantedBy]);
    }
  }
  for (const company of ["taylor", "ventana"]) {
    await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id,operating_company_id,status,source,established_by,updated_by)
             VALUES ($1,$2,'ACTIVE','fixture','fixture','fixture')`, [TENANT, company]);
  }
  await bootstrapAdministrator(repo, { tenantId: TENANT, externalSubject: ADMIN_SUBJECT, performedBy: OPERATOR, reason: "initial administrator" });

  const call = (operation, input = {}, subject = WF_SUBJECT) => executeAdminOperation({ repo },
    { caller: { externalSubject: subject, identityProvider: "firebase" }, operation, input, requestId: `r-${operation}` });
  const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.data; };
  const sec = (operation, input) => call(operation, input, ADMIN_SUBJECT);
  const roleId = async (key) => (await repo.getRoleByKey(TENANT, key)).id;
  const principalOf = async (subject) => {
    const made = await ensureTenantPrincipal(repo, { tenantId: TENANT, externalSubject: subject, actorUid: OPERATOR, actorRoleKeys: ["admin"] });
    return made.principal?.id ?? made.id ?? made.principalId;
  };
  const person = async (subject, roleKeys) => {
    const principalId = await principalOf(subject);
    for (const key of roleKeys) ok(await sec("assignRole", { principalId, roleId: await roleId(key), reason: "fixture staffing" }));
    return { subject, principalId };
  };
  const auditCount = async () => Number((await q(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE tenant_id=$1`, [TENANT])).rows[0].n);
  const instanceEvents = async (instanceId) => (await q(`SELECT event_kind, action_key, from_step_key, to_step_key, from_version_id, to_version_id,
      actor_principal_id, audit_event_id FROM eos_policy.workflow_instance_events WHERE tenant_id=$1 AND instance_id=$2 ORDER BY occurred_at, id`,
    [TENANT, instanceId])).rows;
  const storedInstance = async (objectKey, recordId) => repo.getWorkflowInstance(TENANT, objectKey, recordId);
  const activeVersionOf = async (key) => (await repo.listWorkflows(TENANT)).find((w) => w.key === key)?.activeVersionId ?? null;
  const workflowIdOf = async (key) => (await repo.listWorkflows(TENANT)).find((w) => w.key === key).id;

  let wfAdminPrincipal;
  // ── workflow authority: appointed through Administration (Pass 8 bootstrap), never by migration ──
  {
    ok(await sec("createRole", { key: "workflowAdministrator", name: "Workflow Administrator", reason: REASON }));
    for (const actionKey of ["create", "edit", "version", "bindRole", "publish", "read"]) {
      ok(await sec("grantObjectActionToRole", { objectKey: "workflowDefinition", actionKey, roleKey: "workflowAdministrator", reason: REASON }));
    }
    wfAdminPrincipal = (await person(WF_SUBJECT, ["workflowAdministrator"])).principalId;
  }
  // ── a synthetic Role for the runtime binding-without-capability control (granted through Administration) ──
  ok(await sec("createRole", { key: "apprentice", name: "Apprentice", reason: REASON }));
  ok(await sec("grantObjectActionToRole", { objectKey: "workOrder", actionKey: "transition", roleKey: "apprentice", reason: REASON }));
  // ── a company-scoped Security Role (lane SC): employee.record.read is the scope-evaluable capability ──
  ok(await sec("createRole", { key: "companyReader", name: "Company reader", reason: REASON }));
  ok(await sec("grantObjectActionToRole", { objectKey: "employee", actionKey: "read", roleKey: "companyReader", reason: REASON }));

  const dispatcher = await person("uid-dr-dispatcher", ["dispatcher"]);
  const fieldMgr = await person("uid-dr-field-manager", ["fieldManager"]);
  const office = await person("uid-dr-office", ["officeManager"]);
  const genMgr = await person("uid-dr-general-manager", ["generalManager"]);
  const techA = await person("uid-dr-tech-a", ["technician"]);   // assigned, holds the Functional Role
  const techB = await person("uid-dr-tech-b", ["technician"]);   // never assigned
  const techC = await person("uid-dr-tech-c", ["technician"]);   // assigned, WITHOUT the Functional Role
  const apprentice = await person("uid-dr-apprentice", ["apprentice"]);
  const scopedReader = await person("uid-dr-scoped", []);
  const scopedAssignment = ok(await sec("assignRole", { principalId: scopedReader.principalId, roleId: await roleId("companyReader"),
    scopeType: "operatingCompany", scopeValue: "taylor", reason: "company-scoped reader" }));
  assert.deepEqual([scopedAssignment.scopeType, scopedAssignment.scopeValue], ["operatingCompany", "taylor"]);

  // ── Employees + principal links; the synthetic domain records (Work Orders + governed assignments) ──
  const employee = async (id, company, principalId) => {
    await q(`INSERT INTO eos_workforce.employees (id,tenant_id,employment_status,operating_company_id,employee_number) VALUES ($1,$2,'ACTIVE',$3,$1)`,
      [id, TENANT, company]);
    if (principalId) {
      await q(`INSERT INTO eos_policy.employee_principal_links
                 (id,tenant_id,principal_id,employee_id,operating_company_id,link_source,status,asserted_by,assertion_reason)
               VALUES ($1,$2,$3,$4,$5,'OPERATOR_ASSERTED','active','fixture','domain readiness fixture')`,
      [`lnk-${id}`, TENANT, principalId, id, company]);
    }
    return id;
  };
  const empA = await employee("emp-tech-a", "taylor", techA.principalId);
  await employee("emp-tech-b", "taylor", techB.principalId);
  const empC = await employee("emp-tech-c", "taylor", techC.principalId);
  const empApprentice = await employee("emp-apprentice", "taylor", apprentice.principalId);
  await employee("emp-scoped", "taylor", scopedReader.principalId);
  await employee("emp-rec-taylor", "taylor", null);   // the Employee records the scoped workflow acts on
  await employee("emp-rec-ventana", "ventana", null);
  await employee("emp-rec-taylor-2", "taylor", null);
  const workOrder = async (id, n, assignee) => {
    await q(`INSERT INTO eos_ops.work_orders (id,tenant_id,operating_company_key,work_order_number,status,work_order_type,priority,
               customer_id,location_id,provenance,created_by_principal_id,updated_by_principal_id,created_at,updated_at)
             VALUES ($1,$2,'taylor',$3,'SCHEDULED','SERVICE_CALL',2,'cust-1','loc-1','NATIVE',$4,$4,now(),now())`,
    [id, TENANT, `WO-2026-${String(920000 + n)}`, dispatcher.principalId]);
    if (assignee) {
      await q(`INSERT INTO eos_ops.work_order_assignments (id,tenant_id,work_order_id,assignee_employee_id,source,effective_from,assigned_by_principal_id,provenance)
               VALUES ($1,$2,$3,$4,'SCHEDULE',now() - interval '1 hour',$5,'NATIVE')`, [`woa-${id}`, TENANT, id, assignee, dispatcher.principalId]);
    }
  };
  await workOrder("wo-1", 1, empA);
  await workOrder("wo-2", 2, empA);
  await workOrder("wo-3", 3, empC);
  await workOrder("wo-4", 4, empA);
  await workOrder("wo-5", 5, empApprentice);

  // ── the Functional Role: created and assigned by an FR administrator appointed through Administration ──
  ok(await sec("createRole", { key: "functionalRoleAdministrator", name: "Functional Role administrator", reason: REASON }));
  const frGrant = await sec("grantObjectActionToRole", { objectKey: "employee", actionKey: "setFunctionalRole", roleKey: "functionalRoleAdministrator", reason: REASON });
  ok(frGrant);
  const frAdmin = await person(FR_SUBJECT, ["functionalRoleAdministrator"]);

  // ── the runtime composition a domain transport performs: context -> actor, evaluator, FR facts ──
  const provider = composition.postgresGrantConditionProvider(pool);
  const ctxFor = (p) => capabilityAuthority.resolveOperationalContext(repo, pool,
    { identityProvider: "firebase", externalSubject: p.subject, requestedTenantId: null }, provider);
  const runtimeFor = async (p, objectKey = "workOrder") => {
    const ctx = await ctxFor(p);
    return {
      ctx,
      actor: { tenantId: TENANT, principalId: ctx.principalContext.uid, heldRoleKeys: ctx.principalContext.heldRoleKeys,
        // Pass 9 S5: a scoped Role carries its scope and counts for a binding only where the record's context admits it.
        scopedRoles: (ctx.scopedHeld ?? []).map((h) => ({ roleKey: h.sourceRole, scopeType: h.scopeType, scopeValue: h.scopeValue })) },
      authority: operationalWorkflowAuthority(evaluator.postgresContextualReader(pool), {
        tenantId: TENANT, principalId: ctx.principalContext.uid, capabilities: ctx.capabilities,
        conditionallyHeld: ctx.conditionallyHeld, scopedHeld: ctx.scopedHeld, entitlements: ctx.entitlements,
      }, objectKey),
      facts: postgresWorkflowFunctionalRoleFacts(pool, TENANT, ctx.principalContext.uid),
    };
  };
  /** A domain transition: the transport resolves everything server-side; the caller names only record + action. */
  const act = async (p, recordId, actionKey, { objectKey = "workOrder", businessContext } = {}) => {
    const r = await runtimeFor(p, objectKey);
    return transitionWorkflowInstance(repo, r.actor, { objectKey, recordId, actionKey, reason: REASON }, r.authority, r.facts, businessContext);
  };
  const refusedAct = async (...args) => {
    const err = await refused(() => act(...args));
    assert.ok(err, `expected ${args[2]} on ${args[1]} to be refused`);
    return err;
  };
  /** The scoped record's business context, read from the STORED governed record -- never from the request. */
  const storedEmployeeContext = async (recordId) => {
    const row = (await q(`SELECT operating_company_id FROM eos_workforce.employees WHERE tenant_id=$1 AND id=$2`, [TENANT, recordId])).rows[0];
    return row ? { operatingCompanyId: row.operating_company_id } : undefined;
  };

  let v1Id;
  let v2Id;
  let fr;

  // ════════════════════ 1 ════════════════════
  await t.test("1. a PUBLISHED + ACTIVE workflow version is selected for new records; a DRAFT never is", async () => {
    // The Functional Role the definition binds must exist before the definition naming it can be saved.
    fr = (await frCommands.createFunctionalRole({ pool }, await actorOf(frAdmin), { key: FR_KEY, name: "Completion verifier", reason: REASON })).functionalRole;
    assert.equal(fr.status, "ACTIVE");
    const draft = ok(await call("createWorkflowDraft", { key: WORKFLOW, name: "Domain readiness", objectKey: "workOrder", definition: V1, reason: REASON }));
    v1Id = draft.version.id;
    assert.equal(draft.version.status, "DRAFT");
    // A DRAFT is not selectable: no active version -> no new record can start.
    const early = await call("startWorkflowInstance", { workflowKey: WORKFLOW, recordId: "wo-early", reason: REASON });
    assert.deepEqual([early.ok, early.code], [false, "CONFLICT"], JSON.stringify(early));
    assert.match(early.message, /WORKFLOW_NO_ACTIVE_VERSION/);
    // The database refuses pointing the workflow at a DRAFT.
    await assert.rejects(() => q(`UPDATE eos_policy.workflows SET active_version_id=$1 WHERE tenant_id=$2 AND key=$3`, [v1Id, TENANT, WORKFLOW]),
      /WORKFLOW_ACTIVE_VERSION_NOT_PUBLISHED/);
    const v = ok(await call("validateWorkflowVersion", { versionId: v1Id }));
    assert.deepEqual(v.errors, []);
    const published = ok(await call("publishWorkflowVersion", { versionId: v1Id, reason: REASON }));
    assert.equal(published.status, "PUBLISHED");
    assert.equal(await activeVersionOf(WORKFLOW), v1Id, "publish makes the version ACTIVE");
  });

  // ════════════════════ 2 ════════════════════
  const instanceIds = {};
  await t.test("2. a new record pins the ACTIVE version (startWorkflowInstance), audited once", async () => {
    const before = await auditCount();
    const started = ok(await call("startWorkflowInstance", { workflowKey: WORKFLOW, recordId: "wo-1", reason: REASON }));
    assert.deepEqual([started.workflowVersionId, started.currentStepKey, started.objectKey, started.recordId], [v1Id, "OPEN", "workOrder", "wo-1"]);
    assert.equal(await auditCount(), before + 1, "exactly one audit event for the start");
    const events = await instanceEvents(started.id);
    assert.deepEqual(events.map((e) => [e.event_kind, e.to_version_id]), [["START", v1Id]]);
    assert.ok(events[0].audit_event_id, "the START event names its audit event");
    instanceIds["wo-1"] = started.id;
    for (const recordId of ["wo-2", "wo-3"]) {
      instanceIds[recordId] = ok(await call("startWorkflowInstance", { workflowKey: WORKFLOW, recordId, reason: REASON })).id;
    }
    // One record, one instance.
    const again = await call("startWorkflowInstance", { workflowKey: WORKFLOW, recordId: "wo-1", reason: REASON });
    assert.match(again.message, /WORKFLOW_INSTANCE_EXISTS/);
  });

  // ════════════════════ 3 ════════════════════
  await t.test("3. an action resolves its step/transition from the PINNED version", async () => {
    // The action exists, but not from OPEN: resolved against the pinned definition's from-step.
    assert.match((await refusedAct(techA, "wo-1", "start")).message, /start refused: invalidFromState/);
    assert.match((await refusedAct(dispatcher, "wo-1", "no-such-action")).message, /refused: unknownAction/);
    const moved = await act(dispatcher, "wo-1", "assign");
    assert.deepEqual([moved.decision.allowed, moved.decision.action.key, moved.decision.toStepKey, moved.decision.capabilityKey],
      [true, "assign", "ASSIGNED", DISPATCH]);
    assert.equal(moved.instance.workflowVersionId, v1Id);
  });

  // ════════════════════ 4 ════════════════════
  await t.test("4. the actor needs the binding: Security Role, and the FUNCTIONAL_ROLE narrowing", async () => {
    // Security Role binding: officeManager is bound to nothing.
    assert.match((await refusedAct(office, "wo-2", "assign")).message, /assign refused: notBoundToRole/);
    assert.equal((await act(dispatcher, "wo-2", "assign")).instance.currentStepKey, "ASSIGNED");
    assert.equal((await act(dispatcher, "wo-3", "assign")).instance.currentStepKey, "ASSIGNED");
    await act(techA, "wo-1", "start");
    await act(techC, "wo-3", "start");
    // FUNCTIONAL_ROLE-bound "complete": technician + capability + assignment WITHOUT the Functional Role -> refused.
    assert.match((await refusedAct(techC, "wo-3", "complete")).message, /complete refused: functionalRoleRequired \(FUNCTIONAL_ROLE_REQUIRED\)/);
    assert.match((await refusedAct(techA, "wo-1", "complete")).message, /functionalRoleRequired/, "not yet assigned the Functional Role");
    // Assigned by ANOTHER administrator, through the governed command: the narrowing now admits techA.
    await frCommands.assignEmployeeFunctionalRole({ pool }, await actorOf(frAdmin), { employeeId: empA, functionalRoleId: fr.functionalRoleId, reason: REASON });
    const done = await act(techA, "wo-1", "complete");
    assert.equal(done.instance.currentStepKey, "DONE");
    // The Functional Role granted nothing: techA's capability set is exactly its Security Role's.
    assert.equal((await ctxFor(techA)).capabilities.has(DISPATCH), false);
    // A terminal step refuses everything.
    assert.match((await refusedAct(techA, "wo-1", "complete")).message, /terminalState/);
  });

  // ════════════════════ 5 ════════════════════
  await t.test("5. the actor needs the capability through the SAME evaluator: global, and a scoped holding with stored-record context", async () => {
    // Global: the workflow authority answers exactly what the entitled evaluator answers.
    for (const [p, expected] of [[dispatcher, true], [office, false], [techA, false]]) {
      const r = await runtimeFor(p);
      const viaWorkflow = await r.authority.authorize({ capabilityKey: DISPATCH, recordId: "wo-2", guardKind: null });
      const direct = await composition.authorizeOperationalAction(evaluator.postgresContextualReader(pool), {
        tenantId: TENANT, principalId: r.ctx.principalContext.uid, capabilities: r.ctx.capabilities,
        conditionallyHeld: r.ctx.conditionallyHeld, scopedHeld: r.ctx.scopedHeld, entitlements: r.ctx.entitlements,
      }, { capabilityKey: DISPATCH, recordId: "wo-2" });
      assert.equal(viaWorkflow.allowed, expected);
      assert.equal(direct.allowed, expected);
      if (!expected) assert.equal(viaWorkflow.outcome, direct.outcome);
    }
    // Scoped: a workflow on the Employee object, bound to the company-scoped Role.
    const draft = ok(await call("createWorkflowDraft", { key: EMP_WORKFLOW, name: "Employee review", objectKey: "employee", reason: REASON, definition: {
      steps: [{ key: "OPEN", label: "Open", initial: true }, { key: "REVIEWED", label: "Reviewed", terminal: true }],
      actions: [{ key: "review", label: "Review", from: "OPEN", to: "REVIEWED", capabilityKey: EMP_READ, roleKeys: ["companyReader"] }],
    } }));
    ok(await call("publishWorkflowVersion", { versionId: draft.version.id, reason: REASON }));
    for (const recordId of ["emp-rec-taylor", "emp-rec-ventana", "emp-rec-taylor-2"]) {
      ok(await call("startWorkflowInstance", { workflowKey: EMP_WORKFLOW, recordId, reason: REASON }));
    }
    const ctx = await ctxFor(scopedReader);
    assert.equal(ctx.capabilities.has(EMP_READ), false, "a scoped holding never enters the flat set");
    assert.deepEqual(ctx.scopedHeld.map((h) => [h.capabilityKey, h.scopeType, h.scopeValue]), [[EMP_READ, "operatingCompany", "taylor"]]);
    const moved = await act(scopedReader, "emp-rec-taylor", "review",
      { objectKey: "employee", businessContext: await storedEmployeeContext("emp-rec-taylor") });
    assert.equal(moved.instance.currentStepKey, "REVIEWED");
  });

  // ════════════════════ 6 ════════════════════
  await t.test("6. the RECORD_ASSIGNMENT condition: assigned technician allowed, unassigned refused", async () => {
    await workOrder("wo-cond", 6, empA);
    ok(await call("startWorkflowInstance", { workflowKey: WORKFLOW, recordId: "wo-cond", reason: REASON }));
    await act(dispatcher, "wo-cond", "assign");
    const r = await runtimeFor(techB);
    assert.equal(r.ctx.capabilities.has(TRANSITION), true, "techB HOLDS the capability; only the condition refuses");
    assert.match((await refusedAct(techB, "wo-cond", "start")).message, /start refused: effectiveAuthorityDenied \(NOT_ASSIGNED\)/);
    assert.equal((await storedInstance("workOrder", "wo-cond")).currentStepKey, "ASSIGNED", "a refusal moves nothing");
    assert.equal((await act(techA, "wo-cond", "start")).instance.currentStepKey, "IN_PROGRESS");
    // Ending the governed assignment ends the condition.
    await q(`UPDATE eos_ops.work_order_assignments SET effective_to=now(), end_source='UNSCHEDULE', end_reason='fixture', ended_by_principal_id=$2
             WHERE tenant_id=$1 AND work_order_id='wo-cond'`, [TENANT, dispatcher.principalId]);
    assert.match((await refusedAct(techA, "wo-cond", "complete")).message, /effectiveAuthorityDenied \(NOT_ASSIGNED\)/);
  });

  // ════════════════════ 7 ════════════════════
  await t.test("7. scope: in scope allowed, another company OUTSIDE_ASSIGNMENT_SCOPE, no context SCOPE_CONTEXT_REQUIRED", async () => {
    // Pass 9 S5: outside its scope (or with no context) the scoped Role does not even satisfy the binding, so the
    // transition is refused at notBoundToRole; the evaluator's own scope outcome for the capability is asserted too.
    const r = await runtimeFor(scopedReader, "employee");
    const ventana = await storedEmployeeContext("emp-rec-ventana");
    const outside = await refusedAct(scopedReader, "emp-rec-ventana", "review", { objectKey: "employee", businessContext: ventana });
    assert.match(outside.message, /review refused: notBoundToRole/);
    assert.deepEqual(await r.authority.authorize({ capabilityKey: EMP_READ, recordId: "emp-rec-ventana", guardKind: null, businessContext: ventana }),
      { allowed: false, outcome: "OUTSIDE_ASSIGNMENT_SCOPE" });
    const missing = await refusedAct(scopedReader, "emp-rec-taylor-2", "review", { objectKey: "employee" });
    assert.match(missing.message, /review refused: notBoundToRole/);
    assert.deepEqual(await r.authority.authorize({ capabilityKey: EMP_READ, recordId: "emp-rec-taylor-2", guardKind: null }),
      { allowed: false, outcome: "SCOPE_CONTEXT_REQUIRED" });
    assert.equal((await storedInstance("employee", "emp-rec-taylor-2")).currentStepKey, "OPEN", "a refusal moves nothing");
    const inScope = await act(scopedReader, "emp-rec-taylor-2", "review",
      { objectKey: "employee", businessContext: await storedEmployeeContext("emp-rec-taylor-2") });
    assert.equal(inScope.instance.currentStepKey, "REVIEWED");
    assert.equal((await storedInstance("employee", "emp-rec-ventana")).currentStepKey, "OPEN");
    // FINDING (not patched): no workOrder.* capability is scope-evaluable, so a Work Order domain cannot use a scoped
    // assignment yet -- Administration refuses to scope a Role that carries only Work Order capabilities.
    ok(await sec("createRole", { key: "companyDispatcher", name: "Company dispatcher", reason: REASON }));
    ok(await sec("grantObjectActionToRole", { objectKey: "workOrder", actionKey: "transition", roleKey: "companyDispatcher", reason: REASON }));
    const woScoped = await sec("assignRole", { principalId: techB.principalId, roleId: await roleId("companyDispatcher"),
      scopeType: "operatingCompany", scopeValue: "taylor", reason: REASON });
    assert.deepEqual([woScoped.ok, woScoped.code], [false, "INVALID_INPUT"]);
    assert.match(woScoped.message, /SCOPE_NOT_EVALUABLE_FOR_ROLE/);
  });

  // ════════════════════ 8 ════════════════════
  await t.test("8. an allowed transition moves the instance and writes exactly one instance event, no policy audit", async () => {
    const id = instanceIds["wo-2"];
    const eventsBefore = await instanceEvents(id);
    const auditsBefore = await auditCount();
    // A refusal writes nothing.
    await refusedAct(techB, "wo-2", "start");
    assert.equal((await instanceEvents(id)).length, eventsBefore.length);
    const moved = await act(techA, "wo-2", "start");
    assert.equal(moved.instance.currentStepKey, "IN_PROGRESS");
    assert.equal((await storedInstance("workOrder", "wo-2")).currentStepKey, "IN_PROGRESS", "persisted");
    const after = await instanceEvents(id);
    assert.equal(after.length, eventsBefore.length + 1, "exactly one instance event");
    assert.deepEqual(after.at(-1), {
      event_kind: "TRANSITION", action_key: "start", from_step_key: "ASSIGNED", to_step_key: "IN_PROGRESS",
      from_version_id: v1Id, to_version_id: v1Id, actor_principal_id: techA.principalId, audit_event_id: null,
    });
    assert.equal(await auditCount(), auditsBefore, "a runtime transition is not an administrative act");
    await assert.rejects(() => q(`DELETE FROM eos_policy.workflow_instance_events WHERE tenant_id=$1`, [TENANT]), /APPEND_ONLY/);
  });

  // ════════════════════ 9 ════════════════════
  await t.test("9. a NEW version: old instances keep deciding on their pinned version; new ones use it; MIGRATE is explicit", async () => {
    const created = ok(await call("createWorkflowVersion", { workflowId: await workflowIdOf(WORKFLOW), definition: V2, reason: REASON }));
    v2Id = created.version.id;
    ok(await call("publishWorkflowVersion", { versionId: v2Id, reason: REASON }));
    assert.equal(await activeVersionOf(WORKFLOW), v2Id);
    const pinned = (await q(`SELECT record_id FROM eos_policy.workflow_instances WHERE tenant_id=$1 AND workflow_version_id=$2 ORDER BY record_id`, [TENANT, v1Id])).rows;
    assert.deepEqual(pinned.map((r) => r.record_id), ["wo-1", "wo-2", "wo-3", "wo-cond"], "publishing moved nobody");

    // OLD instance (v1): a v1-only step still resolves; the v1 binding still decides.
    const late = ok(await call("adoptRecordsIntoWorkflowVersion", { versionId: v1Id, records: [{ recordId: "wo-v1-late", stepKey: "OPEN" }], reason: "adopt a v1 record" }));
    await workOrder("wo-v1-late", 7, empA);
    assert.match((await refusedAct(fieldMgr, "wo-v1-late", "assign")).message, /notBoundToRole/, "the v2 binding does not reinterpret v1");
    assert.equal((await act(dispatcher, "wo-v1-late", "assign")).instance.workflowVersionId, v1Id);
    const v1Start = await act(techA, "wo-v1-late", "start");
    assert.deepEqual([v1Start.instance.currentStepKey, v1Start.decision.toStepKey], ["IN_PROGRESS", "IN_PROGRESS"]);

    // NEW instance (v2): the new binding and the new transition.
    const started = ok(await call("startWorkflowInstance", { workflowKey: WORKFLOW, recordId: "wo-4", reason: REASON }));
    assert.equal(started.workflowVersionId, v2Id);
    assert.match((await refusedAct(dispatcher, "wo-4", "assign")).message, /notBoundToRole/);
    assert.equal((await act(fieldMgr, "wo-4", "assign")).instance.currentStepKey, "ASSIGNED");
    assert.equal((await act(techA, "wo-4", "start")).instance.currentStepKey, "WORKING");

    // MIGRATE: an incomplete step map refuses and moves nothing.
    const auditsBefore = await auditCount();
    const incomplete = await call("migrateWorkflowInstances", { fromVersionId: v1Id, toVersionId: v2Id,
      stepMap: { OPEN: "OPEN", ASSIGNED: "ASSIGNED", DONE: "DONE" }, reason: "move to v2" });
    assert.match(incomplete.message, /WORKFLOW_STEP_MAP_INCOMPLETE.*IN_PROGRESS/);
    assert.equal(await auditCount(), auditsBefore);
    const migrated = ok(await call("migrateWorkflowInstances", { fromVersionId: v1Id, toVersionId: v2Id,
      stepMap: { OPEN: "OPEN", ASSIGNED: "ASSIGNED", IN_PROGRESS: "WORKING", DONE: "DONE" }, reason: "move to v2" }));
    assert.equal(migrated.migrated.length, 5);
    assert.equal(await auditCount(), auditsBefore + 1, "ONE audit event for the migration");
    const audit = (await q(`SELECT action, target_id, before, after FROM eos_policy.audit_events WHERE id=$1`, [migrated.auditEventId])).rows[0];
    assert.deepEqual([audit.action, audit.target_id, audit.before.versionId, audit.after.versionId, audit.after.stepMap.IN_PROGRESS],
      ["migrateWorkflowInstances", v2Id, v1Id, v2Id, "WORKING"]);
    const moved = await instanceEvents(late.instances[0].id);
    assert.deepEqual(moved.at(-1), { event_kind: "MIGRATE", action_key: "version.migrate", from_step_key: "IN_PROGRESS", to_step_key: "WORKING",
      from_version_id: v1Id, to_version_id: v2Id, actor_principal_id: wfAdminPrincipal, audit_event_id: migrated.auditEventId });
    // After the explicit move, the record is decided by v2.
    const done = await act(techA, "wo-2", "complete");
    assert.deepEqual([done.instance.workflowVersionId, done.decision.action.fromStepKey, done.instance.currentStepKey], [v2Id, "WORKING", "DONE"]);
  });

  // ════════════════════ 10 ════════════════════
  await t.test("10a. negative: a binding WITHOUT the capability is refused (publish and runtime)", async () => {
    // Publish time: officeManager bound to "start" but does not hold workOrder.transition.
    const bad = ok(await call("createWorkflowVersion", { workflowId: await workflowIdOf(WORKFLOW), reason: REASON, definition: {
      ...V2, actions: V2.actions.map((a) => (a.key === "start" ? { ...a, roleKeys: ["technician", "officeManager"] } : a)),
    } }));
    const pub = await call("publishWorkflowVersion", { versionId: bad.version.id, reason: REASON });
    assert.equal(pub.code, "INVALID_INPUT");
    assert.match(pub.message, /BINDING_WITHOUT_CAPABILITY Role "officeManager"/);
    assert.equal(await activeVersionOf(WORKFLOW), v2Id);
    // Runtime: apprentice is bound in v2; its capability is revoked through Administration -> the binding alone grants nothing.
    ok(await call("startWorkflowInstance", { workflowKey: WORKFLOW, recordId: "wo-5", reason: REASON }));
    await act(fieldMgr, "wo-5", "assign");
    const before = await runtimeFor(apprentice);
    assert.equal((await before.authority.authorize({ capabilityKey: TRANSITION, recordId: "wo-5", guardKind: "RECORD_ASSIGNMENT" })).allowed, true, "control");
    ok(await sec("revokeObjectActionFromRole", { objectKey: "workOrder", actionKey: "transition", roleKey: "apprentice", reason: REASON }));
    assert.match((await refusedAct(apprentice, "wo-5", "start")).message, /start refused: effectiveAuthorityDenied \(CAPABILITY_MISSING\)/);
    assert.equal((await storedInstance("workOrder", "wo-5")).currentStepKey, "ASSIGNED");
  });

  await t.test("10b. negative: the capability WITHOUT a binding is refused", async () => {
    const r = await runtimeFor(genMgr);
    assert.equal(r.ctx.capabilities.has(TRANSITION), true, "generalManager holds workOrder.transition");
    assert.match((await refusedAct(genMgr, "wo-5", "start")).message, /start refused: notBoundToRole/);
    assert.match((await refusedAct(dispatcher, "wo-5", "start")).message, /start refused: notBoundToRole/, "dispatcher holds it too");
  });

  await t.test("10c. negative: a RETIRED version cannot pin", async () => {
    const retired = ok(await call("retireWorkflowVersion", { versionId: v1Id, reason: "nothing runs on v1" }));
    assert.equal(retired.status, "RETIRED");
    const activate = await call("activateWorkflowVersion", { versionId: v1Id, reason: REASON });
    assert.match(activate.message, /only a PUBLISHED version can be active/);
    const adopt = await call("adoptRecordsIntoWorkflowVersion", { versionId: v1Id, records: [{ recordId: "wo-retired", stepKey: "OPEN" }], reason: REASON });
    assert.match(adopt.message, /WORKFLOW_INVALID_LIFECYCLE|only be adopted into a PUBLISHED/);
    const back = await call("migrateWorkflowInstances", { fromVersionId: v2Id, toVersionId: v1Id, stepMap: { OPEN: "OPEN", ASSIGNED: "ASSIGNED", WORKING: "IN_PROGRESS", DONE: "DONE" }, reason: REASON });
    assert.match(back.message, /only move to a PUBLISHED version/);
    await assert.rejects(() => q(`INSERT INTO eos_policy.workflow_instances (id,tenant_id,workflow_version_id,object_key,record_id,current_step_key,created_by,updated_by)
      VALUES ('i-retired',$1,$2,'workOrder','wo-retired','OPEN','x','x')`, [TENANT, v1Id]), /WORKFLOW_INSTANCE_VERSION_NOT_PUBLISHED/);
    assert.equal(await storedInstance("workOrder", "wo-retired"), null);
    assert.equal(await activeVersionOf(WORKFLOW), v2Id);
  });

  await t.test("10d. negative: an unauthorized principal cannot publish", async () => {
    const draft = ok(await call("createWorkflowVersion", { workflowId: await workflowIdOf(WORKFLOW), copyFromVersionId: v2Id, reason: REASON }));
    const before = await auditCount();
    // The protected Administrator is NOT in this list: it publishes by standing (DECISIONS #223).
    for (const subject of [dispatcher.subject, FR_SUBJECT]) {
      for (const operation of ["publishWorkflowVersion", "activateWorkflowVersion"]) {
        const r = await call(operation, { versionId: draft.version.id, reason: REASON }, subject);
        assert.deepEqual([r.code, r.message], ["FORBIDDEN", 'not authorized: "workflowDefinition.publish" is required'], `${subject} ${operation}`);
      }
    }
    assert.equal(await auditCount(), before, "a refused publish writes nothing");
    assert.equal((await repo.listWorkflowVersions(TENANT, await workflowIdOf(WORKFLOW))).find((v) => v.id === draft.version.id).status, "DRAFT");
    assert.equal(await activeVersionOf(WORKFLOW), v2Id);
  });

  async function actorOf(p) {
    const ctx = await ctxFor(p);
    assert.ok(ctx.capabilities.has(frVocab.EMPLOYEE_FUNCTIONAL_ROLE_WRITE), "the FR administrator's authority arrived through Administration");
    return { tenantId: TENANT, principalId: ctx.principalContext.uid, capabilities: ctx.capabilities,
      conditionallyHeld: ctx.conditionallyHeld, entitlements: ctx.entitlements };
  }
});
