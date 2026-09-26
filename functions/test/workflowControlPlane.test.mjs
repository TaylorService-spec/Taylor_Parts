// THE WORKFLOW CONTROL PLANE -- offline proofs (no database).
//
//   1. Bootstrap: the first administrator gets workflow authority through Administration
//      (grantObjectActionToRole on workflowDefinition), never by a migration or a Role name.
//   2. Lifecycle: DRAFT -> PUBLISHED(ACTIVE) -> RETIRED; the active pointer; immutability; retire
//      refused while active or pinned.
//   3. Validation: every code, fail closed at publish.
//   4. The runtime rule: WORKFLOW_BINDING AND EFFECTIVE_AUTHORITY -- a binding never grants.
//   5. The stale operationsManager Sales Order binding is REJECTED at publish and never widens.
//   6. The Work Order seed's missing fieldManager binding is REPORTED.
//   7. Pinning, ADOPT and MIGRATE -- audited, exactly once.
//   8. Unauthorized actors, tenant isolation, audit exactly-once, verbatim refusals over the API.
//   9. Employee workflow responsibilities = bindings on held Roles INTERSECTED with effective authority.
// The PostgreSQL half is workflowControlPlanePostgres.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryPolicyRepository } from "../lib/adminPolicy/inMemoryPolicyRepository.js";
import { bootstrapTenant, bootstrapAdministrator, ensureTenantPrincipal } from "../lib/adminPolicy/tenantBootstrap.js";
import { assignRole } from "../lib/adminPolicy/policyCommands.js";
import { executeAdminOperation } from "../lib/adminPolicy/adminPolicyApi.js";
import { createWorkflowDraft, updateWorkflowDefinition } from "../lib/adminPolicy/workflowCommands.js";
import {
  activateWorkflowVersion,
  publishWorkflowVersion,
  validateStoredWorkflowVersion,
} from "../lib/adminPolicy/workflowLifecycle.js";
import {
  adoptRecordsIntoWorkflowVersion,
  migrateWorkflowInstances,
  startWorkflowInstance,
  transitionWorkflowInstance,
} from "../lib/adminPolicy/workflowInstances.js";
import {
  REQUIRED_GUARD_BY_CAPABILITY,
  WORKFLOW_VALIDATION_ERROR_CODES,
  validateWorkflowDefinition,
} from "../lib/adminPolicy/workflowValidation.js";
import { authorizeWorkflowAction, loadWorkflowVersionDefinition } from "../lib/adminPolicy/workflowEngine.js";
import { operationalWorkflowAuthority } from "../lib/adminPolicy/workflowAuthority.js";
import { WORKFLOW_MUTATION_CAPABILITY } from "../lib/adminPolicy/workflowAdministration.js";
import { deriveWorkflowResponsibilities } from "../lib/adminPolicy/workflowResponsibilities.js";
import { capabilityKeysFor } from "../lib/adminPolicy/administrationCapabilityGate.js";
import { snapshotContextualReader } from "../lib/eosOps/contextualAuthorization.js";
import { SALES_ORDER_WORKFLOW, WORK_ORDER_WORKFLOW } from "../lib/adminPolicy/workflowSeeds.js";
import { grantCapabilities, registerWorkflowCatalog } from "./fixtures/workflowControlPlaneFixtures.mjs";

const OPERATOR = "operator-wf";
const REASON = "workflow control plane proof";

/** The measured nonprod baseline holders of the capabilities the Sales Order and Work Order seeds name. */
const BASELINE = Object.freeze({
  "salesOrder.write": ["admin", "dispatcher", "generalManager", "owner", "salesManager", "salesperson"],
  "workOrder.transition": ["admin", "dispatcher", "fieldManager", "generalManager", "operationsManager", "owner",
    "partsAssociate", "partsManager", "shopAssociate", "shopManager", "technician"],
  "workOrder.lifecycle.dispatch": ["admin", "dispatcher", "fieldManager"],
  "workOrder.lifecycle.cancel": ["admin", "dispatcher", "fieldManager"],
  "workOrder.lifecycle.complete": ["technician"],
});

/** A bootstrapped tenant (seeded Roles, Objects and the five DRAFT seeds) with one administrator. */
async function world({ key = "wf-offline", repo = new InMemoryPolicyRepository(), subject = "sub-wf-admin" } = {}) {
  registerWorkflowCatalog(repo, ["admin.securityPolicy.write", "admin.roleAssignment.write",
    "admin.securityPolicy.read", "admin.principalAccess.read", "audit.event.read"]);
  const { tenant } = await bootstrapTenant(repo, { key, name: key, actorUid: OPERATOR });
  const boot = await bootstrapAdministrator(repo, {
    tenantId: tenant.id, externalSubject: subject, performedBy: OPERATOR, reason: "initial administrator",
  });
  const admin = { tenantId: tenant.id, uid: boot.principal.id, heldRoleKeys: ["admin"] };
  const roles = Object.fromEntries((await repo.listRoles(tenant.id)).map((r) => [r.key, r]));
  // `admin`/`subject` are the SECURITY administrator until workflow authority is granted, when they
  // become the workflow administrator; `secAdmin`/`secSubject` stay the security administrator.
  const w = { repo, tenantId: tenant.id, admin, secAdmin: admin, roles, subject, secSubject: subject };
  w.call = (operation, input = {}, callerSubject = w.subject, deps = {}) =>
    executeAdminOperation({ repo, ...deps }, { caller: { externalSubject: callerSubject }, operation, input, requestId: "req-wf" });
  return w;
}

/**
 * THE POST-BOOTSTRAP ADMINISTRATION ACTS, under the Pass 8 separation of duties (no principal grants a
 * capability to a Role it holds, and none assigns itself): the security administrator creates a
 * Workflow Administrator Role, grants it the workflowDefinition.* keys and assigns it to ANOTHER
 * principal -- each one audited decision. The Role name `admin` never administers workflows.
 */
async function grantWorkflowAuthorityThroughAdministration(w, roleKey = "workflowAdministrator") {
  const call = (op, input) => w.call(op, input, w.secSubject);
  if (!w.roles[roleKey]) {
    const made = await call("createRole", { key: roleKey, name: "Workflow Administrator", reason: REASON });
    assert.equal(made.ok, true, `createRole: ${made.message}`);
    w.roles[roleKey] = made.data;
  }
  for (const actionKey of ["read", "create", "edit", "version", "bindRole", "publish"]) {
    const r = await call("grantObjectActionToRole", { objectKey: "workflowDefinition", actionKey, roleKey, reason: REASON });
    assert.equal(r.ok, true, `grant workflowDefinition.${actionKey}: ${r.message}`);
  }
  const subject = `${w.secSubject}-workflow`;
  const holder = await person(w, subject, [roleKey]);
  w.admin = { tenantId: w.tenantId, uid: holder.principalId, heldRoleKeys: [roleKey] };
  w.subject = subject;
}

async function grantBaseline(w) {
  const pairs = [];
  for (const [capabilityKey, roleKeys] of Object.entries(BASELINE)) {
    for (const roleKey of roleKeys) if (w.roles[roleKey]) pairs.push({ roleId: w.roles[roleKey].id, capabilityKey });
  }
  await grantCapabilities(w.repo, w.tenantId, pairs);
}

