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

// THE SEED IS READ FROM THE SERVER'S OWN SOURCE. The client no longer carries a copy of any workflow
// definition (Administration > Workflows reads the tenant's stored versions from the EOS API), so the
// separation is proved against functions/src/adminPolicy/workflowSeeds.ts directly. Parsing the
// declared action literals is enough: each action is one `{ key: ..., from: ..., to: ..., ... }` line.
const SEED_SOURCE = readFileSync("../functions/src/adminPolicy/workflowSeeds.ts", "utf8");
function seedFamily(constName) {
  const start = SEED_SOURCE.indexOf(`export const ${constName}: SeedWorkflow`);
  assert.ok(start >= 0, `the seed declares ${constName}`);
  const end = SEED_SOURCE.indexOf("export const", start + 1);
  const block = SEED_SOURCE.slice(start, end < 0 ? undefined : end);
  const field = (line, name) => line.match(new RegExp(`${name}: "([^"]*)"`))?.[1] ?? null;
  const actions = [...block.matchAll(/^\s*\{ key: "[^"]+", label: "[^"]*", from: .*$/gm)].map(([line]) => ({
    key: field(line, "key"), from: field(line, "from"), to: field(line, "to"), capabilityId: field(line, "capabilityId"),
  }));
  return { key: field(block, "key"), objectKey: field(block, "objectKey"), actions };
}
const REORDER_FAMILY = seedFamily("PARTS_PURCHASING_WORKFLOW");
const SEED_FAMILIES = ["PARTS_PURCHASING_WORKFLOW", "WORK_ORDER_WORKFLOW", "OPPORTUNITY_WORKFLOW",
  "SALES_AGREEMENT_WORKFLOW", "SALES_ORDER_WORKFLOW"].map(seedFamily);

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
    SEED_FAMILIES.flatMap((f) => f.actions.map((a) => a.capabilityId)).filter(Boolean),
  );
  for (const id of WORKFLOW_ACTION_CAPABILITIES) {
    assert.ok(boundIds.has(id), `${id} is banned from CRED but bound to no workflow action`);
  }
});

test("every reorder.* capability an action names is declared a workflow action", () => {
  // And the converse, so the two lists are exactly each other rather than merely overlapping. SCOPED
  // to the reorder.* family this ruling is about: the Work Order and Sales actions now name the
  // capability their PostgreSQL command path checks (workOrder.transition, salesOrder.write, ...),
  // which are Object capabilities outside the reorder CRUD matrix this separation governs.
  for (const family of SEED_FAMILIES) {
    for (const action of family.actions) {
      if (!action.capabilityId || !action.capabilityId.startsWith("reorder.")) continue;
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

test("the parsed seed is not vacuous: every Parts / Purchasing action and its capability was read", () => {
  // There is no client mirror any more -- so the check that replaces the mirror comparison is that
  // the parser above actually read the seed, rather than returning nothing and passing everything.
  assert.equal(REORDER_FAMILY.actions.length, 11);
  assert.ok(REORDER_FAMILY.actions.every((a) => a.capabilityId), "every reorder action names its capability");
  assert.ok(SEED_SOURCE.includes('objectKey: "reorderRequest"'), "and the seed governs the reorder request");
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
