import { collection, getDocs, doc } from "firebase/firestore";
import { db } from "./firebase";
import { JOBS_COLLECTION, TECHNICIANS_COLLECTION } from "../domain/constants";
import { safeAddDoc, safeUpdateDoc, safeDeleteDoc } from "../lib/firebaseSafe";

// Thin wrapper so the module components don't each need to know
// Firestore's API shape. Every write goes through lib/firebaseSafe.js's
// safe* wrappers, so demo/panic mode (config/env.js) blocks writes here
// the same way it does everywhere else.
export function makeCollectionStore(collectionName) {
  const colRef = collection(db, collectionName);
  return {
    list() {
      return getDocs(colRef).then((snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    },
    add(data) {
      // `updatedAt` IS STAMPED ON CREATE, not only on update.
      //
      // Firestore's orderBy SILENTLY EXCLUDES any document missing the ordered field. The Customers
      // index sorts by updatedAt DESC server-side (metadata/definitions/account.js), so a freshly
      // created Account -- which had only createdAt -- satisfied every filter and was still dropped
      // from the list and from the Prospect view. It remained findable by name search, which orders
      // by `name`, which is exactly the symptom that was reported: "the Prospect I just created is
      // not there, but I can search for it."
      //
      // Introduced by bd576a92 (#1137), which moved ordering from an in-memory subscription to a
      // server-ordered metadata list. The write path never changed; the field-existence requirement
      // simply became load-bearing and nothing said so.
      //
      // This repository had already written the warning down -- see the note in
      // metadata/definitions/inventoryTransaction.js about orderBy excluding documents missing the
      // sorted field. Stamping here fixes it for EVERY collection through this shared writer, rather
      // than for accounts alone.
      const now = Date.now();
      return safeAddDoc(colRef, { createdAt: now, updatedAt: now, ...data }).then((ref) =>
        ref.blocked ? ref : { id: ref.id, ...data }
      );
    },
    update(id, data) {
      return safeUpdateDoc(doc(db, collectionName, id), data).then((result) =>
        result?.blocked ? result : { id, ...data }
      );
    },
    remove(id) {
      return safeDeleteDoc(doc(db, collectionName, id));
    },
  };
}

export const jobsStore = makeCollectionStore(JOBS_COLLECTION);
export const techniciansStore = makeCollectionStore(TECHNICIANS_COLLECTION);
