// Account entity + account.index list — the first real definitions.
//
// Until now the contracts were exercised only by fixtures written to exercise them.
// These assert the properties that matter once a definition describes a collection that
// actually exists and a surface people already use.

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateEntityDefinition, findField } from "../src/metadata/entityDefinition.js";
import { validateListViewDefinition, requiredIndexes } from "../src/metadata/listViewDefinition.js";
import { accountEntity, accountIndexList } from "../src/metadata/definitions/account.js";
import { ACCOUNT_STATUS, ACCOUNT_STATUS_LABEL } from "../src/domain/constants.js";
import {
  INVOICE_DELIVERY_METHOD,
  INVOICE_DELIVERY_METHOD_LABEL,
  PAYMENT_TERMS,
  PAYMENT_TERMS_LABEL,
  TAX_STATUS,
  TAX_STATUS_LABEL,
} from "../src/domain/accountCommercialVocabulary.js";

test("the Account entity is valid against the contract", () => {
  assert.deepEqual(validateEntityDefinition(accountEntity), []);
});

test("the Customers list is valid against the entity", () => {
  assert.deepEqual(validateListViewDefinition(accountIndexList, accountEntity), []);
});

test("status labels come from domain/constants, not a second copy", () => {
  // Two label maps for one enum is how "0 Active" ended up beside a table of ACTIVE
  // rows (#1093) — the surfaces disagreed about what the stored value meant. A metadata
  // layer with its own copy would be the third opinion.
  const status = findField(accountEntity, "status");
  assert.equal(status.enumLabels[ACCOUNT_STATUS.ACTIVE], ACCOUNT_STATUS_LABEL[ACCOUNT_STATUS.ACTIVE]);
  assert.deepEqual([...status.enumValues].sort(), Object.values(ACCOUNT_STATUS).sort());
});

test("identity names a real field and claims no reference number", () => {
  // An Account has no reference number. Declaring one would license a surface to render
  // a document id in its place — the defect corrected on Sales Orders (#1124).
  assert.equal(accountEntity.identity.nameField, "name");
  assert.equal(accountEntity.identity.referenceField, null);
  assert.ok(findField(accountEntity, "name"), "the identity field exists on the entity");
});

test("tags are renderable but claim no filter operator — no authoritative catalog exists", () => {
  // A declared operator is a promise the query layer must keep. array-contains combined
  // with a sort needs its own composite index; claiming it before declaring that index
  // is exactly the promise §9 forbids.
  const tags = findField(accountEntity, "tags");
  assert.deepEqual(tags.operators, []);
  assert.equal(tags.filterable, false);
  assert.ok(accountIndexList.columns.some((c) => c.fieldId === "tags"), "still rendered as a column");
});

test("every declared filter names a field that declares the same operators", () => {
  for (const filter of accountIndexList.filters) {
    const field = findField(accountEntity, filter.fieldId);
    assert.ok(field, `filter ${filter.fieldId} names a real field`);
    for (const op of filter.operators) {
      assert.ok(field.operators.includes(op), `${filter.fieldId} field declares ${op}`);
    }
  }
});

test("the landing view is recently-viewed, not everything", () => {
  // At 250,000 accounts an unfiltered first page answers nobody's question.
  const landing = accountIndexList.savedViews.find((v) => v.isDefault);
  assert.equal(landing.kind, "RECENTLY_VIEWED");
});

test("every demanded index is expressed in Firestore's vocabulary, ready to declare", () => {
  const indexes = requiredIndexes(accountIndexList, accountEntity);
  assert.ok(indexes.length > 0);
  for (const idx of indexes) {
    assert.equal(idx.collectionGroup, "accounts");
    for (const field of idx.fields) {
      // An array filter carries arrayConfig, not an order. Declaring array-contains as an
      // ascending scan is rejected by the deploy.
      const spelled = field.arrayConfig === "CONTAINS" || ["ASCENDING", "DESCENDING"].includes(field.order);
      assert.ok(spelled, `${field.fieldPath} uses Firestore's spelling`);
    }
  }
});

test("the relationship filter demands its own index, not just the combined one", () => {
  // Firestore will not serve a relationship-only query from the status+relationship
  // index, so a single combined demand would leave that query unindexed and failing in
  // front of a user while CI stayed green.
  const shapes = requiredIndexes(accountIndexList, accountEntity)
    .map((i) => i.fields.map((f) => f.fieldPath).join(","));
  assert.ok(shapes.includes("relationshipTypes,updatedAt,__name__"), shapes.join(" | "));
  assert.ok(shapes.includes("status,updatedAt,__name__"), shapes.join(" | "));
  assert.ok(shapes.includes("status,relationshipTypes,updatedAt,__name__"), shapes.join(" | "));
});

// ---- X-ACCOUNT-PAGE-GAPS (entity half): account.locations + Commercial Profile /
// Notes & Identifiers fields ---------------------------------------------------------

test("account.locations points FROM account TO location via accountId, ONE_TO_MANY", () => {
  const rel = accountEntity.relationships.find((r) => r.id === "account.locations");
  assert.ok(rel, "account.locations must be declared on account.js");
  assert.equal(rel.fromEntityId, "account");
  assert.equal(rel.toEntityId, "location");
  assert.equal(rel.viaField, "accountId");
  assert.equal(rel.cardinality, "ONE_TO_MANY");
});

test("account.locations declares no traversalCapability -- nothing gates locations by capability", () => {
  // Same finding as account.contacts: firestore.rules gates locations/{locationId} by
  // ROLE (isAdminOrDispatcher()), not by any capability id. Declaring one here would be a
  // false statement about the system, not a stricter one.
  const rel = accountEntity.relationships.find((r) => r.id === "account.locations");
  assert.equal(rel.traversalCapability, null);
});

