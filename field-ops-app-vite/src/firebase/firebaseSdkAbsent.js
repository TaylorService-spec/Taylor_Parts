// THE FIREBASE SDK'S STAND-IN FOR AN EOS-ONLY BUILD (Firebase retirement, P0 Firebase-exit).
//
// vite.config.js aliases `firebase/app`, `firebase/auth`, `firebase/firestore` and `firebase/functions` to THIS file when the
// build is EOS-only (`VITE_AUTH_SOURCE=eos`, allowed only by config/environments.json `authSources`). firebaseAbsent.js already
// made the app handles null, but ~18 files import the SDK packages directly, so the SDK code (Auth, Firestore, Functions and the
// Google endpoints they carry) was still bundled behind handles that are null at runtime. With this alias none of it is.
//
// FAIL CLOSED, NEVER FALL BACK. Every SDK entry point that a file imports is exported here and refuses with
// code FIREBASE_ABSENT: the handles are null, so the real SDK would have thrown on them anyway; this makes the refusal explicit
// and names the cause. httpsCallable returns a callable that REJECTS (all callers invoke `httpsCallable(functions, name)(payload)`
// inside an async path), so a screen not yet migrated to its EOS replacement (see docs/firebase-exit/
// firebase-dependency-reconciliation-2026-10-20.md section 3) reports "not available" through its existing error path.
//
// This file imports nothing from firebase/ (asserted by test/b2EosOnlySignIn.test.mjs and the bundle guard). Any other build
// has no alias and loads the real SDK, byte-for-byte as before.
const absent = () =>
  Object.assign(new Error("Firebase is not available in this build; this feature has no EOS path yet"), { code: "FIREBASE_ABSENT" });
const refuse = () => {
  throw absent();
};

// firebase/app
export const initializeApp = refuse;
// firebase/auth
export const getAuth = refuse;
export const connectAuthEmulator = refuse;
export const onAuthStateChanged = refuse;
export const signInWithEmailAndPassword = refuse;
export const sendPasswordResetEmail = refuse;
export const signOut = refuse;
// firebase/firestore
export const getFirestore = refuse;
export const connectFirestoreEmulator = refuse;
export const collection = refuse;
export const doc = refuse;
export const query = refuse;
export const where = refuse;
export const getDoc = refuse;
export const getDocs = refuse;
export const onSnapshot = refuse;
// `Timestamp` is imported only as a type (operationsQueries.ts); exported so a value import could never fail to link.
export const Timestamp = undefined;
// firebase/functions
export const getFunctions = refuse;
export const connectFunctionsEmulator = refuse;
export const httpsCallable = () => () => Promise.reject(absent());
