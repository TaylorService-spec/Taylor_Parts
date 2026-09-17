// EOS API (PostgreSQL CRM) implementation. Selected by src/domain/locations.js ONLY when CRM_VIA_EOS_API
// (domain/crmAuthorityRoute.js -- platform-sandbox builds); every other build uses the legacy Firestore implementation
// that stays in src/domain/locations.js. Imports no Firebase SDK and no Firestore helper; never falls back.
//
import { isWriteBlocked } from "../../../config/env";
import { locationInputFromForm, locationRowFromCrm, newIdempotencyKey, requireCrmApi } from "../../../services/crmApiClient.js";

// Customer-site (Location) writers. CRM CUTOVER: written through the governed PostgreSQL CRM authority (EOS API,
// POST /crm/customer) as eos_crm.account_locations. A customer site always belongs to one Account. No Firestore write,
// no fallback.
export async function createLocation(accountId, data) {
  if (isWriteBlocked()) return { blocked: true };
  return locationRowFromCrm(await requireCrmApi("createAccountLocation", {
    idempotencyKey: newIdempotencyKey(), accountId, ...locationInputFromForm(data),
  }));
}

export async function updateLocation(id, data) {
  if (isWriteBlocked()) return { blocked: true };
  return locationRowFromCrm(await requireCrmApi("updateAccountLocation", { accountLocationId: id, ...locationInputFromForm(data) }));
}
