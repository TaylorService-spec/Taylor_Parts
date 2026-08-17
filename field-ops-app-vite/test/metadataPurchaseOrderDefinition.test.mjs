// Purchase Order entity + purchaseOrder.index — S-COM-PURCHASE-ORDER-DEFINITION.
//
// Pins the intended behavior for the LIVE `reorder_purchase_orders` collection, never the
// dormant Epic-5 `purchase_orders` collection. Honest about what this record does NOT have — a
// server-allocated PO-YYYY-###### reference, any stored money, an updatedAt/updatedBy pair, a
// registered `reorderRequest` entity to hang a RELATED list from — rather than idealizing any
// of them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateEntityDefinition, findField } from "../src/metadata/entityDefinition.js";
import { validateListViewDefinition, requiredIndexes } from "../src/metadata/listViewDefinition.js";
import { purchaseOrderEntity, purchaseOrderIndexList } from "../src/metadata/definitions/purchaseOrder.js";
import { PURCHASE_ORDERS_COLLECTION, PURCHASE_ORDER_STATUS } from "../src/domain/constants.js";

test("the Purchase Order entity is valid against the contract", () => {
  assert.deepEqual(validateEntityDefinition(purchaseOrderEntity), []);
});

test("the Purchase Order index list is valid against the entity", () => {
  assert.deepEqual(validateListViewDefinition(purchaseOrderIndexList, purchaseOrderEntity), []);
});

test("the entity id is exactly \"purchaseOrder\", collection is the LIVE reorder_purchase_orders", () => {
  assert.equal(purchaseOrderEntity.id, "purchaseOrder");
  assert.equal(purchaseOrderEntity.collection, PURCHASE_ORDERS_COLLECTION);
  assert.equal(purchaseOrderEntity.collection, "reorder_purchase_orders");
  // The dormant Epic-5 collection is a different string entirely -- this definition must never
  // resolve to it.
  assert.notEqual(purchaseOrderEntity.collection, "purchase_orders");
});

test("read is CLIENT_DIRECT with no capability -- Rules gate by role/relationship, not by capability", () => {
  assert.equal(purchaseOrderEntity.readVia, "CLIENT_DIRECT");
  assert.equal(purchaseOrderEntity.readCapability, null);
});

test("identity is a nameField only -- no server-allocated reference exists to promote", () => {
  // No PO-YYYY-###### (or any allocate*Number sequence) exists anywhere for this collection or
  // its linked Reorder Request. externalPoNumber is required and human-typed, but it is the
  // supplier's own external document number -- not server-allocated, not enforced unique -- so
  // it carries nameField, never referenceField.
  assert.equal(purchaseOrderEntity.identity.nameField, "externalPoNumber");
  assert.equal(purchaseOrderEntity.identity.referenceField, null);
  assert.ok(findField(purchaseOrderEntity, "externalPoNumber"));
});

test("reorderRequestId is declared as its own ID field, equal to the doc id, not promoted into identity", () => {
  const reorderRequestId = findField(purchaseOrderEntity, "reorderRequestId");
  assert.equal(reorderRequestId.type, "ID");
  assert.notEqual(purchaseOrderEntity.identity.nameField, "reorderRequestId");
  assert.notEqual(purchaseOrderEntity.identity.referenceField, "reorderRequestId");
});

test("no money is declared anywhere on this entity -- none is stored", () => {
  // Unlike salesOrder.js (a free-form currency string) or opportunity.js (expectedValue), this
  // record has no price/amount/total field of any kind. Neither a currency column nor a
  // CURRENCY_MINOR-typed field should exist.
  for (const name of ["currency", "unitPrice", "totalCost", "amount", "price", "cost"]) {
    assert.equal(findField(purchaseOrderEntity, name), null, name);
  }
  const fieldTypes = purchaseOrderEntity.fields.map((f) => f.type);
  assert.ok(!fieldTypes.includes("CURRENCY_MINOR"), "no field should be typed CURRENCY_MINOR");
});

test("orderedQuantity is a plain unit count, not a monetary amount", () => {
  const qty = findField(purchaseOrderEntity, "orderedQuantity");
  assert.equal(qty.type, "NUMBER");
});

