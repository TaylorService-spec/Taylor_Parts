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

// Customer Record Page sprint, PR 1 (docs/specifications/customer-record-page-structured-address.md,
// Architecture Decision item 5). Three states, never silently picks
// one Contact when multiple are marked primary -- nothing in the
// schema enforces isPrimary uniqueness today.
export function primaryContactState(contacts) {
  const primaries = (contacts ?? []).filter((c) => c.isPrimary);
  if (primaries.length === 0) return { state: "NONE" };
  if (primaries.length === 1) return { state: "ONE", contact: primaries[0] };
  return { state: "MULTIPLE", contacts: primaries };
}
