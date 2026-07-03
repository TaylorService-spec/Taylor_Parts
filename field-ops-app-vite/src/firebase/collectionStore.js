import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc } from "firebase/firestore";
import { db } from "./firebase";
import { JOBS_COLLECTION, TECHNICIANS_COLLECTION } from "../domain/constants";

// Thin wrapper so the module components don't each need to know
// Firestore's API shape.
export function makeCollectionStore(collectionName) {
  const colRef = collection(db, collectionName);
  return {
    list() {
      return getDocs(colRef).then((snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    },
    add(data) {
      return addDoc(colRef, { ...data, createdAt: Date.now() }).then((ref) => ({ id: ref.id, ...data }));
    },
    update(id, data) {
      return updateDoc(doc(db, collectionName, id), data).then(() => ({ id, ...data }));
    },
    remove(id) {
      return deleteDoc(doc(db, collectionName, id));
    },
  };
}

export const jobsStore = makeCollectionStore(JOBS_COLLECTION);
export const techniciansStore = makeCollectionStore(TECHNICIANS_COLLECTION);
