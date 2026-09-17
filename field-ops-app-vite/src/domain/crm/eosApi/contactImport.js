// EOS API (PostgreSQL CRM) implementation. Selected by src/domain/contactImport.js ONLY when CRM_VIA_EOS_API
// (domain/crmAuthorityRoute.js -- platform-sandbox builds); every other build uses the legacy Firestore implementation
// that stays in src/domain/contactImport.js. Imports no Firebase SDK and no Firestore helper; never falls back.
//
import { isWriteBlocked } from "../../../config/env";
import { contactInputFromForm, newIdempotencyKey, requireCrmApi } from "../../../services/crmApiClient.js";

// CSV contact import. CRM CUTOVER: ONE importAccountContacts call through the governed PostgreSQL CRM authority (EOS API):
// all accepted rows for one Account in one transaction, ALL OR NONE, under one idempotency key. Imported contacts are
// never primary. No Firestore batch and no fallback.
//
// IDEMPOTENCY: the key names ONE import intent (the validated preview the user confirmed). The modal creates it with
// newContactImportKey() and passes the SAME key on a retry of that intent, so a retry after an unknown outcome replays
// the recorded result instead of importing twice; a changed preview is a new intent and gets a new key.
//
// A refusal throws with `nothingImported: true`, the server's code/status/message, and -- for IMPORT_ROWS_INVALID --
// the server's per-row `findings` (index = position in `contacts`).
export const MAX_CONTACT_IMPORT_ROWS = 200;

export function newContactImportKey() {
  return newIdempotencyKey();
}

export async function importContacts(accountId, contacts = [], { idempotencyKey = null } = {}) {
  if (isWriteBlocked()) return { blocked: true };
  if (!Array.isArray(contacts) || contacts.length === 0 || contacts.length > MAX_CONTACT_IMPORT_ROWS) {
    const err = new Error(`an import carries 1 to ${MAX_CONTACT_IMPORT_ROWS} contacts`);
    err.code = "IMPORT_SIZE_INVALID";
    err.status = 400;
    err.nothingImported = true;
    throw err;
  }
  try {
    const result = await requireCrmApi("importAccountContacts", {
      idempotencyKey: idempotencyKey ?? newIdempotencyKey(),
      accountId,
      contacts: contacts.map((c) => contactInputFromForm({ name: c.name, phone: c.phone || null, email: c.email || null, role: c.role || null, isPrimary: false })),
    });
    return { ids: (result.contacts ?? []).map((c) => c.contactId), importedCount: result.importedCount };
  } catch (err) {
    err.nothingImported = true;
    throw err;
  }
}
