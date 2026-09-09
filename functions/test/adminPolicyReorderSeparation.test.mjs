// REORDER REQUEST vs PURCHASE ORDER — the four implications that must not hold.
//
// ════════════════════ THE OWNER RULING THIS ENCODES ════════════════════
//
// Reorder Request and Purchase Order are SEPARATE canonical EOS Objects. The legacy CRUD matrix
// grouped both under one "Purchase Orders" row, which produced two different errors at once:
//
//   WRONG OBJECT   granting "Purchase Orders / Read" also granted the reorder queue
//   WRONG KIND     reorder TRANSITIONS (approve, assign, void) were drawn as Purchase Order EDIT
//
// Ruling item 6 names four implications that must not hold. Each is asserted here against the REAL
// resolver and the REAL workflow engine, over a store, rather than argued for in a comment.
//
//   workflow action        does NOT imply Reorder Request / Edit
//   Reorder Request / Edit does NOT imply a workflow action
//   Purchase Order / Edit  does NOT imply a reorder workflow action
//   Purchase Order data    does NOT imply Reorder Request data (and the reverse)
import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryPolicyRepository } from "../lib/adminPolicy/inMemoryPolicyRepository.js";
import {
  decideWorkflowAction,
  loadWorkflowVersionDefinition,
} from "../lib/adminPolicy/workflowEngine.js";
import { createRole, publishWorkflowVersion } from "../lib/adminPolicy/policyCommands.js";
import { applyWorkflowSeed } from "../lib/adminPolicy/applyWorkflowSeed.js";
import {
  loadPrincipalPolicy,
  resolveFieldAccess,
  resolveObjectAccess,
} from "../lib/adminPolicy/effectiveObjectAccess.js";

const TENANT = "tenant-a";
const SYS = "uid-system";
const adminActor = () => ({ tenantId: TENANT, uid: "uid-admin", heldRoleKeys: ["admin"] });

async function seedRoles(repo, keys) {
  const made = {};
  await repo.transact({ tenantId: TENANT, uid: SYS }, async (tx) => {
    for (const key of keys) {
      made[key] = await tx.createRole({
        key, name: key, description: null, origin: "SYSTEM", protected: key === "admin",
      });
    }
  });
  return made;
}

/**
 * A world with BOTH objects, both Roles, and a published reorder workflow.
 *
 * Deliberately a small hand-built workflow rather than the full seed: the properties under test are
 * about the SEPARATION, and a three-state machine makes the assertions readable. The full seed's own
 * fidelity is proved in adminPolicyWorkflow.test.mjs.
 */
async function reorderWorld(repo) {
  const roles = await seedRoles(repo, ["admin", "partsManager", "partsAssociate"]);
  const applied = await applyWorkflowSeed(repo, adminActor(), {
    key: "partsPurchasing",
    name: "Parts / Purchasing",
    description: "measured",
    objectKey: "reorderRequest",
    steps: [
      { key: "PENDING_REVIEW", label: "Pending review", initial: true },
      { key: "READY_FOR_PARTS_MANAGER", label: "Ready" },
      { key: "DONE", label: "Done", terminal: true },
    ],
    actions: [
      { key: "approve", label: "Approve", from: "PENDING_REVIEW", to: "READY_FOR_PARTS_MANAGER", roleKeys: ["partsManager"] },
      { key: "finish", label: "Finish", from: "READY_FOR_PARTS_MANAGER", to: "DONE", roleKeys: ["partsManager"] },
    ],
  });
  await publishWorkflowVersion(repo, adminActor(), { versionId: applied.version.id });
  const definition = await loadWorkflowVersionDefinition(repo, TENANT, applied.version.id);

  const world = await repo.transact({ tenantId: TENANT, uid: SYS }, async (tx) => {
    const object = async (key, label) =>
      tx.createObject({
        key, label, labelPlural: null, description: null,
        origin: "SYSTEM", lifecycle: "ACTIVE", supportsDelete: false,
      });
    const field = async (objectId, key) =>
      tx.createField({
        objectId, key, label: key, description: null, dataType: "STRING", required: false,
        allowedValues: [], defaultValue: null, searchable: false, sortable: false, reportable: true,
        sensitivity: "NORMAL", referenceTo: null, origin: "SYSTEM", lifecycle: "ACTIVE",
      });
    const reorder = await object("reorderRequest", "Reorder Request");
    const purchaseOrder = await object("purchaseOrder", "Purchase Order");
    return {
      reorder,
      purchaseOrder,
      reorderField: await field(reorder.id, "requestedQty"),
      poField: await field(purchaseOrder.id, "externalPoNumber"),
    };
  });

  const instance = await repo.transact({ tenantId: TENANT, uid: SYS }, (tx) =>
    tx.createWorkflowInstance({
      workflowVersionId: applied.version.id, objectKey: "reorderRequest",
      recordId: "rr-1", currentStepKey: "PENDING_REVIEW",
    }),
  );

  return { roles, definition, instance, ...world };
}

