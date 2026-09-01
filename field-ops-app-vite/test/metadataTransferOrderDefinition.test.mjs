// Transfer Order entity + transferOrder.index — S-INV-TRANSFER-MANUFACTURER-DEFINITIONS,
// A-HELD-DEFINITIONS-IDENTITY.
//
// Pins the intended behavior for the LIVE `transfer_orders` collection (Enterprise Inventory
// Phase 4). This definition was originally held because it had no human name and no business
// reference number anywhere in its schema or its one live rendering surface
// (modules/inventory/Transfers.jsx never prints even the document id) -- a genuine identity gap,
// not an oversight, and this lane correctly refused to invent a number on its own authority. The
// Owner has since ruled (A-IDENTITY-MODES, X-TRANSFER-ORDER-NO-REFERENCE): identityMode
// BUSINESS_REFERENCE, referenceField transferOrderNumber (TO-YYYY-######), server-allocated at
// creation.
//
// CORRECTED (RCV-G4). This header used to say the numbering lane was "not yet built" and the field
// "absent on every existing document". The lane IS built and wired -- allocateTransferOrderNumber is
// called by createTransferOrder -- so a Transfer Order created through the governed command carries a
// number, and "absent on every existing document" became false. The assertion below moved with it:
// it now pins the invariant that survived (absent on LEGACY records, never a document-id fallback)
// rather than a sentence that stopped being true, which is what let the stale claim sit unnoticed.
// The allocator's existence and wiring are asserted in metadataNumberingAuthority.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateEntityDefinition, validateFieldDefinition, findField, resolveIdentityMode } from "../src/metadata/entityDefinition.js";
import { validateListViewDefinition, requiredIndexes } from "../src/metadata/listViewDefinition.js";
import { transferOrderEntity, transferOrderIndexList } from "../src/metadata/definitions/transferOrder.js";
import { TRANSFER_ORDER_STATUSES } from "../src/domain/inventoryTransferPairing.js";
import { TRANSFER_STATUS_META } from "../src/domain/transfersView.js";

test("the Transfer Order entity has ZERO validation problems -- the identity ruling closed the prior gap", () => {
  const problems = validateEntityDefinition(transferOrderEntity);
  assert.deepEqual(problems, []);
});

test("every field on the entity is independently valid -- the one problem above is identity, and identity only", () => {
  for (const field of transferOrderEntity.fields) {
    assert.deepEqual(validateFieldDefinition(field, transferOrderEntity), [], field.id);
  }
});

test("the Transfer Order index list is valid against the entity -- list validation does not depend on entity identity", () => {
  assert.deepEqual(validateListViewDefinition(transferOrderIndexList, transferOrderEntity), []);
});

test("the entity id is exactly \"transferOrder\", collection is the live `transfer_orders` collection", () => {
  assert.equal(transferOrderEntity.id, "transferOrder");
  assert.equal(transferOrderEntity.collection, "transfer_orders");
});

test("identity is BUSINESS_REFERENCE via transferOrderNumber -- no nameField, per the Owner's ruling", () => {
  assert.equal(transferOrderEntity.identity.nameField, null);
  assert.equal(transferOrderEntity.identity.referenceField, "transferOrderNumber");
  assert.equal(resolveIdentityMode(transferOrderEntity.identity), "BUSINESS_REFERENCE");
});

test("transferOrderNumber is declared STRING, sortable, and documented as absent on legacy records with no id fallback", () => {
  const transferOrderNumber = findField(transferOrderEntity, "transferOrderNumber");
  assert.equal(transferOrderNumber.type, "STRING");
  assert.equal(transferOrderNumber.sortable, true);
  // The surviving invariant: legacy rows have no number, and nothing may substitute the document id.
  assert.match(transferOrderNumber.description, /ABSENT ON LEGACY/);
  assert.match(transferOrderNumber.description, /must not fall.*back to the Firestore document id/s);
});

test("transferOrderId is declared as its own ID field, never promoted into identity as a fallback", () => {
  const transferOrderId = findField(transferOrderEntity, "transferOrderId");
  assert.equal(transferOrderId.type, "ID");
  assert.notEqual(transferOrderEntity.identity.nameField, "transferOrderId");
  assert.notEqual(transferOrderEntity.identity.referenceField, "transferOrderId");
});

