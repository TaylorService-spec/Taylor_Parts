// EOS Administration policy — the WORKFLOW and ADMINISTRATION proofs.
//
// Two separations are on trial here and they are the point of the whole design:
//
//   WORKFLOW authority is not DATA authority. Being allowed to Void a Purchase Order does not
//   expose its fields, and reading its fields does not permit voiding it.
//
//   Role DEFINITION is not role ASSIGNMENT. Admin edits what a Role may do; Owner, General Manager
//   and Admin decide who holds it.
//
// Plus the properties that make a workflow trustworthy: a published version is immutable, an
// in-flight instance stays on the version it began under, and the CURRENT STATE comes from the
// store rather than from whoever is asking.
import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryPolicyRepository } from "../lib/adminPolicy/inMemoryPolicyRepository.js";
import {
  allowedWorkflowActions,
  decideWorkflowAction,
  loadWorkflowVersionDefinition,
  validateWorkflowVersion,
} from "../lib/adminPolicy/workflowEngine.js";
import {
  hasAdministrationAuthority,
  PROTECTED_ROLE_KEYS,
  ROLE_ASSIGNMENT_ROLE_KEYS,
} from "../lib/adminPolicy/administrationAuthority.js";
import {
  assignRole,
  createCustomField,
  createRole,
  publishWorkflowVersion,
  revokeRole,
  setObjectPermission,
  updateFieldDefinition,
} from "../lib/adminPolicy/policyCommands.js";
import { applyWorkflowSeed } from "../lib/adminPolicy/applyWorkflowSeed.js";
import { SEED_WORKFLOWS, WORK_ORDER_WORKFLOW } from "../lib/adminPolicy/workflowSeeds.js";
import { loadPrincipalPolicy, resolveFieldAccess } from "../lib/adminPolicy/effectiveObjectAccess.js";

const TENANT = "tenant-a";
const OTHER_TENANT = "tenant-b";
const SYS = "uid-system";

/**
 * Make somebody a MEMBER of the tenant before a Role is assigned to them.
 *
 * Owner ruling B: an assignment to a non-member is unrepresentable -- a composite foreign key in
 * PostgreSQL, mirrored by the in-memory adapter. These proofs are about what a grant CONFERS, so
 * they take the shortest honest route to a grantable principal.
 */
async function member(repo, principalId, tenantId = TENANT) {
  if (await repo.getMembership(tenantId, principalId)) return principalId;
  await repo.transact({ tenantId, uid: "setup" }, (tx) => tx.createTenantMembership(principalId));
  return principalId;
}

/** Assign through the governed command, with the membership it now requires. */
async function grantRole(repo, actor, principalId, roleId) {
  await member(repo, principalId, actor.tenantId);
  return assignRole(repo, actor, { principalId, roleId });
}

const adminActor = (uid = "uid-admin") => ({ tenantId: TENANT, uid, heldRoleKeys: ["admin"] });
const gmActor = (uid = "uid-gm") => ({ tenantId: TENANT, uid, heldRoleKeys: ["generalManager"] });
const plainActor = (uid = "uid-plain") => ({ tenantId: TENANT, uid, heldRoleKeys: ["technician"] });

async function seedRoles(repo, keys, tenantId = TENANT) {
  const made = {};
  await repo.transact({ tenantId, uid: SYS }, async (tx) => {
    for (const key of keys) {
      made[key] = await tx.createRole({
        key, name: key, description: null,
        origin: PROTECTED_ROLE_KEYS.includes(key) ? "SYSTEM" : "CUSTOM",
        protected: PROTECTED_ROLE_KEYS.includes(key),
      });
    }
  });
  return made;
}

/** A published Work Order workflow with its Roles, ready to run instances against. */
async function publishedWorkOrder(repo) {
  const roles = await seedRoles(repo, ["admin", "dispatcher", "technician"]);
  const applied = await applyWorkflowSeed(repo, adminActor(), WORK_ORDER_WORKFLOW);
  await publishWorkflowVersion(repo, adminActor(), { versionId: applied.version.id });
  const definition = await loadWorkflowVersionDefinition(repo, TENANT, applied.version.id);
  return { roles, applied, definition };
}

