// FUNCTIONAL ROLE x WORKFLOW -- offline proofs (no database). The PostgreSQL half is functionalRolePostgres.test.mjs.
//
// A Functional Role is an Employee's business responsibility. In a workflow a FUNCTIONAL_ROLE binding NARROWS:
//
//   allowed <=> SECURITY_ROLE binding (as before) AND effective authority over the action's capability (the same
//               evaluator) AND (no FUNCTIONAL_ROLE binding OR the linked Employee currently holds one of them)
//
//   1. the four cases: role+capability allowed; role without capability refused; capability without role refused
//      when the action has a FUNCTIONAL_ROLE binding; no FUNCTIONAL_ROLE binding -> decision unchanged
//   2. fail closed: no facts, unreadable facts, no Employee link; a FUNCTIONAL_ROLE-only binding never widens;
//      the legacy uid decision refuses a FUNCTIONAL_ROLE-bound action
//   3. drafts: an unknown Functional Role key REFUSES the save (dropping a narrowing binding would widen); publish
//      validation codes UNKNOWN_FUNCTIONAL_ROLE / INACTIVE_FUNCTIONAL_ROLE; the version view names the keys
//   4. responsibilities: source names the Functional Role rule; a held Functional Role with no Security Role
//      binding is listed as conferring nothing
import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryPolicyRepository } from "../lib/adminPolicy/inMemoryPolicyRepository.js";
import { createWorkflowDraft } from "../lib/adminPolicy/workflowCommands.js";
import { publishWorkflowVersion, validateStoredWorkflowVersion } from "../lib/adminPolicy/workflowLifecycle.js";
import { readWorkflowVersionView } from "../lib/adminPolicy/workflowAdminApi.js";
import { authorizeWorkflowAction, decideWorkflowAction } from "../lib/adminPolicy/workflowEngine.js";
import { validateWorkflowDefinition, WORKFLOW_VALIDATION_ERROR_CODES } from "../lib/adminPolicy/workflowValidation.js";
import { deriveWorkflowResponsibilities } from "../lib/adminPolicy/workflowResponsibilities.js";
import { grantCapabilities, registerWorkflowCatalog, grantWorkflowAdministration, createObjects } from "./fixtures/workflowControlPlaneFixtures.mjs";

// ════════════════════ 1 + 2. the runtime rule ════════════════════

const definition = (bindings) => ({
  versionId: "v1",
  steps: [{ key: "A", initial: true, terminal: false }, { key: "Z", initial: false, terminal: true }],
  actions: [{ key: "go", fromStepKey: "A", toStepKey: "Z", requiresOwnAssignment: false, capabilityKey: "workOrder.transition", guardKind: null }],
  bindings,
});
const INSTANCE = { id: "i1", workflowVersionId: "v1", objectKey: "workOrder", recordId: "wo-1", currentStepKey: "A" };
const SR = { actionKey: "go", roleId: "r-disp", functionalRoleId: null, bindingKind: "SECURITY_ROLE" };
const FR = { actionKey: "go", roleId: null, functionalRoleId: "fr-warranty", bindingKind: "FUNCTIONAL_ROLE" };
const authority = (allowed) => ({ async authorize() { return { allowed, outcome: allowed ? "ALLOWED" : "CAPABILITY_MISSING" }; } });
const facts = (employeeId, functionalRoleIds) => ({ async currentFunctionalRoles() { return { employeeId, functionalRoleIds }; } });
const attempt = (roleIds, auth, functionalRoles) => ({ tenantId: "t", principalId: "p", roleIds, recordId: "wo-1", authority: auth, functionalRoles });
const decide = (bindings, a) => authorizeWorkflowAction(definition(bindings), INSTANCE, "go", a);

test("case 1: Security Role binding + capability + Functional Role held -> ALLOWED", async () => {
  const d = await decide([SR, FR], attempt(["r-disp"], authority(true), facts("e-1", ["fr-warranty"])));
  assert.deepEqual([d.allowed, d.outcome], [true, "ALLOWED"]);
});

