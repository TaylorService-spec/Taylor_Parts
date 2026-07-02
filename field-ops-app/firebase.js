// ---------- Firebase setup ----------
//
// Uses the same Firebase project as the Parts Control Center app
// (../index.html) but writes to its own top-level collections so the two
// apps never collide: "fieldops_jobs", "fieldops_technicians".
//
// If this ever needs to live in its own Firebase project, just swap the
// values below for the config from a new project's
// Project settings -> Your apps -> Web app.

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyATXIiI5C1m" + "LmsvS0k-x3i7ZxAbAPtRpSY",
  authDomain: "taylor-parts.firebaseapp.com",
  projectId: "taylor-parts",
  storageBucket: "taylor-parts.firebasestorage.app",
  messagingSenderId: "664399427363",
  appId: "1:664399427363:web:de29dd9ae77bf548907e96",
  measurementId: "G-58GLNRJ5C8",
};

let db = null;
try {
  firebase.initializeApp(FIREBASE_CONFIG);
  db = firebase.firestore();
} catch (e) {
  console.error("Firebase init failed:", e);
}

// ---------- shared collection helper ----------
//
// Thin wrapper so the view modules (jobs.js, technicians.js, ...) don't
// each need to know Firestore's API shape.
function makeCollectionStore(collectionName) {
  return {
    list() {
      if (!db) return Promise.reject(new Error("no db"));
      return db
        .collection(collectionName)
        .get()
        .then((snap) => snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    },
    add(data) {
      if (!db) return Promise.reject(new Error("no db"));
      return db
        .collection(collectionName)
        .add({ ...data, createdAt: Date.now() })
        .then((ref) => ({ id: ref.id, ...data }));
    },
    update(id, data) {
      if (!db) return Promise.reject(new Error("no db"));
      return db
        .collection(collectionName)
        .doc(id)
        .update(data)
        .then(() => ({ id, ...data }));
    },
    remove(id) {
      if (!db) return Promise.reject(new Error("no db"));
      return db.collection(collectionName).doc(id).delete();
    },
    onChange(callback) {
      if (!db) return () => {};
      return db.collection(collectionName).onSnapshot((snap) => {
        callback(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
      });
    },
  };
}

window.FieldOps = window.FieldOps || {};
window.FieldOps.db = db;
window.FieldOps.jobsStore = makeCollectionStore("fieldops_jobs");
window.FieldOps.techniciansStore = makeCollectionStore("fieldops_technicians");