// A Role assignment now requires the principal to be a MEMBER of the tenant (Owner ruling B), so
// these proofs make them one before granting. The separation being proved is unaffected: it is
// about which authority a grant confers, not about who may hold one.
const assignTo = (repo, uid, roleId) =>
  repo.transact({ tenantId: TENANT, uid: SYS }, async (tx) => {
    if (!(await repo.getMembership(TENANT, uid))) await tx.createTenantMembership(uid);
    const version = await tx.bumpAccessVersion(uid);
    return tx.createAssignment({
      principalId: uid, roleId, scopeType: "global", scopeValue: null, status: "active",
      grantedBy: SYS, grantedAt: new Date().toISOString(), accessVersionAtGrant: version,
    });
  });

const grantAll = (repo, roleId, objectId) =>
  repo.transact({ tenantId: TENANT, uid: SYS }, (tx) =>
    tx.setObjectPermission(roleId, objectId, { C: true, R: true, E: true, D: false }));

// ============================ the four implications ============================

test("a WORKFLOW ACTION does not imply Reorder Request / Edit", async () => {
  const repo = new InMemoryPolicyRepository();
  const { roles, definition, instance, reorderField } = await reorderWorld(repo);

  // partsManager may Approve, and holds NO Object CRED at all.
  const attempt = { tenantId: TENANT, actorUid: "uid-pm", roleIds: [roles.partsManager.id], assigneeUid: null };
  assert.equal(decideWorkflowAction(definition, instance, "approve", attempt).allowed, true, "the action is permitted");

  await assignTo(repo, "uid-pm", roles.partsManager.id);
  const policy = await loadPrincipalPolicy(repo, TENANT, "uid-pm");
  assert.equal(resolveObjectAccess(policy, "reorderRequest").cred.E, false, "no Edit on the object");
  assert.equal(resolveFieldAccess(policy, "reorderRequest", reorderField).cred.E, false, "none on its fields");
  assert.equal(resolveFieldAccess(policy, "reorderRequest", reorderField).cred.R, false, "not even Read");
});

