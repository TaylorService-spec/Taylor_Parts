import { INVOICE_DELIVERY_METHOD } from "./constants.js";

// Account Commercial Profile -- PR 1 (docs/specifications/
// account-commercial-profile-and-financial-forecast-horizons.md).
// PURE validation + identity-resolution helpers -- no Firebase import, so
// they are directly unit-testable in Node. PR 1 fields only: defaultCurrency,
// purchaseOrderRequired, invoiceDeliveryMethod, billingContact, accountOwner.
// No paymentTerms/taxStatus/parentAccount/credit/forecast here (later PRs).

// --- Validation --------------------------------------------------------

// Deterministic canonical ISO 4217 alphabetic-code set (active national +
// supranational currencies and the standard fund/precious-metal codes). This
// is the single source of truth for currency validity -- validation FAILS
// CLOSED against it and does NOT fall back to accepting arbitrary well-formed
// codes when a runtime currency list happens to be unavailable. Excludes the
// non-currency placeholders (XXX "no currency", XTS "testing", ZZZ), so a
// well-formatted non-currency is rejected on every runtime.
const ISO_4217_CURRENCIES = new Set([
  "AED", "AFN", "ALL", "AMD", "ANG", "AOA", "ARS", "AUD", "AWG", "AZN",
  "BAM", "BBD", "BDT", "BGN", "BHD", "BIF", "BMD", "BND", "BOB", "BOV",
  "BRL", "BSD", "BTN", "BWP", "BYN", "BZD", "CAD", "CDF", "CHE", "CHF",
  "CHW", "CLF", "CLP", "CNY", "COP", "COU", "CRC", "CUC", "CUP", "CVE",
  "CZK", "DJF", "DKK", "DOP", "DZD", "EGP", "ERN", "ETB", "EUR", "FJD",
  "FKP", "GBP", "GEL", "GHS", "GIP", "GMD", "GNF", "GTQ", "GYD", "HKD",
  "HNL", "HRK", "HTG", "HUF", "IDR", "ILS", "INR", "IQD", "IRR", "ISK",
  "JMD", "JOD", "JPY", "KES", "KGS", "KHR", "KMF", "KPW", "KRW", "KWD",
  "KYD", "KZT", "LAK", "LBP", "LKR", "LRD", "LSL", "LYD", "MAD", "MDL",
  "MGA", "MKD", "MMK", "MNT", "MOP", "MRU", "MUR", "MVR", "MWK", "MXN",
  "MXV", "MYR", "MZN", "NAD", "NGN", "NIO", "NOK", "NPR", "NZD", "OMR",
  "PAB", "PEN", "PGK", "PHP", "PKR", "PLN", "PYG", "QAR", "RON", "RSD",
  "RUB", "RWF", "SAR", "SBD", "SCR", "SDG", "SEK", "SGD", "SHP", "SLE",
  "SLL", "SOS", "SRD", "SSP", "STN", "SVC", "SYP", "SZL", "THB", "TJS",
  "TMT", "TND", "TOP", "TRY", "TTD", "TWD", "TZS", "UAH", "UGX", "USD",
  "USN", "UYI", "UYU", "UYW", "UZS", "VED", "VES", "VND", "VUV", "WST",
  "XAF", "XAG", "XAU", "XBA", "XBB", "XBC", "XBD", "XCD", "XDR", "XOF",
  "XPD", "XPF", "XPT", "XSU", "XUA", "YER", "ZAR", "ZMW", "ZWL",
]);

// A valid ISO 4217 currency code: three uppercase letters AND a member of the
// canonical set above. Fail-closed and deterministic across all runtimes.
export function isValidIso4217(code) {
  if (typeof code !== "string" || !/^[A-Z]{3}$/.test(code)) return false;
  return ISO_4217_CURRENCIES.has(code);
}

export function isValidInvoiceDeliveryMethod(value) {
  return Object.values(INVOICE_DELIVERY_METHOD).includes(value);
}

export function isBooleanPurchaseOrderRequired(value) {
  return typeof value === "boolean";
}

// billingContact must reference a Contact belonging to THIS Account. An unset
// (falsy) contactId is valid (the field is optional); a set id must be found
// among the Account's own contacts -- a contact from another Account is
// rejected.
export function isContactOnAccount(contactId, accountContacts) {
  if (!contactId) return true;
  return (accountContacts ?? []).some((c) => c.id === contactId);
}

