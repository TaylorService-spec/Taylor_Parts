// ADMINISTRATION CONTROL PLANE + SCALED WORKFORCE (DECISIONS #210), over PostgreSQL:
//   the workforce roster (Security Roles only with admin.principalAccess.read), the Effective Access Job Role fact, read-only
//   audited View As preview resolved by the runtime resolver, whole-object authority expanded into governed per-action grants,
//   the workflow runtime (a binding changes who may transition; the engine refuses the unbound), EMP-RT-05 assigned work,
//   Security Role holders with their Employee, and the truck's current technicians. Plus static guards: the workforce
//   orchestrator writes no SQL and admits Principals only through ensureTenantPrincipal; the preview cannot write business rows.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { serviceBaselineTenant, HOUR } from "./support/serviceBaselineTenant.mjs";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const vocabulary = require("../lib/eosWorkforce/jobRoleVocabulary.js");
const { listWorkforceRoster } = require("../lib/eosAdministration/workforceRoster.js");
const { listAssignedWorkForEmployee } = require("../lib/eosWorkforce/reads/assignedWorkReads.js");
const { resolveOperationalContext } = require("../lib/eosOps/capabilityAuthority.js");
const { postgresGrantConditionProvider } = require("../lib/eosOps/entitledActionAuthority.js");
const { executeAdminOperation } = require("../lib/adminPolicy/adminPolicyApi.js");
const { listTruckViews } = require("../lib/eosOps/truckRegistryAdministration.js");
const { explainEffectiveAccess } = require("../lib/eosOps/effectiveAccessExplanation.js");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const TENANT = "t-acp";
const WS = "/operations/workspace", WO = "/operations/work-orders", WF = "/operations/workflow";
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

