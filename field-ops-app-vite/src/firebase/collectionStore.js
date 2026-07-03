import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, onSnapshot } from "firebase/firestore";
import { db } from "./firebase";

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
    onChange(callback) {
      return onSnapshot(colRef, (snap) => {
        callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      });
    },
  };
}

export const jobsStore = makeCollectionStore("fieldops_jobs");
export const techniciansStore = makeCollectionStore("fieldops_technicians");
export const workOrdersStore = makeCollectionStore("fieldops_workorders");
