import { isWriteBlocked } from "../config/env";
import { contactInputFromForm, newIdempotencyKey, requireCrmApi } from "../services/crmApiClient.js";

// CSV contact import. CRM CUTOVER: the accepted rows for ONE Account are written by the governed PostgreSQL CRM
// authority's ATOMIC import (EOS API `importAccountContacts`, functions/src/eosCrm/contactAuthority.ts): one request,
// one transaction, one idempotency receipt -- every Contact or none, exactly the all-or-nothing contract the legacy
// Firestore batch had (Owner ruling: CSV Contact import stays all-or-nothing through a governed server-side bulk
// transaction). Imported Contacts are never primary (contactCsvImport.js). The server validates every row before
// writing and refuses the whole import with per-row findings. No Firestore write and no fallback.
export async function importContacts(accountId, contacts = []) {
  if (isWriteBlocked()) return { blocked: true };
  const result = await requireCrmApi("importAccountContacts", {
    idempotencyKey: newIdempotencyKey(),
    accountId,
    contacts: contacts.map((c) => contactInputFromForm({
      name: c.name, phone: c.phone || null, email: c.email || null, role: c.role || null, isPrimary: false,
    })),
  });
  return { ids: (result?.contacts ?? []).map((c) => c.contactId) };
}