/** A principal holding `roleKeys`, assigned through the governed command. */
async function person(w, subject, roleKeys) {
  const made = await ensureTenantPrincipal(w.repo, {
    tenantId: w.tenantId, externalSubject: subject, actorUid: OPERATOR, actorRoleKeys: ["admin"],
  });
  const principalId = made.principal?.id ?? made.id ?? made.principalId;
  for (const k of roleKeys) await assignRole(w.repo, w.secAdmin, { principalId, roleId: w.roles[k].id, reason: REASON });
  return { principalId, subject, roleKeys };
}

const auditCount = async (w) => (await w.repo.listAuditEvents(w.tenantId, 100000)).length;
const draftOf = async (w, workflowKey) => {
  const wf = (await w.repo.listWorkflows(w.tenantId)).find((x) => x.key === workflowKey);
  const versions = await w.repo.listWorkflowVersions(w.tenantId, wf.id);
  return { workflow: wf, version: versions[versions.length - 1] };
};

/** A tiny, valid, publishable workflow over workOrder with Roles that hold its capabilities. */
const TINY = (roleKeys = ["dispatcher"]) => ({
  steps: [
    { key: "OPEN", label: "Open", initial: true },
    { key: "WORKING", label: "Working" },
    { key: "DONE", label: "Done", terminal: true },
  ],
  actions: [
    { key: "start", label: "Start", from: "OPEN", to: "WORKING", capabilityKey: "workOrder.transition", roleKeys },
    { key: "finish", label: "Finish", from: "WORKING", to: "DONE", capabilityKey: "workOrder.transition", roleKeys },
  ],
});

// ════════════════════ 1. bootstrap ════════════════════

test("bootstrap: the first administrator gets workflow authority through Administration, not a migration or a Role name", async () => {
  const w = await world();
  // The bootstrapped admin holds admin.securityPolicy.write but NO workflowDefinition.* -- the Role
  // name `admin` authorizes nothing here.
  const before = await capabilityKeysFor(w.repo, w.tenantId, ["admin"], w.admin.uid);
  assert.equal([...before].some((k) => k.startsWith("workflowDefinition.")), false);
  const { version } = await draftOf(w, "salesOrder");
  const refused = await w.call("publishWorkflowVersion", { versionId: version.id, reason: REASON });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "FORBIDDEN");
  assert.equal(refused.message, 'not authorized: "workflowDefinition.publish" is required');
  const readRefused = await w.call("listWorkflows");
  assert.equal(readRefused.code, "FORBIDDEN");

  await grantWorkflowAuthorityThroughAdministration(w);
  const decisions = (await w.repo.listRoleCapabilityDecisions(w.tenantId)).filter((d) => d.capabilityKey.startsWith("workflowDefinition."));
  assert.equal(decisions.length, 6, "one audited ADMIN_GRANTED decision per workflow capability");
  assert.ok(decisions.every((d) => d.decision === "ADMIN_GRANTED" && d.roleKey === "workflowAdministrator"));
  // Pass 8 separation: the security administrator may NOT grant workflow authority to its own Role.
  const self = await w.call("grantObjectActionToRole", { objectKey: "workflowDefinition", actionKey: "publish", roleKey: "admin", reason: REASON }, w.secSubject);
  assert.match(self.message, /SELF_ADMINISTRATION/);
  const list = await w.call("listWorkflows");
  assert.equal(list.ok, true);
  assert.deepEqual(list.data.map((x) => x.workflow.key).sort(),
    ["partsPurchasing", "salesAgreement", "salesOpportunity", "salesOrder", "workOrder"]);
});

test("the gate maps every workflow mutation to exactly one registered workflowDefinition.* key", () => {
  for (const [operation, key] of Object.entries(WORKFLOW_MUTATION_CAPABILITY)) {
    assert.match(key, /^workflowDefinition\.(create|edit|version|publish|bindRole)$/, operation);
  }
  assert.equal(WORKFLOW_MUTATION_CAPABILITY.publishWorkflowVersion, "workflowDefinition.publish");
  assert.equal(WORKFLOW_MUTATION_CAPABILITY.migrateWorkflowInstances, "workflowDefinition.publish");
  assert.equal(WORKFLOW_MUTATION_CAPABILITY.setWorkflowRoleBinding, "workflowDefinition.bindRole");
});

// ════════════════════ 2. lifecycle ════════════════════

test("lifecycle: publish makes the version ACTIVE; a second publish moves the pointer; activate rolls back", async () => {
  const w = await world();
  await grantWorkflowAuthorityThroughAdministration(w);
  await grantBaseline(w);
  const v1 = await createWorkflowDraft(w.repo, w.admin, { key: "tiny", name: "Tiny", objectKey: "workOrder", definition: TINY(), reason: REASON });
  assert.equal(v1.version.status, "DRAFT");
  assert.equal((await w.repo.listWorkflows(w.tenantId)).find((x) => x.key === "tiny").activeVersionId, null);

  const p1 = await publishWorkflowVersion(w.repo, w.admin, { versionId: v1.version.id, reason: REASON });
  assert.equal(p1.status, "PUBLISHED");
  let wf = (await w.repo.listWorkflows(w.tenantId)).find((x) => x.key === "tiny");
  assert.equal(wf.activeVersionId, v1.version.id, "publish activates");

  const v2 = await updateWorkflowDefinition(w.repo, w.admin, { versionId: v1.version.id, definition: TINY(), reason: REASON })
    .catch((e) => e);
  assert.match(String(v2.message), /PUBLISHED and cannot be edited/, "a PUBLISHED version is immutable; edit a new DRAFT");
  const next = await w.call("createWorkflowVersion", { workflowId: wf.id, copyFromVersionId: v1.version.id, reason: REASON });
  assert.equal(next.ok, true, next.message);
  assert.equal(next.data.version.status, "DRAFT");
  await publishWorkflowVersion(w.repo, w.admin, { versionId: next.data.version.id, reason: REASON });
  wf = (await w.repo.listWorkflows(w.tenantId)).find((x) => x.key === "tiny");
  assert.equal(wf.activeVersionId, next.data.version.id, "the pointer moved");
  const v1After = (await w.repo.listWorkflowVersions(w.tenantId, wf.id)).find((v) => v.id === v1.version.id);
  assert.equal(v1After.status, "PUBLISHED", "the previous version stays PUBLISHED for its pinned instances");

  // Rollback.
  const rolled = await activateWorkflowVersion(w.repo, w.admin, { versionId: v1.version.id, reason: REASON });
  assert.equal(rolled.activeVersionId, v1.version.id);
  // Re-publishing a PUBLISHED version is a lifecycle refusal.
  const again = await w.call("publishWorkflowVersion", { versionId: v1.version.id, reason: REASON });
  assert.equal(again.code, "CONFLICT");
  assert.match(again.message, /^WORKFLOW_INVALID_LIFECYCLE: /);
  // Store immutability, below the command layer.
  await assert.rejects(() => w.repo.transact({ tenantId: w.tenantId, uid: "x" }, (tx) => tx.createWorkflowAction({
    workflowVersionId: v1.version.id, key: "sneak", label: "s", fromStepKey: "OPEN", toStepKey: "DONE", requiresOwnAssignment: false,
  })), /PUBLISHED and cannot be edited/);
  // A draft cannot be activated.
  const draft = await w.call("createWorkflowVersion", { workflowId: wf.id, copyFromVersionId: v1.version.id, reason: REASON });
  const notPublished = await w.call("activateWorkflowVersion", { versionId: draft.data.version.id, reason: REASON });
  assert.equal(notPublished.code, "CONFLICT");
  assert.match(notPublished.message, /only a PUBLISHED version can be active/);
});

