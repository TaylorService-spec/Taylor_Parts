// W01 HOLDER LOOKUP -- listWorkflowActionRoleHolders over PostgreSQL (2026-10-09).
//
// The Employees holding ONE Security Role relevant to ONE workflow action, for the people who can change assignments:
//   AUTHORIZATION  workflowDefinition.read AND (workflowDefinition.edit OR .version); a reader alone, or nobody, is refused.
//   RELEVANCE      only a Role ELIGIBLE for (holds the action's capability) or BOUND to that action; anything else refused.
//   HOLDERS        ACTIVE and NON-STALE assignments only; revoked and stale ones are not holders.
//   APPLIES        global, or a scope that DECIDES the action's capability (salesChannel for salesOrder.write); an
//                  operatingCompany-scoped holder holds the Role but the action does NOT apply to them.
//   VISIBILITY     the EXISTING Employee visibility (employee.record.read: flat = every Employee, operatingCompany scope =
//                  that company only, none = nobody). Others are COUNTED as withheld, never named. Unknown -> refused.
//   SHAPE          display name, Employee id, scope, appliesToAction -- no principal ids, roles or capabilities.
//   LIMIT          200, with an accurate `truncated`.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { serviceBaselineTenant } from "./support/serviceBaselineTenant.mjs";

const require = createRequire(import.meta.url);
const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const T = "t-wf-holders";
const REASON = "W01 holder lookup proof";

