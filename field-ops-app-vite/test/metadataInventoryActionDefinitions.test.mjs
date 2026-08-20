// Inventory Action + Purchase Order Void definition contracts — A-ENTITY-INVENTORY-ACTION-
// DEFINITIONS, the FINAL slice of A-ENTITY-MASS-DEFINITION.
//
// Both entities were classified DEFINE by the entity-coverage reconciliation (docs/orchestration/
// metadata-program/entity-coverage-reconciliation.md §1.11, §1.20) — the last two of the 22
// remaining uncovered collections that genuinely belong to this program. Both resolve to
// identityMode SYSTEM_ONLY, explicitly declared, matching inventoryTransaction.js's own
// Owner-ruled precedent (A-IDENTITY-MODES, X-INVENTORY-TRANSACTION-NO-IDENTITY): neither entity
// has a human-typed name nor a server-allocated business reference of its own.
//
// inventory_actions: write AND a scoped read are both LIVE and actively authorized today — no
// inactive capability, no Rules deny-all, no pending decision (the cheapest DEFINE in the
// reconciliation's ranked list).
//
// reorder_purchase_order_voids: write shares the same global isWriteBlocked() demo/panic kill
// switch two already-merged siblings (reorderRequest.js, purchaseOrder.js) also use; read is
// LIVE, role-gated, and cross-document-validated — correcting an assumption in purchaseOrder.js's
// own header that this collection was out of reach.

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateEntityDefinition, validateEntityRegistry, findField, resolveIdentityMode } from "../src/metadata/entityDefinition.js";
import { inventoryActionEntity } from "../src/metadata/definitions/inventoryAction.js";
import { purchaseOrderVoidEntity } from "../src/metadata/definitions/purchaseOrderVoid.js";
import { partEntity } from "../src/metadata/definitions/part.js";
import { reorderRequestEntity } from "../src/metadata/definitions/reorderRequest.js";
import { INVENTORY_ACTION_TYPE } from "../src/domain/constants.js";

// ---------------------------------------------------------------------------------------------
// Contract validity
// ---------------------------------------------------------------------------------------------

test("the Inventory Action entity is valid against the contract", () => {
  assert.deepEqual(validateEntityDefinition(inventoryActionEntity), []);
});

test("the Purchase Order Void entity is valid against the contract", () => {
  assert.deepEqual(validateEntityDefinition(purchaseOrderVoidEntity), []);
});

test("this suite's own two entities introduce no unresolved REFERENCE against the real registered part/reorderRequest entities", () => {
  // validateEntityRegistry() re-validates EVERY entity's OWN fields, not just cross-entity
  // reference resolution — so a registry built to check inventoryActionEntity/
  // purchaseOrderVoidEntity's references also re-surfaces reorderRequest.js's and part.js's
  // pre-existing (unrelated) REFERENCE fields (purchaseOrderId, workOrderId, equipmentModelId,
  // and their own further transitive chain). Rather than grow this file's import list to satisfy
  // a chain this suite does not own, filter the registry's problems down to only the ones this
  // suite's own two entities could actually cause — the completeness question is "does MY
  // referenceTo resolve", not "is the whole registry clean" (that is ALL_REGISTERED_ENTITIES'
  // own job in metadataEntityDefinition.test.mjs once these two are registered there).
  const registry = [inventoryActionEntity, purchaseOrderVoidEntity, partEntity, reorderRequestEntity];
  const problems = validateEntityRegistry(registry).filter(
    (p) => p.startsWith("entity inventoryAction:") || p.startsWith("entity purchaseOrderVoid:")
  );
  assert.deepEqual(problems, []);
});

test("Inventory Action's partId and Purchase Order Void's partId/reorderRequestId resolve to entities actually registered in this program", () => {
  assert.equal(findField(inventoryActionEntity, "partId").referenceTo, partEntity.id);
  assert.equal(findField(purchaseOrderVoidEntity, "partId").referenceTo, partEntity.id);
  assert.equal(findField(purchaseOrderVoidEntity, "reorderRequestId").referenceTo, reorderRequestEntity.id);
});