test("retire: refused while ACTIVE, refused while PINNED, allowed once neither -- and a draft may be retired", async () => {
  const w = await world();
  await grantWorkflowAuthorityThroughAdministration(w);
  await grantBaseline(w);
  const v1 = await createWorkflowDraft(w.repo, w.admin, { key: "tiny", name: "Tiny", objectKey: "workOrder", definition: TINY(), reason: REASON });
  await publishWorkflowVersion(w.repo, w.admin, { versionId: v1.version.id, reason: REASON });
  const active = await w.call("retireWorkflowVersion", { versionId: v1.version.id, reason: REASON });
  assert.equal(active.code, "CONFLICT");
  assert.match(active.message, /^WORKFLOW_VERSION_ACTIVE: /);

  await startWorkflowInstance(w.repo, w.admin, { workflowKey: "tiny", recordId: "wo-1", reason: REASON });
  const wf = (await w.repo.listWorkflows(w.tenantId)).find((x) => x.key === "tiny");
  const v2 = await w.call("createWorkflowVersion", { workflowId: wf.id, copyFromVersionId: v1.version.id, reason: REASON });
  await publishWorkflowVersion(w.repo, w.admin, { versionId: v2.data.version.id, reason: REASON });
  const pinned = await w.call("retireWorkflowVersion", { versionId: v1.version.id, reason: REASON });
  assert.equal(pinned.code, "CONFLICT");
  assert.match(pinned.message, /^WORKFLOW_VERSION_PINNED: 1 live instance/);
  // The store refuses too, below the command.
  await assert.rejects(() => w.repo.transact({ tenantId: w.tenantId, uid: "x" }, (tx) => tx.retireWorkflowVersion(v1.version.id)),
    /WORKFLOW_VERSION_PINNED/);

  await migrateWorkflowInstances(w.repo, w.admin, {
    fromVersionId: v1.version.id, toVersionId: v2.data.version.id, stepMap: { OPEN: "OPEN" }, reason: REASON,
  });
  const retired = await w.call("retireWorkflowVersion", { versionId: v1.version.id, reason: REASON });
  assert.equal(retired.ok, true, retired.message);
  assert.equal(retired.data.status, "RETIRED");
  const noReason = await w.call("retireWorkflowVersion", { versionId: v2.data.version.id });
  assert.equal(noReason.code, "INVALID_INPUT", "a request id alone is not a reason");
  assert.match(noReason.message, /^REASON_REQUIRED/);
  // Abandon a draft.
  const draft = await w.call("createWorkflowVersion", { workflowId: wf.id, copyFromVersionId: v1.version.id, reason: REASON });
  const abandoned = await w.call("retireWorkflowVersion", { versionId: draft.data.version.id, reason: REASON });
  assert.equal(abandoned.data.status, "RETIRED");
  const cannotPublishRetired = await w.call("publishWorkflowVersion", { versionId: draft.data.version.id, reason: REASON });
  assert.match(cannotPublishRetired.message, /^WORKFLOW_INVALID_LIFECYCLE/);
});

// ════════════════════ 3. validation, every code ════════════════════

const CONTEXT = Object.freeze({
  objectKeys: new Set(["workOrder", "salesOrder"]),
  capabilities: new Map([
    ["workOrder.transition", { superseded: false }],
    ["workOrder.lifecycle.complete", { superseded: false }],
    ["reorder.request.read.queue", { superseded: true }],
  ]),
  roleKeys: new Set(["dispatcher", "technician", "fieldManager"]),
  roleCapabilities: new Map([
    ["dispatcher", new Set(["workOrder.transition"])],
    ["technician", new Set(["workOrder.transition", "workOrder.lifecycle.complete"])],
    ["fieldManager", new Set(["workOrder.transition"])],
  ]),
});
const VALID = () => ({
  objectKey: "workOrder",
  steps: [
    { key: "A", initial: true, terminal: false },
    { key: "B", initial: false, terminal: false },
    { key: "Z", initial: false, terminal: true },
  ],
  actions: [
    { key: "go", from: "A", to: "B", capabilityKey: "workOrder.transition", guardKind: null },
    { key: "end", from: "B", to: "Z", capabilityKey: "workOrder.lifecycle.complete", guardKind: "RECORD_ASSIGNMENT" },
  ],
  bindings: [
    { actionKey: "go", roleKey: "dispatcher", roleRef: "dispatcher", bindingKind: "SECURITY_ROLE" },
    { actionKey: "go", roleKey: "technician", roleRef: "technician", bindingKind: "SECURITY_ROLE" },
    { actionKey: "go", roleKey: "fieldManager", roleRef: "fieldManager", bindingKind: "SECURITY_ROLE" },
    { actionKey: "end", roleKey: "technician", roleRef: "technician", bindingKind: "SECURITY_ROLE" },
  ],
});
const codes = (def) => validateWorkflowDefinition(def, CONTEXT).errors.map((e) => e.code);

test("validation: a sound definition has no errors", () => {
  const r = validateWorkflowDefinition(VALID(), CONTEXT);
  assert.deepEqual(r.errors, []);
  assert.equal(r.valid, true);
  assert.deepEqual(REQUIRED_GUARD_BY_CAPABILITY, { "workOrder.lifecycle.complete": "RECORD_ASSIGNMENT" },
    "derived from the runtime's LIFECYCLE_CONTEXT_PREDICATES, not restated");
});

test("validation: EVERY error code is produced by the case that should produce it", () => {
  const seen = new Set();
  const expect = (code, def) => { const c = codes(def); assert.ok(c.includes(code), `${code} expected, got ${c.join(",")}`); seen.add(code); };
  const v = VALID;
  expect("NO_START_STATE", { ...v(), steps: v().steps.map((s) => ({ ...s, initial: false })) });
  expect("MULTIPLE_START_STATES", { ...v(), steps: v().steps.map((s) => (s.key === "B" ? { ...s, initial: true } : s)) });
  expect("NO_TERMINAL_STATE", { ...v(), steps: v().steps.map((s) => ({ ...s, terminal: false })) });
  expect("INVALID_TRANSITION", { ...v(), actions: [...v().actions, { key: "ghost", from: "A", to: "NOWHERE", capabilityKey: "workOrder.transition", guardKind: null }] });
  expect("UNREACHABLE_STEP", { ...v(), steps: [...v().steps, { key: "ISLAND", initial: false, terminal: true }] });
  expect("INVALID_OBJECT", { ...v(), objectKey: "notAnObject" });
  expect("ACTION_WITHOUT_CAPABILITY", { ...v(), actions: v().actions.map((a) => (a.key === "go" ? { ...a, capabilityKey: null } : a)) });
  expect("UNKNOWN_CAPABILITY", { ...v(), actions: v().actions.map((a) => (a.key === "go" ? { ...a, capabilityKey: "made.up" } : a)) });
  expect("UNKNOWN_CAPABILITY", { ...v(), actions: v().actions.map((a) => (a.key === "go" ? { ...a, capabilityKey: "reorder.request.read.queue" } : a)) });
  expect("BINDING_WITHOUT_CAPABILITY", { ...v(), bindings: [...v().bindings, { actionKey: "end", roleKey: "dispatcher", roleRef: "dispatcher", bindingKind: "SECURITY_ROLE" }] });
  expect("UNKNOWN_ROLE", { ...v(), bindings: [...v().bindings, { actionKey: "go", roleKey: null, roleRef: "role-id-gone", bindingKind: "SECURITY_ROLE" }] });
  expect("UNSUPPORTED_BINDING_KIND", { ...v(), bindings: [...v().bindings, { actionKey: "go", roleKey: "welder", roleRef: "welder", bindingKind: "FUNCTIONAL_ROLE" }] });
  expect("BINDING_UNKNOWN_ACTION", { ...v(), bindings: [...v().bindings, { actionKey: "nope", roleKey: "dispatcher", roleRef: "dispatcher", bindingKind: "SECURITY_ROLE" }] });
  expect("INVALID_GUARD", { ...v(), actions: v().actions.map((a) => (a.key === "go" ? { ...a, guardKind: "ANYTHING_GOES" } : a)) });
  expect("INVALID_GUARD", { ...v(), objectKey: "salesOrder" }); // RECORD_ASSIGNMENT has no salesOrder relation
  expect("MISSING_REQUIRED_GUARD", { ...v(), actions: v().actions.map((a) => (a.key === "end" ? { ...a, guardKind: null } : a)) });
  assert.deepEqual([...seen].sort(), [...WORKFLOW_VALIDATION_ERROR_CODES].sort(), "every error code has a proving case");
});