test("case 2: Functional Role held WITHOUT the capability -> refused (a Functional Role never grants)", async () => {
  const d = await decide([SR, FR], attempt(["r-disp"], authority(false), facts("e-1", ["fr-warranty"])));
  assert.deepEqual([d.allowed, d.refusal, d.outcome], [false, "effectiveAuthorityDenied", "CAPABILITY_MISSING"]);
  // ...and with no Security Role binding matched at all, holding the Functional Role is still nothing.
  const unbound = await decide([SR, FR], attempt(["r-other"], authority(true), facts("e-1", ["fr-warranty"])));
  assert.equal(unbound.refusal, "notBoundToRole");
});

test("case 3: capability + Security Role WITHOUT the Functional Role, on an action with a FUNCTIONAL_ROLE binding -> refused", async () => {
  const d = await decide([SR, FR], attempt(["r-disp"], authority(true), facts("e-1", ["fr-other"])));
  assert.deepEqual([d.allowed, d.refusal, d.outcome], [false, "functionalRoleRequired", "FUNCTIONAL_ROLE_REQUIRED"]);
  const none = await decide([SR, FR], attempt(["r-disp"], authority(true), facts("e-1", [])));
  assert.equal(none.refusal, "functionalRoleRequired");
});

test("case 4: no FUNCTIONAL_ROLE binding -> the decision is exactly the pre-existing rule, and the facts are never read", async () => {
  let reads = 0;
  const counting = { async currentFunctionalRoles() { reads += 1; throw new Error("must not be consulted"); } };
  for (const [roleIds, allowed, expected] of [
    [["r-disp"], true, [true, undefined]],
    [["r-disp"], false, [false, "effectiveAuthorityDenied"]],
    [["r-other"], true, [false, "notBoundToRole"]],
  ]) {
    const withFacts = await decide([SR], attempt(roleIds, authority(allowed), counting));
    const without = await decide([SR], attempt(roleIds, authority(allowed), undefined));
    assert.deepEqual([withFacts.allowed, withFacts.refusal], expected);
    assert.deepEqual([without.allowed, without.refusal], expected, "identical with and without Functional Role facts");
  }
  assert.equal(reads, 0);
});

test("fail closed: no facts composed, unreadable facts, and no linked Employee all refuse", async () => {
  assert.equal((await decide([SR, FR], attempt(["r-disp"], authority(true), undefined))).refusal, "functionalRoleFactsUnavailable");
  const broken = { async currentFunctionalRoles() { throw new Error("db down"); } };
  assert.equal((await decide([SR, FR], attempt(["r-disp"], authority(true), broken))).refusal, "functionalRoleFactsUnavailable");
  const unlinked = await decide([SR, FR], attempt(["r-disp"], authority(true), facts(null, ["fr-warranty"])));
  assert.deepEqual([unlinked.refusal, unlinked.outcome], ["employeeLinkRequired", "EMPLOYEE_LINK_REQUIRED"]);
});

test("a FUNCTIONAL_ROLE-only binding NEVER widens: holder + capability, but no Security Role binding -> refused", async () => {
  const d = await decide([FR], attempt(["r-disp"], authority(true), facts("e-1", ["fr-warranty"])));
  assert.equal(d.refusal, "notBoundToRole");
});

test("the legacy uid-shaped decision cannot prove a Functional Role and refuses a FUNCTIONAL_ROLE-bound action", () => {
  const legacy = { tenantId: "t", actorUid: "p", roleIds: ["r-disp"], assigneeUid: null };
  assert.equal(decideWorkflowAction(definition([SR]), INSTANCE, "go", legacy).allowed, true);
  assert.equal(decideWorkflowAction(definition([SR, FR]), INSTANCE, "go", legacy).refusal, "functionalRoleRequired");
});

// ════════════════════ 3. drafts, the version view and publish validation ════════════════════

