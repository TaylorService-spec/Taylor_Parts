// THE WORKFLOW CONTROL PLANE, against PostgreSQL (migration 1762732800000).
//
// The fixture is the authority baseline's own rebuild pipeline (phases A-E, as
// administrationControlPlanePostgres), so every grant below is the measured nonprod baseline and
// every decision is made by the SAME runtime evaluator the command paths use.
//
//   1. The database refuses what the commands refuse: active pointer to a non-PUBLISHED version,
//      retiring the active or a pinned version, editing a published definition, pinning a DRAFT,
//      an unaudited ADOPT/MIGRATE event, rewriting an instance event.
//   2. Bootstrap: the first administrator gets workflow authority through Administration only.
//   3. The stale operationsManager Sales Order binding is REJECTED at publish and widens nothing.
//   4. The Work Order seed's missing fieldManager binding is reported.
//   5. WORKFLOW_BINDING AND EFFECTIVE_AUTHORITY over the live evaluator; a revoke through
//      Administration takes effect on a bound action immediately.
//   6. Pinning, ADOPT, MIGRATE, audit exactly once, tenant isolation, responsibilities.
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
const { explainEffectiveAccess } = require("../lib/eosOps/effectiveAccessExplanation.js");
const { applyWorkflowSeed } = require("../lib/adminPolicy/applyWorkflowSeed.js");
const { transitionWorkflowInstance } = require("../lib/adminPolicy/workflowInstances.js");
const { operationalWorkflowAuthority } = require("../lib/adminPolicy/workflowAuthority.js");
const { SALES_ORDER_WORKFLOW, WORK_ORDER_WORKFLOW } = require("../lib/adminPolicy/workflowSeeds.js");

const TENANT = "t-wf-control-plane";
const OTHER = "t-wf-other";
const OPERATOR = "operator-wf";
const ADMIN_SUBJECT = "uid-wf-admin";
const OTHER_ADMIN = "uid-wf-other-admin";
const WF_SUBJECT = "uid-wf-workflow-admin";
const OTHER_WF_SUBJECT = "uid-wf-other-workflow-admin";
const REASON = "workflow control plane proof";

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