test("validation: warnings never block, and name the Roles that hold the capability but are not bound", () => {
  const def = VALID();
  def.bindings = def.bindings.filter((b) => b.roleKey !== "fieldManager");
  const r = validateWorkflowDefinition(def, CONTEXT);
  assert.equal(r.valid, true);
  const holder = r.warnings.find((x) => x.code === "CAPABILITY_HOLDER_NOT_BOUND" && x.actionKey === "go");
  assert.deepEqual(holder.roleKeys, ["fieldManager"]);
});

// ════════════════════ 4. the runtime rule ════════════════════

const definitionFor = (bindings, action = {}) => ({
  versionId: "v1",
  steps: [{ key: "A", initial: true, terminal: false }, { key: "Z", initial: false, terminal: true }],
  actions: [{ key: "go", fromStepKey: "A", toStepKey: "Z", requiresOwnAssignment: false, capabilityKey: "workOrder.transition", guardKind: null, ...action }],
  bindings,
});
const INSTANCE = { id: "i1", workflowVersionId: "v1", objectKey: "workOrder", recordId: "wo-1", currentStepKey: "A" };
const authority = (allowed, outcome = allowed ? "ALLOWED" : "CAPABILITY_MISSING") => ({ async authorize() { return { allowed, outcome }; } });
const attempt = (roleIds, auth) => ({ tenantId: "t", principalId: "p", roleIds, recordId: "wo-1", authority: auth });

test("runtime: decision = WORKFLOW_BINDING AND EFFECTIVE_AUTHORITY -- a binding never grants", async () => {
  const bound = definitionFor([{ actionKey: "go", roleId: "r-disp", bindingKind: "SECURITY_ROLE" }]);
  assert.equal((await authorizeWorkflowAction(bound, INSTANCE, "go", attempt(["r-disp"], authority(true)))).allowed, true, "both");
  const noAuthority = await authorizeWorkflowAction(bound, INSTANCE, "go", attempt(["r-disp"], authority(false)));
  assert.deepEqual([noAuthority.allowed, noAuthority.refusal, noAuthority.outcome], [false, "effectiveAuthorityDenied", "CAPABILITY_MISSING"],
    "bound, capability missing: NO");
  const notBound = await authorizeWorkflowAction(bound, INSTANCE, "go", attempt(["r-other"], authority(true)));
  assert.equal(notBound.refusal, "notBoundToRole", "capability without binding: NO");
  const noCap = await authorizeWorkflowAction(definitionFor(bound.bindings, { capabilityKey: null }), INSTANCE, "go", attempt(["r-disp"], authority(true)));
  assert.equal(noCap.refusal, "actionWithoutCapability");
  const functional = await authorizeWorkflowAction(
    definitionFor([...bound.bindings, { actionKey: "go", roleId: "fr", bindingKind: "FUNCTIONAL_ROLE" }]), INSTANCE, "go", attempt(["r-disp"], authority(true)));
  assert.equal(functional.refusal, "unsupportedBindingKind", "the documented extension point fails closed");
  const outage = await authorizeWorkflowAction(bound, INSTANCE, "go", attempt(["r-disp"], { async authorize() { throw new Error("db down"); } }));
  assert.deepEqual([outage.refusal, outage.outcome], ["effectiveAuthorityDenied", "CONTEXT_AUTHORITY_UNAVAILABLE"]);
});

test("runtime: the composed evaluator is authorizeOperationalAction plus the RECORD_ASSIGNMENT relation", async () => {
  const reader = { ...snapshotContextualReader({ employeeId: "emp-1", workEligibility: [], operationalScopes: [] }),
    async isAssignedEmployee(_t, kind, recordId, employeeId) { return kind === "workOrder" && recordId === "wo-mine" && employeeId === "emp-1"; } };
  const actor = (caps) => ({ tenantId: "t", principalId: "p", capabilities: new Set(caps),
    entitlements: () => caps.map((c) => ({ capabilityKey: c, grantor: { kind: "ROLE", roleKey: "technician" }, condition: null })) });
  const holder = operationalWorkflowAuthority(reader, actor(["workOrder.lifecycle.complete"]), "workOrder");
  assert.deepEqual(await holder.authorize({ capabilityKey: "workOrder.lifecycle.complete", recordId: "wo-mine", guardKind: "RECORD_ASSIGNMENT" }), { allowed: true, outcome: "ALLOWED" });
  assert.deepEqual(await holder.authorize({ capabilityKey: "workOrder.lifecycle.complete", recordId: "wo-theirs", guardKind: "RECORD_ASSIGNMENT" }), { allowed: false, outcome: "NOT_ASSIGNED" });
  const lacking = operationalWorkflowAuthority(reader, actor([]), "workOrder");
  assert.equal((await lacking.authorize({ capabilityKey: "workOrder.lifecycle.complete", recordId: "wo-mine", guardKind: null })).outcome, "CAPABILITY_MISSING");
  const salesGuard = operationalWorkflowAuthority(reader, actor(["salesOrder.write"]), "salesOrder");
  assert.equal((await salesGuard.authorize({ capabilityKey: "salesOrder.write", recordId: "so-1", guardKind: "RECORD_ASSIGNMENT" })).outcome, "GUARD_NOT_EVALUABLE");
});

