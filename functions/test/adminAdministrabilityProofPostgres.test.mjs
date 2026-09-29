// ADMINISTRABILITY PROOF -- an administrator changes an Employee's workflow responsibility WITHOUT CODE, against PostgreSQL.
//
// TEST-ONLY. No domain command is wired: workflow instances are driven through the seams a domain will call
// (adoptRecordsIntoWorkflowVersion / transitionWorkflowInstance) with every actor resolved by resolveOperationalContext
// and every decision made by the ONE runtime evaluator. The fixture tenant is the authority baseline's own rebuild
// (phases A-E, as workflowControlPlanePostgres) and every change below is a governed Administration command.
//
//   P2  WORKFLOW RESPONSIBILITY IS ADMINISTRABLE. For one Employee, listPrincipalWorkflowResponsibilities (Employee ->
//       Security Role (global/scoped) -> Functional Role -> binding -> Role grant -> effective responsibility, each entry
//       naming its admin location) AND the workflow engine's decision change together when an administrator:
//         (a) assigns / revokes a Security Role (global, and scoped)
//         (b) assigns / ends a Functional Role
//         (c) edits a binding in a NEW draft version, publishes, activates (old pinned instances keep the old version)
//         (d) grants / conditions / revokes the capability
//         (e) assigns a SALES_CHANNEL-scoped Security Role: the responsibility names the channel, and the engine decides
//             by the channel read from the STORED Opportunity (lane GA's scope)
//   P3  THREE-WAY AUTHORITY: getSecurityRoleDetail (Role -> Object -> action -> condition/scope), getObjectActionGrantMatrix
//       (Object -> action -> Roles) and explainEffectiveAccess (Employee -> Roles -> effective access) are ONE governed
//       PostgreSQL authority, table-driven over every persona fixture.
//   P4  PERSISTENCE: an Admin grant, revoke, condition and scoped assignment survive the Sample Company reconcile, the
//       nonprod activation tool and verifyLiveTenantAuthority, are not reported as code drift, and system invariants
//       (the forbidden Owner pairs) are still refused / reported.
//   P5  WORKFLOW ADMINISTRATION COMPLETION via the API: definition, version, DRAFT/ACTIVE/RETIRED, steps, transitions,
//       Security Role + Functional Role bindings, guard, migration -- and what is NOT manageable (scope on a binding).
//
// Writes ONLY to a database it creates under POLICY_TEST_DATABASE_URL and drops at the end.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { bindOperatingCompany } from "./support/governedOperatingCompanyBinding.mjs";

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
const { explainEffectiveAccess } = require("../lib/eosOps/effectiveAccessExplanation.js");
const { postgresWorkflowFunctionalRoleFacts } = require("../lib/eosOps/functionalRoleFacts.js");
const { transitionWorkflowInstance } = require("../lib/adminPolicy/workflowInstances.js");
const { operationalWorkflowAuthority } = require("../lib/adminPolicy/workflowAuthority.js");
const { scopeEvaluableCapabilities } = require("../lib/adminPolicy/assignmentScopeRuntime.js");
const { reconcileInventoryCapabilityGrants } = require("../lib/eosOps/migration/inventoryCapabilityGrantMigration.js");
const { activateWorkOrderLifecycleGrants } = require("../lib/adminPolicy/workOrderLifecycleGrantActivation.js");
const { sampleCompanyCapabilityKeys, sampleCompanyRoleKeys } = require("../scripts/seedSampleCompany.js");
const frCommands = require("../lib/eosWorkforce/commands/employeeFunctionalRoleCommands.js");
const opportunityCommands = require("../lib/eosCommercial/commands/opportunityCommandService.js");

const MANIFEST = JSON.parse(readFileSync(join(FUNCTIONS_DIR, "scripts", "fixtures", "personaAuthorityDimensions.v1.json"), "utf8"));
const TENANT = "t-wr-admin-proof";
const OPERATOR = "operator-wr";
const ADMIN_SUBJECT = "uid-wr-admin";
const WF_SUBJECT = "uid-wr-workflow-admin";
const FR_SUBJECT = "uid-wr-fr-admin";
const REASON = "administrability proof";
const WF = "woAdminProof";
const EWF = "empAdminProof";
const FR_KEY = "completion-verifier";