const TENANT = "t-fr";
async function world() {
  const repo = new InMemoryPolicyRepository();
  registerWorkflowCatalog(repo, ["workOrder.transition"]);
  await repo.transact({ tenantId: TENANT, uid: "fixture" }, async (tx) => {
    await tx.createTenant({ key: TENANT, name: TENANT });
    await tx.createRole({ key: "wfAdmin", name: "Workflow Administrator", description: null, origin: "CUSTOM", protected: false });
    await tx.createRole({ key: "dispatcher", name: "Dispatcher", description: null, origin: "CUSTOM", protected: false });
  });
  const roles = Object.fromEntries((await repo.listRoles(TENANT)).map((r) => [r.key, r]));
  await grantWorkflowAdministration(repo, TENANT, roles.wfAdmin.id);
  await grantCapabilities(repo, TENANT, [{ roleId: roles.dispatcher.id, capabilityKey: "workOrder.transition" }]);
  await createObjects(repo, TENANT, ["workOrder"]);
  const warranty = repo.putFunctionalRole({ tenantId: TENANT, key: "warranty-desk", name: "Warranty desk", status: "ACTIVE" });
  const actor = { tenantId: TENANT, uid: "prn-wf", heldRoleKeys: ["wfAdmin"] };
  return { repo, roles, warranty, actor };
}
const DEF = (functionalRoleKeys) => ({
  steps: [{ key: "A", label: "A", initial: true }, { key: "Z", label: "Z", terminal: true }],
  actions: [{ key: "go", label: "Go", from: "A", to: "Z", capabilityKey: "workOrder.transition", roleKeys: ["dispatcher"], functionalRoleKeys }],
});

test("a draft naming an UNKNOWN Functional Role is REFUSED, never saved without the narrowing binding", async () => {
  const w = await world();
  await assert.rejects(
    createWorkflowDraft(w.repo, w.actor, { key: "woFr", name: "WO", objectKey: "workOrder", definition: DEF(["no-such-duty"]), reason: "proof" }),
    /UNKNOWN_FUNCTIONAL_ROLE: no-such-duty/);
  assert.deepEqual(await w.repo.listWorkflows(TENANT), [], "nothing was written");
});

test("a draft with a known Functional Role stores a FUNCTIONAL_ROLE binding; the view names it; INACTIVE refuses publish", async () => {
  const w = await world();
  const draft = await createWorkflowDraft(w.repo, w.actor, { key: "woFr", name: "WO", objectKey: "workOrder", definition: DEF(["warranty-desk"]), reason: "proof" });
  assert.equal(draft.functionalBindingCount, 1);
  const bindings = await w.repo.listWorkflowRoleBindings(TENANT, draft.version.id);
  assert.deepEqual(bindings.map((b) => [b.bindingKind, b.roleId === null, b.functionalRoleId]).sort(),
    [["FUNCTIONAL_ROLE", true, w.warranty.id], ["SECURITY_ROLE", false, null]]);
  const view = await readWorkflowVersionView(w.repo, w.actor, draft.version.id);
  assert.deepEqual(view.actions[0].roleKeys, ["dispatcher"]);
  assert.deepEqual(view.actions[0].functionalRoleKeys, ["warranty-desk"]);
  const ok = await validateStoredWorkflowVersion(w.repo, w.actor, draft.version.id);
  assert.deepEqual(ok.errors.map((e) => e.code), [], "an ACTIVE Functional Role binding validates");

  w.repo.putFunctionalRole({ ...w.warranty, status: "INACTIVE" });
  const bad = await validateStoredWorkflowVersion(w.repo, w.actor, draft.version.id);
  assert.deepEqual(bad.errors.map((e) => e.code), ["INACTIVE_FUNCTIONAL_ROLE"]);
  await assert.rejects(publishWorkflowVersion(w.repo, w.actor, { versionId: draft.version.id, reason: "publish" }),
    (err) => err.code === "WORKFLOW_VALIDATION_FAILED" && err.issues.some((i) => i.code === "INACTIVE_FUNCTIONAL_ROLE"));
  w.repo.putFunctionalRole({ ...w.warranty, status: "ACTIVE" });
  const published = await publishWorkflowVersion(w.repo, w.actor, { versionId: draft.version.id, reason: "publish" });
  assert.equal(published.status, "PUBLISHED");
});

