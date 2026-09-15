import { isWriteBlocked } from "../config/env";
import { contactInputFromForm, contactRowFromCrm, newIdempotencyKey, requireCrmApi } from "../services/crmApiClient.js";

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
