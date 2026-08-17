// accountRecordPage — the Account PageDefinition. Contract tests.
//
// A previous attempt at this failed validation because a RELATED_LIST could not name a
// real ListViewDefinition — Contact/Opportunity/Sales Order related lists did not exist
// yet. They exist now (definitions/contact.js, definitions/opportunity.js,
// definitions/salesOrder.js), and these tests pin down that this page uses them
// correctly, declares the right authority, and stays honest about what it does not yet
// model (Locations; Commercial Profile; Notes & Identifiers).

import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePageDefinition, referencedListIds, SECTION_KIND } from "../src/metadata/pageDefinition.js";
import { findField } from "../src/metadata/entityDefinition.js";
import { accountEntity } from "../src/metadata/definitions/account.js";
import { accountRecordPage } from "../src/metadata/definitions/accountPage.js";
import { contactRelatedList } from "../src/metadata/definitions/contact.js";
import { opportunityRelatedList } from "../src/metadata/definitions/opportunity.js";
import { salesOrderRelatedList } from "../src/metadata/definitions/salesOrder.js";

test("the Account record page is valid against the Account entity", () => {
  assert.deepEqual(validatePageDefinition(accountRecordPage, accountEntity), []);
});

test("compositionMode is RECORD, pinned deliberately — an Account has no lifecycle", () => {
  assert.equal(accountRecordPage.compositionMode, "RECORD");
});

test("every RELATED_LIST section names a listId that resolves to a real, imported ListViewDefinition", () => {
  const relatedSections = accountRecordPage.sections.filter((s) => s.kind === "RELATED_LIST");
  assert.ok(relatedSections.length >= 3, "expects at least Contacts, Opportunities, Sales Orders");

  const realLists = { "account.contacts": contactRelatedList, "account.opportunities": opportunityRelatedList, "account.salesOrders": salesOrderRelatedList };

  for (const section of relatedSections) {
    assert.ok(section.listId, `RELATED_LIST section "${section.id}" must name a listId`);
    const real = realLists[section.listId];
    assert.ok(real, `RELATED_LIST section "${section.id}" names "${section.listId}", which must be one of ${Object.keys(realLists).join(", ")}`);
    // The list's own id must match the key it is filed under — catches a copy-paste
    // mismatch between the section's declared listId and the list actually imported.
    assert.equal(real.id, section.listId);
  }

  // referencedListIds() is the same accounting pageRuntime/CI tooling would use — it must
  // agree with what was just asserted section-by-section.
  assert.deepEqual(referencedListIds(accountRecordPage), Object.keys(realLists).sort());
});

test("no FIELD_GROUP section claims a fieldId absent from accountEntity", () => {
  const fieldGroups = accountRecordPage.sections.filter((s) => s.kind === "FIELD_GROUP");
  assert.ok(fieldGroups.length >= 1, "expects at least the header identity section");
  for (const section of fieldGroups) {
    assert.ok(section.fieldIds.length > 0, `FIELD_GROUP "${section.id}" must declare fieldIds`);
    for (const fieldId of section.fieldIds) {
      assert.ok(findField(accountEntity, fieldId), `FIELD_GROUP "${section.id}" claims field "${fieldId}", which is not on accountEntity`);
    }
  }
});

test("gated sections declare the capability actually verified for their read", () => {
  const byId = Object.fromEntries(accountRecordPage.sections.map((s) => [s.id, s]));

  // Verified against account.js's relationship declarations (traversalCapability) and
  // each entity's own readCapability — see accountPage.js's CAPABILITY DECLARATIONS block.
  assert.equal(byId.opportunities.capabilityRequirement, "opportunity.read");
  assert.equal(byId.salesOrders.capabilityRequirement, "salesOrder.read");
  // Verified against permissionCatalog.ts's "finance.read" (trusted listAccountInvoiceAr
  // read) — AccountFinancialsSection's authoritative sub-block is the AR read.
  assert.equal(byId.financials.capabilityRequirement, "finance.read");
  // Verified against permissionCatalog.ts's "crm.activity.read" (trusted getCrmActivities
  // read, gating ActivityAndNotesSection specifically).
  assert.equal(byId.activityAndNotes.capabilityRequirement, "crm.activity.read");
  // Account Attention composes AR (finance.read) with an undeclared-capability Work Order
  // read; finance.read is the strictest REAL gate the composed section has.
  assert.equal(byId.accountAttention.capabilityRequirement, "finance.read");
});

test("sections verified to have NO capability gate declare none — not an omission, an absence", () => {
  const byId = Object.fromEntries(accountRecordPage.sections.map((s) => [s.id, s]));

  // contact.js declares readCapability: null explicitly: "NO CAPABILITY GATES THIS
  // COLLECTION ... there is no `contact.read` in the permission catalog."
  assert.equal(byId.contacts.capabilityRequirement, null);
  // No workOrder.read capability id exists anywhere in permissionCatalog.ts; Service
  // Activity reads fieldops_wos client-direct, role-gated by Firestore Rules only.
  assert.equal(byId.serviceActivity.capabilityRequirement, null);
});

test("Locations, Commercial Profile, and Notes & Identifiers are deliberately NOT modeled yet", () => {
  // These are real blocks on the live AccountDetail.jsx surface, but Locations has no
  // ListViewDefinition and the profile/identifier fields are not yet declared on
  // accountEntity — see the GAPS block in accountPage.js. Asserting their absence pins the
  // decision so a future lane adding them does so knowingly, not by silent omission.
  const ids = accountRecordPage.sections.map((s) => s.id);
  for (const missing of ["locations", "commercialProfile", "notesAndIdentifiers"]) {
    assert.ok(!ids.includes(missing), `"${missing}" should not be modeled until its registration gap is closed`);
  }
});

test("componentId sections use REGISTERED-id shape (never a function) and are named for a later wiring lane", () => {
  const componentSections = accountRecordPage.sections.filter((s) => s.componentId);
  assert.ok(componentSections.length >= 4, "healthStrip, financials, activityAndNotes, serviceActivity, accountAttention");
  for (const section of componentSections) {
    assert.equal(typeof section.componentId, "string");
    assert.ok(SECTION_KIND.includes(section.kind));
  }
});

test("section ordering is fully decidable — no two sections share a region+order slot", () => {
  const seen = new Set();
  for (const s of accountRecordPage.sections) {
    const key = `${s.region}|${s.order}`;
    assert.ok(!seen.has(key), `region ${s.region} order ${s.order} is claimed by more than one section`);
    seen.add(key);
  }
});

test("the page id and label are distinct concepts, and the label matches the customer-facing name", () => {
  assert.equal(accountRecordPage.id, "account.record");
  assert.equal(accountRecordPage.label, "Customer Detail");
  assert.notEqual(accountRecordPage.id, accountRecordPage.label);
});
