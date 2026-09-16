import { CONTACTS_COLLECTION } from "./constants";
import { makeCollectionStore } from "../firebase/collectionStore";
import { auth } from "../firebase/firebase";
import { assertClientCrmWriterOpen } from "./crmCutoverFreeze";

// Sprint 2.0.2 -- Customer Foundation (docs/BusinessEntityModel.md).
// A Contact is: { id, accountId, name, phone?, email?, role?,
// isPrimary?, createdAt, createdBy, updatedAt, updatedBy }. Promoted
// from "data-layer only" to a minimal inline UI inside
// AccountDetail.jsx (Add Contact: Name/Phone/Email/Primary Contact) --
// intentionally lightweight, no standalone Contacts list/detail page
// or route.
export const contactsStore = makeCollectionStore(CONTACTS_COLLECTION);

// Legacy Contact provenance remains client-supplied while this Firestore path exists. During the
// platform-sandbox CRM cutover the client safety fuse below refuses before actor lookup or any
// collection-store call. This does not add Firebase Rules authority; the path is being frozen for
// migration and will be replaced by the governed PostgreSQL/EOS command path.
export function createContact(accountId, data) {
  assertClientCrmWriterOpen("contact.clientCreate");
  const now = Date.now();
  const actorUid = auth.currentUser?.uid ?? null;
  return contactsStore.add({
    ...data,
    accountId,
    createdBy: actorUid,
    updatedAt: now,
    updatedBy: actorUid,
  });
}

export function updateContact(id, data) {
  assertClientCrmWriterOpen("contact.clientUpdate");
  return contactsStore.update(id, {
    ...data,
    updatedAt: Date.now(),
    updatedBy: auth.currentUser?.uid ?? null,
  });
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
