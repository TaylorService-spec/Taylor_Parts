// Invoice + Payment entity definitions — A-ENTITY-BILLING-DEFINITIONS.
//
// Pins the intended behavior for the deny-all `invoices` and `payments` collections: Invoice is
// CALLABLE-read (listAccountInvoiceAr, finance.read, registered active:false) with a genuine
// server-allocated reference (invoiceNumber) and a read projection narrower than the stored
// document; Payment has NO read path of any kind (readVia UNKNOWN) and no server-allocated
// reference, so its identity leans on the one real, if frequently-null, human-facing field
// (externalRef) instead. Honest about both gaps rather than papering over either.
//
// NO invoiceIndexList EXISTS (H4/M19 fix, docs/... backfill). It used to declare an INDEX
// surface with no readCallable override, which silently inherited the entity's scoped-only
// listAccountInvoiceAr at runtime — a combination that would throw on every single request
// (an INDEX list never supplies the parent-scope filter that callable requires). See
// definitions/invoice.js's own header for the full account. This file no longer asserts
// anything about a list view that does not exist.

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateEntityDefinition, findField } from "../src/metadata/entityDefinition.js";
import { invoiceEntity } from "../src/metadata/definitions/invoice.js";
import { paymentEntity } from "../src/metadata/definitions/payment.js";
import { INVOICE_STATES } from "../src/domain/commercialFinance.js";

// ── Invoice ──────────────────────────────────────────────────────────────────────────────────

test("the Invoice entity is valid", () => {
  assert.deepEqual(validateEntityDefinition(invoiceEntity), []);
});

test("no list view is declared for Invoice -- the only registered callable is scoped and cannot back an INDEX list", async () => {
  // Only the entity is exported from invoice.js; no invoiceIndexList-style export exists,
  // the same restraint payment.js already applies to itself (see the mirrored test below).
  const invoiceModuleKeys = Object.keys(await import("../src/metadata/definitions/invoice.js"));
  assert.deepEqual(invoiceModuleKeys, ["invoiceEntity"]);
});

test("Invoice collection is invoices, deny-all in Rules, read only via the trusted callable", () => {
  assert.equal(invoiceEntity.id, "invoice");
  assert.equal(invoiceEntity.collection, "invoices");
  assert.equal(invoiceEntity.readVia, "CALLABLE");
  assert.equal(invoiceEntity.readCallable, "listAccountInvoiceAr");
  assert.equal(invoiceEntity.readCapability, "finance.read");
});

test("identity is the reference number, and NO nameField is declared -- no human name exists in the write path", () => {
  assert.equal(invoiceEntity.identity.referenceField, "invoiceNumber");
  assert.equal(invoiceEntity.identity.nameField, null);
  assert.ok(findField(invoiceEntity, "invoiceNumber"));
});

test("state values are reused from domain/commercialFinance.js, not a second copy", () => {
  const state = findField(invoiceEntity, "state");
  assert.deepEqual([...state.enumValues], [...INVOICE_STATES]);
  // Every enum label must differ from its own machine value (the #1093 lesson).
  for (const v of state.enumValues) {
    assert.notEqual(state.enumLabels[v], v);
  }
});

test("state is declared but NOT filterable -- listAccountInvoiceAr has no state parameter", () => {
  const state = findField(invoiceEntity, "state");
  assert.equal(state.filterable, false);
  assert.deepEqual([...state.operators], []);
});

test("accountId is filterable EQUALS -- the one real backing query", () => {
  const accountId = findField(invoiceEntity, "accountId");
  assert.equal(accountId.type, "REFERENCE");
  assert.equal(accountId.referenceTo, "account");
  assert.equal(accountId.filterable, true);
  assert.deepEqual([...accountId.operators], ["EQUALS"]);
});

test("salesOrderId is a REFERENCE preserving Sales Order -> Invoice lineage", () => {
  const salesOrderId = findField(invoiceEntity, "salesOrderId");
  assert.equal(salesOrderId.type, "REFERENCE");
  assert.equal(salesOrderId.referenceTo, "salesOrder");
});

test("currency is a plain STRING, never CURRENCY_MINOR -- it is the code the money fields are denominated in", () => {
  const currency = findField(invoiceEntity, "currency");
  assert.equal(currency.type, "STRING");
  assert.notEqual(currency.type, "CURRENCY_MINOR");
});

test("money fields are CURRENCY_MINOR -- verified against invoiceCommands.ts/paymentCommands.ts/adjustmentCommands.ts integer guards", () => {
  const moneyFields = [
    "totalMinor",
    "outstandingMinor",
    "subtotalMinor",
    "discountMinor",
    "taxMinor",
    "appliedMinor",
    "creditsMinor",
    "chargesMinor",
    "writeOffMinor",
  ];
  for (const id of moneyFields) {
    const field = findField(invoiceEntity, id);
    assert.ok(field, id);
    assert.equal(field.type, "CURRENCY_MINOR", id);
  }
});

test("dueDate is DATE -- stored as ms epoch (invoiceCommands.ts's isInt guard), never TIMESTAMP, but a date by kind, not a plain NUMBER", () => {
  const dueDate = findField(invoiceEntity, "dueDate");
  assert.equal(dueDate.type, "DATE");
  assert.notEqual(dueDate.type, "TIMESTAMP");
  assert.notEqual(dueDate.type, "NUMBER");
});

