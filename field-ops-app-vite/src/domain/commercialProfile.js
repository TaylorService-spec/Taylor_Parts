import { INVOICE_DELIVERY_METHOD } from "./constants.js";

// Account Commercial Profile -- PR 1 (docs/specifications/
// account-commercial-profile-and-financial-forecast-horizons.md).
// PURE validation + identity-resolution helpers -- no Firebase import, so
// they are directly unit-testable in Node. PR 1 fields only: defaultCurrency,
// purchaseOrderRequired, invoiceDeliveryMethod, billingContact, accountOwner.
// No paymentTerms/taxStatus/parentAccount/credit/forecast here (later PRs).

// --- Validation --------------------------------------------------------

// A valid ISO 4217 currency code. Format is three uppercase letters; when the
// runtime exposes the ISO 4217 list (Intl.supportedValuesOf), membership is
// checked too, so a well-formatted non-currency like "ZZZ" is rejected.
export function isValidIso4217(code) {
  if (typeof code !== "string" || !/^[A-Z]{3}$/.test(code)) return false;
  try {
    if (typeof Intl !== "undefined" && typeof Intl.supportedValuesOf === "function") {
      return Intl.supportedValuesOf("currency").includes(code);
    }
  } catch {
    // fall through to format-only acceptance when the list is unavailable
  }
  return true;
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

// accountOwner is a valid Person Assignment when unset, or when it carries at
// least a linked userId or employeeId (the picker resolves a real person; a
// raw/unresolvable id is not a valid assignment).
export function isValidAccountOwner(accountOwner) {
  if (!accountOwner) return true;
  return Boolean(accountOwner.assignedToUserId || accountOwner.assignedToEmployeeId);
}

// Pure aggregate validator used by the form. Returns { valid, errors } where
// errors is keyed by field. Only validates fields that are set.
export function commercialProfileErrors(draft, accountContacts) {
  const errors = {};
  if (draft.defaultCurrency && !isValidIso4217(draft.defaultCurrency)) {
    errors.defaultCurrency = "Enter a valid ISO 4217 currency code (e.g. USD).";
  }
  if (draft.invoiceDeliveryMethod && !isValidInvoiceDeliveryMethod(draft.invoiceDeliveryMethod)) {
    errors.invoiceDeliveryMethod = "Choose a valid invoice delivery method.";
  }
  if (draft.purchaseOrderRequired !== undefined && !isBooleanPurchaseOrderRequired(draft.purchaseOrderRequired)) {
    errors.purchaseOrderRequired = "PO-required must be true or false.";
  }
  if (!isContactOnAccount(draft.billingContactId, accountContacts)) {
    errors.billingContact = "Billing contact must belong to this Account.";
  }
  if (!isValidAccountOwner(draft.accountOwner)) {
    errors.accountOwner = "Select an account owner by name.";
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

// --- Identity resolution (current-name resolution + "Unknown …") -------

// Current display name for the account owner, re-resolved from the stable
// internal reference (userId) via the employee directory -- NOT the stored
// snapshot. Unresolved -> "Unknown owner"; unset -> null (omit).
export function resolveOwnerDisplayName(accountOwner, byUserId) {
  if (!accountOwner || (!accountOwner.assignedToUserId && !accountOwner.assignedToEmployeeId)) {
    return null;
  }
  const userId = accountOwner.assignedToUserId;
  const current = userId ? byUserId?.get?.(userId)?.displayName : null;
  return current ?? "Unknown owner";
}

// Current display name for the billing contact, resolved from this Account's
// own contacts. Unresolved (or a contact no longer on the Account) ->
// "Unknown contact"; unset -> null (omit).
export function resolveContactName(contactId, accountContacts) {
  if (!contactId) return null;
  const found = (accountContacts ?? []).find((c) => c.id === contactId);
  return found?.name ?? "Unknown contact";
}
