// REORDER REQUEST vs PURCHASE ORDER — the authority separation.
//
// ════════════════════ THE OWNER RULING THIS ENCODES ════════════════════
//
// Reorder Request and Purchase Order are SEPARATE canonical EOS Objects, and the `reorder.request.*`
// family belongs to Reorder Request. The legacy CRUD matrix grouped both records under one "Purchase
// Orders" row, so an administrator granting "Purchase Orders / Read" was also granting the reorder
// queue, and six reorder TRANSITIONS were drawn as Purchase Order EDIT checkboxes.
//
// Two different mistakes lived in that one row:
//
//   WRONG OBJECT    reorder request data authority attributed to the purchase order
//   WRONG KIND      a business action (approve, assign, void) drawn as a data permission
//
// These prove both are gone, and that fixing one did not reintroduce the other.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  OBJECT_PERMISSIONS,
  WORKFLOW_ACTION_CAPABILITIES,
  credCapabilityIds,
  workflowActionsAlsoInCred,
} from "../src/access/objectPermissionMap.js";
import { findGovernableObject, governedVerbs } from "../src/access/policyObjectRegistry.js";
import { SEED_WORKFLOW_FAMILIES } from "../src/domain/adminWorkflowView.js";

const REORDER_FAMILY = SEED_WORKFLOW_FAMILIES.find((f) => f.key === "partsPurchasing");

/** Every capability id the CRUD matrix attributes to one object, across all four verbs. */
function credIdsFor(objectName) {
  const entry = OBJECT_PERMISSIONS.find((e) => e.object === objectName);
  assert.ok(entry, `"${objectName}" is a matrix row`);
  return new Set(["C", "R", "E", "D"].flatMap((v) => entry[v] ?? []));
}

// ============================ 1. DATA AUTHORITY FOLLOWS THE RECORD ============================

test("NO reorder.request.* data permission maps to Purchase Order CRED", () => {
  // The ruling's first required proof, and the exact defect that existed: `read.queue` and
  // `read.own` sat in the Purchase Orders row's R column.
  const purchaseOrder = credIdsFor("Purchase Orders");
  const strays = [...purchaseOrder].filter((id) => id.startsWith("reorder.request."));
  assert.deepEqual(strays, [], "Purchase Orders must claim no reorder request authority");
});

test("reorder request DATA authority is on the Reorder Requests object", () => {
  const reorder = credIdsFor("Reorder Requests");
  assert.deepEqual([...reorder].sort(), [
    "reorder.request.create.manual",
    "reorder.request.create.system",
    "reorder.request.read.queue",
    "reorder.request.read.own",
  ].sort());
});

test("purchase order DATA authority stays on the Purchase Orders object", () => {
  const purchaseOrder = credIdsFor("Purchase Orders");
  assert.deepEqual([...purchaseOrder].sort(), ["reorder.purchaseOrder.create", "reorder.purchaseOrder.read"].sort());
});

test("both objects resolve, each with its own fields", () => {
  const reorder = findGovernableObject("reorderRequest");
  const purchaseOrder = findGovernableObject("purchaseOrder");
  assert.ok(reorder && purchaseOrder, "both are governable objects");
  assert.notEqual(reorder.key, purchaseOrder.key);
  assert.equal(reorder.fields.length, 37);
  assert.equal(purchaseOrder.fields.length, 10);

  // Both now have real Create and Read authority, and neither has Edit -- because every edit-shaped
  // thing either records is a workflow ACTION.
  assert.deepEqual(governedVerbs(reorder), { C: true, R: true, E: false, D: false });
  assert.deepEqual(governedVerbs(purchaseOrder), { C: true, R: true, E: false, D: false });
});

// ============================ 2. ACTIONS ARE NOT CRED ============================

test("NO workflow action is duplicated as a CRED checkbox", () => {
  // The ruling's item 3. One capability, one home -- otherwise an administrator has two
  // contradictory ways to grant the same thing and no way to tell which one took effect.
  assert.deepEqual(workflowActionsAlsoInCred(), []);
});

test("every reorder TRANSITION left the CRUD matrix", () => {
  const cred = credCapabilityIds();
  for (const id of [
    "reorder.request.approve", "reorder.request.reject", "reorder.request.assign",
    "reorder.request.startPurchasing", "reorder.request.postPurchasingUpdate",
    "reorder.request.recordPurchaseOrder", "reorder.request.markReceived", "reorder.request.cancel",
    "reorder.purchaseOrder.void",
  ]) {
    assert.equal(cred.has(id), false, `${id} is a workflow action and must not appear in any CRED row`);
  }
});

test("the PO lifecycle action stays an ACTION, not an Edit", () => {
  // "PO lifecycle actions such as void/receive must remain explicit Workflow actions where that is
  // their measured behaviour." Voiding is the ORDERED -> VOIDED transition and never touches the
  // original purchase-order document -- an append-only void record is written instead.
  assert.ok(WORKFLOW_ACTION_CAPABILITIES.includes("reorder.purchaseOrder.void"));
  assert.equal(credIdsFor("Purchase Orders").has("reorder.purchaseOrder.void"), false);

  const voidAction = REORDER_FAMILY.actions.find((a) => a.key === "voidPurchaseOrder");
  assert.equal(voidAction.capabilityId, "reorder.purchaseOrder.void");
  assert.equal(voidAction.from, "ORDERED");
  assert.equal(voidAction.to, "VOIDED");
});

