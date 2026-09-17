import { LOCATIONS_COLLECTION } from "./constants";
import { makeCollectionStore } from "../firebase/collectionStore";
import { assertClientCrmWriterOpen } from "./crmCutoverFreeze";
import { createLocation as createLocationEosApi, updateLocation as updateLocationEosApi } from "./crm/eosApi/locations.js";

// Build-time CRM authority route (domain/crmAuthorityRoute.js): true only in a platform-sandbox build.
const CRM_VIA_EOS_API = typeof __APP_CRM_VIA_EOS_API__ === "boolean" && __APP_CRM_VIA_EOS_API__;

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

function createLocationFirestore(accountId, data) {
  assertClientCrmWriterOpen("location.clientCreate");
  return locationsStore.add({ ...data, accountId });
}

function updateLocationFirestore(id, data) {
  assertClientCrmWriterOpen("location.clientUpdate");
  return locationsStore.update(id, { ...data, updatedAt: Date.now() });
}

// ════════════════════ BUILD-TIME CRM AUTHORITY ROUTE ════════════════════
// The customer-site (Location) writer pair is selected ONCE, from the build's environment (domain/crmAuthorityRoute.js): a platform-sandbox build
// uses the EOS API implementation (domain/crm/eosApi/locations.js); every other build -- production included -- uses the legacy
// Firestore implementation above, unchanged. No runtime switch and no fallback between the two.
export const createLocation = CRM_VIA_EOS_API ? createLocationEosApi : createLocationFirestore;
export const updateLocation = CRM_VIA_EOS_API ? updateLocationEosApi : updateLocationFirestore;
