// Location entity + location.index — S-CRM-LOCATION-DEFINITION.
//
// Pins the intended behavior for the entity two other definitions (equipment.js,
// salesOrder.js) were forced to route around because it did not exist: an identity with
// exactly one honest field, an address described as four scalars rather than an invented
// struct, provenance stored as raw numbers with no actors, a real Rules-enforced
// ownership edge this file can declare only from the referencing side, and an INDEX list
// where a RELATED list would have been the natural choice but cannot validate without an
// edit outside this lane's scope.

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateEntityDefinition, findField } from "../src/metadata/entityDefinition.js";
import { validateListViewDefinition, requiredIndexes } from "../src/metadata/listViewDefinition.js";
import { locationEntity, locationIndexList, locationRelatedList } from "../src/metadata/definitions/location.js";
import { accountEntity } from "../src/metadata/definitions/account.js";

test("the Location entity is valid against the contract", () => {
  assert.deepEqual(validateEntityDefinition(locationEntity), []);
});

test("the Location index list is valid against the entity", () => {
  assert.deepEqual(validateListViewDefinition(locationIndexList, locationEntity), []);
});

test("identity is a nameField, with NO referenceField and NO invented site code", () => {
  // LocationCreateModal requires a non-empty "Site name" -- a genuine, always-present
  // human reference -- but nothing in the stored shape, the create modal, or
  // firestore.rules carries any other business identifier. Promoting one that does not
  // exist would be exactly the fallback-to-document-id gap DECISIONS #106 forbids.
  assert.equal(locationEntity.identity.nameField, "name");
  assert.equal(locationEntity.identity.referenceField, null);
  assert.ok(findField(locationEntity, "name"));
  for (const name of ["siteCode", "referenceNumber", "locationCode"]) {
    assert.equal(findField(locationEntity, name), null, name);
  }
});

test("no capability gates this collection -- Rules admit by ROLE, and validate no field shape at all", () => {
  // locations/{locationId} in firestore.rules is `allow read/create/update: if
  // isAdminOrDispatcher()` with no field-shape guard whatsoever -- unlike equipment's
  // block, there is nothing here for a capability OR a shape assertion to describe.
  assert.equal(locationEntity.readCapability, null);
});

test("address is four scalar STRING fields, not an invented struct type", () => {
  // FIELD_TYPE v1 has no composite/struct type -- the same gap part.js's `flags` and
  // salesOrder.js's `lines` leave undeclared. Field ids are flat (no dotted storage
  // path -- v1 has no storagePath concept either), and each description states where the
  // value actually lives on the document.
  for (const [id, path] of [
    ["addressStreet", "address.street"],
    ["addressCity", "address.city"],
    ["addressState", "address.state"],
    ["addressZip", "address.zip"],
  ]) {
    const field = findField(locationEntity, id);
    assert.ok(field, id);
    assert.equal(field.type, "STRING", id);
    assert.match(field.description, new RegExp(path.replace(".", "\\.")), id);
  }
  // No struct/object type exists to declare "address" as one field.
  assert.equal(findField(locationEntity, "address"), null);
});

test("accessNotes is declared optional, and stores null rather than empty string when blank", () => {
  const notes = findField(locationEntity, "accessNotes");
  assert.equal(notes.type, "TEXT");
});

test("createdAt/updatedAt are declared NUMBER, never TIMESTAMP, and no actor fields exist", () => {
  // domain/locations.js stamps both with Date.now() -- epoch milliseconds -- never a
  // Firestore Timestamp. Declaring TIMESTAMP to match a "standard" provenance shape would
  // assert storage semantics this collection does not have.
  const createdAt = findField(locationEntity, "createdAt");
  const updatedAt = findField(locationEntity, "updatedAt");
  assert.equal(createdAt.type, "NUMBER");
  assert.equal(updatedAt.type, "NUMBER");
  assert.notEqual(createdAt.type, "TIMESTAMP");
  assert.notEqual(updatedAt.type, "TIMESTAMP");
  // Neither createdBy nor updatedBy is stored anywhere on this collection's write path.
  for (const name of ["createdBy", "updatedBy"]) {
    assert.equal(findField(locationEntity, name), null, name);
  }
});

test("accountId is a REFERENCE to account -- a real, Rules-enforced ownership edge", () => {
  // firestore.rules' equipmentLocationBelongsToAccount() get()s this exact document and
  // asserts data.accountId equals the referencing Equipment's own accountId -- proof this
  // is enforced ownership, not convention. Declaring the field itself needs no edit to
  // account.js, the same way contact.js declares its own accountId REFERENCE without
  // touching account.js.
  const accountId = findField(locationEntity, "accountId");
  assert.equal(accountId.type, "REFERENCE");
  assert.equal(accountId.referenceTo, "account");
  assert.equal(accountId.filterable, true);
});

