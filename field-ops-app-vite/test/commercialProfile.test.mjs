// Account Commercial Profile -- PR 1. Deterministic unit test for the pure
// validation + identity-resolution helpers in src/domain/commercialProfile.js.
// Covers the required validations (ISO 4217 currency, invoice-delivery enum,
// boolean PO-required, Account-owned billing contact, valid Person
// Assignment) plus the cross-account-contact and unresolved-person cases.
//
// Run: node test/commercialProfile.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import {
  isValidIso4217,
  isValidInvoiceDeliveryMethod,
  isBooleanPurchaseOrderRequired,
  isContactOnAccount,
  isValidAccountOwner,
  commercialProfileErrors,
  resolveOwnerDisplayName,
  resolveContactName,
} from "../src/domain/commercialProfile.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

// --- ISO 4217 currency ---
ok("ISO 4217: valid codes accepted", () => {
  assert.equal(isValidIso4217("USD"), true);
  assert.equal(isValidIso4217("EUR"), true);
  assert.equal(isValidIso4217("JPY"), true);
});
ok("ISO 4217: rejects wrong case / length / non-string", () => {
  assert.equal(isValidIso4217("usd"), false);
  assert.equal(isValidIso4217("US"), false);
  assert.equal(isValidIso4217("DOLLAR"), false);
  assert.equal(isValidIso4217(""), false);
  assert.equal(isValidIso4217(123), false);
  assert.equal(isValidIso4217(null), false);
});
ok("ISO 4217: rejects a well-formatted non-currency (ZZZ) when the list is available", () => {
  // If Intl.supportedValuesOf is present (Node 18+/modern browsers), ZZZ is not
  // a currency and must be rejected. If unavailable, format-only acceptance is
  // the documented fallback -- assert accordingly so the test is portable.
  const hasList = typeof Intl !== "undefined" && typeof Intl.supportedValuesOf === "function";
  assert.equal(isValidIso4217("ZZZ"), hasList ? false : true);
});

// --- invoice-delivery enum ---
ok("invoiceDeliveryMethod: enum accepted, others rejected", () => {
  assert.equal(isValidInvoiceDeliveryMethod("EMAIL"), true);
  assert.equal(isValidInvoiceDeliveryMethod("PORTAL"), true);
  assert.equal(isValidInvoiceDeliveryMethod("MAIL"), true);
  assert.equal(isValidInvoiceDeliveryMethod("EDI"), true);
  assert.equal(isValidInvoiceDeliveryMethod("email"), false);
  assert.equal(isValidInvoiceDeliveryMethod("FAX"), false);
  assert.equal(isValidInvoiceDeliveryMethod(undefined), false);
});

// --- boolean PO-required ---
ok("purchaseOrderRequired: strict boolean", () => {
  assert.equal(isBooleanPurchaseOrderRequired(true), true);
  assert.equal(isBooleanPurchaseOrderRequired(false), true);
  assert.equal(isBooleanPurchaseOrderRequired("true"), false);
  assert.equal(isBooleanPurchaseOrderRequired(1), false);
  assert.equal(isBooleanPurchaseOrderRequired(null), false);
});

// --- billing contact must belong to THIS Account (cross-account rejection) ---
const accountContacts = [
  { id: "c-1", name: "Dana Prime" },
  { id: "c-2", name: "Riley Second" },
];
ok("billingContact: unset is valid", () => assert.equal(isContactOnAccount(null, accountContacts), true));
ok("billingContact: an own contact is valid", () => assert.equal(isContactOnAccount("c-1", accountContacts), true));
ok("billingContact: a CROSS-ACCOUNT contact is rejected", () => assert.equal(isContactOnAccount("c-foreign", accountContacts), false));

// --- account owner validity ---
ok("accountOwner: unset valid; linked userId valid; empty snapshot invalid", () => {
  assert.equal(isValidAccountOwner(null), true);
  assert.equal(isValidAccountOwner({ assignedToUserId: "u-1", assignedToDisplayName: "Sam" }), true);
  assert.equal(isValidAccountOwner({ assignedToEmployeeId: "emp-1" }), true);
  assert.equal(isValidAccountOwner({ assignedToDisplayName: "Sam" }), false); // no id
});

// --- aggregate validator ---
ok("commercialProfileErrors: valid draft -> no errors", () => {
  const r = commercialProfileErrors(
    { defaultCurrency: "USD", invoiceDeliveryMethod: "EMAIL", purchaseOrderRequired: true, billingContactId: "c-1", accountOwner: { assignedToUserId: "u-1" } },
    accountContacts
  );
  assert.deepEqual(r, { valid: true, errors: {} });
});
ok("commercialProfileErrors: invalid currency + cross-account contact -> flagged", () => {
  const r = commercialProfileErrors(
    { defaultCurrency: "usd", billingContactId: "c-foreign" },
    accountContacts
  );
  assert.equal(r.valid, false);
  assert.ok(r.errors.defaultCurrency);
  assert.ok(r.errors.billingContact);
});

// --- identity resolution: current name vs "Unknown" ---
const byUserId = new Map([["u-1", { displayName: "Dana Prime (current)" }]]);
ok("resolveOwnerDisplayName: resolves the CURRENT name from userId", () => {
  assert.equal(resolveOwnerDisplayName({ assignedToUserId: "u-1", assignedToDisplayName: "Dana (stale snapshot)" }, byUserId), "Dana Prime (current)");
});
ok("resolveOwnerDisplayName: unresolved -> 'Unknown owner' (never the raw id/stale snapshot)", () => {
  assert.equal(resolveOwnerDisplayName({ assignedToUserId: "u-gone", assignedToDisplayName: "Old Name" }, byUserId), "Unknown owner");
});
ok("resolveOwnerDisplayName: unset -> null", () => {
  assert.equal(resolveOwnerDisplayName(null, byUserId), null);
  assert.equal(resolveOwnerDisplayName({ assignedToDisplayName: "x" }, byUserId), null);
});
ok("resolveContactName: own contact -> name; foreign -> 'Unknown contact'; unset -> null", () => {
  assert.equal(resolveContactName("c-1", accountContacts), "Dana Prime");
  assert.equal(resolveContactName("c-foreign", accountContacts), "Unknown contact");
  assert.equal(resolveContactName(null, accountContacts), null);
});

console.log(`\n${passed} passed, 0 failed`);
