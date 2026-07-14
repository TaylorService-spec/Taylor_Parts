import { collection, doc, writeBatch } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { CONTACTS_COLLECTION } from "./constants";
import { isWriteBlocked } from "../config/env";

// Contact CSV import -- the WRITE path. All accepted contacts for ONE account are
// written in a single Firestore `writeBatch` (bounded above by
// contactCsvImport.js's MAX_IMPORT_ROWS, well under Firestore's 500-write batch
// cap). The batch is ATOMIC: it either commits every contact or none, so a
// failure persists ZERO contacts -- an invalid/failed import can never leave a
// partial set behind.
//
// This goes through the authenticated client SDK and Firestore Rules exactly like
// the single Add-Contact path (contacts `allow create: if isAdminOrDispatcher()`,
// no per-write cross-document invariant, so a batch of creates is Rules-legal for
// the same session) -- NO Admin SDK, NO Rules bypass, NO Cloud Function, NO
// production credential. It also respects the platform demo/panic write gate
// (config/env.js's isWriteBlocked), returning a { blocked } sentinel rather than
// writing, same convention as lib/firebaseSafe.js.
export async function importContacts(accountId, contacts = []) {
  if (isWriteBlocked()) return { blocked: true };
  const now = Date.now();
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
      updatedAt: now,
    });
  }
  await batch.commit();
  return { ids };
}
