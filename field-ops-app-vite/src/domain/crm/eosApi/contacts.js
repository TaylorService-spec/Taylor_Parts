// EOS API (PostgreSQL CRM) implementation. Selected by src/domain/contacts.js ONLY when CRM_VIA_EOS_API
// (domain/crmAuthorityRoute.js -- platform-sandbox builds); every other build uses the legacy Firestore implementation
// that stays in src/domain/contacts.js. Imports no Firebase SDK and no Firestore helper; never falls back.
//
import { isWriteBlocked } from "../../../config/env";
import { contactInputFromForm, contactRowFromCrm, newIdempotencyKey, requireCrmApi } from "../../../services/crmApiClient.js";

// Contact writers. CRM CUTOVER: a Contact is written through the governed PostgreSQL CRM authority (EOS API,
// POST /crm/customer). Attribution (created_by / updated_by = the EOS Principal) and timestamps are the SERVER's; the
// client supplies neither, and there is no Firestore write or fallback.
export async function createContact(accountId, data) {
  if (isWriteBlocked()) return { blocked: true };
  return contactRowFromCrm(await requireCrmApi("createContact", {
    idempotencyKey: newIdempotencyKey(), accountId, ...contactInputFromForm(data),
  }));
}

export async function updateContact(id, data) {
  if (isWriteBlocked()) return { blocked: true };
  return contactRowFromCrm(await requireCrmApi("updateContact", { contactId: id, ...contactInputFromForm(data) }));
}