async function startInstance(repo, versionId, stepKey, recordId = "wo-1") {
  return repo.transact({ tenantId: TENANT, uid: SYS }, (tx) =>
    tx.createWorkflowInstance({
      workflowVersionId: versionId, objectKey: "workOrder", recordId, currentStepKey: stepKey,
    }),
  );
}

// ============================ the seeds are runnable definitions ============================

test("every seeded workflow is a structurally valid definition", async () => {
  const repo = new InMemoryPolicyRepository();
  await seedRoles(repo, ["admin", "dispatcher", "technician", "partsManager", "partsAssociate",
    "salesperson", "salesManager", "operationsManager"]);
  for (const seed of SEED_WORKFLOWS) {
    // applyWorkflowSeed throws if the definition it wrote cannot describe a runnable process.
    const applied = await applyWorkflowSeed(repo, adminActor(), seed);
    assert.equal(applied.missingRoleKeys.length, 0, `${seed.key}: every bound Role exists`);
    assert.ok(applied.actionCount > 0, `${seed.key}: has actions`);
  }
});

test("the Work Order seed reproduces the measured transition table exactly", async () => {
  // The oracle is field-ops-app-vite/src/domain/workOrderWorkflow.js's WORK_ORDER_TRANSITIONS,
  // transcribed here. A definition that quietly gained or lost an edge would be describing a
  // workflow the system does not run, which is worse than having no definition.
  const MEASURED = {
    CREATED: ["READY_TO_DISPATCH", "CANCELLED"],
    READY_TO_DISPATCH: ["SCHEDULED", "CANCELLED"],
    SCHEDULED: ["DISPATCHED", "READY_TO_DISPATCH", "CANCELLED"],
    DISPATCHED: ["ACCEPTED", "CANCELLED"],
    ACCEPTED: ["EN_ROUTE", "CANCELLED"],
    EN_ROUTE: ["ARRIVED", "CANCELLED"],
    ARRIVED: ["WORK_IN_PROGRESS", "CANCELLED"],
    WORK_IN_PROGRESS: ["COMPLETED", "CANCELLED"],
    COMPLETED: ["CLOSED"],
    CLOSED: [],
    CANCELLED: [],
  };
  const built = {};
  for (const step of WORK_ORDER_WORKFLOW.steps) built[step.key] = [];
  for (const action of WORK_ORDER_WORKFLOW.actions) built[action.from].push(action.to);

  for (const [from, tos] of Object.entries(MEASURED)) {
    assert.deepEqual([...built[from]].sort(), [...tos].sort(), `edges from ${from}`);
  }
  assert.deepEqual(Object.keys(built).sort(), Object.keys(MEASURED).sort(), "the same states, no more");
});

test("the five technician actions require own assignment, exactly as the measured table does", () => {
  const own = WORK_ORDER_WORKFLOW.actions.filter((a) => a.requiresOwnAssignment).map((a) => a.key).sort();
  assert.deepEqual(own, ["Accept", "Arrive", "Complete", "Travel", "WorkStart"]);
});

test("a structurally broken definition is REFUSED rather than published", () => {
  const broken = {
    versionId: "v",
    steps: [{ key: "A", label: "A", initial: false, terminal: false }],
    actions: [{ key: "go", label: "Go", fromStepKey: "A", toStepKey: "NOWHERE", requiresOwnAssignment: false }],
    bindings: [{ actionKey: "missing", roleId: "r" }],
  };
  const problems = validateWorkflowVersion(broken);
  assert.ok(problems.some((p) => /no initial step/.test(p)));
  assert.ok(problems.some((p) => /unknown step "NOWHERE"/.test(p)));
  assert.ok(problems.some((p) => /unknown action "missing"/.test(p)));
});

// ============================ workflow authority ============================

