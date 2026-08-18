// Reorder Request + Receiving Order definition contracts — A-ENTITY-PROCUREMENT-DEFINITIONS,
// A-HELD-DEFINITIONS-IDENTITY.
//
// Both entities were originally held because neither had a human name nor a server-allocated
// business reference — a data-model gap this suite used to record rather than normalize away,
// the same X-TRANSFER-ORDER-NO-REFERENCE / X-INVENTORY-TRANSACTION-NO-IDENTITY precedent in the
// metadata program ledger (docs/orchestration/metadata-program/LEDGER.md). The Owner has since
// ruled (A-IDENTITY-MODES, X-PROCUREMENT-ENTITIES-NO-IDENTITY): both get identityMode
// BUSINESS_REFERENCE — reorderRequestNumber (RR-YYYY-######) and receivingOrderNumber
// (RO-YYYY-######) respectively, server-allocated by a numbering lane not yet built and absent on
// every existing document. validateEntityDefinition() is therefore now EXPECTED to report ZERO
// problems for each entity.
//
// reorder_requests carries THE authoritative procurement lifecycle status — the linked
// reorder_purchase_orders document's own `status` never changes after creation (see
// src/metadata/definitions/purchaseOrder.js's own header). That fact is pinned explicitly below.
//
// receiving_orders is deny-all in firestore.rules with no established read callable anywhere in this
// repository — readVia is UNKNOWN, not CALLABLE, and no ListViewDefinition is declared for it at all.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateEntityDefinition, validateEntityRegistry, findField, resolveIdentityMode } from "../src/metadata/entityDefinition.js";
import { validateListViewDefinition, requiredIndexes, indexKey } from "../src/metadata/listViewDefinition.js";
import { reorderRequestEntity, reorderRequestIndexList } from "../src/metadata/definitions/reorderRequest.js";
import { receivingOrderEntity } from "../src/metadata/definitions/receivingOrder.js";
import { purchaseOrderEntity } from "../src/metadata/definitions/purchaseOrder.js";
import { partEntity } from "../src/metadata/definitions/part.js";
import { warehouseEntity } from "../src/metadata/definitions/warehouse.js";
import { workOrderEntity } from "../src/metadata/definitions/workOrder.js";
import { REORDER_REQUESTS_COLLECTION, REORDER_REQUEST_STATUS, QUANTITY_SOURCE } from "../src/domain/constants.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------------------------
// Identity — BUSINESS_REFERENCE for both, per the Owner's ruling
// ---------------------------------------------------------------------------------------------

test("reorderRequest identity is BUSINESS_REFERENCE via reorderRequestNumber — zero validator problems", () => {
  assert.equal(reorderRequestEntity.identity.nameField, null);
  assert.equal(reorderRequestEntity.identity.referenceField, "reorderRequestNumber");
  assert.equal(resolveIdentityMode(reorderRequestEntity.identity), "BUSINESS_REFERENCE");
  assert.deepEqual(validateEntityDefinition(reorderRequestEntity), []);
});

test("receivingOrder identity is BUSINESS_REFERENCE via receivingOrderNumber — zero validator problems", () => {
  assert.equal(receivingOrderEntity.identity.nameField, null);
  assert.equal(receivingOrderEntity.identity.referenceField, "receivingOrderNumber");
  assert.equal(resolveIdentityMode(receivingOrderEntity.identity), "BUSINESS_REFERENCE");
  assert.deepEqual(validateEntityDefinition(receivingOrderEntity), []);
});

test("neither entity nominates a category/status field as the reference -- the referenceField is the numbering field, not `status`", () => {
  // The exact anti-pattern the ledger's X-INVENTORY-TRANSACTION-NO-IDENTITY entry names as the
  // reason a prior definition was held back.
  assert.notEqual(reorderRequestEntity.identity.referenceField, "status");
  assert.notEqual(receivingOrderEntity.identity.referenceField, "status");
});