test("provenance: issuedAt/issuedAtMillis/updatedAt exist; createdBy and updatedBy do NOT, anywhere", () => {
  const issuedAt = findField(invoiceEntity, "issuedAt");
  const issuedAtMillis = findField(invoiceEntity, "issuedAtMillis");
  const updatedAt = findField(invoiceEntity, "updatedAt");
  assert.equal(issuedAt.type, "TIMESTAMP");
  assert.equal(issuedAtMillis.type, "NUMBER");
  assert.equal(updatedAt.type, "TIMESTAMP");
  // No write path anywhere copies an actor uid onto the invoice document itself -- only onto the
  // separate append-only audit event.
  for (const name of ["createdBy", "updatedBy"]) {
    assert.equal(findField(invoiceEntity, name), null, name);
  }
});

test("sequence and lines are deliberately not declared", () => {
  for (const name of ["sequence", "lines"]) {
    assert.equal(findField(invoiceEntity, name), null, name);
  }
});

test("the derived AR read-only fields (arPosition, daysOverdue) are never declared as stored fields", () => {
  for (const name of ["arPosition", "daysOverdue"]) {
    assert.equal(findField(invoiceEntity, name), null, name);
  }
});

test("no outbound relationships are declared -- account.invoices belongs on account.js, outside this lane", () => {
  assert.equal(invoiceEntity.relationships.length, 0);
});

// ── Payment ──────────────────────────────────────────────────────────────────────────────────

test("the Payment entity is valid against the contract", () => {
  assert.deepEqual(validateEntityDefinition(paymentEntity), []);
});

test("Payment collection is payments, deny-all in Rules, and readVia is honestly UNKNOWN", () => {
  assert.equal(paymentEntity.id, "payment");
  assert.equal(paymentEntity.collection, "payments");
  assert.equal(paymentEntity.readVia, "UNKNOWN");
  assert.equal(paymentEntity.readCallable, null);
  assert.equal(paymentEntity.readCapability, null);
});

test("no list view is declared for Payment -- there is no read path to back one", async () => {
  // Only the entity is exported from payment.js; no invoiceIndexList-style export exists.
  const paymentModuleKeys = Object.keys(await import("../src/metadata/definitions/payment.js"));
  assert.deepEqual(paymentModuleKeys, ["paymentEntity"]);
});

test("identity is a nameField (externalRef) -- no server-allocated reference exists to promote", () => {
  // No PAY-YYYY-###### (or any allocate*Number sequence) exists anywhere for this collection.
  assert.equal(paymentEntity.identity.referenceField, null);
  assert.equal(paymentEntity.identity.nameField, "externalRef");
  assert.ok(findField(paymentEntity, "externalRef"));
});

test("externalRef is genuinely optional -- the identity gap (null externalRef => no name) is recorded, not hidden", () => {
  const externalRef = findField(paymentEntity, "externalRef");
  assert.equal(externalRef.type, "STRING");
  assert.match(externalRef.description, /OPTIONAL/);
  assert.match(externalRef.description, /no human-legible name/);
});

test("a Payment document has no invoiceId of its own -- that link lives in payment_applications, out of scope", () => {
  assert.equal(findField(paymentEntity, "invoiceId"), null);
});

test("money fields are CURRENCY_MINOR, matching invoice.js's own money-field typing", () => {
  for (const id of ["amountMinor", "appliedMinor", "unappliedMinor"]) {
    const field = findField(paymentEntity, id);
    assert.ok(field, id);
    assert.equal(field.type, "CURRENCY_MINOR", id);
  }
});

test("currency is a plain STRING, never CURRENCY_MINOR", () => {
  const currency = findField(paymentEntity, "currency");
  assert.equal(currency.type, "STRING");
  assert.notEqual(currency.type, "CURRENCY_MINOR");
});

test("method is a plain STRING -- no closed vocabulary exists anywhere for it", () => {
  const method = findField(paymentEntity, "method");
  assert.equal(method.type, "STRING");
  assert.notEqual(method.type, "ENUM");
});

test("receivedAtMillis / receivedAt / createdAt are three distinct real fields", () => {
  const receivedAtMillis = findField(paymentEntity, "receivedAtMillis");
  const receivedAt = findField(paymentEntity, "receivedAt");
  const createdAt = findField(paymentEntity, "createdAt");
  assert.equal(receivedAtMillis.type, "NUMBER");
  assert.equal(receivedAt.type, "TIMESTAMP");
  assert.equal(createdAt.type, "TIMESTAMP");
});

test("provenance: createdAt exists; createdBy does not, anywhere", () => {
  assert.ok(findField(paymentEntity, "createdAt"));
  assert.equal(findField(paymentEntity, "createdBy"), null);
});

test("no updatedAt/updatedBy -- append-only by construction, a structural fact not a gap", () => {
  for (const name of ["updatedAt", "updatedBy"]) {
    assert.equal(findField(paymentEntity, name), null, name);
  }
});

test("companyId stays a plain STRING -- no `company` entity is registered in this program", () => {
  const invoiceCompanyId = findField(invoiceEntity, "companyId");
  const paymentCompanyId = findField(paymentEntity, "companyId");
  assert.equal(invoiceCompanyId.type, "STRING");
  assert.equal(paymentCompanyId.type, "STRING");
  assert.notEqual(invoiceCompanyId.type, "REFERENCE");
  assert.notEqual(paymentCompanyId.type, "REFERENCE");
});

test("no outbound relationships are declared -- account.payments belongs on account.js, outside this lane", () => {
  assert.equal(paymentEntity.relationships.length, 0);
});