// accountOwner is a COMPLETE Person Assignment. Unset (null/undefined) is
// valid -- the field is optional. When set, it must carry the full assignment
// record, never merely a present id:
//   - reciprocally linked assignee pair: assignedToEmployeeId + assignedToUserId
//   - resolved assignee display-name snapshot: assignedToDisplayName
//   - assignor identity from the authenticated session: assignedByEmployeeId +
//     assignedByUserId
//   - a finite assignedAt timestamp
// A partial record (e.g. an assignee id with no linked user, or no assignor)
// is rejected -- an arbitrary id is not accepted just because it is present.
export function isCompleteAccountOwner(accountOwner) {
  if (accountOwner == null) return true;
  const hasAssignee = Boolean(accountOwner.assignedToEmployeeId && accountOwner.assignedToUserId);
  const hasSnapshot = Boolean(accountOwner.assignedToDisplayName);
  const hasAssignor = Boolean(accountOwner.assignedByEmployeeId && accountOwner.assignedByUserId);
  return hasAssignee && hasSnapshot && hasAssignor && Number.isFinite(accountOwner.assignedAt);
}

// Pure aggregate validator used by the form. Returns { valid, errors } where
// errors is keyed by field. Validates set fields; billingContact validation is
// skipped while the Account's contacts are still resolving (contactsResolved:
// false) so a not-yet-loaded list can't produce a spurious "not on account"
// error.
export function commercialProfileErrors(draft, accountContacts, { contactsResolved = true } = {}) {
  const errors = {};
  if (draft.defaultCurrency && !isValidIso4217(draft.defaultCurrency)) {
    errors.defaultCurrency = "Enter a valid ISO 4217 currency code (e.g. USD).";
  }
  if (draft.invoiceDeliveryMethod && !isValidInvoiceDeliveryMethod(draft.invoiceDeliveryMethod)) {
    errors.invoiceDeliveryMethod = "Choose a valid invoice delivery method.";
  }
  if (draft.purchaseOrderRequired !== undefined && !isBooleanPurchaseOrderRequired(draft.purchaseOrderRequired)) {
    errors.purchaseOrderRequired = "Purchase-order-required must be true or false.";
  }
  if (contactsResolved && !isContactOnAccount(draft.billingContactId, accountContacts)) {
    errors.billingContact = "Billing contact must belong to this Account.";
  }
  if (!isCompleteAccountOwner(draft.accountOwner)) {
    errors.accountOwner =
      "Assign an account owner with a linked employee and user (and a provisioned assignor session).";
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

// --- Identity resolution (state-aware: loading / resolved / unknown) ----
//
// Identity states are preserved rather than collapsed to a name string, so the
// UI can distinguish "still resolving" from "resolved to nobody". "unknown"
// (and its "Unknown …" label) is only reported AFTER a completed, non-erroring
// lookup -- never while loading, and never on a listener error.
//   state: "unset"    -> no reference stored (omit from the UI)
//          "loading"  -> lookup source is still resolving
//          "error"    -> lookup source failed (don't hang on loading)
//          "resolved" -> a current name was found (name = current name)
//          "unknown"  -> lookup completed but the reference resolved to nobody

// Current display identity for the account owner, re-resolved from the stable
// internal reference (userId) via the employee directory -- NOT the stored
// snapshot.
export function resolveOwnerIdentity(accountOwner, { byUserId, loading = false, error = null } = {}) {
  const userId = accountOwner?.assignedToUserId;
  const employeeId = accountOwner?.assignedToEmployeeId;
  if (!accountOwner || (!userId && !employeeId)) return { state: "unset", name: null };
  if (error) return { state: "error", name: "Owner name unavailable" };
  if (loading) return { state: "loading", name: null };
  const current = userId ? byUserId?.get?.(userId)?.displayName : null;
  if (current) return { state: "resolved", name: current };
  return { state: "unknown", name: "Unknown owner" };
}

// Current display identity for the billing contact, resolved from this
// Account's own contacts.
export function resolveContactIdentity(contactId, { contacts, loading = false, error = null } = {}) {
  if (!contactId) return { state: "unset", name: null };
  if (error) return { state: "error", name: "Contact name unavailable" };
  if (loading) return { state: "loading", name: null };
  const found = (contacts ?? []).find((c) => c.id === contactId);
  if (found?.name) return { state: "resolved", name: found.name };
  return { state: "unknown", name: "Unknown contact" };
}
