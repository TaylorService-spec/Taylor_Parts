// Account Commercial Profile -- PR 1. Deterministic unit test for the pure
// validation + identity-resolution helpers in src/domain/commercialProfile.js.
// Covers the PR #179 review corrections: fail-closed ISO 4217 currency, the
// COMPLETE Person Assignment requirement for accountOwner, the state-aware
// identity resolvers (loading vs error vs resolved vs unknown), and per-field
// validation including billing contact / delivery method / PO-required.
//
// Run: node test/commercialProfile.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import {
  isValidIso4217,
  isValidInvoiceDeliveryMethod,
  isBooleanPurchaseOrderRequired,
  isContactOnAccount,
  isCompleteAccountOwner,
  commercialProfileErrors,
  resolveOwnerIdentity,
  resolveContactIdentity,
} from "../src/domain/commercialProfile.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

// --- ISO 4217 currency: FAIL CLOSED -----------------------------------
ok("ISO 4217: valid codes accepted", () => {
  assert.equal(isValidIso4217("USD"), true);
  assert.equal(isValidIso4217("EUR"), true);
  assert.equal(isValidIso4217("JPY"), true);
  assert.equal(isValidIso4217("GBP"), true);
});
ok("ISO 4217: rejects wrong case / length / non-string", () => {
  assert.equal(isValidIso4217("usd"), false);
  assert.equal(isValidIso4217("US"), false);
  assert.equal(isValidIso4217("DOLLAR"), false);
  assert.equal(isValidIso4217(""), false);
  assert.equal(isValidIso4217(123), false);
  assert.equal(isValidIso4217(null), false);
});
ok("ISO 4217: fails closed -- well-formatted non-currencies always rejected", () => {
  // Deterministic across every runtime: never accepts an arbitrary 3-letter
  // code, even where a runtime currency list is unavailable.
  assert.equal(isValidIso4217("ZZZ"), false);
  assert.equal(isValidIso4217("XXX"), false); // "no currency" placeholder
  assert.equal(isValidIso4217("ABC"), false);
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

// --- account owner: COMPLETE Person Assignment required ---
const completeOwner = {
  assignedToEmployeeId: "emp-1",
  assignedToUserId: "u-1",
  assignedToDisplayName: "Sam Owner",
  assignedByEmployeeId: "emp-9",
  assignedByUserId: "u-9",
  assignedByDisplayName: "Ada Assignor",
  assignedAt: 1_720_000_000_000,
};
ok("accountOwner: unset is valid (optional field)", () => {
  assert.equal(isCompleteAccountOwner(null), true);
  assert.equal(isCompleteAccountOwner(undefined), true);
});
ok("accountOwner: a fully-populated assignment is valid", () => {
  assert.equal(isCompleteAccountOwner(completeOwner), true);
});
ok("accountOwner: rejects an arbitrary/partial record (missing any required piece)", () => {
  assert.equal(isCompleteAccountOwner({ ...completeOwner, assignedToUserId: null }), false); // no linked user
  assert.equal(isCompleteAccountOwner({ ...completeOwner, assignedToEmployeeId: null }), false); // no linked employee
  assert.equal(isCompleteAccountOwner({ ...completeOwner, assignedToDisplayName: null }), false); // no name snapshot
  assert.equal(isCompleteAccountOwner({ ...completeOwner, assignedByEmployeeId: null }), false); // no assignor employee
  assert.equal(isCompleteAccountOwner({ ...completeOwner, assignedByUserId: null }), false); // no assignor user
  assert.equal(isCompleteAccountOwner({ ...completeOwner, assignedAt: undefined }), false); // no timestamp
  assert.equal(isCompleteAccountOwner({ ...completeOwner, assignedAt: NaN }), false); // non-finite timestamp
  assert.equal(isCompleteAccountOwner({ assignedToUserId: "u-1" }), false); // bare id only
});
ok("accountOwner: an UNRESOLVED assignor (bare employeeId, no resolved name) fails closed", () => {
  // AuthContext keeps employeeId for a missing Employee document but leaves
  // displayName null -- a bare, unresolved assignor must not pass as provisioned.
  assert.equal(isCompleteAccountOwner({ ...completeOwner, assignedByDisplayName: null }), false);
  assert.equal(isCompleteAccountOwner({ ...completeOwner, assignedByDisplayName: "" }), false);
});

// --- aggregate validator ---
ok("commercialProfileErrors: valid complete draft -> no errors", () => {
  const r = commercialProfileErrors(
    { defaultCurrency: "USD", invoiceDeliveryMethod: "EMAIL", purchaseOrderRequired: true, billingContactId: "c-1", accountOwner: completeOwner },
    accountContacts
  );
  assert.deepEqual(r, { valid: true, errors: {} });
});
ok("commercialProfileErrors: invalid currency + cross-account contact + malformed PO + partial owner -> all flagged", () => {
  const r = commercialProfileErrors(
    { defaultCurrency: "usd", invoiceDeliveryMethod: "FAX", purchaseOrderRequired: "yes", billingContactId: "c-foreign", accountOwner: { assignedToUserId: "u-1" } },
    accountContacts
  );
  assert.equal(r.valid, false);
  assert.ok(r.errors.defaultCurrency);
  assert.ok(r.errors.invoiceDeliveryMethod);
  assert.ok(r.errors.purchaseOrderRequired);
  assert.ok(r.errors.billingContact);
  assert.ok(r.errors.accountOwner);
});
ok("commercialProfileErrors: billing validation is skipped while contacts are still resolving", () => {
  const r = commercialProfileErrors(
    { billingContactId: "c-foreign" },
    [],
    { contactsResolved: false }
  );
  assert.equal(r.errors.billingContact, undefined); // not flagged mid-load
  const r2 = commercialProfileErrors({ billingContactId: "c-foreign" }, [], { contactsResolved: true });
  assert.ok(r2.errors.billingContact); // flagged once resolved
});
ok("commercialProfileErrors: a contact-lookup error blocks with 'Unable to verify', NOT cross-account", () => {
  // Even an id that WOULD be a valid own-contact must block under a lookup
  // error, and must never be mislabeled as cross-account.
  const r = commercialProfileErrors({ billingContactId: "c-1" }, accountContacts, { contactsError: true });
  assert.equal(r.valid, false);
  assert.equal(r.errors.billingContact, "Unable to verify billing contact.");
  const r2 = commercialProfileErrors({ billingContactId: "c-foreign" }, [], { contactsError: true });
  assert.equal(r2.errors.billingContact, "Unable to verify billing contact.");
});

// --- identity resolution: states preserved (loading vs error vs unknown) ---
const byUserId = new Map([["u-1", { displayName: "Dana Prime (current)" }]]);
ok("resolveOwnerIdentity: unset -> {unset}", () => {
  assert.deepEqual(resolveOwnerIdentity(null, { byUserId }), { state: "unset", name: null });
  assert.deepEqual(resolveOwnerIdentity({ assignedToDisplayName: "x" }, { byUserId }), { state: "unset", name: null });
});
ok("resolveOwnerIdentity: loading -> {loading}, never 'Unknown' prematurely", () => {
  const r = resolveOwnerIdentity({ assignedToUserId: "u-gone" }, { byUserId: new Map(), loading: true });
  assert.equal(r.state, "loading");
  assert.equal(r.name, null);
});
ok("resolveOwnerIdentity: error -> {error}, not stuck loading", () => {
  const r = resolveOwnerIdentity({ assignedToUserId: "u-1" }, { byUserId: new Map(), error: new Error("denied") });
  assert.equal(r.state, "error");
});
ok("resolveOwnerIdentity: resolved -> CURRENT name (not the stored snapshot)", () => {
  const r = resolveOwnerIdentity({ assignedToUserId: "u-1", assignedToDisplayName: "Dana (stale snapshot)" }, { byUserId });
  assert.deepEqual(r, { state: "resolved", name: "Dana Prime (current)" });
});
ok("resolveOwnerIdentity: completed unresolved -> {unknown, 'Unknown owner'}", () => {
  const r = resolveOwnerIdentity({ assignedToUserId: "u-gone", assignedToDisplayName: "Old Name" }, { byUserId, loading: false });
  assert.deepEqual(r, { state: "unknown", name: "Unknown owner" });
});

ok("resolveContactIdentity: unset / loading / error / resolved / unknown", () => {
  assert.deepEqual(resolveContactIdentity(null, { contacts: accountContacts }), { state: "unset", name: null });
  assert.equal(resolveContactIdentity("c-1", { contacts: [], loading: true }).state, "loading");
  assert.equal(resolveContactIdentity("c-1", { contacts: [], error: new Error("x") }).state, "error");
  assert.deepEqual(resolveContactIdentity("c-1", { contacts: accountContacts }), { state: "resolved", name: "Dana Prime" });
  assert.deepEqual(resolveContactIdentity("c-foreign", { contacts: accountContacts }), { state: "unknown", name: "Unknown contact" });
});

console.log(`\n${passed} passed, 0 failed`);
