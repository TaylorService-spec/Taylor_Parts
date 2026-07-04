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
      return safeAddDoc(colRef, { ...data, createdAt: Date.now() }).then((ref) =>
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