test("the store refuses a binding whose target does not match its kind, or a foreign-tenant Functional Role", async () => {
  const w = await world();
  const draft = await createWorkflowDraft(w.repo, w.actor, { key: "woFr", name: "WO", objectKey: "workOrder", definition: DEF([]), reason: "proof" });
  const other = w.repo.putFunctionalRole({ tenantId: "t-other", key: "warranty-desk", name: "Warranty desk", status: "ACTIVE" });
  await assert.rejects(w.repo.transact({ tenantId: TENANT, uid: "x" }, (tx) => tx.createWorkflowRoleBinding({
    workflowVersionId: draft.version.id, actionKey: "go", roleId: null, functionalRoleId: other.id, bindingKind: "FUNCTIONAL_ROLE" })), /functional role not found/);
  await assert.rejects(w.repo.transact({ tenantId: TENANT, uid: "x" }, (tx) => tx.createWorkflowRoleBinding({
    workflowVersionId: draft.version.id, actionKey: "go", roleId: w.roles.dispatcher.id, functionalRoleId: w.warranty.id, bindingKind: "FUNCTIONAL_ROLE" })), /Functional Role only/);
});

test("publish validation: UNKNOWN_FUNCTIONAL_ROLE and INACTIVE_FUNCTIONAL_ROLE are error codes; SECURITY_ROLE rules unchanged", () => {
  assert.ok(WORKFLOW_VALIDATION_ERROR_CODES.includes("UNKNOWN_FUNCTIONAL_ROLE"));
  assert.ok(WORKFLOW_VALIDATION_ERROR_CODES.includes("INACTIVE_FUNCTIONAL_ROLE"));
  const context = {
    objectKeys: new Set(["workOrder"]),
    capabilities: new Map([["workOrder.transition", { superseded: false }]]),
    roleKeys: new Set(["dispatcher"]),
    roleCapabilities: new Map([["dispatcher", new Set(["workOrder.transition"])]]),
    functionalRoles: new Map([["warranty-desk", { status: "ACTIVE" }]]),
  };
  const view = (bindings) => ({
    objectKey: "workOrder",
    steps: [{ key: "A", initial: true, terminal: false }, { key: "Z", initial: false, terminal: true }],
    actions: [{ key: "go", from: "A", to: "Z", capabilityKey: "workOrder.transition", guardKind: null }],
    bindings,
  });
  const sr = { actionKey: "go", roleKey: "dispatcher", roleRef: "dispatcher", bindingKind: "SECURITY_ROLE" };
  const fr = (key) => ({ actionKey: "go", roleKey: null, roleRef: key, bindingKind: "FUNCTIONAL_ROLE", functionalRoleKey: context.functionalRoles.has(key) ? key : null });
  assert.equal(validateWorkflowDefinition(view([sr, fr("warranty-desk")]), context).valid, true);
  assert.deepEqual(validateWorkflowDefinition(view([sr, fr("nope")]), context).errors.map((e) => e.code), ["UNKNOWN_FUNCTIONAL_ROLE"]);
  // A FUNCTIONAL_ROLE binding never needs (or checks) a capability of its own: it grants nothing.
  assert.equal(validateWorkflowDefinition(view([sr, fr("warranty-desk")]), context).errors.some((e) => e.code === "BINDING_WITHOUT_CAPABILITY"), false);
  // A Functional-Role-only action is INERT (no Security Role bound), reported as such.
  const onlyFr = validateWorkflowDefinition(view([fr("warranty-desk")]), context);
  assert.ok(onlyFr.warnings.some((x) => x.code === "ACTION_WITHOUT_BINDING"));
});

// ════════════════════ 4. responsibilities ════════════════════