test("static: the workforce orchestrator writes no SQL and admits Principals only through ensureTenantPrincipal", () => {
  const s = strip(readFileSync(resolve(HERE, "../scripts/seedTaylorNonprodWorkforce.mjs"), "utf8"));
  assert.doesNotMatch(s, /\b(INSERT\s+INTO|UPDATE\s+\w+\.\w+\s+SET|DELETE\s+FROM)\b/i, "no direct table write");
  assert.match(s, /ensureTenantPrincipal\(/);
  assert.match(s, /--tokens local is refused for a non-localhost API/);
  const m = JSON.parse(readFileSync(resolve(HERE, "../scripts/fixtures/taylorNonprodWorkforce.v1.json"), "utf8"));
  assert.deepEqual([...new Set(m.employees.map((e) => e.jobRoleId))].sort(), [...vocabulary.CANONICAL_JOB_ROLE_IDS].sort(), "all 16 canonical Job Roles, no others");
  assert.equal(m.employees.filter((e) => e.jobRoleId === "service-technician").length, 10);
  assert.equal(m.trucks.length, 10);
  // Owner ruling 2026-10-09 (Administrator full access): the Administrator's Employee holds the company-keyed REORDER_QUEUE
  // scope for every KEYED company (taylor; nonprod Ventana is unkeyed, so the writer would refuse it) -- issued by the Owner
  // persona, never self-assigned -- and still NO Work Eligibility and NO WAREHOUSE scope (ADMIN_IMPLIES_NO_WORK_ELIGIBILITY;
  // warehouse reach is decision item #2038).
  const administrator = m.employees.find((e) => e.employeeId === m.actors.workforceAdministration);
  assert.deepEqual(administrator.scopes.map((x) => `${x.scopeType}:${x.scopeId}`).sort(), ["REORDER_QUEUE:taylor"]);
  assert.deepEqual(administrator.workEligibility, []);
  assert.match(s, /scopeActor = e\.employeeId === MANIFEST\.actors\.workforceAdministration \? OWNER : ADMIN/, "the Administrator's own scopes are issued by the Owner persona");
  assert.equal(m.employees.filter((e) => e.securityRoles.some((r) => r.role === "salesManager")).length, 2);
  assert.ok(m.employees.every((e) => !e.securityRoles.some((r) => r.role === "salesManager")) === false && !vocabulary.CANONICAL_JOB_ROLE_IDS.includes("sales-manager"), "Sales Manager is a Security Role, never a Job Role");
});

test("static: View As writes only its audit row; the workspace module stays read-only", () => {
  const preview = strip(readFileSync(resolve(HERE, "../src/eosExperience/previewAsUser.ts"), "utf8"));
  assert.doesNotMatch(preview, /\b(INSERT\s+INTO|UPDATE\s+\w+\.\w+\s+SET|DELETE\s+FROM)\b/i);
  assert.match(preview, /resolveOperationalContextForPrincipal/);
  assert.match(preview, /auditExperiencePreview/);
});

test("administration control plane + workforce over PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { q: query, admin, person, call, repo, pool } = await serviceBaselineTenant(t, { urlBase: URL_BASE, tenant: TENANT, prefix: "acp" });
  const q = async (sql, v = []) => (await query(sql, v)).rows;
  const ok = (r, what = "") => { assert.equal(r.status, 200, `${what} ${JSON.stringify(r.body).slice(0, 600)}`); return r.body.result; };
  const adminAs = (who, operation, input) => executeAdminOperation({ repo }, { caller: { externalSubject: who.subject, identityProvider: "firebase" }, operation, input, requestId: `r-${randomUUID()}` });
  const actorOf = async (who) => {
    const ctx = await resolveOperationalContext(repo, pool, { identityProvider: "firebase", externalSubject: who.subject, requestedTenantId: null }, postgresGrantConditionProvider(pool));
    return { tenantId: TENANT, principalId: ctx.principalContext.uid, capabilities: ctx.capabilities, scopedHeld: ctx.scopedHeld, entitlements: ctx.entitlements };
  };
  for (const r of vocabulary.CANONICAL_JOB_ROLES) {
    await q(`INSERT INTO eos_workforce.job_roles (id, tenant_id, display_name, status, created_by, updated_by) VALUES ($1,$2,$3,'ACTIVE','f','f') ON CONFLICT DO NOTHING`, [r.jobRoleId, TENANT, r.displayName]);
  }
  let jr = 0;
  const jobRole = (employeeId, jobRoleId) => q(`INSERT INTO eos_workforce.employee_job_role_assignments (id, tenant_id, employee_id, job_role_id, effective_from, assigned_by, reason)
      VALUES ($1,$2,$3,$4,now(),'f','fixture')`, [`ejr-${++jr}`, TENANT, employeeId, jobRoleId]);
  const adminP = await person("uid-acp-admin2", ["admin"], { id: "e-admin", name: "Casey Admin" });
  const tech = await person("uid-acp-tech", ["technician"], { id: "e-tech", name: "Sofia Tech", technician: true });
  const dispatcher = await person("uid-acp-disp", ["dispatcher"], { id: "e-disp", name: "Taylor Dispatch" });
  const gm = await person("uid-acp-gm", ["generalManager"], { id: "e-gm", name: "Jordan GM" });
  const seller = await person("uid-acp-seller", ["salesperson"], { id: "e-seller", name: "Robin Seller" });
  const analyst = await person("uid-acp-analyst", ["reportViewer"], { id: "e-analyst", name: "Jules Analyst" });
  const wfAdmin = await person("uid-acp-om", ["officeManager"], { id: "e-om", name: "Priya Office" });
  await q(`INSERT INTO eos_workforce.employees (id,tenant_id,employment_status,operating_company_id,display_name) VALUES ('e-unlinked',$1,'ACTIVE','taylor','Pat Unlinked')`, [TENANT]);
  for (const [e, r] of [["e-tech", "service-technician"], ["e-disp", "service-coordinator-dispatcher"], ["e-gm", "general-manager"], ["e-seller", "retail-sales"], ["e-analyst", "reporting-analyst"], ["e-admin", "office-administration"], ["e-om", "office-manager"]]) await jobRole(e, r);
  await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, created_by, updated_by) VALUES ('acct-1',$1,'Harbor Grill','ACTIVE','f','f')`, [TENANT]);
  await q(`INSERT INTO eos_crm.account_locations (id, tenant_id, account_id, name, created_by, updated_by) VALUES ('loc-1',$1,'acct-1','Downtown','f','f')`, [TENANT]);
  const ROUND = Object.fromEntries(["0", "1", "2", "3", "4", "5", "6"].map((d) => [d, [{ start: "00:00", end: "24:00" }]]));
  ok(await call(dispatcher, WO, "setTechnicianWorkingHours", { employeeId: "e-tech", timeZone: "UTC", weeklyHours: ROUND, reason: "fixture" }), "hours");
  const assigned = ok(await call(dispatcher, WO, "createWorkOrder", { operatingCompanyId: "taylor", customerId: "acct-1", locationId: "loc-1", workOrderType: "SERVICE_CALL", priority: 2 }), "create").workOrderId;
  ok(await call(dispatcher, WO, "markWorkOrderReady", { workOrderId: assigned }), "ready");
  ok(await call(dispatcher, WO, "setWorkOrderPartsPlan", { workOrderId: assigned, plan: [] }), "plan");
  const start = Date.now() + 2 * 24 * HOUR;
  ok(await call(dispatcher, WO, "scheduleWorkOrder", { workOrderId: assigned, employeeId: "e-tech", scheduledStart: start, scheduledEnd: start + HOUR }), "schedule");

  await t.test("ROSTER: many per Job Role, with Security Roles for principalAccess readers -- withheld (and unfilterable) for others", async () => {
    const r = await listWorkforceRoster({ pool }, await actorOf(adminP), {});
    const techRow = r.items.find((i) => i.employeeId === "e-tech");
    assert.equal(techRow.jobRole.id, "service-technician");
    assert.deepEqual(techRow.securityRoles.map((s) => s.roleKey), ["technician"]);
    assert.ok(techRow.workEligibility.includes("SERVICE_TECHNICIAN"));
    assert.ok(techRow.principalId, "the Principal id is given to a principalAccess reader (for assignment)");
    assert.equal(r.items.find((i) => i.employeeId === "e-unlinked").applicationUser, "UNLINKED");
    assert.ok(r.facets.jobRoles.some((j) => j.id === "service-technician" && j.count === 1));
    const filtered = await listWorkforceRoster({ pool }, await actorOf(adminP), { securityRoleKey: "technician" });
    assert.deepEqual(filtered.items.map((i) => i.employeeId), ["e-tech"]);
    const gmView = await listWorkforceRoster({ pool }, await actorOf(gm), {});
    assert.equal(gmView.items.find((i) => i.employeeId === "e-tech").securityRoles, null, "withheld, not empty");
    assert.equal(gmView.items.find((i) => i.employeeId === "e-tech").principalId, null);
    assert.match(gmView.securityRolesWithheld, /admin\.principalAccess\.read/);
    await assert.rejects(listWorkforceRoster({ pool }, await actorOf(gm), { securityRoleKey: "technician" }), (e) => e.code === "CAPABILITY_REQUIRED");
    await assert.rejects(listWorkforceRoster({ pool }, await actorOf(tech), {}), (e) => e.code === "CAPABILITY_REQUIRED");
  });

  await t.test("ROSTER ORDER (UI corrections B/C): Last, First, Employee id over the WHOLE authorized set, before the bound; column sort; limit", async () => {
    for (const [id, first, last] of [["e-ord-3", "Ann", "Zimmer"], ["e-ord-1", "Bob", "Avery"], ["e-ord-2", "Al", "Avery"], ["e-ord-0", "Al", "Avery"]]) {
      await q(`INSERT INTO eos_workforce.employees (id,tenant_id,employment_status,operating_company_id,first_name,last_name) VALUES ($1,$2,'ACTIVE','taylor',$3,$4)`, [id, TENANT, first, last]);
    }
    const all = await listWorkforceRoster({ pool }, await actorOf(adminP), {});
    assert.deepEqual(all.sort, { key: "name", direction: "asc", isDefault: true });
    const ord = all.items.filter((i) => i.employeeId.startsWith("e-ord-")).map((i) => i.employeeId);
    // Avery Al (e-ord-0, e-ord-2: same name, Employee id breaks the tie), Avery Bob, then Zimmer Ann.
    assert.deepEqual(ord, ["e-ord-0", "e-ord-2", "e-ord-1", "e-ord-3"]);
    // The default order is over everybody: no row sorts before a row with an earlier last name.
    const lastNames = all.items.map((i) => (i.lastName ?? (i.displayName ?? "").split(/\s+/).pop() ?? "").toLowerCase());
    assert.deepEqual(lastNames, [...lastNames].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })));
    // The bound applies AFTER the order: limit 2 is the first two of the sorted whole, and the total is the whole.
    const two = await listWorkforceRoster({ pool }, await actorOf(adminP), { limit: 2 });
    assert.deepEqual(two.items.map((i) => i.employeeId), all.items.slice(0, 2).map((i) => i.employeeId));
    assert.equal(two.total, all.total);
    assert.equal(two.truncated, true);
    // A column sort: descending by name reverses the name order; a sort keeps filters.
    const desc = await listWorkforceRoster({ pool }, await actorOf(adminP), { sort: { key: "name", direction: "desc" }, query: "Avery" });
    assert.deepEqual(desc.items.map((i) => i.employeeId), ["e-ord-1", "e-ord-0", "e-ord-2"]);
    const byNumber = await listWorkforceRoster({ pool }, await actorOf(adminP), { sort: { key: "jobRole", direction: "asc" } });
    const labels = byNumber.items.map((i) => i.jobRole?.label ?? null);
    const firstEmpty = labels.indexOf(null);
    assert.ok(firstEmpty === -1 || labels.slice(firstEmpty).every((l) => l === null), "empty values sort last");
    await assert.rejects(listWorkforceRoster({ pool }, await actorOf(adminP), { sort: { key: "salary", direction: "asc" } }), (e) => e.code === "FILTER_INVALID");
    await assert.rejects(listWorkforceRoster({ pool }, await actorOf(adminP), { limit: 501 }), (e) => e.code === "FILTER_INVALID");
    // Ordering never widens: the technician is still refused.
    await assert.rejects(listWorkforceRoster({ pool }, await actorOf(tech), { sort: { key: "name", direction: "asc" } }), (e) => e.code === "CAPABILITY_REQUIRED");
  });

  await t.test("EFFECTIVE ACCESS PROVENANCE (UI corrections §15): ROLE / DIRECT / ROLE_AND_DIRECT / NONE from the evaluator's own sources", async () => {
    const x = await explainEffectiveAccess(repo, pool, { tenantId: TENANT, principalId: tech.principalId });
    for (const a of x.actions) {
      const viaRole = a.sourceRoles.length + a.scopedSources.length > 0;
      const expected = viaRole && a.directGrant ? "ROLE_AND_DIRECT" : a.directGrant ? "DIRECT" : viaRole ? "ROLE" : "NONE";
      assert.equal(a.provenance, expected, a.capabilityKey);
    }
    assert.ok(x.actions.some((a) => a.provenance === "ROLE"), "the technician holds Role-granted capabilities");
    assert.ok(x.actions.some((a) => a.provenance === "NONE"));
  });

  await t.test("EFFECTIVE ACCESS: the chain carries the Job Role as a fact that grants nothing", async () => {
    const x = await explainEffectiveAccess(repo, pool, { tenantId: TENANT, principalId: tech.principalId });
    assert.equal(x.employeeFacts.jobRole.id, "service-technician");
    assert.equal(x.employeeFacts.grantsCapabilities, false);
    assert.equal(x.employeeFacts.employee.displayName, "Sofia Tech");
  });

  await t.test("VIEW AS: read-only, audited, resolved by the runtime resolver -- equal to the subject's own workspace", async () => {
    const before = (await q(`SELECT count(*)::int n FROM eos_ops.work_orders WHERE tenant_id=$1`, [TENANT]))[0].n;
    const p = ok(await call(adminP, WS, "previewMyWorkAs", { employeeId: "e-tech", reason: "test" }), "preview");
    const own = ok(await call(tech, WS, "readMyWork", {}), "own");
    assert.deepEqual([p.preview, p.readOnly], [true, true]);
    assert.equal(p.work.persona.key, "service-technician");
    assert.deepEqual(p.work.sections.map((s) => [s.key, s.status, s.items.map((i) => i.id)]), own.sections.map((s) => [s.key, s.status, s.items.map((i) => i.id)]));
    assert.deepEqual(p.subject.securityRoleKeys, ["technician"]);
    const audit = await q(`SELECT actor_uid, target_id, after FROM eos_policy.audit_events WHERE tenant_id=$1 AND action='experience.previewAsUser'`, [TENANT]);
    assert.equal(audit.length, 1);
    assert.deepEqual([audit[0].actor_uid, audit[0].target_id], [adminP.principalId, tech.principalId]);
    assert.equal((await q(`SELECT count(*)::int n FROM eos_ops.work_orders WHERE tenant_id=$1`, [TENANT]))[0].n, before, "a preview creates nothing");
    const refused = await call(analyst, WS, "previewMyWorkAs", { employeeId: "e-tech" });
    assert.deepEqual([refused.status, refused.body.code], [403, "NOT_AUTHORIZED"]);
    const unlinked = await call(adminP, WS, "previewMyWorkAs", { employeeId: "e-unlinked" });
    assert.deepEqual([unlinked.status, unlinked.body.code], [400, "NO_LINKED_PRINCIPAL"]);
  });

  await t.test("WHOLE OBJECT: expanded into the Object's governed per-action grants, idempotent, refusals reported per action", async () => {
    const g = await admin("applyObjectWideRoleAuthority", { objectKey: "account", roleKey: "generalEmployee", mode: "GRANT", reason: "test" });
    assert.equal(g.ok, true, JSON.stringify(g));
    const caps = (await q(`SELECT key FROM eos_policy.capabilities WHERE object_key='account' ORDER BY key`)).map((r) => r.key);
    assert.deepEqual(g.data.actions.map((a) => a.capabilityKey).sort(), caps);
    assert.ok(g.data.actions.every((a) => a.outcome === "GRANTED"));
    const held = await q(`SELECT c.key FROM eos_policy.role_capabilities rc JOIN eos_policy.roles r ON r.id=rc.role_id AND r.key='generalEmployee' JOIN eos_policy.capabilities c ON c.id=rc.capability_id WHERE rc.tenant_id=$1 AND c.object_key='account'`, [TENANT]);
    assert.equal(held.length, caps.length);
    const audits = (await q(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE tenant_id=$1 AND action='grantObjectActionToRole' AND after::text LIKE '%generalEmployee%'`, [TENANT]))[0].n;
    assert.equal(audits, caps.length, "one audit event per expanded action");
    const again = await admin("applyObjectWideRoleAuthority", { objectKey: "account", roleKey: "generalEmployee", mode: "GRANT", reason: "test" });
    assert.ok(again.data.actions.every((a) => a.outcome === "ALREADY_HELD"));
    const rev = await admin("applyObjectWideRoleAuthority", { objectKey: "account", roleKey: "generalEmployee", mode: "REVOKE", reason: "test" });
    assert.ok(rev.data.actions.every((a) => a.outcome === "REVOKED"));
    const inv = await admin("applyObjectWideRoleAuthority", { objectKey: "reorderRequest", roleKey: "owner", mode: "GRANT", reason: "test" });
    assert.equal(inv.ok, true);
    assert.ok(inv.data.actions.some((a) => a.actionKey === "assign" && a.outcome === "REFUSED" && /SYSTEM_INVARIANT/.test(a.refusal)), "the Owner invariant is reported, never bypassed");
    await admin("applyObjectWideRoleAuthority", { objectKey: "reorderRequest", roleKey: "owner", mode: "REVOKE", reason: "restore" });
    const outsider = await adminAs(seller, "applyObjectWideRoleAuthority", { objectKey: "account", roleKey: "generalEmployee", mode: "GRANT", reason: "x" });
    assert.equal(outsider.ok, false, "an unauthorized caller cannot apply object authority");
    const noReason = await admin("applyObjectWideRoleAuthority", { objectKey: "account", roleKey: "generalEmployee", mode: "GRANT" });
    assert.equal(noReason.ok, false, "a stated reason is required");
  });

  await t.test("WORKFLOW RUNTIME: a published binding decides who may transition; the engine refuses the unbound", async () => {
    for (const actionKey of ["create", "read", "edit", "version", "publish", "bindRole"]) {
      assert.equal((await admin("grantObjectActionToRole", { roleKey: "officeManager", objectKey: "workflowDefinition", actionKey, reason: "workflow administration" })).ok, true, actionKey);
    }
    const list = await adminAs(wfAdmin, "listWorkflows", {});
    assert.equal(list.ok, true, JSON.stringify(list));
    const entry = list.data.find((w) => w.workflow.key === "salesAgreement");
    const sa = entry.workflow;
    const draft = entry.versions[0].id;
    const def = (bound) => ({ steps: [{ key: "DRAFT", label: "Draft", initial: true, terminal: false }, { key: "ACCEPTED", label: "Accepted", initial: false, terminal: true }, { key: "DECLINED", label: "Declined", initial: false, terminal: true }],
      actions: [{ key: "accept", label: "Accept", from: "DRAFT", to: "ACCEPTED", capabilityKey: "salesAgreement.accept", roleKeys: bound },
        { key: "decline", label: "Decline", from: "DRAFT", to: "DECLINED", capabilityKey: "salesAgreement.updateDraft", roleKeys: ["salesperson"] }] });
    const saved = await adminAs(wfAdmin, "updateWorkflowDefinition", { versionId: draft, definition: def(["salesperson"]), reason: "sellers only" });
    assert.equal(saved.ok, true, JSON.stringify(saved));
    const v1 = saved.data.version?.id ?? draft;
    assert.equal((await adminAs(wfAdmin, "publishWorkflowVersion", { versionId: v1, reason: "publish" })).ok, true);
    assert.equal((await adminAs(wfAdmin, "startWorkflowInstance", { workflowKey: "salesAgreement", recordId: "sa-1", reason: "start" })).ok, true);
    const gmWork = ok(await call(gm, WF, "listWorkflowWork", { objectKey: "salesAgreement" }), "gm work");
    const gmAccept = gmWork.items.find((i) => i.recordId === "sa-1").actions.find((a) => a.actionKey === "accept");
    assert.deepEqual([gmAccept.allowed, gmAccept.refusal], [false, "notBoundToRole"], "holds the capability, not bound");
    const refused = await call(gm, WF, "transitionWorkflowInstance", { objectKey: "salesAgreement", recordId: "sa-1", actionKey: "accept" });
    assert.deepEqual([refused.status, refused.body.code], [403, "WORKFLOW_ACTION_REFUSED"]);
    const techTry = await call(tech, WF, "transitionWorkflowInstance", { objectKey: "salesAgreement", recordId: "sa-1", actionKey: "accept" });
    assert.equal(techTry.status, 403);
    // Bind the GM in a new version, publish (ACTIVE), move the in-flight record: the GM may now act.
    const v2 = (await adminAs(wfAdmin, "createWorkflowVersion", { workflowId: sa.id, copyFromVersionId: v1, definition: def(["salesperson", "generalManager"]), reason: "bind GM" })).data.version.id;
    assert.equal((await adminAs(wfAdmin, "publishWorkflowVersion", { versionId: v2, reason: "publish GM" })).ok, true);
    assert.equal((await adminAs(wfAdmin, "migrateWorkflowInstances", { fromVersionId: v1, toVersionId: v2, stepMap: { DRAFT: "DRAFT", ACCEPTED: "ACCEPTED", DECLINED: "DECLINED" }, reason: "move" })).ok, true);
    const moved = ok(await call(gm, WF, "listWorkflowWork", {}), "gm work 2").items.find((i) => i.recordId === "sa-1").actions.find((a) => a.actionKey === "accept");
    assert.equal(moved.allowed, true);
    const done = ok(await call(gm, WF, "transitionWorkflowInstance", { objectKey: "salesAgreement", recordId: "sa-1", actionKey: "accept", reason: "customer accepted" }), "transition");
    assert.equal(done.currentStepKey, "ACCEPTED");
    const ev = await q(`SELECT e.action_key FROM eos_policy.workflow_instance_events e JOIN eos_policy.workflow_instances i ON i.id=e.instance_id WHERE i.tenant_id=$1 AND i.record_id='sa-1' ORDER BY e.occurred_at`, [TENANT]);
    assert.deepEqual(ev.map((e) => e.action_key), ["instance.start", "version.migrate", "accept"]);
    const unauthorizedPublish = await adminAs(gm, "publishWorkflowVersion", { versionId: v2, reason: "x" });
    assert.equal(unauthorizedPublish.ok, false, "workflow administration needs workflowDefinition.publish");
  });

  await t.test("EMP-RT-05: current assigned work -- the family's own read, never for an assignment-restricted reader", async () => {
    const own = await listAssignedWorkForEmployee({ pool }, await actorOf(adminP), { employeeId: "e-tech", family: "WORK_ORDER" });
    assert.deepEqual(own.items.map((i) => i.recordId), [assigned]);
    assert.equal(own.axis, "ASSIGNED_PERSON");
    await assert.rejects(listAssignedWorkForEmployee({ pool }, await actorOf(tech), { employeeId: "e-tech", family: "WORK_ORDER" }), (e) => e.code === "CAPABILITY_REQUIRED");
    await assert.rejects(listAssignedWorkForEmployee({ pool }, await actorOf(adminP), { employeeId: "e-tech", family: "REORDER_REQUEST" }),
      (e) => e.code === "OUTSIDE_OPERATIONAL_SCOPE" || e.code === "CAPABILITY_REQUIRED");
    await assert.rejects(listAssignedWorkForEmployee({ pool }, await actorOf(adminP), { employeeId: "e-tech", family: "TRUCK" }), (e) => e.code === "FAMILY_INVALID");
  });

  await t.test("ROLES: a Security Role's holders carry their Employee; the role carries its id for assignment", async () => {
    const d = await admin("getSecurityRoleDetail", { roleKey: "technician" });
    assert.ok(d.data.roleId);
    assert.deepEqual(d.data.holders.map((h) => h.employeeId), ["e-tech"]);
  });

  await t.test("BASELINE: the recorded activation decisions replay exactly the 12 governed nonprod grants, idempotently", async () => {
    const { recordedActivationOperations, CATALOG_REORDER_ACTIVATION_GRANTS, SELF_SCHEDULING_ACTIVATION_GRANTS } = require("../lib/adminPolicy/recordedActivationDecisionsDelta.js");
    const ops = recordedActivationOperations();
    assert.equal(ops.length, 12);
    assert.equal(CATALOG_REORDER_ACTIVATION_GRANTS.length + SELF_SCHEDULING_ACTIVATION_GRANTS.length, 12);
    for (const { operation, input } of ops) assert.equal((await admin(operation, input)).ok, true, JSON.stringify(input));
    const held = async (role, cap) => (await q(`SELECT 1 FROM eos_policy.role_capabilities rc JOIN eos_policy.roles r ON r.id=rc.role_id AND r.key=$2 JOIN eos_policy.capabilities c ON c.id=rc.capability_id AND c.key=$3 WHERE rc.tenant_id=$1`, [TENANT, role, cap])).length === 1;
    for (const d of [...CATALOG_REORDER_ACTIVATION_GRANTS, ...SELF_SCHEDULING_ACTIVATION_GRANTS]) assert.ok(await held(d.roleKey, d.capabilityKey), `${d.roleKey} ${d.capabilityKey}`);
    const before = (await q(`SELECT count(*)::int n FROM eos_policy.role_capabilities WHERE tenant_id=$1`, [TENANT]))[0].n;
    for (const { operation, input } of ops) assert.equal((await admin(operation, input)).ok, true);
    assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.role_capabilities WHERE tenant_id=$1`, [TENANT]))[0].n, before, "a replay adds nothing");
    for (const d of [...CATALOG_REORDER_ACTIVATION_GRANTS, ...SELF_SCHEDULING_ACTIVATION_GRANTS]) assert.notEqual(d.roleKey, "admin", "the delta never widens admin");
  });

  await t.test("TRUCKS: the truck view names its CURRENT technicians from MOBILE scope", async () => {
    await q(`INSERT INTO eos_ops.mobile_locations (tenant_id, location_type, location_id, operating_company_key, display_label, active, created_by, updated_by) VALUES ($1,'MOBILE','truck-01','taylor','Truck 01',true,'f','f')`, [TENANT]);
    await q(`INSERT INTO eos_ops.warehouses (id, tenant_id, name, status, operating_company_id, created_by, updated_by) VALUES ('wh-1',$1,'Main','ACTIVE','taylor','f','f') ON CONFLICT DO NOTHING`, [TENANT]).catch(() => {});
    await q(`INSERT INTO eos_ops.trucks (tenant_id, truck_id, vehicle_number, display_label, status, active, home_warehouse_id, mobile_location_type, mobile_location_id, created_by, updated_by)
             VALUES ($1,'svc-01','T-101','Service Truck 01','ACTIVE',true,'wh-1','MOBILE','truck-01','f','f')`, [TENANT]);
    await q(`INSERT INTO eos_workforce.employee_operational_scopes (id, tenant_id, employee_id, scope_type, scope_id, effective_from, assigned_by, reason) VALUES ('os-1',$1,'e-tech','MOBILE','truck-01',now(),'f','fixture')`, [TENANT]);
    const [v] = await listTruckViews(pool, TENANT);
    assert.deepEqual([v.scopedEmployeeIds, v.scopedEmployeeNames], [["e-tech"], ["Sofia Tech"]]);
  });
});
