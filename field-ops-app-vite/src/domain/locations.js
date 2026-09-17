import { isWriteBlocked } from "../config/env";
import { locationInputFromForm, locationRowFromCrm, newIdempotencyKey, requireCrmApi } from "../services/crmApiClient.js";

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
