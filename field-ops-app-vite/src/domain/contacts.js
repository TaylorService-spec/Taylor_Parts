import { CONTACTS_COLLECTION } from "./constants";
import { makeCollectionStore } from "../firebase/collectionStore";
import { auth } from "../firebase/firebase";

// Sprint 2.0.2 -- Customer Foundation (docs/BusinessEntityModel.md).
// A Contact is: { id, accountId, name, phone?, email?, role?,
// isPrimary?, createdAt, createdBy, updatedAt, updatedBy }. Promoted
// from "data-layer only" to a minimal inline UI inside
// AccountDetail.jsx (Add Contact: Name/Phone/Email/Primary Contact) --
// intentionally lightweight, no standalone Contacts list/detail page
// or route.
export const contactsStore = makeCollectionStore(CONTACTS_COLLECTION);

// Contact provenance convergence -- Contact is a client-direct write (no
// callable; gated only by firestore.rules' isAdminOrDispatcher()), so unlike
// the metadata/v2/provenance.js invariant's SERVER-AUTHORITATIVE ideal, the
// actor and timestamp below are CLIENT-SUPPLIED CLAIMS, not server-verified
// provenance -- any caller able to write a Contact is able to write these
// values. Converging the SHAPE (createdAt/createdBy/updatedAt/updatedBy on
// every write) is what this change makes; making the values
// server-authoritative would require moving Contact writes behind a trusted
// command, which is a separate, not-yet-authorized decision.
//
// Actor identity reuses the SAME auth.currentUser?.uid ?? null pattern every
// other client-direct-write domain module already uses (e.g.
// domain/inventoryReorderRequests.js, domain/inventoryActions.js) -- no new
// actor-resolution path invented here.
export function createContact(accountId, data) {
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
