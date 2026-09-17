import { collection, doc, writeBatch } from "firebase/firestore";
import { auth, db } from "../firebase/firebase";
import { CONTACTS_COLLECTION } from "./constants";
import { isWriteBlocked } from "../config/env";
import { assertClientCrmWriterOpen } from "./crmCutoverFreeze";
import { importContacts as importContactsEosApi, newContactImportKey as newContactImportKeyEosApi } from "./crm/eosApi/contactImport.js";

// Build-time CRM authority route (domain/crmAuthorityRoute.js): true only in a platform-sandbox build.
const CRM_VIA_EOS_API = typeof __APP_CRM_VIA_EOS_API__ === "boolean" && __APP_CRM_VIA_EOS_API__;

// Contact CSV import -- the WRITE path. All accepted contacts for ONE account are
// written in a single Firestore `writeBatch` (bounded above by
// contactCsvImport.js's MAX_IMPORT_ROWS, well under Firestore's 500-write batch
// cap). The batch is ATOMIC: it either commits every contact or none, so a
// failure persists ZERO contacts -- an invalid/failed import can never leave a
// partial set behind.
//
// During the platform-sandbox CRM cutover this legacy client path is refused
// before a Firestore batch is created. No Firebase Rules change is used as the
// freeze mechanism. The path will be retired after PostgreSQL CRM activation.
async function importContactsFirestore(accountId, contacts = []) {
  assertClientCrmWriterOpen("contact.clientImport");
  if (isWriteBlocked()) return { blocked: true };
  const now = Date.now();
  // Contact provenance convergence -- same client-direct-write posture as
  // domain/contacts.js: this timestamp/actor are CLIENT-SUPPLIED CLAIMS, not
  // server-authoritative provenance. This remains legacy evidence only until
  // the Firestore path is retired.
  const actorUid = auth.currentUser?.uid ?? null;
  const batch = writeBatch(db);
  const ids = [];
  for (const c of contacts) {
    const ref = doc(collection(db, CONTACTS_COLLECTION));
    ids.push(ref.id);
    batch.set(ref, {
      accountId,
      name: c.name,
      phone: c.phone || null,
      email: c.email || null,
      role: c.role || null,
      // Imported contacts are never auto-primary (see contactCsvImport.js) --
      // primary is chosen per-contact in the UI.
      isPrimary: false,
      createdAt: now,
      createdBy: actorUid,
      updatedAt: now,
      updatedBy: actorUid,
    });
  }
  await batch.commit();
  return { ids };
}

// ════════════════════ BUILD-TIME CRM AUTHORITY ROUTE ════════════════════
// The Contact CSV import writer is selected ONCE, from the build's environment (domain/crmAuthorityRoute.js): a platform-sandbox build
// uses the EOS API implementation (domain/crm/eosApi/contactImport.js); every other build -- production included -- uses the legacy
// Firestore implementation above, unchanged. No runtime switch and no fallback between the two.
export const importContacts = CRM_VIA_EOS_API ? importContactsEosApi : importContactsFirestore;
// One idempotency key per import intent, created only by a platform-sandbox build's import modal. null elsewhere: the
// legacy atomic writeBatch has no idempotency receipt.
export const newContactImportKey = CRM_VIA_EOS_API ? newContactImportKeyEosApi : null;