test("markReceived left the Receiving row, and inventory.stock.receive stayed", () => {
  const receiving = credIdsFor("Receiving");
  assert.equal(receiving.has("reorder.request.markReceived"), false, "it is the ORDERED -> RECEIVED transition");
  assert.ok(receiving.has("inventory.stock.receive"), "the Receiving command's own authority is untouched");
});

// ============================ 3. NO AMBIGUITY ============================

test("every workflow-action capability is bound to a real action in the definition", () => {
  // A list of banned ids that named something no workflow performs would be a ban with no subject.
  const boundIds = new Set(
    SEED_WORKFLOW_FAMILIES.flatMap((f) => f.actions.map((a) => a.capabilityId)).filter(Boolean),
  );
  for (const id of WORKFLOW_ACTION_CAPABILITIES) {
    assert.ok(boundIds.has(id), `${id} is banned from CRED but bound to no workflow action`);
  }
});

test("every capability an action names is declared a workflow action", () => {
  // And the converse, so the two lists are exactly each other rather than merely overlapping.
  for (const family of SEED_WORKFLOW_FAMILIES) {
    for (const action of family.actions) {
      if (!action.capabilityId) continue;
      assert.ok(
        WORKFLOW_ACTION_CAPABILITIES.includes(action.capabilityId),
        `${family.key}.${action.key} names ${action.capabilityId}, which is not declared a workflow action`,
      );
    }
  }
});

test("EVERY reorder.* capability has exactly one home", () => {
  // The completeness check. Fifteen ids exist; each is either data authority on an object or a
  // workflow action, never both and never neither.
  const ALL = [
    "reorder.request.read.queue", "reorder.request.read.own",
    "reorder.request.create.manual", "reorder.request.create.system",
    "reorder.request.assign", "reorder.request.startPurchasing",
    "reorder.request.postPurchasingUpdate", "reorder.request.recordPurchaseOrder",
    "reorder.request.markReceived", "reorder.request.approve", "reorder.request.reject",
    "reorder.request.cancel",
    "reorder.purchaseOrder.read", "reorder.purchaseOrder.create", "reorder.purchaseOrder.void",
  ];
  const cred = credCapabilityIds();
  const actions = new Set(WORKFLOW_ACTION_CAPABILITIES);

  for (const id of ALL) {
    const inCred = cred.has(id);
    const inActions = actions.has(id);
    assert.notEqual(inCred && inActions, true, `${id} has TWO homes`);
    assert.notEqual(!inCred && !inActions, true, `${id} has NO home`);
  }
  assert.equal(ALL.filter((id) => cred.has(id)).length, 6, "six data permissions");
  assert.equal(ALL.filter((id) => actions.has(id)).length, 9, "nine workflow actions");
});

// ============================ 4. THE WORKFLOW GOVERNS THE RIGHT RECORD ============================

test("the Parts / Purchasing workflow governs the REORDER REQUEST", () => {
  // It used to say `purchaseOrder`, which was the same conflation in a second place: its states are
  // REORDER_REQUEST_STATUS and an instance moves a reorder request. The purchase order is a record
  // this workflow creates along the way and later voids.
  assert.equal(REORDER_FAMILY.objectKey, "reorderRequest");
  assert.ok(findGovernableObject(REORDER_FAMILY.objectKey), "and that object exists");
});

test("the seed and the client mirror agree about every capability binding", () => {
  // Two packages, no shared build. The mirror is only safe while something compares them.
  const source = readFileSync("../functions/src/adminPolicy/workflowSeeds.ts", "utf8");
  for (const family of SEED_WORKFLOW_FAMILIES) {
    for (const action of family.actions) {
      if (!action.capabilityId) continue;
      assert.ok(
        source.includes(`capabilityId: "${action.capabilityId}"`),
        `${family.key}.${action.key}: the seed must declare ${action.capabilityId}`,
      );
    }
  }
  assert.ok(source.includes('objectKey: "reorderRequest"'), "and the seed governs the same record");
});

test("postPurchasingUpdate is modelled as the SELF-TRANSITION it measurably is", () => {
  // It records progress and deliberately does not move the record. It is still an action somebody
  // must be permitted to perform, so losing it because from === to would have dropped a real
  // authority from the model.
  const action = REORDER_FAMILY.actions.find((a) => a.key === "postPurchasingUpdate");
  assert.ok(action, "the action exists");
  assert.equal(action.from, "PURCHASING_IN_PROGRESS");
  assert.equal(action.to, "PURCHASING_IN_PROGRESS");
  assert.equal(action.capabilityId, "reorder.request.postPurchasingUpdate");
});