// ---------------------------------------------------------------------------------------------
// Identity — DECISIONS #106, both entities SYSTEM_ONLY, explicitly declared
// ---------------------------------------------------------------------------------------------

test("Inventory Action identity is SYSTEM_ONLY, explicitly declared -- no nameField, no referenceField", () => {
  assert.equal(inventoryActionEntity.identity.nameField, null);
  assert.equal(inventoryActionEntity.identity.referenceField, null);
  assert.equal(inventoryActionEntity.identity.mode, "SYSTEM_ONLY");
  assert.equal(resolveIdentityMode(inventoryActionEntity.identity), "SYSTEM_ONLY");
});

test("Purchase Order Void identity is SYSTEM_ONLY, explicitly declared -- no nameField, no referenceField", () => {
  assert.equal(purchaseOrderVoidEntity.identity.nameField, null);
  assert.equal(purchaseOrderVoidEntity.identity.referenceField, null);
  assert.equal(purchaseOrderVoidEntity.identity.mode, "SYSTEM_ONLY");
  assert.equal(resolveIdentityMode(purchaseOrderVoidEntity.identity), "SYSTEM_ONLY");
});

test("neither entity nominates a category/free-text field as identity -- transactionType and reason are NOT the nameField/referenceField", () => {
  // The exact anti-pattern the ledger's X-INVENTORY-TRANSACTION-NO-IDENTITY entry names as the
  // reason a prior definition (this program's own inventory_transactions) was held back.
  assert.notEqual(inventoryActionEntity.identity.nameField, "transactionType");
  assert.notEqual(inventoryActionEntity.identity.referenceField, "transactionType");
  assert.notEqual(purchaseOrderVoidEntity.identity.nameField, "reason");
  assert.notEqual(purchaseOrderVoidEntity.identity.referenceField, "reason");
});

// ---------------------------------------------------------------------------------------------
// No ID-typed field is ever nominated for display -- the validator rejects it, and neither
// definition attempts it in the first place.
// ---------------------------------------------------------------------------------------------

test("no ID-typed field is nominated as nameField or referenceField on either entity", () => {
  for (const entity of [inventoryActionEntity, purchaseOrderVoidEntity]) {
    const idFields = entity.fields.filter((f) => f.type === "ID").map((f) => f.id);
    assert.ok(idFields.length > 0, `${entity.id} should declare its own document-id field`);
    for (const idFieldId of idFields) {
      assert.notEqual(entity.identity.nameField, idFieldId);
      assert.notEqual(entity.identity.referenceField, idFieldId);
    }
  }
});

// ---------------------------------------------------------------------------------------------
// readVia -- both CLIENT_DIRECT, actively role-gated in Rules, no capability evaluated
// ---------------------------------------------------------------------------------------------

test("Inventory Action read is CLIENT_DIRECT with no capability -- a matching catalog id (inventory.action.read) exists but nothing evaluates it on this read path", () => {
  assert.equal(inventoryActionEntity.readVia, "CLIENT_DIRECT");
  assert.equal(inventoryActionEntity.readCapability, null);
  assert.equal(inventoryActionEntity.collection, "inventory_actions");
});

test("Purchase Order Void read is CLIENT_DIRECT with no capability -- the catalog's reorder.purchaseOrder.void id is write-side only, no read id exists", () => {
  assert.equal(purchaseOrderVoidEntity.readVia, "CLIENT_DIRECT");
  assert.equal(purchaseOrderVoidEntity.readCapability, null);
  assert.equal(purchaseOrderVoidEntity.collection, "reorder_purchase_order_voids");
});

// ---------------------------------------------------------------------------------------------
// Inventory Action fields
// ---------------------------------------------------------------------------------------------

test("Inventory Action fields match the sole writer's shape exactly: actionId, partId, transactionType, quantityDelta, reason, notes, createdBy, createdAt", () => {
  for (const id of ["actionId", "partId", "transactionType", "quantityDelta", "reason", "notes", "createdBy", "createdAt"]) {
    assert.ok(findField(inventoryActionEntity, id), id);
  }
  assert.equal(inventoryActionEntity.fields.length, 8);
});

