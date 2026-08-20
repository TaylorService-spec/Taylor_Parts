// Work Order entity + workOrder.index — Gate B, the first non-CRM definition.
//
// Account proved the contracts describe a list of parties. These ask whether the same
// model holds for an OPERATIONAL record: a job moving through a lifecycle. Three of them
// pin findings this definition surfaced rather than properties it merely satisfies.

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateEntityDefinition, findField } from "../src/metadata/entityDefinition.js";
import { validateListViewDefinition, requiredIndexes } from "../src/metadata/listViewDefinition.js";
import { workOrderEntity, workOrderIndexList } from "../src/metadata/definitions/workOrder.js";
import { WORK_ORDER_STATUS_LABEL } from "../src/domain/workOrderStatus.js";
import { WORK_ORDER_PRIORITY_LABEL } from "../src/domain/workOrderPriority.js";

test("the Work Order entity is valid against the contract", () => {
  assert.deepEqual(validateEntityDefinition(workOrderEntity), []);
});

test("the Work Orders list is valid against the entity", () => {
  assert.deepEqual(validateListViewDefinition(workOrderIndexList, workOrderEntity), []);
});

test("identity is the REFERENCE number, and claims no name field", () => {
  // A Work Order is called by its number. The nearest thing to a name — the complaint —
  // is optional on the record, and an identity field that is frequently absent is worse
  // than none: it licenses a fallback, and the fallback is always the document id.
  assert.equal(workOrderEntity.identity.referenceField, "woNumber");
  assert.equal(workOrderEntity.identity.nameField, null);
  assert.ok(findField(workOrderEntity, "woNumber"));
});

test("a NUMERIC enum is valid — priority is stored as 1..4 and labelled with a word", () => {
  // The finding this pins: object keys are strings, so a numeric enum could never match
  // its own label entry and every numeric enum was reported as mislabelled. Keeping the
  // machine value numeric matters — a definition storing the word makes the number
  // unrecoverable.
  const priority = findField(workOrderEntity, "priority");
  assert.deepEqual(priority.enumValues, [1, 2, 3, 4]);
  assert.equal(priority.enumLabels[1], "Emergency");
  assert.deepEqual(validateEntityDefinition(workOrderEntity), []);
});

test("status and priority vocabulary come from domain/, not a copy here", () => {
  // Both maps already exist because surfaces disagreed about the same record. The
  // metadata layer must not become the next surface that disagrees.
  const status = findField(workOrderEntity, "status");
  // deepEqual, not identity: the factory copies and freezes, so sameness of CONTENT is
  // the property that matters — a drifted copy is what this guards.
  assert.deepEqual({ ...status.enumLabels }, { ...WORK_ORDER_STATUS_LABEL });
  assert.deepEqual({ ...findField(workOrderEntity, "priority").enumLabels }, { ...WORK_ORDER_PRIORITY_LABEL });
});

test("priority is a column but NOT a filter, and the index count is why", () => {
  // Three optional filters demand seven composites; two demand three. Priority is the
  // least load-bearing — a dispatcher filters to a customer or a state and reads priority
  // off the row.
  assert.ok(workOrderIndexList.columns.some((c) => c.fieldId === "priority"));
  assert.ok(!workOrderIndexList.filters.some((f) => f.fieldId === "priority"));
  assert.equal(requiredIndexes(workOrderIndexList, workOrderEntity).length, 3);
});

test("assignedTechId renders but claims no filter — its display name lives elsewhere", () => {
  // A filter on a raw technician id offers a control whose values a user cannot type.
  const tech = findField(workOrderEntity, "assignedTechId");
  assert.equal(tech.filterable, false);
  assert.deepEqual(tech.operators, []);
  assert.equal(tech.referenceTo, "employee");
});

test("the open-work view filters by the non-terminal states, not by NOT_EQUALS", () => {
  // Firestore serves an IN from the same index an equality uses; a pair of NOT_EQUALS
  // would not be servable at all.
  const open = workOrderIndexList.savedViews.find((v) => v.id === "open");
  assert.equal(open.filters[0].operator, "IN");
  assert.ok(!open.filters[0].value.includes("CLOSED"));
  assert.ok(!open.filters[0].value.includes("CANCELLED"));
  assert.ok(open.filters[0].value.includes("WORK_IN_PROGRESS"));
});

test("every demanded index is expressed in Firestore's vocabulary", () => {
  for (const idx of requiredIndexes(workOrderIndexList, workOrderEntity)) {
    assert.equal(idx.collectionGroup, "fieldops_wos");
    for (const field of idx.fields) {
      assert.ok(field.arrayConfig === "CONTAINS" || ["ASCENDING", "DESCENDING"].includes(field.order));
    }
  }
});