test("partId is a REFERENCE to `part`, but is NOT identity -- it describes what moves, not this record's own identity", () => {
  const partId = findField(transferOrderEntity, "partId");
  assert.equal(partId.type, "REFERENCE");
  assert.equal(partId.referenceTo, "part");
  assert.notEqual(transferOrderEntity.identity.nameField, "partId");
  assert.notEqual(transferOrderEntity.identity.referenceField, "partId");
});

test("read is CLIENT_DIRECT with no capability -- Rules gate by role/relationship, not by capability", () => {
  assert.equal(transferOrderEntity.readVia, "CLIENT_DIRECT");
  assert.equal(transferOrderEntity.readCapability, null);
});

test("fromWarehouseId/toWarehouseId are REFERENCEs to the now-registered `warehouse` entity, optional, not filtered", () => {
  for (const name of ["fromWarehouseId", "toWarehouseId"]) {
    const field = findField(transferOrderEntity, name);
    assert.equal(field.type, "REFERENCE", name);
    assert.equal(field.referenceTo, "warehouse", name);
    assert.equal(field.filterable, false, name);
  }
});

test("status vocabulary comes from domain/transfersView.js, not a copy inside the definition", () => {
  const status = findField(transferOrderEntity, "status");
  assert.equal(status.type, "ENUM");
  assert.deepEqual([...status.enumValues], [...TRANSFER_ORDER_STATUSES]);
  for (const v of TRANSFER_ORDER_STATUSES) {
    assert.equal(status.enumLabels[v], TRANSFER_STATUS_META[v].label);
    // The #1093 lesson: label must differ from the stored machine value.
    assert.notEqual(status.enumLabels[v], v);
  }
});

test("trackingMode is a NONE/SERIAL subset of PART_TRACKING_MODES, with inline labels distinct from the stored value", () => {
  const trackingMode = findField(transferOrderEntity, "trackingMode");
  assert.deepEqual([...trackingMode.enumValues], ["NONE", "SERIAL"]);
  assert.notEqual(trackingMode.enumLabels.NONE, "NONE");
  assert.notEqual(trackingMode.enumLabels.SERIAL, "SERIAL");
});

test("origin, destination, serialNumbers and actor are deliberately NOT declared -- embedded structs with no v1 FIELD_TYPE", () => {
  for (const name of ["origin", "destination", "serialNumbers", "actor"]) {
    assert.equal(findField(transferOrderEntity, name), null, name);
  }
});

test("schemaVersion is deliberately NOT declared -- an internal deserialize-compatibility gate, not business or query data", () => {
  assert.equal(findField(transferOrderEntity, "schemaVersion"), null);
});

test("createdAt/updatedAt are TIMESTAMP (real Firestore Timestamps), never a reinterpreted epoch number", () => {
  for (const name of ["createdAt", "updatedAt"]) {
    const field = findField(transferOrderEntity, name);
    assert.equal(field.type, "TIMESTAMP", name);
  }
});

test("no relationships are declared -- the real warehouse/part outbound edges belong on entities out of this lane's writeScope", () => {
  assert.equal(transferOrderEntity.relationships.length, 0);
});

test("the index list declares exactly one filter (status), forward-looking over the fully unbounded fetchTransferOrderDocs read", () => {
  assert.equal(transferOrderIndexList.filters.length, 1);
  assert.equal(transferOrderIndexList.filters[0].fieldId, "status");
});

test("the index list demands exactly one net-new composite index: status + createdAt + __name__", () => {
  const required = requiredIndexes(transferOrderIndexList, transferOrderEntity);
  assert.equal(required.length, 1);
  assert.deepEqual(
    required[0].fields.map((f) => f.fieldPath),
    ["status", "createdAt", "__name__"]
  );
  assert.equal(required[0].collectionGroup, "transfer_orders");
});

test("default sort is createdAt DESC -- activity order for in-flight operational work, not the opaque replay-key sort the live workspace uses", () => {
  assert.deepEqual(
    transferOrderIndexList.defaultSort.map((s) => [s.fieldId, s.direction]),
    [["createdAt", "DESC"]]
  );
  assert.equal(transferOrderIndexList.tiebreaker, "__name__");
});