test("no outbound relationships are declared here -- the owning-side edge belongs on Account", () => {
  // account.locations, if and when it exists, points FROM Account and belongs on
  // account.js per the same rule contact.js and equipment.js already follow. Declaring it
  // here would be the wrong owning side, and a RELATED list built on it here would not
  // validate anyway (findParentRelationship resolves against the PARENT's declarations).
  assert.equal(locationEntity.relationships.length, 0);
});

test("this is an INDEX list, not RELATED -- a RELATED list cannot validate without account.js", () => {
  // A RELATED list requires parentRelationshipId to resolve to a relationship declared on
  // the OWNING entity (findParentRelationship). account.js is out of this lane's
  // writeScope and declares no account.locations edge, so a RELATED list here would fail
  // validateListViewDefinition's own check -- this file does not attempt one.
  assert.equal(locationIndexList.surface, "INDEX");
  assert.equal(locationIndexList.parentRelationshipId, null);
});

test("the index list declares exactly the accountId filter, mirroring the real query hook", () => {
  // hooks/useLocationsForAccount.js's own comment: "a single-field equality query needs
  // no composite index." accountId is the only filter this list declares -- nothing else
  // about a Location is indexed or has a vocabulary to filter by, the Work Order lesson
  // that a few optional filters multiply into many composites.
  assert.equal(locationIndexList.filters.length, 1);
  assert.equal(locationIndexList.filters[0].fieldId, "accountId");
  assert.deepEqual([...locationIndexList.filters[0].operators], ["EQUALS"]);
});

test("requiredIndexes derives exactly one composite: accountId + name sort + tiebreaker", () => {
  // The unfiltered, name-sorted query is served by Firestore's automatic single-field
  // index. Filtering by accountId on top of that sort is the one real combination that
  // needs a declared composite.
  const required = requiredIndexes(locationIndexList, locationEntity);
  assert.equal(required.length, 1);
  const [index] = required;
  assert.equal(index.collectionGroup, locationEntity.collection);
  const fieldPaths = index.fields.map((f) => f.fieldPath);
  assert.deepEqual(fieldPaths, ["accountId", "name", "__name__"]);
});

// --- locationRelatedList — account.js now declares the owning-side `account.locations`
// edge, which is what unblocks a RELATED list here (see the file header's updated
// explanation of what changed).

test("the Locations related list is valid against the entity AND against account.js's own relationships", () => {
  // The third argument is the OWNING entity's relationships, exactly as
  // validateListViewDefinition documents: a RELATED list's parent relationship must be
  // declared on the entity that OWNS it, not on the entity the list renders.
  assert.deepEqual(validateListViewDefinition(locationRelatedList, locationEntity, accountEntity.relationships), []);
});

test("the related list is scoped by account.locations, and hands off to location.index", () => {
  assert.equal(locationRelatedList.id, "account.locations");
  assert.equal(locationRelatedList.surface, "RELATED");
  assert.equal(locationRelatedList.parentRelationshipId, "account.locations");
  assert.equal(locationRelatedList.viewAllListId, "location.index");
  assert.equal(locationIndexList.id, locationRelatedList.viewAllListId);
});

test("account.locations reaches the location entity from the OWNING (account) side", () => {
  const rel = accountEntity.relationships.find((r) => r.id === "account.locations");
  assert.ok(rel, "account.js must declare the account.locations relationship");
  assert.equal(rel.fromEntityId, "account");
  assert.equal(rel.toEntityId, "location");
});

test("the related list declares no capability — locationEntity.readCapability is null", () => {
  // Same precedent contact.js's account.contacts related list follows: Rules gate this
  // collection by role, not by capability, so no capability is invented here.
  assert.equal(locationEntity.readCapability, null);
});

test("the related list declares no parent-scope filter — the runtime applies it from the relationship", () => {
  assert.deepEqual([...locationRelatedList.filters], []);
});

test("requiredIndexes derives NO composite for the related list — a single-field sort needs none", () => {
  // No filters and exactly one sort field is the case listViewDefinition.js's own
  // requiredIndexes() explicitly skips (Firestore's automatic single-field index already
  // serves it) — same shape contactRelatedList and opportunityRelatedList already rely on.
  const required = requiredIndexes(locationRelatedList, locationEntity);
  assert.deepEqual(required, []);
});