test("listWorkflowActionRoleHolders: authorization, relevance, holders, scope, visibility, shape, limit", { skip: SKIP, concurrency: false }, async (t) => {
  const { q, repo, admin, person, pool } = await serviceBaselineTenant(t, { urlBase: URL_BASE, tenant: T, prefix: "wfh" });
  const { executeAdminOperation } = require("../lib/adminPolicy/adminPolicyApi.js");
  const { createWorkflowHolderVisibility } = require("../lib/eosAdministration/workflowHolderVisibility.js");
  const visibility = createWorkflowHolderVisibility(repo, pool);
  const as = (who, operation, input, deps = { workflowHolderVisibility: visibility }) => executeAdminOperation({ repo, ...deps },
    { caller: { externalSubject: who.subject, identityProvider: "firebase" }, operation, input, requestId: `r-${randomUUID()}` });
  const ok = (r, what = "") => { assert.equal(r.ok, true, `${what} ${r.code} ${r.message}`); return r.data; };
  const roleId = async (key) => (await repo.getRoleByKey(T, key)).id;
  const auditCount = async () => Number((await q(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE tenant_id=$1`, [T])).rows[0].n);
  const role = async (key, grants) => {
    ok(await admin("createRole", { key, name: key, reason: REASON }), `createRole ${key}`);
    for (const [objectKey, actionKey] of grants) ok(await admin("grantObjectActionToRole", { objectKey, actionKey, roleKey: key, reason: REASON }), `${key} ${objectKey}.${actionKey}`);
  };
  await q(`INSERT INTO eos_policy.tenant_sales_channels (tenant_id,sales_channel,status,source,established_by,updated_by)
           VALUES ($1,'RETAIL','ACTIVE','fixture','fixture','fixture') ON CONFLICT DO NOTHING`, [T]);

  // ── Roles: the assigner, a reader, the target Role (eligible: holds salesOrder.write), a bulk Role, an Employee reader ──
  await role("wfAssigner", [["workflowDefinition", "read"], ["workflowDefinition", "edit"], ["workflowDefinition", "version"]]);
  await role("wfReader", [["workflowDefinition", "read"]]);
  await role("wfTarget", [["salesOrder", "edit"]]);
  await role("wfBulk", [["salesOrder", "edit"]]);
  await role("companyStaffReader", [["employee", "read"]]);
  const capability = (await repo.listCapabilities()).find((c) => c.objectKey === "salesOrder" && c.actionKey === "edit").key;
  assert.equal(capability, "salesOrder.write");

  // ── Callers ──
  const seer = await person("uid-wfh-seer", ["wfAssigner", "generalManager"], { id: "e-seer", name: "Sam Seer" });   // flat employee.record.read
  const scopedSeer = await person("uid-wfh-scoped", ["wfAssigner"], { id: "e-scoped", name: "Sky Scoped" });
  ok(await admin("assignRole", { principalId: scopedSeer.principalId, roleId: await roleId("companyStaffReader"), scopeType: "operatingCompany", scopeValue: "taylor", reason: REASON }));
  const blind = await person("uid-wfh-blind", ["wfAssigner"], { id: "e-blind", name: "Bo Blind" });               // no employee read
  const reader = await person("uid-wfh-reader", ["wfReader", "generalManager"], { id: "e-reader", name: "Rae Reader" });
  const nobody = await person("uid-wfh-nobody", [], { id: "e-nobody", name: "Nia Nobody" });

  // ── Holders of wfTarget ──
  const h1 = await person("uid-wfh-h1", ["wfTarget"], { id: "e-h1", name: "Avery Taylor", company: "taylor" });
  const h2 = await person("uid-wfh-h2", ["wfTarget"], { id: "e-h2", name: "Blake Ventana", company: "ventana" });
  const h3 = await person("uid-wfh-h3", [], { id: "e-h3", name: "Casey Retail", company: "taylor" });
  ok(await admin("assignRole", { principalId: h3.principalId, roleId: await roleId("wfTarget"), scopeType: "salesChannel", scopeValue: "RETAIL", reason: REASON }));
  const h4 = await person("uid-wfh-h4", [], { id: "e-h4", name: "Drew Company", company: "taylor" });
  // An operatingCompany scope cannot decide salesOrder.write: a historical (inert) assignment, written directly as a fixture.
  await q(`INSERT INTO eos_policy.user_role_assignments (id,tenant_id,principal_id,role_id,scope_type,scope_value,status,granted_by,access_version_at_grant,created_by,updated_by)
           VALUES ($1,$2,$3,$4,'operatingCompany','taylor','active','fixture',0,'fixture','fixture')`, [`ura-${randomUUID()}`, T, h4.principalId, await roleId("wfTarget")]);
  const h5 = await person("uid-wfh-h5", ["wfTarget"], { id: "e-h5", name: "Eden Stale", company: "taylor" });
  await q(`UPDATE eos_policy.user_role_assignments SET access_version_at_grant = 99999 WHERE tenant_id=$1 AND principal_id=$2`, [T, h5.principalId]);
  const h6 = await person("uid-wfh-h6", ["wfTarget"], { id: "e-h6", name: "Finn Revoked", company: "taylor" });
  const h6a = (await repo.listAssignmentsForPrincipal(T, h6.principalId)).find((a) => a.status === "active");
  ok(await admin("revokeRole", { assignmentId: h6a.id, reason: REASON }));
  const h7 = await person("uid-wfh-h7", ["wfTarget"]); // a Principal with no Employee

  // ── The workflow: map the first Sales Order action to salesOrder.write; bind wfTarget (eligible) and dispatcher (not) ──
  const so = (await repo.listWorkflows(T)).find((w) => w.key === "salesOrder");
  const v1 = (await repo.listWorkflowVersions(T, so.id)).at(-1);
  const view = ok(await as(seer, "readWorkflowVersion", { versionId: v1.id }));
  const [first, ...rest] = view.actions;
  const definition = {
    steps: view.steps,
    actions: [{ ...first, capabilityKey: capability, roleKeys: ["wfTarget", "wfBulk", "dispatcher"], functionalRoleKeys: [] },
      ...rest.map((a) => ({ ...a, functionalRoleKeys: a.functionalRoleKeys ?? [] }))],
  };
  const saved = ok(await as(seer, "updateWorkflowDefinition", { versionId: v1.id, definition, reason: REASON }), "map the action");
  const versionId = saved.version.id;
  const actionKey = first.key;
  const lookup = (who, roleKey, extra = {}, deps) => as(who, "listWorkflowActionRoleHolders", { versionId, actionKey, roleKey, ...extra }, deps);

  await t.test("AUTHORIZATION: an assigner may; a reader alone, or nobody, is refused", async () => {
    ok(await lookup(seer, "wfTarget"));
    const r = await lookup(reader, "wfTarget");
    assert.equal(r.code, "FORBIDDEN");
    assert.match(r.message, /WORKFLOW_ASSIGNMENT_CAPABILITY_REQUIRED/);
    assert.equal((await lookup(nobody, "wfTarget")).code, "FORBIDDEN");
  });

  await t.test("RELEVANCE: only a Role eligible for or bound to the action; unknown action / extra input refused", async () => {
    const bound = ok(await lookup(seer, "dispatcher"));
    assert.deepEqual([bound.roleEligible, bound.roleBound, bound.holdersForAction], [false, true, 0], "bound but not eligible: nobody can act");
    const r = await lookup(seer, "technician");
    assert.equal(r.code, "INVALID_INPUT");
    assert.match(r.message, /ROLE_NOT_FOR_ACTION/);
    assert.equal((await as(seer, "listWorkflowActionRoleHolders", { versionId, actionKey: "noSuchAction", roleKey: "wfTarget" })).code, "NOT_FOUND");
    assert.equal((await lookup(seer, "wfTarget", { principalId: h1.principalId })).code, "INVALID_INPUT");
    assert.equal((await as(seer, "listWorkflowActionRoleHolders", { versionId: randomUUID(), actionKey, roleKey: "wfTarget" })).code, "NOT_FOUND");
  });

  await t.test("HOLDERS, SCOPE and COUNTS: active non-stale only; scope decides appliesToAction", async () => {
    const before = await auditCount();
    const r = ok(await lookup(seer, "wfTarget"));
    assert.deepEqual(Object.keys(r).sort(), ["actionKey", "employeeVisibility", "holders", "holdersForAction", "roleBound", "roleEligible",
      "roleKey", "roleName", "totalHolders", "truncated", "withheld"]);
    assert.deepEqual([r.roleEligible, r.roleBound], [true, true]);
    // h1 h2 (global), h3 (salesChannel), h4 (operatingCompany, inert), h7 (no Employee). NOT h5 (stale) or h6 (revoked).
    assert.equal(r.totalHolders, 5);
    assert.equal(r.holdersForAction, 4, "h4's scope cannot decide salesOrder.write");
    assert.equal(r.withheld, 1, "h7 is not an Employee: counted, never named");
    assert.equal(r.employeeVisibility, "EMPLOYEE_READ");
    assert.equal(r.truncated, false);
    assert.deepEqual(r.holders, [
      { displayName: "Avery Taylor", employeeId: "e-h1", scope: { type: "global", value: null }, appliesToAction: true },
      { displayName: "Blake Ventana", employeeId: "e-h2", scope: { type: "global", value: null }, appliesToAction: true },
      { displayName: "Casey Retail", employeeId: "e-h3", scope: { type: "salesChannel", value: "RETAIL" }, appliesToAction: true },
      { displayName: "Drew Company", employeeId: "e-h4", scope: { type: "operatingCompany", value: "taylor" }, appliesToAction: false },
    ]);
    const text = JSON.stringify(r);
    for (const p of [h1, h2, h3, h4, h5, h6, h7, seer]) assert.ok(!text.includes(p.principalId), "no principal id in the answer");
    assert.ok(!/Eden Stale|Finn Revoked|capabilit|uid-wfh/i.test(text.replace(/"holdersForAction"/, "")), "no stale/revoked holder, capability list or sign-in identity");
    assert.equal(await auditCount(), before, "read-only");
  });

  await t.test("VISIBILITY: the existing Employee visibility, never wider", async () => {
    const scoped = ok(await lookup(scopedSeer, "wfTarget"));
    assert.deepEqual(scoped.holders.map((h) => h.employeeId), ["e-h1", "e-h3", "e-h4"], "Taylor only: the Ventana Employee is not named");
    assert.deepEqual([scoped.totalHolders, scoped.holdersForAction, scoped.withheld], [5, 4, 2]);
    assert.ok(!JSON.stringify(scoped).includes("Blake Ventana"));
    const none = ok(await lookup(blind, "wfTarget"));
    assert.deepEqual(none.holders, []);
    assert.deepEqual([none.totalHolders, none.holdersForAction, none.withheld, none.employeeVisibility], [5, 4, 5, "NONE"]);
  });

  await t.test("FAIL CLOSED: no visibility resolver, or a failing one, refuses -- never an empty list", async () => {
    for (const deps of [{}, { workflowHolderVisibility: async () => { throw new Error("store down"); } }]) {
      const r = await lookup(seer, "wfTarget", {}, deps);
      assert.equal(r.code, "FORBIDDEN");
      assert.match(r.message, /EMPLOYEE_VISIBILITY_UNAVAILABLE/);
    }
  });

  await t.test("LIMIT: 200 named, truncated reported accurately", async () => {
    const bulkRole = await roleId("wfBulk");
    for (let i = 0; i < 201; i += 1) {
      const pid = `p-bulk-${i}`, eid = `e-bulk-${String(i).padStart(3, "0")}`;
      await q(`INSERT INTO eos_policy.principals (id,external_subject,identity_provider,display_name) VALUES ($1,$2,'firebase',$3)`, [pid, `uid-bulk-${i}`, `Bulk ${i}`]);
      await q(`INSERT INTO eos_policy.tenant_memberships (id,tenant_id,principal_id) VALUES ($1,$2,$3)`, [`m-${pid}`, T, pid]);
      await q(`INSERT INTO eos_workforce.employees (id,tenant_id,employment_status,operating_company_id,display_name) VALUES ($1,$2,'ACTIVE','taylor',$3)`, [eid, T, `Bulk ${String(i).padStart(3, "0")}`]);
      await q(`INSERT INTO eos_policy.employee_principal_links (id,tenant_id,principal_id,employee_id,operating_company_id,link_source,status,asserted_by,assertion_reason)
               VALUES ($1,$2,$3,$4,'taylor','OPERATOR_ASSERTED','active','fixture','fixture')`, [`lnk-${eid}`, T, pid, eid]);
      await q(`INSERT INTO eos_policy.user_role_assignments (id,tenant_id,principal_id,role_id,status,granted_by,access_version_at_grant,created_by,updated_by)
               VALUES ($1,$2,$3,$4,'active','fixture',0,'fixture','fixture')`, [`ura-${pid}`, T, pid, bulkRole]);
    }
    const r = ok(await lookup(seer, "wfBulk"));
    assert.deepEqual([r.totalHolders, r.holders.length, r.truncated, r.withheld], [201, 200, true, 0]);
    assert.equal(r.holders[0].displayName, "Bulk 000");
  });

  await t.test("NOTHING CHANGES: grants, workflow definitions, active versions", async () => {
    const grants = Number((await q(`SELECT count(*)::int n FROM eos_policy.role_capabilities WHERE tenant_id=$1`, [T])).rows[0].n);
    const versions = Number((await q(`SELECT count(*)::int n FROM eos_policy.workflow_versions WHERE tenant_id=$1`, [T])).rows[0].n);
    for (const who of [seer, scopedSeer, blind, reader, nobody]) await lookup(who, "wfTarget");
    assert.equal(Number((await q(`SELECT count(*)::int n FROM eos_policy.role_capabilities WHERE tenant_id=$1`, [T])).rows[0].n), grants);
    assert.equal(Number((await q(`SELECT count(*)::int n FROM eos_policy.workflow_versions WHERE tenant_id=$1`, [T])).rows[0].n), versions);
    assert.equal((await repo.listWorkflows(T)).find((w) => w.key === "salesOrder").activeVersionId, so.activeVersionId);
  });
});
