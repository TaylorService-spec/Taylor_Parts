import { isWriteBlocked } from "../config/env";
import { contactInputFromForm, newIdempotencyKey, requireCrmApi } from "../services/crmApiClient.js";

// CSV contact import. CRM CUTOVER: each accepted row is created through the governed PostgreSQL CRM authority (EOS API),
// one idempotent create per contact. Imported contacts are never auto-primary (see contactCsvImport.js). No Firestore
// batch write and no fallback; a refusal stops the import and reports how many were created before it.
export async function importContacts(accountId, contacts = []) {
  if (isWriteBlocked()) return { blocked: true };
  const ids = [];
  for (const c of contacts) {
    try {
      const created = await requireCrmApi("createContact", {
        idempotencyKey: newIdempotencyKey(),
        accountId,
        ...contactInputFromForm({ name: c.name, phone: c.phone || null, email: c.email || null, role: c.role || null, isPrimary: false }),
      });
      ids.push(created.contactId);
    } catch (err) {
      err.createdBeforeFailure = ids.length;
      throw err;
    }
  }
  return { ids };
}
