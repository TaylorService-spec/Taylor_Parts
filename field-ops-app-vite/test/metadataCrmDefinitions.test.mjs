// Contact + Opportunity definitions — the first Account related-list dependencies.
//
// These describe what is STORED. Several assertions pin the ABSENCE of something, because
// the scouting found fields that are read but never written, authorities that do not
// exist, and provenance that three write paths disagree about — and a definition that
// papered over any of those would be the lie the program exists to prevent.

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateEntityDefinition, findField } from "../src/metadata/entityDefinition.js";
import { validateListViewDefinition } from "../src/metadata/listViewDefinition.js";
import { accountEntity } from "../src/metadata/definitions/account.js";
import { contactEntity, contactRelatedList, contactIndexList } from "../src/metadata/definitions/contact.js";
import { opportunityEntity, opportunityRelatedList, opportunityIndexList } from "../src/metadata/definitions/opportunity.js";
import { OPPORTUNITY_STAGES, STAGE_LABEL } from "../src/domain/opportunityLifecycle.js";

const accountRelationships = accountEntity.relationships;

test("both entities are valid, and so are all four lists", () => {
  assert.deepEqual(validateEntityDefinition(contactEntity), []);
  assert.deepEqual(validateEntityDefinition(opportunityEntity), []);
  assert.deepEqual(validateListViewDefinition(contactRelatedList, contactEntity, accountRelationships), []);
  assert.deepEqual(validateListViewDefinition(contactIndexList, contactEntity), []);
  assert.deepEqual(validateListViewDefinition(opportunityRelatedList, opportunityEntity, accountRelationships), []);
  assert.deepEqual(validateListViewDefinition(opportunityIndexList, opportunityEntity), []);
});

test("the related-list edges are declared on ACCOUNT, the entity that owns them", () => {
  const ids = accountRelationships.map((r) => r.id);
  assert.ok(ids.includes("account.contacts"));
  assert.ok(ids.includes("account.opportunities"));
  // Declared once, on the owning side. Two declarations of one edge is how a viaField
  // drifts between them.
  assert.equal(contactEntity.relationships.length, 0);
  assert.equal(opportunityEntity.relationships.length, 0);
});

test("traversing to opportunities carries the TARGET's authority, not the Account's", () => {
  // Reading an account does not entitle a viewer to its pipeline.
  const rel = accountRelationships.find((r) => r.id === "account.opportunities");
  assert.equal(rel.traversalCapability, "opportunity.read");
});

test("traversing to contacts declares NO authority, because nothing enforces one", () => {
  // Rules admit admin and dispatcher by ROLE; there is no contact.read in the catalog.
  // Declaring one would be a false statement about the system, not a stricter one.
  const rel = accountRelationships.find((r) => r.id === "account.contacts");
  assert.equal(rel.traversalCapability, null);
  assert.equal(contactEntity.readCapability, null);
});

test("Contact claims no reference number and no provenance it does not have", () => {
  // Three write paths disagree: single-add writes neither timestamp, import writes both
  // and no actor, only the sandbox seed writes createdBy. Declaring the fields would
  // assert data absent from most existing documents.
  assert.equal(contactEntity.identity.referenceField, null);
  assert.equal(contactEntity.identity.nameField, "name");
  for (const name of ["createdAt", "createdBy", "updatedAt", "updatedBy"]) {
    assert.equal(findField(contactEntity, name), null, name);
  }
});

test("Contact's role is free text, not an invented enum", () => {
  // The CSV importer accepts any value. An enum here would reject data the app creates.
  const role = findField(contactEntity, "role");
  assert.equal(role.type, "STRING");
  assert.equal(role.enumValues, null);
});

test("the Contacts section can hand off — a capped section with nowhere to go lies", () => {
  assert.equal(contactRelatedList.surface, "RELATED");
  assert.equal(contactRelatedList.viewAllListId, "contact.index");
  assert.equal(contactIndexList.id, "contact.index");
});

test("Opportunity is CALLABLE-read, and a callable-read entity demands no composite index", () => {
  assert.equal(opportunityEntity.readVia, "CALLABLE");
  assert.equal(opportunityEntity.readCallable, "listOpportunitiesForAccount");
  assert.equal(opportunityEntity.readCapability, "opportunity.read");
});

test("Opportunity identity is its reference, because `name` is never written", () => {
  // The read projection returns `name`, no write path sets it. Declaring it as the name
  // field would name something never populated — and a surface would fall back to the id.
  assert.equal(opportunityEntity.identity.referenceField, "opportunityNumber");
  assert.equal(opportunityEntity.identity.nameField, null);
  assert.equal(findField(opportunityEntity, "name"), null);
  assert.equal(findField(opportunityEntity, "nextAction"), null);
});

test("expectedValue is NOT declared as currency, because no currency is stored", () => {
  // A figure labelled with a unit nobody stored is worse than an unlabelled number.
  const value = findField(opportunityEntity, "expectedValue");
  assert.equal(value.type, "NUMBER");
  assert.equal(findField(opportunityEntity, "currency"), null);
  assert.match(value.description, /NOT minor units/);
});

test("stage vocabulary comes from the domain module, not a copy", () => {
  const stage = findField(opportunityEntity, "stage");
  assert.deepEqual([...stage.enumValues], [...OPPORTUNITY_STAGES]);
  assert.deepEqual({ ...stage.enumLabels }, { ...STAGE_LABEL });
});

test("opportunity declares no rowNavigationTo, because no per-Opportunity route exists", () => {
  // A route template is a promise that the route exists. "/sales/opportunities/:id" was
  // declared here and matches nothing in App.jsx; it was harmless only while nothing read
  // rowNavigationTo. Asserted at the definition so the next consumer inherits the truth
  // rather than a value it has to defend against.
  assert.equal(opportunityIndexList.rowNavigationTo ?? null, null);
  assert.equal(opportunityRelatedList.rowNavigationTo ?? null, null);
});