test("both reference fields are declared STRING, sortable, and documented as absent on legacy records with no id fallback", () => {
  const reorderRequestNumber = findField(reorderRequestEntity, "reorderRequestNumber");
  assert.equal(reorderRequestNumber.type, "STRING");
  assert.equal(reorderRequestNumber.sortable, true);
  assert.match(reorderRequestNumber.description, /ABSENT ON EVERY EXISTING/);
  assert.match(reorderRequestNumber.description, /must not fall.*back to the Firestore document id/s);

  const receivingOrderNumber = findField(receivingOrderEntity, "receivingOrderNumber");
  assert.equal(receivingOrderNumber.type, "STRING");
  assert.equal(receivingOrderNumber.sortable, true);
  assert.match(receivingOrderNumber.description, /ABSENT ON EVERY EXISTING/);
  assert.match(receivingOrderNumber.description, /must not fall.*back to the Firestore document id/s);
});

// ---------------------------------------------------------------------------------------------
// Everything else about reorderRequest validates cleanly
// ---------------------------------------------------------------------------------------------

test("the Reorder Request entity has zero validation problems -- the identity ruling closed the prior gap", () => {
  const problems = validateEntityDefinition(reorderRequestEntity);
  assert.deepEqual(problems, []);
});

test("the Reorder Request index list is valid against the entity", () => {
  assert.deepEqual(validateListViewDefinition(reorderRequestIndexList, reorderRequestEntity), []);
});

test("the entity id is exactly \"reorderRequest\", collection is the live reorder_requests", () => {
  assert.equal(reorderRequestEntity.id, "reorderRequest");
  assert.equal(reorderRequestEntity.collection, REORDER_REQUESTS_COLLECTION);
  assert.equal(reorderRequestEntity.collection, "reorder_requests");
});

test("read is CLIENT_DIRECT with no capability -- Rules gate by role/relationship, not by capability", () => {
  assert.equal(reorderRequestEntity.readVia, "CLIENT_DIRECT");
  assert.equal(reorderRequestEntity.readCapability, null);
});

test("status is THE authoritative procurement lifecycle status -- not the linked Purchase Order's own status", () => {
  const status = findField(reorderRequestEntity, "status");
  assert.equal(status.type, "ENUM");
  assert.equal(status.filterable, true);
  assert.deepEqual([...status.operators], ["IN"]);
  // 9 real legal values -- APPROVED (a real reviewDecision value, never a real status value) is
  // deliberately excluded. See the definition file's header for the full grep evidence.
  assert.deepEqual(
    [...status.enumValues].sort(),
    [
      REORDER_REQUEST_STATUS.PENDING_REVIEW,
      REORDER_REQUEST_STATUS.REJECTED,
      REORDER_REQUEST_STATUS.READY_FOR_PARTS_MANAGER,
      REORDER_REQUEST_STATUS.ASSIGNED_TO_PARTS_ASSOCIATE,
      REORDER_REQUEST_STATUS.PURCHASING_IN_PROGRESS,
      REORDER_REQUEST_STATUS.ORDERED,
      REORDER_REQUEST_STATUS.RECEIVED,
      REORDER_REQUEST_STATUS.CANCELLED,
      REORDER_REQUEST_STATUS.VOIDED,
    ].sort()
  );
  assert.ok(!status.enumValues.includes(REORDER_REQUEST_STATUS.APPROVED), "APPROVED must not be a legal status value");
});

test("reviewDecision is a SEPARATE field from status, and is where APPROVED actually lives", () => {
  const reviewDecision = findField(reorderRequestEntity, "reviewDecision");
  assert.equal(reviewDecision.type, "ENUM");
  assert.deepEqual([...reviewDecision.enumValues].sort(), [REORDER_REQUEST_STATUS.APPROVED, REORDER_REQUEST_STATUS.REJECTED].sort());
});

test("recommendationStatus and quantitySource are declared per their own real vocabularies", () => {
  const recommendationStatus = findField(reorderRequestEntity, "recommendationStatus");
  assert.deepEqual([...recommendationStatus.enumValues].sort(), ["NEEDS_PLANNING", "READY"]);
  const quantitySource = findField(reorderRequestEntity, "quantitySource");
  assert.deepEqual([...quantitySource.enumValues].sort(), [QUANTITY_SOURCE.ANALYTICS, QUANTITY_SOURCE.MANUAL_ZERO_HISTORY].sort());
});

