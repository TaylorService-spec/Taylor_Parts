import { initializeApp } from "firebase/app";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFunctions } from "firebase/functions";

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
export const auth = getAuth(app);
// Work Order Engine v1.2 (Epic 1): region must match functions/src's
// deploy region (see functions/src/createWorkOrder.ts/
// transitionWorkOrder.ts's onCall({ region: "us-central1" })).
export const functions = getFunctions(app, "us-central1");

// Local dev/agent-driven smoke testing only -- opt-in via ?emulator=1,
// same URL-param mode-switching pattern as config/env.js's ?env=demo.
// Gated on import.meta.env.DEV (ChatGPT architecture review on PR #93:
// a query param alone is reachable in a production build -- this
// branch must be unreachable there, not just off-by-default) so a
// production build has no path to this code at all, not merely a
// param that defaults to inactive. Never touches the live
// "taylor-parts" project in dev either, unless the param is present.
// See .claude/skills/run-field-ops-app-vite/ for the driver that uses
// this to sign in against the Firestore/Auth emulator without ever
// authenticating against production.
if (import.meta.env.DEV && new URLSearchParams(window.location.search).get("emulator") === "1") {
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
}