test("Reorder Request / Edit does not imply a workflow action", async () => {
  const repo = new InMemoryPolicyRepository();
  const { roles, definition, instance, reorder } = await reorderWorld(repo);

  const editor = await createRole(repo, adminActor(), { key: "reorderEditor", name: "Reorder Editor" });
  await grantAll(repo, editor.id, reorder.id);
  await assignTo(repo, "uid-editor", editor.id);

  const policy = await loadPrincipalPolicy(repo, TENANT, "uid-editor");
  assert.equal(resolveObjectAccess(policy, "reorderRequest").cred.E, true, "the data authority is real");

  const decision = decideWorkflowAction(definition, instance, "approve", {
    tenantId: TENANT, actorUid: "uid-editor", roleIds: [editor.id], assigneeUid: null,
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.refusal, "notBoundToRole", "full CRED buys no transition");
  assert.ok(roles.partsManager, "the bound Role is a different one entirely");
});

test("Purchase Order / Edit does not imply a reorder workflow action", async () => {
  // The cross-object case, and the one the legacy matrix actually produced.
  const repo = new InMemoryPolicyRepository();
  const { definition, instance, purchaseOrder } = await reorderWorld(repo);

  const poEditor = await createRole(repo, adminActor(), { key: "poEditor", name: "PO Editor" });
  await grantAll(repo, poEditor.id, purchaseOrder.id);
  await assignTo(repo, "uid-po", poEditor.id);

  const policy = await loadPrincipalPolicy(repo, TENANT, "uid-po");
  assert.equal(resolveObjectAccess(policy, "purchaseOrder").cred.E, true, "full authority over purchase orders");

  const decision = decideWorkflowAction(definition, instance, "approve", {
    tenantId: TENANT, actorUid: "uid-po", roleIds: [poEditor.id], assigneeUid: null,
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.refusal, "notBoundToRole");
});

test("Purchase Order authority confers NOTHING over Reorder Request data", async () => {
  // The other half of the same conflation: one row over two records meant a Purchase Orders grant
  // silently reached the reorder queue.
  const repo = new InMemoryPolicyRepository();
  const { purchaseOrder, reorderField, poField } = await reorderWorld(repo);

  const poEditor = await createRole(repo, adminActor(), { key: "poEditor", name: "PO Editor" });
  await grantAll(repo, poEditor.id, purchaseOrder.id);
  await assignTo(repo, "uid-po", poEditor.id);

  const policy = await loadPrincipalPolicy(repo, TENANT, "uid-po");
  assert.equal(resolveFieldAccess(policy, "purchaseOrder", poField).cred.R, true, "its own field, readable");
  assert.equal(resolveObjectAccess(policy, "reorderRequest").cred.R, false, "the other object, not readable");
  assert.equal(resolveFieldAccess(policy, "reorderRequest", reorderField).cred.R, false, "nor its fields");
});

test("and the reverse: Reorder Request authority confers nothing over Purchase Order data", async () => {
  const repo = new InMemoryPolicyRepository();
  const { reorder, reorderField, poField } = await reorderWorld(repo);

  const reader = await createRole(repo, adminActor(), { key: "reorderReader", name: "Reorder Reader" });
  await repo.transact({ tenantId: TENANT, uid: SYS }, (tx) =>
    tx.setObjectPermission(reader.id, reorder.id, { C: false, R: true, E: false, D: false }));
  await assignTo(repo, "uid-rr", reader.id);

  const policy = await loadPrincipalPolicy(repo, TENANT, "uid-rr");
  assert.equal(resolveFieldAccess(policy, "reorderRequest", reorderField).cred.R, true);
  assert.equal(resolveObjectAccess(policy, "purchaseOrder").cred.R, false);
  assert.equal(resolveFieldAccess(policy, "purchaseOrder", poField).cred.R, false);
});

test("holding BOTH authorities gives both, and still not the action", async () => {
  // Additive union across two objects, with the workflow boundary intact underneath it. The
  // separation must not become a new implication in the other direction.
  const repo = new InMemoryPolicyRepository();
  const { definition, instance, reorder, purchaseOrder, reorderField, poField } = await reorderWorld(repo);

  const both = await createRole(repo, adminActor(), { key: "bothObjects", name: "Both" });
  await grantAll(repo, both.id, reorder.id);
  await grantAll(repo, both.id, purchaseOrder.id);
  await assignTo(repo, "uid-both", both.id);

  const policy = await loadPrincipalPolicy(repo, TENANT, "uid-both");
  assert.equal(resolveFieldAccess(policy, "reorderRequest", reorderField).cred.E, true);
  assert.equal(resolveFieldAccess(policy, "purchaseOrder", poField).cred.E, true);

  assert.equal(
    decideWorkflowAction(definition, instance, "approve", {
      tenantId: TENANT, actorUid: "uid-both", roleIds: [both.id], assigneeUid: null,
    }).allowed,
    false,
    "every data authority in the domain still buys no transition",
  );
});

// ============================ the seed follows the ruling ============================

test("the seeded Parts / Purchasing workflow governs the REORDER REQUEST", async () => {
  // It used to say `purchaseOrder`, which was the same conflation in a second place: the states are
  // REORDER_REQUEST_STATUS and an instance moves a reorder request.
  const { PARTS_PURCHASING_WORKFLOW } = await import("../lib/adminPolicy/workflowSeeds.js");
  assert.equal(PARTS_PURCHASING_WORKFLOW.objectKey, "reorderRequest");
});

test("every Parts / Purchasing action names the capability it IS", async () => {
  // Ruling item 4: ids are not renamed, they are MAPPED. An action with no mapping would leave a
  // capability with no home, which is what the separation exists to make impossible.
  const { PARTS_PURCHASING_WORKFLOW } = await import("../lib/adminPolicy/workflowSeeds.js");
  const EXPECTED = {
    approve: "reorder.request.approve",
    reject: "reorder.request.reject",
    assign: "reorder.request.assign",
    startPurchasing: "reorder.request.startPurchasing",
    postPurchasingUpdate: "reorder.request.postPurchasingUpdate",
    recordPurchaseOrder: "reorder.request.recordPurchaseOrder",
    markReceived: "reorder.request.markReceived",
    voidPurchaseOrder: "reorder.purchaseOrder.void",
    cancelFromReady: "reorder.request.cancel",
    cancelFromAssigned: "reorder.request.cancel",
    cancelFromPurchasing: "reorder.request.cancel",
  };
  for (const action of PARTS_PURCHASING_WORKFLOW.actions) {
    assert.equal(action.capabilityId, EXPECTED[action.key], `${action.key} maps to its measured capability`);
  }
  assert.equal(PARTS_PURCHASING_WORKFLOW.actions.length, Object.keys(EXPECTED).length, "and none is missing");
});

test("postPurchasingUpdate is a SELF-TRANSITION, and is still an action", async () => {
  // It records progress and deliberately does not move the record. Dropping it because from === to
  // would have lost a real authority from the model.
  const { PARTS_PURCHASING_WORKFLOW } = await import("../lib/adminPolicy/workflowSeeds.js");
  const action = PARTS_PURCHASING_WORKFLOW.actions.find((a) => a.key === "postPurchasingUpdate");
  assert.ok(action);
  assert.equal(action.from, "PURCHASING_IN_PROGRESS");
  assert.equal(action.to, action.from);
});

test("a self-transition is a runnable definition and is authorized like any other action", async () => {
  // A self-loop must not trip the structural validator, and must still require a Role binding.
  const repo = new InMemoryPolicyRepository();
  const roles = await seedRoles(repo, ["admin", "partsAssociate", "outsider"]);
  const applied = await applyWorkflowSeed(repo, adminActor(), {
    key: "selfLoop", name: "Self loop", description: "d", objectKey: "reorderRequest",
    steps: [
      { key: "IN_PROGRESS", label: "In progress", initial: true },
      { key: "DONE", label: "Done", terminal: true },
    ],
    actions: [
      { key: "postUpdate", label: "Post update", from: "IN_PROGRESS", to: "IN_PROGRESS", roleKeys: ["partsAssociate"] },
      { key: "finish", label: "Finish", from: "IN_PROGRESS", to: "DONE", roleKeys: ["partsAssociate"] },
    ],
  });
  await publishWorkflowVersion(repo, adminActor(), { versionId: applied.version.id });
  const definition = await loadWorkflowVersionDefinition(repo, TENANT, applied.version.id);
  const instance = await repo.transact({ tenantId: TENANT, uid: SYS }, (tx) =>
    tx.createWorkflowInstance({
      workflowVersionId: applied.version.id, objectKey: "reorderRequest",
      recordId: "rr-2", currentStepKey: "IN_PROGRESS",
    }),
  );

  const base = { tenantId: TENANT, actorUid: "uid-x", assigneeUid: null };
  assert.equal(
    decideWorkflowAction(definition, instance, "postUpdate", { ...base, roleIds: [roles.partsAssociate.id] }).allowed,
    true,
    "the bound Role may perform it",
  );
  assert.equal(
    decideWorkflowAction(definition, instance, "postUpdate", { ...base, roleIds: [roles.outsider.id] }).refusal,
    "notBoundToRole",
    "and an unbound Role may not -- a self-loop is not a free action",
  );
});
