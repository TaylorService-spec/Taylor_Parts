import { LOCATIONS_COLLECTION } from "./constants";
import { submitCreateLocation, submitUpdateLocation } from "../services/crmWriteClient";

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


// THROUGH THE TRUSTED COMMANDS. Locations gain the four provenance fields they never had: the
// store stamped createdAt/updatedAt and nothing else, so who created or last changed a site was
// simply not recorded. The server writes all four now, which is a small, deliberate widening of what
// is STORED -- not of who may store it.
export function createLocation(accountId, data) {
  return submitCreateLocation(accountId, data);
}

export function updateLocation(id, data) {
  return submitUpdateLocation(id, data);
}
