import { ACCOUNTS_COLLECTION } from "./constants";
import { makeCollectionStore } from "../firebase/collectionStore";
import { normalizeNameForSearch, SEARCH_NAME_FIELD } from "./nameNormalization";

// Sprint 2.0.2 -- Customer Foundation (docs/BusinessEntityModel.md).
// Revives the previously dead domain/customers.js (zero importers,
// never wired to any UI) as domain/accounts.js -- internal naming is
// "Account" throughout; the UI labels this "Customers" where that's
// clearer for users (see BusinessEntityModel.md's naming
// recommendation). Same makeCollectionStore shape as jobsStore/
// techniciansStore -- no transactional logic needed here, unlike
// jobActions.js's assignJob(), since Accounts have no state machine
// and no cross-document invariant to protect. Writes go through this
// file directly (client-direct-write-with-rules), not a Cloud
// Function -- see firestore.rules' accounts match block for why.
//
// An Account is: { id, name, billingAddress?, status?, notes?, tags?,
// customerNumber?, erpId?, accountingId?, legacyId?, createdAt,
// updatedAt }. status is one of ACCOUNT_STATUS (domain/constants.js).
// The four external-identifier fields (customerNumber/erpId/
// accountingId/legacyId) are reserved for future integrations only --
// nothing in this sprint populates or reads them beyond passing
// through whatever a user types.
//
// createdAt/updatedAt are Date.now() epoch-ms numbers, not Firestore
// Timestamps -- same convention makeCollectionStore already uses for
// jobsStore/techniciansStore (see firebase/collectionStore.js), kept
// consistent here rather than introducing a second timestamp
// convention for only these three new collections.
//
// Commercial Profile fields (PR 1: defaultCurrency/purchaseOrderRequired/
// invoiceDeliveryMethod/billingContact/accountOwner; PR 2:
// paymentTerms/taxStatus) are additive and flow through this generic store
// untouched -- there is no field-specific write logic here. The two PR-2
// GOVERNED fields' value-validation AND admin-only-edit authorization are
// enforced in firestore.rules, not in this client writer.
//
// INTERIM (audit-integrity invariant, per the Implementation Plan): this
// admin/dispatcher client-direct-write path is valid only until PR 3b's
// audit log + trusted server-side writer ship, at which point Commercial
// Profile mutations move there and direct client mutation is Rules-denied.
export const accountsStore = makeCollectionStore(ACCOUNTS_COLLECTION);

// ============================ THE DERIVED SEARCH NAME ============================
//
// `nameLower` is a normalized copy of `name`, and the customer search box queries it rather than
// `name` because Firestore cannot compare case-insensitively -- searching "mesquite" could not find
// "Mesquite Soda Works" while the query ran against the display name.
//
// A derived field is only as good as its weakest writer. If ONE path sets `name` without setting
// `nameLower`, that customer becomes permanently unfindable by search, and the symptom -- "search
// sometimes doesn't find things" -- gives no hint of the cause. So the derivation happens HERE, in
// the writers themselves, rather than at the call sites: a caller cannot forget what it never had
// to remember. `accountWriteContract.test.mjs` asserts that this stays true.

/** Fold the derived field in whenever a name is present on the payload. */
function withDerivedSearchName(data) {
  if (!data || typeof data !== "object") return data;
  // Absent `name` means this write is not touching the name, so the stored derivation still
  // matches and must not be clobbered with the empty string.
  if (!("name" in data)) return data;
  return { ...data, [SEARCH_NAME_FIELD]: normalizeNameForSearch(data.name) };
}

export function createAccount(data) {
  return accountsStore.add(withDerivedSearchName(data));
}

export function updateAccount(id, data) {
  return accountsStore.update(id, { ...withDerivedSearchName(data), updatedAt: Date.now() });
}
