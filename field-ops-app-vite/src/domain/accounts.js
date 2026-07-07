import { ACCOUNTS_COLLECTION } from "./constants";
import { makeCollectionStore } from "../firebase/collectionStore";

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
export const accountsStore = makeCollectionStore(ACCOUNTS_COLLECTION);

export function createAccount(data) {
  return accountsStore.add(data);
}

export function updateAccount(id, data) {
  return accountsStore.update(id, { ...data, updatedAt: Date.now() });
}