test("runtime (Pass 8): a CONDITIONED-ONLY capability is decided by the entitled path, never the flat set", async () => {
  const assigned = new Set(["wo-mine"]);
  const reader = { ...snapshotContextualReader({ employeeId: "emp-1", workEligibility: [], operationalScopes: [] }),
    async isAssignedEmployee(_t, kind, recordId, employeeId) { return kind === "workOrder" && assigned.has(recordId) && employeeId === "emp-1"; } };
  const condition = { paths: [[{ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" }]], recordKind: "workOrder" };
  // The flat set does NOT carry the key (the resolver withholds conditioned-only keys); conditionallyHeld does.
  const actor = { tenantId: "t", principalId: "p", capabilities: new Set(), conditionallyHeld: new Set(["workOrder.record.read"]),
    entitlements: () => [{ capabilityKey: "workOrder.record.read", grantor: { kind: "ROLE", roleKey: "technician" }, condition }] };
  const authority = operationalWorkflowAuthority(reader, actor, "workOrder");
  assert.deepEqual(await authority.authorize({ capabilityKey: "workOrder.record.read", recordId: "wo-mine", guardKind: null }), { allowed: true, outcome: "ALLOWED" });
  assert.deepEqual(await authority.authorize({ capabilityKey: "workOrder.record.read", recordId: "wo-mine", guardKind: "RECORD_ASSIGNMENT" }), { allowed: true, outcome: "ALLOWED" },
    "the guard is evaluated over the ADMITTED key, not re-checked against the flat set");
  assert.equal((await authority.authorize({ capabilityKey: "workOrder.record.read", recordId: "wo-other", guardKind: null })).allowed, false,
    "the condition narrows: another record is refused");
  const flatOnly = operationalWorkflowAuthority(reader, { ...actor, conditionallyHeld: undefined }, "workOrder");
  assert.equal((await flatOnly.authorize({ capabilityKey: "workOrder.record.read", recordId: "wo-mine", guardKind: null })).outcome, "CAPABILITY_MISSING",
    "without the conditioned path nothing reaches the key -- the flat set never admits it");
});

// ════════════════════ 5. the stale operationsManager Sales Order binding ════════════════════

test("STALE BINDING: operationsManager on Sales Order is REJECTED at publish and never widens Sales Order authority", async () => {
  const w = await world();
  await grantWorkflowAuthorityThroughAdministration(w);
  await grantBaseline(w);
  const grantsBefore = (await w.repo.listRoleCapabilities(w.tenantId)).length;
  const opsBefore = await capabilityKeysFor(w.repo, w.tenantId, ["operationsManager"], null);
  assert.equal(opsBefore.has("salesOrder.write"), false, "the baseline grants operationsManager no Sales Order capability");

  const { version } = await draftOf(w, "salesOrder"); // the seeded DRAFT: binds operationsManager (workflowSeeds.ts)
  const refused = await w.call("publishWorkflowVersion", { versionId: version.id, reason: REASON });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "INVALID_INPUT");
  assert.match(refused.message, /^WORKFLOW_VALIDATION_FAILED: workflow version cannot be published: /);
  const validation = await w.call("validateWorkflowVersion", { versionId: version.id });
  const stale = validation.data.errors.filter((e) => e.code === "BINDING_WITHOUT_CAPABILITY");
  assert.deepEqual(stale.map((e) => `${e.roleKey}/${e.actionKey}/${e.capabilityKey}`).sort(), [
    "operationsManager/beginFulfillment/salesOrder.write",
    "operationsManager/close/salesOrder.write",
    "operationsManager/markFulfilled/salesOrder.write",
  ]);
  assert.equal(validation.data.errors.length, 3, "and nothing else is wrong with the seed");

  // Nothing widened: no grant written, operationsManager still lacks the capability, nothing active.
  assert.equal((await w.repo.listRoleCapabilities(w.tenantId)).length, grantsBefore);
  assert.equal((await capabilityKeysFor(w.repo, w.tenantId, ["operationsManager"], null)).has("salesOrder.write"), false);
  assert.equal((await w.repo.listWorkflows(w.tenantId)).find((x) => x.key === "salesOrder").activeVersionId, null);

  // The resolution the Owner ruled: remove the binding on a new DRAFT (never auto-grant). It publishes.
  const cleaned = {
    steps: SALES_ORDER_WORKFLOW.steps,
    actions: SALES_ORDER_WORKFLOW.actions.map((a) => ({ ...a, roleKeys: a.roleKeys.filter((k) => k !== "operationsManager") })),
  };
  const next = await w.call("updateWorkflowDefinition", { versionId: version.id, definition: cleaned, reason: "remove stale binding" });
  assert.equal(next.ok, true, next.message);
  const published = await w.call("publishWorkflowVersion", { versionId: next.data.version.id, reason: REASON });
  assert.equal(published.ok, true, published.message);

  // And even a version that DID carry the binding (written below the command layer) confers nothing:
  // the runtime rule asks the evaluator, which refuses the capability.
  const forced = await w.repo.transact({ tenantId: w.tenantId, uid: "x" }, async (tx) => {
    const wf = (await w.repo.listWorkflows(w.tenantId)).find((x) => x.key === "salesOrder");
    const v = await tx.createWorkflowVersion({ workflowId: wf.id, version: 99, status: "DRAFT", publishedAt: null, publishedBy: null });
    await tx.createWorkflowStep({ workflowVersionId: v.id, key: "CONFIRMED", label: "c", initial: true, terminal: false });
    await tx.createWorkflowStep({ workflowVersionId: v.id, key: "CLOSED", label: "x", initial: false, terminal: true });
    await tx.createWorkflowAction({ workflowVersionId: v.id, key: "go", label: "go", fromStepKey: "CONFIRMED", toStepKey: "CLOSED", requiresOwnAssignment: false, capabilityKey: "salesOrder.write" });
    await tx.createWorkflowRoleBinding({ workflowVersionId: v.id, actionKey: "go", roleId: w.roles.operationsManager.id });
    return tx.publishWorkflowVersion(v.id);
  });
  const definition = await loadWorkflowVersionDefinition(w.repo, w.tenantId, forced.id);
  const opsCaps = await capabilityKeysFor(w.repo, w.tenantId, ["operationsManager"], null);
  const decision = await authorizeWorkflowAction(definition,
    { id: "i", workflowVersionId: forced.id, objectKey: "salesOrder", recordId: "so-1", currentStepKey: "CONFIRMED" }, "go", {
      tenantId: w.tenantId, principalId: "ops", roleIds: [w.roles.operationsManager.id], recordId: "so-1",
      authority: operationalWorkflowAuthority(snapshotContextualReader({ employeeId: null, workEligibility: [], operationalScopes: [] }),
        { tenantId: w.tenantId, principalId: "ops", capabilities: opsCaps, entitlements: () => [] }, "salesOrder"),
    });
  assert.deepEqual([decision.allowed, decision.refusal, decision.outcome], [false, "effectiveAuthorityDenied", "CAPABILITY_MISSING"]);
});

test("WORK ORDER SEED FINDING: fieldManager holds dispatch/cancel/transition but the seed binds only admin/dispatcher/technician", async () => {
  const w = await world();
  await grantWorkflowAuthorityThroughAdministration(w);
  await grantBaseline(w);
  const { version } = await draftOf(w, "workOrder");
  const r = await validateStoredWorkflowVersion(w.repo, w.admin, version.id);
  assert.deepEqual(r.errors, [], "with the nonprod baseline grants the Work Order seed is publishable");
  const fieldManagerGaps = r.warnings
    .filter((x) => x.code === "CAPABILITY_HOLDER_NOT_BOUND" && x.roleKeys.includes("fieldManager"))
    .map((x) => x.actionKey).sort();
  assert.ok(fieldManagerGaps.includes("Dispatch"), "fieldManager is not bound to Dispatch");
  assert.ok(fieldManagerGaps.includes("CancelFromCreated"), "fieldManager is not bound to any Cancel");
  assert.equal(fieldManagerGaps.filter((k) => k.startsWith("CancelFrom")).length, 8);
  // Complete requires the RECORD_ASSIGNMENT guard, and the seed carries it.
  const view = await w.call("readWorkflowVersion", { versionId: version.id });
  const complete = view.data.actions.find((a) => a.key === "Complete");
  assert.deepEqual([complete.capabilityKey, complete.guardKind], ["workOrder.lifecycle.complete", "RECORD_ASSIGNMENT"]);
  assert.deepEqual(WORK_ORDER_WORKFLOW.actions.find((a) => a.key === "Dispatch").roleKeys, ["admin", "dispatcher"]);
});

// ════════════════════ 7. pinning, ADOPT, MIGRATE ════════════════════

test("pinning: an instance is judged by ITS version; publishing a new version does not affect it", async () => {
  const w = await world();
  await grantWorkflowAuthorityThroughAdministration(w);
  await grantBaseline(w);
  const v1 = await createWorkflowDraft(w.repo, w.admin, { key: "tiny", name: "Tiny", objectKey: "workOrder", definition: TINY(["dispatcher"]), reason: REASON });
  await publishWorkflowVersion(w.repo, w.admin, { versionId: v1.version.id, reason: REASON });
  const inst = await startWorkflowInstance(w.repo, w.admin, { workflowKey: "tiny", recordId: "wo-1", reason: REASON });
  assert.equal(inst.workflowVersionId, v1.version.id);
  assert.equal(inst.currentStepKey, "OPEN");

  // v2 rebinds everything to technician only, and becomes ACTIVE.
  const wf = (await w.repo.listWorkflows(w.tenantId)).find((x) => x.key === "tiny");
  const v2 = await w.call("createWorkflowVersion", { workflowId: wf.id, definition: TINY(["technician"]), reason: REASON });
  await publishWorkflowVersion(w.repo, w.admin, { versionId: v2.data.version.id, reason: REASON });
  assert.equal((await w.repo.getWorkflowInstance(w.tenantId, "workOrder", "wo-1")).workflowVersionId, v1.version.id, "unaffected");

  const allow = { async authorize() { return { allowed: true, outcome: "ALLOWED" }; } };
  const dispatcher = { tenantId: w.tenantId, principalId: "p-d", heldRoleKeys: ["dispatcher"] };
  const technician = { tenantId: w.tenantId, principalId: "p-t", heldRoleKeys: ["technician"] };
  // The PINNED v1 binds dispatcher -- so dispatcher may act on wo-1 even though v2 does not bind it.
  const moved = await transitionWorkflowInstance(w.repo, dispatcher, { objectKey: "workOrder", recordId: "wo-1", actionKey: "start" }, allow);
  assert.equal(moved.instance.currentStepKey, "WORKING");
  await assert.rejects(() => transitionWorkflowInstance(w.repo, technician, { objectKey: "workOrder", recordId: "wo-1", actionKey: "finish" }, allow),
    /WORKFLOW_ACTION_REFUSED: finish refused: notBoundToRole/);
  // A NEW record starts on the ACTIVE v2.
  const inst2 = await startWorkflowInstance(w.repo, w.admin, { workflowKey: "tiny", recordId: "wo-2", reason: REASON });
  assert.equal(inst2.workflowVersionId, v2.data.version.id);
  // Duplicates and missing active versions are refused.
  await assert.rejects(() => startWorkflowInstance(w.repo, w.admin, { workflowKey: "tiny", recordId: "wo-2", reason: REASON }), /WORKFLOW_INSTANCE_EXISTS/);
  await assert.rejects(() => startWorkflowInstance(w.repo, w.admin, { workflowKey: "salesOrder", recordId: "so-1", reason: REASON }), /WORKFLOW_NO_ACTIVE_VERSION/);
  const events = await w.repo.listWorkflowInstanceEvents(w.tenantId, inst.id);
  assert.deepEqual(events.map((e) => e.eventKind), ["START", "TRANSITION"]);
  assert.equal(events[1].actorPrincipalId, "p-d");
});

test("ADOPT and MIGRATE: explicit, validated, ONE audit event each, one instance event per record naming it", async () => {
  const w = await world();
  await grantWorkflowAuthorityThroughAdministration(w);
  await grantBaseline(w);
  const v1 = await createWorkflowDraft(w.repo, w.admin, { key: "tiny", name: "Tiny", objectKey: "workOrder", definition: TINY(), reason: REASON });
  await publishWorkflowVersion(w.repo, w.admin, { versionId: v1.version.id, reason: REASON });

  const before = await auditCount(w);
  const adopted = await w.call("adoptRecordsIntoWorkflowVersion", {
    versionId: v1.version.id, records: [{ recordId: "legacy-1", stepKey: "WORKING" }, { recordId: "legacy-2", stepKey: "DONE" }], reason: "adopt copied records",
  });
  assert.equal(adopted.ok, true, adopted.message);
  assert.equal(await auditCount(w), before + 1, "ONE audit event for the adoption");
  const auditEvent = (await w.repo.listAuditEvents(w.tenantId, 1))[0];
  assert.equal(auditEvent.action, "adoptRecordsIntoWorkflowVersion");
  assert.equal(auditEvent.targetId, v1.version.id);
  assert.equal(auditEvent.actorUid, w.admin.uid);
  assert.match(auditEvent.reason, /^adopt copied records \[request req-wf\]$/);
  assert.deepEqual(auditEvent.after.records, [{ recordId: "legacy-1", stepKey: "WORKING" }, { recordId: "legacy-2", stepKey: "DONE" }]);
  for (const inst of adopted.data.instances) {
    const [event] = await w.repo.listWorkflowInstanceEvents(w.tenantId, inst.id);
    assert.deepEqual([event.eventKind, event.auditEventId], ["ADOPT", adopted.data.auditEventId]);
  }
  const dup = await w.call("adoptRecordsIntoWorkflowVersion", { versionId: v1.version.id, records: [{ recordId: "legacy-1", stepKey: "OPEN" }], reason: REASON });
  assert.match(dup.message, /^WORKFLOW_INSTANCE_EXISTS/);
  const badStep = await w.call("adoptRecordsIntoWorkflowVersion", { versionId: v1.version.id, records: [{ recordId: "legacy-9", stepKey: "NOPE" }], reason: REASON });
  assert.equal(badStep.code, "INVALID_INPUT");
  assert.match(badStep.message, /^WORKFLOW_STEP_MAP_INVALID/);

  // v2 renames WORKING -> IN_PROGRESS.
  const wf = (await w.repo.listWorkflows(w.tenantId)).find((x) => x.key === "tiny");
  const renamed = TINY();
  renamed.steps = renamed.steps.map((s) => (s.key === "WORKING" ? { ...s, key: "IN_PROGRESS" } : s));
  renamed.actions = renamed.actions.map((a) => ({ ...a, from: a.from === "WORKING" ? "IN_PROGRESS" : a.from, to: a.to === "WORKING" ? "IN_PROGRESS" : a.to }));
  const v2 = await w.call("createWorkflowVersion", { workflowId: wf.id, definition: renamed, reason: REASON });
  await publishWorkflowVersion(w.repo, w.admin, { versionId: v2.data.version.id, reason: REASON });

  const incomplete = await w.call("migrateWorkflowInstances", {
    fromVersionId: v1.version.id, toVersionId: v2.data.version.id, stepMap: { WORKING: "IN_PROGRESS" }, reason: REASON,
  });
  assert.equal(incomplete.code, "INVALID_INPUT");
  assert.match(incomplete.message, /^WORKFLOW_STEP_MAP_INCOMPLETE: .*DONE/);
  const invalid = await w.call("migrateWorkflowInstances", {
    fromVersionId: v1.version.id, toVersionId: v2.data.version.id, stepMap: { WORKING: "WORKING", DONE: "DONE" }, reason: REASON,
  });
  assert.match(invalid.message, /^WORKFLOW_STEP_MAP_INVALID/);

  const mid = await auditCount(w);
  const migrated = await w.call("migrateWorkflowInstances", {
    fromVersionId: v1.version.id, toVersionId: v2.data.version.id, stepMap: { WORKING: "IN_PROGRESS", DONE: "DONE" }, reason: "rename step",
  });
  assert.equal(migrated.ok, true, migrated.message);
  assert.equal(await auditCount(w), mid + 1, "ONE audit event for the migration");
  const moved = await w.repo.getWorkflowInstance(w.tenantId, "workOrder", "legacy-1");
  assert.deepEqual([moved.workflowVersionId, moved.currentStepKey], [v2.data.version.id, "IN_PROGRESS"]);
  const events = await w.repo.listWorkflowInstanceEvents(w.tenantId, moved.id);
  const last = events[events.length - 1];
  assert.deepEqual([last.eventKind, last.fromStepKey, last.toStepKey, last.fromVersionId, last.toVersionId, last.auditEventId],
    ["MIGRATE", "WORKING", "IN_PROGRESS", v1.version.id, v2.data.version.id, migrated.data.auditEventId]);
  // Nothing left to move writes NOTHING.
  const noop = await w.call("migrateWorkflowInstances", {
    fromVersionId: v1.version.id, toVersionId: v2.data.version.id, stepMap: {}, reason: REASON,
  });
  assert.equal(noop.data.auditEventId, null);
  assert.equal(await auditCount(w), mid + 1);
});

// ════════════════════ 8. authorization, isolation, audit, API ════════════════════

test("UNAUTHORIZED: every workflow mutation is refused without its capability -- the Role name `admin` is not enough", async () => {
  const w = await world();
  await grantBaseline(w);
  const tech = await person(w, "sub-tech", ["technician"]);
  const { version, workflow } = await draftOf(w, "workOrder");
  const attempts = {
    createWorkflowDraft: { key: "x", name: "x", objectKey: "workOrder", definition: TINY(), reason: REASON },
    createWorkflowVersion: { workflowId: workflow.id, copyFromVersionId: version.id, reason: REASON },
    updateWorkflowDefinition: { versionId: version.id, definition: TINY(), reason: REASON },
    setWorkflowRoleBinding: { versionId: version.id, actionKey: "MarkReady", roleId: w.roles.fieldManager.id, reason: REASON },
    publishWorkflowVersion: { versionId: version.id, reason: REASON },
    activateWorkflowVersion: { versionId: version.id, reason: REASON },
    retireWorkflowVersion: { versionId: version.id, reason: REASON },
    startWorkflowInstance: { workflowKey: "workOrder", recordId: "wo-1", reason: REASON },
    adoptRecordsIntoWorkflowVersion: { versionId: version.id, records: [{ recordId: "r", stepKey: "CREATED" }], reason: REASON },
    migrateWorkflowInstances: { fromVersionId: version.id, toVersionId: version.id, stepMap: {}, reason: REASON },
  };
  const before = await auditCount(w);
  for (const subject of [w.subject, tech.subject]) {
    for (const [operation, input] of Object.entries(attempts)) {
      const r = await w.call(operation, input, subject);
      assert.equal(r.code, "FORBIDDEN", `${subject} ${operation}: ${r.message}`);
      assert.equal(r.message, `not authorized: "${WORKFLOW_MUTATION_CAPABILITY[operation]}" is required`);
    }
  }
  assert.equal(await auditCount(w), before, "a refused mutation writes nothing");

  // A DIRECT Principal grant authorizes exactly the mapped operation: capability, never Role name.
  const direct = await w.call("grantObjectActionToPrincipal", { objectKey: "workflowDefinition", actionKey: "create", principalId: tech.principalId, reason: REASON });
  assert.equal(direct.ok, true, direct.message);
  const created = await w.call("createWorkflowDraft", attempts.createWorkflowDraft, tech.subject);
  assert.equal(created.ok, true, created.message);
  const stillNoPublish = await w.call("publishWorkflowVersion", { versionId: created.data.version.id, reason: REASON }, tech.subject);
  assert.equal(stillNoPublish.code, "FORBIDDEN");
});

test("TENANT ISOLATION: another tenant's administrator cannot read, publish, retire, adopt into or migrate this tenant's workflows", async () => {
  const repo = new InMemoryPolicyRepository();
  const a = await world({ key: "tenant-a", repo, subject: "sub-a" });
  const b = await world({ key: "tenant-b", repo, subject: "sub-b" });
  await grantWorkflowAuthorityThroughAdministration(a);
  await grantWorkflowAuthorityThroughAdministration(b);
  await grantBaseline(a);
  const v = await createWorkflowDraft(a.repo, a.admin, { key: "tiny", name: "Tiny", objectKey: "workOrder", definition: TINY(), reason: REASON });
  await publishWorkflowVersion(a.repo, a.admin, { versionId: v.version.id, reason: REASON });
  const aAudit = await auditCount(a);
  for (const [operation, input] of Object.entries({
    readWorkflowVersion: { versionId: v.version.id },
    validateWorkflowVersion: { versionId: v.version.id },
    listWorkflowInstances: { versionId: v.version.id },
    retireWorkflowVersion: { versionId: v.version.id, reason: REASON },
    activateWorkflowVersion: { versionId: v.version.id, reason: REASON },
    adoptRecordsIntoWorkflowVersion: { versionId: v.version.id, records: [{ recordId: "x", stepKey: "OPEN" }], reason: REASON },
    migrateWorkflowInstances: { fromVersionId: v.version.id, toVersionId: v.version.id + "x", stepMap: {}, reason: REASON },
    updateWorkflowDefinition: { versionId: v.version.id, definition: TINY(), reason: REASON },
  })) {
    const r = await b.call(operation, input);
    assert.equal(r.code, "NOT_FOUND", `${operation}: ${r.code} ${r.message}`);
  }
  const listB = await b.call("listWorkflows");
  assert.equal(listB.data.some((x) => x.workflow.key === "tiny"), false);
  assert.equal(await auditCount(a), aAudit, "tenant A is untouched");
});

test("AUDIT EXACTLY ONCE: every workflow mutation writes one event carrying actor, tenant, workflow, version, previous/new and reason", async () => {
  const w = await world();
  await grantWorkflowAuthorityThroughAdministration(w);
  await grantBaseline(w);
  const step = async (operation, input) => {
    const before = await auditCount(w);
    const r = await w.call(operation, input);
    assert.equal(r.ok, true, `${operation}: ${r.message}`);
    const events = await w.repo.listAuditEvents(w.tenantId, 100000);
    assert.equal(events.length, before + 1, `${operation} wrote exactly one audit event`);
    const e = events[events.length - 1];
    assert.equal(e.action, operation);
    assert.equal(e.tenantId, w.tenantId);
    assert.equal(e.actorUid, w.admin.uid);
    assert.ok((e.after?.workflowKey ?? e.after?.workflowId) || e.targetKind === "workflowVersion", `${operation} names its workflow`);
    return r.data;
  };
  const draft = await step("createWorkflowDraft", { key: "tiny", name: "Tiny", objectKey: "workOrder", definition: TINY(), reason: REASON });
  const bound = await step("setWorkflowRoleBinding", { versionId: draft.version.id, actionKey: "start", roleId: w.roles.fieldManager.id, reason: REASON });
  assert.equal(bound.actionKey, "start");
  await step("publishWorkflowVersion", { versionId: draft.version.id, reason: REASON });
  const pub = (await w.repo.listAuditEvents(w.tenantId, 1))[0];
  assert.equal(pub.before.status, "DRAFT");
  assert.equal(pub.after.status, "PUBLISHED");
  assert.equal(pub.before.activeVersionId, null);
  assert.equal(pub.after.activeVersionId, draft.version.id);
  const v2 = await step("createWorkflowVersion", { workflowId: draft.workflow.id, copyFromVersionId: draft.version.id, reason: REASON });
  await step("publishWorkflowVersion", { versionId: v2.version.id, reason: REASON });
  await step("activateWorkflowVersion", { versionId: draft.version.id, reason: REASON });
  await step("startWorkflowInstance", { workflowKey: "tiny", recordId: "wo-1", reason: REASON });
  await step("adoptRecordsIntoWorkflowVersion", { versionId: v2.version.id, records: [{ recordId: "wo-9", stepKey: "OPEN" }], reason: REASON });
  await step("migrateWorkflowInstances", { fromVersionId: draft.version.id, toVersionId: v2.version.id, stepMap: { OPEN: "OPEN" }, reason: REASON });
  await step("activateWorkflowVersion", { versionId: v2.version.id, reason: REASON });
  await step("retireWorkflowVersion", { versionId: draft.version.id, reason: REASON });
  // No-ops write none.
  const quiet = await auditCount(w);
  assert.equal((await w.call("activateWorkflowVersion", { versionId: v2.version.id, reason: REASON })).ok, true);
  assert.equal((await w.call("retireWorkflowVersion", { versionId: draft.version.id, reason: REASON })).ok, true);
  assert.equal(await auditCount(w), quiet, "an identical request is a no-op and audits nothing");
  const history = await w.call("readWorkflowHistory", { workflowId: draft.workflow.id });
  assert.ok(history.data.length >= 10, "the workflow's own history is readable");
  assert.ok(history.data.every((e) => e.targetKind.startsWith("workflow")));
});

test("API: refusals are verbatim, and validation results carry every code", async () => {
  const w = await world();
  await grantWorkflowAuthorityThroughAdministration(w);
  const unsaved = await w.call("validateWorkflowVersion", {
    objectKey: "workOrder",
    definition: { steps: [{ key: "A", label: "A", initial: true }], actions: [{ key: "x", label: "x", from: "A", to: "B", roleKeys: ["ghost"] }] },
  });
  assert.equal(unsaved.ok, true);
  assert.deepEqual([...new Set(unsaved.data.errors.map((e) => e.code))].sort(),
    ["ACTION_WITHOUT_CAPABILITY", "INVALID_TRANSITION", "NO_TERMINAL_STATE", "UNKNOWN_ROLE"]);
  const badGuard = await w.call("createWorkflowDraft", { key: "g", name: "g", objectKey: "workOrder",
    definition: { steps: TINY().steps, actions: [{ ...TINY().actions[0], guardKind: "WHATEVER" }] }, reason: REASON });
  assert.equal(badGuard.code, "INVALID_INPUT");
  assert.match(badGuard.message, /^INVALID_GUARD: /);
  const unknownCap = await w.call("createWorkflowDraft", { key: "u", name: "u", objectKey: "workOrder",
    definition: { steps: TINY().steps, actions: TINY().actions.map((a) => ({ ...a, capabilityKey: "not.a.capability" })) }, reason: REASON });
  assert.equal(unknownCap.ok, true, "a draft is kept");
  assert.deepEqual(unknownCap.data.unknownCapabilityKeys, ["not.a.capability"], "reported, never invented");
});

// ════════════════════ 9. responsibilities ════════════════════

test("RESPONSIBILITIES: bindings on held Roles INTERSECTED with effective authority, with source", async () => {
  const w = await world();
  await grantWorkflowAuthorityThroughAdministration(w);
  await grantBaseline(w);
  const draft = await createWorkflowDraft(w.repo, w.admin, { key: "tiny", name: "Tiny", objectKey: "workOrder",
    definition: TINY(["dispatcher", "technician"]), reason: REASON });
  await publishWorkflowVersion(w.repo, w.admin, { versionId: draft.version.id, reason: REASON });
  const d = await person(w, "sub-disp", ["dispatcher"]);
  // The Employee read is admin.principalAccess.read (the migration chain grants it to admin).
  await grantCapabilities(w.repo, w.tenantId, [{ roleId: w.roles.admin.id, capabilityKey: "admin.principalAccess.read" }]);
  // A server-composed evaluator stand-in: dispatcher ALLOWED on workOrder.transition.
  const explain = async (_tenantId, principalId) => ({
    securityRoleKeys: principalId === d.principalId ? ["dispatcher"] : [],
    actions: [{ capabilityKey: "workOrder.transition", result: principalId === d.principalId ? "ALLOWED" : "DENIED", reasonCode: "ALLOWED" }],
  });
  const r = await w.call("listPrincipalWorkflowResponsibilities", { principalId: d.principalId }, w.secSubject, { explainEffectiveAccess: explain });
  assert.equal(r.ok, true, r.message);
  assert.deepEqual(r.data.responsibilities.map((x) => `${x.workflowKey}/${x.actionKey}/${x.viaRoles.join("+")}/${x.authority}`),
    ["tiny/start/dispatcher/ALLOWED", "tiny/finish/dispatcher/ALLOWED"]);
  assert.ok(r.data.responsibilities.every((x) => x.source === "WORKFLOW_BINDING_AND_EFFECTIVE_AUTHORITY"));
  const uncomposed = await w.call("listPrincipalWorkflowResponsibilities", { principalId: d.principalId }, w.secSubject);
  assert.equal(uncomposed.code, "INTERNAL", "no evaluator composed: refuse, never guess");

  // Pure: bound but DENIED is listed as conferring nothing; ALLOWED but unbound is not a responsibility.
  const active = [{
    workflow: { id: "w", key: "wf", name: "WF", objectKey: "workOrder" }, version: { id: "v", version: 1 },
    roleKeyById: new Map([["r1", "salesManager"], ["r2", "operationsManager"]]),
    definition: { steps: [], actions: [{ key: "close", label: "Close", fromStepKey: "A", toStepKey: "B", capabilityKey: "salesOrder.write", guardKind: null, requiresOwnAssignment: false }],
      bindings: [{ actionKey: "close", roleId: "r2", bindingKind: "SECURITY_ROLE" }] },
  }];
  const ops = deriveWorkflowResponsibilities("p", active, { securityRoleKeys: ["operationsManager"],
    actions: [{ capabilityKey: "salesOrder.write", result: "DENIED", reasonCode: "CAPABILITY_MISSING" }] });
  assert.equal(ops.responsibilities.length, 0, "the stale binding confers nothing");
  assert.deepEqual(ops.boundWithoutAuthority.map((x) => x.reasonCode), ["CAPABILITY_MISSING"]);
  const unbound = deriveWorkflowResponsibilities("p", active, { securityRoleKeys: ["salesManager"],
    actions: [{ capabilityKey: "salesOrder.write", result: "ALLOWED", reasonCode: "ALLOWED" }] });
  assert.equal(unbound.responsibilities.length + unbound.boundWithoutAuthority.length, 0, "authority without a binding is not a workflow responsibility");
});
