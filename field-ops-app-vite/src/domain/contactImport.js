import { isWriteBlocked } from "../config/env";

// Contact CSV import -- the WRITE path, through the trusted command.
//
// WHAT MOVED. This file used to build a Firestore `writeBatch` in the browser, stamp
// `createdBy`/`updatedBy` from `auth.currentUser`, and rely on firestore.rules'
// `isAdminOrDispatcher()` as the only check. The server now resolves the actor from
// request.auth.uid and resolves `crm.contact.create` fail-closed
// (functions/src/crm/contactImportCommand.ts). A browser can no longer say who imported a contact.
//
// WHAT DID NOT MOVE. The batch is still ONE ATOMIC COMMIT -- every accepted contact or none, so a
// failure persists zero contacts and can never leave a partial set behind. The row bound, the
// `isPrimary: false` rule, the client-supplied provenance SHAPE and the `{ ids }` return are all
// unchanged. Row validation and duplicate detection stay in contactCsvImport.js, where they belong:
// they decide which rows the person is OFFERED, against contacts the person is looking at. The
// server validates what it is asked to write, which is a different question and always was.
//
// NO FALLBACK to the old writeBatch on failure. Two write authorities for one command is precisely
// what retiring the direct path removes.
//
// Still respects the platform demo/panic write gate before the round trip, returning the same
// `{ blocked }` sentinel as every other write path rather than calling out and being refused.
export async function importContacts(accountId, contacts = []) {
  if (isWriteBlocked()) return { blocked: true };

  // Lazy, matching services/reorderCallableClient.js: firebase/firebase.js runs initializeApp on
  // import, so a static import here would give this module an import-time side effect.
  const [{ httpsCallable }, { functions }] = await Promise.all([
    import("firebase/functions"),
    import("../firebase/firebase.js"),
  ]);

  // The payload carries the rows and the account, and nothing about the caller. There is no
  // createdBy/updatedBy field to send -- the server writes the actor it resolved, so a browser that
  // wanted to attribute an import to someone else has nothing to put it in.
  const res = await httpsCallable(functions, "importContacts")({
    accountId,
    contacts: contacts.map((c) => ({
      name: c.name,
      phone: c.phone || null,
      email: c.email || null,
      role: c.role || null,
    })),
  });
  return { ids: Array.isArray(res?.data?.ids) ? res.data.ids : [] };
}