test("responsibilities: source names the Functional Role rule; a held Functional Role alone confers nothing", () => {
  const active = [{
    workflow: { id: "w1", key: "wo", name: "WO", objectKey: "workOrder" },
    version: { id: "v1", version: 1 },
    definition: {
      versionId: "v1", steps: [],
      actions: [
        { key: "go", label: "Go", fromStepKey: "A", toStepKey: "Z", requiresOwnAssignment: false, capabilityKey: "workOrder.transition", guardKind: null },
        { key: "plain", label: "Plain", fromStepKey: "A", toStepKey: "Z", requiresOwnAssignment: false, capabilityKey: "workOrder.transition", guardKind: null },
        { key: "other", label: "Other", fromStepKey: "A", toStepKey: "Z", requiresOwnAssignment: false, capabilityKey: "workOrder.transition", guardKind: null },
      ],
      bindings: [SR, FR, { ...SR, actionKey: "plain" }, { ...FR, actionKey: "other" }],
    },
    roleKeyById: new Map([["r-disp", "dispatcher"]]),
    functionalRoleKeyById: new Map([["fr-warranty", "warranty-desk"]]),
  }];
  const explained = (functionalRoles) => ({
    securityRoleKeys: ["dispatcher"],
    actions: [{ capabilityKey: "workOrder.transition", result: "ALLOWED", reasonCode: "ALLOWED" }],
    employeeFacts: { functionalRoles },
  });
  const holding = deriveWorkflowResponsibilities("p", active, explained([{ functionalRoleId: "fr-warranty", key: "warranty-desk" }]));
  const byKey = (list) => Object.fromEntries(list.map((r) => [r.actionKey, r]));
  const r = byKey(holding.responsibilities);
  assert.equal(r.go.source, "WORKFLOW_BINDING_FUNCTIONAL_ROLE_AND_EFFECTIVE_AUTHORITY");
  assert.deepEqual([r.go.requiredFunctionalRoles, r.go.viaFunctionalRoles], [["warranty-desk"], ["warranty-desk"]]);
  assert.equal(r.plain.source, "WORKFLOW_BINDING_AND_EFFECTIVE_AUTHORITY");
  const nothing = byKey(holding.boundWithoutAuthority);
  assert.deepEqual([nothing.other.source, nothing.other.reasonCode], ["FUNCTIONAL_ROLE_BINDING_ONLY", "SECURITY_ROLE_BINDING_REQUIRED"]);

  const lacking = deriveWorkflowResponsibilities("p", active, explained([]));
  assert.deepEqual(Object.keys(byKey(lacking.responsibilities)), ["plain"]);
  assert.equal(byKey(lacking.boundWithoutAuthority).go.reasonCode, "FUNCTIONAL_ROLE_REQUIRED");
});

test("lane SC composition: the record's businessContext reaches the capability decision BEFORE the Functional Role narrowing", async () => {
  const seen = [];
  const scopedAuthority = { async authorize(req) { seen.push(req.businessContext); const ok = req.businessContext?.operatingCompanyId === "taylor";
    return { allowed: ok, outcome: ok ? "ALLOWED" : "OUTSIDE_ASSIGNMENT_SCOPE" }; } };
  let factReads = 0;
  const counted = { async currentFunctionalRoles() { factReads += 1; return { employeeId: "e-1", functionalRoleIds: ["fr-warranty"] }; } };
  const run = (ctx) => decide([SR, FR], { ...attempt(["r-disp"], scopedAuthority, counted), businessContext: ctx });
  const outside = await run({ operatingCompanyId: "ventana" });
  assert.deepEqual([outside.refusal, outside.outcome, factReads], ["effectiveAuthorityDenied", "OUTSIDE_ASSIGNMENT_SCOPE", 0], "scope refuses first; FR never read");
  assert.equal((await run({ operatingCompanyId: "taylor" })).allowed, true);
  assert.equal(factReads, 1);
  assert.deepEqual(seen, [{ operatingCompanyId: "ventana" }, { operatingCompanyId: "taylor" }]);
});
