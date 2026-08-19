// Sales Order definition — the second Account related-list CALLABLE-read dependency, and the
// first whose identity field is not yet returned end-to-end by its own read projection.
//
// These assertions pin the intended behavior the definition describes: identity is the
// reference with no invented nameField, no unitPrice column is declared (PR #991's pricing
// exclusion), currency is not declared as a currency type (no minor-unit amount is stored), and
// state labels come from the domain module rather than a second copy inside the definition.

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateEntityDefinition, findField } from "../src/metadata/entityDefinition.js";
import { validateListViewDefinition, requiredIndexes } from "../src/metadata/listViewDefinition.js";
import { accountEntity } from "../src/metadata/definitions/account.js";
import { salesOrderEntity, salesOrderRelatedList, salesOrderIndexList } from "../src/metadata/definitions/salesOrder.js";
import { SALES_ORDER_STATE_VALUES, SALES_ORDER_STATE_LABEL } from "../src/domain/salesOrderStatus.js";

const accountRelationships = accountEntity.relationships;

test("the entity is valid, and so are both lists", () => {
  assert.deepEqual(validateEntityDefinition(salesOrderEntity), []);
  assert.deepEqual(validateListViewDefinition(salesOrderRelatedList, salesOrderEntity, accountRelationships), []);
  assert.deepEqual(validateListViewDefinition(salesOrderIndexList, salesOrderEntity), []);
});

test("the related-list edge is declared on ACCOUNT, the entity that owns it", () => {
  const rel = accountRelationships.find((r) => r.id === "account.salesOrders");
  assert.ok(rel, "account.salesOrders must be declared on account.js");
  assert.equal(rel.toEntityId, "salesOrder");
  assert.equal(rel.viaField, "accountId");
  // Declared once, on the owning side — the same rule account.opportunities follows.
  assert.equal(salesOrderEntity.relationships.length, 0);
});

test("traversing to Sales Orders carries the TARGET's authority, not the Account's", () => {
  const rel = accountRelationships.find((r) => r.id === "account.salesOrders");
  assert.equal(rel.traversalCapability, "salesOrder.read");
});

test("Sales Order is CALLABLE-read, matching the trusted read service", () => {
  assert.equal(salesOrderEntity.readVia, "CALLABLE");
  assert.equal(salesOrderEntity.readCallable, "listSalesOrdersForAccount");
  assert.equal(salesOrderEntity.readCapability, "salesOrder.read");
  assert.equal(salesOrderEntity.collection, "sales_orders");
});

test("identity is the reference number, and NO nameField is declared", () => {
  // A Sales Order has no human-entered name field anywhere in its write paths. Declaring one
  // to satisfy the identity contract would be inventing data, not describing it.
  assert.equal(salesOrderEntity.identity.referenceField, "salesOrderNumber");
  assert.equal(salesOrderEntity.identity.nameField, null);
  assert.ok(findField(salesOrderEntity, "salesOrderNumber"));
});

test("no unitPrice column is declared — PR #991 excluded it from the read projection", () => {
  assert.equal(findField(salesOrderEntity, "unitPrice"), null);
  // `lines` is an embedded array on the document, not a flat column any list can render.
  assert.equal(findField(salesOrderEntity, "lines"), null);
});

test("currency is NOT declared as a currency type — no minor-unit amount is stored", () => {
  const currency = findField(salesOrderEntity, "currency");
  assert.equal(currency.type, "STRING");
  assert.notEqual(currency.type, "CURRENCY_MINOR");
});

test("state vocabulary comes from the domain module, not a copy", () => {
  const state = findField(salesOrderEntity, "state");
  assert.deepEqual([...state.enumValues], [...SALES_ORDER_STATE_VALUES]);
  assert.deepEqual({ ...state.enumLabels }, { ...SALES_ORDER_STATE_LABEL });
});

test("the Sales Orders section can hand off — a capped section with nowhere to go lies", () => {
  assert.equal(salesOrderRelatedList.surface, "RELATED");
  assert.equal(salesOrderRelatedList.viewAllListId, "salesOrder.index");
  assert.equal(salesOrderIndexList.id, "salesOrder.index");
});

test("the index list demands exactly one composite index, over state + salesOrderNumber", () => {
  const demanded = requiredIndexes(salesOrderIndexList, salesOrderEntity);
  assert.equal(demanded.length, 1);
  assert.equal(demanded[0].collectionGroup, "sales_orders");
  assert.deepEqual(
    demanded[0].fields.map((f) => f.fieldPath),
    ["state", "salesOrderNumber", "__name__"]
  );
});

test("the related list demands no index of its own — a capped, unfiltered section needs none", () => {
  assert.deepEqual(requiredIndexes(salesOrderRelatedList, salesOrderEntity), []);
});

test("the index list names the unscoped read built for it, NOT the account-scoped one", () => {
  // This test previously pinned the ABSENCE of a readCallable, because salesOrderReadService.ts
  // exported only an account-scoped list and a single-record read. That absence was the honest
  // state then and the pin was correct — X-SALES-ORDER-NO-UNSCOPED-READ closed it by building
  // the missing read rather than by widening the account-scoped one.
  //
  // The distinction the assertion protects: the account-scoped related list and the unscoped
  // index are DIFFERENT reads with different authority shapes. Reusing listSalesOrdersForAccount
  // for an INDEX surface was explicitly ruled out, so this asserts which callable is named, not
  // merely that one is.
  assert.equal(salesOrderIndexList.readCallable, "listSalesOrderIndex");
  assert.notEqual(salesOrderIndexList.readCallable, "listSalesOrdersForAccount");
  assert.equal(salesOrderRelatedList.readCallable ?? null, null, "the related list still inherits the entity's account-scoped read");
});

test("locationId is a REFERENCE to location, optional in storage, and adds no filter/sort/index demand", () => {
  // `location` is now a registered entity (definitions/location.js). Unlike
  // equipment.locationId, this collection is deny-all/callable-read, so there is no
  // Rules-level accountId cross-check to describe here -- just the pointer itself.
  const locationId = findField(salesOrderEntity, "locationId");
  assert.equal(locationId.type, "REFERENCE");
  assert.equal(locationId.referenceTo, "location");
  // Not filterable/sortable -- the type upgrade alone must not change what
  // requiredIndexes() demands. salesOrderCommands.ts stores `locationId: string | null`,
  // so a Sales Order without a location set is a real, expected shape, not a bug.
  assert.equal(locationId.filterable, false);
  assert.equal(locationId.sortable, false);
  assert.deepEqual(locationId.operators, []);
  const indexIndexes = requiredIndexes(salesOrderIndexList, salesOrderEntity);
  const relatedIndexes = requiredIndexes(salesOrderRelatedList, salesOrderEntity);
  for (const idx of [...indexIndexes, ...relatedIndexes]) {
    assert.ok(!idx.fields.some((f) => f.fieldPath === "locationId"), "no index should reference locationId");
  }
});
