// WHICH CONTROL IN AccountForm EDITS WHICH DECLARED FIELD.
//
// The record page shows a pencil beside a field; clicking it opens the existing governed form and
// lands focus on the control that edits that field. This is the map between the two vocabularies.
//
// ════════════════════ WHY A MAP AND NOT A CONVENTION ════════════════════
//
// The ids do not follow one pattern, and pretending they do would be a guess that steals focus to
// the wrong control. The Commercial Profile block uses `cp-*` because it was built as its own
// section; the rest use `account-*`; and the casing differs from the field ids either way
// (`customerNumber` -> `account-customer-number`). A derived id would be wrong for most of them.
//
// ════════════════════ ABSENCE IS MEANINGFUL, NOT AN OVERSIGHT ════════════════════
//
// A field id that is NOT a key here has no single control to focus, and the form focuses nothing
// rather than approximating:
//
//   billingAddress          four inputs (street/city/state/zip), none of which IS the address
//   relationshipTypes       a checkbox group, not one control
//   lineOfBusiness          a checkbox group, not one control
//   purchaseOrderRequired   a radio pair; `cp-po-required-error` is the ERROR node, not an input
//   accountOwnerEmployeeId  resolved from the session/directory, not typed
//
// Each of those is still EDITABLE through the form — the page-level Edit opens all of them. What
// is missing is only the focus target, and accountRecordPage.test asserts every id here really
// exists in the form so this map cannot rot into pointing at controls that were renamed away.

/** Declared field id -> the DOM id of the control that edits it in AccountForm. */
export const ACCOUNT_FIELD_INPUT_ID = Object.freeze({
  name: "account-name",
  status: "account-status",
  tags: "account-tags",
  notes: "account-notes",
  customerNumber: "account-customer-number",
  erpId: "account-erp-id",
  accountingId: "account-accounting-id",
  legacyId: "account-legacy-id",
  defaultCurrency: "cp-currency",
  invoiceDeliveryMethod: "cp-invoice-delivery",
  paymentTerms: "cp-payment-terms",
  taxStatus: "cp-tax-status",
  billingContactId: "cp-billing-contact",
});