test("partId is a REFERENCE to the registered `part` entity", () => {
  const partId = findField(reorderRequestEntity, "partId");
  assert.equal(partId.type, "REFERENCE");
  assert.equal(partId.referenceTo, "part");
});

test("purchaseOrderId is a REFERENCE to the registered `purchaseOrder` entity -- closes purchaseOrder.js's own REGISTRATION_PENDING gap", () => {
  const purchaseOrderId = findField(reorderRequestEntity, "purchaseOrderId");
  assert.equal(purchaseOrderId.type, "REFERENCE");
  assert.equal(purchaseOrderId.referenceTo, "purchaseOrder");
});

test("workOrderId is a REFERENCE to the registered `workOrder` entity, optional back-link, no relationship declared", () => {
  const workOrderId = findField(reorderRequestEntity, "workOrderId");
  assert.equal(workOrderId.type, "REFERENCE");
  assert.equal(workOrderId.referenceTo, "workOrder");
  assert.equal(reorderRequestEntity.relationships.some((r) => r.toEntityId === "workOrder"), false);
});

test("every actor-uid field is a plain STRING, never a REFERENCE -- these are Firebase Auth uids, not employeeIds", () => {
  for (const name of [
    "requestedBy", "reviewedBy", "assignedBy", "assignedToUserId", "purchasingStartedBy",
    "lastPurchasingUpdateBy", "orderedBy", "receivedBy", "cancelledBy", "voidedBy",
  ]) {
    const field = findField(reorderRequestEntity, name);
    assert.equal(field.type, "STRING", name);
    assert.notEqual(field.type, "REFERENCE", name);
  }
});

test("every *At field is NUMBER (epoch milliseconds), never TIMESTAMP", () => {
  for (const name of [
    "createdAt", "reviewedAt", "assignedAt", "purchasingStartedAt", "lastPurchasingUpdateAt",
    "orderedAt", "receivedAt", "cancelledAt", "voidedAt",
  ]) {
    const field = findField(reorderRequestEntity, name);
    assert.equal(field.type, "NUMBER", name);
    assert.notEqual(field.type, "TIMESTAMP", name);
  }
});

test("free-text fields (notes/reasons) are TEXT, not STRING", () => {
  for (const name of ["reviewNotes", "purchasingNotes", "cancellationReason", "voidReason"]) {
    assert.equal(findField(reorderRequestEntity, name).type, "TEXT", name);
  }
});

test("expectedAvailabilityDate is DATE, not TIMESTAMP -- a plain YYYY-MM-DD string", () => {
  const field = findField(reorderRequestEntity, "expectedAvailabilityDate");
  assert.equal(field.type, "DATE");
  assert.notEqual(field.type, "TIMESTAMP");
});

test("vendorContacted is BOOLEAN", () => {
  assert.equal(findField(reorderRequestEntity, "vendorContacted").type, "BOOLEAN");
});

test("provenance is per-transition, not a generic updatedAt/updatedBy pair -- no such field exists", () => {
  for (const name of ["updatedAt", "updatedBy"]) {
    assert.equal(findField(reorderRequestEntity, name), null, name);
  }
  // Every one of the 8 later-lifecycle transitions stamps its own dedicated actor+timestamp pair.
  for (const name of [
    "reviewedBy", "reviewedAt", "assignedBy", "assignedAt", "purchasingStartedBy", "purchasingStartedAt",
    "lastPurchasingUpdateBy", "lastPurchasingUpdateAt", "orderedBy", "orderedAt", "receivedBy", "receivedAt",
    "cancelledBy", "cancelledAt", "voidedBy", "voidedAt",
  ]) {
    assert.ok(findField(reorderRequestEntity, name), name);
  }
});