test("the other three account relationships are unchanged by adding account.locations", () => {
  const ids = accountEntity.relationships.map((r) => r.id);
  assert.ok(ids.includes("account.contacts"));
  assert.ok(ids.includes("account.opportunities"));
  assert.ok(ids.includes("account.salesOrders"));
  assert.equal(accountEntity.relationships.length, 4);
});

test("defaultCurrency is a plain code, not a fabricated CURRENCY_MINOR", () => {
  // No minor-unit integer is stored anywhere near it -- it is an ISO 4217 alphabetic
  // code, validated by domain/commercialProfile.js's isValidIso4217().
  const field = findField(accountEntity, "defaultCurrency");
  assert.equal(field.type, "STRING");
});

test("purchaseOrderRequired is BOOLEAN", () => {
  const field = findField(accountEntity, "purchaseOrderRequired");
  assert.equal(field.type, "BOOLEAN");
});

test("invoiceDeliveryMethod labels come from the new domain vocabulary module, not a second copy", () => {
  const field = findField(accountEntity, "invoiceDeliveryMethod");
  assert.equal(field.type, "ENUM");
  assert.deepEqual([...field.enumValues].sort(), Object.values(INVOICE_DELIVERY_METHOD).sort());
  assert.equal(field.enumLabels[INVOICE_DELIVERY_METHOD.EMAIL], INVOICE_DELIVERY_METHOD_LABEL[INVOICE_DELIVERY_METHOD.EMAIL]);
});

test("paymentTerms and taxStatus are governed enums with vocabulary from the domain module", () => {
  const paymentTerms = findField(accountEntity, "paymentTerms");
  assert.equal(paymentTerms.type, "ENUM");
  assert.deepEqual([...paymentTerms.enumValues].sort(), Object.values(PAYMENT_TERMS).sort());
  assert.equal(paymentTerms.enumLabels[PAYMENT_TERMS.NET_30], PAYMENT_TERMS_LABEL[PAYMENT_TERMS.NET_30]);

  const taxStatus = findField(accountEntity, "taxStatus");
  assert.equal(taxStatus.type, "ENUM");
  assert.deepEqual([...taxStatus.enumValues].sort(), Object.values(TAX_STATUS).sort());
  assert.equal(taxStatus.enumLabels[TAX_STATUS.EXEMPT], TAX_STATUS_LABEL[TAX_STATUS.EXEMPT]);
});

test("paymentTerms and taxStatus declare no readCapability -- customer.governedField.write gates WRITE, not READ", () => {
  // The account document's read gate is uniformly isAdminOrDispatcher() for the whole
  // record; customer.governedField.write only restricts who may EDIT these two fields.
  // readCapability models read authority only, and FieldDefinition v1 has no
  // writeCapability concept to carry the write-side authority instead -- an intentional,
  // recorded gap, not an oversight.
  assert.equal(findField(accountEntity, "paymentTerms").readCapability, null);
  assert.equal(findField(accountEntity, "taxStatus").readCapability, null);
});

test("billingContactId and accountOwnerEmployeeId are REFERENCE fields to their real targets", () => {
  const billingContactId = findField(accountEntity, "billingContactId");
  assert.equal(billingContactId.type, "REFERENCE");
  assert.equal(billingContactId.referenceTo, "contact");

  const accountOwnerEmployeeId = findField(accountEntity, "accountOwnerEmployeeId");
  assert.equal(accountOwnerEmployeeId.type, "REFERENCE");
  assert.equal(accountOwnerEmployeeId.referenceTo, "employee");
});

test("the identifier fields and notes are declared as plain STRING/TEXT, not ID or REFERENCE", () => {
  // Nothing resolves an entity BY customerNumber/erpId/accountingId/legacyId today --
  // declaring ID or REFERENCE would claim a lookup capability that does not exist.
  for (const id of ["customerNumber", "erpId", "accountingId", "legacyId"]) {
    const field = findField(accountEntity, id);
    assert.equal(field.type, "STRING", `${id} is STRING`);
  }
  assert.equal(findField(accountEntity, "notes").type, "TEXT");
});

test("none of the new Commercial Profile / Notes & Identifiers fields are filterable or sortable", () => {
  // Display-only is the default -- not one of these fields has a real cross-Account
  // query behind it today, only a single-Account detail render. Declaring a filter or
  // sort here would be an unjustified index demand, the Work Order lesson (three
  // optional filters demanded seven composites).
  const newFieldIds = [
    "defaultCurrency", "purchaseOrderRequired", "invoiceDeliveryMethod",
    "paymentTerms", "taxStatus", "billingContactId", "accountOwnerEmployeeId",
    "customerNumber", "erpId", "accountingId", "legacyId", "notes",
  ];
  for (const id of newFieldIds) {
    const field = findField(accountEntity, id);
    assert.equal(field.filterable, false, `${id} is not filterable`);
    assert.equal(field.sortable, false, `${id} is not sortable`);
  }
});

test("requiredIndexes() for the Customers list is unchanged by the new fields -- no new index demand", () => {
  // None of the new fields appear in accountIndexList's columns/filters/sort, so the
  // index-demand set the list already declares must be exactly what it was before.
  const shapes = requiredIndexes(accountIndexList, accountEntity)
    .map((i) => i.fields.map((f) => f.fieldPath).join(","))
    .sort();
  assert.deepEqual(shapes, [
    "relationshipTypes,updatedAt,__name__",
    "status,relationshipTypes,updatedAt,__name__",
    "status,updatedAt,__name__",
  ]);
});