test("an UNAUTHORIZED Role cannot perform an action", async () => {
  const repo = new InMemoryPolicyRepository();
  const { roles, definition, applied } = await publishedWorkOrder(repo);
  const instance = await startInstance(repo, applied.version.id, "SCHEDULED");

  // Dispatch is bound to admin and dispatcher. A technician holds neither.
  const decision = decideWorkflowAction(definition, instance, "Dispatch", {
    tenantId: TENANT, actorUid: "uid-tech", roleIds: [roles.technician.id], assigneeUid: null,
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.refusal, "notBoundToRole");
});

test("an AUTHORIZED Role still cannot skip an invalid state", async () => {
  const repo = new InMemoryPolicyRepository();
  const { roles, definition, applied } = await publishedWorkOrder(repo);
  // The record is only CREATED. Dispatch runs from SCHEDULED.
  const instance = await startInstance(repo, applied.version.id, "CREATED");

  const decision = decideWorkflowAction(definition, instance, "Dispatch", {
    tenantId: TENANT, actorUid: "uid-d", roleIds: [roles.dispatcher.id], assigneeUid: null,
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.refusal, "invalidFromState");
});

test("CLIENT-SUPPLIED STATE cannot override the stored state", async () => {
  const repo = new InMemoryPolicyRepository();
  const { roles, definition, applied } = await publishedWorkOrder(repo);
  const instance = await startInstance(repo, applied.version.id, "CREATED");

  // A caller claiming the record is SCHEDULED. The decision function is not given a place to put
  // that claim -- the instance IS the state -- so the forged value cannot be expressed, let alone
  // believed. Asserted by passing it anyway and watching it change nothing.
  const forged = { ...instance, currentStepKey: "SCHEDULED" };
  const attempt = { tenantId: TENANT, actorUid: "uid-d", roleIds: [roles.dispatcher.id], assigneeUid: null };

  const honest = decideWorkflowAction(definition, instance, "Dispatch", attempt);
  assert.equal(honest.allowed, false, "the stored state refuses");
  // And the ONLY way to get an allow is to actually be in that state -- which requires a stored
  // write, not a request field.
  const advanced = await repo.transact({ tenantId: TENANT, uid: SYS }, (tx) =>
    tx.advanceWorkflowInstance(instance.id, "SCHEDULED"),
  );
  assert.equal(decideWorkflowAction(definition, advanced, "Dispatch", attempt).allowed, true);
  assert.equal(forged.currentStepKey, "SCHEDULED", "the forged object existed but was never consulted");
});

test("requiresOwnAssignment refuses a non-assignee AND an unassigned record", async () => {
  const repo = new InMemoryPolicyRepository();
  const { roles, definition, applied } = await publishedWorkOrder(repo);
  const instance = await startInstance(repo, applied.version.id, "DISPATCHED");
  const base = { tenantId: TENANT, actorUid: "uid-tech", roleIds: [roles.technician.id] };

  assert.equal(
    decideWorkflowAction(definition, instance, "Accept", { ...base, assigneeUid: "uid-other" }).refusal,
    "notOwnAssignment",
    "somebody else's job",
  );
  assert.equal(
    decideWorkflowAction(definition, instance, "Accept", { ...base, assigneeUid: null }).refusal,
    "notOwnAssignment",
    "nobody assigned is not a match -- an absent value must not satisfy an identity check",
  );
  assert.equal(
    decideWorkflowAction(definition, instance, "Accept", { ...base, assigneeUid: "uid-tech" }).allowed,
    true,
    "the assignee may proceed",
  );
});

test("a TERMINAL state accepts no action at all", async () => {
  const repo = new InMemoryPolicyRepository();
  const { roles, definition, applied } = await publishedWorkOrder(repo);
  const instance = await startInstance(repo, applied.version.id, "CLOSED");
  const attempt = { tenantId: TENANT, actorUid: "uid-a", roleIds: [roles.admin.id], assigneeUid: null };

  assert.equal(decideWorkflowAction(definition, instance, "Close", attempt).refusal, "terminalState");
  assert.deepEqual(allowedWorkflowActions(definition, instance, attempt), []);
});

test("allowedWorkflowActions and decideWorkflowAction cannot disagree", async () => {
  // Same code, asked once per action -- so a button that renders and a command that authorizes can
  // never diverge. Asserted rather than assumed, because the divergence is exactly what a second
  // implementation would produce.
  const repo = new InMemoryPolicyRepository();
  const { roles, definition, applied } = await publishedWorkOrder(repo);
  const instance = await startInstance(repo, applied.version.id, "SCHEDULED");
  const attempt = { tenantId: TENANT, actorUid: "uid-d", roleIds: [roles.dispatcher.id], assigneeUid: null };

  const allowed = allowedWorkflowActions(definition, instance, attempt);
  assert.deepEqual([...allowed].sort(), ["CancelFromScheduled", "Dispatch", "Unschedule"]);
  for (const action of definition.actions) {
    assert.equal(
      decideWorkflowAction(definition, instance, action.key, attempt).allowed,
      allowed.includes(action.key),
      `${action.key} must agree`,
    );
  }
});

// ============================ the two authorities are independent ============================

test("WORKFLOW authority does not expose forbidden fields", async () => {
  const repo = new InMemoryPolicyRepository();
  const { roles, definition, applied } = await publishedWorkOrder(repo);
  const instance = await startInstance(repo, applied.version.id, "SCHEDULED");

  // The dispatcher may Dispatch -- and holds NO Object CRED at all, so reads nothing.
  const attempt = { tenantId: TENANT, actorUid: "uid-d", roleIds: [roles.dispatcher.id], assigneeUid: null };
  assert.equal(decideWorkflowAction(definition, instance, "Dispatch", attempt).allowed, true);

  const world = await repo.transact({ tenantId: TENANT, uid: SYS }, async (tx) => {
    const obj = await tx.createObject({
      key: "workOrder", label: "Work Order", labelPlural: null, description: null,
      origin: "SYSTEM", lifecycle: "ACTIVE", supportsDelete: false,
    });
    const f = await tx.createField({
      objectId: obj.id, key: "internalNotes", label: "Internal notes", description: null,
      dataType: "TEXT", required: false, allowedValues: [], defaultValue: null, searchable: false,
      sortable: false, reportable: true, sensitivity: "CONFIDENTIAL", referenceTo: null,
      origin: "SYSTEM", lifecycle: "ACTIVE",
    });
    await tx.createTenantMembership("uid-d");
    await tx.createAssignment({
      principalId: "uid-d", roleId: roles.dispatcher.id, scopeType: "global", scopeValue: null,
      status: "active", grantedBy: SYS, grantedAt: new Date().toISOString(), accessVersionAtGrant: 0,
    });
    return { obj, f };
  });

  const policy = await loadPrincipalPolicy(repo, TENANT, "uid-d");
  assert.equal(
    resolveFieldAccess(policy, "workOrder", world.f).cred.R, false,
    "performing the action grants no sight of the record's fields",
  );
});

test("DATA authority alone does not permit a workflow action", async () => {
  const repo = new InMemoryPolicyRepository();
  const { roles, definition, applied } = await publishedWorkOrder(repo);
  const instance = await startInstance(repo, applied.version.id, "SCHEDULED");

  // A Role with full CRED on Work Orders, bound to no workflow action.
  const reader = await createRole(repo, adminActor(), { key: "workOrderReader", name: "WO Reader" });
  await repo.transact({ tenantId: TENANT, uid: SYS }, async (tx) => {
    const obj = await tx.createObject({
      key: "workOrder", label: "Work Order", labelPlural: null, description: null,
      origin: "SYSTEM", lifecycle: "ACTIVE", supportsDelete: false,
    });
    await tx.setObjectPermission(reader.id, obj.id, { C: true, R: true, E: true, D: false });
  });

  const decision = decideWorkflowAction(definition, instance, "Dispatch", {
    tenantId: TENANT, actorUid: "uid-reader", roleIds: [reader.id], assigneeUid: null,
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.refusal, "notBoundToRole", "full CRED buys no workflow authority");
  assert.ok(roles.dispatcher, "the bound Role is a different one entirely");
});

// ============================ versioning ============================

test("a PUBLISHED version is immutable", async () => {
  const repo = new InMemoryPolicyRepository();
  const { applied } = await publishedWorkOrder(repo);
  await assert.rejects(
    () => repo.transact({ tenantId: TENANT, uid: SYS }, (tx) =>
      tx.createWorkflowStep({
        workflowVersionId: applied.version.id, key: "SNEAKY", label: "Sneaky", initial: false, terminal: false,
      }),
    ),
    /PUBLISHED and cannot be edited/,
  );
});

test("a NEW version does not mutate a running OLD-version instance", async () => {
  const repo = new InMemoryPolicyRepository();
  const { roles, definition, applied } = await publishedWorkOrder(repo);
  const instance = await startInstance(repo, applied.version.id, "SCHEDULED");

  // v2 of the same workflow, with Dispatch bound to NOBODY.
  const v2 = await applyWorkflowSeed(repo, adminActor(), {
    ...WORK_ORDER_WORKFLOW,
    actions: WORK_ORDER_WORKFLOW.actions.map((a) => (a.key === "Dispatch" ? { ...a, roleKeys: [] } : a)),
  });
  assert.equal(v2.version.version, 2, "a second version, not an edit of the first");

  // The in-flight instance is pinned to v1 and still resolves under v1's bindings.
  const attempt = { tenantId: TENANT, actorUid: "uid-d", roleIds: [roles.dispatcher.id], assigneeUid: null };
  assert.equal(
    decideWorkflowAction(definition, instance, "Dispatch", attempt).allowed, true,
    "editing v2 did not reinterpret the running v1 instance",
  );

  // And asking v2's definition about a v1 instance is refused rather than answered by coincidence.
  const v2Definition = await loadWorkflowVersionDefinition(repo, TENANT, v2.version.id);
  assert.equal(
    decideWorkflowAction(v2Definition, instance, "Dispatch", attempt).refusal, "unknownInstance",
    "an instance is only ever judged by its own version",
  );
});

// ============================ administration authority ============================

test("the authority table matches the Owner ruling", () => {
  assert.deepEqual([...ROLE_ASSIGNMENT_ROLE_KEYS], ["owner", "generalManager", "admin"]);
  for (const action of ["editObjectDefinition", "editRoleDefinition", "editWorkflowDefinition"]) {
    assert.equal(hasAdministrationAuthority(["admin"], action), true, `admin may ${action}`);
    assert.equal(hasAdministrationAuthority(["owner"], action), false, `owner may NOT ${action}`);
    assert.equal(hasAdministrationAuthority(["generalManager"], action), false, `GM may NOT ${action}`);
  }
  for (const key of ["owner", "generalManager", "admin"]) {
    assert.equal(hasAdministrationAuthority([key], "assignRole"), true, `${key} may assign`);
  }
  assert.equal(hasAdministrationAuthority(["technician"], "assignRole"), false);
  assert.equal(hasAdministrationAuthority([], "assignRole"), false, "no roles is a refusal");
  assert.equal(hasAdministrationAuthority(null, "assignRole"), false, "unreadable is a refusal");
});

test("a NON-ADMIN cannot edit Objects, Role definitions or Workflows", async () => {
  const repo = new InMemoryPolicyRepository();
  await seedRoles(repo, ["admin"]);
  await repo.transact({ tenantId: TENANT, uid: SYS }, (tx) =>
    tx.createObject({
      key: "customer", label: "Customer", labelPlural: null, description: null,
      origin: "SYSTEM", lifecycle: "ACTIVE", supportsDelete: true,
    }),
  );

  for (const actor of [plainActor(), gmActor()]) {
    await assert.rejects(
      () => createCustomField(repo, actor, { objectKey: "customer", key: "nickname", label: "Nickname", dataType: "STRING" }),
      /not authorized to perform "editObjectDefinition"/,
    );
    await assert.rejects(
      () => createRole(repo, actor, { key: "sneaky", name: "Sneaky" }),
      /not authorized to perform "editRoleDefinition"/,
    );
    await assert.rejects(
      () => publishWorkflowVersion(repo, actor, { versionId: "whatever" }),
      /not authorized to perform "editWorkflowDefinition"/,
    );
  }
});

test("Owner, General Manager and Admin may each assign ANY Role, including Admin", async () => {
  const repo = new InMemoryPolicyRepository();
  const roles = await seedRoles(repo, ["admin", "owner", "generalManager"]);

  for (const [i, actor] of [adminActor(), gmActor(), { tenantId: TENANT, uid: "uid-owner", heldRoleKeys: ["owner"] }].entries()) {
    const assignment = await grantRole(repo, actor, `uid-target-${i}`, roles.admin.id);
    assert.equal(assignment.roleId, roles.admin.id, "the Admin Role itself was assignable");
    assert.equal(assignment.status, "active");
  }
});

test("an unauthorized user cannot assign Roles", async () => {
  const repo = new InMemoryPolicyRepository();
  const roles = await seedRoles(repo, ["admin"]);
  await assert.rejects(
    () => grantRole(repo, plainActor(), "uid-target", roles.admin.id),
    /not authorized to perform "assignRole"/,
  );
});

test("an EXACT assignment can be revoked, and only that one", async () => {
  const repo = new InMemoryPolicyRepository();
  const roles = await seedRoles(repo, ["admin", "salesperson"]);
  // Two administering assignments, so revoking one is not the last-admin case.
  await grantRole(repo, adminActor(), "uid-keeper", roles.admin.id);
  const a = await grantRole(repo, adminActor(), "uid-target", roles.admin.id);
  const b = await grantRole(repo, adminActor(), "uid-target", roles.salesperson.id);

  const revoked = await revokeRole(repo, adminActor(), { assignmentId: a.id });
  assert.equal(revoked.status, "disabled");

  const remaining = await repo.listAssignmentsForPrincipal(TENANT, "uid-target");
  assert.equal(remaining.find((x) => x.id === b.id).status, "active", "the other assignment is untouched");
});

test("the LAST administering assignment cannot be revoked", async () => {
  // The recovery invariant. Ordinary configuration must not be able to leave the tenant
  // unadministrable -- there would be no bug to point at afterwards, only a locked door.
  const repo = new InMemoryPolicyRepository();
  const roles = await seedRoles(repo, ["admin"]);
  const only = await grantRole(repo, adminActor(), "uid-only-admin", roles.admin.id);

  await assert.rejects(
    () => revokeRole(repo, adminActor(), { assignmentId: only.id }),
    /last active administering assignment/,
  );
});

test("a tenant-created Role may not claim a protected key", async () => {
  const repo = new InMemoryPolicyRepository();
  await seedRoles(repo, ["admin"]);
  await assert.rejects(
    () => createRole(repo, adminActor(), { key: "owner", name: "Not the real owner" }),
    /protected system role key/,
  );
});

// ============================ mutation invariants ============================

test("EVERY policy mutation writes exactly one audit event", async () => {
  const repo = new InMemoryPolicyRepository();
  const roles = await seedRoles(repo, ["admin"]);
  const object = await repo.transact({ tenantId: TENANT, uid: SYS }, (tx) =>
    tx.createObject({
      key: "customer", label: "Customer", labelPlural: null, description: null,
      origin: "SYSTEM", lifecycle: "ACTIVE", supportsDelete: true,
    }),
  );

  const before = (await repo.listAuditEvents(TENANT, 1000)).length;
  const field = await createCustomField(repo, adminActor(), {
    objectKey: "customer", key: "nickname", label: "Nickname", dataType: "STRING",
  });
  await updateFieldDefinition(repo, adminActor(), { fieldId: field.id, label: "Preferred name" });
  await createRole(repo, adminActor(), { key: "viewer", name: "Viewer" });
  await setObjectPermission(repo, adminActor(), {
    roleId: roles.admin.id, objectKey: "customer", cred: { C: false, R: true, E: false, D: false },
  });
  await grantRole(repo, adminActor(), "uid-x", roles.admin.id);

  const events = await repo.listAuditEvents(TENANT, 1000);
  assert.equal(events.length - before, 5, "five mutations, five events");
  assert.deepEqual(
    events.slice(before).map((e) => e.action),
    ["createCustomField", "updateFieldDefinition", "createRole", "setObjectPermission", "assignRole"],
  );
  for (const e of events.slice(before)) {
    assert.equal(e.actorUid, "uid-admin", "the actor is recorded");
    assert.ok(e.occurredAt, "and when");
  }
});

test("a permission change BUMPS the access version of every holder", async () => {
  // A change that landed without the bump would leave cached decisions valid -- the change silently
  // not taking effect, which is worse than it failing.
  const repo = new InMemoryPolicyRepository();
  const roles = await seedRoles(repo, ["admin", "viewer"]);
  await repo.transact({ tenantId: TENANT, uid: SYS }, (tx) =>
    tx.createObject({
      key: "customer", label: "Customer", labelPlural: null, description: null,
      origin: "SYSTEM", lifecycle: "ACTIVE", supportsDelete: true,
    }),
  );
  await grantRole(repo, adminActor(), "uid-holder", roles.viewer.id);
  const before = (await repo.getAccessVersion(TENANT, "uid-holder")).accessVersion;

  await setObjectPermission(repo, adminActor(), {
    roleId: roles.viewer.id, objectKey: "customer", cred: { C: false, R: true, E: false, D: false },
  });

  const after = (await repo.getAccessVersion(TENANT, "uid-holder")).accessVersion;
  assert.ok(after > before, `access version rose from ${before} to ${after}`);
});

test("a field's key and dataType are not changeable -- there is no parameter for either", async () => {
  const repo = new InMemoryPolicyRepository();
  await seedRoles(repo, ["admin"]);
  await repo.transact({ tenantId: TENANT, uid: SYS }, (tx) =>
    tx.createObject({
      key: "customer", label: "Customer", labelPlural: null, description: null,
      origin: "SYSTEM", lifecycle: "ACTIVE", supportsDelete: true,
    }),
  );
  const field = await createCustomField(repo, adminActor(), {
    objectKey: "customer", key: "nickname", label: "Nickname", dataType: "STRING",
  });

  // Supplied anyway. A re-key orphans every stored value and a retype makes them mean something
  // they were not written to mean, so the command has no parameter that would accept either.
  const updated = await updateFieldDefinition(repo, adminActor(), {
    fieldId: field.id, label: "Preferred name", key: "somethingElse", dataType: "NUMBER",
  });
  assert.equal(updated.key, "nickname", "the key is unchanged");
  assert.equal(updated.dataType, "STRING", "and so is the type");
  assert.equal(updated.label, "Preferred name", "while the editable field did change");
});

test("a SYSTEM field's DEFINITION is protected -- every part of it", async () => {
  const repo = new InMemoryPolicyRepository();
  await seedRoles(repo, ["admin"]);
  const world = await repo.transact({ tenantId: TENANT, uid: SYS }, async (tx) => {
    const obj = await tx.createObject({
      key: "customer", label: "Customer", labelPlural: null, description: null,
      origin: "SYSTEM", lifecycle: "ACTIVE", supportsDelete: true,
    });
    const f = await tx.createField({
      objectId: obj.id, key: "name", label: "Name", description: null, dataType: "STRING",
      required: true, allowedValues: [], defaultValue: null, searchable: true, sortable: true,
      reportable: true, sensitivity: "NORMAL", referenceTo: null, origin: "SYSTEM", lifecycle: "ACTIVE",
    });
    return { f };
  });

  // WAS: only `lifecycle` was refused, which left a SYSTEM field's label, description, required,
  // searchable, sortable, reportable and sensitivity all editable. That is not what "system Field
  // definitions are protected" means, and `sensitivity` in particular is read by the
  // field-projection path -- so "just a label change" was never just a label change.
  //
  // NOW: the definition is protected as a whole. Its POLICY is still fully configurable through
  // Role field permissions, which is the thing an administrator actually needs.
  for (const patch of [
    { lifecycle: "RETIRED" },
    { label: "Renamed" },
    { description: "changed" },
    { required: false },
    { searchable: false },
    { sortable: false },
    { reportable: false },
    { sensitivity: "RESTRICTED" },
  ]) {
    await assert.rejects(
      () => updateFieldDefinition(repo, adminActor(), { fieldId: world.f.id, ...patch }),
      /SYSTEM field's definition is protected/,
      `${Object.keys(patch)[0]} must be refused on a SYSTEM field`,
    );
  }

  // And a CUSTOM field on the same object stays editable -- the rule is about origin, not about
  // making the screen read-only.
  const custom = await createCustomField(repo, adminActor(), {
    objectKey: "customer", key: "loyaltyTier", label: "Loyalty Tier", dataType: "STRING",
  });
  const updated = await updateFieldDefinition(repo, adminActor(), {
    fieldId: custom.id, label: "Loyalty Band", sensitivity: "INTERNAL",
  });
  assert.equal(updated.label, "Loyalty Band");
  assert.equal(updated.sensitivity, "INTERNAL");
});

test("an ENUM field with no allowed values is refused", async () => {
  const repo = new InMemoryPolicyRepository();
  await seedRoles(repo, ["admin"]);
  await repo.transact({ tenantId: TENANT, uid: SYS }, (tx) =>
    tx.createObject({
      key: "customer", label: "Customer", labelPlural: null, description: null,
      origin: "SYSTEM", lifecycle: "ACTIVE", supportsDelete: true,
    }),
  );
  await assert.rejects(
    () => createCustomField(repo, adminActor(), {
      objectKey: "customer", key: "tier", label: "Tier", dataType: "ENUM", allowedValues: [],
    }),
    /an enum of nothing can hold nothing/,
  );
});

test("Delete cannot be granted on an object that does not support it", async () => {
  const repo = new InMemoryPolicyRepository();
  const roles = await seedRoles(repo, ["admin"]);
  await repo.transact({ tenantId: TENANT, uid: SYS }, (tx) =>
    tx.createObject({
      key: "ledgerEntry", label: "Ledger Entry", labelPlural: null, description: null,
      origin: "SYSTEM", lifecycle: "ACTIVE", supportsDelete: false,
    }),
  );
  await assert.rejects(
    () => setObjectPermission(repo, adminActor(), {
      roleId: roles.admin.id, objectKey: "ledgerEntry", cred: { C: false, R: true, E: false, D: true },
    }),
    /does not support Delete/,
  );
});

test("an administration command cannot reach another tenant", async () => {
  const repo = new InMemoryPolicyRepository();
  await seedRoles(repo, ["admin"], TENANT);
  await seedRoles(repo, ["admin"], OTHER_TENANT);
  await repo.transact({ tenantId: OTHER_TENANT, uid: SYS }, (tx) =>
    tx.createObject({
      key: "customer", label: "Customer", labelPlural: null, description: null,
      origin: "SYSTEM", lifecycle: "ACTIVE", supportsDelete: true,
    }),
  );

  // Tenant A's admin, naming an object that exists only in tenant B. There is no parameter for a
  // tenant, so the actor's own is the only one in play -- the object is simply not there.
  await assert.rejects(
    () => createCustomField(repo, adminActor(), {
      objectKey: "customer", key: "nickname", label: "Nickname", dataType: "STRING",
    }),
    /no object "customer"/,
  );
});