const DISPATCH = "workOrder.lifecycle.dispatch";
const TRANSITION = "workOrder.transition";
const COMPLETE = "workOrder.lifecycle.complete";
const WO_READ = "workOrder.record.read";
const EMP_READ = "employee.record.read";
const ASSIGNED = Object.freeze({ paths: [[{ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" }]], recordKind: "workOrder" });

/** The pre-existing Sample Company reconcile extras (administrationControlPlanePostgres pins the same list). */
const PRE_EXISTING_RECONCILE_EXTRAS = Object.freeze([
  "admin/reorder.request.assign", "admin/reorder.request.read.queue",
  "dispatcher/reorder.request.assign", "dispatcher/reorder.request.read.queue",
  "partsManager/reorder.request.read.queue", "purchasingManager/reorder.request.read.queue",
  "technician/reorder.purchaseOrder.create", "technician/reorder.purchaseOrder.read",
  // DQ-011 (migration 1763856000000) registered workOrder.parts.plan with NO grant. The legacy compatibility
  // `admin` Role composes the WHOLE Firestore catalog, which declares that id, so this same pre-existing
  // reconcile defect now proposes admin/workOrder.parts.plan too. It is a TOOLING widening (Sample Company
  // reconcile), not a migration or runtime grant, and verification reports it as drift; recorded as XLF-L2-2
  // for the reconcile's owner rather than hidden.
  "admin/workOrder.parts.plan",
].sort());

const V1 = {
  steps: [
    { key: "OPEN", label: "Open", initial: true },
    { key: "ASSIGNED", label: "Assigned" },
    { key: "WORKING", label: "Working" },
    { key: "DONE", label: "Done", terminal: true },
  ],
  actions: [
    { key: "dispatch", label: "Dispatch", from: "OPEN", to: "ASSIGNED", capabilityKey: DISPATCH, roleKeys: ["dispatcher"] },
    { key: "start", label: "Start", from: "ASSIGNED", to: "WORKING", capabilityKey: TRANSITION, roleKeys: ["technician"], guardKind: "RECORD_ASSIGNMENT" },
    { key: "complete", label: "Complete", from: "WORKING", to: "DONE", capabilityKey: COMPLETE, roleKeys: ["technician"],
      guardKind: "RECORD_ASSIGNMENT", functionalRoleKeys: [FR_KEY] },
    { key: "close", label: "Review and close", from: "OPEN", to: "DONE", capabilityKey: WO_READ, roleKeys: ["woReviewer"] },
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

test("administrability: workflow responsibility is changed by Administration alone, and the three reads are one authority", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `wradm_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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
  for (const [pairs, grantedBy] of [[baseline.GLOBAL_CATALOG_ACTIVATED_GRANTS, "canonical-catalog:wr"], [baseline.NONPROD_ACTIVATED_CAPABILITY_GRANTS, "nonprod-activation:wr"]]) {
    for (const { roleKey, capabilityKey } of pairs) { // D, E
      await q(`INSERT INTO eos_policy.role_capabilities (id,tenant_id,role_id,capability_id,granted_by,created_by,updated_by)
               SELECT 'rc_wr_' || substr(md5($1 || r.id || c.id), 1, 24), $1, r.id, c.id, $4, $4, $4
                 FROM eos_policy.roles r, eos_policy.capabilities c WHERE r.tenant_id = $1 AND r.key = $2 AND c.key = $3
               ON CONFLICT (tenant_id, role_id, capability_id) DO NOTHING`, [TENANT, roleKey, capabilityKey, grantedBy]);
    }
  }
  for (const company of ["taylor", "ventana"]) {
    await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id,operating_company_id,status,source,established_by,updated_by)
             VALUES ($1,$2,'ACTIVE','fixture','fixture','fixture')`, [TENANT, company]);
    // The commercial writers resolve operating_company_key only through the governed binding -- never key = id.
    await bindOperatingCompany(q, TENANT, company, `${company}-ops`);
  }
  const boot = await bootstrapAdministrator(repo, { tenantId: TENANT, externalSubject: ADMIN_SUBJECT, performedBy: OPERATOR, reason: "initial administrator" });

  const deps = { repo, explainEffectiveAccess: (tenantId, principalId) => explainEffectiveAccess(repo, pool, { tenantId, principalId }) };
  const call = (operation, input = {}, subject = WF_SUBJECT) => executeAdminOperation(deps,
    { caller: { externalSubject: subject, identityProvider: "firebase" }, operation, input, requestId: `r-${operation}` });
  const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.data; };
  const sec = (operation, input) => call(operation, input, ADMIN_SUBJECT);
  const roleId = async (key) => (await repo.getRoleByKey(TENANT, key)).id;
  const principalOf = async (subject) => {
    const made = await ensureTenantPrincipal(repo, { tenantId: TENANT, externalSubject: subject, actorUid: OPERATOR, actorRoleKeys: ["admin"] });
    return made.principal?.id ?? made.id ?? made.principalId;
  };
  const person = async (subject, roleKeys, employeeId = null) => {
    const principalId = await principalOf(subject);
    for (const key of roleKeys) ok(await sec("assignRole", { principalId, roleId: await roleId(key), reason: "fixture staffing" }));
    if (employeeId) await employee(employeeId, "taylor", principalId);
    return { subject, principalId, employeeId };
  };
  const employee = async (id, company, principalId) => {
    await q(`INSERT INTO eos_workforce.employees (id,tenant_id,employment_status,operating_company_id,employee_number) VALUES ($1,$2,'ACTIVE',$3,$1)`,
      [id, TENANT, company]);
    if (principalId) {
      await q(`INSERT INTO eos_policy.employee_principal_links
                 (id,tenant_id,principal_id,employee_id,operating_company_id,link_source,status,asserted_by,assertion_reason)
               VALUES ($1,$2,$3,$4,$5,'OPERATOR_ASSERTED','active','fixture','administrability fixture')`,
      [`lnk-${id}`, TENANT, principalId, id, company]);
    }
    return id;
  };
  const activeVersionOf = async (key) => (await repo.listWorkflows(TENANT)).find((w) => w.key === key)?.activeVersionId ?? null;
  const workflowIdOf = async (key) => (await repo.listWorkflows(TENANT)).find((w) => w.key === key).id;
  const bindingId = async (versionId, actionKey, roleKey) => (await q(
    `SELECT b.id FROM eos_policy.workflow_role_bindings b JOIN eos_policy.roles r ON r.id = b.role_id
      WHERE b.tenant_id=$1 AND b.workflow_version_id=$2 AND b.action_key=$3 AND r.key=$4`, [TENANT, versionId, actionKey, roleKey])).rows[0]?.id;
  const liveGrants = async () => (await q(
    `SELECT r.key AS role_key, c.key AS capability_key FROM eos_policy.role_capabilities rc
       JOIN eos_policy.roles r ON r.id = rc.role_id JOIN eos_policy.capabilities c ON c.id = rc.capability_id
      WHERE rc.tenant_id = $1 ORDER BY 1, 2`, [TENANT])).rows.map((r) => ({ roleKey: r.role_key, capabilityKey: r.capability_key }));
  const currentDecisions = async () => (await repo.listRoleCapabilityDecisions(TENANT))
    .map((d) => ({ roleKey: d.roleKey, capabilityKey: d.capabilityKey, decision: d.decision }));

  // ── Administration appoints the workflow + Functional Role administrators (never by migration) ──
  ok(await sec("createRole", { key: "workflowAdministrator", name: "Workflow Administrator", reason: REASON }));
  for (const actionKey of ["create", "edit", "version", "bindRole", "publish", "read"]) {
    ok(await sec("grantObjectActionToRole", { objectKey: "workflowDefinition", actionKey, roleKey: "workflowAdministrator", reason: REASON }));
  }
  const wfAdmin = await person(WF_SUBJECT, ["workflowAdministrator"]);
  ok(await sec("createRole", { key: "functionalRoleAdministrator", name: "Functional Role administrator", reason: REASON }));
  ok(await sec("grantObjectActionToRole", { objectKey: "employee", actionKey: "setFunctionalRole", roleKey: "functionalRoleAdministrator", reason: REASON }));
  const frAdmin = await person(FR_SUBJECT, ["functionalRoleAdministrator"]);
  // Two custom Roles created and granted through Administration: a Work Order reviewer and a company-scoped reader.
  ok(await sec("createRole", { key: "woReviewer", name: "Work Order reviewer", reason: REASON }));
  ok(await sec("grantObjectActionToRole", { objectKey: "workOrder", actionKey: "read", roleKey: "woReviewer", reason: REASON }));
  ok(await sec("createRole", { key: "companyReader", name: "Company reader", reason: REASON }));
  ok(await sec("grantObjectActionToRole", { objectKey: "employee", actionKey: "read", roleKey: "companyReader", reason: REASON }));

  // THE SUBJECT: one Employee whose workflow responsibility every administrator act below changes. No Roles yet.
  const subject = await person("uid-wr-subject", [], "emp-subject");
  const fieldMgr = await person("uid-wr-field-manager", ["fieldManager"], "emp-field-manager");
  const dispatcherB = await person("uid-wr-dispatcher-b", ["dispatcher"]);
  await employee("emp-other", "taylor", null);
  for (const [id, company] of [["emp-rec-taylor-1", "taylor"], ["emp-rec-taylor-2", "taylor"], ["emp-rec-ventana", "ventana"]]) await employee(id, company, null);

  // ── the runtime composition a domain transport performs ──
  const provider = composition.postgresGrantConditionProvider(pool);
  const ctxFor = (p) => capabilityAuthority.resolveOperationalContext(repo, pool,
    { identityProvider: "firebase", externalSubject: p.subject, requestedTenantId: null }, provider);
  const act = async (p, recordId, actionKey, { objectKey = "workOrder", businessContext } = {}) => {
    const ctx = await ctxFor(p);
    const actor = { tenantId: TENANT, principalId: ctx.principalContext.uid, heldRoleKeys: ctx.principalContext.heldRoleKeys,
      scopedRoles: (ctx.scopedHeld ?? []).map((h) => ({ roleKey: h.sourceRole, scopeType: h.scopeType, scopeValue: h.scopeValue })) };
    const authority = operationalWorkflowAuthority(evaluator.postgresContextualReader(pool), {
      tenantId: TENANT, principalId: ctx.principalContext.uid, capabilities: ctx.capabilities,
      conditionallyHeld: ctx.conditionallyHeld, scopedHeld: ctx.scopedHeld, entitlements: ctx.entitlements,
    }, objectKey);
    return transitionWorkflowInstance(repo, actor, { objectKey, recordId, actionKey, reason: REASON }, authority,
      postgresWorkflowFunctionalRoleFacts(pool, TENANT, ctx.principalContext.uid), businessContext);
  };
  let woN = 0;
  const workOrder = async (id, assignee) => {
    woN += 1;
    await q(`INSERT INTO eos_ops.work_orders (id,tenant_id,operating_company_key,work_order_number,status,work_order_type,priority,
               customer_id,location_id,provenance,created_by_principal_id,updated_by_principal_id,created_at,updated_at)
             VALUES ($1,$2,'taylor',$3,'SCHEDULED','SERVICE_CALL',2,'cust-1','loc-1','NATIVE',$4,$4,now(),now())`,
    [id, TENANT, `WO-2026-${String(930000 + woN)}`, wfAdmin.principalId]);
    if (assignee) {
      await q(`INSERT INTO eos_ops.work_order_assignments (id,tenant_id,work_order_id,assignee_employee_id,source,effective_from,assigned_by_principal_id,provenance)
               VALUES ($1,$2,$3,$4,'SCHEDULE',now() - interval '1 hour',$5,'NATIVE')`, [`woa-${id}`, TENANT, id, assignee, wfAdmin.principalId]);
    }
  };
  /** The ENGINE's decision for p on a fresh record adopted at `fromStep` of `versionId`. A refusal moves nothing. */
  const probe = async (p, versionId, actionKey, fromStep, { assignee = p.employeeId } = {}) => {
    const recordId = `wo-probe-${woN + 1}`;
    await workOrder(recordId, assignee);
    ok(await call("adoptRecordsIntoWorkflowVersion", { versionId, records: [{ recordId, stepKey: fromStep }], reason: REASON }));
    try {
      const moved = await act(p, recordId, actionKey);
      return { allowed: true, versionId: moved.instance.workflowVersionId, recordId };
    } catch (err) {
      return { allowed: false, message: String(err.message), recordId };
    }
  };
  const responsibilitiesOf = async (p) => ok(await sec("listPrincipalWorkflowResponsibilities", { principalId: p.principalId }));
  const find = (list, workflowKey, actionKey) => list.find((r) => r.workflowKey === workflowKey && r.actionKey === actionKey);
  const kinds = (entry) => entry.adminLocations.map((l) => l.kind);
  const locationOf = (entry, kind) => entry.adminLocations.filter((l) => l.kind === kind);

  let v1Id; let v2Id; let v3Id; let empV1Id; let fr; let copiedDraftId;

  // ════════════════════ setup: v1 published through the workflow control plane ════════════════════
  await t.test("setup: the Functional Role and the workflows are created and published through Administration", async () => {
    fr = (await frCommands.createFunctionalRole({ pool }, await frActor(), { key: FR_KEY, name: "Completion verifier", reason: REASON })).functionalRole;
    const draft = ok(await call("createWorkflowDraft", { key: WF, name: "Administrability proof", objectKey: "workOrder", definition: V1, reason: REASON }));
    v1Id = draft.version.id;
    assert.deepEqual(ok(await call("validateWorkflowVersion", { versionId: v1Id })).errors, []);
    assert.equal(ok(await call("publishWorkflowVersion", { versionId: v1Id, reason: REASON })).status, "PUBLISHED");
    assert.equal(await activeVersionOf(WF), v1Id);
    const emp = ok(await call("createWorkflowDraft", { key: EWF, name: "Employee review", objectKey: "employee", reason: REASON, definition: {
      steps: [{ key: "OPEN", label: "Open", initial: true }, { key: "REVIEWED", label: "Reviewed", terminal: true }],
      actions: [{ key: "review", label: "Review", from: "OPEN", to: "REVIEWED", capabilityKey: EMP_READ, roleKeys: ["companyReader"] }],
    } }));
    empV1Id = emp.version.id;
    ok(await call("publishWorkflowVersion", { versionId: empV1Id, reason: REASON }));
    // Nothing yet: the subject holds no Security Role, so no responsibility and the engine refuses at the binding.
    const none = await responsibilitiesOf(subject);
    assert.deepEqual([none.responsibilities.length, none.boundWithoutAuthority.length], [0, 0]);
    assert.match((await probe(subject, v1Id, "dispatch", "OPEN")).message, /dispatch refused: notBoundToRole/);
  });

  // ════════════════════ P2 (a) ════════════════════
  await t.test("P2(a) assigning / revoking a Security Role changes the responsibility and the engine together (global and scoped)", async () => {
    const assignment = ok(await sec("assignRole", { principalId: subject.principalId, roleId: await roleId("dispatcher"), reason: "staff the dispatch desk" }));
    const after = await responsibilitiesOf(subject);
    const dispatch = find(after.responsibilities, WF, "dispatch");
    assert.ok(dispatch, JSON.stringify(after));
    assert.deepEqual([dispatch.version, dispatch.versionId, dispatch.from, dispatch.to, dispatch.authority, dispatch.capabilityKey],
      [1, v1Id, "OPEN", "ASSIGNED", "ALLOWED", DISPATCH]);
    assert.deepEqual(dispatch.securityRoleSources.map((s) => [s.roleKey, s.scopeType, s.assignmentId, s.bindingId]),
      [["dispatcher", "global", assignment.id, await bindingId(v1Id, "dispatch", "dispatcher")]]);
    assert.deepEqual(kinds(dispatch), ["SECURITY_ROLE_ASSIGNMENT", "WORKFLOW_BINDING", "ROLE_CAPABILITY_GRANT"]);
    assert.equal(locationOf(dispatch, "SECURITY_ROLE_ASSIGNMENT")[0].id, assignment.id);
    assert.deepEqual(locationOf(dispatch, "WORKFLOW_BINDING").map((l) => [l.id, l.versionId, l.actionKey, l.boundKey]),
      [[await bindingId(v1Id, "dispatch", "dispatcher"), v1Id, "dispatch", "dispatcher"]]);
    assert.deepEqual(locationOf(dispatch, "ROLE_CAPABILITY_GRANT").map((l) => l.id), [`dispatcher:${DISPATCH}`]);
    assert.deepEqual(dispatch.capabilityGrants.map((g) => [g.roleKey, g.scopeType, g.condition]), [["dispatcher", "global", null]]);
    const allowed = await probe(subject, v1Id, "dispatch", "OPEN");
    assert.deepEqual([allowed.allowed, allowed.versionId], [true, v1Id]);

    ok(await sec("revokeRole", { assignmentId: assignment.id, reason: "leaves the dispatch desk" }));
    assert.equal(find((await responsibilitiesOf(subject)).responsibilities, WF, "dispatch"), undefined);
    assert.match((await probe(subject, v1Id, "dispatch", "OPEN")).message, /notBoundToRole/);

    // SCOPED: companyReader @ operatingCompany=taylor -> the responsibility is SCOPED and names its scope.
    const scoped = ok(await sec("assignRole", { principalId: subject.principalId, roleId: await roleId("companyReader"),
      scopeType: "operatingCompany", scopeValue: "taylor", reason: "reads Taylor Employees" }));
    const withScope = await responsibilitiesOf(subject);
    const review = find(withScope.responsibilities, EWF, "review");
    assert.ok(review, JSON.stringify(withScope));
    assert.deepEqual([review.authority, review.reasonCode], ["SCOPED", "SCOPE_CONTEXT_REQUIRED"]);
    assert.deepEqual(review.securityRoleSources.map((s) => [s.roleKey, s.scopeType, s.scopeValue, s.assignmentId]),
      [["companyReader", "operatingCompany", "taylor", scoped.id]]);
    assert.deepEqual(locationOf(review, "SECURITY_ROLE_ASSIGNMENT").map((l) => [l.id, l.scopeType, l.scopeValue]), [[scoped.id, "operatingCompany", "taylor"]]);
    assert.deepEqual(review.capabilityGrants.map((g) => [g.roleKey, g.scopeType, g.scopeValue]), [["companyReader", "operatingCompany", "taylor"]]);
    // ...and the engine agrees: in scope allowed, another company refused at the binding.
    for (const recordId of ["emp-rec-taylor-1", "emp-rec-ventana"]) ok(await call("startWorkflowInstance", { workflowKey: EWF, recordId, reason: REASON }));
    const context = async (id) => ({ operatingCompanyId: (await q(`SELECT operating_company_id FROM eos_workforce.employees WHERE tenant_id=$1 AND id=$2`, [TENANT, id])).rows[0].operating_company_id });
    await assert.rejects(() => act(subject, "emp-rec-ventana", "review", { objectKey: "employee", businessContext: { operatingCompanyId: "ventana" } }), /review refused: notBoundToRole/);
    assert.equal((await act(subject, "emp-rec-taylor-1", "review", { objectKey: "employee", businessContext: await context("emp-rec-taylor-1") })).instance.currentStepKey, "REVIEWED");
    ok(await sec("revokeRole", { assignmentId: scoped.id, reason: "no longer reads Taylor Employees" }));
    assert.equal(find((await responsibilitiesOf(subject)).responsibilities, EWF, "review"), undefined);
    ok(await call("startWorkflowInstance", { workflowKey: EWF, recordId: "emp-rec-taylor-2", reason: REASON }));
    const t2 = await context("emp-rec-taylor-2");
    await assert.rejects(() => act(subject, "emp-rec-taylor-2", "review", { objectKey: "employee", businessContext: t2 }), /notBoundToRole/);
  });

  // ════════════════════ P2 (b) ════════════════════
  await t.test("P2(b) assigning / ending a Functional Role narrows the responsibility and the engine together", async () => {
    const technicianAssignment = ok(await sec("assignRole", { principalId: subject.principalId, roleId: await roleId("technician"), reason: "staff a technician" }));
    const before = await responsibilitiesOf(subject);
    assert.ok(find(before.responsibilities, WF, "start"), "start needs no Functional Role");
    const blocked = find(before.boundWithoutAuthority, WF, "complete");
    assert.deepEqual([blocked.authority, blocked.reasonCode, blocked.requiredFunctionalRoles, blocked.viaFunctionalRoles], ["DENIED", "FUNCTIONAL_ROLE_REQUIRED", [FR_KEY], []]);
    assert.deepEqual(locationOf(blocked, "FUNCTIONAL_ROLE_ASSIGNMENT").map((l) => [l.id, l.functionalRoleKey, l.held, l.employeeId]),
      [[null, FR_KEY, false, subject.employeeId]], "names WHERE to assign the missing Functional Role");
    assert.match((await probe(subject, v1Id, "complete", "WORKING")).message, /complete refused: functionalRoleRequired/);

    const assigned = await frCommands.assignEmployeeFunctionalRole({ pool }, await frActor(), { employeeId: subject.employeeId, functionalRoleId: fr.functionalRoleId, reason: REASON });
    const withFr = await responsibilitiesOf(subject);
    const complete = find(withFr.responsibilities, WF, "complete");
    assert.ok(complete, JSON.stringify(withFr.boundWithoutAuthority));
    assert.equal(complete.source, "WORKFLOW_BINDING_FUNCTIONAL_ROLE_AND_EFFECTIVE_AUTHORITY");
    assert.equal(complete.guardKind, "RECORD_ASSIGNMENT");
    assert.deepEqual(complete.functionalRoleSources.map((f) => [f.functionalRoleKey, f.held, f.assignmentId]), [[FR_KEY, true, assigned.assignmentId]]);
    assert.deepEqual(locationOf(complete, "FUNCTIONAL_ROLE_ASSIGNMENT").map((l) => l.id), [assigned.assignmentId]);
    assert.equal((await probe(subject, v1Id, "complete", "WORKING")).allowed, true);
    // The guard still decides per record: an unassigned Work Order is refused.
    assert.match((await probe(subject, v1Id, "complete", "WORKING", { assignee: "emp-other" })).message, /effectiveAuthorityDenied \(NOT_ASSIGNED\)/);
    // The Functional Role granted NOTHING: the capability set is the Security Roles' alone.
    assert.equal((await ctxFor(subject)).capabilities.has(DISPATCH), false);

    await frCommands.endEmployeeFunctionalRoleAssignment({ pool }, await frActor(), { employeeId: subject.employeeId, assignmentId: assigned.assignmentId, reason: REASON });
    assert.ok(find((await responsibilitiesOf(subject)).boundWithoutAuthority, WF, "complete"));
    assert.match((await probe(subject, v1Id, "complete", "WORKING")).message, /functionalRoleRequired/);
    // Off the technician Role again, so P2(d) sees woReviewer as the ONLY grantor of workOrder.record.read.
    ok(await sec("revokeRole", { assignmentId: technicianAssignment.id, reason: "leaves the technician pool" }));
    const gone = await responsibilitiesOf(subject);
    assert.equal([...gone.responsibilities, ...gone.boundWithoutAuthority].some((r) => r.actionKey === "start" || r.actionKey === "complete"), false);
  });

  // ════════════════════ P2 (d) ════════════════════
  await t.test("P2(d) granting / conditioning / revoking the capability changes the responsibility and the engine together", async () => {
    ok(await sec("assignRole", { principalId: subject.principalId, roleId: await roleId("woReviewer"), reason: "reviews Work Orders" }));
    let close = find((await responsibilitiesOf(subject)).responsibilities, WF, "close");
    assert.deepEqual([close.authority, close.grantConditions], ["ALLOWED", []]);
    assert.deepEqual(locationOf(close, "ROLE_CAPABILITY_GRANT").map((l) => [l.id, l.conditioned]), [[`woReviewer:${WO_READ}`, false]]);
    assert.equal((await probe(subject, v1Id, "close", "OPEN", { assignee: "emp-other" })).allowed, true, "unconditioned: any record");

    ok(await sec("setGrantCondition", { objectKey: "workOrder", actionKey: "read", roleKey: "woReviewer", condition: ASSIGNED, reason: "reviewers read only assigned Work Orders" }));
    close = find((await responsibilitiesOf(subject)).responsibilities, WF, "close");
    assert.deepEqual([close.authority, close.reasonCode, close.grantConditions], ["CONDITIONAL", "RECORD_ASSIGNMENT_REQUIRED", [ASSIGNED]]);
    assert.deepEqual(locationOf(close, "ROLE_CAPABILITY_GRANT").map((l) => l.conditioned), [true]);
    assert.equal((await probe(subject, v1Id, "close", "OPEN")).allowed, true, "assigned: allowed");
    assert.match((await probe(subject, v1Id, "close", "OPEN", { assignee: "emp-other" })).message, /effectiveAuthorityDenied \(NOT_ASSIGNED\)/);

    ok(await sec("revokeObjectActionFromRole", { objectKey: "workOrder", actionKey: "read", roleKey: "woReviewer", reason: "withdraw review" }));
    const revoked = find((await responsibilitiesOf(subject)).boundWithoutAuthority, WF, "close");
    assert.deepEqual([revoked.authority, revoked.reasonCode], ["DENIED", "CAPABILITY_MISSING"]);
    assert.deepEqual(locationOf(revoked, "ROLE_CAPABILITY_GRANT").map((l) => l.roleKey), ["woReviewer"], "names the grant to restore");
    assert.match((await probe(subject, v1Id, "close", "OPEN")).message, /effectiveAuthorityDenied \(CAPABILITY_MISSING\)/);

    ok(await sec("retireGrantCondition", { objectKey: "workOrder", actionKey: "read", roleKey: "woReviewer", reason: "no grant left to narrow" }));
    ok(await sec("grantObjectActionToRole", { objectKey: "workOrder", actionKey: "read", roleKey: "woReviewer", condition: ASSIGNED, requiresCondition: true, reason: "restore, conditioned" }));
    close = find((await responsibilitiesOf(subject)).responsibilities, WF, "close");
    assert.equal(close.authority, "CONDITIONAL");
    assert.equal((await probe(subject, v1Id, "close", "OPEN")).allowed, true);
  });

  // ════════════════════ P2 (c) ════════════════════
  await t.test("P2(c) editing a binding in a NEW draft, publishing and activating moves the responsibility; pinned instances keep v1", async () => {
    const dispatcherAssignment = ok(await sec("assignRole", { principalId: subject.principalId, roleId: await roleId("dispatcher"), reason: "back on the dispatch desk" }));
    assert.equal(find((await responsibilitiesOf(subject)).responsibilities, WF, "dispatch").version, 1);
    // A record PINNED to v1 before anything changes.
    await workOrder("wo-pinned-v1", subject.employeeId);
    ok(await call("startWorkflowInstance", { workflowKey: WF, recordId: "wo-pinned-v1", reason: REASON }));

    // The draft editor path: copy v1, replace the definition (dispatch: dispatcher -> fieldManager), validate, publish.
    const draft = ok(await call("createWorkflowVersion", { workflowId: await workflowIdOf(WF), copyFromVersionId: v1Id, reason: REASON }));
    copiedDraftId = draft.version.id;
    assert.deepEqual([draft.version.status, draft.version.version], ["DRAFT", 2]);
    // updateWorkflowDefinition never rewrites rows: it writes the edited definition as the NEXT draft (v3) and leaves the
    // superseded draft (v2) readable, still DRAFT.
    const updated = ok(await call("updateWorkflowDefinition", { versionId: copiedDraftId, reason: REASON, definition: {
      ...V1, actions: V1.actions.map((a) => (a.key === "dispatch" ? { ...a, roleKeys: ["fieldManager"] } : a)),
    } }));
    v2Id = updated.version.id;
    assert.deepEqual([updated.version.status, updated.version.version], ["DRAFT", 3]);
    assert.equal(find((await responsibilitiesOf(subject)).responsibilities, WF, "dispatch").version, 1, "a DRAFT changes nobody's responsibility");
    assert.deepEqual(ok(await call("validateWorkflowVersion", { versionId: v2Id })).errors, []);
    ok(await call("publishWorkflowVersion", { versionId: v2Id, reason: REASON }));
    assert.equal(await activeVersionOf(WF), v2Id);
    assert.equal(find((await responsibilitiesOf(subject)).responsibilities, WF, "dispatch"), undefined, "the subject lost dispatch");
    const fmDispatch = find((await responsibilitiesOf(fieldMgr)).responsibilities, WF, "dispatch");
    assert.deepEqual([fmDispatch.version, fmDispatch.versionId, fmDispatch.viaRoles], [3, v2Id, ["fieldManager"]]);
    assert.equal(locationOf(fmDispatch, "WORKFLOW_BINDING")[0].id, await bindingId(v2Id, "dispatch", "fieldManager"));
    // ENGINE: the v1-pinned record still decides on v1; a new record starts on v2 and decides on v2.
    const pinned = await act(subject, "wo-pinned-v1", "dispatch");
    assert.deepEqual([pinned.instance.workflowVersionId, pinned.instance.currentStepKey], [v1Id, "ASSIGNED"]);
    await workOrder("wo-new-v2", subject.employeeId);
    const started = ok(await call("startWorkflowInstance", { workflowKey: WF, recordId: "wo-new-v2", reason: REASON }));
    assert.equal(started.workflowVersionId, v2Id);
    await assert.rejects(() => act(subject, "wo-new-v2", "dispatch"), /notBoundToRole/);
    assert.equal((await act(fieldMgr, "wo-new-v2", "dispatch")).instance.workflowVersionId, v2Id);

    // setWorkflowRoleBinding path: v3 = v2 + dispatcher bound again; publish (active), then ACTIVATE v2 back, then v3.
    v3Id = ok(await call("createWorkflowVersion", { workflowId: await workflowIdOf(WF), copyFromVersionId: v2Id, reason: REASON })).version.id;
    ok(await call("setWorkflowRoleBinding", { versionId: v3Id, actionKey: "dispatch", roleId: await roleId("dispatcher"), reason: REASON }));
    ok(await call("publishWorkflowVersion", { versionId: v3Id, reason: REASON }));
    const v3 = find((await responsibilitiesOf(subject)).responsibilities, WF, "dispatch");
    assert.deepEqual([v3.version, v3.securityRoleSources.map((s) => s.assignmentId)], [4, [dispatcherAssignment.id]]);
    ok(await call("activateWorkflowVersion", { versionId: v2Id, reason: "roll back the binding" }));
    assert.equal(find((await responsibilitiesOf(subject)).responsibilities, WF, "dispatch"), undefined, "activation alone moves it");
    assert.match((await probe(subject, v2Id, "dispatch", "OPEN")).message, /notBoundToRole/);
    ok(await call("activateWorkflowVersion", { versionId: v3Id, reason: "restore the binding" }));
    assert.equal(find((await responsibilitiesOf(subject)).responsibilities, WF, "dispatch").version, 4);
    assert.equal((await probe(subject, v3Id, "dispatch", "OPEN")).allowed, true);
    // No per-Employee workflow grant exists anywhere in the answer: every location is a Role, binding or grant.
    for (const entry of [...(await responsibilitiesOf(subject)).responsibilities, ...(await responsibilitiesOf(subject)).boundWithoutAuthority]) {
      for (const loc of entry.adminLocations) {
        assert.ok(["SECURITY_ROLE_ASSIGNMENT", "FUNCTIONAL_ROLE_ASSIGNMENT", "WORKFLOW_BINDING", "ROLE_CAPABILITY_GRANT"].includes(loc.kind), loc.kind);
      }
    }
  });

  // ════════════════════ P2 (e) ════════════════════
  await t.test("P2(e) a SALES_CHANNEL-scoped Security Role: the responsibility names the channel; the record's channel decides", async () => {
    // Governed channel values (lane GA): activated through Administration, never by migration.
    for (const salesChannel of ["RETAIL", "NATIONAL_ACCOUNTS"]) {
      ok(await sec("setTenantSalesChannelStatus", { salesChannel, status: "ACTIVE", reason: "we sell through this channel" }));
    }
    ok(await sec("createRole", { key: "channelReviewer", name: "Channel reviewer", reason: REASON }));
    ok(await sec("grantObjectActionToRole", { objectKey: "opportunity", actionKey: "read", roleKey: "channelReviewer", reason: REASON }));
    const draft = ok(await call("createWorkflowDraft", { key: "oppChannelReview", name: "Opportunity review", objectKey: "opportunity", reason: REASON, definition: {
      steps: [{ key: "OPEN", label: "Open", initial: true }, { key: "REVIEWED", label: "Reviewed", terminal: true }],
      actions: [{ key: "review", label: "Review", from: "OPEN", to: "REVIEWED", capabilityKey: "opportunity.read", roleKeys: ["channelReviewer"] }],
    } }));
    ok(await call("publishWorkflowVersion", { versionId: draft.version.id, reason: REASON }));
    // Two stored Opportunities, one per channel, written by the Commercial command (the fact the transport reads).
    await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, owner_employee_id, created_by, updated_by)
             VALUES ('acct-wr',$1,'WR Customer','ACTIVE','emp-other','x','x')`, [TENANT]);
    await q(`INSERT INTO eos_policy.principals (id, external_subject, identity_provider, status) VALUES ('p-wr-writer','p-wr-writer','proof','active')`);
    await q(`INSERT INTO eos_policy.tenant_memberships (id, tenant_id, principal_id) VALUES ('m-wr-writer',$1,'p-wr-writer')`, [TENANT]);
    const writer = { tenantId: TENANT, principalId: "p-wr-writer", capabilities: new Set(["opportunity.write"]) };
    const catalog = { async verifyReferences(_db, _t, refs) { return refs.map(() => "FOUND"); } };
    const newOpp = async (salesChannel) => (await opportunityCommands.createOpportunity({ pool, catalog }, writer, {
      idempotencyKey: `k-${randomUUID()}`, accountId: "acct-wr", salesChannel, operatingCompanyId: "taylor", need: `${salesChannel} need`,
      lines: [{ kind: "SERVICE", ref: "svc", qty: 1 }] })).opportunityId;
    const retail = await newOpp("RETAIL");
    const national = await newOpp("NATIONAL_ACCOUNTS");
    for (const recordId of [retail, national]) ok(await call("startWorkflowInstance", { workflowKey: "oppChannelReview", recordId, reason: REASON }));
    const storedChannel = async (id) => ({ salesChannel: (await q(`SELECT sales_channel::text AS c FROM eos_commercial.opportunities WHERE tenant_id=$1 AND id=$2`, [TENANT, id])).rows[0].c });

    const assignment = ok(await sec("assignRole", { principalId: subject.principalId, roleId: await roleId("channelReviewer"),
      scopeType: "salesChannel", scopeValue: "RETAIL", reason: "reviews Retail Opportunities" }));
    const review = find((await responsibilitiesOf(subject)).responsibilities, "oppChannelReview", "review");
    assert.ok(review);
    assert.deepEqual([review.authority, review.reasonCode], ["SCOPED", "SCOPE_CONTEXT_REQUIRED"]);
    assert.deepEqual(review.securityRoleSources.map((x) => [x.roleKey, x.scopeType, x.scopeValue, x.assignmentId]),
      [["channelReviewer", "salesChannel", "RETAIL", assignment.id]]);
    assert.deepEqual(locationOf(review, "SECURITY_ROLE_ASSIGNMENT").map((l) => [l.scopeType, l.scopeValue]), [["salesChannel", "RETAIL"]]);
    // The subject also holds dispatcher (P2c), which grants opportunity.read GLOBALLY -- listed too, but it is bound to
    // nothing here, so the binding is still satisfied only inside the channel: the entry stays SCOPED.
    assert.deepEqual(review.capabilityGrants.map((g) => [g.roleKey, g.scopeType, g.scopeValue]).sort(),
      [["channelReviewer", "salesChannel", "RETAIL"], ["dispatcher", "global", null]]);
    // ENGINE: the NATIONAL_ACCOUNTS record is refused at the binding, no context is refused, the RETAIL record moves.
    await assert.rejects(() => act(subject, national, "review", { objectKey: "opportunity", businessContext: undefined }), /notBoundToRole/);
    const nationalCtx = await storedChannel(national);
    assert.deepEqual(nationalCtx, { salesChannel: "NATIONAL_ACCOUNTS" });
    await assert.rejects(() => act(subject, national, "review", { objectKey: "opportunity", businessContext: nationalCtx }), /review refused: notBoundToRole/);
    const moved = await act(subject, retail, "review", { objectKey: "opportunity", businessContext: await storedChannel(retail) });
    assert.equal(moved.instance.currentStepKey, "REVIEWED");
    // Revoking the scoped assignment removes the responsibility.
    ok(await sec("revokeRole", { assignmentId: assignment.id, reason: "leaves Retail review" }));
    assert.equal(find((await responsibilitiesOf(subject)).responsibilities, "oppChannelReview", "review"), undefined);
  });

  // ════════════════════ P3 ════════════════════
  const personaPrincipals = [];
  await t.test("P3 three-way authority: Security Role detail, Object grant matrix and explainEffectiveAccess agree, for every persona", async () => {
    // Persona fixtures (the manifest's Security Roles), plus the subject and one scoped holder.
    const fixtureRoleId = async (key) => {
      const existing = await repo.getRoleByKey(TENANT, key);
      if (existing) return existing.id;
      await q(`INSERT INTO eos_policy.roles (id,tenant_id,key,name,origin,created_by,updated_by) VALUES ($1,$2,$3,$3,'SYSTEM','fixture','fixture')`, [`role-${key}`, TENANT, key]);
      return `role-${key}`;
    };
    const fixtureAssign = async (principalId, roleKey, scopeType = "global", scopeValue = null) => {
      const rid = await fixtureRoleId(roleKey);
      await repo.transact({ tenantId: TENANT, uid: "fixture" }, async (tx) => {
        const version = await tx.bumpAccessVersion(principalId);
        return tx.createAssignment({ principalId, roleId: rid, scopeType, scopeValue, status: "active", grantedBy: "fixture",
          grantedAt: new Date().toISOString(), accessVersionAtGrant: version });
      });
    };
    for (const [key, persona] of Object.entries(MANIFEST.personas)) {
      const principalId = await principalOf(`uid-persona-${key}`);
      for (const roleKey of persona.securityRoles ?? []) await fixtureAssign(principalId, roleKey);
      personaPrincipals.push({ key, principalId });
    }
    const scopedHolder = await principalOf("uid-wr-scoped-holder");
    await fixtureAssign(scopedHolder, "companyReader", "operatingCompany", "taylor");
    await fixtureAssign(scopedHolder, "officeManager");
    personaPrincipals.push({ key: "scoped-holder", principalId: scopedHolder }, { key: "subject", principalId: subject.principalId });
    // A direct exception, so the DIRECT half is compared too.
    ok(await sec("grantObjectActionToPrincipal", { objectKey: "workOrder", actionKey: "dispatch", principalId: scopedHolder, reason: "covering exception" }));

    // (A) every Role's detail, (B) every Object's matrix -- through the Admin API.
    const roles = await repo.listRoles(TENANT);
    const detail = new Map();
    for (const role of roles) detail.set(role.key, ok(await sec("getSecurityRoleDetail", { roleKey: role.key })));
    const objectKeys = [...new Set((await repo.listCapabilities()).map((c) => c.objectKey))].sort();
    const matrix = new Map();
    for (const objectKey of objectKeys) {
      const r = await sec("getObjectActionGrantMatrix", { objectKey });
      if (r.ok) matrix.set(objectKey, r.data);
      else assert.equal(r.code, "NOT_FOUND", `${objectKey}: ${JSON.stringify(r)}`); // a capability Object with no Object row
    }
    assert.ok(matrix.size > 10, "the matrix covered the Object catalog");
    const activeCondition = (a) => (a.condition && a.condition.status === "ACTIVE" ? a.condition.condition : null);

    // A <-> B: every (Role, capability) cell, both directions.
    let cells = 0;
    for (const [roleKey, d] of detail) {
      for (const a of d.actions) {
        const m = matrix.get(a.objectKey);
        if (!m) continue;
        const cell = m.actions.find((x) => x.capabilityKey === a.capabilityKey)?.roles.find((r) => r.roleKey === roleKey) ?? null;
        if (a.held || a.source !== null || a.condition !== null) {
          assert.ok(cell, `B lacks ${roleKey}/${a.capabilityKey}`);
          assert.deepEqual([cell.held, cell.source, cell.condition ?? null], [a.held, a.source, a.condition?.condition ?? null], `${roleKey}/${a.capabilityKey}`);
          cells += 1;
        } else assert.equal(cell, null, `B shows ${roleKey}/${a.capabilityKey} that A does not`);
      }
    }
    for (const [objectKey, m] of matrix) {
      for (const action of m.actions) {
        for (const cell of action.roles) {
          const a = detail.get(cell.roleKey)?.actions.find((x) => x.capabilityKey === action.capabilityKey);
          assert.ok(a, `A lacks ${cell.roleKey}/${action.capabilityKey} (${objectKey})`);
          assert.equal(a.held, cell.held);
        }
      }
    }
    assert.ok(cells > 100, `compared ${cells} cells`);

    // A/B -> C: for every persona, the evaluator's answer is exactly the held Roles' grants (+ conditions, scope, direct).
    for (const { key, principalId } of personaPrincipals) {
      const c = ok(await sec("explainEffectiveAccess", { principalId }));
      const heldGlobal = new Set(c.securityRoleKeys);
      const holdersOf = (roleKey) => detail.get(roleKey).holders.filter((h) => h.principalId === principalId);
      for (const roleKey of heldGlobal) assert.ok(holdersOf(roleKey).some((h) => h.scopeType === "global"), `${key}: A lists ${roleKey}'s holder`);
      for (const action of c.actions) {
        const grants = [...heldGlobal].map((roleKey) => ({ roleKey, a: detail.get(roleKey).actions.find((x) => x.capabilityKey === action.capabilityKey) }))
          .filter((g) => g.a?.held);
        assert.deepEqual(action.sourceRoles.map((s) => [s.roleKey, s.condition ?? null]).sort(),
          grants.map((g) => [g.roleKey, activeCondition(g.a)]).sort(), `${key}: ${action.capabilityKey} sources`);
        const direct = matrix.get(action.objectKey)?.actions.find((x) => x.capabilityKey === action.capabilityKey)?.principals.some((p) => p.principalId === principalId) ?? false;
        assert.equal(action.directGrant !== null, direct, `${key}: ${action.capabilityKey} direct exception`);
        // Lane DX: an UNCONDITIONED direct exception is a capability source exactly like an unconditioned Role grant.
        const directCell = matrix.get(action.objectKey)?.actions.find((x) => x.capabilityKey === action.capabilityKey)
          ?.principals.find((p) => p.principalId === principalId) ?? null;
        const unconditioned = grants.some((g) => activeCondition(g.a) === null) || (directCell !== null && directCell.condition === null);
        if (unconditioned) {
          assert.ok(c.capabilities.includes(action.capabilityKey), `${key}: ${action.capabilityKey} in the flat set`);
          assert.notEqual(action.reasonCode, "CAPABILITY_MISSING", `${key}: ${action.capabilityKey}`);
        } else if (grants.length > 0 || directCell !== null) {
          assert.ok(c.conditionallyHeld.includes(action.capabilityKey) && !c.capabilities.includes(action.capabilityKey), `${key}: ${action.capabilityKey} conditioned-only`);
          assert.equal(action.withheldFromFlatSetKernels, true);
        } else if (action.scopedSources.length === 0) {
          assert.deepEqual([action.result, action.reasonCode, c.capabilities.includes(action.capabilityKey)], ["DENIED", "CAPABILITY_MISSING", false], `${key}: ${action.capabilityKey}`);
        }
      }
      // Scope: every scoped holder row in A appears in C with exactly the scope-evaluable held capabilities.
      for (const s of c.assignments.scoped) {
        assert.ok(holdersOf(s.roleKey).some((h) => h.scopeType === s.scopeType && h.scopeValue === s.scopeValue && h.assignmentId === s.assignmentId), `${key}: A holder for scoped ${s.roleKey}`);
        const expected = detail.get(s.roleKey).actions.filter((a) => a.held && scopeEvaluableCapabilities(s.scopeType).has(a.capabilityKey)).map((a) => a.capabilityKey).sort();
        assert.deepEqual([...s.capabilities].sort(), expected, `${key}: scoped ${s.roleKey} capabilities`);
        for (const cap of expected) {
          const src = c.actions.find((x) => x.capabilityKey === cap).scopedSources.find((x) => x.roleKey === s.roleKey && x.scopeValue === s.scopeValue);
          assert.ok(src, `${key}: scoped source for ${cap}`);
          assert.equal(src.result === "ALLOWED" || src.result === "CONDITIONAL", true, `${key}: in-scope ${cap} ${src.result}`);
        }
      }
    }
    const scopedView = ok(await sec("explainEffectiveAccess", { principalId: scopedHolder }));
    assert.deepEqual(scopedView.assignments.scoped.map((s) => [s.roleKey, s.scopeType, s.scopeValue, s.capabilities]), [["companyReader", "operatingCompany", "taylor", [EMP_READ]]]);
  });

  // ════════════════════ P4 ════════════════════
  await t.test("P4 Admin grant, revoke, condition and scoped assignment survive reconcile + activation + verification, and are not drift", async () => {
    // A REVOKE of a system default, on top of P2's grants and condition, and a scoped assignment through the API.
    ok(await sec("revokeObjectActionFromRole", { objectKey: "workOrder", actionKey: "cancel", roleKey: "dispatcher", reason: "dispatch does not cancel" }));
    ok(await sec("grantObjectActionToRole", { objectKey: "workOrder", actionKey: "read", roleKey: "officeManager", reason: "office reads Work Orders" }));
    const scoped = ok(await sec("assignRole", { principalId: dispatcherB.principalId, roleId: await roleId("companyReader"),
      scopeType: "operatingCompany", scopeValue: "ventana", reason: "reads Ventana Employees" }));
    const snapshot = async () => ({
      conditions: (await q(`SELECT grant_scope, grantor_key, capability_key, condition, status FROM eos_policy.capability_grant_conditions
                             WHERE tenant_id=$1 ORDER BY grantor_key, capability_key, status`, [TENANT])).rows,
      scoped: (await q(`SELECT id, principal_id, role_id, scope_type, scope_value, status FROM eos_policy.user_role_assignments
                         WHERE tenant_id=$1 AND scope_type <> 'global' ORDER BY id`, [TENANT])).rows,
      subject: await responsibilitiesOf(subject),
      dispatcherB: ok(await sec("explainEffectiveAccess", { principalId: dispatcherB.principalId })).assignments.scoped,
    });
    const before = await snapshot();
    assert.ok(before.conditions.some((c) => c.grantor_key === "woReviewer" && c.capability_key === WO_READ && c.status === "ACTIVE"));
    assert.ok(before.scoped.some((a) => a.id === scoped.id && a.scope_value === "ventana"));

    // THE SAMPLE COMPANY RECONCILE (seedSampleCompany.js step 3) and THE NONPROD ACTIVATION TOOL.
    const vocabulary = await capabilityAuthority.listCapabilityKeys(pool);
    const report = await reconcileInventoryCapabilityGrants(pool, {
      tenantId: TENANT, apply: true, actor: "sample-company-v2:wr",
      capabilityKeys: sampleCompanyCapabilityKeys().filter((k) => vocabulary.has(k)), roleKeys: sampleCompanyRoleKeys(),
    });
    assert.deepEqual(report.unresolved, []);
    assert.deepEqual(report.rows.filter((r) => r.status === "APPLIED").map((r) => `${r.roleKey}/${r.capabilityKey}`), PRE_EXISTING_RECONCILE_EXTRAS,
      "the reconcile re-added nothing an administrator decided");
    const activation = await activateWorkOrderLifecycleGrants(repo, { tenantId: TENANT, uid: boot.principal.id, heldRoleKeys: ["admin"] },
      { apply: true, reason: "re-run the activation" });
    assert.equal(activation.appliedAdditions, 0);
    assert.ok(activation.rows.some((r) => r.status === "ADMIN_REVOKED" && r.roleKey === "dispatcher" && r.capabilityKey === "workOrder.lifecycle.cancel"));

    const after = await snapshot();
    assert.deepEqual(after.conditions, before.conditions, "conditions survive");
    assert.deepEqual(after.scoped, before.scoped, "scoped assignments survive");
    assert.deepEqual(after.subject, before.subject, "the Employee's workflow responsibilities are unchanged");
    assert.deepEqual(after.dispatcherB, before.dispatcherB);
    const live = await liveGrants();
    const has = (roleKey, capabilityKey) => live.some((g) => g.roleKey === roleKey && g.capabilityKey === capabilityKey);
    assert.deepEqual([has("officeManager", WO_READ), has("woReviewer", WO_READ), has("dispatcher", "workOrder.lifecycle.cancel")], [true, true, false]);

    // VERIFICATION: every Administration decision explains its difference; the only drift is the pre-existing extras.
    const principals = [];
    for (const principalId of await repo.listTenantPrincipalIds(TENANT)) {
      const assignments = (await repo.listAssignmentsForPrincipal(TENANT, principalId)).filter((a) => a.status === "active" && a.scopeType === "global");
      const roleKeys = (await repo.listRoles(TENANT)).filter((r) => assignments.some((a) => a.roleId === r.id)).map((r) => r.key);
      const caps = await repo.listCapabilities();
      const directCapabilityKeys = (await repo.listPrincipalCapabilities(TENANT, principalId)).map((d) => caps.find((c) => c.id === d.capabilityId)?.key).filter(Boolean);
      principals.push({ principalId, roleKeys, directCapabilityKeys });
    }
    const decisions = await currentDecisions();
    const v = baseline.verifyLiveTenantAuthority({ live, decisions, environment: "nonprod", principals });
    assert.deepEqual(v.drift.map((d) => `${d.kind}:${d.roleKey}/${d.capabilityKey}`), PRE_EXISTING_RECONCILE_EXTRAS.map((c) => `UNEXPLAINED_EXTRA:${c}`), JSON.stringify(v.drift));
    const decided = new Set(decisions.map((d) => `${d.roleKey}/${d.capabilityKey}`));
    assert.equal(v.drift.some((d) => decided.has(`${d.roleKey}/${d.capabilityKey}`)), false, "an Administration decision was reported as drift");
    assert.ok(v.explainedByAdminGrant.some((c) => c.roleKey === "officeManager" && c.capabilityKey === WO_READ));
    assert.ok(v.explainedByAdminGrant.some((c) => c.roleKey === "woReviewer" && c.capabilityKey === WO_READ));
    assert.ok(v.explainedByAdminRevoke.some((c) => c.roleKey === "dispatcher" && c.capabilityKey === "workOrder.lifecycle.cancel"));
    assert.deepEqual(v.forbiddenPrincipalHoldings, []);
    await q(`DELETE FROM eos_policy.role_capabilities WHERE tenant_id = $1 AND granted_by = 'sample-company-v2:wr'`, [TENANT]);
    assert.deepEqual(baseline.verifyLiveTenantAuthority({ live: await liveGrants(), decisions, environment: "nonprod", principals }).drift, [],
      "with the pre-existing extras removed, zero drift");

    // SYSTEM INVARIANTS still hold: Administration refuses a forbidden pair, and one written behind its back is reported.
    const forbidden = await sec("grantObjectActionToRole", { objectKey: "salesAgreement", actionKey: "accept", roleKey: "owner", reason: "try a forbidden pair" });
    assert.equal(forbidden.ok, false);
    assert.match(forbidden.message, /may never hold salesAgreement\.accept/);
    await q(`INSERT INTO eos_policy.role_capabilities (id,tenant_id,role_id,capability_id,granted_by,created_by,updated_by)
             SELECT 'rc-wr-forbidden',$1,r.id,c.id,'rogue','rogue','rogue' FROM eos_policy.roles r, eos_policy.capabilities c
              WHERE r.tenant_id=$1 AND r.key='owner' AND c.key='salesAgreement.accept'`, [TENANT]);
    const rogue = baseline.verifyLiveTenantAuthority({ live: await liveGrants(), decisions: await currentDecisions(), environment: "nonprod" });
    assert.deepEqual(rogue.forbiddenPresent, [{ roleKey: "owner", capabilityKey: "salesAgreement.accept" }]);
    assert.ok(rogue.drift.some((d) => d.kind === "FORBIDDEN_PRESENT"));
    await q(`DELETE FROM eos_policy.role_capabilities WHERE id='rc-wr-forbidden'`);
  });

  // ════════════════════ P5 ════════════════════
  await t.test("P5 workflow administration completion via the API: every element manageable, and what is not", async () => {
    const workflowId = await workflowIdOf(WF);
    // DEFINITION + VERSIONS + LIFECYCLE STATES, as the list returns them.
    const listed = ok(await call("listWorkflows")).find((w) => w.workflow.key === WF);
    assert.deepEqual(listed.versions.map((v) => [v.version, v.status]), [[1, "PUBLISHED"], [2, "DRAFT"], [3, "PUBLISHED"], [4, "PUBLISHED"]]);
    assert.equal(listed.workflow.activeVersionId, v3Id);
    // STEPS, TRANSITIONS, SECURITY ROLE + FUNCTIONAL ROLE BINDINGS, GUARD, as one version reads.
    const view = ok(await call("readWorkflowVersion", { versionId: v3Id }));
    assert.deepEqual(view.steps.map((s) => [s.key, s.initial, s.terminal]).sort(), [["ASSIGNED", false, false], ["DONE", false, true], ["OPEN", true, false], ["WORKING", false, false]]);
    const complete = view.actions.find((a) => a.key === "complete");
    assert.deepEqual([complete.from, complete.to, complete.capabilityKey, complete.guardKind, complete.roleKeys, complete.functionalRoleKeys],
      ["WORKING", "DONE", COMPLETE, "RECORD_ASSIGNMENT", ["technician"], [FR_KEY]]);
    assert.deepEqual(view.actions.find((a) => a.key === "dispatch").roleKeys.sort(), ["dispatcher", "fieldManager"]);

    // A NEW DRAFT that edits steps and transitions (a new WAITING step), then publish -> ACTIVE.
    const v4 = ok(await call("createWorkflowDraft", { key: "woAdminProofCopy", name: "Copy", objectKey: "workOrder", reason: REASON, definition: V1 }));
    const edited = ok(await call("updateWorkflowDefinition", { versionId: v4.version.id, reason: REASON, definition: {
      steps: [...V1.steps.slice(0, 3), { key: "WAITING", label: "Waiting on parts" }, V1.steps[3]],
      actions: [...V1.actions, { key: "park", label: "Park", from: "WORKING", to: "WAITING", capabilityKey: TRANSITION, roleKeys: ["technician"], guardKind: "RECORD_ASSIGNMENT" },
        { key: "resume", label: "Resume", from: "WAITING", to: "WORKING", capabilityKey: TRANSITION, roleKeys: ["technician"], guardKind: "RECORD_ASSIGNMENT" }],
    } }));
    assert.deepEqual([edited.version.status, edited.version.version], ["DRAFT", 2], "the edit is the NEXT draft");
    const editedView = ok(await call("readWorkflowVersion", { versionId: edited.version.id }));
    assert.ok(editedView.steps.some((s) => s.key === "WAITING") && editedView.actions.some((a) => a.key === "park" && a.to === "WAITING"));
    // UNSAVED validation (the editor's live check) and the STORED validation.
    assert.deepEqual(ok(await call("validateWorkflowVersion", { objectKey: "workOrder", definition: V1 })).errors, []);
    const badUnsaved = ok(await call("validateWorkflowVersion", { objectKey: "workOrder", definition: {
      ...V1, actions: V1.actions.map((a) => (a.key === "dispatch" ? { ...a, roleKeys: ["officeManager"] } : a)) } }));
    assert.ok(badUnsaved.errors.some((e) => e.code === "BINDING_WITHOUT_CAPABILITY"), JSON.stringify(badUnsaved));
    ok(await call("publishWorkflowVersion", { versionId: edited.version.id, reason: REASON }));
    assert.equal(await activeVersionOf("woAdminProofCopy"), edited.version.id);

    // A PUBLISHED version is immutable: definition edits and binding edits are refused.
    const immutable = await call("updateWorkflowDefinition", { versionId: v3Id, definition: V1, reason: REASON });
    assert.equal(immutable.ok, false);
    const bindPublished = await call("setWorkflowRoleBinding", { versionId: v3Id, actionKey: "dispatch", roleId: await roleId("officeManager"), reason: REASON });
    assert.deepEqual([bindPublished.ok, bindPublished.message], [false, "a published workflow version's bindings cannot be changed"]);
    // GUARD: only the closed list. An unknown guard kind is refused at save.
    const badGuard = await call("createWorkflowVersion", { workflowId, reason: REASON, definition: {
      ...V1, actions: V1.actions.map((a) => (a.key === "start" ? { ...a, guardKind: "SELF" } : a)) } });
    assert.equal(badGuard.ok, false);
    assert.match(badGuard.message, /INVALID_GUARD/);
    // FUNCTIONAL ROLE: an unknown key would WIDEN if dropped, so it refuses the save.
    const badFr = await call("createWorkflowVersion", { workflowId, reason: REASON, definition: {
      ...V1, actions: V1.actions.map((a) => (a.key === "complete" ? { ...a, functionalRoleKeys: ["no-such-role"] } : a)) } });
    assert.equal(badFr.ok, false);
    assert.match(badFr.message, /UNKNOWN_FUNCTIONAL_ROLE/);

    // NOT MANAGEABLE -- SCOPE ON A BINDING. A binding row has no scope column (bindingKind SECURITY_ROLE | FUNCTIONAL_ROLE
    // only); a scope named on an action is not stored. Scope is expressed on the Security Role ASSIGNMENT (Pass 9 S5),
    // which the engine applies to the binding per record -- proved in P2(a).
    const scopedDraft = ok(await call("createWorkflowVersion", { workflowId, reason: REASON, definition: {
      ...V1, actions: V1.actions.map((a) => (a.key === "dispatch" ? { ...a, scopeType: "operatingCompany", scopeValue: "taylor" } : a)) } }));
    const scopedView = ok(await call("readWorkflowVersion", { versionId: scopedDraft.version.id }));
    for (const b of scopedView.actions.find((a) => a.key === "dispatch").bindings) assert.deepEqual(Object.keys(b).sort(), ["bindingKind", "functionalRoleKey", "roleKey"]);
    const columns = (await q(`SELECT column_name FROM information_schema.columns WHERE table_schema='eos_policy' AND table_name='workflow_role_bindings'`)).rows.map((r) => r.column_name);
    assert.equal(columns.some((c) => /scope/.test(c)), false, "no scope column on a binding");

    // MIGRATION to a new version: explicit, complete step map, audited; RETIRED refuses new pins and pinned retire refuses.
    const pinnedV1 = (await repo.listWorkflowInstances(TENANT, v1Id)).length;
    assert.ok(pinnedV1 > 0);
    const retirePinned = await call("retireWorkflowVersion", { versionId: v1Id, reason: "try" });
    assert.match(retirePinned.message, /WORKFLOW_VERSION_PINNED/);
    const migrated = ok(await call("migrateWorkflowInstances", { fromVersionId: v1Id, toVersionId: v3Id,
      stepMap: { OPEN: "OPEN", ASSIGNED: "ASSIGNED", WORKING: "WORKING", DONE: "DONE" }, reason: "move v1 records to v3" }));
    assert.equal(migrated.migrated.length, pinnedV1);
    assert.equal((await repo.listWorkflowInstances(TENANT, v1Id)).length, 0);
    assert.equal(ok(await call("retireWorkflowVersion", { versionId: v1Id, reason: "nothing runs on v1" })).status, "RETIRED");
    assert.match((await call("activateWorkflowVersion", { versionId: v1Id, reason: REASON })).message, /only a PUBLISHED version can be active/);
    // HISTORY: every step above is in the workflow's audit history.
    const history = ok(await call("readWorkflowHistory", { workflowId, limit: 500 })).map((e) => e.action);
    for (const action of ["createWorkflowDraft", "createWorkflowVersion", "updateWorkflowDefinition", "setWorkflowRoleBinding",
      "publishWorkflowVersion", "activateWorkflowVersion", "retireWorkflowVersion", "migrateWorkflowInstances"]) {
      assert.ok(history.includes(action), `history has ${action}`);
    }
    // The subject's responsibilities follow the ACTIVE version only, and a RETIRED version never appears.
    const resp = await responsibilitiesOf(subject);
    assert.equal([...resp.responsibilities, ...resp.boundWithoutAuthority].some((r) => r.versionId === v1Id), false);
  });

  async function frActor() {
    const ctx = await ctxFor(frAdmin);
    return { tenantId: TENANT, principalId: ctx.principalContext.uid, capabilities: ctx.capabilities,
      conditionallyHeld: ctx.conditionallyHeld, entitlements: ctx.entitlements };
  }
});