test("the ONE_TO_ONE relationship to purchaseOrder validates against the real registry", () => {
  const rel = reorderRequestEntity.relationships.find((r) => r.id === "purchaseOrder");
  assert.ok(rel);
  assert.equal(rel.toEntityId, "purchaseOrder");
  assert.equal(rel.viaField, "reorderRequestId");
  assert.equal(rel.cardinality, "ONE_TO_ONE");
  // reorderRequestId must be a real field on the TARGET entity (purchaseOrder), not this one.
  assert.ok(findField(purchaseOrderEntity, "reorderRequestId"));
  // Full-registry cross-checks only for THIS entity's own outbound references -- workOrardEntity's
  // and purchaseOrderEntity's unrelated internal gaps (e.g. workOrder -> account/employee, neither
  // registered in this leaf lane's scope) are not this suite's concern.
  const registryProblems = validateEntityRegistry([reorderRequestEntity, purchaseOrderEntity, partEntity, workOrderEntity]);
  const reorderRequestProblems = registryProblems.filter((p) => p.startsWith("entity reorderRequest:"));
  assert.deepEqual(reorderRequestProblems, []);
});

// ---------------------------------------------------------------------------------------------
// Reorder Request index — registry-only, backs no live surface
// ---------------------------------------------------------------------------------------------

test("the index list declares status IN as its one required filter, matching the one real composite-backed query", () => {
  assert.equal(reorderRequestIndexList.filters.length, 1);
  const [filter] = reorderRequestIndexList.filters;
  assert.equal(filter.fieldId, "status");
  assert.deepEqual([...filter.operators], ["IN"]);
  assert.equal(filter.required, true);
});

test("default sort is createdAt DESC -- most recent request first, with the __name__ tiebreaker", () => {
  assert.deepEqual(
    reorderRequestIndexList.defaultSort.map((s) => [s.fieldId, s.direction]),
    [["createdAt", "DESC"]]
  );
  assert.equal(reorderRequestIndexList.tiebreaker, "__name__");
});

test("the index list demands exactly one composite, and it is ALREADY declared in firestore.indexes.json -- no net-new demand", () => {
  const required = requiredIndexes(reorderRequestIndexList, reorderRequestEntity);
  assert.equal(required.length, 1);
  assert.equal(required[0].collectionGroup, "reorder_requests");

  const indexesPath = path.join(__dirname, "..", "..", "firestore.indexes.json");
  const declared = JSON.parse(fs.readFileSync(indexesPath, "utf8")).indexes ?? [];
  const declaredKeys = new Set(declared.map((idx) => indexKey({ ...idx, collectionGroup: idx.collectionGroup })));
  assert.ok(declaredKeys.has(indexKey(required[0])), "the required index must already exist in firestore.indexes.json");
});

// ---------------------------------------------------------------------------------------------
// Everything else about receivingOrder validates cleanly
// ---------------------------------------------------------------------------------------------

test("the Receiving Order entity has zero validation problems -- the identity ruling closed the prior gap", () => {
  const problems = validateEntityDefinition(receivingOrderEntity);
  assert.deepEqual(problems, []);
});

test("the entity id is exactly \"receivingOrder\", collection is the live receiving_orders", () => {
  assert.equal(receivingOrderEntity.id, "receivingOrder");
  assert.equal(receivingOrderEntity.collection, "receiving_orders");
});

test("readVia is UNKNOWN, not CALLABLE -- deny-all in firestore.rules, but no read callable exists to name", () => {
  assert.equal(receivingOrderEntity.readVia, "UNKNOWN");
  assert.equal(receivingOrderEntity.readCallable, null);
  assert.equal(receivingOrderEntity.readCapability, null);
});

test("no ListViewDefinition is exported for receivingOrder -- there is no real query, filtered or unfiltered, to describe", async () => {
  const mod = await import("../src/metadata/definitions/receivingOrder.js");
  assert.equal(mod.receivingOrderIndexList, undefined);
});