test("the workflow control plane, end to end, against PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `wfcp_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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
  for (const tenant of [TENANT, OTHER]) {
    await q(`INSERT INTO eos_policy.tenants (id,key,name) VALUES ($1,$1,$1)`, [tenant]); // B
    await seedTenantPolicy(repo, tenant, OPERATOR);
  }
  migrate(url); // C
  const applyDeclared = async (tenant, pairs, grantedBy) => {
    for (const { roleKey, capabilityKey } of pairs) {
      await q(`INSERT INTO eos_policy.role_capabilities (id,tenant_id,role_id,capability_id,granted_by,created_by,updated_by)
               SELECT 'rc_wf_' || substr(md5($1 || r.id || c.id), 1, 24), $1, r.id, c.id, $4, $4, $4
                 FROM eos_policy.roles r, eos_policy.capabilities c WHERE r.tenant_id = $1 AND r.key = $2 AND c.key = $3
               ON CONFLICT (tenant_id, role_id, capability_id) DO NOTHING`, [tenant, roleKey, capabilityKey, grantedBy]);
    }
  };
  for (const tenant of [TENANT, OTHER]) {
    await applyDeclared(tenant, baseline.GLOBAL_CATALOG_ACTIVATED_GRANTS, "canonical-catalog:wf"); // D
    await applyDeclared(tenant, baseline.NONPROD_ACTIVATED_CAPABILITY_GRANTS, "nonprod-activation:wf"); // E
  }

  const auditCount = async (tenant = TENANT) =>
    Number((await q(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE tenant_id=$1`, [tenant])).rows[0].n);
  const grantCount = async () =>
    Number((await q(`SELECT count(*)::int n FROM eos_policy.role_capabilities WHERE tenant_id=$1`, [TENANT])).rows[0].n);
  const boot = await bootstrapAdministrator(repo, { tenantId: TENANT, externalSubject: ADMIN_SUBJECT, performedBy: OPERATOR, reason: "initial administrator" });
  await bootstrapAdministrator(repo, { tenantId: OTHER, externalSubject: OTHER_ADMIN, performedBy: OPERATOR, reason: "initial administrator" });
  // The workflow administrator (appointed in the bootstrap subtest); until then workflow calls go
  // as the security administrator and are refused.
  let adminActor = null;
  let defaultSubject = ADMIN_SUBJECT;
  const call = (operation, input = {}, subject = defaultSubject, deps = {}) => executeAdminOperation({ repo, ...deps },
    { caller: { externalSubject: subject, identityProvider: "firebase" }, operation, input, requestId: `r-${operation}` });
  /**
   * The Pass 8 bootstrap path: the security administrator creates a Workflow Administrator Role, grants
   * it workflowDefinition.* (a Role the administrator does NOT hold -- self-administration is refused)
   * and assigns it to ANOTHER principal. Each is one audited Administration act; no migration grants.
   */
  const appointWorkflowAdministrator = async (tenant, secSubject, wfSubject, actions = ["create", "edit", "version", "bindRole", "publish"]) => {
    const as = (op, input) => call(op, input, secSubject);
    const made = await as("createRole", { key: "workflowAdministrator", name: "Workflow Administrator", reason: REASON });
    assert.equal(made.ok, true, made.message);
    for (const actionKey of [...actions, "read"]) {
      const r = await as("grantObjectActionToRole", { objectKey: "workflowDefinition", actionKey, roleKey: "workflowAdministrator", reason: REASON });
      assert.equal(r.ok, true, r.message);
    }
    const holder = await ensureTenantPrincipal(repo, { tenantId: tenant, externalSubject: wfSubject, actorUid: OPERATOR, actorRoleKeys: ["admin"] });
    const principalId = holder.principal?.id ?? holder.id ?? holder.principalId;
    const assigned = await as("assignRole", { principalId, roleId: made.data.id, reason: "appoint the workflow administrator" });
    assert.equal(assigned.ok, true, assigned.message);
    return { tenantId: tenant, uid: principalId, heldRoleKeys: ["workflowAdministrator"] };
  };
  const roleId = async (key) => (await repo.getRoleByKey(TENANT, key)).id;
  const person = async (subject, roleKeys) => {
    const made = await ensureTenantPrincipal(repo, { tenantId: TENANT, externalSubject: subject, actorUid: OPERATOR, actorRoleKeys: ["admin"] });
    const principalId = made.principal?.id ?? made.id ?? made.principalId;
    for (const key of roleKeys) {
      const res = await call("assignRole", { principalId, roleId: await roleId(key), reason: "fixture staffing" }, ADMIN_SUBJECT);
      assert.equal(res.ok, true, `assignRole ${key}: ${JSON.stringify(res)}`);
    }
    return { subject, principalId, roleKeys };
  };
  const dispatcher = await person("uid-wf-dispatcher", ["dispatcher"]);
  const opsManager = await person("uid-wf-ops", ["operationsManager"]);
  const office = await person("uid-wf-office", ["officeManager"]);

  const provider = composition.postgresGrantConditionProvider(pool);
  const ctxFor = (p) => capabilityAuthority.resolveOperationalContext(repo, pool,
    { identityProvider: "firebase", externalSubject: p.subject, requestedTenantId: null }, provider);
  const runtimeFor = async (p) => {
    const ctx = await ctxFor(p);
    return {
      ctx,
      actor: { tenantId: TENANT, principalId: ctx.principalContext.uid, heldRoleKeys: ctx.principalContext.heldRoleKeys },
      authority: operationalWorkflowAuthority(evaluator.postgresContextualReader(pool), {
        tenantId: TENANT, principalId: ctx.principalContext.uid, capabilities: ctx.capabilities,
        conditionallyHeld: ctx.conditionallyHeld, entitlements: ctx.entitlements,
      }, "workOrder"),
    };
  };
  const workflowId = async (key, tenant = TENANT) => (await repo.listWorkflows(tenant)).find((w) => w.key === key).id;

  await t.test("the migration: columns, closed vocabularies, and nothing granted", async () => {
    const cols = (await q(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='eos_policy'
      AND (table_name, column_name) IN (('workflows','active_version_id'),('workflow_actions','capability_key'),
        ('workflow_actions','guard_kind'),('workflow_role_bindings','binding_kind'),('workflow_instance_events','event_kind'),
        ('workflow_instance_events','actor_principal_id'),('workflow_instance_events','audit_event_id'))`)).rows;
    assert.equal(cols.length, 7);
    const held = (await q(`SELECT c.key FROM eos_policy.role_capabilities rc JOIN eos_policy.capabilities c ON c.id=rc.capability_id
      WHERE rc.tenant_id=$1 AND c.key LIKE 'workflowDefinition.%' AND c.key <> 'workflowDefinition.read'`, [TENANT])).rows;
    assert.deepEqual(held, [], "no migration grants workflow write authority");
    // The seed-boundary drafts were written before capability_key existed: none carries one.
    const seeded = (await q(`SELECT count(*)::int n FROM eos_policy.workflow_actions WHERE tenant_id=$1 AND capability_key IS NOT NULL`, [TENANT])).rows[0].n;
    assert.equal(seeded, 0);
    // The legacy own-assignment flag was carried into the guard.
    const guards = (await q(`SELECT count(*)::int n FROM eos_policy.workflow_actions WHERE tenant_id=$1 AND requires_own_assignment
      AND guard_kind = 'RECORD_ASSIGNMENT'`, [TENANT])).rows[0].n;
    assert.ok(guards >= 6, `own-assignment actions carry the RECORD_ASSIGNMENT guard (${guards})`);
  });

  await t.test("bootstrap: workflow authority arrives through Administration, never by Role name or migration", async () => {
    const draft = (await repo.listWorkflowVersions(TENANT, await workflowId("salesOrder")))[0];
    const refused = await call("publishWorkflowVersion", { versionId: draft.id, reason: REASON });
    assert.deepEqual([refused.code, refused.message], ["FORBIDDEN", 'not authorized: "workflowDefinition.publish" is required']);
    // Pass 8: the administrator may not grant workflow authority to a Role it holds.
    const self = await call("grantObjectActionToRole", { objectKey: "workflowDefinition", actionKey: "publish", roleKey: "admin", reason: REASON });
    assert.match(self.message, /SELF_ADMINISTRATION/);
    const before = await auditCount();
    adminActor = await appointWorkflowAdministrator(TENANT, ADMIN_SUBJECT, WF_SUBJECT);
    assert.equal(await auditCount(), before + 1 + 6 + 1 + 1,
      "createRole + one audited decision per capability + provisioning the principal + the assignment");
    const decisions = (await repo.listRoleCapabilityDecisions(TENANT)).filter((d) => d.capabilityKey.startsWith("workflowDefinition."));
    assert.deepEqual([...new Set(decisions.map((d) => `${d.roleKey}/${d.decision}`))], ["workflowAdministrator/ADMIN_GRANTED"]);
    assert.equal(decisions.length, 6);
    defaultSubject = WF_SUBJECT;
    const readOk = await call("listWorkflows");
    assert.equal(readOk.ok, true, readOk.message);
  });

  await t.test("the database refuses what the commands refuse", async () => {
    const wf = await workflowId("workOrder");
    const draft = (await repo.listWorkflowVersions(TENANT, wf))[0];
    await assert.rejects(() => q(`UPDATE eos_policy.workflows SET active_version_id=$1 WHERE id=$2`, [draft.id, wf]),
      /WORKFLOW_ACTIVE_VERSION_NOT_PUBLISHED/);
    await assert.rejects(() => q(`INSERT INTO eos_policy.workflow_instances (id,tenant_id,workflow_version_id,object_key,record_id,current_step_key,created_by,updated_by)
      VALUES ('i-x',$1,$2,'workOrder','wo-x','CREATED','x','x')`, [TENANT, draft.id]), /WORKFLOW_INSTANCE_VERSION_NOT_PUBLISHED/);
    await assert.rejects(() => q(`DELETE FROM eos_policy.workflow_versions WHERE id=$1`, [draft.id]), /WORKFLOW_VERSION_IMMUTABLE/);
    await assert.rejects(() => q(`UPDATE eos_policy.workflow_actions SET guard_kind='SOMETHING' WHERE workflow_version_id=$1`, [draft.id]),
      /workflow_actions_guard_kind_known/);
    await assert.rejects(() => q(`UPDATE eos_policy.workflow_actions SET requires_own_assignment = NOT requires_own_assignment
      WHERE workflow_version_id=$1 AND guard_kind IS NOT NULL`, [draft.id]), /workflow_actions_guard_agrees_with_legacy_flag/);
  });

  // ── the Sales Order seed WITH its measured capabilities, as an administrator would re-apply it ──
  let salesOrderDraft;
  await t.test("STALE BINDING: operationsManager on Sales Order is REJECTED at publish and never widens", async () => {
    const opsCtx = await ctxFor(opsManager);
    assert.equal(opsCtx.capabilities.has("salesOrder.write"), false, "baseline: operationsManager holds no Sales Order capability");
    const grantsBefore = await grantCount();
    const applied = await applyWorkflowSeed(repo, adminActor, SALES_ORDER_WORKFLOW);
    salesOrderDraft = applied.version;
    assert.deepEqual(applied.unknownCapabilityKeys, []);
    const refused = await call("publishWorkflowVersion", { versionId: applied.version.id, reason: REASON });
    assert.equal(refused.code, "INVALID_INPUT");
    assert.match(refused.message, /^WORKFLOW_VALIDATION_FAILED: workflow version cannot be published: BINDING_WITHOUT_CAPABILITY Role "operationsManager"/);
    const v = await call("validateWorkflowVersion", { versionId: applied.version.id });
    assert.deepEqual(v.data.errors.map((e) => `${e.code}:${e.roleKey}/${e.actionKey}`).sort(), [
      "BINDING_WITHOUT_CAPABILITY:operationsManager/beginFulfillment",
      "BINDING_WITHOUT_CAPABILITY:operationsManager/close",
      "BINDING_WITHOUT_CAPABILITY:operationsManager/markFulfilled",
    ]);
    // The seed-boundary draft (v1) carries no capability at all, so it is refused too -- differently.
    const boundary = await call("validateWorkflowVersion", { versionId: (await repo.listWorkflowVersions(TENANT, await workflowId("salesOrder")))[0].id });
    assert.ok(boundary.data.errors.every((e) => e.code === "ACTION_WITHOUT_CAPABILITY"));
    // NOTHING WIDENED.
    assert.equal(await grantCount(), grantsBefore, "no grant was written");
    assert.equal((await ctxFor(opsManager)).capabilities.has("salesOrder.write"), false);
    const explained = await explainEffectiveAccess(repo, pool, { tenantId: TENANT, principalId: opsManager.principalId });
    assert.equal(explained.actions.find((a) => a.capabilityKey === "salesOrder.write").result, "DENIED");
    assert.equal((await repo.listWorkflows(TENANT)).find((w) => w.key === "salesOrder").activeVersionId, null);
  });

  await t.test("WORK ORDER SEED FINDING: fieldManager holds dispatch and cancel but is not bound", async () => {
    const applied = await applyWorkflowSeed(repo, adminActor, WORK_ORDER_WORKFLOW);
    const v = await call("validateWorkflowVersion", { versionId: applied.version.id });
    assert.deepEqual(v.data.errors, [], "with the nonprod baseline the Work Order seed is publishable");
    const fm = v.data.warnings.filter((w) => w.code === "CAPABILITY_HOLDER_NOT_BOUND" && w.roleKeys.includes("fieldManager"));
    const actions = fm.map((w) => w.actionKey);
    assert.ok(actions.includes("Dispatch"));
    assert.equal(actions.filter((a) => a.startsWith("CancelFrom")).length, 8);
    const published = await call("publishWorkflowVersion", { versionId: applied.version.id, reason: REASON });
    assert.equal(published.ok, true, published.message);
    assert.equal((await repo.listWorkflows(TENANT)).find((w) => w.key === "workOrder").activeVersionId, applied.version.id);
  });

  await t.test("RUNTIME: WORKFLOW_BINDING AND EFFECTIVE_AUTHORITY over the live evaluator", async () => {
    const start = await call("startWorkflowInstance", { workflowKey: "workOrder", recordId: "wo-rt-1", reason: REASON });
    assert.equal(start.ok, true, start.message);
    const d = await runtimeFor(dispatcher);
    const moved = await transitionWorkflowInstance(repo, d.actor, { objectKey: "workOrder", recordId: "wo-rt-1", actionKey: "MarkReady" }, d.authority);
    assert.equal(moved.instance.currentStepKey, "READY_TO_DISPATCH");
    // officeManager is bound to nothing: refused before authority is even asked.
    const o = await runtimeFor(office);
    await assert.rejects(() => transitionWorkflowInstance(repo, o.actor, { objectKey: "workOrder", recordId: "wo-rt-1", actionKey: "Schedule" }, o.authority),
      /notBoundToRole/);
    // A REVOKE through Administration takes effect on a still-bound action: the binding never granted.
    const revoked = await call("revokeObjectActionFromRole", { objectKey: "workOrder", actionKey: "transition", roleKey: "dispatcher", reason: REASON }, ADMIN_SUBJECT);
    assert.equal(revoked.ok, true, revoked.message);
    const d2 = await runtimeFor(dispatcher);
    await assert.rejects(() => transitionWorkflowInstance(repo, d2.actor, { objectKey: "workOrder", recordId: "wo-rt-1", actionKey: "Schedule" }, d2.authority),
      /effectiveAuthorityDenied \(CAPABILITY_MISSING\)/);
    const regrant = await call("grantObjectActionToRole", { objectKey: "workOrder", actionKey: "transition", roleKey: "dispatcher", reason: REASON }, ADMIN_SUBJECT);
    assert.equal(regrant.ok, true, regrant.message);
    const d3 = await runtimeFor(dispatcher);
    const scheduled = await transitionWorkflowInstance(repo, d3.actor, { objectKey: "workOrder", recordId: "wo-rt-1", actionKey: "Schedule" }, d3.authority);
    assert.equal(scheduled.instance.currentStepKey, "SCHEDULED");
    const events = (await q(`SELECT event_kind, action_key, actor_principal_id FROM eos_policy.workflow_instance_events
      WHERE tenant_id=$1 AND instance_id=$2 ORDER BY occurred_at, id`, [TENANT, start.data.id])).rows;
    assert.deepEqual(events.map((e) => e.event_kind), ["START", "TRANSITION", "TRANSITION"]);
    assert.equal(events[1].actor_principal_id, dispatcher.principalId);
    await assert.rejects(() => q(`UPDATE eos_policy.workflow_instance_events SET reason='x' WHERE tenant_id=$1`, [TENANT]),
      /WORKFLOW_INSTANCE_EVENTS_APPEND_ONLY/);
  });

  await t.test("PINNING, ADOPT, MIGRATE, RETIRE -- each audited exactly once", async () => {
    const wf = await workflowId("workOrder");
    const v1 = (await repo.listWorkflows(TENANT)).find((w) => w.key === "workOrder").activeVersionId;
    const adoptBefore = await auditCount();
    const adopted = await call("adoptRecordsIntoWorkflowVersion", {
      versionId: v1, records: [{ recordId: "wo-legacy-1", stepKey: "SCHEDULED" }, { recordId: "wo-legacy-2", stepKey: "CLOSED" }], reason: "adopt migrated WOs",
    });
    assert.equal(adopted.ok, true, adopted.message);
    assert.equal(await auditCount(), adoptBefore + 1);
    await assert.rejects(() => q(`INSERT INTO eos_policy.workflow_instance_events (id,tenant_id,instance_id,action_key,from_step_key,to_step_key,actor_uid,event_kind)
      VALUES ('e-x',$1,$2,'instance.adopt','A','A','x','ADOPT')`, [TENANT, adopted.data.instances[0].id]), /workflow_instance_events_admin_acts_audited/);

    // v2: a new version (copy) is published and becomes ACTIVE; v1 instances stay on v1.
    const v2 = await call("createWorkflowVersion", { workflowId: wf, copyFromVersionId: v1, reason: REASON });
    assert.equal(v2.ok, true, v2.message);
    assert.equal((await call("publishWorkflowVersion", { versionId: v2.data.version.id, reason: REASON })).ok, true);
    const pinned = (await q(`SELECT count(*)::int n FROM eos_policy.workflow_instances WHERE workflow_version_id=$1`, [v1])).rows[0].n;
    assert.equal(pinned, 3, "publishing a new version moved nobody");
    const retireRefused = await call("retireWorkflowVersion", { versionId: v1, reason: REASON });
    assert.match(retireRefused.message, /^WORKFLOW_VERSION_PINNED: 3 live instance/);
    await assert.rejects(() => q(`UPDATE eos_policy.workflow_versions SET status='RETIRED' WHERE id=$1`, [v1]), /WORKFLOW_VERSION_PINNED/);
    const activeRefused = await call("retireWorkflowVersion", { versionId: v2.data.version.id, reason: REASON });
    assert.match(activeRefused.message, /^WORKFLOW_VERSION_ACTIVE/);

    const steps = WORK_ORDER_WORKFLOW.steps.map((s) => s.key);
    const migrateBefore = await auditCount();
    const migrated = await call("migrateWorkflowInstances", {
      fromVersionId: v1, toVersionId: v2.data.version.id, stepMap: Object.fromEntries(steps.map((s) => [s, s])), reason: "move to v2",
    });
    assert.equal(migrated.ok, true, migrated.message);
    assert.equal(migrated.data.migrated.length, 3);
    assert.equal(await auditCount(), migrateBefore + 1, "ONE audit event for the whole migration");
    const auditRow = (await q(`SELECT action, actor_uid, target_id, reason, before, after FROM eos_policy.audit_events WHERE id=$1`,
      [migrated.data.auditEventId])).rows[0];
    assert.deepEqual([auditRow.action, auditRow.actor_uid, auditRow.target_id], ["migrateWorkflowInstances", adminActor.uid, v2.data.version.id]);
    assert.equal(auditRow.before.versionId, v1);
    assert.equal(auditRow.after.versionId, v2.data.version.id);
    assert.match(auditRow.reason, /^move to v2 \[request r-migrateWorkflowInstances\]$/);
    await assert.rejects(() => q(`UPDATE eos_policy.audit_events SET reason='x' WHERE id=$1`, [migrated.data.auditEventId]), /append/i);
    const retireBefore = await auditCount();
    const retired = await call("retireWorkflowVersion", { versionId: v1, reason: "nothing runs on v1" });
    assert.equal(retired.ok, true, retired.message);
    assert.equal(retired.data.status, "RETIRED");
    assert.equal(await auditCount(), retireBefore + 1);
  });

  await t.test("UNAUTHORIZED and TENANT ISOLATION", async () => {
    const before = await auditCount();
    const r = await call("activateWorkflowVersion", { versionId: salesOrderDraft.id, reason: REASON }, dispatcher.subject);
    assert.equal(r.code, "FORBIDDEN");
    assert.equal(r.message, 'not authorized: "workflowDefinition.publish" is required');
    assert.equal(await auditCount(), before);
    // Another tenant's administrator (who holds workflow authority in ITS tenant) finds nothing here.
    await appointWorkflowAdministrator(OTHER, OTHER_ADMIN, OTHER_WF_SUBJECT, ["publish", "edit"]);
    const beforeIsolation = await auditCount();
    const wo = (await repo.listWorkflows(TENANT)).find((w) => w.key === "workOrder").activeVersionId;
    for (const [operation, input] of [
      ["readWorkflowVersion", { versionId: wo }],
      ["retireWorkflowVersion", { versionId: wo, reason: REASON }],
      ["publishWorkflowVersion", { versionId: salesOrderDraft.id, reason: REASON }],
      ["adoptRecordsIntoWorkflowVersion", { versionId: wo, records: [{ recordId: "x", stepKey: "CREATED" }], reason: REASON }],
    ]) {
      const res = await call(operation, input, OTHER_WF_SUBJECT);
      assert.equal(res.code, "NOT_FOUND", `${operation}: ${res.code} ${res.message}`);
    }
    assert.equal(await auditCount(), beforeIsolation, "tenant A untouched");
  });

  await t.test("W01 D2: readMyWorkflowAdministration answers the caller's OWN decisions, exactly as the mutations enforce", async () => {
    const ops = ["createWorkflowDraft", "createWorkflowVersion", "updateWorkflowDefinition", "setWorkflowRoleBinding", "publishWorkflowVersion",
      "activateWorkflowVersion", "retireWorkflowVersion", "startWorkflowInstance", "adoptRecordsIntoWorkflowVersion", "migrateWorkflowInstances"];
    const before = await auditCount();
    // A workflow administrator holding every workflowDefinition capability: every operation allowed.
    const full = await call("readMyWorkflowAdministration", {}, WF_SUBJECT);
    assert.equal(full.ok, true, full.message);
    assert.deepEqual(Object.keys(full.data.operations).sort(), [...ops].sort());
    for (const op of ops) assert.equal(full.data.operations[op].allowed, true, op);
    assert.equal(full.data.operations.publishWorkflowVersion.requiredCapability, "workflowDefinition.publish");
    assert.equal(typeof full.data.operations.publishWorkflowVersion.requiredLabel, "string");
    // The Security administrator holds the workflow READ only: every operation refused -- and the real mutation agrees.
    const readOnly = await call("readMyWorkflowAdministration", {}, ADMIN_SUBJECT);
    assert.equal(readOnly.ok, true, readOnly.message);
    for (const op of ops) assert.equal(readOnly.data.operations[op].allowed, false, op);
    const draft = (await repo.listWorkflowVersions(TENANT, salesOrderDraft.workflowId)).find((v) => v.status === "DRAFT") ?? salesOrderDraft;
    for (const [op, input] of [["publishWorkflowVersion", { versionId: draft.id, reason: REASON }],
      ["updateWorkflowDefinition", { versionId: draft.id, definition: { steps: [], actions: [] }, reason: REASON }]]) {
      const refused = await call(op, input, ADMIN_SUBJECT);
      assert.equal(refused.code, "FORBIDDEN", `${op}: ${refused.code} ${refused.message}`);
      assert.match(refused.message, new RegExp(readOnly.data.operations[op].requiredCapability.replace(".", "\\.")));
    }
    // No workflow read at all: refused like every workflow read, before anything is computed.
    const none = await call("readMyWorkflowAdministration", {}, "uid-wf-dispatcher");
    assert.equal(none.code, "FORBIDDEN");
    // Self only: there is no way to ask about anyone else.
    const probe = await call("readMyWorkflowAdministration", { principalId: dispatcher.principalId }, ADMIN_SUBJECT);
    assert.equal(probe.code, "INVALID_INPUT");
    assert.equal(await auditCount(), before, "read-only: nothing audited, nothing changed");
  });

  await t.test("W01 D3: eligibleRoles are exactly the bindings validation accepts", async () => {
    const versions = await repo.listWorkflowVersions(TENANT, salesOrderDraft.workflowId);
    const view = await call("readWorkflowVersion", { versionId: versions[versions.length - 1].id }, ADMIN_SUBJECT);
    assert.equal(view.ok, true, view.message);
    assert.equal(typeof view.data.roleNames, "object");
    const allRoles = (await repo.listRoles(TENANT)).map((r) => r.key);
    const mapped = view.data.actions.filter((a) => a.capabilityKey);
    assert.ok(mapped.length > 0, "the seeded Sales Order workflow names capabilities");
    const asDefinition = (roleKeysFor) => ({
      steps: view.data.steps,
      actions: view.data.actions.map((a) => ({ key: a.key, from: a.from, to: a.to, capabilityKey: a.capabilityKey, guardKind: a.guardKind,
        roleKeys: roleKeysFor(a), functionalRoleKeys: [] })),
    });
    const bindingErrors = async (definition) => {
      const v = await call("validateWorkflowVersion", { objectKey: view.data.workflow.objectKey, definition }, ADMIN_SUBJECT);
      assert.equal(v.ok, true, v.message);
      return v.data.errors.filter((e) => e.code === "BINDING_WITHOUT_CAPABILITY");
    };
    // Every eligible Role, bound everywhere it is eligible: no binding error.
    assert.deepEqual(await bindingErrors(asDefinition((a) => (a.eligibleRoles ?? []).map((r) => r.key))), []);
    for (const a of mapped) {
      assert.ok(Array.isArray(a.eligibleRoles), a.key);
      for (const r of a.eligibleRoles) assert.equal(view.data.roleNames[r.key], r.name);
      // Any Role NOT eligible, bound to this action: exactly the refusal the page warns about.
      const outsider = allRoles.find((k) => !a.eligibleRoles.some((r) => r.key === k));
      if (!outsider) continue;
      const errs = await bindingErrors(asDefinition((x) => (x.key === a.key ? [outsider] : (x.eligibleRoles ?? []).map((r) => r.key))));
      assert.deepEqual(errs.map((e) => [e.actionKey, e.roleKey]), [[a.key, outsider]]);
    }
    // An action that names no capability has no eligibility to state.
    for (const a of view.data.actions.filter((x) => !x.capabilityKey)) assert.equal(a.eligibleRoles, null, a.key);
  });

  await t.test("RESPONSIBILITIES: bindings on held Roles INTERSECTED with the runtime evaluator's answer", async () => {
    const deps = { explainEffectiveAccess: (tenantId, principalId) => explainEffectiveAccess(repo, pool, { tenantId, principalId }) };
    const d = await call("listPrincipalWorkflowResponsibilities", { principalId: dispatcher.principalId }, ADMIN_SUBJECT, deps);
    assert.equal(d.ok, true, d.message);
    const keys = d.data.responsibilities.map((x) => `${x.workflowKey}/${x.actionKey}`);
    assert.ok(keys.includes("workOrder/MarkReady"));
    assert.ok(keys.includes("workOrder/Dispatch"), "dispatch is held by dispatcher through the nonprod activation");
    assert.ok(d.data.responsibilities.every((x) => x.source === "WORKFLOW_BINDING_AND_EFFECTIVE_AUTHORITY"));
    const ops = await call("listPrincipalWorkflowResponsibilities", { principalId: opsManager.principalId }, ADMIN_SUBJECT, deps);
    assert.deepEqual(ops.data.responsibilities.filter((x) => x.workflowKey === "salesOrder"), [],
      "no Sales Order workflow responsibility for operationsManager");
    const other = await call("listPrincipalWorkflowResponsibilities", { principalId: dispatcher.principalId }, OTHER_ADMIN, deps);
    assert.notEqual(other.ok, true, "another tenant cannot read this principal's responsibilities");
  });
});