test("partId is a REFERENCE to the registered `part` entity", () => {
  const partId = findField(inventoryActionEntity, "partId");
  assert.equal(partId.type, "REFERENCE");
  assert.equal(partId.referenceTo, "part");
});

test("transactionType is the exact three-value INVENTORY_ACTION_TYPE union, labels differ from their machine values", () => {
  const field = findField(inventoryActionEntity, "transactionType");
  assert.equal(field.type, "ENUM");
  assert.deepEqual([...field.enumValues].sort(), [...Object.values(INVENTORY_ACTION_TYPE)].sort());
  for (const v of field.enumValues) {
    assert.notEqual(field.enumLabels[v], v, v); // the #1093 lesson
  }
});

test("createdAt is NUMBER (client-clock Date.now()), never TIMESTAMP", () => {
  assert.equal(findField(inventoryActionEntity, "createdAt").type, "NUMBER");
});

test("createdBy is recorded as a client-supplied claim, not server-validated -- unlike purchaseOrder.js's own createdBy and Purchase Order Void's voidedBy", () => {
  const createdBy = findField(inventoryActionEntity, "createdBy");
  assert.equal(createdBy.type, "STRING");
  assert.match(createdBy.description, /not.*validated|client-supplied claim/i);
});

test("no relationships are declared on Inventory Action", () => {
  assert.equal(inventoryActionEntity.relationships.length, 0);
});

// ---------------------------------------------------------------------------------------------
// Purchase Order Void fields
// ---------------------------------------------------------------------------------------------

test("Purchase Order Void fields match the sole writer's shape exactly: reorderPurchaseOrderId, reorderRequestId, partId, voidedBy, reason, createdAt", () => {
  for (const id of ["reorderPurchaseOrderId", "reorderRequestId", "partId", "voidedBy", "reason", "createdAt"]) {
    assert.ok(findField(purchaseOrderVoidEntity, id), id);
  }
  assert.equal(purchaseOrderVoidEntity.fields.length, 6);
});

test("reorderRequestId is a REFERENCE to the registered `reorderRequest` entity, distinct from the document id field", () => {
  const reorderRequestId = findField(purchaseOrderVoidEntity, "reorderRequestId");
  assert.equal(reorderRequestId.type, "REFERENCE");
  assert.equal(reorderRequestId.referenceTo, "reorderRequest");
  assert.equal(findField(purchaseOrderVoidEntity, "reorderPurchaseOrderId").type, "ID");
});

test("partId is a REFERENCE to the registered `part` entity", () => {
  const partId = findField(purchaseOrderVoidEntity, "partId");
  assert.equal(partId.type, "REFERENCE");
  assert.equal(partId.referenceTo, "part");
});

test("voidedBy is server-validated (== request.auth.uid by firestore.rules), unlike Inventory Action's createdBy", () => {
  const voidedBy = findField(purchaseOrderVoidEntity, "voidedBy");
  assert.equal(voidedBy.type, "STRING");
  assert.match(voidedBy.description, /request\.auth\.uid/);
});

test("reason is required free text (TEXT), not identity", () => {
  assert.equal(findField(purchaseOrderVoidEntity, "reason").type, "TEXT");
});

test("createdAt is NUMBER (client-clock Date.now(), cross-document pinned to the linked Reorder Request's voidedAt), never TIMESTAMP", () => {
  assert.equal(findField(purchaseOrderVoidEntity, "createdAt").type, "NUMBER");
});

test("no relationships are declared on Purchase Order Void", () => {
  assert.equal(purchaseOrderVoidEntity.relationships.length, 0);
});

// ---------------------------------------------------------------------------------------------
// Deliberate absences -- no list view declared for either entity
// ---------------------------------------------------------------------------------------------

test("neither entity exports a ListViewDefinition -- no real query browses either collection as a list", async () => {
  const inventoryActionModule = await import("../src/metadata/definitions/inventoryAction.js");
  const purchaseOrderVoidModule = await import("../src/metadata/definitions/purchaseOrderVoid.js");
  assert.deepEqual(Object.keys(inventoryActionModule), ["inventoryActionEntity"]);
  assert.deepEqual(Object.keys(purchaseOrderVoidModule), ["purchaseOrderVoidEntity"]);
});
