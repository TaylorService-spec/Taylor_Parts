// ---------- Firebase setup (modular v9+ SDK) ----------
//
// Uses the same Firebase project as the Parts Control Center app
// (../index.html) but writes to its own top-level collections so the two
// apps never collide: "fieldops_jobs", "fieldops_technicians".
//
// This file is loaded as a native ES module (see index.html), so it can
// use the Firebase modular SDK directly. jobs.js/technicians.js/etc. are
// Babel-transformed JSX loaded as classic scripts — Babel standalone's
// module output runs from blob: URLs, where relative imports don't
// resolve (https://babeljs.io/docs/babel-standalone#usage), so instead of
// importing this module they read its output off window.FieldOps.
//
// If this ever needs to live in its own Firebase project, just swap the
// values below for the config from a new project's
// Project settings -> Your apps -> Web app.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore,
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyATXIiI5C1m" + "LmsvS0k-x3i7ZxAbAPtRpSY",
  authDomain: "taylor-parts.firebaseapp.com",
  projectId: "taylor-parts",
  storageBucket: "taylor-parts.firebasestorage.app",
  messagingSenderId: "664399427363",
  appId: "1:664399427363:web:de29dd9ae77bf548907e96",
  measurementId: "G-58GLNRJ5C8",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// ---------- shared collection helper ----------
//
// Thin wrapper so the view modules (jobs.js, technicians.js, ...) don't
// each need to know Firestore's API shape.
function makeCollectionStore(collectionName) {
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

window.FieldOps = window.FieldOps || {};
window.FieldOps.db = db;
window.FieldOps.jobsStore = makeCollectionStore("fieldops_jobs");
window.FieldOps.techniciansStore = makeCollectionStore("fieldops_technicians");
