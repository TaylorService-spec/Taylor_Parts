// AUTH-PR-2 emulator evidence -- proves the mapping boundary and recovery
// containment WITHOUT changing production. Uses the Firebase CLIENT SDK (Rules
// ARE enforced, unlike the Admin SDK) against the Firestore + Auth emulators.
//
// Proves:
//  - usernames/{...} mapping is client-inaccessible (default-deny; there is no
//    usernames match block in firestore.rules) -- no client create/update/
//    delete and no public read, for both unauthenticated and authenticated
//    ordinary clients. Trusted-writer (Admin SDK) is the only path and is
//    intentionally NOT exercised here. No Rules change is made.
//  - a password-reset email is captured by the Auth emulator (stays local,
//    never sent externally) and the reset does not mutate the user's identity.
//
// Never touches the live project -- a demo projectId + emulator hosts only.
// Sanitized: never prints reset links, OOB codes, tokens, or UIDs.
//
// Run (from repo root, so firebase.json + firestore.rules are used):
//   firebase emulators:exec --only firestore,auth --project demo-authpr2 \
//     "node field-ops-app-vite/test/emulator/authPr2Boundary.mjs"
import assert from "node:assert/strict";
import { initializeApp } from "firebase/app";
import {
  getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, updateDoc, deleteDoc,
} from "firebase/firestore";
import {
  getAuth, connectAuthEmulator, createUserWithEmailAndPassword,
  sendPasswordResetEmail, signInWithEmailAndPassword, signOut,
} from "firebase/auth";

const PROJECT = process.env.GCLOUD_PROJECT || "demo-authpr2";
const app = initializeApp({ projectId: PROJECT, apiKey: "demo-key", authDomain: "localhost" });
const db = getFirestore(app);
connectFirestoreEmulator(db, "127.0.0.1", 8080);
const auth = getAuth(app);
connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });

let passed = 0;
async function expectDenied(name, op) {
  try {
    await op();
    assert.fail(`${name} -- expected permission-denied but the op SUCCEEDED`);
  } catch (e) {
    const code = String(e && (e.code || e.message));
    assert.ok(code.includes("permission-denied"), `${name} -- expected permission-denied, got: ${code}`);
    passed += 1;
    console.log("PASS -- " + name);
  }
}

const ref = doc(db, "usernames", "jane.smith");

// 1) Unauthenticated client is fully denied on the mapping.
await expectDenied("unauthenticated read usernames -> denied", () => getDoc(ref));
await expectDenied("unauthenticated create usernames -> denied", () => setDoc(ref, { uid: "x", active: true }));
await expectDenied("unauthenticated update usernames -> denied", () => updateDoc(ref, { active: false }));
await expectDenied("unauthenticated delete usernames -> denied", () => deleteDoc(ref));

// 2) An authenticated ORDINARY client is equally denied (no usernames rule).
const u1 = `user_${Date.now()}@example.com`;
await createUserWithEmailAndPassword(auth, u1, "Passw0rd!23");
await expectDenied("authenticated read usernames -> denied", () => getDoc(ref));
await expectDenied("authenticated create usernames -> denied", () => setDoc(ref, { uid: "y", active: true }));
await expectDenied("authenticated delete usernames -> denied", () => deleteDoc(ref));
await signOut(auth);

// 3) Reset email is captured locally by the emulator (never sent externally),
//    and the reset produces no identity mutation.
const resetEmail = `reset_${Date.now()}@example.com`;
await createUserWithEmailAndPassword(auth, resetEmail, "Passw0rd!23");
await signOut(auth);
await sendPasswordResetEmail(auth, resetEmail); // must not throw; captured locally
const oobRes = await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/oobCodes`);
const oobBody = await oobRes.json();
const resetCodes = (oobBody.oobCodes || []).filter(
  (c) => c.email === resetEmail && c.requestType === "PASSWORD_RESET",
);
assert.ok(resetCodes.length >= 1, "a PASSWORD_RESET OOB code must be captured in the emulator");
passed += 1;
console.log("PASS -- reset email captured in emulator (stays local; no external send)");

// Identity unchanged: the ORIGINAL credential still authenticates (the reset
// link was never consumed), proving the reset REQUEST mutated no identity.
const back = await signInWithEmailAndPassword(auth, resetEmail, "Passw0rd!23");
assert.ok(back.user && back.user.email === resetEmail, "original credential must still authenticate");
await signOut(auth);
passed += 1;
console.log("PASS -- original credential still valid (no identity mutation from reset request)");

console.log(`\n${passed} passed`);
process.exit(0);