test("sourceType and status each have exactly one legal value today, and neither is filterable", () => {
  const sourceType = findField(receivingOrderEntity, "sourceType");
  assert.deepEqual([...sourceType.enumValues], ["REORDER_PURCHASE_ORDER"]);
  assert.equal(sourceType.filterable, false);

  const status = findField(receivingOrderEntity, "status");
  assert.deepEqual([...status.enumValues], ["PUTAWAY_COMPLETE"]);
  assert.equal(status.filterable, false);
});

test("receivingLocationType is pinned to WAREHOUSE, tighter than the shared LocationRef's 6-value vocabulary", () => {
  const receivingLocationType = findField(receivingOrderEntity, "receivingLocationType");
  assert.deepEqual([...receivingLocationType.enumValues], ["WAREHOUSE"]);
});

test("receivingLocationId is a REFERENCE to the registered `warehouse` entity", () => {
  const receivingLocationId = findField(receivingOrderEntity, "receivingLocationId");
  assert.equal(receivingLocationId.type, "REFERENCE");
  assert.equal(receivingLocationId.referenceTo, "warehouse");
  // Full-registry cross-checks only for THIS entity's own outbound references -- workOrderEntity's
  // and purchaseOrderEntity's unrelated internal gaps (out of this leaf lane's scope) are not this
  // test's concern.
  const registryProblems = validateEntityRegistry([receivingOrderEntity, warehouseEntity, reorderRequestEntity, purchaseOrderEntity]);
  const receivingOrderProblems = registryProblems.filter((p) => p.startsWith("entity receivingOrder:"));
  assert.deepEqual(receivingOrderProblems, []);
});

test("sourceReorderRequestId / sourcePurchaseOrderId are REFERENCEs to the registered reorderRequest / purchaseOrder entities", () => {
  const sourceReorderRequestId = findField(receivingOrderEntity, "sourceReorderRequestId");
  assert.equal(sourceReorderRequestId.type, "REFERENCE");
  assert.equal(sourceReorderRequestId.referenceTo, "reorderRequest");

  const sourcePurchaseOrderId = findField(receivingOrderEntity, "sourcePurchaseOrderId");
  assert.equal(sourcePurchaseOrderId.type, "REFERENCE");
  assert.equal(sourcePurchaseOrderId.referenceTo, "purchaseOrder");
});

test("there is no embedded `lines` field -- an array of structs, left undeclared per FIELD_TYPE v1's own restraint", () => {
  for (const name of ["lines", "lineItems"]) {
    assert.equal(findField(receivingOrderEntity, name), null, name);
  }
});

test("createdAt/updatedAt are TIMESTAMP -- a real Firestore Timestamp, unlike reorderRequest's/purchaseOrder's epoch-millisecond NUMBER fields", () => {
  const createdAt = findField(receivingOrderEntity, "createdAt");
  const updatedAt = findField(receivingOrderEntity, "updatedAt");
  assert.equal(createdAt.type, "TIMESTAMP");
  assert.equal(updatedAt.type, "TIMESTAMP");
  assert.notEqual(createdAt.type, "NUMBER");
});

test("updatedAt/updatedBy are declared as real fields, not omitted -- append-only is recorded as a fact, not implied by absence", () => {
  assert.ok(findField(receivingOrderEntity, "updatedAt"));
  assert.ok(findField(receivingOrderEntity, "updatedBy"));
  assert.ok(findField(receivingOrderEntity, "createdBy"));
});

test("idempotencyKey and fingerprint are plain STRING, and neither is nominated into identity", () => {
  assert.equal(findField(receivingOrderEntity, "idempotencyKey").type, "STRING");
  assert.equal(findField(receivingOrderEntity, "fingerprint").type, "STRING");
  assert.notEqual(receivingOrderEntity.identity.nameField, "idempotencyKey");
  assert.notEqual(receivingOrderEntity.identity.nameField, "fingerprint");
  assert.notEqual(receivingOrderEntity.identity.referenceField, "idempotencyKey");
  assert.notEqual(receivingOrderEntity.identity.referenceField, "fingerprint");
});

test("no relationships are declared -- there is no established read path for any runtime to traverse FROM this entity", () => {
  assert.equal(receivingOrderEntity.relationships.length, 0);
});
