import { CONTACTS_COLLECTION } from "./constants";
import { makeCollectionStore } from "../firebase/collectionStore";

// Sprint 2.0.2 -- Customer Foundation (docs/BusinessEntityModel.md).
// A Contact is: { id, accountId, name, phone?, email?, role?,
// isPrimary?, createdAt, updatedAt }. Promoted from "data-layer only"
// to a minimal inline UI inside AccountDetail.jsx (Add Contact: Name/
// Phone/Email/Primary Contact) -- intentionally lightweight, no
// standalone Contacts list/detail page or route.
export const contactsStore = makeCollectionStore(CONTACTS_COLLECTION);

export function createContact(accountId, data) {
  return contactsStore.add({ ...data, accountId });
}

export function updateContact(id, data) {
  return contactsStore.update(id, { ...data, updatedAt: Date.now() });
}
