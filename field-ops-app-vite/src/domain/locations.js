import { LOCATIONS_COLLECTION } from "./constants";
import { makeCollectionStore } from "../firebase/collectionStore";

// Sprint 2.0.2 -- Customer Foundation (docs/BusinessEntityModel.md).
// A Location is: { id, accountId, name, address, accessNotes?,
// createdAt, updatedAt }. Recommended (and implemented) as a
// first-class collection related to Account by `accountId`, not an
// array embedded on the Account document -- see
// BusinessEntityModel.md's Option A/B comparison for why (scalability,
// direct querying, and consistency with every other FK-based
// relationship already in this codebase all favored this).
//
// No standalone Locations list/detail page exists this sprint --
// Locations are shown only nested inside AccountDetail.jsx. See
// hooks/useLocationsForAccount.js for the scoped read.
export const locationsStore = makeCollectionStore(LOCATIONS_COLLECTION);

export function createLocation(accountId, data) {
  return locationsStore.add({ ...data, accountId });
}

export function updateLocation(id, data) {
  return locationsStore.update(id, { ...data, updatedAt: Date.now() });
}