test("there is no embedded line-items array and no line-item column -- this record is 1:1 with one Part", () => {
  for (const name of ["lines", "lineItems", "items"]) {
    assert.equal(findField(purchaseOrderEntity, name), null, name);
  }
  assert.ok(findField(purchaseOrderEntity, "partId"));
});

test("partId is a REFERENCE to the registered `part` entity, and is not filterable", () => {
  const partId = findField(purchaseOrderEntity, "partId");
  assert.equal(partId.type, "REFERENCE");
  assert.equal(partId.referenceTo, "part");
  // Nothing server-side queries this collection by partId today -- declaring a filter here
  // would promise a query that has never been needed.
  assert.equal(partId.filterable, false);
});

test("supplierName stays a plain STRING -- it is a name, not an id, and no supplier entity is registered", () => {
  const supplierName = findField(purchaseOrderEntity, "supplierName");
  assert.equal(supplierName.type, "STRING");
  assert.notEqual(supplierName.type, "REFERENCE");
});

test("orderedDate / expectedArrivalDate are DATE, not TIMESTAMP -- plain YYYY-MM-DD strings", () => {
  const orderedDate = findField(purchaseOrderEntity, "orderedDate");
  const expectedArrivalDate = findField(purchaseOrderEntity, "expectedArrivalDate");
  assert.equal(orderedDate.type, "DATE");
  assert.equal(expectedArrivalDate.type, "DATE");
  assert.notEqual(orderedDate.type, "TIMESTAMP");
  assert.notEqual(expectedArrivalDate.type, "TIMESTAMP");
});

test("status has exactly the one legal stored value, and is rendered but never filterable", () => {
  const status = findField(purchaseOrderEntity, "status");
  assert.equal(status.type, "ENUM");
  assert.deepEqual([...status.enumValues], [PURCHASE_ORDER_STATUS.ORDERED]);
  assert.equal(status.enumLabels[PURCHASE_ORDER_STATUS.ORDERED], "Ordered");
  // The #1093 lesson: label must differ from the stored machine value.
  assert.notEqual(status.enumLabels[PURCHASE_ORDER_STATUS.ORDERED], PURCHASE_ORDER_STATUS.ORDERED);
  // A field that can only ever equal one value must not promise a real filter.
  assert.equal(status.filterable, false);
  assert.deepEqual([...status.operators], []);
});

test("the computed view status (OPEN/RECEIVED/VOIDED/ORPHAN) is never declared as a stored field", () => {
  // domain/purchaseOrdersView.js derives this by joining against the linked reorder_requests
  // document -- it is never written to a reorder_purchase_orders document, so no
  // FieldDefinition may claim it as stored data.
  for (const name of ["viewStatus", "isReceiptCandidate"]) {
    assert.equal(findField(purchaseOrderEntity, name), null, name);
  }
});

test("provenance: createdAt is NUMBER (epoch ms), createdBy is a plain actor-uid string, and there is no updatedAt/updatedBy", () => {
  const createdAt = findField(purchaseOrderEntity, "createdAt");
  const createdBy = findField(purchaseOrderEntity, "createdBy");
  assert.equal(createdAt.type, "NUMBER");
  assert.notEqual(createdAt.type, "TIMESTAMP");
  assert.equal(createdBy.type, "STRING");
  // `allow update, delete: if false` -- this document is never updated after creation, so an
  // updatedAt/updatedBy pair would describe a write path that cannot exist.
  for (const name of ["updatedAt", "updatedBy"]) {
    assert.equal(findField(purchaseOrderEntity, name), null, name);
  }
});

test("no outbound relationships are declared -- the one real parent edge has no registered owning entity", () => {
  assert.equal(purchaseOrderEntity.relationships.length, 0);
});

test("the index list declares no filters -- no real backend query filters this collection by a field of its own", () => {
  assert.deepEqual(purchaseOrderIndexList.filters, []);
});

test("the index list demands no composite index at all -- one sort field, zero filters", () => {
  const required = requiredIndexes(purchaseOrderIndexList, purchaseOrderEntity);
  assert.deepEqual(required, []);
});

test("default sort is createdAt DESC -- most recent order first, with the __name__ tiebreaker", () => {
  assert.deepEqual(
    purchaseOrderIndexList.defaultSort.map((s) => [s.fieldId, s.direction]),
    [["createdAt", "DESC"]]
  );
  assert.equal(purchaseOrderIndexList.tiebreaker, "__name__");
});
