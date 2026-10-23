// ACCESS EXPLAINED (Option A piece 3) -- the eleven-gate chain for one person, against a real PostgreSQL.
//
// Proves: the read is the SAME authority as explainEffectiveAccess (admin.principalAccess.read) and a non-admin is refused;
// the gates come back in order, the first refusal stops the chain, and each gate that can be checked fails for the reason it
// should (sign-in, principal, employment, company, object, record access); an overview names no failure for a healthy
// person; nothing is written; and the proposal's layer names ride in the payload but are marked not approved.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { serviceBaselineTenant } from "./support/serviceBaselineTenant.mjs";

const require = createRequire(import.meta.url);
const { executeAdminOperation } = require("../lib/adminPolicy/adminPolicyApi.js");
const { explainAccessGates } = require("../lib/eosOps/accessGatesExplanation.js");
const { applyWorkflowSeed } = require("../lib/adminPolicy/applyWorkflowSeed.js");
const { WORK_ORDER_WORKFLOW } = require("../lib/adminPolicy/workflowSeeds.js");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const TENANT = "t-gates";
const PREFIX = "exp_gates";
const ORDER = ["signIn", "principal", "employment", "company", "activation", "door", "object", "field", "record", "process", "system"];

test("Access explained, in PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { q, repo, pool, person, admin } = await serviceBaselineTenant(t, { urlBase: URL_BASE, tenant: TENANT, prefix: PREFIX });
  const ADMIN_SUBJECT = `uid-${PREFIX}-admin`;

  // The sign-in read is injected exactly as the dispatcher injects the login administration handler.
  const signIn = {};
  const loginAdministration = async (_op, _actor, input) => signIn[input.principalId] ?? {
    account: { status: "active", lockedUntil: null, mfaRequired: false, mfaEnrolled: false, failedAttempts: 0 }, eosIdentity: { kind: "login" },
  };
  const DEPS = { repo, loginAdministration,
    explainAccessGates: (tenantId, principalId, question, readSignIn) => explainAccessGates(repo, pool, { tenantId, principalId, question, readSignIn }) };
  const as = (subject, input) => executeAdminOperation(DEPS,
    { caller: { externalSubject: subject, identityProvider: "firebase" }, operation: "explainAccessGates", input, requestId: `r-${randomUUID()}` });
  const explain = async (who, question) => {
    const r = await as(ADMIN_SUBJECT, { principalId: who.principalId, ...(question ? { question } : {}) });
    assert.equal(r.ok, true, JSON.stringify(r).slice(0, 500));
    return r.data;
  };
  const gate = (data, key) => data.gates.find((g) => g.key === key);
  const statuses = (data) => Object.fromEntries(data.gates.map((g) => [g.key, g.status]));

  const healthy = await person("uid-healthy", ["dispatcher"], { id: "e-healthy", name: "Hal Healthy" });
  const bare = await person("uid-bare", ["dispatcher"], { id: "e-bare", name: "Bea Bare" });
  const locked = await person("uid-locked", ["dispatcher"], { id: "e-locked", name: "Lou Locked" });
  const disabled = await person("uid-disabled", ["dispatcher"], { id: "e-disabled", name: "Dee Disabled" });
  const gone = await person("uid-gone", ["dispatcher"], { id: "e-gone", name: "Gus Gone", status: "TERMINATED" });
  const leave = await person("uid-leave", ["dispatcher"], { id: "e-leave", name: "Lee Leave", status: "ON_LEAVE" });
  signIn[locked.principalId] = { account: { status: "active", lockedUntil: "2099-01-01T00:00:00.000Z", mfaRequired: false, mfaEnrolled: false, failedAttempts: 5 }, eosIdentity: { kind: "login" } };
  await q(`UPDATE eos_policy.principals SET status = 'disabled' WHERE id = $1`, [disabled.principalId]);

  await t.test("1. SAME AUTHORITY: a non-admin is refused, a missing principal is not found, and nothing is returned", async () => {
    const refused = await as(bare.subject, { principalId: healthy.principalId });
    assert.equal(refused.ok, false);
    assert.equal(refused.code, "FORBIDDEN");
    assert.equal("data" in refused, false);
    // Including when the person asked about is themselves.
    assert.equal((await as(healthy.subject, { principalId: healthy.principalId })).code, "FORBIDDEN");
    assert.equal((await as(ADMIN_SUBJECT, { principalId: "prn-nobody" })).code, "NOT_FOUND");
    assert.equal((await as(ADMIN_SUBJECT, {})).code, "INVALID_INPUT");
  });

  await t.test("2. an overview of a healthy person: eleven gates in order, no failure, layer names shipped but not approved", async () => {
    const data = await explain(healthy);
    assert.deepEqual(data.gates.map((g) => g.key), ORDER);
    assert.deepEqual(data.gates.map((g) => g.step), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    assert.equal(data.verdict, "OVERVIEW");
    assert.equal(data.firstFailure, null);
    const s = statuses(data);
    for (const k of ["signIn", "principal", "employment", "company", "door"]) assert.equal(s[k], "PASS", k);
    for (const k of ["object", "field", "record", "process", "system"]) assert.equal(s[k], "NOT_EVALUATED", k);
    assert.equal(data.layerNamesApproved, false);
    assert.ok(data.gates.every((g) => typeof g.proposedLayer === "string"));
    assert.ok(gate(data, "signIn").settings.some((x) => x.id === "1.1"));
    assert.ok(gate(data, "employment").settings.some((x) => x.id === "2.1" && x.value === "ACTIVE"));
    assert.ok(data.options.actions.length > 10 && data.options.surfaces.length > 5, "the picker vocabulary rides with the overview");
  });

  await t.test("3. gate 1 Sign-in: a locked account blocks, in plain words, and every later gate is not evaluated", async () => {
    const data = await explain(locked);
    assert.equal(data.verdict, "BLOCKED");
    assert.equal(data.firstFailure.key, "signIn");
    assert.match(data.firstFailure.text, /^Blocked at: Sign-in\. .*locked until 2099/);
    assert.equal(gate(data, "signIn").status, "FAIL");
    for (const g of data.gates.slice(1)) assert.equal(g.status, "NOT_EVALUATED", g.key);
  });

  await t.test("4. gate 2 Principal and tenant: a disabled principal blocks here, not at a later gate", async () => {
    const data = await explain(disabled);
    assert.equal(data.firstFailure.key, "principal");
    assert.match(data.firstFailure.text, /^Blocked at: Principal and tenant\. The principal is disabled/);
    assert.equal(gate(data, "employment").status, "NOT_EVALUATED");
  });

  await t.test("5. gate 3 Employment: Terminated and On Leave block even though the Role assignment is untouched", async () => {
    for (const [who, status] of [[gone, "TERMINATED"], [leave, "ON_LEAVE"]]) {
      const data = await explain(who);
      assert.equal(data.firstFailure.key, "employment", status);
      assert.match(data.firstFailure.text, new RegExp(`^Blocked at: Employment eligibility\\. .*${status}`));
      assert.equal(gate(data, "principal").status, "PASS");
      assert.equal(gate(data, "company").status, "NOT_EVALUATED");
    }
    const roles = (await q(`SELECT count(*)::int n FROM eos_policy.user_role_assignments WHERE principal_id = $1 AND status = 'active'`, [gone.principalId])).rows[0].n;
    assert.ok(roles > 0, "the assignment is still there; the gate, not a revoke, is what blocks");
  });

  await t.test("6. gate 4 Company: a record in a company outside the person's reach blocks", async () => {
    const data = await explain(healthy, { capabilityKey: "workOrder.transition", businessContext: { operatingCompanyId: "ventana" } });
    assert.equal(data.verdict, "BLOCKED");
    assert.equal(data.firstFailure.key, "company");
    assert.match(data.firstFailure.text, /Their company reach is taylor; this record belongs to ventana/);
    assert.equal(gate(data, "object").status, "NOT_EVALUATED");
    // An explicit company-access grant moves exactly this gate, and the gate names the grant that did it.
    const cross = await person("uid-cross", ["dispatcher"], { id: "e-cross", name: "Cy Cross" });
    const granted = await admin("grantCompanyAuthority", { employeeId: "e-cross", operatingCompanyId: "ventana", reason: "gates test" });
    assert.equal(granted.ok, true, JSON.stringify(granted).slice(0, 300));
    const reach = await explain(cross, { capabilityKey: "workOrder.transition", businessContext: { operatingCompanyId: "ventana" } });
    assert.equal(gate(reach, "company").status, "PASS");
    assert.deepEqual(gate(reach, "company").settings.find((x) => x.id === "3.3").value, "ventana");
  });

  await t.test("7. gate 7 Object: an action no role grants blocks at Object, with the roles named", async () => {
    const data = await explain(healthy, { capabilityKey: "admin.securityPolicy.write" });
    assert.equal(data.question.kind, "ACTION");
    assert.equal(data.firstFailure.key, "object");
    assert.match(data.firstFailure.text, /^Blocked at: Object\. None of their Security Roles \(dispatcher\)/);
    assert.equal(gate(data, "door").status !== "FAIL", true, "a door is never the security boundary");
    for (const k of ["field", "record", "process", "system"]) assert.equal(gate(data, k).status, "NOT_EVALUATED", k);
  });

  await t.test("8. an action the person holds passes Object; Activation and Field are honestly NOT_COVERED", async () => {
    const held = (await q(`SELECT c.key FROM eos_policy.role_capabilities rc JOIN eos_policy.roles r ON r.id = rc.role_id AND r.tenant_id = rc.tenant_id
                             JOIN eos_policy.capabilities c ON c.id = rc.capability_id
                            WHERE rc.tenant_id = $1 AND r.key = 'dispatcher' AND c.key NOT LIKE 'admin.%' ORDER BY c.key LIMIT 1`, [TENANT])).rows[0].key;
    const data = await explain(healthy, { capabilityKey: held });
    assert.equal(gate(data, "object").status, "PASS", held);
    assert.equal(gate(data, "activation").status, "NOT_COVERED");
    assert.equal(gate(data, "field").status, "NOT_COVERED");
    assert.equal(data.firstFailure, null);
    assert.ok(["ALLOWED", "NEEDS_RECORD"].includes(data.verdict), data.verdict);
  });

  await t.test("9. a page question: Door fails for a page the person is not offered, and says what it needs", async () => {
    const offered = (await explain(healthy)).options.surfaces.map((s) => s.key);
    const adminPage = offered.find((k) => k.startsWith("administration."));
    assert.ok(adminPage, "the catalog offers an administration page");
    const data = await explain(healthy, { surfaceKey: adminPage });
    assert.equal(data.question.kind, "PAGE");
    assert.equal(data.firstFailure.key, "door");
    assert.match(data.firstFailure.text, /^Blocked at: Door\. .* needs /);
  });

  await t.test("10. gate 9 Record access: a channel-scoped holder is blocked outside the channel, admitted inside it", async () => {
    for (const ch of ["RETAIL", "NATIONAL_ACCOUNTS"]) {
      await q(`INSERT INTO eos_policy.tenant_sales_channels (tenant_id, sales_channel, status, source, established_by, updated_by) VALUES ($1,$2,'ACTIVE','f','f','f')`, [TENANT, ch]);
    }
    const reader = (await q(`SELECT r.key FROM eos_policy.role_capabilities rc JOIN eos_policy.roles r ON r.id = rc.role_id AND r.tenant_id = rc.tenant_id
                               JOIN eos_policy.capabilities c ON c.id = rc.capability_id WHERE rc.tenant_id = $1 AND c.key = 'opportunity.read'
                                AND NOT EXISTS (SELECT 1 FROM eos_policy.role_capabilities x JOIN eos_policy.capabilities xc ON xc.id = x.capability_id
                                                 WHERE x.tenant_id = rc.tenant_id AND x.role_id = rc.role_id
                                                   AND (xc.key LIKE 'admin.%' OR xc.key LIKE 'audit.%' OR xc.key LIKE 'workflowDefinition.%'))
                              ORDER BY r.key LIMIT 1`, [TENANT])).rows[0]?.key;
    assert.ok(reader, "some role grants opportunity.read");
    const seller = await person("uid-seller", [], { id: "e-seller", name: "Sal Seller" });
    const roleId = (await repo.getRoleByKey(TENANT, reader)).id;
    const assigned = await admin("assignRole", { principalId: seller.principalId, roleId, scopeType: "salesChannel", scopeValue: "RETAIL", reason: "gates test" });
    assert.equal(assigned.ok, true, JSON.stringify(assigned).slice(0, 300));
    const outside = await explain(seller, { capabilityKey: "opportunity.read", businessContext: { salesChannel: "NATIONAL_ACCOUNTS" } });
    assert.equal(outside.firstFailure.key, "record");
    assert.match(outside.firstFailure.text, /^Blocked at: Record access\. They are scoped to sales channel RETAIL; this record is in NATIONAL_ACCOUNTS\./);
    assert.equal(gate(outside, "object").status, "PASS");
    const inside = await explain(seller, { capabilityKey: "opportunity.read", businessContext: { salesChannel: "RETAIL" } });
    assert.equal(gate(inside, "record").status, "PASS");
    assert.equal(inside.firstFailure, null);
    const undecided = await explain(seller, { capabilityKey: "opportunity.read" });
    assert.equal(gate(undecided, "record").status, "NOT_EVALUATED");
    assert.equal(undecided.verdict, "NEEDS_RECORD");
  });

  await t.test("10b. gate 10 Process: a bound role can move the step; a role that holds the key but is not bound is blocked here", async () => {
    // A Workflow Administrator (the Pass 8 bootstrap path) applies and publishes the Work Order seed.
    const made = await admin("createRole", { key: "workflowAdministrator", name: "Workflow Administrator", reason: "gates test" });
    assert.equal(made.ok, true, made.message);
    for (const actionKey of ["create", "edit", "version", "bindRole", "publish", "read"]) {
      assert.equal((await admin("grantObjectActionToRole", { objectKey: "workflowDefinition", actionKey, roleKey: "workflowAdministrator", reason: "gates test" })).ok, true, actionKey);
    }
    const wfAdmin = await person("uid-wfadmin", []);
    assert.equal((await admin("assignRole", { principalId: wfAdmin.principalId, roleId: made.data.id, reason: "gates test" })).ok, true);
    const applied = await applyWorkflowSeed(repo, { tenantId: TENANT, uid: wfAdmin.principalId, heldRoleKeys: ["workflowAdministrator"] }, WORK_ORDER_WORKFLOW);
    const published = await executeAdminOperation({ repo }, { caller: { externalSubject: wfAdmin.subject, identityProvider: "firebase" },
      operation: "publishWorkflowVersion", input: { versionId: applied.version.id, reason: "gates test" }, requestId: "r-pub" });
    assert.equal(published.ok, true, published.message);
    const dispatchCap = WORK_ORDER_WORKFLOW.actions.find((a) => a.key === "Dispatch").capabilityId;
    assert.equal(typeof dispatchCap, "string");

    const bound = await explain(healthy, { capabilityKey: dispatchCap });
    assert.equal(gate(bound, "process").status, "PASS", JSON.stringify(gate(bound, "process")));
    assert.match(gate(bound, "process").summary, /Can move: .*Dispatch/);

    const fm = await person("uid-fieldmgr", ["fieldManager"], { id: "e-fm", name: "Fran Field" });
    const unbound = await explain(fm, { capabilityKey: dispatchCap });
    assert.equal(gate(unbound, "object").status, "PASS", "fieldManager holds the key");
    assert.equal(unbound.firstFailure.key, "process");
    assert.match(unbound.firstFailure.text, /^Blocked at: Process\. .*Dispatch.* none of their roles \(fieldManager\) is bound/);
    assert.equal(gate(unbound, "system").status, "NOT_EVALUATED");
    // An action no published step uses is simply not a process question.
    assert.equal(gate(await explain(healthy, { capabilityKey: "customer.record.read" }), "process").status, "NOT_APPLICABLE");
  });

  await t.test("11. an unknown action, page or shape is refused as INVALID_INPUT, never ignored", async () => {
    for (const question of [{ capabilityKey: "no.such.key" }, { surfaceKey: "no.such.page" }, { objectKey: "workOrder" }, "text",
      { capabilityKey: "workOrder.transition", surfaceKey: "service.workOrders" }, { businessContext: "x" }]) {
      const r = await as(ADMIN_SUBJECT, { principalId: healthy.principalId, question });
      assert.equal(r.ok, false, JSON.stringify(question));
      assert.equal(r.code, "INVALID_INPUT", JSON.stringify(question));
    }
  });

  await t.test("12. READ-ONLY: asking changes no policy row and writes no audit event", async () => {
    const digest = async () => (await q(`SELECT (SELECT count(*) FROM eos_policy.audit_events)::int a, (SELECT count(*) FROM eos_policy.user_role_assignments)::int r,
                                                (SELECT count(*) FROM eos_policy.role_capabilities)::int c, (SELECT count(*) FROM eos_policy.principal_capabilities)::int p`)).rows[0];
    const before = await digest();
    await explain(healthy);
    await explain(healthy, { capabilityKey: "workOrder.transition" });
    await explain(locked);
    assert.deepEqual(await digest(), before);
  });

  await t.test("13. without EOS login composed, sign-in is NOT_COVERED, not guessed", async () => {
    const r = await executeAdminOperation({ repo, explainAccessGates: DEPS.explainAccessGates },
      { caller: { externalSubject: ADMIN_SUBJECT, identityProvider: "firebase" }, operation: "explainAccessGates", input: { principalId: healthy.principalId }, requestId: "r-x" });
    assert.equal(r.ok, true);
    assert.equal(r.data.gates[0].status, "NOT_COVERED");
    assert.equal(r.data.firstFailure, null);
  });
});
